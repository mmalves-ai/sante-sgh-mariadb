import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comRastro, operacaoDo, sqlSemLiterais } from './telemetria.js';

const exportador = new InMemorySpanExporter();
beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exportador)] }),
  );
});
afterAll(() => trace.disable());

describe('rastro das consultas sem valor (regra 12)', () => {
  it('SQL sem literais e operação', () => {
    expect(
      sqlSemLiterais(
        "SELECT FIRST 10 a.X FROM T a WHERE a.N = 'Fulano d''Tal' AND a.C = 12345678909 AND a.V = -1.5",
      ),
    ).toBe('SELECT FIRST ? a.X FROM T a WHERE a.N = ? AND a.C = ? AND a.V = ?');
    expect(sqlSemLiterais('SELECT RDB$RELATION_NAME, T1.COL2 FROM RDB$RELATIONS T1')).toBe(
      'SELECT RDB$RELATION_NAME, T1.COL2 FROM RDB$RELATIONS T1',
    );
    expect(operacaoDo('  with x as (select 1) select * from x')).toBe('WITH');
    expect(operacaoDo('')).toBe('OUTRO');
  });

  it('span com atributos de banco, sem os parâmetros; erro vira status sem mensagem', async () => {
    exportador.reset();
    await comRastro(
      { rede: 'r', estabelecimento: 'zz', sql: 'SELECT X FROM T WHERE C = ?', parametros: 1 },
      async () => [1, 2],
      (x) => x.length,
    );
    await expect(
      comRastro(
        { rede: 'r', estabelecimento: 'zz', sql: 'SELECT 1', parametros: 0 },
        async () => {
          throw new TypeError('valor 12345678909 na mensagem');
        },
        () => 0,
      ),
    ).rejects.toThrow(TypeError);
    const [ok, falha] = exportador.getFinishedSpans();
    expect(ok?.name).toBe('firebird SELECT');
    expect(ok?.attributes).toMatchObject({
      'db.system.name': 'firebird',
      'db.namespace': 'zz',
      'db.query.text': 'SELECT X FROM T WHERE C = ?',
      'db.query.parameter_count': 1,
      'db.response.returned_rows': 2,
    });
    expect(falha?.status.code).toBe(SpanStatusCode.ERROR);
    expect(falha?.attributes['error.type']).toBe('TypeError');
    expect(
      JSON.stringify(exportador.getFinishedSpans().map((s) => [s.attributes, s.events, s.status])),
    ).not.toContain('12345678909');
  });

  it('escrita: linhas afetadas no atributo próprio', async () => {
    exportador.reset();
    await comRastro(
      { rede: 'r', estabelecimento: 'zz', sql: "UPDATE T SET A = 'x' WHERE ID = ?", parametros: 1 },
      async () => 3,
      (n) => n,
      'db.response.affected_rows',
    );
    const [s] = exportador.getFinishedSpans();
    expect(s?.name).toBe('firebird UPDATE');
    expect(s?.attributes).toMatchObject({
      'db.query.text': 'UPDATE T SET A = ? WHERE ID = ?',
      'db.response.affected_rows': 3,
    });
    expect(s?.attributes['db.response.returned_rows']).toBeUndefined();
  });
});
