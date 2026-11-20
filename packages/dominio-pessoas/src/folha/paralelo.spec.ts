// M53.3 (regra 8): o cálculo em paralelo com a folha externa, por rubrica-resumo, sem dado pessoal. Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  atualizarSecaoParalelo,
  compararParalelo,
  juntarCompetenciaParalelo,
  type LinhaExternaParalelo,
  MARCA_FIM_PARALELO,
  MARCA_INICIO_PARALELO,
  type VinculoCalculadoParalelo,
} from './paralelo.js';

const v = (vinculo: number, proventos: number, descontos: number): VinculoCalculadoParalelo => ({
  vinculo,
  proventos,
  descontos,
  inss: Math.round(descontos * 0.8),
  irrf: descontos - Math.round(descontos * 0.8),
  fgts: Math.round(proventos * 0.08),
  encargosEmpresa: Math.round(proventos * 0.278),
});
const ext = (x: VinculoCalculadoParalelo, ajuste = 0): LinhaExternaParalelo[] => [
  { vinculo: x.vinculo, rubrica: 'proventos', valor: x.proventos + ajuste },
  { vinculo: x.vinculo, rubrica: 'descontos', valor: x.descontos },
  { vinculo: x.vinculo, rubrica: 'liquido', valor: x.proventos + ajuste - x.descontos },
];
const guias = (vs: readonly VinculoCalculadoParalelo[]): LinhaExternaParalelo[] => [
  { vinculo: null, rubrica: 'inss', valor: vs.reduce((t, x) => t + x.inss + x.encargosEmpresa, 0) },
  { vinculo: null, rubrica: 'fgts', valor: vs.reduce((t, x) => t + x.fgts, 0) },
  { vinculo: null, rubrica: 'irrf', valor: vs.reduce((t, x) => t + x.irrf, 0) },
];
const base = { empresa: 1, competencia: '2026-09', processo: 10, loteExterno: 20 };

describe('cálculo em paralelo com a folha externa (regra 8)', () => {
  const a = v(1, 300_000, 30_000);
  const b = v(2, 450_000, 60_000);

  it('folhas iguais conferem em todas as rubricas, com as contas impressas', () => {
    const r = compararParalelo({
      ...base,
      calculado: [a, b],
      externo: [...ext(a), ...ext(b), ...guias([a, b])],
    });
    expect(r.confere).toBe(true);
    expect(r.vinculos).toEqual({ sante: 2, externo: 2, emAmbos: 2, soNoSante: [], soNoExterno: [] });
    expect(r.rubricas.map((x) => x.rubrica)).toEqual([
      'proventos',
      'descontos',
      'liquido',
      'inss',
      'fgts',
      'irrf',
    ]);
    expect(r.rubricas[0]).toMatchObject({
      sante: 750_000,
      externo: 750_000,
      diferenca: 0,
      conta: '7500.00 − 7500.00 = 0.00',
    });
  });

  it('diferença num vínculo aparece na rubrica com o ID e no líquido; a tolerância a absorve', () => {
    const externo = [...ext(a, 150), ...ext(b), ...guias([a, b])];
    const r = compararParalelo({ ...base, calculado: [a, b], externo });
    expect(r.confere).toBe(false);
    const prov = r.rubricas.find((x) => x.rubrica === 'proventos')!;
    expect(prov).toMatchObject({ diferenca: -150, vinculosDivergentes: [1], confere: false });
    expect(r.rubricas.find((x) => x.rubrica === 'liquido')!.vinculosDivergentes).toEqual([1]);
    expect(r.rubricas.find((x) => x.rubrica === 'descontos')!.confere).toBe(true);
    expect(compararParalelo({ ...base, calculado: [a, b], externo, toleranciaCentavos: 200 }).confere).toBe(
      true,
    );
  });

  it('vínculo só num dos lados e guia diferente são divergências', () => {
    const c = v(3, 100_000, 8_000);
    const r = compararParalelo({
      ...base,
      calculado: [a, c],
      externo: [
        ...ext(a),
        ...ext(b),
        ...guias([a, b]).map((g) => (g.rubrica === 'fgts' ? { ...g, valor: g.valor + 1 } : g)),
      ],
    });
    expect(r.vinculos.soNoSante).toEqual([3]);
    expect(r.vinculos.soNoExterno).toEqual([2]);
    expect(r.vinculos.emAmbos).toBe(1);
    expect(r.rubricas.find((x) => x.rubrica === 'fgts')!.confere).toBe(false);
    expect(r.confere).toBe(false);
  });

  it('linhas de outras rubricas do externo são ignoradas; tolerância negativa vira zero; nenhum nome ou CPF no relatório', () => {
    const r = compararParalelo({
      ...base,
      calculado: [a],
      externo: [...ext(a), { vinculo: 1, rubrica: 'outra', valor: 99 }, ...guias([a])],
      toleranciaCentavos: -5,
    });
    expect(r.toleranciaCentavos).toBe(0);
    expect(r.confere).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/nome|cpf/i);
  });
});

