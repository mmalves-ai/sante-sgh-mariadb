// 08-SGO L102 (C2-120): regras da remuneração e do pagamento do prestador da rede.
import { describe, expect, it } from 'vitest';
import {
  acrescimoAplica,
  calcularPagamento,
  diaAnterior,
  diasParaPagamento,
  escolherRegra,
  type EventoValoracao,
  problemasDaRegraValoracao,
  problemasDaTabelaRemuneracao,
  problemasDoAdiantamento,
  problemasDoCalculoPagamento,
  problemasDoCalendario,
  problemasDoItemTabela,
  problemasDoLotePagamento,
  problemasDoPacote,
  problemasDoReajusteRede,
  proximoReajuste,
  reajustarUnidade,
  reajustarValor,
  resolverTributoDoLote,
  type RegraParaEscolha,
  valorar,
  valorDoItem,
} from './remuneracao-rede.js';

const codigos = (ps: { codigo: string }[]) => ps.map((x) => x.codigo);
const tabela = {
  codigo: 'T1',
  nome: 'Tabela',
  finalidade: 'pagamento_rede' as const,
  tipoValor: 'indice' as const,
  valorCh: 0.5,
  valorUco: 12,
  valorFilme: 21.7,
  prestador: null,
  inicio: '2026-01-01',
  fim: null,
};
const regra = (x: Partial<RegraParaEscolha>): RegraParaEscolha => ({
  id: 1,
  prioridade: 100,
  prestador: null,
  tipoPrestador: null,
  grupo: null,
  item: null,
  tabela: 9,
  fator: 1,
  acrescimo: null,
  diaSemana: null,
  horaInicio: null,
  horaFim: null,
  inicio: '2026-01-01',
  fim: null,
  ...x,
});
const evento: EventoValoracao = {
  prestador: 5,
  tipoPrestador: 2,
  grupos: [7],
  item: 30,
  data: '2026-03-10',
  hora: '23:30',
  urgencia: true,
};

describe('tabela negociada e itens', () => {
  it('tabela em unidades exige o valor do CH; vigência em ordem', () => {
    expect(problemasDaTabelaRemuneracao(tabela)).toEqual([]);
    expect(codigos(problemasDaTabelaRemuneracao({ ...tabela, valorCh: null, fim: '2025-01-01' }))).toEqual([
      'unidade-sem-valor',
      'vigencia-invertida',
    ]);
  });
  it('item precisa de alvo, unidades na tabela de índice e vigência dentro da tabela', () => {
    const item = {
      procedimento: 1,
      grupo: null,
      valor: null,
      quantidadeCh: 100,
      quantidadeUco: 2,
      quantidadeFilme: null,
      inicio: '2026-02-01',
      fim: null,
    };
    expect(problemasDoItemTabela(item, tabela)).toEqual([]);
    expect(
      codigos(
        problemasDoItemTabela(
          { ...item, procedimento: null, quantidadeCh: null, quantidadeUco: null, inicio: '2025-12-01' },
          tabela,
        ),
      ),
    ).toEqual(['item-sem-alvo', 'item-sem-unidades', 'fora-da-tabela']);
    expect(
      codigos(problemasDoItemTabela({ ...item, valor: null }, { ...tabela, tipoValor: 'valor_fixo' })),
    ).toEqual(['item-sem-valor']);
  });
  it('valor do item: CH × valor do CH + UCO × valor da UCO + filme', () => {
    expect(
      valorDoItem({ valor: null, quantidadeCh: 100, quantidadeUco: 2, quantidadeFilme: 0.5 }, tabela),
    ).toBe(84.85);
    expect(
      valorDoItem(
        { valor: 80, quantidadeCh: 100, quantidadeUco: null, quantidadeFilme: null },
        { ...tabela, tipoValor: 'valor_fixo' },
      ),
    ).toBe(80);
  });
});

