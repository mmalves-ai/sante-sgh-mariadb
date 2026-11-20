// Regra 15 (ficha do M24): os medicamentos da prescrição viram as receitas da alta no receituário certo.
import { describe, expect, it } from 'vitest';
import { MAXIMO_ITENS_RECEITA, receitasDaAlta, type ItemParaReceita } from './receita-alta.js';

const item = (id: number, o: Partial<ItemParaReceita> = {}): ItemParaReceita => ({
  id,
  medicamento: true,
  ativo: true,
  descricao: `MEDICAMENTO SINTETICO ${id}`,
  dose: '1 comprimido',
  via: 'VO',
  frequencia: '08/08',
  controlado: null,
  antimicrobiano: false,
  ...o,
});

describe('receitasDaAlta (regra 15)', () => {
  it('uma receita por receituário: simples, antimicrobiano e controle especial por lista', () => {
    const r = receitasDaAlta([
      item(1),
      item(2, { antimicrobiano: true }),
      item(3, { controlado: 'C1' }),
      item(4, { controlado: 'b1' }),
      item(5, { controlado: 'C1' }),
      item(6),
    ]);
    expect(r.map((x) => [x.chave, x.tipo, x.itens.map((i) => i.item)])).toEqual([
      ['simples', 'simples', [1, 6]],
      ['antimicrobiano', 'antimicrobiano', [2]],
      ['controle-especial:B1', 'controle-especial', [4]],
      ['controle-especial:C1', 'controle-especial', [3, 5]],
    ]);
    expect(r[3]?.receituario).toBe('Receita de controle especial em duas vias');
    expect(r[3]?.aviso).toBeNull();
    // Lista B: notificação de receita (talão), avisada.
    expect(r[2]?.receituario).toContain('Notificação de receita B');
    expect(r[2]?.aviso).toContain('talão');
  });

  it('só medicamentos ativos; posologia da dose, via e frequência (sem horário)', () => {
    const r = receitasDaAlta([
      item(1, { medicamento: false }),
      item(2, { ativo: false }),
      item(3, { dose: null, via: null, frequencia: null }),
      item(4, { dose: '500 mg', via: 'VO', frequencia: '06/06' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.itens.map((i) => [i.item, i.posologia])).toEqual([
      [3, 'Conforme orientação'],
      [4, '500 mg, VO, 06/06'],
    ]);
  });

  it('controlado sem lista vai à receita de controle especial; acima de 20 itens, a receita se divide', () => {
    expect(receitasDaAlta([item(1, { controlado: '' })])[0]).toMatchObject({
      chave: 'controle-especial:sem-lista',
      receituario: 'Receita de controle especial',
    });
    const muitos = Array.from({ length: MAXIMO_ITENS_RECEITA + 3 }, (_, k) => item(k + 1));
    const r = receitasDaAlta(muitos);
    expect(r.map((x) => [x.chave, x.itens.length])).toEqual([
      ['simples', MAXIMO_ITENS_RECEITA],
      ['simples:2', 3],
    ]);
  });

  it('textos nos limites do receituário (nome 80, posologia 70)', () => {
    const r = receitasDaAlta([item(1, { descricao: 'X'.repeat(120), dose: 'Y'.repeat(90) })]);
    expect(r[0]?.itens[0]?.medicamento).toHaveLength(80);
    expect(r[0]?.itens[0]?.posologia.length).toBeLessThanOrEqual(70);
  });
});
