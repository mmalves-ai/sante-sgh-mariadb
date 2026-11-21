// Ficha anestésica (ficha do M46, regra 3; Resolução CFM 2.174/2017, anexo da ficha; Lei 12.842/2013): sinais a cada
// 5 minutos, fármacos e gases com dose e hora, fluidos e hemoderivados que vão ao balanço (M45) uma vez só, marcos
// de tempo em ordem, transferência de responsabilidade entre anestesistas e a assinatura só pelo anestesista da
// cirurgia. Regras puras: a gravação (regra 12) reconfere no banco o que vale.
import {
  FLUIDOS_FICHA,
  INTERVALO_SINAIS_FICHA_MIN,
  MARCOS_FICHA,
  SINAIS_FICHA,
  SINAIS_FICHA_OBRIGATORIOS,
  type LacunaSinal,
  type MarcoFicha,
  type ParteFicha,
  type RecusaAnestesia,
  type ResponsavelFicha,
  type SinalFicha,
  type SituacaoFicha,
} from '@sgh/contratos';
import { instanteDosMinutos, minutosDoInstante } from './instante.js';

export type Recusa = { readonly ok: false; readonly codigo: RecusaAnestesia };
export type Aceite = { readonly ok: true };
const recusa = (codigo: RecusaAnestesia): Recusa => ({ ok: false, codigo });
const ACEITE: Aceite = { ok: true };

// ── Sinais ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Faixa plausível do sinal (fora dela é erro de digitação e é recusado). */
export function validarSinalFicha(tipo: string, valor: number): Aceite | Recusa {
  const d = (SINAIS_FICHA as Record<string, (typeof SINAIS_FICHA)[SinalFicha] | undefined>)[tipo];
  if (!d || !Number.isFinite(valor) || valor < d.minimo || valor > d.maximo)
    return recusa('ficha-sinal-implausivel');
  return ACEITE;
}

export interface SinalLancado {
  readonly tipo: SinalFicha;
  readonly momento: string;
}

export interface Intervalo {
  readonly inicio: string;
  readonly fim: string;
}

/**
 * Lacunas da grade de sinais (regra 3): a janela [inicio, fim) é cortada em fatias de 5 minutos; cada fatia sem
 * registro de algum sinal obrigatório é uma lacuna. Fatias vizinhas com os mesmos sinais em falta viram uma lacuna
 * só. Lacuna inteiramente coberta por uma justificativa registrada fica marcada como justificada.
 */
export function lacunasDeSinais(
  sinais: readonly SinalLancado[],
  janela: Intervalo,
  justificativas: readonly Intervalo[] = [],
  intervaloMin: number = INTERVALO_SINAIS_FICHA_MIN,
  obrigatorios: readonly SinalFicha[] = SINAIS_FICHA_OBRIGATORIOS,
): LacunaSinal[] {
  const ini = minutosDoInstante(janela.inicio);
  const fim = minutosDoInstante(janela.fim);
  const porTipo = new Map<SinalFicha, number[]>();
  for (const s of sinais) {
    const l = porTipo.get(s.tipo) ?? [];
    l.push(minutosDoInstante(s.momento));
    porTipo.set(s.tipo, l);
  }
  const just = justificativas.map((j) => [minutosDoInstante(j.inicio), minutosDoInstante(j.fim)] as const);
  const brutas: { ini: number; fim: number; sinais: SinalFicha[] }[] = [];
  for (let t = ini; t < fim; t += intervaloMin) {
    const f = Math.min(t + intervaloMin, fim);
    const faltam = obrigatorios.filter((tipo) => !(porTipo.get(tipo) ?? []).some((m) => m >= t && m < f));
    if (faltam.length === 0) continue;
    const ultima = brutas.at(-1);
    if (ultima && ultima.fim === t && ultima.sinais.join() === faltam.join()) ultima.fim = f;
    else brutas.push({ ini: t, fim: f, sinais: faltam });
  }
  return brutas.map((b) => ({
    inicio: instanteDosMinutos(b.ini),
    fim: instanteDosMinutos(b.fim),
    sinais: b.sinais,
    justificada: just.some(([a, z]) => a <= b.ini && z >= b.fim),
  }));
}

// ── Marcos de tempo e janela ─────────────────────────────────────────────────────────────────────────────────────

export type Marcos = Readonly<Partial<Record<MarcoFicha, string>>>;

const ORDEM_MARCOS = MARCOS_FICHA.map((m) => m.codigo) as MarcoFicha[];

