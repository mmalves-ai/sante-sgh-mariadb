// Tipos neutros do acesso (F2-L): o que a fonte de acesso entrega ao serviço de sessão, sem nada do banco de
// origem. Copiados e renomeados a partir da versão anterior do produto: ContaLegado virou ContaAcesso (sem a
// marca de cifra antiga nem o segundo fator antigo); a combinação de cifra antiga saiu do contrato (é assunto do
// conector). A cifra do caminho novo é argon2id (@sgh/dominio-acesso, cifra-plataforma). Nenhum tipo aqui leva
// senha, resumo de senha ou dado pessoal além do nome de exibição.
import type { PapelSessao, UnidadeSessao } from '@sgh/contratos';
import type { PoliticaSenhaLegado, PoliticaSenhaSante, SituacaoTermo } from '@sgh/dominio-acesso';

/** Situação da conta (tabela usuario), sem nenhum dado sensível. */
export interface ContaAcesso {
  readonly login: string;
  /** usuario.id */
  readonly id: number;
  readonly nomeExibicao: string;
  /** situacao ativa, sem exclusão e dentro da validade (expira_em). */
  readonly ativo: boolean;
  /** bloqueado_em preenchido. */
  readonly bloqueado: boolean;
  readonly senhaAlteradaEm: Date | null;
  /** Sem credencial guardada: não há o que conferir (o chamador nunca abre sessão com isso). */
  readonly semCifra: boolean;
  /** credencial_usuario.troca_obrigatoria: a sessão abre só para trocar a senha. */
  readonly trocaObrigatoria: boolean;
  // Sem marca de "administrador da plataforma" aqui: a conta do cliente nunca vira "pode tudo" por coluna do
  // banco do cliente (decisão do dono 2026-11-20, b). O ator da plataforma é AtorPlataforma, abaixo.
}

/**
 * Administrador da plataforma (decisão do dono 2026-11-20, b; ADR 0022): autenticado contra a credencial do banco
 * plataforma (db/plataforma/0002, argon2id), nunca contra o banco de um cliente. No login escolhe o cliente (ou há
 * um só) e entra nele com todas as permissões (autorizacaoDoAtorPlataforma). Não é usuário do cliente: nada de
 * usuário-espelho.
 */
export interface AtorPlataforma {
  readonly tipo: 'plataforma';
  /** administrador_plataforma.id no banco plataforma. */
  readonly idAdministrador: number;
  readonly nomeExibicao: string;
  /** Código do cliente escolhido no login (plataforma.cliente.codigo). */
  readonly cliente: string;
  /** Senha inicial (semeador) ou redefinida: a sessão abre só para trocar a senha. */
  readonly trocaObrigatoria?: boolean;
  /**
   * credencial.senha_alterada_em (ms) na entrada: a sessão vale enquanto a credencial for a mesma (senha trocada ou
   * redefinida em outro lugar derruba as sessões abertas com a anterior).
   */
  readonly senhaAlteradaEm?: number;
}

/** Situação atual da credencial do administrador (releitura da sessão aberta). null: não existe mais. */
export interface SituacaoAdministradorPlataforma {
  readonly ativo: boolean;
  readonly senhaAlteradaEm: number;
}

export type AutenticacaoPlataforma =
  | { readonly desfecho: 'ok'; readonly ator: AtorPlataforma }
  | { readonly desfecho: 'credencial-invalida' }
  /** Administrador inativo ou bloqueado no banco plataforma. */
  | { readonly desfecho: 'conta-impedida' }
  /** O cliente escolhido não existe ou não está ativo na plataforma. */
  | { readonly desfecho: 'cliente-indisponivel' };

