import { describe, expect, it } from 'vitest';
import { ErroDemonstrativo } from './demonstrativo.js';
import {
  casarItensDemonstrativo,
  conferirPagamento,
  demonstrativoPagamentoSinteticoXml,
  glosaDaLinha,
  lerDemonstrativoPagamentoXml,
  linhasPagamentoDosItens,
  situacaoDoDemonstrativo,
  totaisDoPagamento,
} from './demonstrativo-conciliacao.js';

const linha = (o: Partial<Parameters<typeof casarItensDemonstrativo>[0][number]> = {}) => ({
  numeroGuia: 'G1',
  sequencial: 1,
  codigoProcedimento: '10101012',
  valorInformado: 300,
  valorPago: 300,
  quantidadePaga: 3,
  motivo: 0,
  ...o,
});
const cand = (item: number, seq: number, guias = ['G1', '55'], codigo = '10101012', valorCobrado = 300) => ({
  item,
  conta: 55,
  guias,
  sequencial: seq,
  codigo,
  valorCobrado,
});

describe('casamento item a item do demonstrativo', () => {
  it('casa pela guia e sequencial, com glosa pelo informado menos o liberado', () => {
    const r = casarItensDemonstrativo(
      [linha(), linha({ sequencial: 2, valorPago: 100, motivo: 1001 })],
      [cand(10, 1), cand(11, 2)],
    );
    expect(r).toEqual([
      { item: 10, conta: 55, situacao: 'pendente', valorGlosa: 0, divergencias: [] },
      { item: 11, conta: 55, situacao: 'pendente', valorGlosa: 200, divergencias: [] },
    ]);
  });
  it('aceita a guia com zeros à esquerda e o número da conta', () => {
    expect(casarItensDemonstrativo([linha({ numeroGuia: '0055' })], [cand(10, 1)])[0]!.item).toBe(10);
  });
  it('sem a guia, casa pelo sequencial e código só quando há um único candidato', () => {
    expect(casarItensDemonstrativo([linha({ numeroGuia: 'X' })], [cand(10, 1)])[0]!.item).toBe(10);
    const dois = casarItensDemonstrativo(
      [linha({ numeroGuia: 'X' })],
      [cand(10, 1), { ...cand(20, 1, ['G2']), conta: 56 }],
    );
    expect(dois[0]).toMatchObject({ item: null, situacao: 'sem_correspondencia', valorGlosa: 0 });
  });
  it('nunca casa o mesmo item duas vezes e marca a divergência de código e valor', () => {
    const r = casarItensDemonstrativo(
      [linha({ codigoProcedimento: '99999999', valorInformado: 250, valorPago: 250 }), linha()],
      [cand(10, 1)],
    );
    expect(r[0]).toMatchObject({ item: 10, situacao: 'divergente', divergencias: ['codigo', 'valor'] });
    expect(r[1]).toMatchObject({ item: null, situacao: 'sem_correspondencia' });
  });
  it('glosa nunca negativa e em centavos exatos', () => {
    expect(glosaDaLinha(100, 150)).toBe(0);
    expect(glosaDaLinha(0.3, 0.1)).toBe(0.2);
  });
  it('situação do cabeçalho', () => {
    expect(situacaoDoDemonstrativo([{ situacao: 'pendente' }])).toBe('importado');
    expect(situacaoDoDemonstrativo([{ situacao: 'conciliado' }])).toBe('conciliado');
    expect(situacaoDoDemonstrativo([{ situacao: 'pendente' }, { situacao: 'divergente' }])).toBe(
      'com_divergencia',
    );
  });
});

describe('demonstrativo de pagamento', () => {
  const xml = demonstrativoPagamentoSinteticoXml({
    numero: 'DP-1',
    dataEmissao: '2026-11-10',
    dataPagamento: '2026-11-15',
    protocolos: [
      { numeroLote: '000123', protocolo: 'P9', informado: 900, liberado: 700 },
      { numeroLote: '000124', protocolo: 'P10', informado: 100.1, liberado: 100.1 },
    ],
    descontos: [
      { indicador: 1, tipo: '01', descricao: 'IRRF', valor: 12.3 },
      { indicador: 2, tipo: '05', descricao: 'AJUSTE', valor: 5 },
    ],
  });
  it('lê protocolos, data do pagamento e débitos/créditos', () => {
    const d = lerDemonstrativoPagamentoXml(xml);
    expect(d).toMatchObject({ numero: 'DP-1', dataEmissao: '2026-11-10', dataPagamento: '2026-11-15' });
    expect(d.linhas).toHaveLength(2);
    expect(d.linhas[0]).toMatchObject({ numeroLote: '000123', protocolo: 'P9', valorGlosa: 200 });
    expect(d.deducoes.map((x) => [x.natureza, x.valor])).toEqual([
      ['debito', 12.3],
      ['credito', 5],
    ]);
    const t = totaisDoPagamento(d.linhas, d.deducoes);
    expect(t).toEqual({
      informado: 1000.1,
      processado: 1000.1,
      liberado: 800.1,
      glosa: 200,
      debitos: 12.3,
      creditos: 5,
      liquido: 792.8,
    });
    expect(conferirPagamento(t)).toBeNull();
  });
  it('recusa o que não é demonstrativo de pagamento e o líquido negativo', () => {
    expect(() => lerDemonstrativoPagamentoXml('<demonstrativoAnaliseConta/>')).toThrow(ErroDemonstrativo);
    expect(
      conferirPagamento(
        totaisDoPagamento(
          [
            {
              numeroLote: '1',
              protocolo: null,
              numeroGuia: null,
              valorInformado: 10,
              valorProcessado: 10,
              valorLiberado: 10,
              valorGlosa: 0,
            },
          ],
          [{ natureza: 'debito', codigo: null, descricao: 'X', valor: 11, dataPagamento: null }],
        ),
      ),
    ).not.toBeNull();
  });
  it('digitação: itens agrupados por guia', () => {
    const l = linhasPagamentoDosItens([
      linha(),
      linha({ sequencial: 2, valorPago: 100 }),
      linha({ numeroGuia: 'G2' }),
    ]);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({
      numeroGuia: 'G1',
      valorInformado: 600,
      valorLiberado: 400,
      valorGlosa: 200,
    });
  });
});

describe('situação da linha do pagamento', () => {
  it('casada sem glosa concilia; com glosa diverge; sem lote nem conta fica sem correspondência', async () => {
    const { situacaoLinhaPagamento } = await import('./demonstrativo-conciliacao.js');
    expect(situacaoLinhaPagamento({ casada: true, valorGlosa: 0 })).toBe('conciliado');
    expect(situacaoLinhaPagamento({ casada: true, valorGlosa: 0.01 })).toBe('divergente');
    expect(situacaoLinhaPagamento({ casada: false, valorGlosa: 0 })).toBe('sem_correspondencia');
  });
});
