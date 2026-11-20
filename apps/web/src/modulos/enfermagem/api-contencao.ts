// W0-03, mercado M5: cliente da tela da contenção mecânica. As leituras vêm tipadas pelos contratos; as gravações
// levam o CSRF e a Idempotency-Key. Problem Details viram ErroApi (o código da recusa em `problema.codigo`).
import type {
  ChecagemContencaoEntrada,
  ContencaoLida,
  ContencoesDaUnidade,
  IndicadorContencaoResposta,
  OrdemContencaoEntrada,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-enfermagem.js';

const C = '/api/enfermagem/contencao';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('contencao'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

interface Feito {
  readonly ok: true;
  readonly mensagem: string;
}

export const lerContencoesDaUnidade = (unidade: string) =>
  ler<ContencoesDaUnidade>(`${C}/unidade?unidade=${encodeURIComponent(unidade)}`);
export const lerHistoricoContencao = (atendimento: number) =>
  ler<{ atendimento: number; agora: string; ordens: ContencaoLida[] }>(`${C}/atendimentos/${atendimento}`);
export const lerIndicadorContencao = (unidade: string, de: string, ate: string) =>
  ler<IndicadorContencaoResposta>(
    `${C}/indicador?unidade=${encodeURIComponent(unidade)}&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
  );
export const prescreverContencao = (e: OrdemContencaoEntrada) =>
  enviar<Feito & { id: number; horarios: string[] }>(C, e);
export const renovarContencao = (id: number, e: OrdemContencaoEntrada) =>
  enviar<Feito & { id: number; horarios: string[] }>(`${C}/${id}/renovar`, e);
export const checarContencao = (id: number, previsto: string, e: ChecagemContencaoEntrada) =>
  enviar<Feito>(`${C}/${id}/checagens`, { previsto, ...e });
export const retirarContencao = (id: number, motivo: string) =>
  enviar<Feito>(`${C}/${id}/retirar`, { motivo });
export const inativarContencao = (id: number, motivo: string, senha: string) =>
  enviar<Feito>(`${C}/${id}/inativar`, { motivo, senha });
/** Revisão W0-03: o adendo da checagem (só do autor; a original continua visível). */
export const adendoChecagemContencao = (
  id: number,
  e: {
    previsto: string;
    achados: Record<string, 'normal' | 'alterado'>;
    observacao?: string;
    motivo: string;
  },
) => enviar<Feito>(`${C}/${id}/checagens/adendo`, e);
