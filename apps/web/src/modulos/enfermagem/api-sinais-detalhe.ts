// Cliente das rotas do detalhe da aferição e dos limites de alerta dos sinais vitais (03-PEP L115;
// sinais-detalhe.controller.ts). A gravação leva CSRF e a Idempotency-Key (uma por ato: repetir não grava duas vezes).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const E = '/api/enfermagem';

export interface CatalogosAfericao {
  parametros: {
    codigo: string;
    descricao: string;
    unidade: string | null;
    alertaMinimo: number | null;
    alertaMaximo: number | null;
    exibeLocal: boolean;
    exigeLocal: boolean;
    exibePosicao: boolean;
    exigePosicao: boolean;
  }[];
  instrumentos: { id: number; descricao: string; parametro: string | null; padrao: boolean }[];
  locais: { id: number; descricao: string }[];
  posicoes: { id: number; descricao: string }[];
  motivos: { id: number; descricao: string; exigeComplemento: boolean }[];
  setores: { id: number; nome: string }[];
}

export type NivelAlerta = 'normal' | 'atencao' | 'critico';

export interface ValorAfericaoLido {
  id: number;
  afericao: number;
  aferidoEm: string | null;
  tipo: string;
  descricao: string;
  unidade: string | null;
  valor: number | null;
  nivel: NivelAlerta | 'fora_faixa_plausivel' | null;
  instrumento: string | null;
  local: string | null;
  posicao: string | null;
  naoAferido: boolean;
  motivo: string | null;
  justificativa: string | null;
}

export interface ValorAfericaoEntrada {
  tipo: string;
  valor: number | null;
  instrumento: number | null;
  local: number | null;
  posicao: number | null;
  naoAferido: boolean;
  motivo: number | null;
  justificativa: string | null;
  confirmadoForaDaFaixa: boolean;
}

export interface AfericaoFeita {
  afericao: number;
  setor: number | null;
  valores: { id: number; tipo: string; nivel: NivelAlerta | null; limite: number | null }[];
  mensagem: string;
}

export interface LimiteSinal {
  id: number;
  parametro: string;
  parametroDescricao: string;
  estabelecimento: number | null;
  setor: number | null;
  setorNome: string | null;
  instrumento: number | null;
  instrumentoDescricao: string | null;
  sexo: 'ambos' | 'feminino' | 'masculino';
  idadeMinimaDias: number;
  idadeMaximaDias: number | null;
  limiteInferior: number | null;
  normalInferior: number | null;
  normalSuperior: number | null;
  limiteSuperior: number | null;
  ativo: boolean;
  versao: number;
}

export interface RegraSetorSinal {
  id: number;
  setor: number;
  setorNome: string;
  parametro: string;
  parametroDescricao: string;
  obrigatorio: boolean;
  periodicidadeMinutos: number | null;
  exibeLocal: boolean;
  exigeLocal: boolean;
  exibePosicao: boolean;
  exigePosicao: boolean;
  ativo: boolean;
  versao: number;
}

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function postar<T>(url: string, corpo: unknown, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': `sv-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const lerCatalogosAfericao = (b?: typeof fetch) =>
  ler<CatalogosAfericao>(`${E}/afericao/catalogos`, b);
export const lerAfericoes = (paciente: number, b?: typeof fetch) =>
  ler<{ paciente: number; itens: ValorAfericaoLido[] }>(`${E}/pacientes/${paciente}/afericoes`, b);
export const registrarAfericao = (
  paciente: number,
  corpo: {
    atendimento: number | null;
    horaReal: string | null;
    observacao: string | null;
    valores: ValorAfericaoEntrada[];
  },
  b?: typeof fetch,
) => postar<AfericaoFeita>(`${E}/pacientes/${paciente}/afericoes`, corpo, b);

export const lerLimites = (b?: typeof fetch) =>
  ler<{ limites: LimiteSinal[]; regras: RegraSetorSinal[] }>(`${E}/limites-sinais`, b);
export const incluirLimite = (
  corpo: Omit<
    LimiteSinal,
    | 'id'
    | 'parametroDescricao'
    | 'estabelecimento'
    | 'setorNome'
    | 'instrumentoDescricao'
    | 'ativo'
    | 'versao'
  > & {
    abrangencia: 'cliente' | 'estabelecimento';
  },
  b?: typeof fetch,
) => postar<{ id: number; mensagem: string }>(`${E}/limites-sinais`, corpo, b);
export const inativarLimite = (id: number, versao: number, motivo: string, b?: typeof fetch) =>
  postar<{ id: number; mensagem: string }>(`${E}/limites-sinais/${id}/inativacao`, { versao, motivo }, b);
export const aplicarPadraoNews2 = (b?: typeof fetch) =>
  postar<{ incluidos: string[]; jaTinha: string[]; semParametro: string[]; mensagem: string }>(
    `${E}/limites-sinais/padrao-news2`,
    {},
    b,
  );
export const gravarRegraSetor = (
  corpo: Omit<RegraSetorSinal, 'id' | 'setorNome' | 'parametroDescricao' | 'versao'> & {
    versao: number | null;
  },
  b?: typeof fetch,
) => postar<{ id: number; versao: number; mensagem: string }>(`${E}/limites-sinais/regras-setor`, corpo, b);
