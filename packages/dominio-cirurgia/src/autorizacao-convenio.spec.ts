import { describe, expect, it } from 'vitest';
import {
  conferirConfirmacaoCirurgia,
  etapaAutorizacaoCirurgia,
  senhaDaCirurgia,
  type SituacaoAutorizacaoCirurgia,
} from './autorizacao-convenio.js';

const base: SituacaoAutorizacaoCirurgia = {
  tipoCobertura: 'convenio',
  natureza: 'eletiva',
  senha: null,
  guia: null,
};

describe('autorização prévia da cirurgia eletiva (04-CC linha 102)', () => {
  it('etapas derivadas da guia ligada', () => {
    expect(etapaAutorizacaoCirurgia(base)).toBe('sem_guia');
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'rascunho', senha: null } })).toBe(
      'guia_em_preparo',
    );
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'pronta_envio', senha: null } })).toBe(
      'pronta_envio',
    );
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'em_analise', senha: null } })).toBe(
      'aguardando_operadora',
    );
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'autorizada', senha: 'S1' } })).toBe(
      'autorizada',
    );
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'autorizada', senha: null } })).toBe(
      'aguardando_operadora',
    );
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'negada', senha: null } })).toBe('negada');
    expect(etapaAutorizacaoCirurgia({ ...base, senha: 'X9' })).toBe('autorizada');
    expect(etapaAutorizacaoCirurgia({ ...base, tipoCobertura: 'particular' })).toBe('nao_exigida');
  });

  it('a senha vale a do agendamento ou a da guia autorizada; a da guia negada não vale', () => {
    expect(senhaDaCirurgia({ senha: ' A1 ', guia: null })).toBe('A1');
    expect(senhaDaCirurgia({ senha: null, guia: { situacao: 'autorizada_parcial', senha: 'B2' } })).toBe(
      'B2',
    );
    expect(senhaDaCirurgia({ senha: '', guia: { situacao: 'negada', senha: 'C3' } })).toBeNull();
  });

  it('eletiva de convênio sem senha não confirma nem entra no bloco; com senha passa', () => {
    for (const nova of ['confirmado', 'no_bloco', 'em_andamento'])
      expect(conferirConfirmacaoCirurgia(base, nova, null)).toMatchObject({
        ok: false,
        codigo: 'autorizacao-pendente',
      });
    expect(
      conferirConfirmacaoCirurgia(
        { ...base, guia: { situacao: 'em_analise', senha: null } },
        'confirmado',
        null,
      ),
    ).toMatchObject({ ok: false, mensagem: expect.stringContaining('aguarda a resposta') });
    expect(conferirConfirmacaoCirurgia({ ...base, senha: 'S' }, 'confirmado', null)).toEqual({
      ok: true,
      comunicarDepois: false,
    });
    expect(conferirConfirmacaoCirurgia(base, 'suspenso', null)).toEqual({ ok: true, comunicarDepois: false });
    expect(conferirConfirmacaoCirurgia({ ...base, tipoCobertura: 'sus' }, 'confirmado', null).ok).toBe(true);
    expect(conferirConfirmacaoCirurgia({ ...base, natureza: 'outro' }, 'confirmado', 'x'.repeat(20)).ok).toBe(
      false,
    );
  });

  it('urgência sem senha exige a justificativa e fica para comunicar depois', () => {
    const urg = { ...base, natureza: 'urgencia' };
    expect(conferirConfirmacaoCirurgia(urg, 'confirmado', 'curta')).toMatchObject({
      ok: false,
      codigo: 'justificativa-urgencia',
    });
    expect(conferirConfirmacaoCirurgia(urg, 'confirmado', 'Abdome agudo, risco de perfuração')).toEqual({
      ok: true,
      comunicarDepois: true,
    });
    expect(
      conferirConfirmacaoCirurgia(
        { ...base, natureza: 'emergencia' },
        'no_bloco',
        'Trauma com sangramento ativo',
      ).ok,
    ).toBe(true);
  });
});
