import { describe, expect, it } from 'vitest';
import {
  chaveLiberacaoDoInstrumento,
  competenciaAnterior,
  competenciaDaData,
  competenciaDe,
  competenciaSeguinte,
  dataNaCompetencia,
  intervaloDaCompetencia,
  partesDaCompetencia,
  recusaAbrirCompetencia,
  recusaFecharCompetencia,
  recusaReabrirCompetencia,
} from './competencia.js';

describe('competência SUS (AAAAMM)', () => {
  it('lê, monta e navega', () => {
    expect(partesDaCompetencia('202509')).toEqual({ ano: 2025, mes: 9 });
    expect(partesDaCompetencia('202513')).toBeNull();
    expect(partesDaCompetencia('2025-09')).toBeNull();
    expect(competenciaDe(2025, 9)).toBe('202509');
    expect(() => competenciaDe(2025, 13)).toThrow(RangeError);
    expect(() => competenciaDe(1999, 1)).toThrow(RangeError);
    expect(competenciaSeguinte('202512')).toBe('202601');
    expect(competenciaSeguinte('202509')).toBe('202510');
    expect(competenciaAnterior('202601')).toBe('202512');
    expect(competenciaAnterior('202510')).toBe('202509');
    expect(() => competenciaSeguinte('2025')).toThrow(RangeError);
    expect(() => competenciaAnterior('x')).toThrow(RangeError);
  });

  it('competência da data: a do atendimento; a data vazia do banco não tem competência', () => {
    expect(competenciaDaData('2025-09-30')).toBe('202509');
    expect(competenciaDaData('2025-09-30T23:59:00Z')).toBe('202509');
    expect(competenciaDaData('1899-12-30')).toBeNull();
    expect(competenciaDaData(null)).toBeNull();
    expect(competenciaDaData('lixo')).toBeNull();
    expect(dataNaCompetencia('2025-02-28', '202502')).toBe(true);
    expect(dataNaCompetencia('2025-03-01', '202502')).toBe(false);
  });

  it('intervalo com o último dia certo (inclusive fevereiro bissexto)', () => {
    expect(intervaloDaCompetencia('202402')).toEqual({ inicio: '2024-02-01', fim: '2024-02-29' });
    expect(intervaloDaCompetencia('202502')).toEqual({ inicio: '2025-02-01', fim: '2025-02-28' });
    expect(intervaloDaCompetencia('202512')).toEqual({ inicio: '2025-12-01', fim: '2025-12-31' });
    expect(() => intervaloDaCompetencia('202500')).toThrow(RangeError);
  });

  it('abrir: uma por instrumento; nunca futura; instrumento desligado não abre (DP-35)', () => {
    expect(recusaAbrirCompetencia('202510', '2026-10-24', null, true)).toBeNull();
    expect(recusaAbrirCompetencia('202610', '2026-10-24', null, true)).toBeNull();
    expect(recusaAbrirCompetencia('202611', '2026-10-24', null, true)).toBe('competencia-futura');
    expect(recusaAbrirCompetencia('202509', '2026-10-24', { situacao: 'aberta' }, true)).toBe(
      'competencia-ja-aberta',
    );
    expect(recusaAbrirCompetencia('202509', '2026-10-24', { situacao: 'fechada' }, true)).toBe(
      'competencia-ja-fechada',
    );
    expect(recusaAbrirCompetencia('202509', '2026-10-24', null, false)).toBe('instrumento-desligado');
  });

  it('fechar: só aberta, criticada e com as críticas tratadas (bloqueante corrigida e aviso justificado não impedem)', () => {
    const aberta = { situacao: 'aberta' } as const;
    expect(recusaFecharCompetencia(null, true, [])).toBe('competencia-nao-aberta');
    expect(recusaFecharCompetencia({ situacao: 'fechada' }, true, [])).toBe('competencia-ja-fechada');
    expect(recusaFecharCompetencia(aberta, false, [])).toBe('critica-nao-executada');
    expect(recusaFecharCompetencia(aberta, true, [{ gravidade: 'bloqueante', situacao: 'aberta' }])).toBe(
      'criticas-bloqueantes-abertas',
    );
    expect(
      recusaFecharCompetencia(aberta, true, [
        { gravidade: 'bloqueante', situacao: 'corrigida' },
        { gravidade: 'aviso', situacao: 'aberta' },
      ]),
    ).toBe('avisos-nao-justificados');
    expect(
      recusaFecharCompetencia(aberta, true, [
        { gravidade: 'bloqueante', situacao: 'corrigida' },
        { gravidade: 'aviso', situacao: 'justificada' },
        { gravidade: 'aviso', situacao: 'corrigida' },
      ]),
    ).toBeNull();
    // A bloqueante vem antes do aviso (a correção na origem primeiro).
    expect(
      recusaFecharCompetencia(aberta, true, [
        { gravidade: 'aviso', situacao: 'aberta' },
        { gravidade: 'bloqueante', situacao: 'aberta' },
      ]),
    ).toBe('criticas-bloqueantes-abertas');
  });

  it('reabrir: só a fechada', () => {
    expect(recusaReabrirCompetencia(null)).toBe('competencia-nao-aberta');
    expect(recusaReabrirCompetencia({ situacao: 'aberta' })).toBe('competencia-nao-fechada');
    expect(recusaReabrirCompetencia({ situacao: 'fechada' })).toBeNull();
  });

  it('chave de liberação por instrumento', () => {
    expect(chaveLiberacaoDoInstrumento('ciha')).toBe('faturamento.susCiha');
    expect(chaveLiberacaoDoInstrumento('aih')).toBe('faturamento.susAih');
  });
});
