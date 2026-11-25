// Endereço manual (02-CAD linha 14): CEP fora do cadastro de CEPs exige espécie do logradouro, município e logradouro.
import { describe, expect, it } from 'vitest';
import { errosEndereco } from './contatos.js';

const base = { cep: '99999999', numero: '10', semNumero: false, vigenciaInicio: null, vigenciaFim: null };

describe('endereço manual (CEP fora do cadastro de CEPs)', () => {
  it('pelo cadastro de CEPs não pede espécie nem município', () => {
    expect(errosEndereco(base)).toEqual([]);
    expect(errosEndereco({ ...base, manual: null })).toEqual([]);
  });

  it('manual exige espécie, município e logradouro', () => {
    expect(errosEndereco({ ...base, manual: { especie: null, municipio: null, logradouro: '  ' } })).toEqual([
      'especie',
      'municipio',
      'logradouro',
    ]);
    expect(
      errosEndereco({ ...base, manual: { especie: 3, municipio: null, logradouro: 'DAS FLORES' } }),
    ).toEqual(['municipio']);
  });

  it('manual completo passa, e as demais regras continuam valendo', () => {
    const manual = { especie: 3, municipio: 7, logradouro: 'DAS FLORES' };
    expect(errosEndereco({ ...base, manual })).toEqual([]);
    expect(errosEndereco({ ...base, numero: null, manual })).toEqual(['numero']);
  });
});
