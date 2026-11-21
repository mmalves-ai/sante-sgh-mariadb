// Estatísticas de custeio (M54-F4): competência, duração da cirurgia, coleta pelas fontes agregadas (censo completo ou
// estimativa, horas de sala com as parcelas, centro do movimento que não está no cadastro) e a matriz da competência
// (manual prevalece, referência herdada, totais = soma das parcelas). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  centesimos,
  competenciaFutura,
  deCentesimos,
  type FontesLidas,
  intervaloDaCompetencia,
  montarMatriz,
  planejarColeta,
  type RegistroParaMatriz,
} from './estatistica.js';

describe('competência e quantidades', () => {
  it('intervalo do mês, com fevereiro bissexto e dezembro', () => {
    expect(intervaloDaCompetencia('2026-03')).toEqual({
      inicio: '2026-03-01',
      fim: '2026-03-31',
      seguinte: '2026-04-01',
      dias: 31,
    });
    expect(intervaloDaCompetencia('2028-02').dias).toBe(29);
    expect(intervaloDaCompetencia('2026-12').seguinte).toBe('2027-01-01');
    expect(() => intervaloDaCompetencia('2026-13')).toThrow(/inválida/);
    expect(() => intervaloDaCompetencia('março')).toThrow(/inválida/);
  });
  it('competência futura', () => {
    expect(competenciaFutura('2026-11', '2026-10-28')).toBe(true);
    expect(competenciaFutura('2026-10', '2026-10-28')).toBe(false);
  });
  it('centésimos', () => {
    expect(centesimos(12.345)).toBe(1235);
    expect(deCentesimos(1235)).toBe(12.35);
  });
});

const centros = [
  { id: 1, codigo: 300100 },
  { id: 2, codigo: 300310 },
  { id: 3, codigo: 300500 },
];
const vazio: FontesLidas = {
  censo: { grupos: [], diasFechados: 0 },
  internacoes: [],
  cirurgias: [],
  exames: [],
  requisicoes: [],
  colaboradores: [],
  leitos: [],
};

describe('coleta da competência', () => {
  it('censo fechado em todos os dias: paciente-dia do censo, não estimado', () => {
    const p = planejarColeta(
      { ...vazio, censo: { grupos: [{ cdc: 300100, quantidade: 301 }], diasFechados: 31 } },
      centros,
      31,
    );
    expect(p.linhas.filter((l) => l.codigo === 'pacienteDia')).toEqual([
      { centro: 1, codigo: 'pacienteDia', cent: 30_100, fonte: 'censo', estimada: false, tipoDado: 1 },
    ]);
    expect(p.fontes[0]).toMatchObject({ fonte: 'censo', grupos: 1, centros: 1, semCentro: 0, aviso: null });
  });
  it('censo incompleto: paciente-dia estimado pelas internações, com o aviso dos dias fechados', () => {
    const p = planejarColeta(
      {
        ...vazio,
        censo: { grupos: [{ cdc: 300100, quantidade: 10 }], diasFechados: 3 },
        internacoes: [
          { cdc: 300100, quantidade: 301 },
          { cdc: 999999, quantidade: 7 },
        ],
      },
      centros,
      31,
    );
    expect(p.linhas).toEqual([
      { centro: 1, codigo: 'pacienteDia', cent: 30_100, fonte: 'internacoes', estimada: true, tipoDado: 1 },
    ]);
    expect(p.fontes[0]).toMatchObject({ fonte: 'internacoes', estimada: true, semCentro: 1 });
    expect(p.fontes[0]!.aviso).toContain('3 de 31 dias');
  });
  it('cirurgias: horas de sala = Σ duração × quantidade (90 × 2 + 30 × 1 = 210 min = 3,5 h) e a quantidade', () => {
    const p = planejarColeta(
      {
        ...vazio,
        cirurgias: [
          { cdc: 300310, minutos: 90, n: 2 },
          { cdc: 300310, minutos: 30, n: 1 },
          { cdc: 300310, minutos: null, n: 4 },
          { cdc: null, minutos: 60, n: 1 },
        ],
      },
      centros,
      31,
    );
    const daCir = p.linhas.filter((l) => l.fonte === 'cirurgias');
    expect(daCir).toEqual([
      { centro: 2, codigo: 'horasSala', cent: 350, fonte: 'cirurgias', estimada: false, tipoDado: 1 },
      { centro: 2, codigo: 'cirurgias', cent: 700, fonte: 'cirurgias', estimada: false, tipoDado: 1 },
    ]);
    const r = p.fontes.find((f) => f.fonte === 'cirurgias')!;
    expect(r).toMatchObject({ grupos: 4, centros: 1, semCentro: 1 });
    expect(r.aviso).toContain('4 cirurgia(s) sem duração');
  });
  it('exames, requisições, leitos (referência) e colaboradores pelo ID da lotação; zero não grava', () => {
    const p = planejarColeta(
      {
        ...vazio,
        exames: [
          { cdc: 300500, quantidade: 34_535 },
          { cdc: 300100, quantidade: 0 },
        ],
        requisicoes: [{ cdc: 300100, quantidade: 7510 }],
        leitos: [{ cdc: 300100, quantidade: 12 }],
        colaboradores: [
          { centro: 1, n: 4, horas: 160 },
          { centro: 77, n: 1, horas: 40 },
        ],
      },
      centros,
      30,
    );
    expect(p.linhas.map((l) => [l.centro, l.codigo, l.cent, l.tipoDado])).toEqual([
      [3, 'exames', 3_453_500, 1],
      [1, 'requisicoes', 751_000, 1],
      [1, 'colaboradores', 400, 1],
      [1, 'horasContratadas', 16_000, 1],
      [1, 'leitos', 1200, 2],
    ]);
    expect(p.fontes.find((f) => f.fonte === 'colaboradores')).toMatchObject({ semCentro: 1, aviso: null });
    expect(p.fontes.map((f) => f.fonte)).toEqual([
      'internacoes',
      'cirurgias',
      'exames',
      'requisicoes',
      'colaboradores',
      'leitos',
    ]);
  });
  it('sem colaborador no cadastro de pessoas: o aviso', () => {
    const p = planejarColeta(vazio, centros, 31);
    expect(p.linhas).toEqual([]);
    expect(p.fontes.find((f) => f.fonte === 'colaboradores')!.aviso).toContain('Nenhum colaborador');
  });
});

