// Partes comuns dos controladores do M10: a sessão (rede, estabelecimento, login, perfis), a análise da entrada
// pelo Zod dos contratos, o Problem Details dos erros do executor e das regras (sem nome de tabela nem valor), a
// Idempotency-Key das receitas, a reautenticação (SBIS-07) e a linha da trilha das gravações SGH_.
import { segredosNaResposta } from '@sgh/contratos';
import { type ContextoOperacao, ErroOperacao, ErroPedido, ErroSetor, type TrilhaGestao } from '@sgh/legado';
import type { z } from 'zod';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import type { Ctx } from './fonte.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

export interface SessaoM10 {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly perfis: readonly string[];
  readonly permissoes: ReadonlySet<string>;
}

export function sessaoDe(req: RequisicaoAutorizada): SessaoM10 {
  const s = req.sgh?.sessao;
  if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
    throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
  const perfil = s.perfil;
  return {
    rede: s.rede,
    hospital: s.estabelecimentoAtivo,
    login: s.usuario.login,
    perfis: [...(perfil?.perfil ? [perfil.perfil] : []), ...(perfil?.complementares ?? [])],
    permissoes: new Set(s.permissoes ?? []),
  };
}

export function ctxDe(req: RequisicaoAutorizada, origem: string): Ctx {
  const s = sessaoDe(req);
  return { rede: s.rede, hospital: s.hospital, traceId: correlacaoDaRequisicao(req, origem) };
}

export function analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Dados inválidos',
      r.error.issues[0]?.message ?? undefined,
    );
  return r.data;
}

/** Erro do executor ou da regra (mesmos códigos) → Problem Details sem nome de tabela nem valor. */
export function problema(e: unknown): never {
  if (e instanceof ErroProblema) throw e;
  if (e instanceof ErroOperacao) {
    const p = e.problema;
    const tipo =
      p.codigo === 'conflito-versao'
        ? 'conflito-de-versao'
        : p.status === 409
          ? 'recusa-de-negocio'
          : tipoPorStatus(p.status);
    throw new ErroProblema(tipo, p.status, p.title, p.detail, { ...(p.codigo ? { codigo: p.codigo } : {}) });
  }
  if (e instanceof ErroSetor || e instanceof ErroPedido)
    throw new ErroProblema(
      e.codigo === 'conflito-versao' ? 'conflito-de-versao' : 'recusa-de-negocio',
      409,
      'Operação recusada',
      e.message,
      { codigo: e.codigo },
    );
  throw e;
}

export function idempotencia(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return chave;
}

export function reautenticado(
  servico: ServicoSessao | null,
  resolvedor: ResolvedorSessao,
  req: RequisicaoAutorizada,
  senha: string | undefined,
): Promise<number> {
  return reautenticar(servico, resolvedor, req, senha);
}

/** Contexto da receita do executor (o operador é o login da sessão; no "como", o alvo ou o "em nome de"). */
export function contextoOperacao(
  req: RequisicaoAutorizada,
  origem: string,
  reautenticadoEm?: number,
  chave?: string,
): ContextoOperacao {
  const s = sessaoDe(req);
  return {
    rede: s.rede,
    hospital: s.hospital,
    traceId: correlacaoDaRequisicao(req, origem),
    usuarioLegado: s.login,
    idempotencyKey: chave ?? idempotencia(req),
    estacao: estacaoDaRequisicao(req).slice(0, 80),
    ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
  };
}

export function trilhaDe(
  req: RequisicaoAutorizada,
  evento: string,
  recurso: string,
  operacao: string,
): TrilhaGestao {
  const s = sessaoDe(req);
  return {
    rede: s.rede,
    hospital: s.hospital,
    usuario: s.login,
    evento,
    recurso,
    operacao,
    resultado: 'sucesso',
    estacao: estacaoDaRequisicao(req).slice(0, 80),
    correlacao: correlacaoDaRequisicao(req, 'administracao').slice(0, 64),
  };
}

/** Regra 10 na saída: nenhuma resposta do M10 leva coluna de credencial ou de dado pessoal (falha fechada). */
export function semSegredos<T>(corpo: T): T {
  const achados = segredosNaResposta(corpo);
  if (achados.length > 0)
    throw new ErroProblema(
      'erro-interno',
      500,
      'Resposta recusada',
      'A resposta continha um campo proibido.',
    );
  return corpo;
}

/** Data civil (AAAA-MM-DD) de um Date (hora civil do banco). */
export function dia(v: Date | null | undefined): string | null {
  if (!(v instanceof Date)) return null;
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
}
