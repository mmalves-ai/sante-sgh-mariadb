// Regras próprias da onda 3 (ficha do M41, seção 8) e as funções do painel de acompanhamento (seções 4, 7 e 10). Dados
// sintéticos: nenhum item, unidade ou local real.
import { describe, expect, it } from 'vitest';
import {
  conferenciaNumerica,
  contagemAgregada,
  decidirChaveFarmacia,
  documentosPorSistema,
  efeitosDoDocumento,
  gravacoesEmTabelaDeEfeito,
  horariosPorUnidade,
  operacoesDaOnda3,
  setoresAntesDe,
  setorOnda3,
  unidadesPorLocal,
} from '@sgh/contratos/regras-suprimentos';
import {
  CHAVE_PRESCRICAO_ONDA2,
  esquemaPainelOnda3,
  IDS_SETOR_ONDA3,
  RECURSOS_DESLIGADOS,
  RECURSOS_FORA_DA_ONDA3,
  SETORES_ONDA3,
  TABELAS_EFEITO_ESTOQUE,
} from '@sgh/contratos';

describe('regra 1: farmácia depois da prescrição em uso', () => {
  it('liga só com a prescrição ligada em todas as unidades atendidas', () => {
    expect(decidirChaveFarmacia(true, ['U1', 'U2'], ['U1', 'U2', 'U3'])).toEqual({ permitido: true });
    const r = decidirChaveFarmacia(true, ['U2', 'U1', 'U3', 'U1'], ['U1']);
    expect(r.permitido).toBe(false);
    if (r.permitido) return;
    expect(r.faltam).toEqual(['U2', 'U3']);
    expect(r.mensagem).toContain('U2, U3');
  });
  it('local sem unidade atendida conhecida não liga; desligar nunca recusa', () => {
    const r = decidirChaveFarmacia(true, [' ', ''], ['U1']);
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.faltam).toEqual([]);
    expect(decidirChaveFarmacia(false, ['U1'], [])).toEqual({ permitido: true });
  });
  it('o mapa local → unidades vem das dispensações recentes (com o mínimo)', () => {
    const m = unidadesPorLocal(
      [
        { local: 10, unidade: 'B ', dispensacoes: 30 },
        { local: 10, unidade: 'A', dispensacoes: 2 },
        { local: 10, unidade: 'B', dispensacoes: 5 },
        { local: 15, unidade: '', dispensacoes: 9 },
        { local: 15, unidade: 'C', dispensacoes: 1 },
      ],
      2,
    );
    expect(m.get(10)).toEqual(['A', 'B']);
    expect(m.has(15)).toBe(false);
    expect(unidadesPorLocal([{ local: 1, unidade: 'Z', dispensacoes: 1 }]).get(1)).toEqual(['Z']);
  });
  it('a chave da prescrição é a da onda 2 e existe entre os recursos', () => {
    expect(RECURSOS_DESLIGADOS.some((r) => r.chave === CHAVE_PRESCRICAO_ONDA2)).toBe(true);
    expect(SETORES_ONDA3.filter((s) => s.exigePrescricaoDaUnidade).map((s) => s.id)).toEqual([
      'farmacia-central',
      'farmacias-satelites',
      'farmacia-clinica',
    ]);
  });
});

describe('setores da onda e ordem do campo 12', () => {
  it('quatro setores na ordem recomendada, cada recurso declarado', () => {
    expect(SETORES_ONDA3.map((s) => s.id)).toEqual([...IDS_SETOR_ONDA3]);
    expect(SETORES_ONDA3.map((s) => s.ordem)).toEqual([1, 2, 3, 4]);
    const chaves = new Set(RECURSOS_DESLIGADOS.map((r) => r.chave));
    for (const s of SETORES_ONDA3) for (const r of s.recursos) expect(chaves.has(r), r).toBe(true);
    for (const r of RECURSOS_FORA_DA_ONDA3) expect(chaves.has(r), r).toBe(true);
    expect(setorOnda3('nao-existe')).toBeUndefined();
  });
  it('setoresAntesDe: os anteriores ainda não liberados', () => {
    expect(setoresAntesDe('almoxarifado-compras', [])).toEqual([]);
    expect(setoresAntesDe('farmacias-satelites', ['almoxarifado-compras'])).toEqual(['farmacia-central']);
    expect(
      setoresAntesDe('farmacia-clinica', ['almoxarifado-compras', 'farmacia-central', 'farmacias-satelites']),
    ).toEqual([]);
    expect(setoresAntesDe('x', [])).toEqual([]);
  });
  it('P1 e P2 sem sobreposição; a dispensação e os documentos de estoque são P1', () => {
    const { p1, p2 } = operacoesDaOnda3();
    expect(p1).toContain('suprimentos.dispensarHorario');
    expect(p1).toContain('suprimentos.registrarSaida');
    expect(p2).toContain('suprimentos.fecharMes');
    expect(p2).toContain('suprimentos.avaliarPrescricao');
    expect(p1.filter((o) => p2.includes(o))).toEqual([]);
  });
  it('controlados: o livro informatizado fica fora da onda e exige a aprovação da VISA (regra 5)', () => {
    const livro = RECURSOS_DESLIGADOS.find((r) => r.chave === 'suprimentos.livroControlados');
    expect(livro?.prerequisitos.some((p) => p.tipo === 'aprovacao' && /Vigil/.test(p.descricao))).toBe(true);
    for (const s of SETORES_ONDA3) expect(s.recursos).not.toContain('suprimentos.livroControlados');
  });
});

