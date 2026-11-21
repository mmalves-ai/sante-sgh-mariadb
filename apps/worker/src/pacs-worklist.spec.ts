// M47 (etapa 3), regra 8, no `worker` (lote F2.2 05-16): a geração automática da lista de trabalho de imagem só com a
// chave valendo no estabelecimento, um item por exame de imagem sem item na janela (sem modalidade ativa: item
// 'sem_modalidade', nunca some), a falha de um exame isolada dos demais, a chave por geração do pedido, o segundo consumidor que desiste sem duplicar, a janela do parâmetro e a liga/desliga por ambiente. A porta é um
// dublê (nada conecta a banco); a prova sobre o banco é a pacs-worklist-propria.int.spec.ts.
import { accessionDoItem } from '@sgh/dominio-sadt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chaveDoPedido, OPERACAO_ITEM_WORKLIST, type ExameSemItem, type PortaWorklist } from './pacs-worklist-propria.js';
import {
  cicloWorklist,
  geracaoPacsLigada,
  janelaPacs,
  type NucleoPacs,
  PacsWorklistService,
} from './pacs-worklist.service.js';

const estado = {
  ligada: true,
  janela: null as number | null,
  pendentes: [] as ExameSemItem[],
  criados: [] as { exame: number; accession: string; modalidade: string }[],
  janelaPedida: '',
  semModalidade: [] as number[],
  envenenado: 0,
  duplicar: false,
  seq: 100,
};

const porta: PortaWorklist = {
  ligada: async () => estado.ligada,
  janelaDias: async () => estado.janela,
  examesSemItem: async (_cod, desde, ate) => {
    estado.janelaPedida = `${desde.toISOString().slice(0, 10)}..${ate.toISOString().slice(0, 10)}`;
    return { itens: estado.pendentes, cortada: false };
  },
  registrarItem: async (cod, x, m) => {
    if (x.exame === estado.envenenado) throw new Error('cadastro');
    if (estado.duplicar || estado.criados.some((c) => c.exame === x.exame)) return null;
    const id = ++estado.seq;
    const accession = accessionDoItem(cod, id);
    if (!m) {
      estado.semModalidade.push(x.exame);
      return { id, accession, situacao: 'sem_modalidade' as const };
    }
    estado.criados.push({ exame: x.exame, accession, modalidade: m.sigla });
    return { id, accession, situacao: 'a_enviar' as const };
  },
};

const exame = (id: number, sigla: string | null, ativa = true): ExameSemItem => ({
  exame: id,
  paciente: 900000 + id,
  setor: 7,
  urgente: false,
  modalidade: sigla ? { id: id, sigla, ativa } : null,
  geracao: 0,
  itemPendente: null,
});

beforeEach(() => {
  estado.ligada = true;
  estado.janela = null;
  estado.pendentes = [exame(501, 'CT'), exame(502, 'CR'), exame(503, 'US', false)];
  estado.criados = [];
  estado.semModalidade = [];
  estado.envenenado = 0;
  estado.duplicar = false;
});

