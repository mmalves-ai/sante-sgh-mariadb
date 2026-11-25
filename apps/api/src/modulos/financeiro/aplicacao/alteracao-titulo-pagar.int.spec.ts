// F3.8, 07-FIN linha 63: contrato de efeito da alteração do título a pagar não pago contra o MariaDB real (massa
// SINTÉTICA "L0207"). O descritivo (referente) muda sem tocar na aprovação: o pedido continua e o título continua
// autorizado como estava. Valor e parcelas sem justificativa num título aprovado são recusados sem gravar nada; com a
// justificativa, o valor bruto e o líquido mudam, as parcelas ficam como pedidas (a nova entra, a que continua leva o
// valor e o saldo novos), o pedido de aprovação fica cancelado com o motivo (as decisões ficam no histórico) e o título
// perde a marca de autorizado. Tirar uma parcela exclui a linha de forma lógica (ela continua no banco). A trilha guarda
// o antes e o depois. Título com baixa e versão desatualizada são recusados sem gravar.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_ALTERACAO_TITULO_PAGAR } from '../alteracao-titulo-pagar-propria.js';
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

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-alt-${randomUUID()}` });
const trilha = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'titulo_pagar',
  entidadeId: 0,
  correlacao: null,
};
const somaDias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const HOJE = somaDias(0);

describe.skipIf(SEM_BANCO)('alteração do título a pagar não pago (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'alt-02-07' }, (l) => l.consultar(sql, p));
  const um = async (sql: string, p: unknown[]) => (await consultar(sql, p))[0] ?? {};
  const alterar = (entrada: Record<string, unknown>, usuario = m.lanca) => {
    const c = m.ctx(usuario);
    return m.nucleo
      .criarExecutor()
      .executar(OPERACOES_ALTERACAO_TITULO_PAGAR.alterarTituloPagar as never, CLIENTE, entrada, op(c))
      .then((r) => r.resultado as Record<string, unknown>);
  };
  const lancar = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(
      c,
      'financeiro.criarTituloPagar',
      tituloDaMassa(m, documento, valor),
      op(c),
    );
    return { parcela: Number(t.resultado['titulo']), titulo: Number(t.resultado['tituloPagar']) };
  };
  const aprovar = (parcela: number) =>
    porta.gravarSgh(op(m.ctx(m.aprova)), trilha, (g) =>
      g.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
  const estado = async (titulo: number) => {
    const t = await um(
      'SELECT valor_bruto, valor_liquido, quantidade_parcelas, referente, autorizado, versao FROM titulo_pagar WHERE id = ?',
      [titulo],
    );
    const parcelas = await consultar(
      'SELECT sequencia, vencimento, valor, saldo, excluido_em IS NOT NULL AS excluida FROM parcela_pagar WHERE titulo_pagar_id = ? ORDER BY sequencia',
      [titulo],
    );
    const pedidos = await consultar(
      `SELECT situacao, motivo_conclusao FROM pedido_aprovacao WHERE entidade = 'titulo_pagar' AND entidade_id = ? ORDER BY id`,
      [titulo],
    );
    const decisoes = await um(
      `SELECT COUNT(*) AS n FROM decisao_aprovacao d JOIN pedido_aprovacao p ON p.id = d.pedido_aprovacao_id
        WHERE p.entidade = 'titulo_pagar' AND p.entidade_id = ?`,
      [titulo],
    );
    return {
      bruto: Number(t['valor_bruto']),
      liquido: Number(t['valor_liquido']),
      quantidade: Number(t['quantidade_parcelas']),
      referente: String(t['referente'] ?? ''),
      autorizado: Number(t['autorizado']) === 1,
      versao: Number(t['versao']),
      parcelas: parcelas.map((p) => ({
        sequencia: Number(p['sequencia']),
        valor: Number(p['valor']),
        saldo: Number(p['saldo']),
        excluida: Number(p['excluida']) === 1,
      })),
      pedidos: pedidos.map((p) => String(p['situacao'])),
      motivos: pedidos.map((p) => String(p['motivo_conclusao'] ?? '')),
      decisoes: Number(decisoes['n']),
    };
  };

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

  it('descritivo muda sem tocar na aprovação; valor e parcelas cancelam o pedido e reabrem a alçada', async () => {
    const { parcela, titulo } = await lancar(963101, 600);
    await aprovar(parcela);
    const aprovado = await estado(titulo);
    expect(aprovado.pedidos.length).toBe(1);
    expect(aprovado.decisoes).toBe(1);

    const r1 = await alterar({ titulo: parcela, referente: 'SINTETICO ALTERADO' });
    expect(r1).toMatchObject({
      campos: 'referente',
      materiais: '',
      reabreAlcada: false,
      aprovacoesCanceladas: 0,
    });
    const descritivo = await estado(titulo);
    expect(descritivo).toMatchObject({
      referente: 'SINTETICO ALTERADO',
      autorizado: aprovado.autorizado,
      pedidos: aprovado.pedidos,
      bruto: 600,
    });

    const novo = {
      titulo: parcela,
      valorDocumento: 700,
      parcelas: [
        { parcela: 1, vencimento: HOJE, valor: 300 },
        { parcela: 2, vencimento: somaDias(30), valor: 400 },
      ],
    };
    expect(await codigoDaGravacao(alterar(novo))).toBe('justificativa-obrigatoria');
    expect(await estado(titulo)).toEqual(descritivo);

    const r2 = await alterar({ ...novo, justificativa: 'nota fiscal corrigida pelo fornecedor' });
    expect(r2).toMatchObject({
      materiais: 'valorDocumento,parcelas',
      reabreAlcada: true,
      aprovacoesCanceladas: 1,
    });
    const depois = await estado(titulo);
    expect(depois).toMatchObject({
      bruto: 700,
      liquido: 700,
      quantidade: 2,
      autorizado: false,
      pedidos: ['cancelado'],
      decisoes: 1,
      parcelas: [
        { sequencia: 1, valor: 300, saldo: 300, excluida: false },
        { sequencia: 2, valor: 400, saldo: 400, excluida: false },
      ],
    });
    expect(depois.motivos[0]).toContain('nota fiscal corrigida');

    const trilhaAlt = await um(
      `SELECT JSON_EXTRACT(dados_depois, '$.dados.antes.valorDocumento') AS antes,
              JSON_EXTRACT(dados_depois, '$.dados.depois.valorDocumento') AS depois, motivo
         FROM trilha_auditoria WHERE entidade = 'titulo_pagar' AND entidade_id = ? AND estabelecimento_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) = 'financeiro.alterar_titulo_pagar'
        ORDER BY id DESC LIMIT 1`,
      [titulo, m.est],
    );
    expect(Number(trilhaAlt['antes'])).toBe(600);
    expect(Number(trilhaAlt['depois'])).toBe(700);
    expect(String(trilhaAlt['motivo'])).toContain('nota fiscal corrigida');

    // Sem aprovação vigente: tirar a parcela 2 não pede justificativa; a linha fica, excluída de forma lógica.
    await alterar({
      titulo: parcela,
      valorDocumento: 300,
      parcelas: [{ parcela: 1, vencimento: HOJE, valor: 300 }],
    });
    const uma = await estado(titulo);
    expect(uma).toMatchObject({
      bruto: 300,
      quantidade: 1,
      parcelas: [
        { sequencia: 1, valor: 300, excluida: false },
        { sequencia: 2, valor: 400, excluida: true },
      ],
    });
    // A parcela 2 volta na mesma linha.
    await alterar({
      titulo: parcela,
      valorDocumento: 500,
      parcelas: [
        { parcela: 1, vencimento: HOJE, valor: 300 },
        { parcela: 2, vencimento: somaDias(30), valor: 200 },
      ],
    });
    expect((await estado(titulo)).parcelas).toEqual([
      { sequencia: 1, valor: 300, saldo: 300, excluida: false },
      { sequencia: 2, valor: 200, saldo: 200, excluida: false },
    ]);
  });

  it('título com baixa e versão desatualizada são recusados sem gravar', async () => {
    const { parcela, titulo } = await lancar(963102, 400);
    const antes = await estado(titulo);
    expect(await codigoDaGravacao(alterar({ titulo: parcela, versao: '999', referente: 'X' }))).toBe(
      'conflito-versao',
    );
    expect(await codigoDaGravacao(alterar({ titulo: parcela, referente: ' SINTETICO L0207 ' }))).toBe(
      'sem-alteracao',
    );
    await aprovar(parcela);
    await porta.executar(
      m.ctx(m.paga),
      'financeiro.baixarTitulo',
      {
        cenario: 'pagar',
        titulos: [{ titulo: parcela, versao: null, valorPago: 100 }],
        conta: m.contaA,
        dataPagamento: HOJE,
        formaPagamento: 1,
        porBordero: false,
      },
      op(m.ctx(m.paga)),
    );
    const pago = await estado(titulo);
    expect(pago.parcelas[0]?.saldo).toBe(300);
    expect(await codigoDaGravacao(alterar({ titulo: parcela, referente: 'DEPOIS DA BAIXA' }))).toBe(
      'titulo-nao-alteravel',
    );
    expect(await estado(titulo)).toEqual(pago);
    expect(antes.bruto).toBe(400);
  });
});
