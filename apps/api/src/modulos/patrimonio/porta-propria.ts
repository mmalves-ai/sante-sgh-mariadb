// Porta PRÓPRIA do patrimônio (M54, etapa 6) sobre o MariaDB do cliente, pelo @sgh/nucleo: bem_patrimonial,
// movimento_bem, inventario_bem e inventario_bem_item, grupo_bem e cota_depreciacao; os domínios de origem_bem,
// tipo_responsavel_bem, coeficiente_turno e centro_custo; a nota de entrada de nota_entrada e nota_entrada_item.
// Leituras somente leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação), com a trava
// otimista pela `versao`. Toda leitura do estabelecimento filtra `estabelecimento_id` e `excluido_em IS NULL`; o grupo
// do bem, a origem, o tipo de responsável e o coeficiente são cadastros do cliente (rede inteira).
// Melhoria: as versões anteriores do grupo do bem vêm da trilha de auditoria (o retrato relido pela trava vai em
// dados_antes, com o motivo), sem tabela de versões à parte.
// Melhoria: a transferência grava o setor de origem e de destino (o setor do centro de custo), e o aceite move o bem
// de centro na mesma transação, relendo a versão do pedido e do bem.
// Melhoria: o número do inventário vem da sequencia_negocio do estabelecimento; a plaqueta gerada também, no formato
// do domínio (`formatarPlaqueta`, chamado com o número da sequência) e partindo da maior plaqueta já cadastrada no
// formato (o cliente migrado não colide); uma plaqueta já usada é pulada, nunca recusada.
// Melhoria: a baixa grava o motivo de baixa do cadastro (motivo_baixa_bem, pela FK), não o motivo em texto livre; o
// texto fica como a justificativa.
// Melhoria: a semente dos grupos (IN RFB) entra no cadastro do cliente na primeira gravação, na mesma transação.
// O laudo do bem grava em laudo_bem (o PDF fica no armazenamento, pela chave do SHA-256).
// Pendente (pedido ao orquestrador, DDL em docs/obra/fatias/f22/saida/02-11.json): cálculo e estorno da depreciação
// (cabeçalho do cálculo), ajuste de valor do bem, nome do responsável e doador do termo, referência da
// devolução, centro lido e resumo do inventário. Até lá, a gravação recusa com o código
// `modelo-pendente` (nada é gravado pela metade) e as leituras devolvem vazio.
import { GRUPOS_BEM, type VersaoGrupoBem } from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Operacao,
  recusa,
  restricaoUnicaViolada,
  type ResultadoOperacao,
  travarEConferir,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ContextoPatrimonio, PortaPatrimonio } from './porta.js';
