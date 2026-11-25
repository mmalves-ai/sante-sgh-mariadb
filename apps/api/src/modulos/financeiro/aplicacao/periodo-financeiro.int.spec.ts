// F3.8, 07-FIN linha 85: contrato de efeito do fechamento e da reabertura do período financeiro contra o MariaDB real
// (massa SINTÉTICA "L0207"). Fechar o mês passado com o anterior nunca fechado: os dois fecham em cadeia (quem, quando,
// quantos movimentos, evento de cada um), cada conta ganha um saldo por dia com movimento (valores exatos, encadeados)
// e o resumo do período, com a abertura igual ao saldo inicial da conta mais o movimento anterior. O lançamento e a
// baixa com data até o fim do último mês fechado são recusados e não gravam; o outro estabelecimento fica intocado.
// Reabrir: um usuário pede (justificativa), outro decide; quem pediu não autoriza; a recusa e a autorização viram
// eventos; o novo fechamento regrava os saldos. Concorrência: lançamento e fechamento simultâneos nunca deixam
// movimento num mês fechado fora do saldo.
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
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-pf-${randomUUID()}` });
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const hoje = new Date();
const mesAtras = (n: number) =>
  new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
// O mês passado (pedido), o retrasado (nunca fechado: entra na cadeia) e o atual (em curso).
const COMP = mesAtras(1);
const ANTERIOR = mesAtras(2);
const MES_ATUAL = mesAtras(0);
const D0 = `${ANTERIOR.slice(0, 8)}05`;
const D1 = `${COMP.slice(0, 8)}03`;
const D2 = `${COMP.slice(0, 8)}10`;
const JUST = 'Tarifa do banco lançada fora do mês';
const cent = (v: number) => Math.round(v * 100);

describe.skipIf(SEM_BANCO)('período financeiro: fechar em ordem, travar e reabrir (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pf-02-07' }, (l) => l.consultar(sql, p));
  const limparEventos = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pf-02-07' }, (e) =>
      e.executar('DELETE FROM evento_periodo_financeiro WHERE estabelecimento_id IN (?, ?)', [
        m.est,
        m.outroEst,
      ]),
    );
  const executar = (nome: string, entrada: unknown, usuario = m.lanca) => {
    const c = m.ctx(usuario);
    return porta.executar(c, nome, entrada, op(c));
  };
  const transferir = (data: string, de: number, para: number, valor: number) =>
    executar('financeiro.lancarMovimento', {
      tipo: 'T',
      data,
      contaCredito: para,
      contaDebito: de,
      valor,
      historico: 'TRANSFERENCIA SINTETICA L0207 PERIODO',
      classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
    });
  const pedir = (usuario = m.lanca, justificativa = JUST) =>
    executar('financeiro.pedirReaberturaPeriodo', { competencia: COMP, justificativa }, usuario);
  const decidir = (decisao: 'autorizar' | 'recusar', usuario = m.aprova) =>
    executar('financeiro.reabrirPeriodo', { competencia: COMP, decisao }, usuario);
  const periodo = async (comp = COMP) =>
    (
      await consultar(
        `SELECT id, situacao, fechamento_usuario_id, quantidade_registros, reabertura_usuario_id,
                autorizador_usuario_id, justificativa_reabertura, bloqueia_banco
           FROM periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ?`,
        [m.est, comp],
      )
    )[0];
  const eventos = async (comp = COMP) =>
    (
      await consultar(
        'SELECT tipo, usuario_id FROM evento_periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ? ORDER BY id',
        [m.est, comp],
      )
    ).map((r) => `${String(r['tipo'])}:${Number(r['usuario_id'])}`);
  const dias = async (conta: number, comp = COMP) =>
    (
      await consultar(
        `SELECT data_saldo, saldo_anterior, total_entradas, total_saidas, saldo_final, fechado, operacao
           FROM saldo_diario_conta WHERE conta_bancaria_id = ? AND data_saldo BETWEEN ? AND LAST_DAY(?) ORDER BY data_saldo`,
        [conta, comp, comp],
      )
    ).map((r) => ({
      data: iso(r['data_saldo']),
      anterior: Number(r['saldo_anterior']),
      entradas: Number(r['total_entradas']),
      saidas: Number(r['total_saidas']),
      final: Number(r['saldo_final']),
      fechado: Number(r['fechado']) === 1,
      operacao: String(r['operacao']),
    }));
  const resumo = async (conta: number, comp: string) =>
    (
      await consultar(
        `SELECT s.saldo_inicial, s.total_credito, s.total_debito, s.saldo_final FROM saldo_financeiro_periodo s
           JOIN periodo_financeiro p ON p.id = s.periodo_financeiro_id
          WHERE p.estabelecimento_id = ? AND p.competencia = ? AND s.tipo_referencia = 'conta_bancaria'
            AND s.conta_bancaria_id = ?`,
        [m.est, comp, conta],
      )
    )[0];
  const movimentosDoMes = async (comp = COMP) =>
    Number(
      (
        await consultar(
          `SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ? AND situacao = 'ativo'
              AND excluido_em IS NULL AND data_movimento BETWEEN ? AND LAST_DAY(?)`,
          [m.est, comp, comp],
        )
      )[0]?.['n'] ?? 0,
    );
  /** A abertura esperada, calculada à parte: saldo inicial da conta e o movimento ativo antes da competência. */
  const aberturaEsperada = async (conta: number, comp: string) =>
    Number(
      (
        await consultar(
          `SELECT COALESCE(c.saldo_inicial, 0) + COALESCE((SELECT SUM(CASE WHEN natureza = 'credito' THEN valor ELSE -valor END)
                    FROM movimento_bancario WHERE conta_bancaria_id = c.id AND situacao = 'ativo'
                     AND excluido_em IS NULL AND data_movimento < ?), 0) AS s
             FROM conta_bancaria c WHERE c.id = ?`,
          [comp, conta],
        )
      )[0]?.['s'] ?? NaN,
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparEventos();
  });

  afterAll(async () => {
    if (m) {
      await limparEventos();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('fecha em cadeia o mês anterior nunca fechado, com saldos exatos e abertura = inicial + anterior', async () => {
    await transferir(D0, m.contaA, m.contaB, 10);
    await transferir(D1, m.contaA, m.contaB, 77.7);
    await transferir(D2, m.contaB, m.contaA, 20);
    expect(await periodo(ANTERIOR)).toBeUndefined();
    const r = await executar('financeiro.fecharPeriodo', { competencia: COMP });
    expect([r.resultado['meses'], r.resultado['desde']]).toEqual([2, ANTERIOR]);
    expect(Number(r.resultado['movimentos'])).toBe(await movimentosDoMes());

    for (const comp of [ANTERIOR, COMP]) {
      const p = await periodo(comp);
      expect([p?.['situacao'], Number(p?.['fechamento_usuario_id']), Number(p?.['bloqueia_banco'])]).toEqual([
        'fechado',
        m.lanca,
        1,
      ]);
      expect(Number(p?.['quantidade_registros'])).toBe(await movimentosDoMes(comp));
      expect(await eventos(comp)).toEqual([`fechamento:${m.lanca}`]);
    }

    // Valores exatos do dia: a conta A só teve a saída de 77,70 em D1 e a entrada de 20 em D2.
    const a = await dias(m.contaA);
    expect(a.map((d) => [d.data, d.entradas, d.saidas, d.fechado, d.operacao])).toEqual([
      [D1, 0, 77.7, true, 'inclusao'],
      [D2, 20, 0, true, 'inclusao'],
    ]);
    const abertura = await aberturaEsperada(m.contaA, COMP);
    expect(cent(a[0]!.anterior)).toBe(cent(abertura));
    expect(cent(a[0]!.final)).toBe(cent(abertura - 77.7));
    expect(a[1]!.anterior).toBe(a[0]!.final);
    expect(cent(a[1]!.final)).toBe(cent(abertura - 77.7 + 20));
    // O resumo do mês e o encadeamento com o mês anterior (o final de um é a abertura do outro).
    const rc = await resumo(m.contaA, COMP);
    const ra = await resumo(m.contaA, ANTERIOR);
    expect([cent(Number(rc?.['saldo_inicial'])), cent(Number(rc?.['saldo_final']))]).toEqual([
      cent(abertura),
      cent(abertura - 57.7),
    ]);
    expect([Number(rc?.['total_credito']), Number(rc?.['total_debito'])]).toEqual([20, 77.7]);
    expect(cent(Number(ra?.['saldo_final']))).toBe(cent(abertura));
    expect(cent(Number(ra?.['saldo_inicial']))).toBe(cent(await aberturaEsperada(m.contaA, ANTERIOR)));
    expect(cent(Number(ra?.['saldo_inicial']) - 10)).toBe(cent(abertura));

    // O outro estabelecimento fica intocado: sem período, sem saldo e sem evento.
    const outro = await consultar(
      `SELECT (SELECT COUNT(*) FROM periodo_financeiro WHERE estabelecimento_id = ?) AS p,
              (SELECT COUNT(*) FROM saldo_diario_conta WHERE conta_bancaria_id = ?) AS s,
              (SELECT COUNT(*) FROM evento_periodo_financeiro WHERE estabelecimento_id = ?) AS e`,
      [m.outroEst, m.contaOutroEst, m.outroEst],
    );
    expect([Number(outro[0]?.['p']), Number(outro[0]?.['s']), Number(outro[0]?.['e'])]).toEqual([0, 0, 0]);
  });

  it('trava toda data até o fim do último mês fechado: movimento e baixa recusados, nada gravado', async () => {
    const antes = [await movimentosDoMes(ANTERIOR), await movimentosDoMes()];
    expect(await codigoDaGravacao(transferir(D1, m.contaA, m.contaB, 5))).toBe('periodo-fechado');
    expect(await codigoDaGravacao(transferir(D0, m.contaA, m.contaB, 5))).toBe('periodo-fechado');
    expect(
      await codigoDaGravacao(
        executar('financeiro.baixarTitulo', {
          cenario: 'pagar',
          // A versão é o carimbo de concorrência (texto) ou nula; a entrada tem de ser válida para chegar à trava.
          titulos: [{ titulo: 999_999_999, versao: null }],
          conta: m.contaA,
          dataPagamento: D0,
          formaPagamento: 1,
          porBordero: true,
        }),
      ),
    ).toBe('periodo-fechado');
    // A baixa do título a receber com a data do recebimento no mês fechado: a mesma trava, antes de ler o título.
    expect(
      await codigoDaGravacao(
        executar('financeiro.baixarTitulo', {
          cenario: 'receber',
          titulo: 999_999_999,
          versao: null,
          conta: m.contaA,
          dataRecebimento: D1,
          valorRecebido: 5,
          formaPagamento: 1,
          motivo: 'RECEBIMENTO SINTETICO L0207',
        }),
      ),
    ).toBe('periodo-fechado');
    // As gravações diretas do adiantamento (saída, compensação e devolução) passam pela mesma trava, antes de tudo.
    const trilha = {
      estabelecimento: null,
      usuario: null,
      acao: 'operacao' as const,
      entidade: 'adiantamento',
      entidadeId: 0,
      correlacao: null,
    };
    const gravar = (f: Parameters<PortaFinanceiroPropria['gravarSgh']>[2]) =>
      codigoDaGravacao(porta.gravarSgh(op(m.ctx(m.paga)), trilha, f));
    const escopo = [m.contaA, m.contaB];
    expect(
      await gravar((g) =>
        g.pagarAdiantamento({ adiantamento: 999_999_999, data: D1, usuario: 'x', contasEscopo: escopo }),
      ),
    ).toBe('periodo-fechado');
    expect(
      await gravar((g) =>
        g.compensarAdiantamento({
          adiantamento: 999_999_999,
          parcela: 999_999_999,
          valor: 5,
          data: D0,
          usuario: 'x',
        }),
      ),
    ).toBe('periodo-fechado');
    expect(
      await gravar((g) =>
        g.devolverAdiantamento({
          adiantamento: 999_999_999,
          conta: m.contaA,
          valor: 5,
          data: D1,
          motivo: 'Sobra devolvida',
          usuario: 'x',
          contasEscopo: escopo,
        }),
      ),
    ).toBe('periodo-fechado');
    // O crédito não identificado com data no mês fechado não é atribuído a título: a trava vem pela data do crédito,
    // depois de lido o crédito (por isso um crédito de verdade na massa); o crédito segue pendente e nada é recebido.
    const credito = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pf-02-07' }, (e) =>
      e.inserir(
        `INSERT INTO credito_nao_identificado (estabelecimento_id, conta_bancaria_id, data_credito, historico_extrato,
           valor, criado_em) VALUES (?, ?, ?, 'CREDITO SINTETICO L0207 PERIODO', 12.34, ?)`,
        [m.est, m.contaA, D1, new Date()],
      ),
    );
    const recebimentos = async () =>
      Number(
        (await consultar('SELECT COUNT(*) AS n FROM recebimento WHERE estabelecimento_id = ?', [m.est]))[0]?.[
          'n'
        ] ?? 0,
      );
    const recebidosAntes = await recebimentos();
    expect(
      await gravar((g) =>
        g.atribuirCredito({
          credito,
          tituloReceber: 999_999_999,
          observacao: '',
          usuario: 'x',
          contasEscopo: escopo,
        }),
      ),
    ).toBe('periodo-fechado');
    const [cr] = await consultar(
      'SELECT situacao, titulo_receber_id, identificado_em FROM credito_nao_identificado WHERE id = ?',
      [credito],
    );
    expect([cr?.['situacao'], cr?.['titulo_receber_id'], cr?.['identificado_em']]).toEqual([
      'pendente',
      null,
      null,
    ]);
    expect(await recebimentos()).toBe(recebidosAntes);
    // A recusa é da data: o mesmo crédito, datado no mês em curso, passa da trava e só para no título que não existe.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pf-02-07' }, (e) =>
      e.executar('UPDATE credito_nao_identificado SET data_credito = ? WHERE id = ?', [MES_ATUAL, credito]),
    );
    expect(
      await gravar((g) =>
        g.atribuirCredito({
          credito,
          tituloReceber: 999_999_999,
          observacao: '',
          usuario: 'x',
          contasEscopo: escopo,
        }),
      ),
    ).toBe('titulo-inexistente');
    expect([await movimentosDoMes(ANTERIOR), await movimentosDoMes()]).toEqual(antes);
    for (const comp of [COMP, ANTERIOR])
      expect(await codigoDaGravacao(executar('financeiro.fecharPeriodo', { competencia: comp }))).toBe(
        'periodo-ja-fechado',
      );
    expect(await codigoDaGravacao(executar('financeiro.fecharPeriodo', { competencia: MES_ATUAL }))).toBe(
      'periodo-em-curso',
    );
    const atual = await consultar(
      'SELECT COUNT(*) AS n FROM periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ?',
      [m.est, MES_ATUAL],
    );
    expect(Number(atual[0]?.['n'])).toBe(0);
  });

  it('reabertura: um pede, outro decide; quem pediu não autoriza; cada passo vira evento', async () => {
    expect(
      await codigoDaGravacao(
        executar('financeiro.pedirReaberturaPeriodo', { competencia: ANTERIOR, justificativa: JUST }),
      ),
    ).toBe('periodo-posterior-fechado');
    expect(await codigoDaGravacao(pedir(m.lanca, 'erro'))).toBe('justificativa-obrigatoria');
    expect(await codigoDaGravacao(decidir('autorizar'))).toBe('sem-pedido-reabertura');
    await pedir();
    expect(await codigoDaGravacao(pedir())).toBe('pedido-reabertura-pendente');
    expect(await codigoDaGravacao(decidir('autorizar', m.lanca))).toBe('autorizador-igual-solicitante');
    expect((await periodo())?.['situacao']).toBe('fechado');
    await decidir('recusar');
    expect((await periodo())?.['situacao']).toBe('fechado');

    await pedir();
    await decidir('autorizar');
    const p = await periodo();
    expect([
      p?.['situacao'],
      Number(p?.['reabertura_usuario_id']),
      Number(p?.['autorizador_usuario_id']),
      p?.['justificativa_reabertura'],
      Number(p?.['bloqueia_banco']),
    ]).toEqual(['reaberto', m.lanca, m.aprova, JUST, 0]);
    expect((await dias(m.contaA)).every((d) => !d.fechado)).toBe(true);
    // Reaberto só o último: o anterior continua travado.
    expect(await codigoDaGravacao(transferir(D0, m.contaA, m.contaB, 5))).toBe('periodo-fechado');

    const antes = (await dias(m.contaA)).find((d) => d.data === D1)!;
    await transferir(D1, m.contaA, m.contaB, 5);
    const r = await executar('financeiro.fecharPeriodo', { competencia: COMP });
    expect(r.resultado['meses']).toBe(1);
    const depois = (await dias(m.contaA)).find((d) => d.data === D1)!;
    expect(cent(depois.saidas - antes.saidas)).toBe(500);
    expect([depois.fechado, depois.operacao]).toEqual([true, 'alteracao']);
    expect((await periodo())?.['situacao']).toBe('fechado');
    expect(await eventos()).toEqual([
      `fechamento:${m.lanca}`,
      `pedido_reabertura:${m.lanca}`,
      `reabertura_recusada:${m.aprova}`,
      `pedido_reabertura:${m.lanca}`,
      `reabertura:${m.aprova}`,
      `fechamento:${m.lanca}`,
    ]);
  });

  it('lançamento e fechamento simultâneos: nenhum movimento fica no mês fechado fora do saldo', async () => {
    await pedir();
    await decidir('autorizar');
    const [lanc] = await Promise.allSettled([
      transferir(D2, m.contaA, m.contaB, 3.33),
      executar('financeiro.fecharPeriodo', { competencia: COMP }),
    ]);
    if (lanc.status === 'rejected')
      expect(await codigoDaGravacao(Promise.reject(lanc.reason))).toBe('periodo-fechado');
    const p = await periodo();
    expect(p?.['situacao']).toBe('fechado');
    expect(Number(p?.['quantidade_registros'])).toBe(await movimentosDoMes());
    const [soma] = await consultar(
      `SELECT COALESCE(SUM(valor), 0) AS s FROM movimento_bancario WHERE conta_bancaria_id = ? AND situacao = 'ativo'
          AND excluido_em IS NULL AND natureza = 'debito' AND data_movimento = ?`,
      [m.contaA, D2],
    );
    const dia = (await dias(m.contaA)).find((d) => d.data === D2)!;
    expect(cent(dia.saidas)).toBe(cent(Number(soma?.['s'])));
  });
});
