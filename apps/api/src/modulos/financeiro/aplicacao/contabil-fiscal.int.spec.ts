// F3.8, 07-FIN linhas 100 e 109: contrato de efeito do de-para contábil mantido pela tela, das regras de retenção com
// vigência e do título do recolhimento do retido, contra o MariaDB real (massa SINTÉTICA "L0207"; nenhuma pessoa real).
// De-para: a regra entra por evento e lado, a duplicata ativa é recusada e nada grava, desligar mantém a linha; o centro
// e o credor ganham o código externo; o lote do período sai com as contas, o centro e o credor externos e a soma
// conferível, em partidas (despesa, fornecedor pelo líquido, tributo a recolher pelo retido, pagamento), pelo serviço
// (arquivo guardado, hash e registro do lote). Retenção: a regra entra com vigência, a sobreposta é recusada, a
// sugestão sai da regra vigente e encerrar grava o fim da vigência (a regra fica; estender é recusado). Recolhimento:
// um título a pagar com o retido da competência, vencimento no mês seguinte e as retenções ligadas a ele; repetir não
// gera outro. Título cancelado e outro estabelecimento ficam fora do lote, da lista em aberto e da guia.
import { createHash, randomUUID } from 'node:crypto';
import { conferirLote, dePararFatos, montarLoteContabil } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { ApoiosFinanceiro } from '../apoios.js';
import { OPERACOES_CONTABIL_FISCAL, retidoEmAberto, sugestaoRetencao } from '../contabil-fiscal-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import { ServicoFinanceiro } from '../servico.js';
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
  const executar = (nome: keyof typeof OPERACOES_CONTABIL_FISCAL, entrada: unknown, est?: number) => {
    const c = m.ctx(m.lanca, est);
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
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (?, ?)`, [m.est, m.outroEst]);
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
        // Um título com retenção por estabelecimento; o cancelado (com retenção) fica fora do lote e da guia.
        const titulo = async (est: number, doc: string, bruto: number, retido: number, situacao: string) => {
          const t = await e.inserir(
            `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
               numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
               centro_custo_id, referente, situacao, cancelado_em, motivo_cancelamento, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, '2026-10-05', '2026-10-05', ?, ?, ?, ?, ?, 'SERVICO SINTETICO', ?, ?, ?, ?)`,
            [
              est,
              `L0207-${doc}`,
              tc,
              m.fornecedor,
              td,
              doc,
              bruto,
              retido,
              bruto - retido,
              n,
              est === m.est ? m.centro : null,
              situacao,
              situacao === 'cancelado' ? agora : null,
              situacao === 'cancelado' ? 'CANCELAMENTO SINTETICO' : null,
              agora,
            ],
          );
          // A parcela do título vivo foi paga em 20/10 (o pagamento entra no lote por competência).
          const paga = situacao === 'aberto' && est === m.est;
          const p = await e.inserir(
            `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, valor_pago,
               situacao, quitada_em, criado_em)
             VALUES (?, 1, '2026-10-30', '2026-10-30', ?, ?, ?, ?, ?, ?)`,
            [
              t,
              bruto - retido,
              paga ? 0 : bruto - retido,
              paga ? bruto - retido : 0,
              paga ? 'paga' : 'aberta',
              paga ? '2026-10-20' : null,
              agora,
            ],
          );
          await e.inserir(
            `INSERT INTO retencao_titulo (parcela_pagar_id, sequencia, tributo_id, competencia, data_fato_gerador, base_calculo,
               aliquota, valor_retido, criado_em) VALUES (?, 1, ?, '2026-10-01', '2026-10-05', ?, 1.5, ?, ?)`,
            [p, m.tributo, bruto, retido, agora],
          );
          return t;
        };
        const t = await titulo(m.est, 'L0207CF1', 1000, 15, 'aberto');
        await titulo(m.est, 'L0207CF2', 400, 7, 'cancelado');
        await titulo(m.outroEst, 'L0207CF3', 2000, 30, 'aberto');
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
    await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_retencao_apropriada', lado: 'credito', conta: '2.1.5' }),
    );
    await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_pagamento_titulo', lado: 'credito', conta: '1.1.1' }),
    );
    // De-para do outro estabelecimento: não vale aqui.
    await executar(
      'financeiro.manterDeParaContabil',
      conta({ evento: 'fin_despesa_reconhecida', lado: 'debito', conta: '9.OUTRO' }),
      m.outroEst,
    );
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
      'evento_contabil:credito:2.1.5',
      'evento_contabil:credito:1.1.1',
    ]);
    const dp = await porta.deParaContabil(m.ctx(m.lanca) as never, {
      de: '2026-10-01',
      ate: '2026-10-31',
      regua: 'competencia',
    });
    const { eventos, depara } = dePararFatos(dp.fatos, dp.regras, dp.centros, dp.credores);
    const lote = montarLoteContabil(eventos, depara);
    // Três partidas: a despesa (fornecedor pelo líquido), o retido (tributo a recolher) e o pagamento ao fornecedor,
    // que baixa a mesma conta creditada na emissão. O título cancelado e o outro estabelecimento ficam fora.
    expect(lote.linhas.map((l) => l.split(';').slice(0, 4).concat(l.split(';').slice(5)).join(';'))).toEqual([
      '2026-10-05;4.1.9;2.1.1;985.00;L0207CF1;CC-EXT-1;F-EXT-1',
      '2026-10-05;4.1.9;2.1.5;15.00;L0207CF1;CC-EXT-1;F-EXT-1',
      '2026-10-20;2.1.1;1.1.1;985.00;L0207CF1;CC-EXT-1;F-EXT-1',
    ]);
    expect([lote.somaDebitos, lote.somaCreditos, lote.semDePara.length]).toEqual([1985, 1985, 0]);
    expect(conferirLote(lote.conteudo).ok).toBe(true);
    // Pelo serviço: o arquivo guardado é o lote, o hash confere e o registro do lote leva a contagem e a soma.
    const guardados = new Map<string, Uint8Array>();
    const armazem = {
      guardar: async (chave: string, b: Uint8Array) => {
        guardados.set(chave, b);
        return { versao: null };
      },
      ler: async (chave: string) => guardados.get(chave) ?? null,
    };
    const apoios = new ApoiosFinanceiro(porta, new RegistradorTrilhaMemoria(), null, null, 'desenvolvimento');
    // A liberação da funcionalidade é da configuração do estabelecimento (fora deste contrato), como na prorrogação.
    (apoios.apoios.fiscal as unknown as { exigirLiberacao: () => Promise<void> }).exigirLiberacao =
      async () => undefined;
    const servico = new ServicoFinanceiro(porta, apoios, 'desenvolvimento', armazem);
    const sessao = {
      req: { headers: { 'idempotency-key': `t0207-cf-lote-${randomUUID()}` } },
      hospital: 'l0207',
      rede: '',
      login: `l0207.${m.lanca}`,
      porta: m.ctx(m.lanca),
      pode: () => true,
    } as unknown as SessaoCadastro;
    const exportado = await servico.exportarLoteContabil(sessao, {
      periodo: '2026-10',
      regua: 'competencia',
    } as never);
    const [chave, bytes] = [...guardados.entries()][0] ?? ['', new Uint8Array()];
    expect(Buffer.from(bytes).toString('utf8')).toBe(lote.conteudo);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(chave).toBe(`contabil/2026-10-competencia-${hash.slice(0, 16)}.txt`);
    const [reg] = await consultar(
      `SELECT x.quantidade_lancamentos, x.valor_total, x.hash_conferencia, a.chave_armazenamento
         FROM lote_exportacao_contabil x LEFT JOIN arquivo a ON a.id = x.arquivo_id
        WHERE x.id = ? AND x.estabelecimento_id = ?`,
      [Number(exportado.ids['lote']), m.est],
    );
    expect([
      Number(reg?.['quantidade_lancamentos']),
      Number(reg?.['valor_total']),
      reg?.['hash_conferencia'],
      reg?.['chave_armazenamento'],
    ]).toEqual([3, 1985, hash, chave]);
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
    expect(montarLoteContabil(l2.eventos, l2.depara).linhas.map((l) => l.split(';')[1])).toEqual([
      '4.1.1',
      '4.1.1',
      '2.1.1',
    ]);
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
    // A regra do outro estabelecimento (alíquota diferente) não entra na sugestão daqui.
    await executar('financeiro.manterRegraRetencao', { ...regra, aliquota: 4.8 }, m.outroEst);
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
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, ativo FROM regra_retencao WHERE estabelecimento_id = ?",
      [m.est],
    );
    expect(linhas.map((l) => [l['fim'], Number(l['ativo'])])).toEqual([['2026-12-31', 1]]);
    // Estender a regra encerrada é recusado (só antecipa) e nada muda.
    expect(
      await codigoDaGravacao(
        executar('financeiro.manterRegraRetencao', {
          acao: 'encerrar',
          id: Number(r.resultado['regra']),
          vigenciaFim: '2027-06-30',
        }),
      ),
    ).toBe('so-antecipar');
  });

  it('recolhimento: título com o retido da competência, vencimento no mês seguinte, retenção ligada; repetir é recusado', async () => {
    const entrada = {
      competencia: '2026-10',
      tributo: m.tributo,
      credor: m.fornecedor,
      natureza,
      codigoReceita: '1708',
    };
    // Em aberto: só o retido do título vivo deste estabelecimento (o cancelado e o outro estabelecimento ficam fora).
    const aberto = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'cf-109-aberto' }, (l) =>
      retidoEmAberto(l, m.est, '2026-10'),
    );
    expect(aberto.map((a) => [a.tributo, a.retencoes, a.valor])).toEqual([[m.tributo, 1, 15]]);
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
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'titulo_pagar' AND entidade_id = ? AND estabelecimento_id = ?`,
      [t, m.est],
    );
    expect(Number(trilha[0]?.['n'])).toBeGreaterThan(0);
    // O retido do título cancelado segue sem guia.
    const fora = await consultar(
      `SELECT COUNT(*) AS n FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
         JOIN titulo_pagar x ON x.id = p.titulo_pagar_id
        WHERE x.situacao = 'cancelado' AND x.estabelecimento_id = ? AND r.recolhimento_titulo_pagar_id IS NOT NULL`,
      [m.est],
    );
    expect(Number(fora[0]?.['n'])).toBe(0);
  });
});
