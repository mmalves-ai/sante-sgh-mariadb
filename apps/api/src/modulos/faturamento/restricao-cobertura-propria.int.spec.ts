// Contrato de efeito da restrição de cobertura por fonte pagadora e da compatibilidade entre procedimentos (F7, 09-AREA
// linha 76) contra o MariaDB real. Massa SINTÉTICA com códigos "C284" (nenhuma pessoa real). Prova o que fica no banco:
//   - o cadastro grava a restrição com os critérios; alterar troca os critérios (o antigo fica com excluido_em e a
//     sequência continua); o par de compatibilidade e a justificativa padronizada ficam gravados; par repetido e
//     restrição sem alvo são recusados sem gravar;
//   - o lançamento do item não coberto é recusado ('cobertura-restrita') e nada entra na conta; a exceção do atendimento
//     (justificativa, autor, quantidade) libera e fica na memória do item; revogada, fica com excluido_em e volta a
//     bloquear;
//   - o critério de faixa de idade lê a idade do paciente: fora da faixa, o item passa;
//   - o par incompatível bloqueia o segundo procedimento; o aviso só alerta e volta no resultado e na memória;
//   - na prescrição, o mesmo item restrito só gera alerta e nada é gravado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoFaturamento } from './porta.js';
import { PortaFaturamentoPropria } from './porta-propria.js';
import { ServicoCobertura } from './restricao-cobertura.controller.js';
import { avaliarCoberturaPropria, excecoesAtendimentoPropria } from './restricao-cobertura-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C284';
const COD = { a: 82_840_001, b: 82_840_002, c: 82_840_003, d: 82_840_004, e: 82_840_005 } as const;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('restrição de cobertura e compatibilidade no lançamento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFaturamentoPropria;
  let s: ServicoCobertura;
  let c: ContextoFaturamento;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: ids['usuario']!,
    correlacao: 'teste-c284',
    chaveIdempotencia: `c284-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids['est']!,
    usuario: null,
    correlacao: 'teste-c284',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c284' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await linhas(sql, p))[0]!['n']);

  const limpar = async (e: Escritor) => {
    if (!ids['est']) return;
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids['est'], `${P}%`],
    );
    for (const { id } of contas) {
      await e.executar(
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar('DELETE FROM restricao_cobertura_excecao WHERE estabelecimento_id = ?', [ids['est']]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
    if (ids['fonte']) {
      await e.executar(
        `DELETE c FROM restricao_cobertura_criterio c JOIN restricao_cobertura_fonte_pagadora r
            ON r.id = c.restricao_cobertura_fonte_pagadora_id WHERE r.fonte_pagadora_id = ?`,
        [ids['fonte']],
      );
      await e.executar('DELETE FROM restricao_cobertura_fonte_pagadora WHERE fonte_pagadora_id = ?', [
        ids['fonte'],
      ]);
    }
    await e.executar(
      `DELETE p FROM compatibilidade_procedimento p JOIN item_faturavel i ON i.id = p.item_faturavel_id
        WHERE i.codigo LIKE ?`,
      ['8284%'],
    );
    await e.executar('DELETE FROM justificativa_excecao_cobertura WHERE codigo LIKE ?', [`${P}%`]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
        garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
      ids['est'] = await g(
        'estabelecimento',
        `${P}A`,
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['fonte'] = await g(
        'fonte_pagadora',
        `${P}FP`,
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      await limpar(e);
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
      await e.executar("UPDATE pessoa_fisica SET data_nascimento = '1990-05-10' WHERE id = ?", [pp]);
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 828_401, agora],
      );
      const pf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids['categoria'] = await g(
        'categoria_atendimento',
        P,
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids['tipoConta'] = await g(
        'tipo_conta',
        P,
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'ambulatorial', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`${P.toLowerCase()}.fat`],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P.toLowerCase()}.fat`, `USUARIO ${P}`, agora],
      );
      ids['grupo'] = await g(
        'grupo_faturamento',
        `${P}G`,
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [`${P}G`, `GRUPO ${P}`, agora],
      );
      ids['tabela'] = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE codigo = ?',
        [`${P}T`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id,
           criado_em) VALUES (?, ?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
        [ids['est'], `${P}T`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
      );
      let seq = 0;
      for (const [k, cod] of Object.entries(COD)) {
        seq += 1;
        ids[k] = await g(
          'item_faturavel',
          String(cod),
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [String(cod), `PROCEDIMENTO SINTETICO ${P} ${k}`, ids['grupo'], agora],
        );
        const pp2 = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids['tabela'], ids[k]],
          'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, ?, ?, ?)',
          [ids['tabela'], seq, ids[k], agora],
        );
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [pp2],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
             valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
           VALUES (?, 'inclusao', ?, '2020-01-01', 0, 100, 0, 100, ?)`,
          [pp2, agora, agora],
        );
      }
      const eletivo = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['FAE'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', FALSE, ?)",
        ['FAE', 'CARATER SINTETICO FAE', agora],
      );
      ids['atendimento'] = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 11:00:00', ?)`,
        [ids['est'], `${P}-AT`, ids['paciente'], ids['categoria'], eletivo, ids['fonte'], ids['prof'], agora],
      );
      ids['conta'] = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ambulatorial', '2026-01-01', '2026-01-20 11:00:00', ?)`,
        [
          ids['est'],
          `${P}-C`,
          ids['atendimento'],
          ids['paciente'],
          ids['fonte'],
          ids['tipoConta'],
          ids['tabela'],
          agora,
        ],
      );
    });
    porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
    s = new ServicoCobertura(nucleo);
    c = {
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-c284',
      rede: 'rede-teste',
      hospital: `${P}A`,
    };
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est']] });
    });
    await nucleo.encerrar();
  });

  const lancar = (codigo: number, quantidade = 1) =>
    porta.executar(
      c,
      'faturamento.lancarItem',
      {
        conta: ids['conta'],
        tipo: 3,
        codigo,
        quantidade,
        data: '2026-01-20',
        hora: '10:00',
        local: 0,
        ato: 0,
      },
      op(),
    );
  const itensNaConta = (item: number) =>
    contar(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND item_faturavel_id = ?',
      [ids['conta'], item],
    );
  const memoria = async (itemConta: number) => {
    const [x] = await linhas(
      'SELECT dados FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ?',
      [itemConta],
    );
    const d = typeof x!['dados'] === 'string' ? JSON.parse(String(x!['dados'])) : x!['dados'];
    return (
      d as { cobertura: { situacao: string; achados: { excecaoId: number | null; efeito: string }[] } | null }
    ).cobertura;
  };
  const base = { fontePagadoraId: 0, vigenciaInicio: '2025-01-01' };

  it('cadastro: restrição com critérios, troca de critérios com histórico, par, justificativa e recusas', async () => {
    const r = await s.gravar('restricao.gravar', op(), {
      ...base,
      fontePagadoraId: ids['fonte'],
      descricao: `NAO COBERTO ${P}`,
      itemId: ids['a'],
      tipo: 'nao_coberto',
      criterios: [{ tipo: 'tipo_atendimento', tipoAtendimento: 'ambulatorial' }],
    });
    ids['restrA'] = Number(r['id']);
    // Alterar troca o critério: o antigo fica marcado, o novo entra com a sequência seguinte.
    const [v] = await linhas('SELECT versao FROM restricao_cobertura_fonte_pagadora WHERE id = ?', [
      ids['restrA'],
    ]);
    await s.gravar('restricao.gravar', op(), {
      ...base,
      id: ids['restrA'],
      versao: Number(v!['versao']),
      fontePagadoraId: ids['fonte'],
      descricao: `NAO COBERTO ${P}`,
      itemId: ids['a'],
      tipo: 'nao_coberto',
      criterios: [{ tipo: 'faixa_idade', idadeMinima: 18 }],
    });
    const crit = await linhas(
      `SELECT sequencia, tipo_criterio, excluido_em IS NOT NULL AS excluido FROM restricao_cobertura_criterio
        WHERE restricao_cobertura_fonte_pagadora_id = ? ORDER BY sequencia`,
      [ids['restrA']],
    );
    expect(crit.map((x) => [Number(x['sequencia']), x['tipo_criterio'], Number(x['excluido'])])).toEqual([
      [1, 'tipo_atendimento', 1],
      [2, 'faixa_idade', 0],
    ]);
    // Critério que não bate com o paciente (nascido em 1990): o item e passa.
    await s.gravar('restricao.gravar', op(), {
      ...base,
      fontePagadoraId: ids['fonte'],
      descricao: `IDOSO ${P}`,
      itemId: ids['e'],
      tipo: 'nao_coberto',
      criterios: [{ tipo: 'faixa_idade', idadeMinima: 60 }],
    });
    await s.gravar('restricao.gravar', op(), {
      ...base,
      fontePagadoraId: ids['fonte'],
      descricao: `AVISO ${P}`,
      itemId: ids['d'],
      tipo: 'somente_aviso',
      mensagem: `Conferir a guia ${P}`,
    });
    await expect(
      s.gravar('restricao.gravar', op(), {
        ...base,
        fontePagadoraId: ids['fonte'],
        descricao: 'SEM ALVO',
        tipo: 'nao_coberto',
      }),
    ).rejects.toThrow(/item, o grupo ou a tabela/);
    const par = await s.gravar('par.gravar', op(), {
      itemId: ids['b'],
      relacionadoId: ids['c'],
      tipo: 'incompativel',
      fontePagadoraId: ids['fonte'],
      vigenciaInicio: '2025-01-01',
    });
    expect(Number(par['id'])).toBeGreaterThan(0);
    await expect(
      s.gravar('par.gravar', op(), {
        itemId: ids['b'],
        relacionadoId: ids['c'],
        tipo: 'incompativel',
        fontePagadoraId: ids['fonte'],
        vigenciaInicio: '2025-01-01',
      }),
    ).rejects.toThrow(/Já existe/);
    const j = await s.gravar('justificativa.gravar', op(), { codigo: `${P}J`, descricao: `URGENCIA ${P}` });
    ids['just'] = Number(j['id']);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM restricao_cobertura_fonte_pagadora WHERE fonte_pagadora_id = ? AND descricao = ?',
        [ids['fonte'], 'SEM ALVO'],
      ),
    ).toBe(0);
  });

  it('lançamento: item não coberto recusado sem gravar; a exceção libera e fica na memória; revogada volta a bloquear', async () => {
    await expect(lancar(COD.a)).rejects.toThrow(/não coberto/);
    expect(await itensNaConta(ids['a']!)).toBe(0);
    const x = await s.gravar('excecao.registrar', op(), {
      atendimentoId: ids['atendimento'],
      restricaoId: ids['restrA'],
      itemId: ids['a'],
      justificativaId: ids['just'],
      quantidadeAutorizada: 1,
      numeroGuia: `${P}G1`,
      tiposAtendimento: ['ambulatorial'],
    });
    ids['exc'] = Number(x['id']);
    const [gx] = await linhas(
      `SELECT paciente_id, fonte_pagadora_id, autorizado_por_usuario_id, aplica_internacao, aplica_ambulatorial
         FROM restricao_cobertura_excecao WHERE id = ?`,
      [ids['exc']],
    );
    expect(
      [gx!['paciente_id'], gx!['fonte_pagadora_id'], gx!['autorizado_por_usuario_id']].map(Number),
    ).toEqual([ids['paciente'], ids['fonte'], ids['usuario']]);
    expect([Number(gx!['aplica_internacao']), Number(gx!['aplica_ambulatorial'])]).toEqual([0, 1]);
    const ok = await lancar(COD.a);
    const mem = await memoria(Number(ok.resultado['id']));
    expect(mem?.achados[0]).toMatchObject({ efeito: 'liberado', excecaoId: ids['exc'] });
    // A quantidade autorizada (1) já foi usada: o segundo é recusado.
    await expect(lancar(COD.a)).rejects.toThrow(/não coberto/);
    const vis = await s.ler(ctxL(), (l, est) => excecoesAtendimentoPropria(l, est, ids['atendimento']!));
    const [ex] = vis.excecoes;
    await s.gravar('excecao.revogar', op(), { id: ids['exc'], versao: ex!.versao });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM restricao_cobertura_excecao WHERE id = ? AND excluido_em IS NOT NULL',
        [ids['exc']],
      ),
    ).toBe(1);
    expect(await itensNaConta(ids['a']!)).toBe(1);
  });

  it('critério fora da faixa passa; par incompatível bloqueia o segundo; aviso só alerta e vai à memória', async () => {
    const e1 = await lancar(COD.e);
    expect(await memoria(Number(e1.resultado['id']))).toBeNull();
    await lancar(COD.b);
    await expect(lancar(COD.c)).rejects.toThrow(/incompatível/);
    expect(await itensNaConta(ids['c']!)).toBe(0);
    const d = await lancar(COD.d);
    expect(d.resultado).toMatchObject({ coberturaSituacao: 'alerta' });
    expect(String(d.resultado['coberturaMotivos'])).toContain(`Conferir a guia ${P}`);
    expect((await memoria(Number(d.resultado['id'])))?.situacao).toBe('alerta');
  });

  it('prescrição: o item restrito só gera alerta e nada é gravado', async () => {
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [ids['conta']],
    );
    const r = await s.ler(ctxL(), (l, est) =>
      avaliarCoberturaPropria(l, est, {
        atendimentoId: ids['atendimento']!,
        contexto: 'prescricao',
        data: '2026-01-21',
        hora: '09:00',
        setorId: null,
        profissionalId: ids['prof']!,
        itens: [
          { codigo: String(COD.a), quantidade: 1 },
          { codigo: String(COD.c), quantidade: 1 },
        ],
      }),
    );
    expect(r.itens.map((i) => i.situacao)).toEqual(['alerta', 'alerta']);
    expect(r.itens.flatMap((i) => i.achados).every((a) => a.efeito === 'alerta')).toBe(true);
    expect(
      await contar('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [
        ids['conta'],
      ]),
    ).toBe(antes);
  });
});
