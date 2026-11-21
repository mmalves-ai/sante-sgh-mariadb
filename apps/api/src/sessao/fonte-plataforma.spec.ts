// Fonte do login do administrador da plataforma (decisão do dono 2026-11-20, b) sobre um núcleo de mentira: senha
// conferida antes da situação da conta e do cliente, falha contada, cliente suspenso recusado, troca grava só o resumo
// argon2id. Sem banco e sem dado pessoal.
import { describe, expect, it } from 'vitest';
import { cifrarSenha } from '@sgh/dominio-acesso';
import type { Escritor, Leitor, Linha } from '@sgh/nucleo';
import { FontePlataformaPropria, type NucleoPlataforma, nucleoPlataforma } from './fonte-plataforma.js';

const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const SENHA = 'Inicial#2026x';

async function cenario(
  opcoes: { ativo?: boolean; bloqueadoAte?: Date | null; situacao?: string; semCredencial?: boolean } = {},
) {
  const credencial = {
    id: 7,
    nome: 'Administrador',
    ativo: (opcoes.ativo ?? true) ? 1 : 0,
    resumo_senha: await cifrarSenha(SENHA, RAPIDO),
    troca_obrigatoria: 1,
    bloqueado_ate: opcoes.bloqueadoAte ?? null,
    senha_alterada_em: new Date('2026-11-01T10:00:00.123Z'),
  };
  const escritos: { sql: string; p: readonly unknown[] }[] = [];
  const leitor = {
    cliente: 'plataforma',
    consultar: <T extends Linha>(sql: string): Promise<T[]> =>
      Promise.resolve((/FROM cliente/.test(sql) ? [{ codigo: 'cliente_a' }] : []) as unknown as T[]),
    uma: <T extends Linha>(sql: string, p: readonly unknown[] = []): Promise<T | null> => {
      if (/FROM credencial_administrador_plataforma/.test(sql)) {
        const achou = !opcoes.semCredencial && (p[0] === 'dono' || p[0] === 7);
        return Promise.resolve((achou ? credencial : null) as T | null);
      }
      if (/FROM cliente/.test(sql))
        return Promise.resolve(
          (p[0] === 'cliente_a' ? { situacao: opcoes.situacao ?? 'implantacao' } : null) as T | null,
        );
      return Promise.resolve(null);
    },
  } satisfies Leitor;
  const nucleo: NucleoPlataforma = {
    lerPlataforma: (_c, fn) => fn(leitor),
    escreverPlataforma: (_c, fn) =>
      fn({
        ...leitor,
        executar: (sql: string, p: readonly unknown[] = []) => {
          escritos.push({ sql, p });
          return Promise.resolve(1);
        },
      } as unknown as Escritor),
  };
  return { fonte: new FontePlataformaPropria(nucleo, () => new Date('2026-11-20T12:00:00Z')), escritos };
}

