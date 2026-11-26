import { describe, expect, it } from 'vitest';
import {
  autorizacaoParcial,
  conferirConferenciaParcial,
  conferirConfirmacaoCirurgia,
  conferirExcecaoUrgencia,
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

  it('a exceção de urgência registrada libera a entrada no bloco; eletiva e cirurgia com senha não registram', () => {
    const urg = { ...base, natureza: 'emergencia' };
    expect(conferirConfirmacaoCirurgia({ ...urg, posteriorRegistrado: true }, 'no_bloco', null)).toEqual({
      ok: true,
      comunicarDepois: false,
    });
    expect(conferirExcecaoUrgencia(urg, 'Trauma com sangramento ativo')).toEqual([]);
    expect(conferirExcecaoUrgencia(urg, 'curta').map((x) => x.campo)).toEqual(['justificativa']);
    expect(conferirExcecaoUrgencia(base, 'Paciente quer adiantar').map((x) => x.campo)).toEqual([
      'agendamento',
    ]);
    expect(conferirExcecaoUrgencia({ ...urg, senha: 'S1' }, 'Trauma com sangramento ativo')).toHaveLength(1);
    expect(
      conferirExcecaoUrgencia({ ...urg, tipoCobertura: 'sus' }, 'Trauma com sangramento ativo'),
    ).toHaveLength(1);
  });

  it('autorizada em parte: a etapa não vira autorizada pela senha e a confirmação pede a conferência registrada', () => {
    const parcial = { situacao: 'autorizada_parcial', senha: 'P7' };
    // a senha da resposta parcial também vai ao agendamento: a etapa segue "autorizada em parte"
    const s = { ...base, senha: 'P7', guia: parcial };
    expect(autorizacaoParcial(s)).toBe(true);
    expect(etapaAutorizacaoCirurgia(s)).toBe('autorizada_parcial');
    expect(etapaAutorizacaoCirurgia({ ...base, guia: parcial })).toBe('autorizada_parcial');
    expect(etapaAutorizacaoCirurgia({ ...base, guia: { situacao: 'autorizada_parcial', senha: null } })).toBe(
      'aguardando_operadora',
    );
    for (const nova of ['confirmado', 'no_bloco', 'em_andamento']) {
      const r = conferirConfirmacaoCirurgia(s, nova, 'qualquer complemento longo');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.codigo).toBe('autorizacao-parcial');
    }
    // a urgência autorizada em parte também pede a conferência (a exceção de urgência não vale: já há senha)
    expect(conferirConfirmacaoCirurgia({ ...s, natureza: 'urgencia' }, 'no_bloco', null).ok).toBe(false);
    expect(
      conferirExcecaoUrgencia({ ...s, natureza: 'urgencia' }, 'Trauma com sangramento ativo'),
    ).toHaveLength(1);
    expect(conferirConfirmacaoCirurgia({ ...s, parcialConferida: true }, 'confirmado', null)).toEqual({
      ok: true,
      comunicarDepois: false,
    });
    expect(conferirConfirmacaoCirurgia(s, 'cancelado', null).ok).toBe(true);
    // registrar a conferência: só na guia parcial, uma vez, com 10 a 500 letras
    expect(conferirConferenciaParcial(s, 'Segue só o procedimento principal autorizado')).toEqual([]);
    expect(conferirConferenciaParcial(s, 'curta').map((x) => x.campo)).toEqual(['justificativa']);
    expect(
      conferirConferenciaParcial({ ...s, parcialConferida: true }, 'Segue só o principal autorizado'),
    ).toHaveLength(1);
    expect(
      conferirConferenciaParcial(
        { ...base, senha: 'S1', guia: { situacao: 'autorizada', senha: 'S1' } },
        'Segue só o principal autorizado',
      ).map((x) => x.campo),
    ).toEqual(['agendamento']);
    expect(conferirConferenciaParcial({ ...s, tipoCobertura: 'sus' }, 'Segue só o principal')).toHaveLength(
      1,
    );
  });
});
