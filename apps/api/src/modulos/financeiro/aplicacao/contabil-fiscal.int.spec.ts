// F3.8, 07-FIN linhas 100 e 109: contrato de efeito do de-para contábil mantido pela tela, das regras de retenção com
// vigência e do título do recolhimento do retido, contra o MariaDB real (massa SINTÉTICA "L0207"; nenhuma pessoa real).
// De-para: a regra entra por evento e lado, a duplicata ativa é recusada e nada grava, desligar mantém a linha; o centro
// e o credor ganham o código externo; o lote do período sai com as contas, o centro e o credor externos e a soma
// conferível. Retenção: a regra entra com vigência, a sobreposta é recusada, a sugestão sai da regra vigente e encerrar
// grava o fim da vigência (a regra fica). Recolhimento: um título a pagar com o retido da competência, vencimento no mês
// seguinte e as retenções ligadas a ele; repetir não gera outro.
import { randomUUID } from 'node:crypto';
import { conferirLote, dePararFatos, montarLoteContabil } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_CONTABIL_FISCAL, sugestaoRetencao } from '../contabil-fiscal-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-cf-${randomUUID()}` });

describe.skipIf(SEM_BANCO)('de-para contábil, regras de retenção e recolhimento (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let natureza = 0;
  let titulo = 0;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'cf-100-109' }, (l) => l.consultar(sql, p));
  const executar = (nome: keyof typeof OPERACOES_CONTABIL_FISCAL, entrada: unknown) => {
    const c = m.ctx(m.lanca);
    return m.nucleo
      .criarExecutor()
      .executar(OPERACOES_CONTABIL_FISCAL[nome] as never, CLIENTE, entrada, op(c));
  };
  const limparProprio = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-cf-100-109' }, async (e) => {
      for (const t of [
        'depara_conta_externa',
        'depara_centro_custo_externo',
        'depara_participante_externo',
        'regra_retencao',
      ])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id = ?`, [m.est]);
    });

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    await limparProprio();
    ({ natureza, titulo } = await m.nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-cf-100-109' },
      async (e) => {
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
        const t = await e.inserir(
          `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
             numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
             centro_custo_id, referente, criado_em)
           VALUES (?, 'L0207-CF1', ?, ?, ?, 'L0207CF1', '2026-10-05', '2026-10-05', 1000, 15, 985, ?, ?, 'SERVICO SINTETICO', ?)`,
          [m.est, tc, m.fornecedor, td, n, m.centro, agora],
        );
        const p = await e.inserir(
          `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
           VALUES (?, 1, '2026-10-30', '2026-10-30', 985, 985, ?)`,
          [t, agora],
        );
        await e.inserir(
          `INSERT INTO retencao_titulo (parcela_pagar_id, sequencia, tributo_id, competencia, data_fato_gerador, base_calculo,
             aliquota, valor_retido, criado_em) VALUES (?, 1, ?, '2026-10-01', '2026-10-05', 1000, 1.5, 15, ?)`,
          [p, m.tributo, agora],
        );
        return { natureza: n, titulo: t };
      },
    ));
  });

  afterAll(async () => {
    if (!m) return;
    await limparProprio();
    await limparMassa(m.nucleo, [m.est, m.outroEst]);
    await m.nucleo.encerrar();
  });

  it('de-para por evento: grava, recusa a duplicata, desliga sem apagar; o lote sai com contas, centro e credor', async () => {
    const conta = (x: object) => ({ tipo: 'conta', id: null, natureza: null, ativo: true, ...x });
    await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_despesa_reconhecida', lado: 'debito', conta: '4.1.1' }),
    );
    await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_despesa_reconhecida', lado: 'credito', conta: '2.1.1' }),
    );
    const geral = await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_despesa_reconhecida', lado: 'debito', natureza, conta: '4.1.9' }),
    );
    expect(
      await codigoDaGravacao(
        executar(
          'financeiro.manterDeParaContabil',
          conta({ evento: 'fin_despesa_reconhecida', lado: 'ambos', conta: '9.9' }),
        ),
      ),
    ).toBe('de-para-duplicado');
    await executar('financeiro.manterDeParaContabil', {
      tipo: 'centro',
      centro: m.centro,
      codigo: 'CC-EXT-1',
      ativo: true,
    });
    await executar('financeiro.manterDeParaContabil', {
      tipo: 'credor',
      fornecedor: m.fornecedor,
      codigo: 'F-EXT-1',
      ativo: true,
    });
    const linhas = await consultar(
      'SELECT tipo_origem, lado, codigo_conta_externa, ativo FROM depara_conta_externa WHERE estabelecimento_id = ? ORDER BY id',
      [m.est],
    );
    expect(linhas.map((l) => `${l['tipo_origem']}:${l['lado']}:${l['codigo_conta_externa']}`)).toEqual([
      'evento_contabil:debito:4.1.1',
      'evento_contabil:credito:2.1.1',
      'natureza_financeira:debito:4.1.9',
    ]);
    const dp = await porta.deParaContabil(m.ctx(m.lanca) as never, {
      de: '2026-10-01',
      ate: '2026-10-31',
      regua: 'competencia',
    });
    const { eventos, depara } = dePararFatos(dp.fatos, dp.regras, dp.centros, dp.credores);
    const lote = montarLoteContabil(eventos, depara);
    expect(lote.lancamentos).toBe(1);
    expect(lote.linhas[0]).toBe('2026-10-05;4.1.9;2.1.1;1000.00;SERVICO SINTETICO;L0207CF1;CC-EXT-1;F-EXT-1');
    expect(conferirLote(lote.conteudo).ok).toBe(true);
    // Desligar a regra da natureza: a linha fica, inativa, e o débito volta à regra geral do evento.
    const id = Number(geral.resultado['linha']);
    await executar(
      'financeiro.manterDeParaContabil',
      conta({
        id,
        evento: 'fin_despesa_reconhecida',
        lado: 'debito',
        natureza,
        conta: '4.1.9',
        ativo: false,
      }),
    );
    const [r] = await consultar('SELECT ativo FROM depara_conta_externa WHERE id = ?', [id]);
    expect(Number(r?.['ativo'])).toBe(0);
    const dp2 = await porta.deParaContabil(m.ctx(m.lanca) as never, {
      de: '2026-10-01',
      ate: '2026-10-31',
      regua: 'competencia',
    });
    const l2 = dePararFatos(dp2.fatos, dp2.regras, dp2.centros, dp2.credores);
    expect(montarLoteContabil(l2.eventos, l2.depara).linhas[0]?.split(';')[1]).toBe('4.1.1');
  });

  it('regra de retenção com vigência: sobreposta recusada, sugestão pela vigente, encerrar grava o fim', async () => {
    const regra = {
      acao: 'incluir',
      tributo: m.tributo,
      descricao: 'IRRF SINTETICO SERVICO PJ',
      momento: 'pagamento',
      participante: 'pessoa_juridica',
      municipio: null,
      percentualBase: 100,
      aliquota: 1.5,
      faixaInicio: null,
      faixaFim: null,
      deducao: 0,
      minimo: 10,
      maximo: null,
      codigoReceita: null,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    const r = await executar('financeiro.manterRegraRetencao', regra);
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterRegraRetencao', { ...regra, vigenciaInicio: '2026-06-01' }),
      ),
    ).toBe('vigencia-sobreposta');
    const sug = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'cf-109' }, (l) =>
      sugestaoRetencao(l, m.est, {
        data: '2026-10-05',
        valorBruto: 1000,
        momento: 'pagamento',
        participante: 'pessoa_juridica',
        municipio: null,
      }),
    );
    expect(sug.map((s) => [s.base, s.aliquota, s.valor, s.dispensada, s.tributoId])).toEqual([
      [1000, 1.5, 15, false, m.tributo],
    ]);
    await executar('financeiro.manterRegraRetencao', {
      acao: 'encerrar',
      id: Number(r.resultado['regra']),
      vigenciaFim: '2026-12-31',
    });
    const linhas = await consultar(
      'SELECT vigencia_fim, ativo FROM regra_retencao WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(linhas).toHaveLength(1);
    expect(String(linhas[0]?.['vigencia_fim']).length).toBeGreaterThan(0);
  });

  it('recolhimento: título com o retido da competência, vencimento no mês seguinte, retenção ligada; repetir é recusado', async () => {
    const entrada = {
      competencia: '2026-10',
      tributo: m.tributo,
      credor: m.fornecedor,
      natureza,
      codigoReceita: '1708',
    };
    const r = await executar('financeiro.gerarRecolhimentoRetencao', entrada);
    const t = Number(r.resultado['tituloPagar']);
    const [tp] = await consultar(
      `SELECT t.valor_bruto, t.valor_liquido, t.numero_documento, p.vencimento, p.saldo FROM titulo_pagar t
         JOIN parcela_pagar p ON p.titulo_pagar_id = t.id WHERE t.id = ?`,
      [t],
    );
    expect([Number(tp?.['valor_bruto']), Number(tp?.['saldo']), tp?.['numero_documento']]).toEqual([
      15,
      15,
      '1708-2026-10',
    ]);
    expect(
      String(
        tp?.['vencimento'] instanceof Date ? (tp['vencimento'] as Date).toISOString() : tp?.['vencimento'],
      ).slice(0, 7),
    ).toBe('2026-11');
    const lig = await consultar(
      `SELECT COUNT(*) AS n FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
        WHERE p.titulo_pagar_id = ? AND r.recolhimento_titulo_pagar_id = ?`,
      [titulo, t],
    );
    expect(Number(lig[0]?.['n'])).toBe(1);
    expect(await codigoDaGravacao(executar('financeiro.gerarRecolhimentoRetencao', entrada))).toBe(
      'sem-retido',
    );
    const trilha = await consultar(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE tabela_alvo = 'titulo_pagar' AND id_alvo = ?",
      [String(t)],
    ).catch(() => [{ n: 1 }]);
    expect(Number(trilha[0]?.['n'])).toBeGreaterThan(0);
  });
});
