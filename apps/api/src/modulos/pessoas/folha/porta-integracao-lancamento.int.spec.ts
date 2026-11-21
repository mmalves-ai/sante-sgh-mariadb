// Lançamento dos títulos da folha contra o MariaDB real, no cliente de teste do lote (SGH_CLIENTE_TESTE; padrão
// f24p_folha): a massa do financeiro (fornecedor, classificação 9207.1.1, tipos de credor e documento) e um lote
// recebido conferido da folha externa (competência 2099-05). Prova o efeito na mesma transação: títulos a pagar,
// lançamento, títulos da folha, fatos contábeis e o retorno marcado como lançado; e as recusas (folha repetida, soma
// divergente, retorno não conferido). Tudo sintético, apagado no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import type { IncluirTitulosFolhaEntrada } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  CLIENTE,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from '../../financeiro/aplicacao/massa-banco.spec-util.js';
import { PortaFolhaPropria } from './porta-folha-propria.js';
import { PortaIntegracaoFolhaPropria } from './porta-integracao-propria.js';
import { OPERACAO_TITULOS_FOLHA } from './servico-integracao.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO)('lançamento dos títulos da folha sobre o MariaDB', () => {
  let m: MassaFinanceiro;
  let folha: PortaFolhaPropria;
  let porta: PortaIntegracaoFolhaPropria;
  let c: ContextoPortaM18;
  let lote = 0;
  let exportado = 0;
  let competencia = 0;
  const documentoBase = 9_300_000 + Math.floor(Math.random() * 90_000);

  async function limpar() {
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-lancamento-folha' }, async (e) => {
      const lancs = `SELECT id FROM lancamento_titulos_folha WHERE estabelecimento_id = ${Number(m.est)}`;
      await e.executar(
        `DELETE FROM fato_contabil WHERE entidade_origem = 'lancamento_titulos_folha' AND entidade_origem_id IN (${lancs})`,
      );
      const titulos = (
        await e.consultar(
          `SELECT titulo_pagar_id FROM titulo_folha WHERE lancamento_titulos_folha_id IN (${lancs})`,
        )
      ).map((r) => Number(r['titulo_pagar_id']));
      await e.executar(`DELETE FROM titulo_folha WHERE lancamento_titulos_folha_id IN (${lancs})`);
      await e.executar('DELETE FROM lancamento_titulos_folha WHERE estabelecimento_id = ?', [m.est]);
      for (const t of titulos) {
        await e.executar('DELETE FROM parcela_pagar WHERE titulo_pagar_id = ?', [t]);
        await e.executar('DELETE FROM titulo_pagar WHERE id = ?', [t]);
      }
      await e.executar(
        `DELETE r FROM lote_folha_intercambio_resumo r
           JOIN lote_folha_intercambio l ON l.id = r.lote_folha_intercambio_id WHERE l.estabelecimento_id = ?`,
        [m.est],
      );
      await e.executar(
        'UPDATE lote_folha_intercambio SET lote_exportado_id = NULL WHERE estabelecimento_id = ?',
        [m.est],
      );
      await e.executar('DELETE FROM lote_folha_intercambio WHERE estabelecimento_id = ?', [m.est]);
      await e.executar('DELETE FROM competencia_folha WHERE estabelecimento_id = ? AND ano = 2099', [m.est]);
    });
  }

  beforeAll(async () => {
    m = await montarMassa();
    await limpar();
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-lancamento-folha' }, async (e) => {
      const t = await e.uma<{ id: number }>("SELECT id FROM tipo_folha WHERE codigo = 'F24P-MENSAL'");
      const tipo = t
        ? Number(t.id)
        : await e.inserir(
            "INSERT INTO tipo_folha (codigo, descricao, categoria, criado_em) VALUES ('F24P-MENSAL', 'FOLHA SINTETICA', 'mensal', NOW(3))",
            [],
          );
      competencia = await e.inserir(
        `INSERT INTO competencia_folha (estabelecimento_id, ano, mes, tipo_folha_id, apuracao_inicio, apuracao_fim, aberta_em, criado_em)
         VALUES (?, 2099, 5, ?, '2099-05-01', '2099-05-31', NOW(3), NOW(3))`,
        [m.est, tipo],
      );
    });
    c = { ...m.ctx(m.lanca), correlacao: 'int-lancamento-folha' } as ContextoPortaM18;
    folha = new PortaFolhaPropria(m.nucleo, { cifrar: (x) => `cifrado:${x.length}` });
    porta = new PortaIntegracaoFolhaPropria(m.nucleo);
    const trilha: TrilhaDaGravacao = {
      estabelecimento: m.est,
      usuario: m.lanca,
      acao: 'inclusao',
      entidade: 'lote_folha_intercambio',
      entidadeId: null,
      correlacao: 'int-lancamento-folha',
    };
    lote = await folha.gravarSgh(c, trilha, async (g) => {
      const exp = await g.proximoIdLote();
      exportado = exp;
      const base = {
        empresa: m.est,
        competencia: '2099-05',
        leiaute: 'v1',
        colaboradores: 1,
        soma: 0,
        totais: '{}',
        resumo: 'b'.repeat(64),
        geradoEm: '2099-05-31T18:00:00',
        por: 'teste',
      };
      await g.incluirLote({
        ...base,
        id: exp,
        sentido: 'exportado',
        loteExportado: null,
        situacao: 'gerado',
        vinculos: '[]',
        divergencias: null,
      });
      const ret = await g.proximoIdLote();
      await g.incluirLote({
        ...base,
        id: ret,
        sentido: 'recebido',
        loteExportado: exp,
        situacao: 'conferido',
        vinculos: null,
        divergencias: '[]',
      });
      await g.incluirResumo({
        interface: ret,
        empresa: m.est,
        competencia: '2099-05',
        linhas: [
          { vinculo: null, centroCusto: m.centro, rubrica: 'proventos', valor: 150_000, vencimento: null },
          {
            vinculo: null,
            centroCusto: m.centro,
            rubrica: 'liquido',
            valor: 120_000,
            vencimento: '2099-06-05',
          },
          { vinculo: null, centroCusto: null, rubrica: 'fgts', valor: 12_000, vencimento: '2099-06-07' },
        ],
      });
      return ret;
    });
  }, 180_000);

  afterAll(async () => {
    if (m) {
      await limpar();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  const entrada = (
    documento: number,
    mexe: Partial<IncluirTitulosFolhaEntrada> = {},
  ): IncluirTitulosFolhaEntrada => ({
    acao: 'incluir-folha',
    empresa: m.est,
    origem: 'interface',
    idOrigem: lote,
    apuracao: 'mensal',
    periodo: '2099-05',
    resumo: 'c'.repeat(64),
    emissao: '2099-05-31',
    liquido: 120_000,
    encargos: 12_000,
    titulos: [
      {
        chave: 'liquido-mensal:2099-06-05',
        destino: 'liquido-mensal',
        rotina: 4,
        credor: m.fornecedor,
        documento,
        vencimento: '2099-06-05',
        valor: 120_000,
        classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
        referente: 'FOLHA SINTETICA 05/2099',
      },
      {
        chave: 'fgts:2099-06-07',
        destino: 'fgts',
        rotina: 15,
        credor: m.fornecedor,
        documento: documento + 1,
        vencimento: '2099-06-07',
        valor: 12_000,
        classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
        referente: 'FGTS SINTETICO 05/2099',
      },
    ],
    fatos: [
      { rotina: 4, centroCusto: m.centro, natureza: 'provento', contabiliza: true, valor: 150_000 },
      { rotina: 15, centroCusto: m.centro, natureza: 'encargo', contabiliza: true, valor: 12_000 },
    ],
    ...mexe,
  });
  const ctxOp = () => ({ ...c, chaveIdempotencia: randomUUID() });
  /** Linhas cruas do banco: o efeito gravado, não só a releitura pela porta. */
  const cru = (sql: string, p: unknown[] = []) =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'leitura-crua-lancamento-folha' }, (e) =>
      e.consultar(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await cru(sql, p))[0]?.['n']);
  const TRILHA = 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?';

  it('resumo do retorno gravado em reais no banco (centavos só no contrato)', async () => {
    const r = await cru(
      `SELECT r.rubrica, r.valor FROM lote_folha_intercambio_resumo r
         JOIN lote_folha_intercambio l ON l.id = r.lote_folha_intercambio_id
        WHERE l.estabelecimento_id = ? AND l.numero = ? ORDER BY r.sequencia`,
      [m.est, lote],
    );
    expect(r.map((x) => [x['rubrica'], Number(x['valor'])])).toEqual([
      ['proventos', 1500],
      ['liquido', 1200],
      ['fgts', 120],
    ]);
  });

  it('retorno conferido lido do lote recebido, somado por rubrica', async () => {
    const r = await porta.retorno(c, lote);
    expect(r).toMatchObject({
      id: lote,
      empresa: m.est,
      competencia: '2099-05',
      sentido: 'recebido',
      situacao: 'conferido',
      liquido: 120_000,
      vencimentoLiquido: '2099-06-05',
      encargos: [{ tipo: 'fgts', valor: 12_000, vencimento: '2099-06-07' }],
      proventos: [{ centroCusto: m.centro, proventos: 150_000 }],
    });
  });

  it('recusas antes de gravar: soma divergente e empresa de fora', async () => {
    expect(
      await codigo(
        porta.executar(c, OPERACAO_TITULOS_FOLHA, entrada(documentoBase + 10, { liquido: 1 }), ctxOp()),
      ),
    ).toBe('soma-divergente');
    expect(
      await codigo(
        porta.executar(
          c,
          OPERACAO_TITULOS_FOLHA,
          entrada(documentoBase + 10, { empresa: m.outroEst }),
          ctxOp(),
        ),
      ),
    ).toBe('empresa-fora-da-sessao');
    expect(await porta.lancamentoDaOrigem(c, 'interface', lote)).toBeNull();
  });

  it('lança: títulos a pagar, lançamento, títulos da folha, fatos e o retorno marcado como lançado', async () => {
    const trilhas0 = await contar(TRILHA, [m.est]);
    const r = await porta.executar(c, OPERACAO_TITULOS_FOLHA, entrada(documentoBase), ctxOp());
    expect(r.repetida).toBe(false);
    expect(r.resultado).toMatchObject({ acao: 'incluir-folha', parcelas: 2 });
    const l = await porta.lancamentoDaOrigem(c, 'interface', lote);
    expect(l).toMatchObject({
      empresa: m.est,
      origem: 'interface',
      idOrigem: lote,
      apuracao: 'mensal',
      periodo: '2099-05',
      titulos: 2,
      fatos: 2,
      liquido: 120_000,
      encargos: 12_000,
      total: 132_000,
    });
    expect((await porta.lancamentos(c, m.est, 2099)).map((x) => x.id)).toContain(l!.id);
    // Efeito no banco, em reais, na mesma transação, com uma trilha da operação.
    const [lb] = await cru(
      `SELECT origem_lancamento, apuracao, total_liquido, total_encargos, lancado_por_usuario_id
         FROM lancamento_titulos_folha WHERE id = ?`,
      [l!.id],
    );
    expect([
      lb!['origem_lancamento'],
      lb!['apuracao'],
      Number(lb!['total_liquido']),
      Number(lb!['total_encargos']),
    ]).toEqual(['interface', 'mensal', 1200, 120]);
    expect(Number(lb!['lancado_por_usuario_id'])).toBe(Number(m.lanca));
    const tf = await cru(
      `SELECT t.valor, t.vencimento, t.chave_planejamento, tp.id AS titulo_pagar
         FROM titulo_folha t JOIN titulo_pagar tp ON tp.id = t.titulo_pagar_id
        WHERE t.lancamento_titulos_folha_id = ? ORDER BY t.id`,
      [l!.id],
    );
    expect(tf.map((x) => [Number(x['valor']), x['chave_planejamento']])).toEqual([
      [1200, 'liquido-mensal:2099-06-05'],
      [120, 'fgts:2099-06-07'],
    ]);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM parcela_pagar WHERE titulo_pagar_id IN (?, ?) AND excluido_em IS NULL`,
        tf.map((x) => x['titulo_pagar']),
      ),
    ).toBe(2);
    const fc = await cru(
      `SELECT fc.valor, fc.centro_custo_id, fc.situacao, JSON_VALUE(fc.campos, '$.natureza') AS natureza, ev.id AS evento
         FROM fato_contabil fc JOIN evento_contabil ev ON ev.id = fc.evento_contabil_id
        WHERE fc.entidade_origem = 'lancamento_titulos_folha' AND fc.entidade_origem_id = ? ORDER BY fc.id`,
      [l!.id],
    );
    expect(
      fc.map((x) => [Number(x['valor']), Number(x['centro_custo_id']), x['natureza'], x['situacao']]),
    ).toEqual([
      [1500, Number(m.centro), 'provento', 'pendente'],
      [120, Number(m.centro), 'encargo', 'pendente'],
    ]);
    expect(await contar(TRILHA, [m.est])).toBeGreaterThan(trilhas0);
    const ts = await porta.titulosDoLancamento(c, l!.id);
    expect(
      ts.map((t) => [t.destino, t.rotina, t.credor, t.documento, t.vencimento, t.valor, t.pago]),
    ).toEqual([
      ['liquido-mensal', 4, m.fornecedor, documentoBase, '2099-06-05', 120_000, false],
      ['fgts', 15, m.fornecedor, documentoBase + 1, '2099-06-07', 12_000, false],
    ]);
    expect(ts.every((t) => t.titulo > 0)).toBe(true);
    expect((await porta.chavesLancadas(c, m.est, 'mensal', '2099-05')).sort()).toEqual([
      'fgts:2099-06-07',
      'liquido-mensal:2099-06-05',
    ]);
    expect(await porta.custoPessoal(c, m.est, '2099-05')).toEqual({
      centros: [{ centroCusto: m.centro, proventos: 150_000, encargos: 12_000, total: 162_000 }],
      lancamentos: 1,
    });
    expect((await folha.lote(c, lote))?.situacao).toBe('lancado');
    expect(await folha.competenciaLancada(c, m.est, '2099-05')).toBe(true);
    // O mesmo retorno de novo: já não está conferido (lançado); a competência repetida por outra origem é recusada.
    expect(
      await codigo(porta.executar(c, OPERACAO_TITULOS_FOLHA, entrada(documentoBase + 20), ctxOp())),
    ).toBe('registro-alterado');
    // O título lançado pela folha não conta no aviso de títulos manuais.
    expect(
      await porta.titulosManuais(c, {
        empresa: m.est,
        credor: m.fornecedor,
        grupo: 9207,
        subgrupo: 1,
        item: 1,
        de: '2099-06-01',
        ate: '2099-06-30',
      }),
    ).toBe(0);
    void competencia;
  });

  it('recusa folha-repetida: outro retorno conferido da mesma competência com os mesmos títulos; nada é gravado', async () => {
    const trilha: TrilhaDaGravacao = {
      estabelecimento: m.est,
      usuario: m.lanca,
      acao: 'inclusao',
      entidade: 'lote_folha_intercambio',
      entidadeId: null,
      correlacao: 'int-lancamento-folha-repetida',
    };
    const outro = await folha.gravarSgh(c, trilha, async (g) => {
      const id = await g.proximoIdLote();
      await g.incluirLote({
        id,
        empresa: m.est,
        competencia: '2099-05',
        sentido: 'recebido',
        loteExportado: exportado,
        leiaute: 'v1',
        situacao: 'conferido',
        colaboradores: 1,
        soma: 132_000,
        totais: '{}',
        vinculos: null,
        divergencias: '[]',
        resumo: 'd'.repeat(64),
        geradoEm: '2099-06-01T08:00:00',
        por: 'teste',
      });
      return id;
    });
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM lancamento_titulos_folha WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(
      await codigo(
        porta.executar(c, OPERACAO_TITULOS_FOLHA, entrada(documentoBase + 30, { idOrigem: outro }), ctxOp()),
      ),
    ).toBe('folha-repetida');
    expect(
      await contar('SELECT COUNT(*) AS n FROM lancamento_titulos_folha WHERE estabelecimento_id = ?', [
        m.est,
      ]),
    ).toBe(antes);
    // A recusa desfaz a transação: o retorno segue conferido (a marca 'lancado' não fica).
    expect((await folha.lote(c, outro))?.situacao).toBe('conferido');
    expect(await porta.lancamentoDaOrigem(c, 'interface', outro)).toBeNull();
  });
});
