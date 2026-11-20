import { describe, expect, it } from 'vitest';
import { chaveSolicitante, duplicados, incompleto } from './deduplicacao.js';

describe('solicitante externo (regra 12)', () => {
  it('chave por conselho + UF + número, sem caixa nem espaço', () => {
    expect(chaveSolicitante({ conselho: 'crm', uf: 'mg', numero: 12345 })).toBe('CRM|MG|12345');
    expect(chaveSolicitante({ conselho: 'CRM', uf: 'M', numero: 12345 })).toBeNull();
    expect(chaveSolicitante({ conselho: null, uf: 'MG', numero: 1 })).toBeNull();
    expect(chaveSolicitante({ conselho: 'CRM', uf: 'MG', numero: 0 })).toBeNull();
  });
  it('marca os duplicados e os incompletos', () => {
    const lista = [
      { id: 1, conselho: 'CRM', uf: 'MG', numero: 10, cbo: '225125' },
      { id: 2, conselho: 'crm ', uf: 'mg', numero: 10, cbo: '225125' },
      { id: 3, conselho: 'CRM', uf: 'SP', numero: 10, cbo: null },
      { id: 4, conselho: null, uf: null, numero: null, cbo: null },
    ];
    expect([...duplicados(lista)].sort()).toEqual([1, 2]);
    expect(lista.map(incompleto)).toEqual([false, false, true, true]);
  });
});
