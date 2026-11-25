// F7 (08-SGO linha 102, C2-120): contrato de efeito da remuneração e do pagamento do prestador no MariaDB real (cliente
// f22_o2, massa sintética "L0209", competência 2031 para não cruzar com outros testes). A porta grava a tabela negociada
// em unidades e o item, a regra de valoração com acréscimo noturno e valora o evento; o pacote com o principal; o
// reajuste do contrato encerra o item antigo e inclui o reajustado (o histórico fica); o calendário e o fechamento; o
// adiantamento com o título a pagar; o lote calculado com tributos e, ao fechar, a compensação do adiantamento e o
// título com a retenção. Recusas não gravam nada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  type MassaOperadora,
  P,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
import { PortaRemuneracaoRedePropria } from './remuneracao-rede-propria.js';

const COD = 'C120';
const COMP = '2031-04-01';

describe.skipIf(SEM_BANCO)('remuneração e pagamento do prestador (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRemuneracaoRedePropria;
  let m: MassaOperadora;
  let contrato: number;
  let itens: number[];
  let natureza: number;
  let documento: number;
  let irrf: number;
  let iss: number;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2120' }, (l) => l.consultar(sql, p));
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? {};
  const escrever = (fn: (e: Parameters<Parameters<NucleoProprio['escrever']>[1]>[0]) => Promise<unknown>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2120-massa' }, fn);
  const trilha = (ev: string) => {
    const t = trilhaTela(m, 'remuneracao', ev);
    return (r: { id: number }) => t(r);
  };
  const recusada = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return codigoDe(e);
    }
  };

  const limpar = () =>
    escrever(async (e) => {
      const titulos = (
        await e.consultar(
          `SELECT titulo_pagar_id AS id FROM adiantamento_rede WHERE prestador_rede_id = ? AND descricao LIKE ?
            UNION SELECT i.titulo_pagar_id FROM lote_pagamento_rede_item i JOIN lote_pagamento_rede l ON l.id = i.lote_pagamento_rede_id
             WHERE l.prestador_rede_id = ? AND l.competencia = ?`,
          [m.prestador, `${COD}%`, m.prestador, COMP],
        )
      )
        .map((r) => Number(r['id']))
        .filter((x) => x > 0);
      const lotes = `SELECT id FROM lote_pagamento_rede WHERE prestador_rede_id = ${Number(m.prestador)} AND competencia = '${COMP}'`;
      await e.executar(`DELETE FROM lancamento_avulso_prestador WHERE lote_pagamento_rede_id IN (${lotes})`);
      await e.executar(`DELETE FROM lote_pagamento_rede_tributo WHERE lote_pagamento_rede_id IN (${lotes})`);
      await e.executar(`DELETE FROM lote_pagamento_rede_item WHERE lote_pagamento_rede_id IN (${lotes})`);
      await e.executar('DELETE FROM adiantamento_rede WHERE prestador_rede_id = ? AND descricao LIKE ?', [
        m.prestador,
        `${COD}%`,
      ]);
      await e.executar('DELETE FROM lote_pagamento_rede WHERE prestador_rede_id = ? AND competencia = ?', [
        m.prestador,
        COMP,
      ]);
      if (titulos.length) {
        const lista = titulos.join(', ');
        await e.executar(
          `DELETE FROM retencao_titulo WHERE parcela_pagar_id IN (SELECT id FROM parcela_pagar WHERE titulo_pagar_id IN (${lista}))`,
        );
        await e.executar(`DELETE FROM parcela_pagar WHERE titulo_pagar_id IN (${lista})`);
        await e.executar(`DELETE FROM titulo_pagar WHERE id IN (${lista})`);
      }
      await e.executar(
        'DELETE FROM lote_conta_recebida WHERE prestador_rede_id = ? AND numero_lote_prestador LIKE ?',
        [m.prestador, `${COD}%`],
      );
      await e.executar(
        'DELETE FROM calendario_pagamento_rede WHERE operadora_saude_id = ? AND YEAR(competencia) = 2031',
        [m.operadora],
      );
      await e.executar(
        `DELETE FROM aliquota_tributo_vigencia WHERE estabelecimento_id = ? AND vigencia_inicio = ? AND aplicacao = 'retencao_pagar'
            AND tributo_id IN (SELECT id FROM tributo WHERE codigo IN ('IRRF','ISS'))`,
        [m.est, COMP],
      );
      await e.executar(
        'DELETE FROM reajuste_contrato_rede WHERE contrato_rede_prestador_id IN (SELECT id FROM contrato_rede_prestador WHERE numero = ?)',
        [`${P}-${COD}`],
      );
      await e.executar('DELETE FROM regra_valoracao_item WHERE operadora_saude_id = ? AND codigo LIKE ?', [
        m.operadora,
        `${COD}%`,
      ]);
      await e.executar(
        `DELETE FROM pacote_remuneracao_rede_item WHERE pacote_remuneracao_rede_id IN
           (SELECT id FROM pacote_remuneracao_rede WHERE operadora_saude_id = ? AND codigo LIKE ?)`,
        [m.operadora, `${COD}%`],
      );
      await e.executar('DELETE FROM pacote_remuneracao_rede WHERE operadora_saude_id = ? AND codigo LIKE ?', [
        m.operadora,
        `${COD}%`,
      ]);
      await e.executar(
        `DELETE FROM tabela_remuneracao_rede_item WHERE tabela_remuneracao_rede_id IN
           (SELECT id FROM tabela_remuneracao_rede WHERE operadora_saude_id = ? AND codigo LIKE ?)`,
        [m.operadora, `${COD}%`],
      );
      await e.executar('DELETE FROM tabela_remuneracao_rede WHERE operadora_saude_id = ? AND codigo LIKE ?', [
        m.operadora,
        `${COD}%`,
      ]);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaRemuneracaoRedePropria(nucleo, CLIENTE);
    m = await prepararMassa(nucleo);
    await limpar();
    itens = (await ler('SELECT id FROM item_faturavel WHERE excluido_em IS NULL ORDER BY id LIMIT 2')).map(
      (r) => Number(r['id']),
    );
    natureza = Number(
      (
        await um(
          "SELECT id FROM natureza_financeira WHERE tipo = 'despesa' AND ativo = TRUE ORDER BY id LIMIT 1",
        )
      )['id'],
    );
    documento = Number(
      (await um("SELECT id FROM tipo_documento_financeiro WHERE codigo = 'nota_fiscal'"))['id'],
    );
    irrf = Number((await um("SELECT id FROM tributo WHERE codigo = 'IRRF'"))['id']);
    iss = Number((await um("SELECT id FROM tributo WHERE codigo = 'ISS'"))['id']);
    contrato = (await escrever(async (e) => {
      const k = await e.uma(
        'SELECT id FROM contrato_rede_prestador WHERE operadora_saude_id = ? AND numero = ?',
        [m.operadora, `${P}-${COD}`],
      );
      if (k) return Number(k['id']);
      return e.inserir(
        `INSERT INTO contrato_rede_prestador (estabelecimento_id, operadora_saude_id, prestador_rede_id, numero, inicio,
           forma_reajuste, mes_reajuste, situacao, criado_em) VALUES (?, ?, ?, ?, '2030-01-01', 'ipca', 3, 'vigente', NOW(3))`,
        [m.est, m.operadora, m.prestador, `${P}-${COD}`],
      );
    })) as number;
  }, 120_000);
  afterAll(async () => {
    await limpar();
    await nucleo?.encerrar();
  });

  it('tabela em unidades, item, regra noturna e a valoração do evento', async () => {
    const c = contexto(m);
    expect(
      await recusada(
        porta.incluirTabela(
          c,
          m.operadora,
          {
            codigo: `${COD}-X`,
            nome: 'X',
            finalidade: 'pagamento_rede',
            tipoValor: 'indice',
            valorCh: null,
            valorUco: null,
            valorFilme: null,
            prestador: null,
            inicio: '2030-01-01',
            fim: null,
          },
          trilha('t'),
        ),
      ),
    ).toBe('unidade-sem-valor');
    const t = await porta.incluirTabela(
      c,
      m.operadora,
      {
        codigo: `${COD}-T1`,
        nome: 'TABELA SINTETICA C2120',
        finalidade: 'pagamento_rede',
        tipoValor: 'indice',
        valorCh: 0.5,
        valorUco: 12,
        valorFilme: null,
        prestador: null,
        inicio: '2030-01-01',
        fim: null,
      },
      trilha('operadora.remuneracao.tabela.incluida'),
    );
    const item = {
      procedimento: m.termo,
      grupo: null,
      valor: null,
      quantidadeCh: 100,
      quantidadeUco: 2,
      quantidadeFilme: null,
      inicio: '2030-01-01',
      fim: null,
      prestador: null,
    };
    await porta.incluirItem(c, t.id, item, trilha('operadora.remuneracao.item.incluido'));
    expect(await recusada(porta.incluirItem(c, t.id, item, trilha('x')))).toBe('item-sobreposto');
    await porta.incluirRegra(
      c,
      m.operadora,
      {
        codigo: `${COD}-R1`,
        descricao: 'NOTURNO SINTETICO',
        prioridade: 10,
        prestador: m.prestador,
        tipoPrestador: null,
        grupo: null,
        item: null,
        tabela: t.id,
        fator: 1.2,
        acrescimo: 30,
        diaSemana: null,
        horaInicio: '19:00',
        horaFim: '07:00',
        inicio: '2030-01-01',
        fim: null,
      },
      trilha('operadora.remuneracao.regra.incluida'),
    );
    const base = {
      prestador: m.prestador,
      procedimento: m.termo,
      item: null,
      grupo: null,
      data: '2030-06-10',
      urgencia: false,
      quantidade: 1,
    };
    const noite = await porta.valorar(c, m.operadora, { ...base, hora: '23:00' });
    const dia = await porta.valorar(c, m.operadora, { ...base, hora: '10:00' });
    expect([noite.valorUnitarioTabela, noite.acrescimoPercentual, noite.valor, dia.valor]).toEqual([
      74, 30, 115.44, 88.8,
    ]);
    const gravada = await um(
      'SELECT tipo_valor, valor_ch, (SELECT COUNT(*) FROM tabela_remuneracao_rede_item WHERE tabela_remuneracao_rede_id = t.id) AS n FROM tabela_remuneracao_rede t WHERE id = ?',
      [t.id],
    );
    expect([gravada['tipo_valor'], Number(gravada['valor_ch']), Number(gravada['n'])]).toEqual([
      'indice',
      0.5,
      1,
    ]);
  });

  it('reajuste do contrato encerra o item antigo, inclui o reajustado e reajusta as unidades', async () => {
    const c = contexto(m);
    const t = Number(
      (
        await um('SELECT id FROM tabela_remuneracao_rede WHERE operadora_saude_id = ? AND codigo = ?', [
          m.operadora,
          `${COD}-T1`,
        ])
      )['id'],
    );
    const r = await porta
      .reajustar(
        c,
        contrato,
        {
          forma: 'indice_contratual',
          indice: null,
          percentual: 10,
          dataBase: '2031-03-01',
          inicio: '2031-03-01',
          descricao: null,
          tabela: t,
          grupo: null,
        },
        trilha('x'),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(r).toBe('indice-ausente');
    const ok = await porta.reajustar(
      c,
      contrato,
      {
        forma: 'acordo',
        indice: null,
        percentual: 10,
        dataBase: '2031-03-01',
        inicio: '2031-03-01',
        descricao: 'TERMO SINTETICO C2120',
        tabela: t,
        grupo: null,
      },
      trilha('operadora.remuneracao.reajuste.aplicado'),
    );
    expect(ok.itens).toBe(1);
    const linhas = await ler(
      'SELECT vigencia_inicio, vigencia_fim FROM tabela_remuneracao_rede_item WHERE tabela_remuneracao_rede_id = ? ORDER BY sequencia',
      [t],
    );
    expect(
      linhas.map((l) => [
        String(l['vigencia_inicio']).slice(0, 10),
        l['vigencia_fim'] ? String(l['vigencia_fim']).slice(0, 10) : null,
      ]),
    ).toHaveLength(2);
    const tab = await um('SELECT valor_ch, valor_uco FROM tabela_remuneracao_rede WHERE id = ?', [t]);
    expect([Number(tab['valor_ch']), Number(tab['valor_uco'])]).toEqual([0.55, 13.2]);
    const rj = await um(
      'SELECT forma, percentual, proximo_reajuste FROM reajuste_contrato_rede WHERE id = ?',
      [ok.id],
    );
    expect([rj['forma'], Number(rj['percentual'])]).toEqual(['acordo', 10]);
    // Valoração antes e depois do reajuste: o histórico vale para a data do evento.
    const antes = await porta.valorar(c, m.operadora, {
      prestador: m.prestador,
      procedimento: m.termo,
      item: null,
      grupo: null,
      data: '2031-02-10',
      hora: '10:00',
      urgencia: false,
      quantidade: 1,
    });
    expect(antes.valorUnitarioTabela).toBe(81.4); // 100 × 0,55 + 2 × 13,2 (unidades já reajustadas)
  });

  it('pacote com o principal e recusa do principal fora', async () => {
    const c = contexto(m);
    const [principal, outro] = itens as [number, number];
    expect(
      await recusada(
        porta.incluirPacote(
          c,
          m.operadora,
          {
            codigo: `${COD}-P0`,
            descricao: 'X',
            prestador: m.prestador,
            principal,
            tipo: 'cirurgico',
            regime: 'internacao',
            diarias: 2,
            valorGlobal: 5000,
            inicio: '2031-01-01',
            fim: null,
            inclusoes: null,
            itens: [{ item: principal, inclusao: 'excluido', quantidade: null }],
          },
          trilha('x'),
        ),
      ),
    ).toBe('principal-excluido');
    const p = await porta.incluirPacote(
      c,
      m.operadora,
      {
        codigo: `${COD}-P1`,
        descricao: 'PACOTE SINTETICO',
        prestador: m.prestador,
        principal,
        tipo: 'cirurgico',
        regime: 'internacao',
        diarias: 2,
        valorGlobal: 5000,
        inicio: '2031-01-01',
        fim: null,
        inclusoes: 'Diárias e taxas',
        itens: outro ? [{ item: outro, inclusao: 'excluido', quantidade: null }] : [],
      },
      trilha('operadora.remuneracao.pacote.incluido'),
    );
    const linhas = await ler(
      'SELECT item_faturavel_id, principal, inclusao FROM pacote_remuneracao_rede_item WHERE pacote_remuneracao_rede_id = ? ORDER BY sequencia',
      [p.id],
    );
    expect(linhas[0]).toMatchObject({ item_faturavel_id: principal, inclusao: 'incluido' });
    expect(Number(linhas[0]?.['principal'])).toBe(1);
  });

  it('calendário da competência e o fechamento', async () => {
    const c = contexto(m);
    const cal = {
      competencia: COMP,
      prestador: null,
      atendimentoInicio: '2031-02-01',
      atendimentoFim: '2031-02-28',
      entregaInicio: '2031-03-01',
      entregaFim: '2031-03-10',
      corte: '2031-03-15',
      pagamento: '2031-04-10',
    };
    expect(
      await recusada(
        porta.incluirCalendario(c, m.operadora, { ...cal, pagamento: '2031-03-01' }, trilha('x')),
      ),
    ).toBe('pagamento-antes-do-corte');
    const k = await porta.incluirCalendario(
      c,
      m.operadora,
      cal,
      trilha('operadora.remuneracao.calendario.incluido'),
    );
    expect(await recusada(porta.incluirCalendario(c, m.operadora, cal, trilha('x')))).toBe(
      'competencia-em-uso',
    );
    await porta.fecharCalendario(c, k.id, 1, trilha('operadora.remuneracao.calendario.fechado'));
    const g = await um(
      'SELECT dias_para_pagamento, fechado, fechado_em IS NOT NULL AS f FROM calendario_pagamento_rede WHERE id = ?',
      [k.id],
    );
    expect([Number(g['dias_para_pagamento']), Number(g['fechado']), Number(g['f'])]).toEqual([41, 1, 1]);
  });

  it('adiantamento com título; lote com tributos; fechar compensa e gera o título com a retenção', async () => {
    const c = contexto(m);
    const ad = await porta.incluirAdiantamento(
      c,
      m.prestador,
      {
        descricao: `${COD} adiantamento sintetico`,
        data: '2031-03-05',
        valor: 1000,
        parcelas: 2,
        inicioCompensacao: COMP,
        natureza,
        documento,
        vencimento: '2031-03-06',
      },
      trilha('operadora.remuneracao.adiantamento.incluido'),
    );
    const ta = await um('SELECT tipo_titulo, valor_bruto, valor_liquido FROM titulo_pagar WHERE id = ?', [
      ad.titulo,
    ]);
    expect([ta['tipo_titulo'], Number(ta['valor_bruto']), Number(ta['valor_liquido'])]).toEqual([
      'adiantamento',
      1000,
      1000,
    ]);

    // O cadastro manda a alíquota e o mínimo: IRRF 1,5% com mínimo de R$ 10,00 e ISS 5% na data do pagamento.
    const pessoa = String(
      (await um('SELECT pessoa FROM prestador_rede WHERE id = ?', [m.prestador]))['pessoa'],
    );
    await escrever(async (e) => {
      for (const [t, aliq, min] of [
        [irrf, 1.5, 10],
        [iss, 5, null],
      ] as const)
        await e.executar(
          `INSERT INTO aliquota_tributo_vigencia (estabelecimento_id, tributo_id, aplicacao, tipo_pessoa, aliquota,
             valor_minimo_retencao, vigencia_inicio, ativo, criado_em) VALUES (?, ?, 'retencao_pagar', ?, ?, ?, ?, TRUE, NOW(3))`,
          [m.est, t, pessoa, aliq, min, COMP],
        );
    });
    const novaConta = (liberado: number) =>
      escrever((e) =>
        e.inserir(
          `INSERT INTO lote_conta_recebida (estabelecimento_id, operadora_saude_id, prestador_rede_id, numero_protocolo, numero_lote_prestador,
             tipo_guia, competencia, canal_envio, quantidade_guias, valor_apresentado, valor_glosado, valor_liberado, recebido_em, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, 'consulta', '2031-03-01', 'portal', 1, ?, 500, ?, NOW(3), 'analisada', NOW(3))`,
          [
            m.est,
            m.operadora,
            m.prestador,
            `${COD}${Date.now() % 1e9}`,
            `${COD}-${Date.now() % 1e9}`,
            liberado + 500,
            liberado,
          ],
        ),
      ) as Promise<number>;
    const conta = await novaConta(10000);
    const pequena = await novaConta(500);
    const contas = new PortaContasOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
      { autorizacoesPorSenha: async () => [], designacoes: async () => [] },
    );
    const pagarAvulso = (id: number) =>
      recusada(
        contas.gravar(c, trilhaTela(m, 'lote_conta_recebida', 'x'), (g) =>
          g.pagar({
            id,
            versao: 1,
            usuario: 'x',
            valor: 1,
            data: '2031-04-10',
            documento: 'TED',
            situacao: 'paga',
          }),
        ),
      );
    const base = {
      prestador: m.prestador,
      competencia: COMP,
      vencimento: '2031-04-10',
      mensagemPrestador: null,
    };
    // Mínimo de retenção do cadastro: 1,5% de R$ 500,00 = R$ 7,50, abaixo de R$ 10,00: calculado e não retido.
    const lp0 = await porta.criarLote(
      c,
      m.operadora,
      { ...base, contas: [pequena], tributos: [{ tributo: irrf, aliquota: null, deducao: 0 }] },
      trilha('operadora.remuneracao.lote.criado'),
    );
    expect([
      lp0.calculo.tributos[0]?.aliquota,
      lp0.calculo.tributos[0]?.imposto,
      lp0.calculo.valorTributos,
    ]).toEqual([1.5, 7.5, 0]);
    // A conta num lote calculado não é paga pelo pagamento avulso (pagaria duas vezes).
    expect(await pagarAvulso(pequena)).toBe('conta-em-lote-pagamento');
    await porta.cancelarLote(c, lp0.id, 1, trilha('operadora.remuneracao.lote.cancelado'));
    // Retenção acima do bruto e exceção sem motivo são recusadas.
    expect(
      await recusada(
        porta.criarLote(
          c,
          m.operadora,
          {
            ...base,
            contas: [pequena],
            tributos: [
              { tributo: irrf, aliquota: 60, deducao: 0, motivo: 'Teste do limite' },
              { tributo: iss, aliquota: 60, deducao: 0, motivo: 'Teste do limite' },
            ],
          },
          trilha('x'),
        ),
      ),
    ).toBe('retencao-acima-do-bruto');
    expect(
      await recusada(
        porta.criarLote(
          c,
          m.operadora,
          { ...base, contas: [conta], tributos: [{ tributo: iss, aliquota: 2, deducao: 0 }] },
          trilha('x'),
        ),
      ),
    ).toBe('excecao-sem-motivo');
    const lote = {
      ...base,
      contas: [conta],
      tributos: [
        { tributo: irrf, aliquota: null, deducao: 0 },
        { tributo: iss, aliquota: 2, deducao: 0, motivo: 'Alíquota do contrato do prestador' },
      ],
    };
    expect(await recusada(porta.criarLote(c, m.operadora, { ...lote, contas: [] }, trilha('x')))).toBe(
      'lote-vazio',
    );
    const l = await porta.criarLote(c, m.operadora, lote, trilha('operadora.remuneracao.lote.criado'));
    expect([l.calculo.valorTributos, l.calculo.liquidoLote]).toEqual([350, 9650]);
    expect(l.excecoes).toEqual([iss]);
    const det = await ler(
      'SELECT aliquota, detalhamento FROM lote_pagamento_rede_tributo WHERE lote_pagamento_rede_id = ? ORDER BY sequencia',
      [l.id],
    );
    expect(det.map((r) => Number(r['aliquota']))).toEqual([1.5, 2]);
    expect(String(det[1]?.['detalhamento'])).toContain('Exceção: alíquota 2%');
    expect(await recusada(porta.criarLote(c, m.operadora, lote, trilha('x')))).toBe('conta-indisponivel');

    const f = await porta.fecharLote(
      c,
      l.id,
      { versao: 1, natureza, documento },
      trilha('operadora.remuneracao.lote.fechado'),
    );
    expect([f.compensado, f.liquidoTitulo]).toEqual([500, 9150]);
    const t = await um(
      'SELECT valor_bruto, valor_desconto, valor_retencoes, valor_liquido, empresa_fornecedora_id IS NOT NULL OR profissional_id IS NOT NULL AS credor FROM titulo_pagar WHERE id = ?',
      [f.titulo],
    );
    expect([
      Number(t['valor_bruto']),
      Number(t['valor_desconto']),
      Number(t['valor_retencoes']),
      Number(t['valor_liquido']),
      Number(t['credor']),
    ]).toEqual([10000, 500, 350, 9150, 1]);
    const ret = await ler(
      'SELECT r.tributo_id, r.valor_retido FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id WHERE p.titulo_pagar_id = ? ORDER BY r.sequencia',
      [f.titulo],
    );
    expect(ret.map((r) => [Number(r['tributo_id']), Number(r['valor_retido'])])).toEqual([
      [irrf, 150],
      [iss, 200],
    ]);
    const lp = await um(
      `SELECT situacao, valor_bruto, valor_tributos, valor_liquido,
              (SELECT COUNT(*) FROM lote_pagamento_rede_item WHERE lote_pagamento_rede_id = l.id AND titulo_pagar_id = ?) AS itens,
              (SELECT COUNT(*) FROM lote_pagamento_rede_tributo WHERE lote_pagamento_rede_id = l.id AND retencao_titulo_id IS NOT NULL) AS tributos
         FROM lote_pagamento_rede l WHERE id = ?`,
      [f.titulo, l.id],
    );
    expect([
      lp['situacao'],
      Number(lp['valor_bruto']),
      Number(lp['valor_tributos']),
      Number(lp['valor_liquido']),
      Number(lp['itens']),
      Number(lp['tributos']),
    ]).toEqual(['fechado', 10000, 350, 9650, 1, 2]);
    const a = await um('SELECT valor_compensado, situacao FROM adiantamento_rede WHERE id = ?', [ad.id]);
    expect([Number(a['valor_compensado']), a['situacao']]).toEqual([500, 'compensando']);
    const deb = await um(
      "SELECT COUNT(*) AS n, SUM(valor) AS v FROM lancamento_avulso_prestador WHERE lote_pagamento_rede_id = ? AND natureza = 'debito' AND tipo = 'adiantamento'",
      [l.id],
    );
    expect([Number(deb['n']), Number(deb['v'])]).toEqual([1, 500]);
    expect(await recusada(porta.fecharLote(c, l.id, { versao: 2, natureza, documento }, trilha('x')))).toBe(
      'lote-nao-calculado',
    );
    // A conta do lote fechado fica paga pelo título e não pode ser paga de novo.
    const pg = await um(
      'SELECT situacao, valor_pago, pago_em IS NOT NULL AS data, documento_pagamento FROM lote_conta_recebida WHERE id = ?',
      [conta],
    );
    expect([pg['situacao'], Number(pg['valor_pago']), Number(pg['data'])]).toEqual(['paga', 10000, 1]);
    expect(String(pg['documento_pagamento'])).toContain(f.tituloNumero);
    expect(await pagarAvulso(conta)).toBe('conta-nao-analisada');
    const visao = await porta.prestadorPagamento(c, m.operadora, m.prestador);
    expect(visao.lotes.find((x) => x.id === l.id)?.tituloNumero).toBe(f.tituloNumero);
  });
});
