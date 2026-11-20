// Regra 2 do M48 (cap-05b §5.11; RDC 36/2013; Classificação Internacional para a Segurança do Paciente da OMS):
// circunstância notificável, quase erro, incidente sem dano e evento adverso, com o grau e o tipo de dano.
//   - Quem notifica não precisa saber a taxonomia (manual m17): responde se chegou ao paciente e o dano percebido, e o
//     sistema PROPÕE a classificação; o NSP confirma ou corrige na triagem.
//   - Coerência: o que não atingiu o paciente (circunstância, quase erro) e o incidente sem dano têm dano "nenhum"; o
//     evento adverso tem dano de leve a óbito.
//   - Notivisa (RDC 36/2013, art. 10): obrigatório para o evento adverso; o óbito tem o prazo de 72 h. Os demais são
//     recomendados (o NSP pode transcrever mesmo assim).
import { CLASSIFICACOES_OMS, ordemDoDano, type ClassificacaoOms, type GrauDano } from '@sgh/contratos';

/** Proposta a partir do que o notificador respondeu. */
export function propostaDeClassificacao(chegouAoPaciente: boolean, dano: GrauDano): ClassificacaoOms {
  if (!chegouAoPaciente) return 'quaseErro';
  return dano === 'nenhum' ? 'incidenteSemDano' : 'eventoAdverso';
}

export type ProblemaClassificacao =
  'dano-sem-ter-atingido' | 'evento-adverso-sem-dano' | 'incidente-sem-dano-com-dano';

/** Confere a classificação com o grau de dano (null: coerente). */
export function conferirClassificacao(c: ClassificacaoOms, dano: GrauDano): ProblemaClassificacao | null {
  const atingiu = CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.atingiu ?? false;
  if (!atingiu && dano !== 'nenhum') return 'dano-sem-ter-atingido';
  if (c === 'eventoAdverso' && dano === 'nenhum') return 'evento-adverso-sem-dano';
  if (c === 'incidenteSemDano' && dano !== 'nenhum') return 'incidente-sem-dano-com-dano';
  return null;
}

/** Evento adverso com óbito (prazo de 72 h; análise de causa raiz em 60 dias). */
export function ehObito(c: ClassificacaoOms, dano: GrauDano): boolean {
  return c === 'eventoAdverso' && dano === 'obito';
}

/** A notificação ao Notivisa é obrigatória (evento adverso, de qualquer grau)? */
export function notivisaObrigatorio(c: ClassificacaoOms): boolean {
  return c === 'eventoAdverso';
}

/** Dano grave ou óbito: o NSP é avisado na hora (a fila de triagem põe no topo). */
export function exigeAtencaoImediata(dano: GrauDano, neverEvent = false): boolean {
  return neverEvent || ordemDoDano(dano) >= ordemDoDano('grave');
}
