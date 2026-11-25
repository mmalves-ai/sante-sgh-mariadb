// Contrato de efeito da governança do cadastro de itens (C2-082, 05-SUP linha 2) contra o MariaDB real (cliente de teste
// do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a inclusão pedida nasce enviada; a aprovação pelo
// próprio solicitante é recusada sem gravar; a aprovação por outra pessoa cria o item padronizado e conclui; a inclusão
// de descrição que já existe é recusada; a unificação aprovada por outra pessoa e executada zera o saldo do absorvido,
// soma o convertido no que permanece (movimentos unificacao_saida e unificacao_entrada com o mesmo valor), repassa o
// código de barras, liga a substituição de apresentação e deixa o absorvido inativo e bloqueado para compra, nunca
// apagado; a repetição pela mesma chave não grava duas vezes; a substituição é incluída e desativada.
// A migração 11_SUP/99_unificacao_insumo só está no f22_o5: rode com SGH_CLIENTE_TESTE=f22_o5.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaGovernancaCadastroPropria } from './governanca-cadastro.js';
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
import { movimentar, tipoMovimentoId } from './porta-propria.js';

const k = () => `t-gov-${randomUUID()}`;
type L = Record<string, unknown>;
const HOJE = new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('governança do cadastro de itens (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaGovernancaCadastroPropria;
  let m: MassaSuprimentos;
  let c1: ContextoPortaM18;
  let c2: ContextoPortaM18;
  let permanece = 0;
  let absorvido = 0;
  const unificacoes: number[] = [];
  const solicitacoes: number[] = [];
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2082' }, (l) => l.uma<L>(sql, p));
  const saldo = async (insumo: number) =>
    Number(
      (
        await um('SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
          m.localA,
          insumo,
        ])
      )?.['quantidade'] ?? 0,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaGovernancaCadastroPropria(nucleo);
    c1 = contexto(m, m.estA, 't-c2082') as ContextoPortaM18;
    c2 = { ...c1, usuario: m.usuario2 } as ContextoPortaM18;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2082-massa' }, async (e) => {
      const item = (cod: string, nome: string) =>
        inserirMinimo(
          e,
          'insumo',
          {
            codigo: `${m.marca}${cod}`,
            nome,
            tipo: 'material',
            grupo_insumo_id: m.grupo,
            estoque_unidade_medida_id: m.unidade,
            situacao: 'ativo',
          },
          m.marca,
        );
      permanece = await item('UP', `LUVA SINTETICA ${m.marca} CAIXA`);
      absorvido = await item('UA', `LUVA SINTETICA ${m.marca} PAR`);
      await inserirMinimo(
        e,
        'insumo_codigo_barras',
        {
          insumo_id: absorvido,
          sequencia: 1,
          codigo_barras: `${m.marca}789`,
          unidade_medida_id: m.unidade,
        },
        m.marca,
      );
    });
    await nucleo.criarExecutor().executar(
      definirOperacao({
        nome: 'teste.c2082.entrada',
        tabelas: ['saldo_estoque', 'saldo_lote', 'movimento_estoque', 'movimento_lote'],
        entrada: z.unknown(),
        gravar: async (tx) => {
          const r = await movimentar(tx, m.estA, {
            local: m.localA,
            insumo: absorvido,
            quantidade: 10,
            natureza: 'entrada',
            tipoMovimento: await tipoMovimentoId(tx, 'unificacao_entrada'),
            valorEntrada: 25,
            lotes: [],
            hoje: HOJE,
          });
          return { id: r.id };
        },
        alvo: () => ({ tabela: 'saldo_estoque', id: m.localA }),
      }),
      CLIENTE,
      {},
      {
        cliente: CLIENTE,
        estabelecimento: m.estA,
        usuario: m.usuario,
        correlacao: 't-c2082-entrada',
        chaveIdempotencia: k(),
      },
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2082-limpa' }, async (e) => {
        for (const u of unificacoes) {
          await e.executar('DELETE FROM unificacao_insumo_item WHERE unificacao_insumo_id = ?', [u]);
          await e.executar('DELETE FROM unificacao_insumo WHERE id = ?', [u]);
        }
        for (const s of solicitacoes)
          await e.executar('DELETE FROM solicitacao_cadastro_insumo WHERE id = ?', [s]);
        const meus = 'SELECT id FROM insumo WHERE codigo LIKE ?';
        await e.executar(
          `DELETE FROM substituicao_insumo WHERE insumo_id IN (${meus}) OR substituto_insumo_id IN (${meus})`,
          [`${m.marca}%`, `${m.marca}%`],
        );
        await e.executar(`DELETE FROM insumo_estabelecimento WHERE insumo_id IN (${meus})`, [`${m.marca}%`]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('a inclusão só nasce da aprovação por outra pessoa; a duplicidade é recusada na hora', async () => {
    const pedido = await porta.solicitar(
      c1,
      {
        tipo: 'inclusao',
        item: null,
        descricao: `Seringa sintetica ${m.marca} 3 ml`,
        unidade: 'unidade',
        justificativa: 'Uso diário na enfermagem, sem item equivalente no cadastro.',
      },
      k(),
    );
    solicitacoes.push(pedido.id);
    expect(pedido.situacao).toBe('enviada');
    const lida = await um('SELECT versao, situacao, numero FROM solicitacao_cadastro_insumo WHERE id = ?', [
      pedido.id,
    ]);
    expect(lida?.['situacao']).toBe('enviada');
    expect(Number(lida?.['numero'])).toBeGreaterThan(0);
    const decisao = {
      versao: Number(lida?.['versao']),
      acao: 'aprovar' as const,
      parecer: 'Aprovado pela comissão de padronização.',
      codigo: `${m.marca}NV`,
      tipoItem: 'material',
      grupo: m.grupo,
      unidadeEstoque: m.unidade,
    };
    expect(await codigoDe(porta.decidirSolicitacao(c1, pedido.id, decisao, k()))).toBe('segregacao');
    expect(
      (await um('SELECT situacao FROM solicitacao_cadastro_insumo WHERE id = ?', [pedido.id]))?.['situacao'],
    ).toBe('enviada');
    expect(await um('SELECT id FROM insumo WHERE codigo = ?', [`${m.marca}NV`])).toBeNull();
    const chave = k();
    const ok = await porta.decidirSolicitacao(c2, pedido.id, decisao, chave);
    expect(ok.situacao).toBe('concluida');
    await porta.decidirSolicitacao(c2, pedido.id, decisao, chave);
    const s = await um(
      'SELECT situacao, criado_insumo_id, parecerista_usuario_id FROM solicitacao_cadastro_insumo WHERE id = ?',
      [pedido.id],
    );
    expect(Number(s?.['parecerista_usuario_id'])).toBe(m.usuario2);
    const novo = await um('SELECT id, nome, situacao, padronizado FROM insumo WHERE codigo = ?', [
      `${m.marca}NV`,
    ]);
    expect(Number(s?.['criado_insumo_id'])).toBe(Number(novo?.['id']));
    expect(novo?.['situacao']).toBe('ativo');
    expect(Boolean(Number(novo?.['padronizado']))).toBe(true);

    expect(
      await codigoDe(
        porta.solicitar(
          c1,
          {
            tipo: 'inclusao',
            item: null,
            descricao: `luva sintética ${m.marca} - caixa`,
            justificativa: 'Pedido repetido de um item que já existe no cadastro.',
          },
          k(),
        ),
      ),
    ).toBe('item-ja-existe');
  });

  it('a unificação executada transfere o saldo e as referências e inativa o absorvido, sem apagar', async () => {
    const chaveCriar = k();
    const entrada = {
      permanece,
      absorvidos: [{ item: absorvido, fator: 0.5 }],
      motivo: 'Itens duplicados: par e caixa da mesma luva.',
    };
    const u = await porta.unificar(c1, entrada, chaveCriar);
    unificacoes.push(u.id);
    const repetida = await porta.unificar(c1, entrada, chaveCriar);
    expect(repetida.id).toBe(u.id);
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM unificacao_insumo WHERE insumo_permanece_id = ?', [permanece])
        )?.['n'],
      ),
    ).toBe(1);
    const versao = async () =>
      Number((await um('SELECT versao FROM unificacao_insumo WHERE id = ?', [u.id]))?.['versao']);
    expect(
      await codigoDe(porta.decidirUnificacao(c1, u.id, { versao: await versao(), acao: 'aprovar' }, k())),
    ).toBe('segregacao');
    expect(
      (await porta.decidirUnificacao(c2, u.id, { versao: await versao(), acao: 'aprovar' }, k())).situacao,
    ).toBe('aprovada');
    expect(await saldo(absorvido)).toBe(10);
    const fim = await porta.decidirUnificacao(c1, u.id, { versao: await versao(), acao: 'executar' }, k());
    expect(fim.situacao).toBe('concluida');

    expect(await saldo(absorvido)).toBe(0);
    expect(await saldo(permanece)).toBe(5);
    const movs = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2082' }, (l) =>
      l.consultar<L>(
        `SELECT t.codigo, m.insumo_id, m.quantidade, m.valor_total FROM movimento_estoque m
           JOIN tipo_movimento_estoque t ON t.id = m.tipo_movimento_estoque_id
          WHERE m.insumo_id IN (?, ?) AND t.codigo IN ('unificacao_saida','unificacao_entrada') ORDER BY m.id`,
        [permanece, absorvido],
      ),
    );
    const saida = movs.find((x) => x['codigo'] === 'unificacao_saida');
    const ent = movs.filter(
      (x) => x['codigo'] === 'unificacao_entrada' && Number(x['insumo_id']) === permanece,
    );
    expect(Number(saida?.['quantidade'])).toBe(10);
    expect(ent).toHaveLength(1);
    expect(Number(ent[0]?.['quantidade'])).toBe(5);
    expect(Number(ent[0]?.['valor_total'])).toBe(Number(saida?.['valor_total']));

    expect(
      Number(
        (await um('SELECT insumo_id FROM insumo_codigo_barras WHERE codigo_barras = ?', [`${m.marca}789`]))?.[
          'insumo_id'
        ],
      ),
    ).toBe(permanece);
    const ab = await um(
      'SELECT situacao, padronizado, bloqueado_compra, excluido_em FROM insumo WHERE id = ?',
      [absorvido],
    );
    expect(ab?.['situacao']).toBe('inativo');
    expect(Boolean(Number(ab?.['bloqueado_compra']))).toBe(true);
    expect(ab?.['excluido_em']).toBeNull();
    const sub = await um(
      'SELECT tipo, ativo FROM substituicao_insumo WHERE insumo_id = ? AND substituto_insumo_id = ?',
      [absorvido, permanece],
    );
    expect(sub?.['tipo']).toBe('apresentacao');
    const item = await um(
      'SELECT situacao, quantidade_saldo_transferida, referencias_transferidas FROM unificacao_insumo_item WHERE unificacao_insumo_id = ?',
      [u.id],
    );
    expect(item?.['situacao']).toBe('transferido');
    expect(Number(item?.['quantidade_saldo_transferida'])).toBe(5);
    expect(Number(item?.['referencias_transferidas'])).toBe(1);
    const uni = await um(
      'SELECT situacao, aprovador_usuario_id, executado_em FROM unificacao_insumo WHERE id = ?',
      [u.id],
    );
    expect(uni?.['situacao']).toBe('concluida');
    expect(Number(uni?.['aprovador_usuario_id'])).toBe(m.usuario2);
    expect(uni?.['executado_em']).not.toBeNull();
  });

  it('a substituição é incluída e desativada sem apagar; a de um item por ele mesmo é recusada', async () => {
    const base = {
      item: permanece,
      substituto: m.insumo,
      tipo: 'generico' as const,
      fator: 1,
      exigeAvisoPrescritor: true,
      vigenciaInicio: null,
      vigenciaFim: null,
      ativo: true,
    };
    expect(await codigoDe(porta.substituir(c1, { ...base, substituto: permanece }, k()))).toBe(
      'substitui-a-si',
    );
    const s = await porta.substituir(c1, base, k());
    expect(s.situacao).toBe('ativa');
    const d = await porta.substituir(c1, { ...base, ativo: false }, k());
    expect(d.id).toBe(s.id);
    const linha = await um('SELECT ativo, excluido_em FROM substituicao_insumo WHERE id = ?', [s.id]);
    expect(Boolean(Number(linha?.['ativo']))).toBe(false);
    expect(linha?.['excluido_em']).toBeNull();
    expect((await porta.substituicoes(c1, permanece)).length).toBeGreaterThan(0);
  });
});
