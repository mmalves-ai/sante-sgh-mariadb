// Indicadores da reunião de leitos (M44, etapa 2; mina M41, regra 17; cap-14 §14.4.2): cada um com o numerador e o
// denominador impressos (a conta se confere na tela). Tempo de espera por leito (solicitação → internação) das
// concluídas no período; solicitações atendidas dentro do prazo da prioridade; internados no vermelho; altas previstas
// para hoje já com a alta médica decidida. Regras puras.
const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);

export interface IndicadorNir {
  readonly codigo: string;
  readonly nome: string;
  readonly numerador: number;
  readonly denominador: number;
  readonly valor: number | null;
  readonly unidade: string;
}

const razao = (n: number, d: number, casas = 1) =>
  d === 0 ? null : Math.round((n / d) * 10 ** casas) / 10 ** casas;

export function indicadoresNir(e: {
  concluidas: readonly { solicitadoEm: string; internadoEm: string; prazoEm: string }[];
  internados: readonly { cor: string }[];
  altasHoje: readonly { altaMedicaDecidida: boolean }[];
}): IndicadorNir[] {
  const esperas = e.concluidas.map((c) =>
    Math.max(0, Math.round((ms(c.internadoEm) - ms(c.solicitadoEm)) / 60_000)),
  );
  const soma = esperas.reduce((s, x) => s + x, 0);
  const noPrazo = e.concluidas.filter((c) => ms(c.internadoEm) <= ms(c.prazoEm)).length;
  const vermelhos = e.internados.filter((i) => i.cor === 'vermelho').length;
  const altasFeitas = e.altasHoje.filter((a) => a.altaMedicaDecidida).length;
  return [
    {
      codigo: 'nir.esperaMedia',
      nome: 'Espera média por leito (solicitação até a internação)',
      numerador: soma,
      denominador: esperas.length,
      valor: razao(soma, esperas.length),
      unidade: 'minutos',
    },
    {
      codigo: 'nir.dentroDoPrazo',
      nome: 'Solicitações atendidas dentro do prazo da prioridade',
      numerador: noPrazo,
      denominador: e.concluidas.length,
      valor: razao(noPrazo * 100, e.concluidas.length),
      unidade: '%',
    },
    {
      codigo: 'nir.vermelhos',
      nome: 'Internados no vermelho do quadro de permanência',
      numerador: vermelhos,
      denominador: e.internados.length,
      valor: razao(vermelhos * 100, e.internados.length),
      unidade: '%',
    },
    {
      codigo: 'nir.altasPrevistasHoje',
      nome: 'Altas previstas para hoje com a alta médica já decidida',
      numerador: altasFeitas,
      denominador: e.altasHoje.length,
      valor: razao(altasFeitas * 100, e.altasHoje.length),
      unidade: '%',
    },
  ];
}
