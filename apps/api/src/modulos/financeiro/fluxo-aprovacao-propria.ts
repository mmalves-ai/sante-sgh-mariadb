// F8, 07-FIN linha 65: fluxo de aprovação configurável no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). As regras são do @sgh/dominio-financeiro (fluxo-aprovacao.ts); aqui ficam a leitura
// sob a trava e a gravação nas tabelas do modelo:
//   fluxo_aprovacao + etapa_fluxo_aprovacao + aprovador_etapa (o fluxo nasce inteiro e não se reescreve: mudar é
//   encerrar o atual e criar outro; os pedidos em andamento seguem no fluxo em que entraram);
//   agrupador_aprovacao + membro_agrupador_aprovacao (migração 14_FIN/95; o membro retirado fica inativo);
//   resposta_padrao_aprovacao (aprova, reprova ou devolve, com ou sem justificativa);
//   pedido_aprovacao (com o fluxo e a etapa atual) + decisao_aprovacao (etapa, resposta e canal web ou celular).
// O motor serve ao título a pagar, ao pedido de compra e ao contrato com o fornecedor. No fim do fluxo, o efeito no
// documento: o título fica autorizado; o pedido de compra fica aprovado ou reprovado (devolvido volta a rascunho); o
// contrato entra em vigor. A alçada simples do título (porta-propria.ts, aprovarTitulo) continua como estava: o motor
// só recebe o título quando um fluxo configurável o atende.
import {
  type AgrupadorConfigurado,
  andamentoDepois,
  type AprovadorConfigurado,
  aprovadoresAptos,
  type AtributosDocumento,
  CRITERIOS_AGRUPADOR,
  conferirDecisao,
  conferirFluxo,
  conferirSubmissao,
  DOCUMENTOS_APROVAVEIS,
  type DocumentoAprovavel,
  type DocumentoEmAprovacao,
  type EfeitoResposta,
  escolherFluxo,
  type EtapaConfigurada,
  etapasExigidas,
  type FluxoConfigurado,
  type RecusaFinanceiro,
  type RegraQuorum,
  type RespostaPadrao,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  controlarOrcamentoDoDocumento,
  TABELAS_CONTROLE_NO_DOCUMENTO,
} from '../orcamento/controle-orcamentario-propria.js';
import { dataIso, numero, texto } from './vocabulario.js';

const id = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dinheiro = z.number().min(0).max(999_999_999);
const CODIGO = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .regex(/^[A-Z0-9_.-]+$/);
type Linha = Record<string, unknown>;

/** Código do tipo de documento (tipo_documento_aprovacao) de cada documento que o motor aprova. */
export const TIPO_FLUXO: Readonly<Record<DocumentoAprovavel, { codigo: string; descricao: string }>> = {
  titulo_pagar: { codigo: 'FLUXO_TITULO_PAGAR', descricao: 'Título a pagar (fluxo configurável)' },
  pedido_compra: { codigo: 'FLUXO_PEDIDO_COMPRA', descricao: 'Pedido de compra (fluxo configurável)' },
  contrato_fornecedor: {
    codigo: 'FLUXO_CONTRATO',
    descricao: 'Contrato com o fornecedor (fluxo configurável)',
  },
};
const CODIGOS_FLUXO = Object.values(TIPO_FLUXO).map((t) => t.codigo);
const DECISAO_DO_EFEITO: Record<EfeitoResposta, string> = {
  aprova: 'aprovado',
  reprova: 'recusado',
  devolve: 'devolvido',
};

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A decisão precisa de um usuário.');
  return ctx.usuario;
}
const hoje = () => new Date().toISOString().slice(0, 10);
const nulo = (v: unknown): number | null => (v === null || v === undefined ? null : numero(v));
const bool = (v: unknown) => Boolean(numero(v));
function json<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined) return padrao;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return padrao;
  }
}

// ── Leitura da configuração (domínio) ───────────────────────────────────────────────────────────────────────────

const tipoDoCodigo = (c: string): DocumentoAprovavel =>
  (Object.entries(TIPO_FLUXO).find(([, t]) => t.codigo === c)?.[0] ?? 'titulo_pagar') as DocumentoAprovavel;

async function fluxosLidos(
  l: Leitor,
  est: number,
): Promise<(FluxoConfigurado & { codigo: string; descricao: string })[]> {
  const r = await l.consultar(
    `SELECT f.id, f.codigo, f.descricao, f.estabelecimento_id, f.centro_custo_id, f.valor_minimo, f.valor_maximo,
            f.prioridade, f.vigencia_inicio, f.vigencia_fim, f.ativo, t.codigo AS tipo
       FROM fluxo_aprovacao f JOIN tipo_documento_aprovacao t ON t.id = f.tipo_documento_aprovacao_id
      WHERE (f.estabelecimento_id = ? OR f.estabelecimento_id IS NULL) AND t.codigo IN (?, ?, ?)
      ORDER BY f.id`,
    [est, ...CODIGOS_FLUXO],
  );
  return r.map((x) => ({
    id: numero(x['id']),
    codigo: texto(x['codigo']),
    descricao: texto(x['descricao']),
    tipo: tipoDoCodigo(texto(x['tipo'])),
    estabelecimento: nulo(x['estabelecimento_id']),
    centroCusto: nulo(x['centro_custo_id']),
    valorMinimo: numero(x['valor_minimo']),
    valorMaximo: nulo(x['valor_maximo']),
    prioridade: numero(x['prioridade']),
    vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(x['vigencia_fim']),
    ativo: bool(x['ativo']),
  }));
}

