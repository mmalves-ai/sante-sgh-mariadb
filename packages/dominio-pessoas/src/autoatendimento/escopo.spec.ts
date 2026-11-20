// Regra 21 (ficha do M52): o autosserviço vê só o próprio; o holerite só com a folha no Sante SGH (M53).
import { describe, expect, it } from 'vitest';
import { escopoProprio, holeriteDisponivel } from './escopo.js';

describe('autosserviço: escopo do próprio (regra 21)', () => {
  const doLogin = [
    { id: 3, ativo: false },
    { id: 8, ativo: true },
    { id: 5, ativo: true },
  ];

  it('sem pedido: o vínculo ativo mais recente; sem ativo, o mais recente; sem vínculo, nenhum', () => {
    expect(escopoProprio(doLogin, null)).toEqual({ vinculo: 8, recusa: null });
    expect(
      escopoProprio(
        [
          { id: 3, ativo: false },
          { id: 4, ativo: false },
        ],
        null,
      ),
    ).toEqual({
      vinculo: 4,
      recusa: null,
    });
    expect(escopoProprio([], null)).toEqual({ vinculo: null, recusa: null });
  });

  it('o pedido de um vínculo do login vale; o de outra pessoa é recusado (nunca cai no primeiro)', () => {
    expect(escopoProprio(doLogin, 3)).toEqual({ vinculo: 3, recusa: null });
    const r = escopoProprio(doLogin, 99);
    expect(r.vinculo).toBeNull();
    expect(r.recusa?.codigo).toBe('so-o-proprio');
    expect(escopoProprio([], 1).recusa?.codigo).toBe('so-o-proprio');
  });

  it('holerite e férias: só com a folha no Sante SGH', () => {
    expect(holeriteDisponivel(true)).toBe('disponivel');
    expect(holeriteDisponivel(false)).toBe('folha-fora');
  });
});
