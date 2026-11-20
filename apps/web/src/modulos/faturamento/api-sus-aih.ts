// Cliente das telas da AIH, dos leitos de UTI e do retorno do gestor (M51, etapa 4). As respostas são conferidas pelos
// esquemas de @sgh/contratos; toda escrita leva o CSRF e a chave de idempotência.
import {
  type AihLida,
  type ArquivoSusGerado,
  type EspelhoAih,
  esquemaAihLida,
  esquemaArquivoSusGerado,
  esquemaEspelhoAih,
  esquemaFaixaAihLida,
  esquemaInternacaoParaAih,
  esquemaPaginaAihs,
  esquemaPaginaRetornosSus,
  esquemaResultadoRetornoSus,
  esquemaRetornoSusLido,
  type FaixaAihLida,
  type FiltroAihs,
  type FiltroRetornosSus,
  type GerarSisaihEntrada,
  type ImportarRetornoSusEntrada,
  type InternacaoParaAih,
  type PaginaAihs,
  type PaginaRetornosSus,
  type RegistrarAihEntrada,
  type RegistrarFaixaAihEntrada,
  type ResultadoRetornoSus,
  type RetornoSusLido,
  type TratarRetornoSusEntrada,
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

export const esquemaPainelAih = z.object({
  liberado: z.boolean(),
  retornoBpaLiberado: z.boolean(),
  parametros: z.object({ cnes: z.boolean(), diretorClinico: z.boolean(), diariasUti: z.number().int() }),
  faixas: z.array(esquemaFaixaAihLida),
  leitosUti: z.array(z.object({ tipo: z.number().int(), nome: z.string(), leitos: z.number().int() })),
  porSituacao: z.record(z.string(), z.number().int()),
  leiauteConferido: z.boolean(),
});
export type PainelAih = z.infer<typeof esquemaPainelAih>;

export async function lerPainelAih(buscar: typeof fetch = fetch): Promise<PainelAih> {
  return lerJson(await buscar(`${BASE}/aih/painel`, { headers: JSON_ACEITO }), esquemaPainelAih);
}

export async function lerAihs(f: Partial<FiltroAihs>, buscar: typeof fetch = fetch): Promise<PaginaAihs> {
  return lerJson(
    await buscar(
      `${BASE}/aih${consulta({
        situacao: f.situacao,
        numero: f.numero,
        prontuario: f.prontuario,
        registro: f.registro,
        pagina: f.pagina ?? 0,
        porPagina: f.porPagina ?? 50,
      })}`,
      { headers: JSON_ACEITO },
    ),
    esquemaPaginaAihs,
  );
}

export async function lerInternacaoAih(
  registro: number,
  buscar: typeof fetch = fetch,
): Promise<InternacaoParaAih> {
  return lerJson(
    await buscar(`${BASE}/aih/internacao/${encodeURIComponent(String(registro))}`, { headers: JSON_ACEITO }),
    esquemaInternacaoParaAih,
  );
}

export async function registrarAih(e: RegistrarAihEntrada, buscar: typeof fetch = fetch): Promise<AihLida> {
  return lerJson(await buscar(`${BASE}/aih`, escrita(e)), esquemaAihLida);
}

export async function lerEspelhoAih(id: number, buscar: typeof fetch = fetch): Promise<EspelhoAih> {
  return lerJson(await buscar(`${BASE}/aih/${id}/espelho`, { headers: JSON_ACEITO }), esquemaEspelhoAih);
}

export async function lerFaixasAih(buscar: typeof fetch = fetch): Promise<FaixaAihLida[]> {
  return lerJson(await buscar(`${BASE}/aih/faixas`, { headers: JSON_ACEITO }), z.array(esquemaFaixaAihLida));
}

export async function registrarFaixaAih(
  e: RegistrarFaixaAihEntrada,
  buscar: typeof fetch = fetch,
): Promise<FaixaAihLida> {
  return lerJson(await buscar(`${BASE}/aih/faixas`, escrita(e)), esquemaFaixaAihLida);
}

export async function gerarSisaih(
  e: GerarSisaihEntrada,
  buscar: typeof fetch = fetch,
): Promise<ArquivoSusGerado> {
  return lerJson(await buscar(`${BASE}/aih/arquivo`, escrita(e)), esquemaArquivoSusGerado);
}

/** O endereço do download do SISAIH01 (a rota da AIH; auditado no servidor). */
export function enderecoArquivoAih(id: number): string {
  return `${BASE}/aih/arquivos/${id}/conteudo`;
}

export async function lerRetornosSus(
  f: Partial<FiltroRetornosSus>,
  buscar: typeof fetch = fetch,
): Promise<PaginaRetornosSus> {
  return lerJson(
    await buscar(
      `${BASE}/retorno${consulta({
        instrumento: f.instrumento,
        competencia: f.competencia,
        situacao: f.situacao,
        tratamento: f.tratamento,
        pagina: f.pagina ?? 0,
        porPagina: f.porPagina ?? 50,
      })}`,
      { headers: JSON_ACEITO },
    ),
    esquemaPaginaRetornosSus,
  );
}

export async function importarRetornoSus(
  e: ImportarRetornoSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<ResultadoRetornoSus> {
  return lerJson(await buscar(`${BASE}/retorno`, escrita(e)), esquemaResultadoRetornoSus);
}

export async function tratarRetornoSus(
  e: TratarRetornoSusEntrada,
  buscar: typeof fetch = fetch,
): Promise<RetornoSusLido> {
  return lerJson(await buscar(`${BASE}/retorno/tratamento`, escrita(e)), esquemaRetornoSusLido);
}
