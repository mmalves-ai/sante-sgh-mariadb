// Módulo da enfermagem beira-leito da API (M25): a linha do tempo do turno, o aprazamento, a checagem em tela e no
// tablet (pulseira, dose, dupla checagem, infusão), os conflitos de sincronização, os sinais vitais, a passagem de
// plantão e os aparelhos do modo beira do leito. O módulo Nest (modulo.ts) liga as portas: as próprias sobre o banco
// do cliente, a memória só em dev/ci sem o núcleo e a indisponível (503) fora disso.
export { modulo, type OpcoesModuloEnfermagem } from './modulo.js';
export { ApoiosEnfermagem } from './apoios.js';
export { EnfermagemController } from './enfermagem.controller.js';
export { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
export { PortaEnfermagemMemoria, VINCULOS_SINTETICOS } from './porta-memoria.js';
export { ServicoEnfermagem } from './servico.js';
export { AVISOS_ENFERMAGEM } from './simbolos.js';
export { VigiaHorarios } from './vigia.js';
// M45 (etapa 3): balanço hídrico.
export { BalancoController } from './balanco.controller.js';
export { PORTA_BALANCO, type PortaBalanco } from './balanco-porta.js';
export { PortaBalancoMemoria } from './balanco-porta-memoria.js';
// M45 (etapa 2): escores de risco, reavaliações, classificação de pacientes e índices de gravidade da UTI.
export { ClassificacaoPacientesController, EscoresController } from './escores.controller.js';
export { IndicesUtiController } from './indices-uti.controller.js';
export { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
export { PortaEscoresMemoria, VINCULOS_ESCORES_SINTETICOS } from './escores-porta-memoria.js';
// W0-03, mercado M5: contenção mecânica (ordem, checagem aprazada, retirada, alerta da vencida e indicador).
export { ContencaoController, VIGIA_CONTENCAO } from './contencao.controller.js';
export { VigiaContencao } from './contencao-servico.js';
// W0-03, mercado M2: o Time de Resposta Rápida e a ficha da parada (Utstein).
export { TrrController } from './trr.controller.js';
export { ProtocoloInternadoController } from './protocolo-internado.controller.js';
export { LesaoController } from './lesao.controller.js';
// M45 (etapa 4): processo de enfermagem, prescrição de enfermagem, receita do enfermeiro e vacina aplicada.
export { SaeController } from './sae.controller.js';
export { PrescricaoEnfermeiroController } from './prescricao-enfermeiro.controller.js';
export { VacinaController } from './vacina.controller.js';
export { PORTA_SAE, type PortaSae } from './sae-porta.js';
export { PortaSaePropria, portaSaeIndisponivel } from './sae-porta-propria.js';
export { PortaSaeMemoria } from './sae-porta-memoria.js';
// M47 (etapa 1): agência transfusional (requisição, amostra, ato à beira do leito, reação e hemovigilância).
export { TransfusaoController } from './transfusao.controller.js';
export { PORTA_TRANSFUSAO, type PortaTransfusao } from './transfusao-porta.js';
export { PortaTransfusaoPropria, portaTransfusaoIndisponivel } from './transfusao-porta-propria.js';
export { PortaTransfusaoMemoria } from './transfusao-porta-memoria.js';
// M47 (etapa 2): imuno-hematologia, prova cruzada e estoque de bolsas (chave agencia.completa).
export { AgenciaController } from './agencia.controller.js';
export { PORTA_AGENCIA, type PortaAgencia } from './agencia-porta.js';
export { PortaAgenciaMemoria } from './agencia-porta-memoria.js';
