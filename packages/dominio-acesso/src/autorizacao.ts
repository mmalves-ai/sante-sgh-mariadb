// Entrada de @sgh/dominio-acesso para a TELA (`@sgh/dominio-acesso/autorizacao`): só as regras que rodam no
// navegador (CASL, decisão, quebra de vidro, vínculo), sem node:crypto (o TOTP fica no índice do servidor).
// As MESMAS funções que o servidor usa: a tela é conveniência, quem decide é o servidor (cap-08 §8.4).
export * from './ability.js';
export * from './decisao.js';
export * from './emergencia.js';
export * from './vinculo.js';
// M10: regras puras das telas de administração (período da auditoria, login exato, transição do pedido do
// titular), as mesmas que o servidor confere de novo.
export * from './auditoria/periodo.js';
export * from './usuario/login.js';
export * from './privacidade/pedido-titular.js';
// 01-ADM L75: regra de alerta conferida na tela enquanto se digita (a mesma do servidor; sem node:crypto).
export * from './notificacao/notificacao-regra.js';
