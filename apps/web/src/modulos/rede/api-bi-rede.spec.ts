// @vitest-environment jsdom
// M57 (etapa 3): o cliente do BI da Rede valida a resposta pelo contrato (fora dele, recusa), monta a consulta só com o
// preenchido, manda o registro e a alteração dos serviços por POST com o CSRF e a Idempotency-Key; os textos não citam
// o outro sistema pelo nome, nome de tabela nem a marca fixa de uma rede (ADR 0023; DP-49).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alterarServicoRede,
  consulta,
  enderecoPlanilhaBiRede,
  lerBiRede,
  lerPainelBiRede,
  lerSerieBiRede,
  lerServicosRede,
  registrarServicoRede,
} from './api-bi-rede.js';
import { mensagensBiRede } from './i18n-bi.js';

afterEach(() => vi.unstubAllGlobals());

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}
const est = (codigo: string) => ({
  codigo,
  nome: `Estabelecimento ${codigo}`,
  situacao: 'incluido',
  motivo: null,
  dadosAte: null,
  ultimoMovimento: null,
});
const ficha = {
  codigo: 'admissoes',
  nome: 'Internações (admissões)',
  formula: 'f',
  numerador: 'n',
  denominador: null,
  unidade: 'quantidade',
  polaridade: 'neutra',
  versao: 1,
  limitacoes: [],
};
const valor = {
  periodo: '2025-01',
  numerador: 3,
  denominador: null,
  valor: 3,
  parcial: false,
  parcelas: [
    { estabelecimento: 'pc', numerador: 1, denominador: null, valor: 1, parcial: false },
    { estabelecimento: 'sx', numerador: 2, denominador: null, valor: 2, parcial: false },
  ],
  conta: '1 + 2 = 3',
};
const servico = {
  estabelecimento: 'pc',
  id: 1,
  area: 'compras',
  titulo: 'Compra SINTETICA',
  descricao: null,
  estabelecimentos: ['pc', 'sx'],
  situacao: 'registrada',
  registradoPor: 'SINT.DIRETORIA.REDE',
  registradoEm: '2026-10-25T10:00:00.000',
  atualizadoPor: null,
  atualizadoEm: null,
};

describe('cliente do BI da Rede', () => {
  it('consulta só com o preenchido; o endereço da planilha', () => {
    expect(consulta({ de: '2025-01', ate: '', x: undefined })).toBe('?de=2025-01');
    expect(consulta({})).toBe('');
    expect(enderecoPlanilhaBiRede('admissoes', { de: '2025-01' })).toBe(
      '/api/relatorios/bi/rede/indicadores/admissoes/exportar?de=2025-01',
    );
  });

  it('o consolidado, a série e o painel pelo contrato; fora dele, recusa', async () => {
    const buscar = vi.fn(async (url: string) => {
      if (url.includes('/indicadores/'))
        return resposta({
          ficha,
          periodo: { de: '2025-01', ate: '2025-01' },
          estabelecimentos: [est('pc'), est('sx')],
          valores: [valor],
          recusa: null,
          notas: [],
        });
      if (url.includes('/paineis/'))
        return resposta({
          painel: 'operacional',
          periodo: { de: '2025-01', ate: '2025-01' },
          estabelecimentos: [est('pc')],
          series: [],
          notas: [],
        });
      return resposta({
        periodo: { de: '2025-01', ate: '2025-01' },
        estabelecimentos: [est('pc'), est('sx')],
        indicadores: [{ ficha, ultimo: valor, recusa: null }],
        pseudonimo: 'por-estabelecimento',
        notas: [],
        geradoEm: '2026-10-25T10:00:00.000Z',
      });
    });
    const b = await lerBiRede({ de: '2025-01' }, buscar as unknown as typeof fetch);
    expect(b.indicadores[0]!.ultimo!.conta).toBe('1 + 2 = 3');
    expect(buscar.mock.calls[0]![0]).toBe('/api/relatorios/bi/rede?de=2025-01');
    expect((await lerSerieBiRede('admissoes', {}, buscar as unknown as typeof fetch)).valores).toHaveLength(
      1,
    );
    expect((await lerPainelBiRede('operacional', {}, buscar as unknown as typeof fetch)).painel).toBe(
      'operacional',
    );
    const fora = vi.fn(async () => resposta({ periodo: 1 }));
    await expect(lerBiRede({}, fora as unknown as typeof fetch)).rejects.toThrow();
    const erro = vi.fn(async () =>
      resposta({ type: 'recurso-desligado', title: 'Funcionalidade desligada', status: 403 }, 403),
    );
    await expect(lerBiRede({}, erro as unknown as typeof fetch)).rejects.toThrow();
  });

  it('serviços: lista, registrar e alterar por POST com o CSRF e a Idempotency-Key', async () => {
    document.cookie = 'sgh_csrf=token-sintetico';
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const buscar = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, ...(init ? { init } : {}) });
      if (init?.method === 'POST' && url.endsWith('/servicos')) return resposta(servico, 201);
      if (init?.method === 'POST') return resposta({ registro: servico, mudou: true });
      return resposta({
        itens: [servico],
        total: 1,
        truncado: false,
        estabelecimentos: [{ codigo: 'pc', nome: 'A' }],
        foraDoAr: [],
      });
    });
    const f = buscar as unknown as typeof fetch;
    expect((await lerServicosRede({ area: 'compras', pagina: 1 }, f)).total).toBe(1);
    expect(chamadas[0]!.url).toBe('/api/rede/servicos?area=compras&pagina=1');
    await lerServicosRede({ busca: 'luvas', pagina: 2 }, f);
    expect(chamadas[1]!.url).toBe('/api/rede/servicos?busca=luvas&pagina=2');
    chamadas.splice(1, 1);
    await registrarServicoRede({ area: 'compras', titulo: 'Compra SINTETICA', estabelecimentos: ['pc'] }, f);
    expect((await alterarServicoRede('pc', 1, { situacao: 'adotada' }, f)).mudou).toBe(true);
    // A edição manda só os campos que mudaram.
    await alterarServicoRede('pc', 1, { titulo: 'Compra SINTETICA revista' }, f);
    expect(JSON.parse(String(chamadas[3]!.init!.body))).toEqual({ titulo: 'Compra SINTETICA revista' });
    for (const c of chamadas.slice(1)) {
      const h = c.init!.headers as Record<string, string>;
      expect(h['x-csrf']).toBeTruthy();
      expect(h['idempotency-key']).toMatch(/^web-/);
    }
    expect(chamadas[2]!.url).toBe('/api/rede/servicos/pc/1');
  });

  it('os textos não citam o outro sistema, tabela nem uma marca fixa de rede', () => {
    const tudo = JSON.stringify(mensagensBiRede);
    expect(tudo).not.toMatch(/SPDATA|legado|sistema atual|SGH_|RICADPAC|Santé|Sante /i);
  });
});
