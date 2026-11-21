// Módulo agenda de exames da API (M18): agendas, cobertura por convênio e por exame, geração da grade, marcação,
// cancelamento, remarcação, cancelamentos e a conferência de consistência; e o apoio de gravação comum do M18.
export {
  ApoioGravacao,
  type AlvoSgh,
  type ContextoPortaM18,
  type DestinoPorta,
  destinoDoContrato,
  type GravacaoFeita,
  type LiberacaoGravacao,
  type PortaGravacaoM18,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from './apoio-gravacao.js';
export { corpo, dataDaConsulta, ExamesController, inteiroOuNulo } from './exames.controller.js';
export { type GravadorCoberturaExame, PORTA_EXAME, type PortaExame } from './porta.js';
export { type NucleoExame, portaExameIndisponivel, PortaExamePropria } from './porta-propria.js';
export { PortaExameMemoria } from './porta-memoria.js';
export type * from './tipos.js';
