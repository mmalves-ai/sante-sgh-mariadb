import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoEquipamento,
  conferirCancelamentoHemocomponente,
  conferirReservaEquipamento,
  conferirReservaHemocomponente,
  conferirVinculoRequisicao,
  conflitosEquipamento,
  type ItemRequisicaoParaReserva,
  type OcupacaoEquipamento,
  periodoDaCirurgia,
  provaCruzadaInicial,
  reservaPeloVinculo,
} from './reserva-cirurgia.js';

const AG = { id: 10, situacao: 'agendado' };
const ocup = (
  agendamento: number,
  inicio: string,
  fim: string,
  situacao = 'reservado',
): OcupacaoEquipamento => ({
  agendamento,
  numero: `CC-${agendamento}`,
  inicio,
  fim,
  situacao,
});
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('periodoDaCirurgia', () => {
  it('é a janela da cirurgia (início + duração); sem início ou duração, null', () => {
    expect(periodoDaCirurgia('2026-12-01 07:30', 150)).toEqual({
      inicio: '2026-12-01 07:30',
      fim: '2026-12-01 10:00',
    });
    expect(periodoDaCirurgia('2026-12-01 23:00', 120)?.fim).toBe('2026-12-02 01:00');
    expect(periodoDaCirurgia(null, 60)).toBeNull();
    expect(periodoDaCirurgia('2026-12-01 07:30', null)).toBeNull();
    expect(periodoDaCirurgia('2026-02-30 07:30', 60)).toBeNull();
  });
});

describe('conflitosEquipamento', () => {
  const periodo = { inicio: '2026-12-01 08:00', fim: '2026-12-01 10:00' };
  it('acha só as reservas de outras cirurgias que cruzam o período e ocupam o equipamento', () => {
    const r = conflitosEquipamento(10, periodo, [
      ocup(11, '2026-12-01 09:30', '2026-12-01 11:00'),
      ocup(12, '2026-12-01 10:00', '2026-12-01 11:00'), // encosta no fim: não cruza
      ocup(13, '2026-12-01 06:00', '2026-12-01 08:00'), // encosta no início: não cruza
      ocup(14, '2026-12-01 07:00', '2026-12-01 12:00', 'cancelado'),
      ocup(15, '2026-12-01 07:00', '2026-12-01 12:00', 'liberado'),
      ocup(10, '2026-12-01 08:00', '2026-12-01 10:00'), // a própria cirurgia
      ocup(16, '2026-12-01 07:00', '2026-12-01 12:00', 'em_uso'),
    ]);
    expect(r.map((o) => o.agendamento)).toEqual([11, 16]);
  });
});

describe('conferirReservaEquipamento', () => {
  const ok = { inicio: '2026-12-01 08:00', fim: '2026-12-01 10:00', quantidade: 1 };
  const ativo = { situacao: 'ativo' };
  it('aceita o período livre', () => {
    expect(
      conferirReservaEquipamento(AG, ok, ativo, [ocup(11, '2026-12-01 10:00', '2026-12-01 12:00')]),
    ).toEqual([]);
  });
  it('recusa o conflito de horário citando a cirurgia que ocupa', () => {
    const p = conferirReservaEquipamento(AG, ok, ativo, [ocup(11, '2026-12-01 09:00', '2026-12-01 12:00')]);
    expect(campos(p)).toEqual(['equipamento']);
    expect(p[0]!.mensagem).toContain('CC-11');
  });
  it('recusa período invertido, longo demais, data inválida e quantidade fora da faixa', () => {
    expect(campos(conferirReservaEquipamento(AG, { ...ok, fim: '2026-12-01 08:00' }, ativo, []))).toEqual([
      'fim',
    ]);
    expect(campos(conferirReservaEquipamento(AG, { ...ok, fim: '2026-12-02 08:01' }, ativo, []))).toEqual([
      'fim',
    ]);
    expect(campos(conferirReservaEquipamento(AG, { ...ok, inicio: 'amanhã' }, ativo, []))).toEqual([
      'inicio',
    ]);
    expect(campos(conferirReservaEquipamento(AG, { ...ok, quantidade: 0 }, ativo, []))).toEqual([
      'quantidade',
    ]);
    expect(campos(conferirReservaEquipamento(AG, { ...ok, quantidade: 1.5 }, ativo, []))).toEqual([
      'quantidade',
    ]);
  });
  it('recusa equipamento desativado ou inexistente e cirurgia fechada', () => {
    expect(campos(conferirReservaEquipamento(AG, ok, { situacao: 'desativado' }, []))).toEqual([
      'equipamento',
    ]);
    expect(campos(conferirReservaEquipamento(AG, ok, null, []))).toEqual(['equipamento']);
    expect(campos(conferirReservaEquipamento({ id: 10, situacao: 'realizado' }, ok, ativo, []))).toEqual([
      'situacao',
    ]);
    expect(conferirReservaEquipamento(AG, ok, { situacao: 'reserva' }, [])).toEqual([]);
  });
  it('cancelamento: só antes do uso e com a cirurgia aberta', () => {
    expect(conferirCancelamentoEquipamento('agendado', 'reservado')).toEqual([]);
    expect(conferirCancelamentoEquipamento('confirmado', 'confirmado')).toEqual([]);
    expect(campos(conferirCancelamentoEquipamento('agendado', 'em_uso'))).toEqual(['reserva']);
    expect(campos(conferirCancelamentoEquipamento('agendado', 'cancelado'))).toEqual(['reserva']);
    expect(campos(conferirCancelamentoEquipamento('cancelado', 'reservado'))).toEqual(['situacao']);
  });
});

