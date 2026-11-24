// Produção do repasse a partir da conta (F3, motores): quando nasce, quantas linhas, base e estorno. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  competenciaDoDebito,
  estornoDaProducao,
  funcaoTitular,
  geraNoEvento,
  type ItemContaProducao,
  momentoDoParametro,
  type ProducaoGravada,
  producoesDoItem,
  somarProducao,
} from './producao.js';

const item = (p: Partial<ItemContaProducao> = {}): ItemContaProducao => ({
  id: 9,
  situacao: 'lancado',
  excluido: false,
  quantidade: 1,
  valorTotal: 500,
  valorHonorario: 0,
  valorGlosado: 0,
  pertencePacote: false,
  executante: 77,
  funcao: null,
  participantes: [],
  ...p,
});

const gravada = (p: Partial<ProducaoGravada> = {}): ProducaoGravada => ({
  situacao: 'pendente',
  integrada: false,
  baseCentavos: 50_000,
  baseOriginalCentavos: 50_000,
  repassadoCentavos: 35_000,
  jaEstornadoCentavos: 0,
  vigente: true,
  competenciaDebito: '2026-11',
  ...p,
});

describe('momento da produção', () => {
  it('lançamento gera só com a regra "lancamento"; o fechamento completa nas duas; a mudança completa na regra lançamento ou com a conta fechada', () => {
    expect(geraNoEvento('lancamento', 'lancamento')).toBe(true);
    expect(geraNoEvento('fechamento', 'lancamento')).toBe(false);
    expect(geraNoEvento('fechamento', 'fechamento')).toBe(true);
    expect(geraNoEvento('lancamento', 'fechamento')).toBe(true);
    expect(geraNoEvento('lancamento', 'mudanca-item')).toBe(true);
    expect(geraNoEvento('fechamento', 'mudanca-item')).toBe(false);
    expect(geraNoEvento('fechamento', 'mudanca-item', true)).toBe(true);
  });
  it('parâmetro fora da lista volta ao lançamento', () => {
    expect(momentoDoParametro('fechamento')).toBe('fechamento');
    expect(momentoDoParametro(' x ')).toBe('lancamento');
    expect(momentoDoParametro(null)).toBe('lancamento');
  });
});

describe('produções do item', () => {
  it('titular: a ativa de tipo cirurgião ou clínico de menor ordem', () => {
    expect(
      funcaoTitular([
        { id: 5, tipo: 'auxiliar', ativo: true, ordem: 0 },
        { id: 4, tipo: 'clinico', ativo: false, ordem: 0 },
        { id: 3, tipo: 'clinico', ativo: true, ordem: 2 },
        { id: 2, tipo: 'cirurgiao', ativo: true, ordem: 1 },
      ]),
    ).toBe(2);
    expect(funcaoTitular([{ id: 5, tipo: 'auxiliar', ativo: true, ordem: 0 }])).toBeNull();
  });
  it('executor na função do item ou na titular; base no honorário quando a tabela separa', () => {
    expect(producoesDoItem(item(), 11).producoes).toEqual([
      { profissional: 77, prestador: null, funcao: 11, quantidade: 1, baseCentavos: 50_000 },
    ]);
    expect(producoesDoItem(item({ funcao: 12, valorHonorario: 320.5 }), 11).producoes[0]).toMatchObject({
      funcao: 12,
      baseCentavos: 32_050,
    });
  });
  it('pendências: sem executor e sem função titular', () => {
    expect(producoesDoItem(item({ executante: null }), 11)).toEqual({ producoes: [], pendencia: 'sem-executante' });
    expect(producoesDoItem(item(), null).pendencia).toBe('sem-funcao-titular');
  });
  it('equipe: uma por participante pago pelo hospital, com o recebedor e a base do participante', () => {
    const r = producoesDoItem(
      item({
        participantes: [
          { profissional: 1, funcao: 11, recebedor: 900, forma: 'via_hospital', valorBaseRepasse: 300, valorAto: 350 },
          { profissional: 2, funcao: 13, recebedor: null, forma: 'via_hospital', valorBaseRepasse: null, valorAto: 90 },
          { profissional: 3, funcao: 14, recebedor: null, forma: 'direto_fonte_pagadora', valorBaseRepasse: null, valorAto: 60 },
        ],
      }),
      11,
    );
    expect(r.producoes.map((p) => [p.profissional, p.prestador, p.funcao, p.baseCentavos])).toEqual([
      [1, 900, 11, 30_000],
      [2, null, 13, 9_000],
    ]);
  });
  it('item estornado, sem cobrança, transferido ou excluído não gera', () => {
    for (const situacao of ['estornado', 'sem_cobranca', 'transferido'])
      expect(producoesDoItem(item({ situacao }), 11).producoes).toEqual([]);
    expect(producoesDoItem(item({ excluido: true }), 11).producoes).toEqual([]);
  });
});

