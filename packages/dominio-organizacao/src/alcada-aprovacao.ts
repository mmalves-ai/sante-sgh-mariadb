// Alçada de aprovação (01-ADM L59, escopo do usuário): a regra que diz, por estabelecimento e tipo de documento,
// quantos níveis aprovam, em série ou em paralelo, com que prazo, e quem aprova cada faixa de valor (um perfil de
// acesso ou uma conta). Sem I/O: a API apura os fatos no banco e grava só o que estas funções deixam.
// Desenho próprio:
//   - os níveis são numerados sem buraco a partir de 1 e o número de níveis da regra sai deles (não se digita);
//   - cada linha de nível tem um aprovador só: um perfil ou uma conta, nunca os dois;
//   - faixa de valor coerente (mínimo <= teto); o teto do nível sobe com o nível (quem está acima aprova mais), e o
//     nível sem teto só pode ser o último;
//   - teto acumulado e período andam juntos (sem período o teto acumulado não tem sentido);
//   - vigência nova sobre uma regra aberta do mesmo documento encerra a anterior na véspera, numa gravação só;
//     qualquer outra sobreposição é recusada (duas regras valendo no mesmo dia para o mesmo documento);
//   - regra já usada em pedido de aprovação não troca os níveis: abre-se uma vigência nova (o pedido antigo continua
//     apontando para a regra com que foi decidido; histórico nunca apagado);
//   - encerrar fecha a vigência (a linha fica no banco); a regra que ainda não começou é desativada.
import { vespera } from './gestao-estrutura.js';

export type RecusaAlcada =
  | 'descricao-obrigatoria'
  | 'sem-niveis'
  | 'niveis-demais'
  | 'nivel-com-buraco'
  | 'aprovador-unico'
  | 'faixa-invalida'
  | 'teto-decrescente'
  | 'nivel-sem-teto-no-meio'
  | 'acumulado-sem-periodo'
  | 'vigencia-invalida'
  | 'vigencia-sobreposta'
  | 'regra-em-uso'
  | 'encerramento-invalido';

export const MENSAGEM_ALCADA: Readonly<Record<RecusaAlcada, string>> = {
  'descricao-obrigatoria': 'Dê um nome à regra de alçada.',
  'sem-niveis': 'A regra precisa de pelo menos um nível de aprovação.',
  'niveis-demais': 'A regra aceita no máximo 20 níveis de aprovação.',
  'nivel-com-buraco': 'Os níveis são numerados em sequência a partir de 1, sem pular número.',
  'aprovador-unico': 'Cada linha de nível tem um aprovador só: um perfil de acesso ou uma conta.',
  'faixa-invalida': 'O valor mínimo da faixa não pode passar do teto, e nenhum valor pode ser negativo.',
  'teto-decrescente': 'O teto de um nível não pode ser menor que o do nível anterior.',
  'nivel-sem-teto-no-meio': 'Só o último nível pode ficar sem teto de valor.',
  'acumulado-sem-periodo':
    'O teto acumulado exige o período (dia, semana, mês ou ano), e o período exige o teto.',
  'vigencia-invalida': 'O fim da vigência não pode ser antes do início.',
  'vigencia-sobreposta':
    'Já existe regra deste documento valendo nesse período: encerre-a ou comece a nova depois dela.',
  'regra-em-uso':
    'Esta regra já decidiu pedidos de aprovação: para mudar os níveis, abra uma vigência nova a partir de hoje.',
  'encerramento-invalido': 'A data de encerramento precisa estar dentro da vigência da regra.',
};

export const MODOS_APROVACAO = ['serie', 'paralelo'] as const;
export type ModoAprovacao = (typeof MODOS_APROVACAO)[number];
export const ACOES_PRAZO_VENCIDO = ['alertar', 'escalar', 'recusar'] as const;
export const PERIODOS_ACUMULADO = ['dia', 'semana', 'mes', 'ano'] as const;
export const MAXIMO_NIVEIS = 20;

export interface LinhaNivelAlcada {
  readonly nivel: number;
  readonly perfil: string | null;
  readonly usuario: string | null;
  readonly valorMinimo: number;
  /** null: sem teto. */
  readonly valorMaximo: number | null;
  readonly valorAcumuladoMaximo: number | null;
  readonly periodoAcumulado: string | null;
}

export interface RegraAlcada {
  readonly descricao: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly niveis: readonly LinhaNivelAlcada[];
}

