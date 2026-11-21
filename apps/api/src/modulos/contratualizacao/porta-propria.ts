// Porta PRÓPRIA da contratualização SUS (M55, F2.2): o banco do cliente pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre no estabelecimento da sessão e sem os registros excluídos; as gravações da tela (contrato,
// meta e apuração) numa operação do Executor (`contratualizacao.gravacao`): trilha, outbox e idempotência na mesma
// transação, o contrato, a meta e a apuração relidos com trava (FOR UPDATE) antes de mudar e a versão conferida pela
// trava otimista (`alterarAuditado`).
// Tabelas: contrato_gestor_sus, incentivo_contratual_sus, meta_contratual_sus, indicador_contratual_sus,
// afericao_meta_sus; listas em dominio_contratualizacao_sus; SIGTAP (procedimento_sigtap, grupo_sigtap, dominio_sigtap,
// da rede inteira: catálogo público); produção do faturamento SUS (producao_ambulatorial_sus*, conta_aih*).
// Melhoria: o CNES e a habilitação do contrato vêm do cadastro do estabelecimento (estabelecimento.codigo_cnes e
// habilitacao_estabelecimento vigente), não de texto digitado por contrato.
// Melhoria: o motivo do encerramento vai à trilha da operação (motivo), com quem encerrou e quando no próprio contrato.
// Melhoria: o reenvio do pedido com a mesma Idempotency-Key acha o contrato, a meta ou a apuração original pela chave
// guardada em idempotencia_operacao na inclusão (mesma transação; a chave única do banco impede a segunda linha).
// Melhoria: a meta qualitativa ganha o seu indicador (indicador_contratual_sus) com o tipo, o sentido e a unidade.
// Melhoria: valores em DECIMAL de reais no banco (a tela segue em centavos); listas por código neutro (vocabulario.ts).
// O contrato guarda a observação e o encerramento (motivo, quando e quem); a meta, o bloco de financiamento
// (complexidade) e o formato "valor inteiro"; a apuração, a origem do realizado. A produção das contas SUS de convênio
// soma os itens das contas hospitalares das fontes pagadoras do parâmetro, pela equivalência vigente do item faturável
// com a SIGTAP (equivalencia_sigtap_item) na data em que o item foi realizado.
import { randomUUID } from 'node:crypto';
import {
  type ApuracaoSus,
  type ContratoSus,
  type EscoreSus,
  type IncentivoSus,
  type MetaSus,
  mesesDaPeriodicidade,
  type ProducaoSigtapSus,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  erroIdempotenciaDivergente,
  gravarIdempotencia,
  hashEntrada,
  lerIdempotencia,
  type Escritor,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  type ApuracaoParaGravar,
  type ContratoParaGravar,
  type DominiosContratualizacao,
  type GravadorContratualizacao,
  LISTAS_DOMINIO_CONTRATUALIZACAO,
  type ListaDominioContratualizacao,
  type MetaParaGravar,
  METODOS_PORTA_CONTRATUALIZACAO,
  type PortaContratualizacao,
} from './porta.js';
import {
  codigoDaTela,
  codigoNeutro,
  FONTE_AFERICAO_DA_TELA,
  FORMATO_DA_TELA,
  FORMATO_DO_BANCO,
  MODALIDADE_SIGTAP,
  NIVEL_DA_TELA,
  NIVEL_DO_BANCO,
  ORIGEM_REALIZADO_DO_BANCO,
  ORIGEM_REALIZADO_DO_CONTRATO,
  periodicidadeDosMeses,
} from './vocabulario.js';

/** O mínimo do núcleo que a porta usa (os testes trocam). */
export type NucleoContratualizacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Tabelas que a operação de gravação da contratualização grava. */
export const TABELAS_CONTRATUALIZACAO = [
  'contrato_gestor_sus',
  'incentivo_contratual_sus',
  'meta_contratual_sus',
  'indicador_contratual_sus',
  'afericao_meta_sus',
] as const;

const TETO_CONTRATOS = 200;
const TETO_METAS = 500;
const TETO_APURACOES = 5_000;
const TETO_PRODUCAO = 50_000;
const FUSO_PADRAO = 'America/Sao_Paulo';
const SEM_EXECUTOR = 'A contratualização SUS grava pela operação própria da tela, não por operação avulsa.';

