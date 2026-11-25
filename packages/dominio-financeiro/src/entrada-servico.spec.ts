// F7, 09-AREA linha 78 (C2-094): regras da entrada de serviço tomado (pedido, câmbio, retenções e cancelamento).
import { describe, expect, it } from 'vitest';
import {
  calcularRetencoesEntrada,
  campoDoTributo,
  conferirCancelamentoEntrada,
  conferirConclusaoEntrada,
  conferirTituloDaEntrada,
  conferirEntradaServico,
  type EntradaServicoProposta,
  type ItemEntradaServico,
  liquidoEntrada,
  ratear,
  totaisReinf,
  valorBrutoEntrada,
} from './entrada-servico.js';
import { type RegraRetencao, sugerirRetencoes } from './retencao-regra.js';

const item = (x: Partial<ItemEntradaServico> = {}): ItemEntradaServico => ({
  quantidade: 1,
  valorUnitario: 1000,
  valorDesconto: 0,
  servico: 7,
  pedidoItem: 70,
  inssNaoRetido: 0,
  processoJudicial: null,
  ...x,
});
const base = (x: Partial<EntradaServicoProposta> = {}): EntradaServicoProposta => ({
  fornecedor: 1,
  dataEmissao: '2026-09-05',
  dataEntrada: '2026-09-08',
  competencia: '2026-09',
  itens: [item()],
  pedido: {
    id: 9,
    fornecedor: 1,
    situacao: 'aprovado',
    natureza: 'servico',
    itens: [{ id: 70, servico: 7, quantidade: 2, recebida: 0, cancelada: 0, valorUnitario: 1000 }],
  },
  issRetido: false,
  aliquotaIss: null,
  cambio: null,
  ...x,
});
const regra = (
  tributo: string,
  aliquota: number,
  minimo = 10,
  codigoReceita: string | null = null,
): RegraRetencao => ({
  id: aliquota * 100,
  tributo,
  momento: 'emissao',
  participante: 'todos',
  municipio: null,
  percentualBase: 100,
  aliquota,
  faixaInicio: null,
  faixaFim: null,
  deducao: 0,
  minimo,
  maximo: null,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ativo: true,
  codigoReceita,
});

describe('entrada de serviço tomado: conferência', () => {
  it('aceita a nota contra o pedido aprovado, no saldo e no preço', () => {
    expect(conferirEntradaServico(base())).toBeNull();
  });
  it('recusa pedido de outro fornecedor, fechado, de produto, item fora, saldo e preço acima', () => {
    const ped = base().pedido!;
    expect(conferirEntradaServico(base({ fornecedor: 2 }))?.codigo).toBe('pedido-outro-fornecedor');
    expect(conferirEntradaServico(base({ pedido: { ...ped, situacao: 'recebido' } }))?.codigo).toBe(
      'pedido-fechado',
    );
    expect(conferirEntradaServico(base({ pedido: { ...ped, natureza: 'produto' } }))?.codigo).toBe(
      'pedido-de-produto',
    );
    expect(conferirEntradaServico(base({ itens: [item({ pedidoItem: 71 })] }))?.codigo).toBe(
      'item-fora-do-pedido',
    );
    expect(conferirEntradaServico(base({ itens: [item({ servico: 8 })] }))?.codigo).toBe('servico-diferente');
    expect(conferirEntradaServico(base({ itens: [item({ quantidade: 2 }), item()] }))?.codigo).toBe(
      'acima-do-saldo',
    );
    expect(conferirEntradaServico(base({ itens: [item({ valorUnitario: 1000.5 })] }))?.codigo).toBe(
      'acima-do-preco',
    );
    expect(conferirEntradaServico(base({ pedido: null }))?.codigo).toBe('item-sem-pedido');
    expect(conferirEntradaServico(base({ pedido: null, itens: [item({ pedidoItem: null })] }))).toBeNull();
  });
  it('recusa datas, competência, INSS sem processo, ISS fora da faixa e câmbio que não fecha', () => {
    expect(conferirEntradaServico(base({ dataEntrada: '2026-09-01' }))?.codigo).toBe('datas-invertidas');
    expect(conferirEntradaServico(base({ competencia: '2026-10' }))?.codigo).toBe('competencia-futura');
    expect(conferirEntradaServico(base({ competencia: '2026-08' }))?.codigo).toBe('competencia-anterior');
    expect(conferirEntradaServico(base({ itens: [item({ inssNaoRetido: 5 })] }))?.codigo).toBe(
      'sem-processo',
    );
    expect(conferirEntradaServico(base({ issRetido: true }))?.codigo).toBe('iss-sem-aliquota');
    expect(conferirEntradaServico(base({ issRetido: true, aliquotaIss: 6 }))?.codigo).toBe(
      'iss-fora-da-faixa',
    );
    expect(conferirEntradaServico(base({ issRetido: true, aliquotaIss: 5 }))).toBeNull();
    expect(conferirEntradaServico(base({ cambio: { taxa: 5, valorMoeda: 200 } }))).toBeNull();
    expect(conferirEntradaServico(base({ cambio: { taxa: 5, valorMoeda: 150 } }))?.codigo).toBe(
      'cambio-nao-fecha',
    );
    expect(conferirEntradaServico(base({ cambio: { taxa: 0, valorMoeda: 0 } }))?.codigo).toBe(
      'cambio-invalido',
    );
  });
  it('soma os itens com desconto e recusa o desconto acima do valor', () => {
    expect(valorBrutoEntrada([item({ quantidade: 1.5, valorUnitario: 333.3333, valorDesconto: 0.5 })])).toBe(
      499.5,
    );
    expect(conferirEntradaServico(base({ itens: [item({ valorDesconto: 1001 })] }))?.codigo).toBe(
      'valor-invalido',
    );
  });
});

