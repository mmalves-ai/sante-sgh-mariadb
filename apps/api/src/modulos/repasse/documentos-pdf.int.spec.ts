// O demonstrativo do repasse e o RPA em PDF/A (M33; ficha, seção 10, "Documento"; cap-14 §14.4.2): o HTML das telas
// convertido pelo Gotenberg em PDF/A-2b e conferido pelo veraPDF (os mesmos contêineres dos documentos do M09/M15).
// Dados sintéticos (prestador 7001, valores inventados). Pula sem o Gotenberg no ar.
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { converterHtmlEmPdfA, gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { pastaTemporaria, verapdf } from '../documento/integracao.spec-util.js';
import { htmlDemonstrativo, htmlRpaEmitido } from './documentos.js';

const GOTENBERG = 'http://127.0.0.1:3318';
const no = await gotenbergDisponivel(GOTENBERG);
const pasta = pastaTemporaria('m33-pdf-');
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe.skipIf(!no)('demonstrativo e RPA em PDF/A (Gotenberg + veraPDF)', () => {
  it('os dois documentos passam no veraPDF (PDF/A-2b)', async () => {
    const demo = htmlDemonstrativo({
      apuracao: 1,
      empresa: 1,
      competencia: '2026-10',
      prestador: 7001,
      estado: 'aprovada',
      base: 1800,
      valor: 333,
      itens: [
        {
          item: 1,
          beneficiario: 7001,
          regra: 9001,
          dimensoes: ['profissional', 'convenio'],
          ignoradas: [],
          base: 'cobrado',
          baseValor: 1000,
          percentual: 18.5,
          valorFixo: 0,
          valorSemAdicional: 185,
          adicional: null,
          valor: 185,
          pendencia: null,
          conta: 'R$ 1.000,00 × 18,5000% = R$ 185,00 — ação, coração, “aspas”',
        },
      ],
    });
    const rpa = htmlRpaEmitido({
      rpa: {
        serie: 'RPA',
        numero: 5425,
        inicio: '2026-10-10',
        fim: '2026-10-31',
        emissao: '2026-10-31',
        prestador: 7001,
      },
      lancamentos: [{ id: 900, data: '2026-10-10', evento: 40, valor: 333 }],
      retencoes: {
        bruto: 333,
        baseInss: 333,
        inss: 36.63,
        baseIrrf: 296.37,
        irrf: 0,
        iss: 16.65,
        liquido: 279.72,
      },
      titulo: { id: 7701, valor: 279.72, vencimento: '2026-11-10' },
      contribuinte: { nome: 'MEDICO SINTETICO A', conselho: '7001/SP', documento: '***.***.***-00' },
      eventos: new Map([[40, 'Honorários médicos (sintético)']]),
    });
    const a = await converterHtmlEmPdfA(GOTENBERG, demo);
    const b = await converterHtmlEmPdfA(GOTENBERG, rpa);
    const r = verapdf(pasta, { 'demonstrativo.pdf': a.pdf, 'rpa.pdf': b.pdf });
    expect(r.map((x) => [x.arquivo, x.conforme])).toEqual([
      ['demonstrativo.pdf', true],
      ['rpa.pdf', true],
    ]);
  }, 300_000);
});
