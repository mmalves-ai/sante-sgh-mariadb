// Troca e redefinição de senha sobre o banco do cliente (F2-L): só argon2id. O serviço de sessão confere a senha
// atual, a política e o reuso e entrega à porta só o resumo PHC já cifrado (cifrarSenha de @sgh/dominio-acesso);
// a senha em claro nunca chega à gravação. A gravação é uma operação do Executor do núcleo: credencial_usuario e
// historico_senha na mesma transação, com a trilha. O reuso confere a senha nova contra a credencial atual e o
// histórico da janela (conferirSenha, argon2id). Nenhum resumo vai a log, trilha ou resposta.
import { conferirSenha } from '@sgh/dominio-acesso';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  origemComoAtual,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export type ReusoSenha = 'igual-atual' | 'repetida' | null;

/** Tipo da gravação: a própria troca ou a senha provisória dada pelo gestor (ou pela recuperação). */
export type TipoGravacaoSenha = 'troca' | 'redefinicao';

/** Quem grava e de onde (vocabulário neutro; o adaptador resolve os ids pelo banco do cliente). */
export interface ContextoSenha {
  readonly rede: string;
  /** Código do estabelecimento da sessão. */
  readonly estabelecimento: string;
  /** Login de quem faz a gravação (o próprio, o gestor ou o próprio na recuperação). */
  readonly autor: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly estacao: string;
  readonly reautenticadoEm: number;
}

export interface PortaSenha {
  /** A senha nova repete a atual ou o histórico desde `desde` (null: só a atual)? */
  reuso(estabelecimento: string, login: string, senhaNova: string, desde: Date | null): Promise<ReusoSenha>;
  /**
   * A data de nascimento do usuário (AAAA-MM-DD) para a recusa de senha derivada do nascimento; null sem a data.
   * Ausente: a recusa não tem a data.
   */
  nascimento?(estabelecimento: string, login: string): Promise<string | null>;
  /**
   * Grava o resumo argon2id (PHC) da senha nova: `troca` (a própria) ou `redefinicao` (provisória, troca obrigatória
   * no próximo acesso). Devolve o usuario.id (null: memória do dev/ci).
   */
  gravar(
    estabelecimento: string,
    login: string,
    resumo: string,
    ctx: ContextoSenha,
    tipo?: TipoGravacaoSenha,
  ): Promise<number | null>;
}

export const OPERACAO_TROCAR_SENHA = 'acesso.trocar-senha';
export const OPERACAO_REDEFINIR_SENHA = 'acesso.redefinir-senha';
export const ALGORITMO_SENHA = 'argon2id';
/** Quantas senhas anteriores, no máximo, o reuso confere (cada conferência custa um argon2id). */
export const HISTORICO_REUSO_MAXIMO = 24;

const RESUMO_ARGON2ID = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

/** O resumo é PHC argon2id (nada de texto puro nem de outro algoritmo). */
export function resumoArgon2id(resumo: string): boolean {
  return RESUMO_ARGON2ID.test(resumo);
}

const entradaSenha = z.object({
  login: z.string().trim().min(1).max(60),
  resumo: z.string().max(255).refine(resumoArgon2id, 'resumo fora do formato argon2id'),
  tipo: z.enum(['troca', 'redefinicao']),
});
type EntradaSenha = z.infer<typeof entradaSenha>;

interface LinhaCredencial {
  readonly id: number;
  readonly versao: number;
  readonly [coluna: string]: unknown;
}

async function idDoUsuario(l: Leitor, login: string): Promise<number | null> {
  const u = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
    login,
  ]);
  return u ? Number(u.id) : null;
}

async function idDoEstabelecimento(l: Leitor, codigo: string): Promise<number | null> {
  const e = await l.uma<{ id: number }>(
    'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [codigo],
  );
  return e ? Number(e.id) : null;
}

/**
 * O autor é o administrador da plataforma? Só pela marca do núcleo (sessão do ator da plataforma, que o Executor leva à
 * trilha na mesma transação, com o id da conta dele no banco plataforma); nunca por coluna do banco do cliente nem
 * por campo da entrada.
 */
function autorDaPlataforma(): boolean {
  return origemComoAtual()?.atorTipo === 'plataforma';
}

/**
 * Redefinição da senha de OUTRO usuário (o gestor de acessos): a credencial vale para o cliente inteiro, então o
 * gestor só redefine a de quem tem vínculo vigente com o estabelecimento da sessão dele, e nunca a de uma conta de
 * administração (perfil com administrador=1, vigente ou futuro, em qualquer estabelecimento, ou
 * administrador_plataforma=1). Só o administrador da plataforma passa por cima (decisão do dono, b).
 */
