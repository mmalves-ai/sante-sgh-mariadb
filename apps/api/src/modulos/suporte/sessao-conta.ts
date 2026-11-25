// Leitura da SESSÃO DA CONTA DA PLATAFORMA (ADR 0021) para qualquer controlador: o cookie próprio (HttpOnly), a
// sessão conferida no serviço (rede do endereço, marca das credenciais) e, nas escritas, o CSRF por token duplo
// próprio (cookie sgh_pcsrf + cabeçalho x-csrf-plataforma, conferido contra o guardado na sessão). Um lugar só: o
// controlador da plataforma e a tela de carga (obra carga-painel) usam a mesma função.
import type { TipoProblema } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import {
  CABECALHO_CSRF_PLATAFORMA,
  COOKIE_CSRF_PLATAFORMA,
  lerCookie,
  lerCookiePlataforma,
} from '../../sessao/cookies.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import type { ContaComAtribuicoes, ErroPlataforma, ServicoPlataforma } from './servico-plataforma.js';

export interface RequisicaoConta {
  readonly headers: Record<string, string | string[] | undefined>;
}

/** Ambiente da leitura: o prefixo __Host- fora de dev/ci e a rede pelo endereço pedido. */
export interface AmbienteConta {
  readonly ambiente: string;
  readonly resolvedor: ResolvedorRede;
}

const SEM_PREFIXO = new Set(['dev', 'ci']);

export const prefixoHostDoAmbiente = (ambiente: string): boolean => !SEM_PREFIXO.has(ambiente);

export function redeDaRequisicao(req: RequisicaoConta, resolvedor: ResolvedorRede): string | null {
  const host = req.headers['host'];
  return resolvedor.resolver(Array.isArray(host) ? host[0] : host);
}

/** O id da sessão da conta no cookie próprio (null sem ele). */
export function idSessaoConta(req: RequisicaoConta, ambiente: string): string | null {
  return lerCookiePlataforma(req.headers['cookie'] as string | undefined, prefixoHostDoAmbiente(ambiente));
}

const ERROS: Record<ErroPlataforma['tipo'], [TipoProblema, number, string]> = {
  'credencial-invalida': ['nao-autenticado', 401, 'E-mail, senha ou código inválidos'],
  'muitas-tentativas': ['muitas-tentativas', 429, 'Muitas tentativas'],
  'sessao-encerrada': ['nao-autenticado', 401, 'Sessão da plataforma encerrada'],
  'sem-permissao': ['sem-permissao', 403, 'Sem permissão'],
  indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
  'entrada-invalida': ['entrada-invalida', 400, 'Dados inválidos'],
  'nao-encontrado': ['nao-encontrado', 404, 'Não encontrado'],
  conflito: ['recusa-de-negocio', 409, 'Operação recusada'],
  'rede-desconhecida': ['rede-desconhecida', 404, 'Endereço sem rede configurada'],
};

/** O erro do serviço da plataforma como Problem Details. */
export function problemaDaPlataforma(e: ErroPlataforma): ErroProblema {
  const [tipo, status, titulo] = ERROS[e.tipo];
  return new ErroProblema(tipo, status, titulo, e.detalhe);
}

/**
 * A conta da sessão da plataforma: 401 sem ela (ou encerrada); nas escritas, 403 sem o CSRF próprio. Erro do
 * serviço sobe como ErroPlataforma (o chamador converte com problemaDaPlataforma).
 */
export async function contaDaSessao(
  p: ServicoPlataforma,
  req: RequisicaoConta,
  amb: AmbienteConta,
  escrita = false,
): Promise<ContaComAtribuicoes> {
  const id = idSessaoConta(req, amb.ambiente);
  const lido = await p.ler(id, redeDaRequisicao(req, amb.resolvedor));
  if (!lido || !id) throw new ErroProblema('nao-autenticado', 401, 'Sessão da plataforma necessária');
  if (escrita) {
    const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF_PLATAFORMA);
    const bruto = req.headers[CABECALHO_CSRF_PLATAFORMA];
    const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    const ok = !!doCookie && doCookie === doCabecalho && (await p.csrfConfere(id, doCabecalho));
    if (!ok) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
  }
  return lido.conta;
}