type Linha = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
/** DATE do banco → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** DATETIME do banco → "AAAA-MM-DDTHH:MM:SS". */
const instanteIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : null;
/** Reais (DECIMAL) → centavos; centavos → reais com 2 casas. */
const centavos = (v: unknown) => Math.round(num(v) * 100);
const reais = (c: number) => (c / 100).toFixed(2);
/** "AAAAMM" ↔ datas do mês. */
const primeiroDia = (competencia: string) => `${competencia.slice(0, 4)}-${competencia.slice(4, 6)}-01`;
function ultimoDia(competencia: string): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(4, 6));
  return `${primeiroDia(competencia).slice(0, 8)}${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;
}
const competenciaDe = (data: string | null) => (data ? `${data.slice(0, 4)}${data.slice(5, 7)}` : null);
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Hoje e a competência no fuso do estabelecimento. */
export function relogioContratualizacao(
  fuso: string | null,
  agora: Date = new Date(),
): { hoje: string; competencia: string } {
  const formatar = (f: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: f,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(agora);
  let hoje: string;
  try {
    hoje = formatar(fuso || FUSO_PADRAO);
  } catch {
    hoje = formatar(FUSO_PADRAO);
  }
  return { hoje, competencia: `${hoje.slice(0, 4)}${hoje.slice(5, 7)}` };
}

// ── SQL de leitura ───────────────────────────────────────────────────────────────────────────────────────────────

const SQL_CONTRATO = `SELECT g.id, g.numero_contrato, g.gestor_nome, g.objeto, g.vigencia_inicio, g.vigencia_fim,
    g.valor_pre_fixado_mensal, g.valor_pos_fixado_mensal, g.percentual_parte_qualitativa, g.situacao, g.versao,
    g.criado_em, g.alterado_em, g.observacao, g.motivo_encerramento, g.encerrado_em, e.codigo AS esfera,
    r.codigo AS rede, uc.login AS criado_login, ua.login AS alterado_login, ue.login AS encerrado_login
  FROM contrato_gestor_sus g
  JOIN dominio_contratualizacao_sus e ON e.id = g.esfera_dominio_contratualizacao_sus_id
  LEFT JOIN dominio_contratualizacao_sus r ON r.id = g.rede_assistencial_dominio_contratualizacao_sus_id
  LEFT JOIN usuario uc ON uc.id = g.criado_por
  LEFT JOIN usuario ua ON ua.id = g.alterado_por
  LEFT JOIN usuario ue ON ue.id = g.encerrado_por_usuario_id
 WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL`;

const SQL_META = `SELECT m.id, m.contrato_gestor_sus_id, m.tipo, m.descricao, m.periodicidade_meses, m.vigencia_inicio,
    m.vigencia_fim, m.pontos, m.nivel_sigtap, m.formato_resposta, m.sentido, m.unidade_medida, m.valor_meta, m.ativa,
    m.versao, m.criado_em, m.alterado_em, COALESCE(p.codigo_sigtap, gs.codigo_sigtap) AS codigo_sigtap,
    ds.codigo_sigtap AS modalidade, ti.codigo AS tipo_indicador, i.fonte AS afericao, cx.codigo AS complexidade,
    COALESCE(ua.login, uc.login) AS por_login
  FROM meta_contratual_sus m
  JOIN contrato_gestor_sus g ON g.id = m.contrato_gestor_sus_id
  LEFT JOIN procedimento_sigtap p ON p.id = m.procedimento_sigtap_id
  LEFT JOIN grupo_sigtap gs ON gs.id = m.grupo_sigtap_id
  LEFT JOIN dominio_sigtap ds ON ds.id = m.modalidade_dominio_sigtap_id
  LEFT JOIN indicador_contratual_sus i ON i.id = m.indicador_contratual_sus_id
  LEFT JOIN dominio_contratualizacao_sus ti ON ti.id = i.tipo_indicador_dominio_contratualizacao_sus_id
  LEFT JOIN dominio_contratualizacao_sus cx ON cx.id = m.complexidade_dominio_contratualizacao_sus_id
  LEFT JOIN usuario uc ON uc.id = m.criado_por
  LEFT JOIN usuario ua ON ua.id = m.alterado_por
 WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL AND m.excluido_em IS NULL`;

const SQL_APURACAO = `SELECT a.id, a.meta_contratual_sus_id, a.competencia_inicial, a.competencia_final, a.valor_meta,
    a.valor_alcancado, a.percentual_alcancado, a.observacao, a.origem_realizado, a.versao, a.apurada_em,
    a.alterado_em, m.tipo,
    es.codigo AS escore, COALESCE(ua.login, uc.login) AS por_login
  FROM afericao_meta_sus a
  JOIN meta_contratual_sus m ON m.id = a.meta_contratual_sus_id
  LEFT JOIN dominio_contratualizacao_sus es ON es.id = a.escore_dominio_contratualizacao_sus_id
  LEFT JOIN usuario uc ON uc.id = a.criado_por
  LEFT JOIN usuario ua ON ua.id = a.alterado_por
 WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

interface CadastroEstabelecimento {
  readonly cnes: string | null;
  readonly habilitacao: string | null;
  readonly habilitacaoValidade: string | null;
}

async function cadastroDoEstabelecimento(l: Leitor, est: number): Promise<CadastroEstabelecimento> {
  const e = await l.uma('SELECT codigo_cnes FROM estabelecimento WHERE id = ?', [est]);
  const h = await l.uma(
    `SELECT h.descricao, he.vigencia_fim FROM habilitacao_estabelecimento he
       JOIN habilitacao_sus h ON h.id = he.habilitacao_sus_id
      WHERE he.estabelecimento_id = ? AND he.excluido_em IS NULL
      ORDER BY (he.vigencia_fim IS NULL) DESC, he.vigencia_fim DESC, he.id DESC LIMIT 1`,
    [est],
  );
  return {
    cnes: txtOuNull(e?.['codigo_cnes']),
    habilitacao: h ? txtOuNull(h['descricao']) : null,
    habilitacaoValidade: h ? dataIso(h['vigencia_fim']) : null,
  };
}

async function incentivosDe(l: Leitor, contratos: readonly number[]): Promise<Map<number, IncentivoSus[]>> {
  const r = new Map<number, IncentivoSus[]>();
  if (contratos.length === 0) return r;
  const ls = await l.consultar(
    `SELECT contrato_gestor_sus_id, nome, valor_incentivo, vigencia_inicio, vigencia_fim FROM incentivo_contratual_sus
      WHERE contrato_gestor_sus_id IN (${marcas(contratos.length)}) ORDER BY contrato_gestor_sus_id, id`,
    [...contratos],
    { teto: 30 * contratos.length + 1 },
  );
  for (const x of ls) {
    const id = num(x['contrato_gestor_sus_id']);
    const lista = r.get(id) ?? [];
    lista.push({
      incentivo: null,
      nome: txt(x['nome']),
      valorMensalCentavos: centavos(x['valor_incentivo']),
      inicio: dataIso(x['vigencia_inicio']) ?? '',
      fim: dataIso(x['vigencia_fim']),
    });
    r.set(id, lista);
  }
  return r;
}

