// Onda 0 (M38): a situação das telas de consulta para esta sessão (GET /api/onda0/telas) e a vigilância diária de
// gravação em produção (GET /api/config/assinaturas/vigia). Só leitura.
import {
  esquemaPainelVigia,
  esquemaTelasOnda0,
  type PainelVigia,
  type TelaOnda0Situacao,
  type TelasOnda0,
} from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

export async function lerTelasOnda0(buscar: typeof fetch = fetch): Promise<TelasOnda0> {
  const r = await buscar('/api/onda0/telas', { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaTelasOnda0.parse(await r.json());
}

export interface FiltroVigia {
  readonly hospital?: string;
  readonly de?: string;
  readonly ate?: string;
}

export async function buscarVigia(f: FiltroVigia = {}, buscar: typeof fetch = fetch): Promise<PainelVigia> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  const s = q.toString();
  const r = await buscar(`/api/config/assinaturas/vigia${s ? `?${s}` : ''}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPainelVigia.parse(await r.json());
}

/** Chaves de tela desligadas (ou fora do escopo) para esta sessão: o menu, a paleta e a casca escondem a tela. */
export function chavesDeTelaDesligadas(telas: readonly TelaOnda0Situacao[] | undefined): Set<string> {
  const s = new Set<string>();
  for (const t of telas ?? [])
    if (t.recurso && t.situacao !== 'ligada' && t.situacao !== 'sem-chave') s.add(t.recurso);
  return s;
}

/** Resumo da vigilância do período: dias com execução e dias com divergência. */
export function resumoVigia(p: PainelVigia | undefined): { dias: number; comDivergencia: number } {
  const porDia = new Map<string, number>();
  for (const e of p?.execucoes ?? [])
    porDia.set(e.resultado.data, (porDia.get(e.resultado.data) ?? 0) + e.resultado.divergentes);
  return { dias: porDia.size, comDivergencia: [...porDia.values()].filter((n) => n > 0).length };
}
