// Unidade do suporte no banco próprio: a ligação no ramo do núcleo (servicosSuporte deixa de devolver null) e o
// mapeamento das linhas do banco plataforma para a porta (papel, situação da ação, ids fora do formato).
import { randomBytes } from 'node:crypto';
import { hashConvite } from '@sgh/dominio-acesso';
import type { Escritor, Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { NucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import type { ContextoModulo } from '../registro.js';
import { servicosSuporte } from './modulo.js';
import {
  FonteComoEstabelecimentoPropria,
  LIMITE_CRUZAMENTO,
  RepositorioPlataformaPropria,
} from './porta-propria-plataforma.js';
import { ErroConviteMudou, ErroCorrigirIndisponivel, RepositorioPlataformaMemoria } from './repositorio.js';
import { ErroPlataforma, ServicoPlataforma } from './servico-plataforma.js';

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
    await r.registrarAcao({
      sessao: '2',
      metodo: 'POST',
      caminho: '/x',
      status: 'aborted',
      http: null,
      clinico: false,
      naoReversivel: null,
    });
    expect(chamadas[0]?.p[3]).toBe('interrompida');
    expect((await r.acoes('2'))[0]).toMatchObject({ id: '3', status: 'blocked', http: 403, clinico: false });
  });

  it('alterar conta que não existe: erro (como a memória)', async () => {
    const { nucleo } = falso(() => [], 0);
    await expect(
      new RepositorioPlataformaPropria(nucleo).alterarConta('9', { ativo: true }, null),
    ).rejects.toThrow('não alterada');
  });

  it('o aviso ao Auditor fica registrado em sessao_suporte_aviso (false: a entrega é pela fila); falha ao gravar sobe', async () => {
    const { nucleo, chamadas } = falso(() => []);
    const aviso = { tipo: 'alerta-suporte', chave: 'suporte:h1:5', carga: { idSessao: '5', motivo: 'm1' } };
    expect(await new RepositorioPlataformaPropria(nucleo, () => 0).registrarAvisoComo(aviso)).toBe(false);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toContain('INSERT INTO sessao_suporte_aviso');
    expect(chamadas[0]?.p.slice(0, 4)).toEqual([
      5,
      'alerta-suporte',
      'suporte:h1:5',
      JSON.stringify(aviso.carga),
    ]);
    // Sem a gravação, o serviço encerra a sessão ('aviso-nao-registrado'): o erro não é engolido aqui.
    const quebrado: NucleoPlataforma = {
      lerPlataforma: () => Promise.reject(new Error('banco fora')),
      escreverPlataforma: () => Promise.reject(new Error('banco fora')),
    };
    await expect(new RepositorioPlataformaPropria(quebrado).registrarAvisoComo(aviso)).rejects.toThrow(
      'banco fora',
    );
    await expect(
      new RepositorioPlataformaPropria(nucleo).registrarAvisoComo({ ...aviso, carga: { idSessao: 'x' } }),
    ).rejects.toThrow('sessão inexistente');
  });

  it('o aceite do convite grava condicionado ao convite lido: 0 linhas é ErroConviteMudou (uso único)', async () => {
    const { nucleo, chamadas } = falso(() => [], 0);
    await expect(
      new RepositorioPlataformaPropria(nucleo).alterarConta('7', { cifra: 'c' }, null, { conviteHash: 'h1' }),
    ).rejects.toBeInstanceOf(ErroConviteMudou);
    expect(chamadas[0]?.sql).toContain('AND convite_resumo = ?');
    expect(chamadas[0]?.p.slice(-2)).toEqual(['h1', 'h1']);
  });
});

describe('FonteComoEstabelecimentoPropria', () => {
  it('cruzamento: só a origem da sessão consultada é do suporte; acima do limite ficam as mais recentes, com truncado', async () => {
    const linha = (id: number, origem: string | null): Linha => ({
      id,
      ocorrido_em: new Date(id * 1000),
      login: 'alvo',
      endereco_ip: '10.0.0.1',
      origem,
    });
    const leitor = (ls: Linha[]) =>
      ({
        uma: () => Promise.resolve({ id: 1 }),
        consultar: () => Promise.resolve(ls),
      }) as unknown as Leitor;
    const fonte = (ls: Linha[]) =>
      new FonteComoEstabelecimentoPropria({ lerSomente: (_o, fn) => fn(leitor(ls)) as never }, 'c');
    const janela = { sessao: '11', alvo: 'alvo', inicio: new Date(0), fim: new Date(1e7) };
    // o banco devolve da mais nova para a mais velha
    const r = await fonte([linha(3, '12'), linha(2, null), linha(1, '11')]).cruzamento('h1', janela);
    expect(r.truncado).toBe(false);
    expect(r.linhas.map((l) => [l.idTrilha, l.doSuporte])).toEqual([
      ['1', true],
      ['2', false],
      ['3', false],
    ]);
    const muitas = Array.from({ length: LIMITE_CRUZAMENTO + 1 }, (_, i) =>
      linha(LIMITE_CRUZAMENTO + 1 - i, null),
    );
    const t = await fonte(muitas).cruzamento('h1', janela);
    expect(t.truncado).toBe(true);
    expect(t.linhas).toHaveLength(LIMITE_CRUZAMENTO);
    expect(t.linhas[0]?.idTrilha).toBe('2');
    expect(t.linhas.at(-1)?.idTrilha).toBe(String(LIMITE_CRUZAMENTO + 1));
  });

  it('a correção é recusada (sem imagens no banco próprio) e nenhuma ação tem imagem', async () => {
    const f = new FonteComoEstabelecimentoPropria(
      { lerSomente: () => Promise.reject(new Error('não lê')) },
      'c',
    );
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

describe('aceite do convite (uso único) contra o repositório de memória', () => {
  it('dois aceites simultâneos do mesmo token: um define a senha, o outro é convite inválido', async () => {
    const repo = new RepositorioPlataformaMemoria(() => 1_000);
    const token = randomBytes(16).toString('hex');
    const hash = hashConvite(token);
    const id = await repo.criarConta(
      {
        email: 's@exemplo.invalid',
        nome: null,
        papel: 'SUPORTE',
        cifra: null,
        conviteHash: hash,
        conviteAte: new Date(9e12),
        criadoPor: null,
      },
      { ator: null, evento: 'plataforma.convite.criado', detalhe: null, estacao: 't' },
    );
    const servico = new ServicoPlataforma(repo, new ArmazemMemoria(), {
      ambiente: 'producao',
      produto: 'Teste',
      chaveMestra: randomBytes(32),
      agora: () => 1_000,
    });
    const r = await Promise.allSettled([
      servico.aceitarConvite(token, 'SenhaForte#2026a', 'e1'),
      servico.aceitarConvite(token, 'SenhaForte#2026b', 'e2'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason).toBeInstanceOf(ErroPlataforma);
    expect((falha.reason as ErroPlataforma).tipo).toBe('nao-encontrado');
    expect((await repo.contaPorId(id))?.conviteHash).toBeNull();
    expect(repo.eventos.filter((e) => e.evento === 'plataforma.senha.definida')).toHaveLength(1);
  });
});
