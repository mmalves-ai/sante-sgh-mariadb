// F7, 07-FIN linha 114: regra pura da NF-e de saída de mercadoria (massa sintética).
import { describe, expect, it } from 'vitest';
import {
  calcularNfeSaida,
  chaveAcessoNfe,
  chaveNfeValida,
  cnpjValido,
  conferirCancelamentoNfe,
  conferirCartaCorrecao,
  conferirNfeSaida,
  cpfValido,
  danfeHtml,
  digitoChaveNfe,
  LIMITE_CARTAS_CORRECAO,
  NATUREZAS_NFE_PADRAO,
  type PedidoNfeSaida,
  simularSefaz,
  situacaoDoRetornoNfe,
  xmlNfeSaida,
} from './nfe-saida.js';

const natureza = (c: string) => NATUREZAS_NFE_PADRAO.find((n) => n.codigo === c)!;
const emissao = new Date('2026-11-25T13:00:00Z');
const chaveOrigem = chaveAcessoNfe({
  uf: 'SP',
  emissao,
  cnpjEmitente: '11444777000161',
  serie: 1,
  numero: 77,
  codigoNumerico: 12345678,
});
const item = {
  codigo: 'INS-1',
  descricao: 'LUVA SINTETICA',
  ncm: '40151900',
  unidade: 'CX',
  quantidade: 3,
  valorUnitario: 10.5,
  desconto: 1.5,
  lote: 'L1',
  fabricacao: '2026-01-01',
  validade: '2027-01-01',
  registroAnvisa: null,
  cstIcms: '00',
  aliquotaIcms: 18,
  aliquotaIpi: 5,
};
const pedido = (x: Partial<PedidoNfeSaida> = {}): PedidoNfeSaida => ({
  natureza: natureza('devolucao_compra'),
  emitente: {
    documento: '11222333000181',
    nome: 'HOSPITAL SINTETICO',
    uf: 'SP',
    municipioIbge: '3550308',
    municipio: 'SAO PAULO',
    inscricaoEstadual: null,
    contribuinteIcms: true,
  },
  destinatario: {
    documento: '11444777000161',
    nome: 'FORNECEDOR SINTETICO',
    uf: 'SP',
    municipioIbge: null,
    municipio: null,
    inscricaoEstadual: '123',
    contribuinteIcms: true,
  },
  referencias: [chaveOrigem],
  itens: [item],
  valorFrete: 0,
  informacaoComplementar: null,
  ...x,
});

describe('NF-e de saída: documentos, chave e CFOP', () => {
  it('confere CNPJ e CPF pelo dígito', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('11111111111')).toBe(false);
  });
  it('monta a chave de 44 dígitos com o dígito módulo 11', () => {
    expect(chaveOrigem).toHaveLength(44);
    expect(chaveOrigem.slice(0, 6)).toBe('352611');
    expect(chaveOrigem.slice(20, 22)).toBe('55');
    expect(chaveNfeValida(chaveOrigem)).toBe(true);
    expect(chaveNfeValida(chaveOrigem.slice(0, 43) + String((Number(chaveOrigem[43]) + 1) % 10))).toBe(false);
    expect(digitoChaveNfe('0000000000000000000000000000000000000000001')).toBe(9);
  });
  it('escolhe o CFOP dentro ou fora do estado', () => {
    expect(calcularNfeSaida(pedido()).cfop).toBe('5556');
    const fora = pedido({ destinatario: { ...pedido().destinatario, uf: 'RJ' } });
    expect(calcularNfeSaida(fora).cfop).toBe('6556');
    expect(calcularNfeSaida(pedido({ natureza: natureza('remessa_conserto'), referencias: [] })).cfop).toBe(
      '5915',
    );
  });
});

