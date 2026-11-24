// Família acesso-ligacao (modulos-proprios-3): as recusas da entrada por e-mail em Problem Details. O código no e-mail
// pedido por quem não o escolheu é recusa de negócio (409), nunca erro do servidor.
import { ErroProblema } from '../../problema.filter.js';
import { ErroCodigoEmail } from '../../sessao/codigo-email.js';
import { ErroRecuperacaoPlataforma } from '../../sessao/recuperacao-plataforma.js';

const DO_CODIGO: Record<ErroCodigoEmail['codigo'], [import('@sgh/contratos').TipoProblema, number, string]> =
  {
    'metodo-nao-escolhido': ['recusa-de-negocio', 409, 'Segundo fator por e-mail não escolhido'],
    'sem-email': ['recusa-de-negocio', 409, 'Conta sem e-mail'],
    'muitos-envios': ['muitas-tentativas', 429, 'Muitos envios'],
  };

const DA_PLATAFORMA: Record<
  ErroRecuperacaoPlataforma['codigo'],
  [import('@sgh/contratos').TipoProblema, string]
> = {
  indisponivel: ['indisponivel', 'Serviço indisponível'],
  'muitos-pedidos': ['muitas-tentativas', 'Muitos pedidos'],
  'entrada-invalida': ['entrada-invalida', 'Dados inválidos'],
  'token-invalido': ['entrada-invalida', 'Link inválido ou vencido'],
  'conta-impedida': ['recusa-de-negocio', 'Conta impedida'],
  'metodo-nao-escolhido': ['recusa-de-negocio', 'Segundo fator por e-mail não escolhido'],
};

/** O Problem Details da recusa da entrada por e-mail (null: não é dela). */
export function problemaDoAcessoEmail(e: unknown): ErroProblema | null {
  if (e instanceof ErroCodigoEmail) {
    const [tipo, status, titulo] = DO_CODIGO[e.codigo];
    return new ErroProblema(tipo, status, titulo, e.message, { codigo: e.codigo });
  }
  if (e instanceof ErroRecuperacaoPlataforma) {
    const [tipo, titulo] = DA_PLATAFORMA[e.codigo];
    return new ErroProblema(tipo, e.status, titulo, e.message, { codigo: e.codigo });
  }
  return null;
}
