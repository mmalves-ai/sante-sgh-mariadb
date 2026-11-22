// M56.6 (F5): regras puras das contas médicas recebidas pela operadora (protocolo, prazo, conferência do lote, críticas e
// glosa automática, revisão do auditor, valores, ações, recurso e pagamento). Dados SINTÉTICOS (carteirinha com o
// verificador calculado sobre uma sequência inventada).
import type { GuiaTissRecebida, ItemTissRecebido, LoteTissRecebido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { numeroCarteirinha } from './carteirinha.js';
import {
  exigeParecerNoRecurso,
  problemasDoParecerDoRecurso,
  rateioDoAcatado,
  acoesDaConta,
  type AutorizacaoDaSenha,
  competenciaDoRecebimento,
  type ContextoGuia,
  contaVencida,
  criticasDaGuia,
  documentoDaOrigem,
  exigeSenha,
  glosaFinalDosItens,
  glosasAutomaticas,
  prazoPagamento,
  prestadorNaRedeNaData,
  problemasDaDecisaoDoRecurso,
  problemasDaGlosa,
  problemasDoLote,
  problemasDoPagamento,
  problemasDoRecurso,
  protocoloConta,
  protocoloContaValido,
  reaisDeCentavos,
  situacaoDoRecurso,
  situacaoPelosValores,
  valorEsperado,
  valoresDaConta,
} from './conta.js';
import type { DadosElegibilidade } from './elegibilidade.js';

const CARTEIRA = numeroCarteirinha('999990', 1);
const HOJE = '2026-10-26';

const item = (p: Partial<ItemTissRecebido> = {}): ItemTissRecebido => ({
  sequencial: 1,
  grupo: 'procedimento',
  codigoDespesa: null,
  tabela: '22',
  codigo: '40301630',
  descricao: 'EXAME SINTÉTICO',
  data: '2026-10-20',
  quantidade: 2,
  fator: 1,
  valorUnitario: 12.35,
  valorTotal: 24.7,
  ...p,
});

const guia = (p: Partial<GuiaTissRecebida> = {}): GuiaTissRecebida => ({
  tipo: 'sp-sadt',
  registroAns: '999990',
  numeroGuiaPrestador: 'G-1',
  numeroGuiaOperadora: null,
  senha: '9999900000000011',
  carteirinha: CARTEIRA,
  atendimentoRN: false,
  carater: '1',
  inicio: '2026-10-20',
  fim: '2026-10-20',
  itens: [item()],
  ...p,
});

const dados = (p: Partial<DadosElegibilidade> = {}): DadosElegibilidade => ({
  beneficiario: { situacao: 'ativo', inclusao: '2026-01-01' },
  contrato: { situacao: 'ativo', inicio: '2026-01-01', fim: null },
  produto: {
    situacao: 'ativo',
    natureza: 'plano',
    carencias: { urgencia: 1, partos: 300, demais: 30, cpt: 0 },
  },
  ...p,
});

const autorizacao = (p: Partial<AutorizacaoDaSenha> = {}): AutorizacaoDaSenha => ({
  id: 7,
  protocolo: '99999020261020000001',
  situacao: 'autorizada',
  beneficiario: 10,
  prestadores: [3],
  validade: '2026-11-19',
  itens: [{ tabela: 22, codigo: '40301630', autorizada: 2 }],
  ...p,
});

const ctx = (p: Partial<ContextoGuia> = {}): ContextoGuia => ({
  hoje: HOJE,
  prestador: { id: 3, contratoInicio: '2026-01-01', situacao: 'credenciado', situacaoEm: '2026-01-01' },
  beneficiario: { id: 10, dados: dados() },
  autorizacao: autorizacao(),
  jaApresentada: false,
  ...p,
});

describe('protocolo, competência e prazo', () => {
  it('o protocolo tem 12 dígitos: AAAAMM e a sequência', () => {
    expect(protocoloConta('2026-10-26', 42)).toBe('202610000042');
    expect(protocoloConta('2026-10-26', 1_000_007)).toBe('202610000007');
    expect(protocoloContaValido('202610000042')).toBe(true);
    expect(protocoloContaValido('20261000004')).toBe(false);
    expect(() => protocoloConta('26/10', 1)).toThrow();
    expect(() => protocoloConta('2026-10-26', 0)).toThrow();
  });
  it('a competência é o mês do recebimento e o prazo conta 30 dias corridos', () => {
    expect(competenciaDoRecebimento(HOJE)).toBe('2026-10');
    expect(prazoPagamento('2026-10-26T10:00:00')).toBe('2026-11-25');
    expect(prazoPagamento('2026-10-26', 10)).toBe('2026-11-05');
  });
  it('vencida: em análise ou liberada depois do prazo; paga e devolvida nunca', () => {
    expect(contaVencida('recebida', '2026-10-25', HOJE)).toBe(true);
    expect(contaVencida('analisada', '2026-10-25', HOJE)).toBe(true);
    expect(contaVencida('analisada', HOJE, HOJE)).toBe(false);
    expect(contaVencida('paga', '2026-10-01', HOJE)).toBe(false);
    expect(contaVencida('devolvida', '2026-10-01', HOJE)).toBe(false);
  });
  it('dinheiro em centavos', () => {
    expect(reaisDeCentavos(1234)).toBe(12.34);
  });
});

describe('o lote e o prestador', () => {
  const lote = (p: Partial<LoteTissRecebido> = {}): LoteTissRecebido => ({
    tipoTransacao: 'ENVIO_LOTE_GUIAS',
    sequencialTransacao: '1',
    dataTransacao: HOJE,
    padrao: '4.03.00',
    prestador: { tipo: 'codigo', valor: '11.222.333/0001-81' },
    registroAnsDestino: '999990',
    numeroLote: '1',
    tipoGuia: 'sp-sadt',
    guias: [guia()],
    ...p,
  });
  const operadora = { id: 1, registroAns: '999990', ativa: true };
  it('o documento da origem sem pontuação', () => {
    expect(documentoDaOrigem({ tipo: 'codigo', valor: '11.222.333/0001-81' })).toBe('11222333000181');
    expect(documentoDaOrigem({ tipo: 'cpf', valor: '529.982.247-25' })).toBe('52998224725');
  });
  it('lote em ordem: nenhum problema', () => {
    expect(problemasDoLote(lote(), { operadora, prestadorEncontrado: true, loteJaRecebido: false })).toEqual(
      [],
    );
  });
  it('cada recusa do lote', () => {
    const cod = (l: LoteTissRecebido, x: Partial<Parameters<typeof problemasDoLote>[1]> = {}) =>
      problemasDoLote(l, { operadora, prestadorEncontrado: true, loteJaRecebido: false, ...x }).map(
        (p) => p.codigo,
      );
    expect(cod(lote({ padrao: '4.01.00' }))).toEqual(['versao-recusada']);
    expect(cod(lote(), { operadora: null })).toEqual(['operadora-destino-desconhecida']);
    expect(cod(lote(), { operadora: { ...operadora, ativa: false } })).toEqual([
      'operadora-destino-desconhecida',
    ]);
    expect(cod(lote({ guias: [guia({ registroAns: '123456' })] }))).toEqual(['registro-da-guia-divergente']);
    expect(cod(lote(), { prestadorEncontrado: false })).toEqual(['prestador-desconhecido']);
    expect(cod(lote(), { loteJaRecebido: true })).toEqual(['lote-ja-recebido']);
    expect(cod(lote({ guias: [] }))).toEqual(['guias-demais']);
    expect(
      cod(lote({ guias: Array.from({ length: 101 }, (_, i) => guia({ numeroGuiaPrestador: `G${i}` })) })),
    ).toEqual(['guias-demais']);
    expect(cod(lote({ guias: [guia(), guia()] }))).toEqual(['guia-repetida-no-lote']);
  });
  it('o prestador na rede na data do atendimento', () => {
    const p = { contratoInicio: '2026-02-01', situacao: 'credenciado', situacaoEm: '2026-02-01' };
    expect(prestadorNaRedeNaData(p, '2026-01-31')).toBe('prestador-antes-do-contrato');
    expect(prestadorNaRedeNaData(p, '2026-02-01')).toBeNull();
    const saiu = { ...p, situacao: 'descredenciado', situacaoEm: '2026-09-01' };
    expect(prestadorNaRedeNaData(saiu, '2026-08-31')).toBeNull();
    expect(prestadorNaRedeNaData(saiu, '2026-09-01')).toBe('prestador-fora-da-rede-na-data');
  });
});

describe('críticas da guia', () => {
  it('guia em ordem: nenhuma crítica e nenhuma glosa', () => {
    expect(criticasDaGuia(guia(), ctx())).toEqual([]);
    expect(glosasAutomaticas(guia(), [], autorizacao())).toEqual([]);
  });
  it('quem exige a senha', () => {
    expect(exigeSenha({ tipo: 'resumo-internacao', carater: '2' })).toBe(true);
    expect(exigeSenha({ tipo: 'honorario', carater: null })).toBe(true);
    expect(exigeSenha({ tipo: 'sp-sadt', carater: '1' })).toBe(true);
    expect(exigeSenha({ tipo: 'sp-sadt', carater: '2' })).toBe(false);
    expect(exigeSenha({ tipo: 'consulta', carater: null })).toBe(false);
  });
  it('elegibilidade na data do atendimento', () => {
    expect(criticasDaGuia(guia({ carteirinha: '123' }), ctx({ beneficiario: null }))).toContain(
      'carteira-invalida',
    );
    expect(criticasDaGuia(guia(), ctx({ beneficiario: null }))[0]).toBe('beneficiario-inexistente');
    const c = (d: Partial<DadosElegibilidade>) =>
      criticasDaGuia(guia(), ctx({ beneficiario: { id: 10, dados: dados(d) } }));
    expect(c({ beneficiario: { situacao: 'excluido', inclusao: '2026-01-01' } })).toContain(
      'beneficiario-excluido',
    );
    expect(c({ beneficiario: { situacao: 'suspenso', inclusao: '2026-01-01' } })).toContain(
      'beneficiario-suspenso',
    );
    expect(c({ beneficiario: { situacao: 'ativo', inclusao: '2026-10-21' } })).toContain(
      'atendimento-antes-da-inclusao',
    );
    expect(c({ contrato: { situacao: 'encerrado', inicio: '2026-01-01', fim: null } })).toContain(
      'contrato-inativo',
    );
    expect(c({ contrato: { situacao: 'ativo', inicio: '2026-01-01', fim: '2026-06-30' } })).toContain(
      'contrato-fora-da-vigencia',
    );
    expect(
      c({
        produto: {
          situacao: 'cancelado',
          natureza: 'plano',
          carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 0 },
        },
      }),
    ).toContain('produto-cancelado');
    expect(
      c({
        produto: {
          situacao: 'ativo',
          natureza: 'cartaoDesconto',
          carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 0 },
        },
      }),
    ).toContain('cartao-desconto');
  });
  it('atendimento no futuro, prestador fora da rede e guia já apresentada', () => {
    expect(
      criticasDaGuia(guia({ inicio: '2026-10-27' }), ctx({ autorizacao: autorizacao({ validade: null }) })),
    ).toEqual(['atendimento-no-futuro']);
    expect(
      criticasDaGuia(
        guia(),
        ctx({
          prestador: {
            id: 3,
            contratoInicio: '2026-01-01',
            situacao: 'descredenciado',
            situacaoEm: '2026-10-01',
          },
        }),
      ),
    ).toEqual(['prestador-fora-da-rede-na-data']);
    expect(criticasDaGuia(guia(), ctx({ jaApresentada: true }))).toEqual(['guia-ja-apresentada']);
  });
  it('a senha da autorização', () => {
    expect(criticasDaGuia(guia({ senha: null }), ctx({ autorizacao: null }))).toEqual(['senha-ausente']);
    expect(criticasDaGuia(guia({ senha: null, carater: '2' }), ctx({ autorizacao: null }))).toEqual([]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: null }))).toEqual(['senha-inexistente']);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ situacao: 'em-analise' }) }))).toEqual([
      'senha-inexistente',
    ]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ beneficiario: 99 }) }))).toEqual([
      'senha-de-outro-beneficiario',
    ]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ situacao: 'cancelada' }) }))).toEqual([
      'autorizacao-cancelada',
    ]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ validade: '2026-10-19' }) }))).toEqual([
      'senha-vencida',
    ]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ prestadores: [4, 5] }) }))).toEqual([
      'autorizacao-de-outro-prestador',
    ]);
    expect(criticasDaGuia(guia(), ctx({ autorizacao: autorizacao({ situacao: 'parcial' }) }))).toEqual([]);
  });
  it('a carência só nos atendimentos sem senha (consulta e urgência)', () => {
    const recente = { id: 10, dados: dados({ beneficiario: { situacao: 'ativo', inclusao: '2026-10-10' } }) };
    expect(
      criticasDaGuia(guia({ tipo: 'consulta', senha: null, carater: null }), ctx({ beneficiario: recente })),
    ).toEqual(['em-carencia']);
    // Urgência: carência de 1 dia, já cumprida.
    expect(criticasDaGuia(guia({ senha: null, carater: '2' }), ctx({ beneficiario: recente }))).toEqual([]);
    // Com a senha, a carência já foi da autorização.
    expect(criticasDaGuia(guia(), ctx({ beneficiario: recente }))).toEqual([]);
  });
});