async function etapasLidas(
  l: Leitor,
  fluxos: readonly number[],
): Promise<(EtapaConfigurada & { fluxo: number })[]> {
  if (!fluxos.length) return [];
  const r = await l.consultar(
    `SELECT id, fluxo_aprovacao_id, sequencia, nome, valor_minimo, valor_maximo, condicao_entrada, regra_quorum,
            quantidade_minima_aprovadores, obrigatoria
       FROM etapa_fluxo_aprovacao WHERE fluxo_aprovacao_id IN (${fluxos.map(() => '?').join(',')})
        AND excluido_em IS NULL ORDER BY fluxo_aprovacao_id, sequencia`,
    [...fluxos],
  );
  return r.map((x) => ({
    id: numero(x['id']),
    fluxo: numero(x['fluxo_aprovacao_id']),
    sequencia: numero(x['sequencia']),
    nome: texto(x['nome']),
    valorMinimo: nulo(x['valor_minimo']),
    valorMaximo: nulo(x['valor_maximo']),
    condicao: json(x['condicao_entrada'], null),
    regraQuorum: texto(x['regra_quorum']) as RegraQuorum,
    minimo: nulo(x['quantidade_minima_aprovadores']),
    obrigatoria: bool(x['obrigatoria']),
  }));
}

async function aprovadoresLidos(l: Leitor, etapas: readonly number[]): Promise<AprovadorConfigurado[]> {
  if (!etapas.length) return [];
  const r = await l.consultar(
    `SELECT id, etapa_fluxo_aprovacao_id, usuario_id, papel_seguranca_id, substituto_usuario_id, agrupador_aprovacao_id,
            valor_limite, aprova_pelo_celular, vigencia_inicio, vigencia_fim, ativo
       FROM aprovador_etapa WHERE etapa_fluxo_aprovacao_id IN (${etapas.map(() => '?').join(',')})
        AND excluido_em IS NULL ORDER BY id`,
    [...etapas],
  );
  return r.map((x) => ({
    id: numero(x['id']),
    etapa: numero(x['etapa_fluxo_aprovacao_id']),
    usuario: nulo(x['usuario_id']),
    papel: nulo(x['papel_seguranca_id']),
    substituto: nulo(x['substituto_usuario_id']),
    agrupador: nulo(x['agrupador_aprovacao_id']),
    valorLimite: nulo(x['valor_limite']),
    aprovaPeloCelular: bool(x['aprova_pelo_celular']),
    vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(x['vigencia_fim']),
    ativo: bool(x['ativo']),
  }));
}

async function agrupadoresLidos(
  l: Leitor,
): Promise<(AgrupadorConfigurado & { codigo: string; descricao: string; fluxo: number | null })[]> {
  const r = await l.consultar(
    `SELECT a.id, a.codigo, a.descricao, a.criterio, a.aceita_vazio, a.ativo, a.fluxo_aprovacao_id,
            (SELECT GROUP_CONCAT(m.valor_id ORDER BY m.valor_id) FROM membro_agrupador_aprovacao m
              WHERE m.agrupador_aprovacao_id = a.id AND m.ativo = TRUE) AS membros
       FROM agrupador_aprovacao a ORDER BY a.ordem, a.id`,
    [],
  );
  return r.map((x) => ({
    id: numero(x['id']),
    codigo: texto(x['codigo']),
    descricao: texto(x['descricao']),
    criterio: texto(x['criterio']) as AgrupadorConfigurado['criterio'],
    aceitaVazio: bool(x['aceita_vazio']),
    ativo: bool(x['ativo']),
    fluxo: nulo(x['fluxo_aprovacao_id']),
    membros: texto(x['membros'])
      .split(',')
      .filter(Boolean)
      .map((v) => Number(v)),
  }));
}

async function respostasLidas(
  l: Leitor,
): Promise<(RespostaPadrao & { codigo: string; descricao: string; ordem: number })[]> {
  const r = await l.consultar(
    `SELECT id, codigo, descricao, efeito, exige_justificativa, fluxo_aprovacao_id, ordem, ativo
       FROM resposta_padrao_aprovacao ORDER BY ordem, id`,
    [],
  );
  return r.map((x) => ({
    id: numero(x['id']),
    codigo: texto(x['codigo']),
    descricao: texto(x['descricao']),
    efeito: texto(x['efeito']) as EfeitoResposta,
    exigeJustificativa: bool(x['exige_justificativa']),
    fluxo: nulo(x['fluxo_aprovacao_id']),
    ordem: numero(x['ordem']),
    ativo: bool(x['ativo']),
  }));
}