describe('regra de valoração', () => {
  it('fator positivo, horário completo e acréscimo para a janela especial', () => {
    const base = {
      codigo: 'R',
      descricao: 'Regra',
      prioridade: 1,
      prestador: null,
      tipoPrestador: null,
      grupo: null,
      item: null,
      tabela: 1,
      fator: 1,
      acrescimo: null,
      diaSemana: null,
      horaInicio: null,
      horaFim: null,
      inicio: '2026-01-01',
      fim: null,
    };
    expect(problemasDaRegraValoracao(base)).toEqual([]);
    expect(
      codigos(problemasDaRegraValoracao({ ...base, fator: 0, horaInicio: '19:00', diaSemana: 9 })),
    ).toEqual(['fator-invalido', 'dia-invalido', 'horario-incompleto', 'acrescimo-ausente']);
  });
  it('escolhe a de menor prioridade e, no empate, a mais específica; fora da vigência não vale', () => {
    const geral = regra({ id: 1 });
    const doPrestador = regra({ id: 2, prestador: 5 });
    const doGrupo = regra({ id: 3, prestador: 5, grupo: 7 });
    const outroPrest = regra({ id: 4, prestador: 6, prioridade: 1 });
    const vencida = regra({ id: 5, prioridade: 1, fim: '2026-02-01' });
    expect(escolherRegra([geral, doPrestador, doGrupo, outroPrest, vencida], evento)?.id).toBe(3);
    expect(escolherRegra([geral, regra({ id: 6, prioridade: 50 })], evento)?.id).toBe(6);
    expect(escolherRegra([outroPrest], evento)).toBeNull();
  });
  it('acréscimo de urgência e janela noturna que vira o dia', () => {
    expect(acrescimoAplica(regra({ acrescimo: 30 }), evento)).toBe(true);
    expect(acrescimoAplica(regra({ acrescimo: 30 }), { ...evento, urgencia: false })).toBe(false);
    const noite = regra({ acrescimo: 30, horaInicio: '19:00', horaFim: '07:00' });
    expect(acrescimoAplica(noite, evento)).toBe(true);
    expect(acrescimoAplica(noite, { ...evento, hora: '12:00' })).toBe(false);
    expect(acrescimoAplica(regra({ acrescimo: 30, diaSemana: 1 }), evento)).toBe(false);
    expect(acrescimoAplica(regra({ acrescimo: 30, diaSemana: 3 }), evento)).toBe(true);
  });
  it('valor = unitário × fator × (1 + acréscimo) × quantidade', () => {
    expect(valorar(regra({ fator: 1.2, acrescimo: 30 }), evento, 100, 2)).toMatchObject({
      acrescimoPercentual: 30,
      valor: 312,
    });
    expect(valorar(regra({ fator: 1.2, acrescimo: 30 }), { ...evento, urgencia: false }, 100, 2).valor).toBe(
      240,
    );
  });
});

describe('pacote', () => {
  const pacote = {
    codigo: 'P',
    descricao: 'Pacote',
    prestador: 5,
    principal: 30,
    tipo: 'cirurgico' as const,
    regime: 'internacao' as const,
    diarias: 2,
    valorGlobal: 5000,
    inicio: '2026-01-01',
    fim: null,
    inclusoes: null,
    itens: [
      { item: 30, inclusao: 'incluido' as const, quantidade: 1 },
      { item: 31, inclusao: 'excluido' as const, quantidade: null },
    ],
  };
  it('valor positivo, principal dentro, itens sem repetição, ambulatorial sem diária', () => {
    expect(problemasDoPacote(pacote)).toEqual([]);
    expect(
      codigos(
        problemasDoPacote({
          ...pacote,
          valorGlobal: 0,
          regime: 'ambulatorial',
          itens: [
            { item: 30, inclusao: 'excluido', quantidade: 0 },
            { item: 30, inclusao: 'incluido', quantidade: 1 },
          ],
        }),
      ),
    ).toEqual([
      'valor-invalido',
      'diarias-no-ambulatorial',
      'quantidade-invalida',
      'principal-excluido',
      'item-repetido',
    ]);
  });
});

