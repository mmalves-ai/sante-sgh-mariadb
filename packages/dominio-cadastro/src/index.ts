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
export * from './captacao/captacao.js';
export * from './cobertura/cobertura.js';
export * from './pre-cadastro/pre-cadastro.js';
export * from './unificacao/desfazer.js';
export * from './unificacao/referencias-paciente.js';
export * from './ficha-complementar/regras-campo.js';
export * from './ficha-complementar/contatos.js';
export * from './ficha-complementar/responsaveis.js';
