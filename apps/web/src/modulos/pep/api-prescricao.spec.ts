// Cliente dos cadastros de prescrição em consulta e da prescrição impressa (M24): a busca vai na consulta, a resposta
// é conferida pelo contrato e a reimpressão leva o motivo da 2ª via.
import { describe, expect, it } from 'vitest';
import { imprimirPrescricao, lerCadastroPrescricao } from './api-prescricao.js';

function falso(resposta: Response, pedidos: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    pedidos.push({ url: String(url), ...(init ? { init } : {}) });
    return resposta.clone();
  }) as typeof fetch;
}

describe('cadastros de prescrição e impressão (M24)', () => {
  it('a busca vai codificada, sem espaços nas pontas e com o teto de 60 letras', async () => {
    const pedidos: { url: string }[] = [];
    const corpo = {
      secao: 'kitsMedicamento',
      linhas: [
        { id: '1', nome: 'CEFTRIAXONA', ativo: true, campos: { via: 'EV', agora: false }, filhos: [] },
      ],
      truncada: false,
    };
    const r = await lerCadastroPrescricao(
      'kitsMedicamento',
      `  ceftri ão ${'x'.repeat(80)}`,
      falso(new Response(JSON.stringify(corpo), { status: 200 }), pedidos),
    );
    expect(r.linhas[0]?.nome).toBe('CEFTRIAXONA');
    const url = new URL(pedidos[0]!.url, 'http://x');
    expect(url.pathname).toBe('/api/pep/prescricao/cadastros/kitsMedicamento');
    expect(url.searchParams.get('termo')?.length).toBe(60);
    expect(url.searchParams.get('termo')?.startsWith('ceftri ão')).toBe(true);
    await lerCadastroPrescricao(
      'receitasPadrao',
      '   ',
      falso(new Response(JSON.stringify({ ...corpo, secao: 'receitasPadrao' })), pedidos),
    );
    expect(pedidos[1]!.url).toBe('/api/pep/prescricao/cadastros/receitasPadrao');
  });

  it('resposta fora do contrato é recusada', async () => {
    await expect(
      lerCadastroPrescricao('kitsMedicamento', '', falso(new Response(JSON.stringify({ linhas: 1 })), [])),
    ).rejects.toThrow();
  });

  it('impressão: o PDF volta como arquivo; a reimpressão leva o motivo', async () => {
    const pedidos: { url: string; init?: RequestInit }[] = [];
    const pdf = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    const b = await imprimirPrescricao(1001, 7, null, falso(pdf, pedidos));
    expect(b.size).toBe(4);
    expect(pedidos[0]!.url).toBe('/api/pep/prescricao/1001/prescricoes/7/imprimir');
    expect(pedidos[0]!.init?.body).toBe('{}');
    await imprimirPrescricao(1001, 7, 'Reimpressão para a enfermagem', falso(pdf, pedidos));
    expect(JSON.parse(String(pedidos[1]!.init?.body))).toEqual({
      justificativa: 'Reimpressão para a enfermagem',
    });
  });
});
