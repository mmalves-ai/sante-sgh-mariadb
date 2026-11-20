// Obstetrícia e neonatologia (M45, etapa 6): o partograma (fase ativa, linhas de alerta e de ação, alertas) e o
// recém-nascido (classificações, Apgar do 10º minuto, a mãe da internação e o tipo de parto do cadastro).
import { esquemaRegistrarPartograma, esquemaRegistrarRecemNascido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroEspecialidade } from './comum.js';
import {
  alertasDoRegistro,
  classificarApgar,
  classificarIdadeGestacional,
  classificarPesoAoNascer,
  conferirPartograma,
  conferirRecemNascido,
  igDecimal,
  linhasDoPartograma,
  posicaoNasLinhas,
} from './obstetricia.js';

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroEspecialidade ? e.codigo : `outro: ${String(e)}`;
  }
  return 'passou';
};
const ponto = (x: Record<string, unknown>) =>
  esquemaRegistrarPartograma.parse({ internacao: 1, em: '2026-10-25T10:00', ...x });
const C = { admissao: '2026-10-25T06:00', agora: '2026-10-25T18:00', anteriores: [], faseAtivaCm: 4 };

describe('linhas do partograma', () => {
  it('a fase ativa no primeiro registro com 4 cm; alerta a 1 cm/h e ação 4 h à direita', () => {
    const l = linhasDoPartograma(
      [
        { em: '2026-10-25T10:00', dilatacaoCm: 5 },
        { em: '2026-10-25T08:00', dilatacaoCm: 3 },
        { em: '2026-10-25T09:00', dilatacaoCm: 4 },
      ],
      4,
    );
    expect(l.inicioFaseAtiva).toEqual({ em: '2026-10-25T09:00', dilatacaoCm: 4 });
    expect(l.alerta).toEqual([
      { horas: 0, dilatacaoCm: 4 },
      { horas: 6, dilatacaoCm: 10 },
    ]);
    expect(l.acao).toEqual([
      { horas: 4, dilatacaoCm: 4 },
      { horas: 10, dilatacaoCm: 10 },
    ]);
    expect(posicaoNasLinhas(l, '2026-10-25T11:00', 7)).toBe('esquerda-da-alerta');
    expect(posicaoNasLinhas(l, '2026-10-25T12:00', 6)).toBe('alerta');
    expect(posicaoNasLinhas(l, '2026-10-25T15:00', 5)).toBe('acao');
    expect(posicaoNasLinhas(l, '2026-10-25T08:30', 3)).toBe('antes-da-fase-ativa');
    expect(linhasDoPartograma([{ em: '2026-10-25T08:00', dilatacaoCm: 3 }], 4).inicioFaseAtiva).toBeNull();
    expect(posicaoNasLinhas(linhasDoPartograma([], 4), '2026-10-25T08:00', 3)).toBe('antes-da-fase-ativa');
  });
});

