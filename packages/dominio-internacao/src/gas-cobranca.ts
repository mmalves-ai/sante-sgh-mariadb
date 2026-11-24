// Gases medicinais por tempo de uso (F3.4, 04-INT linha 82): as regras puras do uso por paciente e da cobrança.
//   - o uso tem início e fim; o mesmo gás não fica aberto duas vezes no mesmo atendimento (a troca de fluxo ou de local
//     encerra o uso e abre outro que o continua);
//   - a cobrança soma o tempo dos usos encerrados do gás, desconta a tolerância e converte pela unidade da regra
//     (minuto, hora, fração de hora, dia, litro ou metro cúbico) com o arredondamento da regra; havendo faixas, a faixa
//     em que o tempo cai decide a quantidade (e o item, quando a faixa tem item próprio);
//   - o uso simultâneo com outro gás segue o tratamento da regra: cobra os dois, só o maior (pelo fluxo), com desconto
//     no tempo sobreposto ou não cobra o tempo sobreposto; sem tratamento específico, vale o percentual padrão da
//     regra, e sem ele cobra os dois.
// Toda conta sai com os passos, para a memória do item da conta.

export const UNIDADES_COBRANCA_GAS = [
  'minuto',
  'hora',
  'fracao_hora',
  'dia',
  'litro',
  'metro_cubico',
] as const;
export type UnidadeCobrancaGas = (typeof UNIDADES_COBRANCA_GAS)[number];
export const ARREDONDAMENTOS_GAS = ['nenhum', 'para_cima', 'para_baixo', 'mais_proximo'] as const;
export type ArredondamentoGas = (typeof ARREDONDAMENTOS_GAS)[number];
export const TRATAMENTOS_SIMULTANEO_GAS = [
  'cobra_ambos',
  'cobra_maior',
  'cobra_com_desconto',
  'nao_cobra',
] as const;
export type TratamentoSimultaneoGas = (typeof TRATAMENTOS_SIMULTANEO_GAS)[number];
export const LOCAIS_USO_GAS = [
  'leito',
  'centro_cirurgico',
  'sala_procedimento',
  'pronto_atendimento',
  'transporte',
  'outro',
] as const;
export type LocalUsoGas = (typeof LOCAIS_USO_GAS)[number];

export interface FaixaCobrancaGas {
  readonly horasInicio: number;
  readonly horasFim: number | null;
  readonly item: number | null;
  readonly quantidade: number;
}

export interface SimultaneoCobrancaGas {
  /** O outro gás (item faturável) em uso ao mesmo tempo. */
  readonly gas: number;
  readonly tratamento: TratamentoSimultaneoGas;
  readonly percentual: number | null;
}

export interface RegraCobrancaGas {
  readonly unidade: UnidadeCobrancaGas;
  readonly toleranciaMinutos: number;
  readonly fracaoMinimaMinutos: number | null;
  readonly arredondamento: ArredondamentoGas;
  readonly percentualSimultaneo: number | null;
  readonly faixas: readonly FaixaCobrancaGas[];
  readonly simultaneos: readonly SimultaneoCobrancaGas[];
}

export interface UsoGasPeriodo {
  /** O gás (item faturável) do uso. */
  readonly gas: number;
  readonly inicio: Date;
  /** Nulo: em uso (não entra na cobrança). */
  readonly fim: Date | null;
  readonly fluxoLitrosMinuto: number | null;
}

export interface CobrancaGas {
  readonly minutosUso: number;
  readonly minutosCobraveis: number;
  /** Zero: nada a lançar (tolerância ou sobreposição não cobrada). */
  readonly quantidade: number;
  /** O item da faixa, quando difere do item da regra. */
  readonly itemFaixa: number | null;
  readonly passos: readonly string[];
}

export interface ProblemaGas {
  readonly campo: string;
  readonly mensagem: string;
}

const MS_MIN = 60_000;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** As horas de uso de um período (4 casas), apuradas no encerramento. */
export function horasDeUso(inicio: Date, fim: Date): number {
  return r4(Math.max(0, fim.getTime() - inicio.getTime()) / 3_600_000);
}

