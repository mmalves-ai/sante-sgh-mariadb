// Regra 2 do M45: Braden ≤ 18 é risco de lesão por pressão; faixas em regra versionada; as do formulário em uso (6-11,
// 12-14, 15-16) ficam como versão histórica. Regra 3: o total é sempre calculado dos itens.
import { describe, expect, it } from 'vitest';
import { calcularEscala } from './escalas.js';
import { BRADEN_HISTORICA_FORMULARIO, faixaDe, REGRAS_PADRAO } from './regras.js';

const TODOS = (v: number, friccao = Math.min(v, 3)) => ({
  percepcao: v,
  umidade: v,
  atividade: v,
  mobilidade: v,
  nutricao: v,
  friccao,
});

describe('Braden', () => {
  it('total de 6 a 23 calculado dos itens; 19 ou mais sem risco; 18 é risco', () => {
    const minimo = calcularEscala('braden', TODOS(1));
    expect(minimo).toMatchObject({ ok: true, total: 6, gatilho: 'prevencao' });
    const maximo = calcularEscala('braden', TODOS(4));
    expect(maximo).toMatchObject({ ok: true, total: 23, gatilho: 'nenhum' });
    const dezoito = calcularEscala('braden', { ...TODOS(3), percepcao: 4, umidade: 4, nutricao: 2 }); // 4+4+3+3+2+3
    expect(dezoito).toMatchObject({ ok: true, total: 19 });
    const r = calcularEscala('braden', { ...TODOS(3), nutricao: 2, percepcao: 4 }); // 4+3+3+3+2+3 = 18
    expect(r.ok && r.total).toBe(18);
    expect(r.ok && r.faixa.codigo).toBe('baixo');
    expect(r.ok && r.faixa.risco).toBe(true);
    expect(r.ok && r.conduta).toMatch(/lesão por pressão/);
  });
  it('as faixas padrão: muito alto, alto, moderado, baixo e sem risco', () => {
    const f = REGRAS_PADRAO.braden.faixas;
    expect([9, 10, 12, 13, 14, 15, 18, 19].map((t) => faixaDe(f, t)?.codigo)).toEqual([
      'muitoAlto',
      'alto',
      'alto',
      'moderado',
      'moderado',
      'baixo',
      'baixo',
      'semRisco',
    ]);
  });
  it('a versão histórica do formulário: 6-11 alto, 12-14 moderado, 15-16 baixo (só leitura)', () => {
    const f = BRADEN_HISTORICA_FORMULARIO.faixas;
    expect([6, 11, 12, 14, 15, 16, 17].map((t) => faixaDe(f, t)?.codigo)).toEqual([
      'alto',
      'alto',
      'moderado',
      'moderado',
      'baixo',
      'baixo',
      'semRisco',
    ]);
    expect(BRADEN_HISTORICA_FORMULARIO.historica).toBe(true);
  });
  it('item que falta e ponto fora das opções são recusados (regra 15)', () => {
    const semFriccao: Record<string, number> = TODOS(2);
    delete semFriccao['friccao'];
    expect(calcularEscala('braden', semFriccao)).toMatchObject({
      ok: false,
      codigo: 'item-faltando',
      itens: ['friccao'],
    });
    expect(calcularEscala('braden', { ...TODOS(2), friccao: 4 })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
      itens: ['friccao'],
    });
    expect(calcularEscala('braden', { ...TODOS(2), outro: 1 })).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
  });
});