async function papeisDoUsuario(l: Leitor, usuario: number): Promise<number[]> {
  const r = await l.consultar(
    `SELECT papel_seguranca_id FROM usuario_papel_seguranca
      WHERE usuario_id = ? AND excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
        AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [usuario],
  );
  return r.map((x) => numero(x['papel_seguranca_id']));
}

// ── Documento ──────────────────────────────────────────────────────────────────────────────────────────────────

interface DocumentoLido {
  readonly doc: DocumentoEmAprovacao;
  readonly versao: number;
  readonly situacao: string;
  readonly numero: string;
  readonly descricao: string;
  readonly centroCusto: number | null;
  readonly fornecedor: number | null;
}

async function documentoTravado(
  tx: TxOperacao,
  est: number,
  tipo: DocumentoAprovavel,
  documento: number,
): Promise<DocumentoLido> {
  let r: Linha | undefined;
  if (tipo === 'titulo_pagar') {
    [r] = await tx.consultarParaAtualizar(
      `SELECT t.id, t.versao, t.situacao, t.valor_bruto AS valor, t.centro_custo_id, t.empresa_fornecedora_id,
              t.natureza_financeira_id, t.criado_por AS solicitante, t.numero_documento AS numero, t.autorizado,
              'Título a pagar' AS descricao
         FROM titulo_pagar t WHERE t.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL`,
      [documento, est],
      { teto: 1 },
    );
  } else if (tipo === 'pedido_compra') {
    [r] = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.situacao, p.valor_total AS valor, p.centro_custo_id, p.empresa_fornecedora_id,
              NULL AS natureza_financeira_id, COALESCE(p.comprador_usuario_id, p.criado_por) AS solicitante,
              CONCAT(p.ano, '/', p.numero) AS numero, 0 AS autorizado, 'Pedido de compra' AS descricao
         FROM pedido_compra p WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [documento, est],
      { teto: 1 },
    );
  } else {
    [r] = await tx.consultarParaAtualizar(
      `SELECT c.id, c.versao, c.situacao, COALESCE(c.valor_global, 0) AS valor, c.centro_custo_id,
              c.empresa_fornecedora_id, NULL AS natureza_financeira_id, c.criado_por AS solicitante,
              c.numero, 0 AS autorizado, LEFT(c.objeto, 200) AS descricao
         FROM contrato_fornecedor c WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
      [documento, est],
      { teto: 1 },
    );
  }
  if (!r) throw recusa('documento-inexistente', 'O documento não existe neste estabelecimento.');
  const situacao = texto(r['situacao']);
  const aberto =
    tipo === 'titulo_pagar'
      ? situacao === 'aberto' && !bool(r['autorizado'])
      : tipo === 'pedido_compra'
        ? ['rascunho', 'em_cotacao', 'aguardando_aprovacao'].includes(situacao)
        : situacao === 'rascunho';
  if (!aberto)
    throw recusa(
      'documento-fora-de-aprovacao',
      tipo === 'titulo_pagar'
        ? 'Só o título em aberto e ainda não autorizado vai para aprovação.'
        : tipo === 'pedido_compra'
          ? 'Só o pedido ainda não decidido vai para aprovação.'
          : 'Só o contrato em rascunho vai para aprovação.',
    );
  const atributos: AtributosDocumento = {
    centro_custo: nulo(r['centro_custo_id']),
    credor: nulo(r['empresa_fornecedora_id']),
    natureza_financeira: nulo(r['natureza_financeira_id']),
  };
  return {
    doc: {
      tipo,
      estabelecimento: est,
      valor: numero(r['valor']),
      atributos,
      solicitante: nulo(r['solicitante']),
    },
    versao: numero(r['versao']),
    situacao,
    numero: texto(r['numero']).slice(0, 60),
    descricao: texto(r['descricao']).slice(0, 500),
    centroCusto: nulo(r['centro_custo_id']),
    fornecedor: nulo(r['empresa_fornecedora_id']),
  };
}

async function tipoDocumento(tx: TxOperacao, tipo: DocumentoAprovavel): Promise<number> {
  const t = TIPO_FLUXO[tipo];
  const r = await tx.uma('SELECT id FROM tipo_documento_aprovacao WHERE codigo = ?', [t.codigo]);
  if (r) return numero(r['id']);
  return tx.incluir('tipo_documento_aprovacao', {
    codigo: t.codigo,
    descricao: t.descricao,
    entidade: tipo,
    tipo_limite: 'valor',
  });
}

/** O efeito no documento quando o pedido se conclui. */
async function aplicarNoDocumento(
  tx: TxOperacao,
  est: number,
  tipo: DocumentoAprovavel,
  documento: number,
  situacao: 'aprovado' | 'reprovado' | 'devolvido',
  pedido: number,
  usuario: number,
  justificativa: string,
  agora: Date,
): Promise<void> {
  const d = await documentoTravado(tx, est, tipo, documento).catch(() => null);
  if (!d) return; // decidido por outro caminho entretanto (ex.: a alçada do título): o pedido fica com a decisão.
  if (tipo === 'titulo_pagar') {
    if (situacao === 'aprovado')
      await tx.alterar('titulo_pagar', documento, d.versao, {
        autorizado: true,
        autorizado_em: agora,
        autorizador_usuario_id: usuario,
        pedido_aprovacao_id: pedido,
      });
  } else if (tipo === 'pedido_compra') {
    await tx.alterar(
      'pedido_compra',
      documento,
      d.versao,
      situacao === 'devolvido'
        ? { situacao: 'rascunho' }
        : {
            situacao,
            aprovado_por_usuario_id: usuario,
            aprovado_em: agora,
            justificativa_aprovacao: justificativa.trim().slice(0, 250) || null,
          },
    );
  } else if (situacao === 'aprovado') {
    await tx.alterar('contrato_fornecedor', documento, d.versao, { situacao: 'vigente' });
  }
  // C2-112 (07-FIN linha 130): o motor aprova o título e o pedido por fora da alçada simples; a aprovação dele também
  // reserva o saldo orçado na mesma transação, e o bloqueio sem exceção aprovada recusa a decisão inteira.
  if (situacao === 'aprovado' && (tipo === 'titulo_pagar' || tipo === 'pedido_compra'))
    await controlarOrcamentoDoDocumento(tx, est, usuario, { tipoDocumento: tipo, documento, ciente: true });
}

// ── Operações ──────────────────────────────────────────────────────────────────────────────────────────────────

const esquemaAprovador = z
  .object({
    usuario: id.nullable(),
    papel: id.nullable(),
    substituto: id.nullable().default(null),
    agrupador: id.nullable().default(null),
    valorLimite: dinheiro.nullable().default(null),
    aprovaPeloCelular: z.boolean().default(false),
    notificaCelular: z.boolean().default(false),
    vigenciaInicio: DATA,
    vigenciaFim: DATA.nullable().default(null),
  })
  .strict();
