// @vitest-environment jsdom
// C1-135 (06-FAT linha 38): o cliente da alçada do faturamento confere a lista pelo contrato (fora dele, recusa) e
// manda o pedido e a decisão por POST com a Idempotency-Key, no endereço do pedido.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decidirAlcada, lerPedidosAlcada, pedirAlcada } from './api-parametros-faturamento.js';

afterEach(() => vi.unstubAllGlobals());

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const PEDIDO = {
  id: 7,
  documento: 'fat_reabertura_competencia',
  referencia: 3,
  valor: 5000,
  motivo: 'conta esquecida',
  situacao: 'pendente',
  solicitante: 11,
  solicitanteNome: 'FATURISTA SINTETICO',
  solicitadoEm: '2026-11-27T10:00:00.000Z',
  decisor: null,
  decisorNome: null,
  decididoEm: null,
  nivel: null,
  motivoDecisao: null,
};

describe('cliente da alçada do faturamento', () => {
  it('lê os pedidos pelo contrato e recusa resposta fora dele', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resposta([PEDIDO]))
      .mockResolvedValueOnce(resposta([{ id: 'x' }]));
    vi.stubGlobal('fetch', f);
    expect(await lerPedidosAlcada()).toEqual([PEDIDO]);
    expect(String(f.mock.calls[0]![0])).toBe('/api/faturamento/alcada/pedidos');
    await expect(lerPedidosAlcada()).rejects.toThrow();
  });

  it('pede e decide por POST com a Idempotency-Key', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resposta({ pedido: 7, situacao: 'pendente' }))
      .mockResolvedValueOnce(resposta({ pedido: 7, situacao: 'aprovado', nivel: 2 }));
    vi.stubGlobal('fetch', f);
    const e = { documento: 'fat_aceite_glosa' as const, referencia: 3, valor: 10, motivo: 'aceite' };
    expect(await pedirAlcada(e, 'k1')).toMatchObject({ pedido: 7 });
    expect(await decidirAlcada(7, { aprovar: true }, 'k2')).toMatchObject({ situacao: 'aprovado' });
    const [u1, i1] = f.mock.calls[0]! as [string, RequestInit];
    const [u2, i2] = f.mock.calls[1]! as [string, RequestInit];
    expect(u1).toBe('/api/faturamento/alcada/pedidos');
    expect(u2).toBe('/api/faturamento/alcada/pedidos/7/decisao');
    expect(i1.method).toBe('POST');
    expect(JSON.parse(String(i1.body))).toEqual(e);
    expect(new Headers(i1.headers).get('Idempotency-Key')).toBe('k1');
    expect(new Headers(i2.headers).get('Idempotency-Key')).toBe('k2');
  });
});
