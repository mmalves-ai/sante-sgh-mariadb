// M54.1, correção da revisão: a janela fora do pico e o "hoje" do ciclo vão no fuso civil do Brasil (UTC−3), não na
// hora do processo (TZ=UTC no manual de implantação §3.3). Instante de prova: 31/10/2026 às 23:30 de Brasília, que é
// 01/11/2026 02:30Z. Lote F2.2 05-12: o ciclo por cliente e estabelecimento sobre uma porta dublê (liberação, contagem,
// contabilização e a recusa `modelo-pendente` registrada sem parar o ciclo).
import { CHAVE_CONTABIL, recursoDesligado } from '@sgh/contratos';
import { competenciaDaData } from '@sgh/dominio-contabil';
import { describe, expect, it } from 'vitest';
import type { AcessoContabilizacao } from './contabilizacao.js';
import {
  cicloDoCliente,
  codigoDaFalha,
  contabilizacaoLigada,
  hojeDoCiclo,
  LeituraFatosContabeisService,
} from './leitura-fatos.service.js';
import { contabilLigadaPor, modeloPendente, type PortaContabilWorker } from './porta-propria.js';

const NOITE_DO_ULTIMO_DIA = new Date('2026-11-01T02:30:00Z');
const PRODUCAO = { AMBIENTE: 'producao' } as NodeJS.ProcessEnv;

describe('leitura dos fatos contábeis no fuso civil', () => {
  const s = new LeituraFatosContabeisService();

  it('23:30 de Brasília está dentro da janela padrão 22:00-06:00', () => {
    expect(s.naJanela(NOITE_DO_ULTIMO_DIA, PRODUCAO)).toBe(true);
  });

  it('19:30 de Brasília (22:30Z) fica fora da janela padrão', () => {
    expect(s.naJanela(new Date('2026-10-29T22:30:00Z'), PRODUCAO)).toBe(false);
  });

  it('05:59 de Brasília (08:59Z) ainda está dentro; 06:30 (09:30Z) já está fora', () => {
    expect(s.naJanela(new Date('2026-10-30T08:59:00Z'), PRODUCAO)).toBe(true);
    expect(s.naJanela(new Date('2026-10-30T09:30:00Z'), PRODUCAO)).toBe(false);
  });

  it('o estorno visto às 23:30 do último dia sai com a data e a competência do próprio mês', () => {
    const hoje = hojeDoCiclo(NOITE_DO_ULTIMO_DIA);
    expect(hoje).toBe('2026-10-31');
    expect(competenciaDaData(hoje)).toBe('2026-10');
  });
});

describe('contabilização depois da contagem (M54.2)', () => {
  it('ligada por padrão; CONTABIL_CONTABILIZAR=desligado só conta', () => {
    expect(contabilizacaoLigada({})).toBe(true);
    expect(contabilizacaoLigada({ CONTABIL_CONTABILIZAR: 'ligado' })).toBe(true);
    expect(contabilizacaoLigada({ CONTABIL_CONTABILIZAR: ' desligado ' })).toBe(false);
  });
});

const DECLARADOS = recursoDesligado(CHAVE_CONTABIL)?.prerequisitos ?? [];
const CUMPRIDOS = DECLARADOS.map((p) => ({
  recurso: CHAVE_CONTABIL,
  tipo: p.tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: null,
  alteradoPor: '',
  alteradoEm: '',
})) as unknown as Parameters<typeof contabilLigadaPor>[0]['prerequisitos'];
const CHAVE_LIGADA = [{ escopo: 'hospital' as const, valor: '*', ligada: true }];
const LIGADA = { chaves: CHAVE_LIGADA, prerequisitos: CUMPRIDOS };
const zeros = { pendente: 0, contabilizado: 0, semRegra: 0, semConta: 0, substituido: 0, ignorado: 0 };

function portaDubla(acesso: AcessoContabilizacao): PortaContabilWorker & { lidos: number[] } {
  const lidos: number[] = [];
  return {
    lidos,
    estabelecimentos: async () => [
      { id: 1, codigo: 'h1' },
      { id: 2, codigo: 'h2' },
    ],
    liberacao: async (id) => (id === 1 ? LIGADA : { chaves: [], prerequisitos: [] }),
    fatosPorSituacao: async (id) => {
      lidos.push(id);
      return { ...zeros, pendente: 3 };
    },
    ler: acesso.ler,
    gravar: acesso.gravar,
  };
}