describe('registro do partograma', () => {
  it('os alertas do registro', () => {
    expect(
      alertasDoRegistro(
        ponto({
          bcf: 100,
          contracoes10min: 6,
          bolsa: 'rota',
          liquido: 'meconial',
          paSistolica: 150,
          paDiastolica: 95,
          temperatura: 38.2,
        }),
      ),
    ).toHaveLength(5);
    expect(alertasDoRegistro(ponto({ bcf: 170 }))[0]).toContain('taquicardia');
    expect(alertasDoRegistro(ponto({ bcf: 140, paSistolica: 120, paDiastolica: 80 }))).toEqual([]);
  });

  it('confere o registro e soma os alertas das linhas', () => {
    const anteriores = [{ em: '2026-10-25T09:00', dilatacaoCm: 4, bolsa: null }];
    expect(conferirPartograma(ponto({ dilatacaoCm: 6, bcf: 140 }), { ...C, anteriores }).alertas).toEqual([]);
    expect(
      conferirPartograma(ponto({ em: '2026-10-25T12:00', dilatacaoCm: 5 }), { ...C, anteriores }).alertas,
    ).toEqual(['Dilatação à direita da linha de alerta: reavaliar a evolução do trabalho de parto.']);
    expect(
      conferirPartograma(ponto({ em: '2026-10-25T15:00', dilatacaoCm: 5 }), { ...C, anteriores }).alertas,
    ).toEqual(['Dilatação além da linha de ação: conduta médica imediata.']);
  });

  it('recusa o vazio, o futuro, antes da admissão, a pressão invertida e o líquido sem a bolsa rota', () => {
    expect(erro(() => conferirPartograma(ponto({}), C))).toBe('registro-vazio');
    expect(erro(() => conferirPartograma(ponto({ observacao: 'Paciente deambulando' }), C))).toBe('passou');
    expect(erro(() => conferirPartograma(ponto({ em: '2026-10-25T19:00', bcf: 140 }), C))).toBe(
      'instante-futuro',
    );
    expect(erro(() => conferirPartograma(ponto({ em: '2026-10-25T05:00', bcf: 140 }), C))).toBe(
      'antes-da-admissao',
    );
    expect(erro(() => conferirPartograma(ponto({ paSistolica: 80, paDiastolica: 90 }), C))).toBe(
      'pressao-invertida',
    );
    expect(erro(() => conferirPartograma(ponto({ liquido: 'claro' }), C))).toBe('liquido-sem-bolsa-rota');
    expect(
      erro(() =>
        conferirPartograma(ponto({ liquido: 'claro' }), {
          ...C,
          anteriores: [{ em: '2026-10-25T09:00', dilatacaoCm: null, bolsa: 'rota' }],
        }),
      ),
    ).toBe('passou');
  });
});

describe('recém-nascido', () => {
  const rn = (x: Record<string, unknown> = {}) =>
    esquemaRegistrarRecemNascido.parse({
      internacao: 1,
      nascimentoEm: '2026-10-25T14:10',
      sexo: 'F',
      pesoG: 3200,
      apgar1: 8,
      apgar5: 9,
      igSemanas: 39,
      igDias: 2,
      tipoParto: 1,
      reanimacao: false,
      ...x,
    });
  const c = {
    sexoMae: 'F' as const,
    tiposParto: new Set([1, 2, 3, 4]),
    admissao: C.admissao,
    agora: C.agora,
  };

  it('as classificações', () => {
    expect(classificarIdadeGestacional(27, 6)).toContain('extremo');
    expect(classificarIdadeGestacional(30, 0)).toContain('Muito pré-termo');
    expect(classificarIdadeGestacional(36, 6)).toContain('moderado a tardio');
    expect(classificarIdadeGestacional(39, 0)).toContain('A termo');
    expect(classificarIdadeGestacional(42, 0)).toContain('Pós-termo');
    expect(classificarPesoAoNascer(900)).toContain('Extremo');
    expect(classificarPesoAoNascer(1400)).toContain('Muito baixo');
    expect(classificarPesoAoNascer(2400)).toContain('Baixo peso');
    expect(classificarPesoAoNascer(3200)).toContain('adequado');
    expect(classificarPesoAoNascer(4100)).toContain('Macrossomia');
    expect(classificarApgar(9)).toContain('normal');
    expect(classificarApgar(5)).toContain('moderadamente');
    expect(classificarApgar(2)).toContain('baixo');
    expect(igDecimal(39, 2)).toBe(39.3);
  });

  it('confere e devolve os alertas', () => {
    expect(conferirRecemNascido(rn(), c).alertas).toEqual([]);
    expect(
      conferirRecemNascido(rn({ apgar5: 6, apgar10: 8, pesoG: 2300, reanimacao: true }), c).alertas,
    ).toHaveLength(3);
  });

  it('recusa a mãe do sexo masculino, o tipo de parto fora do cadastro, o Apgar do 10º ausente e o futuro', () => {
    expect(erro(() => conferirRecemNascido(rn(), { ...c, sexoMae: 'M' }))).toBe('mae-nao-feminina');
    expect(erro(() => conferirRecemNascido(rn({ tipoParto: 9 }), c))).toBe('valor-desconhecido');
    expect(erro(() => conferirRecemNascido(rn({ apgar5: 5 }), c))).toBe('apgar10-ausente');
    expect(erro(() => conferirRecemNascido(rn({ nascimentoEm: '2026-10-26T01:00' }), c))).toBe(
      'instante-futuro',
    );
  });
});
