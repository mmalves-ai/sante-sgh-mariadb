// Auditorias internas, comissões, matriz de riscos GUT e não conformidades (M48, etapa 5; cap-13 §13.3.10 e §13.3.12;
// DP-47.9: checklists configuráveis, sem o conteúdo do Manual OPSS até a compra). Regras puras: a conformidade do
// checklist com as parcelas, o quórum e o atraso da comissão, a pontuação e a prioridade GUT, e o ciclo da não
// conformidade (aberta → em tratamento → verificação → encerrada; ineficaz volta ao tratamento).
import {
  CLASSIFICACOES_NAO_CONFORMIDADE,
  type ClassificacaoNaoConformidade,
  type ItemChecklistAuditoria,
  mesesDaPeriodicidadeComissao,
  type PeriodicidadeComissao,
  PRIORIDADES_RISCO,
  type PrioridadeRisco,
  type RegistrarNaoConformidadeEntrada,
  type RegistrarReuniaoComissaoEntrada,
  type RegistrarRiscoEntrada,
  type ResultadoChecklist,
  type SituacaoNaoConformidade,
} from '@sgh/contratos';
import { duasCasas, noFuturo, numeroBr, somarDiasData, somarMeses } from './comum.js';

// ── Auditoria interna ────────────────────────────────────────────────────────────────────────────────────────────

/** Conformidade = (conformes + 0,5 × parciais) ÷ avaliados × 100; o "não se aplica" fica fora do denominador. */
export function resultadoChecklist(
  itens: readonly Pick<ItemChecklistAuditoria, 'resultado'>[],
): ResultadoChecklist {
  const conta = (r: ItemChecklistAuditoria['resultado']) => itens.filter((i) => i.resultado === r).length;
  const conformes = conta('conforme');
  const parciais = conta('parcial');
  const naoConformes = conta('naoConforme');
  const naoAplicaveis = conta('naoAplicavel');
  const avaliados = conformes + parciais + naoConformes;
  const valor = avaliados > 0 ? duasCasas(((conformes + 0.5 * parciais) / avaliados) * 100) : null;
  return {
    conformes,
    parciais,
    naoConformes,
    naoAplicaveis,
    avaliados,
    conformidade: valor,
    conta:
      valor === null ? null : `(${conformes} + 0,5 × ${parciais}) ÷ ${avaliados} × 100 = ${numeroBr(valor)}%`,
  };
}

export type RecusaAuditoria = 'data-futura' | 'item-nao-conforme-sem-evidencia';

/** A auditoria: não no futuro; todo item não conforme ou parcial com a evidência (o achado). */
export function recusaAuditoria(
  e: { readonly realizadaEm: string; readonly itens: readonly ItemChecklistAuditoria[] },
  hoje: string,
): RecusaAuditoria | null {
  if (e.realizadaEm > hoje) return 'data-futura';
  if (
    e.itens.some(
      (i) =>
        (i.resultado === 'naoConforme' || i.resultado === 'parcial') && (i.evidencia?.trim().length ?? 0) < 5,
    )
  )
    return 'item-nao-conforme-sem-evidencia';
  return null;
}

// ── Comissões ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Quórum de maioria simples: mais da metade dos membros presentes. */
export function temQuorum(membros: number, presentes: number): boolean {
  return membros > 0 && presentes > membros / 2;
}

/** A data até quando a próxima reunião ordinária deve acontecer (a última mais a periodicidade). */
export function proximaReuniaoAte(
  ultima: string | null,
  periodicidade: PeriodicidadeComissao,
): string | null {
  return ultima === null
    ? null
    : somarMeses(ultima.slice(0, 10), mesesDaPeriodicidadeComissao(periodicidade));
}

/** A comissão ativa está atrasada: passou da data da próxima ordinária (ou nunca se reuniu e tem mais de um período). */
export function comissaoAtrasada(e: {
  readonly ativa: boolean;
  readonly periodicidade: PeriodicidadeComissao;
  readonly ultimaOrdinaria: string | null;
  readonly criadaEm: string;
  readonly hoje: string;
}): boolean {
  if (!e.ativa) return false;
  const base = e.ultimaOrdinaria ?? e.criadaEm;
  return somarMeses(base.slice(0, 10), mesesDaPeriodicidadeComissao(e.periodicidade)) < e.hoje;
}

