// Responsável legal, familiares e dependentes do paciente (F3.1, 02-CAD linha 4). Regra pura:
//   - papel, poderes (autorizar procedimento, receber informação, retirar documento) e vigência;
//   - só quem representa o paciente (responsável legal, guardião, tutor, curador) autoriza procedimento, e precisa
//     ser maior de idade, com a data de nascimento conhecida;
//   - menor de idade (pela data de nascimento) não fica sem representante vigente: o encerramento do último é
//     recusado até haver outro (ou a maioridade); paciente sob curatela (incapaz) não fica sem curador, salvo com o
//     levantamento da curatela declarado;
//   - guarda, tutela e curatela pedem o comprovante (fica como pendência na ficha até ser anexado).
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

export type Pendencia = 'menor-sem-representante' | 'comprovante-ausente';

/** Pendências da representação do paciente na data (mostradas na ficha). */
export function pendenciasRepresentacao(
  nascimentoPaciente: string | null,
  vigentes: readonly VinculoVigente[],
  hoje: string,
): { pendencia: Pendencia; vinculo: number | null }[] {
  const p: { pendencia: Pendencia; vinculo: number | null }[] = [];
  if (
    menorDeIdade(nascimentoPaciente, hoje) &&
    !vigentes.some((v) => PAPEIS_DO_MENOR.includes(v.papel as PapelResponsavel))
  )
    p.push({ pendencia: 'menor-sem-representante', vinculo: null });
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
): 'menor-sem-representante' | 'incapaz-sem-curador' | null {
  const alvo = vigentes.find((v) => v.id === encerrando);
  if (!alvo) return null;
  const resto = vigentes.filter((v) => v.id !== encerrando);
  if (
    PAPEIS_DO_MENOR.includes(alvo.papel as PapelResponsavel) &&
    menorDeIdade(nascimentoPaciente, hoje) &&
    !resto.some((v) => PAPEIS_DO_MENOR.includes(v.papel as PapelResponsavel))
  )
    return 'menor-sem-representante';
  if (alvo.papel === 'curador' && !levantamentoCuratela && !resto.some((v) => v.papel === 'curador'))
    return 'incapaz-sem-curador';
  return null;
}
