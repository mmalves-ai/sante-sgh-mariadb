// Cliente da representação do paciente (F3.1, 02-CAD linha 4): condição de incapacidade (data e documento),
// levantamento e comprovante enviado pela tela. As gravações mandam o CSRF e a Idempotency-Key; Problem Details viram
// ErroApi (mensagem em português na tela).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/cadastros/pacientes';

/** O comprovante vai em base64 no corpo JSON: até 640 KB, PDF, PNG ou JPEG (o servidor confere pelo conteúdo). */
export const TAMANHO_MAXIMO_COMPROVANTE = 640 * 1024;
export const TIPOS_COMPROVANTE = ['application/pdf', 'image/png', 'image/jpeg'];
/** Documentos judiciais: pedem o número do processo. */
export const DOCUMENTOS_JUDICIAIS = ['sentenca_curatela', 'curatela_provisoria'];

const esquemaIncapacidades = z.object({
  incapaz: z.boolean(),
  itens: z.array(
    z.object({
      id: z.number(),
      inicio: z.string().nullable(),
      fim: z.string().nullable(),
      vigente: z.boolean(),
      documentoTipo: z.string(),
      documentoNumero: z.string().nullable(),
      documentoData: z.string().nullable(),
      temComprovante: z.boolean(),
      motivoEncerramento: z.string().nullable(),
      observacao: z.string().nullable(),
    }),
  ),
  alertas: z.array(z.object({ alerta: z.string(), mensagem: z.string() })),
  documentos: z.array(z.string()),
});
export type Incapacidades = z.infer<typeof esquemaIncapacidades>;

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

export async function lerIncapacidades(id: number, buscar: typeof fetch = fetch): Promise<Incapacidades> {
  const r = await buscar(`${P}/${id}/incapacidades`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaIncapacidades.parse(await r.json());
}

export const registrarIncapacidade = (
  id: number,
  corpo: { inicio: string; documentoTipo: string; documentoNumero: string | null; documentoData: string },
) => gravar(`${P}/${id}/incapacidades`, corpo);

export const encerrarIncapacidade = (
  id: number,
  incapacidade: number,
  corpo: { fim: string; motivo: string },
) => gravar(`${P}/${id}/incapacidades/${incapacidade}/encerrar`, corpo);

/** Endereço do comprovante anexado (abre em outra aba; a leitura fica na trilha do paciente). */
export const urlComprovante = (id: number, alvo: 'responsavel' | 'incapacidade', registro: number): string =>
  `${P}/${id}/comprovantes-representacao/${alvo}/${registro}/arquivo`;

export const enviarComprovante = (
  id: number,
  corpo: { alvo: 'responsavel' | 'incapacidade'; id: number; conteudo: string; nome: string },
) => gravar(`${P}/${id}/comprovantes-representacao`, corpo);
