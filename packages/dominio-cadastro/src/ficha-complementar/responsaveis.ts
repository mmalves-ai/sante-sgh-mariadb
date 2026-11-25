// Responsável legal, familiares e dependentes do paciente (F3.1, 02-CAD linha 4). Regra pura:
//   - papel, poderes (autorizar procedimento, receber informação, retirar documento) e vigência;
//   - só quem representa o paciente (responsável legal, guardião, tutor, curador) autoriza procedimento, e precisa
//     ser maior de idade, com a data de nascimento conhecida;
//   - menor de idade (pela data de nascimento) não fica sem representante vigente: o encerramento do último é
//     recusado até haver outro (ou a maioridade); paciente sob curatela (incapaz) não fica sem curador, salvo com o
//     levantamento da curatela declarado;
//   - guarda, tutela e curatela pedem o comprovante (fica como pendência na ficha até ser anexado);
//   - a incapacidade do paciente é uma condição própria, com data de início e documento (sentença de curatela,
//     curatela provisória ou laudo médico): enquanto vigente, o paciente sem curador fica com a pendência
//     `incapaz-sem-curador`, o curador não é encerrado (o levantamento encerra a condição, com data e motivo) e o
//     consentimento é assinado pelo curador;
//   - as pendências de representação (menor sem representante, incapaz sem curador) valem também fora da ficha: a
//     abertura do atendimento avisa (nunca bloqueia: a urgência não espera o cadastro) e o consentimento recusa a
//     assinatura de quem não pode consentir.
// Nada se apaga: o vínculo encerra a vigência.

export const PAPEIS_RESPONSAVEL = [
  'responsavel_legal',
  'responsavel_financeiro',
  'familiar',
  'contato_emergencia',
  'acompanhante',
  'guardiao_legal',
  'curador',
  'tutor',
  'dependente',
] as const;
export type PapelResponsavel = (typeof PAPEIS_RESPONSAVEL)[number];

/** Representam o paciente legalmente (menor ou incapaz). */
export const PAPEIS_REPRESENTANTE: readonly PapelResponsavel[] = [
  'responsavel_legal',
  'guardiao_legal',
  'tutor',
  'curador',
];
/** Representam o menor de idade. */
const PAPEIS_DO_MENOR: readonly PapelResponsavel[] = ['responsavel_legal', 'guardiao_legal', 'tutor'];
/** Exigem documento (termo de guarda, tutela ou curatela). */
export const PAPEIS_COM_COMPROVANTE: readonly PapelResponsavel[] = ['guardiao_legal', 'tutor', 'curador'];

export const MAIORIDADE = 18;

export interface Poderes {
  readonly autorizarProcedimento: boolean;
  readonly receberInformacao: boolean;
  readonly retirarDocumento: boolean;
}

export function poderesPadrao(papel: PapelResponsavel): Poderes {
  const representa = PAPEIS_REPRESENTANTE.includes(papel);
  return {
    autorizarProcedimento: representa,
    receberInformacao: representa,
    retirarDocumento: representa,
  };
}

/** Idade completa em anos na data (datas civis AAAA-MM-DD). */
export function idadeEm(nascimento: string, hoje: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ah, mh, dh] = hoje.split('-').map(Number) as [number, number, number];
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

export const menorDeIdade = (nascimento: string | null, hoje: string): boolean =>
  nascimento !== null && idadeEm(nascimento, hoje) < MAIORIDADE;

export interface ResponsavelNovo {
  readonly papel: string;
  readonly poderes: Poderes;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly nascimentoResponsavel: string | null;
  /** A pessoa do responsável é a do próprio paciente. */
  readonly mesmaPessoaDoPaciente: boolean;
}

