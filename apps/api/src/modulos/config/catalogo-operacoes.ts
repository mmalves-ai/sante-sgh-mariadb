// Catálogo das operações liberáveis na API: a regra pura mora em @sgh/dominio-config (liberacao/catalogo-operacoes.ts),
// a mesma que o comando liberacao:ligar-tudo usa; aqui fica só o símbolo de injeção do Nest e a reexportação.
export {
  type CatalogoOperacoesLiberacao,
  catalogoOperacoesProprio,
  type OperacaoLiberavel,
  operacoesDeclaradas,
} from '@sgh/dominio-config';

export const CATALOGO_OPERACOES = Symbol('CATALOGO_OPERACOES');
