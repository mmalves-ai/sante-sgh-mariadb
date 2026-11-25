// Contrato de efeito da página inicial montada pelo hospital (01-ADM L114; F8) contra o MariaDB real (cliente de teste;
// massa SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: o modelo nasce rascunho e o
// nome repetido é recusado; publicar sem bloco nem perfil é recusado sem gravar; salvar grava os blocos em ordem
// (lista de trabalho ligada ao catálogo tipo_bloco_pagina, indicador, atalho e texto) e o perfil com a prioridade; a
// lista fora do catálogo e a versão velha são recusadas sem mudar nada; tirar blocos marca-os como excluídos (nada é
// apagado) e o perfil que sai também; publicado, a página da pessoa traz o modelo dos perfis dela com a série do
// indicador e sem a lista que ela não veria; inativado, volta a página fixa (nulo). O modelo da REDE, com dois
// estabelecimentos: sem o escopo de rede, nenhum dos dois cria, salva nem muda a situação dele (nada gravado); com o
// escopo, os perfis são conferidos pelo escopo do modelo (o perfil do outro estabelecimento vale) e o editor do outro
// estabelecimento salva sem perder o perfil daqui; sem o escopo, o detalhe esconde o perfil alheio e só o conta.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPaginaInicialPropria } from './pagina-inicial-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2039pi';
const P2 = 'c2039pj';
const REDE = 'C2039 rede';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const mod = `(SELECT x.id FROM (SELECT id FROM modelo_pagina_inicial WHERE estabelecimento_id IN ${est}
     OR (estabelecimento_id IS NULL AND nome LIKE ?)) x)`;
  const pm = [P, P2, `${REDE}%`];
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM modelo_pagina_inicial_bloco WHERE modelo_pagina_inicial_id IN ${mod}`, pm);
    await e.executar(`DELETE FROM modelo_pagina_inicial_perfil WHERE modelo_pagina_inicial_id IN ${mod}`, pm);
    await e.executar(
      `DELETE FROM modelo_pagina_inicial WHERE estabelecimento_id IN ${est} OR (estabelecimento_id IS NULL AND nome LIKE ?)`,
      pm,
    );
    await e.executar(`DELETE FROM apuracao_indicador WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM usuario_perfil WHERE estabelecimento_id IN ${est}`, [P, P2]);
    await e.executar(`DELETE FROM perfil_acesso WHERE codigo LIKE 'c2039-%'`);
    await e.executar(`DELETE FROM indicador WHERE codigo LIKE 'C2039%'`);
    await limparTrilhaDaMassa(e, { codigos: [P, P2] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Página inicial montada pelo hospital (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPaginaInicialPropria;
  let m: {
    est: number;
    usuario: number;
    perfil: number;
    perfil2: number;
    perfilOutro: number;
    indicador: number;
  };
  let modelo = 0;
  const ctx = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P, hospital: P });
  const ctxOutro = () => ({ cliente: CLIENTE, usuario: m.usuario, correlacao: P2, hospital: P2 });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const linhaModelo = async () =>
    (await ler('SELECT situacao, nome, versao FROM modelo_pagina_inicial WHERE id = ?', [modelo]))[0]!;
  const blocos = () =>
    ler(
      `SELECT b.sequencia, b.tipo_bloco, t.codigo AS catalogo, b.indicador_id, b.endereco_link, b.texto, b.largura,
              b.excluido_em IS NOT NULL AS excluido
         FROM modelo_pagina_inicial_bloco b LEFT JOIN tipo_bloco_pagina t ON t.id = b.tipo_bloco_pagina_id
        WHERE b.modelo_pagina_inicial_id = ? ORDER BY b.sequencia`,
      [modelo],
    );
  const perfis = () =>
    ler(
      'SELECT perfil_acesso_id, prioridade, excluido_em IS NOT NULL AS excluido FROM modelo_pagina_inicial_perfil WHERE modelo_pagina_inicial_id = ? ORDER BY perfil_acesso_id',
      [modelo],
    );
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { problema?: { status?: number; codigo?: string }; status?: number; codigo?: string };
      return { status: x.problema?.status ?? x.status, texto: JSON.stringify(x.problema ?? x) };
    }
    throw new Error('Era para recusar.');
  };
  const quatroBlocos = () => [
    {
      tipo: 'lista_trabalho',
      catalogo: 'medico',
      indicadorId: null,
      titulo: null,
      endereco: null,
      texto: null,
      largura: 2,
    },
    {
      tipo: 'indicador',
      catalogo: null,
      indicadorId: m.indicador,
      titulo: null,
      endereco: null,
      texto: null,
      largura: 1,
    },
    {
      tipo: 'link',
      catalogo: null,
      indicadorId: null,
      titulo: 'Agenda',
      endereco: '/agenda',
      texto: null,
      largura: 1,
    },
    {
      tipo: 'texto',
      catalogo: null,
      indicadorId: null,
      titulo: 'Aviso',
      endereco: null,
      texto: 'Plantão novo',
      largura: 3,
    },
  ];

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaPaginaInicialPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const perfil = await e.inserir(
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'c2039-a', 'Perfil teste A', ?)",
        [est, agora],
      );
      const perfil2 = await e.inserir(
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'c2039-b', 'Perfil teste B', ?)",
        [est, agora],
      );
      const est2 = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste B', 'Hospital sintético B (fictício)', 'America/Sao_Paulo', ?)`,
        [P2, agora],
      );
      const perfilOutro = await e.inserir(
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'c2039-c', 'Perfil teste C', ?)",
        [est2, agora],
      );
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [us!['id'], perfil, est, '2026-01-01', agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      let indicador: number | undefined;
      try {
        indicador = await e.inserir(
          `INSERT INTO indicador (codigo, nome, grupo_indicador_id, unidade, polaridade, criado_em)
           VALUES ('C2039IND', 'Ocupação (teste)', 0, 'percentual', 'maior_melhor', ?)`,
          [agora],
        );
        for (const [comp, valor] of [
          ['2026-09-01', 70],
          ['2026-10-01', 85.5],
        ] as const)
          await e.executar(
            `INSERT INTO apuracao_indicador (estabelecimento_id, indicador_id, indicador_versao_id, competencia, periodo_inicio,
               periodo_fim, valor, valor_meta, criado_em) VALUES (?, ?, 0, ?, ?, LAST_DAY(?), ?, 80, ?)`,
            [est, indicador, comp, comp, comp, valor, agora],
          );
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      return { est, usuario: Number(us!['id']), perfil, perfil2, perfilOutro, indicador: indicador! };
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('cria o modelo em rascunho; nome repetido é recusado; publicar vazio é recusado sem gravar', async () => {
    const r = await porta.criar(ctx(), { nome: 'Plantão clínico', descricao: null, rede: false });
    modelo = r.id;
    expect(await linhaModelo()).toMatchObject({ situacao: 'rascunho', nome: 'Plantão clínico' });
    expect(
      (await erro(porta.criar(ctx(), { nome: 'Plantão clínico', descricao: null, rede: false }))).texto,
    ).toContain('nome-repetido');
    const e = await erro(porta.mudarSituacao(ctx(), modelo, { versao: 1, situacao: 'publicado' }));
    expect(e.texto).toContain('sem-blocos');
    expect(e.texto).toContain('Ligue ao menos um perfil');
    expect(await linhaModelo()).toMatchObject({ situacao: 'rascunho', versao: 1 });
  });

  it('salva blocos em ordem e perfis; lista fora do catálogo e versão velha são recusadas', async () => {
    const ruim: Record<string, unknown>[] = quatroBlocos();
    ruim[0] = { ...ruim[0]!, catalogo: 'inexistente' };
    const e = await erro(
      porta.salvar(ctx(), modelo, {
        versao: 1,
        nome: 'Plantão clínico',
        descricao: null,
        blocos: ruim,
        perfis: [],
      }),
    );
    expect(e.texto).toContain('lista-desconhecida');
    expect(await blocos()).toHaveLength(0);

    const r = await porta.salvar(ctx(), modelo, {
      versao: 1,
      nome: 'Plantão clínico',
      descricao: 'Para o corpo clínico',
      blocos: quatroBlocos(),
      perfis: [
        { perfilId: m.perfil, prioridade: 1 },
        { perfilId: m.perfil2, prioridade: 5 },
      ],
    });
    expect(r.versao).toBe(2);
    const b = await blocos();
    expect(b.map((x) => [Number(x['sequencia']), x['tipo_bloco'], x['catalogo']])).toEqual([
      [1, 'lista_trabalho', 'medico'],
      [2, 'indicador', 'indicador'],
      [3, 'link', 'link'],
      [4, 'texto', 'texto'],
    ]);
    expect(Number(b[1]!['indicador_id'])).toBe(m.indicador);
    expect(b[2]!['endereco_link']).toBe('/agenda');
    expect(Number(b[3]!['largura'])).toBe(3);
    expect((await perfis()).map((p) => [Number(p['perfil_acesso_id']), Number(p['prioridade'])])).toEqual([
      [m.perfil, 1],
      [m.perfil2, 5],
    ]);
    expect(
      (
        await erro(
          porta.salvar(ctx(), modelo, { versao: 1, nome: 'X1x', descricao: null, blocos: [], perfis: [] }),
        )
      ).status,
    ).toBe(409);
  });

  it('tirar blocos e perfil marca como excluído (nada é apagado); publica', async () => {
    const r = await porta.salvar(ctx(), modelo, {
      versao: 2,
      nome: 'Plantão clínico',
      descricao: null,
      blocos: quatroBlocos().slice(0, 2),
      perfis: [{ perfilId: m.perfil, prioridade: 1 }],
    });
    const b = await blocos();
    expect(b).toHaveLength(4);
    expect(b.map((x) => Number(x['excluido']))).toEqual([0, 0, 1, 1]);
    expect((await perfis()).map((p) => Number(p['excluido']))).toEqual([0, 1]);
    const pub = await porta.mudarSituacao(ctx(), modelo, { versao: r.versao, situacao: 'publicado' });
    expect(pub.situacao).toBe('publicado');
    expect(await linhaModelo()).toMatchObject({ situacao: 'publicado' });
  });

  it('a página da pessoa: o modelo do perfil, a série do indicador e sem a lista não liberada', async () => {
    const com = await porta.minha(ctx(), new Set(['medico']));
    expect(com.modelo).toEqual({ id: modelo, nome: 'Plantão clínico' });
    expect(com.blocos.map((b) => b.tipo)).toEqual(['lista_trabalho', 'indicador']);
    const ind = com.blocos[1]!.indicador!;
    expect(ind.serie.map((s) => [s.competencia, s.valor, s.meta])).toEqual([
      ['2026-09-01', 70, 80],
      ['2026-10-01', 85.5, 80],
    ]);
    const sem = await porta.minha(ctx(), new Set());
    expect(sem.blocos.map((b) => b.tipo)).toEqual(['indicador']);
  });

  it('inativado, a página fixa volta (nulo); o modelo continua no banco', async () => {
    const v = Number((await linhaModelo())['versao']);
    await porta.mudarSituacao(ctx(), modelo, { versao: v, situacao: 'inativo' });
    expect((await porta.minha(ctx(), new Set(['medico']))).modelo).toBeNull();
    expect(await linhaModelo()).toMatchObject({ situacao: 'inativo' });
    expect((await porta.modelos(ctx())).find((x) => x.id === modelo)).toMatchObject({ blocos: 2, perfis: 1 });
  });

  it('modelo da rede: só com o escopo de rede; perfis pelo escopo do modelo, não do estabelecimento da sessão', async () => {
    const pagina = (v: number, perfisIds: number[]) => ({
      versao: v,
      nome: `${REDE} geral`,
      descricao: null,
      blocos: quatroBlocos().slice(2),
      perfis: perfisIds.map((perfilId, i) => ({ perfilId, prioridade: i + 1 })),
    });
    const daRede = () =>
      ler(
        'SELECT id, versao, situacao FROM modelo_pagina_inicial WHERE estabelecimento_id IS NULL AND nome LIKE ?',
        [`${REDE}%`],
      );
    // Sem o escopo de rede: nada é criado.
    const sem = await erro(porta.criar(ctx(), { nome: `${REDE} geral`, descricao: null, rede: true }));
    expect(sem.status).toBe(403);
    expect(sem.texto).toContain('sem-escopo-rede');
    expect(await daRede()).toHaveLength(0);

    // Com o escopo, de A: cria e liga o perfil de A e o de B (o modelo vale para a rede inteira).
    const r = await porta.criar(ctx(), { nome: `${REDE} geral`, descricao: null, rede: true }, true);
    const v2 = await porta.salvar(ctx(), r.id, pagina(1, [m.perfil, m.perfilOutro]), true);
    expect(v2.versao).toBe(2);
    // O modelo de um estabelecimento continua só com os perfis dele: o de B é recusado no modelo de A.
    expect(
      (
        await erro(
          porta.salvar(ctx(), modelo, {
            ...pagina(Number((await linhaModelo())['versao']), [m.perfilOutro]),
            nome: 'Plantão clínico',
          }),
        )
      ).texto,
    ).toContain('perfil-inexistente');

    // De B, sem o escopo: não salva, não publica, não inativa (403, versão intacta); o detalhe esconde o perfil de A.
    expect((await erro(porta.salvar(ctxOutro(), r.id, pagina(2, [m.perfilOutro])))).status).toBe(403);
    expect(
      (await erro(porta.mudarSituacao(ctxOutro(), r.id, { versao: 2, situacao: 'publicado' }))).status,
    ).toBe(403);
    expect(
      (await erro(porta.mudarSituacao(ctxOutro(), r.id, { versao: 2, situacao: 'inativo' }))).status,
    ).toBe(403);
    expect((await daRede()).map((x) => [Number(x['versao']), x['situacao']])).toEqual([[2, 'rascunho']]);
    const visto = await porta.detalhe(ctxOutro(), r.id);
    expect(visto).toMatchObject({ rede: true, podeAlterar: false, perfisOutros: 1 });
    expect(visto.perfis.map((p) => p.perfilId)).toEqual([m.perfilOutro]);
    const cat = await porta.catalogo(ctxOutro());
    expect(cat.podeRede).toBe(false);
    expect(cat.perfis.some((p) => p.id === m.perfil)).toBe(false);

    // De B, com o escopo: vê os dois perfis, salva mantendo o de A (sem 'perfil-inexistente') e publica.
    const comEscopo = await porta.detalhe(ctxOutro(), r.id, true);
    expect(comEscopo).toMatchObject({ podeAlterar: true, perfisOutros: 0 });
    expect(comEscopo.perfis.map((p) => p.perfilId).sort()).toEqual([m.perfil, m.perfilOutro].sort());
    expect((await porta.catalogo(ctxOutro(), true)).perfis.some((p) => p.id === m.perfil)).toBe(true);
    const v3 = await porta.salvar(ctxOutro(), r.id, pagina(2, [m.perfil, m.perfilOutro]), true);
    await porta.mudarSituacao(ctxOutro(), r.id, { versao: v3.versao, situacao: 'publicado' }, true);
    expect((await daRede()).map((x) => [Number(x['versao']), x['situacao']])).toEqual([[4, 'publicado']]);
    const ligados = await ler(
      'SELECT perfil_acesso_id FROM modelo_pagina_inicial_perfil WHERE modelo_pagina_inicial_id = ? AND excluido_em IS NULL ORDER BY perfil_acesso_id',
      [r.id],
    );
    expect(ligados.map((x) => Number(x['perfil_acesso_id']))).toEqual(
      [m.perfil, m.perfilOutro].sort((a, b) => a - b),
    );
  });
});
