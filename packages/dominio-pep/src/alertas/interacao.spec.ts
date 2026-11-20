// Regra 8 do M24: interação só com a base de terceiros (aqui sintética); sem ela, nenhuma interação é inventada.
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { alertasInteracao } from './interacao.js';
import { avaliarAlertas } from './motor.js';

const varfarina = produto({ produto: 1, principiosAtivos: [11] });
const aas = produto({ produto: 2, principiosAtivos: [22] });
const outro = produto({ produto: 3, principiosAtivos: [33] });
const base = [
  { a: 11, b: 22, gravidade: 'grave' as const, efeito: 'risco de sangramento' },
  { a: 33, b: 11, gravidade: 'contraindicada' as const, efeito: 'efeito sintético' },
  { a: 22, b: 33, gravidade: 'moderada' as const, efeito: 'efeito sintético moderado' },
];

describe('interação (base sintética)', () => {
  it('par da base em qualquer ordem, com o rascunho e com os ativos', () => {
    const i1 = item('i1', [{ produto: varfarina }]);
    const i2 = item('i2', [{ produto: aas }]);
    expect(alertasInteracao(i1, [i1, i2], contexto({ interacoes: base }))[0]?.titulo).toBe('Interação grave');
    const ativo = item('x', [{ produto: outro }], { existente: true });
    expect(alertasInteracao(i1, [i1], contexto({ interacoes: base, ativos: [ativo] }))[0]?.gravidade).toBe(
      'contraindicada',
    );
  });
  it('sem a base (null) ou sem par, nada', () => {
    const i1 = item('i1', [{ produto: varfarina }]);
    const i2 = item('i2', [{ produto: aas }]);
    expect(alertasInteracao(i1, [i1, i2], contexto({ interacoes: null }))).toEqual([]);
    expect(alertasInteracao(i1, [i1, i2], contexto({ interacoes: [] }))).toEqual([]);
  });
  it('nível pela gravidade: contraindicada bloqueia, grave justifica, moderada avisa', () => {
    const itens = [
      item('i1', [{ produto: varfarina }]),
      item('i2', [{ produto: aas }]),
      item('i3', [{ produto: outro }]),
    ];
    const a = avaliarAlertas({
      itens,
      ctx: contexto({
        interacoes: base,
        duplicidade: { porMedicamento: false, porPrincipio: false, consistir: false },
      }),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    const niveis = new Set(a.filter((x) => x.tipo === 'interacao').map((x) => x.nivel));
    expect(niveis).toEqual(new Set(['bloqueio', 'justificar', 'aviso']));
  });
});
