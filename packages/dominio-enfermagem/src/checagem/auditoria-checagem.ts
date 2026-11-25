// Auditoria das checagens de enfermagem (09-AREA linha 86): a qualidade sorteia uma amostra das checagens já feitas
// num período (do estabelecimento, de uma unidade ou de um paciente), designa os auditores, avalia cada checagem
// (conforme, não conforme com o motivo padronizado e a justificativa, ou não aplicável com a justificativa) e conclui
// com os totais e o resultado. Regras puras: o sorteio é reprodutível pela semente (quem audita a auditoria refaz a
// mesma amostra), a conclusão só sai com a amostra toda avaliada e o resultado sai da taxa de conformidade.
// Nada é apagado: a auditoria cancelada fica no histórico com o motivo.

export type PapelAuditor = 'responsavel' | 'auditor' | 'observador';
export type ResultadoItemAuditoria = 'pendente' | 'conforme' | 'nao_conforme' | 'nao_aplicavel';
export type ResultadoAuditoria = 'conforme' | 'parcialmente_conforme' | 'nao_conforme';
export type SituacaoAuditoria = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';

export interface ProblemaAuditoria {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Limites da amostra e do período. */
export const AMOSTRA_MAXIMA = 200;
export const PERIODO_MAXIMO_DIAS = 92;
/** Taxa de conformidade (conformes sobre avaliados) a partir da qual a auditoria sai parcialmente conforme. */
export const LIMIAR_PARCIAL = 0.8;
const JUSTIFICATIVA_MINIMA = 10;

const p = (codigo: string, mensagem: string): ProblemaAuditoria => ({ codigo, mensagem });

/** Gerador pseudoaleatório determinístico (mulberry32) semeado pelo texto da semente. */
function gerador(semente: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sorteia `tamanho` checagens entre as candidatas, reprodutível pela semente: a mesma lista (em qualquer ordem) e a
 * mesma semente dão a mesma amostra. A amostra volta na ordem do sorteio (a sequência do item).
 */
export function sortearAmostra(candidatas: readonly number[], tamanho: number, semente: string): number[] {
  const unicas = [...new Set(candidatas)].sort((a, b) => a - b);
  const n = Math.max(0, Math.min(Math.trunc(tamanho), unicas.length));
  const aleatorio = gerador(semente);
  for (let i = unicas.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [unicas[i], unicas[j]] = [unicas[j]!, unicas[i]!];
  }
  return unicas.slice(0, n);
}

export interface PedidoAbertura {
  readonly inicio: Date;
  readonly fim: Date;
  readonly tamanho: number;
  readonly candidatas: number;
  readonly responsavel: number;
  readonly auditores: readonly { readonly usuario: number; readonly papel: PapelAuditor }[];
  readonly agora: Date;
}

/** Confere a abertura: período válido e no passado, amostra possível e ao menos um auditor que avalia. */
export function conferirAbertura(a: PedidoAbertura): ProblemaAuditoria | null {
  if (Number.isNaN(a.inicio.getTime()) || Number.isNaN(a.fim.getTime()))
    return p('periodo-invalido', 'Informe o início e o fim do período auditado.');
  if (a.fim.getTime() < a.inicio.getTime())
    return p('periodo-invalido', 'O fim do período não pode ser antes do início.');
  if (a.inicio.getTime() > a.agora.getTime())
    return p('periodo-futuro', 'O período auditado começa no futuro: só se auditam checagens já feitas.');
  if (a.fim.getTime() - a.inicio.getTime() > PERIODO_MAXIMO_DIAS * 86_400_000)
    return p('periodo-longo', `O período auditado vai até ${PERIODO_MAXIMO_DIAS} dias.`);
  if (!Number.isInteger(a.tamanho) || a.tamanho < 1 || a.tamanho > AMOSTRA_MAXIMA)
    return p('amostra-invalida', `A amostra vai de 1 a ${AMOSTRA_MAXIMA} checagens.`);
  if (a.candidatas === 0)
    return p('sem-checagens', 'Não há checagem feita no período e no recorte escolhidos.');
  const usuarios = a.auditores.map((x) => x.usuario);
  if (new Set(usuarios).size !== usuarios.length)
    return p('auditor-repetido', 'Cada auditor entra uma vez só.');
  if (a.auditores.some((x) => x.papel === 'responsavel' && x.usuario !== a.responsavel))
    return p(
      'responsavel-unico',
      'O responsável é quem abre a auditoria; os demais entram como auditor ou observador.',
    );
  return null;
}

/** Os auditores gravados: o responsável primeiro, depois os designados (sem repetir). */
export function auditoresDaAbertura(
  responsavel: number,
  designados: readonly { readonly usuario: number; readonly papel: PapelAuditor }[],
): { usuario: number; papel: PapelAuditor }[] {
  return [
    { usuario: responsavel, papel: 'responsavel' },
    ...designados
      .filter((d) => d.usuario !== responsavel)
      .map((d) => ({ usuario: d.usuario, papel: d.papel })),
  ];
}

/** Só o responsável e os auditores avaliam; o observador só vê. */
export function podeAvaliar(
  auditores: readonly { readonly usuario: number; readonly papel: PapelAuditor }[],
  usuario: number,
): boolean {
  return auditores.some((a) => a.usuario === usuario && a.papel !== 'observador');
}

export interface AvaliacaoItem {
  readonly situacao: SituacaoAuditoria;
  readonly resultado: ResultadoItemAuditoria;
  readonly motivo: number | null;
  readonly motivoExigeComplemento: boolean;
  readonly justificativa: string | null;
}

/** Confere a avaliação de uma checagem da amostra. */
export function conferirAvaliacao(a: AvaliacaoItem): ProblemaAuditoria | null {
  if (a.situacao === 'concluida' || a.situacao === 'cancelada')
    return p('auditoria-encerrada', 'A auditoria já foi encerrada: a avaliação não muda mais.');
  if (a.resultado === 'pendente')
    return p('avaliacao-invalida', 'Escolha conforme, não conforme ou não aplicável.');
  const texto = (a.justificativa ?? '').trim();
  if (a.resultado === 'nao_conforme') {
    if (a.motivo === null) return p('motivo-obrigatorio', 'A não conformidade pede o motivo padronizado.');
    if (texto.length < JUSTIFICATIVA_MINIMA)
      return p(
        'justificativa-obrigatoria',
        `Descreva a não conformidade (ao menos ${JUSTIFICATIVA_MINIMA} caracteres).`,
      );
  }
  if (a.resultado === 'nao_aplicavel' && texto.length < JUSTIFICATIVA_MINIMA)
    return p(
      'justificativa-obrigatoria',
      `Diga por que a checagem não se aplica (ao menos ${JUSTIFICATIVA_MINIMA} caracteres).`,
    );
  if (a.resultado !== 'nao_conforme' && a.motivo !== null)
    return p('motivo-indevido', 'O motivo de não conformidade só vale para a checagem não conforme.');
  return null;
}

export interface TotaisAuditoria {
  readonly avaliados: number;
  readonly conformes: number;
  readonly naoConformes: number;
  readonly naoAplicaveis: number;
  readonly pendentes: number;
  /** Conformes sobre avaliados (sem os não aplicáveis), de 0 a 1; nulo sem avaliado. */
  readonly taxa: number | null;
}

export function totaisDaAuditoria(itens: readonly ResultadoItemAuditoria[]): TotaisAuditoria {
  const conta = (r: ResultadoItemAuditoria) => itens.filter((x) => x === r).length;
  const conformes = conta('conforme');
  const naoConformes = conta('nao_conforme');
  const avaliados = conformes + naoConformes;
  return {
    avaliados,
    conformes,
    naoConformes,
    naoAplicaveis: conta('nao_aplicavel'),
    pendentes: conta('pendente'),
    taxa: avaliados === 0 ? null : conformes / avaliados,
  };
}

/** O resultado pela taxa: tudo conforme; a partir do limiar, parcialmente conforme; abaixo, não conforme. */
export function resultadoPelaTaxa(t: TotaisAuditoria): ResultadoAuditoria | null {
  if (t.taxa === null) return null;
  if (t.naoConformes === 0) return 'conforme';
  return t.taxa >= LIMIAR_PARCIAL ? 'parcialmente_conforme' : 'nao_conforme';
}

export type Conclusao =
  | { readonly ok: true; readonly totais: TotaisAuditoria; readonly resultado: ResultadoAuditoria }
  | { readonly ok: false; readonly problema: ProblemaAuditoria };

/** Conclui: amostra toda avaliada e ao menos uma checagem aplicável; totais e resultado pela taxa. */
export function concluirAuditoria(
  situacao: SituacaoAuditoria,
  itens: readonly ResultadoItemAuditoria[],
): Conclusao {
  if (situacao === 'concluida' || situacao === 'cancelada')
    return { ok: false, problema: p('auditoria-encerrada', 'A auditoria já foi encerrada.') };
  const totais = totaisDaAuditoria(itens);
  if (totais.pendentes > 0)
    return {
      ok: false,
      problema: p(
        'amostra-incompleta',
        `Faltam ${totais.pendentes} checagem(ns) da amostra para avaliar antes de concluir.`,
      ),
    };
  const resultado = resultadoPelaTaxa(totais);
  if (resultado === null)
    return {
      ok: false,
      problema: p(
        'sem-avaliado',
        'Todas as checagens da amostra ficaram como não aplicáveis: cancele a auditoria com o motivo.',
      ),
    };
  return { ok: true, totais, resultado };
}

/** O cancelamento: só a auditoria não encerrada, com o motivo. */
export function conferirCancelamentoAuditoria(
  situacao: SituacaoAuditoria,
  motivo: string | null,
): ProblemaAuditoria | null {
  if (situacao === 'concluida' || situacao === 'cancelada')
    return p('auditoria-encerrada', 'A auditoria já foi encerrada.');
  if ((motivo ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    return p(
      'motivo-obrigatorio',
      `Diga o motivo do cancelamento (ao menos ${JUSTIFICATIVA_MINIMA} caracteres).`,
    );
  return null;
}
