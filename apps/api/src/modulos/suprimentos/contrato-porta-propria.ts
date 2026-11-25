// Porta PRÓPRIA dos contratos com fornecedores (M55, etapa 3) sobre o MariaDB do cliente, pelo @sgh/nucleo (F2.2,
// lote 03-13). Tabelas: contrato_fornecedor (o cadastro), gestor_contrato (gestor e fiscal pelo papel),
// garantia_contrato, aditivo_contrato (aditivo e renovação), reajuste_contrato (+ indice_reajuste), anexo_contrato,
// ocorrencia_contrato (o histórico do contrato: cada evento da tela, com os dados do evento em `dados`) e o vínculo pela
// coluna contrato_fornecedor_id do pedido_compra e do titulo_pagar. Gravação: UMA operação do executor por pedido
// (trilha, outbox e idempotência na mesma transação), sempre no estabelecimento da sessão; as regras são as do domínio
// (@sgh/dominio-suprimentos), conferidas sobre o estado relido na transação, com o contrato travado pela versão.
// Melhoria: a situação do contrato é a do modelo (vigente, encerrado, cancelado), o gestor e o fiscal são usuários
//   do cadastro (gestor_contrato, com o papel e a vigência), a garantia e o índice ficam nas tabelas próprias.
// Melhoria: o aditivo e a renovação também viram linha de aditivo_contrato (valor anterior e novo, vigência), o
//   reajuste vira linha de reajuste_contrato (período, percentual, valores) e o anexo vira anexo_contrato: as outras
//   telas (financeiro, auditoria) leem a estrutura, não o texto do evento.
// Melhoria: a chave do pedido de cada ato fica em idempotencia_operacao na MESMA transação, com o hash da entrada: a
//   mesma chave com outra entrada é recusada (idempotencia-divergente), nunca devolvida como repetição.
// Pendente (pedidos em saida/03-13.json): o "fornecedor crítico" e a observação do contrato, a exceção aprovada usada
//   e o pedido de origem de um título ligado ainda não têm coluna no modelo; até lá ficam no histórico do contrato
//   (ocorrencia_contrato, `dados` do registro do cadastro e do vínculo), lidos de lá.
import {
  type CandidatoVinculo,
  type ContratoDetalhe,
  type ContratoDoVinculo,
  type ContratoGravado,
  type EventoContrato,
  type FaixaVigencia,
  type GarantiaContrato,
  type IndiceReajuste,
  type PainelContratos,
  type SituacaoContratoFornecedor,
  TETO_LISTA_CONTRATOS,
  type TipoContrato,
  type TipoEventoContrato,
  type VinculoContrato,
  valorPedidoNoContrato,
} from '@sgh/contratos';
import {
  avaliarFornecedor,
  calcularReajuste,
  conferirEventoContrato,
  conferirVinculoContrato,
  fimVigente,
  montarContrato,
  saldoContrato,
} from '@sgh/dominio-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  erroIdempotenciaDivergente,
  type Executor,
  gravarIdempotencia,
  hashEntrada,
  type Leitor,
  type Linha,
  lerIdempotencia,
  type NucleoProprio,
  recusa,
  restricaoViolada,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type FornecedorContrato,
  type GravadorContrato,
  METODOS_PORTA_CONTRATO,
  type PortaContrato,
  type UsuarioContrato,
  type VinculoContratoGravado,
} from './contrato-porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoContrato = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a gravação do contrato escreve (o executor confere cada escrita contra esta lista). */
export const TABELAS_CONTRATO = [
  'contrato_fornecedor',
  'gestor_contrato',
  'garantia_contrato',
  'aditivo_contrato',
  'reajuste_contrato',
  'anexo_contrato',
  'ocorrencia_contrato',
  'pedido_compra',
  'titulo_pagar',
  'idempotencia_operacao',
] as const;

/** A operação sob a qual a chave de cada ato da tela fica guardada em idempotencia_operacao. */
export const OPERACAO_CHAVE_CONTRATO = 'contrato.ato.gravar';
/** Teto de proteção da leitura dos contratos do estabelecimento (a tela pagina por TETO_LISTA_CONTRATOS). */
const TETO_CONTRATOS = 5_000;
const TETO_CANDIDATOS = 200;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txtOuNull = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
const din = (n: number) => Math.round(n * 100) / 100;
function dataIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
function instante(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  return String(v ?? '')
    .replace(' ', 'T')
    .slice(0, 19);
}
function json(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') return JSON.parse(v) as Record<string, unknown>;
  return v as Record<string, unknown>;
}
const hojeLocal = (): string => dataIso(new Date())!;

// ── Vocabulário do modelo ↔ vocabulário da tela ─────────────────────────────────────────────────────────────────

const SITUACAO_DO_BANCO: Readonly<Record<string, SituacaoContratoFornecedor>> = {
  encerrado: 'encerrado',
  cancelado: 'rescindido',
};
const SITUACAO_NO_BANCO: Readonly<Record<SituacaoContratoFornecedor, string>> = {
  ativo: 'vigente',
  encerrado: 'encerrado',
  rescindido: 'cancelado',
};
const TIPOS_TELA: readonly TipoContrato[] = [
  'fornecimento',
  'servico',
  'manutencao',
  'locacao',
  'comodato',
  'outro',
];
const MODALIDADE_GARANTIA: Readonly<Record<Exclude<GarantiaContrato, 'nenhuma'>, string>> = {
  caucao: 'caucao_dinheiro',
  seguro: 'seguro_garantia',
  fianca: 'fianca_bancaria',
};
const GARANTIA_DA_MODALIDADE: Readonly<Record<string, GarantiaContrato>> = {
  caucao_dinheiro: 'caucao',
  seguro_garantia: 'seguro',
  fianca_bancaria: 'fianca',
};
const INDICES_TELA: readonly IndiceReajuste[] = ['ipca', 'igpm', 'inpc', 'incc', 'outro'];
/** O tipo da ocorrência do modelo para cada evento da tela (o evento exato fica em `dados.evento`). */
const OCORRENCIA_DO_EVENTO: Readonly<Record<TipoEventoContrato | 'cadastro' | 'vinculo', string>> = {
  aditivo: 'aditivo',
  renovacao: 'aditivo',
  reajuste: 'outro',
  ocorrencia: 'apontamento',
  avaliacao: 'outro',
  anexo: 'outro',
  excecao: 'outro',
  encerramento: 'outro',
  rescisao: 'outro',
  cadastro: 'outro',
  vinculo: 'apontamento',
};
const EVENTOS_TELA = new Set<string>([
  'aditivo',
  'reajuste',
  'renovacao',
  'ocorrencia',
  'avaliacao',
  'anexo',
  'excecao',
  'encerramento',
  'rescisao',
]);

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

