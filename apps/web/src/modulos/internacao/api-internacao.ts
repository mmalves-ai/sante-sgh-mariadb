// Cliente das telas do M16 (painel de leitos, divergência, censo, painéis, indicadores e BI), validado pelos
// contratos. Só leitura. Problem Details viram ErroApi (mensagem em português na tela).
import {
  type CensoDia,
  type ConsultaIndicador,
  type DivergenciasLeitos,
  esquemaCensoDia,
  esquemaDivergenciasLeitos,
  esquemaIndiceIndicadores,
  esquemaInternacoesMarcadas,
  esquemaLiberacaoM16,
  esquemaPacienteDoLeito,
  esquemaPainelGerencial,
  esquemaPainelLeitos,
  esquemaSaudeVigia,
  esquemaSerieCenso,
  esquemaSerieIndicador,
  type IndiceIndicadores,
  type InternacoesMarcadas,
  type LiberacaoM16,
  type PacienteDoLeito,
  type PainelGerencial,
  type PainelGerencialDados,
  type PainelLeitos,
  type SaudeVigia,
  type SerieCenso,
  type SerieIndicador,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

/** Planilha (texto CSV) de uma rota de exportação. */
async function lerTexto(url: string, buscar: typeof fetch = fetch): Promise<string> {
  const r = await buscar(url, { headers: { accept: 'text/csv' } });
  if (!r.ok) throw await erroDaResposta(r);
  return r.text();
}

export function consulta(x: Readonly<Record<string, string | number | undefined | null>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const lerLiberacaoM16 = (b: typeof fetch = fetch): Promise<LiberacaoM16> =>
  ler('/api/internacao/liberacao', esquemaLiberacaoM16, b);

export const lerPainelLeitos = (abertura: boolean, b: typeof fetch = fetch): Promise<PainelLeitos> =>
  ler(`/api/internacao/leitos/painel${abertura ? '?abertura=1' : ''}`, esquemaPainelLeitos, b);

export const lerPacienteDoLeito = (internacao: number, b: typeof fetch = fetch): Promise<PacienteDoLeito> =>
  ler(`/api/internacao/leitos/painel/${internacao}/paciente`, esquemaPacienteDoLeito, b);

export const lerDivergencias = (b: typeof fetch = fetch): Promise<DivergenciasLeitos> =>
  ler('/api/internacao/leitos/divergencias', esquemaDivergenciasLeitos, b);

export const lerCenso = (data: string | undefined, b: typeof fetch = fetch): Promise<CensoDia> =>
  ler(`/api/internacao/censo${consulta({ data })}`, esquemaCensoDia, b);

export const lerSerieCenso = (
  de: string,
  ate: string,
  agrupamento: 'dia' | 'mes',
  b: typeof fetch = fetch,
): Promise<SerieCenso> =>
  ler(`/api/internacao/censo/serie${consulta({ de, ate, agrupamento })}`, esquemaSerieCenso, b);

export const lerInternacoesMarcadas = (b: typeof fetch = fetch): Promise<InternacoesMarcadas> =>
  ler('/api/internacao/censo/marcadas', esquemaInternacoesMarcadas, b);

export const exportarInternacoesMarcadas = (b: typeof fetch = fetch): Promise<string> =>
  lerTexto('/api/internacao/censo/marcadas/exportar', b);

export const exportarCenso = (
  q: { data?: string; de?: string; ate?: string; agrupamento?: string },
  b: typeof fetch = fetch,
): Promise<string> => lerTexto(`/api/internacao/censo/exportar${consulta(q)}`, b);

export const lerPainelGerencial = (
  painel: PainelGerencial,
  de: string | undefined,
  ate: string | undefined,
  b: typeof fetch = fetch,
): Promise<PainelGerencialDados> =>
  ler(`/api/relatorios/paineis/${painel}${consulta({ de, ate })}`, esquemaPainelGerencial, b);

export const lerIndice = (de?: string, ate?: string, b: typeof fetch = fetch): Promise<IndiceIndicadores> =>
  ler(`/api/relatorios/indicadores${consulta({ de, ate })}`, esquemaIndiceIndicadores, b);

type FiltroIndicador = Partial<ConsultaIndicador>;

export const lerSerieIndicador = (
  codigo: string,
  f: FiltroIndicador,
  b: typeof fetch = fetch,
): Promise<SerieIndicador> =>
  ler(`/api/relatorios/indicadores/${encodeURIComponent(codigo)}${consulta(f)}`, esquemaSerieIndicador, b);

export const exportarIndicador = (
  codigo: string,
  f: FiltroIndicador,
  b: typeof fetch = fetch,
): Promise<string> =>
  lerTexto(`/api/relatorios/indicadores/${encodeURIComponent(codigo)}/exportar${consulta(f)}`, b);

const esquemaDestinoBi = z.object({
  ligado: z.boolean(),
  endereco: z.string().nullable(),
  motivo: z.string().nullable(),
  pendencias: z.array(z.string()),
});
export type DestinoBi = z.infer<typeof esquemaDestinoBi>;

export const lerBi = (b: typeof fetch = fetch): Promise<DestinoBi> =>
  ler('/api/relatorios/bi', esquemaDestinoBi, b);

export const lerSaudeVigia = (b: typeof fetch = fetch): Promise<SaudeVigia> =>
  ler('/api/integracao/vigia/saude', esquemaSaudeVigia, b);
