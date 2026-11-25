// Login único corporativo (01-ADM L61): a entrada pelo provedor de identidade do hospital (público) e o cadastro do
// provedor, do perfil por grupo e dos vínculos (gestor de acessos). O segredo do provedor nunca passa por aqui: o
// cadastro guarda só a referência no cofre.
import type { Sessao } from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const A = '/api/acesso/provedores-identidade';

export interface ProvedorIdentidade {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly protocolo: string;
  readonly urlServidor: string;
  readonly dominio: string | null;
  readonly basePesquisa: string | null;
  readonly filtroUsuario: string | null;
  readonly emissor: string | null;
  readonly clienteIdentificador: string | null;
  readonly referenciaCofre: string | null;
  readonly atributoLogin: string;
  readonly atributoEmail: string | null;
  readonly atributoGrupo: string | null;
  readonly criaContaAutomatica: boolean;
  readonly sincronizaPerfis: boolean;
  readonly prioridade: number;
  readonly ativo: boolean;
  readonly soEsteEstabelecimento: boolean;
  readonly entradaLigada: boolean;
  readonly vinculosAtivos: number;
  readonly gruposAtivos: number;
}
export interface GrupoProvedor {
  readonly id: number;
  readonly versao: number;
  readonly grupoExterno: string;
  readonly perfil: string;
  readonly soEsteEstabelecimento: boolean;
  readonly ativo: boolean;
}
export interface VinculoProvedor {
  readonly id: number;
  readonly versao: number;
  readonly login: string;
  readonly identificador: string;
  readonly email: string | null;
  readonly vinculadoEm: string | null;
  readonly ultimoUsoEm: string | null;
  readonly ativo: boolean;
}
/** Gravação do provedor: sem id e versão é inclusão. */
export type ProvedorEntrada = {
  [K in keyof Omit<ProvedorIdentidade, 'entradaLigada' | 'vinculosAtivos' | 'gruposAtivos'>]?:
    ProvedorIdentidade[K] | undefined;
};

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: corpo === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(corpo === undefined
        ? {}
        : { 'content-type': 'application/json', 'x-csrf': tokenCsrf(), 'idempotency-key': chave() }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const listarProvedores = () => pedir<ProvedorIdentidade[]>(A);
export const gravarProvedor = (p: ProvedorEntrada) => pedir<{ id: number; versao: number }>(A, p);
export const listarGrupos = (id: number) => pedir<GrupoProvedor[]>(`${A}/${id}/grupos`);
export const incluirGrupo = (
  id: number,
  g: { grupoExterno: string; perfil: string; soEsteEstabelecimento: boolean },
) => pedir<{ id: number }>(`${A}/${id}/grupos`, g);
export const desativarGrupo = (g: GrupoProvedor) =>
  pedir(`${A}/grupos/${g.id}/desativar`, { versao: g.versao });
export const listarVinculos = (id: number) => pedir<VinculoProvedor[]>(`${A}/${id}/vinculos`);
export const ligarVinculo = (
  id: number,
  v: { login: string; identificador: string; email?: string | null },
) => pedir<{ id: number }>(`${A}/${id}/vinculos`, v);
export const alternarVinculo = (v: VinculoProvedor) =>
  pedir(`${A}/vinculos/${v.id}/${v.ativo ? 'desligar' : 'religar'}`, { versao: v.versao });

// Entrada (pública).
export async function provedoresDaEntrada(
  estabelecimento: string,
): Promise<{ codigo: string; nome: string }[]> {
  try {
    const r = await pedir<{ provedores: { codigo: string; nome: string }[] }>(
      `/api/sessao/provedores?estabelecimento=${encodeURIComponent(estabelecimento)}`,
    );
    return r.provedores;
  } catch {
    return [];
  }
}
export const iniciarEntradaProvedor = (estabelecimento: string, provedor: string) =>
  pedir<{ url: string }>('/api/sessao/provedor/inicio', { estabelecimento, provedor });
export const concluirEntradaProvedor = (
  estado: string,
  codigo: string | undefined,
  codigoSegundoFator?: string,
) =>
  pedir<Sessao>('/api/sessao/provedor/retorno', {
    estado,
    ...(codigo ? { codigo } : {}),
    ...(codigoSegundoFator ? { codigoSegundoFator } : {}),
  });
