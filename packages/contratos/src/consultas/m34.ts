// Consultas somente leitura do M34 (ficha, seções 4 e 5: "Ficam só em consulta nesta fase"): os relatórios do editor
// de relatórios e a configuração deles (o editor de origem continua dono das tabelas), o agendamento de envio de
// origem, os endpoints, webservices e o integrador, as tabelas de identificação de paciente (PIX/PDQ e
// especialidades da integração Digital) e as interfaces de equipamento e dos laboratórios de apoio. Cada consulta
// usa a permissão da tela de trabalho que a mostra. Colunas de senha, usuário de FTP e chave nunca são declaradas
// (a parte física, em @sgh/legado, não as lê; guarda de colunas proibidas).
import { PERMISSOES_M34_CODIGOS as P } from '../permissoes/relatorio-integracao.js';
import type { ConsultaPublica } from './tipos.js';

const ITEM_CATALOGO = 'relatorios-e-bi.catalogo-de-relatorios-parametrizados';
const ITEM_ENVIO = 'relatorios-e-bi.envio-agendado-por-e-mail';
const ITEM_ENDPOINTS = 'administracao.integracoes.endpoints-webservices-e-integrador';
const ITEM_FHIR = 'administracao.integracoes.fhir-r4-rnds-e-identificacao-de-paciente';
const ITEM_INTERFACES = 'diagnostico-sadt.laboratorio.interfaces-de-equipamento';

const de = (ler: string) => ({ ler, exportar: ler });

function c(
  modulo: string,
  recurso: string,
  rotulo: string,
  item: string,
  permissao: string,
  classe: ConsultaPublica['classe'] = 'comum',
): ConsultaPublica {
  return {
    modulo,
    recurso,
    rotulo,
    item,
    fase: 3,
    classe,
    grande: false,
    marco: 'M34',
    permissoes: de(permissao),
  };
}

export const CONSULTAS_M34: readonly ConsultaPublica[] = [
  c(
    'relatorio',
    'relatorioOrigem',
    'Relatórios de SQL livre (origem)',
    ITEM_CATALOGO,
    P.triagemLer,
    'pessoal',
  ),
  c(
    'relatorio',
    'parametroRelatorioOrigem',
    'Parâmetros dos relatórios de origem',
    ITEM_CATALOGO,
    P.triagemLer,
  ),
  c('relatorio', 'pesquisaParametroOrigem', 'Pesquisas de parâmetro (origem)', ITEM_CATALOGO, P.triagemLer),
  c(
    'relatorio',
    'acessoGrupoRelatorio',
    'Acesso por grupo aos relatórios de origem',
    ITEM_CATALOGO,
    P.triagemLer,
  ),
  c(
    'relatorio',
    'acessoUsuarioRelatorio',
    'Acesso por usuário aos relatórios de origem',
    ITEM_CATALOGO,
    P.triagemLer,
    'pessoal',
  ),
  c('relatorio', 'agrupamentoRelatorio', 'Agrupamentos de relatórios', ITEM_CATALOGO, P.triagemLer),
  c('relatorio', 'relatorioDoAgrupamento', 'Relatórios de cada agrupamento', ITEM_CATALOGO, P.triagemLer),
  c('relatorio', 'botaoRelatorio', 'Botões de relatório nas telas', ITEM_CATALOGO, P.triagemLer),
  c('relatorio', 'opcaoRelatorio', 'Opções de relatório', ITEM_CATALOGO, P.triagemLer),
  c(
    'relatorio',
    'parametroBotaoRelatorio',
    'Parâmetros dos botões de relatório',
    ITEM_CATALOGO,
    P.triagemLer,
  ),
  c(
    'relatorio',
    'modeloPepRelatorio',
    'Modelos do prontuário ligados a relatórios',
    ITEM_CATALOGO,
    P.triagemLer,
  ),
  c('relatorio', 'agendaOrigem', 'Envios agendados de origem', ITEM_ENVIO, P.agendamentoLer, 'pessoal'),
  c('integracao', 'endpointServico', 'Endpoints', ITEM_ENDPOINTS, P.configuracaoLer),
  c('integracao', 'endpointUri', 'Caminhos dos endpoints', ITEM_ENDPOINTS, P.configuracaoLer),
  c(
    'integracao',
    'endpointServicoInterno',
    'Endpoints de serviços internos',
    ITEM_ENDPOINTS,
    P.configuracaoLer,
  ),
  c('integracao', 'identificacaoEndpoint', 'Identificações de endpoint', ITEM_ENDPOINTS, P.configuracaoLer),
  c(
    'integracao',
    'integradorTabela',
    'Tabelas sincronizadas pelo integrador',
    ITEM_ENDPOINTS,
    P.configuracaoLer,
  ),
  c('integracao', 'integradorParametro', 'Parâmetros do integrador', ITEM_ENDPOINTS, P.configuracaoLer),
  c('integracao', 'especialidadeDigital', 'Especialidades da integração Digital', ITEM_FHIR, P.fhirLer),
  c('integracao', 'tipoDocumentoPixPdq', 'Tipos de certidão (PIX/PDQ)', ITEM_FHIR, P.fhirLer),
  c('integracao', 'sexoPixPdq', 'Sexo (PIX/PDQ)', ITEM_FHIR, P.fhirLer),
  c(
    'sadt',
    'interfaceEquipamento',
    'Interfaces de equipamento e de laboratório de apoio',
    ITEM_INTERFACES,
    P.interfaceLer,
  ),
  c('sadt', 'modeloInterface', 'Modelos de interface', ITEM_INTERFACES, P.interfaceLer),
  c('sadt', 'modeloDaInterface', 'Modelos por interface', ITEM_INTERFACES, P.interfaceLer),
];
