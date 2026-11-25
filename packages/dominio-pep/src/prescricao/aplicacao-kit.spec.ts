import { describe, expect, it } from 'vitest';
import { aplicacaoDoKit, type ItemKitParaAplicar, type KitParaAplicar } from './aplicacao-kit.js';

const item = (
  sequencia: number,
  papel: ItemKitParaAplicar['papel'],
  extra: Partial<ItemKitParaAplicar> = {},
) => ({
  sequencia,
  item: 100 + sequencia,
  papel,
  quantidade: 1,
  unidade: 7,
  via: null,
  frequencia: null,
  ...extra,
});
const kit = (extra: Partial<KitParaAplicar> = {}): KitParaAplicar => ({
  id: 9,
  tipoKit: 'medicamento',
  ativo: true,
  via: 3,
  frequencia: 4,
  velocidade: null,
  unidadeInfusao: null,
  itens: [],
  ...extra,
});

describe('aplicação do kit na prescrição', () => {
  it('kit de medicamento: cada item vira um item, o principal primeiro, via e frequência do cabeçalho quando faltam', () => {
    const a = aplicacaoDoKit(kit({ itens: [item(1, 'componente', { via: 5 }), item(2, 'principal')] }));
    expect(a.problema).toBeNull();
    expect(a.forma).toBe('itens');
    expect(a.linhas.map((l) => [l.sequencia, l.papel, l.via, l.frequencia, l.principal])).toEqual([
      [2, 'principal', 3, 4, false],
      [1, 'componente', 5, 4, false],
    ]);
  });

  it('kit de solução: uma solução com o principal, o diluente e os componentes, via do cabeçalho', () => {
    const a = aplicacaoDoKit(
      kit({
        tipoKit: 'solucao',
        velocidade: 21,
        unidadeInfusao: 8,
        itens: [
          item(1, 'diluente', { quantidade: 250, via: 9 }),
          item(2, 'componente'),
          item(3, 'principal'),
        ],
      }),
    );
    expect(a.forma).toBe('solucao');
    expect(a.linhas.map((l) => [l.papel, l.principal, l.via])).toEqual([
      ['principal', true, 3],
      ['diluente', false, 3],
      ['componente', false, 3],
    ]);
  });

  it('kit de solução sem principal: o primeiro componente que entra vira o principal', () => {
    const a = aplicacaoDoKit(
      kit({ tipoKit: 'solucao', itens: [item(1, 'componente'), item(2, 'diluente')] }),
    );
    expect(a.linhas.filter((l) => l.principal).map((l) => l.papel)).toEqual(['diluente']);
  });

  it('material e item sem produto ficam para revisar, sem entrar', () => {
    const a = aplicacaoDoKit(
      kit({ itens: [item(1, 'principal'), item(2, 'material'), item(3, 'componente', { item: null })] }),
    );
    expect(a.linhas.map((l) => l.sequencia)).toEqual([1]);
    expect(a.revisar).toEqual([3, 2]);
  });

  it('kit inativo, sem item com produto ou solução sem diluente não se aplica', () => {
    expect(aplicacaoDoKit(kit({ ativo: false, itens: [item(1, 'principal')] })).problema).toBe('kit-inativo');
    expect(aplicacaoDoKit(kit({ itens: [item(1, 'material')] })).problema).toBe('kit-sem-itens');
    const s = aplicacaoDoKit(kit({ tipoKit: 'solucao', itens: [item(1, 'principal')] }));
    expect([s.problema, s.linhas.length]).toEqual(['solucao-sem-diluente', 0]);
  });
});