/** Confere a regra inteira; devolve a primeira recusa ou null. */
export function validarAlcada(r: RegraAlcada): RecusaAlcada | null {
  if (!r.descricao.trim()) return 'descricao-obrigatoria';
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio) return 'vigencia-invalida';
  if (r.niveis.length === 0) return 'sem-niveis';
  const numeros = [...new Set(r.niveis.map((n) => n.nivel))].sort((a, b) => a - b);
  if (numeros.length > MAXIMO_NIVEIS) return 'niveis-demais';
  if (numeros.some((n, i) => n !== i + 1)) return 'nivel-com-buraco';
  for (const n of r.niveis) {
    if ((n.perfil === null) === (n.usuario === null)) return 'aprovador-unico';
    if (n.valorMinimo < 0 || (n.valorMaximo !== null && n.valorMaximo < n.valorMinimo))
      return 'faixa-invalida';
    if ((n.valorAcumuladoMaximo === null) !== (n.periodoAcumulado === null)) return 'acumulado-sem-periodo';
    if (n.valorAcumuladoMaximo !== null && n.valorAcumuladoMaximo < 0) return 'faixa-invalida';
  }
  // Teto de cada nível: o maior teto das linhas do nível (null = sem teto).
  const teto = numeros.map((num) => {
    const ls = r.niveis.filter((n) => n.nivel === num);
    return ls.some((n) => n.valorMaximo === null) ? null : Math.max(...ls.map((n) => n.valorMaximo ?? 0));
  });
  for (let i = 0; i < teto.length; i++) {
    const t = teto[i];
    if (t === null || t === undefined) {
      if (i < teto.length - 1) return 'nivel-sem-teto-no-meio';
      continue;
    }
    const anterior = i > 0 ? teto[i - 1] : undefined;
    if (anterior !== undefined && anterior !== null && t < anterior) return 'teto-decrescente';
  }
  return null;
}

/** Quantos níveis a regra tem (o maior número de nível). */
export const quantidadeNiveis = (niveis: readonly LinhaNivelAlcada[]): number =>
  niveis.reduce((m, n) => Math.max(m, n.nivel), 0);

/** Véspera de uma data ISO (AAAA-MM-DD): a mesma regra da gestão da estrutura, exportada também por aqui. */
export { vespera };

export interface VigenciaExistente {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string | null;
}

export type PlanoVigencia =
  | { readonly recusa: RecusaAlcada }
  | { readonly recusa: null; readonly encerrar: { readonly id: number; readonly fim: string } | null };

/**
 * A vigência nova contra as regras ativas do mesmo estabelecimento e documento (sem a própria, se alteração).
 * A regra que começou antes da nova é encerrada na véspera quando a nova vai até onde ela ia (ou além); qualquer
 * outra sobreposição (inclusive a nova no meio da anterior) recusa.
 */
/** A nova vai até onde a anterior ia (ou além): só então a anterior é encerrada na véspera, sem buraco. */
const cobreOFim = (novaFim: string | null, fim: string | null): boolean =>
  novaFim === null || (fim !== null && novaFim >= fim);

export function planejarVigencia(
  nova: { readonly inicio: string; readonly fim: string | null },
  existentes: readonly VigenciaExistente[],
): PlanoVigencia {
  const sobre = existentes.filter(
    (e) => (e.fim === null || e.fim >= nova.inicio) && (nova.fim === null || e.inicio <= nova.fim),
  );
  if (sobre.length === 0) return { recusa: null, encerrar: null };
  const [e] = sobre;
  if (sobre.length === 1 && e && e.inicio < nova.inicio && cobreOFim(nova.fim, e.fim))
    return { recusa: null, encerrar: { id: e.id, fim: vespera(nova.inicio) } };
  return { recusa: 'vigencia-sobreposta' };
}

/** Os níveis podem mudar? Não, se a regra já foi usada em pedido de aprovação. */
export const conferirTrocaNiveis = (pedidosDaRegra: number, niveisMudaram: boolean): RecusaAlcada | null =>
  pedidosDaRegra > 0 && niveisMudaram ? 'regra-em-uso' : null;

export type DesfechoEncerramento =
  | { readonly recusa: RecusaAlcada }
  | { readonly recusa: null; readonly acao: 'fechar'; readonly fim: string }
  | { readonly recusa: null; readonly acao: 'desativar' };

/**
 * Encerrar a regra em `fim` (padrão: hoje). Regra que começa depois de hoje é desativada (nunca valeu); a data
 * precisa estar dentro da vigência.
 */
export function encerrarAlcada(
  r: { readonly inicio: string; readonly fim: string | null },
  hoje: string,
  fim: string | null,
): DesfechoEncerramento {
  if (r.inicio > hoje) return { recusa: null, acao: 'desativar' };
  const f = fim ?? hoje;
  if (f < r.inicio || (r.fim !== null && f > r.fim)) return { recusa: 'encerramento-invalido' };
  return { recusa: null, acao: 'fechar', fim: f };
}

/** Comparação dos níveis lidos com os novos (mesmo conteúdo, em qualquer ordem). */
export function niveisIguais(a: readonly LinhaNivelAlcada[], b: readonly LinhaNivelAlcada[]): boolean {
  const chave = (n: LinhaNivelAlcada) =>
    [
      n.nivel,
      n.perfil,
      n.usuario,
      n.valorMinimo,
      n.valorMaximo,
      n.valorAcumuladoMaximo,
      n.periodoAcumulado,
    ].join('|');
  const x = a.map(chave).sort();
  const y = b.map(chave).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
