// Cliente da aba SLA do contrato com fornecedor (09-AREA linha 88): a leitura dos SLAs com faixas, medições e apurações,
// a prévia da apuração (sem gravar) e as gravações (SLA novo, encerramento, medição, apuração) com o CSRF e a
// Idempotency-Key (o mesmo pedido reenviado não grava duas vezes).
import type {
  ApuracaoSla,
  FaixaSlaEntrada,
  MedicaoSlaEntrada,
  SlaContratoEntrada,
  TipoRegraSla,
  UnidadeSla,
} from '@sgh/dominio-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface MedicaoSlaTela extends MedicaoSlaEntrada {
  readonly id: number;
  readonly medido: number | null;
  readonly usuario: string | null;
}

export interface ApuracaoSlaTela {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly desempenho: number;
  readonly faixa: string | null;
  readonly glosa: number;
  readonly multa: number;
  readonly total: number;
  readonly parcelas: string[];
  readonly usuario: string | null;
  readonly em: string;
}

export interface SlaTela {
  readonly id: number;
  readonly versao: number;
  readonly servico: number | null;
  readonly servicoDescricao: string | null;
  readonly descricao: string;
  readonly tipoRegra: TipoRegraSla;
  readonly unidade: UnidadeSla;
  readonly meta: number;
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly somenteDiasUteis: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly vigente: boolean;
  readonly faixas: FaixaSlaEntrada[];
  readonly medicoes: MedicaoSlaTela[];
  readonly apuracoes: ApuracaoSlaTela[];
}

export interface PainelSlaTela {
  readonly hoje: string;
  readonly agora: string;
  readonly contrato: { id: number; situacao: string; inicio: string; fim: string | null };
  readonly slas: SlaTela[];
  readonly servicos: { id: number; codigo: string; descricao: string }[];
}

const base = (contrato: number) => `/api/suprimentos/contratos/${contrato}/sla`;

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown, chave: string): Promise<T> {
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
  return (await r.json()) as T;
}

export const lerPainelSla = (contrato: number) => ler<PainelSlaTela>(base(contrato));

export function previaApuracaoSla(
  contrato: number,
  sla: number,
  p: { inicio: string; fim: string; valorFatura: number | null },
): Promise<ApuracaoSla> {
  const q = new URLSearchParams({ inicio: p.inicio, fim: p.fim });
  if (p.valorFatura !== null) q.set('valorFatura', String(p.valorFatura));
  return ler<ApuracaoSla>(`${base(contrato)}/${sla}/previa?${q.toString()}`);
}

export const gravarSlaTela = (contrato: number, e: SlaContratoEntrada, chave = novaChaveContrato('sla')) =>
  enviar<{ id: number; fechados: number[]; mensagem: string }>(base(contrato), e, chave);

export const encerrarSlaTela = (
  contrato: number,
  sla: number,
  fim: string,
  versao: number,
  chave = novaChaveContrato('sla-fim'),
) =>
  enviar<{ id: number; mensagem: string }>(`${base(contrato)}/${sla}/encerramento`, { fim, versao }, chave);

export const medirSlaTela = (
  contrato: number,
  sla: number,
  m: MedicaoSlaEntrada,
  chave = novaChaveContrato('sla-medicao'),
) =>
  enviar<{ id: number; medido: number | null; mensagem: string }>(
    `${base(contrato)}/${sla}/medicoes`,
    m,
    chave,
  );

export const apurarSlaTela = (
  contrato: number,
  sla: number,
  p: { inicio: string; fim: string; valorFatura: number | null },
  chave = novaChaveContrato('sla-apuracao'),
) => enviar<ApuracaoSlaTela & { mensagem: string }>(`${base(contrato)}/${sla}/apuracoes`, p, chave);
