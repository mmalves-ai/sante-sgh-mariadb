import { describe, expect, it } from 'vitest';
import {
  type EntradaAdiantamento,
  extratoContaCorrente,
  planejarAplicacao,
  situacaoPeloSaldo,
  validarAdiantamento,
  validarDevolucao,
} from './adiantamento-paciente.js';
import { montarOrcamentoDoModelo, validarModelo } from './modelo-orcamento.js';

const base: EntradaAdiantamento = {
  tipo: 'adiantamento',
  valor: 500,
  forma: 'dinheiro',
  parcelas: 1,
  comprovante: null,
  conectorEletronico: false,
  atendimentoUrgencia: false,
  declaracaoVoluntaria: false,
  pagadorNome: null,
  pagadorCpf: null,
  pacienteEhPagador: true,
};

describe('adiantamento do paciente (06-FAT linha 39)', () => {
  it('aceita o recebimento simples e recusa valor, parcelas e comprovante faltando', () => {
    expect(validarAdiantamento(base)).toEqual({});
    expect(Object.keys(validarAdiantamento({ ...base, valor: 0 }))).toEqual(['valor']);
    expect(validarAdiantamento({ ...base, valor: 10.555 })['valor']).toMatch(/duas casas/);
    expect(validarAdiantamento({ ...base, parcelas: 3 })['parcelas']).toMatch(/crédito/);
    expect(validarAdiantamento({ ...base, forma: 'pix' })['comprovante']).toBeDefined();
    expect(validarAdiantamento({ ...base, forma: 'pix', conectorEletronico: true })).toEqual({});
    expect(validarAdiantamento({ ...base, forma: 'cartao_credito', parcelas: 3, comprovante: 'A1' })).toEqual(
      {},
    );
    expect(validarAdiantamento({ ...base, forma: 'transferencia' })['comprovante']).toBeDefined();
  });
  it('veda a caução exigida na urgência (Lei 12.653) e aceita a declaração voluntária', () => {
    const c = { ...base, tipo: 'caucao' as const, atendimentoUrgencia: true };
    expect(validarAdiantamento(c)['declaracaoVoluntaria']).toBeDefined();
    expect(validarAdiantamento({ ...c, declaracaoVoluntaria: true })).toEqual({});
    expect(validarAdiantamento({ ...base, atendimentoUrgencia: true })).toEqual({});
  });
  it('pede o pagador quando não é o paciente e confere o CPF', () => {
    expect(validarAdiantamento({ ...base, pacienteEhPagador: false })['pagadorNome']).toBeDefined();
    expect(validarAdiantamento({ ...base, pagadorCpf: '123' })['pagadorCpf']).toBeDefined();
  });
  it('situação pelo saldo', () => {
    expect(situacaoPeloSaldo(100, 100, false)).toBe('ativo');
    expect(situacaoPeloSaldo(100, 40, false)).toBe('aplicado_parcial');
    expect(situacaoPeloSaldo(100, 0, false)).toBe('aplicado');
    expect(situacaoPeloSaldo(100, 0, true)).toBe('devolvido');
  });
  it('aplica do mais antigo para o mais novo, até a dívida da conta ou o valor pedido', () => {
    const saldos = [
      { id: 2, saldo: 300, recebidoEm: '2026-11-10', situacao: 'ativo' as const, jaNaConta: false },
      {
        id: 1,
        saldo: 100,
        recebidoEm: '2026-11-01',
        situacao: 'aplicado_parcial' as const,
        jaNaConta: false,
      },
      { id: 3, saldo: 50, recebidoEm: '2026-11-12', situacao: 'cancelado' as const, jaNaConta: false },
    ];
    const tudo = planejarAplicacao(saldos, 250, null);
    expect(tudo.erros).toEqual({});
    expect(tudo.parcelas).toEqual([
      { adiantamento: 1, valor: 100 },
      { adiantamento: 2, valor: 150 },
    ]);
    expect(tudo.total).toBe(250);
    expect(planejarAplicacao(saldos, 1000, null).total).toBe(400);
    expect(planejarAplicacao(saldos, 1000, 80).parcelas).toEqual([{ adiantamento: 1, valor: 80 }]);
    expect(planejarAplicacao(saldos, 1000, 500).erros['valor']).toMatch(/400\.00/);
    expect(planejarAplicacao(saldos, 50, 80).erros['valor']).toMatch(/deve/);
    expect(planejarAplicacao(saldos, 0, null).erros['conta']).toBeDefined();
    expect(planejarAplicacao([], 10, null).erros['adiantamentos']).toBeDefined();
    expect(planejarAplicacao(saldos, 1000, null, [2]).parcelas).toEqual([{ adiantamento: 2, valor: 300 }]);
    expect(planejarAplicacao(saldos, 1000, null, [3]).erros['adiantamentos']).toBeDefined();
  });
  it('devolução até o saldo, com favorecido, motivo e chave Pix', () => {
    const d = {
      saldo: 100,
      situacao: 'aplicado_parcial' as const,
      valor: 100,
      favorecidoNome: 'X',
      favorecidoCpf: null,
      forma: 'dinheiro' as const,
      chavePix: null,
      motivo: 'alta',
    };
    expect(validarDevolucao(d)).toEqual({});
    expect(validarDevolucao({ ...d, valor: 101 })['valor']).toBeDefined();
    expect(validarDevolucao({ ...d, forma: 'pix' })['chavePix']).toBeDefined();
    expect(validarDevolucao({ ...d, forma: 'cartao_debito' })['forma']).toBeDefined();
    expect(validarDevolucao({ ...d, situacao: 'devolvido' })['adiantamento']).toBeDefined();
    expect(validarDevolucao({ ...d, motivo: ' ', favorecidoNome: '' })).toHaveProperty('motivo');
  });
  it('extrato da conta corrente com saldo corrido', () => {
    const x = extratoContaCorrente([
      { tipo: 'aplicacao', data: '2026-11-03', valor: 70, referencia: 'C1', adiantamento: 1 },
      { tipo: 'adiantamento', data: '2026-11-01', valor: 100, referencia: 'A1', adiantamento: 1 },
      { tipo: 'estorno_aplicacao', data: '2026-11-04', valor: 20, referencia: 'C1', adiantamento: 1 },
      { tipo: 'devolucao', data: '2026-11-05', valor: 50, referencia: 'D1', adiantamento: 1 },
    ]);
    expect(x.linhas.map((l) => l.saldo)).toEqual([100, 30, 50, 0]);
    expect([x.creditos, x.debitos, x.saldo]).toEqual([120, 120, 0]);
  });
});

