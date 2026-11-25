// Cliente do profissional provisório (F8, 02-CAD linha 21). Respostas do profissional-provisorio.controller.ts da API;
// a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export type SituacaoProvisorio = 'provisorio' | 'regularizado' | 'expirado' | 'cancelado';
export type EstadoPrazo = 'em_dia' | 'vence_logo' | 'vencido' | 'encerrado';
export type TipoUso = 'atendimento' | 'paciente' | 'agendamento_cirurgico' | 'agendamento_internacao';
export type FiltroProvisorios = 'abertos' | 'vencidos' | 'todos';

export interface EntradaProvisorio {
  nome: string;
  cpf: string | null;
  conselhoId: number | null;
  numeroConselho: string | null;
  ufConselhoId: number | null;
  motivo: string;
  dataInicio: string;
  prazo: string | null;
  telefone: string | null;
}
export interface ItemProvisorio {
  id: number;
  versao: number;
  nome: string;
  cpfInformado: boolean;
  conselhoId: number | null;
  conselhoSigla: string | null;
  numeroConselho: string | null;
  ufConselhoId: number | null;
  ufSigla: string | null;
  motivo: string;
  dataInicio: string;
  prazo: string;
  situacao: SituacaoProvisorio;
  estadoPrazo: EstadoPrazo;
  diasParaPrazo: number;
  profissionalId: number | null;
  usos: number;
  usosPendentes: number;
}
export interface VisaoProvisorios {
  hoje: string;
  prazoSugerido: string;
  itens: ItemProvisorio[];
  resumo: { abertos: number; vencidos: number; venceLogo: number };
  conselhos: { id: number; sigla: string; porUf: boolean }[];
  ufs: { id: number; sigla: string }[];
}
export interface DetalheProvisorio {
  usos: { id: number; sequencia: number; tipo: TipoUso; registroId: number; regularizado: boolean }[];
  candidatos: { id: number; nome: string; por: 'inscricao' | 'cpf' }[];
}

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const aceito = { accept: 'application/json' };
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: aceito }
      : {
          method: metodo,
          headers: {
            ...aceito,
            'content-type': 'application/json',
            'x-csrf': tokenCsrf(),
            'idempotency-key': chave(),
          },
          body: JSON.stringify(corpo ?? {}),
        },
  );
  if (!r.ok) throw await erroDaResposta(r);
  return objeto.parse(await r.json()) as T;
}

const C = '/api/cadastros/profissionais-provisorios';
type Gravado = { id: number };
export const lerProvisorios = (filtro: FiltroProvisorios) =>
  pedir<VisaoProvisorios>(`${C}?${new URLSearchParams({ filtro })}`);
export const lerDetalheProvisorio = (id: number) => pedir<DetalheProvisorio>(`${C}/${id}`);
export const criarProvisorio = (e: EntradaProvisorio) => pedir<Gravado>(C, 'POST', e);
export const ligarRegistro = (id: number, tipo: TipoUso, registroId: number) =>
  pedir<Gravado>(`${C}/${id}/usos`, 'POST', { tipo, registroId });
export const prorrogarProvisorio = (id: number, versao: number, prazo: string, motivo: string) =>
  pedir<Gravado>(`${C}/${id}/prazo`, 'POST', { versao, prazo, motivo });
export const regularizarProvisorio = (id: number, versao: number, profissional: number) =>
  pedir<{ id: number; usos: number; transferidos: number }>(`${C}/${id}/regularizar`, 'POST', {
    versao,
    profissional,
  });
export const cancelarProvisorio = (id: number, versao: number, motivo: string) =>
  pedir<Gravado>(`${C}/${id}/cancelar`, 'POST', { versao, motivo });
