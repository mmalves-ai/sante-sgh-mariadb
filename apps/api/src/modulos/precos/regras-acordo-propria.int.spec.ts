// Integração da leitura das regras do acordo com a fonte pagadora (06-FAT linha 1) contra o MariaDB real. Massa
// SINTÉTICA com códigos "F37R" (nenhum dado real): percentual sobre honorário e mat/med, desconto por grupo de despesa,
// via de acesso (a do convênio e a padrão de todas), item isento e teto; a marca "vigente na data" e o isolamento por
// estabelecimento. No fim, a massa de regras é apagada; ficam os cadastros da rede. SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CtxPrecos } from './fonte.js';
import { LeitorRegrasAcordo, vigenteNaData } from './regras-acordo-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F37R';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe('vigenteNaData', () => {
  it('início até a data e fim nulo ou depois dela', () => {
    expect(vigenteNaData('2025-01-01', null, '2025-01-01')).toBe(true);
    expect(vigenteNaData('2025-01-02', null, '2025-01-01')).toBe(false);
    expect(vigenteNaData('2025-01-01', '2025-06-30', '2025-06-30')).toBe(true);
    expect(vigenteNaData('2025-01-01', '2025-06-30', '2025-07-01')).toBe(false);
  });
});

describe.skipIf(SEM_BANCO)('regras do acordo com a fonte pagadora (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let leitor: LeitorRegrasAcordo;
  const ids = { est: 0, outroEst: 0, fonte: 0, tabela: 0, contrato: 0, grupo: 0, item: 0, via: 0 };
  let c: CtxPrecos;

  const limpar = async (e: Escritor) => {
    await e.executar('DELETE FROM regra_percentual_cobranca WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar('DELETE FROM regra_via_acesso WHERE via_acesso_cirurgico_id = ?', [ids.via]);
    await e.executar('DELETE FROM item_isento_cobranca WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar('DELETE FROM teto_cobranca WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar(
      'DELETE r FROM regra_desconto_grupo r JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
      [ids.fonte],
    );
    await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f37-regras' }, async (e) => {
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
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO F37R', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-A`],
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA F37R SINTETICA', 'operadora', 'ativa', ?, 30, ?)`,
        [`${P}-A`, classe, agora],
      );
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
           VALUES (?, ?, 'HONORARIOS F37R', 'honorario', 'propria', 'real', 'ativa', ?)`,
        [ids.est, `${P}-HON`, agora],
      );
      ids.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}-MAT`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'MATERIAIS F37R', 'material', ?)",
        [`${P}-MAT`, agora],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        [`${P}-CONS`],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, 'CONSULTA SINTETICA F37R', 'honorario', ?, ?)",
        [`${P}-CONS`, ids.grupo, agora],
      );
      ids.via = await garantir(
        e,
        'SELECT id FROM via_acesso_cirurgico WHERE codigo = ?',
        [`${P}-DIF`],
        "INSERT INTO via_acesso_cirurgico (codigo, descricao, criado_em) VALUES (?, 'VIAS DIFERENTES F37R', ?)",
        [`${P}-DIF`, agora],
      );
      await limpar(e);
      ids.contrato = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO F37R', '2025-01-01', 'vigente', 60, ?)`,
        [ids.est, ids.fonte, `${P}-1`, agora],
      );
      // Percentual: 120% do honorário vigente; 80% do mat/med encerrado em 2025-06-30.
      await e.inserir(
        `INSERT INTO regra_percentual_cobranca (estabelecimento_id, fonte_pagadora_id, contrato_fonte_pagadora_id,
           tabela_preco_id, componente, percentual, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, 'honorario', 120, '2025-01-01', ?)`,
        [ids.est, ids.fonte, ids.contrato, ids.tabela, agora],
      );
      await e.inserir(
        `INSERT INTO regra_percentual_cobranca (estabelecimento_id, fonte_pagadora_id, contrato_fonte_pagadora_id,
           tabela_preco_id, componente, percentual, vigencia_inicio, vigencia_fim, criado_em)
         VALUES (?, ?, ?, ?, 'matmed', 80, '2025-01-01', '2025-06-30', ?)`,
        [ids.est, ids.fonte, ids.contrato, ids.tabela, agora],
      );
      await e.inserir(
        `INSERT INTO regra_desconto_grupo (contrato_fonte_pagadora_id, grupo_faturamento_id, percentual_desconto,
           aplica_domiciliar, sobre_filme, vigencia_inicio, criado_em) VALUES (?, ?, 10, FALSE, FALSE, '2025-01-01', ?)`,
        [ids.contrato, ids.grupo, agora],
      );
      // Via de acesso: a do convênio (2º procedimento a 50%) e a padrão de todas (70%), no estabelecimento.
      await e.inserir(
        `INSERT INTO regra_via_acesso (estabelecimento_id, descricao, fonte_pagadora_id, via_acesso_cirurgico_id,
           ordem_procedimento, percentual, vigencia_inicio, criado_em) VALUES (?, 'SEGUNDO F37R', ?, ?, 2, 50, '2025-01-01', ?)`,
        [ids.est, ids.fonte, ids.via, agora],
      );
      await e.inserir(
        `INSERT INTO regra_via_acesso (estabelecimento_id, descricao, fonte_pagadora_id, via_acesso_cirurgico_id,
           ordem_procedimento, percentual, vigencia_inicio, criado_em) VALUES (?, 'PADRAO F37R', NULL, ?, 2, 70, '2025-01-01', ?)`,
        [ids.est, ids.via, agora],
      );
      // Regra de outro estabelecimento: nunca aparece.
      await e.inserir(
        `INSERT INTO regra_via_acesso (estabelecimento_id, descricao, fonte_pagadora_id, via_acesso_cirurgico_id,
           ordem_procedimento, percentual, vigencia_inicio, criado_em) VALUES (?, 'OUTRO F37R', ?, ?, 3, 30, '2025-01-01', ?)`,
        [ids.outroEst, ids.fonte, ids.via, agora],
      );
      await e.inserir(
        `INSERT INTO item_isento_cobranca (estabelecimento_id, fonte_pagadora_id, contrato_fonte_pagadora_id,
           item_faturavel_id, motivo, vigencia_inicio, criado_em) VALUES (NULL, ?, ?, ?, 'INCLUSO NO PACOTE F37R', '2025-01-01', ?)`,
        [ids.fonte, ids.contrato, ids.item, agora],
      );
      await e.inserir(
        `INSERT INTO teto_cobranca (estabelecimento_id, fonte_pagadora_id, abrangencia, grupo_faturamento_id, valor_teto,
           acao, vigencia_inicio, criado_em) VALUES (?, ?, 'grupo', ?, 5000, 'alertar', '2025-01-01', ?)`,
        [ids.est, ids.fonte, ids.grupo, agora],
      );
    });
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: null,
      correlacao: 'teste-f37-regras',
      rede: 'teste',
      hospital: P,
      traceId: 'teste-f37-regras',
    } as CtxPrecos;
    leitor = new LeitorRegrasAcordo(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f37-regras' }, async (e) => {
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  it('percentuais por componente com a vigência na data', async () => {
    const r = await leitor.regras(c, ids.fonte, '2025-09-01');
    expect(r.percentuais.map((p) => [p.componente, p.percentual, p.vigente])).toEqual([
      ['honorario', 120, true],
      ['matmed', 80, false],
    ]);
    const antes = await leitor.regras(c, ids.fonte, '2025-03-01');
    expect(antes.percentuais.every((p) => p.vigente)).toBe(true);
  });

  it('desconto por grupo de despesa, via de acesso, isento e teto', async () => {
    const r = await leitor.regras(c, ids.fonte, '2025-09-01');
    expect(r.descontosGrupo).toHaveLength(1);
    expect(r.descontosGrupo[0]).toMatchObject({
      grupo: 'MATERIAIS F37R',
      desconto: 10,
      acrescimo: 0,
      sobre: ['honorario', 'custo_operacional'],
      regimes: ['ambulatorial', 'externo', 'internacao', 'urgencia'],
      vigente: true,
    });
    // A do convênio primeiro, a padrão de todas depois; a de outro estabelecimento não aparece.
    expect(r.viasAcesso.map((v) => [v.descricao, v.ordem, v.percentual, v.padraoDeTodas])).toEqual([
      ['SEGUNDO F37R', 2, 50, false],
      ['PADRAO F37R', 2, 70, true],
    ]);
    expect(r.isentos.map((i) => [i.item, i.motivo, i.vigente])).toEqual([
      ['CONSULTA SINTETICA F37R', 'INCLUSO NO PACOTE F37R', true],
    ]);
    expect(r.tetos.map((t) => [t.abrangencia, t.grupo, t.valorTeto, t.acao])).toEqual([
      ['grupo', 'MATERIAIS F37R', 5000, 'alertar'],
    ]);
  });

  it('outro estabelecimento: só a regra de todos os estabelecimentos e a sua', async () => {
    const r = await leitor.regras({ ...c, estabelecimento: ids.outroEst }, ids.fonte, '2025-09-01');
    expect(r.percentuais).toEqual([]);
    expect(r.descontosGrupo).toEqual([]);
    expect(r.viasAcesso.map((v) => v.descricao)).toEqual(['OUTRO F37R']);
    expect(r.isentos.map((i) => i.motivo)).toEqual(['INCLUSO NO PACOTE F37R']);
    expect(r.tetos).toEqual([]);
  });
});
