// C3-008 (05-SUP linha 19): a porta genérica do portal de cotação e o primeiro adaptador (troca do mapa por arquivo).
import { describe, expect, it } from 'vitest';
import {
  ADAPTADOR_ARQUIVO_COTACAO,
  COLUNAS_MAPA_COTACAO,
  lerArquivoRespostas,
  lerCsv,
  lerValorPlanilha,
  montarArquivoCotacao,
  recusaDaLeitura,
  totalDasRespostas,
} from './index.js';

const prop = (id: number, item: number, fornecedor: number, nome = `Fornecedor ${fornecedor}`) => ({
  id,
  item,
  seq: 1,
  fornecedor,
  fornecedorNome: nome,
  quantidade: 10,
  valorUnitario: 0,
  marca: '',
});
const propostas = [prop(1, 50, 0), prop(2, 50, 7, 'Alfa; Beta "Ltda"'), prop(3, 50, 8), prop(4, 51, 7)];
const itens = [
  { item: 50, seq: 1, nome: 'Luva de procedimento' },
  { item: 51, seq: 1, nome: 'Seringa 10 ml' },
];
const cab = COLUNAS_MAPA_COTACAO.join(';');

describe('mapa de cotação em arquivo', () => {
  it('monta o cabeçalho fixo e uma linha por proposta de fornecedor (nunca a linha mestre), com aspas no nome', () => {
    const t = montarArquivoCotacao(itens, propostas);
    const linhas = lerCsv(t);
    expect(linhas[0]).toEqual([...COLUNAS_MAPA_COTACAO]);
    expect(linhas.slice(1).map((l) => l[0])).toEqual(['2', '3', '4']);
    expect(linhas[1]).toEqual([
      '2',
      '50',
      '1',
      'Luva de procedimento',
      '10',
      '7',
      'Alfa; Beta "Ltda"',
      '',
      '',
    ]);
    expect(t.endsWith('\r\n')).toBe(true);
  });

  it('ida e volta: o arquivo gerado, preenchido, volta como respostas', () => {
    const t = montarArquivoCotacao(itens, [{ ...propostas[1]!, valorUnitario: 1.5, marca: 'X' }]);
    const l = ADAPTADOR_ARQUIVO_COTACAO.lerRespostas(t, propostas);
    expect(l).toEqual({
      respostas: [{ proposta: 2, valorUnitario: 1.5, marca: 'X' }],
      recusas: [],
      semPreco: 0,
    });
  });

  it('lê valores da planilha brasileira', () => {
    expect(lerValorPlanilha('1.234,56')).toBe(1234.56);
    expect(lerValorPlanilha('R$ 12,5')).toBe(12.5);
    expect(lerValorPlanilha('12.5')).toBe(12.5);
    expect(lerValorPlanilha('1.234')).toBe(1234);
    expect(lerValorPlanilha('')).toBeNull();
    expect(lerValorPlanilha('abc')).toBeNaN();
  });

  it('aceita o BOM, pula a linha sem preço e a linha em branco', () => {
    const t = `\uFEFF${cab}\r\n2;50;1;Luva;10;7;A;2,30;Marca A\r\n3;50;1;Luva;10;8;B;;\r\n\r\n4;51;1;Seringa;10;7;A;0,9;\r\n`;
    const l = lerArquivoRespostas(t, propostas);
    expect(l.recusas).toEqual([]);
    expect(l.semPreco).toBe(1);
    expect(l.respostas).toEqual([
      { proposta: 2, valorUnitario: 2.3, marca: 'Marca A' },
      { proposta: 4, valorUnitario: 0.9 },
    ]);
    expect(totalDasRespostas(l.respostas, propostas)).toEqual({ total: 32, parcelas: [23, 9] });
  });

  it('recusa com o número da linha: proposta de outro pedido, linha mestre, repetida, outro fornecedor, valor e marca', () => {
    const t = [
      cab,
      '99;50;1;Luva;10;7;A;1;',
      '1;50;1;Luva;10;0;-;1;',
      '2;50;1;Luva;10;7;A;1;',
      '2;50;1;Luva;10;7;A;1;',
      '3;50;1;Luva;10;7;A;1;',
      '4;51;1;Seringa;10;7;A;-1;',
      `4;51;1;Seringa;10;;A;1;${'m'.repeat(26)}`,
    ].join('\n');
    const l = lerArquivoRespostas(t, propostas);
    expect(l.recusas.map((r) => [r.linha, r.codigo])).toEqual([
      [2, 'proposta-inexistente'],
      [3, 'proposta-inexistente'],
      [5, 'proposta-repetida'],
      [6, 'fornecedor-diferente'],
      [7, 'valor-invalido'],
      [8, 'proposta-repetida'],
    ]);
    expect(recusaDaLeitura(l)).toEqual({
      codigo: 'proposta-inexistente',
      mensagem: 'Linha 2: A proposta não é deste pedido.',
      campos: ['arquivo'],
    });
  });

  it('recusa a marca longa e as 5 casas decimais', () => {
    const t = `${cab}\n2;;;;;;;1,00001;\n3;;;;;;;1;${'m'.repeat(26)}\n`;
    expect(lerArquivoRespostas(t, propostas).recusas.map((r) => r.codigo)).toEqual([
      'valor-invalido',
      'marca-longa',
    ]);
  });

  it('recusa o arquivo sem as colunas do mapa e o arquivo sem nenhum preço', () => {
    expect(lerArquivoRespostas('a;b\n1;2\n', propostas).recusas[0]?.codigo).toBe('cabecalho');
    expect(lerArquivoRespostas(`${cab}\n2;50;1;L;10;7;A;;\n`, propostas).recusas[0]?.codigo).toBe(
      'sem-resposta',
    );
    expect(recusaDaLeitura({ respostas: [], recusas: [], semPreco: 0 })).toBeNull();
  });
});
