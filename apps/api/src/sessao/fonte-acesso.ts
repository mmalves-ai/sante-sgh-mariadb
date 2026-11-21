// O que o serviço de sessão precisa da fonte de acesso: a fonte própria (MariaDB do cliente, pelo Leitor de
// @sgh/nucleo) em execução; a sintética nos testes, sem banco. Só leitura: as gravações do login (tentativas,
// troca de senha) passam pelo Executor do núcleo.
import type { FonteAutorizacao } from '../autorizacao/servico-autorizacao.js';
import type {
  Autenticacao,
  ConfigLogin,
  ContaAlvo,
  DadosSessao,
  SaudeEstabelecimento,
} from './tipos-acesso.js';

export type {
  AtorPlataforma,
  Autenticacao,
  AutenticacaoPlataforma,
  ConfigLogin,
  ContaAcesso,
  ContaAlvo,
  DadosSessao,
  FontePlataforma,
  SituacaoAdministradorPlataforma,
  SaudeEstabelecimento,
  SituacaoTermoAcesso,
} from './tipos-acesso.js';

/** M06: também lê as concessões, os escopos e o vínculo (FonteAutorizacao). */
export interface FonteAcesso extends FonteAutorizacao {
  readonly rede: string;
  readonly estabelecimentos: readonly { readonly codigo: string }[];
  saude(): SaudeEstabelecimento[];
  autenticar(codigo: string, login: string, senha: string): Promise<Autenticacao>;
  /** Política de senha e de sessão; o serviço guarda em cache por 5 min. */
  configLogin(codigo: string): Promise<ConfigLogin>;
  dadosDeSessao(codigo: string, login: string, config?: ConfigLogin): Promise<DadosSessao>;
  /** ADR 0021: a conta-alvo do "login como", sem nada de credencial (só leitura). */
  contaAlvo?(codigo: string, login: string): Promise<ContaAlvo | null>;
}

export const FONTE_ACESSO = Symbol('FONTE_ACESSO');