interface ContratoLido extends ContratoGravado {
  readonly fornecedorNome: string;
  readonly centroCustoNome: string | null;
}

const SQL_CONTRATOS = `
  SELECT c.id, c.numero, c.empresa_fornecedora_id, ef.razao_social, c.tipo, c.objeto, c.vigencia_inicio, c.vigencia_fim,
         c.valor_global, ir.codigo AS indice, c.data_reajuste, c.centro_custo_id, cc.nome AS centro_nome, c.situacao,
         c.versao, c.criado_em, u.login AS criador,
         (SELECT ug.login FROM gestor_contrato g JOIN usuario ug ON ug.id = g.usuario_id
           WHERE g.contrato_fornecedor_id = c.id AND g.papel = 'gestor' AND g.excluido_em IS NULL
           ORDER BY g.id DESC LIMIT 1) AS gestor,
         (SELECT ug.login FROM gestor_contrato g JOIN usuario ug ON ug.id = g.usuario_id
           WHERE g.contrato_fornecedor_id = c.id AND g.papel = 'fiscal' AND g.excluido_em IS NULL
           ORDER BY g.id DESC LIMIT 1) AS fiscal
    FROM contrato_fornecedor c
    JOIN empresa_fornecedora ef ON ef.id = c.empresa_fornecedora_id
    LEFT JOIN indice_reajuste ir ON ir.id = c.indice_reajuste_id
    LEFT JOIN centro_custo cc ON cc.id = c.centro_custo_id
    LEFT JOIN usuario u ON u.id = c.criado_por
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

function contratoDe(r: Linha, garantia: Linha | undefined, cadastro: Record<string, unknown>): ContratoLido {
  const tipo = String(r['tipo']) as TipoContrato;
  const indice = txtOuNull(r['indice'])?.toLowerCase() as IndiceReajuste | undefined;
  const g = garantia ? GARANTIA_DA_MODALIDADE[String(garantia['modalidade'])] : undefined;
  return {
    id: num(r['id']),
    numero: String(r['numero']),
    fornecedor: num(r['empresa_fornecedora_id']),
    fornecedorNome: String(r['razao_social'] ?? ''),
    tipo: TIPOS_TELA.includes(tipo) ? tipo : 'outro',
    objeto: String(r['objeto']),
    critico: cadastro['critico'] === true,
    inicio: dataIso(r['vigencia_inicio'])!,
    fimOriginal: dataIso(r['vigencia_fim']) ?? dataIso(r['vigencia_inicio'])!,
    valorInicial: num(r['valor_global']),
    indiceReajuste: indice && INDICES_TELA.includes(indice) ? indice : 'nenhum',
    dataBase: dataIso(r['data_reajuste']),
    garantia: g ?? 'nenhuma',
    garantiaValor: g && garantia ? num(garantia['valor']) : null,
    garantiaValidade: g && garantia ? dataIso(garantia['validade_fim']) : null,
    gestor: String(r['gestor'] ?? ''),
    fiscal: String(r['fiscal'] ?? ''),
    centroCusto: numOuNull(r['centro_custo_id']),
    centroCustoNome: txtOuNull(r['centro_nome']),
    observacao: typeof cadastro['observacao'] === 'string' ? cadastro['observacao'] : null,
    situacao: SITUACAO_DO_BANCO[String(r['situacao'])] ?? 'ativo',
    versao: num(r['versao']),
    usuario: String(r['criador'] ?? ''),
    criadoEm: instante(r['criado_em']),
  };
}

interface Historico {
  readonly eventos: (EventoContrato & { contrato: number })[];
  readonly cadastro: Map<number, Record<string, unknown>>;
  /** Os vínculos gravados pela tela: o id do pedido ou do título → a exceção usada e o pedido de origem. */
  readonly vinculos: Map<
    string,
    { excecao: number | null; pedidoDeOrigem: number | null; usuario: string; em: string }
  >;
}

async function lerHistorico(l: Leitor, ids: readonly number[]): Promise<Historico> {
  const h: Historico = { eventos: [], cadastro: new Map(), vinculos: new Map() };
  if (!ids.length) return h;
  const xs = await l.consultar(
    `SELECT o.id, o.contrato_fornecedor_id, o.dados, o.descricao, o.valor, o.criado_em, u.login
       FROM ocorrencia_contrato o LEFT JOIN usuario u ON u.id = o.usuario_id
      WHERE o.contrato_fornecedor_id IN (${ids.map(() => '?').join(', ')}) AND o.operacao <> 'exclusao'
      ORDER BY o.id`,
    [...ids],
    { teto: 200_000 },
  );
  const usadas = new Set<number>();
  for (const x of xs) {
    const d = json(x['dados']);
    const contrato = num(x['contrato_fornecedor_id']);
    const evento = String(d['evento'] ?? '');
    const usuario = String(x['login'] ?? '');
    if (evento === 'cadastro') {
      h.cadastro.set(contrato, d);
      continue;
    }
    if (evento === 'vinculo') {
      const excecao = numOuNull(d['excecao']);
      if (excecao !== null) usadas.add(excecao);
      for (const alvo of (d['ids'] as number[] | undefined) ?? [])
        h.vinculos.set(`${String(d['tipo'])}:${alvo}`, {
          excecao,
          pedidoDeOrigem: numOuNull(d['pedidoDeOrigem']),
          usuario,
          em: instante(x['criado_em']),
        });
      continue;
    }
    if (!EVENTOS_TELA.has(evento)) continue;
    h.eventos.push({
      id: num(x['id']),
      contrato,
      tipo: evento as TipoEventoContrato,
      data: txtOuNull(d['data']),
      valor: numOuNull(x['valor'] ?? d['valor']),
      percentual: numOuNull(d['percentual']),
      novoFim: txtOuNull(d['novoFim']),
      numeroTermo: txtOuNull(d['numeroTermo']),
      notas: (d['notas'] as EventoContrato['notas']) ?? null,
      resultado: (d['resultado'] as EventoContrato['resultado']) ?? null,
      descricao: txtOuNull(d['descricao']),
      documento: numOuNull(d['documento']),
      usado: false,
      usuario,
      criadoEm: instante(x['criado_em']),
    });
  }
  for (const e of h.eventos) if (usadas.has(e.id)) (e as { usado: boolean }).usado = true;
  return h;
}

/** Os pedidos e os títulos ligados aos contratos (a coluna contrato_fornecedor_id), com o valor que abate o saldo. */
async function lerVinculos(
  l: Leitor,
  est: number,
  ids: readonly number[],
  h: Historico,
): Promise<Map<number, VinculoContrato[]>> {
  const m = new Map<number, VinculoContrato[]>();
  if (!ids.length) return m;
  const em = ids.map(() => '?').join(', ');
  const pedidos = await l.consultar(
    `SELECT p.id, p.contrato_fornecedor_id, p.ano, p.numero, p.valor_total, p.situacao, p.criado_em, u.login
       FROM pedido_compra p LEFT JOIN usuario u ON u.id = p.criado_por
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.contrato_fornecedor_id IN (${em})`,
    [est, ...ids],
    { teto: 200_000 },
  );
  // 05-SUP linha 20: o que a gestão do pedido cancelou depois da aprovação volta ao saldo do contrato.
  const cancelados = new Map<number, { cancelada: number; valorUnitario: number }[]>();
  if (pedidos.length) {
    const ems = pedidos.map(() => '?').join(', ');
    const itens = await l.consultar(
      `SELECT x.pedido_compra_id, x.quantidade_cancelada, x.valor_unitario
         FROM pedido_compra_item x
        WHERE x.excluido_em IS NULL AND x.quantidade_cancelada > 0 AND x.pedido_compra_id IN (${ems})`,
      pedidos.map((x) => num(x['id'])),
      { teto: 200_000 },
    );
    for (const x of itens) {
      const lista = cancelados.get(num(x['pedido_compra_id'])) ?? [];
      lista.push({ cancelada: num(x['quantidade_cancelada']), valorUnitario: num(x['valor_unitario']) });
      cancelados.set(num(x['pedido_compra_id']), lista);
    }
  }
  const titulos = await l.consultar(
    `SELECT t.id, t.contrato_fornecedor_id, t.numero_documento, t.serie_documento, t.valor_liquido, t.situacao,
            t.criado_em, u.login
       FROM titulo_pagar t LEFT JOIN usuario u ON u.id = t.criado_por
      WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.contrato_fornecedor_id IN (${em})`,
    [est, ...ids],
    { teto: 200_000 },
  );
  const por = (tipo: 'pedido' | 'titulo', x: Linha, chaveNatural: string, valor: number) => {
    const id = num(x['id']);
    const v = h.vinculos.get(`${tipo}:${id}`);
    const lista = m.get(num(x['contrato_fornecedor_id'])) ?? [];
    lista.push({
      id,
      tipo,
      legado: id,
      chaveNatural,
      valor: din(valor),
      pedidoDeOrigem: v?.pedidoDeOrigem ?? null,
      ativo: String(x['situacao']) !== 'cancelado',
      excecao: v?.excecao ?? null,
      usuario: v?.usuario ?? String(x['login'] ?? ''),
      criadoEm: v?.em ?? instante(x['criado_em']),
    });
    m.set(num(x['contrato_fornecedor_id']), lista);
  };
  for (const x of pedidos)
    por(
      'pedido',
      x,
      `${num(x['ano'])}/${num(x['numero'])}`,
      valorPedidoNoContrato({
        situacao: String(x['situacao']),
        valorAprovado: num(x['valor_total']),
        itens: cancelados.get(num(x['id'])) ?? [],
      }),
    );
  for (const x of titulos)
    por(
      'titulo',
      x,
      `${String(x['numero_documento'])}${x['serie_documento'] ? `/${String(x['serie_documento'])}` : ''}`,
      num(x['valor_liquido']),
    );
  return m;
}

interface Carga {
  readonly contratos: ContratoLido[];
  readonly historico: Historico;
  readonly vinculos: Map<number, VinculoContrato[]>;
  readonly cortada: boolean;
}

async function carregar(
  l: Leitor,
  est: number,
  filtro: { id?: number; situacao?: string | null; fornecedor?: number | null; termo?: string | null },
  travar = false,
): Promise<Carga> {
  const p: unknown[] = [est];
  let cond = '';
  if (filtro.id !== undefined) {
    cond += ' AND c.id = ?';
    p.push(filtro.id);
  }
  if (filtro.situacao) {
    if (filtro.situacao === 'ativo') cond += " AND c.situacao NOT IN ('encerrado','cancelado')";
    else {
      cond += ' AND c.situacao = ?';
      p.push(SITUACAO_NO_BANCO[filtro.situacao as SituacaoContratoFornecedor]);
    }
  }
  if (filtro.fornecedor) {
    cond += ' AND c.empresa_fornecedora_id = ?';
    p.push(filtro.fornecedor);
  }
  if (filtro.termo) {
    cond += ' AND (c.numero LIKE ? OR c.objeto LIKE ?)';
    const t = `%${filtro.termo.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    p.push(t, t);
  }
  const sql = `${SQL_CONTRATOS}${cond} ORDER BY c.vigencia_fim, c.id LIMIT ${TETO_CONTRATOS + 1}`;
  const linhas = travar
    ? await (l as TxOperacao).consultarParaAtualizar(sql, p, { teto: TETO_CONTRATOS + 1 })
    : await l.consultar(sql, p, { teto: TETO_CONTRATOS + 1 });
  const usar = linhas.slice(0, TETO_CONTRATOS);
  const ids = usar.map((r) => num(r['id']));
  const garantias = new Map<number, Linha>();
  if (ids.length)
    for (const g of await l.consultar(
      `SELECT contrato_fornecedor_id, modalidade, valor, validade_fim FROM garantia_contrato
        WHERE contrato_fornecedor_id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL
          AND situacao IN ('pendente','vigente')
        ORDER BY sequencia`,
      ids,
      { teto: ids.length * 10 },
    ))
      garantias.set(num(g['contrato_fornecedor_id']), g);
  const historico = await lerHistorico(l, ids);
  const vinculos = await lerVinculos(l, est, ids, historico);
  return {
    contratos: usar.map((r) =>
      contratoDe(r, garantias.get(num(r['id'])), historico.cadastro.get(num(r['id'])) ?? {}),
    ),
    historico,
    vinculos,
    cortada: linhas.length > TETO_CONTRATOS,
  };
}

