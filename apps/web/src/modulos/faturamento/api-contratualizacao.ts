// Cliente da tela da contratualização SUS (M55, etapa 5; rotas em /api/faturamento/sus/contratualizacao). As leituras vêm
// tipadas pelos contratos; as gravações levam o CSRF e a Idempotency-Key, que vai também no corpo como `chave` (o mesmo
// pedido reenviado não grava duas vezes). A alteração vai pela versão vista (`versaoVista`); o encerramento não tem chave.
import type {
  ApuracaoSus,
  ContratoSus,
  FaixaCumprimentoSus,
  FonteProducaoSus,
  GravacaoAgenda,
  MetaSus,
  PainelContratualizacaoSus,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const C = '/api/faturamento/sus/contratualizacao';
const JSON_ACEITO = { accept: 'application/json' };

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveSus(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m55.e5.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
    0,
    80,
  );
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  metodo: 'POST' | 'PUT',
  url: string,
  corpo: Record<string, unknown>,
  chave: string | null,
): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    body: JSON.stringify(chave ? { ...corpo, chave } : corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface ItemDominioSusTela {
  readonly codigo: number;
  readonly rotulo: string;
  readonly sigla: string | null;
}

export interface InicioContratualizacao {
  readonly hoje: string;
  readonly competencia: string;
  readonly contratos: readonly ContratoSus[];
  readonly cortada: boolean;
  readonly dominios: Readonly<Record<string, readonly ItemDominioSusTela[]>>;
  readonly parametros: {
    readonly faixas: readonly FaixaCumprimentoSus[];
    readonly faixasValidas: boolean;
    readonly cnes: string | null;
    readonly conveniosSus: readonly number[];
  };
  readonly fonte: FonteProducaoSus;
  readonly gravacao: GravacaoAgenda;
}

export interface RequisitoContratoSus {
  readonly codigo: string;
  readonly mensagem: string;
}

export interface DetalheContratoSus {
  readonly contrato: ContratoSus;
  readonly metas: readonly MetaSus[];
  readonly apuracoes: readonly ApuracaoSus[];
  readonly requisitos: readonly RequisitoContratoSus[];
}

export interface ResultadoGravacaoSus {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly repetida: boolean;
  readonly mensagem: string;
}

export const lerContratualizacao = () => ler<InicioContratualizacao>(C);
export const lerContratoSus = (id: number) => ler<DetalheContratoSus>(`${C}/contratos/${id}`);
export const lerPainelSus = (id: number, competencia: string) =>
  ler<PainelContratualizacaoSus>(
    `${C}/contratos/${id}/painel?${new URLSearchParams({ competencia }).toString()}`,
  );
export const buscarSigtapMeta = (termo: string) =>
  ler<{ itens: { codigo: string; nome: string }[] }>(
    `${C}/sigtap?${new URLSearchParams({ termo }).toString()}`,
  );

export const criarContratoSus = (corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoGravacaoSus>('POST', `${C}/contratos`, corpo, chave);
export const alterarContratoSus = (id: number, corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoGravacaoSus>('PUT', `${C}/contratos/${id}`, corpo, chave);
export const encerrarContratoSus = (id: number, corpo: { versaoVista: number; motivo: string }) =>
  enviar<ResultadoGravacaoSus>('POST', `${C}/contratos/${id}/encerramento`, corpo, null);
export const criarMetaSus = (contrato: number, corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoGravacaoSus>('POST', `${C}/contratos/${contrato}/metas`, corpo, chave);
export const alterarMetaSus = (id: number, corpo: Record<string, unknown>, chave: string) =>
  enviar<ResultadoGravacaoSus>('PUT', `${C}/metas/${id}`, corpo, chave);
export const apurarMetaSus = (
  meta: number,
  corpo: {
    competencia: string;
    realizado: number | null;
    observacao: string | null;
    /** A versão da apuração já registrada: com ela o servidor corrige a apuração em vez de recusá-la. */
    versaoVista: number | null;
  },
  chave: string,
) => enviar<ResultadoGravacaoSus>('POST', `${C}/metas/${meta}/apuracoes`, corpo, chave);
