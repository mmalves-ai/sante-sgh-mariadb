// Filtro comum do paciente com acesso restrito (F8, 02-CAD linha 10): quais rotas passam, de onde sai o paciente e o
// desfecho (segue, 403 com a oferta da quebra de vidro e a trilha, 503 sem decisão).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AcessoRestritoProprio, DecisaoRestrito } from './acesso-restrito-proprio.js';
import {
  alvoDaRequisicao,
  CHAVES_ALVO,
  caminhoClinico,
  InterceptadorAcessoRestrito,
  RESOLVEDORES_DE_ROTA,
} from './acesso-restrito.interceptor.js';

describe('rotas clínicas e alvo da requisição', () => {
  it('passa pelos módulos clínicos (inclusive internacoes, documentos-internacao e /api/api/sadt) e não pelos demais', () => {
    for (const u of [
      '/api/pep/7/evolucoes',
      '/api/enfermagem/sae/3',
      '/api/sadt?paciente=1',
      '/api/api/sadt/catalogo/1',
      '/api/internacao',
      '/api/internacoes/5',
      '/api/documentos-internacao/internacao/5',
      '/api/cirurgia/x',
      '/api/farmacia/y',
      '/api/nutricao/z',
    ])
      expect(caminhoClinico(u)).toBe(true);
    for (const u of [
      '/api/cadastros/pacientes/1',
      '/api/pepx/1',
      '/api/faturamento/contas',
      '/api/api/faturamento',
    ])
      expect(caminhoClinico(u)).toBe(false);
  });
  it('paciente direto (inclusive :p) antes do recurso; consulta; atendimento e demais recursos', () => {
    expect(alvoDaRequisicao({ params: { paciente: '12' }, query: { paciente: '99' } })).toEqual({
      paciente: 12,
      recurso: null,
    });
    expect(alvoDaRequisicao({ params: { p: '7', tipo: 'evolucao', id: '3' } })).toEqual({
      paciente: 7,
      recurso: null,
    });
    expect(alvoDaRequisicao({ params: {}, query: { idPaciente: '5' } })).toEqual({
      paciente: 5,
      recurso: null,
    });
    expect(alvoDaRequisicao({ params: { atendimento: '8' } })).toEqual({
      paciente: null,
      recurso: { tipo: 'atendimento', id: 8 },
    });
    expect(alvoDaRequisicao({ params: { atd: '8' } }).recurso).toEqual({ tipo: 'atendimento', id: 8 });
    expect(alvoDaRequisicao({ params: { int: '2' } }).recurso).toEqual({ tipo: 'internacao', id: 2 });
    expect(alvoDaRequisicao({ params: { agenda: '3' } }).recurso).toEqual({
      tipo: 'agendamento-cirurgico',
      id: 3,
    });
    expect(alvoDaRequisicao({ params: { ato: '4' } }).recurso).toEqual({ tipo: 'ato-cirurgico', id: 4 });
    expect(alvoDaRequisicao({ params: { paciente: 'abc' } })).toEqual({ paciente: null, recurso: null });
  });
  it('resolvedor declarado da rota: o :reg de internacoes é a internação; o :id de outra rota não é nada', () => {
    expect(alvoDaRequisicao({ rota: '/api/internacoes/:reg/alta', params: { reg: '6' } }).recurso).toEqual({
      tipo: 'internacao',
      id: 6,
    });
    expect(alvoDaRequisicao({ rota: '/api/cirurgia/agendamentos/:id', params: { id: '6' } }).recurso).toEqual(
      {
        tipo: 'agendamento-cirurgico',
        id: 6,
      },
    );
    expect(alvoDaRequisicao({ rota: '/api/nutricao/:reg', params: { reg: '6' } })).toEqual({
      paciente: null,
      recurso: null,
    });
  });
  it('gravação: o paciente ou o atendimento no corpo; leitura ignora o corpo', () => {
    expect(alvoDaRequisicao({ method: 'POST', params: {}, body: { pacienteId: 9, texto: 'x' } })).toEqual({
      paciente: 9,
      recurso: null,
    });
    expect(alvoDaRequisicao({ method: 'PUT', params: {}, body: { atendimento: '10' } }).recurso).toEqual({
      tipo: 'atendimento',
      id: 10,
    });
    expect(alvoDaRequisicao({ method: 'GET', params: {}, body: { paciente: 9 } })).toEqual({
      paciente: null,
      recurso: null,
    });
  });
});

// Varredura das rotas registradas nos módulos clínicos (fonte dos controllers): todo prefixo clínico coberto, todo
// parâmetro com cara de paciente resolvido e a lista das rotas por id genérico sem resolvedor só diminui.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PASTAS = ['pep', 'enfermagem', 'sadt', 'internacao', 'cirurgia', 'farmacia', 'nutricao', 'adt'];
function rotasClinicas(): { arquivo: string; prefixo: string; rota: string; params: string[] }[] {
  const out: { arquivo: string; prefixo: string; rota: string; params: string[] }[] = [];
  const andar = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? andar(join(d, e.name)) : e.name.endsWith('.controller.ts') ? [join(d, e.name)] : [],
    );
  for (const pasta of PASTAS)
    for (const arq of andar(join(RAIZ, pasta))) {
      const src = readFileSync(arq, 'utf8');
      let prefixo = '';
      for (const m of src.matchAll(/@(Controller|Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?/g)) {
        if (m[1] === 'Controller') {
          prefixo = m[2] ?? '';
          out.push({ arquivo: arq, prefixo, rota: '', params: [] });
          continue;
        }
        const rota = `/${['api', prefixo, m[2] ?? '']
          .map((x) => x.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/')}`;
        out.push({
          arquivo: arq,
          prefixo,
          rota,
          params: [...rota.matchAll(/:([A-Za-z]+)/g)].map((x) => x[1]!),
        });
      }
    }
  return out;
}
const AREA_CLINICA =
  /^(?:api\/)?(?:pep|enfermagem|sadt|internac|documentos-internacao|cirurgia|farmacia|nutricao)/;
