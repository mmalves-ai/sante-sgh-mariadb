// Cliente dos documentos exigidos por diagnóstico, idade ou setor (C2-028, 03-PEP L132): a lista do profissional
// (atendimentos abertos com documento que falta, vencidas e bloqueantes em destaque), a visão por atendimento e o
// cadastro das regras (/api/pep/documentos-exigidos). Nada é apagado: a regra é desativada pela versão.
import {
  EXIGENCIAS_OBRIGATORIEDADE,
  MOMENTOS_OBRIGATORIEDADE,
  TIPOS_ATENDIMENTO_OBRIGATORIEDADE,
} from '@sgh/dominio-pep';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const pendencia = z.object({
  regra: z.number(),
  modelo: z.number(),
  titulo: z.string(),
  momento: z.enum(MOMENTOS_OBRIGATORIEDADE),
  exigencia: z.enum(EXIGENCIAS_OBRIGATORIEDADE),
  exigidoDesde: z.string(),
  prazo: z.string().nullable(),
  vencida: z.boolean(),
  motivo: z.string(),
});
export type PendenciaDocumento = z.infer<typeof pendencia>;

const atendimento = z.object({
  atendimento: z.number(),
  numero: z.string(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.string().nullable(),
  setor: z.number().nullable(),
  setorNome: z.string().nullable(),
  pendencias: z.array(pendencia),
});
export type AtendimentoComPendencias = z.infer<typeof atendimento>;

const esquemaPendencias = z.object({
  agora: z.string(),
  regrasAtivas: z.number(),
  totais: z.object({
    atendimentos: z.number(),
    pendencias: z.number(),
    vencidas: z.number(),
    bloqueantes: z.number(),
  }),
  itens: z.array(atendimento),
});
export type PendenciasDocumentos = z.infer<typeof esquemaPendencias>;

const regra = z.object({
  id: z.number(),
  versao: z.number(),
  ativo: z.boolean(),
  todosEstabelecimentos: z.boolean(),
  modelo: z.number(),
  titulo: z.string(),
  setor: z.number().nullable(),
  setorNome: z.string().nullable(),
  sexo: z.number().nullable(),
  tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_OBRIGATORIEDADE),
  idadeMinimaDias: z.number().nullable(),
  idadeMaximaDias: z.number().nullable(),
  cids: z.array(z.string()),
  momento: z.enum(MOMENTOS_OBRIGATORIEDADE),
  exigencia: z.enum(EXIGENCIAS_OBRIGATORIEDADE),
  prazoMinutos: z.number().nullable(),
  intervaloDias: z.number().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
});
export type RegraDocumentoExigido = z.infer<typeof regra>;

const opcao = z.object({ id: z.number(), rotulo: z.string() });
const esquemaRegras = z.object({
  regras: z.array(regra),
  opcoes: z.object({ modelos: z.array(opcao), setores: z.array(opcao), sexos: z.array(opcao) }),
});
export type RegrasDocumentosExigidos = z.infer<typeof esquemaRegras>;

const gravado = z.object({ id: z.number().nullable() }).passthrough();
const P = '/api/pep/documentos-exigidos';

export const lerPendenciasDocumentos = (setor: number | null, vencidas: boolean) => {
  const q = new URLSearchParams();
  if (setor !== null) q.set('setor', String(setor));
  if (vencidas) q.set('vencidas', '1');
  const s = q.toString();
  return ler(`${P}/pendencias${s ? `?${s}` : ''}`, esquemaPendencias);
};

export const lerPendenciasDoAtendimento = (at: number) =>
  ler(`${P}/atendimentos/${at}`, atendimento.extend({ agora: z.string() }));

export const lerRegrasDocumentos = () => ler(`${P}/regras`, esquemaRegras);

export interface RegraDocumentoPedido {
  modelo: number;
  setor: number | null;
  sexo: number | null;
  tipoAtendimento: RegraDocumentoExigido['tipoAtendimento'];
  idadeMinimaDias: number | null;
  idadeMaximaDias: number | null;
  cids: string[];
  momento: RegraDocumentoExigido['momento'];
  exigencia: RegraDocumentoExigido['exigencia'];
  prazoMinutos: number | null;
  intervaloDias: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  todosEstabelecimentos: boolean;
}

export const incluirRegraDocumento = (p: RegraDocumentoPedido) =>
  enviar(`${P}/regras`, p, gravado, novaChave('documento-exigido-incluir'));

/** Altera pela versão lida (conflito: 409); o CID retirado fica marcado, nada é apagado. */
export const alterarRegraDocumento = (id: number, versao: number, p: RegraDocumentoPedido) =>
  enviar(`${P}/regras/${id}`, { ...p, versao }, gravado, novaChave('documento-exigido-alterar'));

/** Ativa ou desativa a regra pela versão lida (nada apagado). */
export const ativarRegraDocumento = (id: number, versao: number, ativo: boolean) =>
  enviar(`${P}/regras/${id}/ativo`, { versao, ativo }, gravado, novaChave('documento-exigido-ativo'));
