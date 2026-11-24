// Gases medicinais por tempo de uso (04-INT linha 82): uso, regra e cobrança.
import { describe, expect, it } from 'vitest';
import {
  calcularCobrancaGas,
  conferirFimUsoGas,
  conferirInicioUsoGas,
  conferirRegraCobrancaGas,
  diferencaALancarGas,
  horasDeUso,
  type RegraCobrancaGas,
  regraGasQueVale,
} from './gas-cobranca.js';

const t = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
const O2 = 10;
const AR = 20;
const base: RegraCobrancaGas = {
  unidade: 'hora',
  toleranciaMinutos: 0,
  fracaoMinimaMinutos: null,
  arredondamento: 'para_cima',
  percentualSimultaneo: null,
  faixas: [],
  simultaneos: [],
};

describe('uso do gás', () => {
  it('apura as horas e confere início e fim', () => {
    expect(horasDeUso(t('08:00'), t('09:45'))).toBe(1.75);
    expect(
      conferirInicioUsoGas({
        inicio: t('08:00'),
        agora: t('09:00'),
        abertosMesmoGas: 0,
        continuaOutro: false,
      }),
    ).toEqual([]);
    expect(
      conferirInicioUsoGas({
        inicio: t('10:00'),
        agora: t('09:00'),
        abertosMesmoGas: 0,
        continuaOutro: false,
      })[0]!.campo,
    ).toBe('inicio');
    expect(
      conferirInicioUsoGas({
        inicio: t('08:00'),
        agora: t('09:00'),
        abertosMesmoGas: 1,
        continuaOutro: false,
      })[0]!.campo,
    ).toBe('gas');
    expect(
      conferirInicioUsoGas({
        inicio: t('08:00'),
        agora: t('09:00'),
        abertosMesmoGas: 1,
        continuaOutro: true,
      }),
    ).toEqual([]);
    expect(conferirFimUsoGas({ inicio: t('08:00'), fim: t('07:00'), agora: t('09:00') })[0]!.campo).toBe(
      'fim',
    );
  });
});

describe('regra de cobrança', () => {
  it('confere faixas contínuas, fração e desconto', () => {
    expect(conferirRegraCobrancaGas(base, O2)).toEqual([]);
    expect(conferirRegraCobrancaGas({ ...base, unidade: 'fracao_hora' }, O2)[0]!.campo).toBe(
      'fracaoMinimaMinutos',
    );
    const buraco = conferirRegraCobrancaGas(
      {
        ...base,
        faixas: [
          { horasInicio: 0, horasFim: 2, item: null, quantidade: 1 },
          { horasInicio: 3, horasFim: null, item: null, quantidade: 2 },
        ],
      },
      O2,
    );
    expect(buraco.map((p) => p.campo)).toEqual(['faixas.0']);
    expect(
      conferirRegraCobrancaGas(
        { ...base, simultaneos: [{ gas: AR, tratamento: 'cobra_com_desconto', percentual: null }] },
        O2,
      )[0]!.campo,
    ).toBe('simultaneos.0');
    expect(
      conferirRegraCobrancaGas(
        { ...base, simultaneos: [{ gas: O2, tratamento: 'nao_cobra', percentual: null }] },
        O2,
      ),
    ).toHaveLength(1);
  });

  it('a regra que vale é a mais específica vigente', () => {
    const rs = [
      { id: 1, fonte: null, plano: null, vigenciaInicio: '2026-01-01', vigenciaFim: null },
      { id: 2, fonte: 5, plano: null, vigenciaInicio: '2026-01-01', vigenciaFim: null },
      { id: 3, fonte: 5, plano: 7, vigenciaInicio: '2026-01-01', vigenciaFim: '2026-06-30' },
    ];
    expect(regraGasQueVale(rs, { fonte: 5, plano: 7 }, '2026-03-01')!.id).toBe(3);
    expect(regraGasQueVale(rs, { fonte: 5, plano: 7 }, '2026-11-20')!.id).toBe(2);
    expect(regraGasQueVale(rs, { fonte: 9, plano: null }, '2026-11-20')!.id).toBe(1);
    expect(regraGasQueVale(rs, { fonte: 9, plano: null }, '2025-11-20')).toBeNull();
  });
});

