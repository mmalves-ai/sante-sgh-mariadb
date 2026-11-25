// Plano da pré-internação e fila de espera eletiva (C2-048, 04-INT linha 70). Regras puras, sem banco:
//   - o plano previsto da pré-internação: procedimentos (item faturável, quantidade, principal, via de acesso, se entra
//     na guia de solicitação de internação do padrão TISS), materiais e medicamentos (insumo, quantidade, fornecedor
//     previsto para consignado ou OPME) e a equipe prevista (profissional e função na equipe). Cada lista é única pela
//     chave natural (o mesmo procedimento, o mesmo insumo, o mesmo profissional na mesma função não se repetem);
//   - havendo procedimentos, exatamente um é o principal: sem marcação, o primeiro passa a ser (menos um clique); duas
//     marcações são recusadas. A guia TISS de solicitação de internação leva ao menos o principal;
//   - o plano só muda enquanto a pré-internação está pendente (solicitada, aguardando autorização, autorizada,
//     confirmada ou na fila de espera); internada, cancelada ou com falta, o plano é histórico;
//   - a fila de espera eletiva (pré-internação sem data) é ordenada pela prioridade clínica (urgente, prioritária,
//     normal) e, na mesma prioridade, pela data do pedido (quem pediu antes vem antes); o número do agendamento
//     desempata. A mudança de prioridade exige justificativa (transparência da fila, como nas filas reguladas do SUS).

export const PRIORIDADES_FILA_INTERNACAO = ['urgente', 'prioritaria', 'normal'] as const;
export type PrioridadeFilaInternacao = (typeof PRIORIDADES_FILA_INTERNACAO)[number];
export const VIAS_ACESSO_PROCEDIMENTO = ['unica', 'mesma_via', 'diferente_via'] as const;
export type ViaAcessoProcedimento = (typeof VIAS_ACESSO_PROCEDIMENTO)[number];
export const SITUACOES_PRE_INTERNACAO_PENDENTES = [
  'solicitado',
  'aguardando_autorizacao',
  'autorizado',
  'confirmado',
  'em_espera',
] as const;

export const MAX_ITENS_PLANO = 30;
export const MIN_JUSTIFICATIVA_PRIORIDADE = 10;

export interface ProblemaPlanoPre {
  readonly campo: string;
  readonly mensagem: string;
}
export type ResultadoPlanoPre<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly problemas: readonly ProblemaPlanoPre[] };

export interface ProcedimentoPrevistoEntrada {
  readonly item: number;
  readonly quantidade: number;
  readonly principal: boolean;
  readonly viaAcesso: ViaAcessoProcedimento | null;
  readonly incluirNaGuia: boolean;
}
export interface MaterialPrevistoEntrada {
  readonly insumo: number;
  readonly quantidade: number;
  readonly fornecedor: number | null;
  readonly observacao: string | null;
}
export interface ProfissionalPrevistoEntrada {
  readonly profissional: number;
  readonly funcao: number;
}
export interface PlanoPreEntrada {
  readonly procedimentos: readonly ProcedimentoPrevistoEntrada[];
  readonly materiais: readonly MaterialPrevistoEntrada[];
  readonly equipe: readonly ProfissionalPrevistoEntrada[];
}

/** O plano só muda com a pré-internação pendente; depois é histórico. */
export function planoEditavel(situacao: string): boolean {
  return (SITUACOES_PRE_INTERNACAO_PENDENTES as readonly string[]).includes(situacao);
}

const quantidadeValida = (q: number) => Number.isFinite(q) && q > 0 && q <= 99_999;

/** Confere o plano inteiro e devolve o plano normalizado (principal definido, observação aparada). */
export function validarPlanoPreInternacao(
  e: PlanoPreEntrada,
  situacao: string,
): ResultadoPlanoPre<{ valor: PlanoPreEntrada }> {
  const problemas: ProblemaPlanoPre[] = [];
  if (!planoEditavel(situacao))
    problemas.push({
      campo: 'situacao',
      mensagem: 'A pré-internação não está pendente: o plano é histórico e não muda.',
    });
  const listas: [keyof PlanoPreEntrada, number][] = [
    ['procedimentos', e.procedimentos.length],
    ['materiais', e.materiais.length],
    ['equipe', e.equipe.length],
  ];
  for (const [campo, n] of listas)
    if (n > MAX_ITENS_PLANO)
      problemas.push({ campo, mensagem: `No máximo ${MAX_ITENS_PLANO} linhas em cada lista do plano.` });

  const itens = new Set<number>();
  e.procedimentos.forEach((p, i) => {
    if (!quantidadeValida(p.quantidade))
      problemas.push({
        campo: `procedimentos.${i}.quantidade`,
        mensagem: 'A quantidade do procedimento deve ser maior que zero.',
      });
    if (itens.has(p.item))
      problemas.push({ campo: `procedimentos.${i}.item`, mensagem: 'O procedimento já está no plano.' });
    itens.add(p.item);
  });
  const principais = e.procedimentos.filter((p) => p.principal).length;
  if (principais > 1)
    problemas.push({
      campo: 'procedimentos',
      mensagem: 'Só um procedimento é o principal da internação.',
    });
  const procedimentos = e.procedimentos.map((p, i) =>
    principais === 0 && i === 0 ? { ...p, principal: true, incluirNaGuia: true } : p,
  );
  const principal = procedimentos.find((p) => p.principal);
  if (principal && !principal.incluirNaGuia)
    problemas.push({
      campo: 'procedimentos',
      mensagem: 'O procedimento principal entra na guia de solicitação de internação.',
    });

  const insumos = new Set<number>();
  e.materiais.forEach((m, i) => {
    if (!quantidadeValida(m.quantidade))
      problemas.push({
        campo: `materiais.${i}.quantidade`,
        mensagem: 'A quantidade do material deve ser maior que zero.',
      });
    if (insumos.has(m.insumo))
      problemas.push({ campo: `materiais.${i}.insumo`, mensagem: 'O material já está no plano.' });
    insumos.add(m.insumo);
  });

  const pares = new Set<string>();
  e.equipe.forEach((p, i) => {
    const chave = `${p.profissional}:${p.funcao}`;
    if (pares.has(chave))
      problemas.push({
        campo: `equipe.${i}.profissional`,
        mensagem: 'O profissional já está na equipe nesta função.',
      });
    pares.add(chave);
  });

  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    valor: {
      procedimentos,
      materiais: e.materiais.map((m) => ({ ...m, observacao: m.observacao?.trim() || null })),
      equipe: e.equipe,
    },
  };
}

