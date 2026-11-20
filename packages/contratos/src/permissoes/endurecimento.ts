// Permissões do M59 (endurecimento depois da coexistência; ficha do M59, seções 7 e 8). Fatia F1 (contas e
// privilégios): o inventário das contas do banco e os desvios do privilégio mínimo por módulo, só consulta.
// Recurso novo (sem opção correspondente no menu antigo), concedido por perfil. A revogação em si não é tela:
// são scripts de GRANT e REVOKE em infra/firebird/fase7/privilegios/, aplicados pela TI com autorização do
// dono por passo (ficha, seções 6 e 12).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M59_CODIGOS = {
  contaBancoLer: 'acesso.contaBanco.ler',
  // F3 (imutabilidade e segredos): a imutabilidade se lê pelo painel de contas (acesso.contaBanco.ler).
  segredoLegadoLer: 'integracao.segredoLegado.ler',
  segredoLegadoGerir: 'integracao.segredoLegado.gerir',
  senhaSecundariaLer: 'acesso.senhaSecundaria.ler',
  senhaSecundariaRetirar: 'acesso.senhaSecundaria.retirar',
} as const;

export const PERMISSOES_M59: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_M59_CODIGOS.contaBancoLer,
    descricao:
      'Consultar as contas do banco de dados e os seus privilégios (inventário, uso medido e desvios do privilégio mínimo por módulo)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema', 'auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  // F3 (ficha do M59, seção 5 e regra 7): segredos de parceiros. Ler mostra só a situação (nunca o valor); gerir guarda
  // a credencial do Sante no cofre e retira o segredo antigo (crítica: reautenticação). Recurso novo, sem opção no
  // menu antigo: administrador do sistema (a TI do hospital).
  {
    codigo: PERMISSOES_M59_CODIGOS.segredoLegadoLer,
    descricao:
      'Consultar a situação dos segredos de parceiros guardados no banco (convênios, TISS, e-mail, equipamentos): cofre, rotação e retirada',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema', 'auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_M59_CODIGOS.segredoLegadoGerir,
    descricao:
      'Guardar no cofre a credencial que o sistema usa com o parceiro e retirar o segredo antigo do banco (depois do fim da contingência)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  // F3 (cap-08 §8.11): senhas secundárias (cancelamento de nota e a secundária) dos usuários. Gestor de acessos.
  {
    codigo: PERMISSOES_M59_CODIGOS.senhaSecundariaLer,
    descricao: 'Consultar quais usuários ainda têm senha secundária guardada (nunca a senha)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos', 'administrador-sistema', 'auditor'],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_M59_CODIGOS.senhaSecundariaRetirar,
    descricao:
      'Retirar as senhas secundárias de um usuário (a reautenticação ocupa o lugar delas), depois do fim da contingência',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'administrativa',
    criticidade: 'critica',
  },
];
