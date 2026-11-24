// Leituras do cálculo da folha sobre o MariaDB do cliente (modulos-proprios-2, família folha-porta): o processamento da
// folha e as linhas, o histórico das folhas mensais, os itens por rubrica, as férias, as rescisões e os parâmetros das
// obrigações. Mesma especificação da porta de memória (porta-calculo-memoria.ts): filtros, ordenação e somas.
// Tabelas lidas (somente leitura, filtradas pelo estabelecimento da sessão): processamento_folha,
// processamento_folha_linha (com a migração 15_RH/93_folha_calculo), rubrica, programacao_ferias, periodo_aquisitivo,
// recibo_ferias, rescisao, desligamento, parametro_obrigacao e usuario.
// As funções `lerX(l, est, ...)` recebem o leitor: o gravador do cálculo as usa na própria transação (releitura depois da
// trava); a classe as abre numa transação curta somente leitura.
// Formato gravado (o gravador segue o mesmo):
//   - processamento_folha.tipo: `decimo1`/`decimo2` do contrato são `decimo_terceiro_1`/`decimo_terceiro_2`; a
//     competência é o primeiro dia do mês; calculado por/em = criado_por/criado_em; a troca de situação grava
//     alterado_por/alterado_em (situação por/em, null enquanto `calculada`);
//   - programacao_ferias: situação do banco `programada`/`aprovada` = programada, `calculada`/`em_gozo`/`gozada` =
//     calculada; o processamento é o do recibo_ferias vigente (não cancelado) da programação;
//   - rescisao: só as que têm processamento (as do cálculo); modalidade e aviso com sublinhado no banco e hífen no contrato;
//     `conferida`, `paga` e `homologada` (vindas de outra origem) leem como `calculada` (a que vale no vínculo), com a
//     situação por/em de quem as levou a esse estado;
//   - ENCERRADAS: a rescisão conferida, paga ou homologada e as férias em gozo ou gozadas não se cancelam nem se
//     recalculam. A leitura as mostra como `calculada`, e o gravador chama `exigirRescisaoAlteravel` e
//     `exigirFeriasAlteravel` (na mesma transação, com trava) antes de trocar a situação;
//   - rubrica.codigo: o contrato leva o código numérico da rubrica; código com letra ou zero à esquerda recusa a leitura
//     (409 `rubrica-codigo-invalido`), nunca some em silêncio;
//   - parametro_obrigacao: a vigência é o primeiro dia da competência; `dados` é o JSON do contrato sem empresa e início,
//     validado pelo esquema do contrato na leitura (inválido: 409 `parametros-obrigacoes-invalidos`).
import {
  esquemaParametrosObrigacoes,
  type ParametrosObrigacoesLidos,
  type SituacaoFerias,
  type SituacaoRescisao,
} from '@sgh/contratos';
import { type ContextoNucleo, type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import type { ContextoCalculoFolha } from './porta-calculo.js';
import {
  type FeriasDoVinculo,
  type FeriasNaCompetencia,
  type FiltroFeriasDaFolha,
  type FiltroProcessosDaFolha,
  type FiltroRescisoesDaFolha,
  type HistoricoDaFolha,
  type ItemRubricaDoProcesso,
  type LinhaCalculoDoVinculo,
  PAPEIS_HISTORICO_FOLHA,
  type ProcessoDaFolha,
  type RescisaoDaFolha,
  type ResumoVinculoDoProcesso,
} from './tipos-folha.js';

type LeitorFolha = Pick<Leitor, 'consultar' | 'uma'>;
type Linha = Record<string, unknown>;
type TipoProcesso = ProcessoDaFolha['tipo'];

const n = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const d2 = (x: number) => String(x).padStart(2, '0');
const centavos = (x: number) => Math.round(x * 100) / 100;

/** DATE do banco em ISO (AAAA-MM-DD): o driver entrega Date à meia-noite local ou texto. */
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${d2(v.getMonth() + 1)}-${d2(v.getDate())}`;
  return String(v).slice(0, 10);
}
const diaObrigatorio = (v: unknown): string => dia(v) ?? '';
const competenciaDe = (v: unknown): string => diaObrigatorio(v).slice(0, 7);
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : texto(v));
const instanteOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : instante(v));
/** Competência AAAA-MM do contrato no primeiro dia do mês do banco. */
export const competenciaNoBanco = (competencia: string): string => `${competencia}-01`;
/** JSON do banco (o driver entrega objeto ou texto); `undefined` quando não é JSON de objeto. */
const objetoJson = (v: unknown): Record<string, unknown> | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const x: unknown = JSON.parse(String(v));
    return x !== null && typeof x === 'object' && !Array.isArray(x)
      ? (x as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');

// ── Processamento ────────────────────────────────────────────────────────────────────────────────────────────

const TIPO_NO_BANCO: Readonly<Record<TipoProcesso, string>> = {
  mensal: 'mensal',
  ferias: 'ferias',
  decimo1: 'decimo_terceiro_1',
  decimo2: 'decimo_terceiro_2',
  rescisao: 'rescisao',
};
const TIPO_DO_BANCO: Readonly<Record<string, TipoProcesso>> = Object.fromEntries(
  Object.entries(TIPO_NO_BANCO).map(([k, v]) => [v, k as TipoProcesso]),
);
/** O tipo do processamento do contrato como o banco grava. */
export const tipoProcessoNoBanco = (tipo: TipoProcesso): string => TIPO_NO_BANCO[tipo];

const SQL_PROCESSOS = `
  SELECT p.id, p.estabelecimento_id, p.competencia, p.tipo, p.numero, p.situacao, p.pagamento_em, p.totais,
         p.quantidade_fora_da_folha, p.tabela_legal_inicio, p.parametros_inicio, p.resumo, p.motivo, p.criado_em,
         p.alterado_em, p.versao, uc.login AS calculado_login, ua.login AS situacao_login
    FROM processamento_folha p
    LEFT JOIN usuario uc ON uc.id = p.criado_por
    LEFT JOIN usuario ua ON ua.id = p.alterado_por
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

function processoDe(r: Linha): ProcessoDaFolha {
  const situacao = texto(r['situacao']) as ProcessoDaFolha['situacao'];
  const trocada = situacao !== 'calculada';
  return {
    id: n(r['id']),
    empresa: n(r['estabelecimento_id']),
    competencia: competenciaDe(r['competencia']),
    tipo: TIPO_DO_BANCO[texto(r['tipo'])] ?? 'mensal',
    numero: n(r['numero']),
    situacao,
    pagamento: dia(r['pagamento_em']),
    totais: (objetoJson(r['totais']) ?? {}) as unknown as ProcessoDaFolha['totais'],
    foraDaFolha: n(r['quantidade_fora_da_folha']),
    tabelaLegal: diaObrigatorio(r['tabela_legal_inicio']),
    parametros: diaObrigatorio(r['parametros_inicio']),
    resumo: texto(r['resumo']),
    calculadoPor: texto(r['calculado_login']),
    calculadoEm: instante(r['criado_em']),
    situacaoPor: trocada ? textoOuNulo(r['situacao_login']) : null,
    situacaoEm: trocada ? instanteOuNulo(r['alterado_em']) : null,
    motivo: textoOuNulo(r['motivo']),
    versao: n(r['versao']),
  };
}

/** Processamentos do estabelecimento pelo filtro, da competência mais recente e do número maior primeiro. */
export async function lerProcessos(
  l: LeitorFolha,
  est: number,
  f: FiltroProcessosDaFolha,
): Promise<ProcessoDaFolha[]> {
  if (f.empresa !== undefined && f.empresa !== est) return [];
  const filtros: string[] = [];
  const p: unknown[] = [est];
  const se = (cond: string, ...v: unknown[]) => {
    filtros.push(cond);
    p.push(...v);
  };
  if (f.competencia !== undefined) se('p.competencia = ?', competenciaNoBanco(f.competencia));
  if (f.situacao !== undefined) se('p.situacao = ?', f.situacao);
  if (f.tipo !== undefined) se('p.tipo = ?', TIPO_NO_BANCO[f.tipo]);
  const fora = [...(f.semTipo !== undefined ? [f.semTipo] : []), ...(f.semTipos ?? [])].map(
    (t) => TIPO_NO_BANCO[t],
  );
  if (fora.length > 0) se(`p.tipo NOT IN (${marcas(fora)})`, ...fora);
  if (f.competenciaDe !== undefined) se('p.competencia >= ?', competenciaNoBanco(f.competenciaDe));
  if (f.competenciaAte !== undefined) se('p.competencia <= ?', competenciaNoBanco(f.competenciaAte));
  const rs = await l.consultar(
    `${SQL_PROCESSOS}${filtros.map((x) => ` AND ${x}`).join('')} ORDER BY p.competencia DESC, p.numero DESC, p.id DESC`,
    p,
  );
  return rs.map(processoDe);
}

export async function lerProcesso(l: LeitorFolha, est: number, id: number): Promise<ProcessoDaFolha | null> {
  const r = await l.uma(`${SQL_PROCESSOS} AND p.id = ?`, [est, id]);
  return r ? processoDe(r) : null;
}

/** Linhas do processamento (de um vínculo, ou de todos), na ordem gravada. */
export async function lerLinhas(
  l: LeitorFolha,
  est: number,
  processo: number,
  vinculo: number | null = null,
): Promise<LinhaCalculoDoVinculo[]> {
  const rs = await l.consultar(
    `SELECT l.vinculo_trabalho_id, l.papel, l.tipo, l.rubrica_id, r.codigo AS codigo_rubrica, l.quantidade, l.unidade,
            l.valor, l.memoria_calculo, l.centro_custo_id, l.dias_pagos
       FROM processamento_folha_linha l
       JOIN processamento_folha p ON p.id = l.processamento_folha_id
       LEFT JOIN rubrica r ON r.id = l.rubrica_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND l.processamento_folha_id = ?
            ${vinculo === null ? '' : 'AND l.vinculo_trabalho_id = ?'}
      ORDER BY l.id`,
    vinculo === null ? [est, processo] : [est, processo, vinculo],
  );
  return rs.map((r) => {
    const rubrica = numOuNulo(r['rubrica_id']);
    return {
      papel: texto(r['papel']) as LinhaCalculoDoVinculo['papel'],
      tipo: texto(r['tipo']) as LinhaCalculoDoVinculo['tipo'],
      rubrica,
      codigoRubrica: codigoRubricaDe(rubrica, r['codigo_rubrica']),
      quantidade: n(r['quantidade']),
      unidade: texto(r['unidade']) as LinhaCalculoDoVinculo['unidade'],
      valor: n(r['valor']),
      memoria: texto(r['memoria_calculo']),
      vinculo: n(r['vinculo_trabalho_id']),
      centroCusto: n(r['centro_custo_id']),
      diasPagos: n(r['dias_pagos']),
    };
  });
}

/**
 * O código numérico da rubrica no contrato (o mesmo que o cálculo usa). A linha sem rubrica não tem código; a rubrica
 * com código fora do formato (letra, zero à esquerda, vazio) recusa: descartá-la tiraria proventos e descontos dos itens
 * por rubrica, e `0010` virar `10` trocaria a identidade da rubrica.
 */
export function codigoRubricaDe(rubrica: number | null, codigo: unknown): number | null {
  if (rubrica === null) return null;
  const t = texto(codigo);
  if (!/^(0|[1-9]\d{0,8})$/.test(t))
    throw recusa(
      'rubrica-codigo-invalido',
      `A rubrica ${rubrica} tem código fora do formato do cálculo (só dígitos, sem zero à esquerda): corrija o cadastro da rubrica antes de ler o processamento.`,
      { campos: ['codigoRubrica'] },
    );
  return Number(t);
}

/** Os papéis somados no resumo por vínculo (os mesmos da porta de memória). */
export const PAPEIS_DO_RESUMO = [
  'baseInss',
  'baseIrrf',
  'baseFgts',
  'inss',
  'irrf',
  'fgts',
  'inssPatronal',
  'rat',
  'terceiros',
  'inssFerias',
  'irrfFerias',
  'inssDecimo',
  'irrfDecimo',
  'multaFgts',
] as const;

/** Resumo por vínculo (ordem do vínculo): proventos, descontos e a soma de cada papel do resumo, em centavos. */
export function resumirLinhas(linhas: readonly LinhaCalculoDoVinculo[]): ResumoVinculoDoProcesso[] {
  const por = new Map<number, LinhaCalculoDoVinculo[]>();
  for (const x of linhas) por.set(x.vinculo, [...(por.get(x.vinculo) ?? []), x]);
  const soma = (ls: readonly LinhaCalculoDoVinculo[], f: (x: LinhaCalculoDoVinculo) => boolean) =>
    centavos(ls.filter(f).reduce((s, x) => s + x.valor, 0));
  return [...por.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vinculo, ls]) => ({
      vinculo,
      centroCusto: ls[0]!.centroCusto,
      diasPagos: ls[0]!.diasPagos,
      proventos: soma(ls, (x) => x.tipo === 'provento'),
      descontos: soma(ls, (x) => x.tipo === 'desconto'),
      porPapel: Object.fromEntries(PAPEIS_DO_RESUMO.map((p) => [p, soma(ls, (x) => x.papel === p)])),
    }));
}

