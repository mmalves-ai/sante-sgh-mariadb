// Estorno por glosa (M33; ficha, seção 5, repasse.lancarEvento; cap-06b §6.7 "Estorno não apaga"). Glosa mantida
// depois do repasse gera lançamento negativo no período seguinte, proporcional à parte glosada da base, ligado ao
// original. O outro sistema não faz estorno negativo (0 lançamentos com valor negativo em 8.675 no pc), então a ligação
// fica em SGH_REP_ESTORNO. Nunca altera o lançamento original nem o repasse pago; o total estornado nunca passa do
// repassado.
import { competenciaSeguinte, dividirArredondando } from './dinheiro.js';

export interface PedidoEstorno {
  readonly competenciaOriginal: string;
  readonly repassadoCentavos: number;
  readonly baseCentavos: number;
  readonly glosaMantidaCentavos: number;
  /** Já estornado deste lançamento (soma dos estornos anteriores, positivos). */
  readonly jaEstornadoCentavos: number;
}

export type ResultadoEstorno =
  | { readonly ok: true; readonly valorCentavos: number; readonly competencia: string }
  | { readonly ok: false; readonly motivo: 'desligado' | 'sem-glosa' | 'ja-estornado' };

export function estornoPorGlosa(p: PedidoEstorno, ligado: boolean): ResultadoEstorno {
  if (!ligado) return { ok: false, motivo: 'desligado' };
  if (p.glosaMantidaCentavos <= 0 || p.baseCentavos <= 0 || p.repassadoCentavos <= 0)
    return { ok: false, motivo: 'sem-glosa' };
  const glosa = Math.min(p.glosaMantidaCentavos, p.baseCentavos);
  const proporcional = Number(
    dividirArredondando(BigInt(p.repassadoCentavos) * BigInt(glosa), BigInt(p.baseCentavos)),
  );
  const restante = p.repassadoCentavos - p.jaEstornadoCentavos;
  const valor = Math.min(proporcional, restante);
  if (valor <= 0) return { ok: false, motivo: 'ja-estornado' };
  return { ok: true, valorCentavos: -valor, competencia: competenciaSeguinte(p.competenciaOriginal) };
}
