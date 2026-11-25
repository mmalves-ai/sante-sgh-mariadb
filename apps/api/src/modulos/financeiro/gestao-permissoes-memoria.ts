// F3.8, 07-FIN linha 99: as permissões do financeiro na sessão sintética (E2E sem banco do cliente). Só serve à porta em
// memória: com o banco do cliente, as leituras e as gravações são as do gestao-propria.ts, pelo executor. Aqui o estado
// vive no processo, por estabelecimento, com as MESMAS regras do domínio (segregação do próprio escopo, movimentar exige
// consultar, vigência; a marca de restrito separada da lista, por operação) e as mesmas recusas da gravação no banco.
import {
  conferirEscopoConta,
  OPERACOES_TIPO_LANCAMENTO,
  type OperacaoTipoLancamento,
} from '@sgh/dominio-financeiro';
import { ErroProblema } from '../../problema.filter.js';
import type {
  EscopoContaEntrada,
  EscopoContaResposta,
  RestricaoTipoLancamentoEntrada,
  TipoLancamentoPerfilEntrada,
} from './gestao-propria.js';

const USUARIOS = [
  { id: 9101, nome: 'LANÇADOR SINTÉTICO', login: 'SINT.FIN.LANCA' },
  { id: 9102, nome: 'PAGADOR SINTÉTICO', login: 'SINT.FIN.PAGA' },
  { id: 9103, nome: 'CONCILIADOR SINTÉTICO', login: 'SINT.FIN.CONCILIA' },
] as const;
const CONTAS = [
  { conta: 9201, nome: 'CONTA MOVIMENTO SINTÉTICA' },
  { conta: 9202, nome: 'CONTA APLICAÇÃO SINTÉTICA' },
] as const;
const PERFIS = [
  { id: 9301, codigo: 'SINT-TESOURARIA', nome: 'TESOURARIA SINTÉTICA' },
  { id: 9302, codigo: 'SINT-CONTAS-PAGAR', nome: 'CONTAS A PAGAR SINTÉTICO' },
] as const;
const TIPOS = {
  lancamento: [
    { tipo: 9401, codigo: 'credito_avulso', descricao: 'CRÉDITO AVULSO' },
    { tipo: 9402, codigo: 'tarifa', descricao: 'TARIFA BANCÁRIA' },
    { tipo: 9403, codigo: 'transferencia', descricao: 'TRANSFERÊNCIA ENTRE CONTAS' },
  ],
  credor: [
    { tipo: 9501, codigo: 'fornecedor', descricao: 'FORNECEDOR' },
    { tipo: 9502, codigo: 'medico', descricao: 'MÉDICO' },
    { tipo: 9503, codigo: 'tributos', descricao: 'TRIBUTOS' },
  ],
  documento: [
    { tipo: 9601, codigo: 'fatura', descricao: 'FATURA' },
    { tipo: 9602, codigo: 'recibo', descricao: 'RECIBO' },
  ],
} as const;

interface LinhaEscopo {
  consultar: boolean;
  movimentar: boolean;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
}
interface Estado {
  readonly escopo: Map<string, LinhaEscopo>;
  readonly restritos: Set<string>;
  readonly liberados: Set<string>;
}
const ESTADOS = new Map<number, Estado>();
const estado = (est: number): Estado => {
  let e = ESTADOS.get(est);
  if (!e) ESTADOS.set(est, (e = { escopo: new Map(), restritos: new Set(), liberados: new Set() }));
  return e;
};
const recusa = (codigo: string, mensagem: string, campos: readonly string[] = []) =>
  new ErroProblema('entrada-invalida', 409, mensagem, undefined, { codigo, campos: [...campos] });

export const usuariosMemoria = () => USUARIOS.map((u) => ({ ...u }));
export const perfisMemoria = () => PERFIS.map((p) => ({ ...p }));

