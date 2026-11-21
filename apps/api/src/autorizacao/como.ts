// Sessão "como" (ADR 0021: suporte técnico e "login como"). A marca é UMA só e mora no @sgh/nucleo: a guarda e o
// interceptor marcam a requisição (executarComo) e o Executor do núcleo grava o ator real junto com o alvo na
// trilha da mesma transação; a trilha da API (RegistradorTrilhaMemoria) lê a mesma marca. Este arquivo só
// reexporta, para os imports da API não dependerem do caminho do pacote.
export { type MarcaComo, executarComo, marcaComoAtual } from '@sgh/nucleo';