/** Confere o início de um uso: não no futuro (5 min de folga) e sem outro uso aberto do mesmo gás no atendimento. */
export function conferirInicioUsoGas(e: {
  readonly inicio: Date;
  readonly agora: Date;
  readonly abertosMesmoGas: number;
  readonly continuaOutro: boolean;
}): ProblemaGas[] {
  const p: ProblemaGas[] = [];
  if (e.inicio.getTime() > e.agora.getTime() + 5 * MS_MIN)
    p.push({ campo: 'inicio', mensagem: 'O início do uso não pode estar no futuro.' });
  if (e.abertosMesmoGas > 0 && !e.continuaOutro)
    p.push({
      campo: 'gas',
      mensagem:
        'Este gás já está em uso neste atendimento: encerre o uso aberto ou registre a troca de fluxo.',
    });
  return p;
}

/** Confere o encerramento: depois do início e não no futuro. */
export function conferirFimUsoGas(e: {
  readonly inicio: Date;
  readonly fim: Date;
  readonly agora: Date;
}): ProblemaGas[] {
  const p: ProblemaGas[] = [];
  if (e.fim.getTime() < e.inicio.getTime())
    p.push({ campo: 'fim', mensagem: 'O fim do uso não pode ser antes do início.' });
  if (e.fim.getTime() > e.agora.getTime() + 5 * MS_MIN)
    p.push({ campo: 'fim', mensagem: 'O fim do uso não pode estar no futuro.' });
  return p;
}

/** Confere a regra de cobrança antes de gravar (faixas contínuas, percentuais e tratamentos coerentes). */
export function conferirRegraCobrancaGas(r: RegraCobrancaGas, gasDaRegra: number): ProblemaGas[] {
  const p: ProblemaGas[] = [];
  if (!UNIDADES_COBRANCA_GAS.includes(r.unidade))
    p.push({ campo: 'unidade', mensagem: 'Unidade de cobrança inválida.' });
  if (!ARREDONDAMENTOS_GAS.includes(r.arredondamento))
    p.push({ campo: 'arredondamento', mensagem: 'Arredondamento inválido.' });
  if (r.toleranciaMinutos < 0)
    p.push({ campo: 'toleranciaMinutos', mensagem: 'A tolerância não pode ser negativa.' });
  if (
    r.unidade === 'fracao_hora' &&
    !(r.fracaoMinimaMinutos && r.fracaoMinimaMinutos > 0 && r.fracaoMinimaMinutos <= 60)
  )
    p.push({
      campo: 'fracaoMinimaMinutos',
      mensagem: 'A cobrança por fração de hora exige a fração (1 a 60 minutos).',
    });
  if (r.percentualSimultaneo !== null && (r.percentualSimultaneo < 0 || r.percentualSimultaneo > 100))
    p.push({ campo: 'percentualSimultaneo', mensagem: 'O percentual fica entre 0 e 100.' });
  const fs = [...r.faixas].sort((a, b) => a.horasInicio - b.horasInicio);
  fs.forEach((f, i) => {
    if (f.horasInicio < 0 || (f.horasFim !== null && f.horasFim <= f.horasInicio))
      p.push({ campo: `faixas.${i}`, mensagem: 'A faixa termina depois de começar.' });
    if (f.quantidade < 0)
      p.push({ campo: `faixas.${i}`, mensagem: 'A quantidade da faixa não pode ser negativa.' });
    const prox = fs[i + 1];
    if (prox && (f.horasFim === null || f.horasFim !== prox.horasInicio))
      p.push({
        campo: `faixas.${i}`,
        mensagem: 'As faixas são contínuas: cada uma começa onde a anterior termina.',
      });
  });
  if (fs.length && fs[0]!.horasInicio !== 0)
    p.push({ campo: 'faixas.0', mensagem: 'A primeira faixa começa em zero hora.' });
  const vistos = new Set<number>();
  r.simultaneos.forEach((s, i) => {
    if (s.gas === gasDaRegra)
      p.push({ campo: `simultaneos.${i}`, mensagem: 'O gás simultâneo é outro gás.' });
    if (vistos.has(s.gas)) p.push({ campo: `simultaneos.${i}`, mensagem: 'Gás simultâneo repetido.' });
    vistos.add(s.gas);
    if (!TRATAMENTOS_SIMULTANEO_GAS.includes(s.tratamento))
      p.push({ campo: `simultaneos.${i}`, mensagem: 'Tratamento inválido.' });
    if (
      s.tratamento === 'cobra_com_desconto' &&
      (s.percentual === null || s.percentual < 0 || s.percentual > 100)
    )
      p.push({ campo: `simultaneos.${i}`, mensagem: 'O desconto exige o percentual cobrado (0 a 100).' });
  });
  return p;
}

