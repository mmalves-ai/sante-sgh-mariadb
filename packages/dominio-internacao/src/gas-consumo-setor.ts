// Gases medicinais: consumo por setor (C1-050, 05-SUP linha 30). Regras puras, sem banco:
//   - o consumo do setor sem paciente (rede do setor, cilindro aberto, teste de equipamento) é conferido antes de gravar:
//     setor e gás obrigatórios, fluxo ou volume medido, início e fim coerentes e nunca no futuro;
//   - o volume vem do volume medido ou do fluxo × minutos de uso;
//   - a apuração por setor e período soma o uso dos pacientes (registro à beira do leito) e o consumo do setor sem
//     paciente, cada registro recortado ao período (o que passa da borda conta só a parte dentro dele; o volume medido é
//     rateado pelo tempo), com as parcelas impressas: total = parcela dos pacientes + parcela do setor.
import type { ProblemaGas } from './gas-cobranca.js';

const MS_MIN = 60_000;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Volume em litros pelo fluxo (L/min) e pela duração do uso. */
export function litrosPeloFluxo(fluxoLitrosMinuto: number, inicio: Date, fim: Date): number {
  return r4((Math.max(0, fim.getTime() - inicio.getTime()) / MS_MIN) * Math.max(0, fluxoLitrosMinuto));
}

/** Confere o registro de consumo do setor sem paciente antes de gravar. */
export function conferirConsumoGasSetor(e: {
  readonly setor: number | null;
  readonly gas: number | null;
  readonly fluxoLitrosMinuto: number | null;
  readonly quantidadeLitros: number | null;
  readonly inicio: Date;
  readonly fim: Date | null;
  readonly agora: Date;
}): ProblemaGas[] {
  const p: ProblemaGas[] = [];
  if (!e.setor) p.push({ campo: 'setor', mensagem: 'Informe o setor do consumo.' });
  if (!e.gas) p.push({ campo: 'gas', mensagem: 'Informe o gás.' });
  if (e.fluxoLitrosMinuto === null && e.quantidadeLitros === null)
    p.push({ campo: 'fluxo', mensagem: 'Informe o fluxo (L/min) ou o volume medido (L).' });
  if (e.fluxoLitrosMinuto !== null && !(e.fluxoLitrosMinuto > 0))
    p.push({ campo: 'fluxo', mensagem: 'O fluxo deve ser maior que zero.' });
  if (e.quantidadeLitros !== null && !(e.quantidadeLitros >= 0))
    p.push({ campo: 'quantidade', mensagem: 'O volume medido não pode ser negativo.' });
  if (e.quantidadeLitros !== null && e.fim === null)
    p.push({ campo: 'fim', mensagem: 'O volume medido exige o fim do consumo.' });
  if (e.inicio.getTime() > e.agora.getTime() + 5 * MS_MIN)
    p.push({ campo: 'inicio', mensagem: 'O início do consumo não pode estar no futuro.' });
  if (e.fim !== null) {
    if (e.fim.getTime() < e.inicio.getTime())
      p.push({ campo: 'fim', mensagem: 'O fim do consumo não pode ser antes do início.' });
    if (e.fim.getTime() > e.agora.getTime() + 5 * MS_MIN)
      p.push({ campo: 'fim', mensagem: 'O fim do consumo não pode estar no futuro.' });
  }
  return p;
}

/** Um registro de uso ou consumo de gás, já lido do banco (cancelados ficam de fora da leitura). */
export interface RegistroConsumoGas {
  readonly origem: 'paciente' | 'setor';
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly gas: number;
  readonly gasNome: string;
  readonly inicio: Date;
  /** Nulo: ainda em uso (conta até o momento da apuração). */
  readonly fim: Date | null;
  readonly fluxoLitrosMinuto: number | null;
  /** Volume medido do registro inteiro (L), quando houver. */
  readonly quantidadeLitros: number | null;
}

