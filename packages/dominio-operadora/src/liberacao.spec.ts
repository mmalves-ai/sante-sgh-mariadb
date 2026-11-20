// Regra 1 do M56: tudo desligado por padrão; a fatia só vale com o módulo ligado; desligar o módulo recolhe tudo.
import { CHAVES_FATIA_OPERADORA, CHAVES_OPERADORA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  chaveDaFatia,
  chaveOperadoraValendo,
  ehChaveOperadora,
  situacaoChaveOperadora,
  situacaoModuloOperadora,
} from './liberacao.js';

describe('chaves da operadora (regra 1)', () => {
  it('sem chave registrada, o módulo e todas as fatias estão desligados', () => {
    const s = situacaoModuloOperadora(new Set());
    expect(s.modulo).toBe('desligada');
    expect(Object.values(s.fatias).every((x) => x === 'desligada')).toBe(true);
    expect(Object.keys(s.fatias)).toHaveLength(CHAVES_FATIA_OPERADORA.length);
    for (const c of CHAVES_OPERADORA) expect(chaveOperadoraValendo(c, new Set()), c).toBe(false);
  });

  it('a fatia ligada sem o módulo fica aguardando e não vale', () => {
    const ligadas = new Set(['operadora.beneficiarios']);
    expect(situacaoChaveOperadora('operadora.beneficiarios', ligadas)).toBe('aguardando-modulo');
    expect(chaveOperadoraValendo('operadora.beneficiarios', ligadas)).toBe(false);
    expect(situacaoModuloOperadora(ligadas).aguardandoModulo).toEqual(['beneficiarios']);
  });

  it('com o módulo ligado, só valem as fatias ligadas', () => {
    const ligadas = new Set(['operadora', 'operadora.beneficiarios']);
    expect(chaveOperadoraValendo('operadora', ligadas)).toBe(true);
    expect(chaveOperadoraValendo(chaveDaFatia('beneficiarios'), ligadas)).toBe(true);
    expect(chaveOperadoraValendo(chaveDaFatia('cobranca'), ligadas)).toBe(false);
    expect(situacaoModuloOperadora(ligadas).aguardandoModulo).toEqual([]);
  });

  it('desligar o módulo recolhe todas as fatias sem mexer nelas', () => {
    const todas = new Set<string>(CHAVES_OPERADORA);
    expect(situacaoModuloOperadora(todas).aguardandoModulo).toEqual([]);
    todas.delete('operadora');
    const s = situacaoModuloOperadora(todas);
    expect(s.modulo).toBe('desligada');
    expect(s.aguardandoModulo).toHaveLength(CHAVES_FATIA_OPERADORA.length);
  });

  it('reconhece só as chaves da operadora', () => {
    expect(ehChaveOperadora('operadora')).toBe(true);
    expect(ehChaveOperadora('operadora.ans')).toBe(true);
    expect(ehChaveOperadora('operadora.qualquer')).toBe(false);
    expect(ehChaveOperadora('pessoas.esocial')).toBe(false);
  });
});
