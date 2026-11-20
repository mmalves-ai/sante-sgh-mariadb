// O catálogo SIGTAP de uma competência (regra 2): retrato da competência, atual depois do último retrato, idade em
// anos convertida, registro pela vigência, cache; e os parâmetros de convênio e fonte. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  atributosDoBanco,
  catalogoSigtapDaCompetencia,
  conveniosDoParametro,
  fontesDoParametro,
} from './catalogo-competencia.js';

const base = {
  idadeMinima: 0,
  idadeMaxima: 9999,
  sexo: 'I',
  quantidadeMaxima: 0,
  permanencia: null,
  complexidade: 'MC',
};
const PROC = { ...base, id: 7, codigo: '0301010072', competenciaInicial: 200801, competenciaFinal: 0 };

describe('catálogo SIGTAP da competência', () => {
  it('o retrato da competência vale até o último; depois, o atual; registros pela vigência', () => {
    const retratos = [
      { ...base, id: 7, competencia: 201310, sexo: 'F', idadeMinima: 12 },
      { ...base, id: 7, competencia: 201311, sexo: 'M' },
    ];
    const registros = [
      { id: 7, registro: '1', competenciaInicial: 200801, competenciaFinal: 201310 },
      { id: 7, registro: '02', competenciaInicial: 201311, competenciaFinal: 0 },
      { id: 7, registro: '02', competenciaInicial: 201311, competenciaFinal: 0 },
      { id: 7, registro: '99', competenciaInicial: 0, competenciaFinal: 0 },
    ];
    const out = catalogoSigtapDaCompetencia('201310', [PROC], retratos, registros)(7)!;
    expect(out.naCompetencia).toEqual({
      fonte: 'historico',
      atributos: expect.objectContaining({ sexo: 'F', idadeMinimaMeses: 144 }),
    });
    expect(out.registros).toEqual(['bpa-c']);
    const nov = catalogoSigtapDaCompetencia('201311', [PROC], retratos, registros);
    expect(nov(7)!.naCompetencia!.atributos.sexo).toBe('M');
    expect(nov(7)!.registros).toEqual(['bpa-i']);
    expect(nov(7)).toBe(nov(7));
    const hoje = catalogoSigtapDaCompetencia('202509', [PROC], retratos)(7)!;
    expect(hoje.naCompetencia).toMatchObject({
      fonte: 'atual',
      atributos: { sexo: 'ambos', idadeMaximaMeses: null },
    });
    expect(hoje.registros).toEqual([]);
    expect(catalogoSigtapDaCompetencia('202509', [PROC], [])(8)).toBeNull();
    const fechado = catalogoSigtapDaCompetencia('202509', [{ ...PROC, competenciaFinal: 201312 }], []);
    expect(fechado(7)).toMatchObject({ naCompetencia: null });
  });

  it('atributos do banco: anos viram meses, quantidade 0 é sem limite', () => {
    expect(atributosDoBanco({ ...base, idadeMaxima: 110, quantidadeMaxima: 3 })).toMatchObject({
      idadeMinimaMeses: 0,
      idadeMaximaMeses: 1320,
      quantidadeMaxima: 3,
    });
    expect(atributosDoBanco({ ...base, quantidadeMaxima: null }).quantidadeMaxima).toBeNull();
  });

  it('parâmetros: convênios e fontes por convênio', () => {
    expect(conveniosDoParametro(' 1, 2,x,')).toEqual([1, 2]);
    expect([...fontesDoParametro('10:particular-pf; 55:dpvat;x:y;9')]).toEqual([
      [10, 'particular-pf'],
      [55, 'dpvat'],
    ]);
  });
});