const esquemaEtapa = z
  .object({
    sequencia: z.number().int().min(1).max(99),
    nome: z.string().trim().min(1).max(100),
    valorMinimo: dinheiro.nullable().default(null),
    valorMaximo: dinheiro.nullable().default(null),
    condicao: z.record(z.enum(CRITERIOS_AGRUPADOR), z.array(id).max(200)).nullable().default(null),
    regraQuorum: z.enum(['qualquer', 'todos', 'minimo']).default('qualquer'),
    minimo: z.number().int().min(1).max(50).nullable().default(null),
    prazoHoras: z.number().int().min(1).max(8760).nullable().default(null),
    obrigatoria: z.boolean().default(true),
    aprovadores: z.array(esquemaAprovador).max(50),
  })
  .strict();
export const esquemaCriarFluxo = z
  .object({
    codigo: CODIGO,
    descricao: z.string().trim().min(3).max(150),
    tipo: z.enum(DOCUMENTOS_APROVAVEIS),
    todosEstabelecimentos: z.boolean().default(false),
    centroCusto: id.nullable().default(null),
    valorMinimo: dinheiro.default(0),
    valorMaximo: dinheiro.nullable().default(null),
    prioridade: z.number().int().min(1).max(999).default(1),
    vigenciaInicio: DATA,
    vigenciaFim: DATA.nullable().default(null),
    etapas: z.array(esquemaEtapa).max(20),
  })
  .strict();
export type CriarFluxoEntrada = z.infer<typeof esquemaCriarFluxo>;

const criarFluxo = definirOperacao<CriarFluxoEntrada, ResultadoOperacao>({
  nome: 'financeiro.fluxo_aprovacao_criar',
  tabelas: ['fluxo_aprovacao', 'etapa_fluxo_aprovacao', 'aprovador_etapa', 'tipo_documento_aprovacao'],
  entrada: esquemaCriarFluxo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    recusar(conferirFluxo(e));
    if (await tx.uma('SELECT id FROM fluxo_aprovacao WHERE codigo = ?', [e.codigo]))
      throw recusa('codigo-repetido', 'Já existe um fluxo com este código.', { campos: ['codigo'] });
    if (
      e.centroCusto !== null &&
      !(await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
        e.centroCusto,
        est,
      ]))
    )
      throw recusa('centro-custo-inexistente', 'O centro de custo não existe neste estabelecimento.', {
        campos: ['centroCusto'],
      });
    const fluxo = await tx.incluir('fluxo_aprovacao', {
      estabelecimento_id: e.todosEstabelecimentos ? null : est,
      codigo: e.codigo,
      descricao: e.descricao,
      tipo_documento_aprovacao_id: await tipoDocumento(tx, e.tipo),
      centro_custo_id: e.centroCusto,
      valor_minimo: e.valorMinimo,
      valor_maximo: e.valorMaximo,
      prioridade: e.prioridade,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: true,
    });
    for (const et of e.etapas) {
      const etapa = await tx.incluir('etapa_fluxo_aprovacao', {
        fluxo_aprovacao_id: fluxo,
        sequencia: et.sequencia,
        nome: et.nome,
        condicao_entrada: et.condicao ? JSON.stringify(et.condicao) : null,
        valor_minimo: et.valorMinimo,
        valor_maximo: et.valorMaximo,
        prazo_horas: et.prazoHoras,
        regra_quorum: et.regraQuorum,
        quantidade_minima_aprovadores: et.regraQuorum === 'minimo' ? et.minimo : null,
        obrigatoria: et.obrigatoria,
      });
      for (const a of et.aprovadores)
        await tx.incluir('aprovador_etapa', {
          etapa_fluxo_aprovacao_id: etapa,
          usuario_id: a.usuario,
          papel_seguranca_id: a.papel,
          substituto_usuario_id: a.substituto,
          agrupador_aprovacao_id: a.agrupador,
          valor_limite: a.valorLimite,
          aprova_pelo_celular: a.aprovaPeloCelular,
          notifica_celular: a.notificaCelular,
          vigencia_inicio: a.vigenciaInicio,
          vigencia_fim: a.vigenciaFim,
          ativo: true,
        });
    }
    return { fluxo, codigo: e.codigo, etapas: e.etapas.length };
  },
  alvo: (_e, r) => ({ tabela: 'fluxo_aprovacao', id: numero(r['fluxo']) || null }),
});

export const esquemaEncerrarFluxo = z.object({ fluxo: id }).strict();
const encerrarFluxo = definirOperacao<z.infer<typeof esquemaEncerrarFluxo>, ResultadoOperacao>({
  nome: 'financeiro.fluxo_aprovacao_encerrar',
  tabelas: ['fluxo_aprovacao', 'tipo_documento_aprovacao'],
  entrada: esquemaEncerrarFluxo as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [f] = await tx.consultarParaAtualizar(
      `SELECT f.id, f.versao, f.ativo, f.vigencia_inicio FROM fluxo_aprovacao f
         JOIN tipo_documento_aprovacao t ON t.id = f.tipo_documento_aprovacao_id AND t.codigo IN (?, ?, ?)
        WHERE f.id = ? AND (f.estabelecimento_id = ? OR f.estabelecimento_id IS NULL)`,
      [...CODIGOS_FLUXO, e.fluxo, est],
      { teto: 1 },
    );
    if (!f) throw recusa('fluxo-inexistente', 'O fluxo não existe.');
    if (!bool(f['ativo'])) throw recusa('fluxo-encerrado', 'O fluxo já está encerrado.');
    const d = hoje();
    const inicio = dataIso(f['vigencia_inicio']) ?? d;
    await tx.alterar('fluxo_aprovacao', e.fluxo, numero(f['versao']), {
      ativo: false,
      vigencia_fim: inicio > d ? inicio : d,
    });
    return { fluxo: e.fluxo, ativo: false };
  },
  alvo: (e) => ({ tabela: 'fluxo_aprovacao', id: e.fluxo }),
});