describe('paralelo por competência: a mensal com as rescisões do mês (D-PARALELO-535)', () => {
  const p = (id: number, tipo: string, vinculos: VinculoCalculadoParalelo[], competencia = '2026-10') => ({
    id,
    tipo,
    empresa: 1,
    competencia,
    vinculos,
  });
  const a = v(1, 300_000, 30_000);
  const b = v(2, 450_000, 60_000);
  // O vínculo 3 foi desligado no mês: fora da mensal (D-DESLIG-533), só na rescisão; a externa traz o saldo e as verbas.
  const desligado = v(3, 520_000, 70_000);

  it('o desligado só na rescisão confere com a folha externa da competência; férias e 13º ficam listados fora', () => {
    const [c, ...resto] = juntarCompetenciaParalelo([
      p(40, 'rescisao', [desligado]),
      p(30, 'mensal', [a, b]),
      p(35, 'ferias', [v(1, 100_000, 0)]),
      p(36, 'decimo1', [v(2, 225_000, 0)]),
    ]);
    expect(resto).toEqual([]);
    expect(c).toMatchObject({
      processo: 30,
      processos: [30, 40],
      deixados: [
        { id: 35, tipo: 'ferias' },
        { id: 36, tipo: 'decimo1' },
      ],
    });
    const r = compararParalelo({
      ...c!,
      loteExterno: 20,
      externo: [...ext(a), ...ext(b), ...ext(desligado), ...guias([a, b, desligado])],
    });
    expect(r.vinculos).toMatchObject({ sante: 3, externo: 3, emAmbos: 3, soNoSante: [], soNoExterno: [] });
    expect(r.confere).toBe(true);
    expect(r).toMatchObject({
      processos: [30, 40],
      deixados: [
        { id: 35, tipo: 'ferias' },
        { id: 36, tipo: 'decimo1' },
      ],
    });
  });

  it('mensal e rescisão do mesmo vínculo somam; cada competência e empresa à parte; só férias não compara', () => {
    const parcial = v(1, 80_000, 8_000);
    const xs = juntarCompetenciaParalelo([
      p(50, 'mensal', [a]),
      p(51, 'rescisao', [parcial]),
      p(60, 'mensal', [b], '2026-09'),
      { ...p(61, 'mensal', [b]), empresa: 2 },
      p(70, 'ferias', [a], '2026-11'),
    ]);
    expect(xs.map((x) => [x.competencia, x.empresa, x.processo])).toEqual([
      ['2026-09', 1, 60],
      ['2026-10', 1, 50],
      ['2026-10', 2, 61],
    ]);
    expect(xs[1]!.calculado).toEqual([
      {
        vinculo: 1,
        proventos: a.proventos + parcial.proventos,
        descontos: a.descontos + parcial.descontos,
        inss: a.inss + parcial.inss,
        irrf: a.irrf + parcial.irrf,
        fgts: a.fgts + parcial.fgts,
        encargosEmpresa: a.encargosEmpresa + parcial.encargosEmpresa,
      },
    ]);
    // Sem a junção (a mensal sozinha), o desligado aparece só na externa: o erro que a junção evita.
    const so = compararParalelo({
      ...base,
      calculado: [a, b],
      externo: [...ext(a), ...ext(b), ...ext(desligado), ...guias([a, b, desligado])],
    });
    expect(so.vinculos.soNoExterno).toEqual([3]);
    expect(so).toMatchObject({ processos: [10], deixados: [] });
  });
});

describe('relatório do paralelo em Markdown (ficha §11)', () => {
  const a = v(1, 300_000, 30_000);
  const exec = (externo: LinhaExternaParalelo[]) => ({
    geradoEm: '2026-10-27',
    estabelecimento: 'pc',
    competenciasFixadas: ['2026-09'],
    processosEmVigor: 1,
    observacao: null,
    relatorios: [compararParalelo({ ...base, calculado: [a], externo })],
  });

  it('sem competência: cria o arquivo com a seção vazia e a observação', () => {
    const md = atualizarSecaoParalelo(null, {
      ...exec([]),
      competenciasFixadas: [],
      processosEmVigor: 0,
      relatorios: [],
      observacao: 'Nenhuma competência comparada ainda.',
    });
    expect(md).toContain('## Paralelo');
    expect(md).toContain('Nenhuma competência comparada ainda.');
    expect(md).toContain('nenhuma (cabe ao dono fixar)');
    expect(md.indexOf(MARCA_INICIO_PARALELO)).toBeLessThan(md.indexOf(MARCA_FIM_PARALELO));
  });

  it('uma linha por rubrica com a conta; a explicação e o aceite do DP ficam entre execuções', () => {
    const md1 = atualizarSecaoParalelo('# M53\n\nTexto do marco.\n', exec([...ext(a, 150), ...guias([a])]));
    expect(md1.startsWith('# M53\n\nTexto do marco.')).toBe(true);
    expect(md1).toContain(
      '| 2026-09 | 1 | proventos | 3000.00 | 3001.50 | 3000.00 − 3001.50 = -1.50 | não | pendente |',
    );
    expect(md1).toContain('| 2026-09 | 1 | descontos | 300.00 | 300.00 | 300.00 − 300.00 = 0.00 | sim | - |');
    // O DP escreve a explicação; a próxima execução a preserva e não duplica a seção.
    const editado = md1.replace(
      '| não | pendente |',
      '| não | Arredondamento do adicional na folha externa; aceito pelo DP em 27/10/2026 |',
    );
    const md2 = atualizarSecaoParalelo(editado, exec([...ext(a, 150), ...guias([a])]));
    expect(md2).toContain(
      '| não | Arredondamento do adicional na folha externa; aceito pelo DP em 27/10/2026 |',
    );
    expect(md2.split(MARCA_INICIO_PARALELO)).toHaveLength(2);
    expect(md2).not.toMatch(/cpf|nome/i);
  });
});
