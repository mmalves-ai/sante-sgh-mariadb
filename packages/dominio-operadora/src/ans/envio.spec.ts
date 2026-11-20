// Regras 6 e 7 do M56: nada sai fora de produção; envio com arquivo, hash e recibo; mensagem só pela Hal-AI.
import { describe, expect, it } from 'vitest';
import {
  competenciaValida,
  decidirMensagemBeneficiario,
  destinoEnvioAns,
  problemasDoEnvio,
  type RegistroEnvioAns,
  trimestreDaCompetencia,
} from './envio.js';

const HASH = 'a'.repeat(64);

describe('destino dos envios à ANS (regra 7)', () => {
  it('a ANS só em produção; nos outros ambientes, o simulador', () => {
    expect(destinoEnvioAns('producao')).toBe('ans');
    for (const a of ['dev', 'homologacao', 'treino', 'teste', ''])
      expect(destinoEnvioAns(a), a).toBe('simulador');
  });
});

describe('competência', () => {
  it('mensal, trimestral e sob demanda', () => {
    expect(competenciaValida('SIB', '2026-10')).toBe(true);
    expect(competenciaValida('SIB', '2026-13')).toBe(false);
    expect(competenciaValida('SIB', '2026-T3')).toBe(false);
    expect(competenciaValida('SIP', '2026-T3')).toBe(true);
    expect(competenciaValida('DIOPS', '2026-T5')).toBe(false);
    expect(competenciaValida('TPS', '2026-09')).toBe(false);
    expect(competenciaValida('RESSARCIMENTO_SUS', '2026-02-28')).toBe(true);
    expect(competenciaValida('RESSARCIMENTO_SUS', '2026-02-30')).toBe(false);
    expect(competenciaValida('RESSARCIMENTO_SUS', '2026-02')).toBe(false);
  });

  it('trimestre da competência mensal', () => {
    expect(trimestreDaCompetencia('2026-01')).toBe('2026-T1');
    expect(trimestreDaCompetencia('2026-08')).toBe('2026-T3');
    expect(trimestreDaCompetencia('2026-12')).toBe('2026-T4');
    expect(() => trimestreDaCompetencia('2026-T1')).toThrow();
  });
});

describe('registro do envio (regra 7)', () => {
  const base: RegistroEnvioAns = {
    obrigacao: 'SIB',
    competencia: '2026-10',
    destino: 'ans',
    arquivo: 'sib-2026-10.xml',
    hash: HASH,
    recibo: 'protocolo-1',
  };

  it('completo, sem problema', () => {
    expect(problemasDoEnvio(base)).toEqual([]);
    expect(problemasDoEnvio({ ...base, destino: 'simulador', recibo: null })).toEqual([]);
  });

  it('aponta cada falta', () => {
    expect(problemasDoEnvio({ ...base, competencia: 'x', arquivo: ' ', hash: 'ABC', recibo: null })).toEqual([
      'competencia-invalida',
      'sem-arquivo',
      'hash-invalido',
      'sem-recibo',
    ]);
    expect(problemasDoEnvio({ ...base, destino: 'simulador' })).toEqual(['recibo-no-simulador']);
  });
});

describe('mensagem ao beneficiário (regra 6)', () => {
  it('só com a chave, a base legal e em produção; o canal é a Hal-AI', () => {
    const ok = { ambiente: 'producao', baseLegalAprovada: true, chaveLigada: true };
    expect(decidirMensagemBeneficiario(ok)).toEqual({ enviar: true, canal: 'hal-ai' });
    expect(decidirMensagemBeneficiario({ ...ok, chaveLigada: false })).toEqual({
      enviar: false,
      motivo: 'chave-desligada',
    });
    expect(decidirMensagemBeneficiario({ ...ok, baseLegalAprovada: false })).toEqual({
      enviar: false,
      motivo: 'sem-base-legal',
    });
    expect(decidirMensagemBeneficiario({ ...ok, ambiente: 'homologacao' })).toEqual({
      enviar: false,
      motivo: 'fora-de-producao',
    });
  });
});
