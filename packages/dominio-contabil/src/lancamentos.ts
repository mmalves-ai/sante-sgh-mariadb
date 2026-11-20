// Etapa 2 do M54 (F2; ficha, regras 2, 3 e 5; D-ESTORNO-54): o que vira lançamento gravado, puro. A API (e o worker)
// leem do banco, chamam estas funções e gravam o resultado em SGH_CTB_* numa transação.
//   - `planoDaContabilizacao`: os fatos candidatos (pendentes ou recusados) → lançar, estornar ou só marcar a situação.
//     O fato de competência encerrada vai ao primeiro período aberto (regra 3). O fato-estorno (linha alterada ou
//     reaberta) estorna o LANÇAMENTO do fato original, com as partidas dele invertidas (nunca recalcula pela regra de
//     hoje); se o original não chegou a ser contabilizado, não há o que estornar.
//   - `problemasDoLancamentoManual`, `planoDoEstorno`: as recusas do lançamento manual e do estorno.
//   - `impedimentosDoEncerramento`, `recusaDaReabertura`: o encerramento com bloqueio e o "desfazer encerramento".
//   - `montarRazao`, `problemasDaConciliacao`: o razão com o saldo corrido e a conciliação (débitos = créditos).
import {
  type ContaPlano,
  type FatoContabil,
  type ImpedimentoEncerramento,
  type LadoPartida,
  type PartidaGerada,
  type PartidaManual,
  type RegraContabil,
  type SituacaoFato,
  type TipoLancamento,
  TIPOS_FATO,
} from '@sgh/contratos';
import { competenciaDaData } from './dinheiro.js';
import { equilibrio, problemasDoLancamento } from './partidas.js';
import { dataContabil, periodoAberto, type PeriodoContabil } from './periodo.js';
import { recusaDeLancamentoNaConta } from './plano.js';
import { contabilizar, type ContextoAplicacao } from './regra.js';
import { fatosAtivos } from './registro.js';

/** Data AAAA-MM-DD → DD/MM/AAAA (para o histórico e as mensagens). */
export const dataBr = (d: string): string => d.slice(0, 10).split('-').reverse().join('/');
/** Competência AAAA-MM → MM/AAAA. */
export const competenciaBr = (c: string): string => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/** O lançamento a gravar (cabeçalho e partidas); a chave única é a idempotência. */
export interface LancamentoNovo {
  readonly chave: string;
  readonly tipo: TipoLancamento;
  readonly empresa: number;
  readonly data: string;
  readonly competencia: string;
  readonly historico: string;
  readonly partidas: readonly PartidaGerada[];
  readonly fatoId: number | null;
  readonly regraId: number | null;
  readonly regra: { readonly nome: string; readonly versao: number } | null;
  readonly estornaId: number | null;
  readonly justificativa: string | null;
}

/** Chaves de idempotência: um lançamento por fato, um estorno por lançamento, um manual por envio. */
export const chaveLancamentoDoFato = (idFato: number): string => `fato:${idFato}`;
export const chaveEstorno = (idLancamento: number): string => `estorno:${idLancamento}`;
export const chaveManual = (idempotencia: string): string => `manual:${idempotencia.toLowerCase()}`;

/** Partidas invertidas (o estorno): mesmo valor, mesma conta e centro, lado trocado. */
export function partidasInvertidas(
  partidas: readonly PartidaGerada[],
  prefixo = 'Estorno: ',
): PartidaGerada[] {
  return partidas.map((p) => ({
    ...p,
    lado: (p.lado === 'D' ? 'C' : 'D') as LadoPartida,
    historico: `${prefixo}${p.historico}`.slice(0, 120),
  }));
}

// ── Contabilização dos fatos ─────────────────────────────────────────────────────────────────────

/** Fato registrado como a leitura de SGH_CTB_FATO devolve (com o ID e a situação). */
export interface FatoCandidato extends FatoContabil {
  readonly idFato: number;
  readonly situacao: SituacaoFato;
}

