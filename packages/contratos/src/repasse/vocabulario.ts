// Vocabulário do repasse médico (M33; ficha, seções 5 a 8; cap-06b §6.7). Os códigos são os que o outro sistema grava
// (levantados na cópia em 23/10/2026, só contagens): a tela mostra o rótulo, nunca o código cru nem o nome da tabela.

/** Tipo de prestador do repasse (RPTIPOPRESTADOR.COD; 6 linhas no pc). */
export const TIPOS_PRESTADOR_REPASSE = {
  E: 'Empresa médica',
  F: 'Fornecedor (prestador)',
  M: 'Médico (pessoa física)',
  P: 'Prestador (pessoa física)',
  V: 'Vendedor de planos',
  I: 'Tomador',
} as const;
export type TipoPrestadorRepasse = keyof typeof TIPOS_PRESTADOR_REPASSE;

/**
 * Tipo de credor do título a pagar que nasce do repasse (MFCONPAG.TIPO com ONDE='R'; ref 01 §2.5): M (médico,
 * exige o vínculo com o profissional) ou E (empresa médica). Na cópia: 5.027 títulos M e 431 E, todos com RPA.
 */
export const TIPOS_CREDOR_REPASSE = ['M', 'E'] as const;
export type TipoCredorRepasse = (typeof TIPOS_CREDOR_REPASSE)[number];

/** Beneficiário da regra (TBREPGER.MED_PRS): médico ou prestador. */
export const BENEFICIARIOS_REGRA = { M: 'Médico', P: 'Prestador' } as const;
export type BeneficiarioRegra = keyof typeof BENEFICIARIOS_REGRA;

/**
 * Tipo de conta da regra (TBREPGER.TIPO_CTA): A 756, E 38.525, I 66.149 regras no pc. A conta só tem E e I
 * (FCCTAEXT); "A" é lido como "as duas" (vale para qualquer conta), a confirmar no teste dourado.
 */
export const TIPOS_CONTA_REGRA = { A: 'Externa e internação', E: 'Externa', I: 'Internação' } as const;
export type TipoContaRegra = keyof typeof TIPOS_CONTA_REGRA;

/**
 * Valor do item que a apuração integrou (FCINTEGRPA.ID_TBTIPOLANCVLR → TBTIPOLANCVLR). No pc: 6.016 linhas de valor
 * faturado (3.914 com valor, R$ 508.581,47), 4.707 de valor pago e 3 de valor apresentado pago, todas sem valor.
 */
export const TIPOS_VALOR_INTEGRADO = {
  1: 'Valor faturado',
  2: 'Valor pago',
  3: 'Valor glosado',
  4: 'Valor reapresentado',
  5: 'Valor reapresentado pago',
  6: 'Valor de glosa aceita',
  7: 'Valor apresentado pago',
} as const;
export type TipoValorIntegrado = keyof typeof TIPOS_VALOR_INTEGRADO;

/** Base de cálculo da regra (regra 4): cobrado, recebido (pago + recurso deferido) ou misto. */
export const BASES_CALCULO_REPASSE = ['cobrado', 'recebido', 'misto'] as const;
export type BaseCalculoRepasse = (typeof BASES_CALCULO_REPASSE)[number];

/** Estados da apuração do período (SGH_REP_APURACAO; regra 9). */
export const ESTADOS_APURACAO = ['aberta', 'conferida', 'aprovada', 'titulada'] as const;
export type EstadoApuracao = (typeof ESTADOS_APURACAO)[number];

/** Estados da versão de regra (SGH_REP_REGRA_VERSAO; regra 3). */
export const ESTADOS_VERSAO_REGRA = ['rascunho', 'simulada', 'aprovada', 'incluida', 'recusada'] as const;
export type EstadoVersaoRegra = (typeof ESTADOS_VERSAO_REGRA)[number];

/**
 * Dimensões da regra, da mais específica à mais geral (regra 1; a ordem é a proposta pelo cap-06b §6.7 e é conferida
 * contra as apurações gravadas no teste dourado). No pc: profissional em 103.957 regras (847 profissionais),
 * procedimento em 105.427 (23.915 em faixa), convênio em 105.418 (53), ato em 1.720, unidade em 10.087, tipo de
 * lançamento em 105.280; especialidade, local, centro de custo e cooperativa não usados.
 */
export const DIMENSOES_REGRA = [
  'profissional',
  'procedimento',
  'especialidade',
  'ato',
  'local',
  'unidade',
  'centroCusto',
  'cooperativa',
  'tipoLancamento',
  'tipoConta',
  'convenio',
] as const;
export type DimensaoRegra = (typeof DIMENSOES_REGRA)[number];

/** Causa da divergência no teste dourado (regra 2; sem dado pessoal: IDs e valores agregados). */
export const CAUSAS_DIVERGENCIA_REPASSE = [
  'regra-diferente',
  'percentual-diferente',
  'base-diferente',
  'arredondamento',
  'sem-regra-no-novo',
  'sem-regra-no-legado',
  'valor-fixo',
  'adicional',
  'item-sem-base',
] as const;
export type CausaDivergenciaRepasse = (typeof CAUSAS_DIVERGENCIA_REPASSE)[number];

/** Motivo da pendência do item na apuração (item que não vira repasse e precisa de ação). */
export const PENDENCIAS_APURACAO = [
  'sem-executante',
  'sem-regra',
  'nao-conciliado',
  'nao-credenciado',
  'ja-integrado',
] as const;
export type PendenciaApuracao = (typeof PENDENCIAS_APURACAO)[number];

/** Retenções do RPA (regra 7). */
export const RETENCOES_RPA = ['inss', 'irrf', 'iss'] as const;
export type RetencaoRpa = (typeof RETENCOES_RPA)[number];
