// Composição das comissões, quórum da reunião e conferência da amostra do sorteio (F3.9-Q3): regras puras usadas pela
// gravação própria da gestão da qualidade. Os membros são pessoas com vínculo (conta, colaborador ou profissional) ou,
// sem cadastro, um nome externo; o papel da comissão sai da função escrita na tela; a composição alterada encerra só
// quem saiu (a vigência do membro que fica não é reaberta) e o membro com a mesma pessoa e o mesmo papel só troca a
// função.

/** Os papéis da comissão no modelo próprio (CHECK ck_comissao_membro_papel). */
export const PAPEIS_MEMBRO_COMISSAO = [
  'presidente',
  'vice_presidente',
  'secretario',
  'membro_executor',
  'membro',
  'consultor',
] as const;
export type PapelMembroComissao = (typeof PAPEIS_MEMBRO_COMISSAO)[number];

const semAcento = (v: string): string =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

/**
 * O papel da comissão a partir da função escrita na tela: "Presidente", "Vice-presidente", "Secretária",
 * "Membro executor" e "Consultor" (com ou sem acento, caixa ou hífen) viram o papel; qualquer outra função (cargo ou
 * representação) é "membro", e o texto da função fica guardado como foi escrito.
 */
export function papelDaFuncao(funcao: string): PapelMembroComissao {
  const f = semAcento(funcao);
  if (/^vice\s*presidente\b/.test(f)) return 'vice_presidente';
  if (/^presidente\b/.test(f)) return 'presidente';
  if (/^secretari[oa]\b/.test(f)) return 'secretario';
  if (/^membro executor\b/.test(f)) return 'membro_executor';
  if (/^consultor[a]?\b/.test(f)) return 'consultor';
  return 'membro';
}

/** O nome comparado sem caixa, acento nem espaços repetidos (a mesma pessoa escrita de outro jeito). */
export const nomeComparavel = (nome: string): string => semAcento(nome).replace(/\s+/g, ' ');

/**
 * Quórum da reunião: com o quórum mínimo da comissão (número de membros), os presentes têm de alcançá-lo; sem ele, vale
 * a maioria simples da composição (mais da metade). Composição vazia nunca tem quórum.
 */
export function quorumAtingido(presentes: number, membros: number, quorumMinimo: number | null): boolean {
  if (!Number.isInteger(presentes) || !Number.isInteger(membros) || presentes < 0 || membros < 0)
    throw new Error('Contagem de presença inválida.');
  if (membros === 0 || presentes > membros) return false;
  if (quorumMinimo !== null && quorumMinimo > 0) return presentes >= quorumMinimo;
  return presentes * 2 > membros;
}

/** Um membro para a comparação: a chave da pessoa (vínculo ou nome externo), o papel e a função escrita. */
export interface MembroParaComparar {
  readonly pessoa: string;
  readonly papel: PapelMembroComissao;
  readonly funcao: string;
}

/** O que muda na composição: quem fica igual, quem só troca a função, quem sai e quem entra. */
export interface MudancaComposicao<A extends MembroParaComparar, N extends MembroParaComparar> {
  readonly mantidos: readonly A[];
  readonly funcaoTrocada: readonly { readonly atual: A; readonly nova: N }[];
  readonly encerrados: readonly A[];
  readonly incluidos: readonly N[];
}

/**
 * Compara a composição vigente com a nova pela pessoa e pelo papel (a chave única do modelo): o mesmo par com outra
 * função só troca a função; o par que não está na nova sai (a vigência termina); o par novo entra.
 */
export function mudancaDaComposicao<A extends MembroParaComparar, N extends MembroParaComparar>(
  atuais: readonly A[],
  novos: readonly N[],
): MudancaComposicao<A, N> {
  const chave = (m: MembroParaComparar) => `${m.pessoa}|${m.papel}`;
  const porChave = new Map(atuais.map((a) => [chave(a), a]));
  const vistos = new Set<string>();
  const mantidos: A[] = [];
  const funcaoTrocada: { atual: A; nova: N }[] = [];
  const incluidos: N[] = [];
  for (const m of novos) {
    const k = chave(m);
    if (vistos.has(k)) throw new Error('A mesma pessoa com o mesmo papel aparece duas vezes na composição.');
    vistos.add(k);
    const atual = porChave.get(k);
    if (!atual) incluidos.push(m);
    else if (atual.funcao === m.funcao) mantidos.push(atual);
    else funcaoTrocada.push({ atual, nova: m });
  }
  const encerrados = atuais.filter((a) => !vistos.has(chave(a)));
  return { mantidos, funcaoTrocada, encerrados, incluidos };
}

/**
 * A chave da pessoa para a conta do membro: quando a composição vigente já tem essa pessoa por outra chave da mesma
 * conta (o colaborador ou o profissional ligado a ela), vale a chave já gravada (a do mesmo papel primeiro), para a
 * alteração não encerrar e reincluir a mesma pessoa; senão, a resolvida.
 */
export function chaveDaPessoaNaComposicao(
  resolvida: string,
  daConta: readonly string[],
  papel: PapelMembroComissao,
  atuais: readonly Pick<MembroParaComparar, 'pessoa' | 'papel'>[],
): string {
  const conta = new Set([resolvida, ...daConta]);
  const mesmos = atuais.filter((a) => conta.has(a.pessoa));
  return (mesmos.find((a) => a.papel === papel) ?? mesmos[0])?.pessoa ?? resolvida;
}

/** Por que a presença da reunião não pode ser gravada. */
export type RecusaPresencaReuniao =
  'presente-fora-da-composicao' | 'presente-repetido' | 'presente-fora-da-data';

/**
 * Os presentes da reunião como MEMBROS (cada linha da composição, nunca o nome): as posições marcadas valem para a
 * composição que a tela leu (`daTela`) e cada presente tem de ser membro vigente na data da reunião (`naData`).
 */
export function presentesDaReuniao<M extends { readonly id: number }>(
  posicoes: readonly number[],
  daTela: readonly M[],
  naData: readonly { readonly id: number }[],
): { readonly presentes: readonly M[] } | { readonly recusa: RecusaPresencaReuniao } {
  if (posicoes.some((i) => !Number.isInteger(i) || i < 0 || i >= daTela.length))
    return { recusa: 'presente-fora-da-composicao' };
  if (new Set(posicoes).size !== posicoes.length) return { recusa: 'presente-repetido' };
  const vigentes = new Set(naData.map((m) => m.id));
  const presentes = posicoes.map((i) => daTela[i]!);
  if (presentes.some((m) => !vigentes.has(m.id))) return { recusa: 'presente-fora-da-data' };
  return { presentes };
}

/** Por que a amostra do sorteio não pode ser gravada (nulo quando pode). */
export type RecusaAmostraSorteio = 'amostra-vazia' | 'amostra-maior-que-universo' | 'prontuario-repetido';

/** A amostra do sorteio: não vazia, dentro do universo e sem o mesmo atendimento duas vezes. */
export function recusaAmostraSorteio(
  amostra: readonly { readonly reg: number }[],
  universo: number,
): RecusaAmostraSorteio | null {
  if (amostra.length === 0) return 'amostra-vazia';
  if (amostra.length > universo) return 'amostra-maior-que-universo';
  if (new Set(amostra.map((a) => a.reg)).size !== amostra.length) return 'prontuario-repetido';
  return null;
}
