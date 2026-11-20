// Validador de compatibilidade da SIGTAP (ficha do M51, seção 5; regra 2). Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import type { ProcedimentoNaCiha } from './ciha.js';
import {
  compatibilidadesDaCompetencia,
  habilitacoesDoParametro,
  type OcorrenciaSus,
  SEM_COMPATIBILIDADES,
  validarCompatibilidade,
} from './compatibilidade.js';
import { ATRIBUTOS_LIVRES, procedimento } from './massa.spec-util.js';

const proc = (registros: ProcedimentoNaCiha['registros'] = ['bpa-i', 'bpa-c']): ProcedimentoNaCiha => ({
  procedimento: procedimento(101, '0301010072'),
  naCompetencia: { fonte: 'atual', atributos: ATRIBUTOS_LIVRES },
  registros,
});

const base = (extra: Partial<OcorrenciaSus> = {}): OcorrenciaSus => ({
  procedimento: proc(),
  instrumento: 'bpa-i',
  quantidade: 1,
  paciente: { sexo: 'F', idadeMeses: 400 },
  cid: 'I10',
  cbo: '225125',
  ...extra,
});

const lidas = {
  cids: [
    { id: 101, codigo: 'I10', competenciaInicial: 200801, competenciaFinal: 0 },
    { id: 101, codigo: 'E11', competenciaInicial: 200801, competenciaFinal: 202412 },
  ],
  cbos: [{ id: 101, codigo: '225125', competenciaInicial: 0, competenciaFinal: 0 }],
  habilitacoes: [{ id: 101, codigo: '0801', competenciaInicial: 200801, competenciaFinal: 0 }],
  leitos: [{ id: 101, codigo: '3', competenciaInicial: 0, competenciaFinal: 0 }],
};

const regras = (o: OcorrenciaSus, comp = '202509', hab = '801') =>
  validarCompatibilidade(o, compatibilidadesDaCompetencia(comp, lidas), habilitacoesDoParametro(hab)).map(
    (x) => x.regra,
  );

describe('validador de compatibilidade', () => {
  it('passa com CID, CBO, habilitação e instrumento compatíveis', () => {
    expect(regras(base())).toEqual([]);
  });

  it('o procedimento sem listas não restringe CID, CBO nem habilitação', () => {
    expect(
      validarCompatibilidade(
        base({ cid: 'Z00', cbo: '999999' }),
        compatibilidadesDaCompetencia('202509', SEM_COMPATIBILIDADES),
        new Set(),
      ),
    ).toEqual([]);
  });

  it('CID fora da lista vigente na competência (regra 2: a E11 valia até 202412)', () => {
    expect(regras(base({ cid: 'E11' }))).toEqual(['cid-incompativel']);
    expect(regras(base({ cid: 'E11' }), '202412')).toEqual([]);
    expect(regras(base({ cid: null }))).toEqual(['sem-cid-principal']);
    // CID com subcategoria aceita a categoria da lista.
    expect(regras(base({ cid: 'I109' }))).toEqual([]);
    // O BPA consolidado não leva CID.
    expect(regras(base({ cid: 'E11', conferirCid: false }))).toEqual([]);
  });

  it('CBO ausente, mal formado ou incompatível', () => {
    expect(regras(base({ cbo: null }))).toEqual(['sem-cbo']);
    expect(regras(base({ cbo: '12' }))).toEqual(['sem-cbo']);
    expect(regras(base({ cbo: '223505' }))).toEqual(['cbo-incompativel']);
  });

  it('habilitação: o estabelecimento precisa de uma das exigidas', () => {
    expect(regras(base(), '202509', '')).toEqual(['habilitacao-ausente']);
    expect(regras(base(), '202509', '802,0801')).toEqual([]);
  });

  it('leito da internação fora da lista', () => {
    expect(regras(base({ leito: 7, instrumento: 'bpa-i' }))).toEqual(['leito-incompativel']);
    expect(regras(base({ leito: '03' }))).toEqual([]);
  });

  it('instrumento de registro fora dos permitidos', () => {
    expect(regras(base({ procedimento: proc(['aih-principal']) }))).toEqual(['instrumento-incompativel']);
    expect(regras(base({ procedimento: proc([]) }))).toEqual(['instrumento-incompativel']);
    expect(regras(base({ procedimento: proc(['apac-principal']), instrumento: 'apac' }))).toEqual([]);
    expect(regras(base({ procedimento: proc(['aih-secundario']), instrumento: 'aih' }))).toEqual([]);
  });

  it('sexo, idade e quantidade pelos atributos da competência', () => {
    const p: ProcedimentoNaCiha = {
      ...proc(),
      naCompetencia: {
        fonte: 'historico',
        atributos: { ...ATRIBUTOS_LIVRES, sexo: 'M', idadeMinimaMeses: 600, quantidadeMaxima: 1 },
      },
    };
    expect(regras(base({ procedimento: p, quantidade: 2 }))).toEqual([
      'sexo-incompativel',
      'idade-incompativel',
      'quantidade-acima-do-maximo',
    ]);
  });

  it('o procedimento fora da competência não segue para as demais regras', () => {
    expect(regras(base({ procedimento: { ...proc(), naCompetencia: null } }))).toEqual([
      'sigtap-fora-da-competencia',
    ]);
  });

  it('o parâmetro das habilitações ignora o que não é número', () => {
    expect([...habilitacoesDoParametro(' 801, x, 0802,,')]).toEqual(['801', '802']);
  });
});