describe('NF-e de saída: conferência do pedido', () => {
  const codigo = (p: PedidoNfeSaida) => conferirNfeSaida(p)?.codigo ?? null;
  it('aceita o pedido completo', () => expect(codigo(pedido())).toBeNull());
  it('a devolução exige a nota de origem com chave válida', () => {
    expect(codigo(pedido({ referencias: [] }))).toBe('devolucao-sem-referencia');
    expect(codigo(pedido({ referencias: ['1'.repeat(44)] }))).toBe('referencia-chave');
    expect(codigo(pedido({ natureza: natureza('remessa_conserto'), referencias: [] }))).toBeNull();
  });
  it('recusa destinatário, NCM, quantidade, desconto, lote e CST incoerentes', () => {
    const dest = pedido().destinatario;
    expect(codigo(pedido({ destinatario: { ...dest, documento: '11444777000160' } }))).toBe(
      'destinatario-documento',
    );
    expect(codigo(pedido({ destinatario: { ...dest, uf: '' } }))).toBe('destinatario-uf');
    expect(codigo(pedido({ itens: [] }))).toBe('itens-vazio');
    expect(codigo(pedido({ itens: [{ ...item, ncm: '4015' }] }))).toBe('item-ncm');
    expect(codigo(pedido({ itens: [{ ...item, quantidade: 0 }] }))).toBe('item-quantidade');
    expect(codigo(pedido({ itens: [{ ...item, desconto: 99 }] }))).toBe('item-desconto');
    expect(codigo(pedido({ itens: [{ ...item, lote: null }] }))).toBe('item-lote');
    expect(codigo(pedido({ itens: [{ ...item, validade: '2025-01-01' }] }))).toBe('item-validade');
    expect(codigo(pedido({ itens: [{ ...item, cstIcms: '41' }] }))).toBe('item-cst-aliquota');
    expect(codigo(pedido({ itens: [{ ...item, cstIcms: '99' }] }))).toBe('item-cst');
  });
});

describe('NF-e de saída: cálculo e XML', () => {
  it('calcula bruto, desconto, ICMS, IPI e o total da nota', () => {
    const c = calcularNfeSaida(pedido({ valorFrete: 2 }));
    const [i] = c.itens;
    expect(i).toMatchObject({ valorBruto: 31.5, baseIcms: 30, valorIcms: 5.4, baseIpi: 30, valorIpi: 1.5 });
    expect(i!.valorTotal).toBe(31.5);
    expect(c).toMatchObject({ valorProdutos: 31.5, valorDesconto: 1.5, valorIcms: 5.4, valorIpi: 1.5 });
    expect(c.valorTotal).toBe(33.5);
  });
  it('o CST sem destaque não calcula ICMS', () => {
    const c = calcularNfeSaida(pedido({ itens: [{ ...item, cstIcms: '41', aliquotaIcms: 0 }] }));
    expect(c.valorIcms).toBe(0);
  });
  it('gera o XML 4.00 com Id, finalidade de devolução, referência, rastro e totais', () => {
    const p = pedido();
    const c = calcularNfeSaida(p);
    const chave = chaveAcessoNfe({
      uf: 'SP',
      emissao,
      cnpjEmitente: '11222333000181',
      serie: 1,
      numero: 5,
      codigoNumerico: 1,
    });
    const xml = xmlNfeSaida({
      pedido: p,
      calculo: c,
      chave,
      serie: 1,
      numero: 5,
      emissao,
      homologacao: true,
    });
    expect(xml).toContain(`<infNFe versao="4.00" Id="NFe${chave}">`);
    expect(xml).toContain('<finNFe>4</finNFe>');
    expect(xml).toContain(`<refNFe>${chaveOrigem}</refNFe>`);
    expect(xml).toContain('<CFOP>5556</CFOP>');
    expect(xml).toContain('<nLote>L1</nLote>');
    expect(xml).toContain('<vNF>31.50</vNF>');
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('SEM VALOR FISCAL');
    expect(xml).not.toContain('FORNECEDOR SINTETICO');
  });
});

