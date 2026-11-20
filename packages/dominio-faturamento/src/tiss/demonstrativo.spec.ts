// Importação do demonstrativo (M31; DP-33.8): o XML de análise de conta vira os itens (guia, sequencial, procedimento,
// informado, liberado, quantidade e o código da glosa); o nome do beneficiário nunca é lido; arquivo errado é recusado.
import { describe, expect, it } from 'vitest';
import { demonstrativoSinteticoXml, ErroDemonstrativo, lerDemonstrativoXml } from './demonstrativo.js';

const xml = demonstrativoSinteticoXml({
  numero: 'DEM-SINT-1',
  dataEmissao: '2026-10-20',
  numeroLote: '123',
  protocolo: '456',
  guias: [
    {
      numeroGuia: 'G-1',
      itens: [
        { sequencial: 1, codigo: '40301630', informado: 100, liberado: 100, quantidade: 1, motivo: 0 },
        { sequencial: 2, codigo: '40301631', informado: 50, liberado: 20, quantidade: 1, motivo: 1705 },
      ],
    },
  ],
});

describe('demonstrativo', () => {
  it('lê o cabeçalho e os itens', () => {
    const d = lerDemonstrativoXml(xml);
    expect(d).toMatchObject({
      numero: 'DEM-SINT-1',
      dataEmissao: '2026-10-20',
      numeroLote: '123',
      protocolo: '456',
    });
    expect(d.itens).toEqual([
      {
        numeroGuia: 'G-1',
        sequencial: 1,
        codigoProcedimento: '40301630',
        valorInformado: 100,
        valorPago: 100,
        quantidadePaga: 1,
        motivo: 0,
      },
      {
        numeroGuia: 'G-1',
        sequencial: 2,
        codigoProcedimento: '40301631',
        valorInformado: 50,
        valorPago: 20,
        quantidadePaga: 1,
        motivo: 1705,
      },
    ]);
    expect(JSON.stringify(d)).not.toContain('NAO LIDO');
  });
  it('recusa o arquivo que não é demonstrativo, sem cabeçalho ou sem itens', () => {
    expect(() => lerDemonstrativoXml('<x/>')).toThrow(ErroDemonstrativo);
    expect(() => lerDemonstrativoXml('<demonstrativoAnaliseConta></demonstrativoAnaliseConta>')).toThrow(
      /cabeçalho/,
    );
    expect(() =>
      lerDemonstrativoXml(
        '<demonstrativoAnaliseConta><cabecalhoDemonstrativo><numeroDemonstrativo>1</numeroDemonstrativo><dataEmissao>2026-01-01</dataEmissao></cabecalhoDemonstrativo></demonstrativoAnaliseConta>',
      ),
    ).toThrow(/itens/);
  });
});
