// M60, etapa 2: a conferência da instalação e da conexão ao banco.
export {
  ConferenciaInstalacaoController,
  migracoesDoPacote,
  SCRIPTS_DO_PACOTE,
  scriptsDoPacoteDoDisco,
} from './conferencia.controller.js';
export { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
export {
  type ConexaoBanco,
  type EstruturaBanco,
  METODOS_PORTA_IMPLANTACAO,
  type MigracaoRegistrada,
  PORTA_IMPLANTACAO,
  type PortaImplantacao,
  portaImplantacaoIndisponivel,
} from './porta.js';
export { type NucleoImplantacao, PortaImplantacaoPropria } from './porta-propria.js';
export { PortaImplantacaoMemoria } from './porta-memoria.js';
// M60, etapa 3: a fumaça do servidor (testes pós-implantação).
export {
  chavesEsperadasDoAmbiente,
  estruturaHomologadaDoAmbiente,
  FumacaServidorController,
  fusoDoProcesso,
} from './fumaca.controller.js';
export { ServicoFumacaServidor } from './aplicacao/fumaca.js';
export {
  FILAS_IMPLANTACAO,
  FilasBullmq,
  filasDoAmbiente,
  FilasSemValkey,
  type PortaFilasImplantacao,
} from './filas.js';
// Montagem do módulo na API migrada.
export { modulo, type OpcoesModuloImplantacao, portaDaImplantacao } from './modulo.js';
