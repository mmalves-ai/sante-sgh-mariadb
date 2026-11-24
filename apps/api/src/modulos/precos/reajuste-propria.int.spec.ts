// Contrato de efeito do reajuste em lote e do desfazer pelo lote no banco próprio (06-FAT linha 3), contra o MariaDB
// real. Massa SINTÉTICA com códigos "F37RJ" (nenhum dado real): o que fica no banco depois do reajuste em duas partes
// (lote, itens do lote com componentes anteriores e novos, vigência nova), a autoria da vigência, as recusas reconferidas
// sob a transação e o desfazer que NUNCA apaga (linha de exclusão da vigência, item marcado, lote parcial e depois
// inteiro) com a leitura que volta ao preço anterior. No fim, a massa é apagada (com a trilha do estabelecimento
// sintético); ficam o estabelecimento, o usuário e os cadastros. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { precoVigente } from '../faturamento/preco-conta.js';
import type { ContextoGravacaoPreco, CtxPrecos } from './fonte.js';
import { FontePrecosPropria } from './fonte-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F37RJ';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo']);
    return String(e);
  }
}

const BASE = { ch: 100, co: 5, filme: 0, anes: 0, outros: 1 };
const NOVOS = { ch: 110, co: 5.5, filme: 0, anes: 0, outros: 1.1 };

