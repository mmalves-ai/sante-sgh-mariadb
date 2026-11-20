// Cliente das telas da recepção (M19), validado pelos contratos. As gravações vão com o CSRF e a Idempotency-Key (uma
// por intenção de gravar: repetir o mesmo pedido não grava duas vezes). O totem e as TVs falam com a API pelo token do
// dispositivo (cabeçalho x-sgh-dispositivo), nunca com sessão de pessoa. Problem Details viram ErroApi; o código da
// recusa (ex.: fila-vazia) fica em `problema.codigo` para a tela mostrar o texto certo.
import {
  type AgendadosDoDia,
  type ApoioRecepcao,
  type DispositivoCriado,
  type DispositivoLido,
  esquemaAgendadosDoDia,
  esquemaApoioRecepcao,
  esquemaDispositivoCriado,
  esquemaDispositivoLido,
  esquemaFilaGuiche,
  esquemaGravacaoRecepcao,
  esquemaIndicadoresRecepcao,
  esquemaModeloTermo,
  esquemaTermoAssinado,
  esquemaTermosDoPaciente,
  type ModeloTermo,
  type TermosDoPaciente,
  esquemaPainelChamadas,
  esquemaPainelSupervisor,
  esquemaPainelTvLido,
  esquemaResultadoRecepcao,
  esquemaSenhaEmitida,
  esquemaTelaPainelTv,
  esquemaTotemConfig,
  type FilaGuiche,
  type GravacaoRecepcao,
  type IndicadoresRecepcao,
  type PainelChamadas,
  type PainelSupervisor,
  type PainelTvLido,
  type ResultadoRecepcao,
  type SenhaEmitida,
  type TelaPainelTv,
  type TotemConfig,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { ErroApi, erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const R = '/api/recepcao';
const D = '/api/dispositivo';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const ler = async <T>(url: string, esquema: z.ZodType<T>): Promise<T> =>
  lerJson(await fetch(url, { headers: JSON_ACEITO }), esquema);

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `recepcao.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(
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
): Promise<T> {
  const r = await fetch(url, {
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
  enviar<ResultadoRecepcao>(url, corpo, esquemaResultadoRecepcao, chave, metodo);

const qs = (o: Record<string, string | number | null | undefined>) => {
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

// ── Sessão de pessoa (guichê, supervisor, configuração) ─────────────────────────────────────────

export const lerGravacao = (): Promise<GravacaoRecepcao> => ler(`${R}/gravacao`, esquemaGravacaoRecepcao);
export const lerApoio = (): Promise<ApoioRecepcao> => ler(`${R}/apoio`, esquemaApoioRecepcao);
export const lerFila = (p: {
  recepcao: number;
  local: number;
  guiche: number;
  geradores: number[];
}): Promise<FilaGuiche> =>
  ler(`${R}/fila${qs({ ...p, geradores: p.geradores.join(',') })}`, esquemaFilaGuiche);
/** Os agendados do dia pela busca (CPF, prontuário, parte do nome da agenda); `cortada` pede para refinar. */
export const lerAgendados = (
  f: { cpf?: string | null; prontuario?: number | null; agenda?: string | null } = {},
): Promise<AgendadosDoDia> =>
  ler(
    `${R}/agendados${qs({ cpf: f.cpf || null, prontuario: f.prontuario || null, agenda: f.agenda || null })}`,
    esquemaAgendadosDoDia,
  );
export const lerSupervisor = (recepcao: number | null): Promise<PainelSupervisor> =>
  ler(`${R}/supervisor${qs({ recepcao })}`, esquemaPainelSupervisor);
export const lerIndicadores = (
  de: string,
  ate: string,
  recepcao: number | null,
): Promise<IndicadoresRecepcao> =>
  ler(`${R}/indicadores${qs({ de, ate, recepcao })}`, esquemaIndicadoresRecepcao);
export const listarDispositivos = (): Promise<DispositivoLido[]> =>
  ler(`${R}/dispositivos`, z.array(esquemaDispositivoLido));
export const listarUsuariosTecnicos = (): Promise<string[]> =>
  ler(`${R}/usuarios-tecnicos`, z.array(z.string()));
export const listarPaineisTv = (): Promise<PainelTvLido[]> =>
  ler(`${R}/paineis-tv`, z.array(esquemaPainelTvLido));

export const abrirGuiche = (p: { recepcao: number; local: number; guiche: number }, k: string) =>
  gravar(`${R}/guiche/abrir`, p, k);
export const fecharGuiche = (
  p: { recepcao: number; local: number; guiche: number; justificativa?: string | null },
  k: string,
) => gravar(`${R}/guiche/fechar`, p, k);
export const emitirNoBalcao = (p: { gerador: number; prioridade: string; grupo: number | null }, k: string) =>
  gravar(`${R}/senhas`, { ...p, origem: 'balcao' }, k);
export const chamarProxima = (
  p: { recepcao: number; local: number; guiche: number; geradores: number[]; senha?: number | null },
  k: string,
) => gravar(`${R}/senhas/chamar`, p, k);
export const registrarEvento = (
  senha: number,
  p: {
    evento: string;
    local: number;
    guiche: number;
    motivo?: string | null;
    complemento?: string | null;
    destino?: number | null;
  },
  k: string,
) => gravar(`${R}/senhas/${senha}/eventos`, p, k);
export const registrarChegada = (
  senha: number,
  p: { tipo: 'consulta' | 'exame'; marcacao: number },
  k: string,
) => gravar(`${R}/senhas/${senha}/chegada`, p, k);
/** W1-04: desfaz a chegada (fato novo com o motivo; a marcação volta ao estado anterior; ficha aberta recusa). */
export const desfazerChegada = (senha: number, motivo: string, k: string) =>
  gravar(`${R}/senhas/${senha}/chegada/desfazer`, { motivo }, k);

// ── W1-04: termos de consentimento e LGPD (modelos versionados, assinatura no balcão, revogação) ──
const T = `${R}/termos`;
const OK = z.object({ ok: z.literal(true), mensagem: z.string() });
export const lerModelosTermo = (): Promise<ModeloTermo[]> => ler(`${T}/modelos`, z.array(esquemaModeloTermo));
export const lerTermosDoPaciente = (prontuario: number, tipo?: string | null): Promise<TermosDoPaciente> =>
  ler(`${T}/paciente${qs({ prontuario, tipo })}`, esquemaTermosDoPaciente);
export const incluirModeloTermo = (p: unknown, k: string) => enviar(`${T}/modelos`, p, OK, k);
export const novaVersaoTermo = (codigo: string, p: unknown, k: string) =>
  enviar(`${T}/modelos/${encodeURIComponent(codigo)}/versoes`, p, OK, k);
export const situacaoModeloTermo = (codigo: string, p: { ativo: boolean; motivo: string }, k: string) =>
  enviar(`${T}/modelos/${encodeURIComponent(codigo)}/situacao`, p, OK, k);
export const excluirModeloTermo = (codigo: string, motivo: string, k: string) =>
  enviar(`${T}/modelos/${encodeURIComponent(codigo)}/excluir`, { motivo }, OK, k);
export const assinarTermo = (p: unknown, k: string) => enviar(`${T}/assinaturas`, p, esquemaTermoAssinado, k);
export const revogarTermo = (id: number, motivo: string, k: string) =>
  enviar(`${T}/assinaturas/${id}/revogar`, { motivo }, OK, k);
export const configurarFila = (gerador: number, p: unknown, k: string) =>
  enviar(`${R}/filas/${gerador}`, p, z.object({ ok: z.literal(true), mensagem: z.string() }), k, 'PUT');
export const criarDispositivo = (p: unknown, k: string): Promise<DispositivoCriado> =>
  enviar(`${R}/dispositivos`, p, esquemaDispositivoCriado, k);
/** W1-04: nome, conteúdo, locais e recepção sem reemitir o token (o aparelho segue com o que tem). */
export const alterarDispositivo = (id: number, p: unknown, k: string): Promise<DispositivoLido> =>
  enviar(`${R}/dispositivos/${id}`, p, esquemaDispositivoLido, k, 'PUT');
export const renovarDispositivo = (id: number, validadeDias: number, k: string): Promise<DispositivoCriado> =>
  enviar(`${R}/dispositivos/${id}/renovar`, { validadeDias }, esquemaDispositivoCriado, k);
/** M43 (regra 4): o login de TV ou de totem substituído pelo aparelho e a conferência no setor. */
export const conferirDispositivo = (
  id: number,
  loginSubstituido: string,
  k: string,
): Promise<DispositivoLido> =>
  enviar(`${R}/dispositivos/${id}/conferir`, { loginSubstituido }, esquemaDispositivoLido, k);
export const revogarDispositivo = (id: number, k: string) =>
  enviar(`${R}/dispositivos/${id}/revogar`, {}, z.object({ ok: z.literal(true), mensagem: z.string() }), k);

// ── Dispositivo (totem e TVs: o token do aparelho) ──────────────────────────────────────────────

const CHAVE_TOKEN = 'sgh.dispositivo.';

/**
 * O token do aparelho: chega uma vez pelo fragmento do endereço (#token=…, que não vai ao servidor nem aos logs) e
 * fica guardado neste navegador para o dispositivo; o fragmento é apagado da barra de endereço.
 */
export function tokenDoAparelho(dispositivo: string): string | null {
  try {
    const m = /(?:^|[#&])token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(globalThis.location?.hash ?? '');
    if (m?.[1]) {
      globalThis.localStorage?.setItem(`${CHAVE_TOKEN}${dispositivo}`, m[1]);
      globalThis.history?.replaceState?.(null, '', globalThis.location.pathname);
      return m[1];
    }
    return globalThis.localStorage?.getItem(`${CHAVE_TOKEN}${dispositivo}`) ?? null;
  } catch {
    return null;
  }
}

export function esquecerToken(dispositivo: string): void {
  try {
    globalThis.localStorage?.removeItem(`${CHAVE_TOKEN}${dispositivo}`);
  } catch {
    // Sem armazenamento local: nada a esquecer.
  }
}

const doAparelho = async <T>(
  token: string,
  url: string,
  esquema: z.ZodType<T>,
  corpo?: unknown,
  chave?: string,
): Promise<T> => {
  const r = await fetch(url, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: {
      ...JSON_ACEITO,
      'x-sgh-dispositivo': token,
      ...(corpo === undefined
        ? {}
        : { 'content-type': 'application/json', 'idempotency-key': chave ?? novaChave('totem') }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  return lerJson(r, esquema);
};

export const lerTotem = (token: string): Promise<TotemConfig> =>
  doAparelho(token, `${D}/totem`, esquemaTotemConfig);
export const emitirNoTotem = (
  token: string,
  p: { gerador: number; grupo: number | null },
  k: string,
): Promise<SenhaEmitida> => doAparelho(token, `${D}/totem/senhas`, esquemaSenhaEmitida, p, k);
export const checkinNoTotem = (
  token: string,
  p: { cpf?: string | null; codigo?: string | null; gerador: number },
  k: string,
): Promise<SenhaEmitida> => doAparelho(token, `${D}/totem/checkin`, esquemaSenhaEmitida, p, k);
export const lerPainel = (token: string): Promise<PainelChamadas & { bilhete: string }> =>
  doAparelho(token, `${D}/painel`, esquemaPainelChamadas.extend({ bilhete: z.string() }));
export const lerPainelTv = (token: string): Promise<TelaPainelTv> =>
  doAparelho(token, `${D}/paineltv`, esquemaTelaPainelTv);
/** Endereço do canal de eventos do painel (o EventSource não manda cabeçalho: vai o bilhete de 60 s). */
export const canalDoPainel = (bilhete: string): string => `${D}/painel/eventos${qs({ bilhete })}`;
