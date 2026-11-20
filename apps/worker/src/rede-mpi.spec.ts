// MPI da Rede noturno no worker (M57, etapa 1): desligado por padrão (POL-3); só os estabelecimentos com o índice
// (HS-1) e só com dois ou mais; a noite roda ciclos até a marca parar de andar e depois o relatório de divergência com
// o reparo; uma vez por noite, na janela noturna; a porta sobre o núcleo grava a trilha em cada banco. Sintético.
import { describe, expect, it, vi } from 'vitest';
import type { PortaIndiceRede } from '@sgh/dominio-rede';
import {
  estabelecimentosDoMpi,
  estabelecimentosLiberadosMpi,
  noiteDaRede,
  noturnoLigado,
  type NucleoRede,
  portaIndiceNucleo,
  RedeMpiService,
} from './rede-mpi.service.js';

function porta(totalPorBanco: number): PortaIndiceRede & { gravacoes: string[] } {
  const marcas = new Map<string, { ultimoId: number; ultimaAtualizacao: string | null }>();
  const gravacoes: string[] = [];
  return {
    gravacoes,
    marca: async (est) => marcas.get(est) ?? null,
    loteCadastros: async (est, depois, n) => {
      const itens = [];
      for (let id = depois + 1; id <= Math.min(totalPorBanco, depois + n); id++)
        itens.push({
          estabelecimento: est,
          id,
          prontuario: id,
          nome: `PACIENTE SINTETICO ${id}`,
          mae: null,
          nascimento: null,
          sexo: null,
          cpf: null,
          cns: null,
          ativo: true,
          idUnificado: id,
          nomeFoneticoBanco: null,
          maeFoneticaBanco: null,
          atualizadoEm: null,
        });
      return { itens, ultimoId: itens.at(-1)?.id ?? depois };
    },
    cadastrosAlterados: async () => [],
    procurarCandidatos: async () => [],
    cadastrosPorIds: async () => [],
    situacoes: async () => new Map(),
    pessoasDosCadastros: async () => new Map(),
    loteVinculos: async (_e, depois) => ({ itens: [], ultimoId: depois }),
    gravar: async (est, fn, rot) => {
      gravacoes.push(`${est}:${rot.operacao}`);
      return fn({
        escritas: async () => ({ gravadas: 0, jaEstavam: 0 }),
        candidatos: async () => undefined,
        marca: async (m) => void marcas.set(est, m),
        duplicidadesLocais: async () => 0,
      });
    },
  };
}

