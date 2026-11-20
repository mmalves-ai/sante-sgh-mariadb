// M59-F5 (ficha do M59, regra 9; cap-13 §13.6.1, §13.6.2): os ciclos de avaliação da certificação.
// - Autoavaliação: uma por mês (competência), requisito a requisito, conduzida pelo responsável de conformidade; aceita
//   "concessão" para o requisito cuja concessão da coexistência ainda está vigente (relatório de lacunas: o que é
//   concessão e o que é defeito do novo).
// - Pré-auditoria: consultor externo, na versão candidata, com o desligamento concluído; concessão aí é não
//   conformidade. O parecer é "apto" quando nenhuma não conformidade bloqueante fica sem correção verificada.
// - Auditoria formal: só com o desligamento concluído, as concessões encerradas, os requisitos do conteúdo do
//   prontuário que dependem de entrega da Fase 5 liberados e uma pré-auditoria concluída apta; concluída apta, leva o
//   número do certificado (o rodapé "sistema certificado SBIS nº" só aparece depois dele, SBIS-42).
// A correção de não conformidade é registrada por quem corrigiu e verificada por outra pessoa.
import {
  type AbrirCicloPedido,
  type AvaliarItemPedido,
  type CodigoConcessao,
  type ConcluirCicloPedido,
  type ItemCicloSbis,
  type ParecerSbis,
  type RecusaSbis,
  REQUISITOS_SBIS,
  type RequisitoSbis,
  type ResumoResultadosSbis,
  type SituacaoCicloSbis,
  type TipoCicloSbis,
} from '@sgh/contratos';
import type { SituacaoEstabelecimento } from './concessoes.js';

/** O ciclo como a regra o vê (sem os itens). */
export interface CicloRegra {
  readonly id: string;
  readonly tipo: TipoCicloSbis;
  readonly competencia: string;
  readonly situacao: SituacaoCicloSbis;
  readonly parecer: ParecerSbis | null;
  readonly certificado: string | null;
  readonly concluidoEm: string | null;
}

const REQ = new Map(REQUISITOS_SBIS.map((r) => [r.codigo, r]));

export function requisitoSbis(codigo: string): RequisitoSbis | null {
  return REQ.get(codigo) ?? null;
}

/** Competência AAAA-MM de uma data civil AAAA-MM-DD. */
export const competenciaDe = (dia: string): string => dia.slice(0, 7);

export interface ContextoAbertura {
  readonly ciclos: readonly CicloRegra[];
  readonly situacao: SituacaoEstabelecimento;
  readonly concessoesVigentes: number;
  /** Os requisitos do ECF marcados como Fase 5 estão liberados no estabelecimento. */
  readonly fase5Liberada: boolean;
  /** Competência de hoje (AAAA-MM). */
  readonly competencia: string;
}

/** A auditoria formal pode ser aberta agora (regra 9)? Mesma conta da abertura, para o painel. */
export function recusaAuditoriaFormal(ctx: Omit<ContextoAbertura, 'competencia'>): RecusaSbis | null {
  if (!ctx.situacao.desligado) return 'sistema-anterior-ligado';
  if (ctx.concessoesVigentes > 0) return 'concessoes-vigentes';
  if (!ctx.fase5Liberada) return 'fase5-pendente';
  const preApta = ctx.ciclos.some(
    (c) => c.tipo === 'pre-auditoria' && c.situacao === 'concluido' && c.parecer === 'apto',
  );
  return preApta ? null : 'auditoria-sem-pre-auditoria';
}

export function recusaAbrirCiclo(p: AbrirCicloPedido, ctx: ContextoAbertura): RecusaSbis | null {
  if (ctx.ciclos.some((c) => c.tipo === p.tipo && c.situacao === 'aberto')) return 'ciclo-aberto-do-tipo';
  if (p.tipo === 'autoavaliacao') {
    const feita = ctx.ciclos.some(
      (c) => c.tipo === 'autoavaliacao' && c.situacao === 'concluido' && c.competencia === ctx.competencia,
    );
    return feita ? 'autoavaliacao-do-mes' : null;
  }
  if (!p.avaliador?.trim()) return 'avaliador-obrigatorio';
  if (p.tipo === 'pre-auditoria') return ctx.situacao.desligado ? null : 'sistema-anterior-ligado';
  return recusaAuditoriaFormal(ctx);
}

/** Os itens do ciclo recém-aberto: todo o catálogo, pendente. */
export function itensIniciais(): ItemCicloSbis[] {
  return REQUISITOS_SBIS.map((r) => ({
    requisito: r.codigo,
    nivel: r.nivel,
    titulo: r.titulo,
    resultado: 'pendente',
    severidade: null,
    origem: null,
    evidencia: null,
    observacao: null,
    avaliadoPor: null,
    avaliadoEm: null,
    correcao: null,
    correcaoDescricao: null,
    corrigidoPor: null,
    corrigidoEm: null,
    verificadoPor: null,
    verificadoEm: null,
  }));
}

const preenchido = (t: string | undefined) => (t ?? '').trim().length > 0;

