// C2-015 (05-SUP linha 22): devolução de compra ao fornecedor. A quantidade nunca passa do que entrou menos o que já
// voltou; a chave da NF-e de devolução é conferida (44 dígitos, modelo 55, dígito em módulo 11); o valor sai pelo custo
// da compra; o crédito abate as parcelas a pagar pela ordem de vencimento e o que sobra fica pendente.
import { describe, expect, it } from 'vitest';
import {
  chaveNfeValida,
  conferirDevolucaoFornecedor,
  type DevolucaoParaConferir,
  disponivelParaDevolver,
  distribuirAbatimento,
  tipoDaDevolucao,
  valoresDevolucao,
} from '../index.js';

/** Chave sintética com o dígito calculado (UF 35, AAMM 2611, CNPJ 0…01, modelo 55). */
function chaveSintetica(numero: string): string {
  const base = `352611${'0'.repeat(13)}1` + `55001${numero.padStart(9, '0')}1${'1'.repeat(8)}`;
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return `${base}${resto < 2 ? 0 : 11 - resto}`;
}

const base = (x: Partial<DevolucaoParaConferir> = {}): DevolucaoParaConferir => ({
  situacaoNota: 'confirmada',
  entradaEm: '2026-11-10',
  hoje: '2026-11-25',
  motivoAtivo: true,
  itens: [{ notaItem: 1, quantidade: 4, recebida: 10, jaDevolvida: 3 }],
  numeroNotaFiscal: null,
  chaveAcesso: null,
  dataEmissao: null,
  ...x,
});
const codigos = (d: DevolucaoParaConferir) => conferirDevolucaoFornecedor(d).map((x) => x.codigo);

describe('devolução ao fornecedor: conferência', () => {
  it('aceita a devolução dentro do disponível, sem nota fiscal ainda', () => {
    expect(codigos(base())).toEqual([]);
    expect(disponivelParaDevolver({ recebida: 10, jaDevolvida: 3 })).toBe(7);
  });
  it('recusa a quantidade acima do que entrou menos o que já voltou, zero e item repetido', () => {
    expect(
      codigos(base({ itens: [{ notaItem: 1, quantidade: 7.5, recebida: 10, jaDevolvida: 3 }] })),
    ).toEqual(['quantidade-acima-do-recebido']);
    expect(codigos(base({ itens: [{ notaItem: 1, quantidade: 0, recebida: 10, jaDevolvida: 0 }] }))).toEqual([
      'quantidade-invalida',
    ]);
    const i = { notaItem: 1, quantidade: 1, recebida: 10, jaDevolvida: 0 };
    expect(codigos(base({ itens: [i, i] }))).toEqual(['item-repetido']);
    expect(codigos(base({ itens: [] }))).toEqual(['sem-itens']);
  });
  it('recusa a nota não confirmada e o motivo inativo', () => {
    expect(codigos(base({ situacaoNota: 'cancelada', motivoAtivo: false }))).toEqual([
      'nota-nao-confirmada',
      'motivo-invalido',
    ]);
  });
  it('confere a chave de acesso da NF-e e exige o número junto', () => {
    const ok = chaveSintetica('123');
    expect(chaveNfeValida(ok)).toBe(true);
    const errada = `${ok.slice(0, 43)}${(Number(ok[43]) + 1) % 10}`;
    expect(chaveNfeValida(errada)).toBe(false);
    expect(chaveNfeValida(`${ok.slice(0, 20)}65${ok.slice(22)}`)).toBe(false);
    expect(codigos(base({ chaveAcesso: ok, numeroNotaFiscal: '123', dataEmissao: '2026-11-20' }))).toEqual(
      [],
    );
    expect(codigos(base({ chaveAcesso: errada, numeroNotaFiscal: '123' }))).toEqual([
      'chave-acesso-invalida',
    ]);
    expect(codigos(base({ chaveAcesso: ok }))).toEqual(['numero-nota-obrigatorio']);
  });
  it('a emissão não pode ser futura nem anterior à entrada', () => {
    expect(codigos(base({ dataEmissao: '2026-11-26' }))).toEqual(['emissao-futura']);
    expect(codigos(base({ dataEmissao: '2026-11-09' }))).toEqual(['emissao-antes-da-entrada']);
  });
});

describe('devolução ao fornecedor: valores e abatimento', () => {
  it('o valor sai pelo custo da compra, em centavos', () => {
    expect(
      valoresDevolucao([
        { quantidade: 3, valorUnitario: 1.3333 },
        { quantidade: 2, valorUnitario: 5 },
      ]),
    ).toEqual({
      itens: [4, 10],
      total: 14,
    });
  });
  it('total só quando tudo o que entrou volta', () => {
    const nota = [
      { notaItem: 1, recebida: 10, jaDevolvida: 6 },
      { notaItem: 2, recebida: 5, jaDevolvida: 5 },
    ];
    expect(tipoDaDevolucao(nota, [{ notaItem: 1, quantidade: 4 }])).toBe('total');
    expect(tipoDaDevolucao(nota, [{ notaItem: 1, quantidade: 3 }])).toBe('parcial');
  });
  it('abate pela ordem de vencimento até o saldo de cada parcela e deixa a sobra pendente', () => {
    const parcelas = [
      { parcela: 2, saldo: 50, vencimento: '2026-12-30' },
      { parcela: 1, saldo: 30, vencimento: '2026-12-01' },
      { parcela: 3, saldo: 0, vencimento: '2026-11-30' },
    ];
    expect(distribuirAbatimento(40, parcelas)).toEqual({
      abatimentos: [
        { parcela: 1, valor: 30 },
        { parcela: 2, valor: 10 },
      ],
      pendente: 0,
    });
    expect(distribuirAbatimento(100, parcelas)).toEqual({
      abatimentos: [
        { parcela: 1, valor: 30 },
        { parcela: 2, valor: 50 },
      ],
      pendente: 20,
    });
    expect(distribuirAbatimento(15, [])).toEqual({ abatimentos: [], pendente: 15 });
  });
});
