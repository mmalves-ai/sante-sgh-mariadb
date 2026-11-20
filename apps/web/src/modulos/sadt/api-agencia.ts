// Cliente das telas da agência transfusional, etapa 2 (M47; chave `agencia.completa`, DP-21): a imuno-hematologia e a
// prova cruzada, o estoque de bolsas. As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a
// Idempotency-Key (o mesmo pedido reenviado não grava duas vezes). Problem Details viram ErroApi.
import type {
  AcaoBolsa,
  BolsaEstoqueLida,
  CadastrosDoEstoque,
  ExameImunoLancado,
  ImunoHematologiaLida,
  MovimentarBolsaEntrada,
  MovimentoBolsaLido,
  ReceberBolsaEntrada,
  RegistrarImunoHematologiaEntrada,
  RequisicaoTransfusionalLida,
  ResumoEstoque,
  SituacaoBolsaEstoque,
  TipagemDoReceptor,
  TipagemSanguinea,
  VersaoBolsaLida,
  CorrigirBolsaEntrada,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from '../enfermagem/api-enfermagem.js';

const B = '/api/sadt/agencia';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

const consulta = (f: Readonly<Record<string, string>>) => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== ''));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export interface GravacaoAgencia {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly acoes: {
    readonly registrar: boolean;
    readonly liberar: boolean;
    readonly receber: boolean;
    readonly movimentar: boolean;
    /** W0-03: corrigir a etiqueta, a validade e o volume antes do uso. */
    readonly corrigir?: boolean;
  };
}

export type BolsaComAcoes = BolsaEstoqueLida & { readonly acoes: readonly AcaoBolsa[] };
export type BolsaCandidata = BolsaEstoqueLida & {
  readonly compativel: boolean;
  readonly alertas: readonly string[];
};

export interface DetalheAgencia {
  readonly requisicao: RequisicaoTransfusionalLida;
  readonly receptor: TipagemDoReceptor;
  readonly resultados: readonly ImunoHematologiaLida[];
  readonly provas: readonly ImunoHematologiaLida[];
  readonly exames: readonly ExameImunoLancado[];
  readonly reservadas: readonly BolsaEstoqueLida[];
  readonly candidatas: readonly BolsaCandidata[];
  readonly agora: string;
  readonly gravacao: GravacaoAgencia;
}

export interface Gravado {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
  readonly repetida?: boolean;
  readonly alertas?: readonly string[];
  readonly problemas?: readonly string[];
  readonly tipagem?: TipagemSanguinea | null;
  readonly situacao?: SituacaoBolsaEstoque;
}

export const lerEstadoAgencia = (b?: typeof fetch) => ler<{ gravacao: GravacaoAgencia }>(`${B}/estado`, b);
export const lerRequisicoesAbertas = (b?: typeof fetch) =>
  ler<{ itens: RequisicaoTransfusionalLida[]; cortada: boolean; agora: string; gravacao: GravacaoAgencia }>(
    `${B}/requisicoes`,
    b,
  );
export const lerRequisicoesDoEstoque = (b?: typeof fetch) =>
  ler<{ itens: RequisicaoTransfusionalLida[]; cortada: boolean; agora: string }>(
    `${B}/estoque/requisicoes`,
    b,
  );
export const lerDetalheAgencia = (id: number, b?: typeof fetch) =>
  ler<DetalheAgencia>(`${B}/requisicoes/${id}`, b);
export const lerImunos = (f: Readonly<Record<string, string>>, b?: typeof fetch) =>
  ler<{ itens: ImunoHematologiaLida[]; cortada: boolean; agora: string; gravacao: GravacaoAgencia }>(
    `${B}/imuno${consulta(f)}`,
    b,
  );
export const registrarImuno = (
  e: RegistrarImunoHematologiaEntrada,
  chave = novaChave('imuno'),
  b?: typeof fetch,
) => enviar<Gravado>(`${B}/imuno`, e, chave, b);
export const liberarImuno = (id: number, chave = novaChave('imuno-liberar'), b?: typeof fetch) =>
  enviar<Gravado>(`${B}/imuno/${id}/liberar`, { conferido: true }, chave, b);
export const invalidarImuno = (
  id: number,
  motivo: string,
  chave = novaChave('imuno-invalidar'),
  b?: typeof fetch,
) => enviar<Gravado>(`${B}/imuno/${id}/invalidar`, { motivo }, chave, b);
export const lerEstoque = (f: Readonly<Record<string, string>>, b?: typeof fetch) =>
  ler<{
    itens: BolsaComAcoes[];
    cortada: boolean;
    resumo: ResumoEstoque[];
    agora: string;
    gravacao: GravacaoAgencia;
  }>(`${B}/bolsas${consulta(f)}`, b);
export const lerCadastrosDoEstoque = (b?: typeof fetch) =>
  ler<CadastrosDoEstoque>(`${B}/estoque/cadastros`, b);
export const lerBolsa = (id: number, b?: typeof fetch) =>
  ler<{
    bolsa: BolsaComAcoes;
    movimentos: MovimentoBolsaLido[];
    /** W0-03: as versões anteriores (a do recebimento primeiro). */
    versoes?: VersaoBolsaLida[];
    agora: string;
  }>(`${B}/bolsas/${id}`, b);
export const receberBolsa = (e: ReceberBolsaEntrada, chave = novaChave('bolsa'), b?: typeof fetch) =>
  enviar<Gravado>(`${B}/bolsas`, e, chave, b);
export const movimentarBolsa = (
  id: number,
  e: MovimentarBolsaEntrada,
  chave = novaChave('bolsa-mov'),
  b?: typeof fetch,
) => enviar<Gravado>(`${B}/bolsas/${id}/movimentos`, e, chave, b);
/** W0-03: corrigir a bolsa antes do uso (a versão anterior fica legível; depois do uso, 409). */
export const corrigirBolsa = (
  id: number,
  e: CorrigirBolsaEntrada,
  chave = novaChave('bolsa-corrigir'),
  b?: typeof fetch,
) =>
  enviar<{ ok: true; id: number; numero: string; versao: number; mensagem: string }>(
    `${B}/bolsas/${id}/corrigir`,
    e,
    chave,
    b,
  );
