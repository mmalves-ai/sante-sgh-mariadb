// Contrato de efeito do vínculo do item com a referência de preço (F3.6, 05-SUP linha 28) contra o MariaDB real
// (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: vincula com a edição escolhida e o
// fator; a linha do tempo é por publicação (dois vínculos simultâneos de publicações diferentes convivem; a troca na
// mesma publicação fecha o anterior na véspera, nada apagado; a edição vigente entra sozinha); a Idempotency-Key repetida
// devolve o mesmo id sem gravar outra linha; recusa a mesma referência com o mesmo fator, o início antes de hoje ou do
// último, a referência inativa e a edição de outra publicação; encerra o vigente (fim antes do início, antes de hoje e o
// segundo encerramento recusados); a conta escolhe o vínculo pela referência do faturável ou pela publicação da tabela.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
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
import { PortaVinculoReferenciaPropria, vinculoReferenciaDaConta } from './vinculo-referencia-preco.js';

const RODADA = Date.now().toString(36).toUpperCase();
const COD = `F36VRP${RODADA}`.slice(0, 18);
const k = () => `t-vrp-${randomUUID()}`;

describe.skipIf(SEM_BANCO)(
  'vínculo do item com a referência de preço (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaVinculoReferenciaPropria;
    let m: MassaSuprimentos;
    let c: ReturnType<typeof contexto>;
    let ref1 = 0;
    let ref2 = 0;
    let ref3 = 0;
    let hoje = '';
    const dia = (d: number) => {
      const x = new Date(`${hoje}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() + d);
      return x.toISOString().slice(0, 10);
    };
    let refInativa = 0;
    let edicaoOutra = 0;
    let edicaoOutraFonte = 0;
    let fonteCriada: number | null = null;
    let fonteX = 0;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-vrp' }, (l) => l.consultar<T>(sql, p));
    const vinculos = () =>
      ler<
        Record<string, unknown> & {
          id: number;
          item_referencia_matmed_id: number;
          edicao_referencia_matmed_id: number | null;
        }
      >(
        `SELECT id, item_referencia_matmed_id, edicao_referencia_matmed_id, fator_conversao,
              DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, excluido_em
         FROM insumo_referencia_preco WHERE insumo_id = ? ORDER BY vigencia_inicio, id`,
        [m.insumo],
      );

    const limpar = async (e: Escritor) => {
      await e.executar('DELETE FROM insumo_referencia_preco WHERE insumo_id IN (?, ?)', [
        m.insumo,
        m.insumoOpme,
      ]);
      await e.executar(
        'DELETE FROM insumo_referencia_preco WHERE item_referencia_matmed_id IN (SELECT id FROM item_referencia_matmed WHERE codigo_referencia LIKE ?)',
        [`${COD}%`],
      );
      await e.executar('DELETE FROM item_referencia_matmed WHERE codigo_referencia LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM edicao_referencia_matmed WHERE numero_edicao LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM fonte_referencia_matmed WHERE codigo LIKE ?', [`${COD}%`]);
      if (fonteCriada) await e.executar('DELETE FROM fonte_referencia_matmed WHERE id = ?', [fonteCriada]);
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      porta = new PortaVinculoReferenciaPropria(nucleo);
      c = contexto(m, m.estA, 'f36-vrp');
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-vrp' }, async (e) => {
        await e.executar('DELETE FROM insumo_referencia_preco WHERE insumo_id = ?', [m.insumo]);
        const agora = new Date();
        const [fo] = await e.consultar<{ id: number }>(
          "SELECT id FROM fonte_referencia_matmed WHERE codigo = 'outra'",
          [],
        );
        let fonte = fo ? Number(fo.id) : 0;
        if (!fonte) {
          fonte = await e.inserir(
            "INSERT INTO fonte_referencia_matmed (codigo, descricao, tipo_fonte, criado_em) VALUES ('outra', 'PUBLICACAO SINTETICA', 'outra', ?)",
            [agora],
          );
          fonteCriada = fonte;
        }
        fonteX = await e.inserir(
          "INSERT INTO fonte_referencia_matmed (codigo, descricao, tipo_fonte, criado_em) VALUES (?, 'OUTRA SINTETICA', 'outra', ?)",
          [`${COD}X`, agora],
        );
        const edicao = (f: number, num: string) =>
          e.inserir(
            `INSERT INTO edicao_referencia_matmed (fonte_referencia_matmed_id, numero_edicao, vigencia_inicio, situacao, operacao, ocorrido_em, criado_em)
           VALUES (?, ?, '2000-01-01', 'ativa', 'inclusao', ?, ?)`,
            [f, num, agora, agora],
          );
        edicaoOutra = await edicao(fonte, `${COD}E1`);
        edicaoOutraFonte = await edicao(fonteX, `${COD}E2`);
        const ref = (suf: string, situacao: string, unidade: number | null, fonteRef = 'outra') =>
          e.inserir(
            `INSERT INTO item_referencia_matmed (fonte_referencia, codigo_referencia, descricao, tipo_produto, situacao, unidade_medida_id, criado_em)
           VALUES (?, ?, ?, 'material', ?, ?, ?)`,
            [fonteRef, `${COD}${suf}`, `REFERENCIA SINTETICA ${suf}`, situacao, unidade, agora],
          );
        ref1 = await ref('A', 'ativo', m.unidade);
        ref2 = await ref('B', 'ativo', null);
        refInativa = await ref('C', 'descontinuado', null);
        ref3 = await ref('D', 'ativo', null, 'brasindice');
        const [h] = await e.consultar<{ d: string }>(
          "SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS d",
          [],
        );
        hoje = String(h?.d);
      });
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        if (m) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-vrp' }, (e) => limpar(e));
        await limparMassa(nucleo, m);
        await nucleo.encerrar();
      }
    });

    it('a busca traz a referência ativa com o fator sugerido pela unidade (a inativa fica de fora)', async () => {
      const r = await porta.buscar(c, m.insumo, COD);
      expect(r.map((x) => x.codigo).sort()).toEqual([`${COD}A`, `${COD}B`, `${COD}D`]);
      expect(r.find((x) => x.id === ref1)?.fatorSugerido).toBe(1);
      expect(r.find((x) => x.id === ref2)?.fatorSugerido).toBeNull();
    });

    it('vincula com a edição e o fator; a troca na mesma publicação fecha o anterior na véspera; outra publicação convive', async () => {
      const ficha0 = await porta.ficha(c, m.insumo);
      expect(ficha0?.historico).toEqual([]);
      const chave1 = k();
      const e1 = { referencia: ref1, edicao: edicaoOutra, fator: 1, inicio: dia(0) };
      const v1 = await porta.vincular(c, m.insumo, e1, chave1);
      // A repetição do mesmo pedido (resposta perdida) devolve o mesmo id e não grava outra linha.
      expect(await porta.vincular(c, m.insumo, e1, chave1)).toEqual(v1);
      expect(await vinculos()).toHaveLength(1);
      // A mesma chave com outro pedido é recusada.
      expect(await codigoDe(porta.vincular(c, m.insumo, { ...e1, fator: 2 }, chave1))).not.toBe('ok');
      const v3 = await porta.vincular(
        c,
        m.insumo,
        { referencia: ref3, edicao: null, fator: 5, inicio: dia(0) },
        k(),
      );
      const v2 = await porta.vincular(
        c,
        m.insumo,
        { referencia: ref2, edicao: null, fator: 12.5, inicio: dia(60) },
        k(),
      );
      const rs = await vinculos();
      expect(rs).toHaveLength(3);
      const por = (id: number) => rs.find((x) => x.id === id);
      expect(por(v1.id)).toMatchObject({
        edicao_referencia_matmed_id: edicaoOutra,
        inicio: dia(0),
        fim: dia(59),
        excluido_em: null,
      });
      expect(Number(por(v1.id)?.['fator_conversao'])).toBe(1);
      // A outra publicação não foi fechada pela troca.
      expect(por(v3.id)).toMatchObject({ item_referencia_matmed_id: ref3, inicio: dia(0), fim: null });
      expect(por(v2.id)).toMatchObject({ item_referencia_matmed_id: ref2, inicio: dia(60), fim: null });
      expect(Number(por(v2.id)?.['fator_conversao'])).toBe(12.5);
      // A edição vigente da publicação entra sozinha quando não é escolhida.
      expect(por(v2.id)?.edicao_referencia_matmed_id).not.toBeNull();
      const [t] = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'insumo_referencia_preco' AND entidade_id IN (?, ?, ?)",
        [v1.id, v2.id, v3.id],
      );
      expect(Number(t?.n)).toBeGreaterThanOrEqual(3);
      const ficha = await porta.ficha(c, m.insumo);
      expect(ficha?.historico).toHaveLength(3);
      expect(ficha?.vigentes.map((x) => x.id).sort((a, b) => a - b)).toEqual(
        [v1.id, v3.id].sort((a, b) => a - b),
      );
    });

    it('a conta escolhe o vínculo pela referência do faturável, senão pela publicação da tabela da conta', async () => {
      const escolher = (data: string, referenciaDoFaturavel: number | null, fonteDaTabela: string | null) =>
        nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-vrp' }, (l) =>
          vinculoReferenciaDaConta(l, m.insumo, data, { referenciaDoFaturavel, fonteDaTabela }),
        );
      expect(await escolher(dia(0), null, 'brasindice')).toMatchObject({ referencia: ref3, fator: 5 });
      expect(await escolher(dia(0), ref1, 'brasindice')).toMatchObject({ referencia: ref1, fator: 1 });
      expect(await escolher(dia(0), null, 'outra')).toMatchObject({ referencia: ref1, fator: 1 });
      // Depois da troca na publicação 'outra', a conta usa a referência nova com o fator novo.
      expect(await escolher(dia(60), null, 'outra')).toMatchObject({ referencia: ref2, fator: 12.5 });
      expect(await escolher(dia(-1), null, 'outra')).toBeNull();
    });

    it('recusa sem gravar: mesma referência e fator, início antes de hoje ou do último, referência inativa, edição de outra publicação', async () => {
      const antes = (await vinculos()).length;
      const tentar = (e: { referencia: number; edicao: number | null; fator: number; inicio: string }) =>
        codigoDe(porta.vincular(c, m.insumo, e, k()));
      expect(await tentar({ referencia: ref2, edicao: null, fator: 12.5, inicio: dia(70) })).toBe(
        'vinculo-sem-mudanca',
      );
      expect(await tentar({ referencia: ref1, edicao: null, fator: 1, inicio: dia(30) })).toBe(
        'vinculo-retroativo',
      );
      expect(await tentar({ referencia: ref3, edicao: null, fator: 2, inicio: dia(-1) })).toBe(
        'vinculo-retroativo',
      );
      expect(await tentar({ referencia: refInativa, edicao: null, fator: 1, inicio: dia(80) })).toBe(
        'referencia-inativa',
      );
      expect(await tentar({ referencia: ref1, edicao: edicaoOutraFonte, fator: 1, inicio: dia(80) })).toBe(
        'edicao-de-outra-fonte',
      );
      expect(await tentar({ referencia: ref1, edicao: null, fator: 0, inicio: dia(80) })).toBe(
        'fator-invalido',
      );
      expect((await vinculos()).length).toBe(antes);
    });

    it('encerra o vigente numa data (fim antes do início, antes de hoje e o segundo encerramento são recusados)', async () => {
      const rs = await vinculos();
      const v1 = rs.find((x) => x.item_referencia_matmed_id === ref1)!;
      const v2 = rs.find((x) => x.item_referencia_matmed_id === ref2)!;
      expect(await codigoDe(porta.encerrar(c, m.insumo, v2.id, dia(30), k()))).toBe('vigencia-invalida');
      expect(await codigoDe(porta.encerrar(c, m.insumo, v1.id, dia(90), k()))).toBe('vinculo-ja-encerrado');
      const chave = k();
      const fim = await porta.encerrar(c, m.insumo, v2.id, dia(90), chave);
      expect(await porta.encerrar(c, m.insumo, v2.id, dia(90), chave)).toEqual(fim);
      expect(await codigoDe(porta.encerrar(c, m.insumo, v2.id, dia(120), k()))).toBe('vinculo-ja-encerrado');
      const depois = await vinculos();
      expect(depois.find((x) => x.id === v2.id)?.['fim']).toBe(dia(90));
      expect(depois.find((x) => x.id === v1.id)?.['fim']).toBe(dia(59));
      expect(depois.every((x) => x['excluido_em'] === null)).toBe(true);
      expect(await codigoDe(porta.encerrar(c, m.insumoOpme, v2.id, dia(90), k()))).toBe(
        'vinculo-inexistente',
      );
      // Um vínculo que já vale desde o passado não termina antes de hoje (o preço já lançado não se reescreve).
      const antigo = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-vrp' }, (e) =>
        e.inserir(
          `INSERT INTO insumo_referencia_preco (insumo_id, item_referencia_matmed_id, fator_conversao, vigencia_inicio, criado_em)
           VALUES (?, ?, 1, ?, ?)`,
          [m.insumoOpme, ref1, dia(-30), new Date()],
        ),
      );
      expect(await codigoDe(porta.encerrar(c, m.insumoOpme, antigo, dia(-1), k()))).toBe(
        'encerramento-retroativo',
      );
    });
  },
);
