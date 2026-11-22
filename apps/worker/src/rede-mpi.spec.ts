// MPI da Rede noturno no worker (M57, etapa 1; lote F2.2 05-16): desligado por padrão (POL-3); só os estabelecimentos
// do cliente com a chave e os pré-requisitos, e só com dois ou mais; a noite roda ciclos até a marca parar de andar e
// depois o relatório de divergência com o reparo; uma vez por noite, na janela noturna; sem a porta do índice, nada é
// gravado (pendência registrada). Sintético.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortaIndiceRede } from '@sgh/dominio-rede';
import {
  estabelecimentosDoMpi,
  estabelecimentosLiberadosMpi,
  noiteDaRede,
  noturnoLigado,
  type NucleoRede,
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

/** Núcleo falso: os estabelecimentos do cliente e a chave e os pré-requisitos de cada um. */
function nucleoComChaves(
  ligadas: Record<string, { chave: boolean; prereq: boolean }>,
  ests = Object.keys(ligadas),
) {
  return {
    lerPlataforma: async () => [],
    lerSomente: async (_c: unknown, fn: (l: unknown) => Promise<unknown>) =>
      fn({
        uma: async () => null,
        consultar: async (sql: string, p: unknown[] = []) => {
          if (/FROM estabelecimento WHERE/.test(sql)) return ests.map((codigo) => ({ codigo }));
          const x = ligadas[String(p[0])];
          if (!x) throw new Error('estabelecimento fora (simulado)');
          if (/liberacao_chave/.test(sql))
            return [
              { chave: 'rede.mpi', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: x.chave ? 1 : 0 },
            ];
          if (/recurso_prerequisito/.test(sql))
            return [
              {
                recurso: 'rede.mpi',
                tipo: 'aprovacao',
                situacao: x.prereq ? 'cumprido' : 'pendente',
                validade: null,
              },
            ];
          return [];
        },
      }),
    encerrar: async () => undefined,
  } as unknown as NucleoRede;
}

describe('MPI da Rede noturno', () => {
  const antes = { c: process.env['WORKER_CLIENTES'], r: process.env['REDE_MPI_ESTABELECIMENTOS'] };
  afterEach(() => {
    for (const [k, v] of [
      ['WORKER_CLIENTES', antes.c],
      ['REDE_MPI_ESTABELECIMENTOS', antes.r],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });

  it('desligado por padrão; os estabelecimentos do cliente ou só os da lista', () => {
    expect(noturnoLigado({})).toBe(false);
    expect(noturnoLigado({ REDE_MPI_NOTURNO: 'ligado' })).toBe(true);
    expect(estabelecimentosDoMpi({}, ['hs', 'pc'])).toEqual(['hs', 'pc']);
    expect(estabelecimentosDoMpi({ REDE_MPI_ESTABELECIMENTOS: 'hs,zz' }, ['hs', 'pc'])).toEqual(['hs']);
  });

  it('ciclos até a marca parar de andar, depois a divergência (0: sem reparo)', async () => {
    const p = porta(5);
    const r = await noiteDaRede(p, ['hs', 'pc'], { lote: 2, ciclos: 10 });
    expect(r).toMatchObject({ ciclos: 4, lidos: 10, automaticos: 0, divergencias: 0, reparados: 0 });
    expect(p.gravacoes.every((g) => g.endsWith('rede.parearCadastros'))).toBe(true);
    const teto = await noiteDaRede(porta(100), ['hs', 'pc'], { lote: 1, ciclos: 3 });
    expect(teto.ciclos).toBe(3);
  });

  it('uma vez por noite, na janela; sem núcleo, nada', async () => {
    const s = new RedeMpiService();
    const noite = vi.spyOn(s, 'noite').mockResolvedValue(null);
    await s.talvez(new Date(2026, 9, 24, 1, 0));
    await s.talvez(new Date(2026, 9, 24, 3, 0));
    await s.talvez(new Date(2026, 9, 24, 4, 0));
    expect(noite).toHaveBeenCalledTimes(1);
    noite.mockRestore();
    expect(await s.noite()).toBeNull();
  });

  it('a chave rede.mpi de cada estabelecimento: desligada ou com pré-requisito pendente fica fora; falha também', async () => {
    const nucleo = nucleoComChaves({
      pc: { chave: true, prereq: true },
      sx: { chave: false, prereq: true },
      hs: { chave: true, prereq: false },
      ab: { chave: true, prereq: true },
    });
    expect(await estabelecimentosLiberadosMpi(nucleo, 'f22_teste', ['pc', 'sx', 'hs', 'ab', 'zz'])).toEqual([
      'pc',
      'ab',
    ]);
  });

  it('a chave desligada num dos dois: a porta do índice nem é pedida; com os dois, a noite roda', async () => {
    process.env['WORKER_CLIENTES'] = 'f22_teste';
    const s = new RedeMpiService();
    const pedidas: string[] = [];
    s.usar(
      nucleoComChaves({ pc: { chave: true, prereq: true }, hs: { chave: false, prereq: true } }),
      (c) => {
        pedidas.push(c);
        return porta(1);
      },
    );
    expect(await s.noite()).toEqual([]);
    expect(pedidas).toEqual([]);
    s.usar(nucleoComChaves({ pc: { chave: true, prereq: true }, hs: { chave: true, prereq: true } }), (c) => {
      pedidas.push(c);
      return porta(1);
    });
    const r = await s.noite();
    expect(pedidas).toEqual(['f22_teste']);
    expect(r).toHaveLength(1);
    s.usar(nucleoComChaves({ pc: { chave: true, prereq: true }, hs: { chave: true, prereq: true } }), null);
    expect(await s.noite()).toEqual([]);
    await s.onApplicationShutdown();
  });
});
