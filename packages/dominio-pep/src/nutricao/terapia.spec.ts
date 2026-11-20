// Terapia nutricional da EMTN (ficha do M45, seções 4 e 5): a meta pelo peso, o volume-alvo pela densidade, o percentual
// atingido com o volume da checagem (sem redigitação) ou informado, o motivo abaixo do adequado e o tempo até iniciar.
import { describe, expect, it } from 'vitest';
import {
  calcularAcompanhamento,
  calcularMeta,
  ErroTerapia,
  exigirMotivo,
  horasAteIniciar,
  volumeDoDia,
  volumesPorDia,
} from '../index.js';

const entrada = { pesoKg: 70, kcalPorKg: 25, proteinaGPorKg: 1.5, densidadeKcalMl: 1.5, proteinaGL: 60 };

describe('meta da EMTN', () => {
  it('25 kcal/kg e 1,5 g/kg em 70 kg: 1750 kcal, 105 g e 1167 mL da fórmula de 1,5 kcal/mL', () => {
    expect(calcularMeta(entrada)).toEqual({ metaKcal: 1750, metaProteinaG: 105, metaVolumeMl: 1167 });
  });
  it('fora das faixas (erro de digitação) e sem peso ou densidade é recusado', () => {
    expect(() => calcularMeta({ ...entrada, kcalPorKg: 5 })).toThrow(/kcal\/kg/);
    expect(() => calcularMeta({ ...entrada, kcalPorKg: 55 })).toThrow(ErroTerapia);
    expect(() => calcularMeta({ ...entrada, proteinaGPorKg: 0.2 })).toThrow(/g\/kg/);
    expect(() => calcularMeta({ ...entrada, proteinaGPorKg: 4 })).toThrow(ErroTerapia);
    expect(() => calcularMeta({ ...entrada, pesoKg: 0 })).toThrow(/peso/);
    expect(() => calcularMeta({ ...entrada, densidadeKcalMl: 0 })).toThrow(/densidade/);
  });
});

describe('acompanhamento do dia', () => {
  const meta = { ...calcularMeta(entrada), densidadeKcalMl: 1.5, proteinaGL: 60 };
  it('volume da checagem quando ela traz a quantidade; senão o informado; sem nenhum, recusa', () => {
    expect(volumeDoDia({ volumeMl: 900 }, 1000)).toEqual({ volumeMl: 900, origem: 'checagem' });
    expect(volumeDoDia({ volumeMl: null }, 1000)).toEqual({ volumeMl: 1000, origem: 'informado' });
    expect(volumeDoDia(null, 800)).toEqual({ volumeMl: 800, origem: 'informado' });
    expect(() => volumeDoDia({ volumeMl: null }, null)).toThrow(/volume/);
  });
  it('1000 mL: 1500 kcal (85,7%) e 60 g (57,1%): abaixo do adequado pede o motivo', () => {
    const a = calcularAcompanhamento(meta, { volumeMl: 1000, origem: 'informado' }, 80);
    expect(a).toMatchObject({
      kcalAtingida: 1500,
      proteinaAtingidaG: 60,
      pctKcal: 85.7,
      pctProteina: 57.1,
      abaixoDoAdequado: true,
      origemVolume: 'informado',
    });
    expect(() => exigirMotivo(a, null)).toThrow(/motivo/);
    expect(() => exigirMotivo(a, 'progressao')).not.toThrow();
  });
  it('meta atingida não pede motivo', () => {
    const a = calcularAcompanhamento(
      { ...meta, metaProteinaG: 60 },
      { volumeMl: 1167, origem: 'checagem' },
      80,
    );
    expect(a.abaixoDoAdequado).toBe(false);
    expect(() => exigirMotivo(a, null)).not.toThrow();
  });
  it('tempo até iniciar: da admissão à primeira checagem administrada; sem início, null', () => {
    expect(horasAteIniciar('2026-10-23T08:00', '2026-10-24T20:30')).toBe(36);
    expect(horasAteIniciar('2026-10-23T08:00', null)).toBeNull();
  });
  it('o volume checado por dia (os administrados com quantidade somam; os demais contam como previstos)', () => {
    expect(
      volumesPorDia([
        { previsto: '2026-10-24T06:00', situacao: 'A', quantidade: 250 },
        { previsto: '2026-10-24T12:00', situacao: 'A', quantidade: 250.25 },
        { previsto: '2026-10-24T18:00', situacao: 'P', quantidade: null },
        { previsto: '2026-10-25T06:00', situacao: 'A', quantidade: null },
        { previsto: '2026-10-25T12:00', situacao: 'S', quantidade: 0 },
      ]),
    ).toEqual([
      { data: '2026-10-25', horariosAdministrados: 1, horariosPrevistos: 2, volumeMl: null },
      { data: '2026-10-24', horariosAdministrados: 2, horariosPrevistos: 3, volumeMl: 500.3 },
    ]);
  });
});
