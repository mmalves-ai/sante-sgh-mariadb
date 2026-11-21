// Permissões do orçamento empresarial, etapa 7 (M54-F7; ficha, seção 7 "Orçamento empresarial"; convencoes.md §12):
// montar o orçamento anual por centro de custo e item, aprovar a versão e comparar com o realizado. Quem tem a opção no
// outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem "Gestão de orçamento" (4261;
// catalogo-legado.json, pc): Tabelas 584 (Parâmetros 585); Lançamentos 586 (Orçamento 587, Gerar orçamento 588);
// Relatórios 589 (Acompanhamento de orçamento 590, Modelos I a III 591 a 593, Comparativo 594). No pc nenhum grupo tem
// as opções de Gestão de orçamento (preparo do M54, §2.6): a concessão vai também pelo perfil complementar `controller`
// (SGH_ACESSO_MAPA_OPCAO), que a DP-3 confere. O outro sistema não tem opção de aprovar orçamento: a aprovação vem das
// opções de lançamento do orçamento (587, 588) e do perfil, e é sempre de outra pessoa que não quem montou a versão
// (segregação de funções, D-SEGREGA-547).
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar do controller (Fase 6, regra 7: perfis da fase). */
export const PERFIL_CONTROLLER = 'controller';

export const OPCOES_ORCAMENTO = {
  modulo: 4261,
  tabelas: 584,
  parametros: 585,
  lancamentos: 586,
  orcamento: 587,
  gerarOrcamento: 588,
  relatorios: 589,
  acompanhamento: 590,
  modeloI: 591,
  modeloII: 592,
  modeloIII: 593,
  comparativo: 594,
} as const;

const O = OPCOES_ORCAMENTO;

export const PERMISSOES_ORCAMENTO_CODIGOS = {
  ler: 'financeiro.orcamento.ler',
  editar: 'financeiro.orcamento.editar',
  aprovar: 'financeiro.orcamento.aprovar',
} as const;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: 'por-perfil',
  perfis: [PERFIL_CONTROLLER],
  categoria: 'financeira',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_ORCAMENTO_M54_F7: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_ORCAMENTO_CODIGOS.ler,
    'Consultar o orçamento empresarial (versões, linhas por centro de custo e item) e o comparativo orçado × realizado',
    // 587 e 588 também leem: quem monta ou aprova o orçamento abre a tela e lista as versões (regra 1 do M06).
    [
      O.tabelas,
      O.parametros,
      O.lancamentos,
      O.orcamento,
      O.gerarOrcamento,
      O.relatorios,
      O.acompanhamento,
      O.modeloI,
      O.modeloII,
      O.modeloIII,
      O.comparativo,
    ],
  ),
  p(
    PERMISSOES_ORCAMENTO_CODIGOS.editar,
    'Montar o orçamento anual: criar versão (vazia, cópia ou a partir do realizado do ano anterior), lançar os valores por centro de custo, item e mês e descartar a versão em elaboração',
    [O.lancamentos, O.orcamento, O.gerarOrcamento],
  ),
  p(
    PERMISSOES_ORCAMENTO_CODIGOS.aprovar,
    'Aprovar a versão do orçamento (a vigente do ano passa a ser a aprovada; a anterior fica guardada como substituída)',
    [O.orcamento, O.gerarOrcamento],
    { criticidade: 'sensivel' },
  ),
];