describe('ciclo do cliente (lote 05-12)', () => {
  it('a liberação do recurso decide; sem chave, o estabelecimento fica de fora', () => {
    const agora = new Date();
    expect(contabilLigadaPor(LIGADA, agora)).toBe(true);
    expect(contabilLigadaPor({ chaves: [], prerequisitos: CUMPRIDOS }, agora)).toBe(false);
    // Pré-requisito declarado e não cumprido segura o recurso.
    if (DECLARADOS.length > 0) expect(contabilLigadaPor({ chaves: CHAVE_LIGADA, prerequisitos: [] }, agora)).toBe(false);
  });

  it('operação sem modelo: a recusa vai ao resultado com o código e o ciclo segue', async () => {
    const porta = portaDubla({
      ler: () => Promise.reject(modeloPendente('A contabilização automática dos fatos')),
      gravar: () => Promise.reject(new Error('não chamado')),
    });
    const r = await cicloDoCliente(porta, 'cli_a', new Date(), {});
    // Só o h1 está liberado: o h2 nem é contado.
    expect(r).toEqual([
      { cliente: 'cli_a', estabelecimento: 'h1', pendentes: 3, lancamentos: 0, falha: 'modelo-pendente' },
    ]);
    expect(porta.lidos).toEqual([1]);
  });

  it('falha de leitura num estabelecimento fica nele e o seguinte ainda é processado', async () => {
    const base = portaDubla({
      ler: () => Promise.reject(modeloPendente('A contabilização automática dos fatos')),
      gravar: () => Promise.reject(new Error('não chamado')),
    });
    const porta: PortaContabilWorker = {
      ...base,
      liberacao: async (id) => {
        if (id === 1) throw new RangeError('tempo esgotado');
        return LIGADA;
      },
    };
    const r = await cicloDoCliente(porta, 'cli_a', new Date(), { CONTABIL_CONTABILIZAR: 'desligado' });
    expect(r).toEqual([
      { cliente: 'cli_a', estabelecimento: 'h1', pendentes: 0, lancamentos: 0, falha: 'RangeError' },
      { cliente: 'cli_a', estabelecimento: 'h2', pendentes: 3, lancamentos: 0, falha: null },
    ]);
    expect(base.lidos).toEqual([2]);
  });

  it('chave de pessoa, grupo ou setor não liga a contabilização do estabelecimento', () => {
    const agora = new Date();
    const pessoa = [{ escopo: 'pessoa' as const, valor: 'servico.contabil', ligada: true }];
    expect(contabilLigadaPor({ chaves: pessoa, prerequisitos: CUMPRIDOS }, agora)).toBe(false);
    const desligadaComPessoa = [
      { escopo: 'hospital' as const, valor: '*', ligada: false },
      { escopo: 'pessoa' as const, valor: 'servico.contabil', ligada: true },
    ];
    expect(contabilLigadaPor({ chaves: desligadaComPessoa, prerequisitos: CUMPRIDOS }, agora)).toBe(false);
  });

  it('CONTABIL_CONTABILIZAR=desligado só conta, sem chamar a leitura da contabilização', async () => {
    let leituras = 0;
    const porta = portaDubla({
      ler: () => {
        leituras++;
        return Promise.reject(new Error('não chamado'));
      },
      gravar: () => Promise.reject(new Error('não chamado')),
    });
    const r = await cicloDoCliente(porta, 'cli_a', new Date(), { CONTABIL_CONTABILIZAR: 'desligado' });
    expect(leituras).toBe(0);
    expect(r).toEqual([{ cliente: 'cli_a', estabelecimento: 'h1', pendentes: 3, lancamentos: 0, falha: null }]);
  });

  it('o código da falha é o da recusa, ou o nome do erro', () => {
    expect(codigoDaFalha(modeloPendente('x'))).toBe('modelo-pendente');
    expect(codigoDaFalha(new TypeError('y'))).toBe('TypeError');
    expect(codigoDaFalha('z')).toBe('erro');
  });

  it('o serviço sem núcleo ou fora da janela não roda', async () => {
    const s = new LeituraFatosContabeisService();
    expect(await s.ciclo(NOITE_DO_ULTIMO_DIA, PRODUCAO)).toEqual([]);
    s.usar(
      { lerPlataforma: async () => [] as never, encerrar: async () => undefined },
      () => portaDubla({ ler: () => Promise.reject(new Error('x')), gravar: () => Promise.reject(new Error('x')) }),
    );
    expect(await s.ciclo(new Date('2026-10-29T22:30:00Z'), PRODUCAO)).toEqual([]);
    const r = await s.ciclo(NOITE_DO_ULTIMO_DIA, { ...PRODUCAO, WORKER_CLIENTES: 'cli_a' });
    expect(r.map((x) => [x.cliente, x.estabelecimento, x.falha])).toEqual([['cli_a', 'h1', 'x']].map(([c, e]) => [c, e, 'Error']));
  });
});
