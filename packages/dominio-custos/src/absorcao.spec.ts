// Regra 7 (ficha do M54): custeio por absorção com rateio sequencial, com as parcelas. Três centros que rateiam/recebem
// (administração → lavanderia → produtivos) e dois produtivos sintéticos; valores em centavos.
import { describe, expect, it } from 'vitest';
import { apurarAbsorcao, type CentroParaApuracao, type CustoDiretoLido } from './absorcao.js';

const centro = (
  id: number,
  classe: 'produtivo' | 'auxiliar' | 'administrativo',
  ordem: number | null = null,
  criterio: string | null = null,
  ativo = true,
): CentroParaApuracao => ({
  id,
  codigo: 1000 + id,
  nome: `CENTRO SINTETICO ${id}`,
  ativo,
  classificacao: { classe, ordemRateio: ordem, criterio },
});

const ADM = centro(1, 'administrativo', 1, 'colaboradores');
const LAV = centro(2, 'auxiliar', 2, 'kgRoupa');
const UTI = centro(3, 'produtivo');
const ENF = centro(4, 'produtivo');
const CENTROS = [UTI, LAV, ENF, ADM];

const d = (centroId: number | null, grupo: CustoDiretoLido['grupo'], centavos: number): CustoDiretoLido => ({
  centro: centroId,
  grupo,
  centavos,
});

const DIRETOS = [
  d(1, 'pessoal', 100_000),
  d(2, 'materiais', 50_000),
  d(3, 'pessoal', 300_000),
  d(4, 'materiais', 200_000),
];
const EST = new Map<number, Record<string, number>>([
  [2, { colaboradores: 200 }],
  [3, { colaboradores: 500, kgRoupa: 6_000, pacienteDia: 12_000 }],
  [4, { colaboradores: 300, kgRoupa: 4_000, pacienteDia: 40_000 }],
]);

describe('absorção com rateio sequencial (três centros que repartem e recebem)', () => {
  const r = apurarAbsorcao(CENTROS, DIRETOS, EST);
  const linha = (id: number) => r.linhas.find((l) => l.centro === id)!;

  it('a ordem das linhas é a sequência do rateio e depois os produtivos', () => {
    expect(r.linhas.map((l) => l.centro)).toEqual([1, 2, 3, 4]);
  });

  it('a administração reparte pelos colaboradores aos que vêm depois (lavanderia e produtivos)', () => {
    expect(linha(1).repassado).toBe(100_000);
    expect(linha(1).baseCriterioCent).toBe(1_000);
    expect(linha(2).recebidos).toEqual([{ de: 1, centavos: 20_000 }]);
    expect(linha(3).recebidos[0]).toEqual({ de: 1, centavos: 50_000 });
    expect(linha(4).recebidos[0]).toEqual({ de: 1, centavos: 30_000 });
  });

  it('a lavanderia reparte o direto + o recebido pelos quilos de roupa, e nunca de volta à administração', () => {
    expect(linha(2).repassado).toBe(70_000);
    expect(linha(3).recebidos).toEqual([
      { de: 1, centavos: 50_000 },
      { de: 2, centavos: 42_000 },
    ]);
    expect(linha(4).recebidos[1]).toEqual({ de: 2, centavos: 28_000 });
    expect(linha(1).recebidoTotal).toBe(0);
  });

  it('custo final = direto + rateios recebidos, com as parcelas; auxiliares terminam em zero', () => {
    expect(linha(3).custoFinal).toBe(300_000 + 50_000 + 42_000);
    expect(linha(4).custoFinal).toBe(200_000 + 30_000 + 28_000);
    expect(linha(1).custoFinal).toBe(0);
    expect(linha(2).custoFinal).toBe(0);
    for (const l of r.linhas.filter((x) => x.classe === 'produtivo'))
      expect(l.custoFinal).toBe(l.diretoTotal + l.recebidos.reduce((s, p) => s + p.centavos, 0));
  });

  it('conservação: custo direto lido = custo final dos produtivos (nada parado)', () => {
    expect(r.totais.diretoTotal).toBe(650_000);
    expect(r.totais.custoFinalProdutivos).toBe(650_000);
    expect(r.totais.naoRateado).toBe(0);
    expect(r.totais.direto).toEqual({ pessoal: 400_000, materiais: 250_000, despesas: 0 });
  });

  it('produção e custo unitário pelo paciente-dia (centavos por paciente-dia)', () => {
    expect(linha(3).producao).toEqual({ codigo: 'pacienteDia', quantidadeCent: 12_000 });
    expect(linha(3).custoUnitario).toBe(Math.round(392_000 / 120));
    expect(linha(4).custoUnitario).toBe(Math.round(258_000 / 400));
    expect(r.pendencias).toEqual([]);
  });

  it('reapurar com os mesmos dados dá o mesmo resultado (determinístico)', () => {
    expect(apurarAbsorcao([...CENTROS].reverse(), [...DIRETOS].reverse(), EST)).toEqual(r);
  });
});

