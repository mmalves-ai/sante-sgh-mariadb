// @sgh/dominio-atendimento (M20): regras puras do atendimento externo e do pronto atendimento, sem banco. Usadas pela
// API (indicadores, quadro, fila, impressos) e pelas telas (desfechos permitidos, alertas da observação, herança). A
// conferência da conta mora no contrato (as receitas do legado a usam) e segue daqui para as telas.
export * from './carater.js';
export * from './conta-aberta.js';
export * from './desfecho.js';
export * from './fila-consultorio.js';
export * from './heranca.js';
export * from './padrao-abertura.js';
export * from './impressos.js';
// F3.2 (02-REC linha 35): quais fichas saem pela regra de impressão e a numeração da reimpressão.
export * from './regra-impressao.js';
export * from './indicadores.js';
// F3.2 (02-REC linha 30): o que os grupos lidos do banco do cliente valem para o cálculo dos indicadores.
export * from './indicadores-leitura.js';
export * from './observacao.js';
export * from './quadro.js';
// M50, etapa 4: telemedicina (sala de espera, início, alerta do crônico, marca dos documentos, teleinterconsulta).
export * from './teleconsulta/index.js';
// F2.2: abertura, condução, exclusão, observação e ato médico (regras levadas das portas ao domínio).
export * from './fluxo-atendimento.js';
// F3.2 (02-REC linha 30): correção da ficha aberta e do procedimento extra (versão, estorno, correção).
export * from './correcao-ficha.js';
// F3.2 (02-REC linha 34): locais de atendimento (horário, encaminhamento, visibilidade, usuários do local).
export * from './locais-atendimento.js';
// F7 (02-CAD linha 13): o paciente falecido não abre atendimento, marcação nem internação.
export * from './paciente-falecido.js';
