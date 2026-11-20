// Terapia nutricional enteral e parenteral pela EMTN (M45, etapa 5; ficha, seções 4 e 5; cap-05b §5.9; cap-06a §6.3;
// RDC 503/2021): a meta calórica e proteica pelo peso de referência (kcal/kg e g/kg), o volume-alvo pela densidade da
// fórmula, e o acompanhamento do dia com o percentual atingido (o volume infundido vem da checagem da dieta quando ela
// traz a quantidade; senão é informado e marcado como tal). Abaixo do percentual adequado, o dia pede o motivo. O tempo
// até iniciar a terapia (meta de 24 a 48 h) é da admissão à primeira checagem administrada. Puro: sem banco.
// W0-05 (ficha EMTN completa): a meta vale para a enteral e para a parenteral; o volume infundido vem da checagem da
// dieta (enteral) e do balanço hídrico (parenteral), sem digitação; o percentual é diário e acumulado (com as parcelas);
// o alerta de meta não atingida acende com os dias seguidos abaixo do adequado (padrão 3); a avaliação farmacêutica da
// formulação da NPT (Portaria SVS/MS 272/1998, anexo II: o farmacêutico avalia a prescrição quanto à adequação,
// concentração, compatibilidade e estabilidade) recusa o acesso periférico acima de 900 mOsm/L (BRASPEN, Diretriz de
// Terapia Nutricional 2023).
import type {
  AlertaMeta,
  AvaliarNptEntrada,
  MotivoMetaNaoAtingida,
  OrigemVolume,
  ProgressoMeta,
  ViaTerapiaNutricional,
  VolumeBalanco,
  VolumeChecado,
} from '@sgh/contratos';
import { minutosEntre } from './triagem.js';

export type CodigoRecusaTerapia =
  | 'meta-invalida'
  | 'volume-ausente'
  | 'motivo-obrigatorio'
  | 'meta-de-outra-internacao'
  | 'dieta-nao-enteral'
  | 'npt-osmolaridade-periferica'
  | 'npt-parecer-sem-observacao'
  | 'npt-adequada-com-restricao'
  | 'volume-nao-informado';

