// Regra 13 do M25: unidade padronizada e faixa plausível; fora da faixa pede confirmação; retificação é versão nova.
import { describe, expect, it } from 'vitest';
import { conferirRetificacao, validarSinal, vigentes } from './validacao.js';

describe('regra 13: sinais vitais', () => {
  it('dentro da faixa: a unidade padronizada', () => {
    expect(validarSinal({ tipo: 'fc', valor: 80, confirmadoForaDaFaixa: false })).toEqual({
      ok: true,
      unidade: 'bpm',
      foraDaFaixa: false,
    });
    expect(validarSinal({ tipo: 'temperatura', valor: 36.8, confirmadoForaDaFaixa: false })).toMatchObject({
      unidade: '°C',
    });
  });
  it('fora da faixa de alerta pede confirmação; confirmado, grava marcado', () => {
    expect(validarSinal({ tipo: 'spo2', valor: 88, confirmadoForaDaFaixa: false })).toMatchObject({
      ok: false,
      codigo: 'sinal-confirmar',
    });
    expect(validarSinal({ tipo: 'spo2', valor: 88, confirmadoForaDaFaixa: true })).toEqual({
      ok: true,
      unidade: '%',
      foraDaFaixa: true,
    });
  });
  it('fora da faixa plausível é recusado (erro de digitação); escalas inteiras; tipo desconhecido', () => {
    expect(validarSinal({ tipo: 'fc', valor: 800, confirmadoForaDaFaixa: true })).toMatchObject({
      codigo: 'sinal-implausivel',
    });
    expect(validarSinal({ tipo: 'temperatura', valor: 3.7, confirmadoForaDaFaixa: true })).toMatchObject({
      codigo: 'sinal-implausivel',
    });
    expect(validarSinal({ tipo: 'dor', valor: 4.5, confirmadoForaDaFaixa: true })).toMatchObject({
      codigo: 'sinal-implausivel',
    });
    expect(validarSinal({ tipo: 'acvpu', valor: 1.5, confirmadoForaDaFaixa: true })).toMatchObject({
      codigo: 'sinal-implausivel',
    });
    expect(validarSinal({ tipo: 'xyz', valor: 1, confirmadoForaDaFaixa: true })).toMatchObject({
      codigo: 'sinal-tipo',
    });
  });
  it('retificação: versão seguinte, com justificativa, só da vigente', () => {
    expect(
      conferirRetificacao({
        atual: { id: 1, versao: 1, substituidoPor: null },
        justificativa: 'valor digitado errado',
      }),
    ).toEqual({
      ok: true,
      versao: 2,
    });
    expect(
      conferirRetificacao({
        atual: { id: 1, versao: 1, substituidoPor: 2 },
        justificativa: 'valor digitado errado',
      }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      conferirRetificacao({ atual: { id: 1, versao: 1, substituidoPor: null }, justificativa: 'curta' }),
    ).toMatchObject({
      ok: false,
    });
    expect(conferirRetificacao({ atual: null, justificativa: 'valor digitado errado' })).toMatchObject({
      ok: false,
    });
    expect(
      vigentes([
        { id: 1, versao: 1, substituidoPor: 2 },
        { id: 2, versao: 2, substituidoPor: null },
      ]).map((x) => x.id),
    ).toEqual([2]);
  });
});
