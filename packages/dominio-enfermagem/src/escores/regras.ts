// Faixas versionadas das escalas (ficha do M45, regra 2; cap-05b §5.8; cap-11 §11.1). A versão 1 de cada escala é o
// padrão publicado (o mercado usa as mesmas); a gerência de enfermagem publica a versão 2 em diante (imutável, com a
// impressão SHA-256 do conteúdo canônico). A versão histórica do formulário de Braden em uso no estabelecimento (6-11
// alto, 12-14 moderado, 15-16 baixo) fica para ler os registros antigos e nunca vale em registro novo.
import type { EscalaEscore, FaixaEscore, RegraEscore } from '@sgh/contratos';

/** O intervalo possível do total de cada escala (a regra tem de cobrir tudo, sem buraco nem sobreposição). */
export const INTERVALO_ESCALA: Readonly<Record<EscalaEscore, readonly [number, number]>> = {
  news2: [0, 20],
  braden: [6, 23],
  morse: [0, 125],
  glasgow: [3, 15],
  rass: [-5, 4],
  camicu: [0, 1],
  dor: [0, 10],
  // W0-03, mercado M1 (o mínimo e o máximo somados dos itens publicados).
  caprini: [0, 78],
  padua: [0, 20],
  pews: [0, 13],
  bradenq: [7, 28],
  humpty: [7, 23],
  nips: [0, 7],
  flacc: [0, 10],
  meows: [0, 14],
};

const f = (codigo: string, rotulo: string, minimo: number, maximo: number, risco: boolean): FaixaEscore => ({
  codigo,
  rotulo,
  minimo,
  maximo,
  risco,
});

const padrao = (escala: EscalaEscore, origem: string, faixas: FaixaEscore[]): RegraEscore => ({
  escala,
  versao: 1,
  faixas,
  historica: false,
  origem,
  impressao: null,
  publicadoEm: null,
  autor: null,
});

/** A versão 1 de cada escala (padrão publicado). */
export const REGRAS_PADRAO: Readonly<Record<EscalaEscore, RegraEscore>> = {
  news2: padrao('news2', 'Royal College of Physicians, NEWS2 (2017)', [
    f('baixo', 'Risco baixo', 0, 4, false),
    f('medio', 'Risco médio', 5, 6, true),
    f('alto', 'Risco alto', 7, 20, true),
  ]),
  braden: padrao('braden', 'Bergstrom e Braden (1987); risco a partir de 18 (cap-05b §5.8)', [
    f('muitoAlto', 'Risco muito alto', 6, 9, true),
    f('alto', 'Risco alto', 10, 12, true),
    f('moderado', 'Risco moderado', 13, 14, true),
    f('baixo', 'Risco baixo', 15, 18, true),
    f('semRisco', 'Sem risco', 19, 23, false),
  ]),
  morse: padrao('morse', 'Morse (1989); 25 a 44 moderado, 45 ou mais alto (cap-05b §5.8)', [
    f('baixo', 'Risco baixo', 0, 24, false),
    f('moderado', 'Risco moderado', 25, 44, true),
    f('alto', 'Risco alto', 45, 125, true),
  ]),
  glasgow: padrao('glasgow', 'Teasdale e Jennett (1974)', [
    f('grave', 'Comprometimento grave', 3, 8, true),
    f('moderado', 'Comprometimento moderado', 9, 12, true),
    f('leve', 'Leve ou normal', 13, 15, false),
  ]),
  rass: padrao('rass', 'Sessler et al. (2002)', [
    f('sedacaoProfunda', 'Sedação profunda ou não desperta', -5, -4, true),
    f('sedacao', 'Sonolento ou sedação leve a moderada', -3, -1, false),
    f('alerta', 'Alerta e calmo', 0, 0, false),
    f('agitado', 'Inquieto a combativo', 1, 4, true),
  ]),
  camicu: padrao('camicu', 'Ely et al. (2001)', [
    f('negativo', 'Sem delirium', 0, 0, false),
    f('positivo', 'Delirium presente', 1, 1, true),
  ]),
  dor: padrao('dor', 'Escala numérica de dor (0 a 10)', [
    f('semDor', 'Sem dor', 0, 0, false),
    f('leve', 'Dor leve', 1, 3, false),
    f('moderada', 'Dor moderada', 4, 6, true),
    f('intensa', 'Dor intensa', 7, 10, true),
  ]),
  // ── W0-03, mercado M1: a versão 1 de cada escala nova é a faixa publicada; a gerência publica a 2 em diante. ──
  caprini: padrao('caprini', 'Caprini (2005); faixas de Gould et al., ACCP 9ª ed. (2012)', [
    f('muitoBaixo', 'Risco muito baixo', 0, 0, false),
    f('baixo', 'Risco baixo', 1, 2, true),
    f('moderado', 'Risco moderado', 3, 4, true),
    f('alto', 'Risco alto', 5, 78, true),
  ]),
  padua: padrao('padua', 'Barbar et al. (2010): 4 ou mais é alto risco', [
    f('baixo', 'Risco baixo', 0, 3, false),
    f('alto', 'Risco alto', 4, 20, true),
  ]),
  pews: padrao('pews', 'Monaghan (2005), PEWS de Brighton', [
    f('baixo', 'Sem alerta', 0, 2, false),
    f('medio', 'Alerta: avaliação médica', 3, 4, true),
    f('alto', 'Alerta alto: Time de Resposta Rápida', 5, 13, true),
  ]),
  bradenq: padrao('bradenq', 'Quigley e Curley (1996); corte de 16 (Curley et al., 2003)', [
    f('risco', 'Em risco de lesão por pressão', 7, 16, true),
    f('semRisco', 'Sem risco', 17, 28, false),
  ]),
  humpty: padrao('humpty', 'Hill-Rodriguez et al. (2009): 12 ou mais é alto risco', [
    f('baixo', 'Risco baixo', 7, 11, false),
    f('alto', 'Risco alto', 12, 23, true),
  ]),
  nips: padrao('nips', 'Lawrence et al. (1993): mais de 3 indica dor', [
    f('semDor', 'Sem dor ou desconforto leve', 0, 3, false),
    f('dor', 'Dor', 4, 7, true),
  ]),
  flacc: padrao('flacc', 'Merkel et al. (1997)', [
    f('relaxado', 'Relaxado e confortável', 0, 0, false),
    f('leve', 'Desconforto leve', 1, 3, false),
    f('moderada', 'Dor moderada', 4, 6, true),
    f('intensa', 'Dor intensa', 7, 10, true),
  ]),
  meows: padrao('meows', 'Singh et al. (2012): um vermelho ou dois amarelos', [
    f('semGatilho', 'Sem gatilho', 0, 1, false),
    f('gatilho', 'Gatilho: avaliação médica urgente', 2, 14, true),
  ]),
};

