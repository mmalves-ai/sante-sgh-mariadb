// W0-07 (M1): casos de referência do alerta de deterioração e de sepse no PA. NEWS2 pela tabela da publicação do RCP
// (2017), qSOFA pelos três critérios do Sepsis-3 (Singer e Seymour, JAMA 2016; adotado no protocolo do ILAS) e SIRS
// pelos quatro critérios clássicos (o "SIRS ≥ 2" da triagem do ILAS). O limiar da sugestão é parâmetro (padrão NEWS2 5
// e qSOFA 2).
import { describe, expect, it } from 'vitest';
import {
  avaliarDeterioracaoPa,
  calcularNews2Pa,
  calcularQsofa,
  calcularSirs,
  conscienciaAlterada,
  LIMIARES_SEPSE_PA_PADRAO,
  type SinaisDeterioracao,
} from './deterioracao-pa.js';

const NORMAL: SinaisDeterioracao = {
  fr: 16,
  spo2: 98,
  o2: 0,
  pas: 120,
  fc: 72,
  consciencia: 'A',
  temperatura: 36.8,
};

describe('qSOFA (Sepsis-3)', () => {
  it('limites: FR 22 conta e 21 não; PAS 100 conta e 101 não; consciência alterada conta', () => {
    expect(calcularQsofa({ ...NORMAL, fr: 21 }).total).toBe(0);
    expect(calcularQsofa({ ...NORMAL, fr: 22 }).total).toBe(1);
    expect(calcularQsofa({ ...NORMAL, pas: 101 }).total).toBe(0);
    expect(calcularQsofa({ ...NORMAL, pas: 100 }).total).toBe(1);
    expect(calcularQsofa({ ...NORMAL, consciencia: 'C' }).total).toBe(1);
    expect(calcularQsofa({ ...NORMAL, fr: 24, pas: 90, consciencia: 'V' })).toMatchObject({
      total: 3,
      completo: true,
    });
  });
  it('sem a ACVPU, o Glasgow abaixo de 15 vale como consciência alterada', () => {
    expect(conscienciaAlterada({ consciencia: null, glasgow: 14 })).toBe(true);
    expect(conscienciaAlterada({ consciencia: null, glasgow: 15 })).toBe(false);
    expect(conscienciaAlterada({ consciencia: null, glasgow: null })).toBeNull();
    expect(calcularQsofa({ ...NORMAL, consciencia: null, glasgow: 13, fr: 23 }).total).toBe(2);
  });
});

describe('SIRS', () => {
  it('limites: temperatura acima de 38 ou abaixo de 36, FC acima de 90, FR acima de 20, leucócitos', () => {
    expect(calcularSirs({ ...NORMAL, temperatura: 38 }).total).toBe(0);
    expect(calcularSirs({ ...NORMAL, temperatura: 38.1 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, temperatura: 35.9 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, fc: 90 }).total).toBe(0);
    expect(calcularSirs({ ...NORMAL, fc: 91 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, fr: 20 }).total).toBe(0);
    expect(calcularSirs({ ...NORMAL, fr: 21 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, leucocitos: 12_500 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, leucocitos: 3_500 }).total).toBe(1);
    expect(calcularSirs({ ...NORMAL, leucocitos: 8_000, bastoes10: true }).total).toBe(1);
  });
  it('sem hemograma, a SIRS fica parcial (o leucograma falta)', () => {
    const r = calcularSirs({ ...NORMAL, temperatura: 38.6, fc: 118 });
    expect(r).toMatchObject({ total: 2, completo: false, faltando: ['leucocitos'] });
  });
});

describe('NEWS2 do PA pelo motor do M45', () => {
  it('completo: o mesmo total do motor (caso da publicação: 5 com FR 22, FC 115 e 38,4 °C)', () => {
    const r = calcularNews2Pa({ ...NORMAL, fr: 22, fc: 115, temperatura: 38.4 });
    expect(r).toMatchObject({ total: 5, completo: true, faltando: [] });
    expect(r.parcelas).toHaveLength(7);
  });
  it('sinais da classificação (sem oxigênio e sem consciência): soma parcial, que é o piso', () => {
    const r = calcularNews2Pa({ ...NORMAL, o2: null, consciencia: null, fr: 25, pas: 88 });
    expect(r.completo).toBe(false);
    expect(r.faltando).toEqual(['o2', 'acvpu']);
    expect(r.total).toBe(6); // FR 25 = 3, PAS 88 = 3
  });
});

