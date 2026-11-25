// F7, 09-AREA linha 78 (C2-094): contrato de efeito da entrada de serviço tomado contra o MariaDB real (massa SINTÉTICA
// "C2094", estabelecimento próprio; nenhuma pessoa real). Registrar contra o pedido de serviço grava a entrada aberta com
// o número ES-, os itens, o câmbio e as retenções rateadas por item (IR, INSS com a parte não retida por decisão
// judicial, PIS, COFINS e CSLL pela regra vigente; ISS pela nota); a nota repetida, o saldo e o preço acima do pedido
// são recusados sem gravar. Concluir soma a quantidade atendida ao pedido (parcialmente recebido), grava a escrituração
// da entrada (pendente, com os itens e o CFOP 1933) e a EFD-REINF passa a ler a retenção: a R-2010 sai com o INSS e a
// R-4020 com o IR e a CSRF da entrada. Com título ligado que já tem retenção, vale o título (nada em dobro). Cancelar
// devolve o saldo ao pedido e cancela a escrituração; a entrada fica no histórico com a justificativa.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../../teste/limpar-trilha.spec-util.js';
import { detalheEntradaServico, OPERACOES_ENTRADA_SERVICO } from '../entrada-servico-propria.js';
import { OPERACOES_REINF, painelReinf } from '../reinf-eventos-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-c2094-${randomUUID()}` });
const PERIODO = '2026-09';
const CNPJ = '92094000000194';