export function errosResponsavel(r: ResponsavelNovo, hoje: string): string[] {
  const erros: string[] = [];
  const papel = r.papel as PapelResponsavel;
  if (!PAPEIS_RESPONSAVEL.includes(papel)) erros.push('papel');
  if (r.mesmaPessoaDoPaciente) erros.push('mesma-pessoa');
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio) erros.push('vigenciaFim');
  if (r.poderes.autorizarProcedimento && !PAPEIS_REPRESENTANTE.includes(papel))
    erros.push('autorizarProcedimento');
  // Quem representa prova a maioridade: sem a data de nascimento, a representação é recusada.
  if (PAPEIS_REPRESENTANTE.includes(papel) && r.nascimentoResponsavel === null)
    erros.push('nascimento-representante');
  if (PAPEIS_REPRESENTANTE.includes(papel) && menorDeIdade(r.nascimentoResponsavel, hoje))
    erros.push('representante-menor');
  return erros;
}

export interface VinculoVigente {
  readonly id: number;
  readonly papel: string;
  readonly temComprovante: boolean;
}

export type Pendencia = 'menor-sem-representante' | 'incapaz-sem-curador' | 'comprovante-ausente';

/**
 * Pendências da representação do paciente na data (mostradas na ficha). `incapaz`: a condição de incapacidade do
 * paciente está vigente na data.
 */
export function pendenciasRepresentacao(
  nascimentoPaciente: string | null,
  vigentes: readonly VinculoVigente[],
  hoje: string,
  incapaz = false,
): { pendencia: Pendencia; vinculo: number | null }[] {
  const p: { pendencia: Pendencia; vinculo: number | null }[] = [];
  if (
    menorDeIdade(nascimentoPaciente, hoje) &&
    !vigentes.some((v) => PAPEIS_DO_MENOR.includes(v.papel as PapelResponsavel))
  )
    p.push({ pendencia: 'menor-sem-representante', vinculo: null });
  if (incapaz && !vigentes.some((v) => v.papel === 'curador'))
    p.push({ pendencia: 'incapaz-sem-curador', vinculo: null });
  for (const v of vigentes)
    if (PAPEIS_COM_COMPROVANTE.includes(v.papel as PapelResponsavel) && !v.temComprovante)
      p.push({ pendencia: 'comprovante-ausente', vinculo: v.id });
  return p;
}

/**
 * Recusa do encerramento do vínculo (nulo: pode encerrar). O menor não fica sem representante; o paciente sob
 * curatela não fica sem curador, salvo com o levantamento da curatela declarado.
 */
export function recusaEncerramento(
  nascimentoPaciente: string | null,
  vigentes: readonly VinculoVigente[],
  encerrando: number,
  hoje: string,
  levantamentoCuratela: boolean,
  incapaz = false,
): 'menor-sem-representante' | 'incapaz-sem-curador' | 'incapacidade-vigente' | null {
  const alvo = vigentes.find((v) => v.id === encerrando);
  if (!alvo) return null;
  const resto = vigentes.filter((v) => v.id !== encerrando);
  if (
    PAPEIS_DO_MENOR.includes(alvo.papel as PapelResponsavel) &&
    menorDeIdade(nascimentoPaciente, hoje) &&
    !resto.some((v) => PAPEIS_DO_MENOR.includes(v.papel as PapelResponsavel))
  )
    return 'menor-sem-representante';
  if (alvo.papel === 'curador' && !resto.some((v) => v.papel === 'curador')) {
    // Com a incapacidade registrada, o levantamento é o encerramento da condição (data e motivo), não uma marca.
    if (incapaz) return 'incapacidade-vigente';
    if (!levantamentoCuratela) return 'incapaz-sem-curador';
  }
  return null;
}

// ── Incapacidade do paciente (condição com data e documento) ──

export const DOCUMENTOS_INCAPACIDADE = ['sentenca_curatela', 'curatela_provisoria', 'laudo_medico'] as const;
export type DocumentoIncapacidade = (typeof DOCUMENTOS_INCAPACIDADE)[number];
/** Documentos judiciais: pedem o número do processo. */
const DOCUMENTOS_JUDICIAIS: readonly string[] = ['sentenca_curatela', 'curatela_provisoria'];

export interface IncapacidadeNova {
  readonly inicio: string;
  readonly documentoTipo: string;
  readonly documentoNumero: string | null;
  readonly documentoData: string | null;
}

