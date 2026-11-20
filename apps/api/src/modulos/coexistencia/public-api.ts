// Módulo coexistencia da API (M37): painel de migração gradual, treinamento, condução opcional e chamados.
export { MigracaoController, OPCOES_MIGRACAO, opcoesMigracaoDoAmbiente } from './migracao.controller.js';
export { PORTA_COEXISTENCIA, type PortaCoexistencia } from './porta.js';
export {
  EVENTO_ALERTA_CHAMADO,
  portaCoexistenciaIndisponivel,
  portaCoexistenciaLegado,
  portaCoexistenciaNaTransacao,
} from './porta-legado.js';
export { PortaCoexistenciaMemoria, TURMA_SINTETICA } from './porta-memoria.js';
export { ServicoMigracao } from './aplicacao/servico.js';
export { MEDIDOR_TAREFAS, MedidorTarefas, TAREFAS_CHAVE } from './aplicacao/medidor-tarefas.js';
// M43: fim da coexistência por hospital (a aba do painel e a revisão dos sem grupo e dos logins de painel).
export { FimCoexistenciaController, RAIZ_FIM_COEXISTENCIA, raizFimDoAmbiente } from './fim.controller.js';
export { lerRegistroFim, ServicoFimCoexistencia } from './aplicacao/fim.js';
// M58 (etapa 1): prontidão do desligamento por hospital e o cartão da plataforma do banco.
export {
  DesligamentoController,
  RAIZES_DESLIGAMENTO,
  raizesDesligamentoDoAmbiente,
  type RaizesDesligamento,
} from './desligamento.controller.js';
export { lerRegistroDesligamento, ServicoDesligamento } from './aplicacao/desligamento.js';
// M59 (etapa 6): a decisão sobre a retrocompatibilidade e o plano de evolução do modelo (ADR 0033).
export {
  RAIZ_RETROCOMPATIBILIDADE,
  raizRetrocompatibilidadeDoAmbiente,
  RetrocompatibilidadeController,
  ROTA_RETROCOMPATIBILIDADE,
} from './retrocompatibilidade.controller.js';
export {
  lerRegistroRetrocompatibilidade,
  ServicoRetrocompatibilidade,
} from './aplicacao/retrocompatibilidade.js';
