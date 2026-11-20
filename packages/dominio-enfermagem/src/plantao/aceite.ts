// Passagem de plantão (ficha do M25, regra 14; cap-05b §5.8): a responsabilidade só passa com o aceite de quem recebe;
// a passagem leva a nota SBAR de cada paciente e as pendências herdadas (doses atrasadas e omitidas, exames a colher,
// cuidados não feitos, conflitos abertos). Quem passa não aceita o próprio plantão; só o recebedor indicado aceita.
import type { EstadoHorario, HorarioEnfermagem, PendenciaPlantao } from '@sgh/contratos';

/** W0-03: `cancelada` por quem passou, antes do aceite (a responsabilidade continua com quem passou). */
export type SituacaoPassagem = 'aguardandoAceite' | 'aceita' | 'recusada' | 'cancelada';

export interface PassagemParaAceite {
  readonly situacao: SituacaoPassagem;
  readonly passadoPor: string;
  readonly recebedor: string;
}

const igual = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Regra 14: quem pode aceitar (ou recusar) a passagem. O problema, ou null. */
export function conferirAceite(p: PassagemParaAceite | null, login: string): string | null {
  if (!p) return 'A passagem de plantão não foi encontrada.';
  if (p.situacao === 'cancelada') return 'Esta passagem de plantão foi cancelada por quem passou.';
  if (p.situacao !== 'aguardandoAceite') return 'Esta passagem de plantão já foi respondida.';
  if (igual(p.passadoPor, login)) return 'Quem passa o plantão não o aceita: o aceite é de quem recebe.';
  if (!igual(p.recebedor, login)) return 'O aceite é do profissional indicado para receber o plantão.';
  return null;
}

/** De quem é a responsabilidade: de quem passou até o aceite; de quem recebeu depois dele. */
export function responsavel(p: PassagemParaAceite): string {
  return p.situacao === 'aceita' ? p.recebedor : p.passadoPor;
}

/**
 * W0-03: quem pode cancelar a passagem. Só quem passou, só antes do aceite (a passagem aceita é registro clínico
 * finalizado). O problema e o código (409), ou null.
 */
export function conferirCancelamento(
  p: PassagemParaAceite | null,
  login: string,
): { codigo: string; problema: string } | null {
  if (!p) return { codigo: 'plantao-inexistente', problema: 'A passagem de plantão não foi encontrada.' };
  if (p.situacao === 'cancelada')
    return { codigo: 'plantao-ja-respondido', problema: 'A passagem já foi cancelada.' };
  if (p.situacao !== 'aguardandoAceite')
    return {
      codigo: 'plantao-ja-respondido',
      problema: 'A passagem já foi respondida por quem recebe: depois do aceite, não se cancela.',
    };
  if (!igual(p.passadoPor, login))
    return { codigo: 'plantao-de-outro', problema: 'Só quem passou o plantão pode cancelar a passagem.' };
  return null;
}

/** Quem passa não pode indicar a si mesmo como recebedor. */
export function conferirPassagem(p: {
  readonly passadoPor: string;
  readonly recebedor: string;
  readonly notas: number;
}): string | null {
  if (igual(p.passadoPor, p.recebedor)) return 'Indique outro profissional para receber o plantão.';
  if (p.notas === 0) return 'A passagem precisa da nota de pelo menos um paciente.';
  return null;
}

const PENDENCIA_DO_ESTADO: Partial<Record<EstadoHorario, PendenciaPlantao>> = {
  atrasada: 'doseAtrasada',
  omitida: 'doseOmitida',
};

/** As pendências herdadas que a passagem sugere, por paciente (doses atrasadas e omitidas; cuidados não feitos). */
export function pendenciasHerdadas(
  horarios: readonly Pick<
    HorarioEnfermagem,
    'id' | 'paciente' | 'estado' | 'tipo' | 'descricao' | 'previsto'
  >[],
): Map<number, { tipo: PendenciaPlantao; descricao: string; horario: number }[]> {
  const r = new Map<number, { tipo: PendenciaPlantao; descricao: string; horario: number }[]>();
  for (const h of horarios) {
    let tipo = PENDENCIA_DO_ESTADO[h.estado];
    if (!tipo) continue;
    if (h.tipo === 'cuidado' || h.tipo === 'glicemia') tipo = 'cuidadoNaoFeito';
    const lista = r.get(h.paciente) ?? [];
    lista.push({
      tipo,
      descricao: `${h.descricao} (${h.previsto.slice(11, 16)})`.slice(0, 200),
      horario: h.id,
    });
    r.set(h.paciente, lista);
  }
  return r;
}