describe('regra 2: os efeitos do estoque são da operação de movimento do domínio', () => {
  it('acusa operação da onda que grava tabela de efeito sem ser de movimento; ignora as de movimento e as de fora', () => {
    expect(
      gravacoesEmTabelaDeEfeito([
        {
          nome: 'suprimentos.registrarSaida',
          tabelasGravadas: ['documento_estoque', 'saldo_estoque_mensal'],
        },
        {
          nome: 'suprimentos.criarPedido',
          tabelasGravadas: ['pedido_compra', 'saldo_estoque', 'SALDO_ESTOQUE'],
        },
        { nome: 'suprimentos.definirVencedorCotacao', tabelasGravadas: ['cotacao', 'sequencia_negocio'] },
        { nome: 'faturamento.lancarItem', tabelasGravadas: ['consumo_centro_custo'] },
      ]),
    ).toEqual([{ operacao: 'suprimentos.criarPedido', tabela: 'saldo_estoque' }]);
    expect(TABELAS_EFEITO_ESTOQUE).toContain('saldo_estoque');
    expect(TABELAS_EFEITO_ESTOQUE).not.toContain('sequencia_negocio');
    expect(TABELAS_EFEITO_ESTOQUE).not.toContain('lancamento_contabil');
  });
});

describe('efeitos dos gatilhos por documento', () => {
  const base = {
    tipo: 'saida' as const,
    consolidado: true,
    itens: [
      { item: 1, valorMedio: 2.5, rastreavel: false, comLote: false },
      { item: 2, valorMedio: 1, rastreavel: true, comLote: true },
    ],
    itensComSaldoMensal: [1, 2],
    comConsumo: true,
    itensComSaldoLocal: [1, 2],
  };
  it('documento com todos os efeitos: nenhum alerta', () => {
    expect(efeitosDoDocumento(base)).toEqual({
      efeitos: { valorizado: true, saldoMensal: true, consumo: true, lote: true, saldoLocal: true },
      alertas: [],
    });
  });
  it('sem valorização, sem saldo mensal, sem consumo, sem lote', () => {
    const doc = {
      ...base,
      itens: [
        { item: 1, valorMedio: null, rastreavel: false, comLote: false },
        { item: 2, valorMedio: 0, rastreavel: true, comLote: false },
      ],
      itensComSaldoMensal: [1],
      comConsumo: false,
      itensComSaldoLocal: [],
    };
    const r = efeitosDoDocumento(doc, { exigirConsumo: true });
    expect(r.alertas).toEqual(['sem-valorizacao', 'sem-saldo-mensal', 'sem-consumo', 'sem-lote']);
    expect(r.efeitos.saldoLocal).toBe(false);
    // Consumo informativo por padrão (a condição do gatilho ainda não fixada): sem o alerta, mas o efeito aparece.
    const padrao = efeitosDoDocumento(doc);
    expect(padrao.alertas).toEqual(['sem-valorizacao', 'sem-saldo-mensal', 'sem-lote']);
    expect(padrao.efeitos.consumo).toBe(false);
  });
  it('consumo só vale na saída; sem item rastreável, o lote não se aplica', () => {
    const r = efeitosDoDocumento({
      ...base,
      tipo: 'devolucao',
      itens: [{ item: 1, valorMedio: 3, rastreavel: false, comLote: false }],
      itensComSaldoMensal: [1],
      comConsumo: false,
    });
    expect(r.efeitos.consumo).toBeNull();
    expect(r.efeitos.lote).toBeNull();
    expect(r.alertas).toEqual([]);
  });
  it('não consolidado: alerta, salvo a dispensação (o efeito está na saída que ela gera)', () => {
    expect(efeitosDoDocumento({ ...base, consolidado: false }).alertas).toEqual(['nao-consolidado']);
    expect(efeitosDoDocumento({ ...base, tipo: 'dispensacao', consolidado: false }).alertas).toEqual([]);
    expect(efeitosDoDocumento({ ...base, tipo: 'dispensacao' }).efeitos.valorizado).toBeNull();
    expect(efeitosDoDocumento({ ...base, itens: [] }).alertas).toEqual([]);
  });
});

