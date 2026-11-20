// Cliente das telas da agenda de consultas (M17), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar: repetir o mesmo pedido não grava duas vezes). Problem Details
// viram ErroApi; o código da recusa (ex.: horario-ocupado) fica em `problema.codigo` para a tela mostrar o
// texto certo (textoDaRecusa).
import {
  type BuscaVagas,
  type DetalheAgenda,
  type EscalaAgenda,
  esquemaBuscaVagas,
  esquemaDetalheAgenda,
  esquemaEscalaAgenda,
  esquemaGradeSemana,
  esquemaGravacaoAgenda,
  esquemaIndicadoresAgenda,
  esquemaListaAgendas,
  esquemaListaBloqueios,
  esquemaListaCancelamentos,
  esquemaListaEspera,
  esquemaMarcadosComConvenio,
  esquemaMarcacaoDetalhe,
  esquemaMarcacoesPaciente,
  esquemaOpcoesAgenda,
  esquemaPainelDia,
  esquemaPreviaBloqueio,
  esquemaPreviaGrade,
  esquemaResultadoAgenda,
  esquemaResultadoLote,
  type GradeSemana,
  type GravacaoAgenda,
  type IndicadoresAgenda,
  type ListaAgendas,
  type ListaCancelamentos,
  type ListaEspera,
  type MarcacaoDetalhe,
  type MarcacoesPaciente,
  type OpcoesAgenda,
  type PainelDia,
  type PreviaBloqueio,
  type PreviaGrade,
  type ResultadoAgenda,
  type ResultadoLote,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { ErroApi, erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/agenda/consultas';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `agenda.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
    0,
    80,
  );
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  chave: string,
  metodo: 'POST' | 'PUT' = 'POST',
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: metodo,
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
const gravar = (url: string, corpo: unknown, chave: string, metodo: 'POST' | 'PUT' = 'POST') =>
  enviar<ResultadoAgenda>(url, corpo, esquemaResultadoAgenda, chave, metodo);

const qs = (o: Record<string, string | number | null | undefined | boolean>) => {
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

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────
export const lerOpcoes = (): Promise<OpcoesAgenda> => ler(`${P}/opcoes`, esquemaOpcoesAgenda);
export const lerGravacao = (): Promise<GravacaoAgenda> => ler(`${P}/gravacao`, esquemaGravacaoAgenda);
export const listarAgendas = (
  f: { termo?: string; situacao?: string; especialidade?: number | null } = {},
): Promise<ListaAgendas> => ler(`${P}/agendas${qs(f)}`, esquemaListaAgendas);
export const lerAgenda = (id: number): Promise<DetalheAgenda> =>
  ler(`${P}/agendas/${id}`, esquemaDetalheAgenda);
export const lerEscala = (id: number): Promise<EscalaAgenda> =>
  ler(`${P}/escalas/${id}`, esquemaEscalaAgenda);
export const lerGrade = (agenda: number, inicio: string | null): Promise<GradeSemana> =>
  ler(`${P}/grade${qs({ agenda, inicio })}`, esquemaGradeSemana);
export const buscarVagas = (f: {
  agenda?: number | null;
  especialidade?: number | null;
  profissional?: string | null;
  convenio?: number | null;
  turno?: string | null;
  de?: string | null;
  ate?: string | null;
  unidade?: number | null;
  local?: number | null;
}): Promise<BuscaVagas> => ler(`${P}/vagas${qs(f)}`, esquemaBuscaVagas);
export const lerMarcacao = (id: number): Promise<MarcacaoDetalhe> =>
  ler(`${P}/marcacoes/${id}`, esquemaMarcacaoDetalhe);
export const lerPainelDia = (data: string | null, agenda: number | null): Promise<PainelDia> =>
  ler(`${P}/dia${qs({ data, agenda })}`, esquemaPainelDia);
export const lerMarcacoesPaciente = (id: number): Promise<MarcacoesPaciente> =>
  ler(`${P}/pacientes/${id}/marcacoes`, esquemaMarcacoesPaciente);
export const listarCancelamentos = (f: {
  de?: string | null;
  ate?: string | null;
  agenda?: number | null;
  motivo?: string | null;
  pagina?: number;
}): Promise<ListaCancelamentos> => ler(`${P}/cancelamentos${qs(f)}`, esquemaListaCancelamentos);
export const listarBloqueios = (agenda: number | null, ativos = true) =>
  ler(`${P}/bloqueios${qs({ agenda, ativos: ativos ? null : 'nao' })}`, esquemaListaBloqueios);
export const listarEspera = (
  f: { situacao?: string; agenda?: number | null; especialidade?: number | null } = {},
): Promise<ListaEspera> => ler(`${P}/espera${qs(f)}`, esquemaListaEspera);
export const lerMarcadosComConvenio = (agenda: number, convenio: number) =>
  ler(`${P}/agendas/${agenda}/convenios/${convenio}/marcados`, esquemaMarcadosComConvenio);
export const lerIndicadores = (de: string | null, ate: string | null): Promise<IndicadoresAgenda> =>
  ler(`${P}/indicadores${qs({ de, ate })}`, esquemaIndicadoresAgenda);
export const avaliarEncaixe = (agenda: number, data: string, hora: string) =>
  ler(
    `${P}/encaixes/avaliacao${qs({ agenda, data, hora })}`,
    z
      .object({
        vetos: z.array(z.object({ codigo: z.string(), texto: z.string() })),
        alertas: z.array(z.object({ codigo: z.string(), texto: z.string() })),
      })
      .passthrough(),
  );

// ── Prévias (nada é gravado) ───────────────────────────────────────────────────────────────────────
export const previaGrade = (p: unknown): Promise<PreviaGrade> =>
  enviar(`${P}/grade/previa`, p, esquemaPreviaGrade, novaChave('previa'));
export const previaBloqueio = (p: unknown): Promise<PreviaBloqueio> =>
  enviar(`${P}/bloqueios/previa`, p, esquemaPreviaBloqueio, novaChave('previa-bloqueio'));

// ── Gravações ─────────────────────────────────────────────────────────────────────────────────────
export const incluirAgenda = (p: unknown, k: string) => gravar(`${P}/agendas`, p, k);
export const alterarAgenda = (id: number, p: unknown, k: string) => gravar(`${P}/agendas/${id}`, p, k, 'PUT');
export const definirConvenio = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendas/${id}/convenios`, p, k);
export const definirEspecialidade = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendas/${id}/especialidades`, p, k);
export const revisarLigacao = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendas/${id}/ligacao`, p, k);
export const planejarEscala = (id: number, p: unknown, k: string) => gravar(`${P}/escalas/${id}`, p, k);
export const cancelarEscalaPlanejada = (id: number, versao: number, k: string) =>
  gravar(`${P}/escalas/${id}/planejadas/${versao}/cancelar`, {}, k);
export const gerarGrade = (p: unknown, k: string) => gravar(`${P}/grade/gerar`, p, k);
export const reverterGeracao = (id: number, k: string) => gravar(`${P}/grade/geracoes/${id}/reverter`, {}, k);
export const marcarConsulta = (p: unknown, k: string) => gravar(`${P}/marcacoes`, p, k);
export const encaixar = (p: unknown, k: string) => gravar(`${P}/encaixes`, p, k);
export const cancelarMarcacao = (id: number, p: unknown, k: string) =>
  gravar(`${P}/marcacoes/${id}/cancelar`, p, k);
export const desfazerEncaixe = (id: number, p: unknown, k: string) =>
  gravar(`${P}/marcacoes/${id}/desfazer-encaixe`, p, k);
export const remarcar = (id: number, p: unknown, k: string) => gravar(`${P}/marcacoes/${id}/remarcar`, p, k);
export const confirmar = (id: number, p: unknown, k: string) =>
  gravar(`${P}/marcacoes/${id}/confirmar`, p, k);
export const registrarFalta = (id: number, k: string) => gravar(`${P}/marcacoes/${id}/falta`, {}, k);
export const remarcarLote = (p: unknown, k: string): Promise<ResultadoLote> =>
  enviar(`${P}/remarcar-lote`, p, esquemaResultadoLote, k);
export const bloquear = (p: unknown, k: string) => gravar(`${P}/bloqueios`, p, k);
export const encerrarBloqueio = (agenda: number, id: number, k: string) =>
  gravar(`${P}/bloqueios/${agenda}/${id}/encerrar`, {}, k);
export const incluirEspera = (p: unknown, k: string) => gravar(`${P}/espera`, p, k);
export const ofertarEspera = (id: number, p: unknown, k: string) => gravar(`${P}/espera/${id}/ofertar`, p, k);
export const marcarEspera = (id: number, p: unknown, k: string) => gravar(`${P}/espera/${id}/marcar`, p, k);
export const encerrarEspera = (id: number, p: unknown, k: string) =>
  gravar(`${P}/espera/${id}/encerrar`, p, k);