export function recusaAvaliarItem(
  ciclo: CicloRegra,
  requisito: string,
  p: AvaliarItemPedido,
  vigentes: ReadonlySet<CodigoConcessao>,
  atual?: Pick<ItemCicloSbis, 'resultado' | 'correcao'>,
): RecusaSbis | null {
  if (ciclo.situacao !== 'aberto') return 'ciclo-fechado';
  const r = REQ.get(requisito);
  if (!r) return 'requisito-desconhecido';
  // A não conformidade só se reavalia depois da correção verificada por outra pessoa: sem isso, quem a registrou
  // (e corrigiu) a apagaria avaliando o requisito de novo, e o parecer sairia apto sem a verificação (D-CICLOS-F5).
  if (atual?.resultado === 'nao-conforme' && atual.correcao !== 'verificada') return 'nc-sem-verificacao';
  switch (p.resultado) {
    case 'concessao':
      if (ciclo.tipo !== 'autoavaliacao') return 'concessao-fora-da-autoavaliacao';
      if (!r.concessao || !vigentes.has(r.concessao)) return 'concessao-encerrada';
      return null;
    case 'nao-conforme':
      if (!p.severidade || !p.origem) return 'nc-sem-severidade';
      return preenchido(p.evidencia) ? null : 'evidencia-obrigatoria';
    case 'conforme':
      return preenchido(p.evidencia) ? null : 'evidencia-obrigatoria';
    case 'nao-aplicavel':
      return preenchido(p.observacao) ? null : 'evidencia-obrigatoria';
  }
}

/** O item depois da avaliação (a não conformidade abre a correção; os demais resultados a limpam). */
export function aplicarAvaliacao(
  item: ItemCicloSbis,
  p: AvaliarItemPedido,
  por: string,
  em: string,
): ItemCicloSbis {
  const nc = p.resultado === 'nao-conforme';
  return {
    ...item,
    resultado: p.resultado,
    severidade: nc ? (p.severidade ?? null) : null,
    origem: nc ? (p.origem ?? null) : p.resultado === 'concessao' ? 'concessao' : null,
    evidencia: p.evidencia?.trim() || null,
    observacao: p.observacao?.trim() || null,
    avaliadoPor: por,
    avaliadoEm: em,
    correcao: nc ? 'aberta' : null,
    correcaoDescricao: null,
    corrigidoPor: null,
    corrigidoEm: null,
    verificadoPor: null,
    verificadoEm: null,
  };
}

export function recusaCorrigirItem(ciclo: CicloRegra, item: ItemCicloSbis): RecusaSbis | null {
  if (ciclo.situacao !== 'aberto') return 'ciclo-fechado';
  if (item.resultado !== 'nao-conforme') return 'item-nao-conforme';
  return item.correcao === 'aberta' ? null : 'correcao-nao-aberta';
}

export function recusaVerificarItem(ciclo: CicloRegra, item: ItemCicloSbis, por: string): RecusaSbis | null {
  if (ciclo.situacao !== 'aberto') return 'ciclo-fechado';
  if (item.resultado !== 'nao-conforme') return 'item-nao-conforme';
  if (item.correcao !== 'corrigida') return 'correcao-nao-corrigida';
  return item.corrigidoPor === por ? 'verificador-igual' : null;
}

export function resumirItens(itens: readonly ItemCicloSbis[]): ResumoResultadosSbis {
  const r: ResumoResultadosSbis = {
    pendente: 0,
    conforme: 0,
    'nao-conforme': 0,
    concessao: 0,
    'nao-aplicavel': 0,
    bloqueantesAbertas: 0,
    defeitos: 0,
  };
  for (const i of itens) {
    r[i.resultado]++;
    if (i.resultado !== 'nao-conforme') continue;
    if (i.origem === 'defeito') r.defeitos++;
    if (i.severidade === 'bloqueante' && i.correcao !== 'verificada') r.bloqueantesAbertas++;
  }
  return r;
}

export const parecerDosItens = (itens: readonly ItemCicloSbis[]): ParecerSbis =>
  resumirItens(itens).bloqueantesAbertas > 0 ? 'com-bloqueante' : 'apto';

export function recusaConcluirCiclo(
  ciclo: CicloRegra,
  itens: readonly ItemCicloSbis[],
  p: Pick<ConcluirCicloPedido, 'certificado'>,
): RecusaSbis | null {
  if (ciclo.situacao !== 'aberto') return 'ciclo-fechado';
  if (itens.some((i) => i.resultado === 'pendente')) return 'itens-pendentes';
  const apta = parecerDosItens(itens) === 'apto';
  if (p.certificado && (ciclo.tipo !== 'auditoria' || !apta)) return 'certificado-so-na-auditoria';
  if (ciclo.tipo === 'auditoria' && apta && !p.certificado) return 'certificado-obrigatorio';
  return null;
}

export const recusaCancelarCiclo = (ciclo: CicloRegra): RecusaSbis | null =>
  ciclo.situacao === 'aberto' ? null : 'ciclo-fechado';

/** O número do certificado para o rodapé: o da auditoria concluída apta mais recente (SBIS-42). */
export function certificadoVigente(ciclos: readonly CicloRegra[]): string | null {
  const aptas = ciclos
    .filter(
      (c) => c.tipo === 'auditoria' && c.situacao === 'concluido' && c.parecer === 'apto' && c.certificado,
    )
    .sort((a, b) => (b.concluidoEm ?? '').localeCompare(a.concluidoEm ?? ''));
  return aptas[0]?.certificado ?? null;
}

/**
 * Os requisitos do ECF que dependem de entrega da Fase 5 estão prontos quando a pré-auditoria apta mais recente os
 * avaliou todos como conformes (regra 9; cap-13 §13.6.1, Atenção). Sem pré-auditoria apta, não estão.
 */
export function fase5Pronta(itensDaPreAuditoriaApta: readonly ItemCicloSbis[] | null): boolean {
  if (!itensDaPreAuditoriaApta) return false;
  const porCodigo = new Map(itensDaPreAuditoriaApta.map((i) => [i.requisito, i.resultado]));
  return REQUISITOS_SBIS.filter((r) => r.fase5).every((r) => porCodigo.get(r.codigo) === 'conforme');
}
