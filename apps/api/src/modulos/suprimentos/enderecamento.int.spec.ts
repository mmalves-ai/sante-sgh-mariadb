// Contrato de efeito do endereçamento do armazém e da reserva para a separação (F8, 05-SUP linha 4) contra o MariaDB real
// (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: cria o endereço em níveis (o completo e
// o nível pelo de cima, código em maiúsculas; duplicado, superior de outro local recusados); liga o item ao endereço (o
// preferencial novo desmarca o anterior; a retirada leva excluido_em e o religamento reaproveita a linha); não inativa
// endereço com item; reserva o saldo livre por lote na requisição (reserva_estoque, quantidade_reservada no lote e no
// local, reserva do endereço preferencial), a repetição não reserva de novo, a segunda requisição só pega o livre e
// mostra a falta; a liberação devolve ao livre e cancela a reserva do endereço; a baixa no atendimento consome a reserva
// (parcial fica ativa; o item fechado conclui a do endereço). Outro estabelecimento não lê o local.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { baixarReservasDoItem, PortaEnderecamentoPropria, TABELAS_BAIXA_RESERVA } from './enderecamento.js';
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

const COD = `E${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
const k = () => `t-end-${randomUUID()}`;
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('endereçamento do armazém e reserva para a separação (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEnderecamentoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let area = 0;
  let prat = 0;
  let prat2 = 0;
  let vinculo = 0;
  let req1 = 0;
  let item1 = 0;
  let req2 = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c1118' }, (l) => l.uma<L>(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c1118' }, (l) => l.consultar<L>(sql, p));
  const reservado = async () => ({
    lote: Number(
      (
        await um(
          'SELECT quantidade_reservada AS q FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
          [m.localA, m.lote],
        )
      )?.['q'],
    ),
    local: Number(
      (
        await um(
          'SELECT quantidade_reservada AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
          [m.localA, m.insumo],
        )
      )?.['q'],
    ),
  });

  const requisicao = (q: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1118-req' }, async (e) => {
      const r = await inserirMinimo(
        e,
        'requisicao_material',
        {
          estabelecimento_id: m.estA,
          numero: 970_000 + Math.floor(Math.random() * 9_999),
          tipo: 'setor',
          atendente_local_estoque_id: m.localA,
          centro_custo_id: m.centroCusto,
          solicitante_usuario_id: m.usuario,
          situacao: 'autorizada',
        },
        m.marca,
      );
      const i = await inserirMinimo(
        e,
        'requisicao_material_item',
        {
          requisicao_material_id: r,
          sequencia: 1,
          insumo_id: m.insumo,
          unidade_medida_id: m.unidade,
          quantidade_solicitada: q,
        },
        m.marca,
      );
      return [r, i] as const;
    });

  const limparProprio = async () => {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1118-limpa' }, async (e) => {
      await e.executar('DELETE FROM reserva_endereco WHERE local_estoque_id = ?', [m.localA]);
      await e.executar('DELETE FROM reserva_estoque WHERE local_estoque_id = ?', [m.localA]);
      await e.executar(
        'DELETE FROM insumo_endereco WHERE endereco_armazem_id IN (SELECT id FROM endereco_armazem WHERE local_estoque_id IN (?, ?))',
        [m.localA, m.localA2],
      );
      for (let nivel = 8; nivel >= 1; nivel--)
        await e.executar('DELETE FROM endereco_armazem WHERE local_estoque_id IN (?, ?) AND nivel = ?', [
          m.localA,
          m.localA2,
          nivel,
        ]);
      await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
    });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaEnderecamentoPropria(nucleo);
    c = contexto(m, m.estA, 't-c1118') as ContextoPortaM18;
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparProprio();
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('cria o endereço em níveis, com o completo e o nível pelo de cima, e recusa o duplicado e o de outro local', async () => {
    area = (
      await porta.criarEndereco(c, { local: m.localA, tipoNivel: 'area', codigo: COD.toLowerCase() }, k())
    ).id;
    prat = (
      await porta.criarEndereco(
        c,
        { local: m.localA, superior: area, tipoNivel: 'prateleira', codigo: '03', capacidade: 50 },
        k(),
      )
    ).id;
    prat2 = (
      await porta.criarEndereco(
        c,
        { local: m.localA, superior: area, tipoNivel: 'prateleira', codigo: '04' },
        k(),
      )
    ).id;
    expect(
      await um(
        'SELECT nivel, tipo_nivel, codigo, codigo_completo, superior_endereco_armazem_id AS sup, criado_por, versao FROM endereco_armazem WHERE id = ?',
        [prat],
      ),
    ).toMatchObject({
      nivel: 2,
      tipo_nivel: 'prateleira',
      codigo: '03',
      codigo_completo: `${COD}-03`,
      sup: area,
      versao: 1,
    });
    expect(
      await codigoDe(
        porta.criarEndereco(c, { local: m.localA, superior: area, tipoNivel: 'posicao', codigo: '03' }, k()),
      ),
    ).toBe('endereco-duplicado');
    expect(
      await codigoDe(
        porta.criarEndereco(c, { local: m.localA2, superior: area, tipoNivel: 'posicao', codigo: '01' }, k()),
      ),
    ).toBe('endereco-superior-outro-local');
    // A trilha da criação fica na mesma transação.
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'endereco_armazem' AND entidade_id = ?",
            [prat],
          )
        )?.['n'],
      ),
    ).toBe(1);
  }, 60_000);

  it('liga o item: o preferencial novo desmarca o anterior; a retirada não apaga e o religamento reaproveita a linha', async () => {
    vinculo = (
      await porta.vincularItem(c, prat, { insumo: m.insumo, preferencial: true, quantidadeMaxima: 40 }, k())
    ).id;
    const v2 = (
      await porta.vincularItem(
        c,
        prat2,
        { insumo: m.insumo, preferencial: true, quantidadeMaxima: null },
        k(),
      )
    ).id;
    const pref = async () =>
      (
        await todos(
          'SELECT id, preferencial FROM insumo_endereco WHERE insumo_id = ? AND excluido_em IS NULL ORDER BY id',
          [m.insumo],
        )
      )
        .filter((x) => [vinculo, v2].includes(Number(x['id'])))
        .map((x) => [Number(x['id']), Boolean(Number(x['preferencial']))]);
    expect(await pref()).toEqual([
      [vinculo, false],
      [v2, true],
    ]);
    await porta.tornarPreferencial(c, vinculo, k());
    expect(await pref()).toEqual([
      [vinculo, true],
      [v2, false],
    ]);
    expect(
      await codigoDe(
        porta.vincularItem(c, prat2, { insumo: m.insumo, preferencial: false, quantidadeMaxima: null }, k()),
      ),
    ).toBe('item-ja-no-endereco');
    await porta.retirarVinculo(c, v2, k());
    expect(
      await um('SELECT excluido_em IS NOT NULL AS fora, preferencial FROM insumo_endereco WHERE id = ?', [
        v2,
      ]),
    ).toMatchObject({
      fora: 1,
      preferencial: 0,
    });
    expect(
      (
        await porta.vincularItem(
          c,
          prat2,
          { insumo: m.insumo, preferencial: false, quantidadeMaxima: null },
          k(),
        )
      ).id,
    ).toBe(v2);
    await porta.retirarVinculo(c, v2, k());
    // Endereço com item não inativa; a ficha mostra a árvore na ordem do endereço com os itens.
    const f = await porta.ficha(c, m.localA);
    const e = f!.enderecos.find((x) => x.id === prat)!;
    expect(f!.enderecos.map((x) => x.codigoCompleto)).toEqual([COD, `${COD}-03`, `${COD}-04`]);
    expect(e.itens).toMatchObject([{ vinculo, insumo: m.insumo, preferencial: true, quantidadeMaxima: 40 }]);
    expect(
      await codigoDe(
        porta.alterarEndereco(
          c,
          prat,
          { versao: e.versao, descricao: null, capacidade: 50, bloqueado: false, ativo: false },
          k(),
        ),
      ),
    ).toBe('endereco-com-itens');
    expect(await porta.ficha(contexto(m, m.estB, 't-c1118b') as ContextoPortaM18, m.localA)).toBeNull();
  }, 60_000);

  it('reserva o saldo livre por lote e o endereço preferencial; a repetição não reserva de novo', async () => {
    [req1, item1] = await requisicao(6);
    const r = await porta.reservar(c, req1, k());
    expect(r).toEqual({ id: req1, reservas: 1, faltas: [] });
    expect(await reservado()).toEqual({ lote: 6, local: 6 });
    const rs = await porta.reservas(c, req1);
    expect(rs).toMatchObject([
      {
        itemRequisicao: item1,
        insumo: m.insumo,
        lote: `${m.marca}L1`,
        endereco: `${COD}-03`,
        reservada: 6,
        situacao: 'ativa',
      },
    ]);
    expect(
      await um(
        'SELECT endereco_armazem_id AS e, quantidade AS q, situacao FROM reserva_endereco WHERE requisicao_material_id = ?',
        [req1],
      ),
    ).toMatchObject({ e: prat, situacao: 'ativa' });
    expect((await porta.reservar(c, req1, k())).reservas).toBe(0);
    expect(await reservado()).toEqual({ lote: 6, local: 6 });
  }, 60_000);

  it('a segunda requisição só pega o livre e mostra a falta; a liberação devolve ao livre e cancela o endereço', async () => {
    [req2] = await requisicao(6);
    const r = await porta.reservar(c, req2, k());
    expect(r.reservas).toBe(1);
    expect(r.faltas).toMatchObject([{ insumo: m.insumo, falta: 2 }]);
    expect(await reservado()).toEqual({ lote: 10, local: 10 });
    expect(await porta.liberar(c, req2, k())).toEqual({ id: req2, liberadas: 1 });
    expect(await reservado()).toEqual({ lote: 6, local: 6 });
    expect(await porta.reservas(c, req2)).toMatchObject([
      { reservada: 4, liberada: 4, atendida: 0, situacao: 'liberada' },
    ]);
    expect(
      await um('SELECT situacao FROM reserva_endereco WHERE requisicao_material_id = ?', [req2]),
    ).toEqual({
      situacao: 'cancelada',
    });
    expect(await codigoDe(porta.liberar(c, req2, k()))).toBe('sem-reserva');
  }, 60_000);

  it('o atendimento baixa a reserva: parcial fica ativa; o item fechado conclui a reserva do endereço', async () => {
    const executor = nucleo.criarExecutor();
    const baixar = (q: number, completo: boolean) =>
      executor.executar(
        definirOperacao({
          nome: 'teste.c1118.baixar-reserva',
          tabelas: [...TABELAS_BAIXA_RESERVA],
          entrada: z.unknown(),
          gravar: async (tx) => {
            await baixarReservasDoItem(tx, item1, q, completo);
            return { id: item1 };
          },
          alvo: () => ({ tabela: 'requisicao_material_item', id: item1 }),
        }),
        CLIENTE,
        { q },
        {
          cliente: CLIENTE,
          estabelecimento: m.estA,
          usuario: m.usuario,
          correlacao: 't-c1118-baixa',
          chaveIdempotencia: k(),
        },
      );
    await baixar(4, false);
    expect(await reservado()).toEqual({ lote: 2, local: 2 });
    expect(await porta.reservas(c, req1)).toMatchObject([
      { reservada: 6, atendida: 4, liberada: 0, situacao: 'ativa' },
    ]);
    await baixar(2, true);
    expect(await reservado()).toEqual({ lote: 0, local: 0 });
    expect(await porta.reservas(c, req1)).toMatchObject([
      { reservada: 6, atendida: 6, situacao: 'atendida' },
    ]);
    expect(
      await um('SELECT situacao FROM reserva_endereco WHERE requisicao_material_id = ?', [req1]),
    ).toEqual({
      situacao: 'concluida',
    });
  }, 60_000);
});