export async function lerResumoVinculos(
  l: LeitorFolha,
  est: number,
  processo: number,
): Promise<ResumoVinculoDoProcesso[]> {
  return resumirLinhas(await lerLinhas(l, est, processo));
}

// ── Férias ───────────────────────────────────────────────────────────────────────────────────────────────────

const FERIAS_NO_BANCO: Readonly<Record<SituacaoFerias, readonly string[]>> = {
  programada: ['programada', 'aprovada'],
  calculada: ['calculada', 'em_gozo', 'gozada'],
  cancelada: ['cancelada'],
};
/** Férias em gozo ou gozadas: leem como `calculada`, mas não se cancelam nem se recalculam. */
export const FERIAS_ENCERRADAS = ['em_gozo', 'gozada'] as const;
const situacaoFerias = (v: unknown): SituacaoFerias =>
  (Object.keys(FERIAS_NO_BANCO) as SituacaoFerias[]).find((k) => FERIAS_NO_BANCO[k].includes(texto(v))) ??
  'programada';

const SQL_FERIAS = `
  SELECT pf.id, pf.vinculo_trabalho_id, pf.estabelecimento_id, pa.inicio AS aquisitivo_inicio, pa.fim AS aquisitivo_fim,
         pf.inicio_gozo, pf.fim_gozo, pf.dias_gozo, pf.dias_abono, pf.dias_dobra, pf.adianta_decimo_terceiro,
         pf.pagamento_previsto_em, pf.situacao, pf.motivo_cancelamento, pf.criado_em, pf.alterado_em, pf.versao,
         uc.login AS registrado_login, ua.login AS situacao_login,
         (SELECT rf.processamento_folha_id FROM recibo_ferias rf
           WHERE rf.programacao_ferias_id = pf.id AND rf.excluido_em IS NULL AND rf.situacao <> 'cancelado'
             AND rf.processamento_folha_id IS NOT NULL
           ORDER BY rf.id DESC LIMIT 1) AS processo
    FROM programacao_ferias pf
    JOIN periodo_aquisitivo pa ON pa.id = pf.periodo_aquisitivo_id
    LEFT JOIN usuario uc ON uc.id = pf.criado_por
    LEFT JOIN usuario ua ON ua.id = pf.alterado_por
   WHERE pf.estabelecimento_id = ? AND pf.excluido_em IS NULL AND pf.vinculo_trabalho_id IS NOT NULL`;

