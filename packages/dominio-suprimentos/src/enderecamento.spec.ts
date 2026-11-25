// Regras do endereçamento do armazém e da reserva para a separação (F8, 05-SUP linha 4).
import { describe, expect, it } from 'vitest';
import {
  baixaDasReservas,
  codigoCompletoEndereco,
  conferirEnderecoArmazem,
  conferirInativacaoEndereco,
  conferirVinculoEndereco,
  nivelDoEndereco,
  planejarReservaSeparacao,
} from './index.js';

const sup = { id: 9, local: 1, nivel: 2, codigoCompleto: 'A-03', ativo: true };
const codigos = (rs: readonly { codigo: string }[]) => rs.map((r) => r.codigo);

describe('endereço do armazém', () => {
  it('monta o completo e o nível pelo superior, com o código em maiúsculas', () => {
    expect(codigoCompletoEndereco(null, ' a ')).toBe('A');
    expect(codigoCompletoEndereco(sup, '02b')).toBe('A-03-02B');
    expect(nivelDoEndereco(null)).toBe(1);
    expect(nivelDoEndereco(sup)).toBe(3);
  });

  it('aceita o endereço válido e recusa o duplicado no local', () => {
    const e = { local: 1, superior: 9, tipoNivel: 'prateleira' as const, codigo: '02' };
    expect(conferirEnderecoArmazem(e, sup, new Set())).toEqual([]);
    expect(codigos(conferirEnderecoArmazem(e, sup, new Set(['A-03-02'])))).toEqual(['endereco-duplicado']);
  });

  it('recusa código, tipo, superior de outro local ou inativo, nível 9 e capacidade zero', () => {
    const rs = conferirEnderecoArmazem(
      { local: 2, superior: 9, tipoNivel: 'sotao' as never, codigo: 'A 1', capacidade: 0 },
      { ...sup, ativo: false, nivel: 8 },
      new Set(),
    );
    expect(codigos(rs)).toEqual([
      'endereco-codigo-invalido',
      'endereco-tipo-invalido',
      'endereco-superior-outro-local',
      'endereco-superior-inativo',
      'endereco-nivel-maximo',
      'endereco-capacidade-invalida',
    ]);
    expect(
      codigos(
        conferirEnderecoArmazem({ local: 1, superior: 7, tipoNivel: 'area', codigo: 'B' }, null, new Set()),
      ),
    ).toEqual(['endereco-superior-inexistente']);
  });

  it('inativa só sem filhos ativos e sem itens ligados', () => {
    expect(conferirInativacaoEndereco(0, 0)).toEqual([]);
    expect(codigos(conferirInativacaoEndereco(1, 2))).toEqual(['endereco-com-filhos', 'endereco-com-itens']);
  });

  it('liga o item só a endereço ativo e desbloqueado e a item ativo', () => {
    expect(conferirVinculoEndereco({ ativo: true, bloqueado: false }, true, null)).toEqual([]);
    expect(codigos(conferirVinculoEndereco({ ativo: true, bloqueado: true }, false, 0))).toEqual([
      'endereco-indisponivel',
      'item-inativo',
      'quantidade-maxima-invalida',
    ]);
    expect(codigos(conferirVinculoEndereco(null, null, null))).toEqual([
      'endereco-inexistente',
      'item-inexistente',
    ]);
  });
});

describe('reserva para a separação', () => {
  const hoje = '2026-11-25';
  const lotes = new Map([
    [
      10,
      [
        { lote: 3, saldoLote: 30, validade: '2027-06-30', livre: 10 },
        { lote: 1, saldoLote: 31, validade: '2025-01-31', livre: 50 },
        { lote: 2, saldoLote: 32, validade: '2026-12-31', livre: 4 },
      ],
    ],
  ]);

  it('reserva pela validade mais próxima, sem o vencido, e a falta quando o livre não cobre', () => {
    const p = planejarReservaSeparacao(
      [
        { itemRequisicao: 100, insumo: 10, unidade: 1, aSeparar: 6, jaReservado: 0, controlaLote: true },
        { itemRequisicao: 101, insumo: 10, unidade: 1, aSeparar: 10, jaReservado: 0, controlaLote: true },
        { itemRequisicao: 102, insumo: 20, unidade: 1, aSeparar: 5, jaReservado: 0, controlaLote: false },
      ],
      lotes,
      new Map([[20, 3]]),
      hoje,
    );
    expect(p.reservas).toEqual([
      { itemRequisicao: 100, insumo: 10, unidade: 1, lote: 2, saldoLote: 32, quantidade: 4 },
      { itemRequisicao: 100, insumo: 10, unidade: 1, lote: 3, saldoLote: 30, quantidade: 2 },
      { itemRequisicao: 101, insumo: 10, unidade: 1, lote: 3, saldoLote: 30, quantidade: 8 },
      { itemRequisicao: 102, insumo: 20, unidade: 1, lote: null, saldoLote: null, quantidade: 3 },
    ]);
    expect(p.faltas).toEqual([
      { itemRequisicao: 101, insumo: 10, falta: 2 },
      { itemRequisicao: 102, insumo: 20, falta: 2 },
    ]);
  });

  it('a reserva repetida só completa a diferença', () => {
    const p = planejarReservaSeparacao(
      [{ itemRequisicao: 100, insumo: 10, unidade: 1, aSeparar: 6, jaReservado: 6, controlaLote: true }],
      lotes,
      new Map(),
      hoje,
    );
    expect(p).toEqual({ reservas: [], faltas: [] });
  });

  it('o atendimento consome as reservas na ordem; o item completo devolve o resto ao livre', () => {
    const rs = [
      { id: 1, reservada: 4, atendida: 0, liberada: 0 },
      { id: 2, reservada: 2, atendida: 0, liberada: 0 },
    ];
    expect(baixaDasReservas(rs, 3, false)).toEqual([{ id: 1, atender: 3, liberar: 0, situacao: 'ativa' }]);
    expect(baixaDasReservas(rs, 5, true)).toEqual([
      { id: 1, atender: 4, liberar: 0, situacao: 'atendida' },
      { id: 2, atender: 1, liberar: 1, situacao: 'atendida' },
    ]);
    expect(baixaDasReservas(rs, 0, true)).toEqual([
      { id: 1, atender: 0, liberar: 4, situacao: 'liberada' },
      { id: 2, atender: 0, liberar: 2, situacao: 'liberada' },
    ]);
  });
});