function contratoDe(x: Linha, incentivos: IncentivoSus[], cad: CadastroEstabelecimento): ContratoSus {
  const encerrado = txt(x['situacao']) === 'encerrado';
  const esfera = codigoDaTela('esfera', txt(x['esfera']));
  return {
    id: num(x['id']),
    numero: txt(x['numero_contrato']),
    esfera: (esfera ?? 0) as ContratoSus['esfera'],
    gestor: txt(x['gestor_nome']),
    objeto: txt(x['objeto']),
    inicio: dataIso(x['vigencia_inicio']) ?? '',
    fim: dataIso(x['vigencia_fim']) ?? '',
    cnes: cad.cnes,
    habilitacao: cad.habilitacao,
    habilitacaoValidade: cad.habilitacaoValidade,
    redeAssistencia: x['rede'] ? (codigoDaTela('rede_assistencial', txt(x['rede'])) ?? 0) : 0,
    valorPreMensalCentavos: centavos(x['valor_pre_fixado_mensal']),
    valorPosMensalCentavos: centavos(x['valor_pos_fixado_mensal']),
    parteQualitativaPct: Math.round(num(x['percentual_parte_qualitativa'])),
    incentivos,
    observacao: txtOuNull(x['observacao']),
    situacao: encerrado ? 'encerrado' : 'ativo',
    motivoEncerramento: encerrado ? txtOuNull(x['motivo_encerramento']) : null,
    encerradoPor: encerrado ? txtOuNull(x['encerrado_login']) : null,
    encerradoEm: encerrado ? instanteIso(x['encerrado_em']) : null,
    criadoPor: txt(x['criado_login']),
    criadoEm: instanteIso(x['criado_em']) ?? '',
    alteradoPor: txtOuNull(x['alterado_login']),
    alteradoEm: instanteIso(x['alterado_em']),
    versao: num(x['versao']),
  };
}

function metaDe(x: Linha): MetaSus {
  const quantitativa = txt(x['tipo']) === 'quantitativa';
  const afericao = txtOuNull(x['afericao']);
  return {
    id: num(x['id']),
    contrato: num(x['contrato_gestor_sus_id']),
    tipo: quantitativa ? 'quantitativa' : 'qualitativa',
    descricao: txt(x['descricao']),
    periodicidade: periodicidadeDosMeses(num(x['periodicidade_meses'])) ?? num(x['periodicidade_meses']),
    inicio: competenciaDe(dataIso(x['vigencia_inicio'])) ?? '',
    fim: competenciaDe(dataIso(x['vigencia_fim'])),
    pontos: num(x['pontos']),
    nivelSigtap: x['nivel_sigtap'] ? (NIVEL_DO_BANCO[txt(x['nivel_sigtap'])] ?? null) : null,
    codigoSigtap: txtOuNull(x['codigo_sigtap']),
    modalidade: quantitativa
      ? txt(x['modalidade']) === MODALIDADE_SIGTAP.ambulatorial
        ? 'ambulatorial'
        : txt(x['modalidade']) === MODALIDADE_SIGTAP.hospitalar
          ? 'hospitalar'
          : 'todas'
      : null,
    complexidade: x['complexidade'] ? codigoDaTela('complexidade', txt(x['complexidade'])) : null,
    indicador: x['tipo_indicador'] ? codigoDaTela('tipo_indicador', txt(x['tipo_indicador'])) : null,
    formato: x['formato_resposta'] ? (FORMATO_DO_BANCO[txt(x['formato_resposta'])] ?? null) : null,
    sentido: x['sentido'] === 'maior' || x['sentido'] === 'menor' ? x['sentido'] : null,
    unidade: txtOuNull(x['unidade_medida']),
    afericao: afericao ? codigoDaTela('tipo_afericao', afericao) : null,
    valorMeta: num(x['valor_meta']),
    ativa: bool(x['ativa']),
    por: txt(x['por_login']),
    em: instanteIso(x['alterado_em'] ?? x['criado_em']) ?? '',
    versao: num(x['versao']),
  };
}

function apuracaoDe(x: Linha): ApuracaoSus {
  return {
    id: num(x['id']),
    meta: num(x['meta_contratual_sus_id']),
    competencia: txt(x['competencia_final']),
    inicioPeriodo: txt(x['competencia_inicial']),
    metaPeriodo: num(x['valor_meta']),
    realizado: num(x['valor_alcancado']),
    cumprimentoPct: num(x['percentual_alcancado']),
    escore: (codigoDaTela('escore', txt(x['escore'])) ?? 1) as EscoreSus,
    // A apuração gravada antes da coluna não tem a origem: a qualitativa é informada; a quantitativa, do faturamento SUS.
    origem:
      ORIGEM_REALIZADO_DO_BANCO[txt(x['origem_realizado'])] ??
      (txt(x['tipo']) === 'qualitativa' ? 'informado' : 'faturamento-sus'),
    observacao: txtOuNull(x['observacao']),
    por: txt(x['por_login']),
    em: instanteIso(x['alterado_em'] ?? x['apurada_em']) ?? '',
    versao: num(x['versao']),
  };
}

const ordemContratos = "ORDER BY (g.situacao = 'encerrado'), g.vigencia_fim DESC, g.id DESC";
const ordemMetas = 'ORDER BY m.ativa DESC, m.tipo, m.id';