describe('reajuste do contrato', () => {
  it('percentual válido, índice quando não é acordo, início depois da data-base', () => {
    const r = {
      forma: 'indice_contratual' as const,
      indice: 3,
      percentual: 4.5,
      dataBase: '2026-03-01',
      inicio: '2026-03-01',
      descricao: null,
    };
    expect(problemasDoReajusteRede(r)).toEqual([]);
    expect(
      codigos(problemasDoReajusteRede({ ...r, indice: null, percentual: 0, inicio: '2026-02-01' })),
    ).toEqual(['percentual-invalido', 'indice-ausente', 'inicio-antes-da-base']);
    expect(codigos(problemasDoReajusteRede({ ...r, forma: 'acordo', indice: null }))).toEqual([
      'acordo-sem-registro',
    ]);
  });
  it('aplica o percentual (dinheiro em 2 casas, unidade em 4) e calcula as datas', () => {
    expect(reajustarValor(80, 4.5)).toBe(83.6);
    expect(reajustarUnidade(0.5, 4.5)).toBe(0.5225);
    expect(proximoReajuste('2026-03-01')).toBe('2027-03-01');
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
  });
});

describe('calendário de pagamento', () => {
  const c = {
    competencia: '2026-04-01',
    prestador: null,
    atendimentoInicio: '2026-02-01',
    atendimentoFim: '2026-02-28',
    entregaInicio: '2026-03-01',
    entregaFim: '2026-03-10',
    corte: '2026-03-15',
    pagamento: '2026-04-10',
  };
  it('competência no dia 1, períodos em ordem, corte depois da entrega, pagamento depois do corte', () => {
    expect(problemasDoCalendario(c)).toEqual([]);
    expect(
      codigos(
        problemasDoCalendario({
          ...c,
          competencia: '2026-04-05',
          corte: '2026-03-05',
          pagamento: '2026-03-01',
        }),
      ),
    ).toEqual(['competencia-invalida', 'corte-antes-da-entrega', 'pagamento-antes-do-corte']);
    expect(diasParaPagamento(c.atendimentoFim, c.pagamento)).toBe(41);
  });
});

describe('adiantamento e lote de pagamento', () => {
  it('adiantamento com valor, parcelas e início da compensação', () => {
    const a = {
      descricao: 'Adiantamento',
      data: '2026-03-10',
      valor: 1000,
      parcelas: 2,
      inicioCompensacao: '2026-04-01',
    };
    expect(problemasDoAdiantamento(a)).toEqual([]);
    expect(
      codigos(problemasDoAdiantamento({ ...a, valor: 0, parcelas: 0, inicioCompensacao: '2026-02-01' })),
    ).toEqual(['valor-invalido', 'parcelas-invalidas', 'compensacao-antes']);
  });
  it('tributos sobre a base, mínimo de retenção e compensação da parcela do adiantamento', () => {
    const r = calcularPagamento(
      10_000,
      [
        { tributo: 1, aliquota: 1.5, deducao: 0, minimo: 10 },
        { tributo: 2, aliquota: 0.05, deducao: 0, minimo: 10 },
        { tributo: 3, aliquota: 11, deducao: 2000, minimo: null },
      ],
      [
        { id: 8, valor: 1000, compensado: 0, parcelas: 2, inicioCompensacao: '2026-04-01' },
        { id: 9, valor: 300, compensado: 200, parcelas: 1, inicioCompensacao: null },
        { id: 10, valor: 500, compensado: 0, parcelas: 1, inicioCompensacao: '2026-06-01' },
      ],
      '2026-04-01',
    );
    expect(r.tributos.map((t) => [t.imposto, t.retido])).toEqual([
      [150, 150],
      [5, 0],
      [880, 880],
    ]);
    expect(r.valorTributos).toBe(1030);
    expect(r.liquidoLote).toBe(8970);
    expect(r.compensacoes).toEqual([
      { id: 8, valor: 500, quitado: false },
      { id: 9, valor: 100, quitado: true },
    ]);
    expect(r.liquidoTitulo).toBe(8370);
  });
  it('a compensação nunca passa do líquido', () => {
    const r = calcularPagamento(
      100,
      [],
      [{ id: 1, valor: 1000, compensado: 0, parcelas: 1, inicioCompensacao: null }],
      '2026-04-01',
    );
    expect(r.valorCompensado).toBe(100);
    expect(r.liquidoTitulo).toBe(0);
  });
  it('lote precisa de contas, competência no dia 1 e tributo sem repetição', () => {
    expect(
      codigos(
        problemasDoLotePagamento({
          competencia: '2026-04-02',
          vencimento: '2026-04-10',
          contas: [],
          tributos: [
            { tributo: 1, aliquota: 1, deducao: 0 },
            { tributo: 1, aliquota: 120, deducao: 0 },
          ],
        }),
      ),
    ).toEqual(['competencia-invalida', 'lote-vazio', 'tributo-repetido', 'tributo-invalido']);
  });
});

