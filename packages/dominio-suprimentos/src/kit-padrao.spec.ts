// F3.6 (05-SUP linha 13): kit padrão (composição e vínculo ao procedimento).
import { describe, expect, it } from 'vitest';
import {
  chaveProcedimentoKit,
  conferirKitDoPedido,
  conferirKitPadrao,
  somarKitAoPedido,
  diferencaItensKit,
  type KitPadraoConferido,
  linhasDoKitPadrao,
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

describe('linhasDoKitPadrao (o padrão muda a sugestão do gasto de sala)', () => {
  const padrao = { vinculo: 7, procedimento: 5, kit: 30, quantidadeKits: 2 };
  it('o kit padrão entra como linha geral do serviço, com a quantidade de kits e id negativo', () => {
    expect(linhasDoKitPadrao([], [padrao])).toEqual([
      {
        id: -7,
        procedimento: 5,
        cirurgiao: null,
        tipoAnestesia: null,
        insumo: null,
        kit: 30,
        quantidade: 2,
        obrigatorio: false,
        ativo: true,
      },
    ]);
  });
  it('a linha ativa da lista que já cita o kit prevalece; a inativa ou de outro procedimento, não', () => {
    expect(linhasDoKitPadrao([{ procedimento: 5, kit: 30, ativo: true }], [padrao])).toEqual([]);
    expect(linhasDoKitPadrao([{ procedimento: 5, kit: 30, ativo: false }], [padrao])).toHaveLength(1);
    expect(linhasDoKitPadrao([{ procedimento: 6, kit: 30, ativo: true }], [padrao])).toHaveLength(1);
  });
});

describe('kit padrão no pedido de material', () => {
  const kit = {
    kit: 7,
    itens: [
      { insumo: 10, nome: 'GAZE', quantidade: 2 },
      { insumo: 11, nome: 'SORO', quantidade: 0.5 },
    ],
  };
  it('cada item entra com a quantidade do kit vezes o número de kits, marcado com o kit', () => {
    expect(somarKitAoPedido([], kit, 3)).toEqual([
      { item: 10, nome: 'GAZE', quantidade: 6, kit: 7 },
      { item: 11, nome: 'SORO', quantidade: 1.5, kit: 7 },
    ]);
  });
  it('o item que já está no pedido soma na mesma linha; a linha digitada à mão fica sem a marca do kit', () => {
    const r = somarKitAoPedido([{ item: 10, nome: 'GAZE', quantidade: 1, kit: null }], kit, 1);
    expect(r).toEqual([
      { item: 10, nome: 'GAZE', quantidade: 3, kit: null },
      { item: 11, nome: 'SORO', quantidade: 0.5, kit: 7 },
    ]);
  });
  it('o mesmo kit somado de novo mantém a marca; outro kit sobre a linha tira a marca', () => {
    const uma = somarKitAoPedido([], kit, 1) ?? [];
    expect(somarKitAoPedido(uma, kit, 1)?.map((l) => [l.item, l.quantidade, l.kit])).toEqual([
      [10, 4, 7],
      [11, 1, 7],
    ]);
    const outro = { kit: 8, itens: [{ insumo: 10, nome: 'GAZE', quantidade: 1 }] };
    expect(somarKitAoPedido(uma, outro, 1)?.map((l) => [l.item, l.quantidade, l.kit])).toEqual([
      [10, 3, null],
      [11, 0.5, 7],
    ]);
  });
  it('não muda as linhas recebidas e não acumula erro de ponto flutuante', () => {
    const antes = [{ item: 11, nome: 'SORO', quantidade: 0.1, kit: 7 }];
    const fracao = { kit: 7, itens: [{ insumo: 11, nome: 'SORO', quantidade: 0.2 }] };
    expect(somarKitAoPedido(antes, fracao, 1)?.[0]?.quantidade).toBe(0.3);
    expect(antes[0]?.quantidade).toBe(0.1);
  });
  it('número de kits fora de 1 a 999, fracionado, ou kit sem item: nada é somado', () => {
    for (const q of [0, -1, 1.5, 1000, Number.NaN]) expect(somarKitAoPedido([], kit, q)).toBeNull();
    expect(somarKitAoPedido([], { kit: 7, itens: [] }, 1)).toBeNull();
  });
  it('a linha que cita o kit: kit inexistente, inativo e item fora da composição são recusados', () => {
    const codigos = (k: Parameters<typeof conferirKitDoPedido>[0], item: number) =>
      conferirKitDoPedido(k, item, 0).map((r) => r.codigo);
    expect(codigos(null, 10)).toEqual(['kit-inexistente']);
    expect(codigos({ ativo: false, insumos: [10] }, 10)).toEqual(['kit-inativo']);
    expect(codigos({ ativo: true, insumos: [11] }, 10)).toEqual(['item-fora-do-kit']);
    expect(codigos({ ativo: true, insumos: [10, 11] }, 10)).toEqual([]);
    expect(conferirKitDoPedido(null, 10, 2)[0]?.campos).toEqual(['itens.2.kit']);
  });
});
