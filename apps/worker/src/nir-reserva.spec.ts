// M44 (etapa 2), regra 11, no `worker`: a reserva vencida expira UMA vez, com a solicitação reservada de volta à
// análise e a trilha; a solicitação que já mudou não volta; a linha travada por outro consumidor faz este desistir sem
// erro; o relógio é injetado. As leituras e gravações do núcleo são dublês (nada conecta a banco); a prova sobre a
// cópia é a nir-reserva.int.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = {
  vigentes: new Map<number, { solicitacao: number; validaAte: string }>(),
  solicitacoes: new Map<number, string>(),
  trilha: [] as string[],
  transicoes: [] as string[],
  travada: false,
  agoraLido: '' as string,
};

vi.mock('@sgh/legado', () => ({
  relogioRecepcao: async () => ({ hoje: '2026-10-24', agora: '2026-10-24T10:00:00' }),
  reservasVencidasNir: async (_l: unknown, _cod: string, agora: string) => {
    estado.agoraLido = agora;
    return [...estado.vigentes.entries()]
      .filter(([, r]) => r.validaAte < agora)
      .map(([id, r]) => ({ id, solicitacao: r.solicitacao, bloco: 'B1', acomodacao: '101', leito: 'A' }));
  },
  encerrarReservaSgh: async (_e: unknown, r: { reserva: number; vencidaEm: string }) => {
    if (estado.travada) throw new Error('lock conflict on no wait transaction');
    const x = estado.vigentes.get(r.reserva);
    if (!x || x.validaAte >= r.vencidaEm) return 0;
    estado.vigentes.delete(r.reserva);
    return 1;
  },
  solicitacaoNir: async (_e: unknown, _cod: string, id: number) =>
    estado.solicitacoes.has(id) ? { estado: estado.solicitacoes.get(id) } : null,
  transicionarSolicitacaoSgh: async (_e: unknown, t: { solicitacao: number; para: string }) => {
    estado.transicoes.push(`${t.solicitacao}>${t.para}`);
    estado.solicitacoes.set(t.solicitacao, t.para);
    return 1;
  },
  gravarTrilha: async (_e: unknown, l: { evento: string; idAlvo: string }) => {
    estado.trilha.push(`${l.evento}:${l.idAlvo}`);
    return { id: '1', hash: 'h' };
  },
  somenteSgh: (e: unknown) => e,
  ehTravaOcupada: (x: unknown) => x instanceof Error && /lock conflict/.test(x.message),
  lerCodigos: () => ['pc'],
  lerConfiguracaoNucleo: () => ({ bibliotecaCliente: null }),
  NucleoLegado: class {},
}));
vi.mock('@sgh/legado/nativo', () => ({ criarDriverNativo: () => ({}) }));

const { cicloExpiracao, expiracaoLigada, NirReservaService } = await import('./nir-reserva.service.js');
type Nucleo = Parameters<typeof cicloExpiracao>[0];

const nucleo = {
  rede: 'rede',
  lerSomente: async <T>(_c: unknown, fn: (l: never) => Promise<T>) => fn({} as never),
  gravarSgh: async <T>(_c: unknown, fn: (e: never) => Promise<T>) => fn({} as never),
  encerrar: async () => undefined,
} as unknown as Nucleo;

beforeEach(() => {
  estado.vigentes = new Map([
    [1, { solicitacao: 10, validaAte: '2026-10-24T09:00:00' }],
    [2, { solicitacao: 20, validaAte: '2026-10-24T11:00:00' }],
    [3, { solicitacao: 30, validaAte: '2026-10-24T09:30:00' }],
  ]);
  estado.solicitacoes = new Map([
    [10, 'reservado'],
    [20, 'reservado'],
    [30, 'em_transito'],
  ]);
  estado.trilha = [];
  estado.transicoes = [];
  estado.travada = false;
});

describe('expiração das reservas do NIR', () => {
  it('as vencidas no relógio injetado expiram uma vez; a reservada e a em trânsito voltam à análise (regra 11)', async () => {
    const r = await cicloExpiracao(nucleo, 'pc', '2026-10-24T10:00:00');
    expect(r).toEqual({ vencidas: 2, expiradas: 2 });
    expect(estado.transicoes).toEqual(['10>em_analise', '30>em_analise']);
    expect(estado.trilha).toEqual([
      'internacao.reservaLeito.expirada:1',
      'internacao.reservaLeito.expirada:3',
    ]);
    expect(estado.vigentes.has(2)).toBe(true);
    // Segundo ciclo (ou segundo consumidor depois do primeiro): nada mais.
    expect(await cicloExpiracao(nucleo, 'pc', '2026-10-24T10:00:00')).toEqual({ vencidas: 0, expiradas: 0 });
  });

  it('o relógio do banco sem injeção; a linha travada por outro consumidor: desiste sem erro', async () => {
    await cicloExpiracao(nucleo, 'pc');
    expect(estado.agoraLido).toBe('2026-10-24T10:00:00');
    estado.vigentes.set(9, { solicitacao: 90, validaAte: '2026-10-24T08:00:00' });
    estado.travada = true;
    expect(await cicloExpiracao(nucleo, 'pc', '2026-10-24T10:00:00')).toEqual({ vencidas: 1, expiradas: 0 });
    estado.travada = false;
    const outro = {
      ...nucleo,
      gravarSgh: async () => Promise.reject(new Error('falha de rede')),
    } as unknown as Nucleo;
    await expect(cicloExpiracao(outro, 'pc', '2026-10-24T10:00:00')).rejects.toThrow('falha de rede');
  });

  it('ligado fora de dev/ci; em dev/ci só com NIR_EXPIRACAO=ligado; o serviço com o núcleo de teste', async () => {
    expect(expiracaoLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(expiracaoLigada({ AMBIENTE: 'producao', NIR_EXPIRACAO: 'desligado' })).toBe(false);
    expect(expiracaoLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(expiracaoLigada({ AMBIENTE: 'ci', NIR_EXPIRACAO: 'ligado' })).toBe(true);
    const s = new NirReservaService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(nucleo);
    expect(await s.ciclo('2026-10-24T10:00:00')).toEqual([{ estabelecimento: 'pc', expiradas: 2 }]);
    s.usar({ ...nucleo, lerSomente: async () => Promise.reject(new Error('x')) } as unknown as Nucleo);
    expect(await s.ciclo('2026-10-24T10:00:00')).toEqual([]);
    await s.onApplicationShutdown();
  });
});
