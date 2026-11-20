// Módulo do estoque, do almoxarifado e das compras da API (M28).
export { SuprimentosController } from './suprimentos.controller.js';
export { PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';
export {
  portaSuprimentosIndisponivel,
  portaSuprimentosLegado,
  portaSuprimentosNaTransacao,
} from './porta-legado.js';
export { PortaSuprimentosMemoria } from './porta-memoria.js';
// M46 (etapa 3): OPME (solicitação, etapas, consumo em sala com rastreio, conciliação e rastreio reverso).
export { OpmeController } from './opme.controller.js';
export { PORTA_OPME, type PortaOpme } from './opme-porta.js';
export { portaOpmeIndisponivel, portaOpmeLegado, portaOpmeNaTransacao } from './opme-porta-legado.js';
export { PortaOpmeMemoria } from './opme-porta-memoria.js';
// M46 (etapa 4): consignados (saldo por fornecedor, remessa, reposição, faturamento) e manipulação (ordem, dupla
// conferência e a baixa do insumo).
export { ConsignadoController } from './consignado.controller.js';
export { PORTA_CONSIGNADO, type PortaConsignado } from './consignado-porta.js';
export {
  portaConsignadoIndisponivel,
  portaConsignadoLegado,
  portaConsignadoNaTransacao,
} from './consignado-porta-legado.js';
export { PortaConsignadoMemoria } from './consignado-porta-memoria.js';
// M55 (etapa 3): contratos com fornecedores (cadastro, eventos, saldo pelos pedidos e títulos ligados, avaliação).
export { ContratoController } from './contrato.controller.js';
export { PORTA_CONTRATO, type PortaContrato } from './contrato-porta.js';
export {
  portaContratoIndisponivel,
  portaContratoLegado,
  portaContratoNaTransacao,
} from './contrato-porta-legado.js';
export { PortaContratoMemoria } from './contrato-porta-memoria.js';
export { ManipulacaoController } from './manipulacao.controller.js';
export { PORTA_MANIPULACAO, type PortaManipulacao } from './manipulacao-porta.js';
export {
  portaManipulacaoIndisponivel,
  portaManipulacaoLegado,
  portaManipulacaoNaTransacao,
} from './manipulacao-porta-legado.js';
export { PortaManipulacaoMemoria } from './manipulacao-porta-memoria.js';
// M55 (etapa 4): licitação e pregão (termo, pesquisa de preços, aviso, sessão, julgamento, recurso, homologação).
export { LicitacaoController } from './licitacao.controller.js';
export { PORTA_LICITACAO, type PortaLicitacao } from './licitacao-porta.js';
export {
  portaLicitacaoIndisponivel,
  portaLicitacaoLegado,
  portaLicitacaoNaTransacao,
} from './licitacao-porta-legado.js';
export { PortaLicitacaoMemoria } from './licitacao-porta-memoria.js';
