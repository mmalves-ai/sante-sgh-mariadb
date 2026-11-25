// Caixa de avisos clínicos do destinatário (F3.5, 05-SADT linha 10): o aviso clínico (retificação de resultado, laudo
// retificado, achado crítico, isolamento) chega à central de avisos de quem o recebe. Regras puras:
//   - o estado na caixa vem do destinatário (novo, lido, ciente); o aviso cancelado ou excluído não aparece;
//   - a ciência é do próprio destinatário: o aviso de outra pessoa é recusado; a ciência repetida não grava de novo;
//   - o aviso cancelado não recebe ciência; nada é apagado (a ciência grava quando e quem);
//   - a gravidade da central vem da prioridade (crítica e alta pedem atenção; o aviso clínico nunca interrompe a
//     tarefa: a interrupção é só do risco grave da higiene de alertas);
//   - o link leva à visão do paciente (exames do prontuário), nunca com dado do paciente além do identificador.

export type EstadoAvisoClinicoCaixa = 'novo' | 'lido' | 'ciente';
export type GravidadeAvisoClinicoCaixa = 'atencao' | 'informacao';

export interface DestinatarioAvisoClinico {
  readonly usuario: number | null;
  readonly situacaoAviso: string;
  readonly situacaoDestinatario: string;
  readonly lidoEm: Date | null;
  readonly cienteEm: Date | null;
  readonly excluido: boolean;
}

/** O aviso aparece na caixa do destinatário? (cancelado, excluído ou com envio cancelado, não). */
export function avisoClinicoNaCaixa(d: DestinatarioAvisoClinico): boolean {
  return !d.excluido && d.situacaoAviso !== 'cancelado' && d.situacaoDestinatario !== 'cancelado';
}

/** O estado do aviso na caixa de quem o recebe. */
export function estadoDoAvisoClinico(d: DestinatarioAvisoClinico): EstadoAvisoClinicoCaixa {
  if (d.cienteEm !== null || d.situacaoDestinatario === 'ciente') return 'ciente';
  if (d.lidoEm !== null || d.situacaoDestinatario === 'lido') return 'lido';
  return 'novo';
}

/** A gravidade na central pela prioridade do aviso. */
export function gravidadeDoAvisoClinico(prioridade: string): GravidadeAvisoClinicoCaixa {
  return prioridade === 'critica' || prioridade === 'alta' ? 'atencao' : 'informacao';
}

/** A tela que resolve: os exames do paciente no prontuário (ou o prontuário); sem paciente, nenhum link. */
export function linkDoAvisoClinico(a: { paciente: number | null; resultado: number | null }): string | null {
  if (a.paciente === null) return null;
  return a.resultado !== null ? `/pep/paciente/${a.paciente}/exames` : `/pep/paciente/${a.paciente}`;
}

export type DecisaoCienciaAvisoClinico =
  | { readonly gravar: true }
  | { readonly gravar: false; readonly motivo: 'ja-ciente' }
  | { readonly recusa: 'aviso-de-outro-usuario' | 'aviso-cancelado' };

/** A ciência do destinatário: só o próprio, nunca no cancelado; a repetida não grava. */
export function decidirCienciaAvisoClinico(
  d: DestinatarioAvisoClinico,
  usuario: number,
): DecisaoCienciaAvisoClinico {
  if (d.usuario !== usuario) return { recusa: 'aviso-de-outro-usuario' };
  if (!avisoClinicoNaCaixa(d)) return { recusa: 'aviso-cancelado' };
  if (estadoDoAvisoClinico(d) === 'ciente') return { gravar: false, motivo: 'ja-ciente' };
  return { gravar: true };
}

/** A caixa em ordem: novos, lidos e cientes; dentro de cada um, o mais novo primeiro. */
export function ordenarCaixaAvisosClinicos<
  T extends { estado: EstadoAvisoClinicoCaixa; geradoEm: string; id: number },
>(avisos: readonly T[]): T[] {
  const peso = { novo: 0, lido: 1, ciente: 2 } as const;
  return [...avisos].sort(
    (a, b) => peso[a.estado] - peso[b.estado] || b.geradoEm.localeCompare(a.geradoEm) || b.id - a.id,
  );
}
