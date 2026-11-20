// Regra 10 (ficha do M30): C conta por pacote; item S incluso, X excluído; P, D e F "a confirmar" (DP-46.5).
import { describe, expect, it } from 'vitest';
import { conferirContaPacote, ehContaPacote, legendaPacoteConta, legendaPacoteItem } from '../index.js';

describe('pacote (regra 10)', () => {
  it('legenda da conta', () => {
    expect(legendaPacoteConta('C')).toEqual({ rotulo: 'Conta por pacote', aConfirmar: false });
    expect(legendaPacoteConta('N').aConfirmar).toBe(false);
    expect(legendaPacoteConta(null).rotulo).toBe('Sem pacote');
    for (const x of ['P', 'D', 'F']) expect(legendaPacoteConta(x).aConfirmar).toBe(true);
    expect(legendaPacoteConta('Q').rotulo).toContain('a confirmar');
    expect(ehContaPacote(' c ')).toBe(true);
    expect(ehContaPacote('N')).toBe(false);
  });
  it('legenda do item', () => {
    expect(legendaPacoteItem('S').rotulo).toBe('Incluso no pacote');
    expect(legendaPacoteItem('X').rotulo).toContain('Excluído');
    expect(legendaPacoteItem('').rotulo).toBe('Fora de pacote');
    expect(legendaPacoteItem('Z').aConfirmar).toBe(true);
  });
  it('confere a conta pacote contra o pacote vigente (sem mudar o cálculo)', () => {
    const itens = [
      { codigo: 1, pacote: 'S' },
      { codigo: 2, pacote: 'X' },
    ];
    expect(conferirContaPacote({ totalConta: 500 }, itens, { valor: 500, inclusos: [1] })).toEqual({
      confere: true,
      avisos: [],
    });
    const r = conferirContaPacote(
      { totalConta: 450 },
      [...itens, { codigo: 3, pacote: 'S' }, { codigo: 4, pacote: 'N' }],
      {
        valor: 500,
        inclusos: [1, 4],
      },
    );
    expect(r.confere).toBe(false);
    expect(r.avisos).toHaveLength(3);
    expect(conferirContaPacote({ totalConta: 1 }, itens, null).avisos[0]).toContain('Nenhum pacote');
  });
});
