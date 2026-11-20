// Regra 1 do M52: uma pessoa, vários vínculos; admitir um CPF já cadastrado reusa o profissional e o usuário.
import { describe, expect, it } from 'vitest';
import { decidirAdmissao, limiteCargaSemanal, vinculoAtivo, type PessoaAchada } from './vinculo.js';

const nada: PessoaAchada = { profissionais: [], usuarios: [], vinculos: [] };
const pedido = {
  tipo: 'clt',
  admissao: '2026-11-03',
  centroCusto: 12,
  cargaSemanalHoras: 36,
  profissional: null,
  usuario: null,
} as const;

describe('admissão (regra 1)', () => {
  it('pessoa nova: nada a reusar', () => {
    expect(decidirAdmissao(pedido, nada)).toEqual({
      ok: true,
      reusarProfissional: null,
      reusarUsuario: null,
      outrosVinculosAtivos: [],
    });
  });

  it('CPF já cadastrado: reusa o profissional e o usuário da prévia, sem criar segunda pessoa', () => {
    const achado: PessoaAchada = {
      profissionais: [{ id: 501 }],
      usuarios: [{ id: 77, bloqueado: false }],
      vinculos: [
        {
          id: 9,
          tipo: 'cooperado',
          centroCusto: 30,
          cargo: 'Médico',
          admissao: '2024-01-01',
          desligamento: null,
        },
        {
          id: 8,
          tipo: 'clt',
          centroCusto: 12,
          cargo: 'Técnico',
          admissao: '2020-01-01',
          desligamento: '2023-05-01',
        },
      ],
    };
    expect(decidirAdmissao({ ...pedido, profissional: 501, usuario: 77 }, achado)).toEqual({
      ok: true,
      reusarProfissional: 501,
      reusarUsuario: 77,
      outrosVinculosAtivos: [9],
    });
  });

  it('a prévia desatualizada é recusada (alguém cadastrou a pessoa no meio do caminho)', () => {
    const r = decidirAdmissao(pedido, { ...nada, profissionais: [{ id: 501 }] });
    expect(r).toMatchObject({ ok: false, recusa: 'previa-desatualizada' });
    const u = decidirAdmissao(pedido, { ...nada, usuarios: [{ id: 3, bloqueado: true }] });
    expect(u).toMatchObject({ ok: false, recusa: 'previa-desatualizada' });
  });

  it('dois cadastros com o mesmo CPF: espera a unificação', () => {
    expect(decidirAdmissao(pedido, { ...nada, profissionais: [{ id: 1 }, { id: 2 }] })).toMatchObject({
      ok: false,
      recusa: 'cpf-ambiguo',
    });
    expect(
      decidirAdmissao(pedido, {
        ...nada,
        usuarios: [
          { id: 1, bloqueado: false },
          { id: 2, bloqueado: false },
        ],
      }),
    ).toMatchObject({ ok: false, recusa: 'cpf-ambiguo' });
  });

  it('o mesmo tipo de vínculo ativo no mesmo centro de custo é duplicado; em outro centro, não', () => {
    const v = {
      id: 4,
      tipo: 'clt',
      centroCusto: 12,
      cargo: 'Técnico',
      admissao: '2025-01-01',
      desligamento: null,
    } as const;
    expect(decidirAdmissao(pedido, { ...nada, vinculos: [v] })).toMatchObject({
      ok: false,
      recusa: 'vinculo-duplicado',
    });
    expect(decidirAdmissao(pedido, { ...nada, vinculos: [{ ...v, centroCusto: 13 }] })).toMatchObject({
      ok: true,
      outrosVinculosAtivos: [4],
    });
  });

  it('a carga semanal respeita o teto do tipo de vínculo', () => {
    expect(limiteCargaSemanal('clt')).toBe(44);
    expect(limiteCargaSemanal('estatutario')).toBe(44);
    expect(limiteCargaSemanal('estagiario')).toBe(30);
    expect(limiteCargaSemanal('residente')).toBe(60);
    expect(limiteCargaSemanal('pj')).toBe(60);
    expect(decidirAdmissao({ ...pedido, cargaSemanalHoras: 45 }, nada)).toMatchObject({
      ok: false,
      recusa: 'carga-acima-do-limite',
    });
    expect(decidirAdmissao({ ...pedido, tipo: 'estagiario', cargaSemanalHoras: 30 }, nada).ok).toBe(true);
    expect(decidirAdmissao({ ...pedido, tipo: 'estagiario', cargaSemanalHoras: 31 }, nada).ok).toBe(false);
  });

  it('vínculo ativo é o que não tem desligamento', () => {
    expect(vinculoAtivo({ desligamento: null })).toBe(true);
    expect(vinculoAtivo({ desligamento: '2026-01-01' })).toBe(false);
  });
});