/** O lançamento já gravado de um fato (para não lançar de novo e para o estorno do fato). */
export interface LancamentoDoFato {
  readonly id: number;
  readonly idFato: number;
  readonly partidas: readonly PartidaGerada[];
  readonly estornadoPor: number | null;
}

export type AcaoContabilizacao =
  | {
      readonly acao: 'lancar';
      readonly idFato: number;
      /** A situação do fato na leitura: a gravação só vale se ela não mudou (D-CORRIDA-542). */
      readonly situacaoLida: SituacaoFato;
      readonly situacao: 'contabilizado';
      readonly regraId: number | null;
      readonly lancamento: LancamentoNovo;
      /** O fato era de competência encerrada: o lançamento foi ao primeiro período aberto. */
      readonly movido: boolean;
    }
  | {
      readonly acao: 'marcar';
      readonly idFato: number;
      readonly situacaoLida: SituacaoFato;
      readonly situacao: SituacaoFato;
      readonly motivo: string | null;
      readonly regraId: number | null;
    };

export interface EntradaContabilizacao {
  /** Os fatos a contabilizar (pendentes, ou também os sem regra e sem conta). */
  readonly candidatos: readonly FatoCandidato[];
  /** Todos os fatos registrados das linhas dos candidatos (para saber o ativo e o original do estorno). */
  readonly registrados: readonly FatoCandidato[];
  /** Os lançamentos já gravados dos fatos dessas linhas, pelo ID do fato. */
  readonly lancamentos: ReadonlyMap<number, LancamentoDoFato>;
  readonly publicadas: readonly { readonly id: number; readonly regra: RegraContabil }[];
  readonly ctx: ContextoAplicacao;
  readonly periodos: readonly PeriodoContabil[];
}

const linha = (f: Pick<FatoContabil, 'tabela' | 'id' | 'tipo'>) => `${f.tabela}:${f.id}:${f.tipo}`;

function historicoDoFato(f: FatoContabil, movido: boolean): string {
  const base = `${f.estorno ? 'Estorno: ' : ''}${TIPOS_FATO[f.tipo].rotulo} ${f.documento}`.trim();
  return (movido ? `${base} (fato de ${dataBr(f.data)}, período encerrado)` : base).slice(0, 200);
}

/** O que fazer com cada candidato (puro e determinístico: a mesma entrada dá as mesmas ações). */
export function planoDaContabilizacao(e: EntradaContabilizacao): AcaoContabilizacao[] {
  const ativos = new Set(fatosAtivos(e.registrados).map((f) => `${linha(f)}:${f.impressao}`));
  const idDaRegra = new Map(
    e.publicadas.map((p) => [
      `${p.regra.empresa}|${p.regra.origem}|${p.regra.tipoFato}|${p.regra.nome}|${p.regra.versao}`,
      p.id,
    ]),
  );
  const regras = e.publicadas.map((p) => p.regra);
  const acoes: AcaoContabilizacao[] = [];
  const marcar = (f: FatoCandidato, situacao: SituacaoFato, motivo: string | null) =>
    acoes.push({
      acao: 'marcar',
      idFato: f.idFato,
      situacaoLida: f.situacao,
      situacao,
      motivo,
      regraId: null,
    });
  for (const f of e.candidatos) {
    const ja = e.lancamentos.get(f.idFato);
    if (ja) {
      // Lançado antes e a situação não foi marcada (transação anterior interrompida não deixa isso; é reparo).
      marcar(f, 'contabilizado', null);
      continue;
    }
    if (f.estorno) {
      const original = e.registrados.find(
        (o) => !o.estorno && linha(o) === linha(f) && o.impressao === f.referencia,
      );
      const lancOriginal = original ? e.lancamentos.get(original.idFato) : undefined;
      if (!lancOriginal) {
        marcar(f, 'ignorado', 'O fato estornado não chegou a ser contabilizado: não há o que estornar.');
        continue;
      }
      if (lancOriginal.estornadoPor !== null) {
        marcar(f, 'ignorado', 'O lançamento do fato original já foi estornado.');
        continue;
      }
      const data = dataContabil(e.periodos, f.empresa, f.data);
      const movido = data !== f.data;
      acoes.push({
        acao: 'lancar',
        idFato: f.idFato,
        situacaoLida: f.situacao,
        situacao: 'contabilizado',
        regraId: null,
        movido,
        lancamento: {
          chave: chaveLancamentoDoFato(f.idFato),
          tipo: 'estorno',
          empresa: f.empresa,
          data,
          competencia: competenciaDaData(data),
          historico: historicoDoFato(f, movido),
          partidas: partidasInvertidas(lancOriginal.partidas),
          fatoId: f.idFato,
          regraId: null,
          regra: null,
          estornaId: lancOriginal.id,
          justificativa: null,
        },
      });
      continue;
    }
    if (!ativos.has(`${linha(f)}:${f.impressao}`)) {
      marcar(f, 'substituido', 'A linha mudou antes da contabilização: vale o fato mais novo.');
      continue;
    }
    const r = contabilizar(f, regras, e.ctx);
    if (!r.lancamento) {
      marcar(f, r.situacao, r.motivo);
      continue;
    }
    const regraId =
      idDaRegra.get(
        `${f.empresa}|${f.origem}|${f.tipo}|${r.lancamento.regra.nome}|${r.lancamento.regra.versao}`,
      ) ?? null;
    const data = dataContabil(e.periodos, f.empresa, f.data);
    const movido = data !== f.data;
    acoes.push({
      acao: 'lancar',
      idFato: f.idFato,
      situacaoLida: f.situacao,
      situacao: 'contabilizado',
      regraId,
      movido,
      lancamento: {
        chave: chaveLancamentoDoFato(f.idFato),
        tipo: 'automatico',
        empresa: f.empresa,
        data,
        competencia: competenciaDaData(data),
        historico: historicoDoFato(f, movido),
        partidas: r.lancamento.partidas,
        fatoId: f.idFato,
        regraId,
        regra: r.lancamento.regra,
        estornaId: null,
        justificativa: null,
      },
    });
  }
  return acoes;
}

