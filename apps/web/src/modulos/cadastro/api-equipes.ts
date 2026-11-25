// Cliente das equipes médicas e cooperativas do profissional (F8, 02-CAD linha 22). Respostas do
// equipes-cooperativas.controller.ts da API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export interface VinculoVisao {
  id: number;
  versao: number;
  profissionalId: number;
  profissionalNome: string;
  papel: string | null;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface EntradaEquipe {
  id: number | null;
  versao: number | null;
  codigo: string;
  nome: string;
  tipo: string;
  setorId: number | null;
  inicio: string;
  fim: string | null;
  ativo: boolean;
}
export interface EquipeVisao extends Omit<EntradaEquipe, 'id' | 'versao'> {
  id: number;
  versao: number;
  setorNome: string | null;
  responsavelId: number | null;
  membros: VinculoVisao[];
}
export interface EntradaCooperativa {
  id: number | null;
  versao: number | null;
  cnpj: string;
  razaoSocial: string;
  nome: string;
  percentualRepasse: number | null;
  bancoId: number | null;
  agencia: string | null;
  agenciaDigito: string | null;
  conta: string | null;
  contaDigito: string | null;
  tipoConta: string | null;
  retemIr: boolean;
  aliquotaIr: number | null;
  aliquotaIss: number | null;
  aliquotaPis: number | null;
  aliquotaCofins: number | null;
  aliquotaCsll: number | null;
  optanteSimples: boolean;
  ativo: boolean;
}
export interface CooperativaVisao extends Omit<EntradaCooperativa, 'id' | 'versao'> {
  id: number;
  versao: number;
  cooperados: VinculoVisao[];
}
export interface VisaoEquipes {
  hoje: string;
  profissional: { id: number; nome: string } | null;
  equipes: EquipeVisao[];
  cooperativas: CooperativaVisao[];
  setores: { id: number; nome: string }[];
  bancos: { id: number; nome: string }[];
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

const C = '/api/cadastros/equipes-cooperativas';
type Gravado = { id: number };
export const lerEquipes = (profissional: number | null) =>
  pedir<VisaoEquipes>(
    profissional ? `${C}?${new URLSearchParams({ profissional: String(profissional) })}` : C,
  );
export const buscarProfissionais = (busca: string) =>
  pedir<{ id: number; nome: string }[]>(`${C}/profissionais?${new URLSearchParams({ busca })}`);
export const salvarEquipe = (e: EntradaEquipe) => pedir<Gravado>(`${C}/equipes`, 'POST', e);
export const incluirMembro = (
  equipe: number,
  e: { profissionalId: number; papel: string; inicio: string; fim: string | null },
) => pedir<Gravado>(`${C}/equipes/${equipe}/membros`, 'POST', e);
export const encerrarMembro = (id: number, versao: number, fim: string) =>
  pedir<Gravado>(`${C}/membros/${id}/encerrar`, 'POST', { versao, fim });
export const salvarCooperativa = (e: EntradaCooperativa) => pedir<Gravado>(`${C}/cooperativas`, 'POST', e);
export const incluirCooperado = (
  cooperativa: number,
  e: { profissionalId: number; inicio: string; fim: string | null },
) => pedir<Gravado>(`${C}/cooperativas/${cooperativa}/cooperados`, 'POST', e);
export const encerrarCooperado = (id: number, versao: number, fim: string) =>
  pedir<Gravado>(`${C}/cooperados/${id}/encerrar`, 'POST', { versao, fim });
