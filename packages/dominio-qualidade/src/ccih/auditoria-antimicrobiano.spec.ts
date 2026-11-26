import { describe, expect, it } from 'vitest';
import {
  atendimentoDaAuditoria,
  avaliacaoDaFicha,
  avaliarAuditoriaAntimicrobiano,
  type ContextoAuditoria,
  type EntradaAuditoriaAntimicrobiano,
  indicacaoDaFinalidade,
  MENSAGENS_AUDITORIA_ANTIMICROBIANO,
  parecerSugerido,
} from './auditoria-antimicrobiano.js';

const base: EntradaAuditoriaAntimicrobiano = {
  avaliavel: true,
  droga: 'adequada',
  dose: 'adequada',
  tempo: 'adequada',
  via: 'adequada',
  indicacao: null,
  parecer: 'aprovado',
  permiteProrrogacao: null,
  recomendacao: null,
};
const sem: ContextoAuditoria = { parecerPadrao: null, tipo: null, finalidade: 'empirica' };
const recusas = (e: Partial<EntradaAuditoriaAntimicrobiano>, c: Partial<ContextoAuditoria> = {}) => {
  const r = avaliarAuditoriaAntimicrobiano({ ...base, ...e }, { ...sem, ...c });
  return r.ok ? [] : r.recusas;
};

describe('auditoria da prescrição de antimicrobiano', () => {
  it('aprova tudo adequado: indicação pela finalidade, ficha aprovada, sem prorrogação por padrão', () => {
    const r = avaliarAuditoriaAntimicrobiano(base, sem);
    expect(r).toEqual({
      ok: true,
      gravar: {
        avaliavel: true,
        droga: 'adequada',
        dose: 'adequada',
        tempo: 'adequada',
        via: 'adequada',
        indicacao: 'empirico',
        parecer: 'aprovado',
        permiteProrrogacao: false,
        recomendacao: null,
        avaliacaoFicha: 'aprovada',
      },
    });
  });

  it('o parecer padrão traz a prorrogação; a escolha explícita vale sobre ele', () => {
    const p = { parecerPadrao: { ativo: true, permiteProrrogacao: true } };
    const r = avaliarAuditoriaAntimicrobiano(base, { ...sem, ...p });
    expect(r.ok && r.gravar.permiteProrrogacao).toBe(true);
    const r2 = avaliarAuditoriaAntimicrobiano({ ...base, permiteProrrogacao: false }, { ...sem, ...p });
    expect(r2.ok && r2.gravar.permiteProrrogacao).toBe(false);
  });

  it('recusa o parecer vazio, o aprovado com item inadequado e o tipo suspender sem suspensão', () => {
    expect(recusas({ parecer: '' })).toEqual(['parecer-obrigatorio']);
    expect(recusas({ dose: 'inadequada' })).toEqual(['parecer-incoerente']);
    expect(recusas({}, { tipo: { ativo: true, acao: 'suspender' } })).toEqual(['parecer-incoerente']);
    expect(
      recusas(
        { parecer: 'reprovado', recomendacao: 'Trocar por cefalosporina' },
        { tipo: { ativo: true, acao: 'suspender' } },
      ),
    ).toEqual(['parecer-incoerente']);
  });

  it('o parecer que não aprova exige a recomendação ao prescritor', () => {
    expect(recusas({ parecer: 'reprovado', recomendacao: '  curto ' })).toEqual(['recomendacao-obrigatoria']);
    const r = avaliarAuditoriaAntimicrobiano(
      {
        ...base,
        parecer: 'aprovado_com_ressalva',
        dose: 'inadequada',
        recomendacao: ' Ajustar dose pela função renal ',
      },
      sem,
    );
    expect(r.ok && [r.gravar.recomendacao, r.gravar.avaliacaoFicha]).toEqual([
      'Ajustar dose pela função renal',
      'ajuste_solicitado',
    ]);
  });

  it('prorrogação só com aprovação e com ficha avaliável', () => {
    expect(
      recusas({ parecer: 'reprovado', recomendacao: 'Suspender e colher cultura', permiteProrrogacao: true }),
    ).toEqual(['prorrogacao-sem-aprovacao']);
    expect(recusas({ avaliavel: false, permiteProrrogacao: true })).toEqual(['prorrogacao-sem-aprovacao']);
  });

  it('ficha não avaliável: adequações não avaliadas, nada prorroga mesmo com o parecer padrão', () => {
    const r = avaliarAuditoriaAntimicrobiano(
      { ...base, avaliavel: false, dose: 'inadequada' },
      { ...sem, parecerPadrao: { ativo: true, permiteProrrogacao: true } },
    );
    expect(r.ok && [r.gravar.droga, r.gravar.dose, r.gravar.permiteProrrogacao]).toEqual([
      'nao_avaliada',
      'nao_avaliada',
      false,
    ]);
  });

  it('cadastro inativo recusa; todas as recusas têm mensagem', () => {
    expect(
      recusas(
        {},
        {
          parecerPadrao: { ativo: false, permiteProrrogacao: false },
          tipo: { ativo: false, acao: 'manter' },
        },
      ),
    ).toEqual(['parecer-padrao-inativo', 'tipo-auditoria-inativo']);
    for (const m of Object.values(MENSAGENS_AUDITORIA_ANTIMICROBIANO)) expect(m.length).toBeGreaterThan(10);
  });

  it('indicação, parecer sugerido e situação da ficha', () => {
    expect([null, 'empirica', 'terapeutica', 'profilatica', 'x'].map(indicacaoDaFinalidade)).toEqual([
      null,
      'empirico',
      'direcionado_cultura',
      'profilaxia',
      'outro',
    ]);
    expect([null, 'manter', 'suspender', 'trocar'].map((a) => parecerSugerido(a as never))).toEqual([
      null,
      'aprovado',
      'suspenso',
      'aprovado_com_ressalva',
    ]);
    expect(avaliacaoDaFicha('reprovado')).toBe('reprovada');
    expect(avaliacaoDaFicha('suspenso')).toBe('suspensa');
  });

  it('atendimento da auditoria: o da ficha; nulo só na ficha migrada sem atendimento; a do sistema sem ele recusa', () => {
    expect(atendimentoDaAuditoria({ atendimento: 5, migrada: false })).toEqual({ ok: true, atendimento: 5 });
    expect(atendimentoDaAuditoria({ atendimento: 5, migrada: true })).toEqual({ ok: true, atendimento: 5 });
    expect(atendimentoDaAuditoria({ atendimento: null, migrada: true })).toEqual({
      ok: true,
      atendimento: null,
    });
    expect(atendimentoDaAuditoria({ atendimento: null, migrada: false })).toEqual({
      ok: false,
      recusa: 'ficha-sem-atendimento',
    });
  });
});