async function conferirAlvoDaRedefinicao(tx: TxOperacao, idUsuario: number): Promise<void> {
  const estabelecimento = tx.contexto.estabelecimento;
  if (estabelecimento === null)
    throw recusa('estabelecimento-ausente', 'A redefinição de senha exige o estabelecimento da sessão.');
  const vinculo = await tx.uma<{ id: number }>(
    `SELECT id FROM usuario_estabelecimento
      WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
      LIMIT 1`,
    [idUsuario, estabelecimento],
  );
  if (!vinculo)
    throw recusa(
      'alvo-fora-do-estabelecimento',
      'O usuário não tem vínculo vigente com este estabelecimento: a senha dele não se redefine daqui.',
    );
  const administracao = await tx.uma<{ id: number }>(
    `SELECT u.id FROM usuario u
      WHERE u.id = ? AND (u.administrador_plataforma = 1 OR EXISTS (
        SELECT 1 FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id
         WHERE up.usuario_id = u.id AND up.excluido_em IS NULL AND p.excluido_em IS NULL AND p.administrador = 1
           AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)))`,
    [idUsuario],
  );
  if (administracao)
    throw recusa(
      'alvo-administrador',
      'A senha de uma conta de administração só é redefinida pelo administrador da plataforma.',
    );
}

async function gravarSenha(tx: TxOperacao, e: EntradaSenha): Promise<{ idUsuario: number }> {
  const plataforma = autorDaPlataforma();
  // Operação crítica de credencial: sem autor identificado (usuário do cliente ou ator da plataforma), recusa.
  if (tx.contexto.usuario === null && !plataforma)
    throw recusa('autor-inexistente', 'Quem grava a senha não foi identificado neste cliente.');
  const idUsuario = await idDoUsuario(tx, e.login);
  if (idUsuario === null) throw recusa('usuario-inexistente', 'Usuário não encontrado neste cliente.');
  if (e.tipo === 'redefinicao' && idUsuario !== tx.contexto.usuario && !plataforma)
    await conferirAlvoDaRedefinicao(tx, idUsuario);
  const agora = new Date();
  const redefinicao = e.tipo === 'redefinicao';
  const [atual] = await tx.consultarParaAtualizar<LinhaCredencial>(
    'SELECT id, versao FROM credencial_usuario WHERE usuario_id = ? AND excluido_em IS NULL',
    [idUsuario],
  );
  const valores = {
    algoritmo: ALGORITMO_SENHA,
    resumo_senha: e.resumo,
    senha_alterada_em: agora,
    troca_obrigatoria: redefinicao,
    tentativas_invalidas: 0,
    ultima_tentativa_invalida_em: null,
  };
  if (atual) await tx.alterar('credencial_usuario', Number(atual.id), Number(atual.versao), valores);
  else await tx.incluir('credencial_usuario', { usuario_id: idUsuario, ...valores });
  await tx.incluir('historico_senha', {
    usuario_id: idUsuario,
    operacao: atual ? 'alteracao' : 'inclusao',
    hash_senha: e.resumo,
    algoritmo: ALGORITMO_SENHA,
    forma_troca: redefinicao ? 'redefinicao' : 'troca_voluntaria',
    ocorrido_em: agora,
    responsavel_usuario_id: tx.contexto.usuario,
  });
  return { idUsuario };
}

const operacaoSenha = (nome: string) =>
  definirOperacao<EntradaSenha, { idUsuario: number }>({
    nome,
    tabelas: ['credencial_usuario', 'historico_senha'],
    entrada: entradaSenha,
    acao: 'alteracao',
    critica: true,
    gravar: (tx, e) => gravarSenha(tx, e),
    alvo: (_e, r) => ({ tabela: 'credencial_usuario', id: r.idUsuario }),
  });

export const OPERACOES_SENHA = Object.freeze({
  troca: operacaoSenha(OPERACAO_TROCAR_SENHA),
  redefinicao: operacaoSenha(OPERACAO_REDEFINIR_SENHA),
});

/** A senha nova repete a atual ou alguma do histórico desde `desde`? Confere por argon2id, linha a linha. */
export async function reusoNoBanco(
  l: Leitor,
  login: string,
  senhaNova: string,
  desde: Date | null,
): Promise<ReusoSenha> {
  const idUsuario = await idDoUsuario(l, login);
  if (idUsuario === null) return null;
  const atual = await l.uma<{ resumo_senha: string }>(
    "SELECT resumo_senha FROM credencial_usuario WHERE usuario_id = ? AND excluido_em IS NULL AND algoritmo = 'argon2id'",
    [idUsuario],
  );
  if (atual && (await conferirSenha(senhaNova, atual.resumo_senha))) return 'igual-atual';
  if (desde === null) return null;
  const anteriores = await l.consultar<{ hash_senha: string }>(
    "SELECT hash_senha FROM historico_senha WHERE usuario_id = ? AND algoritmo = 'argon2id' AND ocorrido_em >= ? ORDER BY ocorrido_em DESC, id DESC LIMIT ?",
    [idUsuario, desde, HISTORICO_REUSO_MAXIMO],
  );
  for (const h of anteriores) if (await conferirSenha(senhaNova, h.hash_senha)) return 'repetida';
  return null;
}

function dataIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** Banco do cliente: reuso e nascimento pelo Leitor; a gravação pela operação do Executor. */
export function portaSenhaDoNucleo(
  nucleo: Pick<NucleoProprio, 'lerSomente'>,
  executor: () => Executor,
  cliente: string,
): PortaSenha {
  const ler = <T>(correlacao: string, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ cliente, estabelecimento: null, usuario: null, correlacao }, fn);
  return {
    reuso: (_estabelecimento, login, senhaNova, desde) =>
      ler('troca-senha', (l) => reusoNoBanco(l, login, senhaNova, desde)),
    nascimento: (_estabelecimento, login) =>
      ler('troca-senha', async (l) => {
        const u = await l.uma<{ data_nascimento: unknown }>(
          'SELECT data_nascimento FROM usuario WHERE login = ? AND excluido_em IS NULL',
          [login],
        );
        return u ? dataIso(u.data_nascimento) : null;
      }),
    async gravar(estabelecimento, login, resumo, ctx, tipo = 'troca') {
      const ids = await ler(ctx.correlacao, async (l) => ({
        estabelecimento: await idDoEstabelecimento(l, estabelecimento),
        autor: await idDoUsuario(l, ctx.autor),
      }));
      // O autor tem de existir no cliente (ou ser o ator da plataforma, levado à trilha pelo Executor): nunca grava
      // a credencial sem autoria.
      if (ids.autor === null && !autorDaPlataforma())
        throw recusa('autor-inexistente', 'Quem grava a senha não foi identificado neste cliente.');
      const contexto: ContextoOperacao = {
        cliente,
        estabelecimento: ids.estabelecimento,
        usuario: ids.autor,
        correlacao: ctx.correlacao.slice(0, 64),
        chaveIdempotencia: ctx.chaveIdempotencia,
        reautenticadoEm: ctx.reautenticadoEm,
      };
      const r = await executor().executar(OPERACOES_SENHA[tipo], cliente, { login, resumo, tipo }, contexto);
      return r.resultado.idUsuario;
    },
  };
}

/**
 * Dev/ci (fonte sintética) e testes: guarda em memória o resumo de cada gravação por conta, com a mesma conferência
 * de reuso (argon2id); nada vai a banco.
 */
export function portaSenhaMemoria(agora: () => number = () => Date.now()): PortaSenha & {
  trocas(estabelecimento: string, login: string): number;
  /** Quantas gravações de cada tipo (troca ou redefinição) a conta recebeu. */
  tipos(estabelecimento: string, login: string): TipoGravacaoSenha[];
  /** A data de nascimento (AAAA-MM-DD) da conta. */
  definirNascimento(estabelecimento: string, login: string, nascimento: string | null): void;
} {
  const nascimentos = new Map<string, string | null>();
  const guardadas = new Map<string, { resumo: string; em: number; tipo: TipoGravacaoSenha }[]>();
  const chave = (h: string, l: string) => `${h}:${l}`;
  return {
    async reuso(estabelecimento, login, senhaNova, desde) {
      const lista = guardadas.get(chave(estabelecimento, login)) ?? [];
      const atual = lista.at(-1);
      if (atual && (await conferirSenha(senhaNova, atual.resumo))) return 'igual-atual';
      if (desde === null) return null;
      for (const x of lista.slice(0, -1).reverse().slice(0, HISTORICO_REUSO_MAXIMO))
        if (x.em >= desde.getTime() && (await conferirSenha(senhaNova, x.resumo))) return 'repetida';
      return null;
    },
    gravar(estabelecimento, login, resumo, _ctx, tipo = 'troca') {
      if (!resumoArgon2id(resumo))
        return Promise.reject(recusa('senha-sem-cifra', 'A senha só é guardada cifrada (argon2id).'));
      const k = chave(estabelecimento, login);
      guardadas.set(k, [...(guardadas.get(k) ?? []), { resumo, em: agora(), tipo }]);
      return Promise.resolve(null);
    },
    nascimento: (estabelecimento, login) =>
      Promise.resolve(nascimentos.get(chave(estabelecimento, login)) ?? null),
    definirNascimento: (estabelecimento, login, n) => void nascimentos.set(chave(estabelecimento, login), n),
    trocas: (estabelecimento, login) => guardadas.get(chave(estabelecimento, login))?.length ?? 0,
    tipos: (estabelecimento, login) =>
      (guardadas.get(chave(estabelecimento, login)) ?? []).map((x) => x.tipo),
  };
}