describe('casos de borda da absorção', () => {
  it('centavo indivisível: a soma das partes é o total (maior resto)', () => {
    const r = apurarAbsorcao(
      [
        centro(1, 'administrativo', 1, 'colaboradores'),
        centro(3, 'produtivo'),
        centro(4, 'produtivo'),
        centro(5, 'produtivo'),
      ],
      [d(1, 'pessoal', 100)],
      new Map([
        [3, { colaboradores: 100 }],
        [4, { colaboradores: 100 }],
        [5, { colaboradores: 100 }],
      ]),
    );
    expect(r.linhas.filter((l) => l.classe === 'produtivo').map((l) => l.custoFinal)).toEqual([34, 33, 33]);
    expect(r.totais.custoFinalProdutivos).toBe(100);
  });

  it('auxiliar sem base (nenhum seguinte com a estatística): fica parado e é pendência, a conservação fecha', () => {
    const r = apurarAbsorcao(
      [centro(2, 'auxiliar', 1, 'refeicoes'), centro(3, 'produtivo')],
      [d(2, 'materiais', 9_000), d(3, 'pessoal', 1_000)],
      new Map(),
    );
    expect(r.linhas[0]).toMatchObject({ naoRateado: 9_000, custoFinal: 9_000, repassado: 0 });
    expect(r.totais.naoRateado).toBe(9_000);
    expect(r.totais.diretoTotal).toBe(r.totais.custoFinalProdutivos + r.totais.naoRateado);
    expect(r.pendencias.map((p) => p.tipo)).toEqual(['sem-base', 'sem-producao']);
    expect(r.pendencias[0]).toMatchObject({ centros: [2], centavos: 9_000, bloqueia: false });
  });

  it('auxiliar sem custo nenhum não gera pendência de base', () => {
    const r = apurarAbsorcao([centro(2, 'auxiliar', 1, 'refeicoes'), centro(3, 'produtivo')], [], new Map());
    expect(r.pendencias).toEqual([]);
    expect(r.linhas[0]?.baseCriterioCent).toBe(0);
  });

  it('despesas sem centro: distribuídas pela proporção do custo direto (parcela despesas gerais)', () => {
    const r = apurarAbsorcao(
      [centro(3, 'produtivo'), centro(4, 'produtivo')],
      [d(3, 'pessoal', 3_000), d(4, 'materiais', 1_000), d(null, 'despesas', 1_000)],
      new Map([[3, { exames: 100 }]]),
    );
    expect(r.linhas.map((l) => l.despesasGerais)).toEqual([750, 250]);
    expect(r.totais.despesasSemCentro).toBe(1_000);
    expect(r.totais.diretoTotal).toBe(5_000);
    expect(r.totais.custoFinalProdutivos).toBe(5_000);
    expect(r.pendencias.map((p) => p.tipo)).toEqual(['despesas-sem-centro', 'sem-producao']);
    expect(r.linhas[0]?.producao?.codigo).toBe('exames');
  });

  it('despesas sem centro e nenhum custo direto: ficam não distribuídas (pendência), a conservação fecha', () => {
    const r = apurarAbsorcao([centro(3, 'produtivo')], [d(null, 'despesas', 500)], new Map());
    expect(r.totais.despesasNaoDistribuidas).toBe(500);
    expect(r.totais.diretoTotal).toBe(r.totais.custoFinalProdutivos + r.totais.despesasNaoDistribuidas);
    expect(r.pendencias.map((p) => p.tipo)).toEqual(['despesas-nao-distribuidas']);
  });

  it('custo em centro inativo, sem classificação, fora do cadastro ou pessoal sem lotação fica fora do custeio', () => {
    const inativo = centro(7, 'produtivo', null, null, false);
    const semClasse: CentroParaApuracao = { ...centro(8, 'produtivo'), classificacao: null };
    const r = apurarAbsorcao(
      [centro(3, 'produtivo'), inativo, semClasse],
      [
        d(3, 'pessoal', 100),
        d(7, 'materiais', 10),
        d(8, 'materiais', 20),
        d(-555, 'materiais', 30),
        d(null, 'pessoal', 40),
        d(3, 'despesas', 0),
      ],
      new Map(),
    );
    expect(r.totais.foraDoCusteio).toBe(100);
    expect(r.totais.diretoTotal).toBe(100);
    const p = r.pendencias.find((x) => x.tipo === 'centro-fora-do-custeio')!;
    expect(p.centros).toEqual([7, 8]);
    expect(p.mensagem).toContain('sem centro de custo');
  });

  it('lista de nomes longa é resumida ("e mais")', () => {
    const fora = Array.from({ length: 7 }, (_, i) => ({
      ...centro(20 + i, 'produtivo'),
      classificacao: null,
    }));
    const r = apurarAbsorcao(
      [centro(3, 'produtivo'), ...fora],
      fora.map((c) => d(c.id, 'materiais', 1)),
      new Map(),
    );
    expect(r.pendencias[0]?.mensagem).toContain('e mais 2');
  });

  it('ordem igual entre dois que repartem: desempata pelo ID (determinístico)', () => {
    const r = apurarAbsorcao(
      [centro(9, 'auxiliar', 1, 'leitos'), centro(5, 'auxiliar', 1, 'leitos'), centro(3, 'produtivo')],
      [d(9, 'materiais', 100), d(5, 'materiais', 100)],
      new Map([
        [9, { leitos: 100 }],
        [3, { leitos: 100 }],
      ]),
    );
    expect(r.linhas.map((l) => l.centro)).toEqual([5, 9, 3]);
    // O 5 reparte ao 9 e ao 3 (metade cada); o 9 reparte tudo ao 3.
    expect(r.linhas[2]?.custoFinal).toBe(200);
  });
});
