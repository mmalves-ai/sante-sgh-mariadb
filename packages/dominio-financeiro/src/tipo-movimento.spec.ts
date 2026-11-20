// Regra 14 do M32: o movimento com domínio fechado e as mesmas letras; o escopo por conta (regra 15).
import { describe, expect, it } from 'vitest';
import {
  CENARIO_DO_TIPO,
  conferirMovimento,
  contasNoEscopo,
  efeitoNoSaldo,
  ehTipoMovimento,
  ROTULO_TIPO_MOVIMENTO,
  TIPOS_MOVIMENTO_GRAVADOS,
} from './index.js';

const m = { tipo: 'T', contaCredito: 1, contaDebito: 2, valor: 10, historico: 'transferência' };

describe('tipo de movimento (regra 14)', () => {
  it('o novo grava O, F, T, C e D; I e o vazio ficam na conciliação; legendas a confirmar', () => {
    expect(TIPOS_MOVIMENTO_GRAVADOS).toEqual(['O', 'F', 'T', 'C', 'D']);
    expect(ehTipoMovimento('I')).toBe(false);
    expect(ROTULO_TIPO_MOVIMENTO['I']).toContain('a confirmar');
    expect(ROTULO_TIPO_MOVIMENTO['']).toBe('Crédito não identificado');
    expect(CENARIO_DO_TIPO.F).toBe('fechamento-caixa');
  });
  it.each([
    [{ ...m, tipo: 'I' }, 'tipo-movimento-invalido'],
    [{ ...m, valor: 0 }, 'valor-obrigatorio'],
    [{ ...m, historico: ' ' }, 'historico-obrigatorio'],
    [{ ...m, contaDebito: 1 }, 'mesma-conta'],
    [{ ...m, contaDebito: null }, 'contas-obrigatorias'],
    [{ ...m, tipo: 'F', contaCredito: null }, 'contas-obrigatorias'],
    [{ ...m, tipo: 'C', contaCredito: null }, 'conta-obrigatoria'],
    [{ ...m, tipo: 'D', contaDebito: null }, 'conta-obrigatoria'],
    [{ ...m, tipo: 'O', contaCredito: null, contaDebito: null }, 'uma-conta'],
  ])('recusa %j com %s', (x, codigo) => {
    expect(conferirMovimento(x)?.codigo).toBe(codigo);
  });
  it('aceita cada tipo com as contas que ele usa', () => {
    expect(conferirMovimento(m)).toBeNull();
    expect(conferirMovimento({ ...m, tipo: 'C', contaDebito: null })).toBeNull();
    expect(conferirMovimento({ ...m, tipo: 'D', contaCredito: null })).toBeNull();
    expect(conferirMovimento({ ...m, tipo: 'O', contaCredito: null })).toBeNull();
  });
  it('escopo por conta (MFCTAUSU) e o efeito no saldo: +10 na que recebe, −10 na debitada', () => {
    expect(contasNoEscopo(m, null)).toBe(true);
    expect(contasNoEscopo(m, [1, 2])).toBe(true);
    expect(contasNoEscopo(m, [1])).toBe(false);
    expect(contasNoEscopo({ contaCredito: 1, contaDebito: null }, [1])).toBe(true);
    expect(efeitoNoSaldo(m, 1)).toBe(10);
    expect(efeitoNoSaldo(m, 2)).toBe(-10);
    expect(efeitoNoSaldo(m, 3)).toBe(0);
  });
});
