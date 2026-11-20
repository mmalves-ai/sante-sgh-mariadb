// @sgh/dominio-rede: regras puras do MPI da Rede (M57, etapa 1: índice da Rede, pareamento automático e pontuado, fila
// de revisão, vincular e desfazer, divergência entre os índices dos bancos, isolamento da rede). Sem banco, sem HTTP.
export * from './mpi/cadastro.js';
export * from './mpi/pontuacao.js';
export * from './mpi/automatico.js';
export * from './mpi/duplicado-local.js';
export * from './mpi/chave.js';
export * from './mpi/indice.js';
export * from './mpi/vincular.js';
export * from './mpi/desfazer.js';
export * from './mpi/divergencia.js';
export * from './mpi/medicao.js';
export * from './mpi/orquestracao.js';
export * from './rede/isolamento.js';