// ── Leituras comuns (porta e gravador) ───────────────────────────────────────────────────────────────────────────

async function lerContratos(
  l: Leitor,
  est: number,
  extra: string,
  p: unknown[],
  teto: number,
  travar = false,
) {
  const sql = `${SQL_CONTRATO}${extra}`;
  const ls = travar
    ? await (l as Escritor).consultarParaAtualizar(sql, [est, ...p], { teto })
    : await l.consultar(sql, [est, ...p], { teto });
  const inc = await incentivosDe(
    l,
    ls.map((x) => num(x['id'])),
  );
  const cad = await cadastroDoEstabelecimento(l, est);
  return ls.map((x) => contratoDe(x, inc.get(num(x['id'])) ?? [], cad));
}

async function lerMetas(l: Leitor, est: number, extra: string, p: unknown[], teto: number, travar = false) {
  const sql = `${SQL_META}${extra}`;
  const ls = travar
    ? await (l as Escritor).consultarParaAtualizar(sql, [est, ...p], { teto })
    : await l.consultar(sql, [est, ...p], { teto });
  return ls.map(metaDe);
}

async function lerApuracoes(
  l: Leitor,
  est: number,
  extra: string,
  p: unknown[],
  teto: number,
  travar = false,
) {
  const sql = `${SQL_APURACAO}${extra}`;
  const ls = travar
    ? await (l as Escritor).consultarParaAtualizar(sql, [est, ...p], { teto })
    : await l.consultar(sql, [est, ...p], { teto });
  return ls.map(apuracaoDe);
}

async function idDaLista(l: Leitor, lista: ListaDominioContratualizacao, codigo: string): Promise<number> {
  const r = await l.uma(
    'SELECT id FROM dominio_contratualizacao_sus WHERE lista = ? AND codigo = ? AND ativo',
    [lista, codigo],
  );
  if (!r)
    throw new ErroOperacao(
      503,
      'cadastro-incompleto',
      'Cadastro básico incompleto',
      `A lista "${lista}" da contratualização não tem o item "${codigo}" neste cliente: confira a carga das listas.`,
    );
  return num(r['id']);
}

async function idDaListaTela(
  l: Leitor,
  lista: ListaDominioContratualizacao,
  codigoTela: number,
): Promise<number> {
  const codigo = codigoNeutro(lista, codigoTela);
  if (!codigo) throw recusa('entrada-invalida', `Código ${codigoTela} fora da lista "${lista}".`);
  return idDaLista(l, lista, codigo);
}

/** O alvo SIGTAP da meta quantitativa: o procedimento (10 dígitos) ou o grupo, subgrupo ou forma vigente. */
async function alvoSigtap(
  l: Leitor,
  nivel: string,
  codigo: string,
): Promise<{ grupo_sigtap_id: number | null; procedimento_sigtap_id: number | null }> {
  if (nivel === 'procedimento') {
    const p = await l.uma('SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ?', [codigo]);
    if (!p) throw recusa('sigtap-inexistente', 'O código SIGTAP não existe na tabela unificada carregada.');
    return { grupo_sigtap_id: null, procedimento_sigtap_id: num(p['id']) };
  }
  const g = await l.uma(
    `SELECT id FROM grupo_sigtap WHERE nivel = ? AND codigo_sigtap = ? AND vigencia_fim IS NULL
      ORDER BY vigencia_inicio DESC LIMIT 1`,
    [NIVEL_DA_TELA[nivel] ?? nivel, codigo],
  );
  if (!g) throw recusa('sigtap-inexistente', 'O código SIGTAP não existe na tabela unificada carregada.');
  return { grupo_sigtap_id: num(g['id']), procedimento_sigtap_id: null };
}

async function modalidadeSigtap(l: Leitor, modalidade: string | null): Promise<number | null> {
  if (modalidade !== 'ambulatorial' && modalidade !== 'hospitalar') return null;
  const r = await l.uma(
    `SELECT id FROM dominio_sigtap WHERE lista = 'modalidade' AND codigo_sigtap = ?
      ORDER BY vigencia_inicio DESC LIMIT 1`,
    [MODALIDADE_SIGTAP[modalidade]],
  );
  if (!r)
    throw new ErroOperacao(
      503,
      'cadastro-incompleto',
      'Cadastro básico incompleto',
      'A lista de modalidades da tabela unificada não está carregada neste cliente.',
    );
  return num(r['id']);
}

// ── Gravador (dentro da operação) ────────────────────────────────────────────────────────────────────────────────

interface EstadoGravacao {
  motivo: string | null;
}

function valoresContrato(e: ContratoParaGravar['entrada']) {
  return {
    numero_contrato: e.numero,
    gestor_nome: e.gestor.slice(0, 150),
    objeto: e.objeto,
    vigencia_inicio: e.inicio,
    vigencia_fim: e.fim,
    valor_pre_fixado_mensal: reais(e.valorPreMensalCentavos),
    valor_pos_fixado_mensal: reais(e.valorPosMensalCentavos),
    percentual_parte_qualitativa: e.parteQualitativaPct,
    observacao: e.observacao ? e.observacao.slice(0, 500) : null,
  };
}

