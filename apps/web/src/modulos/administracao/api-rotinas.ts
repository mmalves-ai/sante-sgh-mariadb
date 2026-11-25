// Rotinas agendadas (01-SIS L95): painel, histórico com etapas, acionar, suspender e retomar pela API.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/administracao/rotinas';

const esquemaResumo = z.object({
  id: z.number(),
  situacao: z.string(),
  disparo: z.string(),
  ocorridoEm: z.string().nullable(),
  inicioEm: z.string().nullable(),
  fimEm: z.string().nullable(),
  lidos: z.number(),
  gravados: z.number(),
  rejeitados: z.number(),
  mensagemErro: z.string().nullable(),
  usuario: z.string().nullable(),
});
export const esquemaPainelRotinas = z.object({
  agora: z.string(),
  rotinas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      codigo: z.string(),
      nome: z.string(),
      descricao: z.string().nullable(),
      categoria: z.string(),
      situacao: z.string(),
      ativo: z.boolean(),
      permiteAcionamentoManual: z.boolean(),
      intervaloSegundos: z.number().nullable(),
      toleranciaAtrasoSegundos: z.number().nullable(),
      ultimaExecucaoEm: z.string().nullable(),
      proximaExecucaoEm: z.string().nullable(),
      atrasada: z.boolean(),
      atrasoSegundos: z.number(),
      pedidoPendente: z.boolean(),
      impedimentoAcionar: z.string().nullable(),
      ultima: esquemaResumo.nullable(),
    }),
  ),
});
export type PainelRotinas = z.infer<typeof esquemaPainelRotinas>;
export type RotinaDoPainel = PainelRotinas['rotinas'][number];

export const esquemaHistoricoRotina = z.object({
  execucoes: z.array(
    esquemaResumo.extend({
      etapas: z.array(
        z.object({
          sequencia: z.number(),
          nome: z.string(),
          situacao: z.string(),
          inicioEm: z.string().nullable(),
          fimEm: z.string().nullable(),
          lidos: z.number(),
          gravados: z.number(),
          rejeitados: z.number(),
          mensagem: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type HistoricoRotina = z.infer<typeof esquemaHistoricoRotina>;

async function ler<T>(url: string, esquema: z.ZodType<T>): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function gravar(url: string, corpo: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.json();
}

export const buscarRotinas = (): Promise<PainelRotinas> => ler(P, esquemaPainelRotinas);
export const buscarHistoricoRotina = (id: number): Promise<HistoricoRotina> =>
  ler(`${P}/${id}/execucoes?limite=50`, esquemaHistoricoRotina);
export const acionarRotina = (id: number) => gravar(`${P}/${id}/acionar`, {});
export const suspensaoRotina = (id: number, versao: number, acao: 'suspender' | 'retomar') =>
  gravar(`${P}/${id}/suspensao`, { versao, acao });
