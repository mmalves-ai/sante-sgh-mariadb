// Cliente da API da terminologia clínica (F8, 09-AREA linha 84):
// GET  /api/pep/terminologia-clinica/cids?texto=                       CID-10 para o registro do diagnóstico
// GET  /api/pep/terminologia-clinica/conceitos?texto=&cid=             conceitos clínicos (as equivalências da CID primeiro)
// GET  /api/pep/terminologia-clinica/regioes?texto=&superior=&exame=   regiões anatômicas (as do exame, com a padrão)
// GET  /api/pep/terminologia-clinica/paciente/:p/diagnosticos          visão por paciente
// POST /api/pep/terminologia-clinica/diagnosticos                      registrar; trocar ou tirar o conceito
// POST /api/pep/terminologia-clinica/exame-regioes                     ligar, tornar padrão (uma gravação) ou retirar
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/terminologia-clinica';
const JSON_ACEITO = { accept: 'application/json' };

const qs = (f: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function lerJson<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function gravar(caminho: string, rotulo: string, corpo: Record<string, unknown>, buscar: typeof fetch) {
  const r = await buscar(`${P}/${caminho}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(rotulo),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean() })
    .passthrough()
    .parse(await r.json());
}

const esquemaCid = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
export type CidTela = z.infer<typeof esquemaCid>;

const esquemaConceito = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  descricaoCompleta: z.string().nullable(),
  equivalencia: z.string().nullable(),
});
export type ConceitoTela = z.infer<typeof esquemaConceito>;

const esquemaRegiao = z.object({
  id: z.number(),
  sistema: z.string(),
  nivel: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  superiorId: z.number().nullable(),
  padrao: z.boolean().optional(),
});
export type RegiaoTela = z.infer<typeof esquemaRegiao>;

const termo = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
const esquemaDiagnostico = z.object({
  id: z.number(),
  versao: z.number(),
  atendimentoId: z.number(),
  cid: termo,
  conceito: termo.nullable(),
  tipo: z.string(),
  certeza: z.string(),
  escopo: z.string(),
  situacao: z.string(),
  diagnosticadoEm: z.string().nullable(),
  profissional: z.string().nullable(),
  observacao: z.string().nullable(),
});
export type DiagnosticoTela = z.infer<typeof esquemaDiagnostico>;

export const buscarCids = (texto: string, buscar: typeof fetch = fetch) =>
  lerJson(`${P}/cids${qs({ texto })}`, z.array(esquemaCid), buscar);

export const buscarConceitos = (f: { texto?: string; cid?: number }, buscar: typeof fetch = fetch) =>
  lerJson(`${P}/conceitos${qs(f)}`, z.array(esquemaConceito), buscar);

export const buscarRegioes = (
  f: { texto?: string; superior?: number; exame?: number },
  buscar: typeof fetch = fetch,
) => lerJson(`${P}/regioes${qs(f)}`, z.array(esquemaRegiao), buscar);

export const lerDiagnosticosPaciente = (paciente: number, buscar: typeof fetch = fetch) =>
  lerJson(
    `${P}/paciente/${paciente}/diagnosticos`,
    z.object({ diagnosticos: z.array(esquemaDiagnostico) }),
    buscar,
  ).then((r) => r.diagnosticos);

export const gravarDiagnostico = (corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  gravar('diagnosticos', 'pep.diagnosticoAtendimento', corpo, buscar);

export const gravarRegiaoExame = (corpo: Record<string, unknown>, buscar: typeof fetch = fetch) =>
  gravar('exame-regioes', 'sadt.exameRegiaoAnatomica', corpo, buscar);