describe('glosa automática', () => {
  it('a crítica da guia glosa todos os itens inteiros com o motivo da primeira', () => {
    const g = guia({
      itens: [
        item(),
        item({ sequencial: 2, valorTotal: 0 }),
        item({ sequencial: 3, grupo: 'despesa', tabela: '19', valorTotal: 9 }),
      ],
    });
    const r = glosasAutomaticas(g, ['beneficiario-inexistente', 'senha-inexistente'], null);
    expect(r.map((x) => [x.indice, x.glosado, x.motivo, x.critica])).toEqual([
      [0, 24.7, 1001, 'beneficiario-inexistente'],
      [2, 9, 1001, 'beneficiario-inexistente'],
    ]);
    expect(r[0]!.justificativa).toMatch(/^Glosa automática no recebimento: Nenhum beneficiário/);
  });
  it('procedimento não autorizado glosa inteiro; a quantidade acima só o excesso', () => {
    const g = guia({
      itens: [
        item({ codigo: '40301630', quantidade: 2, valorTotal: 24.7 }),
        item({ sequencial: 2, codigo: '40301630', quantidade: 1, valorUnitario: 12.35, valorTotal: 12.35 }),
        item({ sequencial: 3, codigo: '10101012', quantidade: 1, valorUnitario: 100, valorTotal: 100 }),
        item({
          sequencial: 4,
          grupo: 'despesa',
          codigoDespesa: '03',
          tabela: '19',
          codigo: '70000001',
          quantidade: 3,
          valorUnitario: 4.5,
          valorTotal: 13.5,
        }),
      ],
    });
    const r = glosasAutomaticas(
      g,
      [],
      autorizacao({
        itens: [
          { tabela: 22, codigo: '40301630', autorizada: 2 },
          { tabela: 19, codigo: 'X', autorizada: 1 },
        ],
      }),
    );
    expect(r.map((x) => [x.indice, x.glosado, x.motivo, x.critica])).toEqual([
      [1, 12.35, 1408, 'quantidade-acima-da-autorizada'],
      [2, 100, 1402, 'procedimento-nao-autorizado'],
    ]);
  });
  it('a quantidade autorizada nula conta como zero; parte do excesso no mesmo item', () => {
    const g = guia({ itens: [item({ quantidade: 3, valorUnitario: 10, valorTotal: 30 })] });
    expect(
      glosasAutomaticas(
        g,
        [],
        autorizacao({ itens: [{ tabela: 22, codigo: '40301630', autorizada: null }] }),
      )[0],
    ).toMatchObject({
      glosado: 30,
      critica: 'quantidade-acima-da-autorizada',
    });
    expect(
      glosasAutomaticas(
        g,
        [],
        autorizacao({ itens: [{ tabela: 22, codigo: '40301630', autorizada: 2 }] }),
      )[0],
    ).toMatchObject({
      glosado: 10,
    });
  });
  it('o valor a maior glosa só a diferença; o fator de redução conta', () => {
    const g = guia({
      tipo: 'consulta',
      senha: null,
      itens: [
        item({ quantidade: 1, valorUnitario: 100, fator: 1, valorTotal: 120 }),
        item({ sequencial: 2, quantidade: 2, valorUnitario: 50, fator: 0.7, valorTotal: 70 }),
      ],
    });
    const r = glosasAutomaticas(g, [], null);
    expect(r.map((x) => [x.indice, x.glosado, x.motivo, x.critica])).toEqual([
      [0, 20, 1705, 'valor-a-maior'],
    ]);
    expect(valorEsperado({ quantidade: 2, valorUnitario: 50, fator: 0.7 })).toBe(7000);
  });
});

