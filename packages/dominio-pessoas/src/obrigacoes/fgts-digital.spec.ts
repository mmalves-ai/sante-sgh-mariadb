// M53-F7: a apuração do FGTS Digital (valores do cálculo, conferência com o eSocial, prova da soma e conciliação da
// guia). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  apurarFgts,
  conciliarGuiaFgts,
  conferirApuracaoFgts,
  type EventoParaFgts,
  type ProcessoParaObrigacao,
  type ResumoParaObrigacao,
  semEventoAceito,
  totalDaGuiaFgts,
  type VinculoParaObrigacao,
} from './fgts-digital.js';

const C = '2026-09';
const processos: ProcessoParaObrigacao[] = [
  { id: 1, tipo: 'mensal', competencia: C },
  { id: 2, tipo: 'ferias', competencia: C },
  { id: 3, tipo: 'rescisao', competencia: C },
  { id: 4, tipo: 'decimo1', competencia: C },
  { id: 5, tipo: 'mensal', competencia: '2026-08' },
];
const resumos = new Map<number, ResumoParaObrigacao[]>([
  [
    1,
    [
      { vinculo: 10, porPapel: { baseFgts: 300_000, fgts: 24_000 } },
      { vinculo: 11, porPapel: { baseFgts: 200_000, fgts: 16_000 } },
      { vinculo: 12, porPapel: {} },
    ],
  ],
  [2, [{ vinculo: 10, porPapel: { baseFgts: 100_000, fgts: 8_000 } }]],
  [3, [{ vinculo: 13, porPapel: { baseFgts: 150_000, fgts: 12_000, multaFgts: 40_000 } }]],
  [4, [{ vinculo: 11, porPapel: { baseFgts: 100_000, fgts: 8_000 } }]],
  [5, [{ vinculo: 10, porPapel: { baseFgts: 999_999, fgts: 99_999 } }]],
]);
const vinculos = new Map<number, VinculoParaObrigacao>([
  [10, { vinculo: 10, matricula: 'M10', categoria: '101', admissao: '2020-01-02', desligamento: null }],
  [11, { vinculo: 11, matricula: null, categoria: '101', admissao: '2026-09-01', desligamento: null }],
  [
    13,
    { vinculo: 13, matricula: 'M13', categoria: '101', admissao: '2019-01-02', desligamento: '2026-09-15' },
  ],
]);
const ev = (vinculo: number, evento: string, situacao: string, dataReferencia = C): EventoParaFgts => ({
  vinculo,
  evento,
  situacao,
  dataReferencia,
});

describe('apuração do FGTS Digital', () => {
  it('soma por trabalhador os processamentos da competência (13º à parte; outra competência fora)', () => {
    const a = apurarFgts(C, processos, resumos, vinculos, [
      ev(10, 'S-1200', 'aceito'),
      ev(13, 'S-2299', 'aceito', '2026-09-15'),
    ]);
    expect(a.trabalhadores.map((t) => t.vinculo)).toEqual([10, 11, 13]);
    const [t10, t11, t13] = a.trabalhadores;
    expect(t10).toMatchObject({ baseFgts: 400_000, fgts: 32_000, processos: [1, 2], esocial: 'aceito' });
    expect(t11).toMatchObject({ baseFgts: 200_000, baseDecimo: 100_000, fgtsDecimo: 8_000, matricula: null });
    expect(t11!.esocial).toBe('sem-evento');
    expect(t13).toMatchObject({ rescisorio: 40_000, esocial: 'aceito' });
    expect(a.totais).toEqual({
      trabalhadores: 3,
      remuneracao: 750_000,
      remuneracaoDecimo: 100_000,
      baseFgts: 850_000,
      fgts: 68_000,
      rescisorio: 40_000,
      admissoes: 1,
      desligamentos: 1,
    });
    expect(totalDaGuiaFgts(a.totais)).toBe(108_000);
    expect(semEventoAceito(a.trabalhadores)).toEqual([11]);
  });

  it('evento em andamento, descartado ou de outra referência não vale; só o 13º 1ª parcela não se aplica', () => {
    const so13 = apurarFgts(C, [{ id: 4, tipo: 'decimo1', competencia: C }], resumos, new Map(), []);
    expect(so13.trabalhadores[0]).toMatchObject({ vinculo: 11, esocial: 'nao-se-aplica', categoria: null });
    const a = apurarFgts(C, processos, resumos, vinculos, [
      ev(10, 'S-1200', 'enviado'),
      ev(11, 'S-1200', 'descartado'),
      ev(13, 'S-2299', 'aceito', '2026-08-31'),
    ]);
    expect(a.trabalhadores.map((t) => t.esocial)).toEqual(['em-andamento', 'sem-evento', 'sem-evento']);
    const dez = apurarFgts(
      '2026-12',
      [{ id: 9, tipo: 'decimo2', competencia: '2026-12' }],
      new Map([[9, [{ vinculo: 10, porPapel: { baseFgts: 1, fgts: 1 } }]]]),
      vinculos,
      [ev(10, 'S-1200', 'aceito', '2026')],
    );
    expect(dez.trabalhadores[0]!.esocial).toBe('aceito');
  });

  it('prova da soma com as parcelas e o confronto com o FGTS do fechamento da folha', () => {
    const a = apurarFgts(C, processos, resumos, vinculos, []);
    const ok = conferirApuracaoFgts(a, 60_000);
    expect(ok.ok).toBe(true);
    expect(ok.parcelas.map((p) => p.rotulo)).toEqual([
      'Vínculo 10 (matrícula M10)',
      'Vínculo 11',
      'Vínculo 13 (matrícula M13)',
      'Total (depósitos + rescisório)',
    ]);
    expect(ok.parcelas.at(-1)!.valor).toBe(108_000);
    const div = conferirApuracaoFgts(a, 59_999);
    expect(div.ok).toBe(false);
    expect(div.divergencias[0]).toMatch(/fechamento da folha/);
    expect(conferirApuracaoFgts(a, null).ok).toBe(true);
    const torta = { ...a, totais: { ...a.totais, fgts: 1 } };
    expect(conferirApuracaoFgts(torta, null).divergencias[0]).toMatch(/soma dos trabalhadores/);
  });

  it('conciliação da guia: apurado + acréscimos = guia, centavo a centavo', () => {
    const { totais } = apurarFgts(C, processos, resumos, vinculos, []);
    const ok = conciliarGuiaFgts(totais, 108_500, 500);
    expect(ok.ok).toBe(true);
    expect(ok.parcelas.map((p) => p.valor)).toEqual([68_000, 40_000, 500, 108_500, 108_500]);
    const div = conciliarGuiaFgts(totais, 108_000, 500);
    expect(div.ok).toBe(false);
    expect(div.divergencias[0]).toMatch(/-500 centavos/);
  });
});