describe('geração automática da lista de trabalho de imagem (regra 8)', () => {
  it('desligada no estabelecimento: nada lido nem gravado', async () => {
    estado.ligada = false;
    expect(await cicloWorklist(porta, 'pc')).toMatchObject({ situacao: 'desligado', criados: 0 });
    expect(estado.criados).toHaveLength(0);
  });

  it('ligada: um item por exame com modalidade ativa, a janela padrão de 2 dias; sem modalidade ativa, item pendente', async () => {
    const r = await cicloWorklist(porta, 'pc', new Date('2026-10-25T13:00:00Z'));
    expect(r).toMatchObject({ situacao: 'feito', pendentes: 3, criados: 2, semModalidade: 1, falhas: 0 });
    expect(estado.semModalidade).toEqual([503]);
    expect(estado.janelaPedida).toBe('2026-10-23..2026-10-25');
    expect(estado.criados).toEqual([
      { exame: 501, accession: accessionDoItem('pc', 101), modalidade: 'CT' },
      { exame: 502, accession: accessionDoItem('pc', 102), modalidade: 'CR' },
    ]);
  });

  it('a janela do parâmetro vale entre 1 e 30 dias', async () => {
    estado.janela = 5;
    await cicloWorklist(porta, 'pc', new Date('2026-10-25T13:00:00Z'));
    expect(estado.janelaPedida).toBe('2026-10-20..2026-10-25');
    expect(janelaPacs(40)).toBe(2);
    expect(janelaPacs(0)).toBe(2);
    expect(janelaPacs(null)).toBe(2);
    expect(janelaPacs(30)).toBe(30);
  });

  it('dois consumidores: o segundo desiste sem erro nem item a mais', async () => {
    estado.duplicar = true;
    expect(await cicloWorklist(porta, 'pc')).toMatchObject({ criados: 0, pendentes: 3 });
  });

  it('exame sem modalidade no cadastro vira item pendente; com item pendente e ainda sem modalidade, nada a refazer', async () => {
    estado.pendentes = [exame(504, null), { ...exame(505, null), itemPendente: 77 }];
    expect(await cicloWorklist(porta, 'pc')).toMatchObject({ pendentes: 2, criados: 0, semModalidade: 1 });
    expect(estado.semModalidade).toEqual([504]);
  });

  it('a falha de um exame não para os demais do estabelecimento', async () => {
    estado.envenenado = 501;
    expect(await cicloWorklist(porta, 'pc')).toMatchObject({ criados: 1, falhas: 1, semModalidade: 1 });
    expect(estado.criados.map((c) => c.exame)).toEqual([502]);
  });

  it('a chave de idempotência muda a cada geração do pedido e na promoção do item pendente', () => {
    expect(chaveDoPedido('pc', { exame: 15, geracao: 0, itemPendente: null })).toBe('mwl:pc:15:g0');
    expect(chaveDoPedido('pc', { exame: 15, geracao: 1, itemPendente: null })).toBe('mwl:pc:15:g1');
    expect(chaveDoPedido('pc', { exame: 15, geracao: 1, itemPendente: 9 })).toBe('mwl:pc:15:p9');
  });

  it('a operação declara o nome e as tabelas que grava', () => {
    expect(OPERACAO_ITEM_WORKLIST.nome).toBe('sadt.enviar_worklist');
    expect(OPERACAO_ITEM_WORKLIST.tabelas).toEqual(['item_lista_trabalho_imagem', 'exame_item']);
  });

  describe('o serviço', () => {
    const antes = process.env['WORKER_CLIENTES'];
    afterEach(() => {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    });

    it('roda o ciclo por cliente e estabelecimento; em dev/ci só com PACS_WORKLIST=ligado', async () => {
      process.env['WORKER_CLIENTES'] = 'f22_teste';
      const s = new PacsWorklistService();
      expect(await s.ciclo()).toEqual([]);
      const nucleo = {
        lerPlataforma: async () => [],
        lerSomente: async (_c: unknown, fn: (l: unknown) => Promise<unknown>) =>
          fn({ consultar: async () => [{ codigo: 'pc' }], uma: async () => null }),
        encerrar: async () => undefined,
      } as unknown as NucleoPacs;
      s.usar(nucleo, () => porta);
      expect(await s.ciclo()).toEqual([{ cliente: 'f22_teste', estabelecimento: 'pc', criados: 2 }]);
      expect(geracaoPacsLigada({ AMBIENTE: 'dev' })).toBe(false);
      expect(geracaoPacsLigada({ AMBIENTE: 'dev', PACS_WORKLIST: 'ligado' })).toBe(true);
      expect(geracaoPacsLigada({ AMBIENTE: 'producao' })).toBe(true);
      expect(geracaoPacsLigada({ AMBIENTE: 'producao', PACS_MODO: 'desligado' })).toBe(false);
      expect(geracaoPacsLigada({ AMBIENTE: 'homolog', PACS_WORKLIST: 'desligado' })).toBe(false);
      await s.onApplicationShutdown();
    });
  });
});
