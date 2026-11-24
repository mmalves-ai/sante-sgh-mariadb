// Cliente das telas da agenda de exames (M18), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar: repetir o mesmo pedido não grava duas vezes); Problem Details viram
// ErroApi e o código da recusa (ex.: horario-ocupado) fica em `problema.codigo` para a tela mostrar o texto certo.
import {
  type BuscaVagasExame,
  type DetalheAgendaExame,
  esquemaBuscaVagasExame,
  esquemaDetalheAgendaExame,
  esquemaGradeExame,
  esquemaGravacaoAgenda,
  esquemaListaAgendasExame,
  esquemaListaCancelamentosExame,
  esquemaListaMarcacoesExame,
  esquemaMarcacaoExameDetalhe,
  esquemaOpcoesExame,
  esquemaPreviaGradeExame,
  esquemaResiduoExame,
  esquemaResultadoAgenda,
  type GradeExame,
  type GravacaoAgenda,
  type ListaAgendasExame,
  type ListaCancelamentosExame,
  type ListaMarcacoesExame,
  type MarcacaoExameDetalhe,
  type OpcoesExame,
  type PreviaGradeExame,
  type ResiduoExameResposta,
  type ResultadoAgenda,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { ErroApi, erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/agenda/exames';

export async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
export const ler = async <T>(url: string, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(await fetch(url, { headers: JSON_ACEITO }), esquema);

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m18.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  chave: string,
): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquema);
}
export const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoAgenda> =>
  enviar(url, corpo, esquemaResultadoAgenda, chave);

export const qs = (o: Record<string, string | number | null | undefined | boolean>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** Código da recusa de negócio (extras.codigo do Problem Details), quando houver. */
export function codigoDaRecusa(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const c = (e.problema as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' ? c : null;
}

/** 02-AGE 42 e 44: ids dos pacientes de mesmo nome e nascimento devolvidos na recusa da marcação sem prontuário. */
export function candidatosDaRecusa(e: unknown): number[] {
  if (!(e instanceof ErroApi)) return [];
  const d = (e.problema as { dependentes?: { rotulo?: unknown; amostra?: unknown }[] } | null)?.dependentes;
  const p = Array.isArray(d) ? d.find((x) => x.rotulo === 'paciente') : undefined;
  return Array.isArray(p?.amostra) ? p.amostra.map(Number).filter((n) => n > 0) : [];
}

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────
export const lerOpcoesExame = (): Promise<OpcoesExame> => ler(`${P}/opcoes`, esquemaOpcoesExame);
export const lerGravacaoExame = (): Promise<GravacaoAgenda> => ler(`${P}/gravacao`, esquemaGravacaoAgenda);
export const listarAgendasExame = (
  f: { termo?: string | undefined; situacao?: string | undefined; categoria?: number | null } = {},
): Promise<ListaAgendasExame> => ler(`${P}/agendas${qs(f)}`, esquemaListaAgendasExame);
export const lerAgendaExame = (id: number): Promise<DetalheAgendaExame> =>
  ler(`${P}/agendas/${id}`, esquemaDetalheAgendaExame);
export const lerGradeExame = (agenda: number, de: string | null, ate: string | null): Promise<GradeExame> =>
  ler(`${P}/grade${qs({ agenda, de, ate })}`, esquemaGradeExame);
export const buscarVagasExame = (f: {
  agenda?: number | null;
  categoria?: number | null;
  convenio?: number | null;
  exame?: number | null;
  de?: string | null;
  ate?: string | null;
}): Promise<BuscaVagasExame> => ler(`${P}/vagas${qs(f)}`, esquemaBuscaVagasExame);
export const listarMarcacoesExame = (
  data: string | null,
  agenda: number | null,
): Promise<ListaMarcacoesExame> => ler(`${P}/marcacoes${qs({ data, agenda })}`, esquemaListaMarcacoesExame);
export const lerMarcacaoExame = (id: number): Promise<MarcacaoExameDetalhe> =>
  ler(`${P}/marcacoes/${id}`, esquemaMarcacaoExameDetalhe);
export const lerExamesDoPaciente = (id: number): Promise<ListaMarcacoesExame> =>
  ler(`${P}/pacientes/${id}/marcacoes`, esquemaListaMarcacoesExame);
export const listarCancelamentosExame = (f: {
  de?: string | null;
  ate?: string | null;
  agenda?: number | null;
  pagina?: number;
}): Promise<ListaCancelamentosExame> => ler(`${P}/cancelamentos${qs(f)}`, esquemaListaCancelamentosExame);
export const lerResiduoExame = (de: string | null, ate: string | null): Promise<ResiduoExameResposta> =>
  ler(`${P}/residuo${qs({ de, ate })}`, esquemaResiduoExame);

// ── Prévia (nada é gravado) e gravações ──────────────────────────────────────────────────────────────
export const previaGradeExame = (p: unknown): Promise<PreviaGradeExame> =>
  enviar(`${P}/grade/previa`, p, esquemaPreviaGradeExame, novaChave('previa'));
export const gerarGradeExame = (p: unknown, k: string) => gravar(`${P}/grade/gerar`, p, k);
export const definirConvenioExame = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendas/${id}/convenios`, p, k);
export const definirExameCoberto = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendas/${id}/exames`, p, k);
export const marcarExame = (p: unknown, k: string) => gravar(`${P}/marcacoes`, p, k);
/** 02-AGE 44: marcação para quem ainda não tem prontuário (pré-cadastro na mesma gravação). */
export const marcarExameSemProntuario = (p: unknown, k: string) =>
  gravar(`${P}/marcacoes/sem-prontuario`, p, k);
export const cancelarExame = (id: number, p: unknown, k: string) =>
  gravar(`${P}/marcacoes/${id}/cancelar`, p, k);
export const remarcarExame = (id: number, p: unknown, k: string) =>
  gravar(`${P}/marcacoes/${id}/remarcar`, p, k);
