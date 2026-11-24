// F3.6 (05-SUP linha 13): kit padrão (composição e vínculo ao procedimento).
import { describe, expect, it } from 'vitest';
import {
  chaveProcedimentoKit,
  conferirKitPadrao,
  diferencaItensKit,
  type KitPadraoConferido,
} from '@sgh/contratos';

const base: KitPadraoConferido = {
  codigo: 'K1',
  nome: 'Curativo simples',
  tipo: 'procedimento',
  ativo: true,
  itens: [{ insumo: 10, quantidade: 2, obrigatorioRastreavel: false }],
  procedimentos: [{ procedimentoCirurgico: 5, itemFaturavel: null, quantidadeKits: 1, padrao: true }],
};
const codigos = (k: KitPadraoConferido) => conferirKitPadrao(k).map((r) => r.codigo);

describe('conferirKitPadrao', () => {
  it('kit completo passa', () => {
    expect(conferirKitPadrao(base)).toEqual([]);
  });
  it('código e nome obrigatórios', () => {
    expect(codigos({ ...base, codigo: ' ', nome: '' })).toEqual(['kit-sem-codigo', 'kit-sem-nome']);
  });
  it('kit ativo sem itens é recusado; inativo sem itens passa', () => {
    expect(codigos({ ...base, itens: [] })).toEqual(['kit-sem-itens']);
    expect(codigos({ ...base, itens: [], ativo: false, procedimentos: [] })).toEqual([]);
  });
  it('item repetido e quantidade zero apontam a linha', () => {
    const r = conferirKitPadrao({
      ...base,
      itens: [
        { insumo: 10, quantidade: 1, obrigatorioRastreavel: false },
        { insumo: 10, quantidade: 0, obrigatorioRastreavel: false },
      ],
    });
    expect(r.map((x) => x.codigo)).toEqual(['kit-item-repetido', 'kit-quantidade-invalida']);
    expect(r[0]?.campos).toEqual(['itens.1.insumo']);
    expect(r[1]?.campos).toEqual(['itens.1.quantidade']);
  });
  it('kit de emergência exige item obrigatório na conferência do carrinho', () => {
    expect(codigos({ ...base, tipo: 'emergencia' })).toEqual(['kit-emergencia-sem-obrigatorio']);
    expect(
      codigos({
        ...base,
        tipo: 'emergencia',
        itens: [{ insumo: 10, quantidade: 1, obrigatorioRastreavel: true }],
      }),
    ).toEqual([]);
  });
  it('vínculo: um alvo só, sem repetir, quantidade positiva', () => {
    expect(
      codigos({
        ...base,
        procedimentos: [
          { procedimentoCirurgico: 5, itemFaturavel: 7, quantidadeKits: 1, padrao: false },
          { procedimentoCirurgico: null, itemFaturavel: null, quantidadeKits: 1, padrao: false },
          { procedimentoCirurgico: null, itemFaturavel: 7, quantidadeKits: 1, padrao: false },
          { procedimentoCirurgico: null, itemFaturavel: 7, quantidadeKits: 0, padrao: false },
        ],
      }),
    ).toEqual([
      'kit-vinculo-sem-alvo',
      'kit-vinculo-sem-alvo',
      'kit-vinculo-repetido',
      'kit-quantidade-invalida',
    ]);
  });
  it('kit inativo não pode ser o padrão de um procedimento', () => {
    expect(codigos({ ...base, ativo: false })).toEqual(['kit-inativo-padrao']);
  });
  it('a chave do vínculo distingue cirurgia e procedimento faturável', () => {
    expect(chaveProcedimentoKit({ procedimentoCirurgico: 3, itemFaturavel: null })).toBe('c3');
    expect(chaveProcedimentoKit({ procedimentoCirurgico: null, itemFaturavel: 3 })).toBe('f3');
  });
});

describe('diferencaItensKit', () => {
  const i = (insumo: number, quantidade = 1, obrigatorioRastreavel = false) => ({
    insumo,
    quantidade,
    obrigatorioRastreavel,
    permiteSubstituto: false,
  });
  it('separa o que entra, o que muda e o que sai', () => {
    const d = diferencaItensKit([i(1), i(2), i(3)], [i(1), i(2, 5), i(4)]);
    expect(d.entram.map((x) => x.insumo)).toEqual([4]);
    expect(d.mudam.map((x) => x.insumo)).toEqual([2]);
    expect(d.saem.map((x) => x.insumo)).toEqual([3]);
  });
  it('sem mudança, nada a gravar', () => {
    const d = diferencaItensKit([i(1, 2, true)], [i(1, 2, true)]);
    expect([d.entram, d.mudam, d.saem]).toEqual([[], [], []]);
  });
});
