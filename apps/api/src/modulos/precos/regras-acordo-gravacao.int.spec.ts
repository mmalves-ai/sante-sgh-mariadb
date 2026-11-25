// Contrato de efeito da gravação das regras do acordo com a fonte pagadora (06-FAT linha 1) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F37G" (nenhum dado real). Prova o que fica no banco: a regra incluída com autoria e
// versão; a anterior da mesma chave encerrada na véspera (nada se apaga); a recusa do domínio sem escrita; o encerramento
// que nunca reescreve o passado; o escopo do estabelecimento; a trilha. No fim, a massa de regras e a trilha dos
// estabelecimentos sintéticos são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { GravadorRegrasAcordo } from './regras-acordo-gravacao.js';
import { LeitorRegrasAcordo } from './regras-acordo-propria.js';
import type { CtxPrecos } from './fonte.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F37G';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('gravação das regras do acordo (MariaDB, contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let gravador: GravadorRegrasAcordo;
  const ids = { est: 0, outroEst: 0, usuario: 0, fonte: 0, outraFonte: 0, tabela: 0, contrato: 0 };
  const ids2 = { grupo: 0, item: 0, via: 0 };
  let hoje = '';

  const ctx = (est = ids.est): ContextoOperacao =>
    ({
      cliente: CLIENTE,
      estabelecimento: est,
      usuario: ids.usuario,
      correlacao: 'teste-f37g',
      chaveIdempotencia: `f37g-${randomUUID()}`,
    }) as ContextoOperacao;

  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't' }, (l) =>
      l.consultar<T>(sql, p),
    );
  const recusa = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { codigo?: string; code?: string };
      return x.codigo ?? x.code ?? /^\w+: ([a-z-]+):/.exec(String(e))?.[1] ?? String(e);
    }
    return 'gravou';
  };

  const limpar = async (e: Escritor) => {
    for (const t of ['regra_percentual_cobranca', 'item_isento_cobranca', 'teto_cobranca'])
      await e.executar(`DELETE FROM ${t} WHERE fonte_pagadora_id IN (?, ?)`, [ids.fonte, ids.outraFonte]);
    await e.executar('DELETE FROM regra_via_acesso WHERE via_acesso_cirurgico_id = ?', [ids2.via]);
    for (const t of ['regra_desconto_grupo', 'item_alto_custo_contrato'])
      await e.executar(
        `DELETE r FROM ${t} r JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?`,
        [ids.fonte],
      );
    await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f37g' }, async (e) => {
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
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f37g.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f37g.teste', 'TESTE F37G', agora],
      );
      const classe = await garantir(
        e,
        'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
        [`${P}-CONV`],
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO F37G', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      const fonte = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [codigo],
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
             VALUES (?, ?, 'operadora', 'ativa', ?, 30, ?)`,
          [codigo, `OPERADORA ${codigo} SINTETICA`, classe, agora],
        );
      ids.fonte = await fonte(`${P}-A`);
      ids.outraFonte = await fonte(`${P}-B`);
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
           VALUES (?, ?, 'HONORARIOS F37G', 'honorario', 'propria', 'real', 'ativa', ?)`,
        [ids.est, `${P}-HON`, agora],
      );
      ids2.grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}-MAT`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'MATERIAIS F37G', 'material', ?)",
        [`${P}-MAT`, agora],
      );
      ids2.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        [`${P}-STENT`],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, 'ITEM SINTETICO F37G', 'honorario', ?, ?)",
        [`${P}-STENT`, ids2.grupo, agora],
      );
      ids2.via = await garantir(
        e,
        'SELECT id FROM via_acesso_cirurgico WHERE codigo = ?',
        [`${P}-MES`],
        "INSERT INTO via_acesso_cirurgico (codigo, descricao, criado_em) VALUES (?, 'MESMA VIA F37G', ?)",
        [`${P}-MES`, agora],
      );
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
      await limpar(e);
      ids.contrato = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO F37G', '2025-01-01', 'vigente', 60, ?)`,
        [ids.est, ids.fonte, `${P}-1`, agora],
      );
      hoje = String((await e.uma<{ h: string }>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS h", []))?.h);
    });
    gravador = new GravadorRegrasAcordo(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f37g' }, async (e) => {
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outroEst] });
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  it('percentual: inclui com autoria e encerra a anterior da mesma chave na véspera', async () => {
    const base = {
      fonteId: ids.fonte,
      tabelaId: ids.tabela,
      componente: 'honorario',
      percentual: 120,
      vigenciaInicio: '2025-01-01',
    };
    const a = await gravador.gravar('percentual', ctx(), base);
    const b = await gravador.gravar('percentual', ctx(), {
      ...base,
      percentual: 130,
      vigenciaInicio: hoje,
    });
    expect(b['encerradas']).toBe(1);
    const vespera = new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const ls = await ler(
      `SELECT id, percentual, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao, criado_por, estabelecimento_id,
              contrato_fonte_pagadora_id FROM regra_percentual_cobranca WHERE fonte_pagadora_id = ? ORDER BY id`,
      [ids.fonte],
    );
    expect(ls.map((r) => [Number(r['id']), Number(r['percentual']), r['fim'], Number(r['versao'])])).toEqual([
      [a['id'], 120, vespera, 2],
      [b['id'], 130, null, 1],
    ]);
    expect(ls.every((r) => Number(r['criado_por']) === ids.usuario)).toBe(true);
    expect(ls.every((r) => Number(r['estabelecimento_id']) === ids.est)).toBe(true);
    expect(Number(ls[0]?.['contrato_fonte_pagadora_id'])).toBe(ids.contrato);
    // Mesmo início: recusa, sem escrita.
    expect(await recusa(gravador.gravar('percentual', ctx(), { ...base, vigenciaInicio: hoje }))).toBe(
      'vigencia-conflitante',
    );
    // Início retroativo que encerraria a regra vigente no passado (contas já lançadas a usaram): recusa, sem escrita.
    expect(
      await recusa(
        gravador.gravar('percentual', ctx(), { ...base, percentual: 140, vigenciaInicio: '2025-07-01' }),
      ),
    ).toBe('vigencia-retroativa');
    // Tabela de outro estabelecimento: não existe para a sessão.
    expect(await recusa(gravador.gravar('percentual', ctx(ids.outroEst), base))).toBe(
      'referencia-inexistente',
    );
    expect(await recusa(gravador.gravar('percentual', ctx(), { ...base, percentual: 1000 }))).toBe(
      'entrada-invalida',
    );
    expect(
      (
        await ler('SELECT COUNT(*) AS n FROM regra_percentual_cobranca WHERE fonte_pagadora_id = ?', [
          ids.fonte,
        ])
      )[0]?.['n'],
    ).toBe(2);
  });

  it('desconto por grupo: um sentido só e as marcas de regime e parcela', async () => {
    const base = { fonteId: ids.fonte, grupoId: ids2.grupo, vigenciaInicio: '2025-01-01' };
    expect(await recusa(gravador.gravar('desconto', ctx(), { ...base, desconto: 10, acrescimo: 5 }))).toBe(
      'entrada-invalida',
    );
    const r = await gravador.gravar('desconto', ctx(), {
      ...base,
      desconto: 10,
      regimes: ['internacao', 'urgencia'],
      sobre: ['honorario'],
    });
    const [l] = await ler(
      `SELECT contrato_fonte_pagadora_id, percentual_desconto, aplica_internacao, aplica_ambulatorial, sobre_honorario,
              sobre_filme FROM regra_desconto_grupo WHERE id = ?`,
      [r['id']],
    );
    expect([
      Number(l?.['contrato_fonte_pagadora_id']),
      Number(l?.['percentual_desconto']),
      Number(l?.['aplica_internacao']),
      Number(l?.['aplica_ambulatorial']),
      Number(l?.['sobre_honorario']),
      Number(l?.['sobre_filme']),
    ]).toEqual([ids.contrato, 10, 1, 0, 1, 0]);
    // Sem acordo no outro estabelecimento: recusa.
    expect(await recusa(gravador.gravar('desconto', ctx(ids.outroEst), { ...base, desconto: 5 }))).toBe(
      'sem-acordo',
    );
  });

  it('via de acesso, isento, teto e alto custo pelo domínio', async () => {
    const via = await gravador.gravar('via', ctx(), {
      fonteId: ids.fonte,
      descricao: 'SEGUNDO F37G',
      viaId: ids2.via,
      ordem: 2,
      percentual: 50,
      vigenciaInicio: '2025-01-01',
    });
    expect(via['id']).toBeGreaterThan(0);
    expect(
      await recusa(
        gravador.gravar('via', ctx(), {
          fonteId: ids.fonte,
          descricao: 'X',
          viaId: ids2.via,
          ordem: 0,
          percentual: 50,
          vigenciaInicio: '2025-01-01',
        }),
      ),
    ).toBe('entrada-invalida');

    const isento = { fonteId: ids.fonte, motivo: 'Incluso no pacote F37G', vigenciaInicio: '2025-01-01' };
    expect(
      await recusa(gravador.gravar('isento', ctx(), { ...isento, itemId: ids2.item, grupoId: ids2.grupo })),
    ).toBe('entrada-invalida');
    await gravador.gravar('isento', ctx(), { ...isento, itemId: ids2.item });

    const teto = {
      fonteId: ids.fonte,
      abrangencia: 'conta',
      valorTeto: 20000,
      acao: 'transferir_excedente',
      vigenciaInicio: '2025-01-01',
    };
    expect(await recusa(gravador.gravar('teto', ctx(), { ...teto, excedenteFonteId: ids.fonte }))).toBe(
      'entrada-invalida',
    );
    await gravador.gravar('teto', ctx(), { ...teto, excedenteFonteId: ids.outraFonte });

    const alto = {
      fonteId: ids.fonte,
      itemId: ids2.item,
      regra: 'preco_negociado',
      vigenciaInicio: '2025-01-01',
    };
    expect(await recusa(gravador.gravar('alto-custo', ctx(), alto))).toBe('entrada-invalida');
    await gravador.gravar('alto-custo', ctx(), { ...alto, valorNegociado: 1500 });

    const regras = await new LeitorRegrasAcordo(nucleo).regras(
      { cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't' } as unknown as CtxPrecos,
      ids.fonte,
      hoje,
    );
    expect(regras.viasAcesso.map((v) => [v.descricao, v.ordem, v.percentual, v.versao])).toEqual([
      ['SEGUNDO F37G', 2, 50, 1],
    ]);
    expect(regras.isentos.map((i) => [i.item, i.motivo])).toEqual([
      ['ITEM SINTETICO F37G', 'Incluso no pacote F37G'],
    ]);
    expect(regras.tetos.map((t) => [t.abrangencia, t.valorTeto, t.acao, t.excedenteFonte])).toEqual([
      ['conta', 20000, 'transferir_excedente', 'OPERADORA F37G-B SINTETICA'],
    ]);
    expect(regras.altoCusto.map((a) => [a.regra, a.valorNegociado, a.vigente])).toEqual([
      ['preco_negociado', 1500, true],
    ]);
  });

  it('encerrar: nunca antes de hoje, versão nova, outro estabelecimento não acha, e a trilha fica', async () => {
    const [t] = await ler<{ id: number; versao: number }>(
      'SELECT id, versao FROM teto_cobranca WHERE fonte_pagadora_id = ?',
      [ids.fonte],
    );
    const alvo = { fonteId: ids.fonte, id: Number(t?.id), versao: Number(t?.versao) };
    expect(
      await recusa(gravador.gravar('teto.encerrar', ctx(), { ...alvo, vigenciaFim: '2025-06-30' })),
    ).toBe('entrada-invalida');
    expect(
      await recusa(
        gravador.gravar('teto.encerrar', ctx(ids.outroEst), { ...alvo, vigenciaFim: '2099-12-31' }),
      ),
    ).toBe('nao-encontrado');
    const r = await gravador.gravar('teto.encerrar', ctx(), {
      ...alvo,
      vigenciaFim: '2099-12-31',
      motivoAlteracao: 'Fim do acordo F37G',
    });
    expect(r['versao']).toBe(alvo.versao + 1);
    const [l] = await ler(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, alterado_por FROM teto_cobranca WHERE id = ?",
      [alvo.id],
    );
    expect([l?.['fim'], Number(l?.['alterado_por'])]).toEqual(['2099-12-31', ids.usuario]);
    // O alto custo também encerra pelo acordo do estabelecimento.
    const [a] = await ler<{ id: number; versao: number }>(
      `SELECT r.id, r.versao FROM item_alto_custo_contrato r WHERE r.contrato_fonte_pagadora_id = ?`,
      [ids.contrato],
    );
    await gravador.gravar('alto-custo.encerrar', ctx(), {
      fonteId: ids.fonte,
      id: Number(a?.id),
      versao: Number(a?.versao),
      vigenciaFim: hoje,
    });
    const trilha = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [ids.est, ids.usuario],
    );
    // percentual 2, desconto 1, via 1, isento 1, teto 1, alto custo 1, e dois encerramentos.
    expect(Number(trilha[0]?.['n'])).toBeGreaterThanOrEqual(9);
  });
});
