// Integração da porta própria da rouparia contra o MariaDB real (cliente f22_o2, já criado pela obra da onda 2). Massa
// SINTÉTICA com códigos "L0214" (nenhuma pessoa real). Contrato de efeito de cada gravação: o documento no modelo, a
// versão, a trilha da operação e as recusas (versão antiga, chave de outro movimento, envio já retornado, outro
// estabelecimento, inventário e kit aguardando o modelo). A mesma bateria do movimento roda na memória e no banco.
// No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário de teste, que a trilha (só inclusão)
// referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { ContextoRouparia, MovimentoRoupaNovo, PortaRouparia } from './porta.js';
import { PortaRoupariaMemoria } from './porta-memoria.js';
import { documentoDoMovimento, PortaRoupariaPropria, relogioNoFuso } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0214';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const codigoDe = (e: unknown): string | null =>
  e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : e instanceof Error ? e.message : null;
const erroDe = (p: Promise<unknown>) => p.then(() => null, codigoDe);

function movimento(
  x: Partial<MovimentoRoupaNovo> & Pick<MovimentoRoupaNovo, 'tipo' | 'data'>,
): MovimentoRoupaNovo {
  return {
    chave: `t0214-${randomUUID()}`,
    centroCusto: null,
    remessa: null,
    pesoKg: null,
    itens: [],
    lavanderia: null,
    fornecedor: null,
    motivoPerda: null,
    observacao: null,
    diferencaKg: null,
    diferencaPct: null,
    ocorrencia: false,
    ...x,
  };
}

