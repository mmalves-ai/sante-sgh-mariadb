// Cliente do BI consolidado da Rede e do registro dos serviços compartilhados (M57, etapa 3), validado pelos contratos.
// As gravações mandam o CSRF (token duplo) e a Idempotency-Key (uma por pedido). Problem Details viram ErroApi
// (mensagem em português na tela).
import {
  type AlterarServicoCompartilhado,
  type BiRede,
  type ConsultaServicosRede,
  esquemaBiRede,
  esquemaListaServicosRede,
  esquemaPainelBiRede,
  esquemaSerieIndicadorBiRede,
  esquemaServicoCompartilhado,
  type ListaServicosRede,
  type NovoServicoCompartilhado,
  type PainelConsolidadoRede,
  type SerieIndicadorBiRede,
  type ServicoCompartilhado,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const BI = '/api/relatorios/bi/rede';
const SERVICOS = '/api/rede/servicos';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function escrita(corpo: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo ?? {}),
  };
}

/** A query (só os campos preenchidos). */
export function consulta(q: Readonly<Record<string, string | number | undefined | null>>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface PeriodoBi {
  readonly de?: string;
  readonly ate?: string;
}

export async function lerBiRede(p: PeriodoBi = {}, buscar: typeof fetch = fetch): Promise<BiRede> {
  return lerJson(await buscar(`${BI}${consulta({ ...p })}`, { headers: JSON_ACEITO }), esquemaBiRede);
}

export async function lerSerieBiRede(
  codigo: string,
  p: PeriodoBi = {},
  buscar: typeof fetch = fetch,
): Promise<SerieIndicadorBiRede> {
  return lerJson(
    await buscar(`${BI}/indicadores/${encodeURIComponent(codigo)}${consulta({ ...p })}`, {
      headers: JSON_ACEITO,
    }),
    esquemaSerieIndicadorBiRede,
  );
}

/** O endereço da planilha da série (o navegador baixa com a sessão). */
export function enderecoPlanilhaBiRede(codigo: string, p: PeriodoBi = {}): string {
  return `${BI}/indicadores/${encodeURIComponent(codigo)}/exportar${consulta({ ...p })}`;
}

export async function lerPainelBiRede(
  painel: 'operacional' | 'financeiro',
  p: PeriodoBi = {},
  buscar: typeof fetch = fetch,
): Promise<PainelConsolidadoRede> {
  return lerJson(
    await buscar(`${BI}/paineis/${painel}${consulta({ ...p })}`, { headers: JSON_ACEITO }),
    esquemaPainelBiRede,
  );
}

export async function lerServicosRede(
  q: Partial<ConsultaServicosRede>,
  buscar: typeof fetch = fetch,
): Promise<ListaServicosRede> {
  return lerJson(
    await buscar(`${SERVICOS}${consulta({ ...q })}`, { headers: JSON_ACEITO }),
    esquemaListaServicosRede,
  );
}

export async function registrarServicoRede(
  novo: NovoServicoCompartilhado,
  buscar: typeof fetch = fetch,
): Promise<ServicoCompartilhado> {
  return lerJson(await buscar(SERVICOS, escrita(novo)), esquemaServicoCompartilhado);
}

export async function alterarServicoRede(
  estabelecimento: string,
  id: number,
  m: AlterarServicoCompartilhado,
  buscar: typeof fetch = fetch,
): Promise<{ registro: ServicoCompartilhado; mudou: boolean }> {
  return lerJson(
    await buscar(`${SERVICOS}/${encodeURIComponent(estabelecimento)}/${id}`, escrita(m)),
    z.object({ registro: esquemaServicoCompartilhado, mudou: z.boolean() }),
  );
}
