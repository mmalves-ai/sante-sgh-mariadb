// Regras 1 e 2 do M32 (ficha, seção 8; cap-06b §6.8; Anexo A §A.6): o tipo de credor define o lançamento e as
// retenções, e só se grava título com credor válido.
//   - MFCONPAG.TIPO: F 55.792 · M 8.607 (exige o vínculo com o profissional, MFCONPAG_TBCBOPRO) · E 5.421 · X 1.356 ·
//     C 80 · T 10 (confiança alta);
//   - MFCONPAG.ONDE (módulo de origem): F 46.895 · E 18.914 · R 5.458 (confiança média);
//   - os títulos órfãos do outro sistema (12,9% apontam para fornecedor inexistente) aparecem no relatório de
//     saneamento como "não encontrado no cadastro"; a correção pela tela vale nos dois sistemas.
import { recusaFin, type RecusaFinanceiro } from './recusa.js';

export const TIPOS_CREDOR = ['F', 'M', 'E', 'X', 'C', 'T'] as const;
export type TipoCredor = (typeof TIPOS_CREDOR)[number];

export const ROTULO_TIPO_CREDOR: Readonly<Record<TipoCredor, string>> = {
  F: 'Fornecedor',
  M: 'Médico',
  E: 'Empresa médica',
  X: 'Folha',
  C: 'Colaborador',
  T: 'Tributos',
};

/** Frequência de cada tipo nos 71.267 títulos (levantamento de 18/10/2026), para a tela e o teste. */
export const FREQUENCIA_TIPO_CREDOR: Readonly<Record<TipoCredor, number>> = {
  F: 55_792,
  M: 8_607,
  E: 5_421,
  X: 1_356,
  C: 80,
  T: 10,
};

export const ORIGENS_TITULO = ['F', 'E', 'R'] as const;
export type OrigemTitulo = (typeof ORIGENS_TITULO)[number];
export const ROTULO_ORIGEM_TITULO: Readonly<Record<OrigemTitulo, string>> = {
  F: 'Lançado no financeiro',
  E: 'Nota de entrada (estoque)',
  R: 'Repasse médico',
};

export interface RegrasCredor {
  /** M: o título exige o vínculo com o profissional (MFCONPAG_TBCBOPRO). */
  readonly exigeProfissional: boolean;
  /** Retenções na fonte (MFDESACR) permitidas no lançamento manual. */
  readonly admiteRetencao: boolean;
  /** O título nasce pela tela de títulos a pagar (X folha e o repasse nascem em outros módulos). */
  readonly lancamentoManual: boolean;
}

export const ehTipoCredor = (t: string): t is TipoCredor => (TIPOS_CREDOR as readonly string[]).includes(t);

/** Regra 1: o que o tipo de credor exige e permite. */
export function regrasDoCredor(tipo: TipoCredor): RegrasCredor {
  switch (tipo) {
    case 'M':
      return { exigeProfissional: true, admiteRetencao: true, lancamentoManual: true };
    case 'F':
    case 'E':
      return { exigeProfissional: false, admiteRetencao: true, lancamentoManual: true };
    case 'X':
      // Folha: o título nasce da folha (Fase 6); o lançamento manual fica recusado no novo.
      return { exigeProfissional: false, admiteRetencao: false, lancamentoManual: false };
    case 'C':
    case 'T':
      return { exigeProfissional: false, admiteRetencao: false, lancamentoManual: true };
  }
}

export interface CredorInformado {
  readonly tipo: string;
  /** O fornecedor (TBFORNEC.COD) existe e está ativo? */
  readonly credorExiste: boolean;
  /** Profissional (TBCBOPRO.ID) informado e válido, quando o tipo é M. */
  readonly profissional: number | null;
  readonly profissionalExiste?: boolean;
  /** Há retenções informadas? */
  readonly comRetencao?: boolean;
}

/** Regra 2: só grava título com credor válido (e o profissional no médico). */
export function conferirCredor(c: CredorInformado): RecusaFinanceiro | null {
  if (!ehTipoCredor(c.tipo))
    return recusaFin('tipo-credor-invalido', 'Escolha um tipo de credor da lista.', ['tipo']);
  const r = regrasDoCredor(c.tipo);
  if (!r.lancamentoManual)
    return recusaFin(
      'tipo-credor-sem-lancamento',
      `${ROTULO_TIPO_CREDOR[c.tipo]}: o título nasce no módulo de origem, não pelo lançamento manual.`,
      ['tipo'],
    );
  if (!c.credorExiste)
    return recusaFin('credor-inexistente', 'O credor não foi encontrado no cadastro de fornecedores.', [
      'credor',
    ]);
  if (r.exigeProfissional) {
    if (!c.profissional)
      return recusaFin('profissional-obrigatorio', 'Título de médico exige o profissional.', [
        'profissional',
      ]);
    if (c.profissionalExiste === false)
      return recusaFin('profissional-inexistente', 'O profissional não foi encontrado no cadastro.', [
        'profissional',
      ]);
  }
  if (c.comRetencao && !r.admiteRetencao)
    return recusaFin('retencao-nao-admitida', `${ROTULO_TIPO_CREDOR[c.tipo]} não tem retenção na fonte.`, [
      'retencoes',
    ]);
  return null;
}

/** Relatório de saneamento: o título cujo credor não existe no cadastro (sem FK no outro sistema). */
export const ROTULO_CREDOR_ORFAO = 'não encontrado no cadastro';
