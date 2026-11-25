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

// ── Escopo da tela que abre o atendimento ──
// A recepção ambulatorial, o pronto atendimento, os exames e a admissão da internação passam o escopo em que trabalham
// à ficha do paciente e à conferência dos campos pendentes. O tipo da regra sai do tipo com que a tela abre, igual ao
// domínio (tipoAtendimentoDaAbertura, @sgh/dominio-cadastro).
const TIPO_REGRA_DA_ABERTURA: Readonly<Record<string, EscopoRegraCampo['tipoAtendimento']>> = {
  consulta: 'ambulatorial',
  pa: 'urgencia',
  exame: 'externo',
  requisicaoLab: 'externo',
  internacao: 'internacao',
  domiciliar: 'domiciliar',
};

/** Escopo da tela de abertura: o tipo escolhido, o convênio escolhido e o módulo de recepção (se a tela tem um). */
export function escopoDaAbertura(a: {
  readonly tipo?: string | null | undefined;
  readonly convenio?: string | number | null | undefined;
  readonly modulo?: string | number | null | undefined;
}): EscopoRegraCampo {
  const tipo = a.tipo ?? '';
  return {
    modulo: idPositivo(a.modulo),
    tipoAtendimento: Object.prototype.hasOwnProperty.call(TIPO_REGRA_DA_ABERTURA, tipo)
      ? (TIPO_REGRA_DA_ABERTURA[tipo] ?? null)
      : null,
    fontePagadora: idPositivo(a.convenio),
  };
}

/** O escopo como consulta de rota do vue-router (`{ path, query }`): só o que está preenchido. */
export function consultaDeRotaDoEscopo(e: EscopoRegraCampo | null | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(consultaDoEscopo(e).slice(1)));
}

// ── Recusa da abertura pelo servidor ──
// Quando o aviso prévio não apareceu (sem acesso à leitura do cadastro, consulta em erro, cadastro alterado depois do
// aviso), a gravação volta recusada com o código `cadastro-incompleto` e os campos que faltam. A tela mostra os campos
// pelo rótulo padrão (os mesmos do domínio: CAMPOS_REGRA_PACIENTE, @sgh/dominio-cadastro) e o atalho para a ficha.
export const ROTULOS_CAMPO_CADASTRO: Readonly<Record<string, string>> = Object.freeze({
  nome: 'Nome',
  nascimento: 'Data de nascimento',
  sexo: 'Sexo',
  cpf: 'CPF',
  naturalidade: 'Naturalidade',
  cep: 'CEP',
  nomeMae: 'Nome da mãe',
  ufNaturalidade: 'UF da naturalidade',
  logradouro: 'Logradouro',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  celular: 'Celular',
  telefone: 'Telefone',
  email: 'E-mail',
  contatoNome: 'Nome do contato',
  contatoTelefone: 'Telefone do contato',
});

/**
 * Os campos do cadastro que faltam, pelo rótulo, quando o erro da gravação é a recusa `cadastro-incompleto` (o erro da
 * API traz o Problem Details em `problema`); nulo quando o erro é outro.
 */
export function camposDaRecusaDeCadastro(erro: unknown): string[] | null {
  const p = erro && typeof erro === 'object' ? (erro as { readonly problema?: unknown }).problema : undefined;
  if (!p || typeof p !== 'object') return null;
  const o = p as Readonly<Record<string, unknown>>;
  if (o['codigo'] !== 'cadastro-incompleto') return null;
  const campos = Array.isArray(o['campos']) ? o['campos'] : [];
  return campos
    .filter((c): c is string => typeof c === 'string' && c !== '')
    .map((c) =>
      Object.prototype.hasOwnProperty.call(ROTULOS_CAMPO_CADASTRO, c) ? (ROTULOS_CAMPO_CADASTRO[c] ?? c) : c,
    );
}
