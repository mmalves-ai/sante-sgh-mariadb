// Cadastros do M34 no CRUD genérico (M08; ficha, seção 5, "Receita genérica do CRUD"): o de-para do laboratório de
// apoio (exames, elementos e materiais do laboratório) e o de-para de exames por interface de equipamento, os
// domínios das mensagens (tipos de erro, tipos de agendamento e situações de envio), os perfis de prioridade da
// classificação de risco externa (dado do fornecedor: o banco recusa gravar) e os domínios dos webservices
// (operações e padrões). Editar o de-para aqui tem o mesmo efeito de editar no outro sistema: os dois usam a mesma
// tabela (cap-12 §12.2). Opções do legado (menu de origem, ver conector/mapa/permissoes.tsv):
// S.A.D.T. › Interfaceamento 2964 (o de-para das interfaces dos laboratórios de apoio); S.M.S. › Lançamentos 4995 e
// Cadastrar cenário 4993; Tabelas › Cadastro de Endpoint 6339 e Gerenciamento 6340 (webservices, inferida: a árvore
// não tem item dos dois domínios); classificação de risco externa sem tela no legado: Tabelas › Geral M–Z 3698
// (inferida). Conferir na validação.
import type { DominioPublico } from './tipos.js';

const SISTEMA = 'o banco de dados recusa inclusão, alteração e exclusão: dado de sistema do fornecedor';
const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;
const LER = ['ler', 'exportar'] as const;
const INTERFACEAMENTO = [2964];
const SMS = [4995, 4993];
const ENDPOINT = [6339, 6340];

const todas = (ids: readonly number[], acoes: DominioPublico['acoes']) =>
  Object.fromEntries(acoes.map((a) => [a, ids])) as DominioPublico['opcoesLegado'];

const M34 = (
  d: Omit<DominioPublico, 'opcoesLegado' | 'origemOpcoes' | 'marco'>,
  opcoes: readonly number[],
  origem: DominioPublico['origemOpcoes'] = 'tbopcoes',
): DominioPublico => ({ ...d, opcoesLegado: todas(opcoes, d.acoes), origemOpcoes: origem, marco: 'M34' });

export const DOMINIOS_M34: readonly DominioPublico[] = [
  M34(
    {
      modulo: 'sadt',
      recurso: 'apoioExame',
      rotulo: {
        singular: 'Exame do laboratório de apoio',
        plural: 'Exames do laboratório de apoio (de-para)',
      },
      subitem: 'apoioLaboratorio',
      natureza: 'editavel',
      acoes: CIE,
    },
    INTERFACEAMENTO,
  ),
  M34(
    {
      modulo: 'sadt',
      recurso: 'apoioElemento',
      rotulo: {
        singular: 'Elemento do laboratório de apoio',
        plural: 'Elementos do laboratório de apoio (de-para)',
      },
      subitem: 'apoioLaboratorio',
      natureza: 'editavel',
      acoes: CIE,
    },
    INTERFACEAMENTO,
  ),
  M34(
    {
      modulo: 'sadt',
      recurso: 'apoioMaterial',
      rotulo: {
        singular: 'Material do laboratório de apoio',
        plural: 'Materiais do laboratório de apoio (de-para)',
      },
      subitem: 'apoioLaboratorio',
      natureza: 'editavel',
      acoes: CIE,
    },
    INTERFACEAMENTO,
  ),
  M34(
    {
      modulo: 'sadt',
      recurso: 'deParaEquipamento',
      rotulo: {
        singular: 'Exame por interface de equipamento',
        plural: 'Exames por interface de equipamento',
      },
      subitem: 'interfacesEquipamento',
      natureza: 'editavel',
      acoes: CIE,
    },
    INTERFACEAMENTO,
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'tipoErroMensagem',
      rotulo: { singular: 'Tipo de erro do envio de mensagem', plural: 'Tipos de erro do envio de mensagem' },
      subitem: 'integracaoMensagens',
      natureza: 'editavel',
      acoes: CIE,
    },
    SMS,
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'tipoAgendamentoMensagem',
      rotulo: {
        singular: 'Tipo de agendamento de mensagem',
        plural: 'Tipos de agendamento de mensagem',
      },
      subitem: 'integracaoMensagens',
      natureza: 'editavel',
      acoes: CIE,
    },
    SMS,
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'situacaoEnvioMensagem',
      rotulo: { singular: 'Situação do envio de mensagem', plural: 'Situações do envio de mensagem' },
      subitem: 'integracaoMensagens',
      natureza: 'editavel',
      acoes: CIE,
    },
    SMS,
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'perfilPrioridadeExterna',
      rotulo: {
        singular: 'Perfil de prioridade da classificação externa',
        plural: 'Perfis de prioridade da classificação externa',
      },
      subitem: 'classificacaoExterna',
      natureza: 'sistema',
      motivoSomenteLeitura: SISTEMA,
      acoes: LER,
    },
    [3698],
    'inferida',
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'operacaoWebservice',
      rotulo: { singular: 'Operação de webservice', plural: 'Operações de webservice' },
      subitem: 'integracaoWebservices',
      natureza: 'editavel',
      acoes: CIE,
    },
    ENDPOINT,
    'inferida',
  ),
  M34(
    {
      modulo: 'integracao',
      recurso: 'padraoWebservice',
      rotulo: { singular: 'Padrão de webservice', plural: 'Padrões de webservice' },
      subitem: 'integracaoWebservices',
      natureza: 'editavel',
      acoes: CIE,
    },
    ENDPOINT,
    'inferida',
  ),
];