describe.skipIf(SEM_BANCO)(
  'entrada de serviço tomado: pedido, retenções, conclusão, EFD-REINF e cancelamento (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let est = 0;
    let fornecedor = 0;
    let centro = 0;
    let servico = 0;
    let pedido = 0;
    let pedidoItem = 0;
    let moeda = 0;
    const tributos: Record<string, number> = {};
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2094' }, (l) => l.consultar(sql, p));
    const executar = (nome: keyof typeof OPERACOES_ENTRADA_SERVICO, entrada: unknown) =>
      m.nucleo
        .criarExecutor()
        .executar(OPERACOES_ENTRADA_SERVICO[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, est)))
        .then((r) => r.resultado as Record<string, unknown>);
    const reinf = (entrada: unknown) =>
      m.nucleo
        .criarExecutor()
        .executar(
          OPERACOES_REINF['financeiro.reinfGerarEventos'] as never,
          CLIENTE,
          entrada,
          op(m.ctx(m.lanca, est)),
        )
        .then((r) => r.resultado as Record<string, unknown>);

    async function limpar(e: Escritor): Promise<void> {
      const q = [est];
      const doEst = 'IN (SELECT id FROM entrada_servico WHERE estabelecimento_id = ?)';
      await e.executar(
        `DELETE r FROM retencao_entrada_servico r JOIN entrada_servico_item i ON i.id = r.entrada_servico_item_id WHERE i.entrada_servico_id ${doEst}`,
        q,
      );
      await e.executar(
        'DELETE i FROM escrituracao_item_entrada i JOIN escrituracao_entrada x ON x.id = i.escrituracao_entrada_id WHERE x.estabelecimento_id = ?',
        q,
      );
      await e.executar('DELETE FROM escrituracao_entrada WHERE estabelecimento_id = ?', q);
      await e.executar(`DELETE FROM entrada_servico_cambio WHERE entrada_servico_id ${doEst}`, q);
      await e.executar(`DELETE FROM entrada_servico_item WHERE entrada_servico_id ${doEst}`, q);
      await e.executar('DELETE FROM entrada_servico WHERE estabelecimento_id = ?', q);
      await e.executar(
        'DELETE i FROM evento_reinf_item i JOIN evento_reinf v ON v.id = i.evento_reinf_id WHERE v.estabelecimento_id = ?',
        q,
      );
      await e.executar('DELETE FROM evento_reinf WHERE estabelecimento_id = ?', q);
      await e.executar(
        'DELETE r FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id = ?',
        q,
      );
      await e.executar(
        'DELETE p FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id = ?',
        q,
      );
      await e.executar('DELETE FROM titulo_pagar WHERE estabelecimento_id = ?', q);
      await e.executar(
        'DELETE i FROM pedido_compra_item i JOIN pedido_compra p ON p.id = i.pedido_compra_id WHERE p.estabelecimento_id = ?',
        q,
      );
      await e.executar('DELETE FROM pedido_compra WHERE estabelecimento_id = ?', q);
      await e.executar('DELETE FROM regra_retencao WHERE estabelecimento_id = ?', q);
      await e.executar(
        "DELETE FROM sequencia_negocio WHERE tipo = 'entrada_servico' AND estabelecimento_id = ?",
        q,
      );
      await limparTrilhaDaMassa(e, { ids: [est] });
    }

    beforeAll(async () => {
      m = await montarMassa();
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2094' }, async (e) => {
        const agora = new Date();
        const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        est = await g(
          "SELECT id FROM estabelecimento WHERE codigo = 'C2094'",
          [],
          "INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES ('C2094', 'ESTAB C2094 SINTETICO', 'ESTAB C2094 SINTETICO', ?)",
          [agora],
        );
        await e.executar("UPDATE estabelecimento SET cnpj = '92094000000275' WHERE id = ? AND cnpj IS NULL", [
          est,
        ]);
        await limpar(e);
        fornecedor = await g(
          'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
          [CNPJ],
          "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, 'PRESTADOR SINTETICO C2094', ?)",
          [CNPJ, agora],
        );
        centro = await g(
          "SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = 'C2094'",
          [est],
          "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, 'C2094', 'CENTRO SINTETICO C2094', '2000-01-01', ?)",
          [est, agora],
        );
        servico = await g(
          "SELECT id FROM servico_contratavel WHERE codigo = 'C2094-LIMP'",
          [],
          "INSERT INTO servico_contratavel (codigo, descricao, categoria, criado_em) VALUES ('C2094-LIMP', 'LIMPEZA SINTETICA C2094', 'limpeza', ?)",
          [agora],
        );
        moeda = await g(
          "SELECT id FROM moeda WHERE codigo_iso = 'USD' ORDER BY id LIMIT 1",
          [],
          "INSERT INTO moeda (codigo, descricao, codigo_iso, simbolo, criado_em) VALUES ('C2094-USD', 'DOLAR SINTETICO', 'USD', 'US$', ?)",
          [agora],
        );
        await g(
          "SELECT id FROM cfop WHERE codigo_cfop = '1933'",
          [],
          "INSERT INTO cfop (codigo_cfop, descricao, sentido, abrangencia, versao_fonte, criado_em) VALUES ('1933', 'Aquisicao de servico tributado pelo ISSQN', 'entrada', 'estadual', 'teste', ?)",
          [agora],
        );
        for (const [codigo, esfera] of [
          ['IRRF', 'federal'],
          ['INSS', 'federal'],
          ['PIS', 'federal'],
          ['COFINS', 'federal'],
          ['CSLL', 'federal'],
          ['ISS', 'municipal'],
        ] as const)
          tributos[codigo] = await g(
            'SELECT id FROM tributo WHERE codigo = ?',
            [codigo],
            "INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em) VALUES (?, ?, ?, 'por_pagamento', 'retido', ?)",
            [codigo, `${codigo} SINTETICO C2094`, esfera, agora],
          );
        for (const [codigo, aliquota, minimo] of [
          ['IRRF', 1.5, 10],
          ['INSS', 11, 29],
          ['PIS', 0.65, 10],
          ['COFINS', 3, 10],
          ['CSLL', 1, 10],
        ] as const)
          await e.inserir(
            `INSERT INTO regra_retencao (estabelecimento_id, tributo_id, descricao, tipo_participante, momento, percentual_base,
             aliquota, valor_deducao, valor_minimo_retencao, vigencia_inicio, criado_em)
           VALUES (?, ?, ?, 'todos', 'emissao', 100, ?, 0, ?, '2020-01-01', ?)`,
            [est, tributos[codigo], `RETENCAO ${codigo} C2094`, aliquota, minimo, agora],
          );
        pedido = await e.inserir(
          `INSERT INTO pedido_compra (estabelecimento_id, ano, numero, empresa_fornecedora_id, centro_custo_id, natureza,
           data_pedido, situacao, aprovado_em, criado_em) VALUES (?, 2026, 2094, ?, ?, 'servico', '2026-09-01', 'aprovado', ?, ?)`,
          [est, fornecedor, centro, agora, agora],
        );
        pedidoItem = await e.inserir(
          `INSERT INTO pedido_compra_item (pedido_compra_id, sequencia, servico_contratavel_id, quantidade, valor_unitario,
           valor_total, criado_em) VALUES (?, 1, ?, 3, 1000, 3000, ?)`,
          [pedido, servico, agora],
        );
      });
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2094' }, (e) => limpar(e));
      await m.nucleo.encerrar();
    }, 120_000);

    const nota = (numeroDocumento: string, x: Record<string, unknown> = {}) => ({
      fornecedor,
      pedido,
      numeroDocumento,
      serie: 'A',
      dataEmissao: '2026-09-05',
      dataEntrada: '2026-09-08',
      competencia: PERIODO,
      issRetido: true,
      aliquotaIss: 2,
      itens: [
        {
          servico,
          pedidoItem,
          quantidade: 1,
          valorUnitario: 1000,
          centroCusto: centro,
          inssNaoRetido: 10,
          processoJudicial: '00012345620264013400',
        },
        { servico, pedidoItem, quantidade: 1, valorUnitario: 1000, centroCusto: centro },
      ],
      cambio: { moeda, dataCotacao: '2026-09-05', taxa: 5, valorMoeda: 400 },
      ...x,
    });

    it('registra contra o pedido com itens, câmbio e retenções rateadas; recusa repetida, saldo e preço sem gravar', async () => {
      const r = await executar('registrar', nota('NF-1'));
      expect(r).toMatchObject({ valorBruto: 2000, retido: 373 }); // IR 30 + INSS 220-10 + PIS 13 + COFINS 60 + CSLL 20 + ISS 40
      expect(String(r['numero'])).toMatch(/^ES-/);
      const [cab] = await consultar(
        'SELECT situacao, valor_total, valor_iss, iss_retido, base_inss, competencia FROM entrada_servico WHERE id = ?',
        [r['entrada']],
      );
      expect(cab).toMatchObject({ situacao: 'aberta' });
      expect(Number(cab!['valor_iss'])).toBe(40);
      expect(Number(cab!['base_inss'])).toBe(2000);
      const ret = await consultar(
        `SELECT t.codigo, COUNT(*) AS n, SUM(r.valor_tributo) AS devido, SUM(r.valor_retido) AS retido, SUM(r.valor_nao_retido) AS nr
         FROM retencao_entrada_servico r JOIN entrada_servico_item i ON i.id = r.entrada_servico_item_id
         JOIN tributo t ON t.id = r.tributo_id WHERE i.entrada_servico_id = ? GROUP BY t.codigo ORDER BY t.codigo`,
        [r['entrada']],
      );
      expect(
        ret.map((x) => [
          x['codigo'],
          Number(x['n']),
          Number(x['devido']),
          Number(x['retido']),
          Number(x['nr']),
        ]),
      ).toEqual([
        ['COFINS', 2, 60, 60, 0],
        ['CSLL', 2, 20, 20, 0],
        ['INSS', 2, 220, 210, 10],
        ['IRRF', 2, 30, 30, 0],
        ['ISS', 2, 40, 40, 0],
        ['PIS', 2, 13, 13, 0],
      ]);
      const [camb] = await consultar(
        'SELECT taxa_cambio, valor_total_moeda, valor_total_convertido FROM entrada_servico_cambio WHERE entrada_servico_id = ?',
        [r['entrada']],
      );
      expect([
        Number(camb!['taxa_cambio']),
        Number(camb!['valor_total_moeda']),
        Number(camb!['valor_total_convertido']),
      ]).toEqual([5, 400, 2000]);
      const antes = await consultar(
        'SELECT COUNT(*) AS n FROM entrada_servico WHERE estabelecimento_id = ?',
        [est],
      );
      expect(await codigoDaGravacao(executar('registrar', nota('NF-1')))).toBe('documento-repetido');
      expect(
        await codigoDaGravacao(
          executar(
            'registrar',
            nota('NF-2', {
              itens: [{ servico, pedidoItem, quantidade: 4, valorUnitario: 1000, centroCusto: centro }],
              cambio: null,
            }),
          ),
        ),
      ).toBe('acima-do-saldo');
      expect(
        await codigoDaGravacao(
          executar(
            'registrar',
            nota('NF-3', {
              itens: [{ servico, pedidoItem, quantidade: 1, valorUnitario: 1200, centroCusto: centro }],
              cambio: null,
            }),
          ),
        ),
      ).toBe('acima-do-preco');
      const depois = await consultar(
        'SELECT COUNT(*) AS n FROM entrada_servico WHERE estabelecimento_id = ?',
        [est],
      );
      expect(Number(depois[0]!['n'])).toBe(Number(antes[0]!['n']));
    });

    it('conclui: pedido atendido, escrituração pendente e a EFD-REINF lê a retenção da entrada', async () => {
      const [e1] = await consultar(
        "SELECT id, versao FROM entrada_servico WHERE estabelecimento_id = ? AND numero_documento = 'NF-1'",
        [est],
      );
      await executar('concluir', { entrada: Number(e1!['id']), versao: Number(e1!['versao']), titulo: null });
      const [ped] = await consultar(
        'SELECT p.situacao, i.quantidade_recebida FROM pedido_compra p JOIN pedido_compra_item i ON i.pedido_compra_id = p.id WHERE p.id = ?',
        [pedido],
      );
      expect([ped!['situacao'], Number(ped!['quantidade_recebida'])]).toEqual(['parcialmente_recebido', 2]);
      const esc = await consultar(
        `SELECT x.situacao, x.modelo_documento, x.valor_documento, c.codigo_cfop, COUNT(i.id) AS itens
         FROM escrituracao_entrada x JOIN cfop c ON c.id = x.cfop_id JOIN escrituracao_item_entrada i ON i.escrituracao_entrada_id = x.id
        WHERE x.entrada_servico_id = ? GROUP BY x.id`,
        [e1!['id']],
      );
      expect(
        esc.map((x) => [
          x['situacao'],
          x['modelo_documento'],
          Number(x['valor_documento']),
          x['codigo_cfop'],
          Number(x['itens']),
        ]),
      ).toEqual([['pendente', 'SE', 2000, '1933', 2]]);
      const det = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2094' }, (l) =>
        detalheEntradaServico(l, est, Number(e1!['id'])),
      );
      expect(det).toMatchObject({
        situacao: 'concluida',
        retido: 373,
        liquido: 1627,
        cambio: { moeda: 'USD', valorMoeda: 400 },
      });
      // Concluir de novo é recusado (só a aberta).
      expect(
        await codigoDaGravacao(
          executar('concluir', { entrada: Number(e1!['id']), versao: Number(e1!['versao']) + 1 }),
        ),
      ).toBe('situacao-invalida');

      await reinf({ serie: 'R-2000', periodo: PERIODO });
      await reinf({ serie: 'R-4000', periodo: PERIODO });
      const ev = await consultar(
        `SELECT v.codigo_evento, i.beneficiario_documento, i.valor_bruto, i.valor_inss, i.valor_irrf, i.valor_csrf
         FROM evento_reinf v JOIN evento_reinf_item i ON i.evento_reinf_id = v.id AND i.sequencia = 1
        WHERE v.estabelecimento_id = ? AND v.situacao <> 'cancelado' ORDER BY v.codigo_evento`,
        [est],
      );
      expect(
        ev.map((x) => [
          x['codigo_evento'],
          x['beneficiario_documento'],
          Number(x['valor_bruto']),
          Number(x['valor_inss']),
          Number(x['valor_irrf']),
          Number(x['valor_csrf']),
        ]),
      ).toEqual([
        ['R-2010', CNPJ, 2000, 210, 0, 0],
        // A R-4020 grava o retido principal (IR 30 + CSRF 93) no item do beneficiário, como a geração já fazia.
        ['R-4020', CNPJ, 2000, 0, 123, 0],
      ]);
      const painel = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2094' }, (l) =>
        painelReinf(l, est, PERIODO),
      );
      expect(painel.entradasSemDocumento).toEqual([]);
    });

    it('com título ligado que já tem retenção, vale o título; cancelar devolve o saldo e guarda o histórico', async () => {
      const r2 = await executar(
        'registrar',
        nota('NF-4', {
          itens: [{ servico, pedidoItem, quantidade: 1, valorUnitario: 1000, centroCusto: centro }],
          cambio: null,
          issRetido: false,
          aliquotaIss: null,
        }),
      );
      const titulo = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2094' }, async (e) => {
        const agora = new Date();
        const tc = Number(
          (await e.uma<{ id: number }>("SELECT id FROM tipo_credor WHERE codigo = 'fornecedor'", []))?.id,
        );
        const td = Number(
          (await e.uma<{ id: number }>('SELECT id FROM tipo_documento_financeiro ORDER BY id LIMIT 1', []))
            ?.id,
        );
        const nf = Number(
          (await e.uma<{ id: number }>("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'", []))
            ?.id,
        );
        const t = await e.inserir(
          `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
           numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
           referente, situacao, criado_em)
         VALUES (?, 'C2094-T1', ?, ?, ?, 'NF-4', '2026-09-05', '2026-09-05', 1000, 15, 985, ?, 'SERVICO SINTETICO', 'aberto', ?)`,
          [est, tc, fornecedor, td, nf, agora],
        );
        const p = await e.inserir(
          `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, valor_pago,
           situacao, criado_em) VALUES (?, 1, '2026-10-05', '2026-10-05', 985, 985, 0, 'aberta', ?)`,
          [t, agora],
        );
        await e.inserir(
          `INSERT INTO retencao_titulo (parcela_pagar_id, sequencia, tributo_id, competencia, data_fato_gerador, base_calculo,
           aliquota, valor_retido, criado_em) VALUES (?, 1, ?, '2026-09-01', '2026-09-05', 1000, 1.5, 15, ?)`,
          [p, tributos['IRRF'], agora],
        );
        return t;
      });
      const [e2] = await consultar('SELECT versao FROM entrada_servico WHERE id = ?', [r2['entrada']]);
      await executar('concluir', { entrada: Number(r2['entrada']), versao: Number(e2!['versao']), titulo });
      const painel = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2094' }, (l) =>
        painelReinf(l, est, PERIODO),
      );
      expect(painel.titulosSemDocumento).toEqual([]);
      // A R-4020 relida soma o título (IR 15) e a primeira entrada (123): a NF-4 (IR 15) não entra em dobro (seria 153).
      await reinf({ serie: 'R-4000', periodo: PERIODO });
      const [r4020] = await consultar(
        `SELECT i.valor_irrf FROM evento_reinf v JOIN evento_reinf_item i ON i.evento_reinf_id = v.id AND i.sequencia = 1
        WHERE v.estabelecimento_id = ? AND v.codigo_evento = 'R-4020' AND v.situacao <> 'cancelado' ORDER BY v.id DESC LIMIT 1`,
        [est],
      );
      expect(Number(r4020!['valor_irrf'])).toBe(138);

      const [e2b] = await consultar('SELECT versao FROM entrada_servico WHERE id = ?', [r2['entrada']]);
      expect(
        await codigoDaGravacao(
          executar('cancelar', {
            entrada: Number(r2['entrada']),
            versao: Number(e2b!['versao']),
            justificativa: 'curta',
          }),
        ),
      ).toBe('sem-justificativa');
      await executar('cancelar', {
        entrada: Number(r2['entrada']),
        versao: Number(e2b!['versao']),
        justificativa: 'Nota lançada em duplicidade pelo prestador',
      });
      const [fim] = await consultar(
        `SELECT es.situacao, es.justificativa IS NOT NULL AS justificada, x.situacao AS escrituracao, x.situacao_documento,
              i.quantidade_recebida, p.situacao AS pedido,
              (SELECT COUNT(*) FROM retencao_entrada_servico r JOIN entrada_servico_item ii ON ii.id = r.entrada_servico_item_id WHERE ii.entrada_servico_id = es.id) AS retencoes
         FROM entrada_servico es JOIN escrituracao_entrada x ON x.entrada_servico_id = es.id
         JOIN pedido_compra p ON p.id = es.pedido_compra_id JOIN pedido_compra_item i ON i.pedido_compra_id = p.id
        WHERE es.id = ?`,
        [r2['entrada']],
      );
      expect([
        fim!['situacao'],
        Number(fim!['justificada']),
        fim!['escrituracao'],
        fim!['situacao_documento'],
        Number(fim!['quantidade_recebida']),
        fim!['pedido'],
        Number(fim!['retencoes']),
      ]).toEqual([
        'cancelada',
        1,
        'cancelada',
        '02',
        2,
        'parcialmente_recebido',
        5, // IR, INSS, PIS, COFINS e CSLL ficam no histórico
      ]);
    });
    it('o título confirma a retenção: recusa o que não desconta o retido e o já ligado a outra entrada viva', async () => {
      const r5 = await executar(
        'registrar',
        nota('NF-5', {
          itens: [{ servico, pedidoItem, quantidade: 1, valorUnitario: 1000, centroCusto: centro }],
          cambio: null,
          issRetido: false,
          aliquotaIss: null,
        }),
      );
      const entrada = Number(r5['entrada']);
      const [ret] = await consultar(
        `SELECT COALESCE(SUM(r.valor_retido), 0) AS retido FROM retencao_entrada_servico r
           JOIN entrada_servico_item i ON i.id = r.entrada_servico_item_id WHERE i.entrada_servico_id = ?`,
        [entrada],
      );
      const retido = Number(ret!['retido']);
      expect(retido).toBeGreaterThan(0);
      const liquido = Math.round((1000 - retido) * 100) / 100;
      // Títulos sintéticos sem retenção detalhada no título: cheio (o exemplo da revisão, sem desconto do retido), com o
      // total retido da entrada descontado e um já ligado a outra entrada.
      const [cheio, ligado, certo] = await m.nucleo.escrever(
        { cliente: CLIENTE, correlacao: 'preparo-c2094-titulo' },
        async (e) => {
          const agora = new Date();
          const tc = Number(
            (await e.uma<{ id: number }>("SELECT id FROM tipo_credor WHERE codigo = 'fornecedor'", []))?.id,
          );
          const td = Number(
            (await e.uma<{ id: number }>('SELECT id FROM tipo_documento_financeiro ORDER BY id LIMIT 1', []))
              ?.id,
          );
          const nf = Number(
            (await e.uma<{ id: number }>("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'", []))
              ?.id,
          );
          const titulo = (numeroTitulo: string, liq: number) =>
            e.inserir(
              `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id,
               tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes,
               valor_liquido, natureza_financeira_id, referente, situacao, criado_em)
             VALUES (?, ?, ?, ?, ?, 'NF-5', '2026-09-05', '2026-09-05', 1000, ?, ?, ?, 'SERVICO SINTETICO', 'aberto', ?)`,
              [est, numeroTitulo, tc, fornecedor, td, Math.round((1000 - liq) * 100) / 100, liq, nf, agora],
            );
          const t2 = await titulo('C2094-T2', 1000);
          const t3 = await titulo('C2094-T3', liquido);
          const t4 = await titulo('C2094-T4', liquido);
          // A NF-1 (concluída) já é confirmada pelo T3.
          await e.executar(
            "UPDATE entrada_servico SET titulo_pagar_id = ? WHERE estabelecimento_id = ? AND numero_documento = 'NF-1'",
            [t3, est],
          );
          return [t2, t3, t4];
        },
      );
      const versao = async () =>
        Number((await consultar('SELECT versao FROM entrada_servico WHERE id = ?', [entrada]))[0]!['versao']);
      expect(
        await codigoDaGravacao(executar('concluir', { entrada, versao: await versao(), titulo: cheio })),
      ).toBe('titulo-sem-retencao');
      expect(
        await codigoDaGravacao(executar('concluir', { entrada, versao: await versao(), titulo: ligado })),
      ).toBe('titulo-ja-ligado');
      const [antes] = await consultar(
        'SELECT situacao, titulo_pagar_id, (SELECT COUNT(*) FROM escrituracao_entrada x WHERE x.entrada_servico_id = es.id) AS escr FROM entrada_servico es WHERE id = ?',
        [entrada],
      );
      expect([antes!['situacao'], antes!['titulo_pagar_id'], Number(antes!['escr'])]).toEqual([
        'aberta',
        null,
        0,
      ]);
      await executar('concluir', { entrada, versao: await versao(), titulo: certo });
      const [depois] = await consultar('SELECT situacao, titulo_pagar_id FROM entrada_servico WHERE id = ?', [
        entrada,
      ]);
      expect([depois!['situacao'], Number(depois!['titulo_pagar_id'])]).toEqual(['concluida', Number(certo)]);
    });
  },
);
