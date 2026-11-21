// Redefinição da senha de outro usuário (acesso.redefinir-senha) sobre o banco do cliente: a credencial vale para o
// cliente inteiro, então a operação recusa (409) o alvo sem vínculo vigente com o estabelecimento do gestor e a conta
// de administração (perfil administrador ou administrador_plataforma), salvo o ator da plataforma; e nenhuma gravação
// de credencial sai sem autor. Sem banco: transação de mentira que responde pelas mesmas consultas.
import { cifrarSenha } from '@sgh/dominio-acesso';
import {
  type ContextoOperacao,
  ErroOperacao,
  type Executor,
  executarComo,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { type ContextoSenha, OPERACOES_SENHA, portaSenhaDoNucleo } from './porta-senha.js';

const LEVE = { memoria: 8192, passes: 1, paralelismo: 1 };
const ALVO = 7;
const GESTOR = 3;

function tx(o: { usuario: number | null; vinculo?: boolean; administracao?: boolean }) {
  const escritas: string[] = [];
  const t = {
    contexto: { usuario: o.usuario, estabelecimento: 2 } as ContextoOperacao,
    uma: <T>(sql: string) => {
      if (/FROM usuario_estabelecimento/.test(sql))
        return Promise.resolve((o.vinculo === false ? null : { id: 1 }) as T | null);
      if (/administrador_plataforma = 1/.test(sql))
        return Promise.resolve((o.administracao ? { id: ALVO } : null) as T | null);
      if (/FROM usuario WHERE login/.test(sql)) return Promise.resolve({ id: ALVO } as T);
      return Promise.resolve(null);
    },
    consultar: () => Promise.resolve([]),
    consultarParaAtualizar: () => Promise.resolve([{ id: 11, versao: 1 }]),
    alterar: (tabela: string) => {
      escritas.push(tabela);
      return Promise.resolve(2);
    },
    incluir: (tabela: string) => {
      escritas.push(tabela);
      return Promise.resolve(99);
    },
  } as unknown as TxOperacao;
  return { t, escritas };
}

async function recusaDe(p: Promise<unknown>): Promise<{ status: number; codigo: unknown }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroOperacao);
  const pr = (e as ErroOperacao).problema;
  return { status: pr.status, codigo: pr['codigo' as keyof typeof pr] };
}

const MARCA_PLATAFORMA = {
  sessao: 's-1',
  acao: null,
  atorTipo: 'plataforma' as const,
  idConta: '1',
  alvo: 'gestor',
};

describe('acesso.redefinir-senha: alvo e autor', () => {
  it('gestor comum redefinindo a senha do ADMIN (perfil administrador): 409, nada gravado', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t, escritas } = tx({ usuario: GESTOR, administracao: true });
    const e = OPERACOES_SENHA.redefinicao.gravar(
      t,
      { login: 'ADMIN', resumo, tipo: 'redefinicao' },
      t.contexto,
    );
    expect(await recusaDe(e)).toEqual({ status: 409, codigo: 'alvo-administrador' });
    expect(escritas).toEqual([]);
  });

  it('alvo sem vínculo vigente com o estabelecimento do gestor: 409', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t, escritas } = tx({ usuario: GESTOR, vinculo: false });
    const e = OPERACOES_SENHA.redefinicao.gravar(
      t,
      { login: 'outro', resumo, tipo: 'redefinicao' },
      t.contexto,
    );
    expect(await recusaDe(e)).toEqual({ status: 409, codigo: 'alvo-fora-do-estabelecimento' });
    expect(escritas).toEqual([]);
  });

  it('alvo comum com vínculo vigente: grava', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t, escritas } = tx({ usuario: GESTOR });
    const r = await OPERACOES_SENHA.redefinicao.gravar(
      t,
      { login: 'comum', resumo, tipo: 'redefinicao' },
      t.contexto,
    );
    expect(r).toEqual({ idUsuario: ALVO });
    expect(escritas).toEqual(['credencial_usuario', 'historico_senha']);
  });

  it('a recuperação ("Esqueci a senha": autor = alvo) não passa pela conferência do gestor', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t } = tx({ usuario: ALVO, vinculo: false, administracao: true });
    await expect(
      OPERACOES_SENHA.redefinicao.gravar(t, { login: 'ADMIN', resumo, tipo: 'redefinicao' }, t.contexto),
    ).resolves.toEqual({ idUsuario: ALVO });
  });

  it('o administrador da plataforma (marca do núcleo, levada à trilha) redefine a do ADMIN', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t } = tx({ usuario: null, administracao: true, vinculo: false });
    await expect(
      executarComo(MARCA_PLATAFORMA, () =>
        OPERACOES_SENHA.redefinicao.gravar(t, { login: 'ADMIN', resumo, tipo: 'redefinicao' }, t.contexto),
      ),
    ).resolves.toEqual({ idUsuario: ALVO });
  });

  it('sem autor no cliente e sem a marca da plataforma: recusa (autor-inexistente), na operação e na porta', async () => {
    const resumo = await cifrarSenha('Nova#2027x', LEVE);
    const { t, escritas } = tx({ usuario: null });
    const e = OPERACOES_SENHA.troca.gravar(t, { login: 'comum', resumo, tipo: 'troca' }, t.contexto);
    expect(await recusaDe(e)).toEqual({ status: 409, codigo: 'autor-inexistente' });
    expect(escritas).toEqual([]);

    // A porta: o autor não resolve no banco do cliente; o Executor nem é chamado.
    let chamado = false;
    const nucleo = {
      lerSomente: <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) =>
        fn({ uma: () => Promise.resolve(null), consultar: () => Promise.resolve([]) } as unknown as Leitor),
    };
    const executor = {
      executar: () => {
        chamado = true;
        return Promise.resolve({ resultado: { idUsuario: 1 } });
      },
    } as unknown as Executor;
    const ctx: ContextoSenha = {
      rede: 'rede-teste',
      estabelecimento: 'aa',
      autor: 'plataforma-sem-linha',
      correlacao: 'teste',
      chaveIdempotencia: 'k',
      estacao: 'teste',
      reautenticadoEm: 1,
    };
    const porta = portaSenhaDoNucleo(nucleo as never, () => executor, 'teste_login');
    expect(await recusaDe(porta.gravar('aa', 'comum', resumo, ctx, 'redefinicao'))).toEqual({
      status: 409,
      codigo: 'autor-inexistente',
    });
    expect(chamado).toBe(false);
  });
});