describe('modelo de orçamento (06-FAT linha 40)', () => {
  const modelo = {
    codigo: 'COLE-APTO',
    descricao: 'Colecistectomia em apartamento',
    procedimentoId: 10,
    acomodacaoId: 2,
    quantidade: 1,
    valorFechado: null,
    administracao: 10,
    acrescimo: 4,
    validadeDias: 15,
    itens: [
      {
        tipo: 'diaria' as const,
        itemId: 20,
        funcaoId: null,
        profissionalId: null,
        quantidade: 2,
        unitario: null,
        acrescimo: null,
      },
      {
        tipo: 'honorario' as const,
        itemId: null,
        funcaoId: 5,
        profissionalId: 7,
        quantidade: 1,
        unitario: null,
        acrescimo: null,
      },
      {
        tipo: 'taxa' as const,
        itemId: 21,
        funcaoId: null,
        profissionalId: null,
        quantidade: 1,
        unitario: 50,
        acrescimo: 10,
      },
    ],
  };
  it('valida o cadastro com erro por campo e por item', () => {
    expect(validarModelo(modelo)).toEqual({});
    const e = validarModelo({
      ...modelo,
      codigo: 'com espaço',
      administracao: 120,
      validadeDias: 0,
      itens: [{ ...modelo.itens[1]!, funcaoId: null }, modelo.itens[0]!, modelo.itens[0]!],
    });
    expect(Object.keys(e).sort()).toEqual(
      ['administracao', 'codigo', 'itens.0.funcaoId', 'itens.2.itemId', 'validadeDias'].sort(),
    );
  });
  it('monta pelo preço da tabela, honorário pela função, administração e acréscimo', () => {
    const o = montarOrcamentoDoModelo({ ...modelo, precoPrincipal: 1000 }, [
      { ...modelo.itens[0]!, precoTabela: 300, percentualFuncao: null },
      { ...modelo.itens[1]!, precoTabela: null, percentualFuncao: 30 },
      { ...modelo.itens[2]!, precoTabela: 999, percentualFuncao: null },
    ]);
    expect(o.linhas.map((l) => l.total)).toEqual([1000, 600, 300, 55]);
    expect(o.bruto).toBe(1955);
    expect(o.administracao).toBe(165.5); // (1955 − 300) × 10%
    expect(o.acrescimo).toBe(84.82); // (1955 + 165,5) × 4%
    expect(o.total).toBe(2205.32);
    expect(o.semPreco).toEqual([]);
    expect(o.validadeDias).toBe(15);
  });
  it('item sem preço fica com zero e é apontado; valor fechado vira pacote com a parte de cada um', () => {
    const sem = montarOrcamentoDoModelo({ ...modelo, precoPrincipal: null, validadeDias: null }, [
      { ...modelo.itens[0]!, precoTabela: null, percentualFuncao: null },
    ]);
    expect(sem.semPreco).toEqual([1, 2]);
    expect(sem.validadeDias).toBe(30);
    const p = montarOrcamentoDoModelo({ ...modelo, valorFechado: 1500, precoPrincipal: 1000 }, [
      { ...modelo.itens[0]!, precoTabela: 250, percentualFuncao: null },
    ]);
    expect(p.total).toBe(1500);
    expect(p.linhas[0]).toMatchObject({ tipo: 'pacote', total: 1500 });
    expect(p.linhas.slice(1).map((l) => l.valorPacote)).toEqual([1000, 500]);
    expect(p.linhas.slice(1).every((l) => l.total === 0)).toBe(true);
  });
});