describe('cobrança por tempo', () => {
  const uso = (ini: string, fim: string | null, gas = O2, fluxo: number | null = null) => ({
    gas,
    inicio: t(ini),
    fim: fim ? t(fim) : null,
    fluxoLitrosMinuto: fluxo,
  });

  it('por hora arredonda para cima, soma os períodos e ignora o uso aberto', () => {
    const c = calcularCobrancaGas({
      regra: base,
      gas: O2,
      usos: [uso('08:00', '09:10'), uso('10:00', '10:30'), uso('11:00', null)],
    });
    expect([c.minutosUso, c.minutosCobraveis, c.quantidade]).toEqual([100, 100, 2]);
  });

  it('tolerância desconta e pode zerar', () => {
    expect(
      calcularCobrancaGas({
        regra: { ...base, toleranciaMinutos: 15 },
        gas: O2,
        usos: [uso('08:00', '08:10')],
      }).quantidade,
    ).toBe(0);
    expect(
      calcularCobrancaGas({
        regra: { ...base, toleranciaMinutos: 15, unidade: 'minuto' },
        gas: O2,
        usos: [uso('08:00', '09:00')],
      }).quantidade,
    ).toBe(45);
  });

  it('fração de hora, dia e litros', () => {
    const fr = { ...base, unidade: 'fracao_hora' as const, fracaoMinimaMinutos: 30 };
    expect(calcularCobrancaGas({ regra: fr, gas: O2, usos: [uso('08:00', '09:10')] }).quantidade).toBe(1.5);
    expect(
      calcularCobrancaGas({ regra: { ...base, unidade: 'dia' }, gas: O2, usos: [uso('08:00', '20:00')] })
        .quantidade,
    ).toBe(1);
    const litro = { ...base, unidade: 'litro' as const, arredondamento: 'nenhum' as const };
    expect(
      calcularCobrancaGas({ regra: litro, gas: O2, usos: [uso('08:00', '09:00', O2, 2.5)] }).quantidade,
    ).toBe(150);
    const m3 = { ...base, unidade: 'metro_cubico' as const, arredondamento: 'nenhum' as const };
    expect(
      calcularCobrancaGas({ regra: m3, gas: O2, usos: [uso('08:00', '09:00', O2, 2.5)] }).quantidade,
    ).toBe(0.15);
  });

  it('faixa decide quantidade e item', () => {
    const regra = {
      ...base,
      faixas: [
        { horasInicio: 0, horasFim: 6, item: null, quantidade: 1 },
        { horasInicio: 6, horasFim: null, item: 99, quantidade: 1 },
      ],
    };
    expect(calcularCobrancaGas({ regra, gas: O2, usos: [uso('08:00', '10:00')] })).toMatchObject({
      quantidade: 1,
      itemFaixa: null,
    });
    expect(calcularCobrancaGas({ regra, gas: O2, usos: [uso('08:00', '15:00')] })).toMatchObject({
      quantidade: 1,
      itemFaixa: 99,
    });
  });

  it('uso simultâneo: não cobra, desconto, padrão da regra e só o maior', () => {
    const usos = [uso('08:00', '10:00', O2, 5), uso('09:00', '10:00', AR, 2)];
    const minutos = (regra: RegraCobrancaGas, gas = O2) =>
      calcularCobrancaGas({ regra: { ...regra, unidade: 'minuto' }, gas, usos }).quantidade;
    expect(minutos(base)).toBe(120);
    expect(minutos({ ...base, simultaneos: [{ gas: AR, tratamento: 'nao_cobra', percentual: null }] })).toBe(
      60,
    );
    expect(
      minutos({ ...base, simultaneos: [{ gas: AR, tratamento: 'cobra_com_desconto', percentual: 50 }] }),
    ).toBe(90);
    expect(minutos({ ...base, percentualSimultaneo: 25 })).toBe(75);
    const maior = (gas: number) => ({
      ...base,
      simultaneos: [{ gas, tratamento: 'cobra_maior' as const, percentual: null }],
    });
    expect(minutos(maior(AR), O2)).toBe(120);
    expect(minutos(maior(O2), AR)).toBe(0);
  });
});

