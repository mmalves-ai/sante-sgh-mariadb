// Escopo da regra de campo do cadastro (F3.1, 02-CAD linha 2). A tela que abre a ficha do paciente a partir de um
// atendimento (recepção, abertura do atendimento) passa o escopo em que trabalha na consulta da rota da ficha
// (?modulo=&tipoAtendimento=&fontePagadora=); a ficha repassa o mesmo escopo na consulta do POST/PUT de pacientes, e o
// servidor aplica a regra mais específica. Valor inválido ou ausente fica de fora (vale a regra geral), igual ao
// servidor (apps/api/src/modulos/cadastro/cadastro-com-regra.ts, escopoDaConsulta).

export const TIPOS_ATENDIMENTO_ESCOPO = [
  'ambulatorial',
  'urgencia',
  'internacao',
  'externo',
  'domiciliar',
] as const;

export interface EscopoRegraCampo {
  readonly modulo: number | null;
  readonly tipoAtendimento: (typeof TIPOS_ATENDIMENTO_ESCOPO)[number] | null;
  readonly fontePagadora: number | null;
}

const primeiro = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const idPositivo = (v: unknown): number | null => {
  const x = primeiro(v);
  const n = typeof x === 'string' && /^\d{1,15}$/.test(x) ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Lê o escopo da consulta da rota da ficha (o que o vue-router entrega em `route.query`). */
export function escopoDaRota(q: Readonly<Record<string, unknown>>): EscopoRegraCampo {
  const tipo = primeiro(q['tipoAtendimento']);
  return {
    modulo: idPositivo(q['modulo']),
    tipoAtendimento:
      typeof tipo === 'string' && (TIPOS_ATENDIMENTO_ESCOPO as readonly string[]).includes(tipo)
        ? (tipo as EscopoRegraCampo['tipoAtendimento'])
        : null,
    fontePagadora: idPositivo(q['fontePagadora']),
  };
}

/** Consulta para o POST/PUT de pacientes: vazia sem escopo, senão `?modulo=..&tipoAtendimento=..&fontePagadora=..`. */
export function consultaDoEscopo(e: EscopoRegraCampo | null | undefined): string {
  if (!e) return '';
  const p = new URLSearchParams();
  if (e.modulo !== null) p.set('modulo', String(e.modulo));
  if (e.tipoAtendimento !== null) p.set('tipoAtendimento', e.tipoAtendimento);
  if (e.fontePagadora !== null) p.set('fontePagadora', String(e.fontePagadora));
  const s = p.toString();
  return s ? `?${s}` : '';
}
