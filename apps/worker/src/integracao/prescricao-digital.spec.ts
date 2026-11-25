// Enviador de prescrição digital (F8, 08-INTG L132): fora de produção só o simulador (nenhuma chamada HTTP), o retorno
// gravado no envio pela regra do domínio (aceita com identificador, código e endereço; cancelada; a de envio cancelado
// no hospital ignorada), a recusa da plataforma vira falha com o motivo e a resposta incompleta não grava nada.
import { EVENTO_PRESCRICAO_DIGITAL_ENVIO, montarPedidoPrescricaoDigital } from '@sgh/dominio-integracao';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { describe, expect, it, vi } from 'vitest';
import type { EnvioEntrega, ParceiroEntrega } from './porta-propria.js';
import { entregarPrescricaoDigital, gravarRetornoPrescricao } from './prescricao-digital.js';

const conteudo = montarPedidoPrescricaoDigital({
  evento: EVENTO_PRESCRICAO_DIGITAL_ENVIO,
  envio: 7,
  estabelecimento: 'h1',
  receita: { numero: 'R-1', emitidaEm: '2026-11-25T10:00:00.000Z', validadeAte: null },
  documento: { codigoVerificacao: 'ABC', hash: 'a'.repeat(64), arquivo: 1 },
  identificadorExterno: null,
  motivo: null,
});
const parceiro = { codigo: 'plat', tipo: 'api' } as ParceiroEntrega;
const envio = { id: '55', chaveEvento: 'prescricao-digital:envio:7' } as EnvioEntrega;

function dubles(situacao = 'pendente') {
  const alteracoes: Record<string, unknown>[] = [];
  const tx = {
    consultarParaAtualizar: vi.fn(async () => [{ id: 7, situacao, versao: 2 }]),
    alterar: vi.fn(async (_t: string, _id: number, _v: number, c: Record<string, unknown>) => {
      alteracoes.push(c);
    }),
  } as unknown as TxOperacao;
  const leitor = { uma: vi.fn(async () => ({ conteudo, entidade_id: 7 })) } as unknown as Leitor;
  return {
    alteracoes,
    c: (ambiente: string, http?: typeof fetch) => ({
      ambiente,
      destinoApi: () => 'https://plataforma.exemplo.invalid/receitas',
      ler: <T>(_h: string, fn: (l: Leitor) => Promise<T>) => fn(leitor),
      gravar: <T>(_h: string, fn: (t: TxOperacao) => Promise<T>) => fn(tx),
      agora: () => new Date('2026-11-25T12:00:00Z'),
      ...(http ? { http } : {}),
    }),
  };
}

describe('entregarPrescricaoDigital', () => {
  it('fora de produção usa o simulador (sem HTTP) e grava a aceita com identificador, código e endereço', async () => {
    const d = dubles();
    const http = vi.fn();
    const r = await entregarPrescricaoDigital(
      d.c('dev', http as unknown as typeof fetch),
      parceiro,
      envio,
      'h1',
    );
    expect(http).not.toHaveBeenCalled();
    expect(r.recibo).toMatch(/^SIM-/);
    expect(d.alteracoes[0]).toMatchObject({
      situacao: 'aceita',
      codigo_validacao: expect.stringMatching(/^\d{6}$/),
    });
    expect(String(d.alteracoes[0]!['url_validacao'])).toMatch(/^https:\/\/.+\.invalid\//);
  });
  it('em produção a recusa da plataforma grava rejeitada e vira falha com o motivo', async () => {
    const d = dubles();
    const http = vi.fn(
      async () => new Response(JSON.stringify({ situacao: 'rejeitada', motivo: 'CRM inválido' })),
    );
    await expect(
      entregarPrescricaoDigital(d.c('producao', http as unknown as typeof fetch), parceiro, envio, 'h1'),
    ).rejects.toThrow(/recusada pela plataforma: CRM inválido/);
    expect(d.alteracoes[0]).toMatchObject({ situacao: 'rejeitada' });
  });
  it('em produção a aceita sem endereço https não grava nada e falha', async () => {
    const d = dubles();
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            situacao: 'aceita',
            identificador: 'X',
            codigoValidacao: '1',
            urlValidacao: 'http://x',
          }),
        ),
    );
    await expect(
      entregarPrescricaoDigital(d.c('producao', http as unknown as typeof fetch), parceiro, envio, 'h1'),
    ).rejects.toThrow(/endereço de validação https/);
    expect(d.alteracoes).toHaveLength(0);
  });
});

describe('gravarRetornoPrescricao', () => {
  it('o retorno atrasado de envio cancelado no hospital é ignorado', async () => {
    const d = dubles('cancelada');
    const tx = {
      consultarParaAtualizar: async () => [{ id: 7, situacao: 'cancelada', versao: 3 }],
      alterar: vi.fn(),
    } as unknown as TxOperacao;
    const r = await gravarRetornoPrescricao(
      tx,
      7,
      {
        situacao: 'aceita',
        identificadorExterno: 'X',
        codigoValidacao: '1',
        urlValidacao: 'https://x.invalid/1',
        situacaoExterna: null,
        motivo: null,
      },
      new Date(),
    );
    expect(r).toMatch(/^ignorado/);
    expect(d.alteracoes).toHaveLength(0);
  });
});
