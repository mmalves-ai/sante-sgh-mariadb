// Regra do reembolso ao beneficiário (08-SGO linha 106, C2-047): pedido, tabela por município, limite do item, análise
// com glosa e tetos, prazo legal e passagens de situação. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  analisarReembolso,
  diasParaOPrazo,
  documentoValido,
  escolherTabelaReferencia,
  limiteDoItem,
  podePassarReembolso,
  prazoDoReembolso,
  problemasDaRegraReembolso,
  problemasDoPedidoReembolso,
  REGRA_REEMBOLSO_SEM_CADASTRO,
  type TabelaReferenciaCandidata,
  tipoPessoaDoDocumento,
} from './reembolso.js';

const pedido = {
  beneficiario: 1,
  canal: 'presencial' as const,
  prestadorNome: 'CLINICA SINTETICA',
  prestadorDocumento: '11.222.333/0001-81',
  dataAtendimento: '2026-11-10',
  dataAlta: null,
  numeroDocumentoFiscal: 'NF-1',
  itens: [{ procedimento: 1, quantidade: 1, valorApresentado: 300, dataRealizacao: '2026-11-10' }],
};

describe('pedido de reembolso', () => {
  it('confere CPF e CNPJ pelo dígito', () => {
    expect(documentoValido('529.982.247-25')).toBe(true);
    expect(documentoValido('529.982.247-24')).toBe(false);
    expect(documentoValido('11111111111')).toBe(false);
    expect(documentoValido('11222333000181')).toBe(true);
    expect(documentoValido('11222333000182')).toBe(false);
    expect(tipoPessoaDoDocumento('52998224725')).toBe('fisica');
    expect(tipoPessoaDoDocumento('11222333000181')).toBe('juridica');
  });
  it('aceita o pedido completo e exige comprovante anexado', () => {
    expect(problemasDoPedidoReembolso(pedido, '2026-11-25', 1)).toEqual([]);
    expect(problemasDoPedidoReembolso(pedido, '2026-11-25', 0)).toEqual([
      { codigo: 'comprovante-obrigatorio', campo: 'anexos' },
    ]);
  });
  it('recusa data futura, alta antes do atendimento, item sem valor e documento errado', () => {
    const p = problemasDoPedidoReembolso(
      {
        ...pedido,
        prestadorDocumento: '123',
        dataAtendimento: '2026-12-01',
        dataAlta: '2026-11-01',
        itens: [{ procedimento: 1, quantidade: 0, valorApresentado: 0, dataRealizacao: null }],
      },
      '2026-11-25',
      1,
    ).map((x) => x.codigo);
    expect(p).toEqual([
      'documento-invalido',
      'data-atendimento-invalida',
      'alta-antes-do-atendimento',
      'quantidade-invalida',
      'valor-invalido',
    ]);
    expect(problemasDoPedidoReembolso({ ...pedido, itens: [] }, '2026-11-25', 1)[0]?.codigo).toBe(
      'itens-obrigatorios',
    );
  });
});

describe('tabela de referência por município', () => {
  const t = (id: number, x: Partial<TabelaReferenciaCandidata>): TabelaReferenciaCandidata => ({
    id,
    municipio: null,
    produto: null,
    modalidade: null,
    padrao: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    ativo: true,
    ...x,
  });
  const tabelas = [
    t(1, { padrao: true }),
    t(2, { municipio: 10 }),
    t(3, { municipio: 10, produto: 5 }),
    t(4, { municipio: 20 }),
    t(5, { municipio: 10, produto: 5, vigenciaInicio: '2026-02-01', vigenciaFim: '2026-06-30' }),
    t(6, { municipio: 10, produto: 5, ativo: false }),
  ];
  const alvo = { municipio: 10, produto: 5, modalidade: null, data: '2026-11-10' };
  it('a do município e do produto ganha; fora da vigência ou inativa não vale', () => {
    expect(escolherTabelaReferencia(tabelas, alvo)?.id).toBe(3);
    expect(escolherTabelaReferencia(tabelas, { ...alvo, data: '2026-03-01' })?.id).toBe(5);
  });
  it('sem a do município, a padrão; sem nenhuma, nada', () => {
    expect(escolherTabelaReferencia(tabelas, { ...alvo, municipio: 30 })?.id).toBe(1);
    expect(escolherTabelaReferencia(tabelas, { ...alvo, produto: 9 })?.id).toBe(2);
    expect(escolherTabelaReferencia([], alvo)).toBeNull();
  });
  it('a de outra modalidade não vale', () => {
    expect(escolherTabelaReferencia([t(7, { modalidade: 2 })], alvo)).toBeNull();
    expect(escolherTabelaReferencia([t(7, { modalidade: 2 })], { ...alvo, modalidade: 2 })?.id).toBe(7);
  });
});

