// Contrato de efeito do recálculo auditado do saldo (F3.6, 05-SUP linha 16) contra o MariaDB real (cliente de teste
// do lote, massa SINTÉTICA, nenhuma pessoa real). Um saldo com o gravado divergente do razão: a prévia mostra o
// gravado, o refeito e a diferença sem gravar; o período que alcança um mês fechado é recusado; a aplicação pelo
// Executor grava o saldo refeito (quantidade e custo médio), registra o recálculo concluído com o escopo, o motivo,
// o usuário e as diferenças, deixa o razão intacto e, repetida com a mesma chave, não grava de novo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
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
        await e.executar(
          "INSERT INTO fechamento_estoque (estabelecimento_id, competencia, situacao, fechado_em, criado_em) VALUES (?, '2020-01-01', 'fechado', ?, ?)",
          [m.estB, agora, agora],
        );
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
      ).not.toBe('');
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
  },
);
