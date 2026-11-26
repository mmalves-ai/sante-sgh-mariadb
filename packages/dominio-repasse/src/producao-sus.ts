// Repasse da produção SUS aos profissionais (F7, 06-SUS linha 62). Regra pura: a base do repasse é a produção
// APROVADA no retorno do SUS (BPA processado, APAC aprovada, AIH aprovada, com a equipe de cada procedimento em
// conta_aih_profissional), nunca a apresentada. Cada ato recebe a regra do estabelecimento que casa com ele (modalidade,
// procedimento ou grupo, ocupação, papel, vigência na competência), escolhida pela prioridade e, no empate, pela mais
// específica; o valor é a base da regra (serviço profissional, hospitalar, ambulatorial, total, pontos ou valor fixo)
// vezes o percentual pago, menos o desconto, e a glosa é proporcional ao que o SUS deixou de aprovar. O SADT da AIH
// (procedimentos sem equipe, cujo serviço profissional fica com o hospital) é rateado entre os executantes dos
// procedimentos que a regra de rateio marca, por pontos ou por peso, com o teto por procedimento; a sobra fica com o
// hospital. Ato sem executante ou sem regra vira pendência, nunca valor inventado. Tudo em centavos inteiros.
import { aplicarPercentual, centavos, dividirArredondando, reais } from './dinheiro.js';

export const MODALIDADES_REPASSE_SUS = ['ambulatorial', 'internacao'] as const;
export type ModalidadeRepasseSus = (typeof MODALIDADES_REPASSE_SUS)[number];
export const PAPEIS_REGRA_SUS = ['executante', 'anestesista', 'auxiliar', 'plantonista', 'todos'] as const;
export type PapelRegraSus = (typeof PAPEIS_REGRA_SUS)[number];
export type PapelAtoSus = Exclude<PapelRegraSus, 'todos'> | 'outro';
export const BASES_REPASSE_SUS = [
  'servico_profissional',
  'servico_hospitalar',
  'servico_ambulatorial',
  'total',
  'pontos',
  'valor_fixo',
] as const;
export type BaseRepasseSus = (typeof BASES_REPASSE_SUS)[number];
export const INSTRUMENTOS_REPASSE_SUS = ['bpa', 'apac', 'aih'] as const;
export type InstrumentoRepasseSus = (typeof INSTRUMENTOS_REPASSE_SUS)[number];

export interface RegraRepasseSus {
  readonly id: number;
  readonly codigo: string;
  readonly modalidade: ModalidadeRepasseSus;
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly ocupacao: number | null;
  readonly papel: PapelRegraSus;
  readonly base: BaseRepasseSus;
  readonly percentualPago: number | null;
  readonly percentualDesconto: number | null;
  readonly valorFixo: number | null;
  readonly valorDesconto: number | null;
  readonly valorPonto: number | null;
  readonly prioridade: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly ativo: boolean;
}

/** Um ato da produção aprovada: um procedimento (BPA, APAC) ou um membro da equipe de um procedimento da AIH. */
export interface AtoProducaoSus {
  readonly instrumento: InstrumentoRepasseSus;
  /** Id da linha de origem (item do BPA, procedimento da APAC, procedimento da AIH). */
  readonly origem: number;
  readonly procedimento: number;
  readonly grupo: number | null;
  readonly ocupacao: number | null;
  readonly executante: number | null;
  readonly papel: PapelAtoSus;
  readonly quantidade: number;
  readonly pontos: number | null;
  readonly servicoProfissional: number;
  readonly servicoHospitalar: number;
  readonly servicoAmbulatorial: number;
  readonly total: number;
  /** Fração aprovada pelo SUS (valor aprovado / apresentado), entre 0 e 1. */
  readonly fracaoAprovada: number;
}

export interface LinhaRepasseSus {
  readonly sequencia: number;
  readonly instrumento: InstrumentoRepasseSus;
  readonly origem: number;
  readonly executante: number;
  readonly papel: PapelAtoSus;
  readonly regra: number | null;
  readonly pontos: number | null;
  readonly base: number;
  readonly percentual: number | null;
  readonly glosa: number;
  readonly repasse: number;
  readonly sadt: boolean;
}

export type MotivoPendenciaSus = 'sem-executante' | 'sem-regra';
export interface PendenciaRepasseSus {
  readonly instrumento: InstrumentoRepasseSus;
  readonly origem: number;
  readonly motivo: MotivoPendenciaSus;
}

