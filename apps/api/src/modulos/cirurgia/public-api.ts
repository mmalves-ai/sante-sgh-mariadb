// Módulo centro cirúrgico da API (M18): mapa das salas, solicitação, agendamento, remarcação, cancelamento,
// andamento, pendências, registro do ato, revisão da ligação e os usuários permitidos das salas.
export { CirurgiaController } from './cirurgia.controller.js';
export { PORTA_CIRURGIA, type PortaCirurgia } from './porta.js';
export { type NucleoCirurgia, portaCirurgiaIndisponivel, PortaCirurgiaPropria } from './porta-propria.js';
export { PortaCirurgiaMemoria } from './porta-memoria.js';
// M46 (etapa 1): APA, ficha anestésica e SRPA.
export { AnestesiaController } from './anestesia.controller.js';
export { PORTA_ANESTESIA, type PortaAnestesia } from './anestesia-porta.js';
export { portaAnestesiaIndisponivel, PortaAnestesiaPropria } from './anestesia-porta-propria.js';
export { PortaAnestesiaMemoria } from './anestesia-porta-memoria.js';
// M46 (etapa 2): checklist de cirurgia segura, trava da incisão, rastreio no bloco e painel para familiares.
export { AVISOS_BLOCO, BlocoSeguroController } from './bloco-seguro.controller.js';
export { PORTA_BLOCO_SEGURO, type PortaBlocoSeguro } from './bloco-seguro-porta.js';
export { portaBlocoSeguroIndisponivel, PortaBlocoSeguroPropria } from './bloco-seguro-porta-propria.js';
export { PortaBlocoSeguroMemoria } from './bloco-seguro-porta-memoria.js';
export { PainelBlocoFamilia } from './painel-bloco-familia.js';
export { TRAVA_INCISAO, TravaIncisao } from './trava-incisao.js';
export { moduloCirurgia, type OpcoesModuloCirurgia, portasDaCirurgia } from './modulo.js';
export type * from './tipos.js';