describe('revisão do auditor', () => {
  const itens = [
    { id: 1, apresentado: 24.7 },
    { id: 2, apresentado: 10 },
  ];
  const motivos = new Set([1402, 1705]);
  const cod = (p: Parameters<typeof problemasDaGlosa>[1]) =>
    problemasDaGlosa(itens, p, motivos).map((x) => x.codigo);
  it('glosar e desfazer em ordem', () => {
    expect(
      cod([
        { item: 1, valorGlosado: 10, motivo: 1402, justificativa: 'Sem pedido médico.' },
        { item: 2, valorGlosado: 0, motivo: null, justificativa: null },
      ]),
    ).toEqual([]);
  });
  it('cada recusa', () => {
    expect(cod([{ item: 9, valorGlosado: 1, motivo: 1402, justificativa: 'abcde' }])).toEqual([
      'item-inexistente',
    ]);
    expect(
      cod([
        { item: 1, valorGlosado: 1, motivo: 1402, justificativa: 'abcde' },
        { item: 1, valorGlosado: 1, motivo: 1402, justificativa: 'abcde' },
      ]),
    ).toEqual(['item-repetido']);
    expect(cod([{ item: 1, valorGlosado: 24.71, motivo: 1402, justificativa: 'abcde' }])).toEqual([
      'glosa-acima-do-apresentado',
    ]);
    expect(cod([{ item: 1, valorGlosado: 1, motivo: null, justificativa: 'abcde' }])).toEqual([
      'motivo-obrigatorio',
    ]);
    expect(cod([{ item: 1, valorGlosado: 1, motivo: 1001, justificativa: 'abcde' }])).toEqual([
      'motivo-inexistente',
    ]);
    expect(cod([{ item: 1, valorGlosado: 1, motivo: 1402, justificativa: 'ab' }])).toEqual([
      'justificativa-obrigatoria',
    ]);
    expect(cod([{ item: 1, valorGlosado: 1, motivo: 1402, justificativa: null }])).toEqual([
      'justificativa-obrigatoria',
    ]);
    expect(cod([{ item: 1, valorGlosado: 0, motivo: 1402, justificativa: null }])).toEqual([
      'motivo-sem-glosa',
    ]);
    expect(cod([{ item: 1, valorGlosado: 0, motivo: null, justificativa: 'x' }])).toEqual([
      'motivo-sem-glosa',
    ]);
  });
});

