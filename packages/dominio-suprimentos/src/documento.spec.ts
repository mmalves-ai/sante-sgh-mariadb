// Regras 1 e 2 (ficha do M28): documento nasce F com DOC 0; consolidado não aceita item; cabeçalho só com todos os itens.
import { describe, expect, it } from 'vitest';
import {
  cabecalhoNovo,
  competenciaDaData,
  conferirNumeroInformado,
  ordemDaConsolidacao,
  podeConsolidarCabecalho,
  podeIncluirItem,
  TIPO_NUMERACAO,
} from '@sgh/contratos/regras-suprimentos';

describe('documento de estoque (regras 1 e 2)', () => {
  it('nasce não consolidado e sem número; número informado é recusado', () => {
    expect(cabecalhoNovo()).toEqual({ DOC: 0, CONSOL: 'F' });
    expect(conferirNumeroInformado(0)).toBeNull();
    expect(conferirNumeroInformado(null)).toBeNull();
    expect(conferirNumeroInformado(12)?.codigo).toBe('numero-informado');
  });
  it('consolidado não aceita item novo', () => {
    expect(podeIncluirItem({ consolidado: false })).toBeNull();
    expect(podeIncluirItem({ consolidado: true })?.codigo).toBe('documento-consolidado');
  });
  it('cabeçalho só consolida com itens e todos consolidados', () => {
    expect(podeConsolidarCabecalho({ consolidado: false, itens: [] })?.codigo).toBe('documento-sem-itens');
    expect(
      podeConsolidarCabecalho({ consolidado: false, itens: [{ consolidado: true }, { consolidado: false }] })
        ?.codigo,
    ).toBe('itens-nao-consolidados');
    expect(podeConsolidarCabecalho({ consolidado: false, itens: [{ consolidado: true }] })).toBeNull();
  });
  it('consolida os itens em ordem de ID e o cabeçalho por último', () => {
    expect(ordemDaConsolidacao([9, 3])).toEqual([
      { alvo: 'item', id: 3 },
      { alvo: 'item', id: 9 },
      { alvo: 'cabecalho' },
    ]);
  });
  it('a numeração por tipo é a dos gatilhos; a competência sai da data', () => {
    expect(TIPO_NUMERACAO).toEqual({ balanco: 1, nota: 2, saida: 3, devolucao: 4, transferencia: 5 });
    expect(competenciaDaData('2026-10-22')).toEqual({ ano: 2026, mes: 10 });
    expect(() => competenciaDaData('x')).toThrow();
  });
});