export interface RegraRateioSadtAih {
  readonly id: number;
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly profissional: number | null;
  readonly consideraSadt: boolean;
  readonly usaPeso: boolean;
  readonly pesoPercentual: number | null;
  readonly tetoPercentual: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly ativo: boolean;
}

/** Um procedimento executado da AIH que pode receber parte do SADT. */
export interface ParticipanteSadt {
  readonly origem: number;
  readonly procedimento: number;
  readonly grupo: number | null;
  readonly executante: number | null;
  readonly pontos: number | null;
  readonly quantidade: number;
}

export const modalidadeDoInstrumento = (i: InstrumentoRepasseSus): ModalidadeRepasseSus =>
  i === 'aih' ? 'internacao' : 'ambulatorial';

/** A atividade do profissional na AIH (código do domínio do SUS) → papel do repasse. */
export function papelDaAtividadeAih(codigo: string | null): PapelAtoSus {
  const c = (codigo ?? '').replace(/^0+/, '');
  if (c === '' || c === '1') return 'executante';
  if (c === '6') return 'anestesista';
  if (['2', '3', '4', '5'].includes(c)) return 'auxiliar';
  return 'outro';
}

const vigente = (r: { inicio: string; fim: string | null; ativo: boolean }, dia: string) =>
  r.ativo && r.inicio <= dia && (r.fim === null || r.fim >= dia);

const especificidade = (r: RegraRepasseSus) =>
  (r.procedimento !== null ? 4 : r.grupo !== null ? 2 : 0) +
  (r.ocupacao !== null ? 1 : 0) +
  (r.papel !== 'todos' ? 1 : 0);

/** A regra que vale para o ato na competência (primeiro dia, AAAA-MM-DD), ou null. */
export function escolherRegraSus(
  ato: AtoProducaoSus,
  regras: readonly RegraRepasseSus[],
  dia: string,
): RegraRepasseSus | null {
  const modalidade = modalidadeDoInstrumento(ato.instrumento);
  const casam = regras.filter(
    (r) =>
      vigente(r, dia) &&
      r.modalidade === modalidade &&
      (r.procedimento === null || r.procedimento === ato.procedimento) &&
      (r.procedimento !== null || r.grupo === null || r.grupo === ato.grupo) &&
      (r.ocupacao === null || r.ocupacao === ato.ocupacao) &&
      (r.papel === 'todos' || r.papel === ato.papel),
  );
  casam.sort((a, b) => a.prioridade - b.prioridade || especificidade(b) - especificidade(a) || a.id - b.id);
  return casam[0] ?? null;
}

/** Base da regra em centavos, antes do percentual (pontos e valor fixo já vêm prontos). */
function baseEmCentavos(ato: AtoProducaoSus, r: RegraRepasseSus): number {
  switch (r.base) {
    case 'servico_profissional':
      return centavos(ato.servicoProfissional);
    case 'servico_hospitalar':
      return centavos(ato.servicoHospitalar);
    case 'servico_ambulatorial':
      return centavos(ato.servicoAmbulatorial);
    case 'total':
      return centavos(ato.total);
    case 'pontos':
      return Math.round((ato.pontos ?? 0) * centavos(r.valorPonto ?? 0));
    case 'valor_fixo':
      return Math.round(centavos(r.valorFixo ?? 0) * ato.quantidade);
  }
}

/** Valor do ato pela regra: base, percentual pago, desconto e glosa proporcional ao não aprovado. */
export function calcularAtoSus(
  ato: AtoProducaoSus,
  r: RegraRepasseSus,
): { base: number; percentual: number | null; glosa: number; repasse: number } {
  const base = baseEmCentavos(ato, r);
  const fixo = r.base === 'valor_fixo' || r.base === 'pontos';
  const percentual = fixo ? r.percentualPago : (r.percentualPago ?? 100);
  let bruto = percentual === null ? base : aplicarPercentual(base, percentual);
  if (r.percentualDesconto) bruto -= aplicarPercentual(bruto, r.percentualDesconto);
  if (r.valorDesconto) bruto -= centavos(r.valorDesconto);
  bruto = Math.max(0, bruto);
  const fracao = Math.min(1, Math.max(0, ato.fracaoAprovada));
  const glosa =
    bruto - Number(dividirArredondando(BigInt(bruto) * BigInt(Math.round(fracao * 1e6)), 1_000_000n));
  return { base: reais(base), percentual, glosa: reais(glosa), repasse: reais(bruto - glosa) };
}

