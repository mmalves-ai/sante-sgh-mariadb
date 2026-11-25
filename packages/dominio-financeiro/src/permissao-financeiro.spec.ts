// F3.8, 07-FIN linha 99: regra das permissões do financeiro (escopo de conta por usuário e tipo por perfil e operação).
import { describe, expect, it } from 'vitest';
import {
  conferirEscopoConta,
  conferirTipoLancamento,
  NOMES_OPERACAO_TIPO_LANCAMENTO,
  OPERACOES_TIPO_LANCAMENTO,
  type PedidoEscopoConta,
  type PerfilNoTipoLancamento,
} from './permissao-financeiro.js';

const pedido = (p: Partial<PedidoEscopoConta> = {}): PedidoEscopoConta => ({
  usuario: 10,
  quemMantem: 20,
  consultar: true,
  movimentar: true,
  vigenciaInicio: null,
  vigenciaFim: null,
  ...p,
});
const restrito = (...liberados: number[]): PerfilNoTipoLancamento => ({
  restrito: true,
  concedeOperacao: true,
  liberados,
});
const livre = (concedeOperacao: boolean): PerfilNoTipoLancamento => ({
  restrito: false,
  concedeOperacao,
  liberados: [],
});

describe('escopo de conta do usuário', () => {
  it('aceita consultar e movimentar, só consultar, e retirar (as duas marcas desligadas)', () => {
    expect(conferirEscopoConta(pedido())).toBeNull();
    expect(conferirEscopoConta(pedido({ movimentar: false }))).toBeNull();
    expect(conferirEscopoConta(pedido({ consultar: false, movimentar: false }))).toBeNull();
  });

  it('ninguém altera o próprio escopo, nem para retirar', () => {
    const r = conferirEscopoConta(pedido({ quemMantem: 10 }));
    expect(r?.codigo).toBe('escopo-proprio');
    expect(r?.campos).toEqual(['usuario']);
    expect(conferirEscopoConta(pedido({ quemMantem: 10, consultar: false, movimentar: false }))?.codigo).toBe(
      'escopo-proprio',
    );
  });

  it('movimentar exige consultar', () => {
    const r = conferirEscopoConta(pedido({ consultar: false, movimentar: true }));
    expect(r?.codigo).toBe('escopo-movimentar-sem-consultar');
    expect(r?.campos).toEqual(['consultar']);
  });

  it('a vigência não se inverte; o mesmo dia e a vigência aberta passam', () => {
    expect(
      conferirEscopoConta(pedido({ vigenciaInicio: '2026-11-10', vigenciaFim: '2026-11-09' }))?.codigo,
    ).toBe('escopo-vigencia-invertida');
    expect(
      conferirEscopoConta(pedido({ vigenciaInicio: '2026-11-10', vigenciaFim: '2026-11-10' })),
    ).toBeNull();
    expect(conferirEscopoConta(pedido({ vigenciaInicio: '2026-11-10' }))).toBeNull();
    expect(conferirEscopoConta(pedido({ vigenciaFim: '2026-11-10' }))).toBeNull();
  });

  it('a segregação vem antes das outras recusas', () => {
    const r = conferirEscopoConta(
      pedido({ quemMantem: 10, consultar: false, vigenciaInicio: '2026-11-10', vigenciaFim: '2026-11-01' }),
    );
    expect(r?.codigo).toBe('escopo-proprio');
  });
});