/** Resumo das ações (contagens por situação e totais dos lançamentos, com as parcelas por lançamento). */
export function resumoDaContabilizacao(acoes: readonly AcaoContabilizacao[]): {
  readonly porSituacao: Record<SituacaoFato, number>;
  readonly lancamentos: number;
  readonly movidos: number;
  readonly debitos: number;
  readonly creditos: number;
} {
  const porSituacao: Record<SituacaoFato, number> = {
    pendente: 0,
    contabilizado: 0,
    semRegra: 0,
    semConta: 0,
    substituido: 0,
    ignorado: 0,
  };
  let lancamentos = 0;
  let movidos = 0;
  let debitos = 0;
  let creditos = 0;
  for (const a of acoes) {
    porSituacao[a.situacao] += 1;
    if (a.acao !== 'lancar') continue;
    lancamentos += 1;
    if (a.movido) movidos += 1;
    const q = equilibrio(a.lancamento.partidas);
    debitos += q.debitos;
    creditos += q.creditos;
  }
  return { porSituacao, lancamentos, movidos, debitos, creditos };
}

// ── Lançamento manual e estorno ──────────────────────────────────────────────────────────────────

export interface EntradaManual {
  readonly empresa: number;
  readonly data: string;
  readonly partidas: readonly PartidaManual[];
}

/** A data do lançamento depois de hoje (D-FUTURO-542): o manual e o estorno recusam; nula quando não é futura. */
export function recusaDataFutura(data: string, hoje: string): string | null {
  return data > hoje
    ? `A data ${dataBr(data)} é futura: o lançamento vai na data de hoje (${dataBr(hoje)}) ou antes.`
    : null;
}

/**
 * Recusas do lançamento manual: data futura (quando `hoje` vem), período aberto, contas analíticas ativas, centro de
 * custo exigido, equilíbrio.
 */