function feriasDe(r: Linha): FeriasDoVinculo {
  const situacao = situacaoFerias(r['situacao']);
  const trocada = situacao !== 'programada';
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    empresa: n(r['estabelecimento_id']),
    aquisitivoInicio: diaObrigatorio(r['aquisitivo_inicio']),
    aquisitivoFim: diaObrigatorio(r['aquisitivo_fim']),
    inicio: diaObrigatorio(r['inicio_gozo']),
    fim: diaObrigatorio(r['fim_gozo']),
    dias: n(r['dias_gozo']),
    abono: n(r['dias_abono']),
    dobra: n(r['dias_dobra']),
    adiantarDecimo: n(r['adianta_decimo_terceiro']) === 1,
    pagamento: diaObrigatorio(r['pagamento_previsto_em']),
    situacao,
    processo: numOuNulo(r['processo']),
    motivo: textoOuNulo(r['motivo_cancelamento']),
    registradoPor: texto(r['registrado_login']),
    registradoEm: instante(r['criado_em']),
    situacaoPor: trocada ? textoOuNulo(r['situacao_login']) : null,
    situacaoEm: trocada ? instanteOuNulo(r['alterado_em']) : null,
    versao: n(r['versao']),
  };
}

/** Férias do estabelecimento pelo filtro: do vínculo, a mais recente primeiro; de todos, pela data do gozo. */
export async function lerFerias(
  l: LeitorFolha,
  est: number,
  f: FiltroFeriasDaFolha,
): Promise<FeriasDoVinculo[]> {
  if (f.empresa !== undefined && f.empresa !== est) return [];
  const filtros: string[] = [];
  const p: unknown[] = [est];
  if (f.vinculo !== undefined) {
    filtros.push('pf.vinculo_trabalho_id = ?');
    p.push(f.vinculo);
  }
  if (f.de !== undefined) {
    filtros.push('pf.fim_gozo >= ?');
    p.push(f.de);
  }
  if (f.ate !== undefined) {
    filtros.push('pf.inicio_gozo <= ?');
    p.push(f.ate);
  }
  if (f.situacao !== undefined) {
    const s = FERIAS_NO_BANCO[f.situacao];
    filtros.push(`pf.situacao IN (${marcas(s)})`);
    p.push(...s);
  }
  const ordem = f.vinculo !== undefined ? 'pf.inicio_gozo DESC, pf.id DESC' : 'pf.inicio_gozo, pf.id';
  const rs = await l.consultar(
    `${SQL_FERIAS}${filtros.map((x) => ` AND ${x}`).join('')} ORDER BY ${ordem}`,
    p,
  );
  return rs.map(feriasDe);
}

