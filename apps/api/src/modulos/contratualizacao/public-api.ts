// Módulo contratualização SUS da API (M55, fatia F5): o contrato com o gestor, os incentivos, as metas quantitativas e
// qualitativas, a apuração do período e o painel produção × meta com o repasse estimado.
export { ContratualizacaoController } from './contratualizacao.controller.js';
export { modulo, moduloContratualizacao } from './modulo.js';
export {
  type ApuracaoParaGravar,
  type ContratoParaGravar,
  type DominiosContratualizacao,
  type MetaParaGravar,
  PORTA_CONTRATUALIZACAO,
  type PortaContratualizacao,
} from './porta.js';
export { PortaContratualizacaoMemoria } from './porta-memoria.js';
export {
  type NucleoContratualizacao,
  portaContratualizacaoIndisponivel,
  PortaContratualizacaoPropria,
} from './porta-propria.js';
export { CARGA_DOMINIOS_CONTRATUALIZACAO } from './vocabulario.js';
