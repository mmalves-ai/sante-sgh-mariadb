// Módulo recepção da API (M19): guichê, fila, emissão, chamada sem espera, eventos da senha, chegada do agendado,
// totem e painéis de chamada (perfil Painel/Totem), painel do supervisor, indicadores e dispositivos.
export { RecepcaoController } from './recepcao.controller.js';
export { GestaoRecepcaoController } from './gestao.controller.js';
export { TermosRecepcaoController } from './termos.controller.js';
export { DispositivoController } from './dispositivo.controller.js';
export { CentralChamadas } from './chamadas.js';
export { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
export { portaRecepcaoIndisponivel, portaRecepcaoLegado } from './porta-legado.js';
export { PortaRecepcaoMemoria } from './porta-memoria.js';
export { CENTRAL_CHAMADAS, REDE_RECEPCAO } from './simbolos.js';
// M44 (etapa 1): classificação de risco no PA (fila, classificar, reclassificar, protocolos, painel e o quadro com cor).
export { ClassificacaoController, fonteAtendimentosPa, fonteRiscoPa } from './classificacao.controller.js';
export { ProtocoloGerenciadoController } from './protocolo-gerenciado.controller.js';
// W0-03, M3: as versões publicadas (conferidas) reusadas pelo relógio do internado na enfermagem.
export { ServicoProtocoloGerenciado } from './protocolo-gerenciado-servico.js';
export { PORTA_CLASSIFICACAO, type PortaClassificacao } from './classificacao-porta.js';
export { portaClassificacaoIndisponivel, portaClassificacaoLegado } from './classificacao-porta-legado.js';
export { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
export { ServicoClassificacao } from './classificacao-servico.js';
export { PAINEL_BLOCO_TV, PAINEL_PA_TV } from './simbolos.js';
