// M48 (etapa 1): notificação de incidentes e eventos adversos (botão global, triagem do NSP, prazos e Notivisa).
export { CHAVE_QUALIDADE_NOTIFICACAO, NotificacaoController } from './notificacao.controller.js';
export { PORTA_QUALIDADE, type PortaQualidade, portaQualidadeIndisponivel } from './porta.js';
export { PortaQualidadePropria } from './porta-propria.js';
export { PortaQualidadeMemoria } from './porta-memoria.js';
export { SegurancaPacienteController } from './seguranca.controller.js';
export { RESUMO_SUGESTAO, ResumoSugestao } from './servico-seguranca.js';
// M48 (etapa 3): CCIH (vigilância, dispositivos, IRAS, antimicrobianos, precauções, higiene das mãos e surtos).
export { CcihController, CHAVE_QUALIDADE_CCIH } from './ccih.controller.js';
export { PORTA_CCIH, type PortaCcih, portaCcihIndisponivel } from './porta-ccih.js';
export { PortaCcihPropria } from './porta-ccih-propria.js';
export { PortaCcihMemoria } from './porta-ccih-memoria.js';
// M48 (etapa 4): notificação compulsória (gatilhos por CID, resultado reagente e óbito; caso, prazo e ficha SINAN).
export { AgravoController, CHAVE_QUALIDADE_AGRAVOS } from './agravo.controller.js';
export { PORTA_AGRAVO, type PortaAgravo, portaAgravoIndisponivel } from './porta-agravo.js';
export { PortaAgravoPropria } from './porta-agravo-propria.js';
export { AGRAVO_SINTETICO, PortaAgravoMemoria } from './porta-agravo-memoria.js';
// M48 (etapa 5): gestão da qualidade (documentos, indicadores, auditorias, comissões, riscos, não conformidades,
// ouvidoria) e envios regulatórios.
export { CHAVE_QUALIDADE_GESTAO, GestaoQualidadeController } from './gestao.controller.js';
export { RevisaoProntuarioController } from './revisao-prontuario.controller.js';
export { PORTA_GESTAO, type PortaGestao, portaGestaoIndisponivel } from './porta-gestao.js';
export { PortaGestaoPropria } from './porta-gestao-propria.js';
export { GESTAO_SINTETICA, PortaGestaoMemoria } from './porta-gestao-memoria.js';
// Revisão do W0-04: a pendência de prontuário ao médico pela central de avisos (o sino do Início).
export { CENTRAL_AVISOS_QUALIDADE, type CentralAvisosQualidade } from './central-pendencias.js';
export { modulo, type OpcoesModuloQualidade, portasDaQualidade } from './modulo.js';
export type * from './tipos.js';
