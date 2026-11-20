// Regra 1 do M45: NEWS2 a cada aferição (RCP 2017), com a conduta: 5 a 6 ou 3 num parâmetro isolado avisa o médico; 7 ou
// mais aciona o TRR; suspeita de infecção com 5 ou mais sugere o protocolo de sepse. Casos da publicação (tabela 1).
import { describe, expect, it } from 'vitest';
import {
  calcularNews2,
  pontosConsciencia,
  pontosFc,
  pontosFr,
  pontosPas,
  pontosSpo2,
  pontosTemperatura,
} from './news2.js';
import { REGRAS_PADRAO } from './regras.js';

const NORMAL = { fr: 16, spo2: 98, o2: 0, pas: 120, fc: 72, acvpu: 0, temperatura: 36.8 };

describe('pontos de cada parâmetro (limites da tabela da publicação)', () => {
  it('frequência respiratória', () => {
    expect([8, 9, 11, 12, 20, 21, 24, 25].map(pontosFr)).toEqual([3, 1, 1, 0, 0, 2, 2, 3]);
  });
  it('saturação na escala 1 e na escala 2 (ar e oxigênio)', () => {
    expect([91, 92, 93, 94, 95, 96].map((v) => pontosSpo2(v, 1, false))).toEqual([3, 2, 2, 1, 1, 0]);
    expect([83, 84, 85, 86, 87, 88, 92].map((v) => pontosSpo2(v, 2, false))).toEqual([3, 2, 2, 1, 1, 0, 0]);
    // Na escala 2, 93 ou mais em ar ambiente é 0; em oxigênio sobe (93-94: 1; 95-96: 2; 97+: 3).
    expect(pontosSpo2(97, 2, false)).toBe(0);
    expect([93, 94, 95, 96, 97].map((v) => pontosSpo2(v, 2, true))).toEqual([1, 1, 2, 2, 3]);
  });
  it('pressão sistólica, pulso, consciência e temperatura', () => {
    expect([90, 91, 100, 101, 110, 111, 219, 220].map(pontosPas)).toEqual([3, 2, 2, 1, 1, 0, 0, 3]);
    expect([40, 41, 50, 51, 90, 91, 110, 111, 130, 131].map(pontosFc)).toEqual([
      3, 1, 1, 0, 0, 1, 1, 2, 2, 3,
    ]);
    expect([0, 1, 2, 3, 4].map(pontosConsciencia)).toEqual([0, 3, 3, 3, 3]);
    expect([35, 35.1, 36, 36.1, 38, 38.1, 39, 39.1].map(pontosTemperatura)).toEqual([3, 1, 1, 0, 0, 1, 1, 2]);
  });
});

describe('total, faixa e conduta (regra 1)', () => {
  it('normal: 0, risco baixo, sem conduta', () => {
    const r = calcularNews2(NORMAL);
    expect(r).toMatchObject({ total: 0, gatilho: 'nenhum', sugereSepse: false });
    expect(r.faixa.codigo).toBe('baixo');
    expect(r.parcelas).toHaveLength(7);
  });
  it('3 num parâmetro isolado com total baixo: avisa o médico (risco baixo a médio)', () => {
    const r = calcularNews2({ ...NORMAL, acvpu: 1 });
    expect(r.total).toBe(3);
    expect(r.parametroIsoladoTres).toBe(true);
    expect(r.gatilho).toBe('avisar-medico');
    expect(r.faixa).toMatchObject({ codigo: 'baixoMedio', risco: true });
    expect(r.conduta).toMatch(/um parâmetro em 3 pontos/);
  });
  it('5 a 6: avisa o médico; com suspeita de infecção, sugere a sepse', () => {
    const cinco = { ...NORMAL, fr: 22, fc: 115, temperatura: 38.4 }; // 2 + 2 + 1
    expect(calcularNews2(cinco)).toMatchObject({ total: 5, gatilho: 'avisar-medico' });
    expect(calcularNews2(cinco).faixa.codigo).toBe('medio');
    const s = calcularNews2(cinco, { suspeitaInfeccao: true });
    expect(s).toMatchObject({ gatilho: 'sepse', sugereSepse: true });
    expect(s.conduta).toMatch(/protocolo de sepse/);
    expect(calcularNews2({ ...NORMAL, fc: 115 }, { suspeitaInfeccao: true }).sugereSepse).toBe(false);
  });
  it('7 ou mais: aciona o TRR (e mantém a sugestão de sepse quando há suspeita)', () => {
    // E2E @M45.2: FR 26 (3), SpO2 93 (2), O2 2 L (2) = 7.
    const r = calcularNews2({ ...NORMAL, fr: 26, spo2: 93, o2: 2 });
    expect(r).toMatchObject({ total: 7, gatilho: 'trr', sugereSepse: false });
    expect(r.faixa.codigo).toBe('alto');
    expect(r.conduta).toMatch(/Time de Resposta Rápida/);
    const s = calcularNews2({ ...NORMAL, fr: 26, spo2: 93, o2: 2 }, { suspeitaInfeccao: true });
    expect(s).toMatchObject({ gatilho: 'trr', sugereSepse: true });
    expect(s.conduta).toMatch(/sepse/);
  });
  it('a escala 2 muda a pontuação da saturação no paciente hipercápnico em oxigênio', () => {
    const p = { ...NORMAL, spo2: 90, o2: 1 };
    expect(calcularNews2(p).total).toBe(5); // escala 1: 3 + 2 de oxigênio
    expect(calcularNews2(p, { escalaSpo2: 2 }).total).toBe(2); // escala 2: 0 + 2 de oxigênio
  });
  it('as faixas vêm da regra vigente (versão publicada)', () => {
    const regra = {
      ...REGRAS_PADRAO.news2,
      versao: 2,
      faixas: [
        { codigo: 'baixo', rotulo: 'Baixo', minimo: 0, maximo: 3, risco: false },
        { codigo: 'medio', rotulo: 'Médio', minimo: 4, maximo: 6, risco: true },
        { codigo: 'alto', rotulo: 'Alto', minimo: 7, maximo: 20, risco: true },
      ],
    };
    expect(calcularNews2({ ...NORMAL, fc: 115, fr: 22 }, { regra }).faixa.codigo).toBe('medio');
  });
});
