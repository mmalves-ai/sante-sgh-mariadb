// Cliente do paciente com acesso restrito ao prontuário (F8, 02-CAD linha 10). Respostas do
// acesso-restrito.controller.ts da API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export const TIPOS_MARCA = [
  'confidencial',
  'vip',
  'protecao_judicial',
  'vitima_violencia',
  'colaborador',
  'destaque',
] as const;
export const EXIBICOES = ['normal', 'iniciais', 'pseudonimo', 'oculto'] as const;

export interface LiberacaoVisao {
  id: number;
  versao: number;
  profissionalId: number | null;
  equipeId: number | null;
  destino: string;
  justificativa: string;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface MarcaVisao {
  id: number;
  versao: number;
  tipo: string;
  motivo: string;
  todosEstabelecimentos: boolean;
  exibicao: string;
  pseudonimo: string | null;
  exigeQuebraVidro: boolean;
  situacao: string;
  inicio: string;
  fim: string | null;
  viva: boolean;
  liberacoes: LiberacaoVisao[];
}
export interface VisaoAcessoRestrito {
  paciente: { id: number; nome: string; prontuario: string | null };
  marcas: MarcaVisao[];
}
export interface PacienteRestrito {
  paciente: number;
  nome: string;
  tipos: string[];
  liberacoes: number;
}
export interface EntradaMarca {
  todosEstabelecimentos: boolean;
  tipo: string;
  motivo: string;
  exibicao: string;
  pseudonimo: string | null;
  exigeQuebraVidro: boolean;
  inicio: string;
  fim: string | null;
}
export interface EntradaLiberacao {
  profissionalId: number | null;
  equipeId: number | null;
  justificativa: string;
  inicio: string;
  fim: string | null;
}
export interface Destinos {
  profissionais: { id: number; nome: string }[];
  equipes: { id: number; nome: string }[];
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

const C = '/api/cadastros';
type Gravado = { id: number };
export const lerRestritos = () => pedir<PacienteRestrito[]>(`${C}/acesso-restrito`);
export const lerAcessoRestrito = (paciente: number) =>
  pedir<VisaoAcessoRestrito>(`${C}/pacientes/${paciente}/acesso-restrito`);
export const buscarDestinos = (busca: string) =>
  pedir<Destinos>(`${C}/acesso-restrito/destinos?${new URLSearchParams({ busca })}`);
export const marcarPaciente = (paciente: number, e: EntradaMarca) =>
  pedir<Gravado>(`${C}/pacientes/${paciente}/acesso-restrito`, 'POST', e);
export const encerrarMarca = (marca: number, versao: number, motivo: string) =>
  pedir<Gravado>(`${C}/acesso-restrito/${marca}/encerrar`, 'POST', { versao, motivo });
export const liberarDestino = (marca: number, e: EntradaLiberacao) =>
  pedir<Gravado>(`${C}/acesso-restrito/${marca}/liberacoes`, 'POST', e);
export const revogarLiberacao = (id: number, versao: number) =>
  pedir<Gravado>(`${C}/acesso-restrito/liberacoes/${id}/revogar`, 'POST', { versao });

/** Faltas da marca na hora (a mesma regra do domínio; o servidor confere de novo). */
export function faltasMarca(e: EntradaMarca): string[] {
  const f: string[] = [];
  if (!e.tipo) f.push('tipo');
  if (e.motivo.trim().length < 10) f.push('motivo');
  if (e.exibicao === 'pseudonimo' && (e.pseudonimo ?? '').trim().length < 3) f.push('pseudonimo');
  if (!e.inicio) f.push('inicio');
  if (e.fim && e.fim < e.inicio) f.push('fim');
  return f;
}
/** Faltas da liberação na hora. */
export function faltasLiberacao(e: EntradaLiberacao): string[] {
  const f: string[] = [];
  if ((e.profissionalId === null) === (e.equipeId === null)) f.push('destino');
  if (e.justificativa.trim().length < 10) f.push('justificativa');
  if (!e.inicio) f.push('inicio');
  if (e.fim && e.fim < e.inicio) f.push('fim');
  return f;
}
