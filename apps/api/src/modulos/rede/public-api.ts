// Módulo do MPI da Rede da API (M57, etapa 1): fila de prováveis duplicados entre os estabelecimentos da rede,
// decisão, desfazer, vínculos de um cadastro, ciclo de pareamento e relatório de divergência entre os índices.
export { RedeMpiController } from './rede.controller.js';
export { type AtendimentosRede, PORTA_REDE, type PortaRede } from './porta.js';
export { portaRedeIndisponivel, portaServicosRedeIndisponivel } from './indisponivel.js';
export { type NucleoRede, PortaRedePropria } from './porta-propria.js';
export {
  ATENDIMENTOS_SINTETICOS_REDE,
  estabelecimentosSinteticosRede,
  massaSinteticaRede,
  PortaRedeMemoria,
} from './porta-memoria.js';
export { ServicoMpiRede, USUARIO_PAREAMENTO_REDE } from './aplicacao/servico.js';
export { modulo, moduloRede, portasDaRede } from './modulo.js';
// M57 (etapa 3): o registro dos serviços compartilhados da Rede.
export { ServicosRedeController } from './servicos/servicos.controller.js';
export { PORTA_SERVICOS_REDE, type PortaServicosRede } from './servicos/porta.js';
export { PortaServicosRedePropria } from './servicos/porta-propria.js';
export { PortaServicosRedeMemoria } from './servicos/porta-memoria.js';
export { ServicoServicosRede } from './servicos/servico.js';
