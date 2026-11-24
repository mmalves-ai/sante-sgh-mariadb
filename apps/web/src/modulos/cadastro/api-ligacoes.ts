// Cliente das ligações do cadastro (F3.1, 02-CAD linhas 17, 18 e 20): procedimentos e ocupações da especialidade,
// lotação do profissional e manutenção do solicitante externo. Respostas do cadastro-ligacoes.controller.ts da API;
// a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

export interface LigacoesEspecialidade {
  hoje: string;
  procedimentos: {
    id: number;
    versao: number;
    procedimento: number;
    codigo: string;
    descricao: string;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    vigente: boolean;
  }[];
  ocupacoes: {
    id: number;
    versao: number;
    ocupacao: number;
    codigo: string;
    descricao: string;
    principal: boolean;
  }[];
}
export interface Lotacao {
  id: number;
  versao: number;
  estabelecimentoNome: string;
  unidadeNome: string | null;
  ocupacaoCodigo: string;
  ocupacaoDescricao: string;
  tipoVinculoDescricao: string | null;
  cargaAmbulatorial: number;
  cargaHospitalar: number;
  cargaOutros: number;
  cargaSemanal: number;
  ocupacaoPadrao: boolean;
  atendeSus: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  vigente: boolean;
}
export interface OpcoesLigacoes {
  estabelecimentos: { id: number; nome: string }[];
  unidades: { id: number; estabelecimento: number; nome: string }[];
  tiposVinculo: { id: number; codigo: string; descricao: string }[];
  ocupacoes: { id: number; codigo: string; descricao: string }[];
  procedimentos: { id: number; codigo: string; descricao: string }[];
}
export interface Parecido {
  id: number;
  nome: string;
  registro: string;
  ativo: boolean;
  motivo: 'mesmo-registro' | 'mesmo-nome' | 'numero-proximo';
}
export interface FichaSolicitante {
  id: number;
  versao: number;
  nome: string;
  conselho: string;
  uf: string;
  numero: string;
  cpf: string | null;
  cns: string | null;
  ocupacao: number | null;
  ocupacaoCodigo: string | null;
  especialidade: number | null;
  instituicaoNome: string | null;
  instituicaoCnpj: string | null;
  instituicaoCnes: string | null;
  telefone: string | null;
  email: string | null;
  observacao: string | null;
  ativo: boolean;
  dataInativacao: string | null;
  faltaParaGuia: string[];
  parecidos: Parecido[];
  codigos: { id: number; versao: number; fonte: number; fonteNome: string; codigo: string; ativo: boolean }[];
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
export const lerOpcoesLigacoes = (termo = '') =>
  pedir<OpcoesLigacoes>(`${C}/ligacoes/opcoes${termo ? `?${new URLSearchParams({ termo })}` : ''}`);
export const lerLigacoesEspecialidade = (e: number) =>
  pedir<LigacoesEspecialidade>(`${C}/especialidades/${e}/ligacoes`);
export const incluirProcedimentoPermitido = (e: number, c: Record<string, unknown>) =>
  pedir<Gravado>(`${C}/especialidades/${e}/procedimentos-permitidos`, 'POST', c);
export const encerrarProcedimentoPermitido = (e: number, id: number, versao: number, fim: string | null) =>
  pedir<Gravado>(`${C}/especialidades/${e}/procedimentos-permitidos/${id}/encerrar`, 'POST', { versao, fim });
export const gravarOcupacaoEspecialidade = (e: number, ocupacao: number, principal: boolean) =>
  pedir<Gravado>(`${C}/especialidades/${e}/ocupacoes`, 'POST', { ocupacao, principal });
export const retirarOcupacaoEspecialidade = (e: number, id: number, versao: number) =>
  pedir<Gravado>(`${C}/especialidades/${e}/ocupacoes/${id}/retirar`, 'POST', { versao });
export const lerLotacoes = (p: number) =>
  pedir<{ hoje: string; itens: Lotacao[] }>(`${C}/profissionais/${p}/lotacoes`);
export const incluirLotacao = (p: number, c: Record<string, unknown>) =>
  pedir<Gravado>(`${C}/profissionais/${p}/lotacoes`, 'POST', c);
export const encerrarLotacao = (p: number, id: number, versao: number, fim: string | null) =>
  pedir<Gravado>(`${C}/profissionais/${p}/lotacoes/${id}/encerrar`, 'POST', { versao, fim });
export const lerParecidos = (q: { nome: string; conselho: string; uf: string; numero: string }) =>
  pedir<Parecido[]>(`${C}/solicitantes/parecidos?${new URLSearchParams(q)}`);
export const lerFichaSolicitante = (id: number) => pedir<FichaSolicitante>(`${C}/solicitantes/${id}/ficha`);
export const alterarSolicitante = (id: number, c: Record<string, unknown>) =>
  pedir<Gravado>(`${C}/solicitantes/${id}`, 'PUT', c);
export const mudarSituacaoSolicitante = (id: number, c: { versao: number; ativo: boolean; motivo: string }) =>
  pedir<Gravado>(`${C}/solicitantes/${id}/situacao`, 'POST', c);
export const gravarCodigoNaFonte = (id: number, c: { fonte: number; codigo: string; ativo: boolean }) =>
  pedir<Gravado>(`${C}/solicitantes/${id}/codigos`, 'POST', c);
