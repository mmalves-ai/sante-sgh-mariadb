// Cliente das telas do MPI da Rede (M57, etapas 1 e 2: o aviso do cabeçalho e o acesso cruzado), validado pelos contratos. As gravações mandam o CSRF (token duplo) e
// a Idempotency-Key (uma por pedido). Problem Details viram ErroApi (mensagem em português na tela).
import {
  type AvisoRedePaciente,
  type CandidatoRede,
  type CicloPareamentoRede,
  type ConsultaFilaRede,
  type DecisaoCandidatoRede,
  type DesfazerVinculoRede,
  type DivergenciasRede,
  esquemaAvisoRedePaciente,
  esquemaCandidatoRede,
  esquemaCicloPareamentoRede,
  esquemaDivergenciasRede,
  esquemaFilaRede,
  esquemaProntuarioRede,
  esquemaResultadoGravacaoRede,
  esquemaVinculosCadastroRede,
  type FilaRede,
  type PedidoProntuarioRede,
  type ProntuarioRede,
  type ResultadoGravacaoRede,
  type VinculosCadastroRede,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/rede/mpi';

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

function escrita(corpo?: unknown): RequestInit {
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

const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

/** A query da fila (só os filtros preenchidos). */
export function consultaDaFila(q: Partial<ConsultaFilaRede>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function lerFilaRede(q: Partial<ConsultaFilaRede>, buscar: typeof fetch = fetch): Promise<FilaRede> {
  return ler(`${P}/fila${consultaDaFila(q)}`, esquemaFilaRede, buscar);
}

export function lerCandidatoRede(chave: string, buscar: typeof fetch = fetch): Promise<CandidatoRede> {
  return ler(`${P}/candidatos/${encodeURIComponent(chave)}`, esquemaCandidatoRede, buscar);
}

export async function decidirParRede(
  chave: string,
  d: DecisaoCandidatoRede,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacaoRede> {
  return lerJson(
    await buscar(`${P}/candidatos/${encodeURIComponent(chave)}/decisao`, escrita(d)),
    esquemaResultadoGravacaoRede,
  );
}

export async function desfazerVinculoRede(
  chave: string,
  d: DesfazerVinculoRede,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacaoRede> {
  return lerJson(
    await buscar(`${P}/vinculos/${encodeURIComponent(chave)}/desfazer`, escrita(d)),
    esquemaResultadoGravacaoRede,
  );
}

export function lerVinculosRede(
  estabelecimento: string,
  id: number,
  buscar: typeof fetch = fetch,
): Promise<VinculosCadastroRede> {
  return ler(`${P}/cadastros/${estabelecimento}/${id}/vinculos`, esquemaVinculosCadastroRede, buscar);
}

export async function atualizarFilaRede(buscar: typeof fetch = fetch): Promise<CicloPareamentoRede> {
  return lerJson(await buscar(`${P}/pareamento`, escrita({})), esquemaCicloPareamentoRede);
}

export function lerDivergenciasRede(buscar: typeof fetch = fetch): Promise<DivergenciasRede> {
  return ler(`${P}/divergencias`, esquemaDivergenciasRede, buscar);
}

export async function repararIndiceRede(
  buscar: typeof fetch = fetch,
): Promise<{ reparados: number; pendentes: number; manuais: string[] }> {
  return lerJson(
    await buscar(`${P}/divergencias/reparo`, escrita({})),
    z.object({ reparados: z.number(), pendentes: z.number(), manuais: z.array(z.string()) }),
  );
}

/** Quantos bancos gravaram (o aviso "o que faltou é completado" quando algum ficou pendente). */
export function resumoGravacao(r: ResultadoGravacaoRede): {
  gravados: number;
  total: number;
  pendente: boolean;
} {
  const gravados = r.bancos.filter((b) => b.situacao !== 'pendente').length;
  return { gravados, total: r.bancos.length, pendente: gravados < r.bancos.length };
}

// ── Etapa 2: o aviso no cabeçalho do paciente e o acesso cruzado (DP-42) ─────────────────────────────────

export function lerAvisoRede(paciente: number, buscar: typeof fetch = fetch): Promise<AvisoRedePaciente> {
  return ler(`${P}/pacientes/${paciente}/aviso`, esquemaAvisoRedePaciente, buscar);
}

/** Abre a linha do tempo do paciente no outro estabelecimento (motivo e justificativa; trilha nos dois bancos). */
export async function abrirProntuarioRede(
  paciente: number,
  estabelecimento: string,
  pedido: PedidoProntuarioRede,
  buscar: typeof fetch = fetch,
): Promise<ProntuarioRede> {
  return lerJson(
    await buscar(
      `/api/pep/rede/paciente/${paciente}/estabelecimentos/${encodeURIComponent(estabelecimento)}/linha-do-tempo`,
      escrita(pedido),
    ),
    esquemaProntuarioRede,
  );
}