describe('FontePlataformaPropria', () => {
  it('senha certa no cliente ativo: o ator da plataforma com a troca obrigatória', async () => {
    const { fonte } = await cenario();
    expect(await fonte.autenticar('dono', SENHA, 'cliente_a')).toEqual({
      desfecho: 'ok',
      ator: {
        tipo: 'plataforma',
        idAdministrador: 7,
        nomeExibicao: 'Administrador',
        cliente: 'cliente_a',
        trocaObrigatoria: true,
        senhaAlteradaEm: Date.parse('2026-11-01T10:00:00.123Z'),
      },
    });
    expect(await fonte.clientes()).toEqual(['cliente_a']);
  });

  it('senha errada ou login inexistente: credencial inválida; a falha da conta existente é contada', async () => {
    const { fonte, escritos } = await cenario();
    expect(await fonte.autenticar('dono', 'Errada#1', 'cliente_a')).toEqual({
      desfecho: 'credencial-invalida',
    });
    expect(escritos).toHaveLength(1);
    expect(escritos[0]?.sql).toMatch(/tentativas_falhas \+ 1/);
    // A contagem é da credencial (o id) e arma o bloqueio no limite (5, prazo de 15 min).
    expect(escritos[0]?.sql).toMatch(/SET bloqueado_ate = IF\(tentativas_falhas \+ 1 >= \?/);
    expect(escritos[0]?.p).toEqual([5, new Date('2026-11-20T12:15:00Z'), 5, 7]);
    expect(await fonte.autenticar('outro', SENHA, 'cliente_a')).toEqual({ desfecho: 'credencial-invalida' });
    // Senha errada nunca revela a situação do cliente nem a da conta.
    const suspenso = (await cenario({ situacao: 'suspenso', ativo: false })).fonte;
    expect(await suspenso.autenticar('dono', 'Errada#1', 'cliente_x')).toEqual({
      desfecho: 'credencial-invalida',
    });
  });

  it('conta inativa ou bloqueada: impedida; cliente suspenso ou inexistente: indisponível', async () => {
    expect(await (await cenario({ ativo: false })).fonte.autenticar('dono', SENHA, 'cliente_a')).toEqual({
      desfecho: 'conta-impedida',
    });
    expect(
      await (
        await cenario({ bloqueadoAte: new Date('2026-11-20T13:00:00Z') })
      ).fonte.autenticar('dono', SENHA, 'cliente_a'),
    ).toEqual({ desfecho: 'conta-impedida' });
    expect(
      await (
        await cenario({ bloqueadoAte: new Date('2026-11-20T11:00:00Z') })
      ).fonte.autenticar('dono', SENHA, 'cliente_a'),
    ).toMatchObject({ desfecho: 'ok' });
    expect(
      await (await cenario({ situacao: 'suspenso' })).fonte.autenticar('dono', SENHA, 'cliente_a'),
    ).toEqual({
      desfecho: 'cliente-indisponivel',
    });
    expect(await (await cenario()).fonte.autenticar('dono', SENHA, 'cliente_x')).toEqual({
      desfecho: 'cliente-indisponivel',
    });
  });

  it('conferir (reautenticação) e gravar a senha nova (só o resumo argon2id)', async () => {
    const { fonte, escritos } = await cenario();
    expect(await fonte.conferir(7, SENHA)).toBe(true);
    expect(await fonte.conferir(7, 'Errada#1')).toBe(false);
    expect(await fonte.conferir(8, SENHA)).toBe(false);
    const resumo = await cifrarSenha('Nova#2026abc', RAPIDO);
    await fonte.gravarSenha(7, resumo, 'correlacao-1', 'cliente_a');
    const ultimo = escritos.find((x) => /resumo_senha = \?/.test(x.sql));
    // O evento da troca na linha do tempo do cliente, na mesma transação (sem a senha nem o resumo).
    const evento = escritos.find((x) => /INSERT INTO cliente_evento/.test(x.sql));
    expect(evento?.p).toContain('cliente_a');
    expect(JSON.stringify(evento)).not.toContain(resumo);
    expect(ultimo?.sql).toMatch(/troca_obrigatoria = FALSE/);
    expect(ultimo?.p).toContain(resumo);
    expect(JSON.stringify(escritos)).not.toContain('Nova#2026abc');
    await expect(fonte.gravarSenha(7, 'texto-puro', 'c', 'cliente_a')).rejects.toThrow();
  });

  it('bloqueio armado: senha errada não conta mais; senha certa liberada zera a contagem', async () => {
    const bloqueada = await cenario({ bloqueadoAte: new Date('2026-11-20T13:00:00Z') });
    expect(await bloqueada.fonte.autenticar('dono', 'Errada#1', 'cliente_a')).toEqual({
      desfecho: 'credencial-invalida',
    });
    expect(bloqueada.escritos).toHaveLength(0);
    const livre = await cenario();
    await livre.fonte.autenticar('dono', SENHA, 'cliente_a');
    expect(livre.escritos.map((x) => x.sql).join(' ')).toMatch(
      /SET tentativas_falhas = 0, bloqueado_ate = NULL/,
    );
  });

  it('situação da credencial (releitura da sessão aberta)', async () => {
    expect(await (await cenario()).fonte.situacao(7)).toEqual({
      ativo: true,
      senhaAlteradaEm: Date.parse('2026-11-01T10:00:00.123Z'),
    });
    expect(await (await cenario({ ativo: false })).fonte.situacao(7)).toMatchObject({ ativo: false });
    expect(await (await cenario()).fonte.situacao(8)).toBe(null);
  });

  it('nucleoPlataforma: só o núcleo que lê o banco plataforma', () => {
    expect(nucleoPlataforma(null)).toBe(null);
    expect(nucleoPlataforma({ lerSomente: () => null })).toBe(null);
    const n = { lerPlataforma: () => null, escreverPlataforma: () => null };
    expect(nucleoPlataforma(n)).toBe(n);
  });
});
