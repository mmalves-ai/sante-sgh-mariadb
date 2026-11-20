import { describe, expect, it } from 'vitest';
import { buscarMarca, buscarSessao, buscarVersao, trocarEstabelecimento } from './api.js';
import { ErroApi } from './casca/erros/problem-details.js';

const versao = {
  produto: 'Produto de teste',
  versao: '0.1.0',
  commit: 'abc123def456',
  construidoEm: '2026-10-19T19:30:00.000Z',
  identificacao: '0.1.0+abc123def456',
};
const resposta = (corpo: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('cliente da API', () => {
  it('lê a versão e a marca e valida o contrato', async () => {
    await expect(buscarVersao(resposta(versao))).resolves.toEqual(versao);
    await expect(buscarMarca(resposta({ produto: 'P', marca: 'rede-sante', rede: null }))).resolves.toEqual({
      produto: 'P',
      marca: 'rede-sante',
      rede: null,
    });
  });

  it('erro vira ErroApi com o Problem Details', async () => {
    const e = await buscarSessao(
      resposta({ type: 'urn:sgh:problema:nao-autenticado', status: 401 }, 401),
    ).catch((x) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect((e as ErroApi).status).toBe(401);
  });

  it('troca de estabelecimento faz POST com o código', async () => {
    let corpo = '';
    const buscar = (async (_u: string, init?: RequestInit) => {
      corpo = String(init?.body);
      return new Response(
        JSON.stringify({
          usuario: { id: 's', nome: 'S' },
          rede: null,
          estabelecimentos: [],
          estabelecimentoAtivo: 'bb',
          permissoes: [],
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
        }),
      );
    }) as unknown as typeof fetch;
    await expect(trocarEstabelecimento('bb', buscar)).resolves.toMatchObject({ estabelecimentoAtivo: 'bb' });
    expect(JSON.parse(corpo)).toEqual({ codigo: 'bb' });
  });
});
