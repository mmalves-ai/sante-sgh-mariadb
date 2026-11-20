// M44, regra 4, no `worker`: o estouro do tempo-alvo sem atendimento médico é avisado UMA vez por classificação, com o
// relógio injetado; com a chave desligada, nada; o atendimento médico iniciado para o relógio; o atendimento encerrado
// sai; dois consumidores no mesmo ciclo não duplicam (a chave única do aviso). As leituras e gravações do núcleo são
// trocadas por dublês (nada conecta a banco); a prova sobre a cópia é a classificacao-estouro.int.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = {
  ligada: true,
  avisos: new Set<string>(),
  trilha: [] as string[],
};

vi.mock('@sgh/legado', () => ({
  lerChavesLiberacao: async () =>
    estado.ligada
      ? [{ chave: 'pa.classificacao', tipo: 'recurso', ligada: true, escopo: 'hospital', valor: '*' }]
      : [],
  relogioRecepcao: async () => ({ hoje: '2026-10-24', agora: '2026-10-24T10:00:00' }),
  atendimentosPaAbertos: async () => ({
    itens: [
      { reg: 1, cabecalho: '11', saida: null, marcas: [] },
      {
        reg: 2,
        cabecalho: '12',
        saida: null,
        marcas: [{ etapa: 'atendimentoMedico', em: '2026-10-24T08:30:00' }],
      },
      { reg: 3, cabecalho: '13', saida: null, marcas: [{ etapa: 'decisao', em: '2026-10-24T09:00:00' }] },
      { reg: 4, cabecalho: '14', saida: null, marcas: [] },
    ],
    cortada: false,
  }),
  classificacoesDosAtendimentos: async () => [
    {
      id: 101,
      cabecalho: '11',
      corFinal: 'amarelo',
      em: '2026-10-24T08:00:00',
      tempoAlvoMin: 60,
      motivo: 'inicial',
    },
    {
      id: 102,
      cabecalho: '12',
      corFinal: 'amarelo',
      em: '2026-10-24T08:00:00',
      tempoAlvoMin: 60,
      motivo: 'inicial',
    },
    {
      id: 103,
      cabecalho: '13',
      corFinal: 'amarelo',
      em: '2026-10-24T08:00:00',
      tempoAlvoMin: 60,
      motivo: 'inicial',
    },
    {
      id: 104,
      cabecalho: '14',
      corFinal: 'verde',
      em: '2026-10-24T09:30:00',
      tempoAlvoMin: 120,
      motivo: 'inicial',
    },
  ],
  avisosJaGravados: async (_l: unknown, chaves: string[]) =>
    new Set(chaves.filter((c) => estado.avisos.has(c))),
  registrarAvisoEstouro: async (_e: unknown, a: { chave: string }) => {
    if (estado.avisos.has(a.chave)) return false;
    estado.avisos.add(a.chave);
    return true;
  },
  gravarTrilha: async (_e: unknown, t: { evento: string }) => {
    estado.trilha.push(t.evento);
    return { id: '1', hash: 'h' };
  },
  somenteSgh: (e: unknown) => e,
  lerCodigos: () => ['pc'],
  lerConfiguracaoNucleo: () => ({}),
  NucleoLegado: class {},
}));
vi.mock('@sgh/legado/nativo', () => ({ criarDriverNativo: () => ({}) }));

const nucleo = {
  rede: 'rede',
  lerSomente: async <T>(_c: unknown, fn: (l: unknown) => Promise<T>) => fn({}),
  gravarSgh: async <T>(_c: unknown, fn: (e: unknown) => Promise<T>) => fn({}),
  encerrar: async () => undefined,
};

const { cicloEstouro, estourosPendentes, estouroLigado, ClassificacaoEstouroService } =
  await import('./classificacao-estouro.service.js');

beforeEach(() => {
  estado.ligada = true;
  estado.avisos.clear();
  estado.trilha.length = 0;
});

describe('aviso de estouro da classificação (worker)', () => {
  it('só o amarelo estourado sem médico; o médico iniciado para o relógio; o encerrado sai; o verde no prazo', async () => {
    const p = await estourosPendentes(nucleo as never, 'pc');
    expect(p.pendentes.map((x) => x.reg)).toEqual([1]);
    expect(p.pendentes[0]).toMatchObject({ chave: 'pa.classificacao.estouro:pc:101', cor: 'amarelo' });
  });

  it('relógio injetado: antes do prazo, nada; depois, o verde também', async () => {
    expect((await estourosPendentes(nucleo as never, 'pc', '2026-10-24T08:59:00')).pendentes).toEqual([]);
    expect(
      (await estourosPendentes(nucleo as never, 'pc', '2026-10-24T11:31:00')).pendentes.map((x) => x.reg),
    ).toEqual([1, 4]);
  });

  it('um aviso por classificação: dois consumidores no mesmo ciclo não duplicam; a trilha registra uma vez', async () => {
    const [a, b] = await Promise.all([
      cicloEstouro(nucleo as never, 'pc'),
      cicloEstouro(nucleo as never, 'pc'),
    ]);
    expect(a.avisados + b.avisados).toBe(1);
    expect(estado.trilha).toEqual(['recepcao.classificacao.estourada']);
    expect((await cicloEstouro(nucleo as never, 'pc')).avisados).toBe(0);
  });

  it('com a chave desligada, nada é lido além da chave', async () => {
    estado.ligada = false;
    expect(await cicloEstouro(nucleo as never, 'pc')).toEqual({ ligada: false, pendentes: 0, avisados: 0 });
  });

  it('ligado fora de dev/ci; em dev/ci só pedido; o serviço roda o ciclo com o núcleo de teste', async () => {
    expect(estouroLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(estouroLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(estouroLigado({ AMBIENTE: 'ci', CLASSIFICACAO_ESTOURO: 'ligado' })).toBe(true);
    expect(estouroLigado({ AMBIENTE: 'producao', CLASSIFICACAO_ESTOURO: 'desligado' })).toBe(false);
    const s = new ClassificacaoEstouroService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(nucleo as never);
    expect(await s.ciclo()).toEqual([{ estabelecimento: 'pc', avisados: 1 }]);
    await s.onApplicationShutdown();
  });
});