/** A versão histórica do formulário de Braden em uso (só leitura dos registros antigos). */
export const BRADEN_HISTORICA_FORMULARIO: RegraEscore = {
  escala: 'braden',
  versao: 0,
  faixas: [
    f('alto', 'Risco alto', 6, 11, true),
    f('moderado', 'Risco moderado', 12, 14, true),
    f('baixo', 'Risco baixo', 15, 16, true),
    f('semRisco', 'Sem risco', 17, 23, false),
  ],
  historica: true,
  origem: 'faixas do formulário de Braden em uso no estabelecimento (cap-11 §11.1)',
  impressao: null,
  publicadoEm: null,
  autor: null,
};

/** As faixas da dor comportamental (BPS de 3 a 12; mais de 5 é dor significativa). Fixas: não são publicadas. */
export const FAIXAS_DOR_COMPORTAMENTAL: readonly FaixaEscore[] = [
  f('semDor', 'Sem dor', 3, 3, false),
  f('leve', 'Dor leve', 4, 5, false),
  f('significativa', 'Dor significativa', 6, 12, true),
];

/** A faixa do total na regra (null quando o total está fora: a regra não cobre o total). */
export function faixaDe(faixas: readonly FaixaEscore[], total: number): FaixaEscore | null {
  return faixas.find((x) => total >= x.minimo && total <= x.maximo) ?? null;
}

/**
 * Confere as faixas de uma versão nova: ordenadas, sem sobreposição nem buraco, cobrindo o intervalo da escala, códigos
 * únicos e ao menos uma de risco e uma sem risco.
 */
export function problemasDasFaixas(escala: EscalaEscore, faixas: readonly FaixaEscore[]): string[] {
  const p: string[] = [];
  const [min, max] = INTERVALO_ESCALA[escala];
  const ord = [...faixas].sort((a, b) => a.minimo - b.minimo);
  if (new Set(faixas.map((x) => x.codigo)).size !== faixas.length) p.push('Há código de faixa repetido.');
  if (ord.length === 0) return ['Informe as faixas.'];
  if (ord[0]!.minimo !== min) p.push(`A primeira faixa tem de começar em ${min}.`);
  if (ord.at(-1)!.maximo !== max) p.push(`A última faixa tem de terminar em ${max}.`);
  for (let i = 1; i < ord.length; i++) {
    const a = ord[i - 1]!;
    const b = ord[i]!;
    if (b.minimo <= a.maximo) p.push(`As faixas "${a.rotulo}" e "${b.rotulo}" se sobrepõem.`);
    else if (b.minimo !== a.maximo + 1) p.push(`Há um intervalo sem faixa entre ${a.maximo} e ${b.minimo}.`);
  }
  if (!faixas.some((x) => x.risco)) p.push('Marque ao menos uma faixa de risco.');
  if (!faixas.some((x) => !x.risco)) p.push('Deixe ao menos uma faixa sem risco.');
  return p;
}

/** O conteúdo canônico das faixas (a impressão SHA-256 é calculada sobre ele): ordenado e sem espaços. */
export function conteudoCanonicoFaixas(escala: EscalaEscore, faixas: readonly FaixaEscore[]): string {
  const ord = [...faixas]
    .sort((a, b) => a.minimo - b.minimo)
    .map((x) => ({ codigo: x.codigo, maximo: x.maximo, minimo: x.minimo, risco: x.risco, rotulo: x.rotulo }));
  return JSON.stringify({ escala, faixas: ord });
}

/** A regra vigente de cada escala: a de maior versão publicada, ou a versão 1 do padrão. */
export function regrasVigentes(publicadas: readonly RegraEscore[]): Record<EscalaEscore, RegraEscore> {
  const r = { ...REGRAS_PADRAO } as Record<EscalaEscore, RegraEscore>;
  for (const x of publicadas) if (!x.historica && x.versao > (r[x.escala]?.versao ?? 0)) r[x.escala] = x;
  return r;
}