describe('valores, situação e ações', () => {
  it('liberado, saldo e situação pelos valores', () => {
    const v = { apresentado: 100, glosado: 30.5, acatado: 10, pago: 0 };
    expect(valoresDaConta(v, 'recebida')).toEqual({
      apresentado: 100,
      glosado: 30.5,
      acatado: 10,
      liberado: 79.5,
      pago: 0,
      saldo: 0,
    });
    expect(valoresDaConta(v, 'analisada').saldo).toBe(79.5);
    expect(valoresDaConta({ ...v, pago: 79.5 }, 'paga').saldo).toBe(0);
    expect(valoresDaConta(v, 'devolvida')).toMatchObject({ liberado: 0, saldo: 0 });
    expect(valoresDaConta({ ...v, pago: 90 }, 'analisada').saldo).toBe(0);
    expect(situacaoPelosValores(79.5, 79.5)).toBe('paga');
    expect(situacaoPelosValores(79.5, 50)).toBe('analisada');
  });
  it('as ações por situação e por quem está na tela', () => {
    const base = {
      saldo: 0,
      auditorDesignado: true,
      podeAnalisar: true,
      podeReceber: true,
      podePagar: true,
      guiasRecorriveis: 0,
      recursosPendentes: 0,
    };
    expect(acoesDaConta({ ...base, situacao: 'recebida' })).toEqual(['glosar', 'concluir', 'devolver']);
    expect(acoesDaConta({ ...base, situacao: 'recebida', auditorDesignado: false })).toEqual([]);
    expect(
      acoesDaConta({ ...base, situacao: 'analisada', saldo: 10, guiasRecorriveis: 1, recursosPendentes: 1 }),
    ).toEqual(['recurso', 'decidir-recurso', 'pagar']);
    expect(acoesDaConta({ ...base, situacao: 'paga', guiasRecorriveis: 1 })).toEqual(['recurso']);
    expect(acoesDaConta({ ...base, situacao: 'analisada', saldo: 10, podePagar: false })).toEqual([]);
    expect(acoesDaConta({ ...base, situacao: 'devolvida', guiasRecorriveis: 2 })).toEqual([]);
  });
});

