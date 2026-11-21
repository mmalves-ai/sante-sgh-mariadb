// Versão anterior da porta de senha, sobre o banco de origem (resumo SHA-1 com a combinação capturada). Fica FORA do
// boot da F2-L (API_MODULOS) e serve de referência para o conector; a porta em execução é porta-senha.ts (argon2id).
// W1-01 (parte 2): a troca de senha pelo novo grava no legado pelo executor (receita acesso.trocarSenha). O serviço
// de sessão confere a senha atual, a política e o reuso e entrega à porta só o resumo e o sal (nunca a senha). A
// combinação do resumo é a confirmada pelo vetor capturado do sistema anterior (ACESSO_COMBINACAO_SENHA): sem ela,
// a troca fica indisponível (dependência do dono, escrita nas evidências).
import {
  type Combinacao,
  type ContextoOperacao,
  type Executor,
  nascimentoDoUsuario,
  type NucleoLegado,
  operacao,
  reusoDaSenhaNova,
  type SenhaLegado,
  senhaJaUsada,
} from '@sgh/legado';

export type ReusoSenha = 'igual-atual' | 'repetida' | null;

export interface PortaSenhaLegado {
  /** Combinação confirmada do resumo (null: troca indisponível). */
  readonly combinacao: Combinacao | null;
  /** A senha nova repete a atual ou o histórico desde `desde` (null: só a atual)? */
  reuso(hospital: string, login: string, senhaNova: string, desde: Date | null): Promise<ReusoSenha>;
  /**
   * Revisão W1-01: a data de nascimento do usuário (AAAA-MM-DD, pelo profissional vinculado) para a recusa de senha
   * derivada do nascimento na troca; null quando não há vínculo ou data. Ausente: a recusa não tem a data.
   */
  nascimento?(hospital: string, login: string): Promise<string | null>;
  /**
   * Grava pelo executor (TBUSERS; TBHISTSENHA pelo gatilho do legado): `troca` (a própria, acesso.trocarSenha) ou
   * `redefinicao` (senha provisória do gestor, acesso.redefinirSenha). Devolve o ID_TBUSERS (null: memória do dev/ci).
   */
  gravar(
    hospital: string,
    login: string,
    senha: SenhaLegado,
    ctx: ContextoOperacao,
    tipo?: TipoGravacaoSenha,
  ): Promise<number | null>;
}

export const OPERACAO_TROCAR_SENHA = 'acesso.trocarSenha';
export const OPERACAO_REDEFINIR_SENHA = 'acesso.redefinirSenha';
export type TipoGravacaoSenha = 'troca' | 'redefinicao';

/** Núcleo real: leitura só de leitura para o reuso; a gravação pela receita do executor. */
export function portaSenhaDoNucleo(
  nucleo: Pick<NucleoLegado, 'lerSomente'>,
  executor: () => Executor,
  combinacao: Combinacao | null,
): PortaSenhaLegado {
  return {
    combinacao,
    reuso: (hospital, login, senhaNova, desde) => {
      if (!combinacao) return Promise.resolve(null);
      return nucleo.lerSomente({ rede: '', hospital, traceId: 'troca-senha' }, (l) =>
        reusoDaSenhaNova(l, login, senhaNova, combinacao, desde),
      );
    },
    nascimento: (hospital, login) =>
      nucleo.lerSomente({ rede: '', hospital, traceId: 'troca-senha' }, (l) => nascimentoDoUsuario(l, login)),
    async gravar(hospital, login, s, ctx, tipo = 'troca') {
      const r = await executor().executar(
        operacao(tipo === 'redefinicao' ? OPERACAO_REDEFINIR_SENHA : OPERACAO_TROCAR_SENHA),
        hospital,
        { login, resumo: s.resumo, sal: s.sal },
        ctx,
      );
      const id = (r as { resultado?: { idUsuario?: unknown } }).resultado?.idUsuario;
      return typeof id === 'number' ? id : null;
    },
  };
}

/**
 * Dev/ci (fonte sintética): guarda em memória o resumo de cada troca por conta, com a mesma conferência de reuso;
 * nada vai a banco. A senha nova passa a valer pela credencial forte regravada (identidade sintética).
 */
export function portaSenhaMemoria(combinacao: Combinacao = 'sha1-senha-salt'): PortaSenhaLegado & {
  trocas(hospital: string, login: string): number;
  /** Quantas gravações de cada tipo (troca ou redefinição) a conta recebeu. */
  tipos(hospital: string, login: string): TipoGravacaoSenha[];
  /** Dev/ci: a data de nascimento (AAAA-MM-DD) da conta, como viria do profissional vinculado. */
  definirNascimento(hospital: string, login: string, nascimento: string | null): void;
} {
  const nascimentos = new Map<string, string | null>();
  const guardadas = new Map<string, { resumo: string; sal: string; em: number; tipo: TipoGravacaoSenha }[]>();
  const chave = (h: string, l: string) => `${h}:${l}`;
  const confere = (senha: string, x: { resumo: string; sal: string }) =>
    senhaJaUsada(senha, [{ senha: x.resumo, salt: x.sal }], combinacao);
  return {
    combinacao,
    reuso(hospital, login, senhaNova, desde) {
      const lista = guardadas.get(chave(hospital, login)) ?? [];
      const atual = lista.at(-1);
      if (atual && confere(senhaNova, atual)) return Promise.resolve('igual-atual');
      if (desde === null) return Promise.resolve(null);
      const repetida = lista.some((x) => x.em >= desde.getTime() && confere(senhaNova, x));
      return Promise.resolve(repetida ? 'repetida' : null);
    },
    gravar(hospital, login, s, _ctx, tipo = 'troca') {
      const k = chave(hospital, login);
      guardadas.set(k, [...(guardadas.get(k) ?? []), { resumo: s.resumo, sal: s.sal, em: Date.now(), tipo }]);
      return Promise.resolve(null);
    },
    nascimento: (hospital, login) => Promise.resolve(nascimentos.get(chave(hospital, login)) ?? null),
    definirNascimento: (hospital, login, n) => void nascimentos.set(chave(hospital, login), n),
    trocas: (hospital, login) => guardadas.get(chave(hospital, login))?.length ?? 0,
    tipos: (hospital, login) => (guardadas.get(chave(hospital, login)) ?? []).map((x) => x.tipo),
  };
}
