// Operações do estoque (M28) e apoios comuns das portas do módulo: o esquema de entrada de cada operação do executor
// (os contratos Zod de @sgh/contratos), a recusa do recurso que o banco ainda não atende (OPME e manipulação), a fonte do estado das operações (memória de dev/ci) e o valor guardado no resultado das gravações diretas.
// Melhoria: a lista das operações é do próprio módulo (sem catálogo do sistema de origem); operação desconhecida é
// recusada com código, nunca aceita em silêncio.
import {
  type EstadoOperacao,
  esquemaCorrigirValidade,
  esquemaCriarPedido,
  esquemaDefinirVencedor,
  esquemaDesconsolidar,
  esquemaFecharMes,
  esquemaGravarKitPadrao,
  esquemaMovimentoDireto,
  esquemaReabrirMes,
  esquemaRegistrarBalanco,
  esquemaRegistrarDevolucao,
  esquemaRegistrarEntradaNF,
  esquemaRegistrarProposta,
  esquemaRegistrarSaida,
  esquemaReporKit,
  esquemaRequisitarMaterial,
  esquemaTransferir,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  ErroOperacao,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import type { ZodTypeAny } from 'zod';
import type { SessaoCadastro } from '../cadastro/comum.js';

/** O esquema de entrada de cada operação do executor no estoque. */
export const ENTRADAS_SUPRIMENTOS: Readonly<Record<string, ZodTypeAny>> = {
  'suprimentos.registrarSaida': esquemaRegistrarSaida,
  'suprimentos.registrarDevolucao': esquemaRegistrarDevolucao,
  'suprimentos.requisitarMaterial': esquemaRequisitarMaterial,
  'suprimentos.transferir': esquemaTransferir,
  'suprimentos.registrarEntradaNF': esquemaRegistrarEntradaNF,
  'suprimentos.criarPedido': esquemaCriarPedido,
  'suprimentos.registrarProposta': esquemaRegistrarProposta,
  'suprimentos.definirVencedorCotacao': esquemaDefinirVencedor,
  'suprimentos.registrarMovimentoDireto': esquemaMovimentoDireto,
  'suprimentos.registrarBalanco': esquemaRegistrarBalanco,
  'suprimentos.fecharMes': esquemaFecharMes,
  'suprimentos.reabrirMes': esquemaReabrirMes,
  'suprimentos.reporKitRastreavel': esquemaReporKit,
  'suprimentos.desconsolidarDocumento': esquemaDesconsolidar,
  'suprimentos.corrigirValidadeLote': esquemaCorrigirValidade,
  'suprimentos.gravarKitPadrao': esquemaGravarKitPadrao,
};

/** A operação do estoque pelo nome (a entrada valida a requisição); desconhecida: recusa. */
export function operacaoSuprimentos(nome: string): { readonly nome: string; readonly entrada: ZodTypeAny } {
  const entrada = ENTRADAS_SUPRIMENTOS[nome];
  if (!entrada) throw recusa('operacao-desconhecida', 'Operação desconhecida no estoque.');
  return { nome, entrada };
}

/** 409 com o motivo: o recurso ainda não está no banco (a tela fica em consulta, nada é gravado). */
export const modeloPendente = (o: string): ErroOperacao =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso ainda não disponível no banco',
    `${o.slice(0, 1).toUpperCase()}${o.slice(1)} ainda não está disponível neste banco: a tela fica em consulta.`,
  );

/** O estado das operações por estabelecimento (memória de dev/ci: o padrão é liberada). */
export interface FonteEstadoOperacao {
  estado(operacao: string, estabelecimento: string): EstadoOperacao | null;
}

/** A chave do estado em memória: o estabelecimento da sessão (o cliente inteiro, sem estabelecimento). */
export const chaveMemoria = (c: ContextoNucleo): string =>
  c.estabelecimento === null ? 'cliente' : String(c.estabelecimento);

/** O login de quem grava (a memória de dev/ci guarda o escopo por login); sem login, o id do usuário. */
export function loginDaOperacao(ctx: ContextoOperacao): string {
  const l = (ctx as { readonly login?: unknown }).login;
  return typeof l === 'string' && l ? l : String(ctx.usuario ?? '');
}

/** A chave de idempotência mandada pela tela, quando o contexto a traz. */
export function chaveDaTela(c: ContextoNucleo): string | null {
  const k = (c as { readonly chaveIdempotencia?: unknown }).chaveIdempotencia;
  return typeof k === 'string' && k ? k : null;
}

/** O nome da operação: o evento da tela (`dadosDepois.evento`) quando a trilha é fixa; senão, o genérico do módulo. */
export function nomeDaGravacao(modulo: string, trilha: unknown): string {
  const ev =
    typeof trilha === 'function'
      ? null
      : (trilha as { dadosDepois?: { evento?: unknown } } | null)?.dadosDepois?.evento;
  if (typeof ev !== 'string') return `${modulo}.gravacao`;
  const nome = ev.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /^[a-z][a-z0-9_.-]{2,119}$/.test(nome) && nome.startsWith(`${modulo}.`)
    ? nome
    : `${modulo}.gravacao`;
}

/** O valor da gravação guardado no resultado da operação (a repetida pela chave devolve o mesmo valor). */
export function resultadoDe(v: unknown): ResultadoOperacao {
  return { valor: v === undefined ? null : JSON.stringify(v) };
}

export function valorDe<T>(r: ResultadoOperacao): T {
  const v = r['valor'];
  return (typeof v === 'string' ? JSON.parse(v) : undefined) as T;
}

/** O contexto do núcleo, sem os campos extras da sessão. */
export function contextoNucleo(c: ContextoNucleo, rotulo: string): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || rotulo).slice(0, 64),
  };
}

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,100}$/;
const ordemNaRequisicao = new WeakMap<object, number>();

/**
 * A sessão com a Idempotency-Key da tela no contexto da porta (mais a ordem da gravação direta na requisição): o
 * reenvio do mesmo pedido devolve o resultado gravado, sem gravar de novo. Sem a chave, cada gravação é única.
 */
export function comChave(s: SessaoCadastro): SessaoCadastro {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave)) return s;
  const ordem = (ordemNaRequisicao.get(s.req) ?? 0) + 1;
  ordemNaRequisicao.set(s.req, ordem);
  return { ...s, porta: { ...s.porta, chaveIdempotencia: `${chave}:${ordem}` } as SessaoCadastro['porta'] };
}
