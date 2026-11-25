import { describe, expect, it } from 'vitest';
import {
  conferirRegraPlantao,
  type PlantaoParaRegra,
  type RegraPlantaoLida,
  regraPlantaoAplicavel,
  tipoDiaPlantao,
  valorPelaRegraPlantao,
} from './regra-plantao.js';

const regra = (x: Partial<RegraPlantaoLida> = {}): RegraPlantaoLida => ({
  id: 1,
  descricao: 'UTI',
  profissional: null,
  escala: null,
  setor: 10,
  especialidade: null,
  diaSemana: null,
  forma: 'por_plantao',
  horasPlantao: 12,
  valorPadrao: 1200,
  valorFimSemana: null,
  valorFeriado: null,
  percentualFeriado: null,
  fator: null,
  valorHoraExtraAntes: null,
  percentualHoraExtraAntes: null,
  valorHoraExtraDepois: null,
  percentualHoraExtraDepois: null,
  toleranciaMinutos: 15,
  inicio: '2026-01-01',
  fim: null,
  ...x,
});

// 2026-11-25 é quarta; 2026-11-28 é sábado.
const plantao = (x: Partial<PlantaoParaRegra> = {}): PlantaoParaRegra => ({
  profissional: 7,
  escala: 3,
  setor: 10,
  especialidade: 5,
  previstoInicio: '2026-11-25T07:00',
  previstoFim: '2026-11-25T19:00',
  realInicio: '2026-11-25T07:00',
  realFim: '2026-11-25T19:00',
  ...x,
});
const sem = new Set<string>();

describe('regra de plantão do repasse', () => {
  it('escolhe a mais específica: profissional vence escala, que vence setor', () => {
    const rs = [
      regra({ id: 1 }),
      regra({ id: 2, escala: 3 }),
      regra({ id: 3, profissional: 7, setor: null }),
    ];
    expect(regraPlantaoAplicavel(rs, plantao())?.id).toBe(3);
    expect(regraPlantaoAplicavel(rs.slice(0, 2), plantao())?.id).toBe(2);
  });

  it('ignora a regra fora da vigência, de outro recorte ou de outro dia da semana', () => {
    const rs = [
      regra({ id: 1, fim: '2026-10-31' }),
      regra({ id: 2, setor: 99 }),
      regra({ id: 3, diaSemana: 7 }),
      regra({ id: 4, especialidade: 6 }),
    ];
    expect(regraPlantaoAplicavel(rs, plantao())).toBeNull();
    expect(regraPlantaoAplicavel([regra({ id: 3, diaSemana: 4 })], plantao())?.id).toBe(3);
  });

  it('empate: a de vigência mais recente', () => {
    const rs = [regra({ id: 9, inicio: '2026-01-01' }), regra({ id: 2, inicio: '2026-06-01' })];
    expect(regraPlantaoAplicavel(rs, plantao())?.id).toBe(2);
  });

  it('tipo de dia: feriado, fim de semana e útil', () => {
    expect(tipoDiaPlantao('2026-11-25', sem)).toBe('util');
    expect(tipoDiaPlantao('2026-11-28', sem)).toBe('fim_semana');
    expect(tipoDiaPlantao('2026-11-25', new Set(['2026-11-25']))).toBe('feriado');
  });

  it('por plantão em dia útil, dentro da tolerância, paga o valor cheio', () => {
    const v = valorPelaRegraPlantao(regra(), plantao({ realInicio: '2026-11-25T07:10' }), sem);
    expect(v.valor).toBe(1200);
    expect(v.tipoDia).toBe('util');
    expect(v.parcelas).toContain('total R$ 1.200,00');
  });

  it('fim de semana com fator e hora extra depois pelo percentual', () => {
    const v = valorPelaRegraPlantao(
      regra({ valorFimSemana: 1500, fator: 1.2, percentualHoraExtraDepois: 50 }),
      plantao({
        previstoInicio: '2026-11-28T07:00',
        previstoFim: '2026-11-28T19:00',
        realInicio: '2026-11-28T07:00',
        realFim: '2026-11-28T20:00',
      }),
      sem,
    );
    // 1500 × 1,2 = 1800; hora do dia 150; extra 1 h × 225 = 225.
    expect(v.valor).toBe(2025);
    expect(v.parcelas).toContain('hora extra depois do fim 1 h × R$ 225,00/h = R$ 225,00');
  });

  it('feriado pelo percentual sobre o padrão; saída antes além da tolerância desconta na proporção', () => {
    const v = valorPelaRegraPlantao(
      regra({ percentualFeriado: 100 }),
      plantao({ realFim: '2026-11-25T13:00' }),
      new Set(['2026-11-25']),
    );
    // 1200 + 100% = 2400; 6 h de 12 h = 1200.
    expect(v.tipoDia).toBe('feriado');
    expect(v.valor).toBe(1200);
  });

  it('por hora: horas dentro do previsto e hora extra antes pelo valor próprio', () => {
    const v = valorPelaRegraPlantao(
      regra({ forma: 'por_hora', horasPlantao: null, valorPadrao: 100, valorHoraExtraAntes: 130 }),
      plantao({ realInicio: '2026-11-25T06:00', realFim: '2026-11-25T17:00' }),
      sem,
    );
    // 10 h × 100 = 1000 (saída 2 h antes) + 1 h × 130.
    expect(v.valor).toBe(1130);
  });

  it('hora extra sem valor nem percentual não é paga', () => {
    const v = valorPelaRegraPlantao(regra(), plantao({ realFim: '2026-11-25T21:00' }), sem);
    expect(v.valor).toBe(1200);
  });

  it('confere a regra nova', () => {
    const base: Omit<RegraPlantaoLida, 'id'> = regra();
    expect(conferirRegraPlantao(base)).toBeNull();
    expect(conferirRegraPlantao({ ...base, setor: null })?.codigo).toBe('recorte-obrigatorio');
    expect(conferirRegraPlantao({ ...base, horasPlantao: null })?.codigo).toBe('horas-obrigatorias');
    expect(conferirRegraPlantao({ ...base, valorPadrao: 0 })?.codigo).toBe('valor-invalido');
    expect(conferirRegraPlantao({ ...base, fator: 0 })?.codigo).toBe('fator-invalido');
    expect(conferirRegraPlantao({ ...base, fim: '2025-12-31' })?.codigo).toBe('periodo-invalido');
  });
});
