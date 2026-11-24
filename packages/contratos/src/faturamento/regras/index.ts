// Regras puras da conta do paciente, dos lançamentos e da auditoria de contas (M30): situação da conta (regras 2 e 3),
// grupo do item (6), vetos do fechamento e da reabertura (4), explicador de preço (8), vigência (9), pacote (10), duas
// réguas de data (11), particular (12), escopo por convênio (13) e faturabilidade como dados. Moram em @sgh/contratos
// (subcaminho `@sgh/contratos/regras-faturamento`, fora do índice) porque o adaptador do legado também as confere antes
// de gravar e só depende de contratos (fronteira Nx; como D-REGRAS-28); @sgh/dominio-faturamento as publica para a API
// e a tela e as testa.
export * from './recusa.js';
export * from './situacao.js';
export * from './tipo-item.js';
export * from './fechamento.js';
export * from './vigencia.js';
export * from './pacote.js';
export * from './reguas.js';
export * from './particular.js';
export * from './escopo.js';
export * from './faturabilidade.js';
export * from './explicador.js';
export * from './tiss.js';
// M42: regras da onda 4 (abertura da competência, dias sem versão, códigos de baixa confiança, acompanhamento e
// conferência da competência).
export * from './onda4.js';
export * from './estoque-conta.js';
