// Reabertura da competência do convênio (F3.7, 06-FAT linha 32): a regra que decide se a competência fechada pode
// voltar a receber lançamentos. A alçada é a permissão do cargo (`faturamento.competencia.reabrir`), conferida pela
// rota; aqui fica o que o negócio exige: estar fechada, ter motivo e, quando há contas já apresentadas à operadora
// (em lote gerado, enviado ou protocolado), a confirmação explícita de quem reabre, com o impacto mostrado. Alterar
// uma conta já apresentada segue o fluxo de cancelamento ou reapresentação da guia (boa prática TISS).

export interface ImpactoReabertura {
  /** Contas da competência em lote não cancelado (gerado, enviado ou protocolado). */
  readonly contasApresentadas: number;
  /** Soma do valor dessas contas. */
  readonly valorApresentado: number;
}

export interface PedidoReabertura {
  readonly fechada: boolean;
  readonly motivo: string;
  readonly impacto: ImpactoReabertura;
  /** Quem reabre viu o impacto e confirmou. */
  readonly confirmarImpacto: boolean;
}

export interface RecusaReabertura {
  readonly codigo: 'competencia-aberta' | 'motivo-obrigatorio' | 'competencia-apresentada';
  readonly mensagem: string;
  readonly campos?: readonly string[];
  readonly impacto?: ImpactoReabertura;
}

/** O motivo da reabertura tem ao menos 5 letras (sem contar espaços nas pontas). */
export const MOTIVO_REABERTURA_MINIMO = 5;

const real = (v: number): string =>
  `R$ ${v
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

export function conferirReaberturaCompetencia(p: PedidoReabertura): RecusaReabertura | null {
  if (!p.fechada) return { codigo: 'competencia-aberta', mensagem: 'A competência já está aberta.' };
  if (p.motivo.trim().length < MOTIVO_REABERTURA_MINIMO)
    return { codigo: 'motivo-obrigatorio', mensagem: 'Informe o motivo.', campos: ['motivo'] };
  if (p.impacto.contasApresentadas > 0 && !p.confirmarImpacto) {
    const n = p.impacto.contasApresentadas;
    return {
      codigo: 'competencia-apresentada',
      mensagem:
        `${n} ${n === 1 ? 'conta desta competência já está' : 'contas desta competência já estão'} em lote ` +
        `(${real(p.impacto.valorApresentado)} apresentados à operadora). Alterar uma conta apresentada exige ` +
        'cancelar ou reapresentar a guia. Confirme para reabrir mesmo assim.',
      impacto: p.impacto,
    };
  }
  return null;
}