export const esquemaSalvarAgrupador = z
  .object({
    id: id.nullable().default(null),
    codigo: CODIGO,
    descricao: z.string().trim().min(3).max(150),
    criterio: z.enum(CRITERIOS_AGRUPADOR),
    fluxo: id.nullable().default(null),
    aceitaVazio: z.boolean().default(false),
    ativo: z.boolean().default(true),
    membros: z.array(id).max(500),
  })
  .strict();
const salvarAgrupador = definirOperacao<z.infer<typeof esquemaSalvarAgrupador>, ResultadoOperacao>({
  nome: 'financeiro.agrupador_aprovacao_salvar',
  tabelas: ['agrupador_aprovacao', 'membro_agrupador_aprovacao'],
  entrada: esquemaSalvarAgrupador as never,
  async gravar(tx, e) {
    const membros = [...new Set(e.membros)];
    if (!membros.length && !e.aceitaVazio)
      throw recusa('agrupador-vazio', 'Inclua ao menos um valor no agrupador.', { campos: ['membros'] });
    const mesmo = await tx.uma('SELECT id FROM agrupador_aprovacao WHERE codigo = ?', [e.codigo]);
    if (mesmo && numero(mesmo['id']) !== e.id)
      throw recusa('codigo-repetido', 'Já existe um agrupador com este código.', { campos: ['codigo'] });
    const campos = {
      codigo: e.codigo,
      descricao: e.descricao,
      criterio: e.criterio,
      fluxo_aprovacao_id: e.fluxo,
      aceita_vazio: e.aceitaVazio,
      ativo: e.ativo,
    };
    let ag: number;
    if (e.id !== null) {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM agrupador_aprovacao WHERE id = ?',
        [e.id],
        {
          teto: 1,
        },
      );
      if (!a) throw recusa('agrupador-inexistente', 'O agrupador não existe.');
      await tx.alterar('agrupador_aprovacao', e.id, numero(a['versao']), campos);
      ag = e.id;
    } else ag = await tx.incluir('agrupador_aprovacao', campos);
    const atuais = await tx.consultarParaAtualizar(
      'SELECT id, versao, valor_id, ativo FROM membro_agrupador_aprovacao WHERE agrupador_aprovacao_id = ?',
      [ag],
      { teto: 1000 },
    );
    for (const m of atuais) {
      const quer = membros.includes(numero(m['valor_id']));
      if (quer !== bool(m['ativo']))
        await tx.alterar('membro_agrupador_aprovacao', numero(m['id']), numero(m['versao']), { ativo: quer });
    }
    const ja = new Set(atuais.map((m) => numero(m['valor_id'])));
    for (const v of membros)
      if (!ja.has(v))
        await tx.incluir('membro_agrupador_aprovacao', {
          agrupador_aprovacao_id: ag,
          valor_id: v,
          ativo: true,
        });
    return { agrupador: ag, membros: membros.length };
  },
  alvo: (_e, r) => ({ tabela: 'agrupador_aprovacao', id: numero(r['agrupador']) || null }),
});

export const esquemaSalvarResposta = z
  .object({
    id: id.nullable().default(null),
    codigo: CODIGO,
    descricao: z.string().trim().min(2).max(150),
    efeito: z.enum(['aprova', 'reprova', 'devolve']),
    exigeJustificativa: z.boolean().default(false),
    fluxo: id.nullable().default(null),
    ordem: z.number().int().min(0).max(999).default(0),
    ativo: z.boolean().default(true),
  })
  .strict();
const salvarResposta = definirOperacao<z.infer<typeof esquemaSalvarResposta>, ResultadoOperacao>({
  nome: 'financeiro.resposta_aprovacao_salvar',
  tabelas: ['resposta_padrao_aprovacao'],
  entrada: esquemaSalvarResposta as never,
  async gravar(tx, e) {
    const mesmo = await tx.uma('SELECT id FROM resposta_padrao_aprovacao WHERE codigo = ?', [e.codigo]);
    if (mesmo && numero(mesmo['id']) !== e.id)
      throw recusa('codigo-repetido', 'Já existe uma resposta com este código.', { campos: ['codigo'] });
    const campos = {
      codigo: e.codigo,
      descricao: e.descricao,
      efeito: e.efeito,
      // Reprovar ou devolver sempre pede justificativa (a decisão fica explicada na trilha).
      exige_justificativa: e.exigeJustificativa || e.efeito !== 'aprova',
      fluxo_aprovacao_id: e.fluxo,
      ordem: e.ordem,
      ativo: e.ativo,
    };
    if (e.id === null) return { resposta: await tx.incluir('resposta_padrao_aprovacao', campos) };
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM resposta_padrao_aprovacao WHERE id = ?',
      [e.id],
      {
        teto: 1,
      },
    );
    if (!r) throw recusa('resposta-inexistente', 'A resposta não existe.');
    await tx.alterar('resposta_padrao_aprovacao', e.id, numero(r['versao']), campos);
    return { resposta: e.id };
  },
  alvo: (_e, r) => ({ tabela: 'resposta_padrao_aprovacao', id: numero(r['resposta']) || null }),
});

/** A configuração inteira do fluxo (etapas, aprovadores e agrupadores) para o documento, já no domínio. */
async function configuracaoDoFluxo(l: Leitor, fluxo: number) {
  const etapas = await etapasLidas(l, [fluxo]);
  const aprovadores = await aprovadoresLidos(
    l,
    etapas.map((e) => e.id),
  );
  const agrupadores = await agrupadoresLidos(l);
  return { etapas, aprovadores, agrupadores };
}

