// Regras puras da produção do repasse a partir da conta (producao-conta.ts): débito até o bruto na apuração, soma das
// glosas aceitas do item e o crédito da glosa revertida sem o lançamento da apuração.
import { describe, expect, it } from 'vitest';
import {
  debitosNaApuracao,
  glosadoAceitoDoItem,
  type PortaProducaoConta,
  sincronizarProducaoDaConta,
} from './producao-conta.js';

describe('debitosNaApuracao', () => {
  it('desconta até o bruto do profissional, do mais velho ao mais novo, e leva o resto como saldo', () => {
    expect(
      debitosNaApuracao(new Map([[7, 30000]]), [
        { id: 2, profissional: 7, valorCentavos: 20000 },
        { id: 1, profissional: 7, valorCentavos: 20000 },
        { id: 3, profissional: 8, valorCentavos: 5000 },
      ]),
    ).toEqual([
      { id: 1, profissional: 7, descontadoCentavos: 20000, saldoCentavos: 0 },
      { id: 2, profissional: 7, descontadoCentavos: 10000, saldoCentavos: 10000 },
      // Sem produção no período: nada se desconta, tudo vai adiante (nunca se perde).
      { id: 3, profissional: 8, descontadoCentavos: 0, saldoCentavos: 5000 },
    ]);
  });
});

describe('glosadoAceitoDoItem', () => {
  it('soma as glosas aceitas e as parcialmente aceitas; recorrida e pendente não contam', () => {
    expect(
      glosadoAceitoDoItem([
        { decisao: 'aceitar', valorAceito: 600 },
        { decisao: 'recorrer', valorAceito: 0 },
        { decisao: 'aceitar_parcial', valorAceito: 150.5 },
        { decisao: 'pendente', valorAceito: 0 },
      ]),
    ).toBe(750.5);
    expect(glosadoAceitoDoItem([])).toBe(0);
  });
});

describe('glosa revertida depois do desconto sem o lançamento da apuração', () => {
  it('não conta crédito, não reabre a produção e conta a pendência', async () => {
    const alteradas: unknown[] = [];
    const porta = {
      travarConta: async () => ({
        id: 1,
        fontePagadora: 1,
        natureza: 'ambulatorial',
        competencia: '2026-10',
        situacao: 'aberta',
        especialidade: null,
        local: null,
        unidade: null,
        centroCusto: null,
        mesAtual: '2026-11',
      }),
      parametros: async () => new Map([['repasse.momentoProducao', 'lancamento']]),
      itens: async () => [
        {
          item: {
            id: 10,
            situacao: 'lancado',
            excluido: false,
            quantidade: 1,
            valorTotal: 1000,
            valorHonorario: 0,
            valorGlosado: 0,
            pertencePacote: false,
            executante: 5,
            funcao: null,
            participantes: [],
          },
          data: '2026-10-10',
          hora: '10:00',
          procedimento: 1,
          grupoAto: null,
          centroCusto: null,
          tipoLancamento: null,
        },
      ],
      funcoes: async () => [{ id: 1, tipo: 'clinico', ativo: true, ordem: 0 }],
      producoes: async () => [
        {
          id: 99,
          versao: 1,
          item: 10,
          profissional: 5,
          prestador: null,
          funcao: 1,
          situacao: 'estornado',
          valorBase: 1000,
          valorRepasse: 400,
          apurado: 400,
          estornado: 400,
        },
      ],
      competenciasFechadas: async () => new Set<string>(),
      regras: async () => [],
      integrais: async () => ({ brutas: [], grupoDoProcedimento: new Map() }),
      cooperativa: async () => null,
      incluirProducao: async () => 1,
      alterarProducao: async (...a: unknown[]) => {
        alteradas.push(a);
      },
      debitosAbertos: async () => [],
      cancelarDebito: async () => undefined,
      incluirDebito: async () => undefined,
      incluirCredito: async () => false,
      glosasDoItem: async () => [],
      gravarGlosadoDoItem: async () => undefined,
    } as unknown as PortaProducaoConta;
    const r = await sincronizarProducaoDaConta(porta, { conta: 1, evento: 'mudanca-item' });
    expect(r.creditos).toBe(0);
    expect(r.pendencias['credito-sem-lancamento']).toBe(1);
    expect(alteradas).toEqual([]);
  });
});
