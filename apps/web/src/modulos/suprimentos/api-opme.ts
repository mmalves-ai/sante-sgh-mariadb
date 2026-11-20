// Cliente das telas do OPME (M46, etapa 3: solicitações e etapas, consumo em sala com a etiqueta, conciliação com a
// conta e rastreio reverso). As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a Idempotency-Key, que
// vai também no corpo como `chave` (o mesmo pedido reenviado não grava duas vezes).
import type {
  ConciliacaoOpme,
  ConsumoOpmeRegistrado,
  ContextoConsumoOpme,
  EtiquetaOpme,
  GravacaoAgenda,
  ItemOpme,
  RastreioReversoOpme,
  SolicitacaoOpme,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const O = '/api/suprimentos/opme';
const JSON_ACEITO = { accept: 'application/json' };

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveOpme(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m46.opme.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
    0,
    80,
  );
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function gravar<T>(url: string, corpo: Record<string, unknown>, chave: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify({ ...corpo, chave }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export interface ResultadoOpme {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}

export interface CirurgiaOpme {
  readonly agendamento: number;
  readonly sala: number;
  readonly inicio: string;
  readonly atendimento: number;
  readonly paciente: string;
  readonly procedimento: string | null;
  readonly solicitacoes: number;
  readonly consumos: number;
}

export const lerSolicitacoesOpme = (de: string | null, ate: string | null) =>
  ler<{
    de: string;
    ate: string;
    solicitacoes: SolicitacaoOpme[];
    cortada: boolean;
    gravacao: GravacaoAgenda;
  }>(`${O}${qs({ de, ate })}`);
export const lerCirurgiasOpme = (data: string | null) =>
  ler<{
    data: string;
    truncado: boolean;
    cirurgias: CirurgiaOpme[];
    locais: { codigo: number; nome: string }[];
    localSugerido: number | null;
    gravacao: GravacaoAgenda;
  }>(`${O}/cirurgias${qs({ data })}`);
export const buscarFornecedoresOpme = (termo: string) =>
  ler<{ itens: { codigo: number; nome: string }[]; cortada: boolean }>(`${O}/fornecedores${qs({ termo })}`);
export const buscarItensOpme = (termo: string, local: number | null) =>
  ler<{ itens: ItemOpme[]; cortada: boolean }>(`${O}/itens${qs({ termo, local })}`);
export const solicitarOpme = (corpo: Record<string, unknown>, chave = novaChaveOpme('solicitar')) =>
  gravar<ResultadoOpme>(O, corpo, chave);
export const avancarEtapaOpme = (
  id: number,
  corpo: Record<string, unknown>,
  chave = novaChaveOpme('etapa'),
) => gravar<ResultadoOpme>(`${O}/${id}/etapas`, { solicitacao: id, ...corpo }, chave);
export const lerConsumoOpme = (agenda: number) => ler<ContextoConsumoOpme>(`${O}/cirurgias/${agenda}`);
export const consumirOpme = (
  agenda: number,
  corpo: Record<string, unknown>,
  chave = novaChaveOpme('consumo'),
) =>
  gravar<ConsumoOpmeRegistrado>(
    `${O}/cirurgias/${agenda}/consumos`,
    { agendamento: agenda, ...corpo },
    chave,
  );
export const devolverOpme = (
  agenda: number,
  corpo: Record<string, unknown>,
  chave = novaChaveOpme('devolucao'),
) => gravar<ResultadoOpme>(`${O}/cirurgias/${agenda}/devolucoes`, { agendamento: agenda, ...corpo }, chave);
export const lerEtiquetaOpme = (consumo: number) => ler<EtiquetaOpme>(`${O}/consumos/${consumo}/etiqueta`);
export const lerConciliacaoOpme = (de: string | null, ate: string | null) =>
  ler<ConciliacaoOpme>(`${O}/conciliacao${qs({ de, ate })}`);
export const lerRastreioReversoOpme = (f: {
  item: number | null;
  lote: string | null;
  serie: string | null;
  registroAnvisa: string | null;
}) => ler<RastreioReversoOpme>(`${O}/rastreio${qs(f)}`);