/** Um marco por vez, sem repetir, e na ordem: nenhum marco anterior depois dele nem posterior antes dele. */
export function conferirMarco(marcos: Marcos, marco: MarcoFicha, momento: string): Aceite | Recusa {
  if (marcos[marco]) return recusa('ficha-marco-repetido');
  const m = minutosDoInstante(momento);
  const i = ORDEM_MARCOS.indexOf(marco);
  for (const [j, outro] of ORDEM_MARCOS.entries()) {
    const v = marcos[outro];
    if (!v || j === i) continue;
    const mv = minutosDoInstante(v);
    if ((j < i && mv > m) || (j > i && mv < m)) return recusa('ficha-marco-fora-de-ordem');
  }
  return ACEITE;
}

/** A janela em que a ficha aceita lançamentos: da entrada na sala (ou início da anestesia) à saída (se houver). */
export function janelaDaFicha(marcos: Marcos): { inicio: number | null; fim: number | null } {
  const ini = marcos.entradaSala ?? marcos.inicioAnestesia ?? null;
  const fim = marcos.saidaSala ?? null;
  return { inicio: ini ? minutosDoInstante(ini) : null, fim: fim ? minutosDoInstante(fim) : null };
}

/** A janela da grade de sinais: do início ao fim da anestesia (sem fim, até "agora"). */
export function janelaDosSinais(marcos: Marcos, agora: string): Intervalo | null {
  if (!marcos.inicioAnestesia) return null;
  return { inicio: marcos.inicioAnestesia, fim: marcos.fimAnestesia ?? agora };
}

// ── Lançamentos ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface LancamentoParaConferir {
  readonly parte: ParteFicha;
  readonly momento: string;
  readonly fim?: string | null;
  readonly tipo?: string;
  readonly valor?: number;
}

/** Conferência de um lote: ficha assinada ou encerrada não recebe lançamento; cada um dentro da janela e plausível. */
export function conferirLancamentos(
  situacao: SituacaoFicha,
  marcos: Marcos,
  lancamentos: readonly LancamentoParaConferir[],
): Aceite | (Recusa & { readonly indice: number }) {
  const geral =
    situacao === 'assinada' ? 'ficha-assinada' : situacao === 'encerrada' ? 'ficha-encerrada' : null;
  if (geral) return { ok: false, codigo: geral, indice: -1 };
  const { inicio, fim } = janelaDaFicha(marcos);
  for (const [indice, l] of lancamentos.entries()) {
    const m = minutosDoInstante(l.momento);
    const f = l.fim ? minutosDoInstante(l.fim) : null;
    if ((inicio !== null && m < inicio) || (fim !== null && m > fim) || (f !== null && f < m))
      return { ok: false, codigo: 'ficha-fora-da-janela', indice };
    if (l.parte === 'sinal') {
      const r = validarSinalFicha(l.tipo ?? '', l.valor ?? Number.NaN);
      if (!r.ok) return { ...r, indice };
    }
  }
  return ACEITE;
}

// ── Fluidos, perdas e o balanço (M45) ────────────────────────────────────────────────────────────────────────────

export interface FluidoLancado {
  readonly id: number;
  readonly parte: 'fluido' | 'perda';
  readonly tipo: string;
  readonly volumeMl: number;
  readonly momento: string;
  readonly fim: string | null;
}

const HEMOCOMPONENTES = new Set<string>(FLUIDOS_FICHA.filter((f) => f.hemocomponente).map((f) => f.codigo));

export function totaisDaFicha(itens: readonly FluidoLancado[]): {
  ganhosMl: number;
  perdasMl: number;
  hemocomponentesMl: number;
} {
  let ganhosMl = 0;
  let perdasMl = 0;
  let hemocomponentesMl = 0;
  for (const i of itens) {
    if (i.parte === 'perda') perdasMl += i.volumeMl;
    else {
      ganhosMl += i.volumeMl;
      if (HEMOCOMPONENTES.has(i.tipo)) hemocomponentesMl += i.volumeMl;
    }
  }
  return { ganhosMl, perdasMl, hemocomponentesMl };
}

/** Chave idempotente do item do balanço: a mesma chave nunca entra duas vezes (regra 3: "uma vez só"). */
export function chaveBalanco(ficha: number, lancamento: number): string {
  return `cc-fa:${ficha}:${lancamento}`;
}

export interface ItemParaBalanco {
  readonly chave: string;
  readonly direcao: 'ganho' | 'perda';
  readonly tipo: string;
  readonly volumeMl: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly hemocomponente: boolean;
}