export function problemasDoLancamentoManual(
  l: EntradaManual,
  plano: readonly ContaPlano[],
  periodos: readonly PeriodoContabil[],
  hoje?: string,
): string[] {
  const r: string[] = [];
  const futura = hoje ? recusaDataFutura(l.data, hoje) : null;
  if (futura) r.push(futura);
  const comp = competenciaDaData(l.data);
  if (!periodoAberto(periodos, l.empresa, comp))
    r.push(`O período ${competenciaBr(comp)} está encerrado: lance numa data de período aberto.`);
  const porCodigo = new Map(plano.filter((c) => c.empresa === l.empresa).map((c) => [c.codigo, c]));
  const vistas = new Set<string>();
  for (const p of l.partidas) {
    const c = porCodigo.get(p.conta);
    const recusa = recusaDeLancamentoNaConta(c, p.conta);
    if (recusa) {
      if (!vistas.has(p.conta)) r.push(recusa);
      vistas.add(p.conta);
      continue;
    }
    if (c?.exigeCentroCusto && p.centroCusto === null && !vistas.has(`cc:${p.conta}`)) {
      r.push(`A conta ${p.conta} exige centro de custo.`);
      vistas.add(`cc:${p.conta}`);
    }
  }
  r.push(...problemasDoLancamento(partidasDoManual(l.partidas, '')));
  return r;
}

/** As partidas do manual na forma gravada (o histórico da partida, sem o próprio, é o do lançamento). */
export function partidasDoManual(partidas: readonly PartidaManual[], historico: string): PartidaGerada[] {
  return partidas.map((p) => ({
    lado: p.lado,
    conta: p.conta,
    valorCentavos: p.valorCentavos,
    centroCusto: p.centroCusto,
    historico: (p.historico?.trim() || historico).slice(0, 120),
  }));
}

/** O lançamento a estornar como a leitura devolve. */
export interface LancamentoParaEstorno {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoLancamento;
  readonly data: string;
  readonly historico: string;
  readonly partidas: readonly PartidaGerada[];
  readonly estornadoPor: number | null;
}

export type PlanoEstorno =
  | { readonly ok: true; readonly lancamento: LancamentoNovo }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

/** O estorno do lançamento (outro lançamento, partidas invertidas, referência ao original) ou a recusa. */
export function planoDoEstorno(
  original: LancamentoParaEstorno,
  periodos: readonly PeriodoContabil[],
  hoje: string,
  justificativa: string,
  dataPedida?: string,
): PlanoEstorno {
  if (original.tipo === 'estorno')
    return {
      ok: false,
      codigo: 'estorno-de-estorno',
      motivo: 'Um estorno não se estorna: faça um lançamento novo com as partidas certas.',
    };
  if (original.estornadoPor !== null)
    return {
      ok: false,
      codigo: 'ja-estornado',
      motivo: `Este lançamento já foi estornado (lançamento ${original.estornadoPor}).`,
    };
  const data = dataPedida ?? hoje;
  const futura = recusaDataFutura(data, hoje);
  if (futura) return { ok: false, codigo: 'data-futura', motivo: futura };
  if (data < original.data)
    return {
      ok: false,
      codigo: 'data-anterior',
      motivo: `O estorno não pode ser antes do lançamento original (${dataBr(original.data)}).`,
    };
  const comp = competenciaDaData(data);
  if (!periodoAberto(periodos, original.empresa, comp))
    return {
      ok: false,
      codigo: 'periodo-encerrado',
      motivo: `O período ${competenciaBr(comp)} está encerrado: estorne numa data de período aberto.`,
    };
  return {
    ok: true,
    lancamento: {
      chave: chaveEstorno(original.id),
      tipo: 'estorno',
      empresa: original.empresa,
      data,
      competencia: comp,
      historico: `Estorno do lançamento ${original.id}: ${original.historico}`.slice(0, 200),
      partidas: partidasInvertidas(original.partidas),
      fatoId: null,
      regraId: null,
      regra: null,
      estornaId: original.id,
      justificativa,
    },
  };
}

// ── Encerramento e reabertura ────────────────────────────────────────────────────────────────────

export interface EntradaEncerramento {
  readonly competencia: string;
  readonly hoje: string;
  readonly encerrado: boolean;
  readonly fatos: Readonly<Partial<Record<SituacaoFato, number>>>;
  readonly debitos: number;
  readonly creditos: number;
  /** A competência anterior, quando aberta e com movimento (lançamento ou fato): tem de ser encerrada antes. */
  readonly anteriorAbertaComMovimento: string | null;
}

