// Unidade do suporte no banco próprio: a ligação no ramo do núcleo (servicosSuporte deixa de devolver null) e o
// mapeamento das linhas do banco plataforma para a porta (papel, situação da ação, ids fora do formato).
import type { Escritor, Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { NucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import type { ContextoModulo } from '../registro.js';
import { servicosSuporte } from './modulo.js';
import { FonteComoEstabelecimentoPropria, RepositorioPlataformaPropria } from './porta-propria-plataforma.js';
import { ErroCorrigirIndisponivel } from './repositorio.js';

interface Chamada {
  readonly sql: string;
  readonly p: readonly unknown[];
}

function falso(linhas: (sql: string) => Linha[], afetadas = 1) {
  const chamadas: Chamada[] = [];
  const leitor = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas(sql));
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas(sql)[0] ?? null);
    },
    executar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(afetadas);
    },
    inserir: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(42);
    },
    consultarParaAtualizar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas(sql));
    },
  } as unknown as Escritor;
  const nucleo: NucleoPlataforma = {
    lerPlataforma: (_c, fn: (l: Leitor) => Promise<never>) => fn(leitor),
    escreverPlataforma: (_c, fn: (e: Escritor) => Promise<never>) => fn(leitor),
  };
  return { chamadas, nucleo };
}

const CONTA: Linha = {
  id: 7,
  email: 'a@exemplo.invalid',
  nome: null,
  papel: 'plataforma',
  ativo: 1,
  resumo_senha: null,
  segredo_segundo_fator: null,
  segundo_fator_ativo: 0,
  convite_resumo: null,
  convite_valido_ate: null,
  criado_em: new Date(0),
};

describe('RepositorioPlataformaPropria (mapeamento)', () => {
  it('conta: papel e booleanos na forma da porta; e-mail comparado exato', async () => {
    const { chamadas, nucleo } = falso(() => [CONTA]);
    const r = new RepositorioPlataformaPropria(nucleo);
    expect(await r.contaPorEmail('a@exemplo.invalid')).toMatchObject({
      id: '7',
      papel: 'PLATAFORMA',
      ativo: true,
      totpAtivo: false,
    });
    expect(chamadas[0]?.sql).toMatch(/CAST\(email AS BINARY\)/);
  });

  it('id fora do formato: nada lido nem gravado', async () => {
    const { chamadas, nucleo } = falso(() => [CONTA]);
    const r = new RepositorioPlataformaPropria(nucleo);
    expect(await r.contaPorId('7; DROP')).toBe(null);
    expect(await r.sessaoComo('x')).toBe(null);
    expect(await r.acoes('')).toEqual([]);
    expect(await r.encerrarSessaoComo('abc', 'm', null)).toBe(false);
    await expect(r.alterarConta('-1', { ativo: false }, null)).rejects.toThrow('não alterada');
    expect(chamadas).toEqual([]);
  });

  it('ação: a situação da porta vai ao banco com o nome de negócio e volta igual', async () => {
    const { chamadas, nucleo } = falso(() => [
      {
        id: 3,
        sessao_suporte_id: 2,
        metodo: 'POST',
        caminho: '/x',
        situacao: 'bloqueada',
        codigo_http: 403,
        clinico: 0,
        nao_reversivel: null,
        ocorrido_em: new Date(0),
      },
    ]);
    const r = new RepositorioPlataformaPropria(nucleo, () => 0);
    await r.registrarAcao({ sessao: '2', metodo: 'POST', caminho: '/x', status: 'aborted', http: null, clinico: false, naoReversivel: null });
    expect(chamadas[0]?.p[3]).toBe('interrompida');
    expect((await r.acoes('2'))[0]).toMatchObject({ id: '3', status: 'blocked', http: 403, clinico: false });
  });

  it('alterar conta que não existe: erro (como a memória)', async () => {
    const { nucleo } = falso(() => [], 0);
    await expect(new RepositorioPlataformaPropria(nucleo).alterarConta('9', { ativo: true }, null)).rejects.toThrow(
      'não alterada',
    );
  });

  it('o aviso ao Auditor não tem outbox: false (o serviço manda pela fila)', async () => {
    const { nucleo } = falso(() => []);
    expect(await new RepositorioPlataformaPropria(nucleo).registrarAvisoComo()).toBe(false);
  });
});

describe('FonteComoEstabelecimentoPropria', () => {
  it('a correção é recusada (sem imagens no banco próprio) e nenhuma ação tem imagem', async () => {
    const f = new FonteComoEstabelecimentoPropria({ lerSomente: () => Promise.reject(new Error('não lê')) }, 'c');
    await expect(f.previa()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
    await expect(f.corrigir()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
    expect((await f.imagensPorAcao()).size).toBe(0);
  });
});

describe('servicosSuporte no ramo do núcleo', () => {
  const ctx = (nucleo: unknown, cliente: string | null): ContextoModulo =>
    ({
      configuracao: { ambiente: 'producao', produtoNome: 'P', rede: 'rede-x', clientePadrao: cliente },
      nucleo,
      env: {},
      armazem: new ArmazemMemoria(),
      servico: null,
      trilha: {},
    }) as unknown as ContextoModulo;

  it('com o banco plataforma e o cliente padrão: os dois serviços montados (antes: null e 503)', () => {
    const { nucleo } = falso(() => []);
    const s = servicosSuporte(ctx({ ...nucleo, lerSomente: () => Promise.resolve([]) }, 'cli'));
    expect(s.plataforma?.repo).toBeInstanceOf(RepositorioPlataformaPropria);
    expect(s.como).not.toBe(null);
  });

  it('sem o cliente padrão: só a conta da plataforma (o "como" fica fechado)', () => {
    const { nucleo } = falso(() => []);
    const s = servicosSuporte(ctx({ ...nucleo, lerSomente: () => Promise.resolve([]) }, null));
    expect(s.plataforma).not.toBe(null);
    expect(s.como).toBe(null);
  });

  it('núcleo sem o banco plataforma: falha fechada (null)', () => {
    const s = servicosSuporte(ctx({ lerSomente: () => Promise.resolve([]) }, 'cli'));
    expect(s.plataforma).toBe(null);
    expect(s.como).toBe(null);
  });
});
