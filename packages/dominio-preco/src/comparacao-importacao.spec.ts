import { describe, expect, it } from 'vitest';
import { compararComVigente, lerArquivoPreco } from './comparacao-importacao.js';

describe('importação versionada: leitura, validação e comparação', () => {
  it('lê o leiaute com ponto-e-vírgula e vírgula decimal, com linha de total conferida', () => {
    const a = lerArquivoPreco(
      '﻿codigo;valor_ch;valor_co\n101;10,50;1\n102;1.234,5678;0\n#total;2;1245,0678\n',
    );
    expect(a.erros).toEqual([]);
    expect(a.colunas).toEqual(['ch', 'co']);
    expect(a.linhas.map((l) => l.valores.ch)).toEqual([10.5, 1234.5678]);
    expect(a.total).toBe(2);
  });
  it('vírgula como separador e ponto decimal', () => {
    const a = lerArquivoPreco('valor_ch,codigo\r\n12.5,7\r\n');
    expect(a.linhas).toEqual([{ linha: 2, codigo: 7, valores: { ch: 12.5 } }]);
  });
  it('código é id de linha (BIGINT): aceita o item próprio 10^12 + 1 e recusa acima de 2^53 - 1', () => {
    const a = lerArquivoPreco('codigo;valor_ch\n1000000000001;10\n');
    expect(a.erros).toEqual([]);
    expect(a.linhas.map((l) => l.codigo)).toEqual([10 ** 12 + 1]);
    const b = lerArquivoPreco('codigo;valor_ch\n9007199254740993;10\n0;10\n');
    expect(b.linhas).toEqual([]);
    expect(b.erros.map((e) => e.linha)).toEqual([2, 3]);
  });
  it('recusa leiaute sem coluna obrigatória ou com coluna estranha', () => {
    expect(lerArquivoPreco('codigo;preco\n1;2').erros[0]?.motivo).toMatch(/obrigatórias/);
    expect(lerArquivoPreco('codigo;valor_ch;nome\n1;2;x').erros[0]?.motivo).toMatch(/fora do leiaute/);
  });
  it('erros por linha: colunas, código, valor, repetido, casas, total', () => {
    const a = lerArquivoPreco(
      [
        'codigo;valor_ch;valor_anes',
        '1;10;1',
        '1;11;1',
        'x;10;1',
        '2;;1',
        '3;10',
        '4;10;1,234',
        '5;-1;0',
        '#total;9;99',
      ].join('\n'),
    );
    expect(a.linhas.map((l) => l.codigo)).toEqual([1]);
    expect(a.erros.map((e) => e.linha)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(lerArquivoPreco('codigo;valor_ch\n1;10\n#total;1;11').erros[0]?.motivo).toMatch(/Soma/);
    expect(lerArquivoPreco('codigo;valor_ch\n1;10\n#total;x;11').erros[0]?.motivo).toMatch(/ilegível/);
  });
  it('compara com a vigência: novos, removidos, alterados e iguais', () => {
    const arquivo = lerArquivoPreco('codigo;valor_ch\n1;10\n2;25\n9;30\n').linhas;
    const c = compararComVigente(arquivo, [
      { codigo: 1, nome: 'A', situacao: 'A', valores: { ch: 10, co: 0, filme: 0, anes: 0, outros: 0 } },
      { codigo: 2, nome: 'B', situacao: 'A', valores: { ch: 20, co: 0, filme: 0, anes: 0, outros: 0 } },
      { codigo: 3, nome: 'C', situacao: 'A', valores: { ch: 5, co: 0, filme: 0, anes: 0, outros: 0 } },
      { codigo: 4, nome: 'D', situacao: 'I', valores: { ch: 5, co: 0, filme: 0, anes: 0, outros: 0 } },
      { codigo: 5, nome: 'E', situacao: 'A', valores: null },
    ]);
    expect(c).toMatchObject({ novos: 1, removidos: 1, alterados: 1, iguais: 1 });
    expect(c.itens.map((i) => [i.codigo, i.resultado])).toEqual([
      [1, 'igual'],
      [2, 'alterado'],
      [3, 'removido'],
      [9, 'novo'],
    ]);
    const semPreco = compararComVigente(lerArquivoPreco('codigo;valor_ch\n5;1').linhas, [
      { codigo: 5, nome: 'E', situacao: 'A', valores: null },
    ]);
    expect(semPreco.alterados).toBe(1);
  });
  it('teto de linhas', () => {
    const linhas = ['codigo;valor_ch', ...Array.from({ length: 20001 }, (_, i) => `${i + 1};1`)];
    expect(lerArquivoPreco(linhas.join('\n')).erros.at(-1)?.motivo).toMatch(/teto/);
  });
});
