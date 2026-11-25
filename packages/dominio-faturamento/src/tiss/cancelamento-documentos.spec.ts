// Cancelamento de guia enviada e envio de documentos anexos (06-FAT linha 28) no XSD oficial 04.03.00: as duas
// mensagens validam com 0 erro e o hash do epílogo confere; as regras do pedido, do recibo e do documento.
// Massa sintética (fixtures.spec-util.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  base64Documento,
  conferirEnvioDocumentos,
  conferirPedidoCancelamento,
  conferirReciboCancelamento,
  conferirReciboDocumentos,
  formatoDocumentoTiss,
  mensagemCancelaGuia,
  mensagemEnvioDocumento,
} from './cancelamento-documentos.js';
import { cabecalho } from './fixtures.spec-util.js';
import { conferirHashEpilogo } from './lote.js';
import { type ArquivoEsquema, carregarEsquemas, validarNoXsd } from './validacao.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

const guia = (id: number, situacao = 'enviada', fonte = 1, vivo = false) => ({
  id,
  numeroGuiaPrestador: `TESTE-${id}`,
  situacao,
  fontePagadora: fonte,
  emPedidoVivo: vivo,
});
const PDF = new TextEncoder().encode('%PDF-1.4 sintetico');

describe('xsd: cancelamento de guia e envio de documento em 04.03.00', () => {
  it('CANCELA_GUIA com duas guias: 0 erro, hash conferido, caminhos do esquema', async () => {
    const m = mensagemCancelaGuia(cabecalho, [
      { numeroGuiaPrestador: 'TESTE-C-0001', numeroGuiaOperadora: 'OP0001', numeroProtocolo: 'PROT01' },
      { numeroGuiaPrestador: 'TESTE-C-0002' },
    ]);
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    expect(m.tipoTransacao).toBe('CANCELA_GUIA');
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
    expect(m.xml).toMatch(
      /<ans:cancelaGuia>\s*<ans:dadosPrestador>\s*<ans:codigoPrestadorNaOperadora>PRESTTESTE01<\/ans:codigoPrestadorNaOperadora>\s*<\/ans:dadosPrestador>\s*<ans:tipoCancelamento>\s*<ans:tipoCancelamentoGuia>\s*<ans:tipoGuia>2<\/ans:tipoGuia>\s*<ans:numeroGuiaPrestador>TESTE-C-0001<\/ans:numeroGuiaPrestador>\s*<ans:numeroGuiaOperadora>OP0001<\/ans:numeroGuiaOperadora>/,
    );
    expect(() => mensagemCancelaGuia(cabecalho, [])).toThrow(/1 a 100/);
  });

  it('ENVIO_DOCUMENTO: 0 erro, documento em base64, hash conferido', async () => {
    const m = mensagemEnvioDocumento(cabecalho, {
      numeroGuiaPrestador: 'TESTE-S-0001',
      numeroDocumento: 'D0000001-1',
      naturezaGuia: '2',
      formatoDocumento: '02',
      conteudo: PDF,
      tipoDocumento: '02',
      observacao: 'Laudo sintético',
    });
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    expect(m.tipoTransacao).toBe('ENVIO_DOCUMENTO');
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
    expect(m.xml).toContain(`<ans:documento>${Buffer.from(PDF).toString('base64')}</ans:documento>`);
    expect(() =>
      mensagemEnvioDocumento(cabecalho, {
        numeroDocumento: 'X',
        naturezaGuia: '2',
        formatoDocumento: '02',
        conteudo: PDF,
        tipoDocumento: '02',
      }),
    ).toThrow(/guia ou do lote/);
    const fora = mensagemEnvioDocumento(cabecalho, {
      numeroGuiaPrestador: 'TESTE-S-0001',
      numeroDocumento: 'D'.repeat(21),
      naturezaGuia: '2',
      formatoDocumento: '02',
      conteudo: PDF,
      tipoDocumento: '02',
    });
    expect((await validarNoXsd(fora.bytes, esquemas)).valido).toBe(false);
  });

  it('base64 igual ao do Node em todos os restos', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      expect(base64Documento(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
});

describe('regras do pedido de cancelamento', () => {
  it('aceita guias enviadas, aceitas ou glosadas da mesma operadora', () => {
    expect(
      conferirPedidoCancelamento({
        guias: [guia(1), guia(2, 'aceita'), guia(3, 'glosada')],
        motivo: 'Guia em duplicidade',
      }),
    ).toEqual([]);
  });
  it('recusa motivo curto, guia não enviada, paga, cancelada, em pedido vivo, repetida e de outra operadora', () => {
    const p = conferirPedidoCancelamento({
      guias: [
        guia(1, 'em_lote'),
        guia(2, 'paga'),
        guia(3, 'cancelada'),
        guia(4, 'enviada', 1, true),
        guia(5, 'enviada', 2),
        guia(5),
      ],
      motivo: 'curto',
    }).map((x) => x.mensagem);
    expect(p.join('|')).toMatch(/mínimo de 10/);
    expect(p.join('|')).toMatch(/TESTE-1 ainda não foi enviada/);
    expect(p.join('|')).toMatch(/TESTE-2 já foi paga/);
    expect(p.join('|')).toMatch(/TESTE-3 já está cancelada/);
    expect(p.join('|')).toMatch(/TESTE-4 já está num pedido/);
    expect(p.join('|')).toMatch(/mais de uma vez/);
    expect(p.join('|')).toMatch(/uma só operadora/);
    expect(conferirPedidoCancelamento({ guias: [], motivo: 'Motivo suficiente' })).toHaveLength(1);
  });
});

describe('recibo do cancelamento', () => {
  const itens = [
    { id: 10, situacao: 'pendente' as const },
    { id: 11, situacao: 'pendente' as const },
  ];
  it('processado com o status de cada guia; incompleto, inválido ou fora do pedido recusado', () => {
    expect(
      conferirReciboCancelamento('enviado', itens, {
        erro: null,
        guias: [
          { item: 10, status: '1' },
          { item: 11, status: '4' },
        ],
      }),
    ).toEqual({ problemas: [], situacao: 'processado' });
    expect(
      conferirReciboCancelamento('enviado', itens, { erro: null, guias: [{ item: 10, status: '1' }] })
        .situacao,
    ).toBeNull();
    expect(
      conferirReciboCancelamento('enviado', itens, {
        erro: null,
        guias: [
          { item: 10, status: '9' },
          { item: 99, status: '1' },
        ],
      }).problemas.length,
    ).toBeGreaterThanOrEqual(2);
  });
  it('erro da operadora deixa o pedido recusado; rascunho e já respondido recusam', () => {
    expect(
      conferirReciboCancelamento('enviado', itens, { erro: { codigo: '5001', descricao: null }, guias: [] })
        .situacao,
    ).toBe('recusado');
    expect(
      conferirReciboCancelamento('rascunho', itens, { erro: null, guias: [] }).problemas[0]!.mensagem,
    ).toMatch(/não foi enviado/);
    expect(
      conferirReciboCancelamento('processado', itens, { erro: null, guias: [] }).problemas[0]!.mensagem,
    ).toMatch(/já tem o recibo/);
  });
  it('retorno complementar só das guias em processamento', () => {
    const depois = [
      { id: 10, situacao: 'cancelada' as const },
      { id: 11, situacao: 'em_analise' as const },
    ];
    expect(
      conferirReciboCancelamento('processado', depois, { erro: null, guias: [{ item: 11, status: '1' }] })
        .situacao,
    ).toBe('processado');
    expect(
      conferirReciboCancelamento('processado', depois, { erro: null, guias: [{ item: 10, status: '2' }] })
        .situacao,
    ).toBeNull();
  });
});

describe('documentos anexos', () => {
  it('formato pelo tipo do arquivo', () => {
    expect(formatoDocumentoTiss('application/pdf')).toBe('02');
    expect(formatoDocumentoTiss('IMAGE/JPEG')).toBe('01');
    expect(formatoDocumentoTiss('text/plain')).toBeNull();
  });
  it('confere o envio: formato, tamanho, tipo, quantidade e guia cancelada', () => {
    expect(
      conferirEnvioDocumentos({
        situacaoGuia: 'enviada',
        documentos: [{ tipoMime: 'application/pdf', tamanho: 10, tipoDocumento: '02' }],
      }),
    ).toEqual([]);
    const p = conferirEnvioDocumentos({
      situacaoGuia: 'cancelada',
      documentos: [{ tipoMime: 'text/plain', tamanho: 11 * 1024 * 1024, tipoDocumento: '99' }],
    });
    expect(p).toHaveLength(4);
    expect(conferirEnvioDocumentos({ situacaoGuia: 'enviada', documentos: [] })).toHaveLength(1);
  });
  it('recibo: parcial segue enviado; todos respondidos com um aceito fica recebido; todos recusados, rejeitado', () => {
    const itens = [
      { id: 1, situacao: 'enviado' as const },
      { id: 2, situacao: 'enviado' as const },
    ];
    expect(
      conferirReciboDocumentos('enviado', itens, [{ item: 1, protocolo: 'P1', erro: null }]).situacao,
    ).toBe('enviado');
    expect(
      conferirReciboDocumentos('enviado', itens, [
        { item: 1, protocolo: 'P1', erro: null },
        { item: 2, protocolo: null, erro: 'Ilegível' },
      ]).situacao,
    ).toBe('recebido');
    expect(
      conferirReciboDocumentos('enviado', itens, [
        { item: 1, protocolo: null, erro: 'Ilegível' },
        { item: 2, protocolo: null, erro: 'Ilegível' },
      ]).situacao,
    ).toBe('rejeitado');
    expect(
      conferirReciboDocumentos('enviado', itens, [{ item: 1, protocolo: 'P', erro: 'x' }]).situacao,
    ).toBeNull();
    expect(conferirReciboDocumentos('rascunho', itens, []).situacao).toBeNull();
  });
});