export async function lerFeriasPorId(
  l: LeitorFolha,
  est: number,
  id: number,
): Promise<FeriasDoVinculo | null> {
  const r = await l.uma(`${SQL_FERIAS} AND pf.id = ?`, [est, id]);
  return r ? feriasDe(r) : null;
}

/**
 * Recusa (409 `ferias-encerradas`) trocar a situação de férias em gozo ou gozadas. O gravador chama antes de cancelar ou
 * recalcular, com o leitor da transação (trava): a leitura mostra essas férias como `calculada`.
 */
export async function exigirFeriasAlteravel(l: LeitorFolha, est: number, id: number): Promise<void> {
  const r = await l.uma(
    'SELECT situacao FROM programacao_ferias WHERE estabelecimento_id = ? AND id = ? AND excluido_em IS NULL',
    [est, id],
  );
  if (r && (FERIAS_ENCERRADAS as readonly string[]).includes(texto(r['situacao'])))
    throw recusa(
      'ferias-encerradas',
      'Estas férias já estão em gozo ou gozadas: não podem ser canceladas nem recalculadas.',
    );
}

// ── Rescisão ─────────────────────────────────────────────────────────────────────────────────────────────────

const RESCISAO_NO_BANCO: Readonly<Record<SituacaoRescisao, readonly string[]>> = {
  calculada: ['calculada', 'conferida', 'paga', 'homologada'],
  substituida: ['substituida'],
  cancelada: ['cancelada'],
};
/** Rescisão conferida, paga ou homologada: lê como `calculada` (a que vale), mas não se cancela nem se recalcula. */
export const RESCISAO_ENCERRADA = ['conferida', 'paga', 'homologada'] as const;
const situacaoRescisao = (v: unknown): SituacaoRescisao =>
  (Object.keys(RESCISAO_NO_BANCO) as SituacaoRescisao[]).find((k) =>
    RESCISAO_NO_BANCO[k].includes(texto(v)),
  ) ?? 'calculada';
