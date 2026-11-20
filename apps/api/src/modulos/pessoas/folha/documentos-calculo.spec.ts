// M53.3: o HTML do holerite e do relatório de conferência (convertido em PDF/A pelo gerador): sem os encargos da empresa
// no holerite, a conta do líquido com as parcelas, o relatório só com IDs, contagens e somas (regra 8), escape do texto.
// Dados SINTÉTICOS.
import type {
  DetalheFerias,
  DetalheProcessoFolha,
  DetalheRescisao,
  LinhaCalculoFolha,
  MeuHolerite,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  htmlConferenciaCalculo,
  htmlHolerite,
  htmlReciboFerias,
  htmlTermoRescisao,
  reaisBr,
  responderPdf,
} from './documentos-calculo.js';

const linha = (
  papel: LinhaCalculoFolha['papel'],
  tipo: LinhaCalculoFolha['tipo'],
  valor: number,
): LinhaCalculoFolha => ({
  papel,
  tipo,
  rubrica: tipo === 'provento' || tipo === 'desconto' ? 1 : null,
  codigoRubrica: tipo === 'provento' || tipo === 'desconto' ? 101 : null,
  quantidade: 0,
  unidade: 'valor',
  valor,
  memoria: `conta de ${papel} <sintética>`,
});

const holerite: MeuHolerite = {
  hoje: '2026-10-27',
  competencia: '2026-09',
  disponivel: true,
  mensagem: null,
  vinculo: 7,
  matricula: 'M-7',
  calculado: true,
  calculadoEm: '2026-10-05T10:30:00',
  linhas: [
    linha('salario', 'provento', 300_000),
    linha('inss', 'desconto', 25_000),
    linha('baseInss', 'base', 300_000),
    linha('fgts', 'informativa', 24_000),
    linha('inssPatronal', 'informativa', 60_000),
    linha('rat', 'informativa', 6_000),
  ],
  proventos: 300_000,
  descontos: 25_000,
  liquido: 275_000,
};