export type RecusaComissao =
  | 'comissao-inativa'
  | 'reuniao-futura'
  | 'presente-fora-da-composicao'
  | 'presente-repetido'
  | 'comissao-duplicada'
  | 'versao-desatualizada'
  | 'comissao-inexistente'
  | 'membro-repetido';

export function recusaReuniao(
  e: Pick<RegistrarReuniaoComissaoEntrada, 'realizadaEm' | 'presentes'>,
  comissao: { readonly ativa: boolean; readonly membros: number },
  agora: string,
): RecusaComissao | null {
  if (!comissao.ativa) return 'comissao-inativa';
  if (noFuturo(e.realizadaEm, agora)) return 'reuniao-futura';
  if (e.presentes.some((p) => p >= comissao.membros)) return 'presente-fora-da-composicao';
  if (new Set(e.presentes).size !== e.presentes.length) return 'presente-repetido';
  return null;
}

/** A composição sem o mesmo nome duas vezes (o nome comparado sem caixa nem espaços repetidos). */
export function membrosRepetidos(membros: readonly { readonly nome: string }[]): boolean {
  const n = membros.map((m) => m.nome.trim().replace(/\s+/g, ' ').toUpperCase());
  return new Set(n).size !== n.length;
}

// ── Matriz de riscos GUT ─────────────────────────────────────────────────────────────────────────────────────────

export function pontuacaoGut(g: number, u: number, t: number): number {
  for (const v of [g, u, t])
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error('Ponto GUT fora de 1 a 5.');
  return g * u * t;
}

/** A prioridade pela pontuação (crítica de 64 a 125; alta de 27; moderada de 8; baixa abaixo). */
export function prioridadeGut(pontuacao: number): PrioridadeRisco {
  return PRIORIDADES_RISCO.find((p) => pontuacao >= p.minimo)?.codigo ?? 'baixa';
}

/** A conta impressa da pontuação. */
export const contaGut = (g: number, u: number, t: number): string => `${g} × ${u} × ${t} = ${g * u * t}`;

export type RecusaRisco =
  | 'justificativa-obrigatoria'
  | 'controles-obrigatorios'
  | 'reavaliacao-no-passado'
  | 'versao-desatualizada'
  | 'risco-inexistente'
  | 'risco-encerrado';

/**
 * O risco: aceito ou encerrado com a justificativa; o crítico em tratamento ou mitigado com os controles; o ativo com
 * a reavaliação a partir de hoje; o encerrado não volta (registre outro).
 */
export function recusaRisco(
  e: Pick<
    RegistrarRiscoEntrada,
    'gravidade' | 'urgencia' | 'tendencia' | 'situacao' | 'controles' | 'justificativa' | 'reavaliarEm'
  > & { readonly controlesLista?: readonly unknown[] | undefined },
  existente: { readonly versao: number; readonly situacao: string } | null,
  versao: number | null,
  hoje: string,
): RecusaRisco | null {
  if (existente) {
    if (existente.situacao === 'encerrado') return 'risco-encerrado';
    if (existente.versao !== versao) return 'versao-desatualizada';
  }
  if ((e.situacao === 'aceito' || e.situacao === 'encerrado') && (e.justificativa?.trim().length ?? 0) < 10)
    return 'justificativa-obrigatoria';
  const critico = prioridadeGut(pontuacaoGut(e.gravidade, e.urgencia, e.tendencia)) === 'critica';
  if (
    critico &&
    (e.situacao === 'emTratamento' || e.situacao === 'mitigado') &&
    (e.controles?.trim().length ?? 0) < 10 &&
    (e.controlesLista?.length ?? 0) === 0
  )
    return 'controles-obrigatorios';
  if (e.situacao !== 'encerrado' && e.reavaliarEm < hoje) return 'reavaliacao-no-passado';
  return null;
}

export const reavaliacaoVencida = (
  r: { readonly situacao: string; readonly reavaliarEm: string },
  hoje: string,
) => r.situacao !== 'encerrado' && r.reavaliarEm < hoje;

