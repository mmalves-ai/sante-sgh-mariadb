// Regras puras das telas do M27 (sem rede): o filtro da fila do médico, a classe visual de cada pendência, a montagem
// dos destinos da mensagem e a validação local antes de enviar (o servidor valida de novo).
import {
  dadoPessoalNoTexto,
  type DestinoMensagem,
  esquemaEnviarMensagem,
  esquemaPublicarComunicado,
  type LinhaWorklistMedico,
  type TipoDestinoMensagem,
  type TipoPendenciaMedico,
} from '@sgh/contratos';

export type FiltroMedico = 'todos' | 'pendentes' | 'internados';

export function filtrarFilaMedico(
  ps: readonly LinhaWorklistMedico[],
  f: FiltroMedico,
): readonly LinhaWorklistMedico[] {
  if (f === 'pendentes') return ps.filter((p) => p.pendencias.length > 0);
  if (f === 'internados') return ps.filter((p) => p.tipo === 'internacao');
  return ps;
}

/** As pendências que pedem ação já (vermelho), as de prazo (amarelo) e as informativas. */
export function nivelDaPendencia(t: TipoPendenciaMedico): 'urgente' | 'prazo' | 'informativa' {
  if (t === 'critico-nao-visto' || t === 'sem-evolucao-24h') return 'urgente';
  if (t === 'prescricao-a-renovar' || t === 'parecer-atrasado') return 'prazo';
  return 'informativa';
}

/** Acrescenta um destino sem repetir (mesmo tipo e valor, sem diferença de maiúsculas). */
export function adicionarDestino(
  ds: readonly DestinoMensagem[],
  tipo: TipoDestinoMensagem,
  valor: string,
): DestinoMensagem[] {
  const v = valor.trim();
  if (!v) return [...ds];
  const normal = tipo === 'usuario' || tipo === 'grupo' ? v.toUpperCase() : v;
  if (ds.some((d) => d.tipo === tipo && d.valor.toUpperCase() === normal.toUpperCase())) return [...ds];
  return [...ds, { tipo, valor: normal }];
}

export interface RascunhoMensagem {
  readonly assunto: string;
  readonly texto: string;
  readonly destinos: readonly DestinoMensagem[];
  readonly cienciaObrigatoria: boolean;
  readonly contexto: string;
}

export interface RascunhoComunicado extends RascunhoMensagem {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
}

/** Erros por campo (a primeira mensagem de cada um), vazio quando passa. */
export type ErrosDoFormulario = Partial<Record<string, string>>;

function errosDe(issues: readonly { path: readonly PropertyKey[]; message: string }[]): ErrosDoFormulario {
  const e: ErrosDoFormulario = {};
  for (const i of issues) {
    const campo = String(i.path[0] ?? 'formulario');
    e[campo] ??= i.message;
  }
  return e;
}

function contextoDe(c: string): number | null | 'invalido' {
  const t = c.trim();
  if (!t) return null;
  return /^\d{1,10}$/.test(t) && Number(t) > 0 ? Number(t) : 'invalido';
}

/** Regra 7 na tela: o assunto também não leva dado do paciente (o esquema só olha o texto). */
function assuntoComDado(assunto: string): string | null {
  const m = dadoPessoalNoTexto(assunto);
  return m
    ? `O assunto parece ter ${m}. Não escreva dado do paciente: use o campo "Paciente (contexto)".`
    : null;
}

export function validarMensagem(r: RascunhoMensagem) {
  const ctx = contextoDe(r.contexto);
  const p = esquemaEnviarMensagem.safeParse({
    assunto: r.assunto,
    texto: r.texto,
    destinos: r.destinos,
    cienciaObrigatoria: r.cienciaObrigatoria,
    contextoAtendimento: ctx === 'invalido' ? null : ctx,
  });
  const erros = p.success ? {} : errosDe(p.error.issues);
  const a = assuntoComDado(r.assunto);
  if (a) erros['assunto'] ??= a;
  if (ctx === 'invalido') erros['contextoAtendimento'] = 'Informe só o número do atendimento.';
  return Object.keys(erros).length === 0 && p.success
    ? { ok: true as const, valor: p.data }
    : { ok: false as const, erros };
}

/** O datetime-local do navegador (AAAA-MM-DDTHH:MM) como o contrato pede. */
const dataHora = (v: string) => v.trim().slice(0, 16);

export function validarComunicado(r: RascunhoComunicado) {
  const p = esquemaPublicarComunicado.safeParse({
    assunto: r.assunto,
    texto: r.texto,
    destinos: r.destinos,
    cienciaObrigatoria: r.cienciaObrigatoria,
    vigenciaInicio: dataHora(r.vigenciaInicio),
    vigenciaFim: dataHora(r.vigenciaFim),
  });
  const erros = p.success ? {} : errosDe(p.error.issues);
  const a = assuntoComDado(r.assunto);
  if (a) erros['assunto'] ??= a;
  return Object.keys(erros).length === 0 && p.success
    ? { ok: true as const, valor: p.data }
    : { ok: false as const, erros };
}

/** Filtro do dicionário: sem diferença de acento e de maiúsculas. */
export function filtrarPalavras<T extends { palavra: string }>(
  ps: readonly T[],
  termo: string,
): readonly T[] {
  const n = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const t = n(termo.trim());
  return t ? ps.filter((p) => n(p.palavra).includes(t)) : ps;
}

// ── W0-09: ciclo de vida do comunicado ───────────────────────────────────────────────────────────────

/** O motivo das ações do comunicado: ao menos 5 caracteres (o servidor confere de novo). */
export const motivoValido = (m: string): boolean => m.trim().length >= 5;

/** O valor anterior gravado no evento de correção (JSON com o assunto e o texto) como texto legível. */
export function anteriorDoEvento(antes: string): string {
  try {
    const v = JSON.parse(antes) as { assunto?: unknown; texto?: unknown };
    if (v && typeof v === 'object' && typeof v.assunto === 'string')
      return typeof v.texto === 'string' ? `${v.assunto}: ${v.texto}` : v.assunto;
  } catch {
    // não é JSON: mostra como veio
  }
  return antes;
}
