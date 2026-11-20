// @vitest-environment jsdom
// M51 (etapa 2): o cliente do BPA e dos solicitantes confere as respostas pelos contratos (fora deles, recusa), monta a
// consulta só com o preenchido e manda a geração por POST com o CSRF e a Idempotency-Key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buscarSolicitantesCadastroGeral,
  enderecoArquivoBpa,
  gerarBpa,
  lerLinhasBpa,
  lerParametrosLegadoSus,
} from './api-sus.js';

afterEach(() => vi.unstubAllGlobals());

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('cliente do BPA e dos solicitantes', () => {
  it('as linhas do BPA: consulta só com o preenchido e o esquema conferido', async () => {
    const buscar = vi.fn(async () =>
      resposta({
        itens: [
          {
            id: 1,
            tipo: 'c',
            folha: 1,
            sequencia: 1,
            procedimento: '0202010295',
            cbo: '225125',
            idade: 45,
            quantidade: 3,
            data: null,
            conta: null,
            atendimento: null,
          },
        ],
        total: 1,
        porTipo: { c: { linhas: 1, quantidade: 3 } },
      }),
    );
    const r = await lerLinhasBpa({ arquivo: 9, tipo: 'c' }, buscar as unknown as typeof fetch);
    expect(r.total).toBe(1);
    expect(buscar).toHaveBeenCalledWith('/api/sus/bpa/linhas?arquivo=9&tipo=c', expect.anything());
    const ruim = vi.fn(async () => resposta({ itens: [{ id: 'x' }], total: 1, porTipo: {} }));
    await expect(lerLinhasBpa({ arquivo: 9 }, ruim as unknown as typeof fetch)).rejects.toThrow();
  });

  it('gerar o BPA por POST com o CSRF e a Idempotency-Key; a recusa vira erro', async () => {
    const buscar = vi.fn(async () => resposta({ title: 'Operação recusada', status: 422 }, 422));
    await expect(
      gerarBpa({ competencia: '202609', versao: '0000000003' }, buscar as unknown as typeof fetch),
    ).rejects.toBeTruthy();
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sus/bpa/arquivo');
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(
      expect.arrayContaining(['x-csrf', 'idempotency-key']),
    );
    expect(enderecoArquivoBpa(7)).toBe('/api/sus/bpa/arquivos/7/conteudo');
  });

  it('o cadastro geral de solicitantes e os parâmetros do outro sistema', async () => {
    const buscar = vi.fn(async () =>
      resposta([{ id: 1, conselho: 520001, nome: 'MEDICO SINTETICO', uf: 'RJ', cbo: null, ativo: true }]),
    );
    const r = await buscarSolicitantesCadastroGeral('5200', buscar as unknown as typeof fetch);
    expect(r[0]?.conselho).toBe(520001);
    expect(buscar).toHaveBeenCalledWith('/api/sus/solicitantes/cadastro-geral?termo=5200', expect.anything());
    const p = vi.fn(async () => resposta({ competenciaAmbulatorio: null, versao: 'X', orgao: null }));
    expect(await lerParametrosLegadoSus(p as unknown as typeof fetch)).toEqual({
      competenciaAmbulatorio: null,
      versao: 'X',
      orgao: null,
    });
  });
});
