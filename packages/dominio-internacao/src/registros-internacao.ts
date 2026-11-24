// Registros da internação além do retrato da admissão (F3.4, 04-INT linhas 65, 67 e 68), regras puras:
//   - quem opera cada unidade: a unidade sem regra cadastrada fica aberta a quem tem a permissão do cargo; a unidade
//     com regra só aceita o usuário listado com a ação marcada (admitir, transferir, dar alta);
//   - os diagnósticos da internação (entrada, secundários, causa externa) como lista com sequência, nunca apagada;
//   - o acidente que motivou a internação, conferido na hora (datas, CNPJ do empregador, dados do trabalho);
//   - a autorização da operadora como histórico: a guia inicial e cada prorrogação com o seu período de validade,
//     sem sobrescrever a anterior.
// Melhoria sobre o retrato único: o período de cada guia é calculado (início + diárias), a prorrogação começa no dia
// seguinte ao fim da anterior quando o usuário não informa, e o total autorizado é a soma das guias.

export type AcaoUnidade = 'admitir' | 'transferir' | 'darAlta';

export interface RegraUnidadeUsuario {
  readonly usuario: number;
  readonly podeAdmitir: boolean;
  readonly podeTransferir: boolean;
  readonly podeDarAlta: boolean;
}

export type DecisaoUnidade =
  { readonly permitido: true } | { readonly permitido: false; readonly motivo: string };

const ROTULO_ACAO: Readonly<Record<AcaoUnidade, string>> = {
  admitir: 'admitir',
  transferir: 'transferir pacientes',
  darAlta: 'dar alta',
};

/** A unidade sem regra fica aberta (o cargo decide); com regra, só o usuário listado com a ação marcada opera. */
export function decidirPermissaoUnidade(
  regras: readonly RegraUnidadeUsuario[],
  usuario: number | null,
  acao: AcaoUnidade,
): DecisaoUnidade {
  if (regras.length === 0) return { permitido: true };
  const r = usuario === null ? undefined : regras.find((x) => x.usuario === usuario);
  const pode =
    r !== undefined &&
    (acao === 'admitir' ? r.podeAdmitir : acao === 'transferir' ? r.podeTransferir : r.podeDarAlta);
  return pode
    ? { permitido: true }
    : {
        permitido: false,
        motivo: `A unidade tem operadores definidos e o seu usuário não está liberado para ${ROTULO_ACAO[acao]} nela.`,
      };
}

// ── Diagnósticos ─────────────────────────────────────────────────────────────────────────────────

export type TipoDiagnosticoInternacao = 'entrada' | 'principal' | 'secundario' | 'causa_externa';
/** Tipos registrados pela tela da internação (alta e óbito vêm do fluxo da alta). */
export const TIPOS_DIAGNOSTICO_TELA: readonly TipoDiagnosticoInternacao[] = [
  'entrada',
  'principal',
  'secundario',
  'causa_externa',
];

export interface DiagnosticoExistente {
  readonly cid: number;
  readonly tipo: string;
  readonly sequencia: number;
}

/** O código do CID-10 sem ponto e em maiúsculas. */
export const codigoCid = (codigo: string): string => codigo.replace(/\./g, '').trim().toUpperCase();

/** Causa externa: só os códigos do capítulo XX do CID-10 (V01 a Y98). */
export function ehCausaExterna(codigo: string): boolean {
  const c = codigoCid(codigo);
  return /^[VWXY]\d{2}/.test(c) && !c.startsWith('V00') && !c.startsWith('Y99');
}

export type ResultadoRegra<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly campo: string; readonly motivo: string };