describe('NF-e de saída: simulador, cancelamento e carta de correção', () => {
  const chave = chaveOrigem;
  it('o simulador autoriza a nota assinada e rejeita a assinatura que não confere', () => {
    const xml = `<NFe><infNFe Id="NFe${chave}"/></NFe>`;
    expect(simularSefaz({ tipo: 'autorizacao', xml, chave, assinaturaOk: true })).toMatchObject({
      codigo: '100',
    });
    expect(simularSefaz({ tipo: 'autorizacao', xml, chave, assinaturaOk: false })).toMatchObject({
      codigo: '297',
      protocolo: null,
    });
    expect(simularSefaz({ tipo: 'cancelamento', chave, sequencia: 1 }).codigo).toBe('135');
  });
  it('cancela só a autorizada, com justificativa e dentro do prazo', () => {
    const base = {
      situacao: 'autorizada',
      autorizadaEm: emissao,
      agora: emissao,
      justificativa: 'Devolução registrada em duplicidade.',
    };
    expect(conferirCancelamentoNfe(base)).toBeNull();
    expect(conferirCancelamentoNfe({ ...base, situacao: 'cancelada' })?.codigo).toBe('cancelar-situacao');
    expect(conferirCancelamentoNfe({ ...base, justificativa: 'curta' })?.codigo).toBe(
      'cancelar-justificativa',
    );
    expect(
      conferirCancelamentoNfe({ ...base, agora: new Date(emissao.getTime() + 25 * 3_600_000) })?.codigo,
    ).toBe('cancelar-prazo');
  });
  it('a carta de correção confere texto, situação e o limite de 20', () => {
    const texto = 'Corrigir o endereço de entrega do destinatário.';
    expect(conferirCartaCorrecao({ situacao: 'autorizada', texto, cartasAnteriores: 2 })).toEqual({
      ok: true,
      sequencia: 3,
    });
    const r = (x: Parameters<typeof conferirCartaCorrecao>[0]) => {
      const c = conferirCartaCorrecao(x);
      return c.ok ? null : c.recusa.codigo;
    };
    expect(r({ situacao: 'cancelada', texto, cartasAnteriores: 0 })).toBe('cce-situacao');
    expect(r({ situacao: 'autorizada', texto: 'curto', cartasAnteriores: 0 })).toBe('cce-texto');
    expect(r({ situacao: 'autorizada', texto, cartasAnteriores: LIMITE_CARTAS_CORRECAO })).toBe('cce-limite');
  });
  it('o DANFE escapa o texto e marca a nota sem valor fiscal', () => {
    const h = danfeHtml({
      chave,
      protocolo: '1',
      numero: 5,
      serie: '1',
      emissao: '2026-11-25',
      natureza: 'Devolução',
      situacao: 'autorizada',
      emitente: 'A',
      destinatario: '<script>',
      destinatarioDocumento: '1',
      homologacao: true,
      itens: [],
      valorProdutos: 0,
      valorIcms: 0,
      valorIpi: 0,
      valorTotal: 0,
      informacaoComplementar: null,
    });
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('SEM VALOR FISCAL');
  });
});

describe('situação da nota pelo retorno da autorização', () => {
  it('100 e 150 autorizam, 110/301/302/303 denegam, o resto rejeita', () => {
    expect(situacaoDoRetornoNfe('100')).toEqual({ situacao: 'autorizada', evento: 'autorizacao' });
    expect(situacaoDoRetornoNfe('150').situacao).toBe('autorizada');
    for (const c of ['110', '301', '302', '303'])
      expect(situacaoDoRetornoNfe(c)).toEqual({ situacao: 'denegada', evento: 'denegacao' });
    expect(situacaoDoRetornoNfe('297')).toEqual({ situacao: 'rejeitada', evento: 'rejeicao' });
    expect(situacaoDoRetornoNfe('204').situacao).toBe('rejeitada');
  });
});
