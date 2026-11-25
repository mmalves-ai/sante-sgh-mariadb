// F7, 07-FIN linha 110: contrato de efeito da apuração do retido pelo hospital e da guia, contra o MariaDB real (massa
// SINTÉTICA "L0207"; nenhuma pessoa real). O recolhimento grava, na mesma transação, um título, uma guia e uma apuração
// "retido_de_terceiros" por código de receita (a retenção sem código herda o do tributo ou o informado); o tipo da guia
// vem da esfera (IRRF federal no DARF; ISS municipal na guia do município, sem a regra dos quatro dígitos). A guia nasce
// emitida e a apuração fechada; a baixa do título passa a guia a paga e a apuração a recolhida; a exclusão do título
// cancela as duas e devolve o retido ao aberto. O batimento confere o retido com os eventos vigentes da EFD-Reinf em
// que o hospital é o tomador (R-2010, R-4010, R-4020): R-4080 e R-2020 ficam fora.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apuracoesRetido, batimentoReinf, darfDaGuia } from '../apuracao-retido-propria.js';
import { OPERACOES_CONTABIL_FISCAL, retidoEmAberto } from '../contabil-fiscal-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const COMP = '2026-08';
const CNPJ_SINTETICO = '92070110000105';
const HOJE = new Date().toISOString().slice(0, 10);
const trilha = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'titulo_pagar',
  entidadeId: 0,
  correlacao: null,
};
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-ar-${randomUUID()}` });

describe.skipIf(SEM_BANCO)('apuração do retido, DARF e batimento com a Reinf (MariaDB)', () => {
  let m: MassaFinanceiro;
  let natureza = 0;
  let receitaA = 0;
  let receitaB = 0;
  let retencaoB = 0;
  let iss = 0;
  let porta: PortaFinanceiroPropria;
  let tituloA = 0;
  let tituloB = 0;
  let cnpjOriginal: string | null = null;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'ar-110' }, (l) => l.consultar(sql, p));
  const ler = <T>(fn: (l: Parameters<Parameters<typeof m.nucleo.lerSomente>[1]>[0]) => Promise<T>) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'ar-110-ler' }, fn);
  const entrada = (codigoReceita: string | null, tributo = m.tributo) => ({
    competencia: COMP,
    tributo,
    credor: m.fornecedor,
    natureza,
    codigoReceita,
  });
  const guiaLida = async (id: number) =>
    (
      await consultar(
        `SELECT g.tipo_guia, g.codigo_receita_federal_id, g.codigo_receita, g.situacao, g.data_pagamento, g.valor_total,
                a.situacao AS apuracao, (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id) AS itens
           FROM guia_recolhimento g JOIN apuracao_retencao a ON a.guia_recolhimento_id = g.id
          WHERE g.titulo_pagar_id = ? AND g.estabelecimento_id = ?`,
        [id, m.est],
      )
    )[0];
  const recolher = (entrada: unknown) =>
    m.nucleo
      .criarExecutor()
      .executar(
        OPERACOES_CONTABIL_FISCAL['financeiro.gerarRecolhimentoRetencao'] as never,
        CLIENTE,
        entrada,
        op(m.ctx(m.lanca)),
      );
  const limparReinf = (e: Escritor) =>
    e
      .executar(
        'DELETE i FROM evento_reinf_item i JOIN evento_reinf e ON e.id = i.evento_reinf_id WHERE e.estabelecimento_id = ? AND e.competencia = ?',
        [m.est, `${COMP}-01`],
      )
      .then(() =>
        e.executar(
          'UPDATE evento_reinf SET retificado_evento_reinf_id = NULL WHERE estabelecimento_id = ? AND competencia = ?',
          [m.est, `${COMP}-01`],
        ),
      )
      .then(() =>
        e.executar('DELETE FROM evento_reinf WHERE estabelecimento_id = ? AND competencia = ?', [
          m.est,
          `${COMP}-01`,
        ]),
      );

  beforeAll(async () => {
    m = await montarMassa();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
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
    ({ natureza, receitaA, receitaB, retencaoB, iss, cnpjOriginal } = await m.nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-ar-110' },
      async (e) => {
        await limparReinf(e);
        const agora = new Date();
        const n = Number(
          (await e.uma<{ id: number }>("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'", []))
            ?.id,
        );
        const tc = Number(
          (await e.uma<{ id: number }>("SELECT id FROM tipo_credor WHERE codigo = 'fornecedor'", []))?.id,
        );
        const td = Number(
          (await e.uma<{ id: number }>('SELECT id FROM tipo_documento_financeiro ORDER BY id LIMIT 1', []))
            ?.id,
        );
        const receita = async (codigo: string) =>
          Number(
            (
              await e.uma<{ id: number }>(
                "SELECT id FROM codigo_receita_federal WHERE documento_arrecadacao = 'darf' AND codigo_receita = ?",
                [codigo],
              )
            )?.id ??
              (await e.inserir(
                "INSERT INTO codigo_receita_federal (documento_arrecadacao, codigo_receita, descricao, versao_fonte, criado_em) VALUES ('darf', ?, 'RECEITA SINTETICA L0207', 'teste', ?)",
                [codigo, agora],
              )),
          );
        const a = await receita('1708');
        const b = await receita('3280');
        // O estabelecimento de teste ganha um CNPJ sintético para o DARF (o original volta no fim).
        const est = await e.uma<{ cnpj: string | null }>('SELECT cnpj FROM estabelecimento WHERE id = ?', [
          m.est,
        ]);
        if (!est?.cnpj)
          await e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ?', [CNPJ_SINTETICO, m.est]);
        // O ISS retido (tributo municipal sintético) com o código do município, fora do padrão de quatro dígitos.
        const tributoIss =
          Number(
            (await e.uma<{ id: number }>("SELECT id FROM tributo WHERE codigo = 'L0207-ISSM'", []))?.id,
          ) ||
          (await e.inserir(
            "INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, codigo_receita, criado_em) VALUES ('L0207-ISSM', 'ISS SINTETICO L0207', 'municipal', 'por_pagamento', 'retido', 'ISS-1401', ?)",
            [agora],
          ));
        const titulo = async (
          doc: string,
          bruto: number,
          retido: number,
          codigo: number | null,
          tributo = m.tributo,
        ) => {
          const t = await e.inserir(
            `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
               numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
               referente, situacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, '2026-08-05', '2026-08-05', ?, ?, ?, ?, 'SERVICO SINTETICO', 'aberto', ?)`,
            [m.est, `L0207-${doc}`, tc, m.fornecedor, td, doc, bruto, retido, bruto - retido, n, agora],
          );
          const p = await e.inserir(
            `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
             VALUES (?, 1, '2026-08-30', '2026-08-30', ?, ?, ?)`,
            [t, bruto - retido, bruto - retido, agora],
          );
          return e.inserir(
            `INSERT INTO retencao_titulo (parcela_pagar_id, sequencia, tributo_id, codigo_receita_federal_id, competencia,
               data_fato_gerador, base_calculo, aliquota, valor_retido, criado_em)
             VALUES (?, 1, ?, ?, '2026-08-01', '2026-08-05', ?, 1.5, ?, ?)`,
            [p, tributo, codigo, bruto, retido, agora],
          );
        };
        await titulo('L0207AR1', 1000, 15, a);
        await titulo('L0207AR2', 2000, 30, null);
        const rb = await titulo('L0207AR3', 400, 6, b);
        await titulo('L0207AR4', 200, 4, await receita('0588'));
        await titulo('L0207AR5', 1000, 20, null, tributoIss);
        // A Reinf da competência: um R-4020 vigente com IRRF de 40,00, um rejeitado e um original já retificado (fora).
        const evento = async (
          situacao: string,
          irrf: number,
          retifica: number | null = null,
          codigoEvento = 'R-4020',
          inss = 0,
        ) => {
          const ev = await e.inserir(
            `INSERT INTO evento_reinf (estabelecimento_id, competencia, codigo_evento, acao, situacao, retificado_evento_reinf_id, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              m.est,
              `${COMP}-01`,
              codigoEvento,
              retifica ? 'retificacao' : 'inclusao',
              situacao,
              retifica,
              agora,
            ],
          );
          await e.inserir(
            "INSERT INTO evento_reinf_item (evento_reinf_id, sequencia, tipo_item, valor_irrf, valor_inss, criado_em) VALUES (?, 1, 'pagamento', ?, ?, ?)",
            [ev, irrf, inss, agora],
          );
          return ev;
        };
        const original = await evento('gerado', 99);
        await evento('gerado', 40, original);
        await evento('rejeitado', 500);
        // O hospital como prestador (retido pelos tomadores dele): fora do batimento do retido pelo hospital.
        await evento('gerado', 7, null, 'R-4080');
        await evento('gerado', 0, null, 'R-2020', 9);
        return {
          natureza: n,
          receitaA: a,
          receitaB: b,
          retencaoB: rb,
          iss: tributoIss,
          cnpjOriginal: est?.cnpj && est.cnpj !== CNPJ_SINTETICO ? est.cnpj : null,
        };
      },
    ));
  });

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-ar-110' }, async (e) => {
      await e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ?', [cnpjOriginal, m.est]);
      await limparReinf(e);
    });
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-ar-110-iss' }, (e) =>
      e.executar("DELETE FROM tributo WHERE codigo = 'L0207-ISSM' AND id = ?", [iss]),
    );
  });

  it('retenção sem código e tributo sem código padrão: recusa pedindo o código, sem título, guia nem apuração', async () => {
    expect(await codigoDaGravacao(recolher(entrada(null)))).toBe('sem-codigo-receita');
    const [n] = await consultar(
      `SELECT (SELECT COUNT(*) FROM guia_recolhimento WHERE estabelecimento_id = ?) AS guias,
              (SELECT COUNT(*) FROM apuracao_retencao WHERE estabelecimento_id = ? AND sentido = 'retido_de_terceiros') AS apuracoes`,
      [m.est, m.est],
    );
    expect([Number(n?.['guias']), Number(n?.['apuracoes'])]).toEqual([0, 0]);
    // O retido em aberto mostra uma linha por tributo e código (a sem código fica nula: a tela pede o código).
    const aberto = await ler((l) => retidoEmAberto(l, m.est, COMP));
    expect(aberto.map((a) => [a.tipoGuia, a.codigoReceita, a.retencoes, a.valor])).toEqual([
      ['darf', null, 1, 30],
      ['darf', '0588', 1, 4],
      ['darf', '1708', 1, 15],
      ['darf', '3280', 1, 6],
      ['guia_municipal', 'ISS-1401', 1, 20],
    ]);
  });

  it('batimento: o retido (55,00) contra o R-4020 vigente (40,00); rejeitado, retificado, R-4080 e R-2020 fora', async () => {
    const b = await ler((l) => batimentoReinf(l, m.est, COMP));
    expect(b.eventosReinf).toBe(1);
    expect(b.linhas).toEqual([{ grupo: 'irrf', apurado: 55, reinf: 40, diferenca: 15, confere: false }]);
    expect(b.foraDaReinf).toEqual(['L0207-ISSM']);
    expect(b.confere).toBe(false);
  });

  it('dois DARFs do IRRF na mesma competência: 1708 (com a sem código) e, num só clique, 0588 e 3280', async () => {
    const r = await recolher(entrada('1708'));
    const guia = Number(r.resultado['guia']);
    const apuracao = Number(r.resultado['apuracao']);
    tituloA = Number(r.resultado['tituloPagar']);
    expect([
      r.resultado['codigoReceita'],
      r.resultado['valor'],
      r.resultado['retencoes'],
      r.resultado['guias'],
    ]).toEqual(['1708', 45, 2, 1]);
    const [g] = await consultar(
      `SELECT tipo_guia, codigo_receita_federal_id, codigo_receita, competencia, periodo_apuracao, data_vencimento,
              valor_principal, valor_total, titulo_pagar_id, situacao FROM guia_recolhimento WHERE id = ? AND estabelecimento_id = ?`,
      [guia, m.est],
    );
    const dia = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    expect([
      g?.['tipo_guia'],
      Number(g?.['codigo_receita_federal_id']),
      g?.['codigo_receita'],
      dia(g?.['competencia']),
      dia(g?.['periodo_apuracao']),
      dia(g?.['data_vencimento']).slice(0, 7),
      Number(g?.['valor_principal']),
      Number(g?.['valor_total']),
      Number(g?.['titulo_pagar_id']),
      g?.['situacao'],
    ]).toEqual(['darf', receitaA, null, '2026-08-01', '2026-08-31', '2026-09', 45, 45, tituloA, 'emitida']);
    const [a] = await consultar(
      `SELECT sentido, situacao, codigo_receita_federal_id, guia_recolhimento_id, titulo_pagar_id, valor_base_total, valor_total,
              (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id AND i.parcela_pagar_id IS NOT NULL) AS itens,
              (SELECT SUM(i.valor_retido) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id) AS soma
         FROM apuracao_retencao a WHERE a.id = ? AND a.estabelecimento_id = ?`,
      [apuracao, m.est],
    );
    // Apurada (fechada) até a baixa do título.
    expect([
      a?.['sentido'],
      a?.['situacao'],
      Number(a?.['codigo_receita_federal_id']),
      Number(a?.['guia_recolhimento_id']),
      Number(a?.['titulo_pagar_id']),
      Number(a?.['valor_base_total']),
      Number(a?.['valor_total']),
      Number(a?.['itens']),
      Number(a?.['soma']),
    ]).toEqual(['retido_de_terceiros', 'fechada', receitaA, guia, tituloA, 3000, 45, 2, 45]);
    const [fora] = await consultar(
      'SELECT COUNT(*) AS n FROM apuracao_retencao_item WHERE retencao_titulo_id = ?',
      [retencaoB],
    );
    expect(Number(fora?.['n'])).toBe(0);

    // Sem código informado: uma guia por código restante (0588 e 3280), cada uma com o seu título e a sua apuração.
    const r2 = await recolher(entrada(null));
    expect([r2.resultado['guias'], r2.resultado['valor'], r2.resultado['retencoes']]).toEqual([2, 10, 2]);
    const segundas = await consultar(
      `SELECT g.titulo_pagar_id, COALESCE(c.codigo_receita, g.codigo_receita) AS receita, g.valor_total, g.tipo_guia,
              a.situacao, a.valor_total AS apurado
         FROM guia_recolhimento g JOIN apuracao_retencao a ON a.guia_recolhimento_id = g.id
         LEFT JOIN codigo_receita_federal c ON c.id = g.codigo_receita_federal_id
        WHERE g.estabelecimento_id = ? AND g.id <> ? ORDER BY g.id`,
      [m.est, guia],
    );
    expect(
      segundas.map((x) => [
        x['receita'],
        Number(x['valor_total']),
        x['tipo_guia'],
        x['situacao'],
        Number(x['apurado']),
      ]),
    ).toEqual([
      ['0588', 4, 'darf', 'fechada', 4],
      ['3280', 6, 'darf', 'fechada', 6],
    ]);
    expect(new Set(segundas.map((x) => Number(x['titulo_pagar_id']))).size).toBe(2);
    tituloB = Number(segundas[1]?.['titulo_pagar_id']);
    const [rb] = await consultar(
      'SELECT recolhimento_titulo_pagar_id AS t FROM retencao_titulo WHERE id = ?',
      [retencaoB],
    );
    expect(Number(rb?.['t'])).toBe(tituloB);
    expect(receitaB).toBeGreaterThan(0);

    const lista = await ler((l) => apuracoesRetido(l, m.est, COMP));
    expect(lista.map((x) => [x.codigoReceita, x.total, x.somaParcelas, x.situacao, x.tipoGuia])).toEqual([
      ['1708', 45, 45, 'fechada', 'darf'],
      ['0588', 4, 4, 'fechada', 'darf'],
      ['3280', 6, 6, 'fechada', 'darf'],
    ]);
    expect(lista[0]?.parcelas).toEqual([{ codigoReceita: '1708', retencoes: 2, base: 3000, valor: 45 }]);

    const darf = await ler((l) => darfDaGuia(l, m.est, guia));
    expect(darf.campos.map((c) => c.numero)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
    ]);
    const campo = Object.fromEntries(darf.campos.map((c) => [c.numero, c.valor]));
    expect([campo['02'], campo['04'], campo['07'], campo['10'], darf.total]).toEqual([
      '31/08/2026',
      '1708',
      '45,00',
      '45,00',
      45,
    ]);
    expect(await codigoDaGravacao(ler((l) => darfDaGuia(l, m.outroEst, guia)))).toBe('guia-inexistente');
    const [t] = await consultar(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'titulo_pagar' AND entidade_id = ?",
      [tituloA],
    );
    expect(Number(t?.['n'])).toBeGreaterThan(0);
    // O batimento olha o retido, não o recolhido: segue 55,00 contra 40,00.
    const b = await ler((l) => batimentoReinf(l, m.est, COMP));
    expect(b.linhas).toEqual([{ grupo: 'irrf', apurado: 55, reinf: 40, diferenca: 15, confere: false }]);
  });

  it('ISS retido (municipal): guia do município com o código do ente, sem a regra do DARF e sem DARF', async () => {
    const r = await recolher(entrada(null, iss));
    expect([r.resultado['tipoGuia'], r.resultado['codigoReceita'], r.resultado['valor']]).toEqual([
      'guia_municipal',
      'ISS-1401',
      20,
    ]);
    const g = await guiaLida(Number(r.resultado['tituloPagar']));
    expect([
      g?.['tipo_guia'],
      g?.['codigo_receita_federal_id'],
      g?.['codigo_receita'],
      g?.['situacao'],
      g?.['apuracao'],
    ]).toEqual(['guia_municipal', null, 'ISS-1401', 'emitida', 'fechada']);
    expect(await codigoDaGravacao(ler((l) => darfDaGuia(l, m.est, Number(r.resultado['guia']))))).toBe(
      'guia-nao-darf',
    );
  });

  it('baixa do título: guia paga com a data e apuração recolhida; exclusão: guia e apuração canceladas, retido volta', async () => {
    const parcela = async (titulo: number) =>
      Number(
        (
          await consultar('SELECT id FROM parcela_pagar WHERE titulo_pagar_id = ? AND excluido_em IS NULL', [
            titulo,
          ])
        )[0]?.['id'],
      );
    const pa = await parcela(tituloA);
    await porta.gravarSgh(op(m.ctx(m.aprova)), trilha, (g) =>
      g.aprovarTitulo({ titulo: pa, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
    await porta.executar(
      m.ctx(m.paga),
      'financeiro.baixarTitulo',
      {
        cenario: 'pagar',
        titulos: [{ titulo: pa, versao: null }],
        conta: m.contaA,
        dataPagamento: HOJE,
        formaPagamento: 1,
        porBordero: false,
      },
      op(m.ctx(m.paga)),
    );
    const pago = await guiaLida(tituloA);
    const dia = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    expect([pago?.['situacao'], dia(pago?.['data_pagamento']), pago?.['apuracao']]).toEqual([
      'paga',
      HOJE,
      'recolhida',
    ]);

    const pb = await parcela(tituloB);
    await porta.executar(
      m.ctx(m.lanca),
      'financeiro.criarTituloPagar',
      { acao: 'excluir', titulo: pb, versao: null },
      op(m.ctx(m.lanca)),
    );
    const cancelada = await guiaLida(tituloB);
    // A apuração cancelada guarda os itens como histórico; a retenção volta ao retido em aberto.
    expect([
      cancelada?.['situacao'],
      cancelada?.['data_pagamento'],
      cancelada?.['apuracao'],
      Number(cancelada?.['itens']),
    ]).toEqual(['cancelada', null, 'cancelada', 1]);
    const [rb] = await consultar(
      'SELECT recolhimento_titulo_pagar_id AS t FROM retencao_titulo WHERE id = ?',
      [retencaoB],
    );
    expect(rb?.['t']).toBeNull();
    const aberto = await ler((l) => retidoEmAberto(l, m.est, COMP));
    expect(aberto.map((a) => [a.codigoReceita, a.valor])).toEqual([['3280', 6]]);
    // Recolher de novo o 3280: nova guia e nova apuração, sem tocar a cancelada.
    const r = await recolher(entrada('3280'));
    expect([r.resultado['guias'], r.resultado['valor']]).toEqual([1, 6]);
    const nova = await guiaLida(Number(r.resultado['tituloPagar']));
    expect([nova?.['situacao'], nova?.['apuracao']]).toEqual(['emitida', 'fechada']);
    expect((await guiaLida(tituloB))?.['situacao']).toBe('cancelada');
  });
});
