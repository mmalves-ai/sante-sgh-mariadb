// Regra 4 do M24: duplicidade pelo critério do legado (1 medicamento, 2 princípio ativo) com o parâmetro que consiste.
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { alertasDuplicidade } from './duplicidade.js';

const a = produto({ produto: 1, principiosAtivos: [100] });
const aOutraMarca = produto({ produto: 2, principiosAtivos: [100] });
const b = produto({ produto: 3, principiosAtivos: [200] });

describe('duplicidade', () => {
  it('mesmo medicamento no rascunho', () => {
    const i1 = item('i1', [{ produto: a }]);
    const i2 = item('i2', [{ produto: a }]);
    const r = alertasDuplicidade(i1, [i1, i2], contexto());
    expect(r.map((x) => x.titulo)).toEqual(['Medicamento em duplicidade']);
  });
  it('mesmo princípio ativo em outra prescrição ativa do período', () => {
    const i1 = item('i1', [{ produto: a }]);
    const ativo = item('x', [{ produto: aOutraMarca }], { existente: true });
    const r = alertasDuplicidade(i1, [i1], contexto({ ativos: [ativo] }));
    expect(r[0]?.titulo).toBe('Princípio ativo em duplicidade');
    expect(r[0]?.detalhe).toContain('outra prescrição ativa');
  });
  it('critério só por medicamento não acusa o mesmo princípio de outra marca', () => {
    const i1 = item('i1', [{ produto: a }]);
    const i2 = item('i2', [{ produto: aOutraMarca }]);
    const ctx = contexto({ duplicidade: { porMedicamento: true, porPrincipio: false, consistir: true } });
    expect(alertasDuplicidade(i1, [i1, i2], ctx)).toEqual([]);
  });
  it('parâmetro que não consiste desliga a duplicidade', () => {
    const i1 = item('i1', [{ produto: a }]);
    const i2 = item('i2', [{ produto: a }]);
    const ctx = contexto({ duplicidade: { porMedicamento: true, porPrincipio: true, consistir: false } });
    expect(alertasDuplicidade(i1, [i1, i2], ctx)).toEqual([]);
  });
  it('itens diferentes não acusam; o mesmo par só uma vez', () => {
    const i1 = item('i1', [{ produto: a }]);
    expect(alertasDuplicidade(i1, [i1, item('i2', [{ produto: b }])], contexto())).toEqual([]);
    const dup = item('i2', [{ produto: a }, { produto: a }]);
    expect(alertasDuplicidade(i1, [i1, dup], contexto())).toHaveLength(1);
  });
});
