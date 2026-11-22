// Permissões do M12 (ficha, seção 7; convencoes.md §12): convênios, contratos, tabelas de preço, importação
// versionada e o motor de preços (consulta). Quem tem a opção no legado tem a permissão no novo: as opções vêm
// da árvore do menu de origem do módulo Tabelas › Convênios (Consultar 6307, Alterar 3567, Excluir 3569, Gerenciamento
// 3570/6309/3974, Honorários médicos › Gerenciamento 6313/3710/3712, Diárias/Taxas 6311, Índices 6315, Porte
// anestésico 3591, Porte médico 3592, Índice/Procedimento 3588, Controles › Honorários médicos 3564) e de
// Utilitários › Importações › Tabelas (3768). A correspondência ação → opção é inferida (POL-1b) quando a
// árvore não tem item próprio, e é conferida na validação humana (pendência nas evidências do M12).
// Os códigos seguem o formato do catálogo (três partes em camelCase): `convenio.codigoPrestador.ler`
// (a ficha escreve `codigo_prestador`), `preco.dePara.ler` e `cadastro.credenciamento.verBancario`.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_M12: readonly DeclaracaoPermissao[] = [
  {
    codigo: 'convenio.operadora.ler',
    descricao: 'Consultar convênios e operadoras (lista com busca por palavra e situação)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'convenio.situacao.alterar',
    descricao: 'Suspender ou reativar convênio (com justificativa e a senha de novo)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'critica',
  },
  {
    codigo: 'convenio.contrato.ler',
    descricao:
      'Consultar o contrato do convênio em abas (cadastro, tabelas, modificadores, TISS, financeiro)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'convenio.contrato.editar',
    descricao: 'Alterar cadastro, elegibilidade e financeiro do contrato do convênio (crítica)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'critica',
  },
  {
    codigo: 'convenio.codigoPrestador.ler',
    descricao: 'Consultar os códigos de prestador e o acesso a portais (senha de portal nunca aparece)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'sensivel',
  },
  {
    codigo: 'convenio.dominio.ler',
    descricao: 'Ver as classificações oncológicas de operadora (CRUD genérico)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'convenio.dominio.editar',
    descricao: 'Incluir e alterar as classificações oncológicas de operadora (CRUD genérico)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'convenio.credenciamento.ler',
    descricao: 'Consultar credenciamento e código do prestador por convênio (sem as colunas bancárias)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'cadastro.credenciamento.verBancario',
    descricao: 'Ver as colunas bancárias do credenciamento (banco, agência, conta)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'sensivel',
  },
  {
    codigo: 'preco.tabela.ler',
    descricao: 'Consultar tabelas de preço (honorários, diárias e taxas, mat/med) e o valor vigente',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'preco.reajuste.aplicar',
    descricao: 'Reajustar tabela de honorários como nova vigência (crítica; autoria registrada)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'critica',
  },
  {
    codigo: 'preco.reajuste.desfazer',
    descricao: 'Desfazer reajuste ainda não usado em conta (crítica)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'critica',
  },
  {
    codigo: 'preco.importacao.ler',
    descricao: 'Ver as importações versionadas de tabela de preço e as comparações',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'preco.importacao.criar',
    descricao: 'Preparar uma importação de tabela de preço (arquivo, validação e comparação)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'preco.importacao.aprovar',
    descricao:
      'Aprovar e publicar a importação como reajuste por arquivo (crítica; supervisor do faturamento)',

    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'critica',
  },
  {
    codigo: 'preco.dePara.ler',
    descricao: 'Consultar o de-para de exames por convênio',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'preco.porte.ler',
    descricao: 'Consultar portes anestésicos, índices por procedimento e tabelas próprias de operadora',

    concessaoPorPerfil: null,
    categoria: 'financeira',
  },
  {
    codigo: 'preco.regraParticular.ler',
    descricao:
      'Consultar as regras de preço particular do médico ou da agenda e o cálculo do preço com a origem (ADR 0009)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'financeira',
  },
  {
    codigo: 'preco.regraParticular.editar',
    descricao: 'Incluir regra de preço particular do médico ou da agenda (só no particular; ADR 0009)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'financeira',
  },
  {
    codigo: 'convenio.credenciamento.editar',
    descricao:
      'Credenciar profissional no convênio e definir alerta ou bloqueio sem credenciamento (ADR 0009)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'financeira',
  },
  {
    codigo: 'agenda.estruturada.ler',
    descricao:
      'Consultar a agenda estruturada (cobertura, restrições, preparo, texto original) e as respostas ao paciente',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  {
    codigo: 'agenda.estruturada.editar',
    descricao: 'Incluir cobertura por convênio e plano, restrição e preparo da agenda (ADR 0009)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
];