export interface ParcelaConsumoGas {
  readonly registros: number;
  readonly horas: number;
  readonly litros: number;
  /** Registros sem fluxo nem volume: entram nas horas, não nos litros. */
  readonly semVolume: number;
}

export interface ApuracaoGasSetor {
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly gas: number;
  readonly gasNome: string;
  readonly pacientes: ParcelaConsumoGas;
  readonly setorSemPaciente: ParcelaConsumoGas;
  readonly total: ParcelaConsumoGas;
}

const vazia = (): { registros: number; horas: number; litros: number; semVolume: number } => ({
  registros: 0,
  horas: 0,
  litros: 0,
  semVolume: 0,
});

/**
 * Apura o consumo de gás por setor e gás no período [de, ate): horas e litros dos pacientes e do setor sem paciente,
 * cada registro recortado ao período. O total é a soma das duas parcelas (impressas no resultado).
 */
export function apurarConsumoGasPorSetor(e: {
  readonly de: Date;
  readonly ate: Date;
  readonly agora: Date;
  readonly registros: readonly RegistroConsumoGas[];
}): ApuracaoGasSetor[] {
  const grupos = new Map<
    string,
    {
      setor: number | null;
      setorNome: string | null;
      gas: number;
      gasNome: string;
      p: ReturnType<typeof vazia>;
      s: ReturnType<typeof vazia>;
    }
  >();
  for (const r of e.registros) {
    const fimReal = r.fim ?? e.agora;
    const ini = Math.max(r.inicio.getTime(), e.de.getTime());
    const fim = Math.min(fimReal.getTime(), e.ate.getTime());
    const instantaneo = r.inicio.getTime() === fimReal.getTime();
    const dentro = instantaneo
      ? r.inicio.getTime() >= e.de.getTime() && r.inicio.getTime() < e.ate.getTime()
      : fim > ini;
    if (!dentro) continue;
    const ms = Math.max(0, fim - ini);
    const chave = `${r.setor ?? 0}:${r.gas}`;
    let g = grupos.get(chave);
    if (!g) {
      g = { setor: r.setor, setorNome: r.setorNome, gas: r.gas, gasNome: r.gasNome, p: vazia(), s: vazia() };
      grupos.set(chave, g);
    }
    const alvo = r.origem === 'paciente' ? g.p : g.s;
    alvo.registros += 1;
    alvo.horas += ms / 3_600_000;
    if (r.quantidadeLitros !== null) {
      const total = Math.max(0, fimReal.getTime() - r.inicio.getTime());
      alvo.litros += total === 0 ? r.quantidadeLitros : (r.quantidadeLitros * ms) / total;
    } else if (r.fluxoLitrosMinuto !== null) {
      alvo.litros += (ms / MS_MIN) * r.fluxoLitrosMinuto;
    } else {
      alvo.semVolume += 1;
    }
  }
  const fechar = (x: ReturnType<typeof vazia>): ParcelaConsumoGas => ({
    registros: x.registros,
    horas: r4(x.horas),
    litros: r4(x.litros),
    semVolume: x.semVolume,
  });
  return [...grupos.values()]
    .map((g) => {
      const pacientes = fechar(g.p);
      const setorSemPaciente = fechar(g.s);
      return {
        setor: g.setor,
        setorNome: g.setorNome,
        gas: g.gas,
        gasNome: g.gasNome,
        pacientes,
        setorSemPaciente,
        total: {
          registros: pacientes.registros + setorSemPaciente.registros,
          horas: r4(pacientes.horas + setorSemPaciente.horas),
          litros: r4(pacientes.litros + setorSemPaciente.litros),
          semVolume: pacientes.semVolume + setorSemPaciente.semVolume,
        },
      };
    })
    .sort(
      (a, b) =>
        Number(a.setor === null) - Number(b.setor === null) ||
        (a.setorNome ?? '').localeCompare(b.setorNome ?? '', 'pt-BR') ||
        a.gasNome.localeCompare(b.gasNome, 'pt-BR') ||
        a.gas - b.gas,
    );
}