// Rotas clínicas com só um id genérico (:id, :reg, :item...) sem resolvedor declarado, medidas em 25/11/2026: a maioria
// é de cadastro e catálogo; as por paciente leem com req.sghAlvo (conferido depois do método) ou ganham resolvedor.
const PENDENTES_TETO = 333;

describe('cobertura das rotas clínicas registradas', () => {
  const rotas = rotasClinicas();
  it('todo prefixo de controller de área clínica passa pelo filtro', () => {
    const fora = rotas
      .filter((r) => !r.rota && AREA_CLINICA.test(r.prefixo))
      .filter((r) => !caminhoClinico(`/api/${r.prefixo}`))
      .map((r) => r.prefixo);
    expect(fora).toEqual([]);
  });
  it('parâmetro com cara de paciente ou recurso clínico sempre resolvido; pendentes só diminuem', () => {
    const clinicas = rotas.filter((r) => r.rota && caminhoClinico(r.rota));
    expect(clinicas.length).toBeGreaterThan(300);
    const resolvida = (r: { rota: string; params: string[] }) =>
      r.params.some((p) => p in CHAVES_ALVO) ||
      RESOLVEDORES_DE_ROTA.some((x) => x.rota.test(r.rota) && r.params.includes(x.param));
    const suspeita = /^(?:p|pac|paciente.*|atd|atend.*|int|internac.*|agenda|ato|prontuario|prescricao)$/i;
    const semResolver = clinicas.filter((r) => !resolvida(r) && r.params.some((p) => suspeita.test(p)));
    expect(semResolver.map((r) => r.rota)).toEqual([]);
    // As rotas /:p/ do prontuário (cabeçalho, linha do tempo, documentos, alergias, exportar) estão cobertas.
    for (const sufixo of ['cabecalho', 'linha-do-tempo', 'exportar'])
      expect(clinicas.some((r) => r.rota.includes(`/:p/${sufixo}`) && resolvida(r))).toBe(true);
    const pendentes = clinicas.filter((r) => r.params.length && !resolvida(r));
    console.info(`rotas clínicas: ${clinicas.length}; com id genérico sem resolvedor: ${pendentes.length}`);
    expect(pendentes.length).toBeLessThanOrEqual(PENDENTES_TETO);
  });
});

function contexto(url: string, params: Record<string, string>, extra: Record<string, unknown> = {}) {
  const req = {
    method: 'GET',
    originalUrl: url,
    url,
    params,
    query: {},
    headers: {},
    sgh: {
      sessao: { estabelecimentoAtivo: 'h1', rede: 'r', usuario: { id: '3', login: 'ana', ator: 'cliente' } },
    },
    ...extra,
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
const porta = (d: DecisaoRestrito | Error, paciente: number | null = 4) =>
  ({
    decidir: vi.fn(() => (d instanceof Error ? Promise.reject(d) : Promise.resolve(d))),
    pacienteDoRecurso: vi.fn(() => Promise.resolve(paciente)),
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
    expect((p.pacienteDoRecurso as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['atendimento', 8]);
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
  it('depois do método: o paciente que a rota declarou (sghAlvo) é conferido; negado, a resposta não sai', async () => {
    const req: Record<string, unknown> = {};
    const ctx = contexto('/api/enfermagem/lesoes/77', { id: '77' }, req);
    const r0 = ctx.switchToHttp().getRequest() as Record<string, unknown>;
    const p = porta({ desfecho: 'quebra-de-vidro', marcas: [9] });
    const i = new InterceptadorAcessoRestrito(p);
    const r = await lastValueFrom(
      i.intercept(ctx, {
        handle: () => {
          r0['sghAlvo'] = { paciente: 4, tabelaAlvo: 'lesao' };
          return of('dado sigiloso');
        },
      }),
    ).then(
      (v) => ({ ok: v }),
      (e: { status?: number; getStatus?: () => number }) => ({ status: e.status ?? e.getStatus?.() }),
    );
    expect(r).toEqual({ status: 403 });
    expect((p.decidir as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({ paciente: 4 });
  });
  it('gravação com o paciente no corpo passa pela decisão antes do método', async () => {
    const p = porta({ desfecho: 'negado', marcas: [9] });
    let gravou = false;
    const r = await lastValueFrom(
      new InterceptadorAcessoRestrito(p).intercept(
        contexto('/api/pep/evolucoes', {}, { method: 'POST', body: { paciente: 4, texto: 'x' } }),
        {
          handle: () => {
            gravou = true;
            return of('ok');
          },
        },
      ),
    ).then(
      (v) => ({ ok: v }),
      (e: { status?: number; getStatus?: () => number }) => ({ status: e.status ?? e.getStatus?.() }),
    );
    expect(r).toEqual({ status: 403 });
    expect(gravou).toBe(false);
  });
});