const hifen = (v: unknown) => texto(v).replace(/_/g, '-');

const SQL_RESCISOES = `
  SELECT r.id, d.vinculo_trabalho_id, r.estabelecimento_id, r.data_desligamento, r.tipo_rescisao_id, r.modalidade,
         r.aviso_previo, r.dias_aviso, r.dias_aviso_indenizados, r.data_projetada_aviso, r.termo_contrato, r.saldo_fgts,
         r.saldo_fgts_informado, r.valor_multa_fgts, r.pagamento_limite_em, r.situacao, r.processamento_folha_id,
         r.motivo_situacao, r.criado_em, r.alterado_em, r.versao, uc.login AS registrado_login,
         ua.login AS situacao_login
    FROM rescisao r
    JOIN desligamento d ON d.id = r.desligamento_id
    LEFT JOIN usuario uc ON uc.id = r.criado_por
    LEFT JOIN usuario ua ON ua.id = r.alterado_por
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.processamento_folha_id IS NOT NULL
     AND r.modalidade IS NOT NULL AND r.situacao <> 'simulacao'`;

function rescisaoDe(r: Linha): RescisaoDaFolha {
  const situacao = situacaoRescisao(r['situacao']);
  // A conferida, a paga e a homologada mostram quem as levou a esse estado.
  const trocada = texto(r['situacao']) !== 'calculada';
  const desligamento = diaObrigatorio(r['data_desligamento']);
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    empresa: n(r['estabelecimento_id']),
    desligamento,
    tipoRescisao: numOuNulo(r['tipo_rescisao_id']),
    modalidade: hifen(r['modalidade']) as RescisaoDaFolha['modalidade'],
    aviso: (r['aviso_previo'] === null || r['aviso_previo'] === undefined
      ? 'nenhum'
      : hifen(r['aviso_previo'])) as RescisaoDaFolha['aviso'],
    diasAviso: n(r['dias_aviso']),
    diasIndenizados: n(r['dias_aviso_indenizados']),
    projecao: dia(r['data_projetada_aviso']) ?? desligamento,
    termo: dia(r['termo_contrato']),
    saldoFgts: n(r['saldo_fgts']),
    saldoFgtsInformado: n(r['saldo_fgts_informado']) === 1,
    multaFgts: n(r['valor_multa_fgts']),
    pagamento: diaObrigatorio(r['pagamento_limite_em']),
    situacao,
    processo: n(r['processamento_folha_id']),
    motivo: textoOuNulo(r['motivo_situacao']),
    registradoPor: texto(r['registrado_login']),
    registradoEm: instante(r['criado_em']),
    situacaoPor: trocada ? textoOuNulo(r['situacao_login']) : null,
    situacaoEm: trocada ? instanteOuNulo(r['alterado_em']) : null,
    versao: n(r['versao']),
  };
}

