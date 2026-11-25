import { describe, expect, it } from 'vitest';
import {
  aplicarRetornoErp,
  conferirConciliacaoErp,
  conferirGeracaoLoteErp,
  type ItemAtualErp,
  LAYOUT_CANONICO_ERP,
  montarLoteErp,
  podeTransitarLoteErp,
  type RegistroOrigemErp,
  simularRetornoErp,
} from './fila-erp.js';

const ERP = { ativo: true, categoria: 'erp' };
const reg = (id: number, data: string, valor: number, cpfCnpj: string | null = '12345678000199') =>
  ({
    id,
    numero: `N${id}`,
    documento: `D${id}`,
    data,
    valor,
    cpfCnpj,
    contraparte: 'Fornecedor sintético',
    situacao: 'aberto',
  }) satisfies RegistroOrigemErp;

describe('fila do ERP: geração', () => {
  it('aceita o pedido válido e recusa tipo, sistema e período ruins', () => {
    expect(conferirGeracaoLoteErp({ tipo: 'pagar', inicio: '2026-11-01', fim: '2026-11-30' }, ERP)).toEqual(
      [],
    );
    const c = (e: Parameters<typeof conferirGeracaoLoteErp>[0], s = ERP as typeof ERP | null) =>
      conferirGeracaoLoteErp(e, s).map((x) => x.codigo);
    expect(c({ tipo: 'folha', inicio: '2026-11-01', fim: '2026-11-30' })).toEqual(['tipo-invalido']);
    expect(c({ tipo: 'pagar', inicio: '2026-11-01', fim: '2026-11-30' }, null)).toEqual([
      'sistema-inexistente',
    ]);
    expect(
      c(
        { tipo: 'pagar', inicio: '2026-11-01', fim: '2026-11-30' },
        { ativo: true, categoria: 'laboratorio' },
      ),
    ).toEqual(['sistema-nao-erp']);
    expect(
      c({ tipo: 'pagar', inicio: '2026-11-01', fim: '2026-11-30' }, { ativo: false, categoria: 'erp' }),
    ).toEqual(['sistema-inativo']);
    expect(c({ tipo: 'pagar', inicio: '2026-11-30', fim: '2026-11-01' })).toEqual(['periodo-invertido']);
    expect(c({ tipo: 'pagar', inicio: '2026-01-01', fim: '2026-12-31' })).toEqual(['periodo-longo']);
    expect(c({ tipo: 'pagar', inicio: '01/11/2026', fim: '2026-11-30' })).toEqual(['periodo-invalido']);
  });

  it('monta o lote canônico em ordem de data, sem repetir o já exportado e somando em centavos', () => {
    const l = montarLoteErp(
      'pagar',
      [
        reg(3, '2026-11-05', 0.1),
        reg(1, '2026-11-05', 0.2),
        reg(2, '2026-11-01', 10),
        reg(9, '2026-11-02', 5),
      ],
      new Set([9]),
    );
    expect(l.itens.map((i) => [i.sequencia, i.entidadeId])).toEqual([
      [1, 2],
      [2, 1],
      [3, 3],
    ]);
    expect(l.valorTotal).toBe(10.3);
    expect(l.jaExportados).toBe(1);
    expect(l.itens[0]!.entidade).toBe('titulo_pagar');
    expect(l.itens[0]!.conteudo).toMatchObject({
      layout: LAYOUT_CANONICO_ERP,
      tipo: 'pagar',
      documento: 'D2',
    });
  });

  it('CPF/CNPJ fora do tamanho vira nulo (só dígitos)', () => {
    const l = montarLoteErp(
      'receber',
      [reg(1, '2026-11-01', 1, '123.456.789-09'), reg(2, '2026-11-01', 1, '123')],
      new Set(),
    );
    expect(l.itens.map((i) => i.cpfCnpj)).toEqual(['12345678909', null]);
    expect(montarLoteErp('faturamento', [reg(1, '2026-11-01', 1)], new Set()).itens[0]!.entidade).toBe(
      'fatura_fonte_pagadora',
    );
  });
});

