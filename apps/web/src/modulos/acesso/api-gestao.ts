// Cliente da tela "Perfis e permissões" (ADR 0022). As gravações levam o CSRF da sessão, a Idempotency-Key e a
// senha digitada na hora (reautenticação; nunca guardada). Os tipos são os contratos de @sgh/contratos.
import type {
  AbrirRecert,
  CancelarPedidoAcessoCorpo,
  ConcederPedidoAcessoCorpo,
  DecidirPedidoAcessoCorpo,
  DecisaoPedidoAcessoTela,
  MeusPedidosAcessoTela,
  NovoPedidoAcessoCorpo,
  PedidosAcessoGestaoTela,
  AlteracaoPerfilTela,
  ChaveMapa,
  ContasDormentesGestaoTela,
  DefinirPerfilCargoRhCorpo,
  PerfisCargoRhGestaoTela,
  ResolucaoTarefaRhResultado,
  ResolverTarefaRhCorpo,
  TarefasRhGestaoTela,
  ExcecaoDormencia,
  DefinirLimiteSessao,
  DecisaoMapaTela,
  DecidirRecert,
  DecisaoRecertTela,
  FecharRecert,
  EfetivasTela,
  GrupoGestaoTela,
  LimitesSessaoGestaoTela,
  MapaGestaoTela,
  OperacaoGestaoLegado,
  OperacaoGestaoTela,
  PapelGestaoTela,
  RecertificacaoGestaoTela,
  RecertificacoesGestaoTela,
  PoliticaSenhaGestaoTela,
  PublicarPoliticaSenha,
  PreviaMapaTela,
  RodadaContasDormentesTela,
  ResultadoGestaoTela,
  SituacaoMapa,
  UsuarioGestaoTela,
  VersaoDescricaoGrupoTela,
} from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const BASE = '/api/acesso/gestao';