/** Os fluidos e as perdas da ficha que ainda não foram ao balanço hídrico (M45). */
export function itensParaBalanco(
  ficha: number,
  itens: readonly FluidoLancado[],
  jaNoBalanco: ReadonlySet<string>,
): ItemParaBalanco[] {
  return itens
    .map((i) => ({ i, chave: chaveBalanco(ficha, i.id) }))
    .filter(({ chave }) => !jaNoBalanco.has(chave))
    .map(({ i, chave }) => ({
      chave,
      direcao: i.parte === 'perda' ? ('perda' as const) : ('ganho' as const),
      tipo: i.tipo,
      volumeMl: i.volumeMl,
      inicio: i.momento,
      fim: i.fim,
      hemocomponente: i.parte === 'fluido' && HEMOCOMPONENTES.has(i.tipo),
    }));
}

// ── Responsabilidade e passagem entre anestesistas ───────────────────────────────────────────────────────────────

export interface Passagem {
  readonly de: number;
  readonly para: number;
  readonly momento: string;
}

/** Linha de responsabilidade: o anestesista que abriu a ficha e cada passagem, em ordem. */
export function linhaDeResponsabilidade(
  inicial: { readonly anestesista: number; readonly de: string },
  passagens: readonly Passagem[],
): ResponsavelFicha[] {
  const ordenadas = [...passagens].sort(
    (a, b) => minutosDoInstante(a.momento) - minutosDoInstante(b.momento),
  );
  const linha: { anestesista: number; de: string; ate: string | null }[] = [{ ...inicial, ate: null }];
  for (const p of ordenadas) {
    linha.at(-1)!.ate = p.momento;
    linha.push({ anestesista: p.para, de: p.momento, ate: null });
  }
  return linha;
}

export function responsavelAtual(linha: readonly ResponsavelFicha[]): number | null {
  return linha.at(-1)?.anestesista ?? null;
}

/** Só o responsável do momento passa; para outro anestesista; não antes de ter assumido. */
export function conferirPassagem(
  linha: readonly ResponsavelFicha[],
  quem: number,
  para: number,
  momento: string,
): Aceite | Recusa {
  const atual = linha.at(-1);
  if (!atual || atual.anestesista !== quem) return recusa('ficha-passagem-nao-responsavel');
  if (para === quem) return recusa('ficha-passagem-mesmo-anestesista');
  if (minutosDoInstante(momento) < minutosDoInstante(atual.de)) return recusa('ficha-passagem-fora-de-ordem');
  return ACEITE;
}

// ── Assinatura ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface EquipeLancada {
  readonly profissional: number;
  readonly funcao: number;
}

/**
 * Anestesistas da cirurgia: o do agendamento (fora o sentinela), os da equipe lançada com a função de anestesista
 * (a função achada pelo nome; o id é do estabelecimento) e quem teve a responsabilidade na ficha.
 */
export function anestesistasDaCirurgia(e: {
  readonly agendado: number | null;
  readonly equipe: readonly EquipeLancada[];
  readonly funcaoAnestesista: number | null;
  readonly responsaveis: readonly ResponsavelFicha[];
}): Set<number> {
  const s = new Set<number>();
  if (e.agendado !== null) s.add(e.agendado);
  for (const m of e.equipe)
    if (e.funcaoAnestesista !== null && m.funcao === e.funcaoAnestesista) s.add(m.profissional);
  for (const r of e.responsaveis) s.add(r.anestesista);
  return s;
}

export interface FichaParaAssinar {
  readonly situacao: SituacaoFicha;
  readonly marcos: Marcos;
  readonly lacunas: readonly LacunaSinal[];
  /** Gases e infusões contínuas abertos (sem fim). */
  readonly abertos: number;
}

/** O que impede a assinatura agora (vazio = pode assinar). */
export function pendenciasDeAssinatura(
  ficha: FichaParaAssinar,
  assinante: number | null,
  anestesistas: ReadonlySet<number>,
): RecusaAnestesia[] {
  const p: RecusaAnestesia[] = [];
  if (ficha.situacao === 'assinada') p.push('ficha-assinada');
  if (!ficha.marcos.fimAnestesia) p.push('ficha-sem-fim-anestesia');
  if (ficha.lacunas.some((l) => !l.justificada)) p.push('ficha-lacuna-sinais');
  if (ficha.abertos > 0) p.push('ficha-gas-sem-fim');
  if (assinante === null || !anestesistas.has(assinante)) p.push('ficha-nao-e-anestesista');
  return p;
}

/** Situação depois de um marco: o fim da anestesia encerra a ficha para lançamentos (só falta assinar). */
export function situacaoDepoisDoMarco(atual: SituacaoFicha, marco: MarcoFicha): SituacaoFicha {
  if (atual === 'assinada') return atual;
  return marco === 'fimAnestesia' ? 'encerrada' : atual;
}
