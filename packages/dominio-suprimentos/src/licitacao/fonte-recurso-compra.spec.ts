// C2-017 (09-AREA linha 81): a fonte de recurso por item da solicitação de compra pública (Lei 14.133, art. 150).
import {
  conferirFontesSolicitacao,
  fontePrincipal,
  type ItemComFonte,
} from '@sgh/contratos/regras-suprimentos';
import { describe, expect, it } from 'vitest';

const ativas = new Set([1, 2, 3]);
const codigos = (itens: readonly ItemComFonte[]) =>
  conferirFontesSolicitacao(itens, ativas).map((r) => r.codigo);
const item = (x: Partial<ItemComFonte> = {}): ItemComFonte => ({
  quantidadeSolicitada: 10,
  valorUnitarioEstimado: 5,
  fontes: [{ origem: 1, quantidade: null, percentual: 100 }],
  ...x,
});

describe('fonte de recurso da solicitação de compra', () => {
  it('aceita 100% numa fonte, percentuais que fecham 100 e quantidades que fecham a solicitada', () => {
    expect(codigos([item()])).toEqual([]);
    expect(
      codigos([
        item({
          fontes: [
            { origem: 1, quantidade: null, percentual: 33.3333 },
            { origem: 2, quantidade: null, percentual: 66.6667 },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      codigos([
        item({
          fontes: [
            { origem: 1, quantidade: 4, percentual: null },
            { origem: 2, quantidade: 6, percentual: null },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it('recusa sem item, item sem fonte, fonte repetida, inativa, parcela dupla ou vazia, critério misto e soma errada', () => {
    expect(codigos([])).toEqual(['solicitacao-sem-item']);
    expect(codigos([item({ fontes: [] })])).toEqual(['item-sem-fonte']);
    expect(
      codigos([
        item({
          fontes: [
            { origem: 1, quantidade: null, percentual: 50 },
            { origem: 1, quantidade: null, percentual: 50 },
          ],
        }),
      ]),
    ).toEqual(['fonte-repetida']);
    expect(codigos([item({ fontes: [{ origem: 9, quantidade: null, percentual: 100 }] })])).toEqual([
      'fonte-inativa',
    ]);
    expect(codigos([item({ fontes: [{ origem: 1, quantidade: 10, percentual: 100 }] })])).toContain(
      'fonte-parcela-invalida',
    );
    expect(codigos([item({ fontes: [{ origem: 1, quantidade: null, percentual: null }] })])).toContain(
      'fonte-parcela-invalida',
    );
    expect(
      codigos([
        item({
          fontes: [
            { origem: 1, quantidade: 5, percentual: null },
            { origem: 2, quantidade: null, percentual: 50 },
          ],
        }),
      ]),
    ).toEqual(['fonte-criterio-misto']);
    expect(codigos([item({ fontes: [{ origem: 1, quantidade: null, percentual: 90 }] })])).toEqual([
      'fonte-soma-percentual',
    ]);
    expect(codigos([item({ fontes: [{ origem: 1, quantidade: 9, percentual: null }] })])).toEqual([
      'fonte-soma-quantidade',
    ]);
  });

  it('a principal é a de maior valor estimado; sem valor, a de maior quantidade; empate, a primeira', () => {
    const itens = [
      item({
        fontes: [
          { origem: 1, quantidade: null, percentual: 70 },
          { origem: 2, quantidade: null, percentual: 30 },
        ],
      }),
      item({
        quantidadeSolicitada: 4,
        valorUnitarioEstimado: 2,
        fontes: [{ origem: 2, quantidade: 4, percentual: null }],
      }),
    ];
    expect(fontePrincipal(itens)).toBe(1);
    expect(
      fontePrincipal([
        item({ valorUnitarioEstimado: 1 }),
        item({ valorUnitarioEstimado: 100, fontes: [{ origem: 3, quantidade: 10, percentual: null }] }),
      ]),
    ).toBe(3);
    expect(
      fontePrincipal([
        item({ valorUnitarioEstimado: null, quantidadeSolicitada: 2 }),
        item({ valorUnitarioEstimado: null, fontes: [{ origem: 2, quantidade: 10, percentual: null }] }),
      ]),
    ).toBe(2);
    expect(
      fontePrincipal([
        item({
          fontes: [
            { origem: 2, quantidade: null, percentual: 50 },
            { origem: 1, quantidade: null, percentual: 50 },
          ],
        }),
      ]),
    ).toBe(2);
    expect(fontePrincipal([])).toBeNull();
  });
});
