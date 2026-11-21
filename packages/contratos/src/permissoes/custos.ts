// Permissões dos custos hospitalares, etapa 4 (M54-F4; ficha, seção 7 "Centros de custo e rateio"; convencoes.md §12):
// a estrutura de custos (classificação dos centros, ordem e critério do rateio) e a coleta e o lançamento das
// estatísticas. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem
// "Gestão de custos" (4258; catalogo-legado.json, pc): Tabelas 295 (Parâmetros 296, Tabela de ocupação 297, Centros de
// custo 298, Unidade de mensuração 299); Lançamentos › Gerar lançamentos 304 › Buscar produção 307 (SADT 308, Internação
// 312, Bloco cirúrgico 313); Calcular itens de produção 319; Consultas › Centro de custo 321. No pc nenhum grupo tem as
// opções de Gestão de custos (acesso-legado.pc.json, 24/10/2026): a concessão vai também pelo perfil complementar
// `analista-custos` (SGH_ACESSO_MAPA_OPCAO), que a DP-3 confere. As etapas seguintes (apuração, resultado) declaram as
// suas no mesmo arquivo.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar do analista de custos (Fase 6, regra 7: perfis da fase). */
export const PERFIL_ANALISTA_CUSTOS = 'analista-custos';

export const OPCOES_CUSTOS = {
  modulo: 4258,
  tabelas: 295,
  parametros: 296,
  tabelaOcupacao: 297,
  centrosCusto: 298,
  unidadeMensuracao: 299,
  buscarProducao: 307,
  producaoSadt: 308,
  producaoInternacao: 312,
  producaoBloco: 313,
  calcularItensProducao: 319,
  consultaCentroCusto: 321,
  manutencao: 302,
  gerarLancamentos: 304,
  producaoFaturamento: 309,
  producaoEstoque: 310,
  gerarValores: 314,
  zerarValores: 315,
  rateios: 316,
  matMed: 318,
  consultas: 320,
  grupoSubgrupoItem: 322,
  comparativoFaturamento: 323,
  custoProcedimento: 324,
  inconsistencias: 325,
  relatorios: 326,
  relatorioLancamentos: 327,
  relatorioResumo: 328,
  relatorioCentroCusto: 329,
  relatorioAnalitico: 330,
  relatorioSintetico: 331,
  comparativoCentroCusto: 334,
  mapaBaseRateio: 4378,
  utilitarios: 341,
} as const;

const O = OPCOES_CUSTOS;

export const PERMISSOES_CUSTOS_CODIGOS = {
  centroLer: 'custos.centro.ler',
  centroEditar: 'custos.centro.editar',
  estatisticaRegistrar: 'custos.estatistica.registrar',
  apuracaoLer: 'custos.apuracao.ler',
  apuracaoApurar: 'custos.apuracao.apurar',
  apuracaoAprovar: 'custos.apuracao.aprovar',
  apuracaoExportar: 'custos.apuracao.exportar',
  resultadoLer: 'custos.resultado.ler',
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
  perfis: [PERFIL_ANALISTA_CUSTOS],
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_CUSTOS_M54_F4: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_CUSTOS_CODIGOS.centroLer,
    'Consultar a estrutura de custos (centros classificados, ordem e critério do rateio) e as estatísticas por centro e competência',
    [O.tabelas, O.parametros, O.tabelaOcupacao, O.centrosCusto, O.unidadeMensuracao, O.consultaCentroCusto],
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.centroEditar,
    'Classificar os centros de custo (produtivo, auxiliar, administrativo), definir a ordem e o critério do rateio e a unidade de mensuração',
    [O.parametros, O.centrosCusto, O.unidadeMensuracao],
    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.estatisticaRegistrar,
    'Coletar as estatísticas do mês das fontes do banco e lançar as estatísticas sem fonte (área, roupa, refeições)',
    [O.buscarProducao, O.producaoSadt, O.producaoInternacao, O.producaoBloco, O.calcularItensProducao],
  ),
];

/**
 * Etapa 5 (M54-F5; ficha, seção 7 "Apuração do custo do mês" e "Resultado e margem"): apurar (gerar lançamentos, gerar
 * valores, rateios), aprovar (manutenção dos lançamentos e rateios), exportar (utilitários: ApuraSUS e Federassantas) e
 * ler o resultado por conta, convênio e procedimento (comparativo de faturamento, custo por procedimento, relatórios).
 */
export const PERMISSOES_CUSTOS_M54_F5: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_CUSTOS_CODIGOS.apuracaoLer,
    'Consultar a apuração do custo do mês por centro (custo direto, rateios recebidos e custo final, com as parcelas)',
    [
      O.consultas,
      O.consultaCentroCusto,
      O.grupoSubgrupoItem,
      O.inconsistencias,
      O.relatorios,
      O.relatorioLancamentos,
      O.relatorioResumo,
      O.relatorioCentroCusto,
      O.relatorioAnalitico,
      O.relatorioSintetico,
      O.mapaBaseRateio,
    ],
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.apuracaoApurar,
    'Apurar o custo do mês (custeio por absorção com rateio sequencial) e o custo por conta e paciente',
    [
      O.gerarLancamentos,
      O.producaoFaturamento,
      O.producaoEstoque,
      O.gerarValores,
      O.zerarValores,
      O.rateios,
      O.matMed,
      O.calcularItensProducao,
    ],
    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.apuracaoAprovar,
    'Aprovar a apuração do custo do mês (o resultado passa a valer para relatórios e exportação)',
    [O.manutencao, O.rateios],
    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.apuracaoExportar,
    'Gerar o arquivo da apuração aprovada para o ApuraSUS, a Federassantas ou a planilha própria',
    [O.utilitarios],
  ),
  p(
    PERMISSOES_CUSTOS_CODIGOS.resultadoLer,
    'Consultar o resultado e a margem por conta, convênio, procedimento e unidade',
    [
      O.comparativoFaturamento,
      O.custoProcedimento,
      O.comparativoCentroCusto,
      O.relatorioAnalitico,
      O.relatorioSintetico,
    ],
  ),
];
