// Regra 11 (ficha do M28): linha mestre FORN=0; propostas FORN>0; vencedor nominal; rateio; vazio legítimo.
import { describe, expect, it } from 'vitest';
import {
  conferirItensPedido,
  ehMestre,
  exigeJustificativa,
  menorProposta,
  planejarVencedor,
  valorPelosVencedores,
  vencedoresDoItem,
} from '@sgh/contratos/regras-suprimentos';

const p = (id: number, fornecedor: number, valorUnitario: number, vencedor = '') => ({
  id,
  item: 50,
  seq: 1,
  fornecedor,
  valorUnitario,
  quantidade: 10,
  vencedor,
});
const propostas = [
  p(1, 0, 0, 'F'),
  p(2, 11, 5),
  p(3, 12, 4, 'F'),
  p(4, 13, 6, 'T'),
  { ...p(9, 14, 1), item: 51 },
];

describe('cotação (regra 11)', () => {
  it('vencedor único: T na escolhida e F nominalmente nas outras; nunca na mestre', () => {
    const r = planejarVencedor(propostas, { item: 50, seq: 1 }, [3]);
    expect(r.recusas).toEqual([]);
    expect(r.marcas).toEqual([
      { id: 2, vencedor: 'F' },
      { id: 3, vencedor: 'T' },
      { id: 4, vencedor: 'F' },
    ]);
    expect(r.marcas.some((m) => m.id === 1)).toBe(false);
  });
  it('rateio com dois vencedores é legítimo', () => {
    const r = planejarVencedor(propostas, { item: 50, seq: 1 }, [2, 3]);
    expect(r.marcas.filter((m) => m.vencedor === 'T').map((m) => m.id)).toEqual([2, 3]);
  });
  it('troca de vencedor muda só o necessário', () => {
    const r = planejarVencedor(propostas, { item: 50, seq: 1 }, [4]);
    expect(r.marcas).toEqual([{ id: 2, vencedor: 'F' }]);
  });
  it('recusa a mestre, a proposta de outro item e a escolha vazia', () => {
    expect(planejarVencedor(propostas, { item: 50, seq: 1 }, [1]).recusas[0]?.codigo).toBe('linha-mestre');
    expect(planejarVencedor(propostas, { item: 50, seq: 1 }, [9]).recusas[0]?.codigo).toBe(
      'proposta-de-outro-item',
    );
    expect(planejarVencedor(propostas, { item: 50, seq: 1 }, []).recusas[0]?.codigo).toBe('sem-vencedor');
  });
  it('vencedores, menor proposta, justificativa e valor com as parcelas', () => {
    expect(ehMestre({ fornecedor: 0 })).toBe(true);
    expect(vencedoresDoItem(propostas, 50, 1).map((x) => x.id)).toEqual([4]);
    expect(menorProposta(propostas, 50, 1)?.id).toBe(3);
    expect(menorProposta(propostas, 99, 1)).toBeNull();
    expect(exigeJustificativa(propostas, 50, 1, [4])).toBe(true);
    expect(exigeJustificativa(propostas, 50, 1, [3])).toBe(false);
    expect(valorPelosVencedores(propostas)).toEqual({ total: 60, parcelas: [60] });
  });
  it('itens do pedido: ao menos um, quantidade positiva, sem repetir', () => {
    expect(conferirItensPedido([]).map((r) => r.codigo)).toEqual(['pedido-sem-itens']);
    expect(
      conferirItensPedido([
        { item: 1, quantidade: 0 },
        { item: 1, quantidade: 2 },
      ]).map((r) => r.codigo),
    ).toEqual(['quantidade-invalida', 'item-repetido']);
    expect(conferirItensPedido([{ item: 1, quantidade: 2 }])).toEqual([]);
  });
});
