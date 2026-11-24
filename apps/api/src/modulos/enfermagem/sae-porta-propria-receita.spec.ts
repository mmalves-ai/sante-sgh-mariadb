// Regras puras da receita do enfermeiro na porta própria: o protocolo gravado e lido, o tipo de receita pelo modelo e a
// validade pela data civil da emissão.
import { describe, expect, it } from 'vitest';
import { filtroDoModelo, protocoloGravado, protocoloLido, validadeDe } from './sae-porta-propria-receita.js';

describe('receita do enfermeiro (porta própria, regras puras)', () => {
  it('grava o protocolo como CODIGO/ANO e lê de volta (o código pode ter barra só antes do ano)', () => {
    expect(protocoloGravado('PROT-ENF.1', 2026)).toBe('PROT-ENF.1/2026');
    expect(protocoloLido('PROT-ENF.1/2026')).toEqual({ protocolo: 'PROT-ENF.1', ano: 2026 });
    expect(protocoloLido('SEM-ANO')).toEqual({ protocolo: 'SEM-ANO', ano: 0 });
  });

  it('o modelo de retenção é o tipo de antimicrobiano; o simples, o sem controle', () => {
    expect(filtroDoModelo('retencao')).toBe('antimicrobiano = TRUE AND controle_especial = FALSE');
    expect(filtroDoModelo('simples')).toBe('antimicrobiano = FALSE AND controle_especial = FALSE');
  });

  it('a validade soma os dias do tipo à data civil da emissão (nula sem os dias)', () => {
    expect(validadeDe('2026-11-24T10:30', 10)).toBe('2026-12-04');
    expect(validadeDe('2026-12-28T23:59', 10)).toBe('2027-01-07');
    expect(validadeDe('2026-11-24T10:30', null)).toBeNull();
    expect(validadeDe('2026-11-24T10:30', 0)).toBeNull();
  });
});
