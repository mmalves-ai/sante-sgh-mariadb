// @sgh/dominio-agenda (M17; exames no M18): regras puras da agenda de consultas e de exames, sem banco. Usadas pela API (prévias, vagas,
// painel, indicadores), pela tela e pela porta em memória da sessão sintética; as receitas de gravação
// (@sgh/legado) reconferem no banco, sob a trava, o que vale na transação.
export * from './tempo.js';
export * from './estado-horario.js';
export * from './grade.js';
export * from './dias-sem-expediente.js';
export * from './prioridade-marcacao.js';
export * from './prioridade-idade.js';
export * from './encaixe.js';
export * from './cobertura.js';
export * from './nome-agenda.js';
export * from './indicadores.js';
export * from './dia.js';
export * from './exame.js';
export * from './online/index.js';
export * from './sessoes/index.js';
export * from './estruturada.js';
