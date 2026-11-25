// F8, 07-FIN linha 127 (C2-101): contrato de efeito da consolidação gerencial contra o MariaDB real (massa SINTÉTICA
// "C2101", dois estabelecimentos próprios, exercício 2198 isolado; nenhuma pessoa real). O grupo nasce com o plano
// gerencial comum (plano_contas do tipo gerencial ligado ao grupo) e os membros; as contas gerenciais entram por
// exercício; o de-para liga as contas analíticas dos membros. Sem de-para, a apuração é recusada com as pendências.
// Com tudo ligado, a apuração de outubro grava a rodada (apuracao_consolidacao apurada com o total eliminado), as
// eliminações entre empresas pela contrapartida (CPC 36: a venda de serviço de A para B e o saldo a receber/a pagar,
// o registro espelhado de B uma vez só), as transações ficam eliminadas na rodada e o saldo_consolidado_mensal por
// origem e o total; a DRE e o balanço consolidados saem equilibrados. Refazer cancela a rodada anterior e altera os
// saldos (nada duplica); liberada, a competência não se refaz.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo, Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CLIENTE,
  codigoDaGravacao,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from '../financeiro/aplicacao/massa-banco.spec-util.js';
import {
  demonstracoesDoGrupo,
  detalheGrupoConsolidacao,
  OPERACOES_CONSOLIDACAO,
  previaConsolidacao,
} from './consolidacao-propria.js';

