// Cliente da agência transfusional (M47, etapa 1): as gravações levam o CSRF e a Idempotency-Key; a recusa com os
// bloqueios vira ErroApi com os códigos (a tela mostra cada motivo).
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { bloqueiosDaRecusa, iniciarTransfusao, lerRequisicoes } from './api-transfusao.js';

describe('cliente da agência transfusional', () => {
  it('o filtro vazio não vai na URL; o início leva a chave e devolve os bloqueios da recusa', async () => {
    const buscar = vi.fn(async (url: string) => {
      void url;
      return new Response(JSON.stringify({ itens: [], cortada: false, agora: '', gravacao: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await lerRequisicoes({ estado: 'requisitada', urgencia: '' }, buscar as unknown as typeof fetch);
    expect(buscar.mock.calls[0]![0]).toBe('/api/sadt/transfusao/requisicoes?estado=requisitada');
    const recusa = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'urn:sgh:problema:recusa-de-negocio',
            status: 409,
            codigo: 'sem-segundo-profissional',
            bloqueios: ['sem-segundo-profissional', 'bolsa-vencida'],
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    );
    const e = await iniciarTransfusao(7, {}, undefined, recusa as unknown as typeof fetch).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ErroApi);
    expect(bloqueiosDaRecusa(e)).toEqual(['sem-segundo-profissional', 'bolsa-vencida']);
    const h = (recusa.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h['idempotency-key']).toMatch(/^transfusao\./);
    expect(bloqueiosDaRecusa(new Error('x'))).toEqual([]);
  });
});