export const esquemaSubmeter = z.object({ tipo: z.enum(DOCUMENTOS_APROVAVEIS), documento: id }).strict();
const submeter = definirOperacao<z.infer<typeof esquemaSubmeter>, ResultadoOperacao>({
  nome: 'financeiro.aprovacao_documento_submeter',
  tabelas: [
    'pedido_aprovacao',
    'fluxo_aprovacao',
    'etapa_fluxo_aprovacao',
    'aprovador_etapa',
    'agrupador_aprovacao',
    'membro_agrupador_aprovacao',
    'tipo_documento_aprovacao',
    'titulo_pagar',
    'pedido_compra',
    'contrato_fornecedor',
  ],
  entrada: esquemaSubmeter as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const d = await documentoTravado(tx, est, e.tipo, e.documento);
    const aberto = await tx.uma(
      `SELECT id FROM pedido_aprovacao WHERE estabelecimento_id = ? AND entidade = ? AND entidade_id = ?
          AND excluido_em IS NULL AND situacao IN ('pendente','em_aprovacao') LIMIT 1`,
      [est, e.tipo, e.documento],
    );
    if (aberto) throw recusa('ja-em-aprovacao', 'O documento já está em aprovação.');
    const h = hoje();
    const fluxo = escolherFluxo(await fluxosLidos(tx, est), d.doc, h);
    const cfg = fluxo
      ? await configuracaoDoFluxo(tx, fluxo.id)
      : { etapas: [], aprovadores: [], agrupadores: [] };
    const exigidas = etapasExigidas(cfg.etapas, cfg.aprovadores, cfg.agrupadores, d.doc, h);
    recusar(conferirSubmissao(fluxo, exigidas, cfg.aprovadores, cfg.agrupadores, d.doc, h));
    const primeira = exigidas[0]!;
    const agora = new Date();
    const pedido = await tx.incluir('pedido_aprovacao', {
      estabelecimento_id: est,
      tipo_documento_aprovacao_id: await tipoDocumento(tx, e.tipo),
      fluxo_aprovacao_id: fluxo!.id,
      etapa_fluxo_aprovacao_id: primeira.id,
      nivel_atual: 1,
      entidade: e.tipo,
      entidade_id: e.documento,
      numero_documento: d.numero || null,
      descricao: d.descricao || null,
      valor: d.doc.valor,
      centro_custo_id: d.centroCusto,
      empresa_fornecedora_id: d.fornecedor,
      // O retrato do documento na submissão: as etapas e os aprovadores se decidem sempre sobre ele.
      resumo_documento: JSON.stringify({
        atributos: d.doc.atributos,
        solicitante: d.doc.solicitante,
        etapas: exigidas.map((x) => x.id),
      }),
      solicitante_usuario_id: d.doc.solicitante ?? usuario,
      solicitado_em: agora,
      situacao: 'em_aprovacao',
    });
    if (e.tipo === 'pedido_compra' && d.situacao !== 'aguardando_aprovacao')
      await tx.alterar('pedido_compra', e.documento, d.versao, { situacao: 'aguardando_aprovacao' });
    return { pedido, fluxo: fluxo!.id, etapas: exigidas.length, etapa: primeira.nome };
  },
  alvo: (_e, r) => ({ tabela: 'pedido_aprovacao', id: numero(r['pedido']) || null }),
});

export const esquemaDecidir = z
  .object({
    pedido: id,
    resposta: id,
    justificativa: z.string().max(2000).default(''),
    canal: z.enum(['web', 'celular']).default('web'),
  })
  .strict();
