// Módulo rouparia e lavanderia da API (M55, fatia F2): o enxoval, as cotas por setor, os movimentos (coleta, envio,
// retorno conferido, entrega, perda e inventário), a estatística de kg por setor e dia e os indicadores.
export { RoupariaController } from './rouparia.controller.js';
export { PORTA_ROUPARIA, type PortaRouparia } from './porta.js';
export { portaRoupariaIndisponivel, portaRoupariaLegado, portaRoupariaNaTransacao } from './porta-legado.js';
export { PortaRoupariaMemoria } from './porta-memoria.js';
