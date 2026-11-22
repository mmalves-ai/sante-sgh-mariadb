// Teste de aceite do ADR 0009 (seção 6 da resposta da Hal-AI, "Valor"), sobre dados sintéticos: o preço particular
// sai da regra estruturada do médico ou da agenda, antes da tabela do particular; o convênio nunca usa preço por médico.
import type { RegraPrecoParticular, VerificacaoCredenciamento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  compararEspecificidade,
  escolherRegraPrecoParticular,
  origemDaTabela,
  type PedidoRegraParticular,
  resolverPreco,
} from './index.js';

const PART = 1;
const CONV = 2;
const EST = 10;
let seq = 0;
function regra(
  p: Partial<RegraPrecoParticular> & Pick<RegraPrecoParticular, 'dono' | 'valor'>,
): RegraPrecoParticular {
  seq += 1;
  return {
    id: seq,
    estabelecimentoId: null,
    fontePagadoraId: PART,
    alvo: { tipo: 'consulta' },
    prioridade: 100,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    situacaoRevisao: 'confirmada',
    textoOrigemId: null,
    observacao: null,
    ativo: true,
    origem: 'sistema',
    versao: 1,
    ...p,
  };
}
const medA = { tipo: 'profissional' as const, profissionalId: 101 };
const medB = { tipo: 'profissional' as const, profissionalId: 102 };
const agendaA = { tipo: 'agenda' as const, agendaId: 501 };
const consulta = { itemFaturavelId: 9001, grupoFaturamentoId: 70, consulta: true };
const pedido = (x: Partial<PedidoRegraParticular> = {}): PedidoRegraParticular => ({
  profissionalId: 101,
  agendaId: null,
  estabelecimentoId: EST,
  fontePagadoraId: PART,
  data: '2026-11-22',
  alvo: consulta,
  ...x,
});
const tabela = { valor: 280, tabelaPrecoId: 77, origem: 'tabela_convenio' as const, vigencia: '2026-01-01' };

describe('6.1 quanto custa a consulta particular com o médico X', () => {
  const regras = [regra({ dono: medA, valor: 300 }), regra({ dono: medB, valor: 360 })];
  it('cada médico responde pela própria regra, com a origem do preço', () => {
    const a = resolverPreco({
      particular: true,
      pedido: pedido(),
      candidatas: regras,
      tabela,
      credenciamento: null,
    });
    const b = resolverPreco({
      particular: true,
      pedido: pedido({ profissionalId: 102 }),
      candidatas: regras,
      tabela,
      credenciamento: null,
    });
    expect([a.valor, a.origem, a.regraPrecoParticularId]).toEqual([
      300,
      'regra_particular_profissional',
      regras[0]!.id,
    ]);
    expect([b.valor, b.origem]).toEqual([360, 'regra_particular_profissional']);
    expect(a.explicacao).toContain('R$ 300,00');
  });
  it('médico sem regra cai na tabela do particular (nunca "não consta")', () => {
    const c = resolverPreco({
      particular: true,
      pedido: pedido({ profissionalId: 103 }),
      candidatas: regras,
      tabela,
      credenciamento: null,
    });
    expect([c.valor, c.origem, c.tabelaPrecoId, c.recusa]).toEqual([280, 'tabela_convenio', 77, null]);
  });
  it('a regra da agenda vence a do profissional (recorte mais específico)', () => {
    const rs = [...regras, regra({ dono: agendaA, valor: 250 })];
    const r = resolverPreco({
      particular: true,
      pedido: pedido({ agendaId: 501 }),
      candidatas: rs,
      tabela,
      credenciamento: null,
    });
    expect([r.valor, r.origem]).toEqual([250, 'regra_particular_agenda']);
  });
  it('sem regra e sem tabela: item-sem-preco, pede preço manual', () => {
    const r = resolverPreco({
      particular: true,
      pedido: pedido({ profissionalId: 9 }),
      candidatas: regras,
      tabela: null,
      credenciamento: null,
    });
    expect([r.valor, r.recusa]).toEqual([null, 'item-sem-preco']);
  });
});

