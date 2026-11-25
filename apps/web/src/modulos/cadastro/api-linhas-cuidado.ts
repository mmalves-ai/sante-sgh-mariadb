// Cliente dos programas de saúde e linhas de cuidado (F8, 02-CAD linha 11). Respostas do linhas-cuidado.controller.ts
// da API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export type TipoEstado = 'incluido' | 'ativo' | 'suspenso' | 'alta' | 'abandono' | 'transferido' | 'obito';

export interface EntradaPrograma {
  codigo: string;
  descricao: string;
  codigoExterno: string | null;
  publicoAlvo: string | null;
  criterioEntrada: string | null;
  criterioSaida: string | null;
  faixaEtaria: number | null;
  exigeReferencia: boolean;
}
export interface Programa extends EntradaPrograma {
  id: number;
  ativo: boolean;
  versao: number;
  inscritosVivos: number;
  encerradas: number;
  porEstado: Partial<Record<TipoEstado, number>>;
}
export interface EstadoPrograma {
  id: number;
  codigo: string;
  descricao: string;
  tipo: TipoEstado;
  encerra: boolean;
  ativo: boolean;
}
export interface OpcoesProgramas {
  linhas: Programa[];
  estados: EstadoPrograma[];
  faixas: { id: number; descricao: string }[];
}
export interface Inscricao {
  id: number;
  linha: { id: number; codigo: string; descricao: string };
  estado: { id: number; descricao: string; tipo: TipoEstado };
  estadoDesde: string;
  referencia: { id: number; nome: string } | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  motivoSaida: string | null;
  encerrada: boolean;
  versao: number;
  proximos: number[];
  historico: { ocorridoEm: string; operacao: string; estado: string; usuario: string | null }[];
}
export interface Inscrito {
  inscricao: number;
  paciente: number;
  /** Paciente com acesso restrito (confidencial ou VIP) vem pelo pseudônimo. */
  nome: string;
  restrito: boolean;
  estado: string;
  tipo: TipoEstado;
  estadoDesde: string;
  vigenciaInicio: string;
  referencia: string | null;
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

const L = '/api/cadastros/linhas-cuidado';
const P = (paciente: number) => `/api/cadastros/pacientes/${paciente}/linhas-cuidado`;
type Gravado = { id: number };

export const lerProgramas = () => pedir<OpcoesProgramas>(L);
export const incluirPrograma = (e: EntradaPrograma) => pedir<Gravado>(L, 'POST', e);
export const alterarPrograma = (id: number, versao: number, ativo: boolean, e: EntradaPrograma) =>
  pedir<Gravado>(`${L}/${id}`, 'PUT', { ...e, versao, ativo });
export const lerInscritos = (id: number, todos: boolean) =>
  pedir<{ itens: Inscrito[] }>(`${L}/${id}/inscritos?${new URLSearchParams({ todos: todos ? '1' : '0' })}`);
export const lerInscricoes = (paciente: number) => pedir<{ itens: Inscricao[] }>(P(paciente));
export const inscrever = (
  paciente: number,
  e: { linha: number; referencia: number | null; vigenciaInicio: string },
) => pedir<Gravado>(P(paciente), 'POST', e);
export const mudarEstado = (
  paciente: number,
  id: number,
  e: { versao: number; estado: number; data: string; motivo: string | null },
) => pedir<{ id: number; encerrada: boolean }>(`${P(paciente)}/${id}/estado`, 'POST', e);
export const trocarReferencia = (
  paciente: number,
  id: number,
  e: { versao: number; referencia: number | null },
) => pedir<Gravado>(`${P(paciente)}/${id}/referencia`, 'PUT', e);
