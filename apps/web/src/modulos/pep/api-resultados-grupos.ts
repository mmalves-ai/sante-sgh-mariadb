// Cliente dos grupos comparativos de resultados e dos filtros salvos (F3.3, linha 03-PEP L128).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/pep/resultados';

export interface ItemGrupo {
  exame: number;
  nomeExame?: string;
  exameAnalito: number | null;
  nomeAnalito?: string | null;
  rotulo: string | null;
}
export interface Grupo {
  id: number | null;
  nome: string;
  tipoExame: 'laboratorio' | 'imagem' | 'outro';
  ordem: number;
  ativo: boolean;
  versao: number | null;
  itens: ItemGrupo[];
}
export interface ExameBusca {
  id: number;
  codigo: string;
  nome: string;
  analitos: { id: number; nome: string }[];
}
export interface Filtro {
  id: number | null;
  nome: string;
  padrao: boolean;
  escopo: 'atual' | 'todos';
  incluirPendentes: boolean;
  somenteLiberados: boolean;
  somenteMeusPedidos: boolean;
  periodoDias: number | null;
  grupos: number[];
  exames: number[];
  versao: number | null;
}
export type SituacaoCelula = 'normal' | 'abaixo' | 'acima' | 'critico' | 'sem-faixa';
export interface Celula {
  coluna: string;
  resultado: number;
  valor: string;
  numero: number | null;
  situacao: SituacaoCelula;
  preliminar: boolean;
}
export interface Linha {
  exame: number;
  analito: number;
  rotulo: string;
  unidade: string | null;
  faixa: string | null;
  celulas: Celula[];
  tendencia: 'subindo' | 'descendo' | 'estavel' | null;
  variacao: number | null;
}
export interface Comparativo {
  colunas: string[];
  linhas: Linha[];
  foraDaFaixa: number;
  criticos: number;
  filtroAplicado: { id: number; nome: string } | null;
  grupos: number[];
  periodoDias: number | null;
  pendentes: { exame: string; pedidoEm: string | null }[];
  recorte: 'atendimento' | 'todos' | 'sem-atendimento';
  atendimento: number | null;
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf': tokenCsrf() }),
    },
    ...(metodo === 'GET' || metodo === 'DELETE' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const lerGrupos = () => pedir<{ itens: Grupo[] }>(`${P}/grupos`);
export const gravarGrupo = (g: Grupo) =>
  pedir<{ id: number }>(`${P}/grupos`, 'PUT', {
    id: g.id,
    nome: g.nome,
    tipoExame: g.tipoExame,
    ordem: g.ordem,
    ativo: g.ativo,
    versao: g.versao,
    itens: g.itens.map((i) => ({ exame: i.exame, exameAnalito: i.exameAnalito, rotulo: i.rotulo })),
  });
export const buscarExames = (q: string) =>
  pedir<{ itens: ExameBusca[] }>(`${P}/exames?q=${encodeURIComponent(q)}`);
export const lerFiltros = () => pedir<{ itens: Filtro[] }>(`${P}/filtros`);
export const gravarFiltro = (f: Filtro) => pedir<{ id: number }>(`${P}/filtros`, 'PUT', f);
export const excluirFiltro = (id: number, versao: number) =>
  pedir<{ id: number }>(`${P}/filtros/${id}?versao=${versao}`, 'DELETE');
export function lerComparativo(
  paciente: number,
  q: { grupo?: number | null; filtro?: number | null; dias?: number | null; atendimento?: number | null },
): Promise<Comparativo> {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) u.set(k, String(v));
  return pedir<Comparativo>(`/api/pep/paciente/${paciente}/resultados/comparativo?${u.toString()}`);
}
