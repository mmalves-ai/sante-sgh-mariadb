// 13º salário (M53-F3; Leis 4.090/1962 e 4.749/1965): 1ª parcela e parcela final por empresa e ano, avos, médias,
// adiantamentos, INSS em separado, IRRF exclusivo, FGTS sem repetir o adiantamento, pendências e avisos. Números de
// 2026 só para a conta à mão; colaboradores sintéticos.
import { describe, expect, it } from 'vitest';
import { conferirCalculo } from './calculo.js';
import {
  calcularDecimoTerceiro,
  competenciaDoDecimo,
  type EntradaCalculoDecimo,
  entraNoDecimo,
} from './decimo-terceiro.js';
import { PARAM_2026, rubricasDeTeste, SALARIO, TABELA_2026, VINC } from './fixtures-folha.spec.js';
import type { HistoricoFolha } from './medias.js';

const entrada = (extra: Partial<EntradaCalculoDecimo> = {}): EntradaCalculoDecimo => ({
  empresa: 1,
  ano: 2026,
  parcela: 2,
  pagamento: '2026-12-18',
  hoje: '2026-12-10',
  vinculos: [VINC(1)],
  salarios: [SALARIO(1)],
  afastamentos: [],
  diasAfastamento: [{ inicio: '2020-01-01', dias: 15 }],
  historico: new Map(),
  adiantamentos: new Map(),
  tabelasLegais: [TABELA_2026],
  parametros: [PARAM_2026],
  rubricas: rubricasDeTeste(),
  ...extra,
});

const valor = (r: ReturnType<typeof calcularDecimoTerceiro>, vinculo: number, papel: string) =>
  r.colaboradores.find((c) => c.resumo.vinculo === vinculo)?.linhas.find((l) => l.papel === papel)?.valor ??
  0;

describe('quem entra e a competência', () => {
  it('a 1ª parcela é da competência do pagamento; a final, de dezembro', () => {
    expect(competenciaDoDecimo(2026, 1, '2026-11-20')).toBe('2026-11');
    expect(competenciaDoDecimo(2026, 2, '2026-12-18')).toBe('2026-12');
  });

  it('só CLT; desligado até o fim do ano (ou até o pagamento) vai à rescisão (D-DESLIG13-534)', () => {
    expect(entraNoDecimo(VINC(1), 2026, 2, '2026-12-18')).toBe(true);
    expect(entraNoDecimo(VINC(1, { tipo: 'pj' }), 2026, 2, '2026-12-18')).toBe(false);
    expect(entraNoDecimo(VINC(1, { desligamento: '2026-12-31' }), 2026, 2, '2026-12-18')).toBe(false);
    expect(entraNoDecimo(VINC(1, { desligamento: '2026-12-31' }), 2026, 1, '2026-11-20')).toBe(true);
    expect(entraNoDecimo(VINC(1, { admissao: '2027-01-02' }), 2026, 2, '2026-12-18')).toBe(false);
  });
});

describe('1ª parcela (D-PRIM13-534)', () => {
  it('metade da remuneração fixa × avos do ano ÷ 12, só com FGTS; quem adiantou nas férias fica fora', () => {
    const r = calcularDecimoTerceiro(
      entrada({
        parcela: 1,
        pagamento: '2026-11-20',
        hoje: '2026-11-10',
        vinculos: [VINC(1), VINC(2, { admissao: '2026-03-20' }), VINC(3)],
        salarios: [SALARIO(1), SALARIO(2), SALARIO(3)],
        adiantamentos: new Map([[3, 150_000]]),
      }),
    );
    expect(r.pendencias).toEqual([]);
    expect(r.competencia).toBe('2026-11');
    expect(valor(r, 1, 'decimoPrimeira')).toBe(150_000);
    expect(valor(r, 2, 'decimoPrimeira')).toBe(112_500); // 9 avos (abril a dezembro)
    expect(valor(r, 1, 'fgts')).toBe(12_000);
    expect(valor(r, 1, 'inssDecimo')).toBe(0);
    expect(valor(r, 1, 'inssPatronal')).toBe(0);
    expect(r.colaboradores.map((c) => c.resumo.vinculo)).toEqual([1, 2]);
    expect(r.foraDaFolha).toBe(1);
    expect(r.totais).toMatchObject({ colaboradores: 2, proventos: 262_500, descontos: 0, liquido: 262_500 });
    expect(conferirCalculo(r.colaboradores, r.totais).ok).toBe(true);
  });

  it('pagamento fora de fevereiro a novembro é aviso', () => {
    const r = calcularDecimoTerceiro(entrada({ parcela: 1, pagamento: '2026-12-02', hoje: '2026-12-01' }));
    expect(r.avisos.map((a) => a.codigo)).toEqual(['pagamento-fora-do-prazo']);
  });
});

