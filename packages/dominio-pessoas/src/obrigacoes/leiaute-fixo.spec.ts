// M53-F7: o motor dos arquivos de posição fixa (tamanho, alinhamento, recusa do que não cabe). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  arquivoDeLinhas,
  campoDaLinha,
  competenciaAAAAMM,
  competenciaMMAAAA,
  dataDDMMAAAA,
  ErroLeiauteFixo,
  type LeiauteRegistro,
  montarRegistro,
  tamanhoDoLeiaute,
  textoLeiaute,
} from './leiaute-fixo.js';

const L: LeiauteRegistro = {
  registro: 'T',
  tamanho: 20,
  campos: [
    { nome: 'tipo', tamanho: 2, tipo: 'F', fixo: 'T1' },
    { nome: 'numero', tamanho: 5, tipo: 'N' },
    { nome: 'nome', tamanho: 8, tipo: 'A' },
    { nome: 'padrao', tamanho: 2, tipo: 'A', fixo: 'XY' },
    { nome: 'brancos', tamanho: 2, tipo: 'B' },
    { nome: 'fim', tamanho: 1, tipo: 'F', fixo: '*' },
  ],
};

describe('montarRegistro', () => {
  it('alinha número à direita com zeros e texto à esquerda com brancos, em maiúsculas e sem acento', () => {
    const l = montarRegistro(L, { numero: 42, nome: 'joão  çá' });
    expect(l).toBe('T100042JOAO CA XY  *');
    expect(l).toHaveLength(20);
    expect(campoDaLinha(L, l, 'numero')).toBe('00042');
    expect(campoDaLinha(L, l, 'padrao')).toBe('XY');
  });

  it('vazio: zeros no numérico e brancos no texto; texto maior é cortado; o padrão cede ao valor', () => {
    expect(montarRegistro(L, { numero: null, nome: undefined, padrao: 'ZZ' })).toBe('T100000        ZZ  *');
    expect(montarRegistro(L, { numero: '', nome: 'Nome muito comprido' })).toBe('T100000NOME MUIXY  *');
  });

  it('recusa número que não cabe ou com letra, e leiaute de tamanho errado', () => {
    expect(() => montarRegistro(L, { numero: 123456 })).toThrow(ErroLeiauteFixo);
    expect(() => montarRegistro(L, { numero: '12a' })).toThrow(/não numérico/);
    expect(() => montarRegistro({ ...L, tamanho: 21 }, {})).toThrow(/esperado 21/);
    const fixoErrado: LeiauteRegistro = {
      registro: 'X',
      tamanho: 2,
      campos: [{ nome: 'tipo', tamanho: 2, tipo: 'F', fixo: 'X' }],
    };
    expect(() => montarRegistro(fixoErrado, {})).toThrow(/valor fixo/);
    const semFixo: LeiauteRegistro = {
      registro: 'Y',
      tamanho: 1,
      campos: [{ nome: 'f', tamanho: 1, tipo: 'F' }],
    };
    expect(() => montarRegistro(semFixo, {})).toThrow(/valor fixo/);
    expect(() => campoDaLinha(L, 'x', 'nada')).toThrow(/inexistente/);
    expect(tamanhoDoLeiaute(L)).toBe(20);
  });
});

describe('formatos', () => {
  it('datas e competências dos leiautes, texto limpo e arquivo com CRLF', () => {
    expect(dataDDMMAAAA('2019-03-05')).toBe('05032019');
    expect(dataDDMMAAAA(null)).toBe('');
    expect(competenciaAAAAMM('2019-03')).toBe('201903');
    expect(competenciaMMAAAA('2019-03')).toBe('032019');
    expect(textoLeiaute('  Ação #1 – ok ')).toBe('ACAO 1 OK');
    expect(arquivoDeLinhas(['a', 'b'])).toBe('a\r\nb\r\n');
  });
});
