// @sgh/persistencia-contabil: consultas e gravador comuns da contabilidade sobre o banco do cliente, usados pela API
// (apps/api/src/modulos/contabil) e pelo worker (apps/worker/src/contabil). Infraestrutura: fala com o MariaDB só
// pelo @sgh/nucleo; a regra de negócio é do @sgh/dominio-contabil.
export * from './bloqueio.js';
export * from './consultas.js';
export * from './gravacao.js';
export * from './tipos.js';
