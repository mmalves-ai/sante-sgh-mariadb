// Cliente das telas do faturamento SUS próprio (M51, etapas 1 a 3): competências, críticas, CIHA, BPA, arquivos,
// equivalências e o cadastro geral de solicitantes.
// As respostas são conferidas pelos esquemas de @sgh/contratos; toda escrita leva o CSRF e a chave de idempotência.
import {
  type ApacLida,
  type AtendimentoLaudoApac,
  type DominiosApac,
  esquemaApacLida,
  esquemaAtendimentoLaudoApac,
  esquemaDominiosApac,
  esquemaPaginaApacs,
  esquemaPaginaLinhasApac,
  esquemaSolicitanteApac,
  type FiltroApacs,
  type FiltroLinhasApac,
  type GerarApacEntrada,
  type PaginaApacs,
  type PaginaLinhasApac,
  type RegistrarApacEntrada,
  type SolicitanteApac,
  type AbrirCompetenciaSusEntrada,
  type ArquivoSusGerado,
  type ArquivoSusLido,
  type CompetenciaSusResumo,
  type CriticaSusLida,
  type CriticarSusEntrada,
  type DesativarEquivalenciaSusEntrada,
  type EquivalenciaSusLida,
  esquemaArquivoSusGerado,
  esquemaArquivoSusLido,
  esquemaCompetenciaSusResumo,
  esquemaCriticaSusLida,
  esquemaEquivalenciaSusLida,
  esquemaPaginaCriticasSus,
  esquemaPaginaEquivalenciasSus,
  esquemaProcedimentoHospitalSus,
  esquemaResultadoCriticaSus,
  esquemaSigtapAchado,
  type FecharCompetenciaSusEntrada,
  type FiltroCriticasSus,
  type FiltroEquivalenciasSus,
  type GerarCihaEntrada,
  INSTRUMENTOS_SUS,
  type JustificarCriticaSusEntrada,
  type PaginaCriticasSus,
  type PaginaEquivalenciasSus,
  type ProcedimentoHospitalSus,
  type ReabrirCompetenciaSusEntrada,
  type RegistrarEquivalenciaSusEntrada,
  type ResultadoCriticaSus,
  type SigtapAchado,
  esquemaMedicoSolicitanteAchado,
  esquemaPaginaLinhasBpa,
  type FiltroLinhasBpa,
  type GerarBpaEntrada,
  type MedicoSolicitanteAchado,
  type PaginaLinhasBpa,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const BASE = '/api/sus';
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

function consulta(q: Readonly<Record<string, string | number | undefined | null>>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const esquemaCompetenciasSusTela = z.object({
  competencias: z.array(esquemaCompetenciaSusResumo),
  instrumentos: z.array(z.object({ instrumento: z.enum(INSTRUMENTOS_SUS), liberado: z.boolean() })),
  cihaFonteDoEnvio: z.boolean(),
  escopoParcial: z.boolean(),
  hoje: z.string(),
});
export type CompetenciasSusTela = z.infer<typeof esquemaCompetenciasSusTela>;

export async function lerCompetenciasSus(
  instrumento: string | null = null,
  buscar: typeof fetch = fetch,
): Promise<CompetenciasSusTela> {
  return lerJson(
    await buscar(`${BASE}/competencias${consulta({ instrumento })}`, { headers: JSON_ACEITO }),
    esquemaCompetenciasSusTela,
  );
}

export async function abrirCompetenciaSus(
  e: AbrirCompetenciaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<CompetenciaSusResumo> {
  return lerJson(await buscar(`${BASE}/competencias`, escrita(e)), esquemaCompetenciaSusResumo);
}

export async function criticarSus(
  e: CriticarSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<ResultadoCriticaSus> {
  return lerJson(await buscar(`${BASE}/competencias/critica`, escrita(e)), esquemaResultadoCriticaSus);
}

export async function fecharCompetenciaSus(
  e: FecharCompetenciaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<CompetenciaSusResumo> {
  return lerJson(await buscar(`${BASE}/competencias/fechamento`, escrita(e)), esquemaCompetenciaSusResumo);
}

export async function reabrirCompetenciaSus(
  e: ReabrirCompetenciaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<CompetenciaSusResumo> {
  return lerJson(await buscar(`${BASE}/competencias/reabertura`, escrita(e)), esquemaCompetenciaSusResumo);
}

export async function lerCriticasSus(
  f: Partial<FiltroCriticasSus> & Pick<FiltroCriticasSus, 'instrumento' | 'competencia'>,
  buscar: typeof fetch = fetch,
): Promise<PaginaCriticasSus> {
  return lerJson(
    await buscar(`${BASE}/criticas${consulta(f)}`, { headers: JSON_ACEITO }),
    esquemaPaginaCriticasSus,
  );
}

export async function justificarCriticaSus(
  e: JustificarCriticaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<CriticaSusLida> {
  return lerJson(await buscar(`${BASE}/criticas/justificativa`, escrita(e)), esquemaCriticaSusLida);
}

export async function gerarCiha(
  e: GerarCihaEntrada,
  buscar: typeof fetch = fetch,
): Promise<ArquivoSusGerado> {
  return lerJson(await buscar(`${BASE}/ciha/arquivo`, escrita(e)), esquemaArquivoSusGerado);
}

export async function lerArquivosSus(
  instrumento: string,
  competencia: string | null,
  buscar: typeof fetch = fetch,
): Promise<ArquivoSusLido[]> {
  return lerJson(
    await buscar(`${BASE}/arquivos${consulta({ instrumento, competencia })}`, { headers: JSON_ACEITO }),
    z.array(esquemaArquivoSusLido),
  );
}

/** O endereço do download (o navegador baixa; o servidor audita e confere o hash). */
export function enderecoArquivoSus(id: number): string {
  return `${BASE}/arquivos/${id}/conteudo`;
}

/** A página das equivalências (busca e paginação no servidor; com os nomes dos dois procedimentos). */
export async function lerEquivalenciasSus(
  f: Partial<FiltroEquivalenciasSus> = {},
  buscar: typeof fetch = fetch,
): Promise<PaginaEquivalenciasSus> {
  return lerJson(
    await buscar(`${BASE}/equivalencias${consulta(f)}`, { headers: JSON_ACEITO }),
    esquemaPaginaEquivalenciasSus,
  );
}

/** Busca na SIGTAP (código ou nome), com a vigência na competência. */
export async function buscarSigtapSus(
  termo: string,
  competencia: string | null,
  buscar: typeof fetch = fetch,
): Promise<SigtapAchado[]> {
  return lerJson(
    await buscar(`${BASE}/sigtap${consulta({ termo, competencia })}`, { headers: JSON_ACEITO }),
    z.array(esquemaSigtapAchado),
  );
}

/** Busca no cadastro de procedimentos do hospital (código na tabela ou nome), ou pelos IDs. */
export async function buscarProcedimentosHospitalSus(
  q: { termo: string } | { ids: readonly number[] },
  buscar: typeof fetch = fetch,
): Promise<ProcedimentoHospitalSus[]> {
  const qs = 'termo' in q ? consulta({ termo: q.termo }) : consulta({ ids: q.ids.join(',') });
  return lerJson(
    await buscar(`${BASE}/procedimentos-hospital${qs}`, { headers: JSON_ACEITO }),
    z.array(esquemaProcedimentoHospitalSus),
  );
}

export async function registrarEquivalenciaSus(
  e: RegistrarEquivalenciaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<{ equivalencia: EquivalenciaSusLida; mudou: boolean }> {
  return lerJson(
    await buscar(`${BASE}/equivalencias`, escrita(e)),
    z.object({ equivalencia: esquemaEquivalenciaSusLida, mudou: z.boolean() }),
  );
}

export async function desativarEquivalenciaSus(
  e: DesativarEquivalenciaSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<EquivalenciaSusLida> {
  return lerJson(await buscar(`${BASE}/equivalencias/desativacao`, escrita(e)), esquemaEquivalenciaSusLida);
}

// ── Etapa 2: BPA e solicitantes ───────────────────────────────────────────────────────────────────────

export async function gerarBpa(e: GerarBpaEntrada, buscar: typeof fetch = fetch): Promise<ArquivoSusGerado> {
  return lerJson(await buscar(`${BASE}/bpa/arquivo`, escrita(e)), esquemaArquivoSusGerado);
}

/** As linhas de um BPA gerado (paginação no servidor; sem dado pessoal). */
export async function lerLinhasBpa(
  f: Pick<FiltroLinhasBpa, 'arquivo'> & Partial<FiltroLinhasBpa>,
  buscar: typeof fetch = fetch,
): Promise<PaginaLinhasBpa> {
  return lerJson(
    await buscar(`${BASE}/bpa/linhas${consulta(f)}`, { headers: JSON_ACEITO }),
    esquemaPaginaLinhasBpa,
  );
}

/** O endereço do download do BPA (a rota do BPA, com a permissão dele; o servidor audita e confere o hash). */
export function enderecoArquivoBpa(id: number): string {
  return `${BASE}/bpa/arquivos/${id}/conteudo`;
}

/** Busca no cadastro geral de médicos solicitantes (número do conselho ou nome). */
export async function buscarSolicitantesCadastroGeral(
  termo: string,
  buscar: typeof fetch = fetch,
): Promise<MedicoSolicitanteAchado[]> {
  return lerJson(
    await buscar(`${BASE}/solicitantes/cadastro-geral${consulta({ termo })}`, { headers: JSON_ACEITO }),
    z.array(esquemaMedicoSolicitanteAchado),
  );
}

export const esquemaParametrosLegadoSus = z.object({
  competenciaAmbulatorio: z.string().nullable(),
  versao: z.string().nullable(),
  orgao: z.string().nullable(),
});
export type ParametrosLegadoSus = z.infer<typeof esquemaParametrosLegadoSus>;

/** Os parâmetros do faturamento ambulatorial do banco do hospital (somente consulta). */
export async function lerParametrosLegadoSus(buscar: typeof fetch = fetch): Promise<ParametrosLegadoSus> {
  return lerJson(
    await buscar(`${BASE}/parametros-legado`, { headers: JSON_ACEITO }),
    esquemaParametrosLegadoSus,
  );
}

// ── Etapa 3: APAC ─────────────────────────────────────────────────────────────────────────────────────

/** As APACs do estabelecimento (paginação no servidor; o paciente pelo prontuário). */
export async function lerApacs(f: Partial<FiltroApacs>, buscar: typeof fetch = fetch): Promise<PaginaApacs> {
  return lerJson(await buscar(`${BASE}/apac${consulta(f)}`, { headers: JSON_ACEITO }), esquemaPaginaApacs);
}

/** O atendimento do laudo conferido no servidor (sem documento). */
export async function lerAtendimentoLaudoApac(
  registro: number,
  buscar: typeof fetch = fetch,
): Promise<AtendimentoLaudoApac> {
  return lerJson(
    await buscar(`${BASE}/apac/atendimento/${registro}`, { headers: JSON_ACEITO }),
    esquemaAtendimentoLaudoApac,
  );
}

export async function lerDominiosApac(buscar: typeof fetch = fetch): Promise<DominiosApac> {
  return lerJson(await buscar(`${BASE}/apac/dominios`, { headers: JSON_ACEITO }), esquemaDominiosApac);
}

export async function buscarSolicitantesApac(
  termo: string,
  buscar: typeof fetch = fetch,
): Promise<SolicitanteApac[]> {
  return lerJson(
    await buscar(`${BASE}/apac/solicitantes${consulta({ termo })}`, { headers: JSON_ACEITO }),
    z.array(esquemaSolicitanteApac),
  );
}

/** faturamento.registrarApac: laudo, autorizar, negar, continuar, encerrar ou cancelar. */
export async function registrarApac(
  e: RegistrarApacEntrada,
  buscar: typeof fetch = fetch,
): Promise<ApacLida> {
  return lerJson(await buscar(`${BASE}/apac`, escrita(e)), esquemaApacLida);
}

export async function gerarApac(
  e: GerarApacEntrada,
  buscar: typeof fetch = fetch,
): Promise<ArquivoSusGerado> {
  return lerJson(await buscar(`${BASE}/apac/arquivo`, escrita(e)), esquemaArquivoSusGerado);
}

export async function lerLinhasApac(
  f: Pick<FiltroLinhasApac, 'arquivo'> & Partial<FiltroLinhasApac>,
  buscar: typeof fetch = fetch,
): Promise<PaginaLinhasApac> {
  return lerJson(
    await buscar(`${BASE}/apac/linhas${consulta(f)}`, { headers: JSON_ACEITO }),
    esquemaPaginaLinhasApac,
  );
}

/** O endereço do download do APAC-Mag (a rota da APAC, com a permissão dela; o servidor audita e confere o hash). */
export function enderecoArquivoApac(id: number): string {
  return `${BASE}/apac/arquivos/${id}/conteudo`;
}
