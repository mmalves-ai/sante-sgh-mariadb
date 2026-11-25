// F7, 07-FIN linha 110: contrato de efeito da apuração do retido pelo hospital e do DARF, contra o MariaDB real (massa
// SINTÉTICA "L0207"; nenhuma pessoa real). O recolhimento da competência grava, na mesma transação, o título, a guia
// (DARF com código de receita, período de apuração, vencimento e valores) e a apuração "retido_de_terceiros" com uma
// linha por retenção; a leitura mostra as parcelas por código de receita com a soma, o DARF sai com os campos 01 a 10
// e o batimento confere o retido com os eventos vigentes da EFD-Reinf. Retenções com códigos de receita diferentes não
// cabem num DARF só e são recusadas sem gravar nada.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apuracoesRetido, batimentoReinf, darfDaGuia } from '../apuracao-retido-propria.js';
import { OPERACOES_CONTABIL_FISCAL } from '../contabil-fiscal-propria.js';
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
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-ar-${randomUUID()}` });

describe.skipIf(SEM_BANCO)('apuração do retido, DARF e batimento com a Reinf (MariaDB)', () => {
  let m: MassaFinanceiro;
  let natureza = 0;
  let receitaA = 0;
  let receitaB = 0;
  let retencaoB = 0;
  let cnpjOriginal: string | null = null;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'ar-110' }, (l) => l.consultar(sql, p));
  const ler = <T>(fn: (l: Parameters<Parameters<typeof m.nucleo.lerSomente>[1]>[0]) => Promise<T>) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'ar-110-ler' }, fn);
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
    ({ natureza, receitaA, receitaB, retencaoB, cnpjOriginal } = await m.nucleo.escrever(
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
        const titulo = async (doc: string, bruto: number, retido: number, codigo: number | null) => {
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
            [p, m.tributo, codigo, bruto, retido, agora],
          );
        };
        await titulo('L0207AR1', 1000, 15, a);
        await titulo('L0207AR2', 2000, 30, null);
        const rb = await titulo('L0207AR3', 400, 6, b);
        // A Reinf da competência: um R-4020 vigente com IRRF de 40,00, um rejeitado e um original já retificado (fora).
        const evento = async (situacao: string, irrf: number, retifica: number | null = null) => {
          const ev = await e.inserir(
            `INSERT INTO evento_reinf (estabelecimento_id, competencia, codigo_evento, acao, situacao, retificado_evento_reinf_id, criado_em)
             VALUES (?, ?, 'R-4020', ?, ?, ?, ?)`,
            [m.est, `${COMP}-01`, retifica ? 'retificacao' : 'inclusao', situacao, retifica, agora],
          );
          await e.inserir(
            "INSERT INTO evento_reinf_item (evento_reinf_id, sequencia, tipo_item, valor_irrf, criado_em) VALUES (?, 1, 'pagamento', ?, ?)",
            [ev, irrf, agora],
          );
          return ev;
        };
        const original = await evento('gerado', 99);
        await evento('gerado', 40, original);
        await evento('rejeitado', 500);
        return {
          natureza: n,
          receitaA: a,
          receitaB: b,
          retencaoB: rb,
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
  });

  it('códigos de receita diferentes na competência: recusa, sem título, guia nem apuração', async () => {
    const entrada = {
      competencia: COMP,
      tributo: m.tributo,
      credor: m.fornecedor,
      natureza,
      codigoReceita: null,
    };
    expect(await codigoDaGravacao(recolher(entrada))).toBe('receitas-distintas');
    const [n] = await consultar(
      `SELECT (SELECT COUNT(*) FROM guia_recolhimento WHERE estabelecimento_id = ?) AS guias,
              (SELECT COUNT(*) FROM apuracao_retencao WHERE estabelecimento_id = ? AND sentido = 'retido_de_terceiros') AS apuracoes`,
      [m.est, m.est],
    );
    expect([Number(n?.['guias']), Number(n?.['apuracoes'])]).toEqual([0, 0]);
  });

  it('batimento antes do recolhimento: o retido (51,00) contra o R-4020 vigente (40,00); rejeitado e retificado fora', async () => {
    const b = await ler((l) => batimentoReinf(l, m.est, COMP));
    expect(b.eventosReinf).toBe(1);
    expect(b.linhas).toEqual([{ grupo: 'irrf', apurado: 51, reinf: 40, diferenca: 11, confere: false }]);
    expect(b.confere).toBe(false);
  });

  it('recolhimento grava guia DARF e apuração com as retenções; a leitura dá parcelas por código e o DARF 01 a 10', async () => {
    // A retenção de outro código sai da competência (dispensada) para caber num DARF só.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'ar-110-dispensa' }, (e) =>
      e.executar('UPDATE retencao_titulo SET retencao_dispensada = TRUE WHERE id = ?', [retencaoB]),
    );
    const entrada = {
      competencia: COMP,
      tributo: m.tributo,
      credor: m.fornecedor,
      natureza,
      codigoReceita: null,
    };
    const r = await recolher(entrada);
    const guia = Number(r.resultado['guia']);
    const apuracao = Number(r.resultado['apuracao']);
    const titulo = Number(r.resultado['tituloPagar']);
    expect([r.resultado['codigoReceita'], r.resultado['valor'], r.resultado['retencoes']]).toEqual([
      '1708',
      45,
      2,
    ]);
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
    ]).toEqual(['darf', receitaA, null, '2026-08-01', '2026-08-31', '2026-09', 45, 45, titulo, 'emitida']);
    const [a] = await consultar(
      `SELECT sentido, situacao, codigo_receita_federal_id, guia_recolhimento_id, titulo_pagar_id, valor_base_total, valor_total,
              (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id AND i.parcela_pagar_id IS NOT NULL) AS itens,
              (SELECT SUM(i.valor_retido) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id) AS soma
         FROM apuracao_retencao a WHERE a.id = ? AND a.estabelecimento_id = ?`,
      [apuracao, m.est],
    );
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
    ]).toEqual(['retido_de_terceiros', 'recolhida', receitaA, guia, titulo, 3000, 45, 2, 45]);
    // A retenção dispensada (código 3280) ficou fora da apuração e sem guia.
    const [fora] = await consultar(
      'SELECT COUNT(*) AS n FROM apuracao_retencao_item WHERE retencao_titulo_id = ?',
      [retencaoB],
    );
    expect(Number(fora?.['n'])).toBe(0);
    expect(receitaB).toBeGreaterThan(0);

    const lista = await ler((l) => apuracoesRetido(l, m.est, COMP));
    expect(lista.map((x) => [x.codigoReceita, x.total, x.somaParcelas, x.guia, x.situacao])).toEqual([
      ['1708', 45, 45, guia, 'recolhida'],
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
    // A guia de outro estabelecimento não é lida daqui.
    expect(await codigoDaGravacao(ler((l) => darfDaGuia(l, m.outroEst, guia)))).toBe('guia-inexistente');

    // A trilha da operação ficou com o título; o retido apurado (45,00) segue contra a Reinf (40,00).
    const [t] = await consultar(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'titulo_pagar' AND entidade_id = ?",
      [titulo],
    );
    expect(Number(t?.['n'])).toBeGreaterThan(0);
    const b = await ler((l) => batimentoReinf(l, m.est, COMP));
    expect(b.linhas).toEqual([{ grupo: 'irrf', apurado: 45, reinf: 40, diferenca: 5, confere: false }]);
  });
});
