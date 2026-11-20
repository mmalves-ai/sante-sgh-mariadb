// O que o serviço de sessão precisa do núcleo do legado (M02 + M05). NucleoLegado implementa; os testes
// usam a fonte sintética, sem banco. Mantém a leitura READ ONLY do adaptador.
import type {
  Autenticacao,
  Combinacao,
  ConfigLogin,
  ContaAlvo,
  DadosSessao,
  SaudeEstabelecimento,
} from '@sgh/legado';
import type { FonteAutorizacao } from '../autorizacao/servico-autorizacao.js';

/** M06: também lê as concessões, os escopos e o vínculo do legado (FonteAutorizacao). */
export interface FonteAcesso extends FonteAutorizacao {
  readonly rede: string;
  readonly estabelecimentos: readonly { readonly codigo: string }[];
  saude(): SaudeEstabelecimento[];
  autenticar(codigo: string, login: string, senha: string, fixa?: Combinacao): Promise<Autenticacao>;
  /** Política (TBCFGLOGIN); o serviço guarda em cache por 5 min. */
  configLogin(codigo: string): Promise<ConfigLogin>;
  dadosDeSessao(codigo: string, login: string, config?: ConfigLogin): Promise<DadosSessao>;
  /** ADR 0021: a conta-alvo do "login como", sem nada de credencial (READ ONLY). */
  contaAlvo?(codigo: string, login: string): Promise<ContaAlvo | null>;
}

export const FONTE_ACESSO = Symbol('FONTE_ACESSO');
