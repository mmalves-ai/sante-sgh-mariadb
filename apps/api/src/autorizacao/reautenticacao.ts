// Reautenticação das ações críticas (SBIS-07; M05/M06; M08: chaves de liberação e parâmetro crítico): sessão
// real, CSRF por token duplo e a senha conferida de novo no legado. A sessão sintética sem cookie (dev/ci,
// sem login) nunca reautentica (401): a ação crítica exige entrar com o usuário.
import { CABECALHO_CSRF, COOKIE_CSRF, lerCookie } from '../sessao/cookies.js';
import { ErroSessao, type ServicoSessao } from '../sessao/servico-sessao.js';
import { ErroProblema } from '../problema.filter.js';
import type { RequisicaoAutorizada } from './guarda.js';
import type { ResolvedorSessao } from './resolvedor-sessao.js';

export async function reautenticar(
  servico: ServicoSessao | null,
  resolvedor: ResolvedorSessao,
  req: RequisicaoAutorizada,
  senha: string | undefined,
): Promise<number> {
  const id = resolvedor.idSessao(req);
  if (!servico || !id || !req.sgh?.real || !senha)
    throw new ErroProblema(
      'reautenticacao-necessaria',
      401,
      'Confirme a senha',
      'Entre com o seu usuário e confirme a senha.',
    );
  const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
  const bruto = req.headers[CABECALHO_CSRF];
  const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
  const rede = resolvedor.rede(req);
  const csrf =
    !!doCookie &&
    doCookie === doCabecalho &&
    (await servico.csrfConfere(id, rede, doCabecalho).catch(() => false));
  if (!csrf) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
  try {
    await servico.reautenticar(id, rede, senha);
  } catch (e) {
    if (e instanceof ErroSessao && e.tipo === 'muitas-tentativas')
      throw new ErroProblema('muitas-tentativas', 429, 'Muitas tentativas');
    throw new ErroProblema('reautenticacao-necessaria', 401, 'Confirme a senha', 'Senha não conferida.');
  }
  return Date.now();
}

/**
 * Crítica que aceita a janela recente (SBIS-07): com a senha no corpo, reautentica; sem ela, exige que a sessão
 * tenha entrado ou reautenticado dentro da janela (o primeiro login conta). Sessão sintética, sem CSRF ou fora
 * da janela: recusa (`reautenticacao-necessaria`), e a tela pede a senha.
 */
export async function exigirReautenticacaoOuSenha(
  servico: ServicoSessao | null,
  resolvedor: ResolvedorSessao,
  req: RequisicaoAutorizada,
  senha: string | undefined,
): Promise<number> {
  if (senha) return reautenticar(servico, resolvedor, req, senha);
  const id = resolvedor.idSessao(req);
  if (!servico || !id || !req.sgh?.real)
    throw new ErroProblema(
      'reautenticacao-necessaria',
      401,
      'Confirme a senha',
      'Entre com o seu usuário e confirme a senha.',
    );
  const doCookie = lerCookie(req.headers['cookie'] as string | undefined, COOKIE_CSRF);
  const bruto = req.headers[CABECALHO_CSRF];
  const doCabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
  const rede = resolvedor.rede(req);
  const csrf =
    !!doCookie &&
    doCookie === doCabecalho &&
    (await servico.csrfConfere(id, rede, doCabecalho).catch(() => false));
  if (!csrf) throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
  try {
    await servico.exigirReautenticacaoRecente(id, rede);
  } catch {
    throw new ErroProblema(
      'reautenticacao-necessaria',
      401,
      'Confirme a senha',
      'Confirme a sua senha para continuar.',
    );
  }
  return Date.now();
}
