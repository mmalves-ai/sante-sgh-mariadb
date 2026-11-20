// Rastros OpenTelemetry de cada comando ao MariaDB, sem valor de parâmetro. Só a API do OpenTelemetry: sem
// provedor registrado, tudo é no-op; a API e o worker registram o SDK. O SQL vai sem literais e os parâmetros
// entram só pela contagem.
import { metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const ESCOPO = 'sgh-nucleo';

/** SQL sem literais: textos e números viram `?` (o valor nunca vai ao rastro). */
export function sqlSemLiterais(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, '?')
    .replace(/(?<![\w$.])-?\d+(?:\.\d+)?(?![\w$])/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

/** Primeira palavra do comando (SELECT, INSERT, …). */
export function operacaoDo(sql: string): string {
  return /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'OUTRO';
}

let histograma: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;
function duracao() {
  histograma ??= metrics.getMeter(ESCOPO).createHistogram('sgh.mariadb.comando.duracao', {
    unit: 's',
    description: 'Duração dos comandos do núcleo no MariaDB do cliente',
  });
  return histograma;
}

export interface AtributosComando {
  readonly cliente: string;
  readonly sql: string;
  readonly parametros: number;
}

/** Envolve o comando num span de cliente; erro vira status ERROR com o tipo (nunca a mensagem). */
export async function comRastro<T>(
  a: AtributosComando,
  fn: () => Promise<T>,
  linhas: (r: T) => number,
  atributoLinhas: 'db.response.returned_rows' | 'db.response.affected_rows' = 'db.response.returned_rows',
): Promise<T> {
  const operacao = operacaoDo(a.sql);
  const inicio = performance.now();
  return trace.getTracer(ESCOPO).startActiveSpan(
    `mariadb ${operacao}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'mariadb',
        'db.namespace': a.cliente,
        'db.operation.name': operacao,
        'db.query.text': sqlSemLiterais(a.sql),
        'db.query.parameter_count': a.parametros,
        'sgh.cliente': a.cliente,
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
          'sgh.cliente': a.cliente,
          'db.operation.name': operacao,
          erro,
        });
        span.end();
      }
    },
  );
}
