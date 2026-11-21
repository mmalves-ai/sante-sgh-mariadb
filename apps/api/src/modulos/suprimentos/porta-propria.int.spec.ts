// Integração da porta própria do estoque (M28) contra o MariaDB real (cliente f22_o3; massa SINTÉTICA, nenhuma pessoa
// real). Leituras: locais, centros de custo, meses fechados, itens, saldos com lote e o isolamento por estabelecimento.
// Contrato de efeito do inventário: a abertura (cabeçalho com número de negócio, rodada, itens com o saldo e o custo do
// banco, versão 1, trilha com entidade e evento, outbox), a idempotência pela chave da tela (a repetição devolve o
// mesmo id sem gravar; a mesma chave com outro conteúdo é recusada), a contagem pela regra do domínio (divergência pede
// recontagem por outra pessoa na rodada seguinte; duas iguais confirmam), a aprovação por quem não contou e o
// cancelamento com justificativa, que libera o local. Pela HTTP do controller (sessão real, porta própria): GET apoio e
// POST inventarios. O OPME na saída ainda recusa com o motivo, nada gravado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';
import { SuprimentosController } from './suprimentos.controller.js';

const RODADA = Date.now().toString(36);

describe.skipIf(SEM_BANCO)('porta própria do estoque (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f22l0314' }, (l) => l.consultar<T>(sql, p));
  const trilha = (evento: string, entidade: string) => (r: unknown) =>
    ({
      estabelecimento: m.estA,
      usuario: m.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: typeof r === 'number' ? r : null,
      dadosDepois: { evento },
      correlacao: null,
    }) as TrilhaDaGravacao;
  const como = (usuario: number, correlacao = 'f22l0314', chave?: string): ContextoSuprimentos =>
    ({
      ...contexto(m, m.estA, correlacao),
      usuario,
      ...(chave ? { chaveIdempotencia: chave } : {}),
    }) as ContextoSuprimentos;
  const abrir = (
    c: ContextoSuprimentos,
    i: { local: number; tipo: 'geral' | 'ciclico'; itens?: number[]; curva?: 'A' },
  ) =>
    porta.gravarSgh(c, trilha('suprimentos.inventario.aberto', 'inventario_estoque'), (g) =>
      g.abrirInventario({
        local: i.local,
        tipo: i.tipo,
        ...(i.curva ? { curva: i.curva } : {}),
        limitePct: 5,
        itens: (i.itens ?? []).map((item) => ({ item, saldo: 999 })),
        usuario: 'x',
      }),
    );
  const contar = (c: ContextoSuprimentos, inventario: number, item: number, quantidade: number) =>
    porta.gravarSgh(c, trilha('suprimentos.inventario.contado', 'inventario_estoque_item'), (g) =>
      g.registrarContagem({ inventario, item, quantidade, usuario: 'x' }),
    );
  const decidir = (
    c: ContextoSuprimentos,
    inventario: number,
    decisao: 'aprovado' | 'cancelado',
    justificativa = '',
  ) =>
    porta.gravarSgh(c, trilha('suprimentos.inventario.decidido', 'inventario_estoque'), (g) =>
      g.decidirInventario({ inventario, decisao, justificativa, usuario: 'x', podeAprovar: true }),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
  }, 60_000);
  afterAll(async () => {
    desligarMapaEstabelecimentos();
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('leituras: locais, centros de custo, meses fechados, itens, saldos com lote e isolamento', async () => {
    const c = contexto(m);
    const r = await porta.relogio(c);
    expect(r.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await porta.locais(c)).map((x) => x.codigo).sort()).toEqual([m.localA, m.localA2].sort());
    expect(await porta.centrosCusto(c)).toEqual([
      { codigo: m.centroCusto, nome: 'CENTRO SINTETICO', localConsumo: m.localA, tecnico: true },
    ]);
    expect(await porta.centrosCusto(contexto(m, m.estB))).toEqual([]);
    expect(await porta.mesesFechados(c)).toEqual([{ ano: 2026, mes: 9, exportado: true }]);
    const itens = await porta.itens(c, [m.insumo, m.insumoOpme, 999_999_999]);
    expect(itens.size).toBe(2);
    expect(itens.get(m.insumo)).toMatchObject({
      estoque: 14,
      total: 35,
      custoMedio: 2.5,
      rastreavel: true,
      consignado: false,
    });
    const s = await porta.saldos(c, { local: m.localA, item: m.insumo, hoje: '2027-03-01', alertaDias: 60 });
    expect(s.cortada).toBe(false);
    expect(s.itens).toHaveLength(1);
    expect(s.itens[0]).toMatchObject({
      item: m.insumo,
      local: m.localA,
      quantidade: 10,
      valor: 25,
      estoqueEmpresa: 14,
      valorEmpresa: 35,
      custoMedio: 2.5,
      rastreavel: true,
    });
    expect(s.itens[0]!.lotes).toEqual([
      {
        id: m.lote,
        lote: `${m.marca}L1`,
        validade: '2027-03-31',
        quantidade: 10,
        diasParaVencer: 30,
        alerta: 'vence',
      },
    ]);
    // Sem saldo (OPME no A2 com 0) só aparece com comSaldo falso.
    expect(
      (await porta.saldos(c, { local: m.localA2, hoje: r.hoje, alertaDias: 0 })).itens.map((x) => x.item),
    ).toEqual([m.insumo]);
    expect(
      (await porta.saldos(c, { local: m.localA2, comSaldo: false, hoje: r.hoje, alertaDias: 0 })).itens,
    ).toHaveLength(2);
    expect(await porta.lotesDoLocal(c, m.insumo, m.localA2, r.hoje, 0)).toEqual([]);
    // O estabelecimento B vê só o saldo dele (99 a 7,00) e nenhum lote do A.
    const b = await porta.saldos(contexto(m, m.estB), { item: m.insumo, hoje: r.hoje, alertaDias: 0 });
    expect(b.itens.map((x) => [x.local, x.quantidade, x.lotes.length])).toEqual([[m.localB, 99, 0]]);
  });

  it('inventário geral: efeito, idempotência, recontagem por outra pessoa, aprovação por quem não contou', async () => {
    const chave = `f22l0314-inv-${RODADA}`;
    const c = como(m.usuario, chave, chave);
    const id = await abrir(c, { local: m.localA, tipo: 'geral' });
    const [inv] = await ler(
      'SELECT situacao, versao, abertura_usuario_id, numero, estabelecimento_id, controla_lote, tipo FROM inventario_estoque WHERE id = ?',
      [id],
    );
    expect(inv).toMatchObject({ situacao: 'aberto', versao: 1, tipo: 'geral' });
    expect(Number(inv!['abertura_usuario_id'])).toBe(m.usuario);
    expect(Number(inv!['estabelecimento_id'])).toBe(m.estA);
    expect(Number(inv!['controla_lote'])).toBe(1);
    expect(String(inv!['numero'])).toMatch(/^INV-\d+$/);
    // O geral pega o saldo do local (o insumo inativo fica fora), com o saldo e o custo do banco.
    const itens = await ler(
      'SELECT insumo_id, saldo_sistema, custo_medio_unitario, situacao, versao FROM inventario_estoque_item WHERE inventario_estoque_id = ?',
      [id],
    );
    expect(
      itens.map((x) => [
        Number(x['insumo_id']),
        Number(x['saldo_sistema']),
        Number(x['custo_medio_unitario']),
      ]),
    ).toEqual([[m.insumo, 10, 2.5]]);
    expect(itens[0]).toMatchObject({ situacao: 'pendente', versao: 1 });
    // Trilha (entidade, id e evento) e outbox na mesma transação.
    const t = await ler(
      'SELECT entidade, entidade_id, dados_depois FROM trilha_auditoria WHERE correlacao = ?',
      [chave],
    );
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ entidade: 'inventario_estoque' });
    expect(Number(t[0]!['entidade_id'])).toBe(id);
    expect(JSON.stringify(t[0]!['dados_depois'])).toContain('suprimentos.inventario.aberto');
    const o = await ler(
      'SELECT ponto, entidade, entidade_id FROM integracao_mensagem WHERE ponto = ? AND entidade_id = ?',
      ['suprimentos.abrir_inventario', id],
    );
    expect(o).toHaveLength(1);
    // A mesma chave e o mesmo conteúdo: o mesmo id, nada gravado de novo; outro conteúdo: recusa.
    expect(await abrir(c, { local: m.localA, tipo: 'geral' })).toBe(id);
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'geral' }))).toBe('idempotencia-divergente');
    const [qt] = await ler('SELECT COUNT(*) AS n FROM inventario_estoque WHERE local_estoque_id IN (?, ?)', [
      m.localA,
      m.localA2,
    ]);
    expect(Number(qt!['n'])).toBe(1);
    expect((await porta.inventarios(contexto(m))).map((x) => x.id)).toContain(id);
    expect(await porta.inventarios(contexto(m, m.estB))).toEqual([]);

    // 1ª contagem 8 (saldo 10, limite 5%): recontar; abre a rodada 2 com o item pendente.
    expect(await contar(como(m.usuario), id, m.insumo, 8)).toEqual({ ordem: 1 });
    const rod = await ler(
      'SELECT sequencia, tipo, situacao FROM inventario_estoque_contagem WHERE inventario_estoque_id = ? ORDER BY sequencia',
      [id],
    );
    expect(rod).toEqual([
      { sequencia: 1, tipo: 'contagem', situacao: 'fechada' },
      { sequencia: 2, tipo: 'recontagem', situacao: 'aberta' },
    ]);
    const [inv2] = await ler('SELECT situacao, versao FROM inventario_estoque WHERE id = ?', [id]);
    expect(inv2).toMatchObject({ situacao: 'recontagem', versao: 2 });
    // A recontagem é de outra pessoa; a cega não mostra o saldo.
    expect(await codigoDe(contar(como(m.usuario), id, m.insumo, 8))).toBe('mesmo-contador');
    const cega = await porta.inventario(contexto(m), id, true);
    expect(cega?.itens[0]).toMatchObject({
      contagens: 1,
      saldo: null,
      diferenca: null,
      situacao: 'recontar',
    });
    expect(await contar(como(m.usuario2), id, m.insumo, 8)).toEqual({ ordem: 2 });
    const visto = await porta.inventario(contexto(m), id, false);
    expect(visto).toMatchObject({
      situacao: 'recontagem',
      tipo: 'geral',
      limitePct: 5,
      abertoPor: expect.stringContaining('ESTOQUE'),
      balanco: null,
    });
    expect(visto?.itens).toEqual([
      {
        item: m.insumo,
        nome: 'ITEM SINTETICO M',
        contagens: 2,
        saldo: 10,
        contado: 8,
        diferenca: -2,
        divergenciaPct: 20,
        situacao: 'divergente-confirmado',
      },
    ]);
    // Item resolvido não recebe contagem; quem contou não aprova; o supervisor aprova e fecha as rodadas.
    expect(await codigoDe(contar(como(m.usuario3), id, m.insumo, 9))).toBe('item-resolvido');
    expect(await codigoDe(decidir(como(m.usuario2), id, 'aprovado'))).toBe('aprovador-contou');
    await decidir(como(m.usuario3), id, 'aprovado');
    const [inv3] = await ler(
      'SELECT situacao, versao, aprovacao_usuario_id FROM inventario_estoque WHERE id = ?',
      [id],
    );
    expect(inv3).toMatchObject({ situacao: 'aprovado', versao: 3 });
    expect(Number(inv3!['aprovacao_usuario_id'])).toBe(m.usuario3);
    const rod2 = await ler(
      'SELECT situacao FROM inventario_estoque_contagem WHERE inventario_estoque_id = ? ORDER BY sequencia',
      [id],
    );
    expect(rod2.map((x) => x['situacao'])).toEqual(['aprovada', 'aprovada']);
    expect(await codigoDe(contar(como(m.usuario3), id, m.insumo, 1))).toBe('inventario-encerrado');
  });

  it('inventário cíclico: recusas sem gravar, cancelamento com justificativa libera o local', async () => {
    const c = contexto(m);
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'ciclico' }))).toBe('inventario-sem-itens');
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'ciclico', itens: [m.insumoInativo] }))).toBe(
      'item-inativo',
    );
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'ciclico', itens: [999_999_999] }))).toBe(
      'item-inexistente',
    );
    expect(await codigoDe(abrir(c, { local: m.localB, tipo: 'ciclico', itens: [m.insumo] }))).toBe(
      'local-inexistente',
    );
    const id = await abrir(c, { local: m.localA2, tipo: 'ciclico', itens: [m.insumo, m.insumoOpme] });
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'ciclico', itens: [m.insumo] }))).toBe(
      'inventario-em-aberto',
    );
    expect(await codigoDe(contar(c, id, m.insumoInativo, 1))).toBe('item-fora-do-inventario');
    expect(await codigoDe(contar(contexto(m, m.estB), id, m.insumo, 1))).toBe('inventario-inexistente');
    expect(await codigoDe(contar(c, id, m.insumo, -1))).toBe('quantidade-invalida');
    // Aprovar com item pendente: recusa; cancelar exige justificativa; cancelado, o local abre outro.
    expect(await codigoDe(decidir(como(m.usuario3), id, 'aprovado'))).toBe('inventario-incompleto');
    expect(await codigoDe(decidir(como(m.usuario3), id, 'cancelado'))).toBe('sem-justificativa');
    await decidir(como(m.usuario3), id, 'cancelado', 'Contagem refeita no próximo ciclo');
    const [inv] = await ler(
      'SELECT situacao, justificativa, fechamento_usuario_id FROM inventario_estoque WHERE id = ?',
      [id],
    );
    expect(inv).toMatchObject({ situacao: 'cancelado', justificativa: 'Contagem refeita no próximo ciclo' });
    const rod = await ler(
      'SELECT situacao FROM inventario_estoque_contagem WHERE inventario_estoque_id = ?',
      [id],
    );
    expect(rod.map((x) => x['situacao'])).toEqual(['cancelada']);
    // Pela curva A do saldo no local A2 não há item; no A (o i1 é curva A), abriria (o A já tem um aprovado, livre).
    expect(await codigoDe(abrir(c, { local: m.localA2, tipo: 'ciclico', curva: 'A' }))).toBe(
      'inventario-sem-itens',
    );
    const novo = await abrir(c, { local: m.localA2, tipo: 'ciclico', itens: [m.insumo] });
    await decidir(como(m.usuario3), novo, 'cancelado', 'Fim do teste');
  });

  it('pela HTTP do controller: GET apoio e POST inventarios sobre a porta própria (sessão do estabelecimento)', async () => {
    await ligarMapaEstabelecimentos(CLIENTE, nucleo);
    const [est] = await ler('SELECT codigo FROM estabelecimento WHERE id = ?', [m.estA]);
    const trilhaApi = new RegistradorTrilhaMemoria();
    const configuracao = fonteConfiguracaoMemoria(trilhaApi, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
    const controller = new SuprimentosController(porta, trilhaApi, configuracao, null);
    const req = (chave?: string) =>
      ({
        headers: {
          ...(chave ? { 'idempotency-key': chave } : {}),
          'x-correlacao': `f22l0314-http-${RODADA}`,
        },
        sgh: {
          sessao: {
            estabelecimentoAtivo: String(est!['codigo']),
            rede: 'f22',
            usuario: { id: String(m.usuario3), login: 'F22L0314.SUPERVISOR' },
          },
          ability: { can: () => true },
        },
      }) as unknown as RequisicaoAutorizada;
    const apoio = await controller.apoio(req());
    expect(apoio.locais.map((x) => x.codigo).sort()).toEqual([m.localA, m.localA2].sort());
    expect(apoio.centrosCusto).toEqual([
      { codigo: m.centroCusto, nome: 'CENTRO SINTETICO', localConsumo: m.localA, tecnico: true },
    ]);
    // O escopo vem do cadastro do usuário no estoque (o supervisor só aprova pedido no local A).
    expect(apoio.escopo).toMatchObject({
      usuario: 'F22L0314.SUPERVISOR',
      locais: [{ local: m.localA, tipos: [] }],
      flags: { autorizarPedido: true, autorizarRequisicao: false },
    });
    const k = `f22l0314-http-${RODADA}`;
    const r = await controller.abrirInventario(
      { local: m.localA2, tipo: 'ciclico', itens: [m.insumo] },
      req(k),
    );
    const id = Number(r.ids['inventario']);
    expect(r.mensagem).toContain(`Inventário ${id} aberto com 1 item(ns)`);
    const [inv] = await ler('SELECT situacao, local_estoque_id FROM inventario_estoque WHERE id = ?', [id]);
    expect(Number(inv!['local_estoque_id'])).toBe(m.localA2);
    // O reenvio da tela com a mesma Idempotency-Key devolve o mesmo inventário.
    const r2 = await controller.abrirInventario(
      { local: m.localA2, tipo: 'ciclico', itens: [m.insumo] },
      req(k),
    );
    expect(Number(r2.ids['inventario'])).toBe(id);
    await decidir(como(m.usuario), id, 'cancelado', 'Fim do teste HTTP');
  });

  it('recursos ainda fora do banco: OPME na saída responde 409 com o motivo, nada gravado', async () => {
    const c = contexto(m);
    const gravados = async () =>
      (
        await ler<{ n: number }>(
          `SELECT (SELECT COUNT(*) FROM documento_estoque WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM movimento_estoque WHERE estabelecimento_id = ?) AS n`,
          [m.estA, m.estA],
        )
      )[0]?.n;
    const antes = Number(await gravados());
    expect(
      await codigoDe(
        porta.executar(
          c,
          'suprimentos.registrarSaida',
          {
            destino: 1,
            local: m.localA,
            centroCusto: m.centroCusto,
            localConsumo: 1,
            atendimento: 1,
            itens: [{ item: m.insumoOpme, quantidade: 1 }],
            opme: {
              agendamento: 1,
              sala: 1,
              dataHora: '2026-01-15T10:00',
              solicitacao: 1,
              lote: 'LOTE-SINT-1',
              fabricante: 'Fabricante sintetico',
              registroAnvisa: '12345678901',
              fornecedor: 1,
            },
          },
          { ...c, chaveIdempotencia: `k-${RODADA}` },
        ),
      ),
    ).toBe('modelo-pendente');
    expect(Number(await gravados())).toBe(antes);
    expect(await porta.podeGravar(c, 'suprimentos.inexistente')).toMatchObject({
      pode: false,
      codigo: 'operacao-desconhecida',
    });
  });
});
