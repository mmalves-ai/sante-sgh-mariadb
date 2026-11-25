// Gases medicinais: consumo por setor (C1-050, 05-SUP linha 30): conferência do consumo sem paciente e apuração por
// setor e período com as parcelas (pacientes + setor sem paciente).
import { describe, expect, it } from 'vitest';
import {
  apurarConsumoGasPorSetor,
  conferirConsumoGasSetor,
  conferirVinculoConsumoGasSetor,
  litrosPeloFluxo,
  type RegistroConsumoGas,
} from './gas-consumo-setor.js';

const t = (hhmm: string, dia = '20') => new Date(`2026-11-${dia}T${hhmm}:00Z`);
const agora = t('23:00');

describe('consumo do setor sem paciente', () => {
  it('volume pelo fluxo × minutos', () => {
    expect(litrosPeloFluxo(2, t('08:00'), t('09:30'))).toBe(180);
    expect(litrosPeloFluxo(2, t('09:30'), t('08:00'))).toBe(0);
  });

  it('confere setor, gás, fluxo ou volume, início e fim', () => {
    const base = {
      setor: 5,
      gas: 7,
      fluxoLitrosMinuto: 3,
      quantidadeLitros: null,
      inicio: t('08:00'),
      fim: null,
      agora,
    };
    expect(conferirConsumoGasSetor(base)).toEqual([]);
    expect(conferirConsumoGasSetor({ ...base, setor: null, gas: null }).map((p) => p.campo)).toEqual([
      'setor',
      'gas',
    ]);
    expect(conferirConsumoGasSetor({ ...base, fluxoLitrosMinuto: null }).map((p) => p.mensagem)).toEqual([
      'Informe o fluxo (L/min) ou o volume medido (L).',
    ]);
    expect(conferirConsumoGasSetor({ ...base, fluxoLitrosMinuto: 0 }).map((p) => p.campo)).toEqual(['fluxo']);
    expect(
      conferirConsumoGasSetor({ ...base, fluxoLitrosMinuto: null, quantidadeLitros: 500 }).map(
        (p) => p.campo,
      ),
    ).toEqual(['fim']);
    expect(
      conferirConsumoGasSetor({ ...base, fluxoLitrosMinuto: null, quantidadeLitros: 500, fim: t('09:00') }),
    ).toEqual([]);
    expect(conferirConsumoGasSetor({ ...base, fim: t('07:00') }).map((p) => p.campo)).toEqual(['fim']);
    expect(
      conferirConsumoGasSetor({ ...base, inicio: t('23:30'), fim: t('23:40') }).map((p) => p.campo),
    ).toEqual(['inicio', 'fim']);
  });
});

