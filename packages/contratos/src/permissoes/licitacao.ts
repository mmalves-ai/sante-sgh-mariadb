// Permissões do M55, etapa 4 (ficha, seção 7; convencoes.md §12): licitação e pregão. Quem tem a opção no sistema
// anterior tem a permissão no novo (regra 1 do M06). O módulo de compras do sistema anterior tem o menu de licitações
// (as 13 tabelas GC* estão vazias, mas as opções existem e estão concedidas; retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - consultar: Licitações 2097 e Emissão de licitações 2102;
//   - conduzir (termo de referência, pesquisa de preços, edital, aviso, sessão, propostas, julgamento, recurso, ata e
//     pedido): Emissão de licitações 2102, Edital classificatório 2103 e Cotação de preços 2110;
//   - homologar (homologação, decisão do recurso, revogação e anulação: a autoridade): Homologação 2107.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_LICITACAO_CODIGOS = {
  ler: 'suprimentos.licitacao.ler',
  conduzir: 'suprimentos.licitacao.conduzir',
  homologar: 'suprimentos.licitacao.homologar',
} as const;

export const PERMISSOES_LICITACAO_M55_F4: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_LICITACAO_CODIGOS.ler,
    descricao:
      'Consultar os processos de compra (licitação, pregão e contratação direta): termo, pesquisa de preços, propostas, julgamento e atos',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_LICITACAO_CODIGOS.conduzir,
    descricao:
      'Conduzir o processo de compra (agente de contratação ou pregoeiro): termo de referência, pesquisa de preços, edital, aviso, sessão, propostas, julgamento, recurso, ata e pedido',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_LICITACAO_CODIGOS.homologar,
    descricao:
      'Homologar o processo de compra, decidir o recurso e revogar ou anular (a autoridade competente; outra pessoa que não o agente)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
];
