// Contrato de efeito do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6) na porta própria contra o MariaDB real
// (cliente de teste do lote; massa SINTÉTICA, nenhuma pessoa real): o item gravado inteiro (filhos pela chave natural,
// o que sai é excluído ou inativado), inativação recusada com saldo; o local com classificação, inativação recusada
// com saldo; o escopo do usuário por local (retirado fica marcado, sem ação) e as concessões com vigência (retirar
// fecha a vigência, o histórico fica); a lista de separação na ordem do endereço com os lotes pela validade; recusas
// sem gravar e a trilha na mesma transação. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaCadastroEstoquePropria } from './cadastro-estoque-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

const MARCA = `F361${Date.now().toString(36)}`.toUpperCase().slice(0, 14);

describe.skipIf(SEM_BANCO)('cadastro do estoque na porta própria (MariaDB, cliente de teste)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCadastroEstoquePropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let via1 = 0;
  let via2 = 0;
  let pa1 = 0;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f361' }, (l) => l.consultar<T>(sql, p));
  const um = async (sql: string, p: unknown[]) => (await ler<Record<string, unknown>>(sql, p))[0] ?? null;

  const item = (x: Record<string, unknown> = {}) =>
    ({
      codigo: `${MARCA}A`,
      nome: `${MARCA} Dipirona 500 mg`,
      tipo: 'medicamento',
      grupo: m.grupo,
      unidadeEstoque: m.unidade,
      unidadeCompra: m.unidade,
      fatorCompraEstoque: 1,
      fatorEstoqueConsumo: 1,
      fatorConsumoPrescricao: 1,
      gtin: '7891234567895',
      ncm: '30049099',
      controlaLote: true,
      controlaValidade: true,
      controlado: false,
      antimicrobiano: false,
      altaVigilancia: false,
      fracionavel: false,
      prescritivel: true,
      principiosAtivos: [{ principio: pa1, concentracao: 500, unidade: m.unidade, principal: true }],
      vias: [{ via: via1, padrao: true }, { via: via2 }],
      codigosBarras: [{ codigo: '7891234567895', padrao: 'gtin', quantidade: 1, unidade: m.unidade }],
      apresentacoes: [
        {
          nomeComercial: `${MARCA} Marca`,
          quantidadeEmbalagem: 10,
          registro: { numero: '123456789', validade: '2020-01-01', situacao: 'valido' },
        },
      ],
      estabilidades: [{ condicao: 'aberto', horas: 24 }],
      ...x,
    }) as Parameters<PortaCadastroEstoquePropria['incluirItem']>[1];

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaCadastroEstoquePropria(nucleo);
    c = contexto(m, m.estA, 't-f361') as ContextoPortaM18;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f361-massa' }, async (e) => {
      via1 = await inserirMinimo(e, 'via_de_uso', { codigo: `${MARCA}V1` }, MARCA);
      via2 = await inserirMinimo(e, 'via_de_uso', { codigo: `${MARCA}V2` }, MARCA);
      pa1 = await inserirMinimo(e, 'principio_ativo', { descricao: `${MARCA} PRINCIPIO` }, MARCA);
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    const like = `${MARCA}%`;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f361-limpa' }, async (e) => {
      const ins = 'SELECT id FROM insumo WHERE codigo LIKE ?';
      await e.executar(
        `DELETE FROM registro_sanitario WHERE apresentacao_comercial_id IN (SELECT id FROM apresentacao_comercial WHERE insumo_id IN (${ins}))`,
        [like],
      );
      for (const t of [
        'apresentacao_comercial',
        'insumo_principio_ativo',
        'insumo_via',
        'insumo_codigo_barras',
        'estabilidade_insumo',
      ])
        await e.executar(`DELETE FROM ${t} WHERE insumo_id IN (${ins})`, [like]);
      await e.executar(
        `DELETE FROM insumo_endereco WHERE endereco_armazem_id IN (SELECT id FROM endereco_armazem WHERE codigo LIKE ?)`,
        [like],
      );
      await e.executar('DELETE FROM endereco_armazem WHERE codigo LIKE ?', [like]);
      const locs = 'SELECT id FROM local_estoque WHERE codigo LIKE ?';
      await e.executar(
        `DELETE FROM local_estoque_classificacao WHERE local_estoque_id IN (${locs}) OR insumo_id IN (${ins})`,
        [like, like],
      );
      await e.executar(`DELETE FROM local_estoque_setor WHERE local_estoque_id IN (${locs})`, [like]);
      await e.executar(`DELETE FROM local_estoque_usuario WHERE local_estoque_id IN (${locs})`, [like]);
      await e.executar(
        'DELETE FROM usuario_estoque_classificacao WHERE usuario_id = ? AND grupo_insumo_id = ?',
        [m.usuario, m.grupo],
      );
      await e.executar(
        'DELETE FROM usuario_estoque_centro_custo WHERE usuario_id = ? AND centro_custo_id = ?',
        [m.usuario, m.centroCusto],
      );
      await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [like]);
      await e.executar('DELETE FROM via_de_uso WHERE codigo LIKE ?', [like]);
      await e.executar('DELETE FROM principio_ativo WHERE descricao LIKE ?', [like]);
    });
    await e2eLocal();
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });
  const e2eLocal = async () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f361-limpa2' }, (e) =>
      e.executar('DELETE FROM local_estoque WHERE codigo LIKE ?', [`${MARCA}%`]),
    );

  it('item: inclui inteiro, altera pela chave natural, recusa sem gravar e não inativa com saldo', async () => {
    expect(await codigoDe(porta.incluirItem(c, item({ principiosAtivos: [] })))).toBe('item-sem-principio');
    expect(await um('SELECT id FROM insumo WHERE codigo = ?', [`${MARCA}A`])).toBeNull();

    const { id } = await porta.incluirItem(c, item());
    const f = await porta.fichaItem(c, id);
    expect(f).toMatchObject({
      codigo: `${MARCA}A`,
      tipo: 'medicamento',
      situacao: 'ativo',
      versao: 1,
      saldoTotal: 0,
    });
    expect(f!.vias.map((v) => [v.via, v.padrao])).toEqual([
      [via1, true],
      [via2, false],
    ]);
    expect(f!.apresentacoes[0]!.registro).toMatchObject({ numero: '123456789', situacao: 'valido' });
    expect(f!.registrosNaData).toEqual(['vencido']);
    expect(f!.nomesPrincipios[pa1]).toBe(`${MARCA} PRINCIPIO`);
    const trilha = await um(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'insumo' AND entidade_id = ?",
      [id],
    );
    expect(Number(trilha?.['q'])).toBeGreaterThan(0);

    expect(await codigoDe(porta.incluirItem(c, item({ nome: 'outro' })))).toBe('item-codigo-existente');

    // Tira a via 2, troca a apresentação e a estabilidade: a via sai, a apresentação e a estabilidade antigas ficam inativas.
    const v2 = await porta.alterarItem(
      c,
      id,
      1,
      item({
        vias: [{ via: via1, padrao: true }],
        apresentacoes: [{ nomeComercial: `${MARCA} Outra`, quantidadeEmbalagem: 20 }],
        estabilidades: [{ condicao: 'diluido', horas: 6 }],
      }),
    );
    expect(v2.versao).toBe(2);
    expect(await ler('SELECT via_de_uso_id FROM insumo_via WHERE insumo_id = ?', [id])).toEqual([
      { via_de_uso_id: via1 },
    ]);
    const aps = await ler<{ nome_comercial: string; ativo: unknown }>(
      'SELECT nome_comercial, ativo FROM apresentacao_comercial WHERE insumo_id = ? ORDER BY id',
      [id],
    );
    expect(aps.map((a) => [a.nome_comercial, Number(a.ativo)])).toEqual([
      [`${MARCA} Marca`, 0],
      [`${MARCA} Outra`, 1],
    ]);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS q FROM registro_sanitario rs JOIN apresentacao_comercial a ON a.id = rs.apresentacao_comercial_id WHERE a.insumo_id = ?',
            [id],
          )
        )?.['q'],
      ),
    ).toBe(1);
    expect(
      (
        await ler<{ condicao: string; ativo: unknown }>(
          'SELECT condicao, ativo FROM estabilidade_insumo WHERE insumo_id = ? ORDER BY id',
          [id],
        )
      ).map((x) => [x.condicao, Number(x.ativo)]),
    ).toEqual([
      ['aberto', 0],
      ['diluido', 1],
    ]);
    // Versão velha: conflito, nada muda.
    expect(await codigoDe(porta.alterarItem(c, id, 1, item({ nome: `${MARCA} X` })))).not.toBe('ok');

    // O código de barras de outro item é recusado.
    expect(await codigoDe(porta.incluirItem(c, item({ codigo: `${MARCA}B`, gtin: null })))).toBe(
      'codigo-barras-de-outro-item',
    );

    // Inativar: sem motivo recusa; o item da massa com saldo recusa; o novo (sem saldo) inativa e nada é apagado.
    expect(await codigoDe(porta.situacaoItem(c, id, 2, false, ''))).toBe('inativar-sem-motivo');
    const massa = await um('SELECT versao FROM insumo WHERE id = ?', [m.insumo]);
    expect(
      await codigoDe(porta.situacaoItem(c, m.insumo, Number(massa!['versao']), false, 'Fora de linha')),
    ).toBe('inativar-com-saldo');
    await porta.situacaoItem(c, id, 2, false, 'Fora de linha');
    expect(await um('SELECT situacao, excluido_em FROM insumo WHERE id = ?', [id])).toMatchObject({
      situacao: 'inativo',
      excluido_em: null,
    });
  }, 60_000);

  it('local: inclui com classificação, altera, e não inativa com saldo', async () => {
    const base = {
      codigo: `${MARCA}L`,
      nome: `${MARCA} Farmácia satélite`,
      tipo: 'farmacia_satelite' as const,
      centroCusto: m.centroCusto,
      localOrigem: m.localA,
      atendeSetor: true,
      atendePaciente: true,
      atendeTransferencia: false,
      atendimentoParcial: true,
      verificaSaldo: true,
      usaCodigoBarras: true,
      apenasUrgente: false,
      tipoReposicao: 'ponto_pedido' as const,
      setores: [],
      classificacoes: [{ grupo: m.grupo }],
    };
    expect(await codigoDe(porta.incluirLocal(c, { ...base, localOrigem: null }))).toBe(
      'local-reposicao-sem-origem',
    );
    const { id } = await porta.incluirLocal(c, base);
    expect(
      await um(
        'SELECT estabelecimento_id, tipo, origem_local_estoque_id, ativo FROM local_estoque WHERE id = ?',
        [id],
      ),
    ).toMatchObject({
      estabelecimento_id: m.estA,
      tipo: 'farmacia_satelite',
      origem_local_estoque_id: m.localA,
    });
    expect(
      await ler(
        'SELECT grupo_insumo_id FROM local_estoque_classificacao WHERE local_estoque_id = ? AND excluido_em IS NULL',
        [id],
      ),
    ).toEqual([{ grupo_insumo_id: m.grupo }]);
    expect(await codigoDe(porta.alterarLocal(c, id, 1, { ...base, localOrigem: id }))).toBe('local-proprio');
    const v = await porta.alterarLocal(c, id, 1, {
      ...base,
      nome: `${MARCA} Satélite UTI`,
      classificacoes: [],
    });
    expect(v.versao).toBe(2);
    expect(await ler('SELECT id FROM local_estoque_classificacao WHERE local_estoque_id = ?', [id])).toEqual(
      [],
    );
    expect((await porta.fichaLocal(c, id))?.nome).toBe(`${MARCA} Satélite UTI`);
    // O local da massa tem saldo: a inativação é recusada.
    const la = await um('SELECT versao FROM local_estoque WHERE id = ?', [m.localA]);
    expect(await codigoDe(porta.situacaoLocal(c, m.localA, Number(la!['versao']), false, 'Desativado'))).toBe(
      'inativar-local-com-saldo',
    );
    await porta.situacaoLocal(c, id, 2, false, 'Desativado');
    expect(Number((await um('SELECT ativo FROM local_estoque WHERE id = ?', [id]))?.['ativo'])).toBe(0);
    // Outro estabelecimento não vê o local.
    expect(await porta.fichaLocal(contexto(m, m.estB, 't-f361b') as ContextoPortaM18, id)).toBeNull();
  }, 60_000);

  it('escopo do usuário: local concedido e retirado (marcado, sem ação), concessões com vigência', async () => {
    const { id: novo } = await porta.incluirLocal(c, {
      codigo: `${MARCA}E`,
      nome: `${MARCA} Posto`,
      tipo: 'posto',
      atendeSetor: true,
      atendePaciente: false,
      atendeTransferencia: false,
      atendimentoParcial: true,
      verificaSaldo: true,
      usaCodigoBarras: false,
      apenasUrgente: false,
      setores: [],
      classificacoes: [],
    });
    expect(await codigoDe(porta.gravarEscopoLocal(c, m.usuario, novo, { permissoes: [] }))).toBe(
      'escopo-vazio',
    );
    await porta.gravarEscopoLocal(c, m.usuario, novo, {
      permissoes: ['requisitar', 'atender'],
      padrao: false,
    });
    let esc = await porta.escopoUsuario(c, m.usuario);
    expect(esc!.locais.find((l) => l.local === novo)?.permissoes).toEqual(['requisitar', 'atender']);
    await porta.retirarEscopoLocal(c, m.usuario, novo);
    const linha = await um(
      'SELECT pode_requisitar, pode_atender, excluido_em FROM local_estoque_usuario WHERE local_estoque_id = ? AND usuario_id = ?',
      [novo, m.usuario],
    );
    expect(Number(linha!['pode_requisitar']) + Number(linha!['pode_atender'])).toBe(0);
    expect(linha!['excluido_em']).not.toBeNull();
    esc = await porta.escopoUsuario(c, m.usuario);
    expect(esc!.locais.some((l) => l.local === novo)).toBe(false);
    // Conceder de novo reaproveita a linha.
    await porta.gravarEscopoLocal(c, m.usuario, novo, { permissoes: ['inventariar'] });
    expect(
      Number(
        (await um('SELECT COUNT(*) AS q FROM local_estoque_usuario WHERE local_estoque_id = ?', [novo]))?.[
          'q'
        ],
      ),
    ).toBe(1);

    const hoje = (await porta.apoio(c)).hoje;
    const { id: cl } = await porta.concederClassificacao(c, m.usuario, {
      grupo: m.grupo,
      inicio: '2026-01-01',
      requisitar: true,
      movimentar: false,
    });
    expect(
      await codigoDe(
        porta.concederClassificacao(c, m.usuario, {
          grupo: m.grupo,
          inicio: '2026-02-01',
          requisitar: true,
          movimentar: true,
        }),
      ),
    ).toBe('concessao-sobreposta');
    const r = await porta.retirarConcessao(c, 'classificacao', cl);
    expect(r.fim < hoje || r.fim === '2026-01-01').toBe(true);
    expect(
      await um('SELECT excluido_em FROM usuario_estoque_classificacao WHERE id = ?', [cl]),
    ).toMatchObject({ excluido_em: null });
    const { id: cc } = await porta.concederCentroCusto(c, m.usuario, {
      centroCusto: m.centroCusto,
      inicio: hoje,
      requisitar: true,
      movimentar: true,
    });
    esc = await porta.escopoUsuario(c, m.usuario);
    expect(esc!.centrosCusto.find((x) => x.id === cc)).toMatchObject({
      vigente: true,
      permissoes: ['requisitar', 'movimentar'],
    });
    expect(esc!.classificacoes.find((x) => x.id === cl)?.vigente).toBe(false);
  }, 60_000);

  it('lista de separação: só o que falta, endereço do local, lotes pela validade e a falta', async () => {
    const reqId = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f361-req' }, async (e) => {
      const end = await inserirMinimo(
        e,
        'endereco_armazem',
        {
          local_estoque_id: m.localA,
          nivel: 1,
          tipo_nivel: 'prateleira',
          codigo: `${MARCA}P1`,
          codigo_completo: `${MARCA}P1`,
        },
        MARCA,
      );
      await inserirMinimo(
        e,
        'insumo_endereco',
        { insumo_id: m.insumo, endereco_armazem_id: end, preferencial: true },
        MARCA,
      );
      const r = await inserirMinimo(
        e,
        'requisicao_material',
        {
          estabelecimento_id: m.estA,
          numero: 990_000 + Math.floor(Math.random() * 9_999),
          tipo: 'setor',
          atendente_local_estoque_id: m.localA,
          centro_custo_id: m.centroCusto,
          solicitante_usuario_id: m.usuario,
          situacao: 'autorizada',
        },
        MARCA,
      );
      await inserirMinimo(
        e,
        'requisicao_material_item',
        {
          requisicao_material_id: r,
          sequencia: 1,
          insumo_id: m.insumo,
          unidade_medida_id: m.unidade,
          quantidade_solicitada: 999_999,
          quantidade_atendida: 1,
        },
        MARCA,
      );
      return r;
    });
    const s = await porta.separacao(c, reqId);
    expect(s).toMatchObject({ requisicao: reqId, situacao: 'autorizada', local: { id: m.localA } });
    expect(s!.linhas).toHaveLength(1);
    const l = s!.linhas[0]!;
    expect(l).toMatchObject({ item: m.insumo, aSeparar: 999_998, endereco: `${MARCA}P1` });
    expect(l.falta).toBeGreaterThan(0);
    expect(s!.totalFalta).toBe(1);
    const validades = l.lotes.map((x) => x.validade);
    expect([...validades].sort()).toEqual(validades);
    expect(validades.every((v) => v >= s!.geradaEm.slice(0, 10))).toBe(true);
    // Outro estabelecimento não lê a requisição.
    expect(await porta.separacao(contexto(m, m.estB, 't-f361b') as ContextoPortaM18, reqId)).toBeNull();
  }, 60_000);
});
