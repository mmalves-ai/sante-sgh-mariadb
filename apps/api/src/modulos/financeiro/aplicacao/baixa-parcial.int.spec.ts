// F3.8, 07-FIN linha 63: contrato de efeito da baixa do título a pagar com valor informado, contra o MariaDB real (massa
// SINTÉTICA "L0207"). Baixa parcial: a parcela fica "parcial" com o saldo que sobrou, sem data de quitação, e o título
// "pago_parcial"; a baixa guarda o principal liquidado, o desconto, os juros, a multa e o acréscimo, e o movimento da
// conta sai pelo desembolso. A segunda baixa, sobre o saldo, quita. Desconto na quitação: sai menos da conta e a parcela
// quita. Cada recusa (acima do saldo, desconto total, só encargos) deixa a parcela, as baixas e os movimentos como
// estavam. A leitura devolve o saldo e a situação de cada parcela no vocabulário da tela.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-bp-${randomUUID()}` });
const trilha = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'titulo_pagar',
  entidadeId: 0,
  correlacao: null,
};
const HOJE = new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('baixa do título a pagar com valor, desconto e acréscimos (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'bp-02-07' }, (l) => l.uma(sql, p));
  const parcelaLida = async (id: number) => {
    const r = await uma(
      `SELECT p.situacao, p.saldo, p.valor_pago, p.valor_desconto, p.valor_juros, p.valor_multa, p.valor_acrescimo,
              p.quitada_em, t.situacao AS titulo FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
        WHERE p.id = ?`,
      [id],
    );
    return {
      situacao: String(r?.['situacao']),
      saldo: Number(r?.['saldo']),
      pago: Number(r?.['valor_pago']),
      desconto: Number(r?.['valor_desconto']),
      juros: Number(r?.['valor_juros']),
      multa: Number(r?.['valor_multa']),
      acrescimo: Number(r?.['valor_acrescimo']),
      quitada: r?.['quitada_em'] !== null && r?.['quitada_em'] !== undefined,
      titulo: String(r?.['titulo']),
    };
  };
  /** As baixas efetivadas da parcela com o movimento da conta ligado, na ordem em que foram feitas. */
  const baixasLidas = async (id: number) =>
    (
      await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'bp-02-07' }, (l) =>
        l.consultar(
          `SELECT b.valor_principal, b.valor_desconto, b.valor_juros, b.valor_multa, b.valor_acrescimo, b.valor_pago,
                  mv.valor AS movimento, mv.natureza, mv.baixa_titulo_id = b.id AS ligado
             FROM baixa_titulo b JOIN movimento_bancario mv ON mv.id = b.movimento_bancario_id
            WHERE b.parcela_pagar_id = ? AND b.situacao = 'efetivada' AND b.excluido_em IS NULL ORDER BY b.id`,
          [id],
        ),
      )
    ).map((b) => ({
      principal: Number(b['valor_principal']),
      desconto: Number(b['valor_desconto']),
      juros: Number(b['valor_juros']),
      multa: Number(b['valor_multa']),
      acrescimo: Number(b['valor_acrescimo']),
      pago: Number(b['valor_pago']),
      movimento: Number(b['movimento']),
      natureza: String(b['natureza']),
      ligado: Number(b['ligado']) === 1,
    }));
  const tituloAprovado = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(
      c,
      'financeiro.criarTituloPagar',
      tituloDaMassa(m, documento, valor),
      op(c),
    );
    const parcela = Number(t.resultado['titulo']);
    await porta.gravarSgh(op(m.ctx(m.aprova)), trilha, (g) =>
      g.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
    return parcela;
  };
  const pagar = (parcela: number, valores: Record<string, number> = {}, porBordero = false) =>
    porta.executar(
      m.ctx(m.paga),
      'financeiro.baixarTitulo',
      {
        cenario: 'pagar',
        titulos: [{ titulo: parcela, versao: null, ...valores }],
        conta: m.contaA,
        dataPagamento: HOJE,
        formaPagamento: 1,
        porBordero,
      },
      op(m.ctx(m.paga)),
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await porta.gravarSgh(op(m.ctx(m.lanca)), trilha, (g) =>
      g.salvarFaixa({
        id: null,
        centroCusto: null,
        tipoCredor: null,
        valorDe: 0,
        valorAte: null,
        aprovacoes: 1,
        permissao: 'financeiro.tituloPagar.aprovar',
        vigenciaInicio: '2000-01-01',
        vigenciaFim: null,
        ativa: true,
        usuario: 'x',
      }),
    );
  }, 180_000);

  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('baixa parcial deixa saldo em aberto; a segunda baixa, com juros e multa, quita', async () => {
    const p = await tituloAprovado(964001, 1000);
    const r = await pagar(p, { valorPago: 400, desconto: 30, juros: 10 });
    expect(r.resultado).toMatchObject({ titulos: 1, valor: 400, parciais: 1 });
    // 400 saíram da conta; com 30 de desconto e 10 de juros, 420 do saldo foram liquidados.
    expect(await parcelaLida(p)).toEqual({
      situacao: 'parcial',
      saldo: 580,
      pago: 400,
      desconto: 30,
      juros: 10,
      multa: 0,
      acrescimo: 0,
      quitada: false,
      titulo: 'pago_parcial',
    });
    expect(await baixasLidas(p)).toEqual([
      {
        principal: 420,
        desconto: 30,
        juros: 10,
        multa: 0,
        acrescimo: 0,
        pago: 400,
        movimento: 400,
        natureza: 'debito',
        ligado: true,
      },
    ]);
    // A leitura: o título pago em parte, com o saldo, e a parcela no vocabulário da tela; continua na fila de pagamento.
    const det = await porta.tituloPagar(m.ctx(m.lanca), p, HOJE);
    expect(det).toMatchObject({ situacao: 'pago-parcial', saldo: 580, pago: 400 });
    expect(det?.parcelas).toMatchObject([{ id: p, saldo: 580, situacao: 'pago-parcial' }]);
    expect((await porta.filaAprovacao(m.ctx(m.paga), HOJE, '2999-12-31')).map((t) => t.id)).toContain(p);

    // Sem valor informado, a segunda baixa quita o saldo; os juros e a multa saem da conta além dele.
    const r2 = await pagar(p, { juros: 5.8, multa: 11.6 }, true);
    expect(r2.resultado).toMatchObject({ titulos: 1, valor: 597.4, parciais: 0 });
    expect(await parcelaLida(p)).toEqual({
      situacao: 'paga',
      saldo: 0,
      pago: 997.4,
      desconto: 30,
      juros: 15.8,
      multa: 11.6,
      acrescimo: 0,
      quitada: true,
      titulo: 'pago',
    });
    const bs = await baixasLidas(p);
    expect(bs).toHaveLength(2);
    expect(bs[1]).toMatchObject({ principal: 580, juros: 5.8, multa: 11.6, pago: 597.4, movimento: 597.4 });
    // O principal das baixas fecha o valor da parcela.
    expect(bs.reduce((s, b) => s + b.principal, 0)).toBe(1000);
    expect((await porta.tituloPagar(m.ctx(m.lanca), p, HOJE))?.situacao).toBe('pago');
    expect(await codigoDaGravacao(pagar(p))).toBe('titulo-ja-baixado');
  });

  it('desconto na quitação: sai menos da conta e a parcela quita', async () => {
    const p = await tituloAprovado(964002, 800);
    const r = await pagar(p, { desconto: 50, acrescimo: 2.5 });
    expect(r.resultado).toMatchObject({ valor: 752.5, parciais: 0 });
    expect(await parcelaLida(p)).toMatchObject({
      situacao: 'paga',
      saldo: 0,
      pago: 752.5,
      desconto: 50,
      acrescimo: 2.5,
      quitada: true,
      titulo: 'pago',
    });
    expect(await baixasLidas(p)).toMatchObject([
      { principal: 800, desconto: 50, acrescimo: 2.5, pago: 752.5, movimento: 752.5, ligado: true },
    ]);
    // Pago com desconto é pago (não "pago em parte"), mesmo com o desembolso menor que o valor.
    expect((await porta.tituloPagar(m.ctx(m.lanca), p, HOJE))?.situacao).toBe('pago');
  });

  it('recusas não mudam a parcela, as baixas nem os movimentos', async () => {
    const p = await tituloAprovado(964003, 300);
    const antes = await parcelaLida(p);
    expect(await codigoDaGravacao(pagar(p, { valorPago: 300.01 }))).toBe('valor-acima-do-saldo');
    expect(await codigoDaGravacao(pagar(p, { valorPago: 290, desconto: 20 }))).toBe('valor-acima-do-saldo');
    expect(await codigoDaGravacao(pagar(p, { desconto: 300 }))).toBe('desconto-acima-do-valor');
    expect(await codigoDaGravacao(pagar(p, { valorPago: 15, juros: 15 }))).toBe('pagamento-so-de-encargos');
    expect(await parcelaLida(p)).toEqual(antes);
    expect(antes).toMatchObject({ situacao: 'aberta', saldo: 300, pago: 0, titulo: 'aberto' });
    expect(await baixasLidas(p)).toEqual([]);
  });
});
