// F3.8, 07-FIN linha 76: contrato de efeito da baixa pelo demonstrativo de pagamento e da renegociação de títulos a
// receber contra o MariaDB real (massa SINTÉTICA "L0207"; nenhuma pessoa real).
// Demonstrativo: três linhas com item da conta (uma paga inteira, uma com glosa parcial, uma que quita o outro título) e
// uma linha sem item. A baixa grava UM crédito na conta, um recebimento por título com o meio "demonstrativo", uma
// linha por item (apresentado, recebido, glosa), soma o recebido na parcela e no título e deixa a glosa em aberto; a
// linha sem item fica de fora, contada. Repetir com outra chave é recusado; com a mesma chave devolve o já gravado.
// Renegociação: dois títulos do mesmo convênio (um recebido em parte) viram um acordo com juros, multa e desconto
// rateados e um título novo de três parcelas; os originais ficam renegociados, com o histórico. Desfazer devolve o
// saldo às parcelas originais e cancela o título novo, sem apagar nada; com recebimento no acordo é recusado.
// Desfazer a baixa do demonstrativo: os recebimentos ficam estornados (motivo, quem, quando), um débito contrário sai da
// conta ligado ao crédito da baixa, parcela e título recuperam o saldo, as linhas por item ficam, e o demonstrativo pode
// ser baixado de novo. Particular: o título do paciente entra em acordo, e as leituras por devedor (convênio, paciente,
// cliente) devolvem o saldo real das parcelas (a parcela protestada fica de fora da lista e do acordo).
import { randomUUID } from 'node:crypto';
import type { Executor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demonstrativosImportados,
  OPERACOES_BAIXA_DEMONSTRATIVO,
  previaDaBaixa,
} from '../baixa-demonstrativo-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  acordosDoEstabelecimento,
  detalheDoAcordo,
  devedoresComSaldoAberto,
  OPERACOES_RENEGOCIACAO,
  titulosRenegociaveisDoDevedor,
} from '../renegociacao-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const HOJE = new Date().toISOString().slice(0, 10);
const EM_30_DIAS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const OPERACOES = { ...OPERACOES_RENEGOCIACAO, ...OPERACOES_BAIXA_DEMONSTRATIVO };
const n = (v: unknown) => Number(v);

