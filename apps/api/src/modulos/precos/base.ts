// Partes comuns dos controladores do M12: sessão e estabelecimento, contexto de leitura, permissão conferida no
// handler (com a negação na trilha), escopo de convênio (pela sessão, M06), contexto da operação
// (Idempotency-Key obrigatória; reautenticação nas críticas) e a tradução dos erros do executor para Problem
// Details em português (sem nome de tabela nem valor de coluna).
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoDoEstabelecimento, idUsuarioDaSessao } from '../cadastro/contexto-nucleo.js';
import type { ContextoGravacaoPreco, CtxPrecos } from './fonte.js';
import { ErroCarga, ErroPlano } from './tipos.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,72}$/;

export function sessaoDe(req: RequisicaoAutorizada) {
  const a = req.sgh;
  if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
  const hospital = a.sessao.estabelecimentoAtivo;
  if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
  return { a, hospital, rede: a.sessao.rede ?? '', login: a.sessao.usuario.login ?? a.sessao.usuario.id };
}

export function ctxDe(req: RequisicaoAutorizada, origem: string): CtxPrecos {
  const s = sessaoDe(req);
  const correlacao = correlacaoDaRequisicao(req, origem).slice(0, 64);
  return {
    ...contextoDoEstabelecimento(s.hospital),
    usuario: idUsuarioDaSessao(s.a.sessao.usuario.id),
    correlacao,
    rede: s.rede,
    hospital: s.hospital,
    traceId: correlacao,
  };
}

export function podeNa(req: RequisicaoAutorizada, codigo: string): boolean {
  const a = req.sgh;
  return !!a && pode(a.ability, codigo);
}

/** Exige a permissão (mesmas regras CASL da tela); a negação vai à trilha. */
export async function exigir(
  req: RequisicaoAutorizada,
  codigo: string,
  trilha: RegistradorTrilha,
): Promise<void> {
  if (podeNa(req, codigo)) return;
  const { rede, hospital, login } = sessaoDe(req);
  await trilha
    .registrar({
      evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
      rede,
      hospital,
      usuario: login,
      estacao: estacaoDaRequisicao(req),
      correlacao: correlacaoDaRequisicao(req, 'negada'),
      recurso: codigo.slice(0, 80),
      resultado: 'falha',
    })
    .catch(() => undefined);
  throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.');
}

/**
 * Convênios do escopo da sessão (lidos pelo M06): null = sem restrição (lista vazia = todos, POL-1). Lido direto da sessão: o módulo `convenio` não tem escopo por módulo no CASL (as
 * classificações oncológicas, que não são por convênio, falhariam fechado).
 */
export function escopoConvenio(req: RequisicaoAutorizada): readonly string[] | null {
  const lista = req.sgh?.sessao.escopos?.convenios ?? [];
  return lista.length > 0 ? lista.map(String) : null;
}

/**
 * Filtro de convênio de uma leitura em lista pelo escopo da sessão: o convênio pedido (fora do escopo:
 * 'fora', a lista vazia de "nada vaza"); sem convênio pedido, a lista do escopo (nunca "todos" com escopo
 * restrito) ou null (sem restrição: todos).
 */
export function filtroConvenioDaSessao(
  req: RequisicaoAutorizada,
  pedido: number | null,
): number | readonly number[] | null | 'fora' {
  const e = escopoConvenio(req);
  if (pedido !== null) return e && !e.includes(String(pedido)) ? 'fora' : pedido;
  return e ? e.map(Number).filter((n) => Number.isInteger(n)) : null;
}

export function exigirNoEscopo(req: RequisicaoAutorizada, convenio: number): void {
  const e = escopoConvenio(req);
  // Fora do escopo: o mesmo 404 do inexistente (nada vaza).
  if (e && !e.includes(String(convenio)))
    throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
}

/** A Idempotency-Key do pedido, quando válida; null quando o cliente não a mandou (gravação sem reenvio seguro). */
export function chaveDoPedido(req: RequisicaoAutorizada): string | null {
  const bruto = req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof chave === 'string' && IDEMPOTENCIA.test(chave) ? chave : null;
}

