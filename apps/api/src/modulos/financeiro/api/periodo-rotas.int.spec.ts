// F3.8, 07-FIN linha 85: as rotas do período financeiro contra o MariaDB real (massa SINTÉTICA "L0207"), chamadas no
// próprio controlador com o banco do cliente: depois de fechar, pedir e decidir, GET /financeiro/periodos, /eventos e
// /saldo-diario devolvem o que ficou gravado (quem fechou, quantos movimentos, o pedido à espera, quem reabriu e quem
// autorizou; o saldo de cada dia igual ao da tabela). O saldo diário só sai para conta do escopo do usuário e do
// estabelecimento da sessão (404 nos outros casos), e o outro estabelecimento não vê período nem evento. Nas gravações,
// a funcionalidade confere a permissão de agir antes de tudo: decidir a reabertura sem `financeiro.parametro.editar` é
// 403, e sem a configuração do estabelecimento a gravação fica em consulta (falha fechada). Só contagens e códigos.
import { randomUUID } from 'node:crypto';
import { partesDaPermissao } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { ErroProblema } from '../../../problema.filter.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';
import {
  CLIENTE,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from '../aplicacao/massa-banco.spec-util.js';
import { listarPeriodos, saldosDiarios } from '../periodo-propria.js';
import { PeriodoFinanceiroController } from '../periodo.controller.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';

const hoje = new Date();
const mesAtras = (n: number) =>
  new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
const COMP = mesAtras(1);
const ANTERIOR = mesAtras(2);
const FIM = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0)).toISOString().slice(0, 10);
const D0 = `${ANTERIOR.slice(0, 8)}05`;
const D1 = `${COMP.slice(0, 8)}03`;
const D2 = `${COMP.slice(0, 8)}10`;
const JUST = 'Tarifa do banco lançada fora do mês';
const LER = 'financeiro.movimento.ler';
const CRIAR = 'financeiro.movimento.criar';
const DECIDIR = 'financeiro.parametro.editar';

/** O que a rota respondeu: "ok" ou o status e o código do problema (a função cobre a recusa antes da promessa). */
async function resposta(p: Promise<unknown> | (() => Promise<unknown>)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'ok';
  } catch (e) {
    if (!(e instanceof ErroProblema)) throw e;
    return `${e.getStatus()}:${String(e.extras['codigo'] ?? e.tipo)}`;
  }
}

