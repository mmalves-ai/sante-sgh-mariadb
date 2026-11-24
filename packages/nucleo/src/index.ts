// @sgh/nucleo: a infraestrutura neutra sobre o banco MariaDB do cliente (F2.1). Sem o banco legado e sem o sistema de
// origem: pool por cliente, Leitor e Escritor, Executor com trilha, outbox e idempotência na mesma transação,
// trava otimista, números de negócio, auditoria automática e neutralização fora de produção.
export * from './ambiente.js';
export * from './armazem-arquivos.js';
export * from './arquivos-teste.js';
export * from './configuracao.js';
export * from './como.js';
export * from './contexto.js';
export * from './erros.js';
export * from './executor.js';
export * from './gravacao.js';
export * from './idempotencia.js';
export * from './neutralizacao.js';
export * from './nucleo.js';
export * from './pool.js';
export * from './sequencia.js';
export * from './telemetria.js';
export * from './transacao.js';
export * from './trilha.js';