async function gravarIncentivos(
  tx: TxOperacao,
  est: number,
  contrato: number,
  incentivos: ContratoParaGravar['entrada']['incentivos'],
): Promise<void> {
  await tx.executar('DELETE FROM incentivo_contratual_sus WHERE contrato_gestor_sus_id = ?', [contrato]);
  for (const [i, x] of incentivos.entries())
    await tx.incluir('incentivo_contratual_sus', {
      estabelecimento_id: est,
      contrato_gestor_sus_id: contrato,
      codigo: `C${contrato}-${i + 1}`,
      nome: x.nome.slice(0, 150),
      valor_incentivo: reais(x.valorMensalCentavos),
      vigencia_inicio: x.inicio,
      vigencia_fim: x.fim,
    });
}

async function valoresMeta(tx: TxOperacao, e: MetaParaGravar['entrada']) {
  const meses = mesesDaPeriodicidade(e.periodicidade);
  if (meses === null)
    throw recusa('periodicidade-invalida', 'Escolha uma periodicidade mensal ou maior.', {
      campos: ['periodicidade'],
    });
  const quantitativa = e.tipo === 'quantitativa';
  const sigtap =
    quantitativa && e.nivelSigtap && e.codigoSigtap
      ? await alvoSigtap(tx, e.nivelSigtap, e.codigoSigtap)
      : { grupo_sigtap_id: null, procedimento_sigtap_id: null };
  return {
    tipo: e.tipo,
    descricao: e.descricao.slice(0, 200),
    periodicidade_meses: meses,
    vigencia_inicio: primeiroDia(e.inicio),
    vigencia_fim: e.fim ? ultimoDia(e.fim) : null,
    pontos: e.pontos,
    nivel_sigtap: quantitativa && e.nivelSigtap ? (NIVEL_DA_TELA[e.nivelSigtap] ?? null) : null,
    ...sigtap,
    modalidade_dominio_sigtap_id: quantitativa ? await modalidadeSigtap(tx, e.modalidade) : null,
    complexidade_dominio_contratualizacao_sus_id:
      e.complexidade !== null ? await idDaListaTela(tx, 'complexidade', e.complexidade) : null,
    formato_resposta: !quantitativa && e.formato !== null ? (FORMATO_DA_TELA[e.formato] ?? null) : null,
    sentido: quantitativa ? null : e.sentido,
    unidade_medida: e.unidade ? e.unidade.slice(0, 20) : null,
    fonte_afericao: quantitativa
      ? 'producao'
      : e.afericao !== null
        ? (FONTE_AFERICAO_DA_TELA[e.afericao] ?? null)
        : null,
    valor_meta: e.valorMeta,
    ativa: e.ativa,
  };
}

/** O indicador da meta qualitativa (um por meta): tipo, sentido, unidade e a fonte da aferição escolhida. */
async function valoresIndicador(tx: TxOperacao, e: MetaParaGravar['entrada']) {
  return {
    nome: e.descricao.slice(0, 150),
    tipo_indicador_dominio_contratualizacao_sus_id: await idDaListaTela(
      tx,
      'tipo_indicador',
      e.indicador ?? 0,
    ),
    unidade_medida: e.unidade ? e.unidade.slice(0, 30) : null,
    sentido: e.sentido,
    fonte: e.afericao !== null ? codigoNeutro('tipo_afericao', e.afericao) : null,
  };
}

/**
 * A operação de inclusão de cada registro com a chave do pedido (Idempotency-Key): a inclusão guarda a chave em
 * idempotencia_operacao na mesma transação, e o reenvio da mesma chave acha o registro original (`*PelaChave`).
 * A chave única (operação, chave) do banco impede a segunda inclusão mesmo em reenvio simultâneo (409).
 */
const OPERACAO_DA_CHAVE = {
  contrato: 'contratualizacao.contrato.incluir',
  meta: 'contratualizacao.meta.incluir',
  apuracao: 'contratualizacao.apuracao.registrar',
} as const;
type RegistroComChave = keyof typeof OPERACAO_DA_CHAVE;