/** A regra de rateio do SADT que vale para o participante (a do profissional e do procedimento vence a do grupo). */
export function regraRateioDoParticipante(
  p: ParticipanteSadt,
  regras: readonly RegraRateioSadtAih[],
  dia: string,
): RegraRateioSadtAih | null {
  const casam = regras.filter(
    (r) =>
      vigente(r, dia) &&
      (r.procedimento === null || r.procedimento === p.procedimento) &&
      (r.procedimento !== null || r.grupo === p.grupo) &&
      (r.profissional === null || r.profissional === p.executante),
  );
  const peso = (r: RegraRateioSadtAih) =>
    (r.procedimento !== null ? 2 : 0) + (r.profissional !== null ? 1 : 0);
  casam.sort((a, b) => peso(b) - peso(a) || a.id - b.id);
  return casam[0] ?? null;
}

/**
 * Rateia o SADT da AIH (em reais) entre os participantes: o peso é o percentual da regra (usa_peso) ou os pontos ×
 * quantidade; cada parte respeita o teto da regra (percentual do SADT); a sobra do teto fica com o hospital. A soma das
 * partes nunca passa do SADT (maiores restos para os centavos).
 */
export function ratearSadtAih(
  sadt: number,
  participantes: readonly ParticipanteSadt[],
  regras: readonly RegraRateioSadtAih[],
  dia: string,
): {
  readonly origem: number;
  readonly executante: number;
  readonly valor: number;
  readonly regra: number;
}[] {
  const total = centavos(sadt);
  if (total <= 0) return [];
  const elegiveis = participantes.flatMap((p) => {
    const r = regraRateioDoParticipante(p, regras, dia);
    if (!r || !r.consideraSadt || p.executante === null) return [];
    const peso = r.usaPeso ? (r.pesoPercentual ?? 0) : (p.pontos ?? 0) * p.quantidade;
    return peso > 0 ? [{ p, r, peso: Math.round(peso * 10_000) }] : [];
  });
  const soma = elegiveis.reduce((a, x) => a + x.peso, 0);
  if (soma === 0) return [];
  const brutas = elegiveis.map((x) => {
    const exato = BigInt(total) * BigInt(x.peso);
    const inteiro = Number(exato / BigInt(soma));
    const resto = Number(exato % BigInt(soma));
    return { ...x, inteiro, resto };
  });
  let falta = total - brutas.reduce((a, x) => a + x.inteiro, 0);
  [...brutas]
    .sort((a, b) => b.resto - a.resto || a.p.origem - b.p.origem)
    .forEach((x) => {
      if (falta > 0) {
        x.inteiro += 1;
        falta -= 1;
      }
    });
  return brutas
    .map((x) => {
      const teto = x.r.tetoPercentual === null ? x.inteiro : aplicarPercentual(total, x.r.tetoPercentual);
      return {
        origem: x.p.origem,
        executante: x.p.executante as number,
        valor: reais(Math.min(x.inteiro, teto)),
        regra: x.r.id,
      };
    })
    .filter((x) => x.valor > 0);
}

export interface ResultadoApuracaoSus {
  readonly linhas: readonly LinhaRepasseSus[];
  readonly pendencias: readonly PendenciaRepasseSus[];
  readonly totalRepasse: number;
  readonly totalGlosa: number;
}

/**
 * Apura a produção aprovada da competência: cada ato com executante e regra vira uma linha; as partes do SADT da AIH
 * entram como linhas do executante do procedimento (sem regra de repasse: o rateio já é o valor). Sequência a partir
 * de 1, na ordem dos atos.
 */
