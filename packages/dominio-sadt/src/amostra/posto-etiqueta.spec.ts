// Posto de coleta e etiqueta da recoleta e da alíquota (F3.5, 05-SADT linha 7): regra pura, dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  type CadastroDoPosto,
  conferirCadastroDoPosto,
  conferirPostoNaColeta,
  LARGURA_LINHA_ETIQUETA,
  linhaDaEtiqueta,
  RecusaAmostra,
  tipoDaEtiqueta,
  viaDaEtiqueta,
} from './recoleta.js';

const codigoDe = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof RecusaAmostra ? e.codigo : String(e);
  }
};

const posto: CadastroDoPosto = {
  codigo: ' pc-01 ',
  descricao: '  Posto do térreo ',
  tipo: 'interno',
  setorLaboratorio: 7,
  horarioInicio: '07:00',
  horarioFim: '17:00',
  funcionaFimDeSemana: false,
};

describe('cadastro do posto de coleta', () => {
  it('normaliza o código e a descrição', () => {
    expect(conferirCadastroDoPosto(posto)).toMatchObject({ codigo: 'PC-01', descricao: 'Posto do térreo' });
  });

  it('recusa código inválido ou repetido, descrição curta, tipo desconhecido e posto sem setor', () => {
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, codigo: 'com espaço' }))).toBe(
      'posto-codigo-invalido',
    );
    expect(codigoDe(() => conferirCadastroDoPosto(posto, ['pc-01']))).toBe('posto-codigo-repetido');
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, descricao: 'ab' }))).toBe(
      'posto-descricao-invalida',
    );
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, tipo: 'movel' as never }))).toBe(
      'posto-tipo-invalido',
    );
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, setorLaboratorio: null }))).toBe(
      'posto-sem-setor',
    );
  });

  it('o horário vai inteiro (início e fim) e com o fim depois do início; sem horário também vale', () => {
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, horarioFim: null }))).toBe(
      'posto-horario-incompleto',
    );
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, horarioFim: '07:00' }))).toBe(
      'posto-horario-invalido',
    );
    expect(codigoDe(() => conferirCadastroDoPosto({ ...posto, horarioInicio: '7h' }))).toBe(
      'posto-horario-invalido',
    );
    expect(conferirCadastroDoPosto({ ...posto, horarioInicio: null, horarioFim: '' })).toMatchObject({
      horarioInicio: null,
      horarioFim: null,
    });
  });
});

describe('posto escolhido na coleta', () => {
  const p = { ativo: true, horarioInicio: '07:00', horarioFim: '17:00', funcionaFimDeSemana: false };
  const terca = { diaSemana: 2, hora: '10:30' };

  it('sem posto informado a coleta segue (beira do leito)', () => {
    expect(conferirPostoNaColeta(null, false, terca)).toEqual([]);
  });

  it('posto inexistente e posto inativo são recusados', () => {
    expect(codigoDe(() => conferirPostoNaColeta(null, true, terca))).toBe('posto-inexistente');
    expect(codigoDe(() => conferirPostoNaColeta({ ...p, ativo: false }, true, terca))).toBe('posto-inativo');
  });

  it('fora do horário ou em fim de semana a coleta segue com o aviso', () => {
    expect(conferirPostoNaColeta(p, true, terca)).toEqual([]);
    expect(conferirPostoNaColeta(p, true, { diaSemana: 2, hora: '17:00' })).toEqual(['fora-do-horario']);
    expect(conferirPostoNaColeta(p, true, { diaSemana: 6, hora: '06:59' })).toEqual([
      'fim-de-semana',
      'fora-do-horario',
    ]);
    expect(
      conferirPostoNaColeta({ ...p, funcionaFimDeSemana: true }, true, { diaSemana: 0, hora: '08:00' }),
    ).toEqual([]);
    expect(
      conferirPostoNaColeta({ ...p, horarioInicio: null, horarioFim: null }, true, {
        diaSemana: 3,
        hora: '03:00',
      }),
    ).toEqual([]);
  });
});

describe('etiqueta da recoleta e da alíquota', () => {
  it('o tipo vem do que a amostra é', () => {
    expect(tipoDaEtiqueta({ ehAliquota: false, repeticao: false })).toBe('coleta');
    expect(tipoDaEtiqueta({ ehAliquota: false, repeticao: true })).toBe('recoleta');
    expect(tipoDaEtiqueta({ ehAliquota: true, repeticao: true })).toBe('aliquota');
  });

  it('a linha traz a marca do tipo e os exames, sem cortar código ao meio', () => {
    expect(linhaDaEtiqueta({ tipo: 'coleta', exames: ['K', 'NA'] })).toBe('K NA');
    expect(linhaDaEtiqueta({ tipo: 'recoleta', exames: ['K', 'NA'] })).toBe('RC K NA');
    expect(linhaDaEtiqueta({ tipo: 'aliquota', exames: ['GLI'], indice: 2, total: 3 })).toBe('A2/3 GLI');
    const longa = linhaDaEtiqueta({
      tipo: 'recoleta',
      exames: ['HEMOG', 'GLICO', 'UREIA', 'CREAT', 'TGO'],
    });
    expect(longa).toBe('RC HEMOG GLICO +3');
    expect(longa.length).toBeLessThanOrEqual(LARGURA_LINHA_ETIQUETA);
    expect(linhaDaEtiqueta({ tipo: 'coleta', exames: ['EXAMEDENOMEMUITOCOMPRIDO'] })).toHaveLength(
      LARGURA_LINHA_ETIQUETA,
    );
  });

  it('a primeira via usa a chave da coleta; a reimpressão soma uma via; amostra inativa não imprime', () => {
    expect(viaDaEtiqueta('PC0000012345', 'coletada', 0, false)).toEqual({
      via: 1,
      chave: 'amostra-PC0000012345',
    });
    expect(viaDaEtiqueta('PC0000012345', 'recebida', 1, true)).toEqual({
      via: 2,
      chave: 'amostra-PC0000012345-v2',
    });
    expect(viaDaEtiqueta('PC0000012345', 'recebida', 0, true).via).toBe(2);
    for (const s of ['rejeitada', 'cancelada', 'descartada'])
      expect(codigoDe(() => viaDaEtiqueta('PC0000012345', s, 0, false))).toBe('amostra-inativa');
  });
});
