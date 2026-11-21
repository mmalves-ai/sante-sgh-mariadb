// Porta de senha da F2-L (só argon2id): reuso contra a credencial e o histórico, gravação pela operação do Executor
// (credencial_usuario e historico_senha) e o contexto neutro que chega ao núcleo. Sem banco: Leitor e transação de
// mentira, com as mesmas consultas.
import { cifrarSenha } from '@sgh/dominio-acesso';
import type { ContextoOperacao, Executor, Leitor, TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type ContextoSenha,
  OPERACAO_REDEFINIR_SENHA,
  OPERACAO_TROCAR_SENHA,
  OPERACOES_SENHA,
  portaSenhaDoNucleo,
  portaSenhaMemoria,
  resumoArgon2id,
  reusoNoBanco,
} from './porta-senha.js';

// O mínimo que conferirSenha aceita (8 MiB, 1 passe): rápido no teste, mesmo formato PHC.
const LEVE = { memoria: 8192, passes: 1, paralelismo: 1 };
const cifrar = (s: string) => cifrarSenha(s, LEVE);
const CTX: ContextoSenha = {
  rede: 'rede-teste',
  estabelecimento: 'aa',
  autor: 'gestor',
  correlacao: 'teste-senha',
  chaveIdempotencia: 'chave-1',
  estacao: 'teste',
  reautenticadoEm: 1,
};

function leitor(respostas: {
  usuario?: number | null;
  atual?: string | null;
  historico?: string[];
}): Leitor & {
  sqls: string[];
} {
  const sqls: string[] = [];
  return {
    cliente: 'teste_login',
    sqls,
    uma: <T>(sql: string) => {
      sqls.push(sql);
      // Conferências da redefinição: vínculo vigente com o estabelecimento (sim) e conta de administração (não).
      if (/FROM usuario_estabelecimento/.test(sql)) return Promise.resolve({ id: 1 } as T);
      if (/administrador_plataforma = 1/.test(sql)) return Promise.resolve(null);
      if (/FROM usuario/.test(sql))
        return Promise.resolve((respostas.usuario ? { id: respostas.usuario } : null) as T | null);
      if (/FROM credencial_usuario/.test(sql))
        return Promise.resolve((respostas.atual ? { resumo_senha: respostas.atual } : null) as T | null);
      return Promise.resolve(null);
    },
    consultar: <T>(sql: string) => {
      sqls.push(sql);
      return Promise.resolve((respostas.historico ?? []).map((h) => ({ hash_senha: h })) as T[]);
    },
  } as Leitor & { sqls: string[] };
}