export class ErroTerapia extends Error {
  override readonly name = 'ErroTerapia';
  readonly codigo: CodigoRecusaTerapia;
  constructor(codigo: CodigoRecusaTerapia, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const uma = (v: number) => Math.round(v * 10) / 10;

export interface EntradaMeta {
  readonly pesoKg: number;
  readonly kcalPorKg: number;
  readonly proteinaGPorKg: number;
  readonly densidadeKcalMl: number;
  readonly proteinaGL: number;
}

export interface MetaCalculada {
  readonly metaKcal: number;
  readonly metaProteinaG: number;
  readonly metaVolumeMl: number;
}

/** Faixas aceitas (ESPEN/BRASPEN; fora delas é erro de digitação): 10 a 50 kcal/kg e 0,5 a 3 g/kg de proteína. */
export const FAIXA_KCAL_KG: readonly [number, number] = [10, 50];
export const FAIXA_PTN_G_KG: readonly [number, number] = [0.5, 3];

export function calcularMeta(e: EntradaMeta): MetaCalculada {
  const [k0, k1] = FAIXA_KCAL_KG;
  const [p0, p1] = FAIXA_PTN_G_KG;
  if (e.kcalPorKg < k0 || e.kcalPorKg > k1)
    throw new ErroTerapia('meta-invalida', `A meta calórica fica entre ${k0} e ${k1} kcal/kg/dia.`);
  if (e.proteinaGPorKg < p0 || e.proteinaGPorKg > p1)
    throw new ErroTerapia(
      'meta-invalida',
      `A meta proteica fica entre ${String(p0).replace('.', ',')} e ${p1} g/kg/dia.`,
    );
  if (!(e.pesoKg > 0) || !(e.densidadeKcalMl > 0))
    throw new ErroTerapia('meta-invalida', 'Informe o peso de referência e a densidade calórica da fórmula.');
  const metaKcal = uma(e.pesoKg * e.kcalPorKg);
  return {
    metaKcal,
    metaProteinaG: uma(e.pesoKg * e.proteinaGPorKg),
    metaVolumeMl: Math.round(metaKcal / e.densidadeKcalMl),
  };
}

export interface MetaParaAcompanhar extends MetaCalculada {
  readonly densidadeKcalMl: number;
  readonly proteinaGL: number;
}

export interface AcompanhamentoCalculado {
  readonly volumeInfundidoMl: number;
  readonly origemVolume: OrigemVolume;
  readonly kcalAtingida: number;
  readonly proteinaAtingidaG: number;
  readonly pctKcal: number;
  readonly pctProteina: number;
  /** Abaixo do adequado: o dia pede o motivo. */
  readonly abaixoDoAdequado: boolean;
}

/**
 * O volume do dia: o da checagem quando ela traz a quantidade administrada (sem redigitar); senão, o informado (marcado
 * como informado). Sem nenhum dos dois, recusa.
 */
export function volumeDoDia(
  checado: Pick<VolumeChecado, 'volumeMl'> | null,
  informadoMl: number | null,
): { volumeMl: number; origem: 'checagem' | 'informado' } {
  if (checado && checado.volumeMl !== null) return { volumeMl: checado.volumeMl, origem: 'checagem' };
  if (informadoMl !== null) return { volumeMl: informadoMl, origem: 'informado' };
  throw new ErroTerapia(
    'volume-ausente',
    'A checagem do dia não traz o volume administrado: informe o volume infundido.',
  );
}

export function calcularAcompanhamento(
  meta: MetaParaAcompanhar,
  volume: { volumeMl: number; origem: OrigemVolume },
  adequadaPct: number,
): AcompanhamentoCalculado {
  const kcal = uma(volume.volumeMl * meta.densidadeKcalMl);
  const ptn = uma((volume.volumeMl * meta.proteinaGL) / 1000);
  const pctKcal = uma((kcal / meta.metaKcal) * 100);
  const pctProteina = uma((ptn / meta.metaProteinaG) * 100);
  return {
    volumeInfundidoMl: uma(volume.volumeMl),
    origemVolume: volume.origem,
    kcalAtingida: kcal,
    proteinaAtingidaG: ptn,
    pctKcal,
    pctProteina,
    abaixoDoAdequado: pctKcal < adequadaPct || pctProteina < adequadaPct,
  };
}

/** Abaixo do adequado sem motivo é recusado (o indicador de adequação precisa do motivo). */
export function exigirMotivo(a: AcompanhamentoCalculado, motivo: MotivoMetaNaoAtingida | null): void {
  if (a.abaixoDoAdequado && motivo === null)
    throw new ErroTerapia(
      'motivo-obrigatorio',
      `A meta do dia ficou abaixo do adequado (${String(a.pctKcal).replace('.', ',')}% das calorias e ${String(a.pctProteina).replace('.', ',')}% da proteína): informe o motivo.`,
    );
}

/** Horas da admissão à primeira checagem administrada da dieta enteral; null sem início. */
export function horasAteIniciar(admissao: string, primeiraAdministrada: string | null): number | null {
  if (!primeiraAdministrada) return null;
  return Math.max(0, Math.floor(minutosEntre(admissao, primeiraAdministrada) / 60));
}

/** O volume checado por dia a partir das checagens da dieta (administradas e previstas). */
export function volumesPorDia(
  checagens: readonly {
    readonly previsto: string;
    readonly situacao: string;
    readonly quantidade: number | null;
  }[],
): VolumeChecado[] {
  const dias = new Map<string, { adm: number; prev: number; vol: number | null }>();
  for (const c of checagens) {
    const d = c.previsto.slice(0, 10);
    const x = dias.get(d) ?? { adm: 0, prev: 0, vol: null };
    x.prev += 1;
    if (c.situacao === 'A') {
      x.adm += 1;
      if (c.quantidade !== null && c.quantidade > 0) x.vol = uma((x.vol ?? 0) + c.quantidade);
    }
    dias.set(d, x);
  }
  return [...dias.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([data, x]) => ({
      data,
      horariosAdministrados: x.adm,
      horariosPrevistos: x.prev,
      volumeMl: x.vol,
    }));
}

// ── W0-05: ficha EMTN completa ───────────────────────────────────────────────────────────────────

/**
 * O volume do dia pela via: a enteral lê a checagem da dieta; a parenteral lê o balanço hídrico (os ganhos do grupo da
 * NPT). O informado à mão só entra quando a fonte da via não traz o volume (marcado como informado).
 */
export function volumeDoDiaPorVia(
  via: ViaTerapiaNutricional,
  fontes: {
    readonly checado: Pick<VolumeChecado, 'volumeMl'> | null;
    readonly balanco: Pick<VolumeBalanco, 'volumeMl' | 'lancamentos'> | null;
    readonly informadoMl: number | null;
  },
): { volumeMl: number; origem: OrigemVolume } {
  if (via === 'parenteral') {
    if (fontes.balanco && fontes.balanco.lancamentos > 0)
      return { volumeMl: fontes.balanco.volumeMl, origem: 'balanco' };
    if (fontes.informadoMl !== null) return { volumeMl: fontes.informadoMl, origem: 'informado' };
    throw new ErroTerapia(
      'volume-ausente',
      'O balanço hídrico do dia não tem o ganho da parenteral: lance no balanço ou informe o volume infundido.',
    );
  }
  return volumeDoDia(fontes.checado, fontes.informadoMl);
}

/** Expressão dos grupos de ganho do balanço que são a nutrição parenteral (o nome do grupo do cadastro). */
export const GRUPO_PARENTERAL = /parenteral|\bNPT\b/i;

/**
 * O volume da parenteral por dia a partir dos lançamentos do balanço: os ganhos do grupo da NPT, sem os estornados e sem
 * os próprios estornos; o dia é o da hora real do lançamento. Mais recente primeiro.
 */
export function volumesParenteraisDoBalanco(
  lancamentos: readonly {
    readonly sentido: string;
    readonly origem: string;
    readonly grupo: number | null;
    readonly volumeMl: number;
    readonly horaReal: string;
    readonly estornadoPor: number | null;
  }[],
  grupos: readonly { readonly codigo: number; readonly nome: string }[],
): VolumeBalanco[] {
  const npt = new Set(grupos.filter((g) => GRUPO_PARENTERAL.test(g.nome)).map((g) => g.codigo));
  const dias = new Map<string, { lancamentos: number; volumeMl: number }>();
  for (const l of lancamentos) {
    if (l.sentido !== 'ganho' || l.origem === 'estorno' || l.estornadoPor !== null) continue;
    if (l.grupo === null || !npt.has(l.grupo)) continue;
    const d = l.horaReal.slice(0, 10);
    const x = dias.get(d) ?? { lancamentos: 0, volumeMl: 0 };
    x.lancamentos += 1;
    x.volumeMl = uma(x.volumeMl + l.volumeMl);
    dias.set(d, x);
  }
  return [...dias.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([data, x]) => ({ data, ...x }));
}

/**
 * O percentual atingido por dia e o acumulado (do primeiro dia até o dia), com as parcelas: cada dia usa a meta da
 * versão em que foi registrado. Com mais de uma terapia vigente (a enteral e a NPT complementar), o dia soma as metas e
 * o atingido de cada via (as parcelas ficam em `vias`); dentro da mesma via, um acompanhamento por dia (o mais recente
 * vale, quando houver dois ativos). Em ordem de data.
 */
export function progressoDaTerapia(
  acompanhamentos: readonly {
    readonly data: string;
    readonly em: string;
    readonly kcalAtingida: number;
    readonly proteinaAtingidaG: number;
    readonly meta: { readonly metaKcal: number; readonly metaProteinaG: number; readonly via?: string };
  }[],
  adequadaPct: number,
): ProgressoMeta[] {
  const porDiaVia = new Map<string, (typeof acompanhamentos)[number]>();
  for (const a of acompanhamentos) {
    const chave = `${a.data}|${a.meta.via ?? ''}`;
    const x = porDiaVia.get(chave);
    if (!x || a.em > x.em) porDiaVia.set(chave, a);
  }
  const porDia = new Map<string, (typeof acompanhamentos)[number][]>();
  for (const a of porDiaVia.values()) porDia.set(a.data, [...(porDia.get(a.data) ?? []), a]);
  const pct = (a: number, m: number) => (m > 0 ? uma((a / m) * 100) : 0);
  let kM = 0;
  let kA = 0;
  let pM = 0;
  let pA = 0;
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, doDia]) => {
      const vias = [...doDia]
        .sort((a, b) => (a.meta.via ?? '').localeCompare(b.meta.via ?? ''))
        .map((a) => ({
          via: a.meta.via ?? '',
          kcalMeta: a.meta.metaKcal,
          kcalAtingida: a.kcalAtingida,
          ptnMetaG: a.meta.metaProteinaG,
          ptnAtingidaG: a.proteinaAtingidaG,
        }));
      const soma = (f: (v: (typeof vias)[number]) => number) => uma(vias.reduce((t, v) => t + f(v), 0));
      const kcalMeta = soma((v) => v.kcalMeta);
      const kcalAtingida = soma((v) => v.kcalAtingida);
      const ptnMetaG = soma((v) => v.ptnMetaG);
      const ptnAtingidaG = soma((v) => v.ptnAtingidaG);
      kM = uma(kM + kcalMeta);
      kA = uma(kA + kcalAtingida);
      pM = uma(pM + ptnMetaG);
      pA = uma(pA + ptnAtingidaG);
      const pctKcal = pct(kcalAtingida, kcalMeta);
      const pctProteina = pct(ptnAtingidaG, ptnMetaG);
      return {
        data,
        kcalMeta,
        kcalAtingida,
        ptnMetaG,
        ptnAtingidaG,
        pctKcal,
        pctProteina,
        acumuladoKcalMeta: kM,
        acumuladoKcalAtingida: kA,
        acumuladoPtnMetaG: pM,
        acumuladoPtnAtingidaG: pA,
        acumuladoPctKcal: pct(kA, kM),
        acumuladoPctProteina: pct(pA, pM),
        abaixoDoAdequado: pctKcal < adequadaPct || pctProteina < adequadaPct,
        vias,
      };
    });
}

