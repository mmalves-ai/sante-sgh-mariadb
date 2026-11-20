// Regra 9 do M45: Fugulin por turno (12 áreas de 1 a 4; COFEN 543/2017: horas de enfermagem por categoria) e a carga
// da unidade comparada com a equipe informada.
import { AREAS_FUGULIN } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { cargaDaUnidade, classificar, classificarFugulin, compararComEquipe } from './classificacao.js';

const todas = (v: number) => Object.fromEntries(AREAS_FUGULIN.map((a) => [a.codigo, v]));

describe('Fugulin', () => {
  it('12 a 48: mínimos, intermediários, alta dependência, semi-intensivos e intensivos com as horas', () => {
    const c = (respostas: Record<string, number>) => {
      const r = classificarFugulin(respostas);
      return r.ok ? [r.total, r.categoria, r.horas24h] : r.codigo;
    };
    expect(c(todas(1))).toEqual([12, 'minimos', 4]);
    expect(c({ ...todas(1), estadoMental: 4, oxigenacao: 3 })).toEqual([17, 'minimos', 4]);
    expect(c({ ...todas(1), estadoMental: 4, oxigenacao: 4 })).toEqual([18, 'intermediarios', 6]);
    expect(c(todas(2))).toEqual([24, 'altaDependencia', 10]);
    expect(c({ ...todas(2), estadoMental: 4, oxigenacao: 4, sinaisVitais: 4, motilidade: 3 })).toEqual([
      31,
      'semiIntensivos',
      10,
    ]);
    expect(c(todas(3))).toEqual([36, 'intensivos', 18]);
    expect(c(todas(4))).toEqual([48, 'intensivos', 18]);
  });
  it('área faltando ou fora de 1 a 4 é recusada', () => {
    const falta: Record<string, number> = todas(2);
    delete falta['curativo'];
    expect(classificarFugulin(falta)).toMatchObject({
      ok: false,
      codigo: 'item-faltando',
      itens: ['curativo'],
    });
    expect(classificarFugulin({ ...todas(2), curativo: 5 })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
    expect(classificarFugulin({ ...todas(2), outra: 1 })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
    expect(classificar('fugulin', todas(1))).toMatchObject({ ok: true, instrumento: 'fugulin' });
  });
  it('a carga da unidade por categoria e a comparação com a equipe (com a conta impressa)', () => {
    const carga = cargaDaUnidade([
      { instrumento: 'fugulin', categoria: 'minimos', total: 12 },
      { instrumento: 'fugulin', categoria: 'minimos', total: 14 },
      { instrumento: 'fugulin', categoria: 'intensivos', total: 40 },
      { instrumento: 'nas', categoria: 'nas', total: 61.2 },
      { instrumento: 'nas', categoria: 'nas', total: 70.4 },
    ]);
    expect(carga.fugulin.porCategoria.find((c) => c.codigo === 'minimos')).toMatchObject({
      pacientes: 2,
      horas: 8,
    });
    expect(carga.fugulin.horas24h).toBe(26);
    expect(carga.nas).toEqual({ pacientes: 2, soma: 131.6, profissionaisPorTurno: 1.32 });
    const cmp = compararComEquipe({ horasNecessarias24h: 26, profissionais: 1, horasDoTurno: 12 });
    expect(cmp).toMatchObject({ necessariasNoTurno: 13, disponiveis: 12, diferenca: -1, suficiente: false });
    expect(cmp.conta).toBe(
      '1 profissionais × 12 h = 12 h disponíveis; 26 h em 24 h × 12 ÷ 24 = 13 h necessárias no turno',
    );
    expect(
      compararComEquipe({ horasNecessarias24h: 26, profissionais: 2, horasDoTurno: 12 }).suficiente,
    ).toBe(true);
  });
});