function montar(k: Carga, c: ContratoLido, hoje: string) {
  return montarContrato(
    c,
    c.fornecedorNome,
    k.historico.eventos.filter((e) => e.contrato === c.id),
    k.vinculos.get(c.id) ?? [],
    hoje,
  );
}

// ── O gravador (dentro da operação do executor) ─────────────────────────────────────────────────────────────────

/** O gravador da tela e o vínculo feito dentro de outra operação (a compra), sem a chave da tela. */
type GravadorInterno = GravadorContrato & {
  vincularNaOperacao(
    v: Omit<Parameters<GravadorContrato['vincular']>[0], 'chave'>,
  ): Promise<VinculoContratoGravado>;
};

function gravadorSobre(tx: TxOperacao, est: number, hoje: string, agora: Date): GravadorInterno {
  const usuario = tx.contexto.usuario ?? null;

  /** O ato pela chave da tela: o reenvio igual devolve o guardado; a mesma chave com outra entrada é recusada. */
  async function porChave<T extends Record<string, unknown>>(
    chave: string,
    entrada: unknown,
    fazer: () => Promise<T>,
  ): Promise<{ valor: T; repetido: boolean }> {
    const hash = hashEntrada(OPERACAO_CHAVE_CONTRATO, entrada);
    const ja = await lerIdempotencia(tx, OPERACAO_CHAVE_CONTRATO, chave);
    if (ja) {
      if (ja.usuario !== usuario || ja.hashEntrada !== hash || num(ja.resultado['estabelecimento']) !== est)
        throw erroIdempotenciaDivergente();
      return { valor: ja.resultado as unknown as T, repetido: true };
    }
    const valor = await fazer();
    await gravarIdempotencia(tx, {
      operacao: OPERACAO_CHAVE_CONTRATO,
      chave,
      estabelecimento: est,
      usuario,
      hashEntrada: hash,
      resultado: { ...valor, estabelecimento: est } as unknown as ResultadoOperacao,
      trilha: null,
      agora,
    });
    return { valor, repetido: false };
  }

  async function usuarioDoLogin(login: string, campo: string): Promise<number> {
    const u = await tx.uma(
      "SELECT id FROM usuario WHERE login = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [login.trim()],
    );
    if (!u)
      throw recusa('usuario-inexistente', 'O usuário não existe ou não está ativo.', { campos: [campo] });
    return num(u['id']);
  }

  async function indiceDoCodigo(codigo: IndiceReajuste): Promise<number | null> {
    if (codigo === 'nenhum') return null;
    const r = await tx.uma('SELECT id FROM indice_reajuste WHERE codigo = ? AND ativo', [
      codigo.toUpperCase(),
    ]);
    if (!r)
      throw recusa(
        'indice-sem-cadastro',
        `O índice ${codigo.toUpperCase()} não está no cadastro de índices de reajuste: cadastre-o antes de usar.`,
        { campos: ['indiceReajuste'] },
      );
    return num(r['id']);
  }

  async function ocorrencia(
    contrato: number,
    evento: TipoEventoContrato | 'cadastro' | 'vinculo',
    descricao: string,
    dados: Record<string, unknown>,
    o: { valor?: number | null; ocorridoEm?: Date; operacao?: string } = {},
  ): Promise<number> {
    return tx.incluir('ocorrencia_contrato', {
      contrato_fornecedor_id: contrato,
      operacao: o.operacao ?? 'inclusao',
      dados: JSON.stringify({ evento, ...dados }),
      ocorrido_em: o.ocorridoEm ?? agora,
      usuario_id: usuario,
      tipo_ocorrencia: OCORRENCIA_DO_EVENTO[evento],
      descricao,
      valor: o.valor === undefined || o.valor === null ? null : Math.abs(o.valor),
    });
  }

  async function papel(contrato: number, p: 'gestor' | 'fiscal', login: string, inicio: string) {
    const id = await usuarioDoLogin(login, p);
    const atual = await tx.uma(
      `SELECT id, usuario_id, versao FROM gestor_contrato
        WHERE contrato_fornecedor_id = ? AND papel = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
      [contrato, p],
    );
    if (atual && num(atual['usuario_id']) === id) return id;
    if (atual)
      await tx.alterar('gestor_contrato', num(atual['id']), num(atual['versao']), { usuario_id: id });
    else
      await tx.incluir('gestor_contrato', {
        contrato_fornecedor_id: contrato,
        usuario_id: id,
        papel: p,
        vigencia_inicio: inicio,
        aprovador: p === 'gestor',
      });
    return id;
  }

  async function garantia(
    contrato: number,
    g: GarantiaContrato,
    valor: number | null,
    validade: string | null,
    inicio: string,
  ) {
    const atual = await tx.uma(
      `SELECT id, versao FROM garantia_contrato
        WHERE contrato_fornecedor_id = ? AND excluido_em IS NULL AND situacao IN ('pendente','vigente')
        ORDER BY sequencia DESC LIMIT 1`,
      [contrato],
    );
    if (g === 'nenhuma') {
      if (atual)
        await tx.alterar('garantia_contrato', num(atual['id']), num(atual['versao']), {
          situacao: 'cancelada',
        });
      return;
    }
    const valores = {
      modalidade: MODALIDADE_GARANTIA[g],
      valor,
      validade_inicio: inicio,
      validade_fim: validade,
    };
    if (atual) {
      await tx.alterar('garantia_contrato', num(atual['id']), num(atual['versao']), valores);
      return;
    }
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM garantia_contrato WHERE contrato_fornecedor_id = ?',
      [contrato],
    );
    await tx.incluir('garantia_contrato', {
      contrato_fornecedor_id: contrato,
      sequencia: num(seq?.['proxima']),
      situacao: 'vigente',
      ...valores,
    });
  }

  async function contratoTravado(id: number): Promise<{ k: Carga; c: ContratoLido }> {
    const k = await carregar(tx, est, { id }, true);
    const c = k.contratos[0];
    if (!c) throw recusa('contrato-inexistente', 'O contrato não existe neste estabelecimento.');
    return { k, c };
  }

  const erroRestricao = (erro: unknown): never => {
    const r = restricaoViolada(erro);
    if (r?.nome === 'uq_contrato_fornecedor_estabelecimento_numero')
      throw recusa('numero-repetido', 'Já existe contrato com este número no estabelecimento.', {
        campos: ['numero'],
      });
    if (r?.nome === 'fk_contrato_fornecedor_empresa_fornecedora_id')
      throw recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro.', {
        campos: ['fornecedor'],
      });
    if (r?.nome === 'fk_contrato_fornecedor_centro_custo_id')
      throw recusa('centro-custo-inexistente', 'O centro de custo não existe.', { campos: ['centroCusto'] });
    if (r?.nome === 'fk_anexo_contrato_arquivo_id')
      throw recusa('documento-inexistente', 'O documento anexado não existe.', { campos: ['documento'] });
    throw erro;
  };

  return {
    criar: async ({ entrada: x }) => {
      const r = await porChave(x.chave, x, async () => {
        const f = await tx.uma(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
          [x.fornecedor],
        );
        if (!f)
          throw recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro ou não está ativo.', {
            campos: ['fornecedor'],
          });
        let id: number;
        try {
          const gestor = await usuarioDoLogin(x.gestor, 'gestor');
          id = await tx.incluir('contrato_fornecedor', {
            estabelecimento_id: est,
            numero: x.numero,
            objeto: x.objeto,
            empresa_fornecedora_id: x.fornecedor,
            tipo: x.tipo,
            centro_custo_id: x.centroCusto,
            gestor_usuario_id: gestor,
            data_emissao: x.inicio,
            vigencia_inicio: x.inicio,
            vigencia_fim: x.fim,
            valor_global: x.valor,
            indice_reajuste_id: await indiceDoCodigo(x.indiceReajuste),
            data_reajuste: x.indiceReajuste === 'nenhum' ? null : x.dataBase,
            situacao: 'vigente',
          });
        } catch (erro) {
          return erroRestricao(erro);
        }
        await papel(id, 'gestor', x.gestor, x.inicio);
        await papel(id, 'fiscal', x.fiscal, x.inicio);
        await garantia(id, x.garantia, x.garantiaValor, x.garantiaValidade, x.inicio);
        await ocorrencia(id, 'cadastro', 'Cadastro do contrato', {
          critico: x.critico,
          observacao: x.observacao,
        });
        return { id };
      });
      return { id: num(r.valor['id']), repetido: r.repetido };
    },
    alterar: async ({ id, entrada: x }) => {
      const { k, c } = await contratoTravado(id);
      if (c.situacao !== 'ativo')
        throw recusa(
          'contrato-encerrado',
          'O contrato está encerrado ou rescindido: o cadastro não muda mais.',
        );
      if (c.versao !== x.versao) throw erroConflitoVersao(['versao']);
      let versao: number;
      try {
        versao = await tx.alterar('contrato_fornecedor', id, x.versao, {
          objeto: x.objeto,
          centro_custo_id: x.centroCusto,
          gestor_usuario_id: await usuarioDoLogin(x.gestor, 'gestor'),
          indice_reajuste_id: await indiceDoCodigo(x.indiceReajuste),
          data_reajuste: x.indiceReajuste === 'nenhum' ? null : x.dataBase,
        });
      } catch (erro) {
        return erroRestricao(erro);
      }
      await papel(id, 'gestor', x.gestor, c.inicio);
      await papel(id, 'fiscal', x.fiscal, c.inicio);
      await garantia(id, x.garantia, x.garantiaValor, x.garantiaValidade, c.inicio);
      const antes = k.historico.cadastro.get(id) ?? {};
      if (antes['critico'] !== x.critico || (antes['observacao'] ?? null) !== x.observacao)
        await ocorrencia(
          id,
          'cadastro',
          'Alteração do cadastro do contrato',
          { critico: x.critico, observacao: x.observacao },
          { operacao: 'alteracao' },
        );
      return { id, versao };
    },
    evento: async ({ contrato: id, entrada: x }) => {
      const r = await porChave(x.chave, { contrato: id, ...x }, async () => {
        const { k, c } = await contratoTravado(id);
        if (c.versao !== x.versao) throw erroConflitoVersao(['versao']);
        const evs = k.historico.eventos.filter((e) => e.contrato === id);
        const vinc = k.vinculos.get(id) ?? [];
        const saldo = saldoContrato(c.valorInicial, evs, vinc);
        const fim = fimVigente(c.fimOriginal, evs);
        const valorInformado = 'valor' in x ? x.valor : null;
        const novoFim = 'novoFim' in x ? x.novoFim : null;
        const data = 'data' in x ? x.data : null;
        const r0 = conferirEventoContrato({
          tipo: x.tipo,
          situacao: c.situacao,
          inicio: c.inicio,
          fim,
          novoFim,
          valor: valorInformado,
          saldo: saldo.saldo,
          data,
          hoje,
        });
        if (r0) throw recusa(r0.codigo, r0.mensagem, r0.campos ? { campos: r0.campos } : {});
        let valor = valorInformado;
        const vigente = saldo.valorInicial + saldo.aditivos + saldo.reajustes;
        if (x.tipo === 'reajuste') {
          const rs = evs.filter((v) => v.tipo === 'reajuste');
          const calc = calcularReajuste({
            indice: c.indiceReajuste,
            dataBase: c.dataBase,
            ultimoReajuste: rs.length ? rs[rs.length - 1]!.data : null,
            data: x.data,
            percentual: x.percentual,
            valorVigente: vigente,
          });
          if ('codigo' in calc)
            throw recusa(calc.codigo, calc.mensagem, calc.campos ? { campos: calc.campos } : {});
          valor = calc.valor;
        }
        const documento = 'documento' in x ? x.documento : null;
        const notas = x.tipo === 'avaliacao' ? x.notas : null;
        const evento = await ocorrencia(
          id,
          x.tipo,
          x.descricao || `Evento do contrato: ${x.tipo}`,
          {
            data,
            valor,
            percentual: x.tipo === 'reajuste' ? x.percentual : null,
            novoFim,
            numeroTermo: 'numeroTermo' in x ? x.numeroTermo : null,
            notas,
            resultado: notas ? avaliarFornecedor(notas).resultado : null,
            descricao: x.descricao || null,
            documento,
          },
          { valor, ...(data ? { ocorridoEm: new Date(`${data}T12:00:00`) } : {}) },
        );
        // A estrutura do evento nas tabelas próprias (lidas pelas outras telas).
        try {
          if (x.tipo === 'aditivo' || x.tipo === 'renovacao') {
            const v = x.valor;
            const tipo =
              v !== 0 && x.novoFim ? 'prazo_valor' : v !== 0 ? (v < 0 ? 'supressao' : 'valor') : 'prazo';
            await tx.incluir('aditivo_contrato', {
              contrato_fornecedor_id: id,
              numero: x.numeroTermo,
              tipo,
              data_assinatura: hoje,
              vigencia_inicio: hoje < c.inicio ? c.inicio : hoje,
              vigencia_fim: x.novoFim,
              valor_anterior: din(vigente),
              valor_aditivo: v,
              valor_novo: din(vigente + v),
              objeto: x.descricao || null,
              justificativa:
                x.descricao || (x.tipo === 'renovacao' ? 'Renovação do contrato' : 'Termo aditivo'),
              arquivo_id: documento,
              assinado: true,
              situacao: 'vigente',
            });
            await tx.alterar('contrato_fornecedor', id, c.versao, {
              quantidade_aditivos:
                evs.filter((e) => e.tipo === 'aditivo' || e.tipo === 'renovacao').length + 1,
            });
          } else if (x.tipo === 'reajuste') {
            const rs = evs.filter((v) => v.tipo === 'reajuste');
            const de = rs.length ? rs[rs.length - 1]!.data! : (c.dataBase ?? c.inicio);
            await tx.incluir('reajuste_contrato', {
              contrato_fornecedor_id: id,
              operacao: 'inclusao',
              indice_reajuste_id: await indiceDoCodigo(c.indiceReajuste),
              periodo_inicio: de <= x.data ? de : x.data,
              periodo_fim: x.data,
              percentual: x.percentual,
              valor_anterior: din(vigente),
              valor_novo: din(vigente + (valor ?? 0)),
              aplicado_em: x.data,
              observacao: x.descricao ? x.descricao.slice(0, 500) : null,
              ocorrido_em: agora,
              usuario_id: usuario,
            });
            await tx.alterar('contrato_fornecedor', id, c.versao, { data_reajuste: x.data });
          } else if (x.tipo === 'anexo') {
            const seq = await tx.uma(
              'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM anexo_contrato WHERE contrato_fornecedor_id = ?',
              [id],
            );
            await tx.incluir('anexo_contrato', {
              contrato_fornecedor_id: id,
              sequencia: num(seq?.['proxima']),
              tipo_documento: 'outro',
              descricao: x.descricao.slice(0, 150),
              arquivo_id: x.documento,
            });
            await tx.alterar('contrato_fornecedor', id, c.versao, {
              situacao: SITUACAO_NO_BANCO[c.situacao],
            });
          } else if (x.tipo === 'encerramento' || x.tipo === 'rescisao') {
            await tx.alterar('contrato_fornecedor', id, c.versao, {
              situacao: x.tipo === 'encerramento' ? 'encerrado' : 'cancelado',
            });
          } else {
            // A versão do contrato sobe a cada evento (a tela recarrega o saldo e o histórico).
            await tx.alterar('contrato_fornecedor', id, c.versao, {
              situacao: SITUACAO_NO_BANCO[c.situacao],
            });
          }
        } catch (erro) {
          return erroRestricao(erro);
        }
        return { evento, valor };
      });
      return {
        evento: num(r.valor['evento']),
        contrato: id,
        tipo: x.tipo,
        valor: numOuNull(r.valor['valor']),
        repetido: r.repetido,
      };
    },
    vincular: async (v) => {
      const r = await porChave(v.chave, { contrato: v.contrato, tipo: v.tipo, ids: [...v.ids] }, () =>
        vincularAgora(v),
      );
      return {
        contrato: v.contrato.contrato,
        vinculos: (r.valor['vinculos'] as number[]) ?? [],
        saldoAntes: num(r.valor['saldoAntes']),
        saldoDepois: num(r.valor['saldoDepois']),
        repetido: r.repetido,
      };
    },
    vincularNaOperacao: async (v) => {
      const r = await vincularAgora(v);
      return { contrato: v.contrato.contrato, ...r, repetido: false };
    },
  };

  /** O vínculo (regras 6 e 7) com o contrato travado: o pedido ou o título passa a apontar o contrato, com o histórico. */
  async function vincularAgora(
    v: Omit<Parameters<GravadorContrato['vincular']>[0], 'chave'>,
  ): Promise<{ vinculos: number[]; saldoAntes: number; saldoDepois: number }> {
    const { k, c } = await contratoTravado(v.contrato.contrato);
    const evs = k.historico.eventos.filter((e) => e.contrato === c.id);
    const saldo = saldoContrato(c.valorInicial, evs, k.vinculos.get(c.id) ?? []);
    const ids = [...new Set(v.ids)];
    const em = ids.map(() => '?').join(', ');
    const alvos =
      v.tipo === 'pedido'
        ? await tx.consultarParaAtualizar(
            `SELECT id, empresa_fornecedora_id AS fornecedor, contrato_fornecedor_id, valor_total AS valor, versao
                     FROM pedido_compra
                    WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${em})`,
            [est, ...ids],
            { teto: ids.length },
          )
        : await tx.consultarParaAtualizar(
            `SELECT id, empresa_fornecedora_id AS fornecedor, contrato_fornecedor_id, valor_liquido AS valor, versao
                     FROM titulo_pagar
                    WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND id IN (${em})`,
            [est, ...ids],
            { teto: ids.length },
          );
    if (alvos.length !== ids.length)
      throw v.tipo === 'pedido'
        ? recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['ids'] })
        : recusa('titulo-inexistente', 'Algum título não existe ou está cancelado.', { campos: ['ids'] });
    const exc =
      v.contrato.excecao === null
        ? null
        : evs.find((e) => e.id === v.contrato.excecao && e.tipo === 'excecao');
    if (v.contrato.excecao !== null && !exc)
      throw recusa('excecao-inexistente', 'A exceção aprovada não existe.', { campos: ['excecao'] });
    const origem = v.contrato.pedidoDeOrigem;
    const r0 = conferirVinculoContrato({
      contrato: {
        id: c.id,
        situacao: c.situacao,
        inicio: c.inicio,
        fim: fimVigente(c.fimOriginal, evs),
        fornecedor: c.fornecedor,
      },
      hoje,
      tipo: v.tipo,
      fornecedores: [...new Set(alvos.map((a) => num(a['fornecedor'])))],
      valor: v.tipo === 'titulo' && origem === null ? din(alvos.reduce((s, a) => s + num(a['valor']), 0)) : 0,
      saldo: saldo.saldo,
      excecao: exc
        ? { id: exc.id, contrato: c.id, aprovador: exc.usuario, criadoEm: exc.criadoEm, usada: exc.usado }
        : null,
      solicitante: v.usuario,
      jaVinculado: alvos.some((a) => a['contrato_fornecedor_id'] !== null),
      pedidoDeOrigemValido:
        origem === null
          ? null
          : (k.vinculos.get(c.id) ?? []).some((y) => y.id === origem && y.tipo === 'pedido'),
    });
    if (r0) throw recusa(r0.codigo, r0.mensagem, r0.campos ? { campos: r0.campos } : {});
    for (const a of alvos)
      await tx.alterar(
        v.tipo === 'pedido' ? 'pedido_compra' : 'titulo_pagar',
        num(a['id']),
        num(a['versao']),
        {
          contrato_fornecedor_id: c.id,
        },
      );
    await ocorrencia(
      c.id,
      'vinculo',
      v.tipo === 'pedido' ? 'Pedido de compra ligado ao contrato' : 'Título a pagar ligado ao contrato',
      { tipo: v.tipo, ids, excecao: v.contrato.excecao, pedidoDeOrigem: origem },
    );
    const depois = await carregar(tx, est, { id: c.id });
    const s2 = saldoContrato(c.valorInicial, evs, depois.vinculos.get(c.id) ?? []);
    return { vinculos: ids, saldoAntes: saldo.saldo, saldoDepois: s2.saldo };
  }
}

/** As tabelas que o vínculo do pedido ao contrato escreve dentro da operação de compras. */
export const TABELAS_VINCULO_PEDIDO_CONTRATO = ['ocorrencia_contrato'] as const;

/**
 * 05-SUP linha 27: o pedido de compra nasce ligado ao contrato do fornecedor, na MESMA transação da operação de compras
 * (o executor do estoque): as mesmas regras do vínculo da tela dos contratos (vigência ou exceção aprovada, mesmo
 * fornecedor, contrato ativo), o pedido passa a apontar o contrato e o histórico do contrato registra o vínculo.
 */
export async function vincularPedidoNaCompra(
  tx: TxOperacao,
  est: number,
  hoje: string,
  m: { contrato: ContratoDoVinculo; pedido: number; solicitante: string },
): Promise<VinculoContratoGravado> {
  return gravadorSobre(tx, est, hoje, new Date()).vincularNaOperacao({
    contrato: m.contrato,
    tipo: 'pedido',
    ids: [m.pedido],
    usuario: m.solicitante,
  });
}

// ── A porta ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SEM_EXECUTOR =
  'O contrato não grava pelo executor genérico: o pedido e o título com contrato nascem nas telas de compras e de contas a pagar.';

export class PortaContratoPropria implements PortaContrato {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoContrato,
    executorPronto?: Executor,
    private readonly hoje: () => string = hojeLocal,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18, est: number): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'contrato',
    };
  }

  /** O estabelecimento da sessão; sem ele nada é lido nem gravado. */
  private est(c: ContextoPortaM18): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(): Promise<never> {
    return Promise.reject(new ErroProblema('operacao-bloqueada', 409, 'Operação indisponível', SEM_EXECUTOR));
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorContrato) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const hoje = this.hoje();
    const op = definirOperacao({
      nome: 'contrato.gravacao',
      tabelas: [...TABELAS_CONTRATO],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est, hoje, new Date())) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'contrato_fornecedor', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `contrato:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação do contrato sem resultado.');
    return (saida as { valor: T }).valor;
  }

  listar(c: ContextoPortaM18, f: Parameters<PortaContrato['listar']>[1]) {
    return this.ler(c, async (l, est) => {
      const hoje = this.hoje();
      const k = await carregar(l, est, {
        situacao: f.situacao === 'todos' ? null : f.situacao,
        fornecedor: f.fornecedor,
        termo: f.termo,
      });
      let itens = k.contratos.map((x) => montar(k, x, hoje).resumo);
      if (f.faixa) itens = itens.filter((x) => x.faixa === f.faixa);
      itens.sort((a, b) => a.fim.localeCompare(b.fim) || a.id - b.id);
      const pular = (f.pagina - 1) * TETO_LISTA_CONTRATOS;
      return {
        hoje,
        itens: itens.slice(pular, pular + TETO_LISTA_CONTRATOS),
        pagina: f.pagina,
        cortada: k.cortada || itens.length > pular + TETO_LISTA_CONTRATOS,
      };
    });
  }

  detalhar(c: ContextoPortaM18, id: number): Promise<ContratoDetalhe | null> {
    return this.ler(c, async (l, est) => {
      const k = await carregar(l, est, { id });
      const x = k.contratos[0];
      if (!x) return null;
      const m = montar(k, x, this.hoje());
      return { ...m.resumo, ...m.detalhe, centroCustoNome: x.centroCustoNome };
    });
  }

  painel(c: ContextoPortaM18): Promise<PainelContratos> {
    return this.ler(c, async (l, est) => {
      const hoje = this.hoje();
      const k = await carregar(l, est, { situacao: 'ativo' });
      const ms = k.contratos.map((x) => montar(k, x, hoje));
      const faixas: FaixaVigencia[] = [
        'a-iniciar',
        'vigente',
        'vence-90',
        'vence-60',
        'vence-30',
        'vencido',
        'encerrado',
      ];
      return {
        hoje,
        ativos: ms.length,
        porFaixa: Object.fromEntries(
          faixas.map((f) => [f, ms.filter((m) => m.resumo.faixa === f).length]),
        ) as Record<FaixaVigencia, number>,
        avaliacaoVencida: ms.filter((m) => m.detalhe.avisos.some((a) => a.codigo === 'avaliacao-vencida'))
          .length,
        saldoExcedido: ms.filter((m) => m.resumo.saldo < 0).length,
      };
    });
  }

  candidatos(c: ContextoPortaM18, id: number): Promise<CandidatoVinculo[] | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        'SELECT empresa_fornecedora_id FROM contrato_fornecedor WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      if (!x) return null;
      const f = num(x['empresa_fornecedora_id']);
      const pedidos = await l.consultar(
        `SELECT id, ano, numero, data_pedido, valor_total FROM pedido_compra
          WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND contrato_fornecedor_id IS NULL
            AND excluido_em IS NULL AND situacao NOT IN ('cancelado','reprovado')
          ORDER BY data_pedido DESC, id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, f],
        { teto: TETO_CANDIDATOS },
      );
      const titulos = await l.consultar(
        `SELECT id, numero_documento, serie_documento, data_emissao, valor_liquido, quantidade_parcelas
           FROM titulo_pagar
          WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND contrato_fornecedor_id IS NULL
            AND excluido_em IS NULL AND situacao <> 'cancelado'
          ORDER BY data_emissao DESC, id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, f],
        { teto: TETO_CANDIDATOS },
      );
      return [
        ...pedidos.map((p): CandidatoVinculo => ({
          tipo: 'pedido',
          ids: [num(p['id'])],
          chaveNatural: `${num(p['ano'])}/${num(p['numero'])}`,
          data: dataIso(p['data_pedido']),
          valor: din(num(p['valor_total'])),
          descricao: `Pedido ${num(p['numero'])}/${num(p['ano'])}`,
        })),
        ...titulos.map((t): CandidatoVinculo => ({
          tipo: 'titulo',
          ids: [num(t['id'])],
          chaveNatural: `${String(t['numero_documento'])}${t['serie_documento'] ? `/${String(t['serie_documento'])}` : ''}`,
          data: dataIso(t['data_emissao']),
          valor: din(num(t['valor_liquido'])),
          descricao: `Documento ${String(t['numero_documento'])}${t['serie_documento'] ? ` série ${String(t['serie_documento'])}` : ''} (${num(t['quantidade_parcelas'])} parcela(s))`,
        })),
      ];
    });
  }

  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }> {
    // Cadastro da rede inteira (o fornecedor não tem estabelecimento).
    const t = termo.trim();
    return this.ler(c, async (l) => {
      const xs = await l.consultar(
        `SELECT id, razao_social FROM empresa_fornecedora
          WHERE excluido_em IS NULL AND situacao = 'ativo' AND (id = ? OR razao_social LIKE ? OR nome_fantasia LIKE ?)
          ORDER BY razao_social, id LIMIT 51`,
        [
          /^\d+$/.test(t) ? Number(t) : 0,
          `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
          `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
        ],
        { teto: 51 },
      );
      return {
        itens: xs.slice(0, 50).map((x) => ({ codigo: num(x['id']), nome: String(x['razao_social']) })),
        cortada: xs.length > 50,
      };
    });
  }

  usuarios(c: ContextoPortaM18, termo: string): Promise<UsuarioContrato[]> {
    // Cadastro da rede inteira: os usuários ativos (pessoas), pelo login ou nome; teto de 50.
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT login, nome FROM usuario
            WHERE excluido_em IS NULL AND situacao = 'ativo' AND tipo_conta = 'pessoa' AND (login LIKE ? OR nome LIKE ?)
            ORDER BY nome, login LIMIT 50`,
          [`%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`],
          { teto: 50 },
        )
      ).map((x) => ({ login: String(x['login']), nome: String(x['nome']) })),
    );
  }

  centros(c: ContextoPortaM18): Promise<FornecedorContrato[]> {
    // Os centros de custo analíticos e ativos do estabelecimento (os que recebem lançamento).
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome FROM centro_custo
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo AND analitico
            ORDER BY nome, id`,
          [est],
          { teto: 5_000 },
        )
      ).map((x) => ({ codigo: num(x['id']), nome: String(x['nome']) })),
    );
  }
}

/** A porta própria sobre o núcleo do cliente. */
export function portaContratoPropria(nucleo: NucleoContrato): PortaContrato {
  return new PortaContratoPropria(nucleo);
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaContratoIndisponivel(): PortaContrato {
  return portaIndisponivel<PortaContrato>(METODOS_PORTA_CONTRATO);
}
