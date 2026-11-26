// Cliente da foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5): foto ativa, histórico,
// conferências, captura, revogação e conferência da identidade. As gravações mandam o CSRF e a Idempotency-Key;
// Problem Details viram ErroApi (mensagem em português na tela).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/cadastros/pacientes';

export const CONTEXTOS_CONFERENCIA = [
  'recepcao',
  'guia',
  'leito',
  'dispensacao',
  'procedimento',
  'outro',
] as const;
export const RESULTADOS_CONFERENCIA = ['confirmada', 'nao_confirmada', 'dispensada'] as const;

const esquemaFoto = z.object({
  id: z.number(),
  situacao: z.enum(['ativa', 'substituida', 'revogada']),
  capturadaEm: z.string(),
  guardaAte: z.string(),
  revogadaEm: z.string().nullable(),
});
const esquemaIdentificacao = z.object({
  baseLegal: z.string(),
  ativa: esquemaFoto.nullable(),
  historico: z.array(esquemaFoto),
  conferencias: z.array(
    z.object({
      id: z.number(),
      ocorridaEm: z.string(),
      contexto: z.string(),
      resultado: z.string(),
      motivoDispensa: z.string().nullable(),
      atendimento: z.number().nullable(),
      usuario: z.string().nullable(),
    }),
  ),
});
export type IdentificacaoPaciente = z.infer<typeof esquemaIdentificacao>;

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function gravar(url: string, corpo: unknown, buscar: typeof fetch = fetch): Promise<void> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
}

export async function lerIdentificacao(
  id: number,
  buscar: typeof fetch = fetch,
): Promise<IdentificacaoPaciente> {
  const r = await buscar(`${P}/${id}/identificacao`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaIdentificacao.parse(await r.json());
}

/** Endereço da foto ativa (a leitura fica na trilha do paciente); `versao` evita a foto antiga em cache. */
export const urlFotoIdentificacao = (id: number, versao: number): string =>
  `${P}/${id}/identificacao/foto?v=${versao}`;

export const captarFoto = (id: number, conteudo: string) =>
  gravar(`${P}/${id}/identificacao/foto`, { conteudo });

export const revogarFoto = (id: number, motivo: string) =>
  gravar(`${P}/${id}/identificacao/foto/revogar`, { motivo });

export const conferirIdentidade = (
  id: number,
  corpo: { resultado: string; contexto: string; motivoDispensa: string | null },
) => gravar(`${P}/${id}/identificacao/conferencias`, corpo);