describe.skipIf(SEM_BANCO)('baixa pelo demonstrativo e renegociação a receber (MariaDB)', () => {
  let m: MassaFinanceiro;
  let executor: Executor;
  const consultar = (sql: string, p: unknown[] = []) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f38-05' }, (l) => l.consultar(sql, p));
  const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f38-05' }, fn) as Promise<T>;
  const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f38-05' }, fn) as Promise<T>;
  const rodar = (
    op: keyof typeof OPERACOES,
    entrada: unknown,
    o: { usuario?: number; chave?: string; est?: number } = {},
  ) =>
    executor.executar(OPERACOES[op] as never, CLIENTE, entrada, {
      ...m.ctx(o.usuario ?? m.lanca, o.est ?? m.est),
      chaveIdempotencia: o.chave ?? `t-f38-05-${randomUUID()}`,
    });

  beforeAll(async () => {
    m = await montarMassa();
    executor = m.nucleo.criarExecutor();
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('demonstrativo: uma baixa por título com o recebido e a glosa por item; repetir é recusado', async () => {
    const porta = new PortaFinanceiroPropria(m.nucleo);
    const c = m.ctx(m.lanca);
    const titulo = async (contas: readonly number[], documento: number) =>
      n(
        (
          await porta.executar(
            c,
            'financeiro.criarTituloReceber',
            {
              contas: contas.map((conta) => ({ conta, versao: null })),
              vencimento: EM_30_DIAS,
              documento,
              referente: '',
            },
            { ...c, chaveIdempotencia: `t-f38-05-${randomUUID()}` },
          )
        ).resultado['titulo'],
      );
    const [c0, c1, c2] = m.contasHospitalares as [number, number, number];
    // Externas: 100,10 + 200,20 = 300,30 num título; internação: 1.000,55 no outro.
    const t1 = await titulo([c0, c1], 938_051);
    const t2 = await titulo([c2], 938_052);
    const { demonstrativo, cancelado, itens } = await escrever<{
      demonstrativo: number;
      cancelado: number;
      itens: number[];
    }>(async (e) => {
      const agora = new Date();
      const porCodigo = async (tabela: string, codigo: string, colunas: string, valores: unknown[]) =>
        (await e.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo]))?.id ??
        (await e.inserir(
          `INSERT INTO ${tabela} (codigo, ${colunas}, criado_em) VALUES (?, ${valores.map(() => '?').join(', ')}, ?)`,
          [codigo, ...valores, agora],
        ));
      const grupo = await porCodigo('grupo_faturamento', 'L0207-GF', 'descricao, tipo_grupo', [
        'GRUPO FAT L0207',
        'servico_hospitalar',
      ]);
      const fat = await porCodigo(
        'item_faturavel',
        'L0207-IF',
        'descricao, tipo_item, grupo_faturamento_id',
        ['ITEM L0207', 'taxa', grupo],
      );
      const item = (conta: number, total: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, criado_em) VALUES (?, 1, ?, ?, 1, ?, ?, ?)`,
          [conta, fat, agora, total, total, agora],
        );
      const ids = [await item(c0, 100.1), await item(c1, 200.2), await item(c2, 1000.55)];
      const cabecalho = (numero: string, situacao: string) =>
        e.inserir(
          `INSERT INTO demonstrativo_analise_conta (estabelecimento_id, fonte_pagadora_id, numero_demonstrativo,
             data_emissao, valor_informado, valor_liberado, valor_glosa, situacao, criado_em)
           VALUES (?, ?, ?, ?, 1340.85, 1290.85, 50, ?, ?)`,
          [m.est, m.convenio, numero, HOJE, situacao, agora],
        );
      const d = await cabecalho(`${P}-D1`, 'importado');
      const linha = (
        seq: number,
        itemConta: number | null,
        informado: number,
        liberado: number,
        glosa: number,
      ) =>
        e.inserir(
          `INSERT INTO demonstrativo_analise_conta_item (demonstrativo_analise_conta_id, sequencia,
             conta_hospitalar_item_id, numero_guia_prestador, codigo_procedimento, valor_informado, valor_processado,
             valor_liberado, valor_glosa, criado_em) VALUES (?, ?, ?, ?, '10101012', ?, ?, ?, ?, ?)`,
          [d, seq, itemConta, `${P}-G${seq}`, informado, informado, liberado, glosa, agora],
        );
      await linha(1, ids[0]!, 100.1, 100.1, 0);
      await linha(2, ids[1]!, 200.2, 150.2, 50);
      await linha(3, ids[2]!, 1000.55, 1000.55, 0);
      await linha(4, null, 40, 40, 0);
      return { demonstrativo: d, cancelado: await cabecalho(`${P}-D2`, 'cancelado'), itens: ids };
    });

    // A prévia (sem gravar) diz o que cada título recebe e o que fica de fora.
    const lista = await ler<Awaited<ReturnType<typeof demonstrativosImportados>>>((l) =>
      demonstrativosImportados(l, m.est),
    );
    expect(lista.map((x) => [x.numero, x.baixado, x.linhas])).toEqual([[`${P}-D1`, false, 4]]);
    const previa = await ler<Awaited<ReturnType<typeof previaDaBaixa>>>((l) =>
      previaDaBaixa(l, m.est, demonstrativo),
    );
    expect(previa.impedimento).toBeNull();
    expect(previa.plano).toMatchObject({
      totalRecebido: 1250.85,
      totalGlosa: 50,
      linhasSemTitulo: 1,
      valorSemTitulo: 40,
    });
    expect(
      previa.plano?.titulos.map((x) => [x.titulo, x.recebido, x.glosa, x.saldoRestante, x.quita]),
    ).toEqual([
      [t1, 250.3, 50, 50, false],
      [t2, 1000.55, 0, 0, true],
    ]);

    // Recusas antes de gravar: demonstrativo cancelado, conta de outro estabelecimento.
    const entrada = { demonstrativo, conta: m.contaA, dataRecebimento: HOJE };
    expect(
      await codigoDaGravacao(
        rodar('financeiro.baixarDemonstrativoPagamento', { ...entrada, demonstrativo: cancelado }),
      ),
    ).toBe('demonstrativo-cancelado');
    expect(
      await codigoDaGravacao(
        rodar('financeiro.baixarDemonstrativoPagamento', { ...entrada, conta: m.contaOutroEst }),
      ),
    ).not.toBe('gravou');
    expect(
      n(
        (await consultar('SELECT COUNT(*) AS q FROM recebimento WHERE estabelecimento_id = ?', [m.est]))[0]?.[
          'q'
        ],
      ),
    ).toBe(0);

    const chave = `t-f38-05-${randomUUID()}`;
    const r = await rodar('financeiro.baixarDemonstrativoPagamento', entrada, { chave });
    expect(r.repetida).toBe(false);
    expect(r.trilha).not.toBeNull();
    expect(r.resultado).toMatchObject({
      titulos: 2,
      itens: 3,
      recebido: 1250.85,
      glosa: 50,
      linhasSemTitulo: 1,
    });

    const recebimentos = await consultar(
      `SELECT r.id, p.titulo_receber_id AS titulo, r.valor_recebido, r.valor_glosa, r.meio_baixa, r.numero_documento,
              r.conta_bancaria_id, r.movimento_bancario_id, r.situacao
         FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
        WHERE r.estabelecimento_id = ? ORDER BY p.titulo_receber_id`,
      [m.est],
    );
    expect(
      recebimentos.map((x) => [
        n(x['titulo']),
        n(x['valor_recebido']),
        n(x['valor_glosa']),
        x['meio_baixa'],
        x['numero_documento'],
        n(x['conta_bancaria_id']),
        x['situacao'],
      ]),
    ).toEqual([
      [t1, 250.3, 50, 'demonstrativo', `${P}-D1`, m.contaA, 'efetivado'],
      [t2, 1000.55, 0, 'demonstrativo', `${P}-D1`, m.contaA, 'efetivado'],
    ]);
    // Um crédito só na conta, pelo total pago, ligado aos dois recebimentos.
    const movimentos = await consultar(
      'SELECT id, valor, natureza, conta_bancaria_id FROM movimento_bancario WHERE estabelecimento_id = ? AND numero_documento = ?',
      [m.est, `${P}-D1`],
    );
    expect(movimentos.map((x) => [n(x['valor']), x['natureza'], n(x['conta_bancaria_id'])])).toEqual([
      [1250.85, 'credito', m.contaA],
    ]);
    expect(new Set(recebimentos.map((x) => n(x['movimento_bancario_id'])))).toEqual(
      new Set([n(movimentos[0]?.['id'])]),
    );
    // O recebido e a glosa por item da conta.
    const porItem = await consultar(
      `SELECT i.conta_hospitalar_item_id AS item, i.valor_apresentado, i.valor_recebido, i.valor_glosa, i.situacao
         FROM recebimento_item_conta i JOIN recebimento r ON r.id = i.recebimento_id
        WHERE r.estabelecimento_id = ? ORDER BY i.conta_hospitalar_item_id`,
      [m.est],
    );
    expect(
      porItem.map((x) => [
        n(x['item']),
        n(x['valor_apresentado']),
        n(x['valor_recebido']),
        n(x['valor_glosa']),
        x['situacao'],
      ]),
    ).toEqual([
      [itens[0], 100.1, 100.1, 0, 'recebido'],
      [itens[1], 200.2, 150.2, 50, 'parcial'],
      [itens[2], 1000.55, 1000.55, 0, 'recebido'],
    ]);
    // A parcela e o título somam o recebido; a glosa fica em aberto (saldo 50,00) até ser aceita ou recorrida.
    const titulos = await consultar(
      `SELECT t.id, t.situacao, t.valor_recebido, p.situacao AS parcela, p.saldo, p.valor_recebido AS recebido_parcela,
              p.quitada_em IS NOT NULL AS quitada
         FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id WHERE t.id IN (?, ?) ORDER BY t.id`,
      [t1, t2],
    );
    expect(
      titulos.map((x) => [
        x['situacao'],
        n(x['valor_recebido']),
        x['parcela'],
        n(x['saldo']),
        n(x['recebido_parcela']),
        n(x['quitada']),
      ]),
    ).toEqual([
      ['recebido_parcial', 250.3, 'parcial', 50, 250.3, 0],
      ['recebido', 1000.55, 'recebida', 0, 1000.55, 1],
    ]);

    // A mesma chave devolve o já gravado; outra chave é recusada (o demonstrativo já foi baixado); nada dobra.
    expect((await rodar('financeiro.baixarDemonstrativoPagamento', entrada, { chave })).repetida).toBe(true);
    expect(await codigoDaGravacao(rodar('financeiro.baixarDemonstrativoPagamento', entrada))).toBe(
      'demonstrativo-ja-baixado',
    );
    expect(
      n(
        (await consultar('SELECT COUNT(*) AS q FROM recebimento WHERE estabelecimento_id = ?', [m.est]))[0]?.[
          'q'
        ],
      ),
    ).toBe(2);
    const depois = await ler<Awaited<ReturnType<typeof previaDaBaixa>>>((l) =>
      previaDaBaixa(l, m.est, demonstrativo),
    );
    expect(depois.impedimento?.codigo).toBe('demonstrativo-ja-baixado');

    // Desfazer a baixa: motivo obrigatório; outro estabelecimento não alcança; quem não movimenta a conta não desfaz.
    const desfazer = (motivo: string, o: { usuario?: number; est?: number; chave?: string } = {}) =>
      rodar('financeiro.desfazerBaixaDemonstrativo', { demonstrativo, motivo }, o);
    expect(await codigoDaGravacao(desfazer('ok'))).toBe('motivo-obrigatorio');
    expect(await codigoDaGravacao(desfazer('Outro estabelecimento', { est: m.outroEst }))).toBe(
      'demonstrativo-inexistente',
    );
    const u = await desfazer('Crédito lançado na conta errada');
    expect(u.trilha).not.toBeNull();
    expect(u.resultado).toMatchObject({ recebimentos: 2, titulos: 2, estornado: 1250.85, debitos: 1 });
    const estornados = await consultar(
      `SELECT situacao, estornado_em IS NOT NULL AS quando, estorno_usuario_id, motivo_estorno, valor_recebido
         FROM recebimento WHERE estabelecimento_id = ? ORDER BY id`,
      [m.est],
    );
    expect(
      estornados.map((x) => [
        x['situacao'],
        n(x['quando']),
        n(x['estorno_usuario_id']),
        x['motivo_estorno'],
        n(x['valor_recebido']),
      ]),
    ).toEqual([
      ['estornado', 1, m.lanca, 'Crédito lançado na conta errada', 250.3],
      ['estornado', 1, m.lanca, 'Crédito lançado na conta errada', 1000.55],
    ]);
    // O crédito da baixa fica no dia dele; um débito contrário, de origem estorno, sai da mesma conta e aponta para ele.
    const contrarios = await consultar(
      `SELECT natureza, tipo_origem, valor, conta_bancaria_id, situacao, estornado_movimento_bancario_id AS de
         FROM movimento_bancario WHERE estabelecimento_id = ? AND numero_documento = ? ORDER BY id`,
      [m.est, `${P}-D1`],
    );
    expect(
      contrarios.map((x) => [
        x['natureza'],
        x['tipo_origem'],
        n(x['valor']),
        n(x['conta_bancaria_id']),
        x['situacao'],
        x['de'] === null ? null : n(x['de']),
      ]),
    ).toEqual([
      ['credito', 'manual', 1250.85, m.contaA, 'ativo', null],
      ['debito', 'estorno', 1250.85, m.contaA, 'ativo', n(movimentos[0]?.['id'])],
    ]);
    // A parcela e o título recuperam o saldo; as linhas por item da conta ficam no histórico.
    const reabertos = await consultar(
      `SELECT t.situacao, t.valor_recebido, p.situacao AS parcela, p.saldo, p.valor_recebido AS recebido_parcela,
              p.quitada_em IS NOT NULL AS quitada
         FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id WHERE t.id IN (?, ?) ORDER BY t.id`,
      [t1, t2],
    );
    expect(
      reabertos.map((x) => [
        x['situacao'],
        n(x['valor_recebido']),
        x['parcela'],
        n(x['saldo']),
        n(x['recebido_parcela']),
        n(x['quitada']),
      ]),
    ).toEqual([
      ['aberto', 0, 'aberta', 300.3, 0, 0],
      ['aberto', 0, 'aberta', 1000.55, 0, 0],
    ]);
    expect(
      n(
        (
          await consultar(
            `SELECT COUNT(*) AS q FROM recebimento_item_conta i JOIN recebimento r ON r.id = i.recebimento_id
              WHERE r.estabelecimento_id = ?`,
            [m.est],
          )
        )[0]?.['q'],
      ),
    ).toBe(3);
    // Desfeita, não há o que desfazer de novo; o demonstrativo volta à lista como não baixado e é baixado outra vez,
    // agora na conta certa: ficam os dois recebimentos estornados e os dois novos.
    expect(await codigoDaGravacao(desfazer('Repetindo o pedido'))).toBe('demonstrativo-nao-baixado');
    expect(
      (
        await ler<Awaited<ReturnType<typeof demonstrativosImportados>>>((l) =>
          demonstrativosImportados(l, m.est),
        )
      ).map((x) => x.baixado),
    ).toEqual([false]);
    const outra = await rodar('financeiro.baixarDemonstrativoPagamento', { ...entrada, conta: m.contaB });
    expect(outra.resultado).toMatchObject({ titulos: 2, recebido: 1250.85, glosa: 50 });
    const situacoes = await consultar(
      `SELECT situacao, conta_bancaria_id, COUNT(*) AS q FROM recebimento WHERE estabelecimento_id = ?
        GROUP BY situacao, conta_bancaria_id ORDER BY situacao`,
      [m.est],
    );
    expect(situacoes.map((x) => [x['situacao'], n(x['conta_bancaria_id']), n(x['q'])])).toEqual([
      ['efetivado', m.contaB, 2],
      ['estornado', m.contaA, 2],
    ]);
    // Com o crédito conciliado com o extrato, a baixa não se desfaz mais.
    await escrever(async (e) => {
      const c = await e.inserir(
        `INSERT INTO conciliacao_bancaria (estabelecimento_id, conta_bancaria_id, periodo_inicio, periodo_fim,
           saldo_extrato, saldo_sistema, criado_em) VALUES (?, ?, ?, ?, 0, 0, ?)`,
        [m.est, m.contaB, HOJE, HOJE, new Date()],
      );
      await e.executar(
        `UPDATE movimento_bancario SET conciliado = TRUE, conciliacao_bancaria_id = ?
          WHERE estabelecimento_id = ? AND numero_documento = ? AND conta_bancaria_id = ? AND natureza = 'credito'`,
        [c, m.est, `${P}-D1`, m.contaB],
      );
    });
    expect(await codigoDaGravacao(desfazer('Tentativa depois da conciliação'))).toBe('credito-conciliado');
    console.info(`[f38-05] demonstrativo: ${recebimentos.length} recebimento(s), ${porItem.length} item(ns)`);
  }, 120_000);

  it('renegociação: acordo com título novo parcelado e histórico; desfazer devolve o saldo sem apagar', async () => {
    const tituloAvulso = (
      documento: string,
      valor: number,
      recebido: number,
      devedor: { convenio?: number; cliente?: number; paciente?: number },
    ) =>
      escrever<number>(async (e) => {
        const agora = new Date();
        const tipoDoc = await e.uma<{ id: number }>(
          "SELECT id FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('receber','ambos') ORDER BY id LIMIT 1",
          [],
        );
        const nat = await e.uma<{ id: number }>(
          "SELECT id FROM natureza_financeira WHERE codigo = '9207.2.1'",
          [],
        );
        const t = await e.inserir(
          `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, cliente_financeiro_id,
             paciente_id, tipo_origem, tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento,
             valor_bruto, valor_liquido, valor_recebido, situacao, natureza_financeira_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'avulso', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.est,
            `${P}-N${documento}`,
            devedor.convenio ? 'fonte_pagadora' : devedor.paciente ? 'paciente' : 'cliente',
            devedor.convenio ?? null,
            devedor.cliente ?? null,
            devedor.paciente ?? null,
            n(tipoDoc?.id),
            documento,
            HOJE,
            HOJE,
            valor,
            valor,
            recebido,
            recebido > 0 ? 'recebido_parcial' : 'aberto',
            n(nat?.id),
            agora,
          ],
        );
        await e.inserir(
          `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor,
             valor_recebido, saldo, situacao, criado_em) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          [t, HOJE, HOJE, valor, recebido, valor - recebido, recebido > 0 ? 'parcial' : 'aberta', agora],
        );
        return t;
      });
    const cliente = await escrever<number>(async (e) => {
      const f = await e.uma<{ cnpj: string }>('SELECT cnpj FROM empresa_fornecedora WHERE id = ?', [
        m.fornecedor,
      ]);
      return (
        (await e.uma<{ id: number }>('SELECT id FROM cliente_financeiro WHERE cnpj = ?', [f?.cnpj]))?.id ??
        (await e.inserir(
          "INSERT INTO cliente_financeiro (tipo_pessoa, cnpj, nome, criado_em) VALUES ('juridica', ?, 'CLIENTE SINTETICO L0207', ?)",
          [f?.cnpj, new Date()],
        ))
      );
    });
    const ra = await tituloAvulso('938061', 600, 0, { convenio: m.convenio });
    const rb = await tituloAvulso('938062', 400, 100, { convenio: m.convenio });
    const rc = await tituloAvulso('938063', 80, 0, { cliente });
    // Particular: o título do paciente tem uma parcela em aberto (250,00) e outra protestada (70,00), fora do acordo.
    const paciente = n(
      (
        await consultar('SELECT paciente_id FROM conta_hospitalar WHERE id = ?', [m.contasHospitalares[0]])
      )[0]?.['paciente_id'],
    );
    const rp = await tituloAvulso('938064', 250, 0, { paciente });
    await escrever(async (e) => {
      await e.executar(
        'UPDATE titulo_receber SET valor_bruto = 320, valor_liquido = 320, quantidade_parcelas = 2 WHERE id = ?',
        [rp],
      );
      await e.inserir(
        `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor,
           valor_recebido, saldo, situacao, criado_em) VALUES (?, 2, ?, ?, 70, 0, 70, 'protestada', ?)`,
        [rp, HOJE, HOJE, new Date()],
      );
    });

    // A escolha por devedor: quem deve, por tipo e por nome, e todos os títulos dele com o saldo real das parcelas.
    type Devedores = Awaited<ReturnType<typeof devedoresComSaldoAberto>>;
    type DoDevedor = Awaited<ReturnType<typeof titulosRenegociaveisDoDevedor>>;
    const particulares = await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.est, 'E', ''));
    expect(particulares.map((x) => [x.id, x.titulos, x.saldo])).toEqual([[paciente, 1, 250]]);
    expect(
      (await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.est, 'O', ''))).map((x) => [
        x.id,
        x.titulos,
        x.saldo,
      ]),
    ).toEqual([[cliente, 1, 80]]);
    const convenios = await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.est, 'C', 'SINTETICA L0207'));
    expect(convenios.map((x) => x.id)).toEqual([m.convenio]);
    expect(
      await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.est, 'C', 'NOME QUE NAO EXISTE')),
    ).toEqual([]);
    expect(await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.outroEst, 'E', ''))).toEqual([]);
    const doPaciente = await ler<DoDevedor>((l) => titulosRenegociaveisDoDevedor(l, m.est, 'E', paciente));
    expect(doPaciente.devedor).toBe(`paciente:${paciente}`);
    expect(
      doPaciente.titulos.map((x) => [x.id, x.valor, x.saldo, x.parcelas.map((p) => [p.saldo, p.situacao])]),
    ).toEqual([[rp, 320, 250, [[250, 'aberta']]]]);
    const doConvenio = await ler<DoDevedor>((l) => titulosRenegociaveisDoDevedor(l, m.est, 'C', m.convenio));
    expect(
      doConvenio.titulos.filter((x) => [ra, rb].includes(x.id)).map((x) => [x.id, x.recebido, x.saldo]),
    ).toEqual([
      [ra, 0, 600],
      [rb, 100, 300],
    ]);
    expect(await ler<DoDevedor>((l) => titulosRenegociaveisDoDevedor(l, m.outroEst, 'E', paciente))).toEqual({
      devedor: `paciente:${paciente}`,
      titulos: [],
    });

    // O acordo do particular leva o saldo que a lista mostrou (250,00) e deixa a parcela protestada onde estava.
    const rpAcordo = await rodar('financeiro.renegociarTitulosReceber', {
      titulos: [rp],
      quantidadeParcelas: 2,
      primeiroVencimento: EM_30_DIAS,
    });
    expect(rpAcordo.resultado).toMatchObject({ valorOriginal: 250, valorRenegociado: 250, parcelas: 2 });
    const [doParticular] = await consultar(
      `SELECT r.paciente_id, r.fonte_pagadora_id, r.devedor_nome <> '' AS com_nome, t.tipo_devedor,
              t.paciente_id AS paciente_titulo, o.situacao AS original,
              (SELECT GROUP_CONCAT(CONCAT(p.situacao, ':', p.saldo) ORDER BY p.sequencia) FROM parcela_receber p
                WHERE p.titulo_receber_id = o.id) AS parcelas
         FROM renegociacao r JOIN titulo_receber t ON t.id = r.novo_titulo_receber_id
         JOIN titulo_receber o ON o.id = ? WHERE r.id = ?`,
      [rp, n(rpAcordo.resultado['renegociacao'])],
    );
    expect([
      n(doParticular?.['paciente_id']),
      doParticular?.['fonte_pagadora_id'],
      n(doParticular?.['com_nome']),
      doParticular?.['tipo_devedor'],
      n(doParticular?.['paciente_titulo']),
      doParticular?.['original'],
      doParticular?.['parcelas'],
    ]).toEqual([paciente, null, 1, 'paciente', paciente, 'aberto', 'renegociada:0.00,protestada:70.00']);
    expect(await ler<Devedores>((l) => devedoresComSaldoAberto(l, m.est, 'E', ''))).toEqual([
      expect.objectContaining({ id: paciente, titulos: 1, saldo: 250 }),
    ]);
    await rodar('financeiro.desfazerRenegociacaoReceber', {
      renegociacao: n(rpAcordo.resultado['renegociacao']),
      motivo: 'Acordo do particular lançado para a prova',
    });
    const acordo = {
      titulos: [ra, rb],
      juros: 30,
      multa: 20,
      desconto: 50,
      quantidadeParcelas: 3,
      primeiroVencimento: EM_30_DIAS,
      observacao: 'Acordo sintético',
    };
    // Recusas antes de gravar: devedores diferentes, vencimento passado e desconto que zera o acordo.
    expect(
      await codigoDaGravacao(rodar('financeiro.renegociarTitulosReceber', { ...acordo, titulos: [ra, rc] })),
    ).toBe('devedores-diferentes');
    expect(
      await codigoDaGravacao(
        rodar('financeiro.renegociarTitulosReceber', { ...acordo, primeiroVencimento: '2020-01-01' }),
      ),
    ).toBe('vencimento-passado');
    expect(
      await codigoDaGravacao(rodar('financeiro.renegociarTitulosReceber', { ...acordo, desconto: 5000 })),
    ).toBe('desconto-total');
    expect(
      n(
        (
          await consultar(
            'SELECT COUNT(*) AS q FROM renegociacao WHERE estabelecimento_id = ? AND fonte_pagadora_id IS NOT NULL',
            [m.est],
          )
        )[0]?.['q'],
      ),
    ).toBe(0);

    const r = await rodar('financeiro.renegociarTitulosReceber', acordo);
    expect(r.trilha).not.toBeNull();
    expect(r.resultado).toMatchObject({
      valorOriginal: 900,
      valorRenegociado: 900,
      parcelas: 3,
      titulosRenegociados: 2,
    });
    const id = n(r.resultado['renegociacao']);
    const novo = n(r.resultado['titulo']);
    const [cab] = await consultar(
      `SELECT situacao, tipo, valor_original, valor_juros, valor_multa, valor_desconto, valor_renegociado,
              quantidade_parcelas, fonte_pagadora_id, devedor_nome, novo_titulo_receber_id, responsavel_usuario_id,
              termo_aceito_em IS NOT NULL AS aceito FROM renegociacao WHERE id = ?`,
      [id],
    );
    expect({
      ...cab,
      valor_original: n(cab?.['valor_original']),
      valor_juros: n(cab?.['valor_juros']),
      valor_multa: n(cab?.['valor_multa']),
      valor_desconto: n(cab?.['valor_desconto']),
      valor_renegociado: n(cab?.['valor_renegociado']),
      quantidade_parcelas: n(cab?.['quantidade_parcelas']),
      fonte_pagadora_id: n(cab?.['fonte_pagadora_id']),
      novo_titulo_receber_id: n(cab?.['novo_titulo_receber_id']),
      responsavel_usuario_id: n(cab?.['responsavel_usuario_id']),
      aceito: n(cab?.['aceito']),
    }).toEqual({
      situacao: 'efetivada',
      tipo: 'receber',
      valor_original: 900,
      valor_juros: 30,
      valor_multa: 20,
      valor_desconto: 50,
      valor_renegociado: 900,
      quantidade_parcelas: 3,
      fonte_pagadora_id: m.convenio,
      devedor_nome: 'OPERADORA SINTETICA L0207',
      novo_titulo_receber_id: novo,
      responsavel_usuario_id: m.lanca,
      aceito: 1,
    });
    // O título novo: origem acordo, do mesmo devedor, três parcelas mensais que somam o acordo.
    const [tn] = await consultar(
      'SELECT tipo_origem, renegociacao_id, tipo_devedor, fonte_pagadora_id, valor_bruto, valor_liquido, situacao, quantidade_parcelas FROM titulo_receber WHERE id = ?',
      [novo],
    );
    expect([
      tn?.['tipo_origem'],
      n(tn?.['renegociacao_id']),
      tn?.['tipo_devedor'],
      n(tn?.['fonte_pagadora_id']),
      n(tn?.['valor_bruto']),
      n(tn?.['valor_liquido']),
      tn?.['situacao'],
      n(tn?.['quantidade_parcelas']),
    ]).toEqual(['acordo', id, 'fonte_pagadora', m.convenio, 900, 900, 'aberto', 3]);
    const novas = await consultar(
      'SELECT sequencia, valor, saldo, situacao, vencimento FROM parcela_receber WHERE titulo_receber_id = ? ORDER BY sequencia',
      [novo],
    );
    expect(novas.map((x) => [n(x['sequencia']), n(x['valor']), n(x['saldo']), x['situacao']])).toEqual([
      [1, 300, 300, 'aberta'],
      [2, 300, 300, 'aberta'],
      [3, 300, 300, 'aberta'],
    ]);
    // O histórico: o saldo que cada parcela levou, com a parte dos juros, da multa e do desconto.
    const historico = await consultar(
      `SELECT p.titulo_receber_id AS titulo, x.valor_original, x.valor_saldo, x.valor_juros, x.valor_multa, x.valor_desconto
         FROM titulo_renegociado x JOIN parcela_receber p ON p.id = x.parcela_receber_id
        WHERE x.renegociacao_id = ? ORDER BY p.titulo_receber_id`,
      [id],
    );
    expect(
      historico.map((x) => [
        n(x['titulo']),
        n(x['valor_original']),
        n(x['valor_saldo']),
        n(x['valor_juros']),
        n(x['valor_multa']),
        n(x['valor_desconto']),
      ]),
    ).toEqual([
      [ra, 600, 600, 20, 13.33, 33.33],
      [rb, 400, 300, 10, 6.67, 16.67],
    ]);
    const originais = () =>
      consultar(
        `SELECT t.id, t.situacao, t.valor_recebido, p.situacao AS parcela, p.saldo
           FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id WHERE t.id IN (?, ?) ORDER BY t.id`,
        [ra, rb],
      ).then((l) => l.map((x) => [x['situacao'], n(x['valor_recebido']), x['parcela'], n(x['saldo'])]));
    expect(await originais()).toEqual([
      ['renegociado', 0, 'renegociada', 0],
      ['renegociado', 100, 'renegociada', 0],
    ]);
    // O título já renegociado não entra em outro acordo.
    expect(
      await codigoDaGravacao(rodar('financeiro.renegociarTitulosReceber', { ...acordo, titulos: [ra] })),
    ).toBe('parcela-nao-renegociavel');

    // As leituras da tela: a lista e o detalhe do acordo.
    const lista = await ler<Awaited<ReturnType<typeof acordosDoEstabelecimento>>>((l) =>
      acordosDoEstabelecimento(l, m.est),
    );
    expect(
      lista.map((x) => [x.id, x.situacao, x.valorRenegociado, x.parcelas, x.parcelasOriginais, x.titulo]),
    ).toContainEqual([id, 'efetivada', 900, 3, 2, novo]);
    expect(lista.map((x) => x.situacao).sort()).toEqual(['cancelada', 'efetivada']);
    const detalhe = await ler<Awaited<ReturnType<typeof detalheDoAcordo>>>((l) =>
      detalheDoAcordo(l, m.est, id),
    );
    expect(detalhe?.originais.map((x) => [x.titulo, x.saldoLevado, x.situacao])).toEqual([
      [ra, 600, 'renegociada'],
      [rb, 300, 'renegociada'],
    ]);
    expect(detalhe?.novas).toHaveLength(3);
    expect(await ler((l) => detalheDoAcordo(l, m.outroEst, id))).toBeNull();

    // Desfazer: motivo obrigatório; depois, tudo volta e nada some.
    expect(
      await codigoDaGravacao(
        rodar('financeiro.desfazerRenegociacaoReceber', { renegociacao: id, motivo: 'ok' }),
      ),
    ).toBe('motivo-obrigatorio');
    expect(
      await codigoDaGravacao(
        rodar(
          'financeiro.desfazerRenegociacaoReceber',
          { renegociacao: id, motivo: 'Outro estabelecimento' },
          { est: m.outroEst },
        ),
      ),
    ).toBe('acordo-inexistente');
    const d = await rodar('financeiro.desfazerRenegociacaoReceber', {
      renegociacao: id,
      motivo: 'Lançado em duplicidade',
    });
    expect(d.resultado).toMatchObject({ tituloCancelado: novo, parcelasDevolvidas: 2, titulosReabertos: 2 });
    expect(await originais()).toEqual([
      ['aberto', 0, 'aberta', 600],
      ['recebido_parcial', 100, 'parcial', 300],
    ]);
    const [fim] = await consultar(
      `SELECT r.situacao, r.observacao, t.situacao AS titulo, t.motivo_cancelamento,
              (SELECT COUNT(*) FROM parcela_receber p WHERE p.titulo_receber_id = t.id AND p.situacao = 'cancelada' AND p.saldo = 0) AS canceladas,
              (SELECT COUNT(*) FROM titulo_renegociado x WHERE x.renegociacao_id = r.id) AS historico
         FROM renegociacao r JOIN titulo_receber t ON t.id = r.novo_titulo_receber_id WHERE r.id = ?`,
      [id],
    );
    expect([fim?.['situacao'], fim?.['titulo'], n(fim?.['canceladas']), n(fim?.['historico'])]).toEqual([
      'cancelada',
      'cancelado',
      3,
      2,
    ]);
    expect(String(fim?.['observacao'])).toContain('Desfeito: Lançado em duplicidade');
    expect(String(fim?.['motivo_cancelamento'])).toContain('Lançado em duplicidade');
    expect(
      await codigoDaGravacao(
        rodar('financeiro.desfazerRenegociacaoReceber', { renegociacao: id, motivo: 'Repetindo o pedido' }),
      ),
    ).toBe('acordo-nao-efetivado');

    // O título reaberto entra num acordo novo; com recebimento no acordo, desfazer é recusado.
    const r2 = await rodar('financeiro.renegociarTitulosReceber', {
      titulos: [ra],
      quantidadeParcelas: 1,
      primeiroVencimento: HOJE,
    });
    expect(r2.resultado).toMatchObject({ valorOriginal: 600, valorRenegociado: 600, parcelas: 1 });
    await escrever(async (e) => {
      await e.executar(
        "UPDATE parcela_receber SET valor_recebido = 10, saldo = 590, situacao = 'parcial' WHERE titulo_receber_id = ?",
        [n(r2.resultado['titulo'])],
      );
    });
    expect(
      await codigoDaGravacao(
        rodar('financeiro.desfazerRenegociacaoReceber', {
          renegociacao: n(r2.resultado['renegociacao']),
          motivo: 'Tentativa com recebimento',
        }),
      ),
    ).toBe('acordo-com-recebimento');
    console.info('[f38-05] renegociação: 3 acordo(s), 2 desfeito(s), histórico mantido');
  }, 120_000);
});