/** Rescisões do cálculo pelo filtro, do desligamento mais recente primeiro. */
export async function lerRescisoes(
  l: LeitorFolha,
  est: number,
  f: FiltroRescisoesDaFolha,
): Promise<RescisaoDaFolha[]> {
  if (f.empresa !== undefined && f.empresa !== est) return [];
  const filtros: string[] = [];
  const p: unknown[] = [est];
  if (f.vinculo !== undefined) {
    filtros.push('d.vinculo_trabalho_id = ?');
    p.push(f.vinculo);
  }
  if (f.de !== undefined) {
    filtros.push('r.data_desligamento >= ?');
    p.push(f.de);
  }
  if (f.ate !== undefined) {
    filtros.push('r.data_desligamento <= ?');
    p.push(f.ate);
  }
  if (f.situacao !== undefined) {
    const s = RESCISAO_NO_BANCO[f.situacao];
    filtros.push(`r.situacao IN (${marcas(s)})`);
    p.push(...s);
  }
  const rs = await l.consultar(
    `${SQL_RESCISOES}${filtros.map((x) => ` AND ${x}`).join('')} ORDER BY r.data_desligamento DESC, r.id DESC`,
    p,
  );
  return rs.map(rescisaoDe);
}

export async function lerRescisaoPorId(
  l: LeitorFolha,
  est: number,
  id: number,
): Promise<RescisaoDaFolha | null> {
  const r = await l.uma(`${SQL_RESCISOES} AND r.id = ?`, [est, id]);
  return r ? rescisaoDe(r) : null;
}

/**
 * Recusa (409 `rescisao-encerrada`) trocar a situação da rescisão conferida, paga ou homologada (cancelar ou substituir
 * por um recálculo). O gravador chama antes de trocar a situação, com o leitor da transação (trava).
 */
export async function exigirRescisaoAlteravel(l: LeitorFolha, est: number, id: number): Promise<void> {
  const r = await l.uma(
    'SELECT situacao FROM rescisao WHERE estabelecimento_id = ? AND id = ? AND excluido_em IS NULL',
    [est, id],
  );
  if (r && (RESCISAO_ENCERRADA as readonly string[]).includes(texto(r['situacao'])))
    throw recusa(
      'rescisao-encerrada',
      'Esta rescisão já foi conferida, paga ou homologada: não pode ser cancelada nem recalculada.',
    );
}

// ── Parâmetros das obrigações ────────────────────────────────────────────────────────────────────────────────

/** Uma linha de parametro_obrigacao no contrato, validada pelo esquema (com os padrões dele). */
export function parametrosObrigacoesDe(r: Linha): ParametrosObrigacoesLidos {
  const id = n(r['id']);
  const dados = objetoJson(r['dados']);
  const lido =
    dados === undefined
      ? undefined
      : esquemaParametrosObrigacoes.safeParse({
          ...dados,
          empresa: n(r['estabelecimento_id']),
          inicio: competenciaDe(r['vigencia_inicio']),
        });
  if (!lido?.success)
    throw recusa(
      'parametros-obrigacoes-invalidos',
      `Os parâmetros das obrigações ${id} estão gravados fora do formato do contrato: grave uma vigência nova corrigida.`,
      { campos: lido ? [...new Set(lido.error.issues.map((x) => x.path.join('.')))] : ['dados'] },
    );
  return { ...lido.data, id, criadoPor: texto(r['login']), criadoEm: instante(r['criado_em']) };
}

