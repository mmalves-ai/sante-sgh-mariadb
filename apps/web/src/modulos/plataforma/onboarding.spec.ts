// Painel de onboarding (F4 L3), cliente web: chamadas com CSRF só nas gravações, validação pelos contratos e o
// acompanhamento só enquanto a execução está ativa.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  execucaoAtiva,
  lerExecucao,
  pedirExecucao,
  tamanhoLegivel,
  vincularOrigem,
} from './api-onboarding.js';

const EXECUCAO = {
  id: 4,
  tipo: 'importar',
  estado: 'lendo',
  etapa: 'contadas 3 de 10 tabelas',
  percentual: 20,
  motivoFalha: null,
  solicitadoEm: null,
  iniciadoEm: null,
  concluidoEm: null,
  registrosLidos: 100,
  arquivoInalterado: null,
  entidades: [],
  pendencias: { total: 0, criticas: 0, porRegra: [] },
};

function responder(corpo: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('api do painel de onboarding', () => {
  it('lê a execução sem CSRF e valida pelo contrato', async () => {
    const f = responder(EXECUCAO);
    expect((await lerExecucao('exemplo', 4)).percentual).toBe(20);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plataforma/onboarding/clientes/exemplo/execucoes/4');
    expect(init.method).toBe('GET');
    expect(JSON.stringify(init.headers)).not.toContain('x-csrf');
  });

  it('vincular é PUT e importar é POST, ambos com CSRF', async () => {
    let f = responder({ arquivo: 'a.fdb', tamanhoBytes: 8192, sha256: 'f'.repeat(64) });
    await vincularOrigem('exemplo', 'a.fdb');
    let [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual([
      '/api/plataforma/onboarding/clientes/exemplo/origem',
      'PUT',
      '{"arquivo":"a.fdb"}',
    ]);
    expect(JSON.stringify(init.headers)).toContain('x-csrf');
    f = responder({ execucao: 9 });
    expect(await pedirExecucao('exemplo', 'importar')).toEqual({ execucao: 9 });
    [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method]).toEqual(['/api/plataforma/onboarding/clientes/exemplo/execucoes', 'POST']);
  });

  it('acompanha só a execução ativa; tamanho legível', () => {
    expect(execucaoAtiva(EXECUCAO as never)).toBe(true);
    expect(execucaoAtiva({ ...EXECUCAO, estado: 'concluida' } as never)).toBe(false);
    expect(execucaoAtiva(null)).toBe(false);
    expect(tamanhoLegivel(48 * 1024 ** 3)).toBe('48 GB');
    expect(tamanhoLegivel(null)).toBe('—');
  });
});

describe('relatório de conciliação (L10)', () => {
  it('monta o endereço da exportação com o filtro', async () => {
    const { urlRelatorioCsv } = await import('./api-onboarding.js');
    expect(urlRelatorioCsv('cli_1', 7)).toBe(
      '/api/plataforma/onboarding/clientes/cli_1/execucoes/7/relatorio.csv',
    );
    expect(urlRelatorioCsv('cli_1', 7, { entidade: 'paciente', regra: 'cpf_duplicado' })).toBe(
      '/api/plataforma/onboarding/clientes/cli_1/execucoes/7/relatorio.csv?entidade=paciente&regra=cpf_duplicado',
    );
  });
});
