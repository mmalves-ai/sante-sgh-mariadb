// Contrato de efeito da cobrança por fonte pagadora (06-FAT linhas 6, 8 e 9) contra o MariaDB real. Massa SINTÉTICA
// com códigos "F372" (nenhum dado real): o de-para gravado e o anterior encerrado na véspera (nada apagado), a
// conferência com código e quantidade da fonte; o credenciamento de cobrança e a exceção que proíbe o procedimento;
// o item da referência de mercado com o preço da edição na data (PF ou PMC pela tabela) e a equivalência com a
// operadora. No fim, a massa e a trilha do estabelecimento sintético são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoCobranca } from './cobranca.controller.js';
import { conferirCobrancaPropria } from './cobranca-propria.js';
import type { CtxPrecos } from './fonte.js';
import { FontePrecosPropria } from './fonte-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F372';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('cobrança por fonte pagadora na fonte própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoCobranca;
  let fonte: FontePrecosPropria;
  const ids = {
    est: 0,
    fonte: 0,
    item: 0,
    item2: 0,
    grupo: 0,
    prof: 0,
    ref: 0,
    edA: 0,
    edB: 0,
    tab: 0,
    termo: 0,
  };
  let c: CtxPrecos;
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f372',
    chaveIdempotencia: `f372-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f372' }, fn);

  const limpar = async (e: Escritor) => {
    await e.executar('DELETE FROM excecao_credenciamento WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM credenciamento_cobranca WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM equivalencia_item_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar('DELETE FROM equivalencia_matmed_fonte_pagadora WHERE fonte_pagadora_id = ?', [
      ids.fonte,
    ]);
    await e.executar('DELETE FROM equivalencia_matmed_tuss WHERE item_referencia_matmed_id = ?', [ids.ref]);
    await e.executar('DELETE FROM preco_referencia_matmed WHERE item_referencia_matmed_id = ?', [ids.ref]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      const classe = await garantir(
        e,
        'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
        [`${P}-CONV`],
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO F372', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-A`],
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA F372 SINTETICA', 'operadora', 'ativa', ?, 30, ?)`,
        [`${P}-A`, classe, agora],
      );
      // Itens faturáveis e profissional já existentes no cliente de teste (só os ids; nenhum valor sai).
      const its = await e.consultar(
        'SELECT id, grupo_faturamento_id FROM item_faturavel WHERE excluido_em IS NULL ORDER BY id LIMIT 2',
      );
      ids.item = Number(its[0]?.['id']);
      ids.item2 = Number(its[1]?.['id']);
      ids.grupo = Number(its[0]?.['grupo_faturamento_id']);
      ids.prof = Number((await e.uma<{ id: number }>('SELECT id FROM profissional ORDER BY id LIMIT 1'))?.id);
      ids.termo = Number(
        (await e.uma<{ id: number }>('SELECT id FROM termo_terminologia ORDER BY id LIMIT 1'))?.id ?? 0,
      );
      const fr = await garantir(
        e,
        'SELECT id FROM fonte_referencia_matmed WHERE codigo = ?',
        [P],
        "INSERT INTO fonte_referencia_matmed (codigo, descricao, tipo_fonte, criado_em) VALUES (?, 'REFERENCIA F372', 'propria', ?)",
        [P, agora],
      );
      const edicao = (num: string, ini: string) =>
        garantir(
          e,
          'SELECT id FROM edicao_referencia_matmed WHERE fonte_referencia_matmed_id = ? AND numero_edicao = ?',
          [fr, num],
          `INSERT INTO edicao_referencia_matmed (fonte_referencia_matmed_id, numero_edicao, vigencia_inicio, operacao,
             ocorrido_em, criado_em) VALUES (?, ?, ?, 'inclusao', ?, ?)`,
          [fr, num, ini, agora, agora],
        );
      ids.edA = await edicao('901', '2025-01-01');
      ids.edB = await edicao('902', '2026-01-01');
      ids.ref = await garantir(
        e,
        "SELECT id FROM item_referencia_matmed WHERE fonte_referencia = 'simpro' AND codigo_referencia = ?",
        [`${P}-1`],
        `INSERT INTO item_referencia_matmed (fonte_referencia, codigo_referencia, descricao, tipo_produto, criado_em)
           VALUES ('simpro', ?, 'MATERIAL F372 SINTETICO', 'material', ?)`,
        [`${P}-1`, agora],
      );
      ids.tab = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [`${P}-MAT`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, preco_referencia,
           moeda_calculo, situacao, criado_em) VALUES (?, ?, 'MATMED F372', 'material', 'simpro', 'pf', 'real', 'ativa', ?)`,
        [ids.est, `${P}-MAT`, agora],
      );
      await limpar(e);
      for (const [ed, ini, pf, pmc] of [
        [ids.edA, '2025-01-01', 10, 13],
        [ids.edB, '2026-01-01', 11, 14.5],
      ] as const)
        await e.inserir(
          `INSERT INTO preco_referencia_matmed (item_referencia_matmed_id, ocorrido_em, edicao_referencia_matmed_id,
             vigencia_inicio, preco_fabrica, preco_maximo_consumidor, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ids.ref, agora, ed, ini, pf, pmc, agora],
        );
    });
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: null,
      correlacao: 'teste-f372',
      rede: 'teste',
      hospital: P,
      traceId: 'teste-f372',
    } as CtxPrecos;
    s = new ServicoCobranca(nucleo);
    fonte = new FontePrecosPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  const conferir = (extra: Partial<Parameters<typeof conferirCobrancaPropria>[2]> = {}) =>
    s.ler(c, (l, est) =>
      conferirCobrancaPropria(l, est, {
        fontePagadoraId: ids.fonte,
        planoId: null,
        itemId: ids.item,
        profissionalId: ids.prof,
        prestadorId: null,
        equipeIds: [],
        tipoContaId: null,
        tipoAtendimento: 'internacao',
        quantidade: 3,
        data: '2026-05-10',
        ...extra,
      }),
    );

  it('linha 9: de-para gravado, o anterior encerrado na véspera, código e quantidade na conferência', async () => {
    const a = await s.gravar('equivalencia-item', op(), {
      fontePagadoraId: ids.fonte,
      itemId: ids.item,
      codigo: `${P}-OLD`,
      vigenciaInicio: '2025-01-01',
    });
    const b = await s.gravar('equivalencia-item', op(), {
      fontePagadoraId: ids.fonte,
      itemId: ids.item,
      codigo: `${P}-NEW`,
      fatorMultiplicacao: 10,
      fatorDivisao: 4,
      vigenciaInicio: '2026-03-01',
    });
    expect(b['encerradas']).toBe(1);
    const linhas = await escrever((e) =>
      e.consultar(
        `SELECT id, codigo_cobranca, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, excluido_em
           FROM equivalencia_item_fonte_pagadora WHERE fonte_pagadora_id = ? ORDER BY id`,
        [ids.fonte],
      ),
    );
    expect(linhas.map((r) => [Number(r['id']), r['codigo_cobranca'], r['fim'], r['excluido_em']])).toEqual([
      [a['id'], `${P}-OLD`, '2026-02-28', null],
      [b['id'], `${P}-NEW`, null, null],
    ]);
    const r = await conferir();
    expect(r).toMatchObject({ codigo: `${P}-NEW`, quantidade: 7.5, equivalenciaId: b['id'] });
    expect((await conferir({ data: '2025-06-01' })).codigo).toBe(`${P}-OLD`);
    // Mesmo início: recusa (nada é sobrescrito).
    await expect(
      s.gravar('equivalencia-item', op(), {
        fontePagadoraId: ids.fonte,
        itemId: ids.item,
        codigo: 'X',
        vigenciaInicio: '2026-03-01',
      }),
    ).rejects.toThrow(/mesma chave/);
    // Validação no domínio: item e grupo juntos recusam.
    await expect(
      s.gravar('equivalencia-item', op(), {
        fontePagadoraId: ids.fonte,
        itemId: ids.item,
        grupoId: ids.grupo,
        codigo: 'X',
        vigenciaInicio: '2026-04-01',
      }),
    ).rejects.toThrow(/item ou o grupo/);
    const pg = await fonte.dePara(c, ids.fonte, null, 0, 50);
    expect(pg.total).toBe(2);
  });

  it('linha 8: credenciamento de cobrança, exceção que proíbe o procedimento e conferência', async () => {
    expect((await conferir()).credenciamento).toMatchObject({
      permitido: false,
      origem: 'sem-credenciamento',
    });
    const cr = await s.gravar('credenciamento', op(), {
      fontePagadoraId: ids.fonte,
      profissionalId: ids.prof,
      codigoNaFonte: `${P}9`,
      vigenciaInicio: '2025-01-01',
    });
    expect((await conferir()).credenciamento).toMatchObject({
      permitido: true,
      origem: 'credenciamento',
      credenciamentoId: cr['id'],
    });
    await expect(
      s.gravar('excecao', op(), {
        profissionalId: ids.prof,
        itemId: ids.item,
        efeito: 'proibe',
        vigenciaInicio: '2026-01-01',
      }),
    ).rejects.toThrow(/motivo/);
    const ex = await s.gravar('excecao', op(), {
      profissionalId: ids.prof,
      fontePagadoraId: ids.fonte,
      itemId: ids.item,
      efeito: 'proibe',
      motivo: 'FORA DO CONTRATO F372',
      vigenciaInicio: '2026-01-01',
    });
    const r = await conferir();
    expect(r.credenciamento).toMatchObject({ permitido: false, origem: 'excecao', excecaoId: ex['id'] });
    expect(r.avisos.join(' ')).toContain('FORA DO CONTRATO F372');
    // Outro item segue permitido pelo credenciamento.
    expect((await conferir({ itemId: ids.item2 })).credenciamento.permitido).toBe(true);
    // Encerrar a exceção (nada se apaga) devolve a permissão depois do fim.
    const versao = Number(
      (
        await escrever((e) =>
          e.uma<{ versao: number }>('SELECT versao FROM excecao_credenciamento WHERE id = ?', [ex['id']]),
        )
      )?.versao,
    );
    await s.gravar('excecao.encerrar', op(), { id: ex['id'], versao, vigenciaFim: '2026-04-30' });
    expect((await conferir()).credenciamento.permitido).toBe(true);
    const lista = await fonte.credenciamento(c, ids.fonte, 0, 50, false, null);
    expect(lista.total).toBe(1);
    const excs = await fonte.credenciamentoAtos(c, ids.fonte, false);
    expect(excs.itens.map((x) => [x['efeito'], x['fim']])).toEqual([['Proíbe', '2026-04-30']]);
  });

  it('linha 6: item da referência com o preço da edição na data e equivalência com a operadora', async () => {
    const pg = await fonte.itensMatmed(c, ids.tab, {
      busca: `${P}-1`,
      pagina: 0,
      porPagina: 10,
      data: '2026-05-10',
    });
    expect(pg.total).toBe(1);
    expect(pg.itens[0]).toMatchObject({ id: ids.ref, valor: 11, pf: 11, pmc: 14.5, edicao: 902 });
    expect((await fonte.itemMatmed(c, ids.tab, ids.ref, '2025-06-01'))?.valor).toBe(10);
    const vig = await fonte.vigenciasMatmed(c, ids.tab, ids.ref);
    expect(vig.map((v) => [v.data, v.valor])).toEqual([
      ['2026-01-01', 11],
      ['2025-01-01', 10],
    ]);
    const g = await s.gravar('equivalencia-matmed', op(), {
      itemReferenciaId: ids.ref,
      fontePagadoraId: ids.fonte,
      codigoNaFonte: `${P}77`,
      fatorConversao: 2,
      termoTussId: ids.termo || null,
      tipoEquivalenciaTuss: ids.termo ? 'exata' : null,
      vigenciaInicio: '2026-01-01',
    });
    expect(g['operadora']).toBeGreaterThan(0);
    const eqs = await escrever((e) =>
      e.consultar(
        'SELECT codigo_na_fonte, fator_conversao FROM equivalencia_matmed_fonte_pagadora WHERE fonte_pagadora_id = ?',
        [ids.fonte],
      ),
    );
    expect(eqs.map((r) => [r['codigo_na_fonte'], Number(r['fator_conversao'])])).toEqual([[`${P}77`, 2]]);
    const tela = await s.ler(c, async (l) =>
      (await import('./cobranca-propria.js')).equivalenciasMatmedPropria(l, ids.ref),
    );
    expect(tela.total).toBe(ids.termo ? 2 : 1);
  });
});
