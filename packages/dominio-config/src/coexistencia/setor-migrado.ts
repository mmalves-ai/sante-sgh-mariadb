// Regra 10 do M37 (proposta; cap-14 §14.9.4; m32, hipercuidado): o setor é considerado migrado com 14 dias seguidos sem
// S1 do setor, a fila de S2 caindo, as conexões das pessoas do setor no outro sistema em queda contínua, as metas de
// serviço dentro do alvo e o aceite do coordenador da área. Só acompanhamento (DP-5): nada é desligado. Os números
// (dias sem S1, janela das conexões) são parâmetros (coexistencia.migradoDiasSemS1, coexistencia.migradoDiasConexoes).
import type { AvaliacaoMigrado } from '@sgh/contratos';
import { emQuedaContinua } from './ultima-conexao.js';

export interface EntradaSetorMigrado {
  readonly hoje: string;
  /** Dias (AAAA-MM-DD) em que houve chamado S1 do setor. */
  readonly diasComS1: readonly string[];
  /** S2 abertos do setor por dia (a fila), em ordem de dia. */
  readonly filaS2: readonly { dia: string; abertos: number }[];
  /** Pessoas do setor com conexão nova no outro sistema, por dia. */
  readonly conexoes: readonly { dia: string; pessoas: number }[];
  /** As metas de serviço do setor estão no alvo (null: sem medida). */
  readonly metasNoAlvo: boolean | null;
  readonly aceiteCoordenador: boolean;
  readonly diasSemS1: number;
  readonly diasConexoes: number;
}

const DIA = 86_400_000;

/** Dias inteiros desde o último S1 (sem S1 nenhum: infinito). */
function diasDesdeUltimoS1(hoje: string, dias: readonly string[]): number {
  if (dias.length === 0) return Number.POSITIVE_INFINITY;
  const ultimo = [...dias].sort().at(-1)!;
  return Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${ultimo}T00:00:00Z`)) / DIA);
}

/** A fila de S2 está caindo: o último valor é menor que o primeiro e nenhum dia sobe mais que o anterior? */
export function filaCaindo(fila: readonly { dia: string; abertos: number }[]): boolean {
  if (fila.length === 0) return true;
  const v = [...fila].sort((a, b) => a.dia.localeCompare(b.dia)).map((x) => x.abertos);
  if (v.length === 1) return v[0] === 0;
  return v.every((n, i) => i === 0 || n <= v[i - 1]!) && (v.at(-1)! < v[0]! || v.at(-1) === 0);
}

/** Um chamado S2 do setor para a fila por dia: os dias (AAAA-MM-DD) de abertura e de encerramento (null: aberto). */
export interface ChamadoDaFila {
  readonly abertoEm: string;
  readonly encerradoEm: string | null;
}

/**
 * A fila de S2 do setor por dia, de `desde` a `hoje` (inclusive): em cada dia, os S2 abertos até aquele dia e ainda
 * não encerrados no fim dele. É a entrada `filaS2` da regra 10 (nunca vazia quando há janela).
 */
export function filaS2PorDia(
  chamados: readonly ChamadoDaFila[],
  desde: string,
  hoje: string,
): { dia: string; abertos: number }[] {
  const r: { dia: string; abertos: number }[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hoje}T00:00:00Z`); t += DIA) {
    const dia = new Date(t).toISOString().slice(0, 10);
    r.push({
      dia,
      abertos: chamados.filter((c) => c.abertoEm <= dia && (c.encerradoEm === null || c.encerradoEm > dia))
        .length,
    });
  }
  return r;
}

export function avaliarSetorMigrado(e: EntradaSetorMigrado): AvaliacaoMigrado {
  const desde = diasDesdeUltimoS1(e.hoje, e.diasComS1);
  const criterios: AvaliacaoMigrado['criterios'] = [
    {
      criterio: 'sem-s1',
      atendido: desde >= e.diasSemS1,
      detalhe: Number.isFinite(desde)
        ? `${desde} dia(s) desde o último S1 (meta: ${e.diasSemS1})`
        : `nenhum S1 registrado (meta: ${e.diasSemS1} dias)`,
    },
    {
      criterio: 's2-caindo',
      atendido: filaCaindo(e.filaS2),
      detalhe: e.filaS2.every((x) => x.abertos === 0)
        ? 'nenhum S2 aberto na janela'
        : `S2 abertos por dia: ${e.filaS2.map((x) => x.abertos).join(' → ')}`,
    },
    {
      criterio: 'conexoes-em-queda',
      atendido: emQuedaContinua(e.conexoes, e.diasConexoes),
      detalhe: e.conexoes.length
        ? `pessoas no outro sistema por dia: ${e.conexoes.map((x) => x.pessoas).join(', ')}`
        : 'sem retrato das conexões ainda',
    },
    {
      criterio: 'metas',
      atendido: e.metasNoAlvo === true,
      detalhe:
        e.metasNoAlvo === null ? 'metas de serviço sem medida' : e.metasNoAlvo ? 'no alvo' : 'fora do alvo',
    },
    {
      criterio: 'aceite',
      atendido: e.aceiteCoordenador,
      detalhe: e.aceiteCoordenador
        ? 'aceite do coordenador registrado'
        : 'falta o aceite do coordenador da área',
    },
  ];
  return { cumprido: criterios.every((c) => c.atendido), criterios };
}
