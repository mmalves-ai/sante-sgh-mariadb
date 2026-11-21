// Módulo rouparia e lavanderia da API (M55): o enxoval, as cotas por setor, os movimentos (coleta, envio, retorno
// conferido, entrega e perda), a estatística de kg por setor e dia e os indicadores.
export { RoupariaController } from './rouparia.controller.js';
export { PORTA_ROUPARIA, type PortaRouparia } from './porta.js';
export {
  documentoDoMovimento,
  type NucleoRouparia,
  numeroDoMovimento,
  portaRoupariaIndisponivel,
  PortaRoupariaPropria,
} from './porta-propria.js';
export { PortaRoupariaMemoria } from './porta-memoria.js';
export { moduloRouparia } from './modulo.js';
