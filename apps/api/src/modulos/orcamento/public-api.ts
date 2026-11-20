// Módulo do orçamento empresarial da API (M54, etapa 7): versões, linhas, aprovação e orçado × realizado (só SGH_ORC_*).
export { CHAVE_LIBERACAO_ORCAMENTO, OrcamentoController } from './orcamento.controller.js';
export { type ContextoOrcamento, PORTA_ORCAMENTO, type PortaOrcamento } from './porta.js';
export {
  portaOrcamentoIndisponivel,
  portaOrcamentoLegado,
  portaOrcamentoNasTransacoes,
} from './porta-legado.js';
export { PortaOrcamentoMemoria } from './porta-memoria.js';
export { ServicoOrcamento, type SessaoOrcamento } from './servico.js';
