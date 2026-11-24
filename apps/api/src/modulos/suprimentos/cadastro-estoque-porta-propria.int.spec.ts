// Contrato de efeito do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6) na porta própria contra o MariaDB real
// (cliente de teste do lote; massa SINTÉTICA, nenhuma pessoa real): o item gravado inteiro (filhos pela chave natural,
// o que sai é excluído ou inativado), inativação recusada com saldo; o local com classificação, inativação recusada
// com saldo; o item com saldo ou movimento não troca unidade, fator nem controle de lote; a estabilidade pela chave
// completa (condição, guarda e diluente) e o registro sanitário substituído cancelado; o escopo do usuário por local
// (retirado fica marcado, sem ação) e as concessões com vigência (retirar com motivo: a que já valia é encerrada, a de
// hoje ou futura é cancelada; retirar a última concessão de centro de custo recusa a requisição pelo escopo real das
// gravações); a lista de separação só da requisição atendível, com os lotes liberados e válidos pela validade e a
// falta exata; recusas sem gravar e a trilha na mesma transação. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaCadastroEstoquePropria } from './cadastro-estoque-porta-propria.js';
import { PortaSuprimentosPropria } from './porta-propria.js';
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
      // Lotes próprios da lista de separação: o saldo antes do bloqueio que ele referencia.
      await e.executar(
        'DELETE FROM saldo_lote WHERE lote_insumo_id IN (SELECT id FROM lote_insumo WHERE numero_lote LIKE ?)',
        [like],
      );
      await e.executar('DELETE FROM bloqueio_lote WHERE motivo LIKE ?', [like]);
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
        apresentacoes: [
          {
            nomeComercial: `${MARCA} Outra`,
            quantidadeEmbalagem: 20,
            registro: { numero: '987654321', validade: '2030-01-01', situacao: 'valido' },
          },
        ],
        estabilidades: [
          { condicao: 'diluido', horas: 6, diluente: m.insumoOpme },
          { condicao: 'diluido', horas: 4, diluente: m.insumoInativo },
        ],
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
    ).toBe(2);
    const estab = async () =>
      (
        await ler<{ condicao: string; diluente_insumo_id: unknown; ativo: unknown }>(
          'SELECT condicao, diluente_insumo_id, ativo FROM estabilidade_insumo WHERE insumo_id = ? ORDER BY id',
          [id],
        )
      ).map((x) => [x.condicao, Number(x.diluente_insumo_id ?? 0), Number(x.ativo)]);
    expect(await estab()).toEqual([
      ['aberto', 0, 0],
      ['diluido', m.insumoOpme, 1],
      ['diluido', m.insumoInativo, 1],
    ]);
    // Gravar de novo o mesmo item não inativa as estabilidades com diluente; trocar o registro cancela o anterior.
    await porta.alterarItem(
      c,
      id,
      2,
      item({
        vias: [{ via: via1, padrao: true }],
        apresentacoes: [
          {
            nomeComercial: `${MARCA} Outra`,
            quantidadeEmbalagem: 20,
            registro: { numero: '111222333', validade: '2031-01-01', situacao: 'valido' },
          },
        ],
        estabilidades: [
          { condicao: 'diluido', horas: 6, diluente: m.insumoOpme },
          { condicao: 'diluido', horas: 4, diluente: m.insumoInativo },
        ],
      }),
    );
    expect(await estab()).toEqual([
      ['aberto', 0, 0],
      ['diluido', m.insumoOpme, 1],
      ['diluido', m.insumoInativo, 1],
    ]);
    expect(
      (
        await ler<{ numero_registro: string; situacao: string }>(
          `SELECT rs.numero_registro, rs.situacao FROM registro_sanitario rs JOIN apresentacao_comercial a ON a.id = rs.apresentacao_comercial_id
            WHERE a.insumo_id = ? AND a.ativo = TRUE ORDER BY rs.sequencia`,
          [id],
        )
      ).map((x) => [x.numero_registro, x.situacao]),
    ).toEqual([
      ['987654321', 'cancelado'],
      ['111222333', 'valido'],
    ]);
    // Versão velha: conflito, nada muda.
    expect(await codigoDe(porta.alterarItem(c, id, 1, item({ nome: `${MARCA} X` })))).not.toBe('ok');

    // O código de barras de outro item é recusado.
    expect(await codigoDe(porta.incluirItem(c, item({ codigo: `${MARCA}B`, gtin: null })))).toBe(
      'codigo-barras-de-outro-item',
    );

    // Inativar: sem motivo recusa; o item da massa com saldo recusa; o novo (sem saldo) inativa e nada é apagado.
    expect(await codigoDe(porta.situacaoItem(c, id, 3, false, ''))).toBe('inativar-sem-motivo');
    const massa = await um('SELECT versao FROM insumo WHERE id = ?', [m.insumo]);
    // O item da massa tem saldo e lote: a unidade, o fator e o controle de lote não mudam (nada gravado).
    const travado = await codigoDe(
      porta.alterarItem(
        c,
        m.insumo,
        Number(massa!['versao']),
        item({
          codigo: `${MARCA}M`,
          codigosBarras: [],
          gtin: null,
          fatorEstoqueConsumo: 7,
          controlaLote: false,
        }),
      ),
    );
    expect(travado).toBe('item-com-uso-trava');
    expect(await um('SELECT versao FROM insumo WHERE id = ?', [m.insumo])).toMatchObject({
      versao: massa!['versao'],
    });
    expect(
      await codigoDe(porta.situacaoItem(c, m.insumo, Number(massa!['versao']), false, 'Fora de linha')),
    ).toBe('inativar-com-saldo');
    await porta.situacaoItem(c, id, 3, false, 'Fora de linha');
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
    expect(await codigoDe(porta.retirarConcessao(c, 'classificacao', cl, ''))).toBe('retirar-sem-motivo');
    // A que já valia é encerrada na véspera de hoje.
    const r = await porta.retirarConcessao(c, 'classificacao', cl, 'Mudou de função');
    expect(r.cancelada).toBe(false);
    expect(r.fim! < hoje).toBe(true);
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

    // Retirar a única concessão de centro de custo (começou hoje: cancelada na hora) não abre todos os centros: a
    // requisição para o centro é recusada pelo escopo que as gravações usam, e nada é gravado.
    const rc = await porta.retirarConcessao(c, 'centro-custo', cc, 'Saiu do setor');
    expect(rc).toMatchObject({ cancelada: true, fim: null });
    expect(
      await um('SELECT excluido_em IS NOT NULL AS cancelada FROM usuario_estoque_centro_custo WHERE id = ?', [
        cc,
      ]),
    ).toMatchObject({ cancelada: 1 });
    const suprimentos = new PortaSuprimentosPropria(nucleo);
    const requisicoes = async () =>
      Number(
        (await um('SELECT COUNT(*) AS q FROM requisicao_material WHERE estabelecimento_id = ?', [m.estA]))?.[
          'q'
        ],
      );
    const antes = await requisicoes();
    expect(
      await codigoDe(
        suprimentos.executar(
          c,
          'suprimentos.requisitarMaterial',
          {
            destino: 2,
            local: m.localA,
            centroCusto: m.centroCusto,
            localConsumo: 1,
            itens: [{ item: m.insumo, quantidade: 1 }],
          },
          { ...c, chaveIdempotencia: `k-${MARCA}-esc` },
        ),
      ),
    ).toBe('centro-fora-do-escopo');
    expect(await requisicoes()).toBe(antes);
    // A futura retirada é cancelada (nunca valeu); conceder de novo no mesmo início reaproveita a cancelada.
    const amanha = new Date(`${hoje}T12:00:00Z`);
    amanha.setUTCDate(amanha.getUTCDate() + 1);
    const ini = amanha.toISOString().slice(0, 10);
    const { id: fut } = await porta.concederCentroCusto(c, m.usuario, {
      centroCusto: m.centroCusto,
      inicio: ini,
      requisitar: true,
      movimentar: false,
    });
    expect(await porta.retirarConcessao(c, 'centro-custo', fut, 'Não vai mais')).toMatchObject({
      cancelada: true,
    });
    const { id: de } = await porta.concederCentroCusto(c, m.usuario, {
      centroCusto: m.centroCusto,
      inicio: ini,
      requisitar: true,
      movimentar: false,
    });
    expect(de).toBe(fut);
    expect(
      await um('SELECT excluido_em FROM usuario_estoque_centro_custo WHERE id = ?', [fut]),
    ).toMatchObject({
      excluido_em: null,
    });
  }, 60_000);

  it('apoio da tela: guardas e diluentes por lista, os mesmos do banco (soluções ativas)', async () => {
    const ap = await porta.apoio(c);
    const g = await um('SELECT COUNT(*) AS n FROM condicao_armazenamento WHERE ativo = TRUE', []);
    const d = await um(
      "SELECT COUNT(*) AS n FROM insumo WHERE tipo = 'solucao' AND situacao = 'ativo' AND excluido_em IS NULL",
      [],
    );
    expect(ap.guardas.length).toBe(Number(g?.['n']));
    expect(ap.diluentes.length).toBe(Number(d?.['n']));
    expect(ap.guardas.every((o) => o.id > 0 && o.nome !== '')).toBe(true);
  });

  it('lista de separação: só o que falta, endereço do local, lotes pela validade e a falta', async () => {
    const [reqId, reqCancelada] = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 't-f361-req' },
      async (e) => {
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
        // Lotes próprios do teste no local: vencido, bloqueado no local, recolhido e um válido que vence antes do da
        // massa (L1, 10 unidades, 2027-03-31). Só o válido e o L1 podem ser sugeridos.
        const lote = async (
          sufixo: string,
          validade: string,
          situacao: string,
          bloqueado: boolean,
          q: number,
        ) => {
          const li = await inserirMinimo(
            e,
            'lote_insumo',
            {
              estabelecimento_id: m.estA,
              insumo_id: m.insumo,
              numero_lote: `${MARCA}${sufixo}`,
              validade,
              situacao,
              // Lote recolhido ou bloqueado leva o motivo (ck_lote_insumo_bloqueio).
              ...(situacao === 'liberado' ? {} : { motivo_bloqueio: `${MARCA} recolhimento de teste` }),
            },
            MARCA,
          );
          // Saldo bloqueado no local exige o bloqueio registrado (ck_saldo_lote_bloqueio).
          const bloqueio = bloqueado
            ? await inserirMinimo(
                e,
                'bloqueio_lote',
                {
                  estabelecimento_id: m.estA,
                  lote_insumo_id: li,
                  tipo: 'bloqueio',
                  motivo: `${MARCA} bloqueio de teste`,
                  abrangencia: 'local_estoque',
                  local_estoque_id: m.localA,
                  bloqueado_por_usuario_id: m.usuario,
                  situacao: 'ativo',
                },
                MARCA,
              )
            : null;
          await inserirMinimo(
            e,
            'saldo_lote',
            {
              estabelecimento_id: m.estA,
              local_estoque_id: m.localA,
              lote_insumo_id: li,
              quantidade: q,
              bloqueado,
              bloqueio_lote_id: bloqueio,
              competencia: '2026-11-01',
            },
            MARCA,
          );
        };
        await lote('VENC', '2025-01-31', 'liberado', false, 5);
        await lote('BLOQ', '2026-12-01', 'liberado', true, 5);
        await lote('RECO', '2026-12-02', 'recolhido', false, 5);
        await lote('BOM', '2026-12-31', 'liberado', false, 2);
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
            quantidade_solicitada: 15,
            quantidade_atendida: 1,
          },
          MARCA,
        );
        const cancelada = await inserirMinimo(
          e,
          'requisicao_material',
          {
            estabelecimento_id: m.estA,
            numero: 980_000 + Math.floor(Math.random() * 9_999),
            tipo: 'setor',
            atendente_local_estoque_id: m.localA,
            centro_custo_id: m.centroCusto,
            solicitante_usuario_id: m.usuario,
            situacao: 'cancelada',
            // Cancelada leva quem e quando (ck_requisicao_material_cancelamento).
            cancelado_em: new Date(),
            cancelador_usuario_id: m.usuario,
          },
          MARCA,
        );
        return [r, cancelada] as const;
      },
    );
    const s = await porta.separacao(c, reqId);
    expect(s).toMatchObject({ requisicao: reqId, situacao: 'autorizada', local: { id: m.localA } });
    expect(s!.linhas).toHaveLength(1);
    const l = s!.linhas[0]!;
    expect(l).toMatchObject({ item: m.insumo, aSeparar: 14, endereco: `${MARCA}P1` });
    // 14 a separar: 2 do lote válido que vence antes, 10 do L1 da massa e a falta exata de 2. O vencido, o bloqueado e
    // o recolhido nunca são sugeridos.
    expect(l.lotes).toEqual([
      { lote: `${MARCA}BOM`, validade: '2026-12-31', quantidade: 2 },
      { lote: `${m.marca}L1`, validade: '2027-03-31', quantidade: 10 },
    ]);
    expect(l.falta).toBe(2);
    expect(s!.totalFalta).toBe(1);
    // Requisição cancelada: não há o que separar.
    expect(await codigoDe(porta.separacao(c, reqCancelada))).toBe('separacao-requisicao-nao-atendivel');
    // Outro estabelecimento não lê a requisição.
    expect(await porta.separacao(contexto(m, m.estB, 't-f361b') as ContextoPortaM18, reqId)).toBeNull();
  }, 60_000);
});
