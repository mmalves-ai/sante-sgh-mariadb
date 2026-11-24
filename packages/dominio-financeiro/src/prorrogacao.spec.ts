import { describe, expect, it } from 'vitest';
import { conferirProrrogacao, diasProrrogados } from './prorrogacao.js';

const aberta = { situacao: 'aberta', saldo: 100, vencimento: '2026-12-10', emLotePendente: false };
const codigo = (r: ReturnType<typeof conferirProrrogacao>) => r?.codigo ?? null;

describe('prorrogação do vencimento da parcela a pagar', () => {
  it('aceita a parcela aberta para depois, com motivo', () => {
    expect(conferirProrrogacao(aberta, '2026-12-20', 'Acordo com o fornecedor')).toBeNull();
    expect(
      conferirProrrogacao({ ...aberta, situacao: 'parcial' }, '2026-12-11', 'Atraso na entrega'),
    ).toBeNull();
  });
  it('recusa a parcela paga, cancelada ou sem saldo', () => {
    expect(codigo(conferirProrrogacao({ ...aberta, situacao: 'paga' }, '2026-12-20', 'motivo ok'))).toBe(
      'parcela-nao-prorrogavel',
    );
    expect(codigo(conferirProrrogacao({ ...aberta, situacao: 'cancelada' }, '2026-12-20', 'motivo ok'))).toBe(
      'parcela-nao-prorrogavel',
    );
    expect(codigo(conferirProrrogacao({ ...aberta, saldo: 0 }, '2026-12-20', 'motivo ok'))).toBe(
      'parcela-nao-prorrogavel',
    );
  });
  it('recusa a parcela em borderô ou remessa pendente', () => {
    expect(codigo(conferirProrrogacao({ ...aberta, emLotePendente: true }, '2026-12-20', 'motivo ok'))).toBe(
      'parcela-em-lote',
    );
  });
  it('recusa a mesma data, a anterior e a data inválida', () => {
    expect(codigo(conferirProrrogacao(aberta, '2026-12-10', 'motivo ok'))).toBe('prorrogacao-para-tras');
    expect(codigo(conferirProrrogacao(aberta, '2026-12-01', 'motivo ok'))).toBe('prorrogacao-para-tras');
    expect(codigo(conferirProrrogacao(aberta, '2026-13-40', 'motivo ok'))).toBe('data-invalida');
  });
  it('recusa mais de um ano além do vencimento vigente', () => {
    expect(codigo(conferirProrrogacao(aberta, '2027-12-11', 'motivo ok'))).toBe('prorrogacao-longa');
    expect(conferirProrrogacao(aberta, '2027-12-10', 'motivo ok')).toBeNull();
  });
  it('exige motivo de 5 letras', () => {
    expect(codigo(conferirProrrogacao(aberta, '2026-12-20', '  ok  '))).toBe('motivo-obrigatorio');
  });
  it('conta os dias prorrogados desde o vencimento original', () => {
    expect(diasProrrogados('2026-12-10', '2026-12-20')).toBe(10);
    expect(diasProrrogados('2026-12-10', '2026-12-10')).toBe(0);
  });
});