// ── A porta ──────────────────────────────────────────────────────────────────────────────────────────────────

export type NucleoLeituraFolha = Pick<NucleoProprio, 'lerSomente'>;

function contextoDe(c: ContextoCalculoFolha): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** As leituras do processamento, das férias, das rescisões e dos parâmetros das obrigações (porta própria). */
export class LeiturasCalculoFolhaPropria {
  constructor(private readonly nucleo: NucleoLeituraFolha) {}

  private ler<T>(c: ContextoCalculoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  processos(c: ContextoCalculoFolha, f: FiltroProcessosDaFolha): Promise<ProcessoDaFolha[]> {
    return this.ler(c, (l, est) => lerProcessos(l, est, f));
  }

  processo(c: ContextoCalculoFolha, id: number): Promise<ProcessoDaFolha | null> {
    return this.ler(c, (l, est) => lerProcesso(l, est, id));
  }

  resumoVinculos(c: ContextoCalculoFolha, processo: number): Promise<ResumoVinculoDoProcesso[]> {
    return this.ler(c, (l, est) => lerResumoVinculos(l, est, processo));
  }

  linhasDoVinculo(
    c: ContextoCalculoFolha,
    processo: number,
    vinculo: number,
  ): Promise<LinhaCalculoDoVinculo[]> {
    return this.ler(c, (l, est) => lerLinhas(l, est, processo, vinculo));
  }

  /** Processamentos calculados do tipo, de `de` a `ate` (AAAA-MM), que têm linha do vínculo; da competência mais antiga. */
  processosDoVinculo(
    c: ContextoCalculoFolha,
    vinculo: number,
    tipo: TipoProcesso,
    de: string,
    ate: string,
  ): Promise<{ processo: number; competencia: string }[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT p.id, p.competencia FROM processamento_folha p
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.tipo = ? AND p.situacao = 'calculada'
              AND p.competencia BETWEEN ? AND ?
              AND EXISTS (SELECT 1 FROM processamento_folha_linha x
                           WHERE x.processamento_folha_id = p.id AND x.vinculo_trabalho_id = ?)
            ORDER BY p.competencia, p.id`,
          [est, TIPO_NO_BANCO[tipo], competenciaNoBanco(de), competenciaNoBanco(ate), vinculo],
        )
      ).map((r) => ({ processo: n(r['id']), competencia: competenciaDe(r['competencia']) })),
    );
  }

  /** Soma por vínculo, competência e papel do histórico das folhas mensais calculadas de `de` a `ate` (AAAA-MM). */
  historico(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    de: string,
    ate: string,
  ): Promise<HistoricoDaFolha[]> {
    if (vinculos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.vinculo_trabalho_id, p.competencia, x.papel, SUM(COALESCE(x.quantidade, 0)) AS quantidade,
                  SUM(x.valor) AS valor
             FROM processamento_folha p
             JOIN processamento_folha_linha x ON x.processamento_folha_id = p.id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.tipo = 'mensal' AND p.situacao = 'calculada'
              AND p.competencia BETWEEN ? AND ?
              AND x.vinculo_trabalho_id IN (${marcas(vinculos)}) AND x.papel IN (${marcas(PAPEIS_HISTORICO_FOLHA)})
            GROUP BY x.vinculo_trabalho_id, p.competencia, x.papel
            ORDER BY x.vinculo_trabalho_id, p.competencia, x.papel`,
          [est, competenciaNoBanco(de), competenciaNoBanco(ate), ...vinculos, ...PAPEIS_HISTORICO_FOLHA],
        )
      ).map((r) => ({
        vinculo: n(r['vinculo_trabalho_id']),
        competencia: competenciaDe(r['competencia']),
        papel: texto(r['papel']) as HistoricoDaFolha['papel'],
        quantidade: n(r['quantidade']),
        valor: n(r['valor']),
      })),
    );
  }

  /** Proventos e descontos do processamento somados por vínculo e código da rubrica (sem as linhas sem rubrica). */
  itensRubricaDoProcesso(c: ContextoCalculoFolha, processo: number): Promise<ItemRubricaDoProcesso[]> {
    return this.ler(c, async (l, est) => {
      const por = new Map<string, ItemRubricaDoProcesso>();
      for (const x of await lerLinhas(l, est, processo)) {
        if (x.codigoRubrica === null || (x.tipo !== 'provento' && x.tipo !== 'desconto')) continue;
        const k = `${x.vinculo}:${x.tipo}:${x.codigoRubrica}`;
        const a = por.get(k);
        por.set(k, {
          vinculo: x.vinculo,
          tipo: x.tipo,
          codigoRubrica: x.codigoRubrica,
          valor: centavos((a?.valor ?? 0) + x.valor),
        });
      }
      return [...por.values()].sort((a, b) => a.vinculo - b.vinculo || a.codigoRubrica - b.codigoRubrica);
    });
  }

  ferias(c: ContextoCalculoFolha, f: FiltroFeriasDaFolha): Promise<FeriasDoVinculo[]> {
    return this.ler(c, (l, est) => lerFerias(l, est, f));
  }

  feriasPorId(c: ContextoCalculoFolha, id: number): Promise<FeriasDoVinculo | null> {
    return this.ler(c, (l, est) => lerFeriasPorId(l, est, id));
  }

  /**
   * Férias calculadas com gozo em [inicio, fim] e o processamento `calculada` do recibo: a competência do recibo, a base
   * do INSS e o INSS das férias (as linhas `baseInss` e `inssFerias` do processamento).
   */
  feriasNaCompetencia(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<FeriasNaCompetencia[]> {
    return this.ler(c, async (l, est) => {
      const fs = (await lerFerias(l, est, { de: inicio, ate: fim, situacao: 'calculada' })).filter(
        (x) => x.processo !== null,
      );
      if (fs.length === 0) return [];
      const ids = [...new Set(fs.map((x) => x.processo as number))];
      const rs = await l.consultar(
        `SELECT p.id, p.competencia,
                COALESCE(SUM(CASE WHEN x.papel = 'baseInss' THEN x.valor END), 0) AS base_inss,
                COALESCE(SUM(CASE WHEN x.papel = 'inssFerias' THEN x.valor END), 0) AS inss
           FROM processamento_folha p
           LEFT JOIN processamento_folha_linha x ON x.processamento_folha_id = p.id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao = 'calculada'
            AND p.id IN (${marcas(ids)})
          GROUP BY p.id, p.competencia`,
        [est, ...ids],
      );
      const proc = new Map(rs.map((r) => [n(r['id']), r]));
      return fs.flatMap((x) => {
        const p = proc.get(x.processo as number);
        return p
          ? [
              {
                ferias: x.id,
                vinculo: x.vinculo,
                inicio: x.inicio,
                fim: x.fim,
                processo: n(p['id']),
                competencia: competenciaDe(p['competencia']),
                baseInss: n(p['base_inss']),
                inss: n(p['inss']),
              },
            ]
          : [];
      });
    });
  }

  rescisoes(c: ContextoCalculoFolha, f: FiltroRescisoesDaFolha): Promise<RescisaoDaFolha[]> {
    return this.ler(c, (l, est) => lerRescisoes(l, est, f));
  }

  rescisaoPorId(c: ContextoCalculoFolha, id: number): Promise<RescisaoDaFolha | null> {
    return this.ler(c, (l, est) => lerRescisaoPorId(l, est, id));
  }

  /**
   * Parâmetros das obrigações do estabelecimento da sessão, da vigência mais recente primeiro. `empresa` null: as da
   * sessão; outra empresa: nenhuma. Cada linha passa pelo esquema do contrato (os padrões dele valem; JSON inválido
   * recusa com 409 `parametros-obrigacoes-invalidos`, nunca vira objeto vazio).
   * DECISÃO (linhas da rede inteira, estabelecimento_id nulo): ficam de fora. Os parâmetros são a identidade do
   * empregador nos arquivos (razão social, endereço, natureza jurídica, contato e regimes de cada CNPJ), que não se
   * herda da rede; o gravador só grava com o estabelecimento da sessão, como a porta de memória (uma por empresa).
   */
  parametrosObrigacoes(
    c: ContextoCalculoFolha,
    empresa: number | null,
  ): Promise<ParametrosObrigacoesLidos[]> {
    return this.ler(c, async (l, est) => {
      if (empresa !== null && empresa !== est) return [];
      const rs = await l.consultar(
        `SELECT p.id, p.estabelecimento_id, p.vigencia_inicio, p.dados, p.criado_em, u.login
           FROM parametro_obrigacao p LEFT JOIN usuario u ON u.id = p.criado_por
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.vigencia_inicio DESC, p.id DESC`,
        [est],
      );
      return rs.map((r) => parametrosObrigacoesDe(r));
    });
  }
}
