// TAT (tempo total do exame; ficha do M26, regra 12; cap-05b §5.10 "Indicadores"; ref 01 §2.4; sante-api
// src/services/gestao-producao.js): do pedido (inclusão do exame) à liberação, por prioridade e setor, sem sentinela
// (a data vazia do legado, 1899-12-30, e as datas antigas impossíveis não entram). As colunas de data da digitação e da
// emissão do legado têm sentinela e não servem para o TAT (a sante-api mede pela inclusão e pela liberação). As contas
// agregadas vêm do banco; aqui, as médias e as parcelas (com e sem as duas marcas).
import type { SetorSadt } from '@sgh/contratos';

/** Data válida para o TAT: depois de 1900 e antes de 2100 (a sentinela e o ano 5202 ficam fora). */
export function dataValida(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return (
    Number.isFinite(t) && t > Date.parse('1900-01-01T00:00:00Z') && t < Date.parse('2100-01-01T00:00:00Z')
  );
}

/** Minutos do pedido à liberação de um exame (null sem as duas marcas válidas ou com a liberação antes do pedido). */
export function minutosPedidoLiberacao(inclusao: string | null, liberacao: string | null): number | null {
  if (!dataValida(inclusao) || !dataValida(liberacao)) return null;
  const m = (Date.parse(liberacao!) - Date.parse(inclusao!)) / 60_000;
  return m < 0 ? null : m;
}

export interface AgregadoTat {
  readonly setor: SetorSadt;
  readonly urgente: boolean;
  readonly exames: number;
  readonly liberados: number;
  /** Exames com as duas marcas válidas e a soma dos minutos (agregado no banco). */
  readonly comMarcas: number;
  readonly somaMinutos: number;
}

export interface LinhaTat {
  readonly setor: SetorSadt;
  readonly prioridade: 'rotina' | 'urgente';
  readonly exames: number;
  readonly liberados: number;
  readonly mediaMinutosPedidoLiberacao: number | null;
  readonly comMarcas: number;
  readonly semMarcas: number;
}

/** As linhas do TAT por setor e prioridade, com a média e as parcelas (exames sem as marcas sempre impressos). */
export function linhasTat(agregados: readonly AgregadoTat[]): LinhaTat[] {
  const m = new Map<
    string,
    { a: AgregadoTat; exames: number; liberados: number; com: number; soma: number }
  >();
  for (const a of agregados) {
    const k = `${a.setor}|${a.urgente}`;
    const x = m.get(k) ?? { a, exames: 0, liberados: 0, com: 0, soma: 0 };
    x.exames += a.exames;
    x.liberados += a.liberados;
    x.com += a.comMarcas;
    x.soma += a.somaMinutos;
    m.set(k, x);
  }
  return [...m.values()]
    .map((x) => ({
      setor: x.a.setor,
      prioridade: x.a.urgente ? ('urgente' as const) : ('rotina' as const),
      exames: x.exames,
      liberados: x.liberados,
      mediaMinutosPedidoLiberacao: x.com > 0 ? Math.round(x.soma / x.com) : null,
      comMarcas: x.com,
      semMarcas: Math.max(0, x.liberados - x.com),
    }))
    .sort((a, b) => a.setor.localeCompare(b.setor) || a.prioridade.localeCompare(b.prioridade));
}

/** Horas médias do pedido à liberação (arredondadas, como a sante-api), ou null sem exame liberado com as marcas. */
export function horasMedias(linhas: readonly LinhaTat[]): number | null {
  let soma = 0;
  let n = 0;
  for (const l of linhas)
    if (l.mediaMinutosPedidoLiberacao !== null) {
      soma += l.mediaMinutosPedidoLiberacao * l.comMarcas;
      n += l.comMarcas;
    }
  return n ? Math.round(soma / n / 60) : null;
}

/** Pedidos do prontuário pendentes há mais de 24 horas (indicador do setor). */
export function pendenteHaMaisDe24h(inclusao: string | null, agora: string): boolean {
  if (!dataValida(inclusao)) return false;
  return Date.parse(agora) - Date.parse(inclusao!) > 24 * 3_600_000;
}
