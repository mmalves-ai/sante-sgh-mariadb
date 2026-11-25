// Espécie do logradouro na comparação da carga de CEP (02-CAD linha 14): o arquivo traz a sigla ou a descrição, o banco
// guarda a referência ao catálogo; a equivalência leva o valor do arquivo ao que o banco lê, para que o CEP gravado sem
// espécie vire alteração e o igual não acuse diferença falsa. Massa sintética.
import { definicaoCatalogo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  canonizarCampos,
  chaveEquivalencia,
  compararEdicao,
  type EquivalenciasDoCampo,
} from './comparacao.js';
import type { ItemValidado } from './validacao.js';

const def = definicaoCatalogo('cep')!;
const especies: EquivalenciasDoCampo = new Map<string, string | null>([
  ['R', 'Rua'],
  ['RUA', 'Rua'],
  ['AV', 'Avenida'],
  ['AVENIDA', 'Avenida'],
  ['TV', null],
]);
const equivalencias = new Map([['cep', new Map([['tipoLogradouro', especies]])]]);
const item = (tipo: string | null): ItemValidado => ({
  entidade: 'cep',
  linha: 1,
  chave: 'cep=99999989',
  campos: {
    cep: '99999989',
    uf: 'MG',
    cidade: 'CIDADE SINTETICA',
    logradouro: 'DAS FLORES',
    tipoLogradouro: tipo,
  },
  resultado: 'valida',
  motivos: [],
});
const atual = (tipo: string | null) =>
  new Map([
    [
      'cep',
      new Map([
        [
          'cep=99999989',
          {
            cep: '99999989',
            uf: 'MG',
            cidade: 'CIDADE SINTETICA',
            logradouro: 'DAS FLORES',
            tipoLogradouro: tipo,
          },
        ],
      ]),
    ],
  ]);
const comparar = (arquivo: string | null, banco: string | null) =>
  compararEdicao(def, [item(arquivo)], atual(banco), { equivalencias }).itens[0]!;

describe('espécie do logradouro na comparação da carga de CEP', () => {
  it('a chave da equivalência ignora caixa, acento e espaços', () => {
    expect(chaveEquivalencia('  Avenída ')).toBe('AVENIDA');
  });

  it('CEP gravado sem espécie vira alteração com a descrição do catálogo', () => {
    const r = comparar('R', null);
    expect(r.comparacao).toBe('alterado');
    expect(r.depois).toEqual({ tipoLogradouro: 'Rua' });
    expect(r.publicar).toBe(true);
  });

  it('sigla ou descrição da mesma espécie é igual; outra espécie é alteração', () => {
    expect(comparar('rua', 'Rua').comparacao).toBe('igual');
    expect(comparar('R', 'Rua').comparacao).toBe('igual');
    expect(comparar('AV', 'Rua')).toMatchObject({
      comparacao: 'alterado',
      depois: { tipoLogradouro: 'Avenida' },
    });
  });

  it('tipo vazio, fora do catálogo ou ambíguo não acusa diferença (a publicação não o grava)', () => {
    expect(comparar(null, 'Rua').comparacao).toBe('igual');
    expect(comparar('BECO SINTETICO', null).comparacao).toBe('igual');
    expect(comparar('TV', null).comparacao).toBe('igual');
    expect(canonizarCampos({ tipoLogradouro: 'X' }, undefined)).toEqual({ tipoLogradouro: 'X' });
  });
});
