// F3.8, 07-FIN linha 89: taxa vigente da administradora e parcelas a receber, líquidas e com data prevista.
import { describe, expect, it } from 'vitest';
import { escolherTaxa, gerarParcelasRecebivel, type TaxaAdministradora } from './recebivel-cartao.js';

const base: TaxaAdministradora = {
  id: 1,
  administradora: 10,
  bandeira: null,
  modalidade: 'credito',
  parcelaInicial: 1,
  parcelaFinal: 12,
  tipo: 'percentual',
  percentual: 3,
  valor: null,
  diasRepasse: 30,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
};

const pedido = {
  administradora: 10,
  bandeira: 7,
  modalidade: 'credito' as const,
  parcelas: 3,
  data: '2026-11-24',
};

describe('escolherTaxa', () => {
  it('a taxa da bandeira vence a geral; entre iguais, a vigência mais recente', () => {
    const taxas = [
      base,
      { ...base, id: 2, bandeira: 7, percentual: 2.5 },
      { ...base, id: 3, bandeira: 7, percentual: 2.2, vigenciaInicio: '2026-06-01' },
      { ...base, id: 4, bandeira: 8, percentual: 1 },
    ];
    const r = escolherTaxa(taxas, pedido);
    expect('taxa' in r && r.taxa.id).toBe(3);
  });

  it('respeita a faixa de parcelas, a vigência e o ativo', () => {
    const taxas = [
      { ...base, id: 5, parcelaInicial: 1, parcelaFinal: 1 },
      { ...base, id: 6, parcelaInicial: 2, parcelaFinal: 6, vigenciaFim: '2026-10-31' },
      { ...base, id: 7, parcelaInicial: 2, parcelaFinal: 6, ativo: false },
      { ...base, id: 8, parcelaInicial: 2, parcelaFinal: 6, vigenciaInicio: '2026-11-01', percentual: 4 },
    ];
    const r = escolherTaxa(taxas, pedido);
    expect('taxa' in r && r.taxa.id).toBe(8);
  });

  it('sem taxa vigente a venda é recusada; débito parcelado também', () => {
    const r = escolherTaxa([{ ...base, administradora: 11 }], pedido);
    expect('recusa' in r && r.recusa.codigo).toBe('taxa-cartao-ausente');
    const d = escolherTaxa([{ ...base, modalidade: 'debito' }], { ...pedido, modalidade: 'debito' });
    expect('recusa' in d && d.recusa.codigo).toBe('parcelas-cartao-a-vista');
    const z = escolherTaxa([base], { ...pedido, parcelas: 0 });
    expect('recusa' in z && z.recusa.codigo).toBe('parcelas-cartao-invalidas');
  });
});

describe('gerarParcelasRecebivel', () => {
  it('reparte o bruto e a taxa em centavos, com o resto na primeira, e prevê a data de cada crédito', () => {
    const r = gerarParcelasRecebivel({ valor: 100, parcelas: 3, dataVenda: '2026-11-24', taxa: base });
    if (!('parcelas' in r)) throw new Error('recusado');
    expect(r.parcelas.map((x) => x.bruto)).toEqual([33.34, 33.33, 33.33]);
    expect(r.parcelas.map((x) => x.taxa)).toEqual([1, 1, 1]);
    expect(r.parcelas.map((x) => x.liquido)).toEqual([32.34, 32.33, 32.33]);
    expect(r.parcelas.map((x) => x.dataPrevista)).toEqual(['2026-12-24', '2027-01-23', '2027-02-22']);
    const soma = (k: 'bruto' | 'taxa' | 'liquido') =>
      Math.round(r.parcelas.reduce((s, x) => s + x[k] * 100, 0));
    expect(soma('bruto')).toBe(10000);
    expect(soma('taxa') + soma('liquido')).toBe(10000);
    expect(r.parcelas.every((x) => x.percentualTaxa === 3)).toBe(true);
  });

  it('taxa em valor fixo por transação; débito à vista no prazo de repasse', () => {
    const t: TaxaAdministradora = {
      ...base,
      modalidade: 'debito',
      tipo: 'valor',
      percentual: null,
      valor: 0.5,
      diasRepasse: 1,
    };
    const r = gerarParcelasRecebivel({ valor: 80, parcelas: 1, dataVenda: '2026-12-31', taxa: t });
    if (!('parcelas' in r)) throw new Error('recusado');
    expect(r.parcelas).toEqual([
      {
        sequencia: 1,
        dataPrevista: '2027-01-01',
        bruto: 80,
        percentualTaxa: 0.625,
        taxa: 0.5,
        liquido: 79.5,
      },
    ]);
  });

  it('recusa valor não positivo e taxa maior que o valor', () => {
    const z = gerarParcelasRecebivel({ valor: 0, parcelas: 1, dataVenda: '2026-11-24', taxa: base });
    expect('recusa' in z && z.recusa.codigo).toBe('valor-cartao-invalido');
    const t = { ...base, tipo: 'valor' as const, percentual: null, valor: 5 };
    const m = gerarParcelasRecebivel({ valor: 4, parcelas: 1, dataVenda: '2026-11-24', taxa: t });
    expect('recusa' in m && m.recusa.codigo).toBe('taxa-cartao-maior-que-valor');
  });
});