/** Linha da lista gravada: a chave natural e se está vigente (excluída = removida do plano, guardada). */
export interface LinhaPlanoGravada {
  readonly id: number;
  readonly chave: string;
  readonly sequencia: number;
  readonly vigente: boolean;
  readonly versao: number;
}
export interface DiferencaPlano<T> {
  /** Linhas novas, com a sequência a usar. */
  readonly incluir: readonly { readonly valor: T; readonly sequencia: number }[];
  /** Linhas existentes (vigentes ou removidas antes) que ficam no plano com os valores novos. */
  readonly manter: readonly { readonly id: number; readonly versao: number; readonly valor: T }[];
  /** Linhas vigentes que saem do plano (marcadas como excluídas, nunca apagadas). */
  readonly remover: readonly { readonly id: number; readonly versao: number }[];
}

/**
 * Compara a lista nova com a gravada pela chave natural: o que já existia é atualizado (e volta, se tinha saído), o que
 * é novo entra no fim da sequência e o que saiu é marcado como removido. Nada se apaga.
 */
export function diferencaPlano<T>(
  gravadas: readonly LinhaPlanoGravada[],
  novas: readonly T[],
  chaveDe: (v: T) => string,
): DiferencaPlano<T> {
  const porChave = new Map(gravadas.map((g) => [g.chave, g]));
  let proxima = gravadas.reduce((m, g) => Math.max(m, g.sequencia), 0);
  const incluir: { valor: T; sequencia: number }[] = [];
  const manter: { id: number; versao: number; valor: T }[] = [];
  const ficam = new Set<string>();
  for (const v of novas) {
    const chave = chaveDe(v);
    ficam.add(chave);
    const g = porChave.get(chave);
    if (g) manter.push({ id: g.id, versao: g.versao, valor: v });
    else incluir.push({ valor: v, sequencia: ++proxima });
  }
  const remover = gravadas
    .filter((g) => g.vigente && !ficam.has(g.chave))
    .map((g) => ({ id: g.id, versao: g.versao }));
  return { incluir, manter, remover };
}

// ── Fila de espera ──

export interface EsperaInternacao {
  readonly id: number;
  readonly prioridade: PrioridadeFilaInternacao;
  /** Instante do pedido (ISO). */
  readonly solicitadoEm: string;
}

const PESO: Record<PrioridadeFilaInternacao, number> = { urgente: 0, prioritaria: 1, normal: 2 };

/** Ordena a fila: prioridade clínica, depois a data do pedido, depois o agendamento; devolve a posição (1 em diante). */
export function ordenarFilaEspera<T extends EsperaInternacao>(
  fila: readonly T[],
): (T & { readonly posicao: number })[] {
  return [...fila]
    .sort(
      (a, b) =>
        PESO[a.prioridade] - PESO[b.prioridade] ||
        Date.parse(a.solicitadoEm) - Date.parse(b.solicitadoEm) ||
        a.id - b.id,
    )
    .map((x, i) => ({ ...x, posicao: i + 1 }));
}

/** Dias corridos de espera desde o pedido (inteiro, nunca negativo). */
export function diasDeEspera(solicitadoEm: string, agora: Date): number {
  const d = Math.floor((agora.getTime() - Date.parse(solicitadoEm)) / 86_400_000);
  return d > 0 ? d : 0;
}

/** A mudança de prioridade na fila: só na fila de espera, para uma prioridade diferente, com justificativa. */
export function conferirMudancaPrioridade(e: {
  readonly situacao: string;
  readonly atual: PrioridadeFilaInternacao;
  readonly nova: PrioridadeFilaInternacao;
  readonly justificativa: string | null;
}): ResultadoPlanoPre<{ justificativa: string }> {
  const problemas: ProblemaPlanoPre[] = [];
  if (e.situacao !== 'em_espera')
    problemas.push({
      campo: 'situacao',
      mensagem: 'Só a pré-internação na fila de espera muda de prioridade.',
    });
  if (e.atual === e.nova)
    problemas.push({ campo: 'prioridade', mensagem: 'A prioridade escolhida é a atual.' });
  const j = (e.justificativa ?? '').trim();
  if (j.length < MIN_JUSTIFICATIVA_PRIORIDADE)
    problemas.push({
      campo: 'justificativa',
      mensagem: `Justifique a mudança de prioridade (ao menos ${MIN_JUSTIFICATIVA_PRIORIDADE} letras).`,
    });
  return problemas.length ? { ok: false, problemas } : { ok: true, justificativa: j };
}
