import { describe, expect, it } from 'vitest';
import {
  type CondicaoAutoliberacao,
  conferirCurva,
  conferirDelta,
  conferirRegraAutoliberacao,
  decidirAutoliberacao,
  type EntradaAutoliberacao,
  variacaoEntre,
} from './autoliberacao.js';

const agora = new Date('2026-11-25T12:00:00Z');
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);
const faixa = (analito: number, minimo: number, maximo: number): CondicaoAutoliberacao => ({
  tipo: 'faixa',
  analito,
  operador: 'entre',
  valor: null,
  minimo,
  maximo,
  deltaPercentual: null,
  deltaJanelaHoras: null,
});
const base = (over: Partial<EntradaAutoliberacao> = {}): EntradaAutoliberacao => ({
  regras: [{ id: 1, acao: 'liberar', prioridade: 1, condicoes: [faixa(10, 70, 110)] }],
  valores: [{ analito: 10, numero: 90, critico: false }],
  anteriores: [],
  limitesDelta: [],
  interferentes: [],
  curva: null,
  paciente: { idadeAnos: 40, sexo: 'F' },
  agora,
  ...over,
});

describe('autoliberação do resultado (05-SADT linha 11)', () => {
  it('desligada por padrão: sem regra, a liberação é manual', () => {
    expect(decidirAutoliberacao(base({ regras: [] })).decisao).toBe('manual');
  });

  it('libera quando a primeira regra pela prioridade é atendida', () => {
    expect(decidirAutoliberacao(base())).toMatchObject({ decisao: 'liberar', regra: 1, motivos: [] });
    const d = decidirAutoliberacao(
      base({
        regras: [
          { id: 1, acao: 'liberar', prioridade: 5, condicoes: [faixa(10, 70, 110)] },
          { id: 2, acao: 'reter', prioridade: 1, condicoes: [faixa(10, 80, 95)] },
        ],
      }),
    );
    expect(d).toMatchObject({ decisao: 'reter', regra: 2, motivos: ['regra-reter'] });
  });

  it('nenhuma regra atendida retém (nunca libera por omissão)', () => {
    const d = decidirAutoliberacao(base({ valores: [{ analito: 10, numero: 150, critico: false }] }));
    expect(d).toMatchObject({ decisao: 'reter', regra: null, motivos: ['sem-regra-atendida'] });
  });

  it('o crítico retém mesmo com a regra atendida', () => {
    const d = decidirAutoliberacao(base({ valores: [{ analito: 10, numero: 90, critico: true }] }));
    expect(d.decisao).toBe('reter');
    expect(d.motivos).toEqual(['critico']);
  });

  it('delta check contra o anterior do paciente dentro da janela', () => {
    expect(variacaoEntre(130, 100, 'percentual')).toBeCloseTo(30);
    expect(variacaoEntre(130, 100, 'absoluta')).toBe(30);
    expect(variacaoEntre(1, 0, 'percentual')).toBe(Number.POSITIVE_INFINITY);
    const limites = [
      {
        analito: 10,
        tipo: 'percentual' as const,
        variacaoMaxima: 20,
        janelaHoras: 72,
        acao: 'reter_revisao' as const,
      },
    ];
    const valores = [{ analito: 10, numero: 90, critico: false }];
    expect(
      conferirDelta(valores, [{ analito: 10, numero: 60, em: horasAtras(24) }], limites, agora),
    ).toHaveLength(1);
    // Fora da janela não compara; o anterior mais recente é o que vale.
    expect(
      conferirDelta(valores, [{ analito: 10, numero: 60, em: horasAtras(100) }], limites, agora),
    ).toHaveLength(0);
    expect(
      conferirDelta(
        valores,
        [
          { analito: 10, numero: 60, em: horasAtras(48) },
          { analito: 10, numero: 85, em: horasAtras(2) },
        ],
        limites,
        agora,
      ),
    ).toHaveLength(0);
    const d = decidirAutoliberacao(
      base({ anteriores: [{ analito: 10, numero: 60, em: horasAtras(24) }], limitesDelta: limites }),
    );
    expect(d).toMatchObject({ decisao: 'reter', motivos: ['delta'] });
    expect(d.deltas[0]).toMatchObject({ anterior: 60, atual: 90 });
    // A ação "alertar" só avisa: o resultado segue liberado pela regra.
    const alerta = decidirAutoliberacao(
      base({
        anteriores: [{ analito: 10, numero: 60, em: horasAtras(24) }],
        limitesDelta: [{ ...limites[0]!, acao: 'alertar' }],
      }),
    );
    expect(alerta).toMatchObject({ decisao: 'liberar' });
    expect(alerta.deltas).toHaveLength(1);
  });

  it('a condição de delta da regra exige variação dentro do percentual', () => {
    const delta: CondicaoAutoliberacao = {
      ...faixa(10, 0, 0),
      tipo: 'delta',
      operador: null,
      minimo: null,
      maximo: null,
      deltaPercentual: 10,
      deltaJanelaHoras: 48,
    };
    const regras = [
      { id: 1, acao: 'liberar' as const, prioridade: 1, condicoes: [faixa(10, 70, 110), delta] },
    ];
    expect(decidirAutoliberacao(base({ regras })).decisao).toBe('liberar');
    expect(
      decidirAutoliberacao(base({ regras, anteriores: [{ analito: 10, numero: 50, em: horasAtras(1) }] }))
        .motivos,
    ).toEqual(['sem-regra-atendida']);
  });

  it('idade e sexo do paciente entram nas condições', () => {
    const regras = [
      {
        id: 1,
        acao: 'liberar' as const,
        prioridade: 1,
        condicoes: [
          faixa(10, 70, 110),
          { ...faixa(10, 18, 65), tipo: 'idade', analito: null },
          {
            ...faixa(10, 0, 0),
            tipo: 'sexo',
            analito: null,
            operador: null,
            valor: 'F',
            minimo: null,
            maximo: null,
          },
        ],
      },
    ];
    expect(decidirAutoliberacao(base({ regras })).decisao).toBe('liberar');
    expect(decidirAutoliberacao(base({ regras, paciente: { idadeAnos: 70, sexo: 'F' } })).decisao).toBe(
      'reter',
    );
    expect(decidirAutoliberacao(base({ regras, paciente: { idadeAnos: 40, sexo: 'M' } })).decisao).toBe(
      'reter',
    );
  });

  it('substância interferente que bloqueia retém; a que não bloqueia só avisa', () => {
    const d = decidirAutoliberacao(
      base({ interferentes: [{ substancia: 'Biotina', analito: 10, bloqueia: true }] }),
    );
    expect(d).toMatchObject({ decisao: 'reter', motivos: ['interferente'], interferentes: ['Biotina'] });
    expect(
      decidirAutoliberacao(
        base({ interferentes: [{ substancia: 'Lipemia', analito: null, bloqueia: false }] }),
      ),
    ).toMatchObject({ decisao: 'liberar', interferentes: ['Lipemia'] });
    // Interferente de outro analito não conta.
    expect(
      decidirAutoliberacao(base({ interferentes: [{ substancia: 'X', analito: 99, bloqueia: true }] }))
        .decisao,
    ).toBe('liberar');
  });

  it('curva: todos os pontos com valor, na ordem e dentro da tolerância', () => {
    const t0 = new Date('2026-11-25T08:00:00Z');
    const em = (min: number) => new Date(t0.getTime() + min * 60_000);
    const previstos = [
      { sequencia: 1, tempoMinutos: 0 },
      { sequencia: 2, tempoMinutos: 60 },
      { sequencia: 3, tempoMinutos: 120 },
    ];
    const medidos = [
      { sequencia: 1, numero: 85, coletadoEm: em(0) },
      { sequencia: 2, numero: 150, coletadoEm: em(62) },
      { sequencia: 3, numero: 120, coletadoEm: em(121) },
    ];
    expect(conferirCurva({ previstos, medidos, toleranciaMinutos: 10 })).toBeNull();
    expect(conferirCurva({ previstos, medidos: medidos.slice(0, 2), toleranciaMinutos: 10 })).toBe(
      'ponto-faltando',
    );
    expect(
      conferirCurva({
        previstos,
        medidos: [medidos[0]!, { ...medidos[1]!, coletadoEm: em(90) }, medidos[2]!],
        toleranciaMinutos: 10,
      }),
    ).toBe('tempo-fora');
    expect(
      conferirCurva({
        previstos,
        medidos: [medidos[0]!, { ...medidos[1]!, coletadoEm: em(130) }, medidos[2]!],
        toleranciaMinutos: null,
      }),
    ).toBe('ordem-invertida');
    expect(
      decidirAutoliberacao(
        base({ curva: { previstos, medidos: medidos.slice(0, 1), toleranciaMinutos: null } }),
      ),
    ).toMatchObject({ decisao: 'reter', motivos: ['curva'], falhaCurva: 'ponto-faltando' });
  });

  it('cadastro da regra conferido na hora', () => {
    const ok = {
      acao: 'liberar' as const,
      condicoes: [faixa(10, 70, 110)],
      analitosDoExame: [10],
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    expect(conferirRegraAutoliberacao(ok)).toBeNull();
    expect(conferirRegraAutoliberacao({ ...ok, condicoes: [] })).toBe('regra-sem-condicao');
    expect(conferirRegraAutoliberacao({ ...ok, acao: 'reter', condicoes: [] })).toBeNull();
    expect(conferirRegraAutoliberacao({ ...ok, condicoes: [faixa(11, 1, 2)] })).toBe('condicao-analito-fora');
    expect(conferirRegraAutoliberacao({ ...ok, condicoes: [faixa(10, 5, 2)] })).toBe('condicao-faixa');
    expect(
      conferirRegraAutoliberacao({
        ...ok,
        condicoes: [faixa(10, 1, 2), { ...faixa(10, 1, 2), tipo: 'origem' }],
      }),
    ).toBe('condicao-tipo');
    expect(
      conferirRegraAutoliberacao({
        ...ok,
        condicoes: [
          faixa(10, 1, 2),
          { ...faixa(10, 0, 0), tipo: 'delta', minimo: null, maximo: null, deltaPercentual: 0 },
        ],
      }),
    ).toBe('condicao-delta');
    expect(conferirRegraAutoliberacao({ ...ok, vigenciaFim: '2025-01-01' })).toBe('vigencia-invertida');
  });
});