describe('alerta e sugestão de sepse (limiar parametrizado)', () => {
  it('paciente estável: nível baixo, sem sugestão', () => {
    const r = avaliarDeterioracaoPa(NORMAL);
    expect(r).toMatchObject({ nivel: 'baixo', sugereSepse: false, motivoSepse: [] });
    expect(r.news2.total + r.qsofa.total).toBe(0);
  });
  it('referência 1 (sepse pela FR e pela pressão): NEWS2 8, qSOFA 2, SIRS 3: nível alto e sugestão pelos dois', () => {
    // FR 24 (2), SpO2 95 (1), ar (0), PAS 98 (2), FC 112 (2), A (0), 38,3 °C (1): 8, parcela a parcela.
    const s = { ...NORMAL, fr: 24, spo2: 95, pas: 98, fc: 112, temperatura: 38.3 };
    const r = avaliarDeterioracaoPa(s);
    expect(r.news2.total).toBe(2 + 1 + 0 + 2 + 2 + 0 + 1);
    expect(r.qsofa.total).toBe(2);
    expect(r.sirs.total).toBe(3);
    expect(r.nivel).toBe('alto');
    expect(r.sugereSepse).toBe(true);
    expect(r.motivoSepse).toEqual(['news2', 'qsofa']);
    expect(r.conduta).toMatch(/protocolo de sepse/);
  });
  it('referência 2: NEWS2 5 sozinho atinge o padrão (5); com o limiar da instituição em 6, não', () => {
    const s = { ...NORMAL, fr: 22, fc: 115, temperatura: 38.4 };
    expect(avaliarDeterioracaoPa(s)).toMatchObject({
      nivel: 'medio',
      sugereSepse: true,
      motivoSepse: ['news2'],
    });
    expect(avaliarDeterioracaoPa(s, { news2: 6, qsofa: 2 }).sugereSepse).toBe(false);
  });
  it('referência 3: qSOFA 2 com NEWS2 baixo (FR 22 e confusão nova) sugere pelo qSOFA', () => {
    const r = avaliarDeterioracaoPa({ ...NORMAL, fr: 22, consciencia: 'C' });
    expect(r.news2.total).toBe(2 + 3);
    expect(r.qsofa.total).toBe(2);
    expect(r.motivoSepse).toContain('qsofa');
  });
  it('referência 4: parâmetro isolado em 3 (SpO2 91) sem atingir o limiar: baixo a médio', () => {
    const r = avaliarDeterioracaoPa({ ...NORMAL, spo2: 91 });
    expect(r).toMatchObject({ nivel: 'baixoMedio', sugereSepse: false });
  });
  it('parcial abaixo do limiar: indeterminado (nunca "baixo" sem a aferição completa)', () => {
    const r = avaliarDeterioracaoPa({ ...NORMAL, o2: null, consciencia: null });
    expect(r.nivel).toBe('indeterminado');
    expect(r.sugereSepse).toBe(false);
    expect(r.conduta).toMatch(/completar a aferição/);
  });
  it('parcial que já atinge o limiar (o piso): sugere mesmo sem a aferição completa', () => {
    const r = avaliarDeterioracaoPa({ ...NORMAL, o2: null, consciencia: null, fr: 25, pas: 88 });
    expect(r.sugereSepse).toBe(true);
    expect(r.motivoSepse).toEqual(['news2', 'qsofa']);
  });
  it('o padrão do mercado é NEWS2 5 ou qSOFA 2', () => {
    expect(LIMIARES_SEPSE_PA_PADRAO).toEqual({ news2: 5, qsofa: 2 });
  });
});