const reg = (
  x: Partial<RegistroParaMatriz> & Pick<RegistroParaMatriz, 'id' | 'centro' | 'codigo'>,
): RegistroParaMatriz => ({
  competencia: '2026-03',
  cent: 100,
  origem: 'coletada',
  fonte: 'exames',
  estimada: false,
  tipoDado: 1,
  observacao: null,
  registradoPor: 'SINT.CUSTOS',
  registradoEm: '2026-04-02T10:00:00',
  ...x,
});

describe('matriz da competência', () => {
  it('o manual prevalece sobre o coletado; entre dois do mesmo tipo, o mais recente', () => {
    const m = montarMatriz('2026-03', [
      reg({ id: 1, centro: 1, codigo: 'exames', cent: 1000 }),
      reg({ id: 2, centro: 1, codigo: 'exames', cent: 1200, origem: 'manual', fonte: 'manual' }),
      reg({ id: 3, centro: 2, codigo: 'exames', cent: 500 }),
      reg({ id: 4, centro: 2, codigo: 'exames', cent: 600, registradoEm: '2026-04-03T10:00:00' }),
    ]);
    expect(m.linhas.map((l) => [l.centro, l.valores.exames?.id, l.valores.exames?.quantidade])).toEqual([
      [1, 2, 12],
      [2, 4, 6],
    ]);
    // Total = soma das parcelas: 12 + 6 = 18.
    expect(m.totais).toEqual({ exames: 18 });
    expect(m.avisos).toEqual([]);
  });
  it('referência (área) herdada da competência anterior mais recente; lançamento não herda; posterior não entra', () => {
    const m = montarMatriz('2026-03', [
      reg({
        id: 1,
        centro: 1,
        codigo: 'areaM2',
        cent: 12_050,
        competencia: '2026-01',
        tipoDado: 2,
        origem: 'manual',
        fonte: 'manual',
      }),
      reg({
        id: 2,
        centro: 1,
        codigo: 'areaM2',
        cent: 13_000,
        competencia: '2026-02',
        tipoDado: 2,
        origem: 'manual',
        fonte: 'manual',
      }),
      reg({
        id: 3,
        centro: 1,
        codigo: 'areaM2',
        cent: 99_900,
        competencia: '2026-04',
        tipoDado: 2,
        origem: 'manual',
        fonte: 'manual',
      }),
      reg({
        id: 4,
        centro: 1,
        codigo: 'kgRoupa',
        cent: 5000,
        competencia: '2026-02',
        origem: 'manual',
        fonte: 'manual',
      }),
      reg({ id: 5, centro: 2, codigo: 'pacienteDia', cent: 30_100, estimada: true, fonte: 'internacoes' }),
      reg({ id: 6, centro: 2, codigo: 'foraDoCatalogo' }),
    ]);
    expect(m.linhas).toHaveLength(2);
    expect(m.linhas[0]!.valores.areaM2).toMatchObject({ id: 2, quantidade: 130, herdadaDe: '2026-02' });
    expect(m.linhas[0]!.valores.kgRoupa).toBeUndefined();
    expect(m.linhas[1]!.valores.pacienteDia).toMatchObject({ estimada: true, herdadaDe: null });
    expect(m.totais).toEqual({ areaM2: 130, pacienteDia: 301 });
    expect(m.avisos).toEqual([
      '1 valor(es) estimado(s): confira antes da apuração do mês.',
      '1 valor(es) de referência vindo(s) de competência anterior.',
    ]);
  });
  it('sem registro: o aviso para coletar ou lançar', () => {
    expect(montarMatriz('2026-03', []).avisos[0]).toContain('Nenhuma estatística');
  });
});
