// Regra própria do plano da fonte pagadora na recepção (02-CAD linha 24): as fontes, as regras de uma fonte (todas as
// vigências, com planos e categorias), a gravação por ação (incluir ou encerrar, com a chave de idempotência) e a
// prévia da crítica que a abertura do atendimento aplica.
import { PENDENCIAS_PLANO } from '@sgh/dominio-recepcao';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/atendimento/regras-plano';

const opcao = z.object({ id: z.number(), rotulo: z.string() });
export type OpcaoRegraPlano = z.infer<typeof opcao>;

const regra = z.object({
  id: z.number(),
  versao: z.number(),
  fontePagadoraId: z.number(),
  planoId: z.number().nullable(),
  categoriaId: z.number().nullable(),
  estabelecimentoId: z.number().nullable(),
  // 02-REC linha 37: a regra pode valer só numa especialidade, num serviço ou num setor.
  especialidadeId: z.number().nullable().default(null),
  servicoId: z.number().nullable().default(null),
  setorId: z.number().nullable().default(null),
  exigeCarteira: z.boolean(),
  exigeValidadeCarteira: z.boolean(),
  exigeTitular: z.boolean(),
  exigeGuia: z.boolean(),
  exigeSenhaAutorizacao: z.boolean(),
  exigeCodigoValidacao: z.boolean(),
  tamanhoCarteira: z.number().nullable(),
  prefixoCarteira: z.string().nullable(),
  permiteDependentes: z.boolean(),
  prazoRetornoDias: z.number().nullable(),
  documentosExigidos: z.array(z.string()),
  orientacaoRecepcao: z.string().nullable(),
  tetoAtendimentos: z.number().nullable(),
  tetoPeriodoDias: z.number().nullable(),
  tetoBloqueia: z.boolean(),
  pendencia: z.enum(PENDENCIAS_PLANO),
  pendenciaMotivo: z.string().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  vigente: z.boolean(),
});
export type RegraPlanoTela = z.infer<typeof regra>;

export const esquemaRegrasPlanoDaFonte = z.object({
  fonte: opcao,
  hoje: z.string(),
  planos: z.array(opcao),
  categorias: z.array(opcao),
  especialidades: z.array(opcao).default([]),
  servicos: z.array(opcao).default([]),
  setores: z.array(opcao).default([]),
  regras: z.array(regra),
});
export type RegrasPlanoDaFonteTela = z.infer<typeof esquemaRegrasPlanoDaFonte>;

const critica = z.object({ codigo: z.string(), campo: z.string(), mensagem: z.string() });
export const esquemaCriticaPlano = z.object({
  bloqueios: z.array(critica),
  alertas: z.array(critica),
  documentos: z.array(z.string()),
  orientacao: z.string().nullable(),
  regraId: z.number().nullable(),
  atendimentosNoPeriodo: z.number(),
});
export type CriticaPlanoTela = z.infer<typeof esquemaCriticaPlano>;

const esquemaGravacao = z
  .object({
    ok: z.boolean(),
    mensagem: z.string().optional(),
    repetida: z.boolean().optional(),
    resultado: z.object({ id: z.number(), versao: z.number() }).passthrough(),
  })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}

const ler = { headers: { accept: 'application/json' } };
const postar = (corpo: unknown, chave?: string): RequestInit => ({
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-csrf': tokenCsrf(),
    ...(chave ? { 'idempotency-key': chave } : {}),
  },
  body: JSON.stringify(corpo),
});

export const lerFontesRegraPlano = async () => json(await fetch(`${P}/fontes`, ler), z.array(opcao));
/** 02-REC linha 37: os serviços para a abertura (a regra do plano pode valer só num serviço). */
export const lerServicosAbertura = async () => json(await fetch(`${P}/servicos`, ler), z.array(opcao));

export const lerRegrasPlano = async (fonte: number) =>
  json(await fetch(`${P}?fonte=${encodeURIComponent(String(fonte))}`, ler), esquemaRegrasPlanoDaFonte);

export interface IncluirRegraPlano {
  acao: 'incluir';
  fonteId: number;
  planoId: number | null;
  categoriaId: number | null;
  especialidadeId: number | null;
  servicoId: number | null;
  setorId: number | null;
  todasUnidades: boolean;
  exigeCarteira: boolean;
  exigeValidadeCarteira: boolean;
  exigeTitular: boolean;
  exigeGuia: boolean;
  exigeSenhaAutorizacao: boolean;
  exigeCodigoValidacao: boolean;
  tamanhoCarteira: number | null;
  prefixoCarteira: string | null;
  permiteDependentes: boolean;
  prazoRetornoDias: number | null;
  documentosExigidos: string[];
  orientacaoRecepcao: string | null;
  tetoAtendimentos: number | null;
  tetoPeriodoDias: number | null;
  tetoBloqueia: boolean;
  pendencia: (typeof PENDENCIAS_PLANO)[number];
  pendenciaMotivo: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export interface EncerrarRegraPlano {
  acao: 'encerrar';
  fonteId: number;
  id: number;
  versao: number;
  vigenciaFim: string;
}

export const manterRegraPlano = async (a: IncluirRegraPlano | EncerrarRegraPlano, chave: string) =>
  json(await fetch(P, postar(a, chave)), esquemaGravacao);

export interface PreviaRegraPlano {
  fonteId: number;
  planoId?: number | null;
  categoriaId?: number | null;
  especialidadeId?: number | null;
  servicoId?: number | null;
  setorId?: number | null;
  pacienteId?: number | null;
  data?: string;
  carteira?: string | null;
  validadeCarteira?: string | null;
  guia?: string | null;
  senhaAutorizacao?: string | null;
  validadeSenha?: string | null;
}

export const previaRegraPlano = async (p: PreviaRegraPlano) =>
  json(await fetch(`${P}/previa`, postar(p)), esquemaCriticaPlano);