describe('tributos do lote pelo cadastro', () => {
  const irrf = { tributo: 7, codigo: 'IRRF', aliquota: 1.5, minimo: 10, enquadramento: null };
  it('sem alíquota informada vale a do cadastro, com o mínimo de retenção do cadastro', () => {
    const r = resolverTributoDoLote(irrf, { tributo: 7, aliquota: null, deducao: 0 });
    expect(r.problemas).toEqual([]);
    expect(r.tributo).toMatchObject({ aliquota: 1.5, minimo: 10, excecao: false });
    // 1,5% de R$ 600,00 = R$ 9,00, abaixo do mínimo de R$ 10,00: não retém; de R$ 1.000,00 = R$ 15,00 retém.
    expect(calcularPagamento(600, [r.tributo!], [], '2026-04-01').tributos[0]).toMatchObject({
      imposto: 9,
      retido: 0,
    });
    expect(calcularPagamento(1000, [r.tributo!], [], '2026-04-01').valorTributos).toBe(15);
  });
  it('alíquota diferente do cadastro é exceção e exige o motivo, que fica no detalhamento', () => {
    expect(codigos(resolverTributoDoLote(irrf, { tributo: 7, aliquota: 3, deducao: 0 }).problemas)).toEqual([
      'excecao-sem-motivo',
    ]);
    const r = resolverTributoDoLote(irrf, {
      tributo: 7,
      aliquota: 3,
      deducao: 0,
      motivo: 'Decisão do contrato',
    });
    expect(r.tributo).toMatchObject({ aliquota: 3, minimo: 10, excecao: true });
    expect(r.tributo!.detalhamento).toContain('Exceção');
  });
  it('sem alíquota vigente no cadastro, pede a alíquota e o motivo', () => {
    expect(
      codigos(
        resolverTributoDoLote({ ...irrf, aliquota: null }, { tributo: 7, aliquota: null, deducao: 0 })
          .problemas,
      ),
    ).toEqual(['aliquota-sem-cadastro']);
  });
  it('o enquadramento do favorecido: não retém, ou alíquota própria de ISS', () => {
    const naoRetem = resolverTributoDoLote(
      { ...irrf, enquadramento: { regime: 'simples_nacional', retem: false, aliquotaIss: null } },
      { tributo: 7, aliquota: null, deducao: 0 },
    );
    expect(naoRetem.tributo).toMatchObject({ aliquota: 0, minimo: null, excecao: false });
    const iss = resolverTributoDoLote(
      {
        tributo: 9,
        codigo: 'ISS',
        aliquota: 5,
        minimo: null,
        enquadramento: { regime: 'lucro_presumido', retem: true, aliquotaIss: 2 },
      },
      { tributo: 9, aliquota: null, deducao: 0 },
    );
    expect(iss.tributo).toMatchObject({ aliquota: 2, excecao: false });
  });
  it('as retenções não passam do bruto', () => {
    const t = (id: number) => ({ tributo: id, aliquota: 60, deducao: 0, minimo: null });
    expect(
      codigos(problemasDoCalculoPagamento(calcularPagamento(1000, [t(1), t(2)], [], '2026-04-01'))),
    ).toEqual(['retencao-acima-do-bruto']);
    expect(problemasDoCalculoPagamento(calcularPagamento(1000, [t(1)], [], '2026-04-01'))).toEqual([]);
  });
});
