// Contrato de efeito do vínculo do item com a referência de preço (F3.6, 05-SUP linha 28) contra o MariaDB real
// (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: vincula com a edição escolhida e o
// fator, troca de referência (o anterior fecha na véspera, nada apagado; a edição vigente da publicação entra sozinha),
// recusa a mesma referência com o mesmo fator, o início retroativo, a referência inativa e a edição de outra
// publicação, e encerra o vigente (o fim antes do início e o segundo encerramento são recusados). A trilha fica em cada
// gravação. A busca traz o fator sugerido pela unidade. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
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
import { PortaVinculoReferenciaPropria } from './vinculo-referencia-preco.js';

const RODADA = Date.now().toString(36).toUpperCase();
const COD = `F36VRP${RODADA}`.slice(0, 18);

describe.skipIf(SEM_BANCO)(
  'vínculo do item com a referência de preço (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaVinculoReferenciaPropria;
    let m: MassaSuprimentos;
    let c: ReturnType<typeof contexto>;
    let ref1 = 0;
    let ref2 = 0;
    let refInativa = 0;
    let edicaoOutra = 0;
    let edicaoOutraFonte = 0;
    let fonteCriada: number | null = null;
    let fonteX = 0;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-vrp' }, (l) => l.consultar<T>(sql, p));
    const vinculos = () =>
      ler<{ id: number; item_referencia_matmed_id: number; edicao_referencia_matmed_id: number | null }>(
        `SELECT id, item_referencia_matmed_id, edicao_referencia_matmed_id, fator_conversao,
              DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, excluido_em
         FROM insumo_referencia_preco WHERE insumo_id = ? ORDER BY vigencia_inicio`,
        [m.insumo],
      );

    const limpar = async (e: Escritor) => {
      await e.executar('DELETE FROM insumo_referencia_preco WHERE insumo_id = ?', [m.insumo]);
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
        const ref = (suf: string, situacao: string, unidade: number | null) =>
          e.inserir(
            `INSERT INTO item_referencia_matmed (fonte_referencia, codigo_referencia, descricao, tipo_produto, situacao, unidade_medida_id, criado_em)
           VALUES ('outra', ?, ?, 'material', ?, ?, ?)`,
            [`${COD}${suf}`, `REFERENCIA SINTETICA ${suf}`, situacao, unidade, agora],
          );
        ref1 = await ref('A', 'ativo', m.unidade);
        ref2 = await ref('B', 'ativo', null);
        refInativa = await ref('C', 'descontinuado', null);
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
      expect(r.map((x) => x.codigo).sort()).toEqual([`${COD}A`, `${COD}B`]);
      expect(r.find((x) => x.id === ref1)?.fatorSugerido).toBe(1);
      expect(r.find((x) => x.id === ref2)?.fatorSugerido).toBeNull();
    });

    it('vincula com a edição e o fator; a troca fecha o anterior na véspera e nada se apaga', async () => {
      const ficha0 = await porta.ficha(c, m.insumo);
      expect(ficha0?.historico).toEqual([]);
      const v1 = await porta.vincular(c, m.insumo, {
        referencia: ref1,
        edicao: edicaoOutra,
        fator: 1,
        inicio: '2026-01-01',
      });
      const v2 = await porta.vincular(c, m.insumo, {
        referencia: ref2,
        edicao: null,
        fator: 12.5,
        inicio: '2026-03-01',
      });
      const rs = await vinculos();
      expect(rs).toHaveLength(2);
      expect(rs[0]).toMatchObject({
        id: v1.id,
        edicao_referencia_matmed_id: edicaoOutra,
        inicio: '2026-01-01',
        fim: '2026-02-28',
        excluido_em: null,
      });
      expect(Number(rs[0]?.['fator_conversao'])).toBe(1);
      expect(rs[1]).toMatchObject({
        id: v2.id,
        item_referencia_matmed_id: ref2,
        inicio: '2026-03-01',
        fim: null,
      });
      expect(Number(rs[1]?.['fator_conversao'])).toBe(12.5);
      // A edição vigente da publicação entra sozinha quando não é escolhida.
      expect(rs[1]?.edicao_referencia_matmed_id).not.toBeNull();
      const [t] = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'insumo_referencia_preco' AND entidade_id IN (?, ?)",
        [v1.id, v2.id],
      );
      expect(Number(t?.n)).toBeGreaterThanOrEqual(2);
      const ficha = await porta.ficha(c, m.insumo);
      expect(ficha?.historico.map((x) => x.id)).toEqual([v2.id, v1.id]);
      expect(ficha?.vigente?.id).toBe(v2.id);
    });

    it('recusa sem gravar: mesma referência e fator, início retroativo, referência inativa, edição de outra publicação', async () => {
      const antes = (await vinculos()).length;
      expect(
        await codigoDe(
          porta.vincular(c, m.insumo, { referencia: ref2, edicao: null, fator: 12.5, inicio: '2026-04-01' }),
        ),
      ).toBe('vinculo-sem-mudanca');
      expect(
        await codigoDe(
          porta.vincular(c, m.insumo, { referencia: ref1, edicao: null, fator: 1, inicio: '2026-02-01' }),
        ),
      ).toBe('vinculo-retroativo');
      expect(
        await codigoDe(
          porta.vincular(c, m.insumo, {
            referencia: refInativa,
            edicao: null,
            fator: 1,
            inicio: '2026-05-01',
          }),
        ),
      ).toBe('referencia-inativa');
      expect(
        await codigoDe(
          porta.vincular(c, m.insumo, {
            referencia: ref1,
            edicao: edicaoOutraFonte,
            fator: 1,
            inicio: '2026-05-01',
          }),
        ),
      ).toBe('edicao-de-outra-fonte');
      expect(
        await codigoDe(
          porta.vincular(c, m.insumo, { referencia: ref1, edicao: null, fator: 0, inicio: '2026-05-01' }),
        ),
      ).toBe('fator-invalido');
      expect((await vinculos()).length).toBe(antes);
    });

    it('encerra o vigente numa data (o fim antes do início e o segundo encerramento são recusados)', async () => {
      const rs = await vinculos();
      const aberto = rs[1]!;
      expect(await codigoDe(porta.encerrar(c, m.insumo, aberto.id, '2026-02-15'))).toBe('vigencia-invalida');
      expect(await codigoDe(porta.encerrar(c, m.insumo, rs[0]!.id, '2026-06-30'))).toBe(
        'vinculo-ja-encerrado',
      );
      await porta.encerrar(c, m.insumo, aberto.id, '2026-06-30');
      expect(await codigoDe(porta.encerrar(c, m.insumo, aberto.id, '2026-07-30'))).toBe(
        'vinculo-ja-encerrado',
      );
      const depois = await vinculos();
      expect(depois.map((x) => x['fim'])).toEqual(['2026-02-28', '2026-06-30']);
      expect(depois.every((x) => x['excluido_em'] === null)).toBe(true);
      expect(await codigoDe(porta.encerrar(c, m.insumoOpme, aberto.id, '2026-06-30'))).toBe(
        'vinculo-inexistente',
      );
    });
  },
);