async function idPelaChave(
  tx: TxOperacao,
  tipo: RegistroComChave,
  chave: string,
  usuario: number | null,
): Promise<number | null> {
  const r = await lerIdempotencia(tx, OPERACAO_DA_CHAVE[tipo], chave);
  if (!r) return null;
  // A mesma chave usada por outra pessoa não devolve o registro de quem gravou.
  if (r.usuario !== usuario) throw erroIdempotenciaDivergente();
  const id = Number(r.resultado['id']);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function guardarChave(
  tx: TxOperacao,
  tipo: RegistroComChave,
  chave: string,
  est: number,
  usuario: number | null,
  id: number,
): Promise<void> {
  const operacao = OPERACAO_DA_CHAVE[tipo];
  await gravarIdempotencia(tx, {
    operacao,
    chave,
    estabelecimento: est,
    usuario,
    hashEntrada: hashEntrada(operacao, { id }),
    resultado: { id },
    trilha: null,
    agora: new Date(),
  });
}

function gravadorSobre(
  tx: TxOperacao,
  est: number,
  estado: EstadoGravacao,
  usuario: number | null,
): GravadorContratualizacao {
  const contrato = async (id: number) =>
    (await lerContratos(tx, est, ' AND g.id = ?', [id], 1, true))[0] ?? null;
  const meta = async (id: number) => (await lerMetas(tx, est, ' AND m.id = ?', [id], 1, true))[0] ?? null;
  return {
    relogio: async () =>
      relogioContratualizacao(
        txtOuNull(
          (await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]))?.['fuso_horario'],
        ),
      ),
    contrato,
    contratoPelaChave: async (chave) => {
      const id = await idPelaChave(tx, 'contrato', chave, usuario);
      return id === null ? null : contrato(id);
    },
    numeroEmUso: async (numero, excetoId) =>
      (await tx.uma(
        'SELECT id FROM contrato_gestor_sus WHERE estabelecimento_id = ? AND numero_contrato = ? AND id <> ?',
        [est, numero, excetoId ?? 0],
      )) !== null,
    metas: (id) => lerMetas(tx, est, ` AND m.contrato_gestor_sus_id = ? ${ordemMetas}`, [id], TETO_METAS),
    meta,
    metaPelaChave: async (chave) => {
      const id = await idPelaChave(tx, 'meta', chave, usuario);
      return id === null ? null : meta(id);
    },
    apuracao: async (m, competencia) =>
      (
        await lerApuracoes(
          tx,
          est,
          ' AND a.meta_contratual_sus_id = ? AND a.competencia_final = ?',
          [m, competencia],
          1,
          true,
        )
      )[0] ?? null,
    apuracaoPelaChave: async (chave) => {
      const id = await idPelaChave(tx, 'apuracao', chave, usuario);
      return id === null ? null : ((await lerApuracoes(tx, est, ' AND a.id = ?', [id], 1, true))[0] ?? null);
    },
    async incluirContrato(c) {
      const id = await tx.incluir('contrato_gestor_sus', {
        estabelecimento_id: est,
        ...valoresContrato(c.entrada),
        esfera_dominio_contratualizacao_sus_id: await idDaListaTela(tx, 'esfera', c.entrada.esfera),
        rede_assistencial_dominio_contratualizacao_sus_id: c.entrada.redeAssistencia
          ? await idDaListaTela(tx, 'rede_assistencial', c.entrada.redeAssistencia)
          : null,
        situacao: 'vigente',
      });
      await gravarIncentivos(tx, est, id, c.entrada.incentivos);
      await guardarChave(tx, 'contrato', c.chave, est, usuario, id);
      return { id, versao: 1 };
    },
    async alterarContrato(c) {
      const versao = await tx.alterar('contrato_gestor_sus', c.id, c.versaoVista, {
        ...valoresContrato(c.entrada),
        esfera_dominio_contratualizacao_sus_id: await idDaListaTela(tx, 'esfera', c.entrada.esfera),
        rede_assistencial_dominio_contratualizacao_sus_id: c.entrada.redeAssistencia
          ? await idDaListaTela(tx, 'rede_assistencial', c.entrada.redeAssistencia)
          : null,
      });
      await gravarIncentivos(tx, est, c.id, c.entrada.incentivos);
      return { id: c.id, versao };
    },
    async encerrarContrato(c) {
      estado.motivo = c.motivo.slice(0, 300);
      // O CHECK ck_contrato_gestor_sus_encerramento exige o instante e o motivo no contrato encerrado.
      const versao = await tx.alterar('contrato_gestor_sus', c.id, c.versaoVista, {
        situacao: 'encerrado',
        motivo_encerramento: estado.motivo,
        encerrado_em: new Date(),
        encerrado_por_usuario_id: usuario,
      });
      return { id: c.id, versao };
    },
    async incluirMeta(m) {
      const seq = await tx.uma<{ n: unknown }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM meta_contratual_sus WHERE contrato_gestor_sus_id = ?',
        [m.contrato],
      );
      const sequencia = num(seq?.n ?? 1);
      const indicador =
        m.entrada.tipo === 'qualitativa'
          ? await tx.incluir('indicador_contratual_sus', {
              estabelecimento_id: est,
              contrato_gestor_sus_id: m.contrato,
              codigo: `M${m.contrato}-${sequencia}`,
              ...(await valoresIndicador(tx, m.entrada)),
            })
          : null;
      const id = await tx.incluir('meta_contratual_sus', {
        contrato_gestor_sus_id: m.contrato,
        sequencia,
        ...(await valoresMeta(tx, m.entrada)),
        indicador_contratual_sus_id: indicador,
      });
      await guardarChave(tx, 'meta', m.chave, est, usuario, id);
      return { id, versao: 1 };
    },
    async alterarMeta(m) {
      const atual = await tx.uma(
        `SELECT i.id, i.versao FROM meta_contratual_sus x
           JOIN indicador_contratual_sus i ON i.id = x.indicador_contratual_sus_id WHERE x.id = ?`,
        [m.id],
      );
      if (atual)
        await tx.alterar(
          'indicador_contratual_sus',
          num(atual['id']),
          num(atual['versao']),
          await valoresIndicador(tx, m.entrada),
        );
      const versao = await tx.alterar(
        'meta_contratual_sus',
        m.id,
        m.versaoVista,
        await valoresMeta(tx, m.entrada),
      );
      return { id: m.id, versao };
    },
    async registrarApuracao(a) {
      const id = await tx.incluir('afericao_meta_sus', {
        estabelecimento_id: est,
        meta_contratual_sus_id: a.meta,
        ...(await valoresApuracao(tx, a)),
        situacao: 'apurada',
        apurada_em: new Date(),
      });
      await guardarChave(tx, 'apuracao', a.chave, est, usuario, id);
      return { id, versao: 1 };
    },
    async corrigirApuracao(a) {
      const versao = await tx.alterar('afericao_meta_sus', a.id, a.versaoVista, {
        ...(await valoresApuracao(tx, a)),
        apurada_em: new Date(),
      });
      return { id: a.id, versao };
    },
  };
}

async function valoresApuracao(tx: TxOperacao, a: ApuracaoParaGravar) {
  return {
    competencia_inicial: a.inicioPeriodo,
    competencia_final: a.competencia,
    valor_meta: a.metaPeriodo,
    valor_alcancado: a.realizado,
    percentual_alcancado: a.cumprimentoPct,
    escore_dominio_contratualizacao_sus_id: await idDaListaTela(tx, 'escore', a.escore),
    origem_realizado: ORIGEM_REALIZADO_DO_CONTRATO[a.origem],
    observacao: a.observacao,
  };
}

