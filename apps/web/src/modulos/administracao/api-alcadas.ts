// Alçadas de aprovação (01-ADM L59, escopo do usuário): leitura do painel (documentos, perfis, regras com os níveis
// e, com o login, em quais níveis a conta aprova) e as gravações (criar ou alterar a regra; encerrar a vigência).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const A = '/api/administracao/alcadas';

export interface NivelAlcadaApi {
  readonly nivel: number;
  readonly perfil: string | null;
  readonly usuario: string | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
  readonly valorAcumuladoMaximo: number | null;
  readonly periodoAcumulado: string | null;
  readonly obrigatorio: boolean;
  readonly prazoHoras: number | null;
}

export interface AlcadaApi {
  readonly id: number;
  readonly versao: number;
  readonly documento: string;
  readonly documentoDescricao: string;
  readonly descricao: string;
  readonly modo: string;
  readonly quantidadeNiveis: number;
  readonly prazoHoras: number | null;
  readonly acaoPrazoVencido: string;
  readonly permiteAutoaprovacao: boolean;
  readonly exigeJustificativaRecusa: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly vigente: boolean;
  readonly pedidos: number;
  readonly niveis: NivelAlcadaApi[];
}

export interface AlcadaDoUsuarioApi {
  readonly alcada: number;
  readonly documento: string;
  readonly descricao: string;
  readonly nivel: number;
  readonly via: 'conta' | 'perfil';
  readonly perfil: string | null;
  readonly valorMinimo: number;
  readonly valorMaximo: number | null;
}

export interface PainelAlcadasApi {
  readonly documentos: { codigo: string; descricao: string }[];
  readonly perfis: { codigo: string; nome: string }[];
  readonly alcadas: AlcadaApi[];
  readonly doUsuario?: AlcadaDoUsuarioApi[];
}

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function gravar<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export async function buscarAlcadas(usuario?: string): Promise<PainelAlcadasApi> {
  const q = usuario ? `?usuario=${encodeURIComponent(usuario)}` : '';
  const r = await fetch(`${A}${q}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as PainelAlcadasApi;
}

export const gravarAlcada = (corpo: unknown) =>
  gravar<{ alcada: number; encerrada: number | null }>(A, corpo);
export const encerrarAlcadaApi = (id: number, versao: number, fim: string | null) =>
  gravar<{ alcada: number; acao: string }>(`${A}/${id}/encerrar`, { versao, fim });
