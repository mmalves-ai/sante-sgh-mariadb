// NEWS2 (Royal College of Physicians, 2017; ficha do M45, regra 1; cap-05b §5.8): calculado a cada aferição dos sete
// parâmetros (frequência respiratória, saturação na escala 1 ou 2, ar ou oxigênio, pressão sistólica, pulso, nível de
// consciência ACVPU e temperatura). Conduta: 5 a 6, ou 3 num parâmetro isolado, avisa o médico; 7 ou mais aciona o Time
// de Resposta Rápida; suspeita de infecção com 5 ou mais sugere o protocolo de sepse (o relógio do pronto atendimento).
import type { FaixaEscore, GatilhoEscore, RegraEscore } from '@sgh/contratos';
import { faixaDe, REGRAS_PADRAO } from './regras.js';

export interface SinaisNews2 {
  readonly fr: number;
  readonly spo2: number;
  /** Oxigênio suplementar em L/min (0 = ar ambiente). */
  readonly o2: number;
  readonly pas: number;
  readonly fc: number;
  /** 0 alerta; 1 confusão nova; 2 voz; 3 dor; 4 sem resposta. */
  readonly acvpu: number;
  readonly temperatura: number;
}

export interface ParcelaNews2 {
  readonly parametro: keyof SinaisNews2;
  readonly valor: number;
  readonly pontos: number;
}

export interface ResultadoNews2 {
  readonly total: number;
  readonly parcelas: readonly ParcelaNews2[];
  /** Algum parâmetro isolado com 3 pontos (risco "baixo a médio" da publicação: avisa o médico). */
  readonly parametroIsoladoTres: boolean;
  readonly faixa: FaixaEscore;
  readonly gatilho: GatilhoEscore;
  /** Suspeita de infecção com 5 ou mais: sugerir o protocolo de sepse (mesmo quando o gatilho é o TRR). */
  readonly sugereSepse: boolean;
  readonly conduta: string;
}

/** Pontos pelos limites superiores (inclusive): [limite, pontos], o último sem limite. */
function porLimites(valor: number, limites: readonly (readonly [number, number])[], acima: number): number {
  for (const [lim, pts] of limites) if (valor <= lim) return pts;
  return acima;
}

export const pontosFr = (v: number) =>
  porLimites(
    v,
    [
      [8, 3],
      [11, 1],
      [20, 0],
      [24, 2],
    ],
    3,
  );

/** Saturação: escala 1 (padrão) ou escala 2 (insuficiência respiratória hipercápnica), com o oxigênio. */
export function pontosSpo2(v: number, escala: 1 | 2, emOxigenio: boolean): number {
  if (escala === 1)
    return porLimites(
      v,
      [
        [91, 3],
        [93, 2],
        [95, 1],
      ],
      0,
    );
  if (v <= 83) return 3;
  if (v <= 85) return 2;
  if (v <= 87) return 1;
  if (v <= 92 || !emOxigenio) return 0;
  if (v <= 94) return 1;
  if (v <= 96) return 2;
  return 3;
}

export const pontosPas = (v: number) =>
  porLimites(
    v,
    [
      [90, 3],
      [100, 2],
      [110, 1],
      [219, 0],
    ],
    3,
  );

export const pontosFc = (v: number) =>
  porLimites(
    v,
    [
      [40, 3],
      [50, 1],
      [90, 0],
      [110, 1],
      [130, 2],
    ],
    3,
  );

export const pontosTemperatura = (v: number) =>
  porLimites(
    v,
    [
      [35, 3],
      [36, 1],
      [38, 0],
      [39, 1],
    ],
    2,
  );

export const pontosConsciencia = (acvpu: number) => (acvpu === 0 ? 0 : 3);

export function calcularNews2(
  s: SinaisNews2,
  o: { escalaSpo2?: 1 | 2; suspeitaInfeccao?: boolean; regra?: RegraEscore } = {},
): ResultadoNews2 {
  const emO2 = s.o2 > 0;
  const parcelas: ParcelaNews2[] = [
    { parametro: 'fr', valor: s.fr, pontos: pontosFr(s.fr) },
    { parametro: 'spo2', valor: s.spo2, pontos: pontosSpo2(s.spo2, o.escalaSpo2 ?? 1, emO2) },
    { parametro: 'o2', valor: s.o2, pontos: emO2 ? 2 : 0 },
    { parametro: 'pas', valor: s.pas, pontos: pontosPas(s.pas) },
    { parametro: 'fc', valor: s.fc, pontos: pontosFc(s.fc) },
    { parametro: 'acvpu', valor: s.acvpu, pontos: pontosConsciencia(s.acvpu) },
    { parametro: 'temperatura', valor: s.temperatura, pontos: pontosTemperatura(s.temperatura) },
  ];
  const total = parcelas.reduce((a, p) => a + p.pontos, 0);
  const isolado = parcelas.some((p) => p.pontos === 3);
  const regra = o.regra ?? REGRAS_PADRAO.news2;
  const faixa = faixaDe(regra.faixas, total) ?? regra.faixas.at(-1)!;
  const sugereSepse = (o.suspeitaInfeccao ?? false) && total >= 5;
  let gatilho: GatilhoEscore = 'nenhum';
  if (total >= 7) gatilho = 'trr';
  else if (sugereSepse) gatilho = 'sepse';
  else if (total >= 5 || isolado) gatilho = 'avisar-medico';
  const conduta =
    gatilho === 'trr'
      ? `NEWS2 ${total}: acionar o Time de Resposta Rápida agora e monitorar continuamente.`
      : gatilho === 'sepse'
        ? `NEWS2 ${total} com suspeita de infecção: avisar o médico e abrir o protocolo de sepse.`
        : gatilho === 'avisar-medico'
          ? total >= 5
            ? `NEWS2 ${total}: avisar o médico para avaliação urgente e aferir de hora em hora.`
            : `NEWS2 ${total} com um parâmetro em 3 pontos: avisar o médico.`
          : `NEWS2 ${total}: manter a rotina de aferição da unidade.`;
  return {
    total,
    parcelas,
    parametroIsoladoTres: isolado,
    faixa:
      isolado && !faixa.risco
        ? { ...faixa, codigo: 'baixoMedio', rotulo: 'Risco baixo a médio', risco: true }
        : faixa,
    gatilho,
    sugereSepse,
    conduta:
      sugereSepse && gatilho === 'trr'
        ? `${conduta} Suspeita de infecção: abrir o protocolo de sepse.`
        : conduta,
  };
}
