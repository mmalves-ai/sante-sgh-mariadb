// Filtro comum do paciente com acesso restrito (F8, 02-CAD linha 10): quais rotas passam, de onde sai o paciente e o
// desfecho (segue, 403 com a oferta da quebra de vidro e a trilha, 503 sem decisão).
import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AcessoRestritoProprio, DecisaoRestrito } from './acesso-restrito-proprio.js';
import {
  alvoDaRequisicao,
  caminhoClinico,
  InterceptadorAcessoRestrito,
} from './acesso-restrito.interceptor.js';

describe('rotas clínicas e alvo da requisição', () => {
  it('passa pelos módulos clínicos e não pelos demais', () => {
    for (const u of [
      '/api/pep/7/evolucoes',
      '/api/enfermagem/sae/3',
      '/api/sadt?paciente=1',
      '/api/internacao',
      '/api/cirurgia/x',
      '/api/farmacia/y',
      '/api/nutricao/z',
    ])
      expect(caminhoClinico(u)).toBe(true);
    for (const u of ['/api/cadastros/pacientes/1', '/api/pepx/1', '/api/faturamento/contas'])
      expect(caminhoClinico(u)).toBe(false);
  });
  it('paciente da rota antes da consulta; atendimento quando não há paciente', () => {
    expect(alvoDaRequisicao({ params: { paciente: '12' }, query: { paciente: '99' } })).toEqual({
      paciente: 12,
      atendimento: null,
    });
    expect(alvoDaRequisicao({ params: {}, query: { idPaciente: '5' } })).toEqual({
      paciente: 5,
      atendimento: null,
    });
    expect(alvoDaRequisicao({ params: { atendimento: '8' } })).toEqual({ paciente: null, atendimento: 8 });
    expect(alvoDaRequisicao({ params: { paciente: 'abc' } })).toEqual({ paciente: null, atendimento: null });
  });
});

function contexto(url: string, params: Record<string, string>) {
  const req = {
    originalUrl: url,
    url,
    params,
    query: {},
    headers: {},
    sgh: {
      sessao: { estabelecimentoAtivo: 'h1', rede: 'r', usuario: { id: '3', login: 'ana', ator: 'cliente' } },
    },
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
const porta = (d: DecisaoRestrito | Error, paciente: number | null = 4) =>
  ({
    decidir: vi.fn(() => (d instanceof Error ? Promise.reject(d) : Promise.resolve(d))),
    pacienteDoAtendimento: vi.fn(() => Promise.resolve(paciente)),
  }) as unknown as AcessoRestritoProprio;
const proximo = { handle: () => of('dado') };
const rodar = (i: InterceptadorAcessoRestrito, ctx: ExecutionContext) =>
  lastValueFrom(i.intercept(ctx, proximo)).then(
    (v) => ({ ok: v }),
    (e: { status?: number; tipo?: string; extensoes?: unknown; getStatus?: () => number }) => ({
      status: e.status ?? e.getStatus?.(),
      erro: e,
    }),
  );

describe('InterceptadorAcessoRestrito', () => {
  it('sem marca ou liberado, segue', async () => {
    expect(
      await rodar(
        new InterceptadorAcessoRestrito(porta({ desfecho: 'livre', marcas: [] })),
        contexto('/api/pep/4', { paciente: '4' }),
      ),
    ).toEqual({
      ok: 'dado',
    });
    expect(
      await rodar(
        new InterceptadorAcessoRestrito(porta({ desfecho: 'atende', marcas: [1] })),
        contexto('/api/pep/4', { paciente: '4' }),
      ),
    ).toEqual({
      ok: 'dado',
    });
  });
  it('não liberado: 403 paciente-restrito e a tentativa na trilha', async () => {
    const trilha = { registrar: vi.fn(() => Promise.resolve()) };
    const p = porta({ desfecho: 'quebra-de-vidro', marcas: [9] });
    const r = await rodar(
      new InterceptadorAcessoRestrito(p, trilha as never),
      contexto('/api/enfermagem/sae/8', { atendimento: '8' }),
    );
    expect(r).toMatchObject({ status: 403 });
    expect((p.pacienteDoAtendimento as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([8]);
    expect(trilha.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        resultado: 'falha',
        paciente: 4,
        chaveNaturalAlvo: 'paciente-restrito:quebra-de-vidro',
      }),
    );
  });
  it('sem decisão (banco fora): 503, nada mostrado; rota não clínica nem consulta', async () => {
    expect(
      await rodar(
        new InterceptadorAcessoRestrito(porta(new Error('x'))),
        contexto('/api/pep/4', { paciente: '4' }),
      ),
    ).toMatchObject({
      status: 503,
    });
    const p = porta(new Error('x'));
    expect(
      await rodar(
        new InterceptadorAcessoRestrito(p),
        contexto('/api/cadastros/pacientes/4', { paciente: '4' }),
      ),
    ).toEqual({
      ok: 'dado',
    });
    expect(p.decidir).not.toHaveBeenCalled();
  });
});
