// M44, regra 4, no `worker` (lote F2.2 05-15): o estouro do tempo-alvo sem atendimento médico é avisado UMA vez por
// classificação, com o relógio injetado; com a chave desligada, nada; o atendimento médico iniciado para o relógio; a
// decisão ou a saída tiram o atendimento; dois consumidores no mesmo ciclo não duplicam (a chave única do aviso). A
// porta própria é um dublê (nada conecta a banco); a prova sobre o MariaDB é a classificacao-estouro.int.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PortaEstouro } from './classificacao-estouro-propria.js';
import { cicloEstouro, ClassificacaoEstouroService, estourosPendentes, estouroLigado } from './classificacao-estouro.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const EST: AlvoEstabelecimento = { cliente: 'cli_teste', id: 7, codigo: 'pc', fuso: 'America/Sao_Paulo' };
const estado = { ligada: true, avisos: new Set<string>() };
const T = (h: string) => new Date(`2026-10-24T${h}:00.000Z`);

const porta: PortaEstouro = {
  estabelecimentos: async () => [EST],
  ligada: async () => estado.ligada,
  abertos: async () => [
    { id: 1, etapas: [] },
    { id: 2, etapas: [{ etapa: 'atendimento_medico', em: T('08:30').toISOString() }] },
    { id: 3, etapas: [{ etapa: 'decisao', em: T('09:00').toISOString() }] },
    { id: 4, etapas: [] },
    { id: 5, etapas: [] },
  ],
  classificacoes: async () => [
    { id: 101, atendimento: 1, cor: 'amarelo', classificadoEm: T('08:00').toISOString(), tempoAlvoMin: 60 },
    { id: 102, atendimento: 2, cor: 'amarelo', classificadoEm: T('08:00').toISOString(), tempoAlvoMin: 60 },
    { id: 103, atendimento: 3, cor: 'amarelo', classificadoEm: T('08:00').toISOString(), tempoAlvoMin: 60 },
    { id: 104, atendimento: 4, cor: 'verde', classificadoEm: T('09:30').toISOString(), tempoAlvoMin: 120 },
    { id: 105, atendimento: 5, cor: null, classificadoEm: T('08:00').toISOString(), tempoAlvoMin: 60 },
  ],
  avisosGravados: async (chaves) => new Set(chaves.filter((c) => estado.avisos.has(c))),
  registrarAviso: async (_e, a) => {
    if (estado.avisos.has(a.chave)) return false;
    estado.avisos.add(a.chave);
    return true;
  },
};

beforeEach(() => {
  estado.ligada = true;
  estado.avisos.clear();
});

describe('aviso de estouro da classificação (worker)', () => {
  it('só o amarelo estourado sem médico; o médico iniciado para o relógio; a decisão tira; sem cor é contado', async () => {
    const p = await estourosPendentes(porta, EST, T('10:00'));
    expect(p.pendentes.map((x) => x.atendimento)).toEqual([1]);
    expect(p.pendentes[0]).toMatchObject({
      chave: 'pa.classificacao.estouro:pc:101',
      cor: 'amarelo',
      prazoEm: '2026-10-24T09:00:00.000Z',
    });
    expect(p.semCor).toBe(1);
  });

  it('relógio injetado: antes do prazo, nada; depois, o verde também', async () => {
    expect((await estourosPendentes(porta, EST, T('08:59'))).pendentes).toEqual([]);
    expect((await estourosPendentes(porta, EST, T('11:31'))).pendentes.map((x) => x.atendimento)).toEqual([1, 4]);
  });

  it('um aviso por classificação: dois consumidores no mesmo ciclo não duplicam', async () => {
    const [a, b] = await Promise.all([cicloEstouro(porta, EST, T('10:00')), cicloEstouro(porta, EST, T('10:00'))]);
    expect(a.avisados + b.avisados).toBe(1);
    expect((await cicloEstouro(porta, EST, T('10:00'))).avisados).toBe(0);
  });

  it('com a chave desligada, nada é lido além da chave', async () => {
    estado.ligada = false;
    expect(await cicloEstouro(porta, EST, T('10:00'))).toEqual({ ligada: false, pendentes: 0, avisados: 0, semCor: 0 });
  });

  it('ligado fora de dev/ci; em dev/ci só pedido; o serviço roda o ciclo com a porta de teste', async () => {
    expect(estouroLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(estouroLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(estouroLigado({ AMBIENTE: 'ci', CLASSIFICACAO_ESTOURO: 'ligado' })).toBe(true);
    expect(estouroLigado({ AMBIENTE: 'producao', CLASSIFICACAO_ESTOURO: 'desligado' })).toBe(false);
    const s = new ClassificacaoEstouroService();
    expect(await s.ciclo()).toEqual([]);
    s.usar({ lerPlataforma: async () => [] as never, encerrar: async () => undefined }, () => porta);
    const antes = process.env['WORKER_CLIENTES'];
    process.env['WORKER_CLIENTES'] = 'cli_teste';
    try {
      expect(await s.ciclo(T('10:00'))).toEqual([{ cliente: 'cli_teste', estabelecimento: 'pc', avisados: 1 }]);
    } finally {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    }
    await s.onApplicationShutdown();
  });
});
