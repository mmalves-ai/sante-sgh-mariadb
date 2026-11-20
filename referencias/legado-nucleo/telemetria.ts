// Rastros OpenTelemetry de cada consulta ao Firebird, sem valor de parâmetro (regra 12 da ficha do M09;
// cap-09 §9.11). Só a API do OpenTelemetry (sem SDK): sem provedor registrado, tudo é no-op; a API e o
// worker registram o SDK e o exportador OTLP. O texto do SQL vai sem literais (cada '…' e número viram ?),
// e os parâmetros entram só pela contagem. Métrica: duração por estabelecimento e operação.
import { metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const ESCOPO = 'sgh-legado';

/** SQL sem literais: textos e números viram `?` (o valor nunca vai ao rastro). */
export function sqlSemLiterais(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/(?<![\w$.])-?\d+(?:\.\d+)?(?![\w$])/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

/** Primeira palavra do comando (SELECT, WITH, …). */
export function operacaoDo(sql: string): string {
  return /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'OUTRO';
}

let histograma: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;
function duracao() {
  histograma ??= metrics.getMeter(ESCOPO).createHistogram('sgh.firebird.consulta.duracao', {
    unit: 's',
    description: 'Duração das consultas do novo ao Firebird do legado',
  });
  return histograma;
}

export interface AtributosConsulta {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly sql: string;
  readonly parametros: number;
}

/** Envolve a consulta num span de cliente; erro vira status ERROR com o tipo (nunca a mensagem com valor). */
export async function comRastro<T>(
  a: AtributosConsulta,
  fn: () => Promise<T>,
  linhas: (r: T) => number,
  /** Leitura: linhas devolvidas; escrita (executar): linhas afetadas. */
  atributoLinhas: 'db.response.returned_rows' | 'db.response.affected_rows' = 'db.response.returned_rows',
): Promise<T> {
  const operacao = operacaoDo(a.sql);
  const inicio = performance.now();
  return trace.getTracer(ESCOPO).startActiveSpan(
    `firebird ${operacao}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'firebird',
        'db.namespace': a.estabelecimento,
        'db.operation.name': operacao,
        'db.query.text': sqlSemLiterais(a.sql),
        'db.query.parameter_count': a.parametros,
        'sgh.rede': a.rede,
        'sgh.estabelecimento': a.estabelecimento,
      },
    },
    async (span) => {
      let erro = false;
      try {
        const r = await fn();
        span.setAttribute(atributoLinhas, linhas(r));
        return r;
      } catch (e) {
        erro = true;
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', e instanceof Error ? e.name : 'erro');
        throw e;
      } finally {
        duracao().record((performance.now() - inicio) / 1000, {
          'sgh.estabelecimento': a.estabelecimento,
          'db.operation.name': operacao,
          resultado: erro ? 'erro' : 'ok',
        });
        span.end();
      }
    },
  );
}