const ANO = 2198;
const COMP = `${ANO}-10`;
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t-c2101-${randomUUID()}` });

describe.skipIf(SEM_BANCO)(
  'consolidação gerencial: grupo, de-para, apuração com eliminação e DRE (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let estA = 0;
    let estB = 0;
    let plano = 0;
    let grupo = 0;
    const conta: Record<string, number> = {};
    const gerencial: Record<string, number> = {};
    const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2101' }, fn) as Promise<T>;
    const consultar = (sql: string, p: unknown[]) =>
      ler<Record<string, unknown>[]>((l) => l.consultar(sql, p));
    const executar = (nome: keyof typeof OPERACOES_CONSOLIDACAO, entrada: unknown) =>
      m.nucleo
        .criarExecutor()
        .executar(OPERACOES_CONSOLIDACAO[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, estA)))
        .then((r) => r.resultado as Record<string, unknown>);

    async function limpar(e: Escritor): Promise<void> {
      const ests = [estA, estB];
      const g = 'IN (SELECT id FROM grupo_consolidacao WHERE codigo = ?)';
      await e.executar(`DELETE FROM saldo_consolidado_mensal WHERE grupo_consolidacao_id ${g}`, ['C2101']);
      await e.executar(
        `DELETE x FROM eliminacao_consolidacao x JOIN apuracao_consolidacao a ON a.id = x.apuracao_consolidacao_id WHERE a.grupo_consolidacao_id ${g}`,
        ['C2101'],
      );
      await e.executar('DELETE FROM transacao_intercompanhia WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `UPDATE apuracao_consolidacao SET rodada_anterior_id = NULL WHERE grupo_consolidacao_id ${g}`,
        ['C2101'],
      );
      await e.executar(`DELETE FROM apuracao_consolidacao WHERE grupo_consolidacao_id ${g}`, ['C2101']);
      await e.executar(`DELETE FROM depara_conta_gerencial WHERE grupo_consolidacao_id ${g}`, ['C2101']);
      await e.executar(`DELETE FROM empresa_grupo_consolidacao WHERE grupo_consolidacao_id ${g}`, ['C2101']);
      await e.executar(
        `UPDATE plano_contas SET grupo_consolidacao_id = NULL WHERE grupo_consolidacao_id ${g}`,
        ['C2101'],
      );
      await e.executar("DELETE FROM grupo_consolidacao WHERE codigo = 'C2101'", []);
      await e.executar("DELETE FROM plano_contas WHERE codigo = 'GC-C2101'", []);
      await e.executar(
        'DELETE p FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id WHERE l.estabelecimento_id IN (?, ?)',
        ests,
      );
      await e.executar('DELETE FROM lancamento_contabil WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM periodo_contabil WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('UPDATE conta_gerencial_consolidada SET conta_pai_id = NULL WHERE exercicio = ?', [
        ANO,
      ]);
      await e.executar('DELETE FROM conta_gerencial_consolidada WHERE exercicio = ?', [ANO]);
      await limparTrilhaDaMassa(e, { ids: ests });
    }

    beforeAll(async () => {
      m = await montarMassa();
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2101' }, async (e) => {
        const agora = new Date();
        const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        const est = (c: string) =>
          g(
            'SELECT id FROM estabelecimento WHERE codigo = ?',
            [c],
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [c, `ESTAB ${c} SINTETICO`, `ESTAB ${c} SINTETICO`, agora],
          );
        estA = await est('C2101A');
        estB = await est('C2101B');
        await limpar(e);
        plano = await g(
          "SELECT id FROM plano_contas WHERE codigo = 'C2101'",
          [],
          "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('C2101', 'PLANO SINTETICO C2101', 'contabil', '9.9', 2, '2198-01-01', ?)",
          [agora],
        );
        for (const [cl, desc, nat, saldo] of [
          ['1.1', 'CAIXA', 'ativo', 'devedora'],
          ['1.2', 'A RECEBER DO GRUPO', 'ativo', 'devedora'],
          ['2.1', 'A PAGAR AO GRUPO', 'passivo', 'credora'],
          ['3.1', 'CAPITAL', 'patrimonio_liquido', 'credora'],
          ['4.1', 'RECEITA DE SERVICOS', 'receita', 'credora'],
          ['5.1', 'SERVICOS TOMADOS', 'despesa', 'devedora'],
        ] as const)
          conta[cl] = await g(
            'SELECT id FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = ?',
            [plano, cl],
            `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza, natureza_saldo, tipo, criado_em)
           VALUES (?, ?, ?, ?, 2, ?, ?, 'analitica', ?)`,
            [plano, cl, `C2101${cl.replace('.', '')}`, desc, nat, saldo, agora],
          );
        const periodo: Record<string, number> = {};
        for (const ee of [estA, estB])
          for (const mes of ['09', '10'])
            periodo[`${ee}:${mes}`] = await e.inserir(
              `INSERT INTO periodo_contabil (estabelecimento_id, competencia, exercicio, plano_contas_id, situacao, criado_em)
             VALUES (?, ?, ?, ?, 'aberto', ?)`,
              [ee, `${ANO}-${mes}-01`, ANO, plano, agora],
            );
        let numero = 0;
        const lancar = async (ee: number, mes: string, debito: string, credito: string, valor: number) => {
          const l = await e.inserir(
            `INSERT INTO lancamento_contabil (estabelecimento_id, numero, periodo_contabil_id, data_lancamento, tipo, historico, valor_total, criado_em)
           VALUES (?, ?, ?, ?, 'manual', 'LANCAMENTO SINTETICO C2101', ?, ?)`,
            [ee, ++numero, periodo[`${ee}:${mes}`], `${ANO}-${mes}-15`, valor, agora],
          );
          for (const [seq, lado, c] of [
            [1, 'debito', debito],
            [2, 'credito', credito],
          ] as const)
            await e.inserir(
              'INSERT INTO partida_contabil (lancamento_contabil_id, sequencia, lado, conta_contabil_id, valor, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
              [l, seq, lado, conta[c], valor, agora],
            );
        };
        await lancar(estA, '09', '1.1', '3.1', 1000);
        await lancar(estB, '09', '1.1', '3.1', 2000);
        await lancar(estA, '10', '1.2', '4.1', 300);
        await lancar(estA, '10', '1.1', '4.1', 500);
        await lancar(estB, '10', '5.1', '2.1', 300);
        const transacao = (
          ee: number,
          outro: number,
          n: string,
          tipo: string,
          sentido: string,
          c: string,
          cc: string,
        ) =>
          e.inserir(
            `INSERT INTO transacao_intercompanhia (estabelecimento_id, numero, contraparte_estabelecimento_id, tipo_transacao, sentido,
             data_transacao, competencia, valor, descricao, conta_contabil_id, contraparte_conta_contabil_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 300, 'TRANSACAO SINTETICA C2101', ?, ?, ?)`,
            [ee, n, outro, tipo, sentido, `${ANO}-10-15`, `${ANO}-10-01`, conta[c], conta[cc], agora],
          );
        await transacao(estA, estB, 'C2101-1', 'venda_servico', 'a_receber', '1.2', '2.1');
        await transacao(estB, estA, 'C2101-2', 'venda_servico', 'a_pagar', '2.1', '1.2');
        await transacao(estA, estB, 'C2101-3', 'venda_servico', 'a_receber', '4.1', '5.1');
      });
    }, 60_000);

    afterAll(async () => {
      if (!m) return;
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2101' }, (e) => limpar(e));
      await m.nucleo.encerrar();
    });

    it('grupo com um membro é recusado; o grupo válido nasce com o plano gerencial comum', async () => {
      const base = { codigo: 'C2101', nome: 'GRUPO SINTETICO C2101', vigenciaInicio: `${ANO}-01-01` };
      expect(
        await codigoDaGravacao(
          executar('salvarGrupo', {
            ...base,
            membros: [{ estabelecimento: estA, percentual: 100, metodo: 'integral', consolidadora: true }],
          }),
        ),
      ).toBe('membros-insuficientes');
      const r = await executar('salvarGrupo', {
        ...base,
        membros: [
          { estabelecimento: estA, percentual: 100, metodo: 'integral', consolidadora: true },
          { estabelecimento: estB, percentual: 100, metodo: 'integral', consolidadora: false },
        ],
      });
      grupo = Number(r['grupo']);
      const [g] = await consultar(
        `SELECT g.situacao, g.elimina_intercompanhia, p.tipo, p.grupo_consolidacao_id,
          (SELECT COUNT(*) FROM empresa_grupo_consolidacao m WHERE m.grupo_consolidacao_id = g.id) AS membros,
          (SELECT COUNT(*) FROM empresa_grupo_consolidacao m WHERE m.grupo_consolidacao_id = g.id AND m.consolidadora) AS consolidadoras
         FROM grupo_consolidacao g JOIN plano_contas p ON p.id = g.plano_contas_id WHERE g.id = ?`,
        [grupo],
      );
      expect(g).toMatchObject({ situacao: 'ativo', tipo: 'gerencial', membros: 2, consolidadoras: 1 });
      expect(Number(g!['grupo_consolidacao_id'])).toBe(grupo);
    });

    it('plano gerencial e de-para: sem de-para a apuração é recusada com as pendências', async () => {
      for (const [cl, desc, nat, tipo] of [
        ['1', 'ATIVO', 'ativo', 'sintetica'],
        ['1.1', 'DISPONIVEL', 'ativo', 'analitica'],
        ['1.2', 'ENTRE EMPRESAS', 'ativo', 'analitica'],
        ['2', 'PASSIVO', 'passivo', 'sintetica'],
        ['2.1', 'ENTRE EMPRESAS', 'passivo', 'analitica'],
        ['3', 'PATRIMONIO', 'patrimonio_liquido', 'sintetica'],
        ['3.1', 'CAPITAL', 'patrimonio_liquido', 'analitica'],
        ['4', 'RECEITAS', 'receita', 'sintetica'],
        ['4.1', 'SERVICOS', 'receita', 'analitica'],
        ['5', 'DESPESAS', 'despesa', 'sintetica'],
        ['5.1', 'SERVICOS TOMADOS', 'despesa', 'analitica'],
      ] as const)
        gerencial[cl] = Number(
          (
            await executar('incluirConta', {
              exercicio: ANO,
              classificacao: cl,
              descricao: desc,
              natureza: nat,
              tipo,
            })
          )['conta'],
        );
      expect(
        await codigoDaGravacao(
          executar('incluirConta', {
            exercicio: ANO,
            classificacao: '6.1',
            descricao: 'SEM PAI',
            natureza: 'despesa',
            tipo: 'analitica',
          }),
        ),
      ).toBe('sem-conta-pai');
      const previa = await ler<Awaited<ReturnType<typeof previaConsolidacao>>>((l) =>
        previaConsolidacao(l, grupo, COMP),
      );
      expect(previa!.pendencias.filter((p) => p.tipo === 'conta-sem-depara').length).toBeGreaterThanOrEqual(
        6,
      );
      expect(await codigoDaGravacao(executar('apurar', { grupo, competencia: COMP }))).toBe(
        'consolidacao-com-pendencia',
      );
      // De-para de natureza diferente é recusado.
      expect(
        await codigoDaGravacao(
          executar('salvarDePara', { grupo, itens: [{ conta: conta['1.1'], gerencial: gerencial['2.1'] }] }),
        ),
      ).toBe('natureza-diferente');
      const r = await executar('salvarDePara', {
        grupo,
        itens: ['1.1', '1.2', '2.1', '3.1', '4.1', '5.1'].map((c) => ({
          conta: conta[c],
          gerencial: gerencial[c],
        })),
      });
      expect(r).toMatchObject({ ligadas: 6, desligadas: 0 });
      const d = await ler<Awaited<ReturnType<typeof detalheGrupoConsolidacao>>>((l) =>
        detalheGrupoConsolidacao(l, grupo, ANO),
      );
      expect(d!.depara.filter((x) => x.gerencial !== null)).toHaveLength(12);
    });

    it('apura outubro: eliminações pelo CPC 36, transações eliminadas e saldos por origem e total', async () => {
      const r = await executar('apurar', { grupo, competencia: COMP });
      expect(r).toMatchObject({ eliminacoes: 2, totalEliminado: 600_00, rodadaAnterior: null });
      const apuracao = Number(r['apuracao']);
      const [a] = await consultar(
        'SELECT situacao, valor_total, periodo_fim FROM apuracao_consolidacao WHERE id = ?',
        [apuracao],
      );
      expect(a).toMatchObject({ situacao: 'apurada' });
      expect(Number(a!['valor_total'])).toBe(600);
      const el = await consultar(
        'SELECT debito_conta_contabil_id AS d, credito_conta_contabil_id AS c, valor FROM eliminacao_consolidacao WHERE apuracao_consolidacao_id = ? ORDER BY sequencia',
        [apuracao],
      );
      expect(el.map((x) => [Number(x['d']), Number(x['c']), Number(x['valor'])])).toEqual([
        [conta['2.1'], conta['1.2'], 300],
        [conta['4.1'], conta['5.1'], 300],
      ]);
      const tr = await consultar(
        "SELECT COUNT(*) AS n FROM transacao_intercompanhia WHERE estabelecimento_id IN (?, ?) AND situacao = 'eliminada' AND apuracao_consolidacao_id = ?",
        [estA, estB, apuracao],
      );
      expect(Number(tr[0]!['n'])).toBe(3);
      const total = async (cl: string) =>
        Number(
          (
            await consultar(
              'SELECT saldo_final FROM saldo_consolidado_mensal WHERE grupo_consolidacao_id = ? AND conta_gerencial_consolidada_id = ? AND competencia = ? AND estabelecimento_origem_id IS NULL',
              [grupo, gerencial[cl], `${COMP}-01`],
            )
          )[0]!['saldo_final'],
        );
      expect(await total('1.1')).toBe(3500);
      expect(await total('1.2')).toBe(0);
      expect(await total('2.1')).toBe(0);
      expect(await total('4.1')).toBe(-500);
      expect(await total('5.1')).toBe(0);
      const [porOrigem] = await consultar(
        'SELECT saldo_final FROM saldo_consolidado_mensal WHERE grupo_consolidacao_id = ? AND conta_gerencial_consolidada_id = ? AND estabelecimento_origem_id = ?',
        [grupo, gerencial['1.2'], estA],
      );
      expect(Number(porOrigem!['saldo_final'])).toBe(300);
      const dem = await ler<Awaited<ReturnType<typeof demonstracoesDoGrupo>>>((l) =>
        demonstracoesDoGrupo(l, grupo, COMP),
      );
      expect(dem!.dre.resultadoCentavos).toBe(500_00);
      expect(dem!.balanco.totalAtivoCentavos).toBe(3500_00);
      expect(dem!.balanco.equilibrado).toBe(true);
    });

    it('refazer cancela a rodada anterior sem duplicar saldos; liberada não se refaz', async () => {
      const n = async () =>
        Number(
          (
            await consultar(
              'SELECT COUNT(*) AS n FROM saldo_consolidado_mensal WHERE grupo_consolidacao_id = ?',
              [grupo],
            )
          )[0]!['n'],
        );
      const antes = await n();
      const r = await executar('apurar', { grupo, competencia: COMP });
      expect(r['rodadaAnterior']).not.toBeNull();
      expect(r).toMatchObject({ eliminacoes: 2, totalEliminado: 600_00 });
      expect(await n()).toBe(antes);
      const rodadas = await consultar(
        'SELECT situacao, rodada_anterior_id, versao FROM apuracao_consolidacao WHERE grupo_consolidacao_id = ? ORDER BY id',
        [grupo],
      );
      expect(rodadas.map((x) => x['situacao'])).toEqual(['cancelada', 'apurada']);
      const [alterado] = await consultar(
        "SELECT COUNT(*) AS n FROM saldo_consolidado_mensal WHERE grupo_consolidacao_id = ? AND operacao = 'alteracao'",
        [grupo],
      );
      expect(Number(alterado!['n'])).toBe(antes);
      await executar('liberar', { apuracao: Number(r['apuracao']), versao: Number(rodadas[1]!['versao']) });
      expect(await codigoDaGravacao(executar('apurar', { grupo, competencia: COMP }))).toBe(
        'apuracao-liberada',
      );
    });
  },
);