describe('hemocomponente da cirurgia', () => {
  it('prova cruzada nasce pedida quando o tipo exige', () => {
    expect(provaCruzadaInicial(true)).toBe('solicitada');
    expect(provaCruzadaInicial(false)).toBe('dispensada');
  });
  it('confere tipo ativo, quantidade de bolsas e cirurgia aberta', () => {
    expect(conferirReservaHemocomponente('solicitado', 2, { ativo: true })).toEqual([]);
    expect(campos(conferirReservaHemocomponente('solicitado', 0, { ativo: true }))).toEqual(['quantidade']);
    expect(campos(conferirReservaHemocomponente('solicitado', 21, { ativo: true }))).toEqual(['quantidade']);
    expect(campos(conferirReservaHemocomponente('solicitado', 2, { ativo: false }))).toEqual([
      'hemocomponente',
    ]);
    expect(campos(conferirReservaHemocomponente('solicitado', 2, null))).toEqual(['hemocomponente']);
    expect(campos(conferirReservaHemocomponente('em_andamento', 2, { ativo: true }))).toEqual(['situacao']);
  });

  const ag = { id: 10, paciente: 7, situacao: 'agendado' };
  const reserva = { hemocomponente: 3, situacao: 'solicitada' };
  const item: ItemRequisicaoParaReserva = {
    hemocomponente: 3,
    paciente: 7,
    agendamento: null,
    situacaoRequisicao: 'requisitada',
    situacaoItem: 'pendente',
    quantidadeBolsas: 2,
    quantidadeAtendida: 0,
  };
  it('liga a reserva ao item da requisição do mesmo paciente e tipo, sem cirurgia ou desta cirurgia', () => {
    expect(conferirVinculoRequisicao(ag, reserva, item)).toEqual([]);
    expect(conferirVinculoRequisicao(ag, reserva, { ...item, agendamento: 10 })).toEqual([]);
    expect(conferirVinculoRequisicao(ag, { ...reserva, situacao: 'reservada' }, item)).toEqual([]);
  });
  it('recusa outro paciente, outra cirurgia, outro tipo, requisição cancelada e reserva encerrada', () => {
    expect(campos(conferirVinculoRequisicao(ag, reserva, { ...item, paciente: 8 }))).toEqual(['requisicao']);
    expect(campos(conferirVinculoRequisicao(ag, reserva, { ...item, agendamento: 11 }))).toEqual([
      'requisicao',
    ]);
    expect(campos(conferirVinculoRequisicao(ag, reserva, { ...item, hemocomponente: 4 }))).toEqual([
      'requisicao',
    ]);
    expect(
      campos(conferirVinculoRequisicao(ag, reserva, { ...item, situacaoRequisicao: 'cancelada' })),
    ).toEqual(['requisicao']);
    expect(campos(conferirVinculoRequisicao(ag, reserva, { ...item, situacaoItem: 'cancelado' }))).toEqual([
      'requisicao',
    ]);
    expect(campos(conferirVinculoRequisicao(ag, { ...reserva, situacao: 'cancelada' }, item))).toEqual([
      'reserva',
    ]);
    expect(campos(conferirVinculoRequisicao(ag, reserva, null))).toEqual(['requisicao']);
  });
  it('reservada com as bolsas já liberadas, até o pedido', () => {
    expect(reservaPeloVinculo(2, { quantidadeAtendida: 0 })).toEqual({
      situacao: 'reservada',
      quantidadeReservada: 0,
    });
    expect(reservaPeloVinculo(2, { quantidadeAtendida: 1 }).quantidadeReservada).toBe(1);
    expect(reservaPeloVinculo(2, { quantidadeAtendida: 5 }).quantidadeReservada).toBe(2);
  });
  it('cancelamento só da reserva aberta', () => {
    expect(conferirCancelamentoHemocomponente('agendado', 'solicitada')).toEqual([]);
    expect(conferirCancelamentoHemocomponente('agendado', 'reservada')).toEqual([]);
    expect(campos(conferirCancelamentoHemocomponente('agendado', 'utilizada'))).toEqual(['reserva']);
    expect(campos(conferirCancelamentoHemocomponente('realizado', 'solicitada'))).toEqual(['situacao']);
  });
});
