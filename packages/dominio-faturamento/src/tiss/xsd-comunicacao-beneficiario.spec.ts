// Comunicação de internação e de alta do beneficiário (F78.04-2, 04-INT linha 80) no XSD oficial 04.03.00: a mensagem
// COMUNICACAO_BENEFICIARIO valida com 0 erro no início da internação (tipo de internação) e na alta (motivo de
// encerramento), o hash do epílogo confere e a falta do dado obrigatório do evento é recusada antes do XSD.
// Massa sintética (fixtures.spec-util.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { cabecalho } from './fixtures.spec-util.js';
import { conferirHashEpilogo, mensagemComunicacaoBeneficiario } from './lote.js';
import { type ArquivoEsquema, carregarEsquemas, validarNoXsd } from './validacao.js';
import { latin1 } from './xml.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

const base = {
  beneficiario: { numeroCarteira: 'SINTETICO0000001', atendimentoRN: false },
  dataEvento: '2026-10-18',
  tipoInternacao: null,
  motivoEncerramento: null,
};

describe('xsd: comunicação de beneficiário em 04.03.00', () => {
  it.each([
    ['internação', { ...base, tipoEvento: 'I' as const, tipoInternacao: '2' }],
    [
      'alta de recém-nascido pela carteira da mãe',
      {
        ...base,
        beneficiario: { ...base.beneficiario, atendimentoRN: true },
        tipoEvento: 'A' as const,
        motivoEncerramento: '12',
      },
    ],
  ])('%s: 0 erro no XSD e hash do epílogo conferido', async (_, c) => {
    const m = mensagemComunicacaoBeneficiario(cabecalho, c);
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect(m.tipoTransacao).toBe('COMUNICACAO_BENEFICIARIO');
    expect(m.xml).toContain('<ans:Padrao>4.03.00</ans:Padrao>');
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
  });

  it('os valores ficam nos caminhos do esquema', () => {
    const i = mensagemComunicacaoBeneficiario(cabecalho, {
      ...base,
      tipoEvento: 'I',
      tipoInternacao: '2',
    }).xml;
    expect(i).toMatch(
      /<ans:comunicacaoInternacao>\s*<ans:dadosBeneficiario>\s*<ans:numeroCarteira>SINTETICO0000001<\/ans:numeroCarteira>\s*<ans:atendimentoRN>N<\/ans:atendimentoRN>\s*<\/ans:dadosBeneficiario>\s*<ans:dataEvento>2026-10-18<\/ans:dataEvento>\s*<ans:tipoEvento>I<\/ans:tipoEvento>\s*<ans:dadosInternacao>\s*<ans:tipoInternacao>2<\/ans:tipoInternacao>\s*<\/ans:dadosInternacao>/,
    );
    const a = mensagemComunicacaoBeneficiario(cabecalho, {
      ...base,
      tipoEvento: 'A',
      motivoEncerramento: '41',
    }).xml;
    expect(a).toMatch(/<ans:dadosInternacao>\s*<ans:motivoEncerramento>41<\/ans:motivoEncerramento>/);
  });

  it('sem o dado do evento é recusada; valor fora do domínio o XSD recusa', async () => {
    expect(() => mensagemComunicacaoBeneficiario(cabecalho, { ...base, tipoEvento: 'I' })).toThrow(
      /tipo de internação/,
    );
    expect(() => mensagemComunicacaoBeneficiario(cabecalho, { ...base, tipoEvento: 'A' })).toThrow(
      /motivo de encerramento/,
    );
    const m = mensagemComunicacaoBeneficiario(cabecalho, { ...base, tipoEvento: 'I', tipoInternacao: '9' });
    expect((await validarNoXsd(latin1(m.xml), esquemas)).valido).toBe(false);
  });
});
