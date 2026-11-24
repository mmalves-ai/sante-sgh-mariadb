// Sincronização da produção do repasse a partir da conta (producao-conta.ts), com porta em memória: geração no
// lançamento, conta sem item, estorno do item excluído, débito do já apurado, crédito da glosa revertida e a glosa do
// item; mais as regras puras do plano do crédito, do desconto do débito e das integrais do dia.
import { describe, expect, it } from 'vitest';
import {
  descontoDoDebito,
  integraisDoDia,
  padraoParametro,
  planoDoCredito,
  type PortaProducaoConta,
  type ProducaoExistente,
  sincronizarGlosaDoItem,
  sincronizarProducaoDaConta,
} from './producao-conta.js';

type Chamada = [string, ...unknown[]];

function porta(o: {
  item?: Partial<Record<string, unknown>>;
  existentes?: ProducaoExistente[];
  natureza?: string;
  situacaoConta?: string;
  semItens?: boolean;
  credito?: boolean;
  debitosAbertos?: { id: number; versao: number; valor: number }[];
  parametros?: [string, string][];
}): { p: PortaProducaoConta; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const reg =
    (nome: string, ret?: unknown) =>
    async (...a: unknown[]) => {
      chamadas.push([nome, ...a]);
      return ret;
    };
  const p: PortaProducaoConta = {
    travarConta: async () => ({
      id: 1,
      fontePagadora: 3,
      natureza: o.natureza ?? 'ambulatorial',
      competencia: '2026-10',
      situacao: o.situacaoConta ?? 'aberta',
      especialidade: 4,
      local: 5,
      unidade: 6,
      centroCusto: 70,
      mesAtual: '2026-11',
    }),
    parametros: async () =>
      new Map(
        o.parametros ?? [
          ['repasse.momentoProducao', 'lancamento'],
          ['repasse.feriados', ' 2026-10-12, '],
        ],
      ),
    itens: async () =>
      o.semItens
        ? []
        : [
            {
              item: {
                id: 10,
                situacao: 'lancado',
                excluido: false,
                quantidade: 2,
                valorTotal: 1000,
                valorHonorario: 0,
                valorGlosado: 0,
                pertencePacote: false,
                executante: 5,
                funcao: null,
                participantes: [],
                ...o.item,
              } as never,
              data: '2026-10-10',
              hora: '10:00:00',
              procedimento: 1,
              grupoAto: null,
              centroCusto: null,
              tipoLancamento: 9,
            },
          ],
    funcoes: async () => [{ id: 1, tipo: 'clinico', ativo: true, ordem: 0 }] as never,
    producoes: async () => o.existentes ?? [],
    competenciasFechadas: async () => new Set<string>(),
    regras: reg('regras', []) as never,
    integrais: async () => ({ brutas: [], grupoDoProcedimento: new Map() }),
    cooperativa: reg('cooperativa', 8) as never,
    incluirProducao: reg('incluirProducao', 77) as never,
    alterarProducao: reg('alterarProducao') as never,
    debitosAbertos: async () => o.debitosAbertos ?? [],
    cancelarDebito: reg('cancelarDebito') as never,
    incluirDebito: reg('incluirDebito') as never,
    incluirCredito: reg('incluirCredito', o.credito ?? true) as never,
    glosasDoItem: async () => [{ decisao: 'aceitar', valorAceito: 200 }],
    gravarGlosadoDoItem: reg('gravarGlosadoDoItem') as never,
  };
  return { p, chamadas };
}

const existente = (x: Partial<ProducaoExistente>): ProducaoExistente => ({
  id: 99,
  versao: 3,
  item: 10,
  profissional: 5,
  prestador: null,
  funcao: 1,
  situacao: 'pendente',
  valorBase: 1000,
  valorRepasse: null,
  apurado: null,
  estornado: 0,
  ...x,
});

const ZERO = { geradas: 0, estornadas: 0, reduzidas: 0, debitos: 0, creditos: 0, pendencias: {} };

const de = (c: Chamada[], nome: string) => c.filter((x) => x[0] === nome).map((x) => x.slice(1));