// ── Não conformidades ────────────────────────────────────────────────────────────────────────────────────────────

/** O prazo padrão do tratamento pela classificação (maior 30 dias; menor 60; observação 90). */
export function prazoPadraoNaoConformidade(c: ClassificacaoNaoConformidade, abertaEm: string): string {
  const dias = CLASSIFICACOES_NAO_CONFORMIDADE.find((x) => x.codigo === c)?.diasPadrao ?? 60;
  return somarDiasData(abertaEm.slice(0, 10), dias);
}

const TRANSICOES_NC: Readonly<Record<SituacaoNaoConformidade, readonly SituacaoNaoConformidade[]>> = {
  aberta: ['aberta', 'emTratamento'],
  emTratamento: ['emTratamento', 'verificacao'],
  verificacao: ['verificacao', 'encerrada', 'emTratamento'],
  encerrada: [],
};

export type RecusaNaoConformidade =
  | 'transicao-invalida'
  | 'tratamento-incompleto'
  | 'eficacia-obrigatoria'
  | 'eficacia-fora-de-hora'
  | 'ineficaz-nao-encerra'
  | 'versao-desatualizada'
  | 'nao-conformidade-inexistente'
  | 'origem-sem-registro'
  | 'origem-cancelada'
  | 'prazo-no-passado'
  | 'origem-alterada';

/**
 * O andamento da não conformidade. A nova nasce aberta ou já em tratamento; em tratamento exige causa, plano,
 * responsável e prazo; a verificação e o encerramento exigem a eficácia (eficaz encerra; ineficaz volta ao tratamento);
 * a eficácia só na verificação ou no encerramento; origem e registro de origem não mudam.
 */
export function recusaNaoConformidade(
  e: Pick<
    RegistrarNaoConformidadeEntrada,
    | 'origem'
    | 'idOrigem'
    | 'situacao'
    | 'causa'
    | 'plano'
    | 'responsavel'
    | 'prazo'
    | 'eficacia'
    | 'eficaciaTexto'
    | 'versao'
  >,
  existente: {
    readonly versao: number;
    readonly situacao: SituacaoNaoConformidade;
    readonly origem: string;
    readonly idOrigem: number | null;
    readonly prazo: string | null;
  } | null,
  hoje: string,
): RecusaNaoConformidade | null {
  const comRegistro = ['auditoria', 'risco', 'ouvidoria', 'notificacao'].includes(e.origem);
  if (comRegistro !== (e.idOrigem !== null)) return 'origem-sem-registro';
  if (existente) {
    if (existente.versao !== e.versao) return 'versao-desatualizada';
    if (existente.origem !== e.origem || existente.idOrigem !== e.idOrigem) return 'origem-alterada';
    if (!TRANSICOES_NC[existente.situacao].includes(e.situacao)) return 'transicao-invalida';
  } else if (e.situacao !== 'aberta' && e.situacao !== 'emTratamento') return 'transicao-invalida';
  const ok = (v: string | null, min: number) => (v?.trim().length ?? 0) >= min;
  if (
    e.situacao !== 'aberta' &&
    (!ok(e.causa, 10) || !ok(e.plano, 10) || !ok(e.responsavel, 3) || e.prazo === null)
  )
    return 'tratamento-incompleto';
  // O prazo novo (ou alterado) não fica no passado; o já vencido pode seguir até a verificação.
  if (e.prazo !== null && e.prazo < hoje && e.prazo !== (existente?.prazo ?? null)) return 'prazo-no-passado';
  const naVerificacao = e.situacao === 'verificacao' || e.situacao === 'encerrada';
  if (!naVerificacao && e.eficacia !== null) return 'eficacia-fora-de-hora';
  if (e.situacao === 'encerrada') {
    if (e.eficacia === null || !ok(e.eficaciaTexto, 10)) return 'eficacia-obrigatoria';
    if (e.eficacia === 'ineficaz') return 'ineficaz-nao-encerra';
  }
  return null;
}

export const naoConformidadeVencida = (
  n: { readonly situacao: SituacaoNaoConformidade; readonly prazo: string | null },
  hoje: string,
): boolean => n.situacao !== 'encerrada' && n.prazo !== null && n.prazo < hoje;