const diaSeguinte = (d: string): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/**
 * O alerta de meta não atingida: os dias seguidos (de calendário) abaixo do adequado que terminam no último dia com
 * acompanhamento. Acende com `dias` ou mais (padrão 3); null sem alerta. Um dia sem acompanhamento quebra a sequência.
 */
export function alertaMetaNaoAtingida(progresso: readonly ProgressoMeta[], dias = 3): AlertaMeta | null {
  const ordem = [...progresso].sort((a, b) => a.data.localeCompare(b.data));
  let seguidos: ProgressoMeta[] = [];
  for (const p of ordem) {
    const anterior = seguidos[seguidos.length - 1];
    if (!p.abaixoDoAdequado) seguidos = [];
    else if (anterior && diaSeguinte(anterior.data) === p.data) seguidos.push(p);
    else seguidos = [p];
  }
  const ultimo = ordem[ordem.length - 1];
  if (!ultimo || seguidos.length < dias || seguidos[seguidos.length - 1] !== ultimo) return null;
  const desde = seguidos[0]!.data;
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return {
    dias: seguidos.length,
    desde,
    ate: ultimo.data,
    mensagem: `Meta não atingida há ${seguidos.length} dias seguidos (${br(desde)} a ${br(ultimo.data)}): reavalie a terapia com a EMTN.`,
  };
}