const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Erros do registro da incapacidade (campos). A condição começa em data conhecida, nunca no futuro nem antes do
 * nascimento; o documento que a prova tem tipo e data, e o judicial tem o número do processo. Uma só condição vigente
 * por paciente (`jaVigente`).
 */
export function errosIncapacidade(
  i: IncapacidadeNova,
  nascimentoPaciente: string | null,
  hoje: string,
  jaVigente: boolean,
): string[] {
  const erros: string[] = [];
  if (jaVigente) erros.push('incapacidade-ja-vigente');
  if (!DATA_CIVIL.test(i.inicio) || i.inicio > hoje) erros.push('inicio');
  else if (nascimentoPaciente !== null && i.inicio < nascimentoPaciente) erros.push('inicio');
  if (!(DOCUMENTOS_INCAPACIDADE as readonly string[]).includes(i.documentoTipo)) erros.push('documentoTipo');
  if (i.documentoData === null || !DATA_CIVIL.test(i.documentoData) || i.documentoData > hoje)
    erros.push('documentoData');
  if (DOCUMENTOS_JUDICIAIS.includes(i.documentoTipo) && !(i.documentoNumero ?? '').trim())
    erros.push('documentoNumero');
  return erros;
}

/** Recusa do encerramento da incapacidade (levantamento): o fim não é futuro nem anterior ao início. */
export function recusaFimIncapacidade(inicio: string, fim: string, hoje: string): 'fim' | null {
  return !DATA_CIVIL.test(fim) || fim > hoje || fim < inicio ? 'fim' : null;
}

// ── Representação fora da ficha: abertura do atendimento e consentimento ──

export type AlertaRepresentacao = 'menor-sem-representante' | 'incapaz-sem-curador';

/**
 * O que a abertura do atendimento avisa (não bloqueia: o paciente é atendido e a recepção regulariza o cadastro):
 * só as pendências de quem representa, não a do comprovante.
 */
export function alertasRepresentacao(
  nascimentoPaciente: string | null,
  vigentes: readonly VinculoVigente[],
  hoje: string,
  incapaz: boolean,
): AlertaRepresentacao[] {
  return pendenciasRepresentacao(nascimentoPaciente, vigentes, hoje, incapaz)
    .filter((p) => p.vinculo === null)
    .map((p) => p.pendencia as AlertaRepresentacao);
}

export type RecusaSignatario =
  'paciente-menor' | 'paciente-incapaz' | 'representante-ausente' | 'curador-ausente';

/**
 * Quem assina o consentimento. O menor de idade e o incapaz não assinam: assina o representante vigente (do incapaz,
 * o curador; do menor, o responsável legal, o guardião ou o tutor). Devolve o vínculo que assina (nulo: o próprio
 * paciente) ou a recusa. `vigentes` vem na ordem de preferência (contato principal primeiro).
 */
export function signatarioDoConsentimento(e: {
  readonly signatario: 'paciente' | 'representante_legal';
  readonly nascimentoPaciente: string | null;
  readonly incapaz: boolean;
  readonly vigentes: readonly VinculoVigente[];
  readonly hoje: string;
}): { recusa: RecusaSignatario } | { recusa: null; vinculo: number | null } {
  const menor = menorDeIdade(e.nascimentoPaciente, e.hoje);
  if (e.signatario === 'paciente') {
    if (e.incapaz) return { recusa: 'paciente-incapaz' };
    if (menor) return { recusa: 'paciente-menor' };
    return { recusa: null, vinculo: null };
  }
  if (e.incapaz) {
    const curador = e.vigentes.find((v) => v.papel === 'curador');
    return curador ? { recusa: null, vinculo: curador.id } : { recusa: 'curador-ausente' };
  }
  const papeis = menor ? PAPEIS_DO_MENOR : PAPEIS_REPRESENTANTE;
  const r = e.vigentes.find((v) => papeis.includes(v.papel as PapelResponsavel));
  return r ? { recusa: null, vinculo: r.id } : { recusa: 'representante-ausente' };
}
