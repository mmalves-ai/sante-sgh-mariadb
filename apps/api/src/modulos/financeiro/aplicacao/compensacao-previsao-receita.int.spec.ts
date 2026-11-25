// F8, 07-FIN linha 68: contrato de efeito da previsão de receita realizada pelo título a receber e do motivo do
// cancelamento da ocorrência, contra o MariaDB real (massa SINTÉTICA "L0207"; migração 14_FIN/99_previsao_receita_realizado).
// Receita: a ocorrência se realiza pelo título a receber da MESMA fonte pagadora; a conciliação guarda o título a
// receber (o a pagar fica vazio) e a diferença; o título a pagar na receita é recusado; o título de outra fonte, o já
// conciliado e a ocorrência já realizada também. A leitura do previsto × realizado traz o número do título a receber e
// a lista de títulos candidatos só traz os da fonte, vivos e livres.
// Cancelamento: o motivo fica na ocorrência (cancelamento avulso e encerramento da previsão), e a linha não se apaga.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previstoRealizado, titulosParaRealizar } from '../compensacao-previsao-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-f8-pr-${randomUUID()}` });
const HOJE = new Date().toISOString().slice(0, 10);
const FONTE2 = `${P}-CONV9`;

describe.skipIf(SEM_BANCO)(
  'previsão de receita pelo título a receber e motivo do cancelamento (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let porta: PortaFinanceiroPropria;
    let naturezaReceita = 0;
    let naturezaDespesa = 0;
    let outraFonte = 0;
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f8-pr' }, (l) => l.consultar(sql, p));
    const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f8-pr' }, fn) as Promise<T>;
    const executar = (nome: string, entrada: unknown, usuario = m.lanca) => {
      const c = m.ctx(usuario);
      return porta.executar(c, nome, entrada, op(c));
    };
    const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f8-pr' }, fn) as Promise<T>;
    const resultado = (r: unknown) => (r as { resultado: Record<string, unknown> }).resultado;

    /** Um título a receber da fonte pagadora, avulso, com uma parcela. */
    const tituloReceber = (fonte: number, valor: number, documento: string) =>
      escrever<number>(async (e) => {
        const agora = new Date();
        const tipoDoc = await e.uma<{ id: number }>(
          "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'fatura'",
          [],
        );
        const t = await e.inserir(
          `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, ?, 'fonte_pagadora', ?, 'avulso', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.est,
            `${P}-PR${documento}`,
            fonte,
            Number(tipoDoc?.id),
            documento,
            HOJE,
            HOJE,
            valor,
            valor,
            naturezaReceita,
            agora,
          ],
        );
        await e.inserir(
          `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
          [t, HOJE, HOJE, valor, valor, agora],
        );
        return t;
      });

    const limparPrevisoes = () =>
      escrever(async (e) => {
        await e.executar(
          `DELETE c FROM conciliacao_previsao_realizado c JOIN parcela_previsao_financeira o ON o.id = c.parcela_previsao_financeira_id
           JOIN previsao_financeira p ON p.id = o.previsao_financeira_id WHERE p.estabelecimento_id = ?`,
          [m.est],
        );
        await e.executar(
          `DELETE c FROM conciliacao_previsao_realizado c JOIN titulo_pagar t ON t.id = c.titulo_pagar_id WHERE t.estabelecimento_id = ?`,
          [m.est],
        );
        await e.executar(
          'DELETE o FROM parcela_previsao_financeira o JOIN previsao_financeira p ON p.id = o.previsao_financeira_id WHERE p.estabelecimento_id = ?',
          [m.est],
        );
        await e.executar('DELETE FROM previsao_financeira WHERE estabelecimento_id = ?', [m.est]);
      });

    beforeAll(async () => {
      m = await montarMassa();
      porta = new PortaFinanceiroPropria(m.nucleo);
      await limparPrevisoes();
      ({ naturezaReceita, naturezaDespesa, outraFonte } = await escrever<{
        naturezaReceita: number;
        naturezaDespesa: number;
        outraFonte: number;
      }>(async (e) => {
        const nr = await e.uma<{ id: number }>(
          "SELECT id FROM natureza_financeira WHERE codigo = '9207.2.1'",
          [],
        );
        const nd = await e.uma<{ id: number }>(
          "SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'",
          [],
        );
        const f =
          (await e.uma<{ id: number }>('SELECT id FROM fonte_pagadora WHERE codigo = ?', [FONTE2]))?.id ??
          (await e.inserir(
            "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA SINTETICA L0207 B', 'operadora', 'ativa', ?)",
            [FONTE2, new Date()],
          ));
        return { naturezaReceita: Number(nr?.id), naturezaDespesa: Number(nd?.id), outraFonte: Number(f) };
      }));
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await limparPrevisoes();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await escrever(async (e) => {
        await e.executar(
          'DELETE f FROM fonte_pagadora f WHERE f.codigo = ? AND NOT EXISTS (SELECT 1 FROM titulo_receber t WHERE t.fonte_pagadora_id = f.id)',
          [FONTE2],
        );
      });
      await m.nucleo.encerrar();
    });

    it('receita: realiza pelo título a receber da mesma fonte, grava a conciliação e recusa o que não cabe', async () => {
      const r = resultado(
        await executar('financeiro.criarPrevisaoFinanceira', {
          descricao: 'REPASSE SINTETICO L0207',
          tipo: 'receita',
          natureza: naturezaReceita,
          fontePagadora: m.convenio,
          valor: 2000,
          periodicidade: 'mensal',
          diaVencimento: 15,
          dataInicio: '2026-11-01',
          dataFim: '2027-01-31',
          ajuste: 'manter',
        }),
      );
      expect(r).toMatchObject({ ocorrencias: 3, total: 6000 });
      const oc = (
        await consultar(
          'SELECT id FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? ORDER BY sequencia',
          [Number(r['previsao'])],
        )
      ).map((o) => Number(o['id']));
      const [o1, o2] = oc as [number, number];
      const daFonte = await tituloReceber(m.convenio, 1_900, '868101');
      const deOutra = await tituloReceber(outraFonte, 2_000, '868102');
      const pagar = resultado(
        await executar('financeiro.criarTituloPagar', tituloDaMassa(m, 920_868_101, 2_000)),
      );

      // A lista de candidatos traz o título da fonte e não o de outra fonte nem o a pagar.
      const candidatos = await ler<Awaited<ReturnType<typeof titulosParaRealizar>>>((l) =>
        titulosParaRealizar(l, m.est, o1),
      );
      expect(candidatos.map((c) => [c.id, c.lado])).toContainEqual([daFonte, 'receber']);
      expect(candidatos.some((c) => c.id === deOutra)).toBe(false);

      // O título a pagar na receita, o de outra fonte e nenhum título são recusados; nada muda.
      expect(
        await codigoDaGravacao(
          executar('financeiro.realizarPrevisaoFinanceira', {
            ocorrencia: o1,
            tituloPagar: Number(pagar['tituloPagar']),
          }),
        ),
      ).toBe('titulo-de-outro-lado');
      expect(
        await codigoDaGravacao(
          executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: o1, tituloReceber: deOutra }),
        ),
      ).toBe('devedor-diferente');
      expect(
        await codigoDaGravacao(executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: o1 })),
      ).toBe('titulo-obrigatorio');
      const [antes] = await consultar(
        'SELECT situacao, (SELECT COUNT(*) FROM conciliacao_previsao_realizado c WHERE c.parcela_previsao_financeira_id = o.id) AS n FROM parcela_previsao_financeira o WHERE o.id = ?',
        [o1],
      );
      expect([antes?.['situacao'], Number(antes?.['n'])]).toEqual(['aberta', 0]);

      // Pelo título a receber da fonte: realizada, conciliação com o título a receber e a diferença.
      const real = resultado(
        await executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: o1, tituloReceber: daFonte }),
      );
      expect(real['diferenca']).toBe(-100);
      const [c] = await consultar(
        `SELECT o.situacao, o.titulo_receber_id AS oc_receber, o.titulo_pagar_id AS oc_pagar, c.titulo_receber_id,
              c.titulo_pagar_id, c.valor_previsto, c.valor_realizado, c.diferenca, c.usuario_id
         FROM parcela_previsao_financeira o JOIN conciliacao_previsao_realizado c ON c.parcela_previsao_financeira_id = o.id
        WHERE o.id = ?`,
        [o1],
      );
      expect([
        c?.['situacao'],
        Number(c?.['oc_receber']),
        c?.['oc_pagar'],
        Number(c?.['titulo_receber_id']),
        c?.['titulo_pagar_id'],
        Number(c?.['valor_previsto']),
        Number(c?.['valor_realizado']),
        Number(c?.['diferenca']),
        Number(c?.['usuario_id']),
      ]).toEqual(['realizada', daFonte, null, daFonte, null, 2000, 1900, -100, m.lanca]);

      // Realizar de novo e usar o mesmo título noutra ocorrência são recusados.
      expect(
        await codigoDaGravacao(
          executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: o1, tituloReceber: daFonte }),
        ),
      ).toBe('previsao-fechada');
      expect(
        await codigoDaGravacao(
          executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: o2, tituloReceber: daFonte }),
        ),
      ).toBe('titulo-ja-conciliado');

      // A leitura do previsto × realizado traz o número do título a receber.
      const linhas = await ler<Awaited<ReturnType<typeof previstoRealizado>>>((l) =>
        previstoRealizado(l, m.est, '2026-11-01', '2027-01-31'),
      );
      const l1 = linhas.find((x) => x.id === o1);
      expect([l1?.tipo, l1?.situacao, l1?.realizado, l1?.diferenca, l1?.titulo]).toEqual([
        'receita',
        'realizada',
        1900,
        -100,
        `${P}-PR868101`,
      ]);
    });

    it('despesa com título a receber é recusada; o motivo do cancelamento fica na ocorrência e no encerramento', async () => {
      const r = resultado(
        await executar('financeiro.criarPrevisaoFinanceira', {
          descricao: 'MANUTENCAO SINTETICA L0207',
          tipo: 'despesa',
          natureza: naturezaDespesa,
          valor: 500,
          periodicidade: 'mensal',
          diaVencimento: 5,
          dataInicio: '2026-12-01',
          dataFim: '2027-05-31',
          ajuste: 'manter',
        }),
      );
      const previsao = Number(r['previsao']);
      const oc = (
        await consultar(
          'SELECT id FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? ORDER BY sequencia',
          [previsao],
        )
      ).map((o) => Number(o['id']));
      const receber = await tituloReceber(m.convenio, 500, '868103');
      expect(
        await codigoDaGravacao(
          executar('financeiro.realizarPrevisaoFinanceira', { ocorrencia: oc[0], tituloReceber: receber }),
        ),
      ).toBe('titulo-de-outro-lado');

      await executar('financeiro.cancelarOcorrenciaPrevisao', {
        ocorrencia: oc[0],
        motivo: 'manutenção suspensa em dezembro',
      });
      await executar('financeiro.encerrarPrevisaoFinanceira', {
        previsao,
        data: '2027-02-28',
        motivo: 'contrato encerrado',
      });
      const linhas = await consultar(
        'SELECT sequencia, situacao, motivo_cancelamento FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? ORDER BY sequencia',
        [previsao],
      );
      expect(linhas.map((x) => [Number(x['sequencia']), x['situacao'], x['motivo_cancelamento']])).toEqual([
        [1, 'cancelada', 'manutenção suspensa em dezembro'],
        [2, 'aberta', null],
        [3, 'aberta', null],
        [4, 'cancelada', 'Encerramento da previsão em 2027-02-28: contrato encerrado'],
        [5, 'cancelada', 'Encerramento da previsão em 2027-02-28: contrato encerrado'],
        [6, 'cancelada', 'Encerramento da previsão em 2027-02-28: contrato encerrado'],
      ]);
      const leitura = await ler<Awaited<ReturnType<typeof previstoRealizado>>>((l) =>
        previstoRealizado(l, m.est, '2026-12-01', '2026-12-31'),
      );
      expect(leitura.find((x) => x.id === oc[0])?.motivoCancelamento).toBe('manutenção suspensa em dezembro');
    });
  },
);
