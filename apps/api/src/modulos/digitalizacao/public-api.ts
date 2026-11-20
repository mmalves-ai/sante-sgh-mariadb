// M50 (etapa 6): a digitalização certificada do prontuário em papel (captura, índice, conferência da fidelidade e a
// assinatura ICP-Brasil de quem conferiu pelo serviço do M49; só SGH_; o arquivo no armazenamento com retenção).
export { DigitalizacaoController, SERVICO_ASSINATURA_DIGITALIZACAO } from './digitalizacao.controller.js';
export { PORTA_DIGITALIZACAO, type PortaDigitalizacao } from './porta.js';
export { portaDigitalizacaoIndisponivel, portaDigitalizacaoLegado } from './porta-legado.js';
export { PortaDigitalizacaoMemoria } from './porta-memoria.js';
export {
  ARMAZEM_DIGITALIZACAO,
  type ArmazemDigitalizacao,
  ArmazemDigitalizacaoMemoria,
  criarArmazemDigitalizacao,
} from './armazem.js';
export { ServicoAssinaturaDigitalizacao } from './assinatura.js';
