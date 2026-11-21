// Tipos de negócio da gestão de acessos (tela "Perfis e permissões", contas dormentes, recertificação, RH e pedidos):
// o que a FonteGestao lê e grava, em vocabulário neutro (login, código do perfil, data, booleano). Nada aqui lê banco.
// Os tipos das versões, limites, exceções, conferências, pedidos e RH ficam em tipos-gestao-acesso.ts.
// Melhoria: o contexto das operações da conta (ContextoGestao) leva a chave de idempotência e a correlação com nomes
// neutros; o operador é o login da sessão, e a porta própria o resolve para usuario.id dentro da mesma transação.
import type { EstadoOperacao } from '@sgh/contratos';
import { esquemaConcederPapelUsuario, esquemaLogin, esquemaPapelUsuario } from '@sgh/contratos';
import { z } from 'zod';
import type { EventoParaTrilha } from '../../autorizacao/trilha.js';

/** Onde a fonte grava: o banco próprio do cliente ou o estado sintético (dev/ci e testes). */
export type DestinoGestao = 'banco' | 'memoria';

/** O que vai à trilha de uma gravação da gestão (o alvo e o id são da própria gravação). */
export type TrilhaGestao = Omit<EventoParaTrilha, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'> & {
  readonly operacao?: string;
};

/** O estado de cada operação no catálogo de operações do estabelecimento. */
export interface CatalogoOperacoes {
  estado(operacao: string, hospital: string): EstadoOperacao | null;
  motivo?(operacao: string, hospital: string): string | null;
}

/** Contexto de uma operação da conta (bloquear, papéis): quem, de onde e a chave do pedido. */
export interface ContextoGestao {
  readonly rede: string;
  readonly hospital: string;
  /** Login de quem opera. */
  readonly usuario: string;
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly estacao?: string;
  readonly reautenticadoEm?: number;
}

export interface UsuarioGestao {
  readonly login: string;
  readonly nome: string;
  /** Sem grupos no modelo próprio (o perfil é a unidade de concessão): sempre null no banco. */
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly id: number;
}