describe.skipIf(SEM_BANCO)('reajuste e desfazer pelo lote (MariaDB, contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let fonte: FontePrecosPropria;
  const ids = { est: 0, usuario: 0, tabela: 0, a: 0, b: 0, itemA: 0, itemB: 0 };
  let c: CtxPrecos;
  let hoje = '';
  const lote = `F37RJ-${randomUUID().slice(0, 8)}`;
  const gravacao = (): ContextoGravacaoPreco => ({
    ...c,
    chaveIdempotencia: `f37rj-${randomUUID()}`,
    reautenticadoEm: Date.now(),
    login: 'f37rj.teste',
    estacao: 'teste',
  });
  const reajuste = (codigo: number, parte: number, outro = lote, base: typeof BASE | null = BASE) => ({
    tabela: ids.tabela,
    data: hoje,
    lote: outro,
    parte,
    partes: 2,
    modo: 'percentual' as const,
    percentual: 10,
    origem: 'reajuste' as const,
    carga: null,
    justificativa: 'Reajuste anual do acordo (teste sintético)',
    confirmacoes: { tabelaCompartilhada: false, percentualTabela: false },
    itens: [{ codigo, base: base ? { vigencia: '2026-01-15', valores: base } : null, novos: NOVOS }],
  });
  const desfazer = (codigo: number, parte = 1, partes = 1) => ({
    tabela: ids.tabela,
    data: hoje,
    lote,
    parte,
    partes,
    justificativa: 'Percentual errado: desfazer o lote (teste sintético)',
    itens: [{ codigo, valores: NOVOS }],
  });

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        'DELETE i FROM lote_reajuste_item i JOIN lote_reajuste lr ON lr.id = i.lote_reajuste_id WHERE lr.tabela_preco_id = ?',
        [ids.tabela],
      );
      await e.executar('DELETE FROM lote_reajuste WHERE tabela_preco_id = ?', [ids.tabela]);
      await e.executar(
        'DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id WHERE pp.tabela_preco_id = ?',
        [ids.tabela],
      );
      await e.executar('DELETE FROM preco_procedimento WHERE tabela_preco_id = ?', [ids.tabela]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f37rj' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        ['f37rje'],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        ['f37rje', 'ESTAB F37RJ SINTETICO', 'ESTAB F37RJ SINTETICO', agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f37rj.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f37rj.teste', 'TESTE F37RJ', agora],
      );
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
           VALUES (?, ?, 'HONORARIOS F37RJ', 'honorario', 'propria', 'real', 'ativa', ?)`,
        [ids.est, `${P}-HON`, agora],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}-HON`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'HONORARIOS F37RJ', 'honorario', ?)",
        [`${P}-HON`, agora],
      );
      const item = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM item_faturavel WHERE codigo = ?',
          [cod],
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, 'CONSULTA SINTETICA F37RJ', 'honorario', ?, ?)",
          [cod, grupo, agora],
        );
      ids.itemA = await item(`${P}-A`);
      ids.itemB = await item(`${P}-B`);
      await limpar(e);
      for (const [k, it, seq] of [
        ['a', ids.itemA, 1],
        ['b', ids.itemB, 2],
      ] as const) {
        ids[k] = await e.inserir(
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
             VALUES (?, ?, ?, 'valor', ?)`,
          [ids.tabela, seq, it, agora],
        );
        await e.inserir(
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, ocorrido_em, vigencia_inicio, valor_honorario,
             valor_custo_operacional, valor_filme, valor_anestesia, valor_outros, valor_total, criado_em)
           VALUES (?, ?, '2026-01-15', 100, 5, 0, 0, 1, 106, ?)`,
          [ids[k], agora, agora],
        );
      }
    });
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-f37rj',
      rede: 'teste',
      hospital: P,
      traceId: 'teste-f37rj',
    };
    fonte = new FontePrecosPropria(nucleo);
    hoje = await fonte.hoje(c);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f37rj' }, async (e) => {
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  const linhas = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't' }, (l) =>
      l.consultar<T>(sql, p),
    );

  it('as duas operações estão liberadas na fonte própria', () => {
    expect(fonte.estado('preco.reajustar')).toBe('liberada');
    expect(fonte.estado('preco.desfazerReajuste')).toBe('liberada');
  });

  it('recusa a data fora de hoje e a base desatualizada sem gravar nada', async () => {
    expect(
      await recusada(
        fonte.executar('preco.reajustar', c, { ...reajuste(ids.a, 1), data: '2020-01-01' }, gravacao()),
      ),
    ).toBe('data-fora-de-hoje');
    expect(
      await recusada(
        fonte.executar('preco.reajustar', c, reajuste(ids.a, 1, lote, { ...BASE, ch: 99 }), gravacao()),
      ),
    ).toBe('proposta-desatualizada');
    expect(await linhas('SELECT id FROM lote_reajuste WHERE tabela_preco_id = ?', [ids.tabela])).toHaveLength(
      0,
    );
  });

  it('reajuste em duas partes: lote, itens do lote, vigência nova e autoria', async () => {
    const r1 = await fonte.executar('preco.reajustar', c, reajuste(ids.a, 1), gravacao());
    expect(r1.resultado).toMatchObject({ linhas: 1, parte: 1 });
    let [lr] = await linhas('SELECT * FROM lote_reajuste WHERE identificador = ?', [lote]);
    expect(lr).toMatchObject({
      situacao: 'em_aplicacao',
      quantidade_itens: 1,
      total_partes: 2,
      tipo_lote: 'reajuste',
    });
    await fonte.executar('preco.reajustar', c, reajuste(ids.b, 2), gravacao());
    [lr] = await linhas('SELECT * FROM lote_reajuste WHERE identificador = ?', [lote]);
    expect(lr).toMatchObject({
      situacao: 'aplicado',
      quantidade_itens: 2,
      quantidade_desfeitos: 0,
      modo: 'percentual',
      escopo: 'itens',
      autor_usuario_id: ids.usuario,
    });
    expect(Number(lr?.['percentual'])).toBe(10);
    const itens = await linhas(
      'SELECT sequencia, parte, preco_procedimento_id, valor_anterior, valor_novo, desfeito FROM lote_reajuste_item WHERE lote_reajuste_id = ? ORDER BY sequencia',
      [lr?.['id']],
    );
    expect(itens.map((i) => [i['sequencia'], i['parte'], i['preco_procedimento_id']])).toEqual([
      [1, 1, ids.a],
      [2, 2, ids.b],
    ]);
    expect(itens.map((i) => [Number(i['valor_anterior']), Number(i['valor_novo'])])).toEqual([
      [106, 116.6],
      [106, 116.6],
    ]);
    const v = await linhas(
      'SELECT operacao, valor_honorario, valor_total FROM preco_procedimento_valor WHERE preco_procedimento_id = ? AND vigencia_inicio = ?',
      [ids.a, hoje],
    );
    expect(v.map((x) => [x['operacao'], Number(x['valor_honorario']), Number(x['valor_total'])])).toEqual([
      ['inclusao', 110, 116.6],
    ]);
    expect((await fonte.itemHonorario(c, ids.tabela, ids.a, hoje))?.valores).toMatchObject({
      ch: 110,
      co: 5.5,
    });
    expect(await fonte.autoriaDoItem(c, ids.tabela, ids.a)).toEqual([
      expect.objectContaining({ data: hoje, origem: 'reajuste', lote, autor: 'f37rj.teste' }),
    ]);
    expect((await fonte.lotes(c, ids.tabela))?.[0]).toMatchObject({ lote, itens: 2, desfeito: false });
    // O mesmo item na mesma data: a vigência já existe.
    expect(
      await recusada(
        fonte.executar(
          'preco.reajustar',
          c,
          reajuste(ids.a, 1, `F37RJ-${randomUUID().slice(0, 8)}`, NOVOS),
          gravacao(),
        ),
      ),
    ).toBe('vigencia-existente');
  });

  it('desfazer nunca apaga: exclusão da vigência, item marcado, lote parcial; a leitura volta ao preço anterior', async () => {
    await fonte.preConferirDesfazer(c, [desfazer(ids.a)]);
    const r = await fonte.executar('preco.desfazerReajuste', c, desfazer(ids.a), gravacao());
    expect(r.resultado).toMatchObject({ linhas: 1 });
    const v = await linhas(
      'SELECT operacao FROM preco_procedimento_valor WHERE preco_procedimento_id = ? AND vigencia_inicio = ? ORDER BY id',
      [ids.a, hoje],
    );
    expect(v.map((x) => x['operacao'])).toEqual(['inclusao', 'exclusao']);
    const [lr] = await linhas('SELECT * FROM lote_reajuste WHERE identificador = ?', [lote]);
    expect(lr).toMatchObject({
      situacao: 'desfeito_parcial',
      quantidade_desfeitos: 1,
      desfeito_por_usuario_id: ids.usuario,
    });
    expect(lr?.['motivo_desfazer']).toContain('Percentual errado');
    const [ia] = await linhas(
      'SELECT desfeito FROM lote_reajuste_item WHERE lote_reajuste_id = ? AND preco_procedimento_id = ?',
      [lr?.['id'], ids.a],
    );
    expect(Number(ia?.['desfeito'])).toBe(1);
    expect((await fonte.itemHonorario(c, ids.tabela, ids.a, hoje))?.valores).toMatchObject({
      ch: 100,
      co: 5,
    });
    expect((await fonte.vigenciasDoItem(c, ids.tabela, ids.a)).map((x) => x.data)).toEqual(['2026-01-15']);
    expect(await fonte.autoriaDoItem(c, ids.tabela, ids.a)).toEqual([]);
    // O preço da conta também volta ao anterior.
    const conta = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't' },
      (l) => precoVigente(l, [ids.tabela], ids.itemA, hoje),
    );
    expect(conta?.honorario).toBe(100);
    expect(await recusada(fonte.preConferirDesfazer(c, [desfazer(ids.a)]))).toBe('sem-efeito');
  });

  it('alteração por fora depois do lote recusa o desfazer; sem ela, o lote fica desfeito inteiro', async () => {
    const outroValor = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f37rj-por-fora' }, (e) =>
      e.inserir(
        `INSERT INTO preco_procedimento_valor (preco_procedimento_id, ocorrido_em, vigencia_inicio, valor_honorario,
           valor_custo_operacional, valor_filme, valor_anestesia, valor_outros, valor_total, criado_em)
         VALUES (?, ?, ?, 120, 5.5, 0, 0, 1.1, 126.6, ?)`,
        [ids.b, new Date(), hoje, new Date()],
      ),
    );
    expect(await recusada(fonte.preConferirDesfazer(c, [desfazer(ids.b)]))).toBe('alterado-por-fora');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f37rj-por-fora' }, (e) =>
      e.executar('DELETE FROM preco_procedimento_valor WHERE id = ?', [outroValor]),
    );
    await fonte.executar('preco.desfazerReajuste', c, desfazer(ids.b), gravacao());
    const [lr] = await linhas(
      'SELECT situacao, quantidade_desfeitos FROM lote_reajuste WHERE identificador = ?',
      [lote],
    );
    expect(lr).toMatchObject({ situacao: 'desfeito', quantidade_desfeitos: 2 });
    expect((await fonte.lotes(c, ids.tabela))?.[0]).toMatchObject({ lote, desfeitos: 2, desfeito: true });
    // Depois do desfazer, um novo reajuste na mesma data volta a valer.
    await fonte.executar(
      'preco.reajustar',
      c,
      { ...reajuste(ids.a, 1, `F37RJ-${randomUUID().slice(0, 8)}`), partes: 1 },
      gravacao(),
    );
    expect((await fonte.itemHonorario(c, ids.tabela, ids.a, hoje))?.valores).toMatchObject({ ch: 110 });
  });
});