describe('fila do ERP: ciclo, retorno e conciliação', () => {
  const itens: ItemAtualErp[] = [
    { sequencia: 1, situacao: 'pendente', chaveExterna: null, valor: 10 },
    { sequencia: 2, situacao: 'pendente', chaveExterna: null, valor: 5.5 },
  ];

  it('transições permitidas e recusadas', () => {
    expect(podeTransitarLoteErp('gerado', 'enviado')).toBe(true);
    expect(podeTransitarLoteErp('gerado', 'cancelado')).toBe(true);
    expect(podeTransitarLoteErp('enviado', 'cancelado')).toBe(false);
    expect(podeTransitarLoteErp('conciliado', 'cancelado')).toBe(false);
    expect(podeTransitarLoteErp('processado_com_erro', 'conciliado')).toBe(true);
  });

  it('aplica o retorno item a item e é idempotente', () => {
    const r1 = aplicarRetornoErp('enviado', itens, [
      { sequencia: 1, aceito: true, chaveExterna: 'K1', mensagem: null },
    ]);
    expect(r1.situacaoLote).toBe('enviado');
    expect(r1.mudancas).toEqual([
      { sequencia: 1, situacao: 'exportado', chaveExterna: 'K1', mensagem: null },
    ]);
    const depois: ItemAtualErp[] = [{ ...itens[0]!, situacao: 'exportado', chaveExterna: 'K1' }, itens[1]!];
    const r2 = aplicarRetornoErp('enviado', depois, [
      { sequencia: 1, aceito: true, chaveExterna: 'K1', mensagem: null },
      { sequencia: 2, aceito: false, chaveExterna: null, mensagem: 'Sem cadastro' },
      { sequencia: 7, aceito: true, chaveExterna: 'K7', mensagem: null },
    ]);
    expect(r2.repetidos).toBe(1);
    expect(r2.desconhecidos).toEqual([7]);
    expect(r2.situacaoLote).toBe('processado_com_erro');
    expect(r2.quantidadeErros).toBe(1);
    // A chave já gravada não é trocada; aceito sem chave também é conflito.
    const r3 = aplicarRetornoErp(
      'processado_com_erro',
      [{ ...depois[0]! }, { ...itens[1]!, situacao: 'rejeitado' }],
      [
        { sequencia: 1, aceito: true, chaveExterna: 'OUTRA', mensagem: null },
        { sequencia: 2, aceito: true, chaveExterna: '', mensagem: null },
      ],
    );
    expect(r3.conflitos).toEqual([1, 2]);
    expect(r3.mudancas).toEqual([]);
    // O rejeitado corrigido no ERP vira exportado e o lote fica processado.
    const r4 = aplicarRetornoErp(
      'processado_com_erro',
      [{ ...depois[0]! }, { ...itens[1]!, situacao: 'rejeitado' }],
      [{ sequencia: 2, aceito: true, chaveExterna: 'K2', mensagem: null }],
    );
    expect(r4.situacaoLote).toBe('processado');
    expect(() => aplicarRetornoErp('gerado', itens, [])).toThrow(/gerado/);
  });

  it('conciliação exige lote processado, nada pendente e total igual ao aceito', () => {
    const ok: ItemAtualErp[] = [
      { sequencia: 1, situacao: 'exportado', chaveExterna: 'K1', valor: 10.1 },
      { sequencia: 2, situacao: 'rejeitado', chaveExterna: null, valor: 5 },
      { sequencia: 3, situacao: 'exportado', chaveExterna: 'K3', valor: 0.2 },
    ];
    const r = conferirConciliacaoErp('processado_com_erro', ok, 10.3);
    expect(r.erros).toEqual([]);
    expect(r.resumo).toEqual({ exportados: 2, rejeitados: 1, valorExportado: 10.3 });
    expect(conferirConciliacaoErp('processado', ok, 10).erros.map((e) => e.codigo)).toEqual([
      'divergencia-valor',
    ]);
    expect(conferirConciliacaoErp('enviado', itens, null).erros.map((e) => e.codigo)).toEqual([
      'lote-nao-processado',
      'itens-pendentes',
    ]);
  });

  it('o simulador rejeita contraparte sem documento e valor zerado', () => {
    expect(
      simularRetornoErp('ERP-1', 'pagar', [
        { sequencia: 1, cpfCnpj: '12345678000199', valor: 3 },
        { sequencia: 2, cpfCnpj: null, valor: 3 },
        { sequencia: 3, cpfCnpj: '12345678000199', valor: 0 },
      ]).map((x) => [x.aceito, x.chaveExterna]),
    ).toEqual([
      [true, 'SIM-ERP-1-1'],
      [false, null],
      [false, null],
    ]);
    expect(
      simularRetornoErp('ERP-2', 'estoque', [{ sequencia: 1, cpfCnpj: null, valor: 2 }])[0]!.aceito,
    ).toBe(true);
  });
});
