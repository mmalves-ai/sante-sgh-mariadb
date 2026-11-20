// Módulo agenda de exames da API (M18): agendas, cobertura por convênio e por exame, geração da grade, marcação,
// cancelamento, remarcação, cancelamentos e o relatório de resíduo; e o apoio de gravação comum do M18.
export {
  ApoioGravacao,
  type AlvoSgh,
  type ContextoPortaM18,
  type GravacaoFeita,
  type PortaGravacaoM18,
  portaIndisponivel,
} from './apoio-gravacao.js';
export { corpo, dataDaConsulta, ExamesController, inteiroOuNulo } from './exames.controller.js';
export { PORTA_EXAME, type PortaExame } from './porta.js';
export { portaExameIndisponivel, portaExameLegado } from './porta-legado.js';
export { PortaExameMemoria } from './porta-memoria.js';
