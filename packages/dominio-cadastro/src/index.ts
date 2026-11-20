// @sgh/dominio-cadastro: regras puras do cadastro de pacientes e profissionais (M11). Sem banco, sem HTTP.
export * from './documento/cpf.js';
export * from './documento/cns.js';
export * from './busca/fonetica.js';
export * from './busca/termo.js';
export * from './duplicidade/escore.js';
export * from './profissional/categoria.js';
export * from './solicitante/deduplicacao.js';
export * from './paciente/mascaramento.js';
export * from './paciente/historico.js';
