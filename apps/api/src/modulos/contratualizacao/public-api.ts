// Módulo contratualização SUS da API (M55, fatia F5): o contrato com o gestor, os incentivos, as metas quantitativas e
// qualitativas, a apuração do período e o painel produção × meta com o repasse estimado.
export { ContratualizacaoController } from './contratualizacao.controller.js';
export { PORTA_CONTRATUALIZACAO, type PortaContratualizacao } from './porta.js';
export {
  portaContratualizacaoIndisponivel,
  portaContratualizacaoLegado,
  portaContratualizacaoNaTransacao,
} from './porta-legado.js';
export { PortaContratualizacaoMemoria } from './porta-memoria.js';
