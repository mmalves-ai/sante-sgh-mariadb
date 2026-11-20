// Indicadores de higienização e giro de leito (W0-07, M3): lê as limpezas liberadas no período pela porta do ADT e
// calcula com @sgh/dominio-hotelaria (numerador e denominador por tipo, área e profissional). Usado pela tela da
// higienização (GET /api/higienizacao/indicadores) e pelo catálogo de indicadores da qualidade (a competência).
import {
  apurarLimpeza,
  INDICADORES_GIRO,
  linhasIndicadoresGiro,
  type CodigoIndicadorGiro,
  type LinhaIndicadorGiro,
} from '@sgh/dominio-hotelaria';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoAdt, PortaAdt } from './porta.js';

export interface IndicadoresGiroLeito {
  readonly de: string;
  readonly ate: string;
  /** Limpezas liberadas no período (o denominador dos tempos médios). */
  readonly liberadas: number;
  readonly linhas: readonly LinhaIndicadorGiro[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;

/** O período pedido (AAAA-MM-DD, até 366 dias); 400 fora disso. */
export function periodoGiro(de: unknown, ate: unknown): { de: string; ate: string } {
  const d = String(de ?? '');
  const a = String(ate ?? '');
  const dias = (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000;
  if (!DATA.test(d) || !DATA.test(a) || !(dias >= 0) || dias >= MAX_DIAS)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Período inválido',
      'Informe o início e o fim (AAAA-MM-DD), com o fim no mesmo dia ou depois, em até 366 dias.',
    );
  return { de: d, ate: a };
}

/** As linhas dos indicadores no período, com os nomes do tipo, da área e do profissional. */
export async function indicadoresGiroLeito(
  porta: PortaAdt,
  c: ContextoAdt,
  de: string,
  ate: string,
): Promise<IndicadoresGiroLeito> {
  const [r, apoio] = await Promise.all([porta.limpezasLiberadas(c, de, ate), porta.apoio(c)]);
  const itens = r.itens.map((l) => apurarLimpeza(l, de, ate)).filter((x) => x !== null);
  const nome = (lista: readonly { codigo: number | string; nome: string }[], k: number) =>
    lista.find((x) => Number(x.codigo) === k)?.nome;
  const linhas = linhasIndicadoresGiro(itens, {
    tipo: (k) => nome(apoio.tiposLimpeza, k) ?? `Tipo ${k}`,
    area: (k) => r.areas[k] ?? k,
    profissional: (k) => nome(apoio.profissionaisLimpeza, k) ?? `Profissional ${k}`,
  });
  return { de, ate, liberadas: itens.length, linhas };
}

/** Os totais por indicador (o valor do catálogo de indicadores na competência). */
export function totaisGiro(
  i: IndicadoresGiroLeito,
): Map<CodigoIndicadorGiro, { numerador: number; denominador: number }> {
  const m = new Map<CodigoIndicadorGiro, { numerador: number; denominador: number }>();
  for (const codigo of INDICADORES_GIRO) {
    const l = i.linhas.find((x) => x.codigo === codigo && x.recorte === 'total');
    if (l) m.set(codigo, { numerador: l.numerador, denominador: l.denominador });
  }
  return m;
}
