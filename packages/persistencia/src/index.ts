// @sgh/persistencia: portas de persistência sobre o banco do cliente (MariaDB), pelo Leitor e Escritor do
// @sgh/nucleo. Só infraestrutura: a regra de negócio é dos pacotes de domínio. Quem grava passa o Escritor da
// operação (TxOperacao do executor, com trilha e idempotência) ou o do teste.
export * from './agenda-preco/linhas.js';
export * from './agenda-preco/porta.js';
export * from './repasse-producao/porta.js';
export * from './operadora-cancelamento/efetivacao.js';
