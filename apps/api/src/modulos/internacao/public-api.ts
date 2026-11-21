// M16: painel de leitos ao vivo, censo, painéis gerenciais, indicadores, BI e o vigia de mudanças.
export { LeitosController } from './leitos.controller.js';
export { RelatorioController } from './relatorio.controller.js';
export { ConfiguracaoM16, PARAMETROS_PADRAO } from './configuracao.js';
export {
  type CtxInternacao,
  destinoNoContrato,
  FONTE_INTERNACAO,
  type FonteInternacao,
  fonteInternacaoIndisponivel,
} from './fonte.js';
export { FonteInternacaoPropria, type NucleoInternacao, TABELAS_DO_CANAL } from './fonte-propria.js';
export { FonteInternacaoMemoria, variantesSinteticasRede, type VarianteSintetica } from './fonte-memoria.js';
export { ServicoInternacao } from './servico.js';
export {
  BATIDA_EVENTOS_MS,
  BATIDA_EVENTOS_PADRAO_MS,
  CONFIGURACAO_M16,
  SERVICO_INTERNACAO,
} from './simbolos.js';
export { intervaloDoAmbiente, type LeituraCanal, MARCA_ZERO, type MarcaVigia, MOTOR_VIGIA, MotorVigia } from './vigia.js';