/** Impedimentos do encerramento (vazio: pode encerrar). */
export function impedimentosDoEncerramento(e: EntradaEncerramento): ImpedimentoEncerramento[] {
  const r: ImpedimentoEncerramento[] = [];
  const comp = competenciaBr(e.competencia);
  if (e.encerrado)
    return [{ codigo: 'ja-encerrado', mensagem: `O período ${comp} já está encerrado.`, quantidade: 0 }];
  if (e.competencia >= competenciaDaData(e.hoje))
    r.push({
      codigo: 'futuro',
      mensagem: `O período ${comp} ainda não terminou: só se encerra competência passada.`,
      quantidade: 0,
    });
  if (e.anteriorAbertaComMovimento)
    r.push({
      codigo: 'anterior-aberto',
      mensagem: `Encerre antes o período ${competenciaBr(e.anteriorAbertaComMovimento)}.`,
      quantidade: 1,
    });
  const conta = (s: SituacaoFato) => e.fatos[s] ?? 0;
  if (conta('pendente') > 0)
    r.push({
      codigo: 'fatos-pendentes',
      mensagem: 'Há fatos dos módulos aguardando contabilização: contabilize antes de encerrar.',
      quantidade: conta('pendente'),
    });
  if (conta('semRegra') > 0)
    r.push({
      codigo: 'fatos-sem-regra',
      mensagem: 'Há fatos sem regra vigente: publique a regra e contabilize de novo.',
      quantidade: conta('semRegra'),
    });
  if (conta('semConta') > 0)
    r.push({
      codigo: 'fatos-sem-conta',
      mensagem: 'Há fatos sem conta (de-para incompleto): complete o de-para e contabilize de novo.',
      quantidade: conta('semConta'),
    });
  if (e.debitos !== e.creditos)
    r.push({
      codigo: 'desequilibrio',
      mensagem: `Débitos (${e.debitos}) diferentes dos créditos (${e.creditos}) no período: diferença de ${e.debitos - e.creditos} centavos.`,
      quantidade: Math.abs(e.debitos - e.creditos),
    });
  return r;
}

/** Só o último período encerrado da empresa se reabre (o "desfazer encerramento"); nulo = pode. */
export function recusaDaReabertura(
  periodos: readonly PeriodoContabil[],
  empresa: number,
  competencia: string,
): string | null {
  const encerrados = periodos
    .filter((p) => p.empresa === empresa && p.situacao === 'encerrado')
    .map((p) => p.competencia)
    .sort();
  if (!encerrados.includes(competencia)) return `O período ${competenciaBr(competencia)} não está encerrado.`;
  const ultimo = encerrados.at(-1)!;
  if (ultimo !== competencia)
    return `Reabra antes o período ${competenciaBr(ultimo)}: só o último encerrado se reabre.`;
  return null;
}

// ── Razão e conciliação ──────────────────────────────────────────────────────────────────────────

export interface MovimentoLido {
  readonly lancamento: number;
  readonly partida: number;
  readonly data: string;
  readonly tipo: TipoLancamento;
  readonly historico: string;
  readonly centroCusto: number | null;
  readonly lado: LadoPartida;
  readonly valorCentavos: number;
  readonly conciliado: boolean;
}

/** Saldo na natureza da conta: devedora D − C; credora C − D. */
export const saldoNaNatureza = (natureza: 'devedora' | 'credora', debitos: number, creditos: number) =>
  natureza === 'devedora' ? debitos - creditos : creditos - debitos;