export interface PapelUsuario {
  readonly papel: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface PapelGestao {
  readonly papel: number;
  readonly nome: string;
  readonly opcoes: readonly number[];
}

export interface PerfilConcedidoLido {
  readonly id: string;
  readonly perfil: string;
  readonly inicio: Date;
  readonly fim: Date | null;
  readonly motivo: string | null;
  readonly concedidoPor: string;
  readonly revogadoEm: Date | null;
  readonly revogadoPor: string | null;
  readonly revogadoMotivo?: string | null;
  readonly alteracoes?: number;
  /** A versão da concessão (trava otimista da alteração). */
  readonly versao?: number;
}

export interface ConcessaoPerfilNova {
  readonly idUsuario: number;
  readonly login: string;
  readonly perfil: string;
  /** Login (ou nome) de quem concede; o ator real vai à trilha. */
  readonly concedidoPor: string;
  readonly areaAprovou: string;
  readonly inicio: Date | null;
  readonly fim: Date | null;
  readonly motivo: string;
}

export interface AlteracaoPerfilConcedido {
  readonly id: string;
  readonly inicio: Date;
  readonly fim: Date | null;
  readonly motivo: string;
  readonly justificativa: string;
  readonly por: string;
  /** A versão da concessão que a tela leu: diferente da do banco, 409 conflito-versao (sem ela, a última). */
  readonly versao?: number;
}

export type ResultadoAlteracaoPerfil =
  | { readonly situacao: 'ok'; readonly login: string; readonly perfil: string; readonly alteracao: string }
  | { readonly situacao: 'inexistente' }
  | { readonly situacao: 'a-si-mesmo' };

export interface LinhaMapaLida {
  readonly id: string;
  readonly tipo: 'grupo-perfil' | 'perfil-permissao';
  readonly grupo: string | null;
  readonly perfil: string;
  readonly permissao: string | null;
  readonly origem: 'proposta-automatica' | 'revisao-area';
  readonly situacao: 'proposta' | 'aprovada' | 'recusada';
  readonly aprovadoPor: string | null;
  readonly aprovadoEm: Date | null;
}

export interface DecisaoMapa {
  readonly tipo: 'grupo-perfil' | 'perfil-permissao';
  readonly grupo: string | null;
  readonly perfil: string;
  readonly permissao: string | null;
  readonly situacao: 'proposta' | 'aprovada' | 'recusada';
  readonly origem: 'proposta-automatica' | 'revisao-area';
  readonly por: string;
  readonly motivo?: string | null;
  readonly usuariosAfetados?: number | null;
}

export interface ConsultaCandidatosMapa {
  readonly tipo: 'grupo-perfil' | 'perfil-permissao';
  readonly grupo: string | null;
  readonly perfil: string;
  readonly grupos?: readonly string[];
  readonly papeis?: readonly number[];
}

export interface DescricaoGrupoLida {
  readonly id: string;
  readonly grupo: string;
  readonly versao: number;
  readonly descricao: string;
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date | null;
  readonly situacao: 'vigente' | 'substituida' | 'retirada';
  readonly encerradaEm: Date | null;
  readonly encerradaPor: string | null;
}

export interface NovaDescricaoGrupo {
  readonly grupo: string;
  readonly descricao: string;
  readonly motivo: string;
  readonly por: string;
}

/** Conta ativa e livre, com o último acesso (ISO), para a rotina das contas dormentes. */
export interface ContaDormencia {
  readonly login: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly ultimoAcesso: string | null;
}

/** Retrato de uma conta ativa para a campanha de recertificação. */
export interface ContaRecert {
  readonly login: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly setores: string[];
  readonly perfis: string[];
}

export interface GestorAcessoLido {
  readonly login: string;
  readonly grupo: string | null;
  readonly papelGestor: boolean;
  readonly concessoes: readonly string[];
}

/**
 * Os cinco papéis de segurança da certificação (número da tela ↔ papel_seguranca.codigo). A tela e o domínio usam o
 * número (0 = gestor de acessos); o banco guarda o código.
 */
export const CODIGOS_PAPEL: Readonly<Record<number, string>> = {
  0: 'gestor_acessos',
  1: 'administrador_sistema',
  2: 'auditor',
  3: 'operador_backup',
  4: 'operador_sistema',
};

/** Nomes dos cinco papéis (fonte sintética e rótulo padrão). */
export const NOMES_PAPEL: Readonly<Record<number, string>> = {
  0: 'Gestor de acessos',
  1: 'Administrador do sistema',
  2: 'Auditor',
  3: 'Operador de backup',
  4: 'Operador de sistema',
};

/** O perfil que faz de alguém gestor de acessos (regra do último gestor). */
export const PERFIL_GESTOR_ACESSOS = 'gestor-acessos';

/** Operações da conta que a fonte executa (bloqueio e papéis de segurança), com a entrada validada. */
export const OPERACOES_CONTA = {
  'acesso.bloquearUsuario': z.object({ login: esquemaLogin }).strict(),
  'acesso.concederPapelUsuario': esquemaConcederPapelUsuario,
  'acesso.revogarPapelUsuario': esquemaPapelUsuario,
  'acesso.reativarPapelUsuario': esquemaPapelUsuario,
} as const;
export type OperacaoConta = keyof typeof OPERACOES_CONTA;
export const ehOperacaoConta = (nome: string): nome is OperacaoConta => Object.hasOwn(OPERACOES_CONTA, nome);

/** As operações de grupo do sistema de origem: o modelo próprio não tem grupo (o perfil concede). */
export const SEM_GRUPOS =
  'O Sante SGH não tem grupos de usuários: as permissões vêm dos perfis concedidos a cada pessoa. Conceda ou retire o perfil.';