describe('documentos do cálculo', () => {
  it('reais em pt-BR', () => {
    expect(reaisBr(123_456_789)).toBe('R$ 1.234.567,89');
    expect(reaisBr(5)).toBe('R$ 0,05');
    expect(reaisBr(-1_000)).toBe('−R$ 10,00');
  });

  it('holerite: vencimentos, descontos, a conta do líquido e os informativos, sem os encargos da empresa', () => {
    const h = htmlHolerite(holerite);
    expect(h).toContain('<h1>Holerite 09/2026</h1>');
    expect(h).toContain('R$ 3.000,00 − R$ 250,00 = <strong>R$ 2.750,00</strong>');
    expect(h).toContain('Base do INSS');
    expect(h).toContain('FGTS');
    expect(h).not.toContain('INSS da empresa');
    expect(h).not.toContain('RAT ajustado');
    expect(h).toContain('&lt;sintética&gt;');
    expect(h).not.toContain('<sintética>');
  });

  it('holerite não calculado diz que ainda não foi calculado', () => {
    const h = htmlHolerite({ ...holerite, calculado: false, linhas: [] });
    expect(h).toContain('ainda não foi calculado');
  });

  it('conferência: prova da soma com as parcelas, encargos e custo com a conta, grade por vínculo', () => {
    const d: DetalheProcessoFolha = {
      processo: {
        id: 9,
        empresa: 1,
        competencia: '2026-09',
        tipo: 'mensal',
        numero: 2,
        situacao: 'calculada',
        pagamento: null,
        totais: {
          colaboradores: 2,
          proventos: 500_000,
          descontos: 50_000,
          liquido: 450_000,
          inss: 40_000,
          irrf: 10_000,
          fgts: 40_000,
          inssPatronal: 100_000,
          rat: 10_000,
          terceiros: 29_000,
        },
        tabelaLegal: '2026-01-01',
        parametros: '2026-01-01',
        foraDaFolha: 1,
        resumo: 'a'.repeat(64),
        calculadoPor: 'SINT.DP.FOLHA',
        calculadoEm: '2026-10-05T10:30:00',
        situacaoPor: null,
        situacaoEm: null,
        motivo: null,
        versao: 0,
      },
      colaboradoresOcultos: false,
      colaboradores: [7, 8].map((v) => ({
        vinculo: v,
        matricula: null,
        centroCusto: 3,
        diasPagos: 30,
        proventos: 250_000,
        descontos: 25_000,
        liquido: 225_000,
        baseInss: 250_000,
        baseIrrf: 230_000,
        baseFgts: 250_000,
        inss: 20_000,
        irrf: 5_000,
        fgts: 20_000,
        encargos: 69_500,
      })),
      conferencia: { ok: true, parcelas: [{ rotulo: 'Proventos', valor: 500_000 }], divergencias: [] },
    };
    const h = htmlConferenciaCalculo(d);
    expect(h).toContain('Conferência da folha 09/2026 · cálculo 2');
    expect(h).toContain('A soma confere.');
    expect(h).toContain('Total: R$ 5.000,00 − R$ 500,00 = R$ 4.500,00');
    expect(h).toContain('Soma dos 2 vínculo(s): R$ 5.000,00 − R$ 500,00 = R$ 4.500,00');
    expect(h).toContain(
      'R$ 1.000,00 (INSS da empresa) + R$ 100,00 (RAT ajustado) + R$ 290,00 (outras entidades) = R$ 1.390,00',
    );
    expect(h).toContain(
      'Custo de pessoal: R$ 5.000,00 (proventos) + R$ 400,00 (FGTS) + R$ 1.390,00 (encargos) = R$ 6.790,00',
    );
    expect(h.match(/<tr><td>[78]<\/td>/g)).toHaveLength(2);
  });

  it('recibo de férias: o aviso (aquisitivo, gozo, abono, pagamento), as linhas e a conta do líquido; sem recibo, o aviso', () => {
    const ferias: DetalheFerias['ferias'] = {
      id: 3,
      vinculo: 7,
      empresa: 1,
      aquisitivoInicio: '2025-01-10',
      aquisitivoFim: '2026-01-09',
      inicio: '2026-11-03',
      fim: '2026-11-22',
      dias: 20,
      abono: 10,
      dobra: 0,
      adiantarDecimo: true,
      pagamento: '2026-10-30',
      situacao: 'calculada',
      processo: 9,
      motivo: null,
      registradoPor: 'SINT.DP',
      registradoEm: '2026-10-01T09:00:00',
      situacaoPor: null,
      situacaoEm: null,
      versao: 1,
    };
    const processo: DetalheFerias['processo'] = {
      id: 9,
      empresa: 1,
      competencia: '2026-11',
      tipo: 'ferias',
      numero: 2,
      situacao: 'calculada',
      pagamento: '2026-10-30',
      totais: {
        colaboradores: 1,
        proventos: 266_667,
        descontos: 20_000,
        liquido: 246_667,
        inss: 20_000,
        irrf: 0,
        fgts: 21_333,
        inssPatronal: 50_000,
        rat: 0,
        terceiros: 0,
      },
      tabelaLegal: '2026-01-01',
      parametros: '2026-01-01',
      foraDaFolha: 0,
      resumo: 'b'.repeat(64),
      calculadoPor: 'SINT.DP.FOLHA',
      calculadoEm: '2026-10-28T10:30:00',
      situacaoPor: null,
      situacaoEm: null,
      motivo: null,
      versao: 0,
    };
    const html = htmlReciboFerias(
      {
        ferias,
        processo,
        linhas: [
          linha('feriasGozo', 'provento', 200_000),
          linha('feriasTerco', 'provento', 66_667),
          linha('inssFerias', 'desconto', 20_000),
          linha('inssPatronal', 'informativa', 50_000),
        ],
        linhasOcultas: false,
      },
      'M-7',
    );
    expect(html).toContain('10/01/2025 a 09/01/2026');
    expect(html).toContain('03/11/2026 a 22/11/2026 (20 dia(s))');
    expect(html).toContain('<td>10 dia(s)</td>');
    expect(html).toContain('30/10/2026');
    expect(html).toContain('Terço constitucional de férias');
    expect(html).toContain('R$ 2.666,67 − R$ 200,00 = <strong>R$ 2.466,67</strong>');
    expect(html).not.toContain('INSS da empresa');
    expect(html).toContain('&lt;sintética&gt;');
    const so = htmlReciboFerias(
      {
        ferias: { ...ferias, situacao: 'programada', processo: null },
        processo: null,
        linhas: [],
        linhasOcultas: false,
      },
      null,
    );
    expect(so).toContain('ainda não foi calculado');
    expect(so).toContain('Programadas');
  });

  it('o termo de rescisão: modalidade, aviso com a projeção, a conta da multa e do líquido; sem verbas, só os dados', () => {
    const rescisao: DetalheRescisao['rescisao'] = {
      id: 5,
      vinculo: 7,
      empresa: 1,
      desligamento: '2026-10-15',
      tipoRescisao: 2,
      modalidade: 'sem-justa-causa',
      aviso: 'indenizado',
      diasAviso: 36,
      diasIndenizados: 36,
      projecao: '2026-11-20',
      termo: null,
      saldoFgts: 1_000_000,
      saldoFgtsInformado: true,
      multaFgts: 416_320,
      pagamento: '2026-10-25',
      situacao: 'calculada',
      processo: 9,
      motivo: null,
      registradoPor: 'SINT.DP.FOLHA',
      registradoEm: '2026-10-16T10:00:00',
      situacaoPor: null,
      situacaoEm: null,
      versao: 0,
    };
    const processo = {
      id: 9,
      empresa: 1,
      competencia: '2026-10',
      tipo: 'rescisao',
      numero: 3,
      situacao: 'calculada',
      pagamento: '2026-10-25',
      tabelaLegal: '2026-01-01',
      parametros: '2026-01-01',
      foraDaFolha: 0,
      calculadoPor: 'SINT.DP.FOLHA',
      calculadoEm: '2026-10-16T10:00:00',
      situacaoPor: null,
      situacaoEm: null,
      motivo: null,
      versao: 0,
    } as unknown as NonNullable<DetalheRescisao['processo']>;
    const html = htmlTermoRescisao(
      {
        rescisao,
        processo,
        linhas: [
          linha('salario', 'provento', 150_000),
          linha('avisoIndenizado', 'provento', 360_000),
          linha('inss', 'desconto', 10_000),
          linha('inssPatronal', 'informativa', 50_000),
          linha('fgts', 'informativa', 40_800),
          { ...linha('multaFgts', 'informativa', 416_320), quantidade: 4000, unidade: 'percentual' },
        ],
        linhasOcultas: false,
      },
      'M-7',
    );
    expect(html).toContain('Dispensa sem justa causa');
    expect(html).toContain('Indenizado · 36 dia(s) devidos, 36 indenizado(s)');
    expect(html).toContain('15/10/2026 + 36 dia(s) = 20/11/2026');
    expect(html).toContain('(R$ 10.000,00 + R$ 408,00 do FGTS desta rescisão) × 40% = R$ 4.163,20');
    expect(html).toContain('extrato informado');
    expect(html).toContain('Aviso prévio indenizado');
    expect(html).toContain('R$ 5.100,00 − R$ 100,00 = <strong>R$ 5.000,00</strong>');
    expect(html).not.toContain('INSS da empresa');
    expect(html).toContain('M-7');
    const sem = htmlTermoRescisao(
      {
        rescisao: {
          ...rescisao,
          modalidade: 'justa-causa',
          aviso: 'nenhum',
          multaFgts: 0,
          saldoFgtsInformado: false,
          termo: '2026-12-01',
          situacao: 'cancelada',
          motivo: 'Erro <x>',
        },
        processo: null,
        linhas: [],
        linhasOcultas: true,
      },
      null,
    );
    expect(sem).toContain('Sem multa nesta modalidade');
    expect(sem).toContain('soma dos depósitos registrados');
    expect(sem).toContain('01/12/2026');
    expect(sem).toContain('Cancelada · Erro &lt;x&gt;');
    expect(sem).toContain('não estão disponíveis');
  });

  it('sem gerador sai o HTML; com gerador, o PDF; gerador que falha é 503', async () => {
    const cab: Record<string, string> = {};
    const res = { header: (n: string, v: string) => (cab[n] = v), send: (b: unknown) => b };
    expect(await responderPdf(null, res, '<p>x</p>', 't', 'a')).toBe('<p>x</p>');
    expect(cab['content-type']).toContain('text/html');
    const pdf = Buffer.from('%PDF-1.7');
    expect(await responderPdf(async () => pdf, res, '<p>x</p>', 't', 'a')).toBe(pdf);
    expect(cab['content-disposition']).toBe('attachment; filename="a.pdf"');
    await expect(
      responderPdf(async () => Promise.reject(new Error('x')), res, '', 't', 'a'),
    ).rejects.toMatchObject({
      status: 503,
    });
  });
});