function arredondar(x: number, modo: ArredondamentoGas): number {
  if (modo === 'para_cima') return Math.ceil(r4(x));
  if (modo === 'para_baixo') return Math.floor(r4(x));
  if (modo === 'mais_proximo') return Math.round(x);
  return r4(x);
}

/** O peso do tempo deste gás quando outro está em uso ao mesmo tempo (1 cobra tudo, 0 nada). */
function pesoSimultaneo(
  regra: RegraCobrancaGas,
  este: UsoGasPeriodo,
  outro: UsoGasPeriodo,
): { peso: number; regra: string } {
  const s = regra.simultaneos.find((x) => x.gas === outro.gas);
  const t: TratamentoSimultaneoGas | null =
    s?.tratamento ?? (regra.percentualSimultaneo !== null ? 'cobra_com_desconto' : null);
  if (t === null || t === 'cobra_ambos') return { peso: 1, regra: 'cobra_ambos' };
  if (t === 'nao_cobra') return { peso: 0, regra: 'nao_cobra' };
  if (t === 'cobra_com_desconto')
    return { peso: (s?.percentual ?? regra.percentualSimultaneo ?? 100) / 100, regra: 'cobra_com_desconto' };
  // Só o maior: pelo fluxo; empate (ou sem fluxo), o de menor código cobra — nunca os dois nem nenhum.
  const a = este.fluxoLitrosMinuto ?? 0;
  const b = outro.fluxoLitrosMinuto ?? 0;
  const cobra = a > b || (a === b && este.gas < outro.gas);
  return { peso: cobra ? 1 : 0, regra: 'cobra_maior' };
}

/**
 * Calcula a cobrança de um gás no atendimento: os usos encerrados do gás, os dos outros gases para o uso simultâneo.
 */
export function calcularCobrancaGas(e: {
  readonly regra: RegraCobrancaGas;
  readonly gas: number;
  readonly usos: readonly UsoGasPeriodo[];
}): CobrancaGas {
  const { regra } = e;
  const passos: string[] = [];
  const meus = e.usos.filter((u) => u.gas === e.gas && u.fim !== null && u.fim > u.inicio);
  const outros = e.usos.filter((u) => u.gas !== e.gas);
  let minutosUso = 0;
  let minutosPesados = 0;
  let litros = 0;
  for (const u of meus) {
    const fim = u.fim!;
    minutosUso += (fim.getTime() - u.inicio.getTime()) / MS_MIN;
    // Cortes do período nos limites dos usos dos outros gases: em cada trecho vale o peso mais restritivo.
    const cortes = new Set<number>([u.inicio.getTime(), fim.getTime()]);
    for (const o of outros) {
      const of = (o.fim ?? fim).getTime();
      for (const t of [o.inicio.getTime(), of])
        if (t > u.inicio.getTime() && t < fim.getTime()) cortes.add(t);
    }
    const ts = [...cortes].sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const a = ts[i]!;
      const b = ts[i + 1]!;
      let peso = 1;
      for (const o of outros) {
        const oFim = (o.fim ?? fim).getTime();
        if (o.inicio.getTime() < b && oFim > a) {
          const w = pesoSimultaneo(regra, u, o);
          if (w.peso < peso) {
            peso = w.peso;
            passos.push(
              `Uso simultâneo com o gás ${o.gas}: ${w.regra} (${Math.round(w.peso * 100)}% do tempo sobreposto).`,
            );
          }
        }
      }
      const min = ((b - a) / MS_MIN) * peso;
      minutosPesados += min;
      litros += min * (u.fluxoLitrosMinuto ?? 0);
    }
  }
  minutosUso = r4(minutosUso);
  passos.unshift(`Tempo de uso: ${minutosUso} min em ${meus.length} período(s).`);
  const tolerancia = Math.max(0, regra.toleranciaMinutos);
  const cobraveis = r4(Math.max(0, minutosPesados - tolerancia));
  if (tolerancia > 0) passos.push(`Tolerância de ${tolerancia} min descontada.`);
  passos.push(`Tempo cobrável: ${cobraveis} min.`);
  if (cobraveis <= 0) return { minutosUso, minutosCobraveis: 0, quantidade: 0, itemFaixa: null, passos };

  if (regra.faixas.length) {
    const h = cobraveis / 60;
    const fs = [...regra.faixas].sort((a, b) => a.horasInicio - b.horasInicio);
    const f =
      fs.find((x) => h >= x.horasInicio && (x.horasFim === null || h < x.horasFim)) ?? fs[fs.length - 1]!;
    passos.push(`Faixa de ${f.horasInicio} h a ${f.horasFim ?? '∞'} h: quantidade ${f.quantidade}.`);
    return {
      minutosUso,
      minutosCobraveis: cobraveis,
      quantidade: r4(f.quantidade),
      itemFaixa: f.item,
      passos,
    };
  }

  const fator = minutosPesados > 0 ? cobraveis / minutosPesados : 0;
  let quantidade: number;
  switch (regra.unidade) {
    case 'minuto':
      quantidade = arredondar(cobraveis, regra.arredondamento);
      break;
    case 'hora':
      quantidade = arredondar(cobraveis / 60, regra.arredondamento);
      break;
    case 'fracao_hora': {
      const fr = regra.fracaoMinimaMinutos ?? 30;
      quantidade = r4((arredondar(cobraveis / fr, regra.arredondamento) * fr) / 60);
      break;
    }
    case 'dia':
      quantidade = arredondar(cobraveis / 1440, regra.arredondamento);
      break;
    case 'litro':
      quantidade = arredondar(litros * fator, regra.arredondamento);
      break;
    case 'metro_cubico':
      quantidade = arredondar((litros * fator) / 1000, regra.arredondamento);
      break;
  }
  passos.push(`Unidade ${regra.unidade}, arredondamento ${regra.arredondamento}: quantidade ${quantidade}.`);
  return { minutosUso, minutosCobraveis: cobraveis, quantidade, itemFaixa: null, passos };
}

