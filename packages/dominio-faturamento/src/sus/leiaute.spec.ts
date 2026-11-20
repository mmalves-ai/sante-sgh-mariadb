import { describe, expect, it } from 'vitest';
import {
  conferirEstrutura,
  ErroLeiaute,
  FIM_DE_LINHA,
  formatarCampo,
  type Leiaute,
  lerLinha,
  montarLinha,
  tamanhoDoRegistro,
  textoAscii,
} from './leiaute.js';

const L: Leiaute = {
  nome: 'TESTE',
  versao: '1',
  conferidoContraOficial: true,
  fonte: 'sintético',
  registros: {
    '01': {
      tipo: '01',
      campos: [
        { nome: 'tipo', tamanho: 2, tipo: 'N', obrigatorio: true, fixo: '01' },
        { nome: 'n', tamanho: 4, tipo: 'N', obrigatorio: true },
        { nome: 'a', tamanho: 5, tipo: 'A', obrigatorio: false },
      ],
    },
  },
};

describe('leiaute de largura fixa', () => {
  it('numérico com zeros à esquerda; alfanumérico em maiúsculas, sem acento, com espaços à direita', () => {
    expect(formatarCampo('01', L.registros['01']!.campos[1]!, 42)).toBe('0042');
    expect(formatarCampo('01', L.registros['01']!.campos[2]!, 'São')).toBe('SAO  ');
    expect(formatarCampo('01', L.registros['01']!.campos[2]!, null)).toBe('     ');
    expect(formatarCampo('01', { nome: 'x', tamanho: 3, tipo: 'N', obrigatorio: false }, undefined)).toBe(
      '000',
    );
    expect(textoAscii('ação\tç€')).toBe('ACAO C ');
  });

  it('recusa obrigatório vazio, numérico com letra e o que não cabe', () => {
    const c = L.registros['01']!.campos;
    expect(() => formatarCampo('01', c[1]!, '')).toThrow(ErroLeiaute);
    expect(() => formatarCampo('01', c[1]!, '12a')).toThrow(/nao-numerico/);
    expect(() => formatarCampo('01', c[1]!, 12345)).toThrow(/tamanho-excedido/);
  });

  it('monta, lê de volta e confere a estrutura', () => {
    const linha = montarLinha(L, '01', { n: 7, a: 'ok' });
    expect(linha).toBe('010007OK   ');
    expect(linha.length).toBe(tamanhoDoRegistro(L.registros['01']!));
    expect(lerLinha(L, '01', linha)).toEqual({ tipo: '01', n: '0007', a: 'OK   ' });
    expect(conferirEstrutura(L, linha + FIM_DE_LINHA)).toEqual([]);
    expect(conferirEstrutura(L, `${linha}X${FIM_DE_LINHA}99${FIM_DE_LINHA}`)).toEqual([
      { linha: 1, problema: 'tamanho-errado' },
      { linha: 2, problema: 'tipo-desconhecido' },
    ]);
    expect(() => montarLinha(L, '09', {})).toThrow(/inexistente/);
    expect(() => lerLinha(L, '09', '')).toThrow(/inexistente/);
  });

  it('acusa campo fixo diferente fora da primeira posição', () => {
    const L2: Leiaute = {
      ...L,
      registros: {
        '01': {
          tipo: '01',
          campos: [
            { nome: 'tipo', tamanho: 2, tipo: 'N', obrigatorio: true, fixo: '01' },
            { nome: 'v', tamanho: 1, tipo: 'A', obrigatorio: true, fixo: 'V' },
          ],
        },
      },
    };
    expect(conferirEstrutura(L2, `01V${FIM_DE_LINHA}01X${FIM_DE_LINHA}`)).toEqual([
      { linha: 2, problema: 'fixo-diferente' },
    ]);
  });
});
