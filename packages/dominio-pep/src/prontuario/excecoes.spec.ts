// Regra 9 da ficha do M15: exceção aparece, não some (cabeçalho sem conteúdo, data impossível).
import { describe, expect, it } from 'vitest';
import { BASE } from './corpus.spec-util.js';
import { AVISO_SEM_CONTEUDO, dataImpossivel, marcasDoRegistro } from './registro.js';

const AGORA = new Date('2026-10-20T12:00:00Z');

describe('exceções do registro', () => {
  it('cabeçalho sem conteúdo fica marcado', () => {
    expect(marcasDoRegistro({ ...BASE, temConteudo: false }, AGORA).semConteudo).toBe(true);
    expect(AVISO_SEM_CONTEUDO).toMatch(/sem conteúdo/);
  });

  it('data impossível: sentinela, antes de 1900, futuro além de um dia, vazia ou malformada', () => {
    expect(dataImpossivel('1899-12-30T00:00:00', AGORA)).toBe(true);
    expect(dataImpossivel('1850-01-01T00:00:00', AGORA)).toBe(true);
    expect(dataImpossivel('4026-01-01T00:00:00', AGORA)).toBe(true);
    expect(dataImpossivel(null, AGORA)).toBe(true);
    expect(dataImpossivel('ontem', AGORA)).toBe(true);
    expect(dataImpossivel('2026-10-21T08:00:00', AGORA)).toBe(false);
    expect(dataImpossivel('2020-01-21T08:00:00', AGORA)).toBe(false);
    expect(marcasDoRegistro({ ...BASE, dataHora: '1899-12-30T00:00:00' }, AGORA).dataImpossivel).toBe(true);
  });
});
