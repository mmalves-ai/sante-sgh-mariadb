// F8, 07-FIN linha 127 (C2-101): as regras da consolidação gerencial (grupo, de-para, apuração com eliminação entre
// empresas pelo CPC 36, demonstrações consolidadas). Massa sintética, valores em centavos.
import { describe, expect, it } from 'vitest';
import {
  apurarConsolidacao,
  conferirApuracaoConsolidacao,
  conferirContaGerencial,
  conferirDeParaConsolidacao,
  conferirGrupoConsolidacao,
  type ContaGerencial,
  demonstracoesConsolidadas,
  type EntradaApuracaoConsolidacao,
  fatorDoMembro,
  type MembroGrupo,
} from './consolidacao.js';

const A: MembroGrupo = { estabelecimento: 1, percentual: 100, metodo: 'integral', consolidadora: true };
const B: MembroGrupo = { estabelecimento: 2, percentual: 100, metodo: 'integral', consolidadora: false };
const grupo = (membros: MembroGrupo[]) =>
  conferirGrupoConsolidacao({ vigenciaInicio: '2026-01-01', vigenciaFim: null, membros });

describe('grupo de consolidação', () => {
  it('aceita dois membros com uma consolidadora integral', () => expect(grupo([A, B])).toBeNull());
  it('recusa grupo de um só, repetido, sem consolidadora ou com duas', () => {
    expect(grupo([A])?.codigo).toBe('membros-insuficientes');
    expect(grupo([A, A])?.codigo).toBe('membro-repetido');
    expect(grupo([{ ...A, consolidadora: false }, B])?.codigo).toBe('consolidadora-unica');
    expect(grupo([A, { ...B, consolidadora: true }])?.codigo).toBe('consolidadora-unica');
  });
  it('integral só com 100%; participação entre 0 e 100; consolidadora integral', () => {
    expect(grupo([A, { ...B, percentual: 60 }])?.codigo).toBe('integral-sem-100');
    expect(grupo([A, { ...B, percentual: 0, metodo: 'proporcional' }])?.codigo).toBe('participacao-invalida');
    expect(grupo([A, { ...B, percentual: 60, metodo: 'proporcional' }])).toBeNull();
    expect(
      grupo([
        { ...A, consolidadora: false },
        { ...B, percentual: 60, metodo: 'proporcional', consolidadora: true },
      ])?.codigo,
    ).toBe('consolidadora-integral');
    expect(
      conferirGrupoConsolidacao({ vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-31', membros: [A, B] })
        ?.codigo,
    ).toBe('vigencia-invalida');
  });
  it('fator: integral 1, proporcional pelo percentual, equivalência fora da soma', () => {
    expect(fatorDoMembro(A)).toBe(1);
    expect(fatorDoMembro({ percentual: 60, metodo: 'proporcional' })).toBe(0.6);
    expect(fatorDoMembro({ percentual: 30, metodo: 'equivalencia_patrimonial' })).toBe(0);
  });
});

describe('de-para e plano gerencial', () => {
  it('só analítica com analítica da mesma natureza', () => {
    const c = { id: 1, natureza: 'ativo', tipo: 'analitica' } as const;
    expect(conferirDeParaConsolidacao(c, { id: 9, natureza: 'ativo', tipo: 'analitica' })).toBeNull();
    expect(conferirDeParaConsolidacao({ ...c, tipo: 'sintetica' }, { ...c, id: 9 })?.codigo).toBe(
      'conta-sintetica',
    );
    expect(conferirDeParaConsolidacao(c, { id: 9, natureza: 'ativo', tipo: 'sintetica' })?.codigo).toBe(
      'gerencial-sintetica',
    );
    expect(conferirDeParaConsolidacao(c, { id: 9, natureza: 'passivo', tipo: 'analitica' })?.codigo).toBe(
      'natureza-diferente',
    );
  });
  it('conta gerencial: classificação, nível e conta de cima sintética da mesma natureza', () => {
    expect(conferirContaGerencial({ classificacao: '1', nivel: 1, pai: null, natureza: 'ativo' })).toBeNull();
    expect(
      conferirContaGerencial({ classificacao: '1.a', nivel: 2, pai: null, natureza: 'ativo' })?.codigo,
    ).toBe('classificacao-invalida');
    expect(
      conferirContaGerencial({ classificacao: '1.1', nivel: 3, pai: null, natureza: 'ativo' })?.codigo,
    ).toBe('nivel-invalido');
    expect(
      conferirContaGerencial({ classificacao: '1.1', nivel: 2, pai: null, natureza: 'ativo' })?.codigo,
    ).toBe('sem-conta-pai');
    expect(
      conferirContaGerencial({
        classificacao: '1.1',
        nivel: 2,
        pai: { classificacao: '1', tipo: 'analitica', natureza: 'ativo' },
        natureza: 'ativo',
      })?.codigo,
    ).toBe('pai-invalido');
  });
});

// Contas contábeis: 11 caixa A, 12 a receber de B (em A), 13 receita A; 21 caixa B, 22 a pagar a A (em B), 23 despesa B.
// Gerenciais: 101 caixa, 102 entre empresas ativo, 103 receita, 201 passivo entre empresas, 301 despesa.
const base = (extra: Partial<EntradaApuracaoConsolidacao> = {}): EntradaApuracaoConsolidacao => ({
  competencia: '2026-10',
  membros: [A, B],
  saldos: [
    {
      estabelecimento: 1,
      conta: 11,
      anterior: 1000_00,
      debitos: 500_00,
      creditos: 0,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
    {
      estabelecimento: 1,
      conta: 12,
      anterior: 0,
      debitos: 300_00,
      creditos: 0,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
    {
      estabelecimento: 1,
      conta: 13,
      anterior: 0,
      debitos: 0,
      creditos: 800_00,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
    {
      estabelecimento: 2,
      conta: 21,
      anterior: 2000_00,
      debitos: 0,
      creditos: 0,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
    {
      estabelecimento: 2,
      conta: 22,
      anterior: 0,
      debitos: 0,
      creditos: 300_00,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
    {
      estabelecimento: 2,
      conta: 23,
      anterior: 0,
      debitos: 300_00,
      creditos: 0,
      debitosApuracao: 0,
      creditosApuracao: 0,
    },
  ],
  depara: new Map([
    [11, 101],
    [21, 101],
    [12, 102],
    [22, 201],
    [13, 103],
    [23, 301],
  ]),
  naturezaSaldo: new Map([
    [12, 'devedora'],
    [22, 'credora'],
  ]),
  transacoes: [{ id: 7, estabelecimento: 1, contraparte: 2, conta: 12, contaContraparte: 22, valor: 300_00 }],
  eliminaEntreEmpresas: true,
  ...extra,
});
const total = (r: ReturnType<typeof apurarConsolidacao>, g: number) =>
  r.linhas.find((l) => l.gerencial === g && l.origem === null);

describe('apuração mensal com eliminação (CPC 36)', () => {
  it('soma os membros pelo de-para e elimina a transação entre empresas pela contrapartida', () => {
    const r = apurarConsolidacao(base());
    expect(r.pendencias).toEqual([]);
    expect(total(r, 101)?.final).toBe(3500_00);
    expect(r.eliminacoes).toEqual([
      {
        sequencia: 1,
        transacao: 7,
        origem: 1,
        contraparte: 2,
        debitoConta: 22,
        creditoConta: 12,
        valor: 300_00,
      },
    ]);
    // O ativo e o passivo entre empresas zeram no consolidado; nas linhas por origem continuam.
    expect(total(r, 102)?.final).toBe(0);
    expect(total(r, 201)?.final).toBe(0);
    expect(r.linhas.find((l) => l.gerencial === 102 && l.origem === 1)?.final).toBe(300_00);
    expect(r.totalEliminado).toBe(300_00);
    expect(r.transacoesEliminadas).toEqual([7]);
    const t = r.linhas.filter((l) => l.origem === null);
    expect(t.reduce((s, l) => s + l.debitos, 0) - t.reduce((s, l) => s + l.creditos, 0)).toBe(
      t.reduce((s, l) => s + l.final - l.anterior, 0),
    );
  });
  it('o par espelhado (registrado pelos dois lados) é eliminado uma vez', () => {
    const r = apurarConsolidacao(
      base({
        transacoes: [
          { id: 7, estabelecimento: 1, contraparte: 2, conta: 12, contaContraparte: 22, valor: 300_00 },
          { id: 8, estabelecimento: 2, contraparte: 1, conta: 22, contaContraparte: 12, valor: 300_00 },
        ],
      }),
    );
    expect(r.eliminacoes).toHaveLength(1);
    expect(r.transacoesEliminadas).toEqual([7, 8]);
  });
  it('duas transações iguais do mesmo lado são duas eliminações (não se confundem com o espelho)', () => {
    const t = { estabelecimento: 1, contraparte: 2, conta: 12, contaContraparte: 22, valor: 150_00 };
    const r = apurarConsolidacao(
      base({
        transacoes: [
          { id: 7, ...t },
          { id: 9, ...t },
        ],
      }),
    );
    expect(r.eliminacoes.map((x) => x.valor)).toEqual([150_00, 150_00]);
    expect(total(r, 102)?.final).toBe(0);
  });
  it('lista as pendências: conta sem de-para, sem contrapartida, fora do grupo, mesma natureza', () => {
    const depara = new Map(base().depara);
    depara.delete(13);
    const r = apurarConsolidacao(
      base({
        depara,
        naturezaSaldo: new Map([
          [12, 'devedora'],
          [22, 'devedora'],
        ]),
        transacoes: [
          { id: 1, estabelecimento: 1, contraparte: 2, conta: 12, contaContraparte: null, valor: 10_00 },
          { id: 2, estabelecimento: 1, contraparte: 9, conta: 12, contaContraparte: 22, valor: 10_00 },
          { id: 3, estabelecimento: 1, contraparte: 2, conta: 12, contaContraparte: 22, valor: 10_00 },
        ],
      }),
    );
    expect(r.pendencias.map((p) => p.tipo).sort()).toEqual([
      'conta-sem-depara',
      'transacao-fora-do-grupo',
      'transacao-mesma-natureza',
      'transacao-sem-contrapartida',
    ]);
    expect(
      conferirApuracaoConsolidacao({ pendencias: r.pendencias.length, situacaoAnterior: null })?.codigo,
    ).toBe('consolidacao-com-pendencia');
  });
  it('proporcional soma pela participação e elimina pela menor; equivalência fica fora; sem eliminar quando desligado', () => {
    const r = apurarConsolidacao(base({ membros: [A, { ...B, percentual: 60, metodo: 'proporcional' }] }));
    expect(total(r, 101)?.final).toBe(1500_00 + 1200_00);
    expect(r.eliminacoes[0]?.valor).toBe(180_00);
    const eq = apurarConsolidacao(
      base({ membros: [A, { ...B, percentual: 30, metodo: 'equivalencia_patrimonial' }] }),
    );
    expect(total(eq, 101)?.final).toBe(1500_00);
    expect(eq.pendencias.map((p) => p.tipo)).toEqual(['transacao-fora-do-grupo']);
    const sem = apurarConsolidacao(base({ eliminaEntreEmpresas: false }));
    expect(sem.eliminacoes).toEqual([]);
    expect(total(sem, 102)?.final).toBe(300_00);
  });
  it('separa o lançamento de apuração do resultado; liberada não se refaz', () => {
    const r = apurarConsolidacao(
      base({
        saldos: [
          {
            estabelecimento: 1,
            conta: 13,
            anterior: 0,
            debitos: 800_00,
            creditos: 800_00,
            debitosApuracao: 800_00,
            creditosApuracao: 0,
          },
        ],
        transacoes: [],
      }),
    );
    expect(total(r, 103)).toMatchObject({ final: 0, finalSemApuracao: -800_00, debitosSemApuracao: 0 });
    expect(conferirApuracaoConsolidacao({ pendencias: 0, situacaoAnterior: 'liberada' })?.codigo).toBe(
      'apuracao-liberada',
    );
    expect(conferirApuracaoConsolidacao({ pendencias: 0, situacaoAnterior: 'apurada' })).toBeNull();
  });
});

describe('DRE e balanço consolidados', () => {
  const contas: ContaGerencial[] = [
    {
      id: 1,
      classificacao: '1',
      descricao: 'Ativo',
      natureza: 'ativo',
      naturezaSaldo: 'devedora',
      tipo: 'sintetica',
    },
    {
      id: 101,
      classificacao: '1.1',
      descricao: 'Caixa',
      natureza: 'ativo',
      naturezaSaldo: 'devedora',
      tipo: 'analitica',
    },
    {
      id: 2,
      classificacao: '2',
      descricao: 'Passivo',
      natureza: 'passivo',
      naturezaSaldo: 'credora',
      tipo: 'sintetica',
    },
    {
      id: 3,
      classificacao: '3',
      descricao: 'PL',
      natureza: 'patrimonio_liquido',
      naturezaSaldo: 'credora',
      tipo: 'sintetica',
    },
    {
      id: 301,
      classificacao: '3.1',
      descricao: 'Capital',
      natureza: 'patrimonio_liquido',
      naturezaSaldo: 'credora',
      tipo: 'analitica',
    },
    {
      id: 4,
      classificacao: '4',
      descricao: 'Receitas',
      natureza: 'receita',
      naturezaSaldo: 'credora',
      tipo: 'sintetica',
    },
    {
      id: 401,
      classificacao: '4.1',
      descricao: 'Serviços',
      natureza: 'receita',
      naturezaSaldo: 'credora',
      tipo: 'analitica',
    },
    {
      id: 5,
      classificacao: '5',
      descricao: 'Despesas',
      natureza: 'despesa',
      naturezaSaldo: 'devedora',
      tipo: 'sintetica',
    },
    {
      id: 501,
      classificacao: '5.1',
      descricao: 'Pessoal',
      natureza: 'despesa',
      naturezaSaldo: 'devedora',
      tipo: 'analitica',
    },
  ];
  it('DRE do mês e balanço equilibrado com o resultado do exercício', () => {
    const { dre, balanco } = demonstracoesConsolidadas(contas, 1, '2026-10', [
      {
        gerencial: 101,
        competencia: '2026-10',
        debitosSemApuracao: 500_00,
        creditosSemApuracao: 0,
        final: 3500_00,
      },
      {
        gerencial: 301,
        competencia: '2026-10',
        debitosSemApuracao: 0,
        creditosSemApuracao: 0,
        final: -3000_00,
      },
      {
        gerencial: 401,
        competencia: '2026-10',
        debitosSemApuracao: 0,
        creditosSemApuracao: 800_00,
        final: -800_00,
      },
      {
        gerencial: 501,
        competencia: '2026-10',
        debitosSemApuracao: 300_00,
        creditosSemApuracao: 0,
        final: 300_00,
      },
    ]);
    expect(dre.resultadoCentavos).toBe(500_00);
    expect(dre.linhas.find((l) => l.chave === 'receitaBruta')?.valorCentavos).toBe(800_00);
    expect(balanco.totalAtivoCentavos).toBe(3500_00);
    expect(balanco.resultadoExercicioCentavos).toBe(500_00);
    expect(balanco.equilibrado).toBe(true);
  });
});