export function apurarProducaoSus(entrada: {
  readonly competencia: string;
  readonly atos: readonly AtoProducaoSus[];
  readonly regras: readonly RegraRepasseSus[];
  readonly sadt?: readonly {
    readonly valor: number;
    readonly participantes: readonly ParticipanteSadt[];
    readonly fracaoAprovada: number;
  }[];
  readonly rateios?: readonly RegraRateioSadtAih[];
}): ResultadoApuracaoSus {
  const m = /^(\d{4})(\d{2})$/.exec(entrada.competencia);
  if (!m) throw new RangeError(`Competência inválida: ${entrada.competencia}`);
  const dia = `${m[1]}-${m[2]}-01`;
  const linhas: LinhaRepasseSus[] = [];
  const pendencias: PendenciaRepasseSus[] = [];
  let seq = 1;
  for (const ato of entrada.atos) {
    if (ato.executante === null) {
      pendencias.push({ instrumento: ato.instrumento, origem: ato.origem, motivo: 'sem-executante' });
      continue;
    }
    const regra = escolherRegraSus(ato, entrada.regras, dia);
    if (!regra) {
      pendencias.push({ instrumento: ato.instrumento, origem: ato.origem, motivo: 'sem-regra' });
      continue;
    }
    const v = calcularAtoSus(ato, regra);
    linhas.push({
      sequencia: seq++,
      instrumento: ato.instrumento,
      origem: ato.origem,
      executante: ato.executante,
      papel: ato.papel,
      regra: regra.id,
      pontos: ato.pontos,
      base: v.base,
      percentual: v.percentual,
      glosa: v.glosa,
      repasse: v.repasse,
      sadt: false,
    });
  }
  for (const s of entrada.sadt ?? []) {
    for (const parte of ratearSadtAih(s.valor, s.participantes, entrada.rateios ?? [], dia)) {
      const c = centavos(parte.valor);
      const fr = Math.min(1, Math.max(0, s.fracaoAprovada));
      const aprovado = Number(dividirArredondando(BigInt(c) * BigInt(Math.round(fr * 1e6)), 1_000_000n));
      linhas.push({
        sequencia: seq++,
        instrumento: 'aih',
        origem: parte.origem,
        executante: parte.executante,
        papel: 'executante',
        regra: null,
        pontos: null,
        base: parte.valor,
        percentual: null,
        glosa: reais(c - aprovado),
        repasse: reais(aprovado),
        sadt: true,
      });
    }
  }
  const somar = (k: 'repasse' | 'glosa') => reais(linhas.reduce((a, l) => a + centavos(l[k]), 0));
  return { linhas, pendencias, totalRepasse: somar('repasse'), totalGlosa: somar('glosa') };
}

export type ProblemaRegraSus =
  'codigo' | 'descricao' | 'vigencia' | 'percentual' | 'valor-fixo' | 'valor-ponto' | 'alvo-duplo';

/** Conferência da regra antes de gravar (a tela usa a mesma). */
export function conferirRegraSus(r: {
  readonly codigo: string;
  readonly descricao: string;
  readonly base: BaseRepasseSus;
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly percentualPago: number | null;
  readonly percentualDesconto: number | null;
  readonly valorFixo: number | null;
  readonly valorPonto: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}): ProblemaRegraSus[] {
  const p: ProblemaRegraSus[] = [];
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(r.codigo.trim())) p.push('codigo');
  if (r.descricao.trim().length < 3 || r.descricao.length > 150) p.push('descricao');
  if (!/^\d{4}-\d{2}-01$/.test(r.inicio) || (r.fim !== null && r.fim < r.inicio)) p.push('vigencia');
  const fora = (v: number | null) => v !== null && (v < 0 || v > 100);
  if (fora(r.percentualPago) || fora(r.percentualDesconto)) p.push('percentual');
  if (r.base === 'valor_fixo' && !(r.valorFixo !== null && r.valorFixo > 0)) p.push('valor-fixo');
  if (r.base === 'pontos' && !(r.valorPonto !== null && r.valorPonto > 0)) p.push('valor-ponto');
  if (r.procedimento !== null && r.grupo !== null) p.push('alvo-duplo');
  return p;
}

export type ProblemaRateioSadt = 'alvo' | 'peso' | 'teto' | 'vigencia';

export function conferirRateioSadt(r: {
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly usaPeso: boolean;
  readonly pesoPercentual: number | null;
  readonly tetoPercentual: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}): ProblemaRateioSadt[] {
  const p: ProblemaRateioSadt[] = [];
  if (r.procedimento === null && r.grupo === null) p.push('alvo');
  if (r.usaPeso && !(r.pesoPercentual !== null && r.pesoPercentual > 0 && r.pesoPercentual <= 100))
    p.push('peso');
  if (r.tetoPercentual !== null && (r.tetoPercentual <= 0 || r.tetoPercentual > 100)) p.push('teto');
  if (!/^\d{4}-\d{2}-01$/.test(r.inicio) || (r.fim !== null && r.fim < r.inicio)) p.push('vigencia');
  return p;
}