/** A regra que vale: a mais específica (plano, depois fonte, depois geral) vigente na data, entre as ativas. */
export function regraGasQueVale<
  T extends {
    readonly fonte: number | null;
    readonly plano: number | null;
    readonly vigenciaInicio: string;
    readonly vigenciaFim: string | null;
  },
>(
  regras: readonly T[],
  conta: { readonly fonte: number | null; readonly plano: number | null },
  data: string,
): T | null {
  const nota = (r: T) => (r.plano !== null ? 2 : r.fonte !== null ? 1 : 0);
  const cabe = regras.filter(
    (r) =>
      r.vigenciaInicio <= data &&
      (r.vigenciaFim === null || r.vigenciaFim >= data) &&
      (r.fonte === null || r.fonte === conta.fonte) &&
      (r.plano === null || r.plano === conta.plano),
  );
  cabe.sort((a, b) => nota(b) - nota(a) || b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return cabe[0] ?? null;
}

/** O que já foi lançado na conta para o gás (itens vivos: nem estornados nem transferidos). */
export interface LancadoGas {
  readonly item: number;
  readonly quantidade: number;
}

/**
 * O que lançar agora: a cobrança é sempre do tempo ACUMULADO do gás na conta (tolerância, arredondamento e faixa
 * aplicados uma vez só sobre o total), e o lançamento é só a diferença para o que já foi lançado. Assim, lançar todo
 * dia ou uma vez no fim dá a mesma quantidade total. Quando a faixa troca o item cobrado, ou o acumulado cobra menos
 * que o já lançado, não há diferença a lançar sem estorno: recusa, e o acerto é pela conta.
 */
export function diferencaALancarGas(e: {
  readonly cobranca: CobrancaGas;
  readonly item: number;
  readonly lancados: readonly LancadoGas[];
}): { quantidade: number; problemas: ProblemaGas[]; passos: string[] } {
  const jaMesmo = r4(e.lancados.filter((l) => l.item === e.item).reduce((s, l) => s + l.quantidade, 0));
  const outros = [
    ...new Set(e.lancados.filter((l) => l.item !== e.item && l.quantidade > 0).map((l) => l.item)),
  ];
  const problemas: ProblemaGas[] = [];
  if (outros.length)
    problemas.push({
      campo: 'faixa',
      mensagem: `O tempo acumulado mudou a faixa para o item ${e.item}, mas a conta já tem o gás lançado no item ${outros.join(', ')}: estorne os lançamentos anteriores do gás e lance de novo.`,
    });
  const quantidade = r4(e.cobranca.quantidade - jaMesmo);
  if (quantidade < 0)
    problemas.push({
      campo: 'quantidade',
      mensagem: `O tempo acumulado cobra ${e.cobranca.quantidade} e a conta já tem ${jaMesmo} lançado: estorne o excesso pela conta.`,
    });
  return {
    quantidade: Math.max(0, quantidade),
    problemas,
    passos: [
      `Acumulado na conta: ${e.cobranca.quantidade}; já lançado: ${jaMesmo}; a lançar agora: ${Math.max(0, quantidade)}.`,
    ],
  };
}
