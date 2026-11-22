// O valor do laboratório de apoio interpretado pelas regras do SADT: faixa numérica, faixa em texto por sexo, regra
// de crítico sobre a faixa, crítico só pela faixa, valor em texto e faixa ilegível (sem referência inventada).
import { describe, expect, it } from 'vitest';
import { idadeEmDias, interpretarValorApoio, PRAZO_CRITICO_PADRAO_MINUTOS } from './interpretacao-apoio.js';

const faixa = { id: 7, minimo: 70, maximo: 99, texto: '70 a 99', criticoMinimo: null, criticoMaximo: null };
const paciente = { sexo: null, idadeAnos: 40 } as const;

describe('interpretação do valor do laboratório de apoio', () => {
  it('normal, baixo e alto pela faixa numérica', () => {
    expect(interpretarValorApoio({ elemento: 1, valor: 92, faixa, regra: null, paciente })).toMatchObject({
      referenciaMinimo: 70,
      referenciaMaximo: 99,
      interpretacao: 'normal',
      anormal: false,
      critico: false,
    });
    expect(
      interpretarValorApoio({ elemento: 1, valor: 60, faixa, regra: null, paciente }).interpretacao,
    ).toBe('baixo');
    expect(interpretarValorApoio({ elemento: 1, valor: 120, faixa, regra: null, paciente })).toMatchObject({
      interpretacao: 'alto',
      anormal: true,
    });
  });

  it('a faixa só em texto vale pela linha do sexo do paciente', () => {
    const t = { ...faixa, minimo: null, maximo: null, texto: 'Homens: 13 a 17 / Mulheres: 12 a 16' };
    const r = interpretarValorApoio({
      elemento: 1,
      valor: 16.5,
      faixa: t,
      regra: null,
      paciente: { sexo: 'F', idadeAnos: 30 },
    });
    expect(r).toMatchObject({
      referenciaMinimo: 12,
      referenciaMaximo: 16,
      interpretacao: 'alto',
      anormal: true,
    });
  });

  it('a regra de crítico vale sobre a faixa e dá o prazo; sem regra, o crítico da faixa com o prazo padrão', () => {
    const regra = { id: 3, abaixoDe: 40, acimaDe: 400, prazoMinutos: 15 };
    expect(interpretarValorApoio({ elemento: 1, valor: 450, faixa, regra, paciente })).toMatchObject({
      interpretacao: 'critico_alto',
      critico: true,
      anormal: true,
      criticoMinimo: 40,
      criticoMaximo: 400,
      prazoCriticoMinutos: 15,
      regraCritica: 3,
    });
    const f = { ...faixa, criticoMinimo: 50, criticoMaximo: null };
    expect(interpretarValorApoio({ elemento: 1, valor: 30, faixa: f, regra: null, paciente })).toMatchObject({
      interpretacao: 'critico_baixo',
      prazoCriticoMinutos: PRAZO_CRITICO_PADRAO_MINUTOS,
      regraCritica: null,
    });
  });

  it('valor em texto e faixa ilegível: sem interpretação nem destaque', () => {
    expect(interpretarValorApoio({ elemento: 1, valor: null, faixa, regra: null, paciente })).toMatchObject({
      interpretacao: null,
      anormal: false,
      critico: false,
    });
    const ilegivel = { ...faixa, minimo: null, maximo: null, texto: 'ver laudo' };
    expect(
      interpretarValorApoio({ elemento: 1, valor: 5, faixa: ilegivel, regra: null, paciente }),
    ).toMatchObject({
      referenciaMinimo: null,
      referenciaMaximo: null,
      referenciaTexto: 'ver laudo',
      interpretacao: null,
    });
    expect(interpretarValorApoio({ elemento: 1, valor: 5, faixa: null, regra: null, paciente }).anormal).toBe(
      false,
    );
  });

  it('idade em dias', () => {
    expect(idadeEmDias(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-11T12:00:00Z'))).toBe(10);
    expect(idadeEmDias(null, new Date())).toBeNull();
  });
});