describe.skipIf(SEM_BANCO)('período financeiro: as rotas com o banco do cliente (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let rotas: PeriodoFinanceiroController;
  const codigos = new Map<number, string>();
  const logins = new Map<number, string>();
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pf-rotas' }, (l) => l.consultar(sql, p));
  const limparEventos = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pf-rotas' }, (e) =>
      e.executar('DELETE FROM evento_periodo_financeiro WHERE estabelecimento_id IN (?, ?)', [
        m.est,
        m.outroEst,
      ]),
    );
  /** A requisição já autorizada pelo guarda: a sessão do usuário no estabelecimento, com as permissões dadas. */
  const req = (usuario: number, permissoes: readonly string[], est = m.est): RequisicaoAutorizada => {
    const partes = permissoes.map(partesDaPermissao);
    return {
      headers: { 'idempotency-key': `t0207-rotas-${randomUUID()}` },
      ip: '127.0.0.1',
      sgh: {
        sessao: {
          estabelecimentoAtivo: codigos.get(est),
          rede: '',
          unidadeAtiva: null,
          usuario: { id: String(usuario), login: logins.get(usuario) },
        },
        ability: {
          can: (acao: string, sujeito: string) =>
            partes.some((x) => x.acao === acao && x.sujeito === sujeito),
        },
      },
    } as unknown as RequisicaoAutorizada;
  };
  const executar = (nome: string, entrada: unknown, usuario: number) => {
    const c = m.ctx(usuario);
    return porta.executar(c, nome, entrada, { ...c, chaveIdempotencia: `t0207-rotas-${randomUUID()}` });
  };
  const transferir = (data: string, de: number, para: number, valor: number) =>
    executar(
      'financeiro.lancarMovimento',
      {
        tipo: 'T',
        data,
        contaCredito: para,
        contaDebito: de,
        valor,
        historico: 'TRANSFERENCIA SINTETICA L0207 ROTAS',
        classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
      },
      m.lanca,
    );
  const movimentosDoMes = async (comp: string) =>
    Number(
      (
        await consultar(
          `SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ? AND situacao = 'ativo'
              AND excluido_em IS NULL AND data_movimento BETWEEN ? AND LAST_DAY(?)`,
          [m.est, comp, comp],
        )
      )[0]?.['n'] ?? 0,
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparEventos();
    for (const r of await consultar('SELECT id, codigo FROM estabelecimento WHERE id IN (?, ?)', [
      m.est,
      m.outroEst,
    ]))
      codigos.set(Number(r['id']), String(r['codigo']));
    for (const r of await consultar('SELECT id, login FROM usuario WHERE id IN (?, ?, ?)', [
      m.lanca,
      m.aprova,
      m.restrito,
    ]))
      logins.set(Number(r['id']), String(r['login']));
    // O usuário restrito só consulta a conta B.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pf-rotas' }, (e) =>
      e.inserir(
        `INSERT INTO permissao_conta_bancaria (usuario_id, conta_bancaria_id, estabelecimento_id, pode_consultar,
           pode_movimentar, criado_em) VALUES (?, ?, ?, TRUE, FALSE, ?)`,
        [m.restrito, m.contaB, m.est, new Date()],
      ),
    );
    desligarMapaEstabelecimentos();
    await ligarMapaEstabelecimentos(CLIENTE, m.nucleo);
    rotas = new PeriodoFinanceiroController(porta, { registrar: async () => undefined } as never, m.nucleo);
  }, 180_000);

  afterAll(async () => {
    desligarMapaEstabelecimentos();
    if (m) {
      await limparEventos();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('as leituras devolvem o que o fechamento, o pedido e a decisão deixaram no banco', async () => {
    await transferir(D0, m.contaA, m.contaB, 10);
    await transferir(D1, m.contaA, m.contaB, 77.7);
    await transferir(D2, m.contaB, m.contaA, 20);
    const lanca = req(m.lanca, [LER, CRIAR]);
    expect(await rotas.periodos(lanca)).toEqual([]);
    await executar('financeiro.fecharPeriodo', { competencia: COMP }, m.lanca);

    // GET /financeiro/periodos: as duas competências da cadeia, da mais recente à mais antiga.
    const fechados = await rotas.periodos(lanca);
    expect(
      fechados.map((p) => [p.competencia, p.situacao, p.fechadoPor, p.movimentos, p.pedido, p.reabertoPor]),
    ).toEqual([
      [COMP, 'fechado', logins.get(m.lanca), await movimentosDoMes(COMP), null, null],
      [ANTERIOR, 'fechado', logins.get(m.lanca), await movimentosDoMes(ANTERIOR), null, null],
    ]);
    expect(fechados.every((p) => p.fechadoEm !== null && !Number.isNaN(Date.parse(p.fechadoEm)))).toBe(true);

    // GET /financeiro/periodos/saldo-diario: o saldo de cada dia igual ao gravado, com os valores exatos do dia.
    const dias = await rotas.saldoDiario(String(m.contaA), COMP, FIM, lanca);
    expect(dias.map((d) => [d.data, d.entradas, d.saidas, d.fechado])).toEqual([
      [D1, 0, 77.7, true],
      [D2, 20, 0, true],
    ]);
    const gravados = await consultar(
      `SELECT saldo_anterior, saldo_final FROM saldo_diario_conta
        WHERE conta_bancaria_id = ? AND data_saldo BETWEEN ? AND ? ORDER BY data_saldo`,
      [m.contaA, COMP, FIM],
    );
    expect(dias.map((d) => [d.saldoAnterior, d.saldoFinal])).toEqual(
      gravados.map((r) => [Number(r['saldo_anterior']), Number(r['saldo_final'])]),
    );
    expect(dias[1]!.saldoAnterior).toBe(dias[0]!.saldoFinal);
    // O intervalo é respeitado: só o mês anterior.
    expect(
      (await rotas.saldoDiario(String(m.contaA), ANTERIOR, D0, lanca)).map((d) => [d.data, d.saidas]),
    ).toEqual([[D0, 10]]);

    // O pedido à espera aparece na competência, com quem pediu; a recusa o tira; a autorização mostra os dois nomes.
    await executar('financeiro.pedirReaberturaPeriodo', { competencia: COMP, justificativa: JUST }, m.lanca);
    const comPedido = await rotas.periodos(lanca);
    expect([comPedido[0]!.situacao, comPedido[0]!.pedido, comPedido[1]!.pedido]).toEqual([
      'fechado',
      { por: logins.get(m.lanca), usuario: m.lanca, justificativa: JUST },
      null,
    ]);
    await executar('financeiro.reabrirPeriodo', { competencia: COMP, decisao: 'recusar' }, m.aprova);
    expect((await rotas.periodos(lanca))[0]!.pedido).toBeNull();
    await executar('financeiro.pedirReaberturaPeriodo', { competencia: COMP, justificativa: JUST }, m.lanca);
    await executar('financeiro.reabrirPeriodo', { competencia: COMP, decisao: 'autorizar' }, m.aprova);
    const reaberto = (await rotas.periodos(lanca))[0]!;
    expect([
      reaberto.situacao,
      reaberto.reabertoPor,
      reaberto.autorizadoPor,
      reaberto.justificativa,
      reaberto.pedido,
    ]).toEqual(['reaberto', logins.get(m.lanca), logins.get(m.aprova), JUST, null]);
    expect((await rotas.saldoDiario(String(m.contaA), COMP, FIM, lanca)).map((d) => d.fechado)).toEqual([
      false,
      false,
    ]);

    // GET /financeiro/periodos/eventos: do mais recente ao mais antigo, com quem fez e a justificativa do pedido.
    const eventos = await rotas.eventos(lanca);
    expect(eventos.map((e) => [e.competencia, e.tipo, e.usuario, e.por])).toEqual([
      [COMP, 'reabertura', m.aprova, logins.get(m.aprova)],
      [COMP, 'pedido_reabertura', m.lanca, logins.get(m.lanca)],
      [COMP, 'reabertura_recusada', m.aprova, logins.get(m.aprova)],
      [COMP, 'pedido_reabertura', m.lanca, logins.get(m.lanca)],
      [COMP, 'fechamento', m.lanca, logins.get(m.lanca)],
      [ANTERIOR, 'fechamento', m.lanca, logins.get(m.lanca)],
    ]);
    expect(eventos[1]!.justificativa).toBe(JUST);
    expect(eventos[4]!.movimentos).toBe(await movimentosDoMes(COMP));
  });

  it('saldo diário só de conta do escopo e do estabelecimento da sessão; o outro estabelecimento não vê nada', async () => {
    const lanca = req(m.lanca, [LER]);
    // Conta de outro estabelecimento: não encontrada.
    expect(await resposta(rotas.saldoDiario(String(m.contaOutroEst), COMP, FIM, lanca))).toBe(
      '404:nao-encontrado',
    );
    // Usuário com escopo só na conta B: a conta A não sai; a B, sim (a entrada de 77,70 e a saída de 20).
    const restrito = req(m.restrito, [LER]);
    expect(await resposta(rotas.saldoDiario(String(m.contaA), COMP, FIM, restrito))).toBe(
      '404:nao-encontrado',
    );
    expect(
      (await rotas.saldoDiario(String(m.contaB), COMP, FIM, restrito)).map((d) => [
        d.data,
        d.entradas,
        d.saidas,
      ]),
    ).toEqual([
      [D1, 77.7, 0],
      [D2, 0, 20],
    ]);
    // A sessão no outro estabelecimento: sem período, sem evento, e a conta deste estabelecimento não é dela.
    const outro = req(m.lanca, [LER], m.outroEst);
    expect(await rotas.periodos(outro)).toEqual([]);
    expect(await rotas.eventos(outro)).toEqual([]);
    expect(await resposta(rotas.saldoDiario(String(m.contaA), COMP, FIM, outro))).toBe('404:nao-encontrado');
    // O filtro por estabelecimento está também na própria consulta, sem depender do escopo.
    const direto = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pf-rotas' }, async (l) => [
      (await saldosDiarios(l, m.outroEst, m.contaA, COMP, FIM)).length,
      (await listarPeriodos(l, m.outroEst)).length,
      (await saldosDiarios(l, m.est, m.contaA, COMP, FIM)).length,
    ]);
    expect(direto).toEqual([0, 0, 2]);
    // Entrada inválida recusada antes do banco.
    expect(await resposta(() => rotas.saldoDiario('abc', COMP, FIM, lanca))).toBe('400:entrada-invalida');
    expect(await resposta(() => rotas.saldoDiario(String(m.contaA), '2026-13', FIM, lanca))).toBe(
      '400:entrada-invalida',
    );
  });

  it('gravação pela rota: decidir sem a permissão de parâmetro é 403; sem a configuração, fica em consulta', async () => {
    const antes = await consultar(
      'SELECT COUNT(*) AS n FROM evento_periodo_financeiro WHERE estabelecimento_id = ?',
      [m.est],
    );
    // Quem lança o movimento fecha e pede, mas não decide a reabertura (a funcionalidade confere antes de tudo).
    const lanca = req(m.lanca, [LER, CRIAR]);
    expect(await resposta(rotas.reabrir({ competencia: COMP, decisao: 'autorizar' }, lanca))).toBe(
      '403:sem-permissao',
    );
    // Quem só lê não fecha nem pede.
    const leitor = req(m.aprova, [LER]);
    expect(await resposta(rotas.fechar({ competencia: COMP }, leitor))).toBe('403:sem-permissao');
    expect(await resposta(rotas.pedirReabertura({ competencia: COMP, justificativa: JUST }, leitor))).toBe(
      '403:sem-permissao',
    );
    // Corpo fora do contrato: recusado na rota.
    expect(await resposta(rotas.fechar({ competencia: 'novembro' }, lanca))).toBe('400:entrada-invalida');
    expect(
      await resposta(rotas.reabrir({ competencia: COMP, decisao: 'talvez' }, req(m.aprova, [DECIDIR]))),
    ).toBe('400:entrada-invalida');
    // Sem a configuração das funcionalidades do estabelecimento, a gravação fica em consulta (falha fechada).
    expect(await resposta(rotas.fechar({ competencia: COMP }, lanca))).toBe('403:recurso-desligado');
    const depois = await consultar(
      'SELECT COUNT(*) AS n FROM evento_periodo_financeiro WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(depois[0]?.['n'])).toBe(Number(antes[0]?.['n']));
  });
});
