import { describe, expect, it } from 'vitest';
import { loggerNest } from './logger-nest.js';
import { OCULTO } from './redacao.js';

describe('logger do Nest com redação (revisão do M09)', () => {
  it('erro com valor pessoal na mensagem (ex.: chave duplicada do Firebird) sai mascarado', () => {
    const saidas: [string, object, string][] = [];
    const destino = {
      error: (o: object, m: string) => saidas.push(['error', o, m]),
      warn: (o: object, m: string) => saidas.push(['warn', o, m]),
      fatal: (o: object, m: string) => saidas.push(['fatal', o, m]),
    };
    const l = loggerNest(destino);
    l.error(new Error('violation of PRIMARY KEY, key value 123.456.789-09'), 'ExceptionsHandler');
    l.warn({ nomePaciente: 'Paciente Fictício', n: 1 }, 'Contexto');
    l.log('ignorado');
    l.debug('ignorado');
    expect(saidas).toHaveLength(2);
    expect(saidas[0]![2]).toBe(`Error: violation of PRIMARY KEY, key value ${OCULTO}`);
    expect(saidas[0]![1]).toMatchObject({ contexto: 'ExceptionsHandler', origem: 'nest' });
    expect(JSON.stringify(saidas)).not.toMatch(/123\.456\.789-09|Fictício/);
  });
});
