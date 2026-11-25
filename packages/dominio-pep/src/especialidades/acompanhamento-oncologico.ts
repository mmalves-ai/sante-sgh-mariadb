// Acompanhamento oncológico (03-PEP linha 111): a linha de cuidado do paciente com câncer depois do diagnóstico e as
// reações (toxicidades) do tratamento. Regras puras, sem banco:
//   - reação: grau de toxicidade de 1 a 5 (escala CTCAE, Common Terminology Criteria for Adverse Events, do NCI);
//     grau 3 ou mais é grave e pede a conduta; ajustar a dose ou suspender o tratamento pede o tratamento ligado;
//     grau 5 é o óbito ligado à reação e não pode ter evolução de melhora;
//   - acompanhamento: a classificação do paciente na linha de cuidado (investigação, tratamento, seguimento,
//     remissão, recidiva, paliativo, óbito, perda de seguimento), a situação do tumor e a resposta ao tratamento
//     (critérios do tipo RECIST: completa, parcial, estável, progressão). Recidiva pede a data e um tumor que
//     voltou; remissão pede o tumor sem evidência; óbito pede a data e encerra o acompanhamento (nada muda depois).
// Toda mudança vira evento (o histórico nunca é apagado); o tipo do evento sai de `tipoEventoAcompanhamento`.
import type { ErroCampoOnco } from './registro-oncologico.js';

export const CATEGORIAS_REACAO = [
  'hematologica',
  'gastrointestinal',
  'dermatologica',
  'neurologica',
  'cardiaca',
  'renal',
  'hepatica',
  'pulmonar',
  'infusional',
  'constitucional',
  'outra',
] as const;
export type CategoriaReacao = (typeof CATEGORIAS_REACAO)[number];
export const EVOLUCOES_REACAO = ['nova', 'melhora', 'estavel', 'piora', 'resolvida'] as const;
export type EvolucaoReacao = (typeof EVOLUCOES_REACAO)[number];
export const CLASSIFICACOES_PACIENTE_ONCO = [
  'em_investigacao',
  'em_tratamento',
  'em_seguimento',
  'remissao',
  'recidiva',
  'paliativo',
  'obito',
  'perda_seguimento',
] as const;
export type ClassificacaoPacienteOnco = (typeof CLASSIFICACOES_PACIENTE_ONCO)[number];
export const SITUACOES_TUMOR = [
  'sem_evidencia',
  'presente',
  'recidiva_local',
  'recidiva_regional',
  'metastase',
  'desconhecida',
] as const;
export type SituacaoTumor = (typeof SITUACOES_TUMOR)[number];
export const RESPOSTAS_TRATAMENTO = [
  'completa',
  'parcial',
  'estavel',
  'progressao',
  'nao_avaliavel',
] as const;
export type RespostaTratamento = (typeof RESPOSTAS_TRATAMENTO)[number];
export type TipoEventoAcompanhamento = 'classificacao' | 'resposta' | 'recidiva' | 'obito' | 'observacao';

/** Grau a partir do qual a reação é grave (CTCAE 3: grave ou clinicamente significativa). */
export const GRAU_REACAO_GRAVE = 3;

const erro = (campo: string, mensagem: string): ErroCampoOnco => ({ campo, mensagem });
const dia = (s: string) => s.slice(0, 10);

export interface ReacaoEntrada {
  readonly categoria: string;
  readonly descricao: string;
  readonly grau: number;
  readonly evolucao: string;
  readonly avaliadoEm: string;
  readonly conduta: string | null;
  readonly doseAjustada: boolean;
  readonly tratamentoSuspenso: boolean;
  /** Há tratamento oncológico (ou ciclo) ligado à reação. */
  readonly comTratamento: boolean;
}

export function conferirReacao(r: ReacaoEntrada, hoje: string): ErroCampoOnco[] {
  const e: ErroCampoOnco[] = [];
  if (!(CATEGORIAS_REACAO as readonly string[]).includes(r.categoria))
    e.push(erro('categoria', 'Escolha a categoria da reação.'));
  if (!r.descricao.trim()) e.push(erro('descricao', 'Descreva a reação.'));
  if (!Number.isInteger(r.grau) || r.grau < 1 || r.grau > 5)
    e.push(erro('grau', 'O grau da toxicidade vai de 1 a 5 (CTCAE).'));
  if (!(EVOLUCOES_REACAO as readonly string[]).includes(r.evolucao))
    e.push(erro('evolucao', 'Escolha a evolução da reação.'));
  if (dia(r.avaliadoEm) > hoje) e.push(erro('avaliadoEm', 'A avaliação não pode ser no futuro.'));
  if (r.grau >= GRAU_REACAO_GRAVE && !(r.conduta ?? '').trim())
    e.push(erro('conduta', `Reação de grau ${r.grau} é grave: registre a conduta.`));
  if ((r.doseAjustada || r.tratamentoSuspenso) && !r.comTratamento)
    e.push(erro('tratamento', 'Ajuste de dose ou suspensão pede o tratamento oncológico ligado à reação.'));
  if (r.doseAjustada && r.tratamentoSuspenso)
    e.push(erro('doseAjustada', 'Escolha entre ajustar a dose e suspender o tratamento.'));
  if (r.grau === 5 && (r.evolucao === 'melhora' || r.evolucao === 'resolvida'))
    e.push(erro('evolucao', 'Grau 5 é o óbito ligado à reação: não há melhora nem resolução.'));
  return e;
}

