// Permissões do M59-F2 (senhas, segundo fator e identidade; ficha do M59, seção 7). Recursos novos (o menu antigo
// não tem política de segundo fator nem retirada de senha), concedidos por perfil. A situação das senhas e do
// segundo fator na tela de usuários usa a permissão de leitura de usuários do M10 (acesso.usuario.ler).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M59_F2_CODIGOS = {
  politica2faLer: 'acesso.politica2fa.ler',
  politica2faEditar: 'acesso.politica2fa.editar',
  senhaLegadoRetirar: 'acesso.senhaLegado.retirar',
} as const;

export const PERMISSOES_M59_F2: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_M59_F2_CODIGOS.politica2faLer,
    descricao:
      'Consultar a política do segundo fator por perfil, por grupo e por estabelecimento (ondas e prazos)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos', 'administrador-sistema', 'auditor'],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_M59_F2_CODIGOS.politica2faEditar,
    descricao:
      'Tornar o segundo fator obrigatório (ou voltar a opcional) por perfil, por grupo ou para todos',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: PERMISSOES_M59_F2_CODIGOS.senhaLegadoRetirar,
    descricao:
      'Retirar a senha antiga de um usuário que já entra com a credencial forte (só depois do fim da contingência)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['gestor-acessos'],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
];
