// Regras 6 e 7 (ficha do M47): escopo pela chave agencia.completa e o volume no balanço hídrico uma vez só.
// (As provas na cópia são `liberacao-agencia.int-spec.ts` e `balanco-hemocomponente.int-spec.ts` do construtor.)
import { describe, expect, it } from 'vitest';
import { ganhoDoAto, ganhosNovos, passoPermitido, passosDoFluxo } from './escopo.js';

describe('escopo pela DP-21 (regra 6)', () => {
  it('desligada: nada; hemocentro: sem imuno-hematologia; agência própria: completa', () => {
    expect(passosDoFluxo({ transfusaoLigada: false, agenciaCompleta: true })).toEqual([]);
    expect(passosDoFluxo({ transfusaoLigada: true, agenciaCompleta: false })).toEqual([
      'requisicao',
      'amostra',
      'recebimentoDoHemocentro',
      'ato',
      'reacao',
    ]);
    expect(passosDoFluxo({ transfusaoLigada: true, agenciaCompleta: true })).toContain('provaCruzada');
    expect(passoPermitido('provaCruzada', { transfusaoLigada: true, agenciaCompleta: false })).toBe(false);
    expect(passoPermitido('ato', { transfusaoLigada: true, agenciaCompleta: false })).toBe(true);
  });
});

describe('balanço hídrico (regra 7)', () => {
  const ato = {
    id: 5,
    estado: 'concluido' as const,
    volumeTransfundidoMl: 280,
    terminoEm: '2026-10-24T12:00:00',
  };
  it('só o ato terminado com volume', () => {
    expect(ganhoDoAto(ato)).toEqual({
      chave: 'hemo-ato:5',
      volumeMl: 280,
      origem: 'hemocomponente',
      em: ato.terminoEm,
    });
    expect(ganhoDoAto({ ...ato, estado: 'emCurso' })).toBeNull();
    expect(ganhoDoAto({ ...ato, terminoEm: null })).toBeNull();
    expect(ganhoDoAto({ ...ato, volumeTransfundidoMl: 0 })).toBeNull();
    expect(ganhoDoAto({ ...ato, volumeTransfundidoMl: null })).toBeNull();
    expect(ganhoDoAto({ ...ato, estado: 'interrompido', volumeTransfundidoMl: 40 })?.volumeMl).toBe(40);
  });
  it('uma vez só: a chave já lançada e a repetida na lista não entram', () => {
    const r = ganhosNovos([ato, ato, { ...ato, id: 6 }, { ...ato, id: 7 }], new Set(['hemo-ato:6']));
    expect(r.map((g) => g.chave)).toEqual(['hemo-ato:5', 'hemo-ato:7']);
  });
});