export interface AcompanhamentoEntrada {
  readonly classificacao: string;
  readonly situacaoTumor: string | null;
  readonly resposta: string | null;
  readonly primeiroTratamentoEm: string | null;
  readonly recidivaEm: string | null;
  readonly obitoEm: string | null;
}
export interface AcompanhamentoAtual {
  readonly classificacao: ClassificacaoPacienteOnco;
  readonly situacaoTumor: SituacaoTumor | null;
  readonly resposta: RespostaTratamento | null;
  readonly recidivaEm: string | null;
  readonly obitoEm: string | null;
}

const RECIDIVAS: readonly string[] = ['recidiva_local', 'recidiva_regional', 'metastase'];

export function conferirAcompanhamentoOnco(
  a: AcompanhamentoEntrada,
  atual: AcompanhamentoAtual | null,
  hoje: string,
  diagnosticadoEm: string | null,
): ErroCampoOnco[] {
  const e: ErroCampoOnco[] = [];
  if (atual?.classificacao === 'obito')
    return [erro('classificacao', 'O acompanhamento foi encerrado pelo óbito: nada muda depois.')];
  if (!(CLASSIFICACOES_PACIENTE_ONCO as readonly string[]).includes(a.classificacao))
    e.push(erro('classificacao', 'Escolha a classificação do paciente.'));
  if (a.situacaoTumor !== null && !(SITUACOES_TUMOR as readonly string[]).includes(a.situacaoTumor))
    e.push(erro('situacaoTumor', 'Situação do tumor desconhecida.'));
  if (a.resposta !== null && !(RESPOSTAS_TRATAMENTO as readonly string[]).includes(a.resposta))
    e.push(erro('resposta', 'Resposta ao tratamento desconhecida.'));
  for (const [campo, v] of [
    ['primeiroTratamentoEm', a.primeiroTratamentoEm],
    ['recidivaEm', a.recidivaEm],
    ['obitoEm', a.obitoEm],
  ] as const) {
    if (v && dia(v) > hoje) e.push(erro(campo, 'A data não pode ser no futuro.'));
    if (v && diagnosticadoEm && dia(v) < dia(diagnosticadoEm))
      e.push(erro(campo, 'A data não pode ser anterior ao diagnóstico do tumor.'));
  }
  if (a.recidivaEm && a.primeiroTratamentoEm && dia(a.recidivaEm) < dia(a.primeiroTratamentoEm))
    e.push(erro('recidivaEm', 'A recidiva vem depois do primeiro tratamento.'));
  if (a.classificacao === 'recidiva') {
    if (!a.recidivaEm) e.push(erro('recidivaEm', 'Informe a data da recidiva.'));
    if (!a.situacaoTumor || !RECIDIVAS.includes(a.situacaoTumor))
      e.push(erro('situacaoTumor', 'Na recidiva, o tumor voltou: local, regional ou metástase.'));
  }
  if (a.classificacao === 'remissao' && a.situacaoTumor !== 'sem_evidencia')
    e.push(erro('situacaoTumor', 'Remissão é tumor sem evidência de doença.'));
  if (a.classificacao === 'obito' && !a.obitoEm) e.push(erro('obitoEm', 'Informe a data do óbito.'));
  if (a.obitoEm && a.classificacao !== 'obito')
    e.push(erro('classificacao', 'Com a data do óbito, a classificação é óbito.'));
  if (a.resposta === 'completa' && a.situacaoTumor !== null && a.situacaoTumor !== 'sem_evidencia')
    e.push(erro('resposta', 'Resposta completa é tumor sem evidência de doença.'));
  if (a.classificacao === 'em_investigacao' && a.resposta !== null)
    e.push(erro('resposta', 'Em investigação ainda não há resposta ao tratamento.'));
  return e;
}

/** O que a mudança registra na linha do tempo (o mais importante vence). */
export function tipoEventoAcompanhamento(
  a: AcompanhamentoEntrada,
  atual: AcompanhamentoAtual | null,
): TipoEventoAcompanhamento {
  if (a.classificacao === 'obito') return 'obito';
  if (a.recidivaEm && a.recidivaEm !== atual?.recidivaEm) return 'recidiva';
  if (a.classificacao === 'recidiva' && atual?.classificacao !== 'recidiva') return 'recidiva';
  if (a.resposta !== (atual?.resposta ?? null)) return 'resposta';
  if (!atual || a.classificacao !== atual.classificacao) return 'classificacao';
  return 'observacao';
}