import type {
  AjusteDoBem,
  AlteracaoDoBem,
  BemDaCompetencia,
  BemEsperado,
  BemRegistrado,
  CadastroDeBens,
  CalculoRegistrado,
  CotaRegistrada,
  DominiosPatrimonio,
  EstornoDeCalculo,
  FiltroBens,
  GrupoBemNovo,
  GrupoDoBem,
  InventarioRegistrado,
  ItemDaNota,
  LaudoDoBem,
  LeituraNova,
  LeituraRegistrada,
  MovimentoNovo,
  MovimentoRegistrado,
  NotaDeEntrada,
  SituacaoBem,
} from './tipos.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoPatrimonio {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const TETO_DOMINIO = 2000;
const TETO_NOTAS_MES = 300;
const TETO_ITENS_NOTA = 500;
const TETO_MOVIMENTOS = 500;
const TETO_INVENTARIOS = 100;
const TETO_BENS_LEITURA = 20_000;
/** O patrimônio é do estabelecimento: uma só "empresa" no contrato da tela. */
const EMPRESA_UNICA = 1;
const BASE_COTA = 'societaria';

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const inteiroOuNulo = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : inteiro(v));
const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
/** DECIMAL do banco em centavos, sem erro de ponto flutuante. */
function centavos(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(v).trim());
  if (!m) return Math.round(Number(v) * 100);
  const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -c : c;
}
const decimal = (c: number): string =>
  `${c < 0 ? '-' : ''}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const dataIso = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = texto(v);
  return t ? t.slice(0, 10) : null;
};
const instante = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 23);
  const t = texto(v);
  return t ? t.replace(' ', 'T').slice(0, 23) : null;
};
const codigoNumerico = (v: unknown): number | null => {
  const t = texto(v);
  return t && /^\d{1,15}$/.test(t) ? Number(t) : null;
};
/** "AAAA-MM" → primeiro dia do mês. */
const primeiroDia = (competencia: string) => `${competencia.slice(0, 7)}-01`;

const SITUACOES_BEM: Readonly<Record<string, SituacaoBem>> = {
  ativo: 'ativo',
  emprestado: 'emprestado',
  comodato: 'emprestado',
  em_manutencao: 'ativo',
  baixado: 'baixado',
};
const RESULTADO_PARA_BANCO: Readonly<Record<string, string>> = {
  conforme: 'conforme',
  'outro-local': 'outro_local',
  'nao-cadastrado': 'nao_cadastrado',
  baixado: 'baixado',
  emprestado: 'emprestado',
  repetida: 'repetida',
};
const RESULTADO_DO_BANCO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RESULTADO_PARA_BANCO).map(([k, v]) => [v, k]),
);

const modeloPendente = (oQue: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Ainda não disponível neste banco',
    `${oQue} ainda não tem onde ficar no banco próprio (pedido de modelo em andamento): nada foi gravado.`,
  );
const desatualizado = (o = 'O bem') =>
  recusa('desatualizado', `${o} mudou depois que você abriu. Abra de novo.`);
const naoEncontrado = (o: string) => new ErroOperacao(404, 'nao-encontrado', `${o} não encontrado`, `${o} não existe neste estabelecimento.`);

const SQL_LAUDO = `
  SELECT d.id, d.bem_patrimonial_id, d.nome_arquivo, d.descricao, d.chave_armazenamento, d.sha256, d.tamanho_bytes,
         d.criado_em, u.login
    FROM laudo_bem d
    JOIN bem_patrimonial b ON b.id = d.bem_patrimonial_id
    LEFT JOIN usuario u ON u.id = d.criado_por
   WHERE b.estabelecimento_id = ? AND d.excluido_em IS NULL`;

function laudoDe(x: Record<string, unknown>): LaudoDoBem {
  return {
    id: inteiro(x['id']),
    bem: inteiro(x['bem_patrimonial_id']),
    nome: texto(x['nome_arquivo']) ?? '',
    descricao: texto(x['descricao']) ?? '',
    chave: texto(x['chave_armazenamento']) ?? '',
    sha256: texto(x['sha256']) ?? '',
    tamanho: inteiro(x['tamanho_bytes']),
    enviadoPor: texto(x['login']) ?? '',
    enviadoEm: instante(x['criado_em']) ?? '',
  };
}

// ── Leituras: SQL ─────────────────────────────────────────────────────────────────────────────────────────────────

const COLUNAS_BEM = `b.id, b.plaqueta, b.descricao, g.codigo AS grupo, b.origem_bem_id, o.descricao AS onome,
  b.nota_entrada_id, b.nota_entrada_item_id, n.numero_documento AS nf, n.serie, n.data_entrada AS ndata,
  f.razao_social AS fnome, ni.insumo_id AS item_cod, i.nome AS inome, b.termo_doacao_numero, b.data_aquisicao,
  b.valor_aquisicao, b.valor_residual, b.vida_util_meses, b.coeficiente_turno_id, k.descricao AS kdesc,
  k.coeficiente AS kperc, b.inicio_depreciacao, b.depreciavel, b.centro_custo_id, c.codigo AS ccod, c.nome AS cnome,
  b.local_detalhe, b.tipo_responsavel_bem_id, t.descricao AS tnome, ur.nome AS rnome, b.marca, b.modelo,
  b.numero_serie, b.situacao, b.data_baixa, b.versao, uc.login AS criado_login, b.criado_em,
  ua.login AS alterado_login, b.alterado_em,
  (SELECT COALESCE(SUM(d.valor_cota), 0) FROM cota_depreciacao d
    WHERE d.bem_patrimonial_id = b.id AND d.base = '${BASE_COTA}' AND d.excluido_em IS NULL) AS ac,
  (SELECT COUNT(*) FROM cota_depreciacao d
    WHERE d.bem_patrimonial_id = b.id AND d.base = '${BASE_COTA}' AND d.excluido_em IS NULL) AS nc,
  (SELECT MAX(d.competencia) FROM cota_depreciacao d
    WHERE d.bem_patrimonial_id = b.id AND d.base = '${BASE_COTA}' AND d.excluido_em IS NULL) AS uc,
  (SELECT m.id FROM movimento_bem m WHERE m.bem_patrimonial_id = b.id AND m.situacao = 'pendente'
    ORDER BY m.id LIMIT 1) AS mpid,
  (SELECT m.tipo_movimento FROM movimento_bem m WHERE m.bem_patrimonial_id = b.id AND m.situacao = 'pendente'
    ORDER BY m.id LIMIT 1) AS mptipo`;

const DE_BEM = `bem_patrimonial b
  JOIN grupo_bem g ON g.id = b.grupo_bem_id
  LEFT JOIN origem_bem o ON o.id = b.origem_bem_id
  LEFT JOIN nota_entrada n ON n.id = b.nota_entrada_id
  LEFT JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
  LEFT JOIN nota_entrada_item ni ON ni.id = b.nota_entrada_item_id
  LEFT JOIN insumo i ON i.id = ni.insumo_id
  LEFT JOIN coeficiente_turno k ON k.id = b.coeficiente_turno_id
  LEFT JOIN centro_custo c ON c.id = b.centro_custo_id
  LEFT JOIN tipo_responsavel_bem t ON t.id = b.tipo_responsavel_bem_id
  LEFT JOIN usuario ur ON ur.id = b.responsavel_usuario_id
  LEFT JOIN usuario uc ON uc.id = b.criado_por
  LEFT JOIN usuario ua ON ua.id = b.alterado_por`;

function bemDaLinha(x: Record<string, unknown>): BemRegistrado {
  const temNota = x['nota_entrada_id'] != null;
  const coef = inteiroOuNulo(x['coeficiente_turno_id']);
  const tipo = inteiroOuNulo(x['tipo_responsavel_bem_id']);
  const mp = inteiroOuNulo(x['mpid']);
  const criadoEm = instante(x['criado_em']) ?? '';
  const uc = dataIso(x['uc']);
  return {
    id: inteiro(x['id']),
    plaqueta: texto(x['plaqueta']) ?? '',
    descricao: texto(x['descricao']) ?? '',
    grupo: texto(x['grupo']) ?? 'outros',
    origem: { id: inteiro(x['origem_bem_id']), nome: texto(x['onome']) ?? '' },
    documento: temNota ? 'nota' : 'termo',
    nota: temNota
      ? {
          id: inteiro(x['nota_entrada_id']),
          idItem: inteiro(x['nota_entrada_item_id']),
          numero: texto(x['nf']),
          serie: texto(x['serie']),
          data: dataIso(x['ndata']),
          fornecedor: texto(x['fnome']),
          item: inteiroOuNulo(x['item_cod']),
          itemNome: texto(x['inome']),
        }
      : null,
    termo: temNota
      ? null
      : { numero: texto(x['termo_doacao_numero']) ?? '', data: dataIso(x['data_aquisicao']) ?? '', doador: '' },
    empresa: EMPRESA_UNICA,
    dataAquisicao: dataIso(x['data_aquisicao']) ?? '',
    valorCent: centavos(x['valor_aquisicao']),
    residualCent: centavos(x['valor_residual']),
    vidaUtilMeses: inteiro(x['vida_util_meses']) || 1,
    coeficiente:
      coef === null ? null : { id: coef, descricao: texto(x['kdesc']) ?? '', percentual: Number(x['kperc'] ?? 1) || 1 },
    inicioDepreciacao: (dataIso(x['inicio_depreciacao']) ?? '').slice(0, 7),
    depreciavel: booleano(x['depreciavel']),
    centro: { id: inteiro(x['centro_custo_id']), codigo: codigoNumerico(x['ccod']), nome: texto(x['cnome']) ?? '' },
    localDetalhe: texto(x['local_detalhe']),
    tipoResponsavel: tipo === null ? null : { id: tipo, nome: texto(x['tnome']) ?? '' },
    responsavel: texto(x['rnome']),
    marca: texto(x['marca']),
    modelo: texto(x['modelo']),
    numeroSerie: texto(x['numero_serie']),
    situacao: SITUACOES_BEM[String(x['situacao'])] ?? 'ativo',
    baixadoEm: dataIso(x['data_baixa']),
    acumuladaCent: centavos(x['ac']),
    cotas: inteiro(x['nc']),
    ultimaCompetencia: uc ? uc.slice(0, 7) : null,
    movimentoPendente: mp === null ? null : { id: mp, tipo: texto(x['mptipo']) ?? 'transferencia' },
    versao: inteiro(x['versao']),
    criadoPor: texto(x['criado_login']) ?? '',
    criadoEm,
    alteradoPor: texto(x['alterado_login']) ?? texto(x['criado_login']) ?? '',
    alteradoEm: instante(x['alterado_em']) ?? criadoEm,
  };
}

const COLUNAS_MOV = `m.id, m.bem_patrimonial_id, b.plaqueta, b.descricao, m.tipo_movimento, m.situacao, m.data_movimento,
  m.origem_centro_custo_id, co.codigo AS cocod, co.nome AS conome, m.destino_centro_custo_id, cd.codigo AS cdcod,
  cd.nome AS cdnome, m.destino_responsavel, m.terceiro, m.retorno_previsto, m.numero_termo, m.motivo, m.valor_venda,
  us.login AS solicitado_login, m.ocorrido_em, ud.login AS decidido_login, m.decidido_em, m.motivo_decisao, m.versao`;
const DE_MOV = `movimento_bem m
  JOIN bem_patrimonial b ON b.id = m.bem_patrimonial_id
  LEFT JOIN centro_custo co ON co.id = m.origem_centro_custo_id
  LEFT JOIN centro_custo cd ON cd.id = m.destino_centro_custo_id
  LEFT JOIN usuario us ON us.id = m.usuario_id
  LEFT JOIN usuario ud ON ud.id = m.decidido_por_usuario_id`;

function movDaLinha(x: Record<string, unknown>): MovimentoRegistrado {
  const destino = inteiroOuNulo(x['destino_centro_custo_id']);
  return {
    id: inteiro(x['id']),
    bem: { id: inteiro(x['bem_patrimonial_id']), plaqueta: texto(x['plaqueta']) ?? '', descricao: texto(x['descricao']) ?? '' },
    tipo: texto(x['tipo_movimento']) ?? '',
    situacao: texto(x['situacao']) ?? '',
    data: dataIso(x['data_movimento']) ?? '',
    origem: {
      id: inteiro(x['origem_centro_custo_id']),
      codigo: codigoNumerico(x['cocod']),
      nome: texto(x['conome']) ?? '',
    },
    destino:
      destino === null ? null : { id: destino, codigo: codigoNumerico(x['cdcod']), nome: texto(x['cdnome']) ?? '' },
    destinoResponsavel: texto(x['destino_responsavel']),
    terceiro: texto(x['terceiro']),
    retornoPrevisto: dataIso(x['retorno_previsto']),
    termoNumero: texto(x['numero_termo']),
    motivo: texto(x['motivo']) ?? '',
    valorVendaCent: x['valor_venda'] == null ? null : centavos(x['valor_venda']),
    referencia: null,
    solicitadoPor: texto(x['solicitado_login']) ?? '',
    solicitadoEm: instante(x['ocorrido_em']) ?? '',
    decididoPor: texto(x['decidido_login']),
    decididoEm: instante(x['decidido_em']),
    decisaoMotivo: texto(x['motivo_decisao']),
    versao: inteiro(x['versao']),
  };
}

const COLUNAS_INV = `v.id, v.descricao, v.centro_custo_id, c.codigo AS ccod, c.nome AS cnome, v.situacao,
  ua.login AS aberto_login, v.criado_em, v.encerrado_em, ue.login AS alterado_login, v.cancelado_em,
  uk.login AS cancelado_login, v.motivo_cancelamento`;
const DE_INV = `inventario_bem v
  LEFT JOIN centro_custo c ON c.id = v.centro_custo_id
  LEFT JOIN usuario ua ON ua.id = v.criado_por
  LEFT JOIN usuario ue ON ue.id = v.alterado_por
  LEFT JOIN usuario uk ON uk.id = v.cancelamento_usuario_id`;

function invDaLinha(x: Record<string, unknown>): InventarioRegistrado {
  const centro = inteiroOuNulo(x['centro_custo_id']);
  const situacao = x['situacao'] === 'encerrado' ? 'encerrado' : x['situacao'] === 'cancelado' ? 'cancelado' : 'aberto';
  return {
    id: inteiro(x['id']),
    descricao: texto(x['descricao']) ?? '',
    centro: centro === null ? null : { id: centro, codigo: codigoNumerico(x['ccod']), nome: texto(x['cnome']) ?? '' },
    situacao,
    // O número de esperados e o resumo do encerramento ainda não têm coluna (pedido): o serviço recalcula ao vivo.
    esperados: null,
    resumo: null,
    abertoPor: texto(x['aberto_login']) ?? '',
    abertoEm: instante(x['criado_em']) ?? '',
    encerradoPor: situacao === 'encerrado' ? texto(x['alterado_login']) : null,
    encerradoEm: instante(x['encerrado_em']),
    canceladoPor: texto(x['cancelado_login']),
    canceladoEm: instante(x['cancelado_em']),
    motivoCancelamento: texto(x['motivo_cancelamento']),
  };
}

const COLUNAS_NOTA = `n.id, YEAR(n.data_entrada) AS ano, MONTH(n.data_entrada) AS mes, n.numero, n.numero_documento,
  n.serie, n.data_entrada, f.razao_social, n.valor_total,
  (SELECT COUNT(*) FROM nota_entrada_item i WHERE i.nota_entrada_id = n.id AND i.excluido_em IS NULL) AS ni`;

function notaDaLinha(x: Record<string, unknown>): NotaDeEntrada {
  return {
    id: inteiro(x['id']),
    ano: inteiro(x['ano']),
    mes: inteiro(x['mes']),
    doc: inteiro(x['numero']),
    numero: texto(x['numero_documento']),
    serie: texto(x['serie']),
    data: dataIso(x['data_entrada']),
    fornecedor: texto(x['razao_social']),
    empresa: EMPRESA_UNICA,
    totalCent: centavos(x['valor_total']),
    itens: inteiro(x['ni']),
  };
}

const COLUNAS_ITEM = `i.id, i.nota_entrada_id, i.sequencia, i.insumo_id, s.nome, i.quantidade_estoque, i.valor_total,
  (SELECT COUNT(*) FROM bem_patrimonial b WHERE b.nota_entrada_item_id = i.id AND b.excluido_em IS NULL) AS ja`;

function itemDaLinha(x: Record<string, unknown>): ItemDaNota {
  return {
    id: inteiro(x['id']),
    nota: inteiro(x['nota_entrada_id']),
    seq: inteiroOuNulo(x['sequencia']),
    item: inteiro(x['insumo_id']),
    nome: texto(x['nome']) ?? '',
    quantidade: Math.trunc(Number(x['quantidade_estoque'] ?? 0)),
    valorTotalCent: centavos(x['valor_total']),
    jaCadastrados: inteiro(x['ja']),
  };
}

// ── Entradas das operações (Zod) ──────────────────────────────────────────────────────────────────────────────────

const dadosZ = z.unknown();
const bemNovoZ = z.object({
  plaqueta: z.string().regex(/^[A-Z0-9-]{1,20}$/).nullable(),
  descricao: z.string().trim().min(1).max(150),
  grupo: z.string().min(1).max(30),
  origem: z.number().int().positive(),
  documento: z.enum(['nota', 'termo']),
  nota: z.number().int().positive().nullable(),
  itemNota: z.number().int().positive().nullable(),
  termoNumero: z.string().max(40).nullable(),
  dataAquisicao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valorCent: z.number().int().min(0),
  residualCent: z.number().int().min(0),
  vidaUtilMeses: z.number().int().min(1).max(1200),
  coeficiente: z.number().int().positive().nullable(),
  inicioDepreciacao: z.string().regex(/^\d{4}-\d{2}$/),
  depreciavel: z.boolean(),
  centro: z.number().int().positive(),
  localDetalhe: z.string().max(80).nullable(),
  tipoResponsavel: z.number().int().positive().nullable(),
  marca: z.string().max(50).nullable(),
  modelo: z.string().max(50).nullable(),
  numeroSerie: z.string().max(50).nullable(),
});
const cadastrarZ = z.object({
  bens: z.array(bemNovoZ).min(1).max(500),
  item: z.object({ id: z.number().int().positive(), unidades: z.number().int().min(1), jaCadastrados: z.number().int().min(0) }).nullable(),
  dados: dadosZ,
});
const alterarZ = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().min(0),
  descricao: z.string().trim().min(1).max(150),
  grupo: z.string().min(1).max(30),
  localDetalhe: z.string().max(80).nullable(),
  tipoResponsavel: z.number().int().positive().nullable(),
  marca: z.string().max(50).nullable(),
  modelo: z.string().max(50).nullable(),
  numeroSerie: z.string().max(50).nullable(),
  vidaUtilMeses: z.number().int().min(1).max(1200),
  residualCent: z.number().int().min(0),
  coeficiente: z.number().int().positive().nullable(),
  inicioDepreciacao: z.string().regex(/^\d{4}-\d{2}$/),
  depreciavel: z.boolean(),
  dados: dadosZ,
});
const movimentoZ = z.object({
  bem: z.number().int().positive(),
  versaoBem: z.number().int().min(0),
  tipo: z.enum(['transferencia', 'emprestimo', 'comodato', 'devolucao', 'baixa']),
  situacao: z.enum(['pendente', 'concluido']),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origem: z.number().int().positive(),
  destino: z.number().int().positive().nullable(),
  destinoResponsavel: z.string().max(80).nullable(),
  terceiro: z.string().max(120).nullable(),
  retornoPrevisto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  termoNumero: z.string().max(40).nullable(),
  motivo: z.string().max(400),
  motivoBaixa: z.number().int().positive().nullable().default(null),
  valorVendaCent: z.number().int().min(0).nullable(),
  efeito: z.object({ situacao: z.enum(['ativo', 'emprestado', 'baixado']), baixadoEm: z.string().nullable() }).nullable(),
  dados: dadosZ,
});
const decidirZ = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().min(0),
  aceitar: z.boolean(),
  motivo: z.string().max(400).nullable(),
  dados: dadosZ,
});
const cancelarMovZ = z.object({ id: z.number().int().positive(), versao: z.number().int().min(0), motivo: z.string().max(400), dados: dadosZ });
const abrirInvZ = z.object({ descricao: z.string().trim().min(1).max(150), centro: z.number().int().positive().nullable(), dados: dadosZ });
const leituraZ = z.object({
  inventario: z.number().int().positive(),
  codigo: z.string().trim().min(1).max(30),
  bem: z.number().int().positive().nullable(),
  resultado: z.enum(['conforme', 'outro-local', 'nao-cadastrado', 'baixado', 'emprestado', 'repetida']),
  observacao: z.string().max(300).nullable(),
  dados: dadosZ,
});
const encerrarInvZ = z.object({ id: z.number().int().positive(), dados: dadosZ });
const cancelarInvZ = z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(1).max(500), dados: dadosZ });
const grupoZ = z.object({
  codigo: z.string().trim().min(1).max(30),
  nome: z.string().trim().min(1).max(150),
  vidaUtilMeses: z.number().int().min(1).max(1200),
  conta: z.string().max(40).nullable(),
  dados: dadosZ,
});
const grupoVersaoZ = grupoZ.extend({ versaoVista: z.number().int().min(0), motivo: z.string().trim().min(1).max(500) });
const situacaoGrupoZ = z.object({
  codigo: z.string().min(1).max(30),
  versaoVista: z.number().int().min(0),
  motivo: z.string().trim().min(1).max(500),
  ativo: z.boolean(),
  dados: dadosZ,
});
const excluirGrupoZ = z.object({ codigo: z.string().min(1).max(30), versaoVista: z.number().int().min(0), motivo: z.string().trim().min(1).max(500), dados: dadosZ });

// ── Apoio das gravações ───────────────────────────────────────────────────────────────────────────────────────────

const TABELAS_GRUPO = ['grupo_bem'] as const;

/** A semente dos grupos (IN RFB) entra no cadastro do cliente na primeira gravação de grupo ou de bem. */
async function garantirSementeGrupos(tx: TxOperacao): Promise<void> {
  const um = await tx.uma('SELECT id FROM grupo_bem LIMIT 1');
  if (um) return;
  for (const [codigo, g] of Object.entries(GRUPOS_BEM))
    try {
      await tx.incluir('grupo_bem', {
        codigo,
        descricao: g.rotulo,
        depreciavel: true,
        vida_util_societaria_meses: g.vidaUtilMeses,
        taxa_depreciacao_societaria: Math.min(100, 1200 / g.vidaUtilMeses).toFixed(4),
        ativo: true,
      });
    } catch (e) {
      // Outra transação semeou ao mesmo tempo: o grupo já existe e vale.
      if (!restricaoUnicaViolada(e)) throw e;
    }
}

async function idDoGrupo(tx: TxOperacao | Leitor, codigo: string, ativo: boolean): Promise<number> {
  const g = await tx.uma<{ id: unknown; ativo: unknown }>(
    'SELECT id, ativo FROM grupo_bem WHERE codigo = ?',
    [codigo],
  );
  if (!g || (ativo && !booleano(g.ativo))) throw recusa('grupo-inexistente', `O grupo ${codigo} não existe ou está inativo.`);
  return inteiro(g.id);
}

async function idDaConta(tx: TxOperacao, conta: string | null): Promise<number | null> {
  if (conta === null) return null;
  const c = await tx.uma<{ id: unknown }>(
    "SELECT id FROM conta_contabil WHERE classificacao = ? AND tipo = 'analitica' AND ativo = TRUE AND excluido_em IS NULL",
    [conta],
  );
  if (!c) throw recusa('conta-inexistente', `A conta ${conta} não é analítica e ativa no plano de contas.`);
  return inteiro(c.id);
}

/** O centro de custo do estabelecimento, com o setor (a transferência grava o setor de origem e de destino). */
async function centroDoEstabelecimento(tx: TxOperacao, id: number): Promise<{ setor: number | null }> {
  const c = await tx.uma<{ setor_funcional_id: unknown }>(
    'SELECT setor_funcional_id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, tx.contexto.estabelecimento],
  );
  if (!c) throw recusa('centro-inexistente', 'O centro de custo não é deste estabelecimento.');
  return { setor: inteiroOuNulo(c.setor_funcional_id) };
}

async function travarBem(tx: TxOperacao, id: number, versao: number): Promise<Record<string, unknown>> {
  const b = await travarEConferir(tx, {
    tabela: 'bem_patrimonial',
    id,
    colunas: ['estabelecimento_id', 'situacao', 'centro_custo_id', 'excluido_em'],
  });
  if (Number(b['estabelecimento_id']) !== tx.contexto.estabelecimento || b['excluido_em'] != null)
    throw naoEncontrado('Bem');
  if (inteiro(b['versao']) !== versao) throw desatualizado();
  return b;
}

const situacaoNoBanco = (s: SituacaoBem, tipo: string): string =>
  s === 'emprestado' && tipo === 'comodato' ? 'comodato' : s;

// ── Operações ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O formato da plaqueta gerada, lido do gerador do domínio: o prefixo comum (`PC` em `PC000001` e `PC999999`) e a
 * largura do número. Serve para achar a maior plaqueta já cadastrada no formato.
 */
function formatoDaPlaqueta(gerar: (n: number) => string): { prefixo: string; largura: number } {
  const um = gerar(1);
  let outro: string;
  try {
    outro = gerar(999_999);
  } catch {
    outro = um.replace(/\d+$/u, '');
  }
  let i = 0;
  while (i < um.length && i < outro.length && um[i] === outro[i]) i++;
  return { prefixo: um.slice(0, i), largura: um.length - i };
}

/** Tentativas de pular plaqueta já usada (digitada à mão à frente da sequência) antes de recusar. */
const TENTATIVAS_PLAQUETA = 200;

const opCadastrar = (gerarPlaqueta: (n: number) => string) => definirOperacao({
  nome: 'patrimonio.bem.cadastrar',
  tabelas: ['bem_patrimonial', 'grupo_bem', 'sequencia_negocio'],
  entrada: cadastrarZ,
  async gravar(tx, x, ctx) {
    await garantirSementeGrupos(tx);
    if (x.item) {
      const it = await tx.consultarParaAtualizar<{ id: unknown; nota_entrada_id: unknown }>(
        `SELECT i.id, i.nota_entrada_id FROM nota_entrada_item i JOIN nota_entrada n ON n.id = i.nota_entrada_id
          WHERE i.id = ? AND n.estabelecimento_id = ? AND i.excluido_em IS NULL AND n.excluido_em IS NULL`,
        [x.item.id, ctx.estabelecimento],
      );
      if (!it.length) throw recusa('item-nota', 'O item não existe mais na nota fiscal de entrada.');
      const ja = await tx.uma<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM bem_patrimonial WHERE nota_entrada_item_id = ? AND excluido_em IS NULL',
        [x.item.id],
      );
      if (inteiro(ja?.n) !== x.item.jaCadastrados) throw desatualizado('O item da nota');
      if (inteiro(ja?.n) + x.bens.length > x.item.unidades)
        throw recusa('item-quantidade', 'O item da nota não tem mais unidades sem bem cadastrado.');
    }
    if (x.bens.some((b) => b.plaqueta === null)) {
      // A sequência nasce depois da maior plaqueta já cadastrada no formato do domínio (cliente migrado sem colisão).
      const f = formatoDaPlaqueta(gerarPlaqueta);
      const maior = await tx.uma<{ m: unknown }>(
        `SELECT MAX(CAST(SUBSTRING(plaqueta, ?) AS UNSIGNED)) AS m FROM bem_patrimonial
          WHERE estabelecimento_id = ? AND LEFT(plaqueta, ?) = ? AND CHAR_LENGTH(plaqueta) >= ?
            AND SUBSTRING(plaqueta, ?) REGEXP '^[0-9]+$'`,
        [f.prefixo.length + 1, ctx.estabelecimento, f.prefixo.length, f.prefixo, f.prefixo.length + f.largura, f.prefixo.length + 1],
      );
      await garantirSequencia(
        tx,
        { tipo: 'plaqueta_bem', estabelecimento: ctx.estabelecimento, prefixo: f.prefixo.slice(0, 10), inicio: inteiro(maior?.m) + 1 },
        { usuario: ctx.usuario, agora: new Date() },
      );
    }
    /** O próximo número da sequência no formato do domínio; a plaqueta já usada (até a excluída) é pulada. */
    const proximaPlaqueta = async (): Promise<string> => {
      for (let i = 0; i < TENTATIVAS_PLAQUETA; i++) {
        const p = gerarPlaqueta((await tx.proximoNumero('plaqueta_bem')).valor);
        const usada = await tx.uma('SELECT id FROM bem_patrimonial WHERE estabelecimento_id = ? AND plaqueta = ?', [ctx.estabelecimento, p]);
        if (!usada) return p;
      }
      throw recusa('plaqueta-repetida', 'As próximas plaquetas da sequência já estão em uso: informe a plaqueta.');
    };
    const ids: number[] = [];
    for (const b of x.bens) {
      const plaqueta = b.plaqueta ?? (await proximaPlaqueta());
      await centroDoEstabelecimento(tx, b.centro);
      try {
        ids.push(
          await tx.incluir('bem_patrimonial', {
            estabelecimento_id: ctx.estabelecimento,
            plaqueta,
            descricao: b.descricao,
            grupo_bem_id: await idDoGrupo(tx, b.grupo, true),
            origem_bem_id: b.origem,
            centro_custo_id: b.centro,
            local_detalhe: b.localDetalhe,
            tipo_responsavel_bem_id: b.tipoResponsavel,
            marca: b.marca,
            modelo: b.modelo,
            numero_serie: b.numeroSerie,
            nota_entrada_id: b.documento === 'nota' ? b.nota : null,
            nota_entrada_item_id: b.documento === 'nota' ? b.itemNota : null,
            termo_doacao_numero: b.documento === 'termo' ? b.termoNumero : null,
            data_aquisicao: b.dataAquisicao,
            valor_aquisicao: decimal(b.valorCent),
            valor_residual: decimal(b.residualCent),
            depreciavel: b.depreciavel,
            vida_util_meses: b.vidaUtilMeses,
            coeficiente_turno_id: b.coeficiente,
            inicio_depreciacao: primeiroDia(b.inicioDepreciacao),
            situacao: 'ativo',
          }),
        );
      } catch (e) {
        if (restricaoUnicaViolada(e) === 'uq_bem_patrimonial_estabelecimento_plaqueta')
          throw recusa('plaqueta-repetida', `A plaqueta ${plaqueta} já é de outro bem.`);
        throw e;
      }
    }
    return { ids: ids.join(',') };
  },
  alvo: (_x, r) => ({ tabela: 'bem_patrimonial', id: Number(r.ids.split(',')[0]) || null }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const opAlterar = definirOperacao({
  nome: 'patrimonio.bem.alterar',
  tabelas: ['bem_patrimonial', 'grupo_bem'],
  entrada: alterarZ,
  travar: (x) => ({
    tabela: 'bem_patrimonial',
    id: x.id,
    versaoEsperada: x.versao,
    colunas: ['estabelecimento_id', 'descricao', 'grupo_bem_id', 'vida_util_meses', 'valor_residual', 'excluido_em'],
  }),
  async conferir(tx, _x, ctx, relido) {
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento || relido['excluido_em'] != null)
      throw naoEncontrado('Bem');
    void tx;
  },
  async gravar(tx, x) {
    const versao = await tx.alterar('bem_patrimonial', x.id, x.versao, {
      descricao: x.descricao,
      grupo_bem_id: await idDoGrupo(tx, x.grupo, false),
      local_detalhe: x.localDetalhe,
      tipo_responsavel_bem_id: x.tipoResponsavel,
      marca: x.marca,
      modelo: x.modelo,
      numero_serie: x.numeroSerie,
      vida_util_meses: x.vidaUtilMeses,
      valor_residual: decimal(x.residualCent),
      coeficiente_turno_id: x.coeficiente,
      inicio_depreciacao: primeiroDia(x.inicioDepreciacao),
      depreciavel: x.depreciavel,
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'bem_patrimonial', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados }),
});

const opMovimento = definirOperacao({
  nome: 'patrimonio.movimento.registrar',
  tabelas: ['movimento_bem', 'bem_patrimonial'],
  entrada: movimentoZ,
  async gravar(tx, x, ctx) {
    const b = await travarBem(tx, x.bem, x.versaoBem);
    const origem = await centroDoEstabelecimento(tx, x.origem);
    const destino = x.destino === null ? null : await centroDoEstabelecimento(tx, x.destino);
    // A baixa leva o motivo do cadastro (ativo); os outros movimentos não têm motivo de baixa.
    if (x.tipo === 'baixa') {
      if (x.motivoBaixa === null) throw recusa('motivo-baixa', 'Escolha o motivo da baixa no cadastro de motivos.');
      const m = await tx.uma('SELECT id FROM motivo_baixa_bem WHERE id = ? AND ativo = TRUE', [x.motivoBaixa]);
      if (!m) throw recusa('motivo-baixa', 'O motivo de baixa não existe ou está inativo.');
    } else if (x.motivoBaixa !== null) throw recusa('motivo-baixa', 'Só a baixa leva motivo de baixa.');
    if (x.tipo === 'transferencia' && destino?.setor == null)
      throw recusa(
        'destino-sem-setor',
        'O centro de custo de destino não tem setor no cadastro: indique o setor do centro antes de transferir.',
      );
    const agora = new Date();
    const id = await tx.incluir('movimento_bem', {
      estabelecimento_id: ctx.estabelecimento,
      bem_patrimonial_id: x.bem,
      operacao: 'inclusao',
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      tipo_movimento: x.tipo,
      situacao: x.situacao,
      data_movimento: x.data,
      motivo: x.motivo.slice(0, 400),
      origem_setor_funcional_id: origem.setor,
      destino_setor_funcional_id: destino?.setor ?? null,
      origem_centro_custo_id: x.origem,
      destino_centro_custo_id: x.destino,
      destino_responsavel: x.destinoResponsavel,
      terceiro: x.terceiro,
      retorno_previsto: x.retornoPrevisto,
      numero_termo: x.termoNumero,
      motivo_baixa_bem_id: x.motivoBaixa,
      valor_venda: x.valorVendaCent === null ? null : decimal(x.valorVendaCent),
      decidido_em: x.situacao === 'pendente' ? null : agora,
      decidido_por_usuario_id: x.situacao === 'pendente' ? null : ctx.usuario,
    });
    // O registro sobe a versão do bem (dois pedidos ao mesmo tempo não passam) e aplica o efeito imediato.
    const efeito = x.efeito
      ? { situacao: situacaoNoBanco(x.efeito.situacao, x.tipo), data_baixa: x.efeito.baixadoEm }
      : { situacao: b['situacao'] };
    await tx.alterar('bem_patrimonial', x.bem, x.versaoBem, efeito);
    return { id };
  },
  alvo: (_x, r) => ({ tabela: 'movimento_bem', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const opDecidir = definirOperacao({
  nome: 'patrimonio.movimento.decidir',
  tabelas: ['movimento_bem', 'bem_patrimonial'],
  entrada: decidirZ,
  travar: (x) => ({
    tabela: 'movimento_bem',
    id: x.id,
    versaoEsperada: x.versao,
    colunas: ['estabelecimento_id', 'situacao', 'bem_patrimonial_id', 'origem_centro_custo_id', 'destino_centro_custo_id'],
  }),
  async conferir(_tx, _x, ctx, relido) {
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento) throw naoEncontrado('Pedido');
    if (relido['situacao'] !== 'pendente') throw desatualizado('O pedido');
  },
  async gravar(tx, x, ctx) {
    const m = await tx.uma<Record<string, unknown>>(
      'SELECT bem_patrimonial_id, origem_centro_custo_id, destino_centro_custo_id FROM movimento_bem WHERE id = ?',
      [x.id],
    );
    const bemId = inteiro(m?.['bem_patrimonial_id']);
    const b = await travarEConferir(tx, { tabela: 'bem_patrimonial', id: bemId, colunas: ['situacao', 'centro_custo_id'] });
    if (x.aceitar && (b['situacao'] !== 'ativo' || inteiro(b['centro_custo_id']) !== inteiro(m?.['origem_centro_custo_id'])))
      throw recusa('bem-mudou', 'O bem não está mais em uso no setor de origem.');
    const versao = await tx.alterar('movimento_bem', x.id, x.versao, {
      situacao: x.aceitar ? 'aceito' : 'recusado',
      decidido_em: new Date(),
      decidido_por_usuario_id: ctx.usuario,
      motivo_decisao: x.motivo,
    });
    await tx.alterar(
      'bem_patrimonial',
      bemId,
      inteiro(b['versao']),
      x.aceitar && m?.['destino_centro_custo_id'] != null
        ? { centro_custo_id: inteiro(m['destino_centro_custo_id']) }
        : { situacao: b['situacao'] },
    );
    return { versao };
  },
  alvo: (x) => ({ tabela: 'movimento_bem', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', motivo: x.motivo, dados: x.dados }),
});

const opCancelarMov = definirOperacao({
  nome: 'patrimonio.movimento.cancelar',
  tabelas: ['movimento_bem', 'bem_patrimonial'],
  entrada: cancelarMovZ,
  travar: (x) => ({
    tabela: 'movimento_bem',
    id: x.id,
    versaoEsperada: x.versao,
    colunas: ['estabelecimento_id', 'situacao', 'bem_patrimonial_id'],
  }),
  async conferir(_tx, _x, ctx, relido) {
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento) throw naoEncontrado('Pedido');
    if (relido['situacao'] !== 'pendente') throw desatualizado('O pedido');
  },
  async gravar(tx, x, ctx) {
    const versao = await tx.alterar('movimento_bem', x.id, x.versao, {
      situacao: 'cancelado',
      decidido_em: new Date(),
      decidido_por_usuario_id: ctx.usuario,
      motivo_decisao: x.motivo.slice(0, 400),
    });
    const m = await tx.uma<{ b: unknown }>('SELECT bem_patrimonial_id AS b FROM movimento_bem WHERE id = ?', [x.id]);
    const b = await travarEConferir(tx, { tabela: 'bem_patrimonial', id: inteiro(m?.b), colunas: ['situacao'] });
    await tx.alterar('bem_patrimonial', inteiro(m?.b), inteiro(b['versao']), { situacao: b['situacao'] });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'movimento_bem', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', motivo: x.motivo, dados: x.dados }),
});

const anexarLaudoZ = z.object({
  bem: z.number().int().positive(),
  nome: z.string().trim().min(1).max(150),
  descricao: z.string().trim().max(300),
  chave: z.string().min(1).max(300),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  tamanho: z.number().int().positive(),
  dados: dadosZ,
});

const opAnexarLaudo = definirOperacao({
  nome: 'patrimonio.laudo.anexar',
  tabelas: ['laudo_bem'],
  entrada: anexarLaudoZ,
  travar: (x) => ({ tabela: 'bem_patrimonial', id: x.bem, colunas: ['estabelecimento_id'] }),
  async conferir(_tx, _x, ctx, relido) {
    if (!relido || Number(relido['estabelecimento_id']) !== ctx.estabelecimento) throw naoEncontrado('Bem');
  },
  async gravar(tx, x) {
    // O mesmo PDF no mesmo bem é o mesmo laudo (UNIQUE bem + SHA-256): devolve o já anexado, sem segunda linha.
    const ja = await tx.uma<{ id: unknown; excluido_em: unknown }>(
      'SELECT id, excluido_em FROM laudo_bem WHERE bem_patrimonial_id = ? AND sha256 = ?',
      [x.bem, x.sha256],
    );
    if (ja && ja.excluido_em !== null)
      throw recusa('laudo-excluido', 'Este PDF já foi anexado ao bem e excluído; anexe outro arquivo.');
    if (ja) return { id: inteiro(ja.id) };
    const id = await tx.incluir('laudo_bem', {
      bem_patrimonial_id: x.bem,
      nome_arquivo: x.nome,
      descricao: x.descricao,
      chave_armazenamento: x.chave,
      sha256: x.sha256,
      tamanho_bytes: x.tamanho,
    });
    return { id };
  },
  alvo: (_x, r) => ({ tabela: 'laudo_bem', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const opAbrirInv = definirOperacao({
  nome: 'patrimonio.inventario.abrir',
  tabelas: ['inventario_bem', 'sequencia_negocio'],
  entrada: abrirInvZ,
  async gravar(tx, x, ctx) {
    if (ctx.usuario === null) throw recusa('sem-responsavel', 'O inventário pede o usuário responsável.');
    if (x.centro !== null) await centroDoEstabelecimento(tx, x.centro);
    await garantirSequencia(tx, { tipo: 'inventario_bem', estabelecimento: ctx.estabelecimento }, {
      usuario: ctx.usuario,
      agora: new Date(),
    });
    const numero = await tx.proximoNumero('inventario_bem');
    const hoje = new Date().toISOString().slice(0, 10);
    const id = await tx.incluir('inventario_bem', {
      estabelecimento_id: ctx.estabelecimento,
      numero: numero.valor,
      descricao: x.descricao,
      centro_custo_id: x.centro,
      responsavel_usuario_id: ctx.usuario,
      data_abertura: hoje,
      data_inicio: hoje,
      situacao: 'aberto',
    });
    return { id };
  },
  alvo: (_x, r) => ({ tabela: 'inventario_bem', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

async function travarInventarioAberto(tx: TxOperacao, id: number): Promise<Record<string, unknown>> {
  const [v] = await tx.consultarParaAtualizar<Record<string, unknown>>(
    'SELECT id, versao, situacao, estabelecimento_id FROM inventario_bem WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!v || Number(v['estabelecimento_id']) !== tx.contexto.estabelecimento) throw naoEncontrado('Inventário');
  if (v['situacao'] === 'cancelado') throw recusa('inventario-cancelado', 'O inventário foi cancelado.');
  if (v['situacao'] !== 'aberto') throw recusa('inventario-encerrado', 'O inventário já foi encerrado.');
  return v;
}

const opLeitura = definirOperacao({
  nome: 'patrimonio.inventario.ler',
  tabelas: ['inventario_bem_item'],
  entrada: leituraZ,
  async gravar(tx, x, ctx) {
    await travarInventarioAberto(tx, x.inventario);
    if (ctx.usuario === null) throw recusa('sem-leitor', 'A leitura pede o usuário que leu.');
    const s = await tx.uma<{ m: unknown }>(
      'SELECT COALESCE(MAX(sequencia), 0) AS m FROM inventario_bem_item WHERE inventario_bem_id = ?',
      [x.inventario],
    );
    const b =
      x.bem === null
        ? null
        : await tx.uma<{ situacao: unknown }>(
            'SELECT situacao FROM bem_patrimonial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [x.bem, ctx.estabelecimento],
          );
    const id = await tx.incluir('inventario_bem_item', {
      inventario_bem_id: x.inventario,
      sequencia: inteiro(s?.m) + 1,
      plaqueta: x.codigo,
      bem_patrimonial_id: b ? x.bem : null,
      resultado: RESULTADO_PARA_BANCO[x.resultado],
      situacao_anterior: b ? texto(b.situacao) : null,
      justificativa: x.observacao,
      lido_em: new Date(),
      leitor_usuario_id: ctx.usuario,
    });
    return { id };
  },
  alvo: (_x, r) => ({ tabela: 'inventario_bem_item', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

const opEncerrarInv = definirOperacao({
  nome: 'patrimonio.inventario.encerrar',
  tabelas: ['inventario_bem'],
  entrada: encerrarInvZ,
  async gravar(tx, x) {
    const v = await travarInventarioAberto(tx, x.id);
    const agora = new Date();
    const versao = await tx.alterar('inventario_bem', x.id, inteiro(v['versao']), {
      situacao: 'encerrado',
      encerrado_em: agora,
      data_fim: agora.toISOString().slice(0, 10),
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'inventario_bem', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados }),
});

const opCancelarInv = definirOperacao({
  nome: 'patrimonio.inventario.cancelar',
  tabelas: ['inventario_bem'],
  entrada: cancelarInvZ,
  async gravar(tx, x, ctx) {
    const v = await travarInventarioAberto(tx, x.id);
    const versao = await tx.alterar('inventario_bem', x.id, inteiro(v['versao']), {
      situacao: 'cancelado',
      cancelado_em: new Date(),
      cancelamento_usuario_id: ctx.usuario,
      motivo_cancelamento: x.motivo.slice(0, 500),
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'inventario_bem', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', motivo: x.motivo, dados: x.dados }),
});

const opIncluirGrupo = definirOperacao({
  nome: 'patrimonio.grupo.incluir',
  tabelas: TABELAS_GRUPO,
  entrada: grupoZ,
  async gravar(tx, x) {
    await garantirSementeGrupos(tx);
    try {
      const id = await tx.incluir('grupo_bem', {
        codigo: x.codigo,
        descricao: x.nome,
        depreciavel: true,
        vida_util_societaria_meses: x.vidaUtilMeses,
        taxa_depreciacao_societaria: Math.min(100, 1200 / x.vidaUtilMeses).toFixed(4),
        bem_conta_contabil_id: await idDaConta(tx, x.conta),
        ativo: true,
      });
      return { id };
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw recusa('codigo-em-uso', `Já existe um grupo com o código ${x.codigo}.`);
      throw e;
    }
  },
  alvo: (_x, r) => ({ tabela: 'grupo_bem', id: r.id }),
  trilha: (x) => ({ acao: 'inclusao', dados: x.dados }),
});

/** O grupo gravado pelo código, travado e na versão vista (a semente, versão 0, é gravada antes). */
async function travarGrupo(tx: TxOperacao, codigo: string, versaoVista: number): Promise<Record<string, unknown>> {
  await garantirSementeGrupos(tx);
  const g = await tx.uma<{ id: unknown }>('SELECT id FROM grupo_bem WHERE codigo = ?', [codigo]);
  if (!g) throw new ErroOperacao(404, 'nao-encontrado', 'Grupo não encontrado', 'Grupo do bem não encontrado.');
  const relido = await travarEConferir(tx, {
    tabela: 'grupo_bem',
    id: inteiro(g.id),
    colunas: ['descricao', 'vida_util_societaria_meses', 'bem_conta_contabil_id', 'ativo'],
  });
  // A semente gravada nesta transação vale como a versão 0 que a tela viu.
  const versao = inteiro(relido['versao']);
  if (versao !== versaoVista && !(versaoVista === 0 && versao === 1)) throw desatualizado('O grupo do bem');
  return relido;
}

const opAlterarGrupo = definirOperacao({
  nome: 'patrimonio.grupo.alterar',
  tabelas: TABELAS_GRUPO,
  entrada: grupoVersaoZ,
  async gravar(tx, x) {
    const g = await travarGrupo(tx, x.codigo, x.versaoVista);
    const versao = await tx.alterar('grupo_bem', inteiro(g['id']), inteiro(g['versao']), {
      descricao: x.nome,
      vida_util_societaria_meses: x.vidaUtilMeses,
      taxa_depreciacao_societaria: Math.min(100, 1200 / x.vidaUtilMeses).toFixed(4),
      bem_conta_contabil_id: await idDaConta(tx, x.conta),
    });
    return { id: inteiro(g['id']), versao, ...retratoGrupo(g) };
  },
  alvo: (_x, r) => ({ tabela: 'grupo_bem', id: r.id }),
  trilha: (x, r) => ({ acao: 'alteracao', motivo: x.motivo, dados: { ...asObjeto(x.dados), operacao: 'alteracao', antes: antesDoResultado(r) } }),
});

const opSituacaoGrupo = definirOperacao({
  nome: 'patrimonio.grupo.situacao',
  tabelas: TABELAS_GRUPO,
  entrada: situacaoGrupoZ,
  async gravar(tx, x) {
    const g = await travarGrupo(tx, x.codigo, x.versaoVista);
    if (booleano(g['ativo']) === x.ativo)
      throw recusa(x.ativo ? 'ja-ativo' : 'ja-inativo', x.ativo ? 'O grupo do bem já está ativo.' : 'O grupo do bem já está inativo.');
    if (!x.ativo) {
      const n = await tx.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM grupo_bem WHERE ativo = TRUE');
      if (inteiro(n?.n) <= 1)
        throw recusa('ultimo-grupo', 'É o último grupo ativo: inclua ou reative outro grupo antes de inativar este.');
    }
    const versao = await tx.alterar('grupo_bem', inteiro(g['id']), inteiro(g['versao']), { ativo: x.ativo });
    return { id: inteiro(g['id']), versao, ...retratoGrupo(g) };
  },
  alvo: (_x, r) => ({ tabela: 'grupo_bem', id: r.id }),
  trilha: (x, r) => ({
    acao: 'alteracao',
    motivo: x.motivo,
    dados: { ...asObjeto(x.dados), operacao: x.ativo ? 'reativacao' : 'inativacao', antes: antesDoResultado(r) },
  }),
});

const opExcluirGrupo = definirOperacao({
  nome: 'patrimonio.grupo.excluir',
  tabelas: TABELAS_GRUPO,
  entrada: excluirGrupoZ,
  async gravar(tx, x) {
    const g = await travarGrupo(tx, x.codigo, x.versaoVista);
    const id = inteiro(g['id']);
    const bens = await tx.consultar<{ plaqueta: unknown }>(
      'SELECT plaqueta FROM bem_patrimonial WHERE grupo_bem_id = ? AND excluido_em IS NULL ORDER BY plaqueta LIMIT 5',
      [id],
    );
    const nb = await tx.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM bem_patrimonial WHERE grupo_bem_id = ? AND excluido_em IS NULL', [id]);
    if (inteiro(nb?.n) > 0) {
      const total = inteiro(nb?.n);
      throw recusa(
        'com-dependentes',
        `O grupo do bem tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${total} em Bens patrimoniais. Inative o grupo em vez de excluir.`,
        {
          dependentes: [{ rotulo: 'Bens patrimoniais', quantidade: total, amostra: bens.map((b) => String(b.plaqueta)), origem: 'logica' }],
          podeInativar: true,
        },
      );
    }
    const n = await tx.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM grupo_bem');
    if (inteiro(n?.n) <= 1) throw recusa('ultimo-grupo', 'É o último grupo: inclua outro antes de excluir este.');
    await tx.excluir('grupo_bem', id, inteiro(g['versao']));
    return { id, ...retratoGrupo(g) };
  },
  alvo: (_x, r) => ({ tabela: 'grupo_bem', id: r.id }),
  trilha: (x, r) => ({ acao: 'exclusao', motivo: x.motivo, dados: { ...asObjeto(x.dados), antes: antesDoResultado(r) } }),
});

const asObjeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** O retrato do grupo antes da gravação (vai no resultado e na trilha: as versões anteriores saem dela). */
function retratoGrupo(g: Record<string, unknown>): {
  antesVersao: number;
  antesNome: string;
  antesVidaUtilMeses: number;
  antesConta: number | null;
  antesAtivo: boolean;
} {
  return {
    antesVersao: inteiro(g['versao']),
    antesNome: texto(g['descricao']) ?? '',
    antesVidaUtilMeses: inteiro(g['vida_util_societaria_meses']),
    antesConta: inteiroOuNulo(g['bem_conta_contabil_id']),
    antesAtivo: booleano(g['ativo']),
  };
}

const antesDoResultado = (r: ResultadoOperacao): Record<string, unknown> => ({
  versao: r['antesVersao'],
  nome: r['antesNome'],
  vidaUtilMeses: r['antesVidaUtilMeses'],
  conta: r['antesConta'],
  ativo: r['antesAtivo'],
});

// ── A porta ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaPatrimonioPropria implements PortaPatrimonio {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPatrimonio,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPatrimonio, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'patrimonio' }, async (l) =>
      fn(l, await this.estabelecimento(c, l)),
    );
  }

  /** O estabelecimento da sessão (pelo id, ou pelo código quando o mapa ainda não o tinha); sem ele, recusa. */
  private async estabelecimento(c: ContextoPatrimonio, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const x = await l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!x)
      throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento desconhecido', 'O estabelecimento da sessão não existe.');
    return Number(x.id);
  }

  private async gravar<E, S extends ResultadoOperacao>(
    c: ContextoPatrimonio,
    op: Operacao<E, S>,
    entrada: E,
    trilha: RegistroTrilhaTela,
  ): Promise<S> {
    const est = await this.ler(c, async (_l, e) => e);
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: trilha.correlacao ?? c.correlacao,
      chaveIdempotencia: c.chaveIdempotencia ?? `patrimonio-${op.nome}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    return (await this.executor.executar(op, this.cliente, entrada, contexto)).resultado;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  dominios(c: ContextoPatrimonio): Promise<DominiosPatrimonio> {
    return this.ler(c, async (l, est) => {
      const t = { teto: TETO_DOMINIO };
      // Origem, tipo de responsável e coeficiente são cadastros do cliente (rede inteira).
      const origens = await l.consultar('SELECT id, descricao, deprecia FROM origem_bem WHERE ativo = TRUE ORDER BY descricao', [], t);
      const tipos = await l.consultar('SELECT id, descricao FROM tipo_responsavel_bem WHERE ativo = TRUE ORDER BY descricao', [], t);
      const coef = await l.consultar(
        'SELECT id, descricao, coeficiente FROM coeficiente_turno WHERE ativo = TRUE ORDER BY turnos',
        [],
        t,
      );
      // O motivo de baixa também é cadastro do cliente (rede inteira; a tabela não tem estabelecimento).
      const motivos = await l.consultar(
        'SELECT id, descricao, tipo_baixa, exige_laudo FROM motivo_baixa_bem WHERE ativo = TRUE ORDER BY descricao',
        [],
        t,
      );
      const centros = await l.consultar(
        'SELECT id, codigo, nome, ativo FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo',
        [est],
        t,
      );
      const e = await l.uma<{ nome_fantasia: unknown }>('SELECT nome_fantasia FROM estabelecimento WHERE id = ?', [est]);
      return {
        origens: origens.map((x) => ({ id: inteiro(x['id']), nome: texto(x['descricao']) ?? '', depreciar: booleano(x['deprecia']) })),
        tiposResponsavel: tipos.map((x) => ({ id: inteiro(x['id']), nome: texto(x['descricao']) ?? '' })),
        coeficientes: coef.map((x) => ({
          id: inteiro(x['id']),
          descricao: texto(x['descricao']) ?? '',
          percentual: Number(x['coeficiente'] ?? 1),
        })),
        motivosBaixa: motivos.map((x) => ({
          id: inteiro(x['id']),
          descricao: texto(x['descricao']) ?? '',
          tipo: texto(x['tipo_baixa']) ?? 'outro',
          exigeLaudo: booleano(x['exige_laudo']),
        })),
        centros: centros.map((x) => ({
          id: inteiro(x['id']),
          codigo: codigoNumerico(x['codigo']),
          nome: texto(x['nome']) ?? '',
          ativo: booleano(x['ativo']),
        })),
        empresas: [{ id: EMPRESA_UNICA, nome: texto(e?.nome_fantasia) ?? '' }],
        // Os parâmetros da depreciação ainda não têm lugar no modelo (pedido): os padrões da regra.
        parametros: [{ empresa: EMPRESA_UNICA, depreciar: true, aplicarCoeficiente: true, considerarResidual: true }],
      };
    });
  }

  bens(c: ContextoPatrimonio, f: FiltroBens): Promise<{ bens: BemRegistrado[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const w = ['b.estabelecimento_id = ?', 'b.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.centro !== undefined) {
        w.push('b.centro_custo_id = ?');
        p.push(f.centro);
      }
      if (f.situacao !== undefined) {
        w.push(f.situacao === 'emprestado' ? "b.situacao IN ('emprestado', 'comodato')" : 'b.situacao = ?');
        if (f.situacao !== 'emprestado') p.push(f.situacao);
      }
      if (f.grupo !== undefined) {
        w.push('g.codigo = ?');
        p.push(f.grupo);
      }
      const busca = f.busca?.trim();
      if (busca) {
        w.push("(b.plaqueta LIKE CONCAT(?, '%') OR b.descricao LIKE CONCAT('%', ?, '%') OR b.numero_serie = ?)");
        p.push(busca.toUpperCase(), busca, busca);
      }
      const tamanho = Math.max(1, Math.min(500, Math.trunc(f.tamanho)));
      const pular = Math.max(0, (Math.trunc(f.pagina) - 1) * tamanho);
      const ls = await l.consultar(
        `SELECT ${COLUNAS_BEM} FROM ${DE_BEM} WHERE ${w.join(' AND ')} ORDER BY b.plaqueta LIMIT ${tamanho} OFFSET ${pular}`,
        p,
        { teto: tamanho },
      );
      const t = await l.uma<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM bem_patrimonial b JOIN grupo_bem g ON g.id = b.grupo_bem_id WHERE ${w.join(' AND ')}`,
        p,
      );
      return { bens: ls.map(bemDaLinha), total: inteiro(t?.n) };
    });
  }

  bem(c: ContextoPatrimonio, id: number): Promise<BemRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(`SELECT ${COLUNAS_BEM} FROM ${DE_BEM} WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`, [id, est]);
      return x ? bemDaLinha(x) : null;
    });
  }

  bemPorPlaqueta(c: ContextoPatrimonio, plaqueta: string): Promise<BemRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT ${COLUNAS_BEM} FROM ${DE_BEM} WHERE b.plaqueta = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [plaqueta, est],
      );
      return x ? bemDaLinha(x) : null;
    });
  }

  notas(c: ContextoPatrimonio, ano: number, mes: number, busca?: string): Promise<{ notas: NotaDeEntrada[]; truncado: boolean }> {
    return this.ler(c, async (l, est) => {
      const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
      const b = busca?.trim() ?? '';
      const ls = await l.consultar(
        `SELECT ${COLUNAS_NOTA} FROM nota_entrada n JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
          WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND n.cancelada_em IS NULL
            AND n.data_entrada >= ? AND n.data_entrada < DATE_ADD(?, INTERVAL 1 MONTH)
            AND (? = '' OR n.numero_documento = ? OR f.razao_social LIKE CONCAT('%', ?, '%'))
          ORDER BY n.data_entrada, n.id LIMIT ${TETO_NOTAS_MES + 1}`,
        [est, inicio, inicio, b, b, b],
        { teto: TETO_NOTAS_MES + 1 },
      );
      return { notas: ls.slice(0, TETO_NOTAS_MES).map(notaDaLinha), truncado: ls.length > TETO_NOTAS_MES };
    });
  }

  nota(c: ContextoPatrimonio, id: number): Promise<NotaDeEntrada | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT ${COLUNAS_NOTA} FROM nota_entrada n JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
          WHERE n.id = ? AND n.estabelecimento_id = ? AND n.excluido_em IS NULL`,
        [id, est],
      );
      return x ? notaDaLinha(x) : null;
    });
  }

  itensDaNota(c: ContextoPatrimonio, nota: NotaDeEntrada): Promise<ItemDaNota[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT ${COLUNAS_ITEM} FROM nota_entrada_item i JOIN nota_entrada n ON n.id = i.nota_entrada_id
           JOIN insumo s ON s.id = i.insumo_id
          WHERE i.nota_entrada_id = ? AND n.estabelecimento_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [nota.id, est],
        { teto: TETO_ITENS_NOTA },
      );
      return ls.map(itemDaLinha);
    });
  }

  itemNota(c: ContextoPatrimonio, id: number): Promise<ItemDaNota | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT ${COLUNAS_ITEM} FROM nota_entrada_item i JOIN nota_entrada n ON n.id = i.nota_entrada_id
           JOIN insumo s ON s.id = i.insumo_id
          WHERE i.id = ? AND n.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [id, est],
      );
      return x ? itemDaLinha(x) : null;
    });
  }

  bensParaDepreciar(c: ContextoPatrimonio, _empresa: number, competencia: string): Promise<{ bens: BemDaCompetencia[]; truncado: boolean }> {
    return this.ler(c, async (l, est) => {
      const dia = primeiroDia(competencia);
      const ls = await l.consultar(
        `SELECT b.id, b.plaqueta, b.descricao, g.codigo AS grupo, b.centro_custo_id, b.valor_aquisicao, b.valor_residual,
                b.vida_util_meses, k.coeficiente, b.inicio_depreciacao, b.depreciavel, b.situacao, b.data_baixa,
                (SELECT COALESCE(SUM(d.valor_cota), 0) FROM cota_depreciacao d WHERE d.bem_patrimonial_id = b.id
                   AND d.base = '${BASE_COTA}' AND d.excluido_em IS NULL AND d.competencia < ?) AS ac,
                EXISTS (SELECT 1 FROM cota_depreciacao d WHERE d.bem_patrimonial_id = b.id AND d.base = '${BASE_COTA}'
                   AND d.excluido_em IS NULL AND d.competencia = ?) AS tem
           FROM bem_patrimonial b JOIN grupo_bem g ON g.id = b.grupo_bem_id
           LEFT JOIN coeficiente_turno k ON k.id = b.coeficiente_turno_id
          WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND (b.situacao <> 'baixado' OR b.data_baixa >= ?)
          ORDER BY b.plaqueta LIMIT ${TETO_BENS_LEITURA + 1}`,
        [dia, dia, est, dia],
        { teto: TETO_BENS_LEITURA + 1 },
      );
      return {
        bens: ls.slice(0, TETO_BENS_LEITURA).map((x) => ({
          id: inteiro(x['id']),
          plaqueta: texto(x['plaqueta']) ?? '',
          descricao: texto(x['descricao']) ?? '',
          grupo: texto(x['grupo']) ?? '',
          centro: inteiro(x['centro_custo_id']),
          valorCent: centavos(x['valor_aquisicao']),
          residualCent: centavos(x['valor_residual']),
          vidaUtilMeses: inteiro(x['vida_util_meses']) || 1,
          coeficiente: x['coeficiente'] == null ? null : Number(x['coeficiente']),
          inicioDepreciacao: (dataIso(x['inicio_depreciacao']) ?? '').slice(0, 7),
          depreciavel: booleano(x['depreciavel']),
          situacao: SITUACOES_BEM[String(x['situacao'])] ?? 'ativo',
          baixadoEm: dataIso(x['data_baixa']),
          acumuladaCent: centavos(x['ac']),
          temCotaNaCompetencia: booleano(x['tem']),
          // O marco do ajuste de valor depende do modelo do ajuste (pedido).
          marco: null,
        })),
        truncado: ls.length > TETO_BENS_LEITURA,
      };
    });
  }

  // O cálculo da depreciação, o estorno e o ajuste pedem modelo (pedido ao orquestrador): sem registro.
  async calculos(): Promise<{ daCompetencia: CalculoRegistrado | null; ultimo: CalculoRegistrado | null }> {
    return { daCompetencia: null, ultimo: null };
  }

  async cotas(): Promise<CotaRegistrada[]> {
    return [];
  }

  async estornos(): Promise<EstornoDeCalculo[]> {
    return [];
  }

  async ajustes(): Promise<AjusteDoBem[]> {
    return [];
  }

  laudos(c: ContextoPatrimonio, bem: number): Promise<LaudoDoBem[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar(`${SQL_LAUDO} AND b.id = ? ORDER BY d.id DESC`, [est, bem])).map(laudoDe),
    );
  }

  laudo(c: ContextoPatrimonio, id: number): Promise<LaudoDoBem | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(`${SQL_LAUDO} AND d.id = ?`, [est, id]);
      return x ? laudoDe(x) : null;
    });
  }

  movimentos(c: ContextoPatrimonio, f: { situacao?: string | undefined; bem?: number | undefined }): Promise<MovimentoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT ${COLUNAS_MOV} FROM ${DE_MOV}
          WHERE m.estabelecimento_id = ? AND (? IS NULL OR m.situacao = ?) AND (? IS NULL OR m.bem_patrimonial_id = ?)
          ORDER BY m.id DESC LIMIT ${TETO_MOVIMENTOS}`,
        [est, f.situacao ?? null, f.situacao ?? null, f.bem ?? null, f.bem ?? null],
        { teto: TETO_MOVIMENTOS },
      );
      return ls.map(movDaLinha);
    });
  }

  movimento(c: ContextoPatrimonio, id: number): Promise<MovimentoRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(`SELECT ${COLUNAS_MOV} FROM ${DE_MOV} WHERE m.id = ? AND m.estabelecimento_id = ?`, [id, est]);
      return x ? movDaLinha(x) : null;
    });
  }

  ultimaSaida(c: ContextoPatrimonio, bem: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<{ id: unknown }>(
        `SELECT id FROM movimento_bem WHERE estabelecimento_id = ? AND bem_patrimonial_id = ?
            AND tipo_movimento IN ('emprestimo', 'comodato') ORDER BY id DESC LIMIT 1`,
        [est, bem],
      );
      return x ? inteiro(x.id) : null;
    });
  }

  inventarios(c: ContextoPatrimonio): Promise<InventarioRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT ${COLUNAS_INV} FROM ${DE_INV} WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL
          ORDER BY v.id DESC LIMIT ${TETO_INVENTARIOS}`,
        [est],
        { teto: TETO_INVENTARIOS },
      );
      return ls.map(invDaLinha);
    });
  }

  inventario(c: ContextoPatrimonio, id: number): Promise<InventarioRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(`SELECT ${COLUNAS_INV} FROM ${DE_INV} WHERE v.id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL`, [
        id,
        est,
      ]);
      return x ? invDaLinha(x) : null;
    });
  }

  leituras(c: ContextoPatrimonio, inventario: number): Promise<{ leituras: LeituraRegistrada[]; truncado: boolean }> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT i.id, i.plaqueta AS codigo, i.bem_patrimonial_id, b.plaqueta, b.descricao, b.centro_custo_id,
                i.resultado, i.justificativa, u.login, i.lido_em
           FROM inventario_bem_item i JOIN inventario_bem v ON v.id = i.inventario_bem_id
           LEFT JOIN bem_patrimonial b ON b.id = i.bem_patrimonial_id
           LEFT JOIN usuario u ON u.id = i.leitor_usuario_id
          WHERE i.inventario_bem_id = ? AND v.estabelecimento_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia LIMIT ${TETO_BENS_LEITURA + 1}`,
        [inventario, est],
        { teto: TETO_BENS_LEITURA + 1 },
      );
      return {
        leituras: ls.slice(0, TETO_BENS_LEITURA).map((x) => {
          const bem = inteiroOuNulo(x['bem_patrimonial_id']);
          return {
            id: inteiro(x['id']),
            codigo: texto(x['codigo']) ?? '',
            bem:
              bem === null
                ? null
                : { id: bem, plaqueta: texto(x['plaqueta']) ?? '', descricao: texto(x['descricao']) ?? '', centro: inteiro(x['centro_custo_id']) },
            // O centro onde a leitura foi feita ainda não tem coluna (pedido): vale o centro do bem lido.
            centroLido: inteiro(x['centro_custo_id']),
            resultado: RESULTADO_DO_BANCO[String(x['resultado'])] ?? String(x['resultado']),
            observacao: texto(x['justificativa']),
            lidoPor: texto(x['login']) ?? '',
            lidoEm: instante(x['lido_em']) ?? '',
          };
        }),
        truncado: ls.length > TETO_BENS_LEITURA,
      };
    });
  }

  esperados(c: ContextoPatrimonio, centro: number | null): Promise<{ bens: BemEsperado[]; truncado: boolean }> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT id, plaqueta, descricao, centro_custo_id FROM bem_patrimonial
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativo' AND (? IS NULL OR centro_custo_id = ?)
          ORDER BY plaqueta LIMIT ${TETO_BENS_LEITURA + 1}`,
        [est, centro, centro],
        { teto: TETO_BENS_LEITURA + 1 },
      );
      return {
        bens: ls.slice(0, TETO_BENS_LEITURA).map((x) => ({
          id: inteiro(x['id']),
          plaqueta: texto(x['plaqueta']) ?? '',
          descricao: texto(x['descricao']) ?? '',
          centro: inteiro(x['centro_custo_id']),
          situacao: 'ativo' as const,
        })),
        truncado: ls.length > TETO_BENS_LEITURA,
      };
    });
  }

  grupos(c: ContextoPatrimonio): Promise<GrupoDoBem[]> {
    return this.ler(c, async (l, est) => {
      // O grupo do bem é cadastro do cliente (rede inteira); a contagem de bens é a do estabelecimento.
      const ls = await l.consultar(
        `SELECT g.id, g.codigo, g.descricao, g.vida_util_societaria_meses, cc.classificacao AS conta, g.ativo, g.versao,
                g.alterado_em,
                (SELECT COUNT(*) FROM bem_patrimonial b WHERE b.grupo_bem_id = g.id AND b.estabelecimento_id = ?
                   AND b.excluido_em IS NULL) AS bens,
                (SELECT t.motivo FROM trilha_auditoria t WHERE t.entidade = 'grupo_bem' AND t.entidade_id = g.id
                   ORDER BY t.id DESC LIMIT 1) AS motivo
           FROM grupo_bem g LEFT JOIN conta_contabil cc ON cc.id = g.bem_conta_contabil_id`,
        [est],
        { teto: TETO_DOMINIO },
      );
      if (ls.length === 0)
        // Nada gravado: vale a semente (IN RFB), na versão 0.
        return Object.entries(GRUPOS_BEM)
          .map(([codigo, g]) => ({
            id: null,
            codigo: codigo as GrupoDoBem['codigo'],
            nome: g.rotulo,
            vidaUtilMeses: g.vidaUtilMeses,
            conta: null,
            ativo: true,
            semente: true,
            inativadoEm: null,
            motivoInativacao: null,
            versao: 0,
            bens: 0,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo));
      return ls
        .map((x): GrupoDoBem => {
          const ativo = booleano(x['ativo']);
          const codigo = texto(x['codigo']) ?? '';
          return {
            id: inteiro(x['id']),
            codigo: codigo as GrupoDoBem['codigo'],
            nome: texto(x['descricao']) ?? '',
            vidaUtilMeses: inteiro(x['vida_util_societaria_meses']) || 1,
            conta: texto(x['conta']),
            ativo,
            semente: Object.hasOwn(GRUPOS_BEM, codigo),
            inativadoEm: ativo ? null : instante(x['alterado_em']),
            motivoInativacao: ativo ? null : texto(x['motivo']),
            versao: inteiro(x['versao']),
            bens: inteiro(x['bens']),
          };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo));
    });
  }

  contasDoGrupo(c: ContextoPatrimonio): Promise<{ codigo: string; nome: string }[]> {
    return this.ler(c, async (l) => {
      const ls = await l.consultar(
        `SELECT classificacao, descricao FROM conta_contabil
          WHERE tipo = 'analitica' AND ativo = TRUE AND excluido_em IS NULL ORDER BY classificacao`,
        [],
        { teto: TETO_DOMINIO },
      );
      return ls.map((x) => ({ codigo: texto(x['classificacao']) ?? '', nome: texto(x['descricao']) ?? '' }));
    });
  }

  versoesGrupo(c: ContextoPatrimonio, id: number | null): Promise<VersaoGrupoBem[]> {
    if (id === null) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      // As versões anteriores saem da trilha: o retrato de antes de cada alteração, com o motivo e quem gravou.
      const ls = await l.consultar(
        `SELECT t.dados_depois, t.motivo, u.login, t.ocorrido_em FROM trilha_auditoria t
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.entidade = 'grupo_bem' AND t.entidade_id = ? AND t.acao = 'alteracao' ORDER BY t.id DESC`,
        [id],
        { teto: TETO_DOMINIO },
      );
      const contas = new Map<number, string>();
      const versoes: VersaoGrupoBem[] = [];
      for (const x of ls) {
        const d = asObjeto(typeof x['dados_depois'] === 'string' ? JSON.parse(x['dados_depois']) : x['dados_depois']);
        const dados = asObjeto(d['dados']);
        const antes = asObjeto(dados['antes']);
        const op = dados['operacao'];
        if (op !== 'alteracao' && op !== 'inativacao' && op !== 'reativacao') continue;
        const conta = inteiroOuNulo(antes['conta']);
        if (conta !== null && !contas.has(conta)) {
          const cc = await l.uma<{ classificacao: unknown }>('SELECT classificacao FROM conta_contabil WHERE id = ?', [conta]);
          contas.set(conta, texto(cc?.classificacao) ?? '');
        }
        versoes.push({
          versao: inteiro(antes['versao']),
          operacao: op,
          nome: texto(antes['nome']) ?? '',
          vidaUtilMeses: inteiro(antes['vidaUtilMeses']),
          conta: conta === null ? null : (contas.get(conta) ?? null),
          ativo: antes['ativo'] === true,
          motivo: texto(x['motivo']) ?? '',
          por: texto(x['login']) ?? '',
          em: instante(x['ocorrido_em']) ?? '',
        });
      }
      return versoes;
    });
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  async cadastrar(
    c: ContextoPatrimonio,
    x: CadastroDeBens,
    _por: string,
    gerarPlaqueta: (n: number) => string,
    trilha: RegistroTrilhaTela,
  ): Promise<BemRegistrado[]> {
    if (x.bens.some((b) => b.responsavel !== null)) throw modeloPendente('O nome do responsável pelo bem');
    if (x.bens.some((b) => b.documento === 'termo' && (b.termo?.doador ?? '') !== ''))
      throw modeloPendente('O doador do termo de doação');
    const r = await this.gravar(
      c,
      opCadastrar(gerarPlaqueta),
      {
        bens: x.bens.map((b) => ({
          plaqueta: b.plaqueta,
          descricao: b.descricao,
          grupo: b.grupo,
          origem: b.origem,
          documento: b.documento,
          nota: b.nota,
          itemNota: b.itemNota,
          termoNumero: b.termo?.numero ?? null,
          dataAquisicao: b.dataAquisicao,
          valorCent: b.valorCent,
          residualCent: b.residualCent,
          vidaUtilMeses: b.vidaUtilMeses,
          coeficiente: b.coeficiente,
          inicioDepreciacao: b.inicioDepreciacao,
          depreciavel: b.depreciavel,
          centro: b.centro,
          localDetalhe: b.localDetalhe,
          tipoResponsavel: b.tipoResponsavel,
          marca: b.marca,
          modelo: b.modelo,
          numeroSerie: b.numeroSerie,
        })),
        item: x.item,
        dados: trilha.dadosDepois,
      },
      trilha,
    );
    const bens: BemRegistrado[] = [];
    for (const id of r.ids.split(',').map(Number)) {
      const b = await this.bem(c, id);
      if (b) bens.push(b);
    }
    return bens;
  }

  async alterar(
    c: ContextoPatrimonio,
    x: AlteracaoDoBem,
    _por: string,
    conferir: (antes: BemRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: BemRegistrado; depois: BemRegistrado; mudou: boolean } | null> {
    const antes = await this.bem(c, x.id);
    if (!antes) return null;
    if (antes.versao !== x.versao) throw desatualizado();
    const problema = conferir(antes);
    if (problema) throw recusa('bem-alteracao', problema);
    if (x.responsavel !== antes.responsavel && x.responsavel !== null) throw modeloPendente('O nome do responsável pelo bem');
    const mudou =
      antes.descricao !== x.descricao ||
      antes.grupo !== x.grupo ||
      antes.localDetalhe !== x.localDetalhe ||
      (antes.tipoResponsavel?.id ?? null) !== x.tipoResponsavel ||
      antes.marca !== x.marca ||
      antes.modelo !== x.modelo ||
      antes.numeroSerie !== x.numeroSerie ||
      antes.vidaUtilMeses !== x.vidaUtilMeses ||
      antes.residualCent !== x.residualCent ||
      (antes.coeficiente?.id ?? null) !== x.coeficiente ||
      antes.inicioDepreciacao !== x.inicioDepreciacao ||
      antes.depreciavel !== x.depreciavel;
    if (!mudou) return { antes, depois: antes, mudou: false };
    await this.gravar(
      c,
      opAlterar,
      {
        id: x.id,
        versao: x.versao,
        descricao: x.descricao,
        grupo: x.grupo,
        localDetalhe: x.localDetalhe,
        tipoResponsavel: x.tipoResponsavel,
        marca: x.marca,
        modelo: x.modelo,
        numeroSerie: x.numeroSerie,
        vidaUtilMeses: x.vidaUtilMeses,
        residualCent: x.residualCent,
        coeficiente: x.coeficiente,
        inicioDepreciacao: x.inicioDepreciacao,
        depreciavel: x.depreciavel,
        dados: trilha.dadosDepois,
      },
      trilha,
    );
    const depois = await this.bem(c, x.id);
    return { antes, depois: depois ?? antes, mudou: true };
  }

  async registrarMovimento(
    c: ContextoPatrimonio,
    x: MovimentoNovo,
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ movimento: MovimentoRegistrado; bem: BemRegistrado }> {
    const r = await this.gravar(
      c,
      opMovimento,
      {
        bem: x.bem,
        versaoBem: x.versaoBem,
        tipo: x.tipo,
        situacao: x.situacao,
        data: x.data,
        origem: x.origem,
        destino: x.destino,
        destinoResponsavel: x.destinoResponsavel,
        terceiro: x.terceiro,
        retornoPrevisto: x.retornoPrevisto,
        termoNumero: x.termoNumero,
        motivo: x.motivo,
        motivoBaixa: x.motivoBaixa,
        valorVendaCent: x.valorVendaCent,
        efeito: x.efeito,
        dados: { ...asObjeto(trilha.dadosDepois), ...(x.referencia !== null ? { referencia: x.referencia } : {}) },
      },
      trilha,
    );
    const movimento = await this.movimento(c, r.id);
    const bem = await this.bem(c, x.bem);
    if (!movimento || !bem) throw desatualizado();
    return { movimento, bem };
  }

  async decidir(
    c: ContextoPatrimonio,
    x: { id: number; versao: number; aceitar: boolean; motivo: string | null },
    _por: string,
    conferir: (m: MovimentoRegistrado, bem: BemRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: MovimentoRegistrado; movimento: MovimentoRegistrado; bem: BemRegistrado } | null> {
    const antes = await this.movimento(c, x.id);
    if (!antes) return null;
    const b = await this.bem(c, antes.bem.id);
    if (!b) return null;
    const problema = conferir(antes, b);
    if (problema) throw recusa('movimento-decisao', problema);
    await this.gravar(c, opDecidir, { ...x, dados: trilha.dadosDepois }, trilha);
    const movimento = await this.movimento(c, x.id);
    const bem = await this.bem(c, antes.bem.id);
    if (!movimento || !bem) throw desatualizado('O pedido');
    return { antes, movimento, bem };
  }

  async cancelar(
    c: ContextoPatrimonio,
    x: { id: number; versao: number; motivo: string },
    _por: string,
    conferir: (m: MovimentoRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: MovimentoRegistrado; movimento: MovimentoRegistrado } | null> {
    const antes = await this.movimento(c, x.id);
    if (!antes) return null;
    const problema = conferir(antes);
    if (problema) throw recusa('movimento-cancelamento', problema);
    await this.gravar(c, opCancelarMov, { ...x, dados: trilha.dadosDepois }, trilha);
    const movimento = await this.movimento(c, x.id);
    if (!movimento) throw desatualizado('O pedido');
    return { antes, movimento };
  }

  async calcular(): Promise<never> {
    throw modeloPendente('O cálculo da depreciação (o cabeçalho do cálculo da competência)');
  }

  async estornar(): Promise<never> {
    throw modeloPendente('O estorno do cálculo da depreciação');
  }

  async registrarAjuste(): Promise<never> {
    throw modeloPendente('O ajuste de valor do bem');
  }

  async anexarLaudo(
    c: ContextoPatrimonio,
    x: { bem: number; nome: string; descricao: string; chave: string; sha256: string; tamanho: number },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<LaudoDoBem> {
    const { id } = await this.gravar(c, opAnexarLaudo, { ...x, dados: trilha.dadosDepois }, trilha);
    const laudo = await this.laudo(c, id);
    if (!laudo) throw naoEncontrado('Laudo');
    return laudo;
  }

  async estornarAjuste(): Promise<never> {
    throw modeloPendente('O estorno do ajuste de valor do bem');
  }

  async abrirInventario(
    c: ContextoPatrimonio,
    x: { descricao: string; centro: number | null },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    return (await this.gravar(c, opAbrirInv, { ...x, dados: trilha.dadosDepois }, trilha)).id;
  }

  async registrarLeitura(c: ContextoPatrimonio, x: LeituraNova, _por: string, trilha: RegistroTrilhaTela): Promise<number> {
    const r = await this.gravar(
      c,
      opLeitura,
      {
        inventario: x.inventario,
        codigo: x.codigo,
        bem: x.bem,
        resultado: x.resultado as z.infer<typeof leituraZ>['resultado'],
        observacao: x.observacao,
        dados: { ...asObjeto(trilha.dadosDepois), centroLido: x.centroLido },
      },
      trilha,
    );
    return r.id;
  }

  async encerrarInventario(
    c: ContextoPatrimonio,
    x: { id: number; esperados: number; resumo: string },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<boolean> {
    if (!(await this.inventario(c, x.id))) return false;
    await this.gravar(c, opEncerrarInv, { id: x.id, dados: { ...asObjeto(trilha.dadosDepois), esperados: x.esperados } }, trilha);
    return true;
  }

  async cancelarInventario(
    c: ContextoPatrimonio,
    x: { id: number; motivo: string },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<boolean> {
    if (!(await this.inventario(c, x.id))) return false;
    await this.gravar(c, opCancelarInv, { ...x, dados: trilha.dadosDepois }, trilha);
    return true;
  }

  private async grupoPeloCodigo(c: ContextoPatrimonio, codigo: string): Promise<GrupoDoBem> {
    const g = (await this.grupos(c)).find((x) => x.codigo === codigo);
    if (!g) throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado', 'Grupo do bem não encontrado.');
    return g;
  }

  async incluirGrupo(c: ContextoPatrimonio, x: GrupoBemNovo, _por: string, trilha: RegistroTrilhaTela): Promise<GrupoDoBem> {
    await this.gravar(c, opIncluirGrupo, { ...x, dados: trilha.dadosDepois }, trilha);
    return this.grupoPeloCodigo(c, x.codigo);
  }

  async alterarGrupo(
    c: ContextoPatrimonio,
    x: GrupoBemNovo & { versaoVista: number; motivo: string },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: GrupoDoBem; depois: GrupoDoBem }> {
    const antes = await this.grupoPeloCodigo(c, x.codigo);
    await this.gravar(c, opAlterarGrupo, { ...x, dados: trilha.dadosDepois }, trilha);
    return { antes, depois: await this.grupoPeloCodigo(c, x.codigo) };
  }

  async situacaoGrupo(
    c: ContextoPatrimonio,
    x: { codigo: string; versaoVista: number; motivo: string; ativo: boolean },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: GrupoDoBem; depois: GrupoDoBem }> {
    const antes = await this.grupoPeloCodigo(c, x.codigo);
    await this.gravar(c, opSituacaoGrupo, { ...x, dados: trilha.dadosDepois }, trilha);
    return { antes, depois: await this.grupoPeloCodigo(c, x.codigo) };
  }

  async excluirGrupo(
    c: ContextoPatrimonio,
    x: { codigo: string; versaoVista: number; motivo: string },
    _por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<GrupoDoBem> {
    const antes = await this.grupoPeloCodigo(c, x.codigo);
    await this.gravar(c, opExcluirGrupo, { ...x, dados: trilha.dadosDepois }, trilha);
    return antes;
  }
}
