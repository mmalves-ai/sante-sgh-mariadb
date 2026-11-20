// M42: o contrato da onda 4 (ordem dos setores, critério por setor e os esquemas do painel e da conferência).
import { describe, expect, it } from 'vitest';
import {
  ITENS_CRITERIO_LIBERACAO,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  esquemaGravarItensOnda2,
} from '../onda2/onda2.js';
import {
  IDS_SETOR_ONDA_4,
  ITENS_CRITERIO_POR_SETOR_ONDA_4,
  ORDEM_SETORES_ONDA_4,
  SETORES_ONDA_4,
  SETORES_ONDA_4_PRONTIDAO,
  esquemaAcompanhamentoCompetencia,
  esquemaFiltroAcompanhamento,
  esquemaPedidoConferenciaCompetencia,
  operacoesDaOnda4,
  ROTULOS_OPERACAO_ONDA_4,
  rotuloOperacaoOnda4,
} from './onda4.js';

describe('contrato da onda 4', () => {
  it('ordem do campo 12 com os setores da prontidão (sem a carga dos catálogos)', () => {
    expect(ORDEM_SETORES_ONDA_4.flat()).toEqual([...IDS_SETOR_ONDA_4]);
    expect(SETORES_ONDA_4_PRONTIDAO).not.toContain('catalogos-de-preco');
    expect(SETORES_ONDA_4.find((s) => s.id === 'contas-a-pagar')?.recursos).toEqual([
      'financeiro.contasPagar',
    ]);
  });

  it('todo item da onda está no vocabulário e não admite "não se aplica"', () => {
    for (const itens of Object.values(ITENS_CRITERIO_POR_SETOR_ONDA_4))
      for (const i of itens) {
        expect(ITENS_CRITERIO_LIBERACAO).toContain(i);
        expect(ITENS_SEM_NAO_SE_APLICA_ONDA_2).toContain(i);
      }
    const r = esquemaGravarItensOnda2.safeParse({
      itens: [
        { item: 'abertura-da-competencia', situacao: 'nao-se-aplica', evidencia: 'ata 12', em: '2027-01-04' },
      ],
      justificativa: 'registro do comitê',
    });
    expect(r.success).toBe(false);
  });

  it('filtro e pedido de conferência', () => {
    expect(esquemaFiltroAcompanhamento.parse({ competencia: '2026-04', convenio: '7' })).toEqual({
      competencia: '2026-04',
      convenio: 7,
    });
    expect(esquemaFiltroAcompanhamento.safeParse({ competencia: '2026-13' }).success).toBe(false);
    expect(
      esquemaPedidoConferenciaCompetencia.safeParse({
        competencia: '2026-04',
        linhas: [
          { convenio: 1, contas: 2, fechadas: 1, valor: 10 },
          { convenio: 1, contas: 2, fechadas: 1, valor: 10 },
        ],
      }).success,
    ).toBe(false);
    // Sem bloco nenhum: recusado; só os lotes, ou as contas vazias (todo convênio vira diferença), aceitos.
    expect(esquemaPedidoConferenciaCompetencia.safeParse({ competencia: '2026-04' }).success).toBe(false);
    expect(
      esquemaPedidoConferenciaCompetencia.safeParse({ competencia: '2026-04', blocos: {} }).success,
    ).toBe(false);
    expect(
      esquemaPedidoConferenciaCompetencia.safeParse({
        competencia: '2026-04',
        blocos: { lotes: { lotes: 3, protocolados: 2 } },
      }).success,
    ).toBe(true);
    expect(
      esquemaPedidoConferenciaCompetencia.safeParse({ competencia: '2026-04', linhas: [] }).success,
    ).toBe(true);
    expect(
      esquemaPedidoConferenciaCompetencia.safeParse({
        competencia: '2026-04',
        blocos: {
          movimento: [
            { tipo: 'I', lancamentos: 1, valor: 1 },
            { tipo: 'I', lancamentos: 2, valor: 2 },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('toda operação da onda tem rótulo de produto (nenhum nome técnico na tela)', () => {
    for (const op of operacoesDaOnda4()) {
      expect(ROTULOS_OPERACAO_ONDA_4[op], op).toBeTruthy();
      expect(rotuloOperacaoOnda4(op)).not.toMatch(/\./);
    }
    expect(rotuloOperacaoOnda4('x.y')).toBe('Outra gravação');
  });

  it('o painel aceita bloco indisponível no lugar dos títulos', () => {
    const p = esquemaAcompanhamentoCompetencia.safeParse({
      competencia: '2026-04',
      convenio: null,
      contas: {
        disponivel: true,
        contas: 0,
        valor: 0,
        porSituacao: [],
        fechadas: 0,
        fechadasPeloNovo: 0,
        fechadasPeloOutro: 0,
        parcelaDoNovo: null,
        porConvenio: [],
      },
      lotes: {
        disponivel: true,
        lotes: 0,
        comProtocolo: 0,
        semProtocolo: 0,
        contasEmLote: 0,
        conveniosFechados: 0,
        conveniosComConta: 0,
      },
      glosas: { disponivel: false, motivo: 'x' },
      titulos: { disponivel: false, motivo: 'sem a leitura do financeiro' },
      repasse: { disponivel: false, motivo: 'x' },
      gravacoes: [],
      uso: { disponivel: false, motivo: 'x' },
      geradoEm: '2026-10-24T00:00:00Z',
      emCache: false,
    });
    expect(p.success).toBe(true);
  });
});
