// W1-01 (parte 11d; mercado l): bloqueio parametrizado dos atos privativos pela conferência do conselho.
import { describe, expect, it } from 'vitest';
import {
  avaliarRegistroConselho,
  conselhoEfetivo,
  PADRAO_CONSELHO,
  type ParametrosConselho,
} from './conselho.js';

const HOJE = '2026-11-19';
const p = (bloqueio: ParametrosConselho['bloqueio']): ParametrosConselho => ({
  ...PADRAO_CONSELHO,
  bloqueio,
});
const ativo = { situacao: 'ativo' as const, conferidoEm: '2026-11-01' };
const suspenso = { situacao: 'suspenso' as const, conferidoEm: '2026-11-01' };
const antigo = { situacao: 'ativo' as const, conferidoEm: '2025-10-01' };

describe('W1-01 (parte 11d): conferência do conselho', () => {
  it('padrão: bloqueia só o registro irregular; consulta automática desligada', () => {
    expect(PADRAO_CONSELHO).toEqual({ bloqueio: 'irregular', validadeDias: 365, consultaAutomatica: false });
    expect(avaliarRegistroConselho(ativo, PADRAO_CONSELHO, HOJE)).toMatchObject({
      estado: 'regular',
      libera: true,
    });
    expect(avaliarRegistroConselho(suspenso, PADRAO_CONSELHO, HOJE)).toMatchObject({
      estado: 'irregular',
      libera: false,
      motivo: 'Registro suspenso no conselho (conferido em 2026-11-01).',
    });
    expect(avaliarRegistroConselho(null, PADRAO_CONSELHO, HOJE)).toMatchObject({
      estado: 'nao-conferido',
      libera: true,
    });
    expect(avaliarRegistroConselho(antigo, PADRAO_CONSELHO, HOJE)).toMatchObject({
      estado: 'vencido',
      libera: true,
    });
  });

  it('modo estrito: sem conferência ou vencida também bloqueia; desligado nunca bloqueia', () => {
    const estrito = p('irregular-ou-nao-conferido');
    expect(avaliarRegistroConselho(null, estrito, HOJE).libera).toBe(false);
    expect(avaliarRegistroConselho(antigo, estrito, HOJE).libera).toBe(false);
    expect(avaliarRegistroConselho(ativo, estrito, HOJE).libera).toBe(true);
    expect(avaliarRegistroConselho(suspenso, p('desligado'), HOJE).libera).toBe(true);
  });

  it('conselho efetivo: um registro que libera basta; todos irregulares retiram a categoria com conselho', () => {
    expect(
      conselhoEfetivo(
        true,
        [
          { registro: 1, conferencia: suspenso },
          { registro: 2, conferencia: ativo },
        ],
        PADRAO_CONSELHO,
        HOJE,
      ),
    ).toEqual({ conselho: true, bloqueadoPorConferencia: false, motivo: null });
    expect(conselhoEfetivo(true, [{ registro: 1, conferencia: suspenso }], PADRAO_CONSELHO, HOJE)).toEqual({
      conselho: false,
      bloqueadoPorConferencia: true,
      motivo: 'Registro suspenso no conselho (conferido em 2026-11-01).',
    });
    // Sem registro na concessão, nada muda; desligado, nada muda; sem leitura (undefined), nada muda.
    expect(conselhoEfetivo(false, [], p('irregular-ou-nao-conferido'), HOJE).conselho).toBe(false);
    expect(
      conselhoEfetivo(true, [{ registro: 1, conferencia: suspenso }], p('desligado'), HOJE).conselho,
    ).toBe(true);
    expect(conselhoEfetivo(true, undefined, p('irregular-ou-nao-conferido'), HOJE).conselho).toBe(true);
    expect(conselhoEfetivo(true, [], p('irregular-ou-nao-conferido'), HOJE).conselho).toBe(false);
    expect(conselhoEfetivo(true, [], PADRAO_CONSELHO, HOJE).conselho).toBe(true);
  });
});
