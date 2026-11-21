// Permissões do M55, fatia F1 (ficha, seção 7: telas "Abrir e acompanhar OS" e "Equipamentos e preventiva";
// convencoes.md §12). Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06).
// Levantamento na cópia do pc (24/10/2026, só contagens): o módulo "Manutenção" (módulo 21 do menu de origem) existe, mas não tem
// nenhuma opção no menu de origem, e as 22 tabelas de manutenção estão vazias. A opção mais próxima é a do patrimônio, módulo 19,
// "Gestão patrimonial" (4266) › Movimentação (268) › Manutenção de Bens (272, Saída 273, Retorno 274) e Relatórios
// (276) › Relatório de Manutenção (285), cada uma concedida a 1 grupo e a nenhum papel.
// Decisão do preparo (D-PERM-55, POL-5): a equipe de manutenção é quem tem "Manutenção de Bens" no patrimônio; abrir a OS
// é de todo perfil de pessoa (ficha: "qualquer usuário, do seu setor"; o setor é conferido no servidor contra os
// centros de custo do usuário). O módulo `manutencao` não tem escopo ABAC (escoposDaPermissao devolve []).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_MANUTENCAO = {
  moduloPatrimonio: 4266,
  movimentacao: 268,
  manutencaoBens: 272,
  manutencaoBensSaida: 273,
  manutencaoBensRetorno: 274,
  relatorios: 276,
  relatorioManutencao: 285,
} as const;

const O = OPCOES_MANUTENCAO;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_MANUTENCAO_M55_F1: readonly DeclaracaoPermissao[] = [
  p(
    'manutencao.os.abrir',
    'Abrir ordem de serviço de manutenção para o seu setor e acompanhar as que abriu',
    [],
    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'manutencao.os.atender',
    'Triar, assumir e dar andamento às ordens de serviço de manutenção de todos os setores',
    [O.manutencaoBens, O.manutencaoBensSaida, O.manutencaoBensRetorno],
  ),
  p(
    'manutencao.os.encerrar',
    'Concluir, encerrar e cancelar ordem de serviço de manutenção, com causa, custo e laudo',
    [O.manutencaoBensRetorno],
    { criticidade: 'sensivel' },
  ),
  p(
    'manutencao.equipamento.ler',
    'Consultar equipamentos, planos de manutenção, laudos, contratos de manutenção e indicadores',
    [O.manutencaoBens, O.manutencaoBensSaida, O.manutencaoBensRetorno, O.relatorioManutencao],
  ),
  p(
    'manutencao.equipamento.editar',
    'Cadastrar e alterar equipamentos e as coberturas por contrato de manutenção',
    [O.manutencaoBens],
  ),
  p(
    'manutencao.preventiva.planejar',
    'Planejar manutenção preventiva, calibração e segurança elétrica e registrar a execução com o laudo',
    [O.manutencaoBens],
  ),
];

/** Os códigos das permissões da manutenção (para os decoradores da API e as telas). */
export const PERMISSOES_MANUTENCAO_CODIGOS = {
  osAbrir: 'manutencao.os.abrir',
  osAtender: 'manutencao.os.atender',
  osEncerrar: 'manutencao.os.encerrar',
  equipamentoLer: 'manutencao.equipamento.ler',
  equipamentoEditar: 'manutencao.equipamento.editar',
  preventivaPlanejar: 'manutencao.preventiva.planejar',
} as const;