const decidir = definirOperacao<z.infer<typeof esquemaDecidir>, ResultadoOperacao>({
  nome: 'financeiro.aprovacao_documento_decidir',
  tabelas: [
    'pedido_aprovacao',
    'decisao_aprovacao',
    'resposta_padrao_aprovacao',
    'etapa_fluxo_aprovacao',
    'aprovador_etapa',
    'agrupador_aprovacao',
    'membro_agrupador_aprovacao',
    'usuario_papel_seguranca',
    'titulo_pagar',
    'pedido_compra',
    'contrato_fornecedor',
    ...TABELAS_CONTROLE_NO_DOCUMENTO,
  ],
  entrada: esquemaDecidir as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [p] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, fluxo_aprovacao_id, etapa_fluxo_aprovacao_id, entidade, entidade_id, valor,
              resumo_documento, solicitante_usuario_id
         FROM pedido_aprovacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.pedido, est],
      { teto: 1 },
    );
    if (!p || p['fluxo_aprovacao_id'] === null)
      throw recusa('pedido-inexistente', 'O pedido de aprovação não existe neste estabelecimento.');
    const fluxo = numero(p['fluxo_aprovacao_id']);
    const resumo = json<{ atributos?: AtributosDocumento; solicitante?: number | null; etapas?: number[] }>(
      p['resumo_documento'],
      {},
    );
    const tipo = texto(p['entidade']) as DocumentoAprovavel;
    const doc: DocumentoEmAprovacao = {
      tipo,
      estabelecimento: est,
      valor: numero(p['valor']),
      atributos: resumo.atributos ?? {},
      solicitante: resumo.solicitante ?? nulo(p['solicitante_usuario_id']),
    };
    const cfg = await configuracaoDoFluxo(tx, fluxo);
    const exigidas = (resumo.etapas ?? [])
      .map((i) => cfg.etapas.find((x) => x.id === i))
      .filter((x): x is (typeof cfg.etapas)[number] => Boolean(x));
    const atual = exigidas.find((x) => x.id === nulo(p['etapa_fluxo_aprovacao_id']));
    if (!atual) throw recusa('pedido-concluido', 'Este pedido de aprovação já foi concluído.');
    const h = hoje();
    const aptos = aprovadoresAptos(atual.id, cfg.aprovadores, cfg.agrupadores, doc, h);
    const decisoes = (
      await tx.consultar(
        `SELECT d.etapa_fluxo_aprovacao_id, d.aprovador_usuario_id, d.decisao FROM decisao_aprovacao d
          WHERE d.pedido_aprovacao_id = ? ORDER BY d.id`,
        [e.pedido],
      )
    ).map((x) => ({
      etapa: numero(x['etapa_fluxo_aprovacao_id']),
      usuario: numero(x['aprovador_usuario_id']),
      efeito: (texto(x['decisao']) === 'aprovado'
        ? 'aprova'
        : texto(x['decisao']) === 'recusado'
          ? 'reprova'
          : 'devolve') as EfeitoResposta,
    }));
    const resposta = (await respostasLidas(tx)).find((r) => r.id === e.resposta) ?? null;
    recusar(
      conferirDecisao({
        situacao: texto(p['situacao']),
        fluxo,
        etapa: atual,
        aptos,
        decisoes,
        solicitante: doc.solicitante,
        usuario,
        papeis: await papeisDoUsuario(tx, usuario),
        resposta,
        justificativa: e.justificativa,
        canal: e.canal,
      }),
    );
    const agora = new Date();
    const nivel = exigidas.findIndex((x) => x.id === atual.id) + 1;
    const decisao = await tx.incluir('decisao_aprovacao', {
      pedido_aprovacao_id: e.pedido,
      etapa_fluxo_aprovacao_id: atual.id,
      resposta_padrao_aprovacao_id: resposta!.id,
      nivel,
      aprovador_usuario_id: usuario,
      decisao: DECISAO_DO_EFEITO[resposta!.efeito],
      justificativa: e.justificativa.trim() || null,
      valor_aprovado: resposta!.efeito === 'aprova' ? doc.valor : null,
      ocorrido_em: agora,
      endereco_ip: ctx.enderecoIp?.slice(0, 45) ?? null,
      canal: e.canal,
    });
    const aptosPorEtapa = new Map(
      exigidas.map((x) => [x.id, aprovadoresAptos(x.id, cfg.aprovadores, cfg.agrupadores, doc, h).length]),
    );
    const and = andamentoDepois(exigidas, atual.id, aptosPorEtapa, [
      ...decisoes,
      { etapa: atual.id, usuario, efeito: resposta!.efeito },
    ]);
    const concluido = and.situacao !== 'em_aprovacao';
    await tx.alterar('pedido_aprovacao', e.pedido, numero(p['versao']), {
      situacao: and.situacao,
      etapa_fluxo_aprovacao_id: and.etapa,
      nivel_atual: and.nivel,
      concluido_em: concluido ? agora : null,
      motivo_conclusao:
        concluido && and.situacao !== 'aprovado' ? e.justificativa.trim().slice(0, 2000) : null,
    });
    if (concluido)
      await aplicarNoDocumento(
        tx,
        est,
        tipo,
        numero(p['entidade_id']),
        and.situacao as 'aprovado' | 'reprovado' | 'devolvido',
        e.pedido,
        usuario,
        e.justificativa,
        agora,
      );
    return { decisao, pedido: e.pedido, situacao: and.situacao, faltam: and.faltam, nivel: and.nivel };
  },
  alvo: (e) => ({ tabela: 'pedido_aprovacao', id: e.pedido }),
});

