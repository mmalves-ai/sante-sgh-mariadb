// Validade do registro no conselho (regra 3; ATO-03, RDC63-06; ficha, seção 4 "Validade do conselho"). O cadastro de
// profissionais do outro sistema não tem data de validade (TBCBOPRO: COD, UF, CONS_PROF, ATIVO): a validade é
// acompanhada pelo RH em SGH_PES_HABILITACAO. Vencida: a validade já passou; a vencer: vence na janela (padrão 60
// dias, parâmetro `pessoas.alertaConselhoDias`); sem validade: o RH ainda não conferiu.
import { JANELA_ALERTA_CONSELHO_DIAS, type SituacaoHabilitacao } from '@sgh/contratos';
import { diasEntre } from '../datas.js';

export interface SituacaoValidade {
  readonly situacao: SituacaoHabilitacao;
  /** Dias até o vencimento (negativo: vencida há tantos dias); null sem validade. */
  readonly diasParaVencer: number | null;
}

/** Situação da validade em `referencia` (o dia de hoje ou o dia do plantão). Vence no fim do dia da validade. */
export function situacaoHabilitacao(
  validade: string | null,
  referencia: string,
  janelaDias: number = JANELA_ALERTA_CONSELHO_DIAS,
): SituacaoValidade {
  if (validade === null) return { situacao: 'semValidade', diasParaVencer: null };
  const dias = diasEntre(referencia, validade);
  if (dias < 0) return { situacao: 'vencida', diasParaVencer: dias };
  if (dias <= janelaDias) return { situacao: 'aVencer', diasParaVencer: dias };
  return { situacao: 'valida', diasParaVencer: dias };
}

const GRAVIDADE: Record<SituacaoHabilitacao, number> = { vencida: 3, aVencer: 2, semValidade: 1, valida: 0 };

/** A pior situação entre os registros (alerta da lista de colaboradores); sem registro: null. */
export function piorSituacao(situacoes: readonly SituacaoHabilitacao[]): SituacaoHabilitacao | null {
  let pior: SituacaoHabilitacao | null = null;
  for (const s of situacoes) if (pior === null || GRAVIDADE[s] > GRAVIDADE[pior]) pior = s;
  return pior;
}

export interface RegistroComValidade {
  readonly registro: number;
  readonly profissional: number;
  /** TBCBOPRO.ATIVO: o registro inativo não gera alerta. */
  readonly ativo: boolean | null;
  readonly validade: string | null;
}

/**
 * Alertas do dia (agregado diário no worker; lista do RH): registros ativos vencidos, a vencer e sem validade, do
 * mais urgente ao menos urgente (vencidos primeiro, pela data; depois a vencer; por fim, sem validade).
 */
export function alertasDeConselho<R extends RegistroComValidade>(
  registros: readonly R[],
  hoje: string,
  janelaDias: number = JANELA_ALERTA_CONSELHO_DIAS,
): (R & SituacaoValidade)[] {
  return registros
    .filter((r) => r.ativo !== false)
    .map((r) => ({ ...r, ...situacaoHabilitacao(r.validade, hoje, janelaDias) }))
    .filter((r) => r.situacao !== 'valida')
    .sort(
      (a, b) =>
        GRAVIDADE[b.situacao] - GRAVIDADE[a.situacao] ||
        (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0) ||
        a.registro - b.registro,
    );
}
