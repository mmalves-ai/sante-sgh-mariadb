// F3.7 (06-FAT linha 34): o ciclo da glosa por item depois da decisão — o lote de recurso (um por fonte pagadora,
// com os itens recorridos e a justificativa da decisão), o retorno da operadora por item e a situação que o recurso e
// a glosa assumem com os retornos. Regras puras: a porta própria e a de memória aplicam as mesmas.
// Desenho próprio: o recurso parte da decisão "recorrer" já tomada na grade (justificativa e evidência ficam na
// decisão), e o faturista registra o protocolo do lote inteiro numa ação só; o retorno fecha item por item, e a glosa
// só encerra quando todos os itens recorridos tiverem retorno. Nada é apagado: cada retorno é um registro próprio.

export interface RecusaRecurso {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const recusa = (codigo: string, mensagem: string, campos?: readonly string[]): RecusaRecurso =>
  campos ? { codigo, mensagem, campos } : { codigo, mensagem };

const centavos = (v: number) => Math.round(v * 100) / 100;

/** O item glosado como a porta o lê, para entrar no lote de recurso. */
export interface GlosaParaRecurso {
  /** Decisão gravada na grade: 'pendente', 'aceitar', 'aceitar_parcial' ou 'recorrer'. */
  readonly decisao: string;
  /** Justificativa da decisão (obrigatória no recurso). */
  readonly justificativa: string | null;
  readonly valorGlosado: number;
  readonly valorAceito: number;
  /** A glosa já tem recurso registrado. */
  readonly emRecurso: boolean;
  /** Data limite para recorrer (null = sem prazo conhecido). Na reapresentação, contada do retorno anterior. */
  readonly prazo: string | null;
  /**
   * O recurso em que o item está já teve retorno (negado ou acatado em parte): o item pode ser reapresentado num recurso
   * novo, ligado ao anterior. `valorAcatado` é o que já voltou nos recursos anteriores (somado). Ausente ou null = o
   * recurso atual ainda espera o retorno.
   */
  readonly retornoAnterior?: { readonly valorAcatado: number } | null;
}

/**
 * O item pode entrar no lote de recurso? Só a glosa decidida como "recorrer", com a justificativa, ainda sem recurso,
 * dentro do prazo, e com o valor pleiteado entre R$ 0,01 e o que não foi aceito.
 */
export function conferirItemDoRecurso(
  g: GlosaParaRecurso,
  valor: number,
  dataProtocolo: string,
): RecusaRecurso | null {
  const reapresentacao = g.emRecurso && !!g.retornoAnterior;
  if (g.emRecurso && !reapresentacao)
    return recusa('ja-recorrido', 'Este item já tem recurso aguardando o retorno da operadora.');
  if (g.decisao === 'aceitar') return recusa('glosa-aceita', 'A glosa foi aceita: não há o que recorrer.');
  if (g.decisao !== 'recorrer')
    return recusa(
      'sem-decisao-recorrer',
      'Decida "recorrer" na grade, com a justificativa, antes de pôr o item no lote de recurso.',
    );
  if (!(g.justificativa ?? '').trim())
    return recusa('sem-justificativa', 'A decisão de recorrer está sem justificativa.', ['justificativa']);
  if (g.prazo !== null && dataProtocolo > g.prazo)
    return recusa(
      'prazo-vencido',
      `O prazo para recorrer venceu em ${g.prazo}; o protocolo é de ${dataProtocolo}.`,
      ['dataProtocolo'],
    );
  const teto = valorPadraoDoRecurso(g);
  if (reapresentacao && teto < 0.01)
    return recusa(
      'nada-a-reapresentar',
      'Os recursos anteriores já recuperaram todo o valor não aceito: não há o que reapresentar.',
    );
  if (!(valor >= 0.01)) return recusa('valor-invalido', 'O valor do recurso tem de ser positivo.', ['valor']);
  if (valor > teto + 0.005)
    return recusa(
      'valor-acima-da-glosa',
      reapresentacao
        ? `O valor da reapresentação (${valor.toFixed(2)}) passa do que ainda não voltou da glosa (${teto.toFixed(2)}).`
        : `O valor do recurso (${valor.toFixed(2)}) passa do que não foi aceito da glosa (${teto.toFixed(2)}).`,
      ['valor'],
    );
  return null;
}

/**
 * Valor pleiteado padrão: o que não foi aceito da glosa; na reapresentação, descontado o que os recursos anteriores já
 * recuperaram.
 */
export const valorPadraoDoRecurso = (
  g: Pick<GlosaParaRecurso, 'valorGlosado' | 'valorAceito' | 'retornoAnterior'>,
): number => centavos(g.valorGlosado - g.valorAceito - (g.retornoAnterior?.valorAcatado ?? 0));

/**
 * Agrupa os itens do pedido em lotes de recurso: um por fonte pagadora e, na reapresentação, por recurso anterior (o
 * recurso novo fica ligado ao que teve o retorno), na ordem em que aparecem.
 */
export function lotesDeRecurso<
  T extends { readonly fontePagadora: number; readonly recursoAnterior?: number | null },
>(
  itens: readonly T[],
): {
  readonly fontePagadora: number;
  readonly recursoAnterior: number | null;
  readonly itens: readonly T[];
}[] {
  const mapa = new Map<string, { fontePagadora: number; recursoAnterior: number | null; itens: T[] }>();
  for (const i of itens) {
    const anterior = i.recursoAnterior ?? null;
    const chave = `${i.fontePagadora}|${anterior ?? ''}`;
    const l = mapa.get(chave) ?? { fontePagadora: i.fontePagadora, recursoAnterior: anterior, itens: [] };
    l.itens.push(i);
    mapa.set(chave, l);
  }
  return [...mapa.values()];
}

/** Retorno de um item recorrido: o valor que a operadora acatou (null = sem retorno ainda). */
export interface RetornoDoItem {
  readonly valorRecursado: number;
  readonly valorAcatado: number | null;
}

export type SituacaoRecurso = 'enviado' | 'acatado' | 'acatado_parcial' | 'negado';

/**
 * A situação do lote de recurso pelos retornos dos itens: enquanto falta retorno, continua "enviado"; com todos,
 * acatado (tudo pago), negado (nada pago) ou acatado em parte.
 */
export function situacaoDoRecurso(itens: readonly RetornoDoItem[]): {
  readonly situacao: SituacaoRecurso;
  readonly valorAcatado: number;
  readonly completo: boolean;
} {
  const valorAcatado = centavos(itens.reduce((t, i) => t + (i.valorAcatado ?? 0), 0));
  const completo = itens.length > 0 && itens.every((i) => i.valorAcatado !== null);
  if (!completo) return { situacao: 'enviado', valorAcatado, completo };
  const recursado = centavos(itens.reduce((t, i) => t + i.valorRecursado, 0));
  if (valorAcatado <= 0) return { situacao: 'negado', valorAcatado, completo };
  if (valorAcatado >= recursado - 0.005) return { situacao: 'acatado', valorAcatado, completo };
  return { situacao: 'acatado_parcial', valorAcatado, completo };
}

/** Item da glosa para a situação depois do recurso. */
export interface ItemGlosaRecurso {
  readonly decisao: string;
  readonly emRecurso: boolean;
  readonly retornado: boolean;
  readonly valorRecuperado: number;
}

/**
 * A situação da glosa depois de recurso e retorno: com algum item em recurso, ou decidido como "recorrer" e ainda fora
 * do lote, sem retorno, "em_recurso"; com todos os recorridos retornados e nenhum pendente, "recuperada" (algo voltou) ou "encerrada" (nada voltou). Sem recurso, a situação fica como
 * está (a decisão de aceitar cuida dela).
 */
export function situacaoDaGlosaNoRecurso(
  atual: string,
  itens: readonly ItemGlosaRecurso[],
): { readonly situacao: string; readonly valorRecuperado: number; readonly encerrada: boolean } {
  const valorRecuperado = centavos(itens.reduce((t, i) => t + i.valorRecuperado, 0));
  if (atual === 'cancelada') return { situacao: atual, valorRecuperado, encerrada: false };
  const recorridos = itens.filter((i) => i.emRecurso);
  if (recorridos.length === 0) return { situacao: atual, valorRecuperado, encerrada: false };
  // Aberto: todo item em recurso ou decidido como "recorrer" (ainda fora do lote) que não teve retorno.
  if (itens.some((i) => (i.emRecurso || i.decisao === 'recorrer') && !i.retornado))
    return { situacao: 'em_recurso', valorRecuperado, encerrada: false };
  if (itens.some((i) => i.decisao === 'pendente'))
    return { situacao: 'em_recurso', valorRecuperado, encerrada: false };
  return { situacao: valorRecuperado > 0 ? 'recuperada' : 'encerrada', valorRecuperado, encerrada: true };
}
