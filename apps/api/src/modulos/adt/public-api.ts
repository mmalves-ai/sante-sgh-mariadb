// Módulo da internação, dos leitos, da higienização e do SAME da API (M21): ADT sobre a mesma internação do outro
// sistema, o mapa de leitos operacional, a higienização do pedido à liberação e a movimentação física do SAME.
export { ApoiosAdt } from './apoios.js';
export { ARMAZEM_FOTOS, type ArmazemFotos, ArmazemFotosMemoria, criarArmazemFotos } from './fotos.js';
export { HigienizacaoController } from './higienizacao.controller.js';
export { InternacaoController } from './internacao.controller.js';
export { MapaLeitosController } from './leitos.controller.js';
export { PORTA_ADT, type PortaAdt } from './porta.js';
export { indicadoresGiroLeito, totaisGiro } from './indicadores-giro.js';
export { portaAdtIndisponivel, portaAdtLegado } from './porta-legado.js';
export { PortaAdtMemoria } from './porta-memoria.js';
export { SameController } from './same.controller.js';
export { ServicoAdt } from './servico.js';
export { AVISOS_ADT } from './simbolos.js';
// M44 (etapa 2): o NIR (solicitação de leito, fila, reserva, alta prevista, barreiras, permanência e calibragem).
export { EstadoNirMemoria } from './nir-memoria.js';
export { NirController } from './nir.controller.js';
export { RegulacaoController } from './regulacao.controller.js';
export { PORTA_NIR, type PortaNir } from './nir-porta.js';
export { portaNirIndisponivel, portaNirLegado } from './nir-porta-legado.js';
export { PortaNirMemoria } from './nir-porta-memoria.js';
export { ServicoNir } from './nir-servico.js';
// W0-07 (mercado M4): a OS da manutenção num leito propõe e encerra o bloqueio (parâmetro adt.osBloqueiaLeito).
export {
  INTEGRACAO_OS_LEITO,
  type IntegracaoOsLeito,
  IntegracaoOsLeitoAdt,
  type OsParaLeito,
  tipoLimpezaPosManutencao,
} from './os-leito.js';
