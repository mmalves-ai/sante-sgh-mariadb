// Módulo do patrimônio da API (M54, etapa 6): bens, movimentos, depreciação e inventário (só SGH_PAT_*).
export {
  CHAVE_LIBERACAO_PATRIMONIO,
  GERADOR_PDF_PATRIMONIO,
  PatrimonioController,
} from './patrimonio.controller.js';
export { type ContextoPatrimonio, PORTA_PATRIMONIO, type PortaPatrimonio } from './porta.js';
export {
  portaPatrimonioIndisponivel,
  portaPatrimonioLegado,
  portaPatrimonioNasTransacoes,
} from './porta-legado.js';
export { PortaPatrimonioMemoria } from './porta-memoria.js';
export { ServicoPatrimonio, type SessaoPatrimonio } from './servico.js';
export {
  ARMAZEM_LAUDO_PATRIMONIO,
  type ArmazemLaudoPatrimonio,
  ArmazemLaudoMemoria,
  armazemLaudoS3,
} from './armazem-laudo.js';
