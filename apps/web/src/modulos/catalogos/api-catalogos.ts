// Cliente das telas do M13 (catálogos oficiais e importadores), validado pelos contratos. As gravações mandam o
// CSRF (token duplo) e a Idempotency-Key; a aprovação manda a senha de novo. Problem Details viram ErroApi.
import {
  type CargaCatalogo,
  type ConsultaCatalogo,
  type DetalheCargaCatalogo,
  esquemaCargaCatalogo,
  esquemaConsultaCatalogo,
  esquemaDetalheCargaCatalogo,
  esquemaHistoricoSigtap,
  esquemaPainelCatalogos,
  type HistoricoSigtap,
  type NovaCargaCatalogo,
  type PainelCatalogos,
  permissaoConsultaCatalogo,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

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

const escrita = (corpo: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    ...JSON_ACEITO,
    'content-type': 'application/json',
    'x-csrf': tokenCsrf(),
    'idempotency-key': chaveIdempotencia(),
  },
  body: JSON.stringify(corpo),
});

const qs = (p: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
const ler = <T>(url: string, esquema: z.ZodType<T>) =>
  fetch(url, { headers: JSON_ACEITO }).then((r) => lerJson(r, esquema));
const gravar = <T>(url: string, corpo: unknown, esquema: z.ZodType<T>) =>
  fetch(url, escrita(corpo)).then((r) => lerJson(r, esquema));

export const buscarPainel = (): Promise<PainelCatalogos> =>
  ler('/api/catalogos/painel', esquemaPainelCatalogos);

export const listarCargas = (catalogo: string | null): Promise<{ cargas: Omit<CargaCatalogo, never>[] }> =>
  ler(`/api/catalogos/cargas${qs({ catalogo })}`, z.object({ cargas: z.array(esquemaCargaCatalogo) }));

export const enviarCarga = (nova: NovaCargaCatalogo) =>
  gravar(
    '/api/catalogos/cargas',
    nova,
    z
      .object({ id: z.number(), situacao: z.string(), motivo: z.string().nullable(), lotes: z.number() })
      .passthrough(),
  );

export const buscarCarga = (
  id: number,
  f: { pagina: number; comparacao: string | null; resultado: string | null },
): Promise<DetalheCargaCatalogo> =>
  ler(
    `/api/catalogos/cargas/${id}${qs({ pagina: f.pagina, comparacao: f.comparacao, resultado: f.resultado })}`,
    esquemaDetalheCargaCatalogo,
  );

export const aprovarCarga = (id: number, corpo: { justificativa: string; senha: string; versao: number }) =>
  gravar(
    `/api/catalogos/cargas/${id}/aprovar`,
    corpo,
    z.object({ id: z.number(), situacao: z.string(), mensagem: z.string() }).passthrough(),
  );

export const encerrarCarga = (id: number, acao: 'rejeitar' | 'cancelar', motivo: string, versao: number) =>
  gravar(
    `/api/catalogos/cargas/${id}/${acao}`,
    { motivo, versao },
    z.object({ id: z.number(), situacao: z.string() }),
  );

/** Consulta paginada; as posições do leiaute de CEP vão pela rota da tela de leiautes (catalogo.leiaute.ler). */
export const consultarCatalogo = (
  entidade: string,
  busca: string,
  pagina: number,
  o: { readonly porPagina?: number; readonly competencia?: string } = {},
): Promise<ConsultaCatalogo> =>
  ler(
    `${
      permissaoConsultaCatalogo(entidade) === 'catalogo.leiaute.ler'
        ? '/api/catalogos/leiautes/posicoes'
        : `/api/catalogos/consulta/${encodeURIComponent(entidade)}`
    }${qs({ busca, pagina, porPagina: o.porPagina ?? 50, competencia: o.competencia })}`,
    esquemaConsultaCatalogo,
  );

export const buscarHistoricoSigtap = (procedimento: string): Promise<HistoricoSigtap> =>
  ler(`/api/catalogos/sigtap/${procedimento}/historico`, esquemaHistoricoSigtap);
