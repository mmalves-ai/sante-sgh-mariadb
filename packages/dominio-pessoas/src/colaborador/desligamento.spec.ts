// Regra 2 do M52: desligamento bloqueia o acesso no mesmo dia, em cada hospital, sem apagar o usuário.
import { describe, expect, it } from 'vitest';
import { planejarDesligamento, type PedidoDesligamento } from './desligamento.js';

const base: PedidoDesligamento = {
  vinculo: { id: 10, hospital: 'pc', admissao: '2024-03-01', desligamento: null },
  data: '2026-10-24',
  hoje: '2026-10-24',
  usuarios: [{ hospital: 'pc', login: 'USUARIO.SINTETICO', bloqueado: false }],
  outrosVinculosAtivos: [],
  ator: 'RH.SINTETICO',
};

describe('desligamento (regra 2)', () => {
  it('bloqueia o usuário do hospital do vínculo no mesmo dia', () => {
    expect(planejarDesligamento(base)).toEqual({
      ok: true,
      usuarios: [{ hospital: 'pc', login: 'USUARIO.SINTETICO', acao: 'bloquear', motivo: null }],
      bloquearEm: ['pc'],
    });
  });

  it('usuário já bloqueado: só o lado SGH_ (cenário recusa-ja-bloqueado)', () => {
    const r = planejarDesligamento({ ...base, usuarios: [{ ...base.usuarios[0]!, bloqueado: true }] });
    expect(r).toEqual({
      ok: true,
      usuarios: [{ hospital: 'pc', login: 'USUARIO.SINTETICO', acao: 'jaBloqueado', motivo: null }],
      bloquearEm: [],
    });
  });

  it('nos dois hospitais: cada banco é um passo; o hospital com outro vínculo ativo mantém o usuário', () => {
    const r = planejarDesligamento({
      ...base,
      usuarios: [
        { hospital: 'pc', login: 'USUARIO.SINTETICO', bloqueado: false },
        { hospital: 'hs', login: 'USUARIO.SINTETICO', bloqueado: false },
      ],
      outrosVinculosAtivos: [{ id: 11, hospital: 'hs' }],
    });
    expect(r.ok && r.bloquearEm).toEqual(['pc']);
    expect(r.ok && r.usuarios.find((u) => u.hospital === 'hs')).toMatchObject({ acao: 'mantido' });
  });

  it('sem usuário: grava só o vínculo', () => {
    expect(planejarDesligamento({ ...base, usuarios: [] })).toEqual({
      ok: true,
      usuarios: [],
      bloquearEm: [],
    });
  });

  it('recusa vínculo já desligado, data futura, data antes da admissão e o próprio desligamento', () => {
    expect(
      planejarDesligamento({ ...base, vinculo: { ...base.vinculo, desligamento: '2026-01-01' } }),
    ).toMatchObject({ ok: false, recusa: 'ja-desligado' });
    expect(planejarDesligamento({ ...base, data: '2026-10-25' })).toMatchObject({
      ok: false,
      recusa: 'data-futura',
    });
    expect(planejarDesligamento({ ...base, data: '2024-02-29' })).toMatchObject({
      ok: false,
      recusa: 'antes-da-admissao',
    });
    expect(planejarDesligamento({ ...base, ator: ' usuario.sintetico ' })).toMatchObject({
      ok: false,
      recusa: 'a-si-mesmo',
    });
  });

  it('desligamento retroativo (registrado depois) é aceito', () => {
    expect(planejarDesligamento({ ...base, data: '2026-10-20' }).ok).toBe(true);
  });
});
