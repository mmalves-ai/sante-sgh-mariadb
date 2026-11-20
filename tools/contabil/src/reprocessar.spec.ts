// `pnpm contabil:reprocessar` (M54.1, regra 2): duas leituras iguais dão os mesmos lançamentos (idêntico, com os totais
// das duas execuções); uma regra diferente na segunda leitura aparece como diferença; a leitura acima do teto nunca é
// "idêntica"; o fato substituído não conta; as opções e o relatório (só contagens). Dados SINTÉTICOS.
import type { ContaPlano, FatoContabil, RegraContabil } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conferirExecucoes, type LeituraDoPeriodo, opcoesDe, relatorio } from './reprocessar.js';

const conta = (codigo: string): ContaPlano => ({
  empresa: 1,
  codigo,
  nome: `Conta ${codigo}`,
  grupo: 'ativo',
  tipo: 'analitica',
  natureza: 'devedora',
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
});
const fato = (id: number, valor: number, extra: Partial<FatoContabil> = {}): FatoContabil => ({
  tabela: 'MFCONPAG',
  id,
  tipo: 'tituloPagar',
  origem: 1,
  empresa: 1,
  data: '2026-10-05',
  competencia: '2026-10',
  valorCentavos: valor,
  centroCusto: null,
  documento: `título a pagar ${id}`,
  campos: { tipoLancamento: 7 },
  impressao: `imp-${id}-${valor}`,
  carimbo: null,
  estorno: false,
  referencia: null,
  ...extra,
});
const regra = (debito: string): RegraContabil => ({
  empresa: 1,
  origem: 1,
  tipoFato: 'tituloPagar',
  versao: 1,
  nome: 'Títulos a pagar',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  prioridade: 100,
  condicoes: [],
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'fixa', conta: debito },
      valor: { base: 'valorFato' },
      historico: '{documento}',
      centroCusto: 'nenhum',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: '2.1.1.01.0001' },
      valor: { base: 'valorFato' },
      historico: '{documento}',
      centroCusto: 'nenhum',
    },
  ],
});
const leitura = (extra: Partial<LeituraDoPeriodo> = {}): LeituraDoPeriodo => ({
  fatos: [fato(1, 10000), fato(2, 2550)],
  plano: [conta('1.1.1.01.0001'), conta('1.1.1.01.0002'), conta('2.1.1.01.0001')],
  dePara: [],
  regras: [regra('1.1.1.01.0001')],
  parcial: false,
  ...extra,
});

describe('conferência do reprocessamento', () => {
  it('duas leituras iguais dão os mesmos lançamentos, com os totais das duas execuções', () => {
    const r = conferirExecucoes(leitura(), leitura());
    expect(r).toMatchObject({ fatos: 2, identico: true, iguais: 2, diferentes: 0, parcial: false });
    expect(r.lancamentos).toEqual({ primeira: 2, segunda: 2 });
    expect(r.totais.primeira).toEqual({ debitos: 12550, creditos: 12550 });
    expect(r.totais.segunda).toEqual(r.totais.primeira);
  });

  it('a regra diferente na segunda leitura aparece como diferença', () => {
    const r = conferirExecucoes(leitura(), leitura({ regras: [regra('1.1.1.01.0002')] }));
    expect(r).toMatchObject({ identico: false, iguais: 0, diferentes: 2 });
  });

  it('acima do teto nunca é idêntico; o fato substituído não conta', () => {
    expect(conferirExecucoes(leitura({ parcial: true }), leitura()).identico).toBe(false);
    const comSubstituido = leitura({
      fatos: [fato(1, 10000), { ...fato(3, 500), situacao: 'substituido' } as FatoContabil],
    });
    expect(conferirExecucoes(comSubstituido, comSubstituido).fatos).toBe(1);
  });

  it('desde a F2, compara a derivação com os lançamentos gravados dos fatos contabilizados (regra republicada aparece)', () => {
    const contabilizado = (id: number, valor: number) =>
      ({ ...fato(id, valor), idFato: 100 + id, situacao: 'contabilizado' }) as FatoContabil;
    const partidas = (debito: string, valor: number, id: number) => [
      {
        lado: 'D' as const,
        conta: debito,
        valorCentavos: valor,
        historico: `título a pagar ${id}`,
        centroCusto: null,
      },
      {
        lado: 'C' as const,
        conta: '2.1.1.01.0001',
        valorCentavos: valor,
        historico: `título a pagar ${id}`,
        centroCusto: null,
      },
    ];
    const fatos = [contabilizado(1, 10000), contabilizado(2, 2550), fato(3, 700)];
    // O fato 1 foi lançado com a regra antiga (outra conta de débito); o 2 bate; o pendente (3) não entra.
    const gravados = new Map([
      [101, { partidas: partidas('1.1.1.01.0002', 10000, 1) }],
      [102, { partidas: partidas('1.1.1.01.0001', 2550, 2) }],
    ]);
    const r = conferirExecucoes(leitura({ fatos, gravados }), leitura({ fatos, gravados }));
    expect(r.gravado).toEqual({ comparados: 2, iguais: 1, diferentes: 1, semLancamento: 0 });
    expect(r.identico).toBe(false);
    expect(relatorio('pc', 1, '2026-10', r)).toContain(
      'frente ao gravado: 2 fatos contabilizados; iguais 1, diferentes 1',
    );
    const bate = new Map([...gravados, [101, { partidas: partidas('1.1.1.01.0001', 10000, 1) }]]);
    expect(conferirExecucoes(leitura({ fatos, gravados: bate }), leitura({ fatos })).identico).toBe(true);
    const falta = new Map([[101, { partidas: partidas('1.1.1.01.0001', 10000, 1) }]]);
    expect(conferirExecucoes(leitura({ fatos, gravados: falta }), leitura({ fatos })).gravado).toMatchObject({
      semLancamento: 1,
    });
    expect(conferirExecucoes(leitura(), leitura()).gravado).toBeNull();
  });

  it('opções e relatório só com contagens', () => {
    expect(opcoesDe(['--periodo=2026-10', '--hospital=pc', 'x'])).toEqual({
      periodo: '2026-10',
      hospital: 'pc',
    });
    const texto = relatorio('pc', 1, '2026-10', conferirExecucoes(leitura(), leitura()));
    expect(texto).toContain('2 fatos');
    expect(texto).toContain('IDÊNTICO');
    expect(texto).toContain('D 12550 = C 12550');
  });
});
