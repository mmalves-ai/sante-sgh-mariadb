// M60, etapa 2: a conferência da instalação e da conexão ao banco.
export {
  ConferenciaInstalacaoController,
  SCRIPTS_DO_PACOTE,
  scriptsDoPacoteDoDisco,
} from './conferencia.controller.js';
export { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
export { METODOS_PORTA_IMPLANTACAO, PORTA_IMPLANTACAO, type PortaImplantacao } from './porta.js';
export { portaImplantacaoIndisponivel, portaImplantacaoLegado } from './porta-legado.js';
export { PortaImplantacaoMemoria } from './porta-memoria.js';
// M60, etapa 3: a fumaça do servidor (testes pós-implantação).
export { chavesEsperadasDoAmbiente, FumacaServidorController, fusoDoProcesso } from './fumaca.controller.js';
export { ServicoFumacaServidor } from './aplicacao/fumaca.js';
export {
  FILAS_IMPLANTACAO,
  FilasBullmq,
  filasDoAmbiente,
  FilasSemValkey,
  type PortaFilasImplantacao,
} from './filas.js';
