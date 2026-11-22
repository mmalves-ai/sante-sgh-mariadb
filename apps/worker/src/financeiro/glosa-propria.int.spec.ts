// Integração da glosa aceita do evento no título a receber, contra o MariaDB real (cliente f22_o5; massa sintética
// fo513f/fo513g, ids de conta 990513+; nenhuma pessoa real; chaves estrangeiras desligadas só na montagem da massa).
// Contrato de efeito: o evento grava UMA linha em glosa_titulo_receber (meio "evento", chave do evento) e o título passa
// a carregar a glosa aceita, com a versão nova e a trilha; a repetição não duplica; o item sem título, o título de
// outro estabelecimento e o item sem glosa aceita não gravam nada; uma segunda chave para o mesmo item não conta de novo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AcessoIntegracao, acessoDoNucleo } from '../integracao/acesso.js';
import {
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
  sha,
} from '../importadores/integracao.spec-util.js';
import { consumirEventoFinanceiro } from './consumidor-financeiro.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const H = 'fo513f';
const H2 = 'fo513g';
const CONTA = 990513;
const CONTA_SEM_TITULO = 990514;
const CONTA_PARALELA = CONTA + 20;

describe.skipIf(SEM_BANCO)('glosa aceita do evento no título a receber (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let acesso: AcessoIntegracao;
  let est = 0;
  let est2 = 0;
  let seqGlosa = 0;
  const m = {
    titulo: 0,
    tituloOutro: 0,
    tituloParalelo: 0,
    itemParalelo: 0,
    item: 0,
    itemSemTitulo: 0,
    itemSemGlosa: 0,
    itemOutro: 0,
    glosas: [] as number[],
  };

  const limpar = () =>
    escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await e.executar(
          `DELETE g FROM glosa_titulo_receber g JOIN titulo_receber t ON t.id = g.titulo_receber_id
            WHERE t.estabelecimento_id IN (?, ?)`,
          [est, est2],
        );
        await e.executar('DELETE FROM titulo_receber WHERE estabelecimento_id IN (?, ?)', [est, est2]);
        await e.executar(
          'DELETE gi FROM glosa_item gi JOIN conta_hospitalar_item i ON i.id = gi.conta_hospitalar_item_id WHERE i.conta_hospitalar_id IN (?, ?, ?, ?)',
          [CONTA, CONTA_SEM_TITULO, CONTA + 10, CONTA_PARALELA],
        );
        await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (?, ?, ?, ?)', [
          CONTA,
          CONTA_SEM_TITULO,
          CONTA + 10,
          CONTA_PARALELA,
        ]);
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });

  const titulo = (e: Parameters<Parameters<typeof escrever>[1]>[0], estabelecimento: number, conta: number) =>
    inserirSintetico(e, 'titulo_receber', {
      estabelecimento_id: estabelecimento,
      conta_hospitalar_id: conta,
      numero: `F22-0513-${conta}`,
      tipo_devedor: 'fonte_pagadora',
      fonte_pagadora_id: 990513,
      tipo_origem: 'conta',
      situacao: 'aberto',
      valor_bruto: 100,
      valor_desconto: 0,
      valor_acrescimo: 0,
      valor_impostos: 0,
      valor_liquido: 100,
      valor_glosa: 0,
      valor_glosa_aceita: 0,
      valor_recebido: 0,
      quantidade_parcelas: 1,
      criado_em: new Date(),
      versao: 1,
    });
  const item = (e: Parameters<Parameters<typeof escrever>[1]>[0], conta: number, sequencia: number) =>
    inserirSintetico(e, 'conta_hospitalar_item', {
      conta_hospitalar_id: conta,
      sequencia,
      criado_em: new Date(),
      versao: 1,
    });
  const glosa = (
    e: Parameters<Parameters<typeof escrever>[1]>[0],
    itemId: number,
    aceito: number,
    decisao = 'aceitar',
  ) =>
    inserirSintetico(e, 'glosa_item', {
      glosa_id: 990513,
      sequencia: ++seqGlosa,
      conta_hospitalar_item_id: itemId,
      motivo_glosa_id: 990513,
      valor_apresentado: 100,
      valor_glosado: 50,
      valor_aceito: aceito,
      valor_recursado: 0,
      valor_recuperado: 0,
      decisao,
      decidido_em: decisao === 'pendente' ? null : new Date(),
      criado_em: new Date(),
      versao: 1,
    });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    acesso = acessoDoNucleo(nucleo, CLIENTE, 'teste-f22-0513-financeiro');
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, H);
      est2 = await garantirEstabelecimento(e, H2);
    });
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        m.titulo = await titulo(e, est, CONTA);
        m.tituloOutro = await titulo(e, est2, CONTA + 10);
        m.item = await item(e, CONTA, 1);
        m.itemSemGlosa = await item(e, CONTA, 2);
        m.itemSemTitulo = await item(e, CONTA_SEM_TITULO, 1);
        m.itemOutro = await item(e, CONTA + 10, 1);
        m.glosas.push(await glosa(e, m.item, 30));
        m.glosas.push(await glosa(e, m.itemSemGlosa, 0, 'pendente'));
        m.glosas.push(await glosa(e, m.itemSemTitulo, 20));
        m.glosas.push(await glosa(e, m.itemOutro, 20));
        m.tituloParalelo = await titulo(e, est, CONTA_PARALELA);
        m.itemParalelo = await item(e, CONTA_PARALELA, 1);
        m.glosas.push(await glosa(e, m.itemParalelo, 15, 'aceitar_parcial'));
        m.glosas.push(await glosa(e, m.itemParalelo, 25));
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  const evento = (chave: string, hospital: string, itemId: number) => ({
    chave: sha(chave),
    tipo: 'faturamento.glosa.aceita',
    dados: { hospital, item: itemId },
  });
  const lerTitulo = (id: number) =>
    escrever(nucleo, (e) =>
      e.uma<{ valor_glosa: unknown; valor_glosa_aceita: unknown; versao: unknown }>(
        'SELECT valor_glosa, valor_glosa_aceita, versao FROM titulo_receber WHERE id = ?',
        [id],
      ),
    );

  it('registra a glosa uma vez, com o título atualizado pela versão e a trilha', async () => {
    const ev = evento('glosa-1', H, m.item);
    const r = await consumirEventoFinanceiro(acesso, CLIENTE, ev);
    expect(r).toMatchObject({ resultado: 'registrada' });
    const id = (r as { id: number }).id;
    const linha = await escrever(nucleo, (e) =>
      e.uma<{
        valor: unknown;
        meio: string;
        situacao: string;
        chave_evento: string;
        titulo_receber_id: unknown;
      }>(
        'SELECT valor, meio, situacao, chave_evento, titulo_receber_id FROM glosa_titulo_receber WHERE id = ?',
        [id],
      ),
    );
    expect(linha).toMatchObject({ meio: 'evento', situacao: 'aceita', chave_evento: ev.chave });
    expect(Number(linha?.valor)).toBe(30);
    expect(Number(linha?.titulo_receber_id)).toBe(m.titulo);
    const t = await lerTitulo(m.titulo);
    expect(Number(t?.valor_glosa)).toBe(30);
    expect(Number(t?.valor_glosa_aceita)).toBe(30);
    expect(Number(t?.versao)).toBe(2);
    const trilha = await escrever(nucleo, (e) =>
      e.uma<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND correlacao = 'teste-f22-0513-financeiro'",
        [est],
      ),
    );
    expect(Number(trilha?.n)).toBeGreaterThanOrEqual(1);
    // A mesma entrega de novo: repetida, nada muda.
    expect(await consumirEventoFinanceiro(acesso, CLIENTE, ev)).toEqual({ resultado: 'repetida', id });
    // Outra chave para o mesmo item: o aceito já foi lançado.
    expect(await consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-1b', H, m.item))).toEqual({
      resultado: 'sem-glosa',
      id: null,
    });
    expect(Number((await lerTitulo(m.titulo))?.versao)).toBe(2);
  });

  it('sem título, título de outro estabelecimento ou sem glosa aceita: nada gravado', async () => {
    expect(await consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-2', H, m.itemSemTitulo))).toEqual({
      resultado: 'sem-titulo',
      id: null,
    });
    expect(await consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-3', H, m.itemOutro))).toEqual({
      resultado: 'sem-titulo',
      id: null,
    });
    expect(await consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-4', H, m.itemSemGlosa))).toEqual({
      resultado: 'sem-glosa',
      id: null,
    });
    expect(Number((await lerTitulo(m.tituloOutro))?.versao)).toBe(1);
    await expect(
      consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-5', 'fo513x', m.item)),
    ).rejects.toMatchObject({
      problema: { codigo: 'estabelecimento-desconhecido' },
    });
  });

  it('duas entregas em paralelo com chaves diferentes para o mesmo item: a glosa entra uma vez só', async () => {
    const rs = await Promise.all([
      consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-par-a', H, m.itemParalelo)),
      consumirEventoFinanceiro(acesso, CLIENTE, evento('glosa-par-b', H, m.itemParalelo)),
    ]);
    expect(rs.map((r) => (r as { resultado: string }).resultado).sort()).toEqual(['registrada', 'sem-glosa']);
    const t = await lerTitulo(m.tituloParalelo);
    expect(Number(t?.valor_glosa_aceita)).toBe(40);
    expect(Number(t?.valor_glosa)).toBe(40);
    expect(Number(t?.versao)).toBe(2);
    const n = await escrever(nucleo, (e) =>
      e.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM glosa_titulo_receber WHERE titulo_receber_id = ?', [
        m.tituloParalelo,
      ]),
    );
    expect(Number(n?.n)).toBe(1);
  });
});
