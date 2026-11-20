// Cliente da agência transfusional, etapa 2 (M47): o filtro vazio não vai na URL; as gravações levam o CSRF e a
// Idempotency-Key; a recusa com os bloqueios vira ErroApi com os códigos.
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../../casca/erros/problem-details.js';
import {
  lerCadastrosDoEstoque,
  lerEstoque,
  lerImunos,
  movimentarBolsa,
  receberBolsa,
} from './api-agencia.js';
import { bloqueiosDaRecusa } from './api-transfusao.js';

const ok = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });

describe('cliente da agência transfusional (etapa 2)', () => {
  it('as leituras com o filtro e as gravações com a chave; a recusa traz os bloqueios', async () => {
    const buscar = vi.fn(async (url: string) => {
      void url;
      return ok({ itens: [], cortada: false, resumo: [], agora: '', gravacao: {} });
    });
    await lerEstoque({ situacao: 'liberada', abo: '' }, buscar as unknown as typeof fetch);
    expect(buscar.mock.calls[0]![0]).toBe('/api/sadt/agencia/bolsas?situacao=liberada');
    await lerImunos({}, buscar as unknown as typeof fetch);
    expect(buscar.mock.calls[1]![0]).toBe('/api/sadt/agencia/imuno');
    await lerCadastrosDoEstoque(buscar as unknown as typeof fetch);
    expect(buscar.mock.calls[2]![0]).toBe('/api/sadt/agencia/estoque/cadastros');
    const grava = vi.fn(async () => ok({ ok: true, id: 3, mensagem: 'Bolsa recebida e liberada.' }));
    await receberBolsa({} as never, 'bolsa.k1', grava as unknown as typeof fetch);
    const h = (grava.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h['idempotency-key']).toBe('bolsa.k1');
    const recusa = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'urn:sgh:problema:recusa-de-negocio',
            status: 409,
            codigo: 'prova-cruzada-pendente',
            bloqueios: ['prova-cruzada-pendente'],
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    );
    const e = await movimentarBolsa(3, {} as never, 'k2', recusa as unknown as typeof fetch).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ErroApi);
    expect(bloqueiosDaRecusa(e)).toEqual(['prova-cruzada-pendente']);
    expect((recusa.mock.calls[0] as unknown as [string])[0]).toBe('/api/sadt/agencia/bolsas/3/movimentos');
  });
});