describe('recurso de glosa', () => {
  it('registrar: a guia com glosa, um recurso e até a glosa', () => {
    expect(problemasDoRecurso({ glosado: 0, recurso: null }, 1)).toEqual([{ codigo: 'sem-glosa-na-guia' }]);
    expect(problemasDoRecurso({ glosado: 10, recurso: { situacao: 'mantido', valor: 5 } }, 1)).toEqual([
      { codigo: 'recurso-ja-registrado' },
    ]);
    expect(problemasDoRecurso({ glosado: 10, recurso: null }, 10.01)[0]?.codigo).toBe(
      'recurso-acima-da-glosa',
    );
    expect(problemasDoRecurso({ glosado: 10, recurso: null }, 10)).toEqual([]);
  });
  it('a glosa final dos itens depois do acatado, na ordem', () => {
    expect(glosaFinalDosItens([0, 4.5, 10], 6)).toEqual([0, 0, 8.5]);
    expect(glosaFinalDosItens([3, 2], 0)).toEqual([3, 2]);
    expect(glosaFinalDosItens([3, 2], 9)).toEqual([0, 0]);
  });
  it('decidir: só o pendente e até o recurso; a situação pelo acatado', () => {
    expect(problemasDaDecisaoDoRecurso({ glosado: 10, recurso: null }, 0)[0]?.codigo).toBe(
      'sem-recurso-pendente',
    );
    expect(
      problemasDaDecisaoDoRecurso({ glosado: 10, recurso: { situacao: 'acatado', valor: 5 } }, 0)[0]?.codigo,
    ).toBe('sem-recurso-pendente');
    expect(
      problemasDaDecisaoDoRecurso({ glosado: 10, recurso: { situacao: 'pendente', valor: 5 } }, 6)[0]?.codigo,
    ).toBe('acatado-acima-do-recurso');
    expect(
      problemasDaDecisaoDoRecurso({ glosado: 10, recurso: { situacao: 'pendente', valor: 5 } }, 5),
    ).toEqual([]);
    expect(situacaoDoRecurso(5, 0)).toBe('mantido');
    expect(situacaoDoRecurso(5, 2)).toBe('parcial');
    expect(situacaoDoRecurso(5, 5)).toBe('acatado');
  });
});