describe('limite do item e regra do plano', () => {
  const regra = { ...REGRA_REEMBOLSO_SEM_CADASTRO, multiplicador: 1.5 };
  it('referência × multiplicador × quantidade (até a máxima), nunca acima do apresentado', () => {
    expect(
      limiteDoItem({ quantidade: 2, valorApresentado: 500 }, { valor: 100, quantidadeMaxima: null }, regra),
    ).toBe(300);
    expect(
      limiteDoItem({ quantidade: 3, valorApresentado: 500 }, { valor: 100, quantidadeMaxima: 1 }, regra),
    ).toBe(150);
    expect(
      limiteDoItem({ quantidade: 1, valorApresentado: 80 }, { valor: 100, quantidadeMaxima: null }, regra),
    ).toBe(80);
  });
  it('sem referência: percentual do plano; sem percentual: o apresentado', () => {
    expect(limiteDoItem({ quantidade: 1, valorApresentado: 200 }, null, { ...regra, percentual: 70 })).toBe(
      140,
    );
    expect(limiteDoItem({ quantidade: 1, valorApresentado: 200 }, null, regra)).toBe(200);
  });
  it('a regra exige base, multiplicador positivo e prazo dentro do legal', () => {
    expect(problemasDaRegraReembolso({ ...regra, tabela: 1 })).toEqual([]);
    expect(
      problemasDaRegraReembolso({ ...regra, tabela: null, multiplicador: 0, prazoPagamentoDias: 45 }).map(
        (p) => p.codigo,
      ),
    ).toEqual(['multiplicador-invalido', 'base-obrigatoria', 'prazo-acima-do-legal']);
  });
});

describe('análise com glosa por item e tetos', () => {
  const r = REGRA_REEMBOLSO_SEM_CADASTRO;
  const item = (
    id: number,
    limite: number,
    glosas: { motivo: number; valor: number }[] = [],
    copart = 0,
  ) => ({
    id,
    valorApresentado: limite + 50,
    valorLimite: limite,
    glosas: glosas.map((g) => ({ ...g, justificativa: null })),
    coparticipacao: copart,
  });
  it('sem glosa nem teto: aprovado pelo limite', () => {
    const a = analisarReembolso([item(1, 100), item(2, 200)], r, 0);
    expect(a).toMatchObject({
      situacao: 'aprovado',
      valorReembolsado: 300,
      valorGlosado: 0,
      valorApresentado: 400,
    });
    expect(a.itens.map((i) => i.situacao)).toEqual(['aprovado', 'aprovado']);
  });
  it('glosa num item e coparticipação: aprovado parcial', () => {
    const a = analisarReembolso(
      [item(1, 100, [{ motivo: 9, valor: 100 }]), item(2, 200, [{ motivo: 9, valor: 50 }], 20)],
      r,
      0,
    );
    expect(a).toMatchObject({
      situacao: 'aprovado_parcial',
      valorReembolsado: 130,
      valorGlosado: 150,
      valorCoparticipacao: 20,
    });
    expect(a.itens.map((i) => i.situacao)).toEqual(['glosado', 'parcial']);
    expect(a.problemas).toEqual([]);
  });
  it('tudo glosado: negado; glosa acima do limite e sem motivo são problemas', () => {
    expect(analisarReembolso([item(1, 100, [{ motivo: 9, valor: 100 }])], r, 0).situacao).toBe('negado');
    expect(
      analisarReembolso([item(1, 100, [{ motivo: 0, valor: 150 }])], r, 0).problemas.map((p) => p.codigo),
    ).toEqual(['motivo-obrigatorio', 'glosa-acima-do-limite']);
  });
  it('teto por evento e saldo do teto anual cortam do último item', () => {
    const e = analisarReembolso([item(1, 100), item(2, 200)], { ...r, limitePorEvento: 250 }, 0);
    expect(e).toMatchObject({ valorReembolsado: 250, cortePorTeto: 50, situacao: 'aprovado_parcial' });
    expect(e.itens.map((i) => i.valorReembolsado)).toEqual([100, 150]);
    const anual = analisarReembolso([item(1, 100), item(2, 200)], { ...r, limiteAnual: 1000 }, 900);
    expect(anual.valorReembolsado).toBe(100);
    expect(analisarReembolso([item(1, 100)], { ...r, limiteAnual: 1000 }, 1000).situacao).toBe('negado');
  });
});

describe('prazo legal e situação', () => {
  it('30 dias do pedido; a regra pode encurtar, nunca alongar', () => {
    expect(prazoDoReembolso('2026-11-10T14:00:00')).toBe('2026-12-10');
    expect(prazoDoReembolso('2026-11-10', 10)).toBe('2026-11-20');
    expect(prazoDoReembolso('2026-11-10', 60)).toBe('2026-12-10');
    expect(diasParaOPrazo('2026-12-10', '2026-12-12')).toBe(-2);
  });
  it('pago, negado e cancelado não mudam mais; só aprovado vai a pago', () => {
    expect(podePassarReembolso('aprovado', 'pago')).toBe(true);
    expect(podePassarReembolso('em_analise', 'pago')).toBe(false);
    expect(podePassarReembolso('pago', 'cancelado')).toBe(false);
    expect(podePassarReembolso('pendente_documento', 'em_analise')).toBe(true);
  });
});