const reais = (c: number) => {
  const s = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${s}${Math.trunc(a / 100).toLocaleString('pt-BR')},${String(a % 100).padStart(2, '0')}`;
};

/**
 * O razão com o saldo corrido: saldo anterior (débitos e créditos antes do início) e os movimentos em ordem; a
 * conferência imprime as parcelas (saldo anterior, débitos, créditos e saldo final).
 */
export function montarRazao(
  natureza: 'devedora' | 'credora',
  anterior: { readonly debitos: number; readonly creditos: number },
  movimentos: readonly MovimentoLido[],
  totais: { readonly debitos: number; readonly creditos: number },
  teto: number,
  /** Débitos e créditos do intervalo antes da página (a página 1 não tem): o saldo inicial da página. */
  antesDaPagina: { readonly debitos: number; readonly creditos: number } = { debitos: 0, creditos: 0 },
) {
  const saldoAnterior = saldoNaNatureza(natureza, anterior.debitos, anterior.creditos);
  const saldoInicialPagina =
    saldoAnterior + saldoNaNatureza(natureza, antesDaPagina.debitos, antesDaPagina.creditos);
  let saldo = saldoInicialPagina;
  const lista = movimentos.slice(0, teto).map((m) => {
    const d = m.lado === 'D' ? m.valorCentavos : 0;
    const c = m.lado === 'C' ? m.valorCentavos : 0;
    saldo += saldoNaNatureza(natureza, d, c);
    return {
      lancamento: m.lancamento,
      partida: m.partida,
      data: m.data,
      tipo: m.tipo,
      historico: m.historico,
      centroCusto: m.centroCusto,
      debitoCentavos: d,
      creditoCentavos: c,
      saldoCentavos: saldo,
      conciliado: m.conciliado,
    };
  });
  const saldoFinal = saldoAnterior + saldoNaNatureza(natureza, totais.debitos, totais.creditos);
  const conferencia =
    natureza === 'devedora'
      ? `${reais(saldoAnterior)} + ${reais(totais.debitos)} (débitos) − ${reais(totais.creditos)} (créditos) = ${reais(saldoFinal)}`
      : `${reais(saldoAnterior)} + ${reais(totais.creditos)} (créditos) − ${reais(totais.debitos)} (débitos) = ${reais(saldoFinal)}`;
  return {
    saldoAnteriorCentavos: saldoAnterior,
    debitosCentavos: totais.debitos,
    creditosCentavos: totais.creditos,
    saldoFinalCentavos: saldoFinal,
    conferencia,
    movimentos: lista,
    saldoInicialPaginaCentavos: saldoInicialPagina,
    parcial: movimentos.length > teto,
  };
}

export interface PartidaParaConciliacao {
  readonly id: number;
  readonly empresa: number;
  readonly conta: string;
  readonly lado: LadoPartida;
  readonly valorCentavos: number;
  readonly conciliacao: number | null;
}

/** Recusas da conciliação: todas achadas, da conta e empresa, pendentes, com débito e crédito e débitos = créditos. */
export function problemasDaConciliacao(
  pedidas: readonly number[],
  achadas: readonly PartidaParaConciliacao[],
  empresa: number,
  conta: string,
): string[] {
  const r: string[] = [];
  const unicas = [...new Set(pedidas)];
  if (unicas.length !== pedidas.length) r.push('A mesma partida foi escolhida mais de uma vez.');
  const porId = new Map(achadas.map((p) => [p.id, p]));
  const faltam = unicas.filter((id) => !porId.has(id));
  if (faltam.length) r.push(`Partidas não encontradas: ${faltam.join(', ')}.`);
  const escolhidas = unicas.map((id) => porId.get(id)).filter((p): p is PartidaParaConciliacao => !!p);
  if (escolhidas.some((p) => p.empresa !== empresa || p.conta !== conta))
    r.push(`Só se conciliam partidas da conta ${conta}.`);
  const ja = escolhidas.filter((p) => p.conciliacao !== null);
  if (ja.length) r.push(`${ja.length} partida(s) já conciliada(s).`);
  const d = escolhidas.filter((p) => p.lado === 'D').reduce((s, p) => s + p.valorCentavos, 0);
  const c = escolhidas.filter((p) => p.lado === 'C').reduce((s, p) => s + p.valorCentavos, 0);
  if (d === 0 || c === 0) r.push('A conciliação precisa de partidas a débito e a crédito.');
  else if (d !== c) r.push(`Débitos (${d}) diferentes dos créditos (${c}): diferença de ${d - c} centavos.`);
  return r;
}