describe('6.2 quanto custa o exame particular (procedimento, grupo, estimada do texto)', () => {
  const exame = { itemFaturavelId: 8001, grupoFaturamentoId: 80, consulta: false };
  const rs = [
    regra({ dono: medA, valor: 300 }),
    regra({ dono: medA, valor: 500, alvo: { tipo: 'grupo', grupoFaturamentoId: 80 } }),
    regra({
      dono: medA,
      valor: 200,
      alvo: { tipo: 'item', itemFaturavelId: 8001 },
      situacaoRevisao: 'estimada',
      textoOrigemId: 44,
    }),
  ];
  it('o procedimento vence o grupo; a consulta não vale para exame', () => {
    const r = resolverPreco({
      particular: true,
      pedido: pedido({ alvo: exame }),
      candidatas: rs,
      tabela,
      credenciamento: null,
    });
    expect([r.valor, r.estimada, r.textoOrigemId]).toEqual([200, true, 44]);
    expect(r.explicacao).toContain('texto da agenda');
  });
  it('outro exame do grupo usa o grupo', () => {
    const r = resolverPreco({
      particular: true,
      pedido: pedido({ alvo: { itemFaturavelId: 8002, grupoFaturamentoId: 80, consulta: false } }),
      candidatas: rs,
      tabela,
      credenciamento: null,
    });
    expect(r.valor).toBe(500);
  });
  it('a regra recusada, inativa, fora da vigência ou de outro estabelecimento não vale', () => {
    const fora = [
      regra({ dono: medA, valor: 1, situacaoRevisao: 'recusada' }),
      regra({ dono: medA, valor: 2, ativo: false }),
      regra({ dono: medA, valor: 3, vigenciaInicio: '2027-01-01' }),
      regra({ dono: medA, valor: 4, vigenciaFim: '2026-10-31' }),
      regra({ dono: medA, valor: 5, estabelecimentoId: 99 }),
    ];
    expect(escolherRegraPrecoParticular(fora, pedido())).toBeNull();
  });
});

describe('especificidade da regra particular', () => {
  it('estabelecimento > rede; prioridade menor; confirmada > estimada; vigência mais recente', () => {
    const rede = regra({ dono: medA, valor: 10 });
    const est = regra({ dono: medA, valor: 20, estabelecimentoId: EST, prioridade: 200 });
    expect(escolherRegraPrecoParticular([rede, est], pedido())?.valor).toBe(20);
    const p1 = regra({ dono: medA, valor: 30, prioridade: 1 });
    expect(escolherRegraPrecoParticular([rede, p1], pedido())?.valor).toBe(30);
    const est2 = regra({ dono: medA, valor: 40, situacaoRevisao: 'estimada' });
    expect(escolherRegraPrecoParticular([est2, rede], pedido())?.valor).toBe(10);
    const nova = regra({ dono: medA, valor: 50, vigenciaInicio: '2026-06-01' });
    expect(escolherRegraPrecoParticular([rede, nova], pedido())?.valor).toBe(50);
    expect(compararEspecificidade(rede, rede)).toBe(0);
  });
});

describe('decisão 24: convênio não tem preço por médico', () => {
  it('no convênio, a regra particular é ignorada e vale a tabela', () => {
    const rs = [regra({ dono: medA, valor: 999, fontePagadoraId: CONV })];
    const r = resolverPreco({
      particular: false,
      pedido: pedido({ fontePagadoraId: CONV }),
      candidatas: rs,
      tabela: { ...tabela, origem: 'tabela_plano' },
      credenciamento: null,
    });
    expect([r.valor, r.origem, r.regraPrecoParticularId]).toEqual([280, 'tabela_plano', null]);
  });
  it('origem da tabela: conta, plano, convênio', () => {
    expect(origemDaTabela(1, 1, 2)).toBe('tabela_conta');
    expect(origemDaTabela(2, 1, 2)).toBe('tabela_plano');
    expect(origemDaTabela(3, null, null)).toBe('tabela_convenio');
  });
});

describe('decisão 25: credenciamento no cálculo', () => {
  const sem = (efeito: 'alerta' | 'bloqueio'): VerificacaoCredenciamento => ({
    credenciado: false,
    efeito,
    credenciamentoId: null,
    motivo: 'Sem credenciamento.',
  });
  it('alerta: calcula e avisa', () => {
    const r = resolverPreco({
      particular: false,
      pedido: pedido(),
      candidatas: [],
      tabela,
      credenciamento: sem('alerta'),
    });
    expect([r.valor, r.recusa, r.credenciamento?.efeito]).toEqual([280, null, 'alerta']);
    expect(r.explicacao).toContain('Alerta');
  });
  it('bloqueio: recusa profissional-nao-credenciado', () => {
    const r = resolverPreco({
      particular: false,
      pedido: pedido(),
      candidatas: [],
      tabela,
      credenciamento: sem('bloqueio'),
    });
    expect([r.valor, r.recusa]).toEqual([null, 'profissional-nao-credenciado']);
  });
});
