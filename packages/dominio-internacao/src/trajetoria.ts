// Trajetória do paciente (M16; regras 3 e 5; ref 01 §2.4): a ocupação, o censo e o paciente-dia vêm dos trechos de
// leito (a trajetória, com o tipo de acomodação de cada trecho), nunca do contador da acomodação nem da posição
// atual da internação (que subconta a terapia intensiva). A alta vazia é sentinela (internado); as internações
// com dado impossível ficam MARCADAS no cálculo (contagem por marca, para o arquivo médico), nunca corrigidas.
import {
  grupoMotivoAlta,
  type GrupoMotivoAlta,
  type InternacaoMovimento,
  type MovimentoInternacao,
  type TrechoMovimento,
} from '@sgh/contratos';
import { HORA, instante } from './tempo.js';

export const MARCAS_CALCULO = [
  'alta-anterior-a-entrada',
  'trecho-sem-internacao',
  'internacao-sem-trecho',
  'trecho-invertido',
  'trecho-aberto-com-alta',
  'trecho-alem-da-alta',
  'entrada-no-futuro',
  'transferencias-sem-trecho',
] as const;
export type MarcaCalculo = (typeof MARCAS_CALCULO)[number];

const SEP = '\u0000';

/** Chave natural da unidade (bloco + acomodação), texto exato sem espaços à direita. */
export function chaveUnidade(bloco: string, acomodacao: string): string {
  return `${bloco.trimEnd()}${SEP}${acomodacao.trimEnd()}`;
}

/** Chave da linha do censo: a unidade e o tipo de acomodação do trecho (regra 4). */
export function chaveLinha(unidade: string, tipo: number): string {
  return `${unidade}${SEP}${tipo}`;
}

export function partesDaLinha(linha: string): { bloco: string; acomodacao: string; tipo: number } {
  const [bloco = '', acomodacao = '', tipo = '0'] = linha.split(SEP);
  return { bloco, acomodacao, tipo: Number(tipo) };
}

export interface TrechoNormalizado {
  readonly unidade: string;
  readonly linha: string;
  readonly tipo: number;
  readonly ini: number;
  /** null = em aberto. */
  readonly fim: number | null;
}

export interface InternacaoNormalizada {
  readonly reg: number;
  readonly paciente: number;
  readonly ini: number;
  readonly fim: number | null;
  readonly motivo: number | null;
  readonly grupo: GrupoMotivoAlta | null;
  readonly urgencia: boolean;
  readonly clinica: string;
  readonly permanencia: number | null;
  readonly trechos: readonly TrechoNormalizado[];
  /** Óbito após 24 horas da internação (mortalidade institucional; regra 8). */
  readonly obitoInstitucional: boolean;
}

export interface Trajetorias {
  readonly internacoes: readonly InternacaoNormalizada[];
  readonly marcas: Readonly<Record<MarcaCalculo, number>>;
  /**
   * Cada caso marcado com o número da internação (regra 5: o relatório do arquivo médico para corrigir): só o
   * número e o tipo da marca, nunca o paciente. A diferença das transferências é só uma contagem (sem caso).
   */
  readonly casos: readonly CasoMarcado[];
  /** Mudanças de unidade vistas nos trechos (transferências entre unidades). */
  readonly mudancasDeUnidade: number;
}

export interface CasoMarcado {
  readonly internacao: number;
  readonly marca: Exclude<MarcaCalculo, 'transferencias-sem-trecho'>;
}

function marcasVazias(): Record<MarcaCalculo, number> {
  return Object.fromEntries(MARCAS_CALCULO.map((m) => [m, 0])) as Record<MarcaCalculo, number>;
}

/**
 * Normaliza as internações e os trechos: ordem dos trechos pela entrada (e pelo código), alta sentinela como em
 * aberto, trecho em aberto de internação com alta fechado na alta, trecho que passa da alta cortado na alta,
 * internação sem trecho com um trecho na posição atual (marcada). `agora` (relógio de parede, ms) recusa o futuro.
 */