describe('lançamento pelo acumulado (achado da revisão: cobrança não depende do momento do clique)', () => {
  const d = (dia: number, hhmm: string) => new Date(`2026-11-${dia}T${hhmm}:00Z`);
  it('lançamentos diários somam o total arredondado uma vez só', () => {
    // Dois dias de 25 h 10 min cada (troca de fluxo encerra e abre outro uso): acumulado 50 h 20 min → 51 h.
    const u1 = { gas: O2, inicio: d(20, '00:00'), fim: d(21, '01:10'), fluxoLitrosMinuto: 2 };
    const u2 = { gas: O2, inicio: d(21, '01:10'), fim: d(22, '02:20'), fluxoLitrosMinuto: 2 };
    const dia1 = calcularCobrancaGas({ regra: base, gas: O2, usos: [u1] });
    const l1 = diferencaALancarGas({ cobranca: dia1, item: O2, lancados: [] });
    expect(l1).toMatchObject({ quantidade: 26, problemas: [] });
    const dia2 = calcularCobrancaGas({ regra: base, gas: O2, usos: [u1, u2] });
    const l2 = diferencaALancarGas({ cobranca: dia2, item: O2, lancados: [{ item: O2, quantidade: 26 }] });
    expect(l2).toMatchObject({ quantidade: 25, problemas: [] });
    expect(l1.quantidade + l2.quantidade).toBe(51); // não 52 (26 + 26)
  });
  it('a tolerância desconta uma vez só no acumulado', () => {
    const regra = { ...base, toleranciaMinutos: 30, arredondamento: 'nenhum' as const };
    const u1 = { gas: O2, inicio: t('08:00'), fim: t('09:00'), fluxoLitrosMinuto: null };
    const u2 = { gas: O2, inicio: t('09:00'), fim: t('10:00'), fluxoLitrosMinuto: null };
    const a = calcularCobrancaGas({ regra, gas: O2, usos: [u1] });
    expect(a.quantidade).toBe(0.5);
    const b = calcularCobrancaGas({ regra, gas: O2, usos: [u1, u2] });
    expect(
      diferencaALancarGas({ cobranca: b, item: O2, lancados: [{ item: O2, quantidade: 0.5 }] }).quantidade,
    ).toBe(1);
  });
  it('faixa que troca o item depois de lançado recusa (acerto por estorno)', () => {
    const regra: RegraCobrancaGas = {
      ...base,
      faixas: [
        { horasInicio: 0, horasFim: 2, item: 101, quantidade: 1 },
        { horasInicio: 2, horasFim: null, item: 102, quantidade: 1 },
      ],
    };
    const u1 = { gas: O2, inicio: t('08:00'), fim: t('09:00'), fluxoLitrosMinuto: null };
    const u2 = { gas: O2, inicio: t('09:00'), fim: t('11:00'), fluxoLitrosMinuto: null };
    const c = calcularCobrancaGas({ regra, gas: O2, usos: [u1, u2] });
    expect(c.itemFaixa).toBe(102); // 3 h caem uma vez na faixa acima de 2 h
    const r = diferencaALancarGas({ cobranca: c, item: 102, lancados: [{ item: 101, quantidade: 1 }] });
    expect(r.problemas.map((p) => p.campo)).toEqual(['faixa']);
  });
  it('acumulado menor que o já lançado recusa e não lança negativo', () => {
    const c = calcularCobrancaGas({
      regra: base,
      gas: O2,
      usos: [{ gas: O2, inicio: t('08:00'), fim: t('09:00'), fluxoLitrosMinuto: null }],
    });
    const r = diferencaALancarGas({ cobranca: c, item: O2, lancados: [{ item: O2, quantidade: 3 }] });
    expect(r.quantidade).toBe(0);
    expect(r.problemas.map((p) => p.campo)).toEqual(['quantidade']);
    expect(AR).not.toBe(O2);
  });
});