/** Confere o diagnóstico novo contra a lista: o tipo, a causa externa e a repetição; devolve a próxima sequência. */
export function conferirDiagnostico(
  existentes: readonly DiagnosticoExistente[],
  novo: { readonly cid: number; readonly codigo: string; readonly tipo: TipoDiagnosticoInternacao },
): ResultadoRegra<{ sequencia: number }> {
  if (!TIPOS_DIAGNOSTICO_TELA.includes(novo.tipo))
    return { ok: false, campo: 'tipo', motivo: 'Escolha o tipo do diagnóstico.' };
  if (novo.tipo === 'causa_externa' && !ehCausaExterna(novo.codigo))
    return {
      ok: false,
      campo: 'cid',
      motivo: 'A causa externa usa os códigos do capítulo XX do CID-10 (V01 a Y98).',
    };
  if (novo.tipo !== 'causa_externa' && ehCausaExterna(novo.codigo))
    return {
      ok: false,
      campo: 'tipo',
      motivo: 'Os códigos V01 a Y98 descrevem a causa externa: registre como causa externa.',
    };
  if (existentes.some((d) => d.cid === novo.cid && d.tipo === novo.tipo))
    return { ok: false, campo: 'cid', motivo: 'Este diagnóstico já está registrado com este tipo.' };
  if (novo.tipo === 'entrada' && existentes.some((d) => d.tipo === 'entrada'))
    return { ok: false, campo: 'tipo', motivo: 'O diagnóstico de entrada já foi registrado na admissão.' };
  return { ok: true, valor: { sequencia: proximaSequencia(existentes) } };
}

export const proximaSequencia = (l: readonly { readonly sequencia: number }[]): number =>
  l.reduce((m, x) => Math.max(m, x.sequencia), 0) + 1;

/** Os diagnósticos que nascem com a admissão: o CID principal como entrada e o secundário, quando houver. */
export function diagnosticosDaAdmissao(
  cidPrincipal: number,
  cidSecundario: number | null | undefined,
): { cid: number; tipo: TipoDiagnosticoInternacao; sequencia: number }[] {
  const l: { cid: number; tipo: TipoDiagnosticoInternacao; sequencia: number }[] = [
    { cid: cidPrincipal, tipo: 'entrada', sequencia: 1 },
  ];
  if (cidSecundario && cidSecundario !== cidPrincipal)
    l.push({ cid: cidSecundario, tipo: 'secundario', sequencia: 2 });
  return l;
}

// ── Acidente ─────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_ACIDENTE = [
  'trabalho',
  'trabalho_trajeto',
  'transito',
  'violencia',
  'queda',
  'outro',
] as const;
export type TipoAcidente = (typeof TIPOS_ACIDENTE)[number];
export const ehAcidenteDeTrabalho = (t: string): boolean => t === 'trabalho' || t === 'trabalho_trajeto';

/** CNPJ com os dígitos verificadores corretos (14 dígitos, sem a sequência repetida). */
export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos =
      base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = [...base].reduce((a, c, i) => a + Number(c) * pesos[i]!, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + String(d1));
  return d.endsWith(`${d1}${d2}`);
}

export interface AcidenteInformado {
  readonly tipo: TipoAcidente;
  /** Data e hora do acidente (ISO, sem fuso: hora local do estabelecimento). */
  readonly ocorridoEm?: string | undefined;
  readonly empregadorCnpj?: string | undefined;
  readonly empregadorNome?: string | undefined;
  readonly numeroComunicacao?: string | undefined;
  readonly comunicacaoEmitidaEm?: string | undefined;
}