describe('tipo por perfil na operação', () => {
  it('sem perfil restrito (ou sem perfil nenhum), a lista não decide: vale a permissão da operação', () => {
    expect(conferirTipoLancamento([], 7, 'TARIFA')).toBeNull();
    expect(conferirTipoLancamento([livre(true), livre(false)], 7, 'TARIFA')).toBeNull();
  });

  it('perfil restrito lança só o que está na lista', () => {
    expect(conferirTipoLancamento([restrito(7, 8)], 8, 'TARIFA')).toBeNull();
    const r = conferirTipoLancamento([restrito(7, 8)], 9, 'TRANSFERÊNCIA');
    expect(r?.codigo).toBe('tipo-lancamento-nao-liberado');
    expect(r?.campos).toEqual(['tipo']);
    expect(r?.mensagem).toContain('"TRANSFERÊNCIA"');
  });

  it('perfil restrito com a lista vazia não lança nada (retirar o último tipo não devolve tudo)', () => {
    expect(conferirTipoLancamento([restrito()], 7, 'TARIFA')?.codigo).toBe('tipo-lancamento-nao-liberado');
  });

  it('os perfis acumulam: um perfil livre que dá a operação mantém todos os tipos', () => {
    expect(conferirTipoLancamento([restrito(), livre(true)], 7, 'TARIFA')).toBeNull();
  });

  it('perfil livre que não dá a operação não abre o tipo; a lista de outro perfil restrito abre', () => {
    expect(conferirTipoLancamento([restrito(), livre(false)], 7, 'TARIFA')?.codigo).toBe(
      'tipo-lancamento-nao-liberado',
    );
    expect(conferirTipoLancamento([restrito(), restrito(7), livre(false)], 7, 'TARIFA')).toBeNull();
  });

  it('a lista só conta no perfil restrito: tipo guardado em perfil livre que não dá a operação não libera', () => {
    const livreComLista: PerfilNoTipoLancamento = { restrito: false, concedeOperacao: false, liberados: [7] };
    expect(conferirTipoLancamento([restrito(), livreComLista], 7, 'TARIFA')?.codigo).toBe(
      'tipo-lancamento-nao-liberado',
    );
  });

  it('cada operação diz o que foi recusado: movimento, título a pagar, adiantamento e título a receber', () => {
    const de = (o: (typeof NOMES_OPERACAO_TIPO_LANCAMENTO)[number]) =>
      conferirTipoLancamento([restrito()], 3, 'FORNECEDOR', o)?.mensagem ?? '';
    expect(de('banco')).toContain('não lança "FORNECEDOR"');
    expect(de('contas_pagar')).toContain('título a pagar de credor do tipo "FORNECEDOR"');
    expect(de('adiantamento')).toContain('adiantamento a credor do tipo "FORNECEDOR"');
    expect(de('contas_receber')).toContain('título a receber com o documento "FORNECEDOR"');
    for (const o of NOMES_OPERACAO_TIPO_LANCAMENTO) expect(de(o)).toContain('peça a liberação');
  });

  it('o movimento guarda tipo de lançamento; o título a pagar e o adiantamento, tipo de credor', () => {
    expect(NOMES_OPERACAO_TIPO_LANCAMENTO).toEqual([
      'banco',
      'contas_pagar',
      'adiantamento',
      'contas_receber',
    ]);
    expect(OPERACOES_TIPO_LANCAMENTO.banco).toEqual({
      alvo: 'lancamento',
      acao: 'financeiro.movimento.criar',
    });
    expect(OPERACOES_TIPO_LANCAMENTO.contas_pagar.alvo).toBe('credor');
    expect(OPERACOES_TIPO_LANCAMENTO.adiantamento.alvo).toBe('credor');
    expect(OPERACOES_TIPO_LANCAMENTO.contas_receber).toEqual({
      alvo: 'documento',
      acao: 'financeiro.tituloReceber.criar',
    });
    expect(new Set(NOMES_OPERACAO_TIPO_LANCAMENTO.map((o) => OPERACOES_TIPO_LANCAMENTO[o].acao)).size).toBe(
      4,
    );
  });

  it('título a receber: o perfil restrito só emite com o tipo de documento da lista; um perfil livre que dá a operação libera', () => {
    const lista: PerfilNoTipoLancamento = { restrito: true, concedeOperacao: true, liberados: [11] };
    expect(conferirTipoLancamento([lista], 11, 'FATURA', 'contas_receber')).toBeNull();
    expect(conferirTipoLancamento([lista], 12, 'RECIBO', 'contas_receber')?.codigo).toBe(
      'tipo-lancamento-nao-liberado',
    );
    const livre: PerfilNoTipoLancamento = { restrito: false, concedeOperacao: true, liberados: [] };
    expect(conferirTipoLancamento([lista, livre], 12, 'RECIBO', 'contas_receber')).toBeNull();
  });
});
