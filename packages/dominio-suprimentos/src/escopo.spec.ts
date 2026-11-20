// Regra 13 (ficha do M28), parte pura: local × tipo de movimento e centro de custo do usuário do estoque.
import { describe, expect, it } from 'vitest';
import {
  conferirCentroCusto,
  conferirLocal,
  conferirTransferencia,
  escopoDasLinhas,
  podeMovimentar,
} from '@sgh/contratos/regras-suprimentos';

const flags = { autorizarRequisicao: false, autorizarPedido: false, desbloquearFechamento: false };
const e = escopoDasLinhas(
  [
    { local: 10, tipo: 'S' },
    { local: 10, tipo: 'TO' },
    { local: 20, tipo: 'TD' },
    { local: 20, tipo: 'XX' },
  ],
  [300100],
  flags,
);

describe('escopo do usuário do estoque (regra 13)', () => {
  it('só os locais e tipos do cadastro', () => {
    expect(podeMovimentar(e, 10, 'saida')).toBe(true);
    expect(podeMovimentar(e, 10, 'entrada')).toBe(false);
    expect(podeMovimentar(e, 30, 'saida')).toBe(false);
    expect(conferirLocal(e, 20, 'saida')?.codigo).toBe('local-fora-do-escopo');
  });
  it('transferência: origem e destino no escopo e diferentes', () => {
    expect(conferirTransferencia(e, 10, 20)).toEqual([]);
    expect(conferirTransferencia(e, 20, 10).map((r) => r.campos?.[0])).toEqual(['origem', 'destino']);
    expect(conferirTransferencia(e, 10, 10).map((r) => r.codigo)).toContain('mesmo-local');
  });
  it('centro de custo: os do usuário; sem nenhum cadastrado, todos', () => {
    expect(conferirCentroCusto(e, 300100)).toBeNull();
    expect(conferirCentroCusto(e, 200100)?.codigo).toBe('centro-fora-do-escopo');
    expect(conferirCentroCusto(escopoDasLinhas([], [], flags), 200100)).toBeNull();
  });
});
