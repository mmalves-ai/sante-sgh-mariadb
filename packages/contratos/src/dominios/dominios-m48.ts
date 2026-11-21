// Cadastros da qualidade no CRUD genérico (M48, etapa 5; ficha, seção 5, "Receita genérica do CRUD para tipo de autoridade,
// descrição da matriz GUT e tipo da matriz GUT": domínios sem uso de movimento no outro sistema, edição a pedido da
// qualidade, uma assinatura por declaração). Pelo catálogo RDB$ e pelo levantamento da cópia `pc` (2026-10-27): as três
// tabelas sem trigger nem generator (a chave é digitada) e sem coluna de situação (sem inativação); as autoridades
// sanitárias (3: SMS, SES, MS) servem à notificação compulsória; os tipos (3: gravidade, urgência, tendência) e os graus
// (15, com os pontos de 1 a 5) formam a escala GUT do outro sistema, hoje a da priorização de pagamentos do repasse (a
// tabela da matriz por prestador está vazia), e o risco da qualidade tem a escala própria (D-GUT-48.5). A escala é fixa
// (três eixos com cinco graus cada, todos cadastrados): eixos e graus só se alteram, sem inclusão (D-GUT-FIXA-48.5). Substituem as
// consultas provisórias do M14. Opções do outro sistema (menu de origem): nenhuma tela edita estas tabelas; inferidas da
// notificação compulsória do prontuário (5273 e 5487 para ler; 5275 para gravar) e das Tabelas do G.R.T. (3025 para
// ler; 3026 Parâmetros para gravar), mais os perfis do novo (vigilância epidemiológica; escritório da qualidade).
import type { DominioPublico } from './tipos.js';

const AGRAVO_ACESSAR = 5273;
const AGRAVO_CONSULTAR = 5487;
const AGRAVO_NOTIFICAR = 5275;
const GRT_TABELAS = 3025;
const GRT_PARAMETROS = 3026;

const base = {
  modulo: 'qualidade',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'exportar'],
  origemOpcoes: 'inferida',
  marco: 'M48',
} as const;

export const DOMINIOS_M48: readonly DominioPublico[] = [
  {
    ...base,
    recurso: 'autoridadeSanitaria',
    rotulo: { singular: 'Autoridade sanitária', plural: 'Autoridades sanitárias' },
    subitem: 'qualidadeAgravos',
    opcoesLegado: {
      ler: [AGRAVO_ACESSAR, AGRAVO_CONSULTAR],
      exportar: [AGRAVO_ACESSAR, AGRAVO_CONSULTAR],
      criar: [AGRAVO_NOTIFICAR],
      editar: [AGRAVO_NOTIFICAR],
    },
    perfis: { ler: ['vigilancia-epidemiologica'], gravar: ['vigilancia-epidemiologica'] },
    chaveRecurso: 'qualidade.agravos',
  },
  {
    ...base,
    recurso: 'gutTipo',
    rotulo: { singular: 'Eixo da matriz GUT', plural: 'Eixos da matriz GUT' },
    subitem: 'qualidadeGut',
    acoes: ['ler', 'editar', 'exportar'],
    opcoesLegado: { ler: [GRT_TABELAS], exportar: [GRT_TABELAS], editar: [GRT_PARAMETROS] },
    semInclusao:
      'a matriz GUT tem os três eixos (gravidade, urgência e tendência) já cadastrados: só se altera o nome de cada um',
    perfis: { ler: ['gestao-qualidade'], gravar: ['gestao-qualidade'] },
    chaveRecurso: 'qualidade.gestao',
  },
  {
    ...base,
    recurso: 'gutGrau',
    rotulo: { singular: 'Grau da matriz GUT', plural: 'Graus da matriz GUT' },
    subitem: 'qualidadeGut',
    acoes: ['ler', 'editar', 'exportar'],
    opcoesLegado: { ler: [GRT_TABELAS], exportar: [GRT_TABELAS], editar: [GRT_PARAMETROS] },
    semInclusao:
      'cada eixo da matriz GUT tem os cinco graus (pontos de 1 a 5) já cadastrados: só se altera a descrição de cada grau',
    perfis: { ler: ['gestao-qualidade'], gravar: ['gestao-qualidade'] },
    chaveRecurso: 'qualidade.gestao',
  },
];
