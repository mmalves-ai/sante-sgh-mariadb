// 02-AGE linha 53: regra do pedido de vaga do médico ou da regulação.
import { describe, expect, it } from 'vitest';
import { type EntradaPedidoVaga, validarPedidoVaga } from './pedido-vaga.js';

const base: EntradaPedidoVaga = {
  solicitante: 10,
  regulacao: null,
  especialidade: 3,
  agenda: null,
  itens: [{ itemAgendavel: 7, itemFaturavel: null, quantidade: 1 }],
  prazoLimite: null,
  hoje: '2030-03-11',
};
const campos = (e: Partial<EntradaPedidoVaga>) => {
  const r = validarPedidoVaga({ ...base, ...e });
  return r.ok ? [] : r.problemas.map((p) => p.campo);
};

describe('validarPedidoVaga', () => {
  it('aceita o pedido do médico com especialidade e itens e devolve o primeiro item da agenda', () => {
    expect(
      validarPedidoVaga({
        ...base,
        itens: [
          { itemAgendavel: null, itemFaturavel: 40, quantidade: 2 },
          { itemAgendavel: 7, itemFaturavel: null, quantidade: 1 },
        ],
      }),
    ).toEqual({ ok: true, itemPrincipal: 7 });
  });

  it('aceita o pedido da regulação sem profissional solicitante', () => {
    expect(campos({ solicitante: null, regulacao: 5 })).toEqual([]);
  });

  it('recusa o pedido sem origem (nem profissional nem regulação)', () => {
    expect(campos({ solicitante: null })).toEqual(['solicitante']);
  });

  it('o item da agenda basta como alvo da fila; só procedimento faturável sem especialidade não entra', () => {
    expect(validarPedidoVaga({ ...base, especialidade: null })).toEqual({ ok: true, itemPrincipal: 7 });
    expect(
      campos({ especialidade: null, itens: [{ itemAgendavel: null, itemFaturavel: 4, quantidade: 1 }] }),
    ).toEqual(['especialidade']);
    expect(campos({ especialidade: null, agenda: 9, itens: [] })).toEqual([]);
  });

  it('cada item tem um alvo só, quantidade inteira de 1 a 99 e não se repete', () => {
    expect(campos({ itens: [{ itemAgendavel: 1, itemFaturavel: 2, quantidade: 1 }] })).toEqual(['itens.0']);
    expect(campos({ itens: [{ itemAgendavel: null, itemFaturavel: null, quantidade: 1 }] })).toContain(
      'itens.0',
    );
    expect(campos({ itens: [{ itemAgendavel: 1, itemFaturavel: null, quantidade: 0 }] })).toEqual([
      'itens.0.quantidade',
    ]);
    expect(campos({ itens: [{ itemAgendavel: 1, itemFaturavel: null, quantidade: 1.5 }] })).toEqual([
      'itens.0.quantidade',
    ]);
    expect(campos({ itens: [{ itemAgendavel: 1, itemFaturavel: null, quantidade: 100 }] })).toEqual([
      'itens.0.quantidade',
    ]);
    expect(
      campos({
        itens: [
          { itemAgendavel: 1, itemFaturavel: null, quantidade: 1 },
          { itemAgendavel: 1, itemFaturavel: null, quantidade: 2 },
        ],
      }),
    ).toEqual(['itens.1']);
  });

  it('no máximo 20 itens', () => {
    const itens = Array.from({ length: 21 }, (_, i) => ({
      itemAgendavel: i + 1,
      itemFaturavel: null,
      quantidade: 1,
    }));
    expect(campos({ itens })).toEqual(['itens']);
  });

  it('o prazo limite não fica no passado e tem formato de data', () => {
    expect(campos({ prazoLimite: '2030-03-11' })).toEqual([]);
    expect(campos({ prazoLimite: '2030-03-10' })).toEqual(['prazoLimite']);
    expect(campos({ prazoLimite: '11/03/2030' })).toEqual(['prazoLimite']);
  });
});