describe('MPI da Rede noturno', () => {
  it('desligado por padrão; só os estabelecimentos com o índice', () => {
    expect(noturnoLigado({})).toBe(false);
    expect(noturnoLigado({ REDE_MPI_NOTURNO: 'ligado' })).toBe(true);
    expect(estabelecimentosDoMpi({ ESTABELECIMENTOS: 'pc,hs' })).toEqual(['pc']);
    expect(estabelecimentosDoMpi({ ESTABELECIMENTOS: 'pc,hs', REDE_MPI_ESTABELECIMENTOS: 'hs' })).toEqual([
      'pc',
      'hs',
    ]);
  });

  it('ciclos até a marca parar de andar, depois a divergência (0: sem reparo)', async () => {
    const p = porta(5);
    const r = await noiteDaRede(p, ['hs', 'pc'], { lote: 2, ciclos: 10 });
    expect(r).toMatchObject({ ciclos: 4, lidos: 10, automaticos: 0, divergencias: 0, reparados: 0 });
    expect(p.gravacoes.every((g) => g.endsWith('rede.parearCadastros'))).toBe(true);
    const teto = await noiteDaRede(porta(100), ['hs', 'pc'], { lote: 1, ciclos: 3 });
    expect(teto.ciclos).toBe(3);
  });

  it('uma vez por noite, na janela; menos de dois estabelecimentos: nada', async () => {
    const s = new RedeMpiService();
    const noite = vi.spyOn(s, 'noite').mockResolvedValue(null);
    await s.talvez(new Date(2026, 9, 24, 1, 0));
    await s.talvez(new Date(2026, 9, 24, 3, 0));
    await s.talvez(new Date(2026, 9, 24, 4, 0));
    expect(noite).toHaveBeenCalledTimes(1);
    noite.mockRestore();
    expect(await s.noite()).toBeNull();
    s.usar({
      rede: 'r',
      lerSomente: vi.fn(),
      gravarSgh: vi.fn(),
      encerrar: vi.fn(),
    } as unknown as NucleoRede);
    const antes = process.env['ESTABELECIMENTOS'];
    process.env['ESTABELECIMENTOS'] = 'pc';
    expect(await s.noite()).toBeNull();
    if (antes === undefined) delete process.env['ESTABELECIMENTOS'];
    else process.env['ESTABELECIMENTOS'] = antes;
    await s.onApplicationShutdown();
  });

  /** Núcleo falso: as chaves e os pré-requisitos de cada banco; registra toda gravação. */
  function nucleoComChaves(ligadas: Record<string, { chave: boolean; prereq: boolean }>) {
    const gravacoes: string[] = [];
    const nucleo = {
      rede: 'r',
      lerSomente: async (c: { hospital: string }, fn: (l: unknown) => Promise<unknown>) => {
        const x = ligadas[c.hospital];
        if (!x) throw new Error('banco fora (simulado)');
        return fn({
          hospital: c.hospital,
          consultar: async (sql: string) =>
            /SGH_CFG_LIBERACAO/.test(sql)
              ? [
                  {
                    ID: 1,
                    TIPO: 'recurso',
                    OPERACAO: 'rede.mpi',
                    ESCOPO: 'hospital',
                    VALOR: '*',
                    LIGADA: x.chave ? 1 : 0,
                  },
                ]
              : /SGH_CFG_PREREQUISITO/.test(sql)
                ? [{ RECURSO: 'rede.mpi', TIPO: 'aprovacao', SITUACAO: x.prereq ? 'cumprido' : 'pendente' }]
                : [],
          lerBlob: async () => Buffer.alloc(0),
        });
      },
      gravarSgh: async (c: { hospital: string }) => {
        gravacoes.push(c.hospital);
        throw new Error('não devia gravar');
      },
      encerrar: async () => undefined,
    } as unknown as NucleoRede;
    return { nucleo, gravacoes };
  }

  it('a chave rede.mpi de cada estabelecimento: desligada ou com pré-requisito pendente fica fora; banco fora também', async () => {
    const { nucleo } = nucleoComChaves({
      pc: { chave: true, prereq: true },
      sx: { chave: false, prereq: true },
      hs: { chave: true, prereq: false },
      ab: { chave: true, prereq: true },
    });
    expect(await estabelecimentosLiberadosMpi(nucleo, ['pc', 'sx', 'hs', 'ab', 'zz'])).toEqual(['pc', 'ab']);
  });

  it('REDE_MPI_NOTURNO=ligado com a chave desligada num dos dois: nenhuma escrita', async () => {
    const { nucleo, gravacoes } = nucleoComChaves({
      pc: { chave: true, prereq: true },
      hs: { chave: false, prereq: true },
    });
    const s = new RedeMpiService();
    s.usar(nucleo);
    const antes = { e: process.env['ESTABELECIMENTOS'], r: process.env['REDE_MPI_ESTABELECIMENTOS'] };
    process.env['ESTABELECIMENTOS'] = 'pc,hs';
    process.env['REDE_MPI_ESTABELECIMENTOS'] = 'hs';
    try {
      expect(await s.noite()).toBeNull();
      expect(gravacoes).toEqual([]);
    } finally {
      for (const [k, v] of [
        ['ESTABELECIMENTOS', antes.e],
        ['REDE_MPI_ESTABELECIMENTOS', antes.r],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  });

  it('a porta sobre o núcleo: leitura e gravação no banco do estabelecimento, com a trilha junto', async () => {
    const executados: string[] = [];
    const escritor = {
      hospital: 'hs',
      consultar: async (sql: string) =>
        /SGH_REDE_MARCA/.test(sql) ? [] : /GEN_ID|SGH_TRILHA/.test(sql) ? [] : [],
      lerBlob: async () => Buffer.alloc(0),
      executar: async (sql: string) => {
        executados.push(sql.trim().split(/\s+/).slice(0, 5).join(' '));
        return 1;
      },
      executarRetornando: async () => ({ ID: 1, HASH: 'h' }),
    };
    const contextos: string[] = [];
    const nucleo = {
      rede: 'r',
      lerSomente: async (c: { hospital: string }, fn: (l: unknown) => Promise<unknown>) => {
        contextos.push(`ler:${c.hospital}`);
        return fn(escritor);
      },
      gravarSgh: async (c: { hospital: string }, fn: (e: unknown) => Promise<unknown>) => {
        contextos.push(`gravar:${c.hospital}`);
        return fn(escritor);
      },
      encerrar: async () => undefined,
    } as unknown as NucleoRede;
    const p = portaIndiceNucleo(nucleo);
    expect(await p.marca('hs')).toBeNull();
    await p
      .gravar('hs', (g) => g.marca({ ultimoId: 3, ultimaAtualizacao: null }, 'SGH.REDE'), {
        evento: 'rede.fila.atualizada',
        operacao: 'rede.parearCadastros',
        chave: 'lidos=3',
        pessoa: null,
      })
      .catch(() => undefined);
    expect(contextos).toEqual(['ler:hs', 'gravar:hs']);
    expect(executados[0]).toMatch(/^UPDATE OR INSERT INTO SGH_REDE_MARCA/);
  });
});
