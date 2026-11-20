// Regra 2 (ficha do M47): sem dupla checagem da bolsa contra a pulseira, a transfusão não é registrada como iniciada.
// (A prova na cópia, com a checagem do horário no outro sistema, é o `ato-transfusional.int-spec.ts` do construtor.)
import { describe, expect, it } from 'vitest';
import {
  amostraValidaAte,
  conferirInicioTransfusao,
  gravacaoNoHorario,
  MENSAGENS_INICIO,
} from './ato-transfusional.js';

const AGORA = '2026-10-24T10:00:00';
const base = {
  agora: AGORA,
  urgencia: 'rotina' as const,
  estadoRequisicao: 'amostraColetada' as const,
  pacienteDaRequisicao: 7,
  pacienteDaPulseira: 7,
  profissional: 'ENF1',
  segundoProfissional: { login: 'enf2', autenticado: true, temPermissao: true },
  amostraColetadaEm: '2026-10-23T10:00:00',
  termoAssinado: true,
  sinaisAntesEm: '2026-10-24T09:50:00',
  bolsa: { bloqueios: [], alertas: [] },
  bolsaJaUsada: false,
  situacaoHorario: 'P',
};

describe('início do ato (regra 2)', () => {
  it('com a dupla checagem completa, pode', () => {
    expect(conferirInicioTransfusao(base)).toEqual({ pode: true, bloqueios: [], alertas: [] });
    expect(
      conferirInicioTransfusao({ ...base, situacaoHorario: null, estadoRequisicao: 'emAtendimento' }).pode,
    ).toBe(true);
  });

  it('pulseira não lida ou de outro paciente', () => {
    expect(conferirInicioTransfusao({ ...base, pacienteDaPulseira: null }).bloqueios).toEqual([
      'pulseira-nao-lida',
    ]);
    expect(conferirInicioTransfusao({ ...base, pacienteDaPulseira: 8 }).bloqueios).toEqual([
      'pulseira-outro-paciente',
    ]);
  });

  it('segundo profissional ausente, não autenticado, o mesmo ou sem permissão', () => {
    expect(conferirInicioTransfusao({ ...base, segundoProfissional: null }).bloqueios).toEqual([
      'sem-segundo-profissional',
    ]);
    expect(
      conferirInicioTransfusao({
        ...base,
        segundoProfissional: { ...base.segundoProfissional, autenticado: false },
      }).bloqueios,
    ).toEqual(['sem-segundo-profissional']);
    expect(
      conferirInicioTransfusao({
        ...base,
        segundoProfissional: { ...base.segundoProfissional, login: ' enf1 ' },
      }).bloqueios,
    ).toEqual(['segundo-profissional-igual']);
    expect(
      conferirInicioTransfusao({
        ...base,
        segundoProfissional: { ...base.segundoProfissional, temPermissao: false },
      }).bloqueios,
    ).toEqual(['segundo-profissional-sem-permissao']);
  });

  it('amostra, termo, sinais e requisição', () => {
    expect(conferirInicioTransfusao({ ...base, amostraColetadaEm: null }).bloqueios).toEqual(['sem-amostra']);
    expect(conferirInicioTransfusao({ ...base, amostraColetadaEm: '2026-10-21T09:00:00' }).bloqueios).toEqual(
      ['amostra-vencida'],
    );
    expect(conferirInicioTransfusao({ ...base, termoAssinado: false }).bloqueios).toEqual(['sem-termo']);
    expect(conferirInicioTransfusao({ ...base, sinaisAntesEm: null }).bloqueios).toEqual([
      'sem-sinais-antes',
    ]);
    expect(conferirInicioTransfusao({ ...base, sinaisAntesEm: '2026-10-24T09:20:00' }).bloqueios).toEqual([
      'sinais-antes-antigos',
    ]);
    expect(conferirInicioTransfusao({ ...base, estadoRequisicao: 'cancelada' }).bloqueios).toEqual([
      'requisicao-fechada',
    ]);
  });

  it('bolsa: bloqueios da regra 3, já usada, e o horário não pendente', () => {
    const r = conferirInicioTransfusao({
      ...base,
      bolsa: { bloqueios: ['bolsa-vencida'], alertas: ['abo-nao-identico'] },
      bolsaJaUsada: true,
      situacaoHorario: 'S',
    });
    expect(r).toEqual({
      pode: false,
      bloqueios: ['bolsa-vencida', 'bolsa-ja-usada', 'horario-nao-pendente'],
      alertas: ['abo-nao-identico'],
    });
  });

  it('extrema urgência dispensa amostra, termo e aceita a pulseira com motivo; os sinais continuam', () => {
    const r = conferirInicioTransfusao({
      ...base,
      urgencia: 'extremaUrgencia',
      estadoRequisicao: 'requisitada',
      pacienteDaPulseira: null,
      amostraColetadaEm: null,
      termoAssinado: false,
    });
    expect(r.pode).toBe(true);
    expect(
      conferirInicioTransfusao({ ...base, urgencia: 'extremaUrgencia', sinaisAntesEm: null }).bloqueios,
    ).toEqual(['sem-sinais-antes']);
  });

  it('textos de produto', () => {
    for (const m of Object.values(MENSAGENS_INICIO)) expect(m).not.toMatch(/SPDATA|legado/i);
  });
});

describe('amostra e horário', () => {
  it('validade de 72 horas', () => {
    expect(amostraValidaAte('2026-10-24T10:00')).toBe('2026-10-27T10:00:00');
    expect(amostraValidaAte('2026-10-24T10:00:00', 24)).toBe('2026-10-25T10:00:00');
  });
  it('checa o horário pendente; sem horário, só o registro clínico', () => {
    expect(gravacaoNoHorario('P')).toBe('checar-administrado');
    expect(gravacaoNoHorario(null)).toBe('so-registro-clinico');
  });
});
