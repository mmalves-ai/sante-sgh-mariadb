// Segregação nas telas de administração de acesso (ficha do M10, regra 7; cap-08 §8.3.4, §8.4): quem concede
// acesso não concede a si mesmo; o Auditor não altera dado nem acesso; ninguém bloqueia a si mesmo. Vale também no
// "como" e no acesso total (o operador é o usuário da sessão). As receitas do legado conferem de novo dentro da
// transação (naoASiMesmo); esta regra responde antes, com a mensagem certa, sem abrir transação.
import { mesmoLogin } from './login.js';

export type AcaoGestao =
  | 'criar-usuario'
  | 'alterar-usuario'
  | 'bloquear-usuario'
  | 'desbloquear-usuario'
  | 'alterar-escopo'
  | 'conceder-opcao'
  | 'revogar-opcao'
  | 'aceitar-termo'
  | 'redefinir-senha';

export interface OperadorGestao {
  readonly login: string;
  /** Perfis efetivos do operador (o Auditor é o perfil `auditor`). */
  readonly perfis: readonly string[];
}

export type RecusaGestao = 'a-si-mesmo' | 'auditor-nao-altera';

const SOBRE_O_PROPRIO: ReadonlySet<AcaoGestao> = new Set([
  'alterar-usuario',
  'bloquear-usuario',
  'desbloquear-usuario',
  'alterar-escopo',
  'redefinir-senha',
]);

/**
 * Confere a ação. O termo é a exceção: cada pessoa aceita o próprio. O Auditor só consulta (o perfil auditor
 * sozinho; quem acumula auditor e gestor-acessos cai na regra de segregação do M06, que já retira um dos dois).
 */
export function conferirGestao(
  operador: OperadorGestao,
  acao: AcaoGestao,
  alvo: string | null,
): RecusaGestao | null {
  if (acao === 'aceitar-termo') return null;
  const soAuditor = operador.perfis.includes('auditor') && !operador.perfis.includes('gestor-acessos');
  if (soAuditor && !operador.perfis.includes('administrador-sistema')) return 'auditor-nao-altera';
  if (alvo !== null && SOBRE_O_PROPRIO.has(acao) && mesmoLogin(operador.login, alvo)) return 'a-si-mesmo';
  return null;
}

export function mensagemRecusaGestao(r: RecusaGestao, acao: AcaoGestao): string {
  if (r === 'auditor-nao-altera') return 'O perfil de auditoria só consulta: não altera dado nem acesso.';
  if (acao === 'redefinir-senha')
    return 'Ninguém redefine a própria senha: use "Trocar senha" (segregação de funções).';
  return acao === 'bloquear-usuario' || acao === 'desbloquear-usuario'
    ? 'Ninguém bloqueia nem desbloqueia a si mesmo.'
    : 'Ninguém altera o próprio acesso (segregação de funções).';
}
