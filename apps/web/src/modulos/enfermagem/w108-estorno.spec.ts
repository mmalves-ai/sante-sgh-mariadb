// W1-08: o cliente do estorno leva o motivo da lista e a devolução pendente; a recusa da dose com baixa de estoque é
// reconhecida para a tela avisar e oferecer a devolução. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { estoqueBaixadoDaRecusa, estornar } from './api-enfermagem.js';
import { mensagensEnfermagem } from './i18n.js';

describe('W1-08: estorno da checagem na tela', () => {
  it('envia o motivo, a justificativa e a devolução pendente com a chave', async () => {
    let pedido: { url: string; corpo: unknown; chave: string | null } | null = null;
    const buscar = (async (url: string, init: RequestInit) => {
      pedido = {
        url,
        corpo: JSON.parse(String(init.body)),
        chave: (init.headers as Record<string, string>)['idempotency-key'] ?? null,
      };
      return new Response(
        JSON.stringify({
          ok: true,
          horario: 7,
          situacao: 'P',
          devolucaoPendente: true,
          repetida: false,
          mensagem: 'x',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const r = await estornar(
      7,
      { motivo: 'nao-administrado', justificativa: 'dose não administrada', devolucaoPendente: true },
      'estorno-7-abcdef',
      buscar,
    );
    expect(r.devolucaoPendente).toBe(true);
    expect(pedido).toMatchObject({
      url: expect.stringMatching(/\/horarios\/7\/estornar$/),
      corpo: { motivo: 'nao-administrado', justificativa: 'dose não administrada', devolucaoPendente: true },
      chave: 'estorno-7-abcdef',
    });
  });

  it('reconhece a recusa estoque-baixado (e só ela)', () => {
    const baixa = new ErroApi(
      {
        type: 'recusa',
        title: 'Recusa',
        status: 409,
        codigo: 'estoque-baixado',
        detail: 'A dose já baixou estoque',
      },
      409,
    );
    expect(estoqueBaixadoDaRecusa(baixa)).toBe('A dose já baixou estoque');
    const outra = new ErroApi(
      { type: 'recusa', title: 'Recusa', status: 409, codigo: 'horario-nao-checado' },
      409,
    );
    expect(estoqueBaixadoDaRecusa(outra)).toBeNull();
    expect(estoqueBaixadoDaRecusa(new Error('x'))).toBeNull();
  });

  it('a tela tem os dois motivos, a oferta da devolução e nada de "desligado"', () => {
    const c = mensagensEnfermagem.checagem;
    expect(Object.keys(c.estornoMotivos)).toEqual(['nao-administrado', 'checado-por-engano']);
    expect(c.devolverDose).toMatch(/Devolver a dose/);
    expect(c.estornarComPendencia).toMatch(/devolução pendente/);
    const { checagem, aprazamento, turno } = mensagensEnfermagem;
    expect(JSON.stringify({ checagem, aprazamento, turno })).not.toMatch(/desligad|não muda/i);
    expect(mensagensEnfermagem.turno.contencao.ordemVencida).toMatch(/vencida/);
  });
});