/** Porta do login da plataforma: lê só o banco plataforma (credencial e clientes ativos). */
export interface FontePlataforma {
  /** Códigos dos clientes ativos, para o seletor do login (um só: escolhido sem perguntar). */
  clientes(): Promise<readonly string[]>;
  /**
   * Senha conferida primeiro; só depois a situação do administrador e a do cliente (quem não tem a senha não sonda
   * clientes nem contas).
   */
  autenticar(login: string, senha: string, cliente: string): Promise<AutenticacaoPlataforma>;
  /** Reautenticação e senha atual da troca: confere a senha do administrador (inativo ou bloqueado: false). */
  conferir(idAdministrador: number, senha: string): Promise<boolean>;
  /**
   * Grava o resumo argon2id novo (troca da senha): zera a troca obrigatória, as tentativas e o bloqueio e registra o
   * evento na linha do tempo do cliente (cliente_evento), na mesma transação. Devolve o senha_alterada_em gravado (ms).
   */
  gravarSenha(idAdministrador: number, resumo: string, correlacao: string, cliente: string): Promise<number>;
  /**
   * Releitura da credencial para a sessão aberta (ativo e senha_alterada_em). O bloqueio por tentativas não entra:
   * impede entradas novas, mas derrubar as sessões vivas por senhas erradas daria a qualquer um o poder de expulsar o
   * administrador.
   */
  situacao(idAdministrador: number): Promise<SituacaoAdministradorPlataforma | null>;
}

export type Autenticacao =
  | { readonly desfecho: 'ok'; readonly conta: ContaAcesso }
  /** Conta sem senha guardada: senha NÃO conferida; o chamador nunca abre sessão com este desfecho. */
  | { readonly desfecho: 'sem-cifra'; readonly conta: ContaAcesso }
  | { readonly desfecho: 'credencial-invalida' }
  | { readonly desfecho: 'conta-impedida'; readonly conta: ContaAcesso };

/**
 * Política de senha e de sessão do estabelecimento (politica_senha). `senha` tem a forma que
 * @sgh/dominio-acesso espera em politicaEfetiva; `sante` é a camada complementar que só aperta (ausente: nenhuma).
 */
export interface ConfigLogin {
  readonly senha: PoliticaSenhaLegado;
  readonly tempo: {
    readonly inatividadeSegundos: number | null;
    readonly avisoSegundos: number | null;
  };
  readonly limiteTentativas: number | null;
  readonly termoPeriodico: boolean;
  readonly quantidadePeriodoTermo: number | null;
  /** D dias, M meses, A anos. */
  readonly tipoPeriodoTermo: string | null;
  readonly sante?: PoliticaSenhaSante | null;
  /** Sessões simultâneas por perfil no estabelecimento; '*' é o padrão. Ausente ou vazio: sem limite. */
  readonly limitesSessao?: Readonly<Record<string, number>>;
}

/**
 * Padrão seguro quando o estabelecimento não tem linha em politica_senha (quem usa registra aviso no log):
 * 8 caracteres com letra e número, troca a cada 90 dias, sem reuso por 365, 5 tentativas, 30 min de inatividade.
 */
export const CONFIG_LOGIN_PADRAO: ConfigLogin = Object.freeze({
  senha: Object.freeze({
    minimoCaracteres: 8,
    exigeLetra: true,
    exigeNumero: true,
    exigeEspecial: false,
    exigeMinuscula: false,
    exigeMaiuscula: false,
    periodoTrocaDias: 90,
    periodoReutilizacaoDias: 365,
  }),
  tempo: Object.freeze({ inatividadeSegundos: 1800, avisoSegundos: 120 }),
  limiteTentativas: 5,
  termoPeriodico: false,
  quantidadePeriodoTermo: null,
  tipoPeriodoTermo: null,
  sante: null,
});

/** Situação do termo de uso (aceite_termo_uso × termo_uso_versao); mesma forma de @sgh/dominio-acesso. */
export type SituacaoTermoAcesso = SituacaoTermo;

/** Dados crus que o serviço de sessão combina com as regras puras para montar a sessão. */
export interface DadosSessao {
  readonly papeis: PapelSessao[];
  readonly unidades: UnidadeSessao[];
  readonly termo: SituacaoTermoAcesso;
  readonly config: ConfigLogin;
}

/** Situação da conta-alvo do "login como" (sem nada de credencial). */
export interface ContaAlvo {
  readonly login: string;
  readonly id: number;
  readonly nomeExibicao: string;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  /** Perfil principal do alvo (código), ou null. */
  readonly grupo: string | null;
  /** O perfil existe e está ativo. */
  readonly grupoAtivo: boolean;
}

/** Saúde de um estabelecimento do cliente, para o seletor do login. */
export interface SaudeEstabelecimento {
  readonly codigo: string;
  readonly nomeConfigurado: string;
  /** Conectou e pode aparecer no seletor do login. */
  readonly disponivel: boolean;
  /** Por que não está disponível (sem dado: só o motivo técnico neutro). */
  readonly motivo: string | null;
  readonly conectado: boolean;
}
