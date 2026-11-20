// "Voltar à minha conta" (ADR 0021): com a sessão da plataforma vencida, a volta recusada não deixa a sessão
// "como" viva no navegador: o cliente encerra pela própria sessão do SPDATA; só falha se as duas falharem.
import { describe, expect, it } from 'vitest';
import { voltarDoComo } from './api-suporte.js';

function buscarFalso(respostas: Record<string, number>, pedidos: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    pedidos.push(`${init?.method ?? 'GET'} ${url}`);
    const status = respostas[url] ?? 500;
    return new Response(status === 204 ? null : JSON.stringify({ status }), { status });
  }) as unknown as typeof fetch;
}

describe('voltar do "como"', () => {
  it('volta normal: só o DELETE da plataforma, levando os dois CSRF', async () => {
    const pedidos: string[] = [];
    document.cookie = 'sgh_csrf=csrf-sintetico';
    let cabecalhos: Record<string, string> = {};
    const buscar = (async (_u: string, init?: RequestInit) => {
      pedidos.push(String(_u));
      cabecalhos = init?.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await voltarDoComo(buscar);
    expect(pedidos).toEqual(['/api/plataforma/como']);
    expect(cabecalhos['x-csrf']).toBe('csrf-sintetico');
  });

  it('plataforma recusou (401/403): encerra pela sessão do SPDATA', async () => {
    const pedidos: string[] = [];
    await voltarDoComo(buscarFalso({ '/api/plataforma/como': 401, '/api/sessao': 204 }, pedidos));
    expect(pedidos).toEqual(['DELETE /api/plataforma/como', 'DELETE /api/sessao']);
  });

  it('as duas falharam: o erro sobe (a tela não diz que voltou)', async () => {
    const pedidos: string[] = [];
    await expect(
      voltarDoComo(buscarFalso({ '/api/plataforma/como': 403, '/api/sessao': 403 }, pedidos)),
    ).rejects.toThrow();
  });
});
