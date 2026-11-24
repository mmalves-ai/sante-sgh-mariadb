// Cliente das rotas dos vínculos do paciente (F3.1): cobertura permanente, captação e pré-cadastro da marcação.
// As respostas são as do controlador da API (paciente-vinculos.controller.ts); a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const objeto = z.record(z.string(), z.unknown());

export interface Opcoes {
  fontes: { id: number; nome: string; particular: boolean; exigeValidade: boolean }[];
  planos: { id: number; fontePagadora: number; descricao: string }[];
  tiposIndicacao: { id: number; descricao: string; exigeProfissional: boolean; exigeComplemento: boolean }[];
  parentescos: { id: number; descricao: string }[];
  canais: string[];
}
export interface Carteira {
  id: number;
  fontePagadora: { id: number; nome: string };
  plano: { id: number; nome: string } | null;
  numeroCarteira: string | null;
  validade: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  titular: boolean;
  titularNome: string | null;
  principal: boolean;
  situacaoNoDia: 'vigente' | 'a_vencer' | 'vencida' | 'encerrada' | 'futura';
  versao: number;
}
export interface Coberturas {
  hoje: string;
  itens: Carteira[];
  proposta: number | null;
  avisos: { id: number; codigo: string; mensagem: string }[];
}
export interface Captacao {
  id: number;
  captadoEm: string;
  canal: string;
  tipoIndicacao: { id: number; descricao: string };
  indicador: string | null;
  campanha: string | null;
  situacao: string;
}
export interface IndicadorOrigem {
  total: number;
  porCanal: { canal: string; total: number }[];
  porTipo: { id: number; descricao: string; total: number }[];
}
export interface PreCadastro {
  id: number;
  nome: string;
  nascimento: string;
  celular: string | null;
  telefone: string | null;
  situacao: string;
  paciente: number | null;
  marcacoes: number;
}
export interface PreviaConversao {
  acao: 'vincular' | 'cadastrar' | 'recusar';
  paciente: number | null;
  codigo: string | null;
  mensagem: string | null;
  /** O que diverge entre o paciente escolhido e o pré-cadastro (cpf, nascimento, nome). */
  divergencias: string[];
  rascunho: Record<string, unknown> | null;
}

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: JSON_ACEITO }
      : {
          method: metodo,
          headers: {
            ...JSON_ACEITO,
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
export const lerOpcoes = () => pedir<Opcoes>(`${C}/vinculos/opcoes`);
export const lerCoberturas = (p: number) => pedir<Coberturas>(`${C}/pacientes/${p}/coberturas`);
export const incluirCobertura = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/coberturas`, 'POST', c);
export const alterarCobertura = (p: number, id: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/coberturas/${id}`, 'PUT', c);
export const encerrarCobertura = (p: number, id: number, versao: number, motivo: string) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/coberturas/${id}/encerrar`, 'POST', { versao, motivo });
export const lerCaptacoes = (p: number) => pedir<{ itens: Captacao[] }>(`${C}/pacientes/${p}/captacoes`);
export const registrarCaptacao = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/captacoes`, 'POST', c);
export const lerIndicadorOrigem = (de: string, ate: string) =>
  pedir<IndicadorOrigem>(`${C}/captacoes/indicador?${new URLSearchParams({ de, ate })}`);
export const lerPreCadastros = (situacao: string, termo: string) =>
  pedir<{ itens: PreCadastro[] }>(
    `${C}/pre-cadastros?${new URLSearchParams({ ...(situacao ? { situacao } : {}), ...(termo ? { termo } : {}) })}`,
  );
export const registrarPreCadastro = (c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pre-cadastros`, 'POST', c);
export const previaConversao = (id: number, paciente?: number) =>
  pedir<PreviaConversao>(`${C}/pre-cadastros/${id}/conversao${paciente ? `?paciente=${paciente}` : ''}`);
export const converterPreCadastro = (id: number, paciente?: number, motivoDivergencia?: string) =>
  pedir<{ paciente: number; marcacoes: number; cobertura: number | null }>(
    `${C}/pre-cadastros/${id}/converter`,
    'POST',
    { ...(paciente ? { paciente } : {}), ...(motivoDivergencia ? { motivoDivergencia } : {}) },
  );
export const cancelarPreCadastro = (id: number, motivo: string) =>
  pedir<{ id: number }>(`${C}/pre-cadastros/${id}/cancelar`, 'POST', { motivo });
