// Contrato de efeito da cobrança por fonte pagadora (06-FAT linhas 6, 8 e 9) contra o MariaDB real. Massa SINTÉTICA
// com códigos "F372" (nenhum dado real): o de-para gravado e o anterior encerrado na véspera (nada apagado), a
// conferência com código e quantidade da fonte; o credenciamento de cobrança e a exceção que proíbe o procedimento;
// o item da referência de mercado com o preço da edição na data (PF ou PMC pela tabela) e a equivalência com a
// operadora. No fim, a massa e a trilha do estabelecimento sintético são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import type { ContaTiss } from '@sgh/contratos';
import { type ContextoOperacao, type Escritor, type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { EquipesCooperativasPropria } from '../cadastro/equipes-cooperativas-proprio.js';
import { ServicoCobranca } from './cobranca.controller.js';
import { conferirCobrancaPropria } from './cobranca-propria.js';
import { aplicarDeParaNaConta } from './de-para-guia.js';
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
    prof2: 0,
    grupo2: 0,
    equipe: 0,
    planoSup: 0,
    planoSub: 0,
  };
  let hoje = '';
  const mais = (d: string, dias: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + dias);
    return x.toISOString().slice(0, 10);
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
      ids.grupo2 = Number(its[1]?.['grupo_faturamento_id']);
      const profs = await e.consultar('SELECT id FROM profissional ORDER BY id LIMIT 2');
      ids.prof = Number(profs[0]?.['id']);
      ids.prof2 = Number(profs[1]?.['id']);
      hoje = String((await e.uma<{ h: string }>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS h"))?.h);
      // Termo TUSS sintético (o caminho da TUSS é sempre exercido, com ou sem carga oficial no cliente).
      const term = await garantir(
        e,
        'SELECT id FROM terminologia WHERE codigo = ?',
        [`${P}-TUSS`],
        "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES (?, 'TERMINOLOGIA F372', 'material_medicamento', ?)",
        [`${P}-TUSS`, agora],
      );
      ids.termo = await garantir(
        e,
        'SELECT id FROM termo_terminologia WHERE terminologia_id = ? AND codigo_termo = ?',
        [term, `${P}-1`],
        "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, ?, 'TERMO F372', ?)",
        [term, `${P}-1`, agora],
      );
      ids.planoSup = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
        [ids.fonte, `${P}-SUP`],
        "INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, 'PLANO F372', ?)",
        [ids.fonte, `${P}-SUP`, agora],
      );
      ids.planoSub = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
        [ids.fonte, `${P}-SUB`],
        `INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, plano_superior_id, criado_em)
           VALUES (?, ?, 'SUBPLANO F372', ?, ?)`,
        [ids.fonte, `${P}-SUB`, ids.planoSup, agora],
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
      const edC = await edicao('903', '2026-08-01');
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
      // A edição 903 retira o item (linha de exclusão): sem preço a partir dela.
      await e.inserir(
        `INSERT INTO preco_referencia_matmed (item_referencia_matmed_id, operacao, ocorrido_em,
           edicao_referencia_matmed_id, vigencia_inicio, criado_em) VALUES (?, 'exclusao', ?, ?, '2026-08-01', ?)`,
        [ids.ref, agora, edC, agora],
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
    // A equipe do credenciamento por equipe entra pela porta própria do cadastro (02-CAD linha 22), nunca por INSERT.
    const eq = await escrever((e) =>
      e.uma<{ id: number }>(
        'SELECT id FROM equipe_profissional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-EQ`],
      ),
    );
    ids.equipe = eq
      ? Number(eq.id)
      : await new EquipesCooperativasPropria(nucleo, CLIENTE).salvarEquipe(
          {
            cliente: CLIENTE,
            estabelecimento: ids.est,
            usuario: null,
            correlacao: 'teste-f372',
            rede: 'teste',
            hospital: P,
          },
          {
            id: null,
            versao: null,
            codigo: `${P}-EQ`,
            nome: 'EQUIPE F372',
            tipo: 'cirurgica',
            setorId: null,
            inicio: '2025-01-01',
            fim: null,
            ativo: true,
          },
          {
            estabelecimento: ids.est,
            usuario: null,
            acao: 'operacao',
            entidade: 'equipe_profissional',
            entidadeId: null,
            dadosDepois: null,
            correlacao: 'teste-f372',
          },
        );
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
      unidade: 'CX',
      percentual: 80,
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
    expect(r).toMatchObject({
      codigo: `${P}-NEW`,
      quantidade: 7.5,
      equivalenciaId: b['id'],
      unidade: 'CX',
      percentualCobranca: 80,
    });
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
    // Encerramento sem reescrever o passado.
    const versaoDe = async (tabela: string, idReg: unknown) =>
      Number(
        (
          await escrever((e) =>
            e.uma<{ versao: number }>(`SELECT versao FROM ${tabela} WHERE id = ?`, [idReg]),
          )
        )?.versao,
      );
    const T = 'equivalencia_item_fonte_pagadora';
    // (a) registro já encerrado no passado não muda (nem para estender por cima do sucessor).
    await expect(
      s.gravar('equivalencia-item.encerrar', op(), {
        id: a['id'],
        versao: await versaoDe(T, a['id']),
        vigenciaFim: mais(hoje, 400),
      }),
    ).rejects.toThrow(/já foi encerrado/);
    // (b) o fim não recua para antes de hoje.
    await expect(
      s.gravar('equivalencia-item.encerrar', op(), {
        id: b['id'],
        versao: await versaoDe(T, b['id']),
        vigenciaFim: '2026-04-30',
      }),
    ).rejects.toThrow(/antes de hoje/);
    // (c) com o sucessor já gravado para o futuro, o fim não avança por cima dele.
    const fut = await s.gravar('equivalencia-item', op(), {
      fontePagadoraId: ids.fonte,
      itemId: ids.item,
      codigo: `${P}-FUT`,
      vigenciaInicio: mais(hoje, 20),
    });
    expect(fut['encerradas']).toBe(1);
    await expect(
      s.gravar('equivalencia-item.encerrar', op(), {
        id: b['id'],
        versao: await versaoDe(T, b['id']),
        vigenciaFim: mais(hoje, 25),
      }),
    ).rejects.toThrow(/sobrepostas/);
    // Antecipar o fim (de hoje em diante) vale, com o motivo na trilha.
    await s.gravar('equivalencia-item.encerrar', op(), {
      id: b['id'],
      versao: await versaoDe(T, b['id']),
      vigenciaFim: mais(hoje, 10),
      motivo: 'CONTRATO F372 REVISTO',
    });
    const fim = await escrever((e) =>
      e.uma<{ f: string }>(`SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f FROM ${T} WHERE id = ?`, [
        b['id'],
      ]),
    );
    expect(fim?.f).toBe(mais(hoje, 10));
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
    const rc = await conferir();
    expect(rc.credenciamento).toMatchObject({
      permitido: true,
      origem: 'credenciamento',
      credenciamentoId: cr['id'],
    });
    expect(rc.codigoPrestadorNaFonte).toBe(`${P}9`);
    // A exceção presa ao credenciamento de OUTRO profissional não entra na conferência deste.
    const cr2 = await s.gravar('credenciamento', op(), {
      fontePagadoraId: ids.fonte,
      profissionalId: ids.prof2,
      vigenciaInicio: '2025-01-01',
    });
    await s.gravar('excecao', op(), {
      credenciamentoId: cr2['id'],
      itemId: ids.item,
      efeito: 'proibe',
      motivo: 'OUTRO PROFISSIONAL F372',
      vigenciaInicio: '2025-01-01',
    });
    expect((await conferir()).credenciamento.permitido).toBe(true);
    expect((await conferir({ profissionalId: ids.prof2 })).credenciamento).toMatchObject({
      permitido: false,
      origem: 'excecao',
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
    // Recuar o fim para o passado é recusado (contas já lançadas usaram a exceção).
    await expect(
      s.gravar('excecao.encerrar', op(), { id: ex['id'], versao, vigenciaFim: '2026-04-30' }),
    ).rejects.toThrow(/antes de hoje/);
    await s.gravar('excecao.encerrar', op(), { id: ex['id'], versao, vigenciaFim: mais(hoje, 30) });
    expect((await conferir()).credenciamento.permitido).toBe(false);
    expect((await conferir({ data: mais(hoje, 31) })).credenciamento.permitido).toBe(true);
    const lista = await fonte.credenciamento(c, ids.fonte, 0, 50, false, null);
    expect(lista.total).toBe(2);
    // Exceção por grupo e tipo de atendimento: proíbe o grupo do segundo item só na urgência.
    await s.gravar('excecao', op(), {
      profissionalId: ids.prof,
      grupoId: ids.grupo2,
      tipoAtendimento: 'urgencia',
      efeito: 'proibe',
      motivo: 'GRUPO F372',
      vigenciaInicio: '2025-01-01',
    });
    expect((await conferir({ itemId: ids.item2, tipoAtendimento: 'urgencia' })).credenciamento).toMatchObject(
      {
        permitido: false,
        origem: 'excecao',
      },
    );
    expect((await conferir({ itemId: ids.item2 })).credenciamento.permitido).toBe(true);
    // Exceção pelo plano superior: vale para o paciente do subplano, não para quem não tem plano.
    await s.gravar('excecao', op(), {
      profissionalId: ids.prof,
      planoId: ids.planoSup,
      tipoAtendimento: 'externo',
      efeito: 'proibe',
      motivo: 'PLANO F372',
      vigenciaInicio: '2025-01-01',
    });
    expect(
      (await conferir({ itemId: ids.item2, tipoAtendimento: 'externo', planoId: ids.planoSub }))
        .credenciamento.permitido,
    ).toBe(false);
    expect((await conferir({ itemId: ids.item2, tipoAtendimento: 'externo' })).credenciamento.permitido).toBe(
      true,
    );
    // Exceção por equipe: a equipe proíbe o segundo item; a permissão do próprio profissional abre a exceção.
    await s.gravar('excecao', op(), {
      equipeId: ids.equipe,
      itemId: ids.item2,
      efeito: 'proibe',
      motivo: 'EQUIPE F372',
      vigenciaInicio: '2025-01-01',
    });
    expect((await conferir({ itemId: ids.item2, equipeIds: [ids.equipe] })).credenciamento.permitido).toBe(
      false,
    );
    expect((await conferir({ itemId: ids.item2 })).credenciamento.permitido).toBe(true);
    await s.gravar('excecao', op(), {
      profissionalId: ids.prof,
      itemId: ids.item2,
      efeito: 'permite',
      vigenciaInicio: '2025-01-01',
    });
    expect((await conferir({ itemId: ids.item2, equipeIds: [ids.equipe] })).credenciamento).toMatchObject({
      permitido: true,
      origem: 'excecao',
    });
    const excs = await fonte.credenciamentoAtos(c, ids.fonte);
    expect(excs.itens.find((x) => x['fim'] === mais(hoje, 30))?.['efeito']).toBe('Proíbe');
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
      ['2026-08-01', null],
      ['2026-01-01', 11],
      ['2025-01-01', 10],
    ]);
    const g = await s.gravar('equivalencia-matmed', op(), {
      itemReferenciaId: ids.ref,
      fontePagadoraId: ids.fonte,
      codigoNaFonte: `${P}77`,
      fatorConversao: 2,
      termoTussId: ids.termo,
      tipoEquivalenciaTuss: 'exata',
      vigenciaInicio: '2026-01-01',
    });
    expect(g['operadora']).toBeGreaterThan(0);
    expect(g['tuss']).toBeGreaterThan(0);
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
    expect(tela.total).toBe(2);
    // A edição 903 retira o item: sem preço a partir dela.
    expect((await fonte.itemMatmed(c, ids.tab, ids.ref, '2026-09-01'))?.valor ?? null).toBeNull();
    // Nova equivalência posterior: as duas anteriores (operadora e TUSS) se encerram na véspera, nada apagado.
    const g2 = await s.gravar('equivalencia-matmed', op(), {
      itemReferenciaId: ids.ref,
      fontePagadoraId: ids.fonte,
      codigoNaFonte: `${P}78`,
      termoTussId: ids.termo,
      tipoEquivalenciaTuss: 'aproximada',
      vigenciaInicio: '2026-06-01',
    });
    const fins = await escrever(async (e) => [
      ...(await e.consultar(
        `SELECT 'op' AS t, id, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM equivalencia_matmed_fonte_pagadora
          WHERE fonte_pagadora_id = ? ORDER BY id`,
        [ids.fonte],
      )),
      ...(await e.consultar(
        `SELECT 'tuss' AS t, id, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM equivalencia_matmed_tuss
          WHERE item_referencia_matmed_id = ? ORDER BY id`,
        [ids.ref],
      )),
    ]);
    expect(fins.map((r) => [r['t'], Number(r['id']), r['fim']])).toEqual([
      ['op', g['operadora'], '2026-05-31'],
      ['op', g2['operadora'], null],
      ['tuss', g['tuss'], '2026-05-31'],
      ['tuss', g2['tuss'], null],
    ]);
  });

  it('linha 9 na guia: o item da conta leva o código, a quantidade e o percentual do de-para vigente na data', async () => {
    await s.gravar('equivalencia-item', op(), {
      fontePagadoraId: ids.fonte,
      itemId: ids.item2,
      codigo: `${P}-I2`,
      descricao: `ITEM ${P} NA FONTE`,
      fatorMultiplicacao: 2,
      percentual: 50,
      vigenciaInicio: '2024-01-01',
    });
    const item = (data: string, sequencial: number) => ({
      sequencial,
      tipo: 3,
      natureza: 'procedimento',
      data,
      codigo: 'HOSP-1',
      codigoTabela: '22',
      descricao: 'ITEM DO HOSPITAL',
      quantidade: 3,
      valorUnitario: 10,
    });
    const conta = { conta: `${P}-C`, itens: [item(hoje, 1), item('2023-06-01', 2)] } as unknown as ContaTiss;
    const origem = { itemId: ids.item2, grupoId: ids.grupo2 };
    const r = await escrever((e) =>
      aplicarDeParaNaConta(e as unknown as Leitor, ids.fonte, conta, [origem, origem], null),
    );
    expect(r.trocados).toBe(1);
    // Na data: código e descrição da fonte, 3 x 2 = 6 na unidade dela e o total de 30 pela metade (15).
    expect(r.conta.itens[0]).toMatchObject({
      codigo: `${P}-I2`,
      descricao: `ITEM ${P} NA FONTE`,
      quantidade: 6,
      valorUnitario: 2.5,
      sequencial: 1,
    });
    // Antes da vigência do de-para: o item segue como o hospital o lançou.
    expect(r.conta.itens[1]).toEqual(item('2023-06-01', 2));
    // Fonte sem de-para: a conta volta igual, sem troca.
    const sem = await escrever((e) =>
      aplicarDeParaNaConta(e as unknown as Leitor, ids.fonte + 1_000_000, conta, [origem, origem], null),
    );
    expect(sem).toEqual({ conta, trocados: 0 });
  });
});
