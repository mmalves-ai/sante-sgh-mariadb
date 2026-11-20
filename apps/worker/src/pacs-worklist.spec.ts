// M47 (etapa 3), regra 8, no `worker`: a geração automática da lista de trabalho DICOM só com a chave valendo no
// estabelecimento, um item por exame de imagem sem item na janela (o setor sem modalidade fica de fora), a trilha de
// cada item, o segundo consumidor que desiste sem duplicar; e a liga/desliga por ambiente. As leituras e gravações do
// núcleo são dublês (nada conecta a banco); a prova sobre a cópia é a mwl.int.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = {
  chaveLigada: true,
  pendentes: [] as { exame: number; ato: number; data: string }[],
  criados: [] as { exame: number; accession: string; modalidade: string; origem: string }[],
  trilha: [] as string[],
  janelaPedida: '' as string,
  duplicar: false,
  seq: 100,
};

class ErroOperacao extends Error {
  constructor(readonly problema: { codigo: string }) {
    super(problema.codigo);
  }
}

vi.mock('@sgh/legado', () => ({
  ErroOperacao,
  relogioRecepcao: async () => ({ hoje: '2026-10-25', agora: '2026-10-25T10:00:00' }),
  lerChavesLiberacao: async () =>
    estado.chaveLigada
      ? [{ chave: 'imagem.worklist', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true }]
      : [],
  lerPrerequisitos: async () => [
    { recurso: 'imagem.worklist', tipo: 'contrato', situacao: 'cumprido', validade: '2099-12-31' },
    { recurso: 'imagem.worklist', tipo: 'aprovacao', situacao: 'cumprido', validade: '2099-12-31' },
  ],
  lerValoresParametro: async () => [],
  examesImagemSemItem: async (
    _l: unknown,
    _cod: string,
    f: { desde: string; ate: string; atos: number[] },
  ) => {
    estado.janelaPedida = `${f.desde}..${f.ate}:${f.atos.join(',')}`;
    return { itens: estado.pendentes, cortada: false };
  },
  examesSadtPorId: async (_l: unknown, _cod: string, ids: number[]) =>
    estado.pendentes
      .filter((p) => ids.includes(p.exame))
      .map((p) => ({
        id: p.exame,
        ato: p.ato,
        paciente: { id: 900000 + p.exame, prontuario: 1001, nome: 'SINTETICO', nascimento: null, sexo: 'F' },
        chave: { reg: 31337, ato: p.ato, exame: 'X', sequencia: 0, data: p.data, conta: 1, atend: 'E' },
      })),
  modalidadeDoCadastroDosExames: async () => new Map(),
  modalidadesDicom: async () => [
    { id: 6, sigla: 'CR', ativa: true },
    { id: 8, sigla: 'CT', ativa: true },
  ],
  registrarItemMwlSgh: async (
    _e: unknown,
    r: { exame: number; accession: (id: number) => string; modalidade: { sigla: string }; origem: string },
  ) => {
    if (estado.duplicar || estado.criados.some((c) => c.exame === r.exame))
      throw new ErroOperacao({ codigo: 'ja-na-worklist' });
    const id = ++estado.seq;
    const accession = r.accession(id);
    estado.criados.push({ exame: r.exame, accession, modalidade: r.modalidade.sigla, origem: r.origem });
    return { id, accession, outbox: String(id + 5000) };
  },
  gravarTrilha: async (_e: unknown, l: { evento: string; idAlvo: string; usuario: string }) => {
    estado.trilha.push(`${l.evento}:${l.idAlvo}:${l.usuario}`);
    return { id: '1', hash: 'h' };
  },
  somenteSgh: (e: unknown) => e,
  lerCodigos: () => ['pc'],
  lerConfiguracaoNucleo: () => ({ bibliotecaCliente: null }),
  NucleoLegado: class {},
}));
vi.mock('@sgh/legado/nativo', () => ({ criarDriverNativo: () => ({}) }));

const { cicloWorklist, geracaoPacsLigada, PacsWorklistService } = await import('./pacs-worklist.service.js');
type Nucleo = Parameters<typeof cicloWorklist>[0];

const nucleo = {
  rede: 'rede',
  lerSomente: async <T>(_c: unknown, fn: (l: never) => Promise<T>) => fn({} as never),
  gravarSgh: async <T>(_c: unknown, fn: (e: never) => Promise<T>) => fn({} as never),
  encerrar: async () => undefined,
} as unknown as Nucleo;

beforeEach(() => {
  estado.chaveLigada = true;
  estado.pendentes = [
    { exame: 501, ato: 25, data: '2026-10-25' },
    { exame: 502, ato: 16, data: '2026-10-24' },
    { exame: 503, ato: 99, data: '2026-10-25' },
  ];
  estado.criados = [];
  estado.trilha = [];
  estado.duplicar = false;
});

describe('geração automática da lista de trabalho DICOM (regra 8)', () => {
  it('desligada no estabelecimento: nada lido nem gravado', async () => {
    estado.chaveLigada = false;
    expect(await cicloWorklist(nucleo, 'pc')).toMatchObject({ situacao: 'desligado', criados: 0 });
    expect(estado.criados).toHaveLength(0);
  });

  it('ligada: um item por exame com modalidade (o setor sem modalidade fica de fora), a janela de 2 dias e a trilha', async () => {
    const r = await cicloWorklist(nucleo, 'pc', new Date('2026-10-25T13:00:00Z'));
    expect(r).toMatchObject({ situacao: 'feito', pendentes: 3, criados: 2, semModalidade: 1 });
    expect(estado.janelaPedida).toBe('2026-10-24..2026-10-25:16,24,25,26,27,42');
    expect(estado.criados).toEqual([
      { exame: 501, accession: 'PC000000101', modalidade: 'CT', origem: 'automatico' },
      { exame: 502, accession: 'PC000000102', modalidade: 'CR', origem: 'automatico' },
    ]);
    expect(estado.trilha).toEqual(['sadt.pacs.mwlEnviada:101:SGH.PACS', 'sadt.pacs.mwlEnviada:102:SGH.PACS']);
  });

  it('dois consumidores: o segundo esbarra na chave única do exame e desiste sem erro nem item a mais', async () => {
    estado.duplicar = true;
    expect(await cicloWorklist(nucleo, 'pc')).toMatchObject({ criados: 0, pendentes: 3 });
    expect(estado.trilha).toHaveLength(0);
  });

  it('o serviço roda o ciclo por estabelecimento; em dev/ci só com PACS_WORKLIST=ligado', async () => {
    const s = new PacsWorklistService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(nucleo);
    expect(await s.ciclo()).toEqual([{ estabelecimento: 'pc', criados: 2 }]);
    expect(geracaoPacsLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(geracaoPacsLigada({ AMBIENTE: 'dev', PACS_WORKLIST: 'ligado' })).toBe(true);
    expect(geracaoPacsLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(geracaoPacsLigada({ AMBIENTE: 'producao', PACS_MODO: 'desligado' })).toBe(false);
    expect(geracaoPacsLigada({ AMBIENTE: 'homolog', PACS_WORKLIST: 'desligado' })).toBe(false);
    await s.onApplicationShutdown();
  });
});