describe('apuração por setor e período', () => {
  const reg = (x: Partial<RegistroConsumoGas>): RegistroConsumoGas => ({
    origem: 'paciente',
    setor: 1,
    setorNome: 'UTI adulto',
    gas: 10,
    gasNome: 'Oxigênio',
    inicio: t('08:00'),
    fim: t('10:00'),
    fluxoLitrosMinuto: 2,
    quantidadeLitros: null,
    ...x,
  });

  it('soma pacientes e setor sem paciente, com as parcelas', () => {
    const r = apurarConsumoGasPorSetor({
      de: t('00:00'),
      ate: t('00:00', '21'),
      agora,
      registros: [
        reg({}), // 2 h × 2 L/min = 240 L
        reg({ fluxoLitrosMinuto: null }), // 2 h, sem volume
        reg({
          origem: 'setor',
          fluxoLitrosMinuto: null,
          quantidadeLitros: 300,
          inicio: t('12:00'),
          fim: t('13:00'),
        }),
        reg({ origem: 'setor', inicio: t('14:00'), fim: t('14:30'), fluxoLitrosMinuto: 4 }), // 120 L
        reg({
          setor: 2,
          setorNome: 'Centro cirúrgico',
          inicio: t('09:00'),
          fim: t('09:15'),
          fluxoLitrosMinuto: 10,
        }),
      ],
    });
    expect(r.map((g) => g.setorNome)).toEqual(['Centro cirúrgico', 'UTI adulto']);
    const uti = r[1]!;
    expect(uti.pacientes).toEqual({ registros: 2, horas: 4, litros: 240, semVolume: 1 });
    expect(uti.setorSemPaciente).toEqual({ registros: 2, horas: 1.5, litros: 420, semVolume: 0 });
    expect(uti.total).toEqual({ registros: 4, horas: 5.5, litros: 660, semVolume: 1 });
    expect(uti.total.litros).toBe(uti.pacientes.litros + uti.setorSemPaciente.litros);
    expect(r[0]!.total).toEqual({ registros: 1, horas: 0.25, litros: 150, semVolume: 0 });
  });

  it('recorta ao período, rateia o volume medido e conta o uso aberto até agora', () => {
    const r = apurarConsumoGasPorSetor({
      de: t('09:00'),
      ate: t('12:00'),
      agora: t('11:00'),
      registros: [
        reg({}), // 09:00-10:00 dentro: 1 h, 120 L
        reg({
          origem: 'setor',
          fluxoLitrosMinuto: null,
          quantidadeLitros: 400,
          inicio: t('08:00'),
          fim: t('12:00'),
        }),
        reg({ origem: 'setor', fim: null, inicio: t('10:30'), fluxoLitrosMinuto: 1 }), // aberto: 30 min, 30 L
        reg({ inicio: t('12:00'), fim: t('13:00') }), // fora (borda final exclusiva)
        reg({ inicio: t('06:00'), fim: t('09:00') }), // fora (termina na borda inicial)
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.pacientes).toEqual({ registros: 1, horas: 1, litros: 120, semVolume: 0 });
    // 400 L em 4 h, 3 h dentro do período (rateio pelo tempo) + 30 L do aberto.
    expect(r[0]!.setorSemPaciente).toEqual({ registros: 2, horas: 3.5, litros: 330, semVolume: 0 });
  });

  it('agrupa o uso sem setor informado à parte', () => {
    const r = apurarConsumoGasPorSetor({
      de: t('00:00'),
      ate: t('00:00', '21'),
      agora,
      registros: [reg({ setor: null, setorNome: null }), reg({ gas: 11, gasNome: 'Ar comprimido' })],
    });
    expect(r.map((g) => [g.setor, g.gasNome])).toEqual([
      [1, 'Ar comprimido'],
      [null, 'Oxigênio'],
    ]);
  });
});

describe('vínculo do consumo do setor com o ponto e o leito', () => {
  const ponto = { setor: 5, leito: 40, ativo: true };
  const vinculo = (x: Partial<Parameters<typeof conferirVinculoConsumoGasSetor>[0]>) =>
    conferirVinculoConsumoGasSetor({ setor: 5, ponto: null, leito: null, setorDoLeito: null, ...x });

  it('aceita ponto e leito do setor e herda o leito do ponto de leito', () => {
    expect(vinculo({})).toEqual({ problemas: [], leito: null });
    expect(vinculo({ ponto })).toEqual({ problemas: [], leito: 40 });
    expect(vinculo({ ponto, leito: 40, setorDoLeito: 5 })).toEqual({ problemas: [], leito: 40 });
    expect(vinculo({ leito: 41, setorDoLeito: 5 })).toEqual({ problemas: [], leito: 41 });
  });

  it('recusa ponto de outro setor ou inativo, leito de outro setor, sem setor ou diferente do ponto', () => {
    const campos = (x: Parameters<typeof vinculo>[0]) => vinculo(x).problemas.map((q) => q.campo);
    expect(campos({ ponto: { ...ponto, setor: 6 } })).toEqual(['ponto']);
    expect(campos({ ponto: { ...ponto, ativo: false } })).toEqual(['ponto']);
    expect(campos({ leito: 41, setorDoLeito: 6 })).toEqual(['leito']);
    expect(campos({ leito: 41, setorDoLeito: null })).toEqual(['leito']);
    expect(campos({ ponto, leito: 41, setorDoLeito: 5 })).toEqual(['leito']);
  });
});