// ── A porta ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaContratualizacaoPropria implements PortaContratualizacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoContratualizacao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18, est: number | null): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'contratualizacao',
    };
  }

  /** O estabelecimento da sessão (pelo id; sem o mapa, pelo código da sessão). Sem ele, nada é lido. */
  private async estabelecimento(c: ContextoPortaM18): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const codigo = (c as ContextoPortaM18 & { hospital?: string }).hospital;
    if (codigo) {
      const r = await this.nucleo.lerSomente(this.contexto(c, null), (l) =>
        l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [codigo]),
      );
      if (r) return num(r['id']);
    }
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  }

  private async ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string | null> {
    return txtOuNull(
      (await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]))?.['fuso_horario'],
    );
  }

  // ── Gravação ──

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR };
  }

  executar(): Promise<never> {
    return Promise.reject(new Error(SEM_EXECUTOR));
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorContratualizacao) => Promise<T>,
  ): Promise<T> {
    const est = await this.estabelecimento(c);
    let saida: { valor: T } | null = null;
    const estado: EstadoGravacao = { motivo: null };
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'contratualizacao.gravacao',
      tabelas: [...TABELAS_CONTRATUALIZACAO, 'idempotencia_operacao'],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx, _entrada, ctxOp) {
        saida = { valor: await fn(gravadorSobre(tx, est, estado, ctxOp.usuario ?? null)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'contrato_gestor_sus', id: l?.entidadeId ?? null };
      },
      trilha: () => ({
        dados: linha()?.dadosDepois ?? null,
        motivo: estado.motivo ?? linha()?.motivo ?? null,
      }),
    });
    // Cada chamada é uma execução nova do Executor (a trilha e o outbox são desta execução); a idempotência do pedido
    // é a da chave recebida, guardada pela inclusão (guardarChave) e conferida pelos *PelaChave na mesma transação.
    const chave = `contratualizacao:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação da contratualização sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──

  relogio(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) => relogioContratualizacao(await this.fuso(l, est)));
  }

  dominios(c: ContextoPortaM18): Promise<DominiosContratualizacao> {
    // As listas são do produto inteiro (a mesma tabela para toda a rede do cliente), sem estabelecimento.
    return this.ler(c, async (l, est) => {
      const out = Object.fromEntries(
        LISTAS_DOMINIO_CONTRATUALIZACAO.map((k) => [k, []]),
      ) as unknown as DominiosContratualizacao;
      const ls = await l.consultar(
        'SELECT id, lista, codigo, descricao, sigla FROM dominio_contratualizacao_sus WHERE ativo ORDER BY lista, ordem, id',
        [],
        { teto: 2_000 },
      );
      for (const x of ls) {
        const lista = txt(x['lista']) as ListaDominioContratualizacao;
        if (!(lista in out)) continue;
        const tela = codigoDaTela(lista, txt(x['codigo']));
        const semVocabulario = lista === 'tipo_dado';
        if (tela === null && !semVocabulario) continue;
        out[lista].push({
          codigo: tela ?? num(x['id']),
          nome: txt(x['descricao']),
          sigla: txtOuNull(x['sigla']),
        });
      }
      const inc = await l.consultar(
        `SELECT id, nome FROM incentivo_contratual_sus
          WHERE estabelecimento_id = ? AND contrato_gestor_sus_id IS NULL AND ativo ORDER BY nome, id`,
        [est],
        { teto: 1_000 },
      );
      out.incentivo.push(...inc.map((x) => ({ codigo: num(x['id']), nome: txt(x['nome']), sigla: null })));
      return out;
    });
  }

  contratos(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) => {
      const itens = await lerContratos(
        l,
        est,
        ` ${ordemContratos} LIMIT ${TETO_CONTRATOS + 1}`,
        [],
        TETO_CONTRATOS + 1,
      );
      return { itens: itens.slice(0, TETO_CONTRATOS), cortada: itens.length > TETO_CONTRATOS };
    });
  }

  contrato(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => (await lerContratos(l, est, ' AND g.id = ?', [id], 1))[0] ?? null);
  }

  metas(c: ContextoPortaM18, contrato: number) {
    return this.ler(c, (l, est) =>
      lerMetas(l, est, ` AND m.contrato_gestor_sus_id = ? ${ordemMetas}`, [contrato], TETO_METAS),
    );
  }

  meta(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => (await lerMetas(l, est, ' AND m.id = ?', [id], 1))[0] ?? null);
  }

  apuracoes(c: ContextoPortaM18, metas: readonly number[]) {
    if (metas.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) =>
      lerApuracoes(
        l,
        est,
        ` AND a.meta_contratual_sus_id IN (${marcas(metas.length)}) ORDER BY a.meta_contratual_sus_id, a.competencia_final DESC`,
        [...metas],
        TETO_APURACOES,
      ),
    );
  }

  sigtapExiste(c: ContextoPortaM18, prefixo: string) {
    if (!/^\d{2,10}$/.test(prefixo)) return Promise.resolve(false);
    // Catálogo público (tabela unificada): da rede inteira, sem estabelecimento.
    return this.ler(c, async (l) => {
      const p = await l.uma(
        "SELECT id FROM procedimento_sigtap WHERE codigo_sigtap LIKE CONCAT(?, '%') AND ativo LIMIT 1",
        [prefixo],
      );
      if (p) return true;
      return (
        (await l.uma('SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? AND vigencia_fim IS NULL LIMIT 1', [
          prefixo,
        ])) !== null
      );
    });
  }

  buscarSigtap(c: ContextoPortaM18, termo: string) {
    const t = termo.trim();
    const digitos = t.replace(/\D/g, '');
    return this.ler(c, async (l) => {
      const ls =
        digitos.length >= 2 && digitos.length === t.replace(/[\s.-]/g, '').length
          ? await l.consultar(
              `SELECT codigo_sigtap, descricao FROM procedimento_sigtap WHERE codigo_sigtap LIKE CONCAT(?, '%') AND ativo
                ORDER BY codigo_sigtap LIMIT 50`,
              [digitos],
              { teto: 50 },
            )
          : await l.consultar(
              `SELECT codigo_sigtap, descricao FROM procedimento_sigtap WHERE descricao LIKE CONCAT('%', ?, '%') AND ativo
                ORDER BY descricao LIMIT 50`,
              [t.replace(/[%_\\]/g, '')],
              { teto: 50 },
            );
      return ls.map((x) => ({ codigo: txt(x['codigo_sigtap']), nome: txt(x['descricao']) }));
    });
  }

  producaoFaturamentoSus(c: ContextoPortaM18, de: string, ate: string): Promise<ProducaoSigtapSus[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT cs.competencia, 'ambulatorial' AS modalidade, p.codigo_sigtap, SUM(i.quantidade) AS quantidade
           FROM producao_ambulatorial_sus f
           JOIN competencia_sus cs ON cs.id = f.competencia_sus_id
           JOIN producao_ambulatorial_sus_item i ON i.producao_ambulatorial_sus_id = f.id AND i.excluido_em IS NULL
           JOIN procedimento_sigtap p ON p.id = i.procedimento_sigtap_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao NOT IN ('cancelada','rejeitada')
            AND cs.competencia BETWEEN ? AND ?
          GROUP BY cs.competencia, p.codigo_sigtap
         UNION ALL
         SELECT cs.competencia, 'hospitalar' AS modalidade, p.codigo_sigtap, SUM(ap.quantidade) AS quantidade
           FROM conta_aih a
           JOIN competencia_sus cs ON cs.id = a.competencia_sus_id
           JOIN conta_aih_procedimento ap ON ap.conta_aih_id = a.id AND ap.excluido_em IS NULL
           JOIN procedimento_sigtap p ON p.id = ap.procedimento_sigtap_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.situacao IN ('fechada','apresentada','aprovada')
            AND cs.competencia BETWEEN ? AND ?
          GROUP BY cs.competencia, p.codigo_sigtap`,
        [est, de, ate, est, de, ate],
        { teto: TETO_PRODUCAO },
      );
      return ls.map((x) => ({
        competencia: txt(x['competencia']),
        modalidade: txt(x['modalidade']) === 'hospitalar' ? 'hospitalar' : 'ambulatorial',
        codigo: txt(x['codigo_sigtap']),
        quantidade: Math.round(num(x['quantidade'])),
      }));
    });
  }

  /**
   * A produção das contas SUS de convênio de UMA competência: os itens das contas hospitalares (não canceladas) das
   * fontes pagadoras do parâmetro, pela equivalência vigente do item faturável com a SIGTAP na data do item. A conta de
   * internação conta como hospitalar; as demais naturezas, como ambulatorial. Item estornado ou transferido não conta.
   * Os convênios do parâmetro são CÓDIGOS de negócio da fonte pagadora (nunca o id): o filtro casa `fonte_pagadora.codigo`
   * como texto, sem os zeros à esquerda (o parâmetro chega como número).
   */
  producaoContasSus(
    c: ContextoPortaM18,
    competencia: string,
    convenios: readonly number[],
  ): Promise<ProducaoSigtapSus[]> {
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(competencia))
      return Promise.reject(recusa('entrada-invalida', 'Competência AAAAMM.'));
    if (convenios.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT IF(ch.natureza = 'internacao', 'hospitalar', 'ambulatorial') AS modalidade, p.codigo_sigtap,
                SUM(i.quantidade) AS quantidade
           FROM conta_hospitalar ch
           JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
           JOIN conta_hospitalar_item i ON i.conta_hospitalar_id = ch.id AND i.excluido_em IS NULL
                AND i.situacao NOT IN ('estornado','transferido')
           JOIN equivalencia_sigtap_item q ON q.item_faturavel_id = i.item_faturavel_id AND q.excluido_em IS NULL
                AND q.vigencia_inicio <= DATE(i.realizado_em)
                AND (q.vigencia_fim IS NULL OR q.vigencia_fim >= DATE(i.realizado_em))
           JOIN procedimento_sigtap p ON p.id = q.procedimento_sigtap_id
          WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL AND ch.situacao <> 'cancelada'
            AND ch.competencia = ? AND TRIM(LEADING '0' FROM fp.codigo) IN (${marcas(convenios.length)})
          GROUP BY modalidade, p.codigo_sigtap`,
        [est, primeiroDia(competencia), ...convenios.map((x) => String(x))],
        { teto: TETO_PRODUCAO },
      );
      return ls.map((x) => ({
        competencia,
        modalidade: txt(x['modalidade']) === 'hospitalar' ? 'hospitalar' : 'ambulatorial',
        codigo: txt(x['codigo_sigtap']),
        quantidade: Math.round(num(x['quantidade'])),
      }));
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaContratualizacaoIndisponivel(): PortaContratualizacao {
  return portaIndisponivel<PortaContratualizacao>(METODOS_PORTA_CONTRATUALIZACAO);
}
