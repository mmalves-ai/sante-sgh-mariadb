// Cliente da governança do cadastro de itens (C2-082, 05-SUP linha 2): solicitação à comissão de padronização,
// unificação de itens duplicados e substituição (de-para). A gravação leva a Idempotency-Key.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface ItemCadastroTela {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
}
export interface SolicitacaoTela {
  readonly id: number;
  readonly numero: number;
  readonly tipo: 'inclusao' | 'alteracao' | 'inativacao';
  readonly item: string | null;
  readonly descricao: string;
  readonly justificativa: string;
  readonly situacao: string;
  readonly solicitante: number;
  readonly solicitadoEm: string;
  readonly parecer: string | null;
  readonly motivoReprovacao: string | null;
  readonly criadoItem: number | null;
  readonly versao: number;
}
export interface UnificacaoTela {
  readonly id: number;
  readonly numero: string;
  readonly permanece: string;
  readonly absorvidos: string;
  readonly motivo: string;
  readonly situacao: string;
  readonly solicitante: number;
  readonly solicitadoEm: string;
  readonly executadoEm: string | null;
  readonly referenciasTransferidas: number;
  readonly versao: number;
}
export interface SubstituicaoTela {
  readonly id: number;
  readonly item: string;
  readonly substituto: string;
  readonly tipo: string;
  readonly fator: number;
  readonly exigeAvisoPrescritor: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}
export interface GravadoTela {
  readonly id: number;
  readonly situacao: string;
}

const B = '/api/suprimentos/governanca-cadastro';

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
async function gravar(url: string, corpo: unknown, chave: string): Promise<GravadoTela> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as GravadoTela;
}

export const novaChaveGovernanca = () => novaChaveContrato('governanca-cad');
export const buscarItensCadastro = (termo: string) =>
  ler<ItemCadastroTela[]>(`${B}/itens?${new URLSearchParams({ termo }).toString()}`);
export const listarSolicitacoesCadastro = () => ler<SolicitacaoTela[]>(`${B}/solicitacoes`);
export const listarUnificacoes = () => ler<UnificacaoTela[]>(`${B}/unificacoes`);
export const listarSubstituicoes = (item: number | null) =>
  ler<SubstituicaoTela[]>(`${B}/substituicoes${item ? `?item=${item}` : ''}`);

export const solicitarCadastro = (
  e: {
    tipo: 'inclusao' | 'alteracao' | 'inativacao';
    item: number | null;
    descricao: string;
    unidade?: string | null;
    justificativa: string;
  },
  chave: string,
) => gravar(`${B}/solicitacoes`, e, chave);
export const decidirSolicitacaoCadastro = (
  id: number,
  d: {
    versao: number;
    acao: 'aprovar' | 'reprovar' | 'cancelar';
    parecer?: string | null;
    motivo?: string | null;
    codigo?: string;
    tipoItem?: string;
    grupo?: number;
    unidadeEstoque?: number;
  },
  chave: string,
) => gravar(`${B}/solicitacoes/${id}/decisao`, d, chave);
export const pedirUnificacao = (
  e: { permanece: number; absorvidos: { item: number; fator: number }[]; motivo: string },
  chave: string,
) => gravar(`${B}/unificacoes`, e, chave);
export const decidirUnificacao = (
  id: number,
  d: { versao: number; acao: 'aprovar' | 'executar' | 'cancelar'; motivo?: string | null },
  chave: string,
) => gravar(`${B}/unificacoes/${id}/decisao`, d, chave);
export const gravarSubstituicao = (
  e: {
    item: number;
    substituto: number;
    tipo: 'generico' | 'terapeutico' | 'apresentacao' | 'marca';
    fator: number;
    exigeAvisoPrescritor: boolean;
    ativo: boolean;
  },
  chave: string,
) => gravar(`${B}/substituicoes`, e, chave);
