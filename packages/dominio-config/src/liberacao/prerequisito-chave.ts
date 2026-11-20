// Regra 9a do M08 (POL-3, 2026-10-19; ADR 0019): recurso construído e desligado com pré-requisito externo
// (certificado, credenciamento, contrato, aprovação) NÃO pode ser ligado enquanto o pré-requisito faltar; a
// tela diz o que falta. Desligar é sempre permitido (recolher). Pré-requisito vencido conta como falta.
import type { PrerequisitoDeclarado, SituacaoPrerequisito, TipoPrerequisito } from '@sgh/contratos';

export interface PrerequisitoRegistrado {
  readonly tipo: TipoPrerequisito;
  readonly situacao: SituacaoPrerequisito;
  /** AAAA-MM-DD (inclusive); null: sem validade. */
  readonly validade: string | null;
}

export interface FaltaPrerequisito {
  readonly tipo: TipoPrerequisito;
  readonly descricao: string;
  readonly motivo: 'pendente' | 'vencido' | 'sem-registro';
}

/** Data de calendário AAAA-MM-DD em São Paulo (o processo roda em UTC; regra do M02). */
export function diaEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function faltasDoRecurso(
  declarados: readonly PrerequisitoDeclarado[],
  registrados: readonly PrerequisitoRegistrado[],
  agora: Date,
): FaltaPrerequisito[] {
  const hoje = diaEmSaoPaulo(agora);
  const faltas: FaltaPrerequisito[] = [];
  for (const d of declarados) {
    const r = registrados.find((x) => x.tipo === d.tipo);
    if (!r) faltas.push({ tipo: d.tipo, descricao: d.descricao, motivo: 'sem-registro' });
    else if (r.situacao === 'pendente')
      faltas.push({ tipo: d.tipo, descricao: d.descricao, motivo: 'pendente' });
    else if (r.situacao === 'cumprido' && r.validade !== null && r.validade < hoje)
      faltas.push({ tipo: d.tipo, descricao: d.descricao, motivo: 'vencido' });
  }
  return faltas;
}

export type DecisaoChave =
  | { readonly permitido: true }
  | { readonly permitido: false; readonly faltas: readonly FaltaPrerequisito[]; readonly mensagem: string };

/** Ligar exige todos os pré-requisitos cumpridos (ou dispensados) e válidos; desligar, nunca recusa. */
export function decidirChave(
  ligar: boolean,
  declarados: readonly PrerequisitoDeclarado[],
  registrados: readonly PrerequisitoRegistrado[],
  agora: Date,
): DecisaoChave {
  if (!ligar) return { permitido: true };
  const faltas = faltasDoRecurso(declarados, registrados, agora);
  if (faltas.length === 0) return { permitido: true };
  const motivo = { pendente: 'pendente', vencido: 'vencido', 'sem-registro': 'não registrado' } as const;
  return {
    permitido: false,
    faltas,
    mensagem: `Não pode ligar: falta ${faltas.map((f) => `${f.descricao} (${motivo[f.motivo]})`).join('; ')}.`,
  };
}