export function normalizarTrajetorias(
  mov: Pick<MovimentoInternacao, 'internacoes' | 'trechos' | 'transferencias' | 'unidades'>,
  agora: number,
): Trajetorias {
  const contagem = marcasVazias();
  const casos: CasoMarcado[] = [];
  const marcar = (marca: CasoMarcado['marca'], internacao: number) => {
    contagem[marca]++;
    casos.push({ internacao, marca });
  };
  const porReg = new Map<number, TrechoMovimento[]>();
  const regs = new Set(mov.internacoes.map((i) => i.reg));
  for (const t of mov.trechos) {
    if (!regs.has(t.reg)) {
      marcar('trecho-sem-internacao', t.reg);
      continue;
    }
    const l = porReg.get(t.reg);
    if (l) l.push(t);
    else porReg.set(t.reg, [t]);
  }
  const tipoAtual = new Map(mov.unidades.map((u) => [chaveUnidade(u.bloco, u.acomodacao), u.tipo ?? 0]));
  const internacoes: InternacaoNormalizada[] = [];
  let mudancasDeUnidade = 0;
  for (const i of mov.internacoes) {
    const ini = instante(i.entrada, i.horaEntrada);
    const fim = i.alta ? instante(i.alta, i.horaAlta) : null;
    if (ini > agora) {
      marcar('entrada-no-futuro', i.reg);
      continue;
    }
    if (fim !== null && fim < ini) {
      marcar('alta-anterior-a-entrada', i.reg);
      continue;
    }
    const trechos = normalizarTrechos(i, ini, fim, porReg.get(i.reg) ?? [], tipoAtual, (m) =>
      marcar(m, i.reg),
    );
    for (let k = 1; k < trechos.length; k++)
      if (trechos[k]!.unidade !== trechos[k - 1]!.unidade) mudancasDeUnidade++;
    const grupo =
      fim !== null && i.motivo !== null ? grupoMotivoAlta(i.motivo) : fim !== null ? 'alta-domiciliar' : null;
    internacoes.push({
      reg: i.reg,
      paciente: i.paciente,
      ini,
      fim,
      motivo: i.motivo,
      grupo,
      urgencia: (i.carater ?? '').trim() === '2',
      clinica: (i.clinica ?? '').trim() || '?',
      permanencia: i.permanencia,
      trechos,
      obitoInstitucional: grupo === 'obito' && fim !== null && fim - ini >= 24 * HORA,
    });
  }
  // Transferências registradas entre unidades × as mudanças de unidade dos trechos (só a diferença, marcada).
  const registradas = mov.transferencias.filter(
    (t) =>
      chaveUnidade(t.origem.bloco, t.origem.acomodacao) !==
      chaveUnidade(t.destino.bloco, t.destino.acomodacao),
  ).length;
  contagem['transferencias-sem-trecho'] = Math.abs(registradas - mudancasDeUnidade);
  return { internacoes, marcas: contagem, casos, mudancasDeUnidade };
}

function normalizarTrechos(
  i: InternacaoMovimento,
  ini: number,
  fim: number | null,
  lidos: readonly TrechoMovimento[],
  tipoAtual: ReadonlyMap<string, number>,
  marcar: (m: CasoMarcado['marca']) => void,
): TrechoNormalizado[] {
  if (lidos.length === 0) {
    marcar('internacao-sem-trecho');
    const unidade = chaveUnidade(i.bloco, i.acomodacao);
    const tipo = tipoAtual.get(unidade) ?? 0;
    return [{ unidade, linha: chaveLinha(unidade, tipo), tipo, ini, fim }];
  }
  const ordenados = lidos
    .map((t) => ({ t, ini: instante(t.entrada, t.horaEntrada) }))
    .sort((a, b) => a.ini - b.ini || a.t.cod - b.t.cod);
  const r: TrechoNormalizado[] = [];
  for (let k = 0; k < ordenados.length; k++) {
    const { t, ini: tIni } = ordenados[k]!;
    let tFim = t.saida ? instante(t.saida, t.horaSaida) : null;
    if (tFim !== null && tFim < tIni) {
      marcar('trecho-invertido');
      tFim = tIni;
    }
    if (fim !== null) {
      if (tFim === null) {
        marcar('trecho-aberto-com-alta');
        tFim = fim;
      } else if (tFim > fim) {
        marcar('trecho-alem-da-alta');
        tFim = fim;
      }
    }
    const unidade = chaveUnidade(t.bloco, t.acomodacao);
    r.push({ unidade, linha: chaveLinha(unidade, t.tipo), tipo: t.tipo, ini: tIni, fim: tFim });
  }
  return r;
}