export function escopoMemoria(
  est: number,
  usuario: number,
): { restrito: boolean; contas: EscopoContaResposta[] } {
  const e = estado(est);
  const linhas = CONTAS.map((c) => ({ ...c, linha: e.escopo.get(`${usuario}:${c.conta}`) }));
  const restrito = linhas.some((x) => x.linha);
  return {
    restrito,
    contas: linhas.map((x) => ({
      conta: x.conta,
      nome: x.nome,
      consultar: restrito ? (x.linha?.consultar ?? false) : true,
      movimentar: restrito ? (x.linha?.movimentar ?? false) : true,
      vigenciaInicio: x.linha?.vigenciaInicio ?? null,
      vigenciaFim: x.linha?.vigenciaFim ?? null,
      temLinha: !!x.linha,
    })),
  };
}

/** Grava a linha do usuário na conta (retirar desliga as marcas e a linha fica), com a regra do domínio. */
export function manterEscopoMemoria(est: number, login: string, e: EscopoContaEntrada) {
  if (!USUARIOS.some((u) => u.id === e.usuario))
    throw recusa('usuario-inexistente', 'O usuário não existe neste estabelecimento.', ['usuario']);
  if (!CONTAS.some((c) => c.conta === e.conta))
    throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', ['conta']);
  const r = conferirEscopoConta({
    usuario: e.usuario,
    quemMantem: USUARIOS.find((u) => u.login === login)?.id ?? 0,
    consultar: e.consultar,
    movimentar: e.movimentar,
    vigenciaInicio: e.vigenciaInicio ?? null,
    vigenciaFim: e.vigenciaFim ?? null,
  });
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ?? []);
  estado(est).escopo.set(`${e.usuario}:${e.conta}`, {
    consultar: e.consultar,
    movimentar: e.movimentar,
    vigenciaInicio: e.vigenciaInicio ?? null,
    vigenciaFim: e.vigenciaFim ?? null,
  });
  return { usuario: e.usuario, conta: e.conta, consultar: e.consultar, movimentar: e.movimentar };
}

export function tiposMemoria(est: number, perfil: number, operacao: OperacaoTipoLancamento) {
  const e = estado(est);
  return {
    operacao,
    restrito: e.restritos.has(`${perfil}:${operacao}`),
    tipos: TIPOS[OPERACOES_TIPO_LANCAMENTO[operacao].alvo].map((t) => ({
      ...t,
      liberado: e.liberados.has(`${perfil}:${operacao}:${t.tipo}`),
    })),
  };
}

const exigirPerfil = (perfil: number): void => {
  if (!PERFIS.some((p) => p.id === perfil))
    throw recusa('perfil-inexistente', 'O perfil de acesso não existe neste estabelecimento.', ['perfil']);
};

/** Liberar o primeiro tipo restringe o perfil na operação; retirar nunca desfaz a restrição. */
export function manterTipoMemoria(est: number, x: TipoLancamentoPerfilEntrada) {
  const operacao = x.operacao ?? 'banco';
  exigirPerfil(x.perfil);
  if (!TIPOS[OPERACOES_TIPO_LANCAMENTO[operacao].alvo].some((t) => t.tipo === x.tipo))
    throw recusa('tipo-inexistente', 'O tipo não existe para esta operação.', ['tipo']);
  const e = estado(est);
  const chave = `${x.perfil}:${operacao}:${x.tipo}`;
  if (e.liberados.has(chave) === x.liberado)
    throw recusa('sem-mudanca', x.liberado ? 'O tipo já está liberado.' : 'O tipo já não está liberado.');
  const marca = `${x.perfil}:${operacao}`;
  const restringiu = x.liberado && !e.restritos.has(marca);
  if (x.liberado) {
    e.liberados.add(chave);
    e.restritos.add(marca);
  } else e.liberados.delete(chave);
  return { operacao, perfil: x.perfil, tipo: x.tipo, liberado: x.liberado, restringiu };
}

export function manterRestricaoMemoria(est: number, x: RestricaoTipoLancamentoEntrada) {
  const operacao = x.operacao ?? 'banco';
  exigirPerfil(x.perfil);
  const e = estado(est);
  const marca = `${x.perfil}:${operacao}`;
  if (e.restritos.has(marca) === x.restrito)
    throw recusa('sem-mudanca', x.restrito ? 'O perfil já está restrito.' : 'O perfil já não está restrito.');
  if (x.restrito) e.restritos.add(marca);
  else e.restritos.delete(marca);
  return { operacao, perfil: x.perfil, restrito: x.restrito };
}
