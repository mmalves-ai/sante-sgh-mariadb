// Regra 3 (ficha do M30): a situação na tela, derivada de FECHADA, IND_EMI, lote, protocolo, retorno, recurso e SGH_.
import { describe, expect, it } from 'vitest';
import { type FatosSituacao, ROTULO_SITUACAO, SITUACOES_DERIVADAS, situacaoDerivada } from '../index.js';

const f = (x: Partial<FatosSituacao>): FatosSituacao => ({
  fechada: 'N',
  indEmi: 'F',
  emLote: false,
  protocolada: false,
  valorRetorno: 0,
  valorRecurso: 0,
  etapaNovo: null,
  ...x,
});

describe('situação derivada (regra 3)', () => {
  it('aberta, em conferência, em auditoria e emitida', () => {
    expect(situacaoDerivada(f({})).situacao).toBe('aberta');
    expect(situacaoDerivada(f({ etapaNovo: 'conferencia' })).situacao).toBe('em-conferencia');
    expect(situacaoDerivada(f({ etapaNovo: 'auditoria' })).situacao).toBe('em-auditoria');
    expect(situacaoDerivada(f({ indEmi: 'T' })).situacao).toBe('emitida');
  });
  it('fechada e fechada em lote (inferida)', () => {
    expect(situacaoDerivada(f({ fechada: 'S' }))).toMatchObject({ situacao: 'fechada', inferida: false });
    const l = situacaoDerivada(f({ fechada: 'S', emLote: true }));
    expect(l).toMatchObject({ situacao: 'em-lote', inferida: true });
    expect(l.rotulo).toContain('(inferida)');
  });
  it('depois da apresentação, só o outro sistema move: inferida', () => {
    expect(situacaoDerivada(f({ fechada: 'A' }))).toMatchObject({ situacao: 'apresentada', inferida: false });
    expect(situacaoDerivada(f({ fechada: 'A', protocolada: true })).situacao).toBe('protocolada');
    expect(situacaoDerivada(f({ fechada: 'A', protocolada: true, valorRetorno: 10 })).situacao).toBe(
      'com-retorno',
    );
    expect(situacaoDerivada(f({ fechada: 'A', valorRetorno: 10, valorRecurso: 5 }))).toMatchObject({
      situacao: 'em-recurso',
      inferida: true,
      base: 'apresentada',
    });
  });
  it('a conta F é erro de dado e só é mostrada', () => {
    expect(situacaoDerivada(f({ fechada: 'F' })).situacao).toBe('erro-de-dado');
  });
  it('toda situação tem rótulo', () => {
    for (const s of SITUACOES_DERIVADAS) expect(ROTULO_SITUACAO[s].length).toBeGreaterThan(3);
  });
});