export function contextoOperacao(
  req: RequisicaoAutorizada,
  origem: string,
  reautenticadoEm?: number,
): ContextoGravacaoPreco {
  const { login } = sessaoDe(req);
  const bruto = req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return {
    ...ctxDe(req, origem),
    login,
    chaveIdempotencia: chave,
    estacao: estacaoDaRequisicao(req).slice(0, 80),
    ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
  };
}

/** Erro do executor (ou da gravação direta) → Problem Details em português. */
export function problemaDoPreco(e: unknown): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroCarga)
    return new ErroProblema('recusa-de-negocio', 409, 'Importação', e.message, { codigo: e.codigo });
  if (e instanceof ErroPlano)
    return e.codigo === 'nao-encontrado'
      ? new ErroProblema('nao-encontrado', 404, 'Plano', e.message, { codigo: e.codigo })
      : e.codigo === 'conflito-concorrente'
        ? new ErroProblema('conflito-de-versao', 409, 'Plano', e.message, {
            alteradoPor: 'desconhecido',
            campos: [],
            codigo: e.codigo,
          })
        : new ErroProblema('entrada-invalida', 400, 'Plano', e.message, { codigo: e.codigo });
  if (!(e instanceof ErroOperacao)) throw e;
  const p = e.problema;
  const codigo = p.codigo ?? 'erro-interno';
  switch (codigo) {
    case 'conflito-versao':
      return new ErroProblema('conflito-de-versao', 409, p.title, p.detail, {
        alteradoPor: 'desconhecido',
        campos: [...(p.colunas ?? [])],
        codigo,
      });
    case 'registro-em-edicao':
      return new ErroProblema('registro-em-edicao', 409, p.title, p.detail, { codigo });
    case 'registro-inexistente':
      return new ErroProblema('nao-encontrado', 404, p.title, p.detail, { codigo });
    case 'entrada-invalida':
      return new ErroProblema('entrada-invalida', 400, p.title, p.detail, {
        codigo,
        campos: [...(p.campos ?? [])],
      });
    case 'operacao-nao-liberada':
    case 'operacao-bloqueada':
      return new ErroProblema('operacao-bloqueada', p.status, p.title, p.detail, { codigo });
    case 'reautenticacao-necessaria':
      return new ErroProblema('reautenticacao-necessaria', 401, p.title, p.detail, { codigo });
    case 'schema-divergente':
      return new ErroProblema('indisponivel', 503, p.title, p.detail, { codigo });
    case 'contexto-invalido':
    case 'idempotencia-divergente':
      return new ErroProblema('entrada-invalida', p.status, p.title, p.detail, { codigo });
    default:
      if (p.status === 409 || p.status === 404)
        return new ErroProblema(
          p.status === 404 ? 'nao-encontrado' : 'recusa-de-negocio',
          p.status,
          p.title,
          p.detail,
          {
            codigo,
            campos: [...(p.campos ?? [])],
          },
        );
      return new ErroProblema('erro-interno', 500, 'Erro inesperado');
  }
}

const INTEIRO = /^-?\d{1,9}$/;
export function inteiro(v: unknown, nome: string, faixa: [number, number] = [0, 2147483647]): number {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  const n = INTEIRO.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < faixa[0] || n > faixa[1])
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', `Valor inválido: ${nome}.`);
  return n;
}
export function inteiroOuNulo(v: unknown, nome: string): number | null {
  return v === undefined || v === null || v === '' ? null : inteiro(v, nome);
}
export function paginaDe(
  q: Record<string, string | undefined>,
  teto = 500,
): { pagina: number; porPagina: number } {
  const pagina = q['pagina'] ? inteiro(q['pagina'], 'pagina', [0, 100000]) : 0;
  const porPagina = q['porPagina'] ? inteiro(q['porPagina'], 'porPagina', [1, teto]) : 50;
  return { pagina, porPagina };
}
export function dataDe(v: string | undefined): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Data no formato AAAA-MM-DD.');
  return v;
}
