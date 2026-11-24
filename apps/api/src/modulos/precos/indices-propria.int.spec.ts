// Integração dos índices de cobrança e portes (06-FAT linha 5) contra o MariaDB real. Massa SINTÉTICA com códigos
// "F37I" (nenhum dado real): o valor do índice por vigência, do acordo e da tabela do acordo (o do acordo prevalece),
// a linha excluída que nunca vale, o porte de honorário na data e o porte anestésico da tabela; e o honorário que sai
// de índice × quantidade pelo modelo do @sgh/dominio-preco. Nada de outro estabelecimento. No fim, a massa de valores
// é apagada; ficam os cadastros da rede (índice, porte). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { explicarValor } from '@sgh/dominio-preco';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CtxPrecos } from './fonte.js';
import { FontePrecosPropria } from './fonte-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F37I';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('índices de cobrança e portes da fonte própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let fonte: FontePrecosPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    fonte: 0,
    tabela: 0,
    tabelaB: 0,
    amb1: 0,
    amb2: 0,
    contrato: 0,
    ch: 0,
    ch2: 0,
    chInativo: 0,
    filme: 0,
    uco: 0,
    porte: 0,
  };
  let c: CtxPrecos;
  let outro: CtxPrecos;

  const limpar = async (e: Escritor) => {
    await e.executar('DELETE FROM valor_indice WHERE fonte_pagadora_id = ? OR tabela_preco_id = ?', [
      ids.fonte,
      ids.tabela,
    ]);
    await e.executar('DELETE FROM valor_porte_medico WHERE fonte_pagadora_id = ? OR tabela_preco_id = ?', [
      ids.fonte,
      ids.tabela,
    ]);
    await e.executar('DELETE FROM valor_porte_anestesico WHERE tabela_preco_id IN (?, ?, ?)', [
      ids.tabela,
      ids.amb1,
      ids.amb2,
    ]);
    await e.executar(
      'DELETE ctv FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
      [ids.fonte],
    );
    await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f37-indices' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(`${P}A`);
      ids.outroEst = await est(`${P}B`);
      const classe = await garantir(
        e,
        'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
        [`${P}-CONV`],
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO F37I', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-A`],
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA F37I SINTETICA', 'operadora', 'ativa', ?, 30, ?)`,
        [`${P}-A`, classe, agora],
      );
      for (const x of [ids.est, ids.outroEst])
        await garantir(
          e,
          'SELECT id FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?',
          [ids.fonte, x],
          "INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, situacao, criado_em) VALUES (?, ?, 'ativa', ?)",
          [ids.fonte, x, agora],
        );
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
           VALUES (?, ?, 'HONORARIOS F37I', 'honorario', 'propria', 'real', 'ativa', ?)`,
        [ids.est, `${P}-HON`, agora],
      );
      const tabela = (estab: number, codigo: string) =>
        garantir(
          e,
          'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
             VALUES (?, ?, ?, 'honorario', 'propria', 'real', 'ativa', ?)`,
          [estab, codigo, `HONORARIOS ${codigo}`, agora],
        );
      ids.tabelaB = await tabela(ids.outroEst, `${P}-HONB`);
      ids.amb1 = await tabela(ids.est, `${P}-AMB1`);
      ids.amb2 = await tabela(ids.est, `${P}-AMB2`);
      const indice = (codigo: string, tipo: string, ativo = true) =>
        garantir(
          e,
          'SELECT id FROM indice_cobranca WHERE codigo = ?',
          [codigo],
          'INSERT INTO indice_cobranca (codigo, descricao, tipo_indice, ativo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `INDICE ${codigo}`, tipo, ativo, agora],
        );
      ids.ch = await indice(`${P}-CH`, 'coeficiente_honorario');
      ids.filme = await indice(`${P}-FILME`, 'filme');
      ids.uco = await indice(`${P}-UCO`, 'custo_operacional');
      ids.ch2 = await indice(`${P}-CH2`, 'coeficiente_honorario');
      ids.chInativo = await indice(`${P}-CHX`, 'coeficiente_honorario', false);
      ids.porte = await garantir(
        e,
        'SELECT id FROM porte_procedimento WHERE codigo = ?',
        [`${P}3A`],
        "INSERT INTO porte_procedimento (codigo, descricao, tipo_porte, ordem, criado_em) VALUES (?, 'PORTE F37I 3A', 'honorario', 9, ?)",
        [`${P}3A`, agora],
      );
      await limpar(e);
      ids.contrato = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO F37I', '2025-01-01', 'vigente', 60, ?)`,
        [ids.est, ids.fonte, `${P}-1`, agora],
      );
      await e.inserir(
        `INSERT INTO contrato_tabela_vigencia (contrato_fonte_pagadora_id, tipo_item, tabela_preco_id, vigencia_inicio, criado_em)
           VALUES (?, 'honorario_internacao', ?, '2025-01-01', ?)`,
        [ids.contrato, ids.tabela, agora],
      );
      // Ambulatorial: AMB1 em 2025, AMB2 desde 2026 (o porte anestésico segue o regime e a data do atendimento).
      for (const [tab, ini, fim] of [
        [ids.amb1, '2025-01-01', '2025-12-31'],
        [ids.amb2, '2026-01-01', null],
      ] as const)
        await e.inserir(
          `INSERT INTO contrato_tabela_vigencia (contrato_fonte_pagadora_id, tipo_item, tabela_preco_id, vigencia_inicio,
             vigencia_fim, criado_em) VALUES (?, 'honorario_ambulatorial', ?, ?, ?, ?)`,
          [ids.contrato, tab, ini, fim, agora],
        );
      const valor = (
        indice: number,
        escopo: 'fonte' | 'tabela' | 'fonte+B',
        vig: string,
        v: number,
        operacao = 'inclusao',
      ) =>
        e.inserir(
          `INSERT INTO valor_indice (indice_cobranca_id, operacao, ocorrido_em, fonte_pagadora_id, tabela_preco_id,
             vigencia_inicio, valor_indice, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            indice,
            operacao,
            agora,
            escopo === 'tabela' ? null : ids.fonte,
            escopo === 'tabela' ? ids.tabela : escopo === 'fonte+B' ? ids.tabelaB : null,
            vig,
            v,
            agora,
          ],
        );
      // CH: a tabela vale 0,40 desde 2025; o acordo, 0,50 desde 2025 e 0,55 desde 2026-03 (prevalece o acordo).
      await valor(ids.ch, 'tabela', '2025-01-01', 0.4);
      await valor(ids.ch, 'fonte', '2025-01-01', 0.5);
      await valor(ids.ch, 'fonte', '2026-03-01', 0.55);
      // Filme só na tabela; UCO do acordo com uma vigência excluída (nunca vale).
      await valor(ids.filme, 'tabela', '2025-01-01', 21.7);
      await valor(ids.uco, 'fonte', '2025-01-01', 12);
      await valor(ids.uco, 'fonte', '2026-01-01', 99, 'exclusao');
      // Linha da fonte com a tabela de OUTRO estabelecimento: nunca vale para este (venceria pela vigência).
      await valor(ids.ch, 'fonte+B', '2026-05-01', 0.99);
      // Índice inativo: fora do cálculo e da linha do tempo.
      await valor(ids.chInativo, 'fonte', '2026-04-01', 0.77);
      // Segundo CH no acordo a partir de 2027: dois índices do mesmo tipo no mesmo nível (ambíguo).
      await valor(ids.ch2, 'fonte', '2027-01-01', 0.6);
      for (const [vig, v] of [
        ['2025-01-01', 200],
        ['2026-02-01', 210],
      ] as const)
        await e.inserir(
          `INSERT INTO valor_porte_medico (porte_procedimento_id, ocorrido_em, fonte_pagadora_id, vigencia_inicio, valor, criado_em)
             VALUES (?, ?, ?, ?, ?, ?)`,
          [ids.porte, agora, ids.fonte, vig, v, agora],
        );
      for (const [porte, v] of [
        ['1', 150.5],
        ['2', 300],
      ] as const)
        await e.inserir(
          `INSERT INTO valor_porte_anestesico (tabela_preco_id, ocorrido_em, porte_anestesico, vigencia_inicio, valor,
             valor_horario_especial, criado_em) VALUES (?, ?, ?, '2025-01-01', ?, ?, ?)`,
          [ids.tabela, agora, porte, v, v * 1.3, agora],
        );
      for (const [tab, v] of [
        [ids.amb1, 80],
        [ids.amb2, 95],
      ] as const)
        await e.inserir(
          `INSERT INTO valor_porte_anestesico (tabela_preco_id, ocorrido_em, porte_anestesico, vigencia_inicio, valor,
             criado_em) VALUES (?, ?, '1', '2025-01-01', ?, ?)`,
          [tab, agora, v, agora],
        );
    });
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: null,
      correlacao: 'teste-f37-indices',
      rede: 'teste',
      hospital: P,
      traceId: 'teste-f37-indices',
    } as CtxPrecos;
    outro = { ...c, estabelecimento: ids.outroEst };
    fonte = new FontePrecosPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f37-indices' }, async (e) => {
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  it('índices na data: o do acordo prevalece sobre o da tabela; a vigência é a maior ≤ data; exclusão não vale', async () => {
    const em2025 = await fonte.indicesNaData(c, ids.fonte, '2025-06-01');
    expect([...em2025.entries()].sort()).toEqual([
      [1, 0.5],
      [4, 21.7],
      [5, 12],
    ]);
    const em2026 = await fonte.indicesNaData(c, ids.fonte, '2026-06-01');
    expect(em2026.get(1)).toBe(0.55);
    expect(em2026.get(5)).toBe(12);
    // Antes de toda vigência: nada.
    expect((await fonte.indicesNaData(c, ids.fonte, '2024-06-01')).size).toBe(0);
    // A linha da fonte com a tabela de outro estabelecimento (0,99 desde 2026-05) não entra: o CH segue 0,55.
    // O índice inativo (0,77 desde 2026-04) também não.
    expect((await fonte.indicesNaData(c, ids.fonte, '2026-06-01')).get(1)).toBe(0.55);
    // O outro estabelecimento não tem acordo com a fonte: nada vale para ele (nem o CH e o UCO do acordo).
    expect((await fonte.indicesNaData(outro, ids.fonte, '2025-06-01')).size).toBe(0);
    expect((await fonte.indicesNaData(outro, ids.fonte, '2026-06-01')).size).toBe(0);
    expect(await fonte.porteNaData(outro, ids.fonte, `${P}3A`, '2026-06-01')).toBeNull();
    expect(await fonte.indicesConvenio(outro, ids.fonte)).toEqual([]);
  });

  it('dois CH diferentes valorados no acordo na mesma data: recusa em vez de escolher um em silêncio', async () => {
    await expect(fonte.indicesNaData(c, ids.fonte, '2027-06-01')).rejects.toMatchObject({
      problema: { codigo: 'indice-ambiguo' },
    });
  });

  it('porte de honorário na data pelo código; desconhecido é null', async () => {
    expect(await fonte.porteNaData(c, ids.fonte, `${P}3A`, '2025-06-01')).toBe(200);
    expect(await fonte.porteNaData(c, ids.fonte, `${P}3A`, '2026-06-01')).toBe(210);
    expect(await fonte.porteNaData(c, ids.fonte, `${P}9Z`, '2026-06-01')).toBeNull();
  });

  it('o honorário sai de índice × quantidade (modelo CH e PORTE) com os valores do banco', async () => {
    const ind = await fonte.indicesNaData(c, ids.fonte, '2026-06-01');
    const ch = explicarValor({ ch: 100, cope: 10, filmeM2: 0.5 }, null, {
      ch: ind.get(1) ?? null,
      filme: ind.get(4) ?? null,
      uco: ind.get(5) ?? null,
    });
    expect(ch.modelo).toBe('CH');
    expect(ch.total).toBeCloseTo(0.55 * 110 + 21.7 * 0.5, 6);
    const porte = await fonte.porteNaData(c, ids.fonte, `${P}3A`, '2026-06-01');
    const pt = explicarValor({ ch: 0, porte: `${P}3A`, fracaoPorte: null, cope: 2, filmeM2: 0 }, null, {
      porte,
      uco: ind.get(5) ?? null,
      filme: ind.get(4) ?? null,
    });
    expect(pt.modelo).toBe('PORTE');
    expect(pt.falta).toEqual([]);
    expect(pt.total).toBeCloseTo(210 + 12 * 2, 6);
  });

  it('linha do tempo do contrato: índices e portes com todas as vigências; a excluída não aparece', async () => {
    const lista = await fonte.indicesConvenio(c, ids.fonte);
    const ch = lista.filter((i) => i.tipo === 'indice' && i.chave === '1').map((i) => [i.data, i.valor]);
    // Na mesma data, o valor do acordo encobre o da tabela (0,40 não aparece: nunca valeu para este convênio).
    // O CH2 (outro índice do mesmo tipo) aparece com a sua vigência; o inativo e o da tabela de outro
    // estabelecimento, não.
    expect(ch).toEqual([
      ['2027-01-01', 0.6],
      ['2026-03-01', 0.55],
      ['2025-01-01', 0.5],
    ]);
    expect(lista.filter((i) => i.chave === '4').map((i) => i.valor)).toEqual([21.7]);
    expect(lista.filter((i) => i.chave === '5').map((i) => i.valor)).toEqual([12]);
    expect(lista.filter((i) => i.tipo === 'porte').map((i) => [i.chave, i.data, i.valor])).toEqual([
      [`${P}3A`, '2026-02-01', 210],
      [`${P}3A`, '2025-01-01', 200],
    ]);
  });

  it('portes anestésicos: pela tabela do estabelecimento, pela tabela do convênio e paginados', async () => {
    const conv = await fonte.convenio(c, ids.fonte);
    expect(conv?.porte).toBe(ids.tabela);
    const pg = await fonte.portes(c, ids.tabela, 0, 50);
    expect(pg.total).toBe(2);
    expect(pg.itens.map((i) => [i['porte'], i['valor'], i['valorHorarioEspecial']])).toEqual([
      ['1', 150.5, 195.65],
      ['2', 300, 390],
    ]);
    expect(await fonte.portes(c, ids.tabela, 1, 1)).toMatchObject({ total: 2 });
    expect((await fonte.portes(outro, ids.tabela, 0, 50)).total).toBe(0);
  });

  it('porte anestésico na data: a tabela sai do regime e da vigência do acordo, não da data de hoje', async () => {
    const em = (regime: 'internacao' | 'ambulatorial', data: string) =>
      fonte.porteAnestesicoNaData(c, ids.fonte, regime, '1', data);
    expect(await em('internacao', '2025-06-01')).toEqual({
      tabela: ids.tabela,
      valor: 150.5,
      valorHorarioEspecial: 195.65,
    });
    expect(await em('ambulatorial', '2025-06-01')).toMatchObject({ tabela: ids.amb1, valor: 80 });
    expect(await em('ambulatorial', '2026-06-01')).toMatchObject({ tabela: ids.amb2, valor: 95 });
    expect(await em('internacao', '2024-06-01')).toBeNull();
    expect(await fonte.porteAnestesicoNaData(outro, ids.fonte, 'internacao', '1', '2025-06-01')).toBeNull();
  });
});