describe('entrada de serviço tomado: retenções', () => {
  const regras = [
    regra('IRRF', 1.5),
    regra('INSS', 11, 29),
    regra('PIS', 0.65, 10, '5952'),
    regra('COFINS', 3, 10, '5952'),
    regra('CSLL', 1, 10, '5952'),
    regra('ISS', 5),
  ];
  const fato = (valorBruto: number) => ({
    data: '2026-09-05',
    valorBruto,
    momento: 'emissao' as const,
    participante: 'pessoa_juridica' as const,
    municipio: null,
  });
  it('calcula IR, INSS, PIS, COFINS e CSLL pela regra, o ISS pela nota, e o líquido', () => {
    const r = calcularRetencoesEntrada(sugerirRetencoes(regras, fato(2000)), {
      valorBruto: 2000,
      issRetido: true,
      baseIss: null,
      aliquotaIss: 2,
      inssNaoRetido: 0,
    });
    const v = Object.fromEntries(r.map((x) => [x.tributo, x.valorRetido]));
    expect(v).toEqual({ COFINS: 60, CSLL: 20, INSS: 220, IRRF: 30, PIS: 13, ISS: 40 });
    expect(totaisReinf(r)).toEqual({ inss: 220, ir: 30, pis: 13, cofins: 60, csll: 20 });
    expect(liquidoEntrada(2000, r)).toBe(1617);
  });
  it('dispensa pelo mínimo da guia (PIS, COFINS e CSLL juntos) e o IR até R$ 10', () => {
    const r = calcularRetencoesEntrada(sugerirRetencoes(regras, fato(200)), {
      valorBruto: 200,
      issRetido: false,
      baseIss: null,
      aliquotaIss: null,
      inssNaoRetido: 0,
    });
    const v = Object.fromEntries(r.map((x) => [x.tributo, [x.valorTributo, x.valorRetido, x.dispensada]]));
    expect(v['IRRF']).toEqual([3, 0, true]);
    expect(v['PIS']).toEqual([1.3, 0, true]);
    expect(v['INSS']).toEqual([22, 0, true]);
    expect(r.some((x) => x.campo === 'iss')).toBe(false);
  });
  it('separa o INSS não retido por decisão judicial', () => {
    const r = calcularRetencoesEntrada(sugerirRetencoes([regra('INSS', 11, 29)], fato(1000)), {
      valorBruto: 1000,
      issRetido: false,
      baseIss: null,
      aliquotaIss: null,
      inssNaoRetido: 50,
    });
    expect(r[0]).toMatchObject({ valorTributo: 110, valorRetido: 60, valorNaoRetido: 50 });
  });
  it('reconhece o tributo pela sigla e rateia sem perder centavo', () => {
    expect(
      ['IRRF', 'INSS', 'PIS', 'COFINS', 'CSLL', 'ISS', 'C2094-IRRF', 'ICMS'].map(campoDoTributo),
    ).toEqual(['ir', 'inss', 'pis', 'cofins', 'csll', 'iss', 'ir', null]);
    expect(ratear(100, [1, 1, 1])).toEqual([33.33, 33.33, 33.34]);
    expect(ratear(10, [0, 0])).toEqual([0, 10]);
  });
});

describe('entrada de serviço tomado: conclusão e cancelamento', () => {
  it('conclui só a aberta com os itens fechando', () => {
    expect(conferirConclusaoEntrada({ situacao: 'aberta', valorTotal: 10, somaItens: 10 })).toBeNull();
    expect(conferirConclusaoEntrada({ situacao: 'concluida', valorTotal: 10, somaItens: 10 })?.codigo).toBe(
      'situacao-invalida',
    );
    expect(conferirConclusaoEntrada({ situacao: 'aberta', valorTotal: 10, somaItens: 9 })?.codigo).toBe(
      'itens-nao-fecham',
    );
  });
  it('o título confirma a retenção: desconta o retido, ou traz a própria, e só uma entrada', () => {
    const b = {
      valorEntrada: 2000,
      liquidoEntrada: 1780,
      tituloBruto: 2000,
      tituloLiquido: 1780,
      tituloTemRetencao: false,
      ligadoAOutraEntrada: false,
    };
    expect(conferirTituloDaEntrada(b)).toBeNull();
    expect(conferirTituloDaEntrada({ ...b, tituloLiquido: 2000 })?.codigo).toBe('titulo-sem-retencao');
    expect(conferirTituloDaEntrada({ ...b, tituloLiquido: 1985, tituloTemRetencao: true })).toBeNull();
    expect(conferirTituloDaEntrada({ ...b, tituloBruto: 1500, tituloTemRetencao: true })?.codigo).toBe(
      'titulo-valor-divergente',
    );
    expect(conferirTituloDaEntrada({ ...b, ligadoAOutraEntrada: true })?.codigo).toBe('titulo-ja-ligado');
  });
  it('cancela com justificativa, nunca a declarada na REINF nem a de título pago', () => {
    const c = {
      situacao: 'concluida',
      justificativa: 'nota emitida em duplicidade',
      declaradaReinf: false,
      tituloPago: false,
    };
    expect(conferirCancelamentoEntrada(c)).toBeNull();
    expect(conferirCancelamentoEntrada({ ...c, justificativa: 'erro' })?.codigo).toBe('sem-justificativa');
    expect(conferirCancelamentoEntrada({ ...c, declaradaReinf: true })?.codigo).toBe('declarada-reinf');
    expect(conferirCancelamentoEntrada({ ...c, tituloPago: true })?.codigo).toBe('titulo-pago');
    expect(conferirCancelamentoEntrada({ ...c, situacao: 'cancelada' })?.codigo).toBe('ja-cancelada');
  });
});