describe.skipIf(SEM_BANCO)('porta própria da rouparia (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRoupariaPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    setor: 0,
    setorInativo: 0,
    lavanderia: 0,
    peca: 0,
    peca2: 0,
  };
  let ctx: ContextoNucleo;
  let outro: ContextoNucleo;
  let hoje = '';
  const trilha = (entidade: string): TrilhaDaGravacao => ({
    estabelecimento: ctx.estabelecimento,
    usuario: ctx.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste-0214' },
    correlacao: ctx.correlacao,
  });
  const contarTrilha = () =>
    nucleo.lerSomente(ctx, async (l) =>
      Number(
        (await l.uma('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [ctx.correlacao]))?.[
          'n'
        ],
      ),
    );
  const linha = (sql: string, p: unknown[]) => nucleo.lerSomente(ctx, (l) => l.uma(sql, p));

  const limpar = (e: Escritor) =>
    (async () => {
      const est = [ids.est, ids.outroEst];
      await e.executar(
        'DELETE i FROM retorno_lavanderia_item i JOIN retorno_lavanderia r ON r.id = i.retorno_lavanderia_id WHERE r.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM retorno_lavanderia WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM remessa_lavanderia WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM coleta_roupa_suja WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE i FROM distribuicao_enxoval_item i JOIN distribuicao_enxoval d ON d.id = i.distribuicao_enxoval_id WHERE d.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM distribuicao_enxoval WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE bi FROM baixa_enxoval_item bi JOIN baixa_enxoval b ON b.id = bi.baixa_enxoval_id WHERE b.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM baixa_enxoval WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar('DELETE FROM cota_enxoval_setor WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar("DELETE FROM peca_enxoval WHERE codigo LIKE 'PE-%' AND descricao LIKE ?", [`% ${P}%`]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-14' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0214.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0214.teste', 'USUARIO SINTETICO L0214', agora],
      );
      const setor = (codigo: string, ativo: boolean) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, codigo],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, ativo, data_inativacao, criado_em) VALUES (?, ?, ?, 'assistencial', ?, ?, ?)",
          [ids.est, codigo, `SETOR ${codigo} SINTETICO`, ativo, ativo ? null : '2026-01-01', agora],
        );
      ids.setor = await setor(`${P}-UTI`, true);
      ids.setorInativo = await setor(`${P}-OFF`, false);
      const empresa = await garantir(
        e,
        'SELECT id FROM empresa_fornecedora WHERE razao_social = ?',
        [`LAVANDERIA ${P} SINTETICA`],
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', '00000000021400', ?, ?)",
        [`LAVANDERIA ${P} SINTETICA`, agora],
      );
      ids.lavanderia = await garantir(
        e,
        'SELECT id FROM lavanderia_externa WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, `LAVANDERIA ${P}`],
        "INSERT INTO lavanderia_externa (estabelecimento_id, nome, tipo, empresa_fornecedora_id, criado_em) VALUES (?, ?, 'terceirizada', ?, ?)",
        [ids.est, `LAVANDERIA ${P}`, empresa, agora],
      );
      await garantir(
        e,
        "SELECT id FROM motivo_baixa_enxoval WHERE codigo = 'extravio'",
        [],
        "INSERT INTO motivo_baixa_enxoval (codigo, descricao, categoria, criado_em) VALUES ('extravio', 'EXTRAVIO', 'extravio', ?)",
        [agora],
      );
      await limpar(e);
    });
    ctx = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `t0214-${randomUUID()}`,
    };
    outro = { ...ctx, estabelecimento: ids.outroEst };
    porta = new PortaRoupariaPropria(nucleo);
    hoje = (await porta.relogio(ctx)).hoje;
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo
        .escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-14' }, limpar)
        .catch(() => undefined);
      await nucleo.encerrar();
    }
  });

  it('o relógio no fuso do estabelecimento e os setores com o inativo marcado', async () => {
    expect(relogioNoFuso('America/Sao_Paulo', new Date('2026-10-28T12:00:00Z'))).toEqual({
      hoje: '2026-10-28',
      agora: '2026-10-28T09:00:00',
    });
    const setores = await porta.setores(ctx);
    expect(setores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: ids.setor, ativo: true }),
        expect.objectContaining({ codigo: ids.setorInativo, ativo: false }),
      ]),
    );
    expect(await porta.fornecedores(ctx, 'LAVANDERIA')).toEqual([
      { codigo: ids.lavanderia, nome: `LAVANDERIA ${P}` },
    ]);
    expect(await porta.fornecedorExiste(ctx, ids.lavanderia)).toBe(true);
    expect(await porta.fornecedorExiste(outro, ids.lavanderia)).toBe(false);
  });

  it('a peça do enxoval: inclusão com código de negócio, alteração pela versão; a versão antiga e o kit recusam', async () => {
    const antes = await contarTrilha();
    const peca = {
      nome: `LENCOL ${P}`,
      categoria: 'lencol' as const,
      pesoGramas: 600,
      custoReposicaoCentavos: 3550,
      composicao: [],
      ativa: true,
    };
    const r = await porta.gravarSgh(ctx, trilha('peca_enxoval'), (g) => g.incluirPeca(peca));
    ids.peca = r.id;
    expect(r.versao).toBe(1);
    const l = await linha(
      'SELECT codigo, descricao, categoria, custo_unitario, versao, criado_por FROM peca_enxoval WHERE id = ?',
      [r.id],
    );
    expect(l).toMatchObject({
      descricao: `LENCOL ${P}`,
      categoria: 'lencol',
      versao: 1,
      criado_por: ids.usuario,
    });
    expect(String(l?.['codigo'])).toMatch(/^PE-\d+$/);
    expect(Number(l?.['custo_unitario'])).toBe(35.5);
    expect(await contarTrilha()).toBe(antes + 1);
    const alt = await porta.gravarSgh(ctx, trilha('peca_enxoval'), (g) =>
      g.alterarPeca({ ...peca, pesoGramas: 650, id: r.id, versaoVista: 1 }),
    );
    expect(alt.versao).toBe(2);
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('peca_enxoval'), (g) =>
          g.alterarPeca({ ...peca, id: r.id, versaoVista: 1 }),
        ),
      ),
    ).toBe('conflito-versao');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('peca_enxoval'), (g) =>
          g.incluirPeca({
            ...peca,
            nome: `KIT ${P}`,
            categoria: 'kit',
            composicao: [{ peca: r.id, quantidade: 2 }],
          }),
        ),
      ),
    ).toBe('modelo-pendente');
    const p2 = await porta.gravarSgh(ctx, trilha('peca_enxoval'), (g) =>
      g.incluirPeca({ ...peca, nome: `FRONHA ${P}`, categoria: 'fronha', pesoGramas: 150 }),
    );
    ids.peca2 = p2.id;
    const pecas = await porta.pecas(ctx);
    expect(pecas.find((x) => x.id === r.id)).toMatchObject({
      pesoGramas: 650,
      versao: 2,
      custoReposicaoCentavos: 3550,
    });
  });

  it('as cotas do setor por vigência: a nova, a mudança no mesmo dia, o zero que desliga e a volta no mesmo dia', async () => {
    const gravar = (quantidade: number) =>
      porta.gravarSgh(ctx, trilha('cota_enxoval_setor'), (g) =>
        g.gravarCotas({ centroCusto: ids.setor, cotas: [{ peca: ids.peca, quantidade }] }),
      );
    expect(await gravar(10)).toEqual({ alteradas: 1 });
    expect(await gravar(10)).toEqual({ alteradas: 0 });
    expect(await gravar(12)).toEqual({ alteradas: 1 });
    expect(await porta.cotas(ctx, ids.setor)).toEqual([
      { centroCusto: ids.setor, peca: ids.peca, quantidade: 12, versao: 2 },
    ]);
    const l = await linha('SELECT COUNT(*) AS n FROM cota_enxoval_setor WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    expect(Number(l?.['n'])).toBe(1);
    expect(await porta.cotas(outro)).toEqual([]);
    // Zerar desliga a cota de hoje; pôr de novo no mesmo dia religa a mesma linha (sem violar a chave única).
    expect(await gravar(0)).toEqual({ alteradas: 1 });
    expect(await porta.cotas(ctx, ids.setor)).toEqual([]);
    expect(await gravar(12)).toEqual({ alteradas: 1 });
    expect(await porta.cotas(ctx, ids.setor)).toEqual([
      { centroCusto: ids.setor, peca: ids.peca, quantidade: 12, versao: 4 },
    ]);
    const l2 = await linha('SELECT COUNT(*) AS n FROM cota_enxoval_setor WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    expect(Number(l2?.['n'])).toBe(1);
  });

  it('a coleta: o documento, a repetição pela chave e a chave de outro movimento', async () => {
    const m = movimento({
      tipo: 'coleta',
      data: hoje,
      centroCusto: ids.setor,
      pesoKg: 12.5,
      itens: [{ peca: ids.peca, quantidade: 4 }],
    });
    const pedido: ContextoRouparia = {
      ...ctx,
      pedido: { chave: m.chave, impressao: `coleta:${hoje}:${ids.setor}` },
    };
    const r = await porta.gravarSgh(pedido, trilha('coleta_roupa_suja'), async (g) => ({
      ...(await g.registrarMovimento(m)),
      repetida: false,
    }));
    expect(documentoDoMovimento(r.id)?.tipo).toBe('coleta');
    const doc = await linha(
      'SELECT peso_kg, quantidade_pecas, situacao, responsavel_usuario_id FROM coleta_roupa_suja WHERE id = ?',
      [documentoDoMovimento(r.id)!.id],
    );
    expect(doc).toMatchObject({
      quantidade_pecas: 4,
      situacao: 'registrada',
      responsavel_usuario_id: ids.usuario,
    });
    expect(Number(doc?.['peso_kg'])).toBe(12.5);
    const de = await porta.gravarSgh(pedido, trilha('coleta_roupa_suja'), async (g) => ({
      ...(await g.registrarMovimento(m)),
      repetida: false,
    }));
    expect(de).toEqual({ ...r, repetida: true });
    expect(
      await erroDe(
        porta.gravarSgh({ ...ctx, pedido: { chave: m.chave, impressao: 'entrega:x' } }, trilha('x'), (g) =>
          g.registrarMovimento(m),
        ),
      ),
    ).toBe('chave-de-outro-movimento');
    const lido = await porta.movimento(ctx, r.id);
    expect(lido).toMatchObject({
      tipo: 'coleta',
      centroCusto: ids.setor,
      pesoKg: 12.5,
      pecas: 4,
      por: 'l0214.teste',
      situacao: 'registrado',
    });
    expect(await porta.movimento(outro, r.id)).toBeNull();
    expect(await porta.kgPorSetorDia(ctx, hoje, hoje)).toEqual([
      { data: hoje, centroCusto: ids.setor, kg: 12.5, coletas: 1 },
    ]);
  });

  it('envio → retorno com as peças e a diferença; o segundo retorno recusa; o cancelamento devolve o envio', async () => {
    const env = await porta.gravarSgh(ctx, trilha('remessa_lavanderia'), (g) =>
      g.registrarMovimento(
        movimento({
          tipo: 'envio',
          data: hoje,
          pesoKg: 100,
          lavanderia: 'terceirizada',
          fornecedor: ids.lavanderia,
        }),
      ),
    );
    expect((await porta.enviosAbertos(ctx)).map((x) => x.id)).toEqual([env.id]);
    const remessa = await linha(
      'SELECT numero, situacao, lavanderia_externa_id FROM remessa_lavanderia WHERE id = ?',
      [documentoDoMovimento(env.id)!.id],
    );
    expect(remessa).toMatchObject({ situacao: 'registrado', lavanderia_externa_id: ids.lavanderia });
    expect(Number(remessa?.['numero'])).toBeGreaterThan(0);
    const ret = await porta.gravarSgh(ctx, trilha('retorno_lavanderia'), (g) =>
      g.registrarMovimento(
        movimento({
          tipo: 'retorno',
          data: hoje,
          remessa: env.id,
          pesoKg: 90,
          itens: [{ peca: ids.peca, quantidade: 3 }],
          diferencaKg: 10,
          diferencaPct: 10,
          ocorrencia: true,
        }),
      ),
    );
    const lido = await porta.movimento(ctx, ret.id);
    expect(lido).toMatchObject({
      tipo: 'retorno',
      remessa: env.id,
      pesoKg: 90,
      diferencaKg: 10,
      diferencaPct: 10,
      ocorrencia: true,
    });
    expect(lido?.itens).toEqual([{ peca: ids.peca, quantidade: 3 }]);
    expect((await porta.movimento(ctx, env.id))?.situacao).toBe('retornado');
    expect(await porta.enviosAbertos(ctx)).toEqual([]);
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('retorno_lavanderia'), (g) =>
          g.registrarMovimento(movimento({ tipo: 'retorno', data: hoje, remessa: env.id, pesoKg: 1 })),
        ),
      ),
    ).toBe('remessa-ja-retornada');
    const totais = await porta.totais(ctx, hoje, hoje);
    expect(totais).toMatchObject({ kgEnviados: 100, kgRetornados: 90, retornos: 1, ocorrencias: 1 });
    // Cancelamento do retorno pela versão; a versão antiga recusa.
    const c = await porta.gravarSgh(ctx, trilha('retorno_lavanderia'), (g) =>
      g.cancelarMovimento({ id: ret.id, versaoVista: 1, motivo: 'RETORNO LANCADO ERRADO', remessa: env.id }),
    );
    expect(c.versao).toBe(2);
    const cancelado = await porta.movimento(ctx, ret.id);
    expect(cancelado).toMatchObject({
      situacao: 'cancelado',
      motivoCancelamento: 'RETORNO LANCADO ERRADO',
      canceladoPor: 'l0214.teste',
    });
    expect((await porta.movimento(ctx, env.id))?.situacao).toBe('registrado');
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('coleta_roupa_suja'), (g) =>
          g.cancelarMovimento({ id: env.id, versaoVista: 1, motivo: 'VERSAO ANTIGA', remessa: null }),
        ),
      ),
    ).toBe('conflito-versao');
    // O envio com retorno cancelado não aceita outro retorno (um por envio no modelo): recusa de negócio, sem estourar a
    // restrição; o envio pode ser cancelado e lançado de novo.
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('retorno_lavanderia'), (g) =>
          g.registrarMovimento(movimento({ tipo: 'retorno', data: hoje, remessa: env.id, pesoKg: 90 })),
        ),
      ),
    ).toBe('remessa-com-retorno-cancelado');
    const envAtual = await porta.movimento(ctx, env.id);
    const ce = await porta.gravarSgh(ctx, trilha('remessa_lavanderia'), (g) =>
      g.cancelarMovimento({
        id: env.id,
        versaoVista: envAtual!.versao,
        motivo: 'ENVIO REFEITO',
        remessa: null,
      }),
    );
    expect(ce.versao).toBe(envAtual!.versao + 1);
    expect(await porta.enviosAbertos(ctx)).toEqual([]);
  });

  it('a entrega com a cota vigente, a perda por peça com o motivo; o inventário aguarda o modelo', async () => {
    const ent = await porta.gravarSgh(ctx, trilha('distribuicao_enxoval'), (g) =>
      g.registrarMovimento(
        movimento({
          tipo: 'entrega',
          data: hoje,
          centroCusto: ids.setor,
          itens: [{ peca: ids.peca, quantidade: 8 }],
        }),
      ),
    );
    const item = await linha(
      'SELECT quantidade_cota, quantidade_entregue FROM distribuicao_enxoval_item WHERE distribuicao_enxoval_id = ?',
      [documentoDoMovimento(ent.id)!.id],
    );
    expect(item).toEqual({ quantidade_cota: 12, quantidade_entregue: 8 });
    expect((await porta.movimento(ctx, ent.id))?.pecas).toBe(8);
    const per = await porta.gravarSgh(ctx, trilha('baixa_enxoval'), (g) =>
      g.registrarMovimento(
        movimento({
          tipo: 'perda',
          data: hoje,
          centroCusto: ids.setor,
          motivoPerda: 'extravio',
          itens: [{ peca: ids.peca, quantidade: 2 }],
        }),
      ),
    );
    // A perda é um documento só: a de várias peças aguarda os itens da baixa no modelo (nada gravado).
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('baixa_enxoval'), (g) =>
          g.registrarMovimento(
            movimento({
              tipo: 'perda',
              data: hoje,
              centroCusto: ids.setor,
              motivoPerda: 'extravio',
              itens: [
                { peca: ids.peca, quantidade: 2 },
                { peca: ids.peca2, quantidade: 1 },
              ],
            }),
          ),
        ),
      ),
    ).toBe('modelo-pendente');
    const baixas = await nucleo.lerSomente(ctx, (l) =>
      l.consultar(
        `SELECT b.numero, bi.quantidade, bi.custo_estimado FROM baixa_enxoval b
           JOIN baixa_enxoval_item bi ON bi.baixa_enxoval_id = b.id WHERE b.estabelecimento_id = ? ORDER BY b.id`,
        [ids.est],
      ),
    );
    expect(baixas).toHaveLength(1);
    expect(Number(baixas[0]?.['custo_estimado'])).toBe(71);
    expect(await porta.movimento(ctx, per.id)).toMatchObject({
      tipo: 'perda',
      motivoPerda: 'extravio',
      pecas: 2,
    });
    expect((await porta.totais(ctx, hoje, hoje)).pecasPerdidas).toBe(2);
    // O cancelamento da perda desfaz o documento inteiro.
    const cp = await porta.gravarSgh(ctx, trilha('baixa_enxoval'), (g) =>
      g.cancelarMovimento({ id: per.id, versaoVista: 1, motivo: 'PERDA ERRADA', remessa: null }),
    );
    expect(cp.versao).toBe(2);
    expect((await porta.totais(ctx, hoje, hoje)).pecasPerdidas).toBe(0);
    expect(
      await erroDe(
        porta.gravarSgh(ctx, trilha('x'), (g) =>
          g.registrarMovimento(
            movimento({ tipo: 'inventario', data: hoje, itens: [{ peca: ids.peca, quantidade: 0 }] }),
          ),
        ),
      ),
    ).toBe('modelo-pendente');
    const lista = await porta.movimentos(ctx, { de: hoje, ate: hoje, teto: 2 });
    expect(lista.itens).toHaveLength(2);
    expect(lista.cortada).toBe(true);
    expect(
      (await porta.movimentos(ctx, { de: hoje, ate: hoje, tipo: 'perda' })).itens.map((x) => x.tipo),
    ).toEqual(['perda']);
    expect((await porta.movimentos(outro, { de: hoje, ate: hoje })).itens).toEqual([]);
  });

  it('a lista em ordem cronológica entre tabelas (ids cruzados) e a paginação pelo cursor composto', async () => {
    // Uma coleta de ontem com id alto (vinda depois) não passa à frente do envio de hoje.
    const ontem = new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    for (let k = 0; k < 3; k++)
      await porta.gravarSgh(ctx, trilha('coleta_roupa_suja'), (g) =>
        g.registrarMovimento(movimento({ tipo: 'coleta', data: ontem, centroCusto: ids.setor, pesoKg: 1 })),
      );
    const todos = (await porta.movimentos(ctx, { de: ontem, ate: hoje, teto: 1000 })).itens;
    expect(todos.length).toBeGreaterThan(5);
    const chave = (x: { em: string; id: number }) => [x.em, x.id] as const;
    for (let k = 1; k < todos.length; k++) {
      const [ea, ia] = chave(todos[k - 1]!);
      const [eb, ib] = chave(todos[k]!);
      expect(ea > eb || (ea === eb && ia > ib)).toBe(true);
    }
    expect(todos.at(-1)?.data).toBe(ontem);
    expect(todos[0]?.data).toBe(hoje);
    // Paginação de 2 em 2 percorre tudo, na mesma ordem, sem repetir nem perder.
    const paginado: number[] = [];
    let antesDe: number | undefined;
    for (;;) {
      const pg = await porta.movimentos(ctx, {
        de: ontem,
        ate: hoje,
        teto: 2,
        ...(antesDe ? { antesDe } : {}),
      });
      paginado.push(...pg.itens.map((x) => x.id));
      if (!pg.cortada) break;
      antesDe = pg.itens.at(-1)!.id;
    }
    expect(paginado).toEqual(todos.map((x) => x.id));
  });

  it('a mesma bateria da perda (um documento com a peça) vale na memória e no banco', async () => {
    const portas: PortaRouparia[] = [
      new PortaRoupariaMemoria(() => ({ hoje, agora: `${hoje}T09:00:00` })),
      porta,
    ];
    for (const p of portas) {
      const peca = p === porta ? ids.peca : 1;
      const r = await p.gravarSgh(ctx, trilha('baixa_enxoval'), (g) =>
        g.registrarMovimento(
          movimento({
            tipo: 'perda',
            data: hoje,
            centroCusto: p === porta ? ids.setor : 9101,
            motivoPerda: 'extravio',
            itens: [{ peca, quantidade: 3 }],
          }),
        ),
      );
      expect(await p.movimento(ctx, r.id)).toMatchObject({
        tipo: 'perda',
        motivoPerda: 'extravio',
        pecas: 3,
        itens: [{ peca, quantidade: 3 }],
        situacao: 'registrado',
      });
      const antes = (await p.totais(ctx, hoje, hoje)).pecasPerdidas;
      await p.gravarSgh(ctx, trilha('baixa_enxoval'), (g) =>
        g.cancelarMovimento({ id: r.id, versaoVista: 1, motivo: 'PERDA ERRADA', remessa: null }),
      );
      expect((await p.movimento(ctx, r.id))?.situacao).toBe('cancelado');
      expect((await p.totais(ctx, hoje, hoje)).pecasPerdidas).toBe(antes - 3);
    }
  });

  it('a mesma bateria da repetição pela chave vale na memória', async () => {
    const portas: PortaRouparia[] = [
      new PortaRoupariaMemoria(() => ({ hoje, agora: `${hoje}T09:00:00` })),
      porta,
    ];
    for (const p of portas) {
      const m = movimento({
        tipo: 'coleta',
        data: hoje,
        centroCusto: p === porta ? ids.setor : 9101,
        pesoKg: 1,
      });
      const c: ContextoRouparia = { ...ctx, pedido: { chave: m.chave, impressao: 'coleta' } };
      const a = await p.gravarSgh(c, trilha('coleta_roupa_suja'), async (g) => ({
        ...(await g.registrarMovimento(m)),
        repetida: false,
      }));
      const b = await p.gravarSgh(c, trilha('coleta_roupa_suja'), async (g) => ({
        ...(await g.registrarMovimento(m)),
        repetida: false,
      }));
      expect(b).toEqual({ ...a, repetida: true });
      expect(
        await erroDe(
          p.gravarSgh({ ...ctx, pedido: { chave: m.chave, impressao: 'outra' } }, trilha('x'), (g) =>
            g.registrarMovimento(m),
          ),
        ),
      ).toBe('chave-de-outro-movimento');
    }
  });
});