function tokenCsrf(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function ler<T>(caminho: string, buscar: typeof fetch, base = BASE): Promise<T> {
  const r = await buscar(`${base}${caminho}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function gravar<T>(caminho: string, corpo: unknown, buscar: typeof fetch, base = BASE): Promise<T> {
  const r = await buscar(`${base}${caminho}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const buscarUsuariosGestao = (busca: string, buscar: typeof fetch = fetch) =>
  ler<UsuarioGestaoTela[]>(`/usuarios?${new URLSearchParams({ busca }).toString()}`, buscar);

export const buscarEfetivas = (login: string, buscar: typeof fetch = fetch) =>
  ler<EfetivasTela>(`/usuarios/${encodeURIComponent(login)}`, buscar);

export const buscarMapaGestao = (buscar: typeof fetch = fetch) => ler<MapaGestaoTela>('/mapa', buscar);
export const buscarGruposGestao = (buscar: typeof fetch = fetch) => ler<GrupoGestaoTela[]>('/grupos', buscar);
export const buscarPapeisGestao = (buscar: typeof fetch = fetch) => ler<PapelGestaoTela[]>('/papeis', buscar);
export const buscarOperacoesGestao = (buscar: typeof fetch = fetch) =>
  ler<OperacaoGestaoTela[]>('/operacoes', buscar);

export const concederPerfil = (
  p: { login: string; perfil: string; inicio?: string; fim?: string; motivo: string; senha: string },
  buscar: typeof fetch = fetch,
) => gravar<ResultadoGestaoTela & { id: string }>('/perfis', p, buscar);

/** W0-09: revogar exige motivo (fica na concessão revogada) e a senha digitada no diálogo. */
export const revogarPerfil = (id: string, motivo: string, senha: string, buscar: typeof fetch = fetch) =>
  gravar<ResultadoGestaoTela>(`/perfis/${encodeURIComponent(id)}/revogar`, { motivo, senha }, buscar);

export const decidirMapa = (
  chave: ChaveMapa,
  situacao: SituacaoMapa,
  senha: string,
  motivo?: string,
  buscar: typeof fetch = fetch,
) =>
  gravar<ResultadoGestaoTela & { id: string }>(
    '/mapa/decidir',
    { chave, situacao, senha, ...(motivo ? { motivo } : {}) },
    buscar,
  );

/** W0-09: o que a decisão faria (quantos usuários perdem o perfil ou a permissão), antes de confirmar. */
export const previaMapa = (chave: ChaveMapa, situacao: SituacaoMapa, buscar: typeof fetch = fetch) =>
  gravar<PreviaMapaTela>('/mapa/previa', { chave, situacao }, buscar);

export const lerDecisoesMapa = (id: string, buscar: typeof fetch = fetch) =>
  ler<DecisaoMapaTela[]>(`/mapa/${encodeURIComponent(id)}/decisoes`, buscar);

/** W0-09: nova vigência e motivo da concessão (a justificativa e o valor anterior ficam na alteração). */
export const alterarPerfil = (
  id: string,
  p: { inicio: string; fim: string | null; motivo: string; justificativa: string; senha: string },
  buscar: typeof fetch = fetch,
) => gravar<ResultadoGestaoTela>(`/perfis/${encodeURIComponent(id)}/alteracao`, p, buscar);

export const lerAlteracoesPerfil = (id: string, buscar: typeof fetch = fetch) =>
  ler<AlteracaoPerfilTela[]>(`/perfis/${encodeURIComponent(id)}/alteracoes`, buscar);

export const executarLegado = (
  operacao: OperacaoGestaoLegado,
  entrada: unknown,
  senha: string,
  buscar: typeof fetch = fetch,
) => gravar<ResultadoGestaoTela>(`/legado/${encodeURIComponent(operacao)}`, { entrada, senha }, buscar);

/** W1-01 (parte 4c): versão nova da descrição do grupo (a anterior fica consultável). */
export const descreverGrupo = (
  grupo: string,
  descricao: string,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
) =>
  gravar<{ id: string; versao: number; anterior: number | null; operacao: string }>(
    '/grupos/descricao',
    { grupo, descricao, motivo, senha },
    buscar,
  );

export const buscarVersoesDescricaoGrupo = (grupo: string, buscar: typeof fetch = fetch) =>
  ler<VersaoDescricaoGrupoTela[]>(`/grupos/${encodeURIComponent(grupo)}/descricoes`, buscar);

/** W1-01 (parte 5): a política de senha do Sante (as regras de base, a efetiva e as versões). */
export const buscarPoliticaSenha = (buscar: typeof fetch = fetch) =>
  ler<PoliticaSenhaGestaoTela>('/politica-senha', buscar);

/** W1-01 (parte 5): publica a versão nova (vigência agora ou agendada); a anterior fica consultável. */
export const publicarPoliticaSenha = (p: PublicarPoliticaSenha, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; versao: number; anterior: number | null; diferenca: string[] }>(
    '/politica-senha',
    p,
    buscar,
  );

/** W1-01 (parte 5): cancela a versão agendada (antes de entrar em vigor), com motivo. */
export const cancelarPoliticaSenha = (
  versao: number,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
) => gravar<{ id: string; versao: number }>(`/politica-senha/${versao}/cancelar`, { motivo, senha }, buscar);

export const invalidarCache = (login: string | null, buscar: typeof fetch = fetch) =>
  gravar<ResultadoGestaoTela>('/cache/invalidar', login ? { login } : {}, buscar);

/** "101, 102 5429" → [101, 102, 5429] (só inteiros positivos, sem repetição). */
export function lerOpcoes(texto: string): number[] {
  return [
    ...new Set(
      texto
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter((x) => /^\d{1,9}$/.test(x))
        .map(Number)
        .filter((n) => n > 0),
    ),
  ];
}

/** W1-01 (parte 8b): limites de sessões simultâneas por perfil (em vigor e histórico). */
export const buscarLimitesSessao = (buscar: typeof fetch = fetch) =>
  ler<LimitesSessaoGestaoTela>('/limites-sessao', buscar);

/** W1-01 (parte 8b): incluir, alterar ou retirar (limite null) o limite de um perfil ('*' = padrão). */
export const definirLimiteSessao = (p: DefinirLimiteSessao, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; anterior: number | null; limite: number | null; operacao: string }>(
    '/limites-sessao',
    p,
    buscar,
  );

/** W1-01 (parte 9b2b): contas dormentes (parâmetros, prévia de hoje, poupadas, exceções e histórico). */
export const buscarContasDormentes = (buscar: typeof fetch = fetch) =>
  ler<ContasDormentesGestaoTela>('/contas-dormentes', buscar);

/** W1-01 (parte 9b2b): incluir, trocar o prazo ou retirar a exceção de uma conta (linha nova, motivo e senha). */
export const registrarExcecaoDormencia = (p: ExcecaoDormencia, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; anterior: string | null; atual: string | null; destino: 'legado' | 'memoria' }>(
    '/contas-dormentes/excecoes',
    p,
    buscar,
  );

/** W1-01 (parte 9b2b): roda agora a rotina das contas dormentes (bloqueio pelo executor), com a senha. */
export const rodarContasDormentes = (senha: string, buscar: typeof fetch = fetch) =>
  gravar<RodadaContasDormentesTela>('/contas-dormentes/rodar', { senha }, buscar);

/** W1-01 (parte 9c2b): campanhas de recertificação (mais nova primeiro, com o relatório) e o prazo padrão. */
export const buscarRecertificacoes = (buscar: typeof fetch = fetch) =>
  ler<RecertificacoesGestaoTela>('/recertificacoes', buscar);

/** W1-01 (parte 9c2b): uma campanha com as contas do retrato e as decisões. */
export const buscarRecertificacao = (id: string, buscar: typeof fetch = fetch) =>
  ler<RecertificacaoGestaoTela>(`/recertificacoes/${encodeURIComponent(id)}`, buscar);

/** W1-01 (parte 9c2b): abrir a campanha (escopo, prazo, motivo e senha). */
export const abrirRecertificacao = (p: AbrirRecert, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; itens: number; destino: 'legado' | 'memoria' }>('/recertificacoes', p, buscar);

/** W1-01 (parte 9c2b): decidir uma conta (manter; retirar com bloqueio ou revogação de perfil, já aplicado). */
export const decidirRecertificacao = (id: string, p: DecidirRecert, buscar: typeof fetch = fetch) =>
  gravar<DecisaoRecertTela>(`/recertificacoes/${encodeURIComponent(id)}/decisoes`, p, buscar);

/** W1-01 (parte 9c2b): encerrar ou cancelar a campanha aberta. */
export const fecharRecertificacao = (id: string, p: FecharRecert, buscar: typeof fetch = fetch) =>
  gravar<{
    id: string;
    situacao: 'encerrada' | 'cancelada';
    pendentes: number;
    destino: 'legado' | 'memoria';
  }>(`/recertificacoes/${encodeURIComponent(id)}/fechar`, p, buscar);

// ── W1-01 (parte 10c): pedido de acesso (a própria pessoa em /api/acesso/pedidos; a gestão em …/gestao/pedidos) ──
const PEDIDOS = '/api/acesso/pedidos';

/** Os pedidos da própria pessoa, os perfis que ela pode pedir e os setores. */
export const buscarMeusPedidosAcesso = (buscar: typeof fetch = fetch) =>
  ler<MeusPedidosAcessoTela>('', buscar, PEDIDOS);

/** Pedir um perfil (perfil, setor, primeiro e último dia, motivo). */
export const pedirAcesso = (p: NovoPedidoAcessoCorpo, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; destino: 'legado' | 'memoria' }>('', p, buscar, PEDIDOS);

/** Cancelar o próprio pedido antes da concessão (motivo e senha). */
export const cancelarPedidoAcesso = (
  id: string,
  p: CancelarPedidoAcessoCorpo,
  buscar: typeof fetch = fetch,
) =>
  gravar<{ id: string; situacao: 'cancelado'; destino: 'legado' | 'memoria' }>(
    `/${encodeURIComponent(id)}/cancelar`,
    p,
    buscar,
    PEDIDOS,
  );

/** Os pedidos do estabelecimento para decidir (em andamento primeiro). */
export const buscarPedidosAcessoGestao = (buscar: typeof fetch = fetch) =>
  ler<PedidosAcessoGestaoTela>('/pedidos', buscar);

/** Aprovar ou recusar o nível que o pedido espera (aprovado o 2º nível, o perfil já sai concedido). */
export const decidirPedidoAcesso = (id: string, p: DecidirPedidoAcessoCorpo, buscar: typeof fetch = fetch) =>
  gravar<DecisaoPedidoAcessoTela>(`/pedidos/${encodeURIComponent(id)}/decisao`, p, buscar);

/** Revisão: conceder o perfil do pedido 'aprovado' que ficou sem concessão (senha). */
export const concederPedidoAcesso = (
  id: string,
  p: ConcederPedidoAcessoCorpo,
  buscar: typeof fetch = fetch,
) => gravar<DecisaoPedidoAcessoTela>(`/pedidos/${encodeURIComponent(id)}/conceder`, p, buscar);

// ── W1-01 (parte 11a3): provisionamento pelo RH (tarefas derivadas dos vínculos; mapa cargo → perfil) ──

/** As tarefas abertas do RH (criar, revisar, suspender), as resolvidas, os parâmetros e o estado do bloqueio. */
export const buscarTarefasRh = (buscar: typeof fetch = fetch) =>
  ler<TarefasRhGestaoTela>('/rh/tarefas', buscar);

/** Resolver uma tarefa (feita ou dispensada; criar-acesso feita leva o login criado), com motivo e senha. */
export const resolverTarefaRh = (p: ResolverTarefaRhCorpo, buscar: typeof fetch = fetch) =>
  gravar<ResolucaoTarefaRhResultado>('/rh/tarefas/resolver', p, buscar);

/** O mapa cargo → perfil sugerido em vigor, o histórico, os perfis e os cargos dos vínculos ativos. */
export const buscarPerfisCargoRh = (buscar: typeof fetch = fetch) =>
  ler<PerfisCargoRhGestaoTela>('/rh/perfis-cargo', buscar);

/** Incluir, trocar ou retirar (perfil null) a sugestão de perfil de um cargo (linha nova, motivo e senha). */
export const definirPerfilCargoRh = (p: DefinirPerfilCargoRhCorpo, buscar: typeof fetch = fetch) =>
  gravar<{ id: string; anterior: string | null; perfil: string | null; destino: 'legado' | 'memoria' }>(
    '/rh/perfis-cargo',
    p,
    buscar,
  );