describe('documentos do dia por sistema', () => {
  it('demais = total − novo, nunca negativo; o do novo sem total aparece', () => {
    const r = documentosPorSistema(
      [
        { tipo: 'saida', local: 10, total: 40 },
        { tipo: 'saida', local: 10, total: 2 },
        { tipo: 'nota', local: null, total: 3 },
        { tipo: 'devolucao', local: 15, total: 1 },
      ],
      [
        { tipo: 'saida', local: 10 },
        { tipo: 'saida', local: 10 },
        { tipo: 'devolucao', local: 15 },
        { tipo: 'devolucao', local: 15 },
        { tipo: 'transferencia', local: 25 },
      ],
    );
    expect(r).toEqual([
      { tipo: 'devolucao', local: 15, total: 1, novo: 2, demais: 0 },
      { tipo: 'nota', local: null, total: 3, novo: 0, demais: 3 },
      { tipo: 'saida', local: 10, total: 42, novo: 2, demais: 40 },
      { tipo: 'transferencia', local: 25, total: 1, novo: 1, demais: 0 },
    ]);
    expect(documentosPorSistema([], [{ tipo: 'nota', local: null }])).toEqual([
      { tipo: 'nota', local: null, total: 1, novo: 1, demais: 0 },
    ]);
  });
});

describe('horários dispensados contra prescritos', () => {
  it('agrupa por unidade, percentual com 1 casa; dispensados do novo nunca acima dos dispensados', () => {
    expect(
      horariosPorUnidade([
        { unidade: 'B', prescritos: 3, dispensados: 1, dispensadosNovo: 5 },
        { unidade: 'A', prescritos: 0, dispensados: 0, dispensadosNovo: 0 },
        { unidade: 'B', prescritos: 0, dispensados: 1, dispensadosNovo: 0 },
        { unidade: ' ', prescritos: 2, dispensados: 2, dispensadosNovo: 0 },
      ]),
    ).toEqual([
      { unidade: '(sem unidade)', prescritos: 2, dispensados: 2, dispensadosNovo: 0, percentual: 100 },
      { unidade: 'A', prescritos: 0, dispensados: 0, dispensadosNovo: 0, percentual: null },
      { unidade: 'B', prescritos: 3, dispensados: 2, dispensadosNovo: 2, percentual: 66.7 },
    ]);
  });
});

describe('conferência numérica (campo 10)', () => {
  it('0 divergência dentro da tolerância', () => {
    expect(
      conferenciaNumerica(
        [{ item: 1, local: 10, saldo: 5.0004, precoMedio: 2.12341 }],
        [{ item: 1, local: 10, saldo: 5, precoMedio: 2.1234 }],
      ),
    ).toEqual([]);
  });
  it('saldo e preço médio diferentes; item que falta de um lado', () => {
    const r = conferenciaNumerica(
      [
        { item: 2, local: 10, saldo: 10, precoMedio: 1.5 },
        { item: 1, local: null, saldo: 3, precoMedio: 4 },
      ],
      [
        { item: 2, local: 10, saldo: 9, precoMedio: 1.6 },
        { item: 3, local: 10, saldo: 1, precoMedio: 2 },
        { item: 4, local: 10, saldo: 0, precoMedio: 0 },
      ],
    );
    expect(r).toEqual([
      { item: 1, local: null, campo: 'precoMedio', esperado: 4, lido: 0, diferenca: -4 },
      { item: 1, local: null, campo: 'saldo', esperado: 3, lido: 0, diferenca: -3 },
      { item: 2, local: 10, campo: 'precoMedio', esperado: 1.5, lido: 1.6, diferenca: 0.1 },
      { item: 2, local: 10, campo: 'saldo', esperado: 10, lido: 9, diferenca: -1 },
      { item: 3, local: 10, campo: 'precoMedio', esperado: 0, lido: 2, diferenca: 2 },
      { item: 3, local: 10, campo: 'saldo', esperado: 0, lido: 1, diferenca: 1 },
    ]);
  });
});

describe('contrato do painel', () => {
  it('contagem agregada abaixo de 5 vira <5', () => {
    expect(contagemAgregada(0)).toBe(0);
    expect(contagemAgregada(4)).toBe('<5');
    expect(contagemAgregada(5)).toBe(5);
  });
  it('o esquema valida o painel e recusa contagem pequena sem máscara', () => {
    const painel = {
      hospital: 'pc',
      dia: '2026-12-01',
      documentos: [{ tipo: 'saida', local: 10, total: 3, novo: 1, demais: 2 }],
      efeitos: [],
      comAlerta: 0,
      horarios: [],
      requisicoes: [{ local: 10, localNome: 'CENTRAL', pendentes: 2 }],
      uso: [{ local: 10, localNome: 'CENTRAL', usuariosDoLocal: 12, conectadosNaJanela: '<5' }],
      ultimoMesFechado: { ano: 2026, mes: 6 },
      cortada: false,
    };
    expect(esquemaPainelOnda3.safeParse(painel).success).toBe(true);
    expect(
      esquemaPainelOnda3.safeParse({
        ...painel,
        uso: [{ local: 10, localNome: 'X', usuariosDoLocal: -1, conectadosNaJanela: 0 }],
      }).success,
    ).toBe(false);
  });
});