describe('parcela final (D-FINAL13-534)', () => {
  it('avos, desconto do adiantamento, INSS em separado, IRRF exclusivo e FGTS sem o adiantamento', () => {
    const r = calcularDecimoTerceiro(
      entrada({
        vinculos: [VINC(2, { admissao: '2026-03-20' })],
        salarios: [SALARIO(2)],
        adiantamentos: new Map([[2, 112_500]]),
      }),
    );
    expect(r.pendencias).toEqual([]);
    expect(valor(r, 2, 'decimoTerceiro')).toBe(225_000);
    expect(valor(r, 2, 'decimoDesconto')).toBe(112_500);
    expect(valor(r, 2, 'inssDecimo')).toBe(17_973); // 1.518,00 × 7,5% + 732,00 × 9%
    expect(valor(r, 2, 'irrfDecimo')).toBe(0);
    expect(valor(r, 2, 'baseInss')).toBe(225_000);
    expect(valor(r, 2, 'fgts')).toBe(9_000); // (2.250,00 - 1.125,00) × 8%
    expect(r.colaboradores[0]!.resumo).toMatchObject({ diasPagos: 9, liquido: 225_000 - 112_500 - 17_973 });
  });

  it('IRRF exclusivo: sem o desconto simplificado e sem a redução mensal (D-IRRF13-534)', () => {
    const r = calcularDecimoTerceiro(entrada());
    expect(valor(r, 1, 'inssDecimo')).toBe(25_341);
    // (3.000,00 - 253,41) = 2.746,59 × 7,5% - 182,16 = 23,83.
    expect(valor(r, 1, 'irrfDecimo')).toBe(2_383);
  });

  it('médias das variáveis até novembro ÷ avos até novembro × avos ÷ 12; competência sem cálculo é aviso', () => {
    const meses = Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
    const hist: HistoricoFolha[] = meses
      .filter((c) => c !== '2026-04')
      .map((competencia) => ({ competencia, papel: 'salario', quantidade: 30, valor: 300_000 }));
    hist.push({ competencia: '2026-06', papel: 'horaExtra50', quantidade: 1_320, valor: 0 });
    const r = calcularDecimoTerceiro(entrada({ historico: new Map([[1, hist]]) }));
    // 300.000 × 1.320 min × 150% ÷ (220 × 60 × 10.000 × 11) × 12/12 = 4.090,91 → 4.091.
    expect(valor(r, 1, 'decimoMedias')).toBe(4_091);
    expect(r.avisos).toEqual([{ codigo: 'competencias-sem-calculo', competencias: ['2026-04'] }]);
  });

  it('pendências: antes de dezembro, sem salário, papel sem rubrica e líquido negativo', () => {
    expect(calcularDecimoTerceiro(entrada({ hoje: '2026-11-30' })).pendencias.map((p) => p.codigo)).toEqual([
      'competencia-futura',
    ]);
    expect(calcularDecimoTerceiro(entrada({ salarios: [] })).pendencias.map((p) => p.codigo)).toEqual([
      'sem-salario',
    ]);
    const semRub = { ...PARAM_2026, rubricas: { ...PARAM_2026.rubricas, decimoTerceiro: null } };
    expect(calcularDecimoTerceiro(entrada({ parametros: [semRub] })).pendencias).toEqual([
      { codigo: 'papel-sem-rubrica', vinculos: [1], papel: 'decimoTerceiro' },
    ]);
    const neg = calcularDecimoTerceiro(entrada({ adiantamentos: new Map([[1, 400_000]]) }));
    expect(neg.pendencias.map((p) => p.codigo)).toEqual(['liquido-negativo']);
    expect(neg.colaboradores).toEqual([]);
  });

  it('afastado o ano inteiro: sem avos, fora da parcela', () => {
    const r = calcularDecimoTerceiro(
      entrada({ afastamentos: [{ vinculo: 1, inicio: '2025-11-01', fim: null, situacao: 'ativo' }] }),
    );
    expect(r.colaboradores).toEqual([]);
    expect(r.foraDaFolha).toBe(1);
  });
});
