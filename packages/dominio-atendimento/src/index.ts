// @sgh/dominio-atendimento (M20): regras puras do atendimento externo e do pronto atendimento, sem banco. Usadas pela
// API (indicadores, quadro, fila, impressos) e pelas telas (desfechos permitidos, alertas da observação, herança). A
// conferência da conta mora no contrato (as receitas do legado a usam) e segue daqui para as telas.
export * from './carater.js';
export * from './conta-aberta.js';
export * from './desfecho.js';
export * from './fila-consultorio.js';
export * from './heranca.js';
export * from './impressos.js';
export * from './indicadores.js';
export * from './observacao.js';
export * from './quadro.js';
// M50, etapa 4: telemedicina (sala de espera, início, alerta do crônico, marca dos documentos, teleinterconsulta).
export * from './teleconsulta/index.js';
// F2.2: abertura, condução, exclusão, observação e ato médico (regras levadas das portas ao domínio).
export * from './fluxo-atendimento.js';
