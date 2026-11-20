// Regra 3 (ficha do M47): bolsa vencida, em quarentena ou incompatível é bloqueada.
import type { GrupoAbo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { aboCompativelHemacias, aboCompativelPlasma, conferirBolsa, MENSAGENS_BOLSA } from './bolsa.js';

const G: readonly GrupoAbo[] = ['O', 'A', 'B', 'AB'];
const base = {
  classe: 'hemacias' as const,
  hemocomponenteRequisitado: 'CH',
  hemocomponenteDaBolsa: 'ch',
  bolsa: { abo: 'O' as const, rh: 'negativo' as const },
  receptor: { abo: 'A' as const, rh: 'positivo' as const },
  validade: '2026-11-01T00:00:00',
  agora: '2026-10-24T10:00:00',
  situacao: null,
  extremaUrgencia: false,
  justificativaRh: null,
};

describe('compatibilidade ABO', () => {
  it('hemácias: O para todos, AB só para AB', () => {
    const tabela = G.map((d) => G.map((r) => (aboCompativelHemacias(d, r) ? 1 : 0)).join('')).join(' ');
    // linhas: doador O, A, B, AB; colunas: receptor O, A, B, AB
    expect(tabela).toBe('1111 0101 0011 0001');
  });
  it('plasma: AB para todos, O só para O', () => {
    const tabela = G.map((d) => G.map((r) => (aboCompativelPlasma(d, r) ? 1 : 0)).join('')).join(' ');
    expect(tabela).toBe('1000 1100 1010 1111');
  });
});

describe('conferência da bolsa (regra 3)', () => {
  it('compatível não idêntica passa com alerta', () => {
    expect(conferirBolsa(base)).toEqual({ bloqueios: [], alertas: ['abo-nao-identico'] });
    expect(conferirBolsa({ ...base, bolsa: { abo: 'A', rh: 'positivo' } })).toEqual({
      bloqueios: [],
      alertas: [],
    });
  });

  it('vencida, quarentena, indisponível e hemocomponente diferente', () => {
    expect(conferirBolsa({ ...base, validade: '2026-10-24T09:00:00' }).bloqueios).toEqual(['bolsa-vencida']);
    expect(conferirBolsa({ ...base, situacao: 'quarentena' }).bloqueios).toEqual(['bolsa-quarentena']);
    expect(conferirBolsa({ ...base, situacao: 'descartada' }).bloqueios).toEqual(['bolsa-indisponivel']);
    expect(conferirBolsa({ ...base, situacao: 'reservada' }).bloqueios).toEqual([]);
    expect(conferirBolsa({ ...base, situacao: 'liberada' }).bloqueios).toEqual([]);
    expect(conferirBolsa({ ...base, hemocomponenteDaBolsa: 'CP' }).bloqueios).toEqual([
      'hemocomponente-diferente',
    ]);
  });

  it('ABO incompatível e bolsa sem tipagem bloqueiam', () => {
    expect(conferirBolsa({ ...base, bolsa: { abo: 'B', rh: 'positivo' } }).bloqueios).toEqual([
      'abo-incompativel',
    ]);
    expect(conferirBolsa({ ...base, bolsa: { abo: null, rh: null } }).bloqueios).toEqual([
      'abo-incompativel',
    ]);
    expect(
      conferirBolsa({ ...base, classe: 'plasma', bolsa: { abo: 'O', rh: 'positivo' } }).bloqueios,
    ).toEqual(['abo-incompativel']);
    expect(conferirBolsa({ ...base, classe: 'plasma', bolsa: { abo: 'AB', rh: 'positivo' } })).toEqual({
      bloqueios: [],
      alertas: ['abo-nao-identico'],
    });
    expect(conferirBolsa({ ...base, classe: 'plasma', bolsa: { abo: 'A', rh: 'negativo' } })).toEqual({
      bloqueios: [],
      alertas: [],
    });
  });

  it('Rh positivo em receptor negativo: hemácias só com justificativa; plaquetas com alerta', () => {
    const neg = { abo: 'A' as const, rh: 'negativo' as const };
    const pos = { abo: 'A' as const, rh: 'positivo' as const };
    expect(conferirBolsa({ ...base, receptor: neg, bolsa: pos }).bloqueios).toEqual(['rh-incompativel']);
    expect(
      conferirBolsa({ ...base, receptor: neg, bolsa: pos, justificativaRh: 'Sem estoque Rh negativo' }),
    ).toEqual({ bloqueios: [], alertas: ['rh-positivo-em-negativo'] });
    expect(
      conferirBolsa({
        ...base,
        classe: 'plaquetas',
        hemocomponenteRequisitado: 'CP',
        hemocomponenteDaBolsa: 'CP',
        receptor: neg,
        bolsa: { abo: 'O', rh: 'positivo' },
      }),
    ).toEqual({ bloqueios: [], alertas: ['abo-nao-identico', 'rh-positivo-em-negativo'] });
  });

  it('receptor sem tipagem: só universal na extrema urgência', () => {
    const sem = { abo: null, rh: null };
    expect(conferirBolsa({ ...base, receptor: sem }).bloqueios).toEqual(['receptor-sem-tipagem']);
    expect(conferirBolsa({ ...base, receptor: sem, extremaUrgencia: true })).toEqual({
      bloqueios: [],
      alertas: ['receptor-sem-tipagem'],
    });
    expect(
      conferirBolsa({ ...base, receptor: sem, extremaUrgencia: true, bolsa: { abo: 'A', rh: 'negativo' } })
        .bloqueios,
    ).toEqual(['receptor-sem-tipagem']);
    expect(
      conferirBolsa({
        ...base,
        classe: 'plasma',
        receptor: sem,
        extremaUrgencia: true,
        bolsa: { abo: 'AB', rh: 'positivo' },
      }).alertas,
    ).toEqual(['receptor-sem-tipagem']);
    expect(
      conferirBolsa({
        ...base,
        classe: 'crioprecipitado',
        receptor: sem,
        extremaUrgencia: true,
        bolsa: { abo: 'B', rh: 'positivo' },
      }).bloqueios,
    ).toEqual([]);
  });

  it('todo código tem texto sem citar o outro sistema', () => {
    for (const m of Object.values(MENSAGENS_BOLSA)) expect(m).not.toMatch(/SPDATA|legado/i);
  });
});