describe('estorno da produção', () => {
  it('item estornado: antes da apuração estorna; depois, débito do restante no período seguinte', () => {
    expect(estornoDaProducao(item({ situacao: 'estornado' }), gravada(), true)).toEqual({ acao: 'estornar' });
    expect(
      estornoDaProducao(item({ situacao: 'estornado' }), gravada({ integrada: true, jaEstornadoCentavos: 5_000 }), true),
    ).toEqual({ acao: 'debitar', valorCentavos: 30_000, competencia: '2026-11', motivo: 'ajuste', encerrar: true });
  });
  it('produção já estornada ou cancelada não muda (idempotente)', () => {
    expect(estornoDaProducao(item({ situacao: 'estornado' }), gravada({ situacao: 'estornado' }), true)).toEqual({
      acao: 'nada',
    });
  });
  it('glosa antes da apuração: total estorna, parcial reduz a base a partir da original', () => {
    expect(estornoDaProducao(item({ situacao: 'glosado', valorGlosado: 500 }), gravada(), true)).toEqual({
      acao: 'estornar',
    });
    expect(estornoDaProducao(item({ situacao: 'glosado', valorGlosado: 100 }), gravada(), true)).toEqual({
      acao: 'reduzir',
      baseCentavos: 40_000,
    });
    expect(
      estornoDaProducao(item({ situacao: 'glosado', valorGlosado: 100 }), gravada({ baseCentavos: 40_000 }), true),
    ).toEqual({ acao: 'nada' });
  });
  it('glosa depois da apuração: débito proporcional, nunca acima do repassado; desligado não estorna', () => {
    const r = estornoDaProducao(
      item({ situacao: 'glosado', valorGlosado: 100 }),
      gravada({ integrada: true, situacao: 'apurado' }),
      true,
    );
    expect(r).toEqual({ acao: 'debitar', valorCentavos: 7_000, competencia: '2026-11', motivo: 'glosa', encerrar: false });
    expect(
      estornoDaProducao(
        item({ situacao: 'glosado', valorGlosado: 100 }),
        gravada({ integrada: true, situacao: 'apurado', jaEstornadoCentavos: 7_000 }),
        true,
      ),
    ).toEqual({ acao: 'nada' });
    expect(estornoDaProducao(item({ situacao: 'glosado', valorGlosado: 100 }), gravada(), false)).toEqual({
      acao: 'nada',
    });
  });
});

describe('produção que o item não gera mais', () => {
  it('participante removido ou pago fora do hospital: antes da apuração estorna; depois, débito do restante', () => {
    expect(estornoDaProducao(item(), gravada({ vigente: false }), true)).toEqual({ acao: 'estornar' });
    expect(estornoDaProducao(item(), gravada({ vigente: false, situacao: 'estornado' }), true)).toEqual({
      acao: 'nada',
    });
    expect(
      estornoDaProducao(item(), gravada({ vigente: false, integrada: true, situacao: 'apurado' }), true),
    ).toEqual({ acao: 'debitar', valorCentavos: 35_000, competencia: '2026-11', motivo: 'ajuste', encerrar: true });
    expect(
      estornoDaProducao(
        item(),
        gravada({ vigente: false, integrada: true, situacao: 'estornado', jaEstornadoCentavos: 35_000 }),
        true,
      ),
    ).toEqual({ acao: 'nada' });
  });
});

describe('glosa revertida (recurso aceito)', () => {
  it('antes da apuração: a base volta à original; a estornada pela glosa total volta a pendente', () => {
    expect(estornoDaProducao(item({ valorGlosado: 0 }), gravada({ baseCentavos: 40_000 }), true)).toEqual({
      acao: 'reduzir',
      baseCentavos: 50_000,
    });
    expect(estornoDaProducao(item({ valorGlosado: 0 }), gravada({ situacao: 'estornado' }), true)).toEqual({
      acao: 'reativar',
      baseCentavos: 50_000,
    });
    expect(estornoDaProducao(item({ valorGlosado: 250 }), gravada({ situacao: 'estornado' }), true)).toEqual({
      acao: 'reativar',
      baseCentavos: 25_000,
    });
    // O item estornado não volta: a produção estornada fica como está.
    expect(estornoDaProducao(item({ situacao: 'estornado' }), gravada({ situacao: 'estornado' }), true)).toEqual({
      acao: 'nada',
    });
  });
  it('depois da apuração: o débito a mais é desfeito; a estornada pela glosa total volta a apurado', () => {
    expect(
      estornoDaProducao(
        item({ valorGlosado: 0 }),
        gravada({ integrada: true, situacao: 'apurado', jaEstornadoCentavos: 7_000 }),
        true,
      ),
    ).toEqual({ acao: 'creditar', valorCentavos: 7_000, competencia: '2026-11', reabrir: false });
    expect(
      estornoDaProducao(
        item({ valorGlosado: 100 }),
        gravada({ integrada: true, situacao: 'estornado', jaEstornadoCentavos: 35_000 }),
        true,
      ),
    ).toEqual({ acao: 'creditar', valorCentavos: 28_000, competencia: '2026-11', reabrir: true });
    expect(
      estornoDaProducao(
        item({ valorGlosado: 500 }),
        gravada({ integrada: true, situacao: 'estornado', jaEstornadoCentavos: 35_000 }),
        true,
      ),
    ).toEqual({ acao: 'nada' });
  });
});

describe('competência do débito', () => {
  it('o primeiro período aberto a partir do seguinte ao da conta e do mês do evento', () => {
    expect(competenciaDoDebito('2026-10', '2026-10', new Set())).toBe('2026-11');
    expect(competenciaDoDebito('2026-06', '2026-11', new Set())).toBe('2026-11');
    expect(competenciaDoDebito('2026-06', '2026-11', new Set(['2026-11', '2026-12']))).toBe('2027-01');
    expect(competenciaDoDebito('2026-12', '2026-12', new Set(['2027-01']))).toBe('2027-02');
  });
});

describe('soma da apuração', () => {
  it('soma as produções que valem, fora as estornadas e canceladas', () => {
    expect(
      somarProducao([
        { baseCentavos: 50_000, repasseCentavos: 35_000, situacao: 'pendente' },
        { baseCentavos: 20_000, repasseCentavos: 10_000, situacao: 'estornado' },
        { baseCentavos: 10_000, repasseCentavos: 7_000, situacao: 'apurado' },
      ]),
    ).toEqual({ itens: 2, baseCentavos: 60_000, repasseCentavos: 42_000 });
  });
});