/** Osmolaridade máxima da NPT por acesso periférico (mOsm/L). */
export const OSMOLARIDADE_MAXIMA_PERIFERICA = 900;

/** Confere a avaliação farmacêutica da formulação da NPT. */
export function conferirAvaliacaoNpt(a: AvaliarNptEntrada): void {
  if (
    a.parecer === 'adequada' &&
    a.acesso === 'periferico' &&
    a.osmolaridade > OSMOLARIDADE_MAXIMA_PERIFERICA
  )
    throw new ErroTerapia(
      'npt-osmolaridade-periferica',
      `Osmolaridade de ${String(a.osmolaridade).replace('.', ',')} mOsm/L acima do limite do acesso periférico (${OSMOLARIDADE_MAXIMA_PERIFERICA} mOsm/L): a formulação não é adequada para esse acesso.`,
    );
  if (a.parecer === 'adequada' && (!a.estabilidade || !a.compatibilidade))
    throw new ErroTerapia(
      'npt-adequada-com-restricao',
      'A formulação sem estabilidade ou sem compatibilidade conferida não é adequada: escolha "ajustar" ou "inadequada".',
    );
  if (a.parecer !== 'adequada' && !a.observacao)
    throw new ErroTerapia(
      'npt-parecer-sem-observacao',
      'Diga o que ajustar ou por que a formulação é inadequada (observação obrigatória).',
    );
}

/** Só o volume informado à mão se retifica: o da checagem ou do balanço se corrige na fonte. */
export function conferirRetificacaoVolume(origem: OrigemVolume): void {
  if (origem !== 'informado')
    throw new ErroTerapia(
      'volume-nao-informado',
      origem === 'checagem'
        ? 'O volume deste dia veio da checagem da dieta: corrija a checagem (ou estorne este acompanhamento com o motivo).'
        : 'O volume deste dia veio do balanço hídrico: estorne o lançamento no balanço (ou estorne este acompanhamento com o motivo).',
    );
}
