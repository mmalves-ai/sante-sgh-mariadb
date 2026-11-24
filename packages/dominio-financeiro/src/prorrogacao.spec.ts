import { describe, expect, it } from 'vitest';
import {
  conferirAlcadaProrrogacao,
  conferirProrrogacao,
  diasProrrogados,
  tetoProrrogacao,
} from './prorrogacao.js';

const aberta = { situacao: 'aberta', saldo: 100, vencimento: '2026-12-10', emLotePendente: false };
const M = { ativo: true, aplicaPagar: true, exigeJustificativa: false };
const J = { ...M, exigeJustificativa: true };
const codigo = (r: ReturnType<typeof conferirProrrogacao>) => r?.codigo ?? null;

describe('prorrogação do vencimento da parcela a pagar', () => {
  it('aceita a parcela aberta para depois, com motivo', () => {
    expect(conferirProrrogacao(aberta, '2026-12-20', M, '')).toBeNull();
    expect(conferirProrrogacao({ ...aberta, situacao: 'parcial' }, '2026-12-11', M, '')).toBeNull();
  });
  it('recusa a parcela paga, cancelada ou sem saldo', () => {
    expect(codigo(conferirProrrogacao({ ...aberta, situacao: 'paga' }, '2026-12-20', M, ''))).toBe(
      'parcela-nao-prorrogavel',
    );
    expect(codigo(conferirProrrogacao({ ...aberta, situacao: 'cancelada' }, '2026-12-20', M, ''))).toBe(
      'parcela-nao-prorrogavel',
    );
    expect(codigo(conferirProrrogacao({ ...aberta, saldo: 0 }, '2026-12-20', M, ''))).toBe(
      'parcela-nao-prorrogavel',
    );
  });
  it('recusa a parcela em borderô ou remessa pendente', () => {
    expect(codigo(conferirProrrogacao({ ...aberta, emLotePendente: true }, '2026-12-20', M, ''))).toBe(
      'parcela-em-lote',
    );
  });
  it('recusa a mesma data, a anterior e a data inválida', () => {
    expect(codigo(conferirProrrogacao(aberta, '2026-12-10', M, ''))).toBe('prorrogacao-para-tras');
    expect(codigo(conferirProrrogacao(aberta, '2026-12-01', M, ''))).toBe('prorrogacao-para-tras');
    expect(codigo(conferirProrrogacao(aberta, '2026-13-40', M, ''))).toBe('data-invalida');
  });
  it('recusa mais de um ano além do vencimento vigente', () => {
    expect(codigo(conferirProrrogacao(aberta, '2027-12-11', M, ''))).toBe('prorrogacao-longa');
    expect(conferirProrrogacao(aberta, '2027-12-10', M, '')).toBeNull();
    expect(tetoProrrogacao('2028-02-29')).toBe('2029-02-28');
    expect(tetoProrrogacao('2027-02-28')).toBe('2028-02-28');
  });
  it('exige motivo ativo da lista que valha para contas a pagar', () => {
    expect(codigo(conferirProrrogacao(aberta, '2026-12-20', null, 'qualquer'))).toBe('motivo-obrigatorio');
    expect(codigo(conferirProrrogacao(aberta, '2026-12-20', { ...M, ativo: false }, ''))).toBe(
      'motivo-obrigatorio',
    );
    expect(codigo(conferirProrrogacao(aberta, '2026-12-20', { ...M, aplicaPagar: false }, ''))).toBe(
      'motivo-obrigatorio',
    );
  });
  it('exige justificativa de 5 letras quando o motivo pede', () => {
    expect(codigo(conferirProrrogacao(aberta, '2026-12-20', J, '  ok  '))).toBe('justificativa-obrigatoria');
    expect(conferirProrrogacao(aberta, '2026-12-20', J, 'Nota com CNPJ errado')).toBeNull();
  });
  it('conta os dias prorrogados desde o vencimento original', () => {
    expect(diasProrrogados('2026-12-10', '2026-12-20')).toBe(10);
    expect(diasProrrogados('2026-12-10', '2026-12-10')).toBe(0);
  });
});

describe('prorrogação de título já aprovado na alçada (alteração controlada)', () => {
  const cod = (r: ReturnType<typeof conferirAlcadaProrrogacao>) => r?.codigo ?? null;
  it('antes da aprovação, a permissão de prorrogar basta (até para quem lançou)', () => {
    expect(
      cod(conferirAlcadaProrrogacao({ tituloAprovado: false, lancadoPeloUsuario: true, podeAprovar: false })),
    ).toBeNull();
  });
  it('aprovado: quem não pode aprovar é recusado', () => {
    expect(
      cod(conferirAlcadaProrrogacao({ tituloAprovado: true, lancadoPeloUsuario: false, podeAprovar: false })),
    ).toBe('prorrogacao-exige-aprovador');
  });
  it('aprovado: quem lançou é recusado mesmo podendo aprovar (segregação)', () => {
    expect(
      cod(conferirAlcadaProrrogacao({ tituloAprovado: true, lancadoPeloUsuario: true, podeAprovar: true })),
    ).toBe('prorrogacao-pelo-lancador');
  });
  it('aprovado: outro aprovador prorroga', () => {
    expect(
      cod(conferirAlcadaProrrogacao({ tituloAprovado: true, lancadoPeloUsuario: false, podeAprovar: true })),
    ).toBeNull();
  });
});
