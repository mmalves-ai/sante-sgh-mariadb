// M50 (etapa 6): a digitalização certificada do prontuário em papel (captura, índice, conferência da fidelidade e a
// assinatura ICP-Brasil de quem conferiu pelo serviço do M49; no banco do cliente; o arquivo no armazenamento com retenção).
export { DigitalizacaoController, SERVICO_ASSINATURA_DIGITALIZACAO } from './digitalizacao.controller.js';
export { PORTA_DIGITALIZACAO, type PortaDigitalizacao } from './porta.js';
export {
  type NucleoDigitalizacao,
  portaDigitalizacaoIndisponivel,
  PortaDigitalizacaoPropria,
} from './porta-propria.js';
export type { DocumentoDigitalizado, PacienteDoProntuario } from './tipos.js';
export {
  LigacaoAssinaturaDigitalizacao,
  modulo,
  moduloDigitalizacao,
  type OpcoesModuloDigitalizacao,
} from './modulo.js';
export { PortaDigitalizacaoMemoria } from './porta-memoria.js';
export {
  ARMAZEM_DIGITALIZACAO,
  type ArmazemDigitalizacao,
  ArmazemDigitalizacaoMemoria,
  criarArmazemDigitalizacao,
} from './armazem.js';
export { ServicoAssinaturaDigitalizacao } from './assinatura.js';
