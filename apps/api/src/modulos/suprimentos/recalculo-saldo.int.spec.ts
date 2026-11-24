// Contrato de efeito do recálculo auditado do saldo (F3.6, 05-SUP linha 16) contra o MariaDB real (cliente de teste
// do lote, massa SINTÉTICA, nenhuma pessoa real). Um saldo com o gravado divergente do razão: a prévia mostra o
// gravado, o refeito e a diferença sem gravar; o período que alcança um mês fechado e o motivo curto são recusados
// pelo código; a aplicação pelo Executor grava o saldo refeito (quantidade e custo médio) e a posição depois de cada
// movimento (o histórico do item e o custo que o fechamento toma), registra o recálculo com o escopo, o motivo, o
// usuário e as diferenças, com trilha e outbox, deixa o razão intacto e, repetida com a mesma chave, não grava de novo.
// Também: a abertura pelo último mês fechado (o período gravado é o de fato refeito), sem refazer o custo, o estorno
// de entrada, o lote refeito pelo razão (e o lote divergente pendente) e o escopo de todo o estabelecimento com o
// pendente de razão negativo listado sem gravar e o saldo do outro estabelecimento intacto.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
const MOTIVO = 'Saldo divergente do razão no teste sintético';

describe.skipIf(SEM_BANCO)(
  'recálculo auditado do saldo na porta própria (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSuprimentosPropria;
    let m: MassaSuprimentos;
    let c: ContextoSuprimentos;
    let saldo = 0;
    let local = 0;
    let insumo = 0;
    const extra: Record<string, number> = {};
    const saldos: Record<string, number> = {};
    const movS1: number[] = [];
    let ordem = 0;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-recalculo' }, (l) => l.consultar<T>(sql, p));
    const hoje = new Date();
    const entrada = (extra: Record<string, unknown> = {}) => ({
      local,
      insumo,
      ano: hoje.getFullYear(),
      mes: hoje.getMonth() + 1,
      recalculaCusto: true,
      motivo: MOTIVO,
      ...extra,
    });
    const limparRecalculos = (e: Escritor) =>
      e.executar('DELETE FROM recalculo_saldo_estoque WHERE estabelecimento_id IN (?, ?)', [m.estA, m.estB]);

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      porta = new PortaSuprimentosPropria(nucleo);
      c = { ...contexto(m, m.estB, 'f36-recalculo') } as ContextoSuprimentos;
      local = m.localB;
      insumo = m.insumoInativo;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-recalculo' }, async (e) => {
        await limparRecalculos(e);
        const agora = new Date();
        const [antes] = await e.consultar<{ q: number }>(
          'SELECT COUNT(*) AS q FROM movimento_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
          [local, insumo],
        );
        expect(Number(antes?.q)).toBe(0);
        const [s] = await e.consultar<{ id: number }>(
          'SELECT id FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
          [local, insumo],
        );
        // O gravado diverge do razão de propósito: 99 a 1,00 (o razão dá 15 a 20,00).
        if (s) {
          saldo = Number(s.id);
          await e.executar('UPDATE saldo_estoque SET quantidade = 99, custo_medio = 1 WHERE id = ?', [saldo]);
        } else
          saldo = await e.inserir(
            'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, 99, 1, ?)',
            [m.estB, local, insumo, agora],
          );
        const [tipo] = await e.consultar<{ id: number }>(
          'SELECT id FROM tipo_movimento_estoque ORDER BY id LIMIT 1',
          [],
        );
        const [u] = await e.consultar<{ id: number }>(
          'SELECT estoque_unidade_medida_id AS id FROM insumo WHERE id = ?',
          [insumo],
        );
        const comp = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
        const razao: [string, number, number][] = [
          ['entrada', 10, 100],
          ['entrada', 10, 300],
          ['saida', 5, 100],
        ];
        for (const [i, [natureza, q, v]] of razao.entries())
          await e.inserir(
            `INSERT INTO movimento_estoque (estabelecimento_id, local_estoque_id, ocorrido_em, competencia,
             tipo_movimento_estoque_id, natureza, insumo_id, unidade_medida_id, quantidade, quantidade_estoque,
             custo_unitario, valor_total, usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.estB,
              local,
              new Date(agora.getTime() - (3 - i) * 60_000),
              comp,
              Number(tipo?.id),
              natureza,
              insumo,
              Number(u?.id),
              q,
              q,
              v / q,
              v,
              m.usuario,
              agora,
            ],
          );
        const fechamento = await e.inserir(
          "INSERT INTO fechamento_estoque (estabelecimento_id, competencia, situacao, fechado_em, criado_em) VALUES (?, '2020-01-01', 'fechado', ?, ?)",
          [m.estB, agora, agora],
        );
        // O histórico do item gravado com a posição errada (o recálculo a refaz).
        movS1.push(
          ...(
            await e.consultar<{ id: number }>(
              'SELECT id FROM movimento_estoque WHERE local_estoque_id = ? AND insumo_id = ? ORDER BY ocorrido_em, id',
              [local, insumo],
            )
          ).map((x) => Number(x.id)),
        );
        await e.executar(
          'UPDATE movimento_estoque SET saldo_apos = 99, custo_medio_apos = 1 WHERE local_estoque_id = ? AND insumo_id = ?',
          [local, insumo],
        );
        // Os demais casos, cada um num item sintético novo do mesmo local.
        const novoItem = async (k: string, lote = false) => {
          const id = await inserirMinimo(
            e,
            'insumo',
            {
              codigo: `${m.marca}R${k}`,
              nome: `ITEM SINTETICO REC ${k}`,
              tipo: 'material',
              grupo_insumo_id: m.grupo,
              estoque_unidade_medida_id: m.unidade,
              situacao: 'ativo',
              controla_lote: lote,
            },
            m.marca,
          );
          extra[k] = id;
          return id;
        };
        const novoSaldo = async (k: string, q: number, custo: number) => {
          saldos[k] = await e.inserir(
            'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [m.estB, local, extra[k], q, custo, agora],
          );
        };
        const mov = async (
          k: string,
          natureza: 'entrada' | 'saida',
          q: number,
          v: number,
          o: { comp?: string; estorno?: number; lotes?: [number, number][]; apos?: [number, number] } = {},
        ) => {
          ordem += 1;
          const id = await e.inserir(
            `INSERT INTO movimento_estoque (estabelecimento_id, local_estoque_id, ocorrido_em, competencia,
             tipo_movimento_estoque_id, natureza, insumo_id, unidade_medida_id, quantidade, quantidade_estoque,
             custo_unitario, valor_total, saldo_apos, custo_medio_apos, estorno_movimento_estoque_id, usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.estB,
              local,
              new Date(agora.getTime() - 3_600_000 + ordem * 1000),
              o.comp ?? comp,
              Number(tipo?.id),
              natureza,
              extra[k],
              Number(u?.id),
              q,
              q,
              v / q,
              v,
              o.apos?.[0] ?? null,
              o.apos?.[1] ?? null,
              o.estorno ?? null,
              m.usuario,
              agora,
            ],
          );
          for (const [i, [lote, ql]] of (o.lotes ?? []).entries())
            await e.inserir(
              'INSERT INTO movimento_lote (movimento_estoque_id, sequencia, lote_insumo_id, quantidade, criado_em) VALUES (?, ?, ?, ?, ?)',
              [id, i + 1, lote, ql, agora],
            );
          return id;
        };
        const novoLote = async (k: string, q: number) => {
          const lote = await inserirMinimo(
            e,
            'lote_insumo',
            {
              estabelecimento_id: m.estB,
              insumo_id: extra[k],
              numero_lote: `${m.marca}RL${k}`,
              validade: '2030-12-31',
              situacao: 'liberado',
            },
            m.marca,
          );
          await inserirMinimo(
            e,
            'saldo_lote',
            {
              estabelecimento_id: m.estB,
              local_estoque_id: local,
              lote_insumo_id: lote,
              quantidade: q,
              competencia: comp,
            },
            m.marca,
          );
          return lote;
        };
        // Abertura pelo último mês fechado (01/2020: 8 a 2,00); o movimento de antes dele não conta.
        await novoItem('AB');
        await novoSaldo('AB', 50, 3);
        await inserirMinimo(
          e,
          'saldo_estoque_mensal',
          {
            saldo_estoque_id: saldos['AB'],
            competencia: '2020-01-01',
            quantidade_final: 8,
            custo_medio: 2,
            fechado: true,
            fechamento_estoque_id: fechamento,
            usuario_id: m.usuario,
          },
          m.marca,
        );
        await mov('AB', 'entrada', 100, 100, { comp: '2019-12-01' });
        await mov('AB', 'entrada', 2, 10);
        // Sem refazer o custo: 5 a 9,00 gravado; o razão dá 4.
        await novoItem('SC');
        await novoSaldo('SC', 5, 9);
        extra['SCmov'] = await mov('SC', 'entrada', 4, 40, { apos: [1, 7] });
        // Estorno de entrada: sai pelo valor dela e desfaz o custo (10 a 10,00).
        await novoItem('ES');
        await novoSaldo('ES', 10, 20);
        await mov('ES', 'entrada', 10, 100);
        const estornada = await mov('ES', 'entrada', 10, 300);
        await mov('ES', 'saida', 10, 300, { estorno: estornada });
        // Razão negativo no 2º movimento: pendente, nunca gravado.
        await novoItem('NG');
        await novoSaldo('NG', 7, 1);
        await mov('NG', 'entrada', 1, 1);
        await mov('NG', 'saida', 3, 3);
        // Lote refeito pelo razão: 3 gravado no lote; o razão do lote dá 6.
        await novoItem('LT', true);
        await novoSaldo('LT', 3, 1);
        extra['LTlote'] = await novoLote('LT', 3);
        await mov('LT', 'entrada', 10, 10, { lotes: [[extra['LTlote'], 10]] });
        await mov('LT', 'saida', 4, 4, { lotes: [[extra['LTlote'], 4]] });
        // Lote divergente: o razão (5) não tem lote, o lote gravado tem 2: pendente.
        await novoItem('LD', true);
        await novoSaldo('LD', 2, 1);
        extra['LDlote'] = await novoLote('LD', 2);
        await mov('LD', 'entrada', 5, 5);
      });
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        if (m)
          await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-recalculo' }, (e) =>
            limparRecalculos(e),
          );
        await limparMassa(nucleo, m);
        await nucleo.encerrar();
      }
    }, 120_000);

    it('a prévia mostra o gravado, o refeito pelo razão e a diferença, sem gravar', async () => {
      const p = await porta.previaRecalculo(c, entrada());
      expect(p.saldos).toBe(1);
      expect(p.pendentes).toBe(0);
      expect(p.diferencas).toHaveLength(1);
      expect(p.diferencas[0]).toMatchObject({
        saldo,
        movimentos: 3,
        pendencia: null,
        quantidadeGravada: 99,
        quantidadeRefeita: 15,
        custoGravado: 1,
        custoRefeito: 20,
        diferencaQuantidade: -84,
        diferencaValor: 201,
        negativoNoMovimento: null,
      });
      const [s] = await ler<{ quantidade: string }>('SELECT quantidade FROM saldo_estoque WHERE id = ?', [
        saldo,
      ]);
      expect(Number(s?.quantidade)).toBe(99);
    });

    it('recusa o período que alcança um mês fechado e o motivo curto', async () => {
      expect(await codigoDe(porta.previaRecalculo(c, entrada({ ano: 2019, mes: 12 })))).toBe(
        'periodo-fechado',
      );
      expect(
        await codigoDe(
          porta.executar(c, 'suprimentos.recalcularSaldos', entrada({ motivo: 'curto' }), {
            ...c,
            chaveIdempotencia: `f36rec-${RODADA}-curto`,
          }),
        ),
      ).toBe('motivo-obrigatorio');
    });

    it('aplica: grava o saldo refeito, registra o recálculo auditado e deixa o razão intacto; a repetição não grava', async () => {
      const chave = `f36rec-${RODADA}-aplica`;
      const somaAntes = await ler<{ q: string; v: string; n: number }>(
        'SELECT COUNT(*) AS n, SUM(quantidade_estoque) AS q, SUM(valor_total) AS v FROM movimento_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
        [local, insumo],
      );
      const r = await porta.executar(c, 'suprimentos.recalcularSaldos', entrada(), {
        ...c,
        chaveIdempotencia: chave,
      });
      expect(r.repetida).toBe(false);
      expect(r.resultado).toMatchObject({ saldos: 1, corrigidos: 1, pendentes: 0, diferencaValor: 201 });
      const [s] = await ler<{ quantidade: string; custo_medio: string }>(
        'SELECT quantidade, custo_medio FROM saldo_estoque WHERE id = ?',
        [saldo],
      );
      expect(Number(s?.quantidade)).toBe(15);
      expect(Number(s?.custo_medio)).toBe(20);
      const regs = await ler<Record<string, unknown>>(
        `SELECT saldo_estoque_id, local_estoque_id, insumo_id, situacao, concluido_em, usuario_id, recalcula_custo,
              insumos_atingidos, diferenca_quantidade_total, diferenca_valor_total, motivo, operacao, dados
         FROM recalculo_saldo_estoque WHERE estabelecimento_id = ?`,
        [m.estB],
      );
      expect(regs).toHaveLength(1);
      const g = regs[0] ?? {};
      expect(Number(g['saldo_estoque_id'])).toBe(saldo);
      expect(Number(g['local_estoque_id'])).toBe(local);
      expect(Number(g['insumo_id'])).toBe(insumo);
      expect(g['situacao']).toBe('concluido');
      expect(g['concluido_em']).not.toBeNull();
      expect(Number(g['usuario_id'])).toBe(m.usuario);
      expect(Number(g['recalcula_custo'])).toBe(1);
      expect(Number(g['insumos_atingidos'])).toBe(1);
      expect(Number(g['diferenca_quantidade_total'])).toBe(-84);
      expect(Number(g['diferenca_valor_total'])).toBe(201);
      expect(g['motivo']).toBe(MOTIVO);
      const dados = (typeof g['dados'] === 'string' ? JSON.parse(g['dados']) : g['dados']) as {
        diferencas: { saldo: number; de: number; para: number }[];
      };
      expect(dados.diferencas).toEqual([expect.objectContaining({ saldo, de: 99, para: 15 })]);
      // O histórico do item: a posição depois de cada movimento refeita (o fechamento toma dela o custo do mês).
      const hist = await ler<{ saldo_apos: string; custo_medio_apos: string }>(
        `SELECT saldo_apos, custo_medio_apos FROM movimento_estoque WHERE id IN (${movS1.map(() => '?').join(', ')})
          ORDER BY ocorrido_em, id`,
        movS1,
      );
      expect(hist.map((h) => [Number(h.saldo_apos), Number(h.custo_medio_apos)])).toEqual([
        [10, 10],
        [20, 20],
        [15, 20],
      ]);
      // Trilha e outbox na mesma transação.
      const id = Number((r.resultado as { id: number }).id);
      const [tr] = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'recalculo_saldo_estoque' AND entidade_id = ?",
        [id],
      );
      expect(Number(tr?.n)).toBeGreaterThanOrEqual(1);
      const ob = await ler('SELECT ponto FROM integracao_mensagem WHERE ponto = ? AND entidade_id = ?', [
        'suprimentos.recalcular_saldos',
        id,
      ]);
      expect(ob).toHaveLength(1);
      // O razão não é editado.
      const somaDepois = await ler<{ q: string; v: string; n: number }>(
        'SELECT COUNT(*) AS n, SUM(quantidade_estoque) AS q, SUM(valor_total) AS v FROM movimento_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
        [local, insumo],
      );
      expect(JSON.stringify(somaDepois)).toBe(JSON.stringify(somaAntes));
      // A lista dos recálculos traz o motivo e o que foi corrigido.
      const lista = await porta.recalculos(c);
      expect(lista.itens[0]).toMatchObject({
        motivo: MOTIVO,
        insumos: 1,
        diferencaValor: 201,
        terminado: true,
      });
      // A mesma chave não grava de novo; uma nova prévia já confere com o razão.
      const repetida = await porta.executar(c, 'suprimentos.recalcularSaldos', entrada(), {
        ...c,
        chaveIdempotencia: chave,
      });
      expect(repetida.repetida).toBe(true);
      const [cont] = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM recalculo_saldo_estoque WHERE estabelecimento_id = ?',
        [m.estB],
      );
      expect(Number(cont?.n)).toBe(1);
      expect((await porta.previaRecalculo(c, entrada())).diferencas).toEqual([]);
    });

    /** O último recálculo de todo o estabelecimento B (sem local nem item). */
    const registroTodos = async () => {
      const [g] = await ler<Record<string, unknown>>(
        `SELECT competencia_inicio, dados FROM recalculo_saldo_estoque
          WHERE estabelecimento_id = ? AND local_estoque_id IS NULL AND insumo_id IS NULL ORDER BY id DESC LIMIT 1`,
        [m.estB],
      );
      return g ?? {};
    };
    const dataDe = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const saldoDe = async (id: number) => {
      const [s] = await ler<{ quantidade: string; custo_medio: string }>(
        'SELECT quantidade, custo_medio FROM saldo_estoque WHERE id = ?',
        [id],
      );
      return [Number(s?.quantidade), Number(s?.custo_medio)];
    };

    it('parte do último mês fechado e grava o período de fato refeito (não o mês pedido)', async () => {
      const p = await porta.previaRecalculo(c, entrada({ insumo: extra['AB'] }));
      expect(p.abertura).toBe('01/2020');
      expect(p.inicio).toBe('02/2020');
      expect(p.diferencas[0]).toMatchObject({
        movimentos: 1,
        quantidadeRefeita: 10,
        custoRefeito: 2.6,
        pendencia: null,
      });
      const chave = `f36rec-${RODADA}-abertura`;
      await porta.executar(c, 'suprimentos.recalcularSaldos', entrada({ insumo: extra['AB'] }), {
        ...c,
        chaveIdempotencia: chave,
      });
      expect(await saldoDe(saldos['AB'] ?? 0)).toEqual([10, 2.6]);
      const [g] = await ler<Record<string, unknown>>(
        'SELECT competencia_inicio FROM recalculo_saldo_estoque WHERE estabelecimento_id = ? AND insumo_id = ?',
        [m.estB, extra['AB']],
      );
      expect(dataDe(g?.['competencia_inicio'])).toBe('2020-02-01');
    });

    it('sem refazer o custo: só a quantidade e o saldo depois de cada movimento; o custo fica o gravado', async () => {
      await porta.executar(
        c,
        'suprimentos.recalcularSaldos',
        entrada({ insumo: extra['SC'], recalculaCusto: false }),
        { ...c, chaveIdempotencia: `f36rec-${RODADA}-semcusto` },
      );
      expect(await saldoDe(saldos['SC'] ?? 0)).toEqual([4, 9]);
      const [mv] = await ler<{ saldo_apos: string; custo_medio_apos: string }>(
        'SELECT saldo_apos, custo_medio_apos FROM movimento_estoque WHERE id = ?',
        [extra['SCmov']],
      );
      expect([Number(mv?.saldo_apos), Number(mv?.custo_medio_apos)]).toEqual([4, 7]);
      const [g] = await ler<Record<string, unknown>>(
        'SELECT recalcula_custo FROM recalculo_saldo_estoque WHERE estabelecimento_id = ? AND insumo_id = ?',
        [m.estB, extra['SC']],
      );
      expect(Number(g?.['recalcula_custo'])).toBe(0);
    });

    it('o estorno de entrada sai pelo valor dela na prévia', async () => {
      const p = await porta.previaRecalculo(c, entrada({ insumo: extra['ES'] }));
      expect(p.diferencas[0]).toMatchObject({
        quantidadeRefeita: 10,
        custoRefeito: 10,
        diferencaQuantidade: 0,
        diferencaValor: -100,
        pendencia: null,
      });
    });

    it('todo o estabelecimento: aplica o estorno e o lote; razão negativo e lote divergente ficam pendentes e constam do registro; o outro estabelecimento fica intacto', async () => {
      const outroAntes = await ler(
        'SELECT id, quantidade, custo_medio, versao FROM saldo_estoque WHERE estabelecimento_id = ? ORDER BY id',
        [m.estA],
      );
      expect(outroAntes.length).toBeGreaterThan(0);
      const chave = `f36rec-${RODADA}-todos`;
      await porta.executar(c, 'suprimentos.recalcularSaldos', entrada({ local: null, insumo: null }), {
        ...c,
        chaveIdempotencia: chave,
      });
      expect(await saldoDe(saldos['ES'] ?? 0)).toEqual([10, 10]);
      expect(await saldoDe(saldos['LT'] ?? 0)).toEqual([6, 1]);
      const [lt] = await ler<{ quantidade: string }>(
        'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
        [local, extra['LTlote']],
      );
      expect(Number(lt?.quantidade)).toBe(6);
      expect(await saldoDe(saldos['NG'] ?? 0)).toEqual([7, 1]);
      expect(await saldoDe(saldos['LD'] ?? 0)).toEqual([2, 1]);
      const [ld] = await ler<{ quantidade: string }>(
        'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
        [local, extra['LDlote']],
      );
      expect(Number(ld?.quantidade)).toBe(2);
      const g = await registroTodos();
      const dados = (typeof g['dados'] === 'string' ? JSON.parse(g['dados']) : g['dados']) as {
        diferencas: { saldo: number; pendencia: string | null; negativoNoMovimento: number | null }[];
      };
      expect(dados.diferencas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            saldo: saldos['NG'],
            pendencia: 'razao-negativo',
            negativoNoMovimento: 2,
          }),
          expect.objectContaining({ saldo: saldos['LD'], pendencia: 'lote-divergente' }),
          expect.objectContaining({ saldo: saldos['LT'], pendencia: null }),
        ]),
      );
      expect(dataDe(g['competencia_inicio']) <= '2020-02-01').toBe(true);
      const outroDepois = await ler(
        'SELECT id, quantidade, custo_medio, versao FROM saldo_estoque WHERE estabelecimento_id = ? ORDER BY id',
        [m.estA],
      );
      expect(JSON.stringify(outroDepois)).toBe(JSON.stringify(outroAntes));
    });
  },
);
