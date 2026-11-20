// @sgh/dominio-manutencao (M55): regras puras da manutenção e engenharia clínica, sem banco nem Nest. Fatia F1: OS com
// prioridade e SLA, abertura do seu setor, equipamento crítico parado com alerta (regra 1), plano de manutenção com
// laudo e o painel das vencidas (regra 2), disponibilidade, MTBF e MTTR com as parcelas (regra 3) e a cobertura por
// contrato de manutenção. A API relê o estado dentro da transação; nada aqui grava no outro sistema.
export * from './tempo.js';
export * from './os.js';
export * from './preventiva.js';
export * from './indicadores.js';
export * from './cobertura.js';
// W0-08, parte 8: tecnovigilância e recall ligados ao parque instalado (M2).
export * from './tecnovigilancia.js';
// W0-08, parte 9: treinamento dos operadores por modelo, obsolescência e ciclo de vida (M3).
export * from './ciclo-vida.js';