export const OPERACOES_FLUXO_APROVACAO = {
  criarFluxo,
  encerrarFluxo,
  salvarAgrupador,
  salvarResposta,
  submeter,
  decidir,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A configuração do motor: fluxos (com etapas e aprovadores), agrupadores, respostas e os apoios para os combos. */
export async function configuracaoAprovacao(l: Leitor, est: number) {
  const fluxos = await fluxosLidos(l, est);
  const etapas = await etapasLidas(
    l,
    fluxos.map((f) => f.id),
  );
  const aprovadores = await aprovadoresLidos(
    l,
    etapas.map((e) => e.id),
  );
  const usuarios = await l.consultar(
    `SELECT id, login, nome FROM usuario WHERE excluido_em IS NULL AND situacao = 'ativo' ORDER BY nome LIMIT 500`,
    [],
  );
  const papeis = await l.consultar(
    'SELECT id, nome FROM papel_seguranca WHERE excluido_em IS NULL ORDER BY nome LIMIT 300',
    [],
  );
  const centros = await l.consultar(
    'SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo LIMIT 500',
    [est],
  );
  return {
    fluxos: fluxos.map((f) => ({
      ...f,
      etapas: etapas
        .filter((e) => e.fluxo === f.id)
        .map((e) => ({ ...e, aprovadores: aprovadores.filter((a) => a.etapa === e.id) })),
    })),
    agrupadores: await agrupadoresLidos(l),
    respostas: await respostasLidas(l),
    apoios: {
      usuarios: usuarios.map((u) => ({
        id: numero(u['id']),
        rotulo: `${texto(u['nome'])} (${texto(u['login'])})`,
      })),
      papeis: papeis.map((p) => ({ id: numero(p['id']), rotulo: texto(p['nome']) })),
      centrosCusto: centros.map((c) => ({
        id: numero(c['id']),
        rotulo: `${texto(c['codigo'])} · ${texto(c['nome'])}`,
      })),
    },
  };
}

/**
 * A fila do aprovador (a tela do celular): os pedidos em aprovação no estabelecimento cuja etapa atual o usuário pode
 * decidir agora (nominal, substituto ou papel; agrupador e alçada conferidos), com as respostas do fluxo e se o canal
 * celular está liberado. Quem pediu não vê o próprio pedido.
 */
export async function pendenciasDoAprovador(l: Leitor, est: number, usuario: number) {
  const pedidos = await l.consultar(
    `SELECT p.id, p.fluxo_aprovacao_id, p.etapa_fluxo_aprovacao_id, p.entidade, p.entidade_id, p.numero_documento,
            p.descricao, p.valor, p.resumo_documento, p.solicitante_usuario_id, p.solicitado_em, p.nivel_atual,
            u.nome AS solicitante, f.descricao AS fluxo
       FROM pedido_aprovacao p
       JOIN fluxo_aprovacao f ON f.id = p.fluxo_aprovacao_id
       LEFT JOIN usuario u ON u.id = p.solicitante_usuario_id
      WHERE p.estabelecimento_id = ? AND p.situacao = 'em_aprovacao' AND p.excluido_em IS NULL
        AND p.etapa_fluxo_aprovacao_id IS NOT NULL
      ORDER BY p.solicitado_em LIMIT 300`,
    [est],
  );
  if (!pedidos.length) return [];
  const fluxos = [...new Set(pedidos.map((p) => numero(p['fluxo_aprovacao_id'])))];
  const etapas = await etapasLidas(l, fluxos);
  const aprovadores = await aprovadoresLidos(
    l,
    etapas.map((e) => e.id),
  );
  const agrupadores = await agrupadoresLidos(l);
  const respostas = (await respostasLidas(l)).filter((r) => r.ativo);
  const papeis = await papeisDoUsuario(l, usuario);
  const ja = new Set(
    (
      await l.consultar(
        `SELECT pedido_aprovacao_id, etapa_fluxo_aprovacao_id FROM decisao_aprovacao
          WHERE aprovador_usuario_id = ? AND etapa_fluxo_aprovacao_id IS NOT NULL
            AND pedido_aprovacao_id IN (${pedidos.map(() => '?').join(',')})`,
        [usuario, ...pedidos.map((p) => p['id'])],
      )
    ).map((x) => `${numero(x['pedido_aprovacao_id'])}:${numero(x['etapa_fluxo_aprovacao_id'])}`),
  );
  const h = hoje();
  const fila = [];
  for (const p of pedidos) {
    const resumo = json<{ atributos?: AtributosDocumento; solicitante?: number | null; etapas?: number[] }>(
      p['resumo_documento'],
      {},
    );
    const solicitante = resumo.solicitante ?? nulo(p['solicitante_usuario_id']);
    if (solicitante === usuario) continue;
    const etapa = etapas.find((x) => x.id === numero(p['etapa_fluxo_aprovacao_id']));
    if (!etapa || ja.has(`${numero(p['id'])}:${etapa.id}`)) continue;
    const doc: DocumentoEmAprovacao = {
      tipo: texto(p['entidade']) as DocumentoAprovavel,
      estabelecimento: est,
      valor: numero(p['valor']),
      atributos: resumo.atributos ?? {},
      solicitante,
    };
    const aptos = aprovadoresAptos(etapa.id, aprovadores, agrupadores, doc, h);
    const meu =
      aptos.find((a) => a.usuario === usuario) ??
      aptos.find((a) => a.substituto === usuario) ??
      aptos.find((a) => a.papel !== null && papeis.includes(a.papel));
    if (!meu) continue;
    const fluxo = numero(p['fluxo_aprovacao_id']);
    fila.push({
      pedido: numero(p['id']),
      tipo: doc.tipo,
      documento: numero(p['entidade_id']),
      numero: texto(p['numero_documento']),
      descricao: texto(p['descricao']),
      valor: doc.valor,
      fluxo: texto(p['fluxo']),
      etapa: etapa.nome,
      nivel: numero(p['nivel_atual']),
      totalEtapas: resumo.etapas?.length ?? 1,
      solicitante: texto(p['solicitante']),
      solicitadoEm:
        p['solicitado_em'] instanceof Date ? p['solicitado_em'].toISOString() : texto(p['solicitado_em']),
      celular: meu.aprovaPeloCelular,
      respostas: respostas
        .filter((r) => r.fluxo === null || r.fluxo === fluxo)
        .map((r) => ({
          id: r.id,
          descricao: r.descricao,
          efeito: r.efeito,
          exigeJustificativa: r.exigeJustificativa,
        })),
    });
  }
  return fila;
}

/** O histórico de um pedido: cada decisão com a etapa, a resposta, o canal e quando (o registro nunca se apaga). */
export async function historicoDoPedido(l: Leitor, est: number, pedido: number) {
  const p = await l.uma(
    `SELECT id, entidade, entidade_id, situacao, numero_documento, valor FROM pedido_aprovacao
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [pedido, est],
  );
  if (!p) return null;
  const decisoes = await l.consultar(
    `SELECT d.id, d.nivel, d.decisao, d.justificativa, d.canal, d.ocorrido_em, e.nome AS etapa, r.descricao AS resposta,
            u.nome AS aprovador
       FROM decisao_aprovacao d
       LEFT JOIN etapa_fluxo_aprovacao e ON e.id = d.etapa_fluxo_aprovacao_id
       LEFT JOIN resposta_padrao_aprovacao r ON r.id = d.resposta_padrao_aprovacao_id
       LEFT JOIN usuario u ON u.id = d.aprovador_usuario_id
      WHERE d.pedido_aprovacao_id = ? ORDER BY d.id`,
    [pedido],
  );
  return {
    pedido,
    tipo: texto(p['entidade']),
    documento: numero(p['entidade_id']),
    situacao: texto(p['situacao']),
    numero: texto(p['numero_documento']),
    valor: numero(p['valor']),
    decisoes: decisoes.map((d) => ({
      nivel: numero(d['nivel']),
      etapa: texto(d['etapa']),
      resposta: texto(d['resposta']),
      decisao: texto(d['decisao']),
      justificativa: texto(d['justificativa']),
      canal: texto(d['canal']),
      aprovador: texto(d['aprovador']),
      em: d['ocorrido_em'] instanceof Date ? d['ocorrido_em'].toISOString() : texto(d['ocorrido_em']),
    })),
  };
}