describe('pagamento ao prestador', () => {
  const c = { situacao: 'analisada' as const, saldo: 50, analisadaEm: '2026-10-20T10:00:00' };
  it('em ordem e as recusas', () => {
    expect(problemasDoPagamento(c, { valor: 50, data: HOJE }, HOJE)).toEqual([]);
    expect(problemasDoPagamento(c, { valor: 20, data: '2026-10-20' }, HOJE)).toEqual([]);
    expect(
      problemasDoPagamento({ ...c, situacao: 'recebida' }, { valor: 1, data: HOJE }, HOJE)[0]?.codigo,
    ).toBe('situacao-nao-permite');
    expect(problemasDoPagamento({ ...c, situacao: 'paga' }, { valor: 1, data: HOJE }, HOJE)[0]?.codigo).toBe(
      'nada-a-pagar',
    );
    expect(problemasDoPagamento(c, { valor: 50.01, data: HOJE }, HOJE)[0]?.codigo).toBe(
      'pagamento-acima-do-saldo',
    );
    expect(problemasDoPagamento(c, { valor: 1, data: '2026-10-27' }, HOJE)[0]?.codigo).toBe(
      'pagamento-no-futuro',
    );
    expect(problemasDoPagamento(c, { valor: 1, data: '2026-10-19' }, HOJE)[0]?.codigo).toBe(
      'pagamento-antes-da-analise',
    );
    expect(problemasDoPagamento({ ...c, analisadaEm: null }, { valor: 1, data: '2026-10-19' }, HOJE)).toEqual(
      [],
    );
  });
});

