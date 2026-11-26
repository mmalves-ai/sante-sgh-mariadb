// Cliente da API da pesquisa clínica (03-PEP L144):
// GET  /api/pep/pesquisa                          estudos do estabelecimento e se a triagem automática está ligada
// GET  /api/pep/pesquisa/:id                      o estudo com equipe, critérios, candidatos e participantes
// GET  /api/pep/pesquisa/profissionais?termo=     investigador, equipe e avaliador
// GET  /api/pep/pesquisa/pacientes?termo=         pacientes com atendimento no estabelecimento (indicação manual)
// GET  /api/pep/pesquisa/pacientes/:id/anexos     anexos do prontuário do paciente (o TCLE assinado)
// POST /api/pep/pesquisa                          cadastro do estudo; :id/situacao, :id/equipe, :id/criterios,
//      :id/criterios/:c/desativar, :id/triagem, triagens/:id/avaliar, participantes/:id/situacao e /visita
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/pesquisa';
const JSON_ACEITO = { accept: 'application/json' };
const txt = z.string().nullable();

const esquemaResumo = z.object({
  id: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  situacao: z.string(),
  fase: txt,
  numeroCaae: txt,
  investigador: txt,
  inicio: txt,
  fim: txt,
  participantes: z.number(),
  candidatos: z.number(),
  versao: z.number(),
});
export const esquemaPainelPesquisa = z.object({
  estudos: z.array(esquemaResumo),
  triagemAutomatica: z.boolean(),
});
export type PainelPesquisa = z.infer<typeof esquemaPainelPesquisa>;

export const esquemaEstudoPesquisa = z.object({
  id: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  tituloResumido: txt,
  numeroCaae: txt,
  registroEnsaio: txt,
  fase: txt,
  situacao: z.string(),
  aprovacaoEticaEm: txt,
  aprovadoComite: z.boolean(),
  aprovadoDiretoria: z.boolean(),
  inicio: txt,
  fim: txt,
  diasProcessamento: z.number().nullable(),
  recruta: z.boolean(),
  versao: z.number(),
  equipe: z.array(
    z.object({
      id: z.number(),
      profissional: z.number(),
      nome: txt,
      papel: z.string(),
      inicio: txt,
      fim: txt,
    }),
  ),
  criterios: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      tipo: z.string(),
      grupo: z.number(),
      descricao: z.string(),
      fonte: z.string(),
      valorTexto: txt,
      valorMinimo: z.number().nullable(),
      valorMaximo: z.number().nullable(),
      ativo: z.boolean(),
      versao: z.number(),
    }),
  ),
  triagens: z.array(
    z.object({
      id: z.number(),
      paciente: z.number(),
      nome: txt,
      modo: z.string(),
      processadoEm: txt,
      atendidos: z.array(z.object({ criterio: z.number(), valor: z.string() })),
      aConferir: z.array(z.number()),
      situacao: z.string(),
      avaliadoEm: txt,
      observacao: txt,
      versao: z.number(),
    }),
  ),
  participantes: z.array(
    z.object({
      id: z.number(),
      paciente: z.number(),
      nome: txt,
      codigo: txt,
      braco: txt,
      situacao: z.string(),
      consentimentoEm: txt,
      incluidoEm: txt,
      inicioTratamento: txt,
      fimTratamento: txt,
      saidaEm: txt,
      motivoSaida: txt,
      ultimaVisita: txt,
      versao: z.number(),
    }),
  ),
});
export type EstudoPesquisa = z.infer<typeof esquemaEstudoPesquisa>;

const esquemaNome = z.array(z.object({ id: z.number(), nome: z.string() }));
const esquemaPaciente = z.array(
  z.object({ id: z.number(), nome: z.string(), prontuario: z.number().nullable() }),
);
const esquemaAnexo = z.array(z.object({ id: z.number(), nome: txt, em: txt }));

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function enviar(url: string, corpo: Record<string, unknown>, buscar: typeof fetch) {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.pesquisa'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({})
    .passthrough()
    .parse(await r.json()) as Record<string, unknown>;
}

const q = (termo: string) => `?termo=${encodeURIComponent(termo)}`;

export const lerPainelPesquisa = (buscar: typeof fetch = fetch) => ler(P, esquemaPainelPesquisa, buscar);
export const lerEstudoPesquisa = (id: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/${id}`, esquemaEstudoPesquisa, buscar);
export const buscarProfissionaisPesquisa = (termo: string, buscar: typeof fetch = fetch) =>
  ler(`${P}/profissionais${q(termo)}`, esquemaNome, buscar);
export const buscarPacientesPesquisa = (termo: string, buscar: typeof fetch = fetch) =>
  ler(`${P}/pacientes${q(termo)}`, esquemaPaciente, buscar);
export const lerAnexosPesquisa = (paciente: number, buscar: typeof fetch = fetch) =>
  ler(`${P}/pacientes/${paciente}/anexos`, esquemaAnexo, buscar);

export const cadastrarEstudoPesquisa = (corpo: Record<string, unknown>, b: typeof fetch = fetch) =>
  enviar(P, corpo, b);
export const mudarSituacaoEstudo = (id: number, corpo: Record<string, unknown>, b: typeof fetch = fetch) =>
  enviar(`${P}/${id}/situacao`, corpo, b);
export const incluirMembroPesquisa = (id: number, corpo: Record<string, unknown>, b: typeof fetch = fetch) =>
  enviar(`${P}/${id}/equipe`, corpo, b);
export const incluirCriterioPesquisa = (
  id: number,
  corpo: Record<string, unknown>,
  b: typeof fetch = fetch,
) => enviar(`${P}/${id}/criterios`, corpo, b);
export const desativarCriterioPesquisa = (
  id: number,
  criterio: number,
  versao: number,
  b: typeof fetch = fetch,
) => enviar(`${P}/${id}/criterios/${criterio}/desativar`, { versao }, b);
export const triarPesquisa = (id: number, pacientes: number[], b: typeof fetch = fetch) =>
  enviar(`${P}/${id}/triagem`, { pacientes }, b);
export const avaliarTriagemPesquisa = (
  triagem: number,
  corpo: Record<string, unknown>,
  b: typeof fetch = fetch,
) => enviar(`${P}/triagens/${triagem}/avaliar`, corpo, b);
export const mudarParticipantePesquisa = (
  id: number,
  corpo: Record<string, unknown>,
  b: typeof fetch = fetch,
) => enviar(`${P}/participantes/${id}/situacao`, corpo, b);
export const registrarVisitaPesquisa = (
  id: number,
  corpo: Record<string, unknown>,
  b: typeof fetch = fetch,
) => enviar(`${P}/participantes/${id}/visita`, corpo, b);
