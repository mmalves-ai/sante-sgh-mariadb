// Estrutura de custos (M54-F4): sugestão da classe, sequência do rateio, contagem por classe com o total e as pendências
// que bloqueiam a apuração. Centros sintéticos.
import { describe, expect, it } from 'vitest';
import {
  type CentroParaEstrutura,
  classeValida,
  contarEstrutura,
  pendenciasDaEstrutura,
  sequenciaDoRateio,
  sugerirClasse,
} from './estrutura.js';

const c = (
  id: number,
  classe: CentroParaEstrutura['classificacao'] extends infer T
    ? T extends { classe: infer K }
      ? K
      : never
    : never,
  extra: Partial<NonNullable<CentroParaEstrutura['classificacao']>> & { ativo?: boolean } = {},
): CentroParaEstrutura => ({
  id,
  codigo: 1000 + id,
  nome: `CENTRO SINTETICO ${id}`,
  ativo: extra.ativo ?? true,
  produtivoCadastro: null,
  classificacao: {
    classe,
    ordemRateio: classe === 'produtivo' ? null : (extra.ordemRateio ?? id),
    criterio: classe === 'produtivo' ? null : (extra.criterio ?? 'colaboradores'),
    unidadeMensuracao: extra.unidadeMensuracao ?? null,
  },
});
const sem = (id: number, ativo = true): CentroParaEstrutura => ({
  id,
  codigo: 1000 + id,
  nome: `CENTRO SINTETICO ${id}`,
  ativo,
  produtivoCadastro: true,
  classificacao: null,
});

describe('sugestão da classe', () => {
  it('pela marca de produtivo e, entre auxiliar e administrativo, pelo nome', () => {
    expect(sugerirClasse(true, 'UTI ADULTO')).toBe('produtivo');
    expect(sugerirClasse(false, 'LAVANDERIA')).toBe('auxiliar');
    expect(sugerirClasse(false, 'DIRETORIA ADMINISTRATIVA')).toBe('administrativo');
    expect(sugerirClasse(false, 'Faturamento')).toBe('administrativo');
    expect(sugerirClasse(null, 'QUALQUER')).toBeNull();
  });
  it('classe válida só do catálogo', () => {
    expect(classeValida('auxiliar')).toBe(true);
    expect(classeValida('apoio')).toBe(false);
  });
});

describe('sequência do rateio e contagem', () => {
  const centros = [
    c(1, 'produtivo'),
    c(2, 'administrativo', { ordemRateio: 1, criterio: 'colaboradores' }),
    c(3, 'auxiliar', { ordemRateio: 2, criterio: 'kgRoupa' }),
    c(4, 'auxiliar', { ordemRateio: 3, criterio: 'refeicoes', ativo: false }),
    sem(5),
    sem(6, false),
  ];
  it('auxiliares e administrativos ativos pela ordem; os produtivos só recebem', () => {
    expect(sequenciaDoRateio(centros)).toEqual([
      { id: 2, ordem: 1, criterio: 'colaboradores' },
      { id: 3, ordem: 2, criterio: 'kgRoupa' },
    ]);
  });
  it('a ordem empatada desempata pelo ID', () => {
    const s = sequenciaDoRateio([c(9, 'auxiliar', { ordemRateio: 1 }), c(8, 'auxiliar', { ordemRateio: 1 })]);
    expect(s.map((x) => x.id)).toEqual([8, 9]);
  });
  it('contagem dos ativos por classe, com o total igual à soma das parcelas (1 + 1 + 1 + 1 = 4)', () => {
    const k = contarEstrutura(centros);
    expect(k).toEqual({ produtivo: 1, auxiliar: 1, administrativo: 1, semClasse: 1, total: 4 });
    expect(k.produtivo + k.auxiliar + k.administrativo + k.semClasse).toBe(k.total);
  });
});

describe('pendências da estrutura', () => {
  it('estrutura completa: nenhuma pendência', () => {
    expect(
      pendenciasDaEstrutura(
        [c(1, 'produtivo'), c(2, 'auxiliar', { ordemRateio: 1, unidadeMensuracao: 0 })],
        new Set([0]),
      ),
    ).toEqual([]);
  });
  it('sem classe, sem produtivo, ordem repetida e critério fora do catálogo bloqueiam', () => {
    const ps = pendenciasDaEstrutura(
      [
        sem(1),
        c(2, 'auxiliar', { ordemRateio: 5 }),
        c(3, 'administrativo', { ordemRateio: 5 }),
        c(4, 'auxiliar', { ordemRateio: 6, criterio: 'inexistente' }),
      ],
      new Set(),
    );
    expect(ps.map((p) => [p.tipo, p.bloqueia, p.centros])).toEqual([
      ['sem-classe', true, [1]],
      ['sem-produtivo', true, []],
      ['ordem-repetida', true, [2, 3]],
      ['criterio-desconhecido', true, [4]],
    ]);
    expect(ps[2]!.mensagem).toContain('A ordem 5');
  });
  it('unidade fora do cadastro e inativo classificado só avisam; a lista longa abrevia os nomes', () => {
    const muitos = Array.from({ length: 7 }, (_, i) => sem(10 + i, false));
    const ps = pendenciasDaEstrutura(
      [
        c(1, 'produtivo', { unidadeMensuracao: 77 }),
        ...Array.from({ length: 7 }, (_, i) => c(20 + i, 'auxiliar', { ordemRateio: 20 + i, ativo: false })),
        ...muitos,
      ],
      new Set([0]),
    );
    expect(ps.map((p) => [p.tipo, p.bloqueia])).toEqual([
      ['unidade-desconhecida', false],
      ['inativo-classificado', false],
    ]);
    expect(ps[1]!.mensagem).toContain('e mais 2');
  });
});