/** Confere o acidente na hora: datas coerentes com a entrada, dados do empregador no acidente de trabalho. */
export function conferirAcidente(a: AcidenteInformado, entradaEm: string): ResultadoRegra<null> {
  const entrada = entradaEm.slice(0, 16);
  if (a.ocorridoEm && a.ocorridoEm.slice(0, 16) > entrada)
    return {
      ok: false,
      campo: 'ocorridoEm',
      motivo: 'O acidente não pode ser depois da entrada na internação.',
    };
  if (a.comunicacaoEmitidaEm && a.ocorridoEm && a.comunicacaoEmitidaEm < a.ocorridoEm.slice(0, 10))
    return {
      ok: false,
      campo: 'comunicacaoEmitidaEm',
      motivo: 'A comunicação do acidente de trabalho não pode ser anterior ao acidente.',
    };
  if (a.empregadorCnpj && !cnpjValido(a.empregadorCnpj))
    return { ok: false, campo: 'empregadorCnpj', motivo: 'O CNPJ do empregador não confere.' };
  if (ehAcidenteDeTrabalho(a.tipo)) {
    if (!a.ocorridoEm)
      return { ok: false, campo: 'ocorridoEm', motivo: 'Informe quando o acidente de trabalho ocorreu.' };
    if (!a.empregadorCnpj && !a.empregadorNome)
      return { ok: false, campo: 'empregadorNome', motivo: 'Informe o empregador do acidentado.' };
  } else if (a.numeroComunicacao || a.comunicacaoEmitidaEm)
    return {
      ok: false,
      campo: 'numeroComunicacao',
      motivo: 'A comunicação de acidente de trabalho só vale para o acidente de trabalho ou de trajeto.',
    };
  return { ok: true, valor: null };
}

// ── Autorização da operadora (guia inicial e prorrogações) ───────────────────────────────────────

export interface GuiaAutorizada {
  readonly sequencia: number;
  readonly tipo: 'inicial' | 'prorrogacao';
  /** AAAA-MM-DD. */
  readonly inicio: string;
  readonly fim: string;
  readonly diarias: number;
}

const somarDias = (data: string, dias: number): string => {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * A próxima guia da internação: a primeira é a inicial, as seguintes são prorrogações. O início padrão é a entrada
 * (inicial) ou o dia seguinte ao fim da guia anterior (prorrogação); o fim é o início mais as diárias menos um dia.
 * A prorrogação não começa antes do início da anterior nem depois do dia seguinte ao fim dela (sem buraco).
 */
export function proximaGuia(
  historico: readonly GuiaAutorizada[],
  nova: { readonly diarias: number; readonly inicio?: string | undefined },
  entradaEm: string,
): ResultadoRegra<GuiaAutorizada> {
  if (!Number.isInteger(nova.diarias) || nova.diarias < 1)
    return { ok: false, campo: 'validadeDias', motivo: 'Informe as diárias autorizadas.' };
  const anterior = [...historico].sort((a, b) => b.sequencia - a.sequencia)[0];
  const sequencia = proximaSequencia(historico);
  if (!anterior) {
    const inicio = nova.inicio ?? entradaEm.slice(0, 10);
    return {
      ok: true,
      valor: {
        sequencia,
        tipo: 'inicial',
        inicio,
        fim: somarDias(inicio, nova.diarias - 1),
        diarias: nova.diarias,
      },
    };
  }
  const seguinte = somarDias(anterior.fim, 1);
  const inicio = nova.inicio ?? seguinte;
  if (inicio < anterior.inicio)
    return { ok: false, campo: 'inicio', motivo: 'A prorrogação não pode começar antes da guia anterior.' };
  if (inicio > seguinte)
    return {
      ok: false,
      campo: 'inicio',
      motivo: `A prorrogação deixaria dias sem cobertura: comece até ${seguinte.split('-').reverse().join('/')}.`,
    };
  return {
    ok: true,
    valor: {
      sequencia,
      tipo: 'prorrogacao',
      inicio,
      fim: somarDias(inicio, nova.diarias - 1),
      diarias: nova.diarias,
    },
  };
}

/** Diárias cobertas pelas guias (dias distintos entre o primeiro início e o último fim, sem contar a sobreposição). */
export function diariasCobertas(historico: readonly GuiaAutorizada[]): number {
  const dias = new Set<string>();
  for (const g of historico) for (let i = 0; i < g.diarias; i++) dias.add(somarDias(g.inicio, i));
  return dias.size;
}
