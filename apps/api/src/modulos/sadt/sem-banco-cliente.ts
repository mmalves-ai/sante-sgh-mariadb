// 05-SADT linha 7 (C1-042): o 503 de "esta função precisa do banco do cliente" leva um código próprio no Problem
// Details. A tela do diagnóstico reconhece só esse código para dizer que a fonte de dados não tem o banco; os outros
// 503 do tipo "indisponivel" (gerador de PDF fora do ar, serviço de emissão sem configuração, 503 cru do filtro)
// seguem na mensagem geral, com o código de correlação para o suporte achar o log.
import { ErroProblema } from '../../problema.filter.js';

/** Código da recusa: a função depende do banco do cliente e a fonte de dados desta sessão não o tem. */
export const CODIGO_SEM_BANCO_CLIENTE = 'sem-banco-cliente';

/** O 503 "indisponivel" com o código próprio de quem precisa do banco do cliente. */
export function semBancoDoCliente(titulo: string, detalhe?: string): ErroProblema {
  return new ErroProblema('indisponivel', 503, titulo, detalhe, { codigo: CODIGO_SEM_BANCO_CLIENTE });
}
