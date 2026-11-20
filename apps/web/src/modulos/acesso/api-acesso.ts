// Cliente das telas de acesso do M06 (grupos, mapa, quebra de vidro), validado pelos contratos.
import { type EmergenciaAberta, esquemaEmergenciaAberta, type PedidoEmergencia } from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

function tokenCsrf(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const faixa = z.union([z.number().int(), z.literal('<5')]);

export const esquemaGrupos = z.object({
  grupos: z.array(
    z.object({
      grupo: z.string(),
      ativo: z.boolean(),
      usuariosAtivos: faixa,
      opcoesLegado: z.number().int(),
      permissoesNovo: z.number().int(),
      destino: z.string(),
      perfil: z.string().nullable(),
      nivel: z.string().nullable(),
      motivo: z.string().nullable(),
      // W1-01 (parte 4c): a descrição vigente do grupo (do Sante, por versão).
      descricao: z.string().nullable().default(null),
      descricaoVersao: z.number().int().nullable().default(null),
    }),
  ),
});
export type GruposApi = z.infer<typeof esquemaGrupos>;

export const esquemaMapa = z.object({
  modulos: z.array(
    z.object({ id: z.number().int(), nome: z.string(), sistema: z.string(), opcoes: z.number() }),
  ),
  nos: z.array(
    z.object({
      opcao: z.number().int(),
      pai: z.number().int().nullable(),
      nivel: z.number().int(),
      titulo: z.string(),
      permissao: z.string().nullable(),
      exclusao: z.string().nullable(),
    }),
  ),
});
export type MapaApi = z.infer<typeof esquemaMapa>;

export async function buscarGrupos(buscar: typeof fetch = fetch): Promise<GruposApi> {
  return lerJson(await buscar('/api/acesso/grupos', { headers: JSON_ACEITO }), esquemaGrupos);
}

export async function buscarMapa(modulo: number | null, buscar: typeof fetch = fetch): Promise<MapaApi> {
  const q = modulo === null ? '' : `?modulo=${encodeURIComponent(String(modulo))}`;
  return lerJson(await buscar(`/api/acesso/mapa${q}`, { headers: JSON_ACEITO }), esquemaMapa);
}

export const esquemaProntuarioDemonstracao = z.object({
  paciente: z.object({ id: z.number(), nome: z.string(), prontuario: z.string() }),
  porEmergencia: z.boolean(),
  ate: z.string().nullable(),
});
export type ProntuarioDemonstracao = z.infer<typeof esquemaProntuarioDemonstracao>;

export async function abrirProntuarioDemonstracao(
  id: number,
  buscar: typeof fetch = fetch,
): Promise<ProntuarioDemonstracao> {
  return lerJson(
    await buscar(`/api/acesso/emergencias/demonstracao/pacientes/${id}`, { headers: JSON_ACEITO }),
    esquemaProntuarioDemonstracao,
  );
}

export async function abrirEmergencia(
  pedido: PedidoEmergencia,
  buscar: typeof fetch = fetch,
): Promise<EmergenciaAberta> {
  const r = await buscar('/api/acesso/emergencias', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(pedido),
  });
  return lerJson(r, esquemaEmergenciaAberta);
}
