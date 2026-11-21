// M45 (etapa 5): nutrição clínica (fila de pacientes a triar, triagem, terapia nutricional da EMTN), serviço de nutrição
// e dietética (mapa de dietas no corte, etiqueta de bandeja, refeição do acompanhante) e serviço social.
export { moduloNutricao, portaDaNutricao } from './modulo.js';
export { NutricaoController } from './nutricao.controller.js';
export { METODOS_PORTA_NUTRICAO, PORTA_NUTRICAO, type PortaNutricao } from './porta.js';
export { PortaNutricaoMemoria } from './porta-memoria.js';
export { type NucleoNutricao, portaNutricaoIndisponivel, PortaNutricaoPropria } from './porta-propria.js';
export { ServicoNutricao } from './servico.js';
export type * from './tipos.js';
