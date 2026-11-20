// Cliente das consultas somente leitura (M14), validado pelos contratos. A exportação manda o CSRF.
import {
  type ConsultaDescrita,
  esquemaConsultaDescrita,
  esquemaIndiceConsultas,
  esquemaPaginaConsulta,
  esquemaRegistroConsulta,
  type IndiceConsultas,
  type PaginaConsulta,
  type RegistroConsulta,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const base = (m: string, r: string) => `/api/consultas/${encodeURIComponent(m)}/${encodeURIComponent(r)}`;

export async function buscarIndiceConsultas(
  item?: string,
  buscar: typeof fetch = fetch,
): Promise<IndiceConsultas> {
  const q = item ? `?item=${encodeURIComponent(item)}` : '';
  return lerJson(await buscar(`/api/consultas${q}`, { headers: JSON_ACEITO }), esquemaIndiceConsultas);
}

export async function buscarConsulta(
  m: string,
  r: string,
  buscar: typeof fetch = fetch,
): Promise<ConsultaDescrita> {
  return lerJson(await buscar(base(m, r), { headers: JSON_ACEITO }), esquemaConsultaDescrita);
}

/** Filtros da tela: `f.<campo>`, `de.<campo>`, `ate.<campo>`. */
export async function buscarPagina(
  m: string,
  r: string,
  filtros: Readonly<Record<string, string>>,
  apos: string | null,
  porPagina = 50,
  buscar: typeof fetch = fetch,
): Promise<PaginaConsulta> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v.trim() !== '') q.set(k, v.trim());
  if (apos) q.set('apos', apos);
  q.set('porPagina', String(porPagina));
  return lerJson(
    await buscar(`${base(m, r)}/linhas?${q.toString()}`, { headers: JSON_ACEITO }),
    esquemaPaginaConsulta,
  );
}

export async function buscarRegistro(
  m: string,
  r: string,
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<RegistroConsulta> {
  return lerJson(
    await buscar(`${base(m, r)}/registro/${encodeURIComponent(codigo)}`, { headers: JSON_ACEITO }),
    esquemaRegistroConsulta,
  );
}

export async function exportarConsulta(
  m: string,
  r: string,
  filtros: Readonly<Record<string, string>>,
  justificativa?: number,
  buscar: typeof fetch = fetch,
): Promise<string> {
  const limpos = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v.trim() !== ''));
  const resp = await buscar(`${base(m, r)}/exportar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify({ filtros: limpos, ...(justificativa ? { justificativa } : {}) }),
  });
  if (!resp.ok) throw await erroDaResposta(resp);
  return resp.text();
}

const esquemaJustificativas = z.object({
  justificativas: z.array(z.object({ codigo: z.number().int(), descricao: z.string() })),
});

/** Correção do M14: as justificativas de exportação ativas (rota das consultas; quem exporta as lê). */
export async function buscarJustificativas(
  buscar: typeof fetch = fetch,
): Promise<z.infer<typeof esquemaJustificativas>> {
  return lerJson(
    await buscar('/api/consultas/justificativas', { headers: JSON_ACEITO }),
    esquemaJustificativas,
  );
}