describe('sincronizarProducaoDaConta com a porta em memória', () => {
  it('conta sem item: nada a fazer, resumo zerado', async () => {
    const { p, chamadas } = porta({ semItens: true });
    expect(await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' })).toEqual({
      geradas: 0,
      estornadas: 0,
      reduzidas: 0,
      debitos: 0,
      creditos: 0,
      pendencias: {},
    });
    expect(chamadas).toEqual([]);
  });

  it('gera a produção do executante no lançamento, com o centro de custo da conta e a cooperativa', async () => {
    const { p, chamadas } = porta({ natureza: 'internacao' });
    const r = await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' });
    expect(r).toEqual({ ...ZERO, geradas: 1 });
    // O motor do dia busca as regras da data e da fonte pagadora; a cooperativa é a do executante.
    expect(de(chamadas, 'regras')).toEqual([['2026-10-10', 3]]);
    expect(de(chamadas, 'cooperativa')).toEqual([[5]]);
    expect(de(chamadas, 'incluirProducao')).toEqual([
      [
        {
          item: 10,
          conta: 1,
          profissional: 5,
          prestador: null,
          funcao: 1,
          tipoLancamento: 9,
          quantidade: 2,
          valorBase: 1000,
          // Sem regra no dia: pendência de cálculo, sem percentual nem valor.
          percentual: null,
          valorRepasse: null,
          pertencePacote: false,
        },
      ],
    ]);
  });

  it('item excluído com produção pendente: estorna', async () => {
    const { p, chamadas } = porta({ item: { excluido: true }, existentes: [existente({})] });
    const r = await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' });
    expect(r).toEqual({ ...ZERO, estornadas: 1 });
    expect(chamadas).toEqual([['alterarProducao', 99, 3, { situacao: 'estornado' }]]);
  });

  it('item excluído com produção já apurada: débito', async () => {
    const { p, chamadas } = porta({
      item: { excluido: true },
      existentes: [existente({ situacao: 'apurado', apurado: 400, valorRepasse: 400 })],
    });
    const r = await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' });
    expect(r).toEqual({ ...ZERO, debitos: 1 });
    // O débito vai à competência aberta (a da conta já passou) e a produção é encerrada.
    expect(chamadas).toEqual([
      [
        'incluirDebito',
        { producao: 99, conta: 1, item: 10, valor: 400, competencia: '2026-11', motivo: 'ajuste' },
      ],
      ['alterarProducao', 99, 3, { situacao: 'estornado' }],
    ]);
  });

  it('glosa revertida com débito aberto: cancela o débito e lança o crédito do resto', async () => {
    const { p, chamadas } = porta({
      existentes: [existente({ situacao: 'estornado', apurado: 400, valorRepasse: 400, estornado: 400 })],
      debitosAbertos: [{ id: 50, versao: 1, valor: 100 }],
    });
    const r = await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' });
    expect(r).toEqual({ ...ZERO, creditos: 1 });
    expect(chamadas).toEqual([
      ['cancelarDebito', 50, 1],
      ['incluirCredito', { producao: 99, conta: 1, item: 10, valor: 300, competencia: '2026-11' }],
      ['alterarProducao', 99, 3, { situacao: 'apurado' }],
    ]);
  });

  it('item com glosa parcial e produção pendente: reduz a base', async () => {
    const { p, chamadas } = porta({ item: { valorGlosado: 400 }, existentes: [existente({})] });
    const r = await sincronizarProducaoDaConta(p, { conta: 1, evento: 'mudanca-item' });
    expect(r).toEqual({ ...ZERO, reduzidas: 1 });
    expect(chamadas).toEqual([['alterarProducao', 99, 3, { valorBase: 600, limparPrevia: true }]]);
  });

  it('sincronizarGlosaDoItem grava o glosado aceito e sincroniza só o item', async () => {
    const { p, chamadas } = porta({ existentes: [existente({})] });
    const r = await sincronizarGlosaDoItem(p, { conta: 1, item: 10 });
    expect(r).toEqual({ ...ZERO, glosado: 200 });
    expect(chamadas).toEqual([['gravarGlosadoDoItem', 10, 200]]);
  });
});

describe('regras puras do crédito, do débito e das integrais', () => {
  it('planoDoCredito cancela débitos abertos até cobrir o excesso; o que passa vira débito novo, o que falta é crédito', () => {
    const a = { id: 1, versao: 1, valor: 100 };
    const b = { id: 2, versao: 1, valor: 300 };
    expect(planoDoCredito(25000, [a, b])).toEqual({
      cancelar: [a, b],
      debitoNovoCentavos: 15000,
      creditoCentavos: 0,
    });
    expect(planoDoCredito(50000, [a])).toEqual({
      cancelar: [a],
      debitoNovoCentavos: 0,
      creditoCentavos: 40000,
    });
    expect(planoDoCredito(5000, [])).toEqual({ cancelar: [], debitoNovoCentavos: 0, creditoCentavos: 5000 });
  });

  it('descontoDoDebito desconta até o bruto e nunca com valor negativo', () => {
    expect(descontoDoDebito(30000, 50000)).toEqual({ estornoCentavos: 30000, saldoCentavos: 20000 });
    expect(descontoDoDebito(-10, 500)).toEqual({ estornoCentavos: 0, saldoCentavos: 500 });
    expect(descontoDoDebito(800, -5)).toEqual({ estornoCentavos: 0, saldoCentavos: 0 });
  });

  it('integraisDoDia sem integral: nenhuma fonte particular; padrão de parâmetro desconhecido é vazio', () => {
    const g = new Map([[1, 2]]);
    const r = integraisDoDia({ brutas: [], grupoDoProcedimento: g });
    expect(r.integrais).toEqual([]);
    expect(r.grupoDoProcedimento).toBe(g);
    expect([...r.fontesParticulares]).toEqual([]);
    expect(padraoParametro('repasse.chaveQueNaoExiste')).toBe('');
  });
});
