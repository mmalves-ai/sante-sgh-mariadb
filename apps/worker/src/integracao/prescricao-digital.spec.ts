// Enviador de prescrição digital (F8, 08-INTG L132): fora de produção só o simulador (nenhuma chamada HTTP), o retorno
// gravado no envio pela regra do domínio (aceita com identificador, código e endereço; cancelada; a de envio cancelado
// no hospital leva o cancelamento à plataforma), o documento assinado vai anexado ao corpo (sem ele, nada sai), e a
// recusa da plataforma e a aceita incompleta são resultado final (gravadas no envio, sem volta à fila).
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

const PDF = new TextEncoder().encode('%PDF-1.7 receita assinada sintética');
const arquivoOk = vi.fn(async () => ({ conteudo: PDF, tipoMime: 'application/pdf', hash: 'b'.repeat(64) }));

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
      lerArquivo: arquivoOk,
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
  it('em produção o corpo leva o documento assinado anexado (base64 e resumo), lido do armazém', async () => {
    const d = dubles();
    const http = vi.fn<(u: string, i: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            situacao: 'aceita',
            identificador: 'P-1',
            codigoValidacao: '654321',
            urlValidacao: 'https://plataforma.exemplo.invalid/v/P-1',
          }),
        ),
    );
    await entregarPrescricaoDigital(d.c('producao', http as unknown as typeof fetch), parceiro, envio, 'h1');
    expect(arquivoOk).toHaveBeenCalledWith('h1', 1);
    const corpo = JSON.parse(String(http.mock.calls[0]![1].body)) as { documento: Record<string, unknown> };
    expect(corpo.documento).toMatchObject({ tipoMime: 'application/pdf', hashArquivo: 'b'.repeat(64) });
    expect(Buffer.from(String(corpo.documento['conteudoBase64']), 'base64').toString()).toBe(
      '%PDF-1.7 receita assinada sintética',
    );
  });
  it('sem o documento assinado no armazém, nada vai à plataforma', async () => {
    const d = dubles();
    const http = vi.fn();
    const c = {
      ...d.c('producao', http as unknown as typeof fetch),
      lerArquivo: async () => {
        throw new Error('faltando');
      },
    };
    await expect(entregarPrescricaoDigital(c, parceiro, envio, 'h1')).rejects.toThrow(
      /documento assinado indisponível/,
    );
    expect(http).not.toHaveBeenCalled();
    expect(d.alteracoes).toHaveLength(0);
  });
  it('a recusa da plataforma é resultado final: grava rejeitada e a mensagem não volta à fila', async () => {
    const d = dubles();
    const http = vi.fn(
      async () => new Response(JSON.stringify({ situacao: 'rejeitada', motivo: 'CRM inválido' })),
    );
    const r = await entregarPrescricaoDigital(
      d.c('producao', http as unknown as typeof fetch),
      parceiro,
      envio,
      'h1',
    );
    expect(r.resposta).toMatch(/recusada pela plataforma: CRM inválido/);
    expect(d.alteracoes[0]).toMatchObject({ situacao: 'rejeitada' });
  });
  it('a aceita sem endereço https fica em erro no envio, com a resposta guardada, sem nova tentativa', async () => {
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
    const r = await entregarPrescricaoDigital(
      d.c('producao', http as unknown as typeof fetch),
      parceiro,
      envio,
      'h1',
    );
    expect(r.resposta).toMatch(/endereço de validação https/);
    expect(d.alteracoes[0]).toMatchObject({ situacao: 'erro' });
    expect(d.alteracoes[0]!['url_validacao']).toBeUndefined();
    expect(JSON.parse(String(d.alteracoes[0]!['conteudo_retorno']))).toMatchObject({
      recusa: 'retorno-incompleto',
    });
  });
});

describe('gravarRetornoPrescricao', () => {
  it('o retorno atrasado (não aceito) de envio cancelado no hospital é ignorado', async () => {
    const d = dubles('cancelada');
    const tx = {
      consultarParaAtualizar: async () => [{ id: 7, situacao: 'cancelada', versao: 3 }],
      alterar: vi.fn(),
    } as unknown as TxOperacao;
    const r = await gravarRetornoPrescricao(
      tx,
      7,
      {
        situacao: 'rejeitada',
        identificadorExterno: null,
        codigoValidacao: null,
        urlValidacao: null,
        situacaoExterna: null,
        motivo: 'atrasado',
      },
      new Date(),
    );
    expect(r).toMatch(/^ignorado/);
    expect(d.alteracoes).toHaveLength(0);
  });
});
