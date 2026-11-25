// Cliente da identidade do estabelecimento (F3.1, 02-CAD linha 26): logotipos e mantenedora. Respostas do
// identidade-estabelecimento.controller.ts da API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);
const chave = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

export interface Logotipo {
  id: number;
  versao: number;
  sequencia: number;
  finalidade: string;
  largura: number | null;
  altura: number | null;
  cabecalhoRelatorio: string | null;
  rodapeRelatorio: string | null;
  imprimeEmRelatorio: boolean;
  ativo: boolean;
  enviadoEm: string | null;
  nomeOriginal: string;
  tipoMime: string;
  tamanho: number;
}
export interface Mantenedora {
  id: number;
  versao: number;
  codigo: string;
  ativo: boolean;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  naturezaJuridica: number | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  nire: string | null;
  dataRegistroNire: string | null;
  registroCivil: string | null;
  dataRegistroCivil: string | null;
  cnaePrincipal: string | null;
  registroAns: string | null;
  optanteSimples: boolean;
  filantropica: boolean;
  incentivoCultural: boolean;
  tipoDeclarante: string | null;
  responsavel: number | null;
  responsavelNome: string | null;
  contador: number | null;
  contadorNome: string | null;
  contadorCrc: string | null;
  site: string | null;
  estabelecimentos: number;
}
export interface Identidade {
  estabelecimento: number;
  logotipos: Logotipo[];
  mantenedora: Mantenedora | null;
  mantenedoras: Mantenedora[];
  opcoes: {
    finalidades: string[];
    tiposDeclarante: string[];
    naturezas: { id: number; descricao: string }[];
  };
}
export type Corpo = Record<string, unknown>;
type Gravado = { id: number };

const E = '/api/cadastros/estrutura-gestao';
export const CHAVE_IDENTIDADE = ['cadastro', 'estrutura-gestao', 'identidade'] as const;

export const lerIdentidade = () => pedir<Identidade>(`${E}/identidade`);
export const pessoaPorCpf = (cpf: string) =>
  pedir<{ pessoa: { id: number; nome: string } | null }>(
    `${E}/identidade/pessoa?cpf=${encodeURIComponent(cpf)}`,
  );
export const imagemLogotipo = (id: number) =>
  pedir<{ tipo: string; conteudo: string }>(`${E}/logotipos/${id}/imagem`);
export const enviarLogotipo = (c: Corpo) => pedir<{ ids: number[] }>(`${E}/logotipos`, 'POST', c);
export const alterarLogotipo = (id: number, c: Corpo) => pedir<Gravado>(`${E}/logotipos/${id}`, 'PUT', c);
export const excluirLogotipo = (id: number, c: Corpo) =>
  pedir<Gravado>(`${E}/logotipos/${id}/excluir`, 'POST', c);
export const gravarMantenedora = (id: number | null, c: Corpo) =>
  pedir<Gravado>(id ? `${E}/mantenedoras/${id}` : `${E}/mantenedoras`, id ? 'PUT' : 'POST', c);
export const situacaoMantenedora = (id: number, c: Corpo) =>
  pedir<Gravado>(`${E}/mantenedoras/${id}/situacao`, 'POST', c);
export const ligarMantenedora = (c: Corpo) => pedir<Gravado>(`${E}/mantenedora-ligada`, 'POST', c);

/** CNPJ com os dígitos verificadores (a mesma regra do domínio volta da API se passar). */
export function cnpjConfere(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (b: string) => {
    let s = 0;
    let p = b.length - 7;
    for (const x of b) {
      s += Number(x) * p;
      p = p === 2 ? 9 : p - 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return c.endsWith(`${d1}${dv(c.slice(0, 12) + d1)}`);
}