describe('porta de senha (argon2id)', () => {
  it('resumoArgon2id aceita só o PHC argon2id', async () => {
    expect(resumoArgon2id(await cifrar('Qualquer#123'))).toBe(true);
    expect(resumoArgon2id('Qualquer#123')).toBe(false);
    expect(resumoArgon2id('$argon2i$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).toBe(false);
    expect(resumoArgon2id('A94A8FE5CCB19BA61C4C0873D391E987982FBBD3')).toBe(false);
  });

  it('reuso no banco: igual à atual, repetida na janela, livre; sem usuário, nada', async () => {
    const atual = await cifrar('Atual#2026');
    const antiga = await cifrar('Antiga#2025');
    const l = leitor({ usuario: 7, atual, historico: [antiga] });
    expect(await reusoNoBanco(l, 'u', 'Atual#2026', new Date(0))).toBe('igual-atual');
    expect(await reusoNoBanco(l, 'u', 'Antiga#2025', new Date(0))).toBe('repetida');
    expect(await reusoNoBanco(l, 'u', 'Antiga#2025', null)).toBeNull();
    expect(await reusoNoBanco(l, 'u', 'Nova#2027x', new Date(0))).toBeNull();
    expect(l.sqls.some((s) => /historico_senha/.test(s) && /LIMIT \?/.test(s))).toBe(true);
    expect(await reusoNoBanco(leitor({ usuario: null }), 'u', 'Atual#2026', new Date(0))).toBeNull();
  });

  it('a operação grava credencial (alteração com a versão lida) e o histórico, sem a senha em claro', async () => {
    const resumo = await cifrar('Nova#2027x');
    const escritas: { acao: string; tabela: string; valores: Record<string, unknown>; versao?: number }[] =
      [];
    const tx = {
      ...leitor({ usuario: 7 }),
      contexto: { usuario: 3, estabelecimento: 2 } as ContextoOperacao,
      consultarParaAtualizar: () => Promise.resolve([{ id: 11, versao: 4 }]),
      alterar: (tabela: string, _id: number, versao: number, valores: Record<string, unknown>) => {
        escritas.push({ acao: 'alterar', tabela, valores, versao });
        return Promise.resolve(versao + 1);
      },
      incluir: (tabela: string, valores: Record<string, unknown>) => {
        escritas.push({ acao: 'incluir', tabela, valores });
        return Promise.resolve(99);
      },
    } as unknown as TxOperacao;
    const op = OPERACOES_SENHA.redefinicao;
    expect(op.nome).toBe(OPERACAO_REDEFINIR_SENHA);
    expect(op.critica).toBe(true);
    expect([...op.tabelas]).toEqual(['credencial_usuario', 'historico_senha']);
    const r = await op.gravar(tx, { login: 'u', resumo, tipo: 'redefinicao' }, {} as ContextoOperacao);
    expect(r).toEqual({ idUsuario: 7 });
    expect(escritas.map((e) => `${e.acao}:${e.tabela}`)).toEqual([
      'alterar:credencial_usuario',
      'incluir:historico_senha',
    ]);
    expect(escritas[0]!.versao).toBe(4);
    expect(escritas[0]!.valores).toMatchObject({
      algoritmo: 'argon2id',
      resumo_senha: resumo,
      troca_obrigatoria: true,
      tentativas_invalidas: 0,
    });
    expect(escritas[1]!.valores).toMatchObject({
      usuario_id: 7,
      operacao: 'alteracao',
      forma_troca: 'redefinicao',
      responsavel_usuario_id: 3,
    });
    expect(JSON.stringify(escritas)).not.toContain('Nova#2027x');
  });

  it('a entrada recusa resumo fora do argon2id', () => {
    const e = OPERACOES_SENHA.troca.entrada.safeParse({ login: 'u', resumo: 'texto-puro', tipo: 'troca' });
    expect(e.success).toBe(false);
  });

  it('portaSenhaDoNucleo: resolve os ids pelo banco e chama o Executor com o contexto neutro', async () => {
    const resumo = await cifrar('Nova#2027x');
    const chamadas: { nome: string; cliente: string; entrada: unknown; ctx: ContextoOperacao }[] = [];
    const nucleo = {
      lerSomente: <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(leitor({ usuario: 5 })),
    };
    const executor = {
      executar: (op: { nome: string }, cliente: string, entrada: unknown, ctx: ContextoOperacao) => {
        chamadas.push({ nome: op.nome, cliente, entrada, ctx });
        return Promise.resolve({ resultado: { idUsuario: 5 }, repetida: false, eventos: [], trilha: 1 });
      },
    } as unknown as Executor;
    const porta = portaSenhaDoNucleo(nucleo as never, () => executor, 'teste_login');
    expect(await porta.gravar('aa', 'u', resumo, CTX)).toBe(5);
    const c = chamadas[0]!;
    expect(c.nome).toBe(OPERACAO_TROCAR_SENHA);
    expect(c.cliente).toBe('teste_login');
    expect(c.entrada).toEqual({ login: 'u', resumo, tipo: 'troca' });
    expect(c.ctx).toMatchObject({
      cliente: 'teste_login',
      usuario: 5,
      correlacao: 'teste-senha',
      chaveIdempotencia: 'chave-1',
      reautenticadoEm: 1,
    });
  });

  it('memória: reuso igual-atual e repetida na janela; recusa texto puro', async () => {
    let t = 1_000;
    const p = portaSenhaMemoria(() => t);
    await p.gravar('aa', 'u', await cifrar('Primeira#1'), CTX);
    t = 5_000;
    await p.gravar('aa', 'u', await cifrar('Segunda#2'), CTX, 'redefinicao');
    expect(await p.reuso('aa', 'u', 'Segunda#2', null)).toBe('igual-atual');
    expect(await p.reuso('aa', 'u', 'Primeira#1', new Date(0))).toBe('repetida');
    expect(await p.reuso('aa', 'u', 'Primeira#1', new Date(2_000))).toBeNull();
    expect(p.tipos('aa', 'u')).toEqual(['troca', 'redefinicao']);
    await expect(p.gravar('aa', 'u', 'Terceira#3', CTX)).rejects.toMatchObject({
      problema: { codigo: 'senha-sem-cifra' },
    });
    expect(p.trocas('aa', 'u')).toBe(2);
  });
});