describe('recurso de glosa: rateio e parecer', () => {
  it('acatado devolve o recorrido de cada linha; mantido devolve zero', () => {
    expect(rateioDoAcatado([10, 20.5], 'acatado', 30.5)).toEqual([10, 20.5]);
    expect(rateioDoAcatado([10, 20.5], 'mantido', 0)).toEqual([0, 0]);
  });
  it('acatado em parte reparte pelo peso, soma exata e nenhuma linha acima do recorrido', () => {
    const r = rateioDoAcatado([10, 10, 10], 'parcial', 10);
    expect(r.reduce((t, v) => Math.round((t + v) * 100) / 100, 0)).toBe(10);
    expect(r).toEqual([3.34, 3.33, 3.33]);
    expect(rateioDoAcatado([100, 50], 'parcial', 75)).toEqual([50, 25]);
    const quase = rateioDoAcatado([0.01, 0.01, 99.98], 'parcial', 99.99);
    expect(quase.every((v, i) => v <= [0.01, 0.01, 99.98][i]!)).toBe(true);
    expect(Math.round(quase.reduce((t, v) => t + v, 0) * 100)).toBe(9999);
  });
  it('uma linha só recebe todo o acatado', () => {
    expect(rateioDoAcatado([42.1], 'parcial', 12.34)).toEqual([12.34]);
  });
  it('o parecer é obrigatório no mantido e no acatado em parte', () => {
    expect(exigeParecerNoRecurso('acatado')).toBe(false);
    expect(exigeParecerNoRecurso('mantido')).toBe(true);
    expect(problemasDoParecerDoRecurso('parcial', '  ')).toEqual([
      { codigo: 'parecer-obrigatorio', campo: 'parecer' },
    ]);
    expect(problemasDoParecerDoRecurso('parcial', 'Laudo confirma')).toEqual([]);
    expect(problemasDoParecerDoRecurso('acatado', '')).toEqual([]);
  });
});
