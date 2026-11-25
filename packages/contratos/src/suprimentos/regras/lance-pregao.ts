// Lances da disputa aberta (C2-030, 05-SUP linha 26; Lei 14.133/2021, art. 56 e 57): a fase de lances do pregão e do
// leilão, depois das propostas da sessão. Regras puras; a porta própria grava o que elas decidem.
//   - O lance só existe na sessão, no pregão (menor preço: cada lance abaixo da melhor oferta do próprio licitante) e no
//     leilão (maior lance: cada lance acima da própria oferta anterior).
//   - Só dá lance quem tem proposta válida no item: a proposta desclassificada ou o licitante inabilitado não entram.
//   - O intervalo mínimo de diferença entre lances (art. 57), quando o edital o fixa, vale sobre a oferta anterior do
//     próprio licitante, em percentual.
//   - Valor positivo com até 4 casas (como na disputa). Cada lance fica gravado: a ordem dos lances é o histórico da
//     disputa, nada é apagado; o último lance de cada licitante passa a ser a oferta da proposta.
import { type RecusaSuprimentos, recusa } from './recusa.js';

export type SentidoDisputa = 'menor' | 'maior';

/** O sentido da disputa pela modalidade (o leilão disputa o maior lance); null quando a modalidade não tem lances. */
export function sentidoDaDisputa(modalidade: string): SentidoDisputa | null {
  const m = modalidade.replace(/_/g, '-');
  if (m.startsWith('pregao')) return 'menor';
  if (m === 'leilao') return 'maior';
  return null;
}

export interface PropostaParaLance {
  /** O valor unitário da proposta escrita. */
  readonly valor: number;
  readonly desclassificada: boolean;
  readonly inabilitada: boolean;
}

export interface LanceParaConferir {
  readonly etapa: string;
  readonly modalidade: string;
  /** A proposta do licitante no item (null quando ele não apresentou proposta). */
  readonly proposta: PropostaParaLance | null;
  /** Os lances anteriores do próprio licitante no item, na ordem. */
  readonly lancesProprios: readonly number[];
  readonly valor: number;
  /** O intervalo mínimo do edital, em percentual sobre a oferta anterior (0 ou null: sem intervalo). */
  readonly intervaloMinimoPercentual: number | null;
}

/** A melhor oferta anterior do licitante: a proposta escrita e os lances, pelo sentido da disputa. */
export function ofertaAnterior(sentido: SentidoDisputa, proposta: number, lances: readonly number[]): number {
  const todas = [proposta, ...lances];
  return sentido === 'menor' ? Math.min(...todas) : Math.max(...todas);
}

const quatroCasas = (v: number): boolean => Math.abs(Math.round(v * 10_000) - v * 10_000) < 1e-6;

export function podeRegistrarLance(x: LanceParaConferir): RecusaSuprimentos | null {
  if (x.etapa !== 'sessao') return recusa('lance-etapa-invalida', 'Os lances se registram na sessão.');
  const sentido = sentidoDaDisputa(x.modalidade);
  if (sentido === null) return recusa('lance-modalidade', 'Lance só no pregão e no leilão.');
  if (!(x.valor > 0) || !quatroCasas(x.valor))
    return recusa('lance-valor', 'Informe o valor do lance, positivo e com até 4 casas.', ['valor']);
  if (x.proposta === null)
    return recusa('lance-sem-proposta', 'O licitante não tem proposta neste item.', ['fornecedor']);
  if (x.proposta.desclassificada)
    return recusa(
      'lance-proposta-desclassificada',
      'A proposta deste licitante foi desclassificada no item.',
      ['fornecedor'],
    );
  if (x.proposta.inabilitada)
    return recusa('lance-licitante-inabilitado', 'O licitante está inabilitado.', ['fornecedor']);
  const anterior = ofertaAnterior(sentido, x.proposta.valor, x.lancesProprios);
  if (sentido === 'menor' ? x.valor >= anterior : x.valor <= anterior)
    return recusa(
      'lance-nao-melhora',
      sentido === 'menor'
        ? `O lance tem de ficar abaixo da oferta anterior do licitante (${anterior}).`
        : `O lance tem de ficar acima da oferta anterior do licitante (${anterior}).`,
      ['valor'],
    );
  const p = x.intervaloMinimoPercentual ?? 0;
  if (p > 0) {
    const passo = Math.abs(anterior - x.valor) / anterior;
    if (passo * 100 + 1e-9 < p)
      return recusa(
        'lance-intervalo-minimo',
        `O lance tem de melhorar a oferta anterior em pelo menos ${p}% (intervalo mínimo do edital).`,
        ['valor'],
      );
  }
  return null;
}

export interface LanceGravado {
  readonly fornecedor: number;
  readonly valor: number;
  readonly ordem: number;
}

/** A classificação parcial do item: a melhor oferta de cada licitante (o último lance), da melhor para a pior; no
 *  empate, quem chegou primeiro ao valor fica à frente. */
export function classificacaoDosLances(
  sentido: SentidoDisputa,
  lances: readonly LanceGravado[],
): { fornecedor: number; valor: number; posicao: number }[] {
  const melhor = new Map<number, LanceGravado>();
  for (const l of [...lances].sort((a, b) => a.ordem - b.ordem)) {
    const atual = melhor.get(l.fornecedor);
    if (!atual || (sentido === 'menor' ? l.valor < atual.valor : l.valor > atual.valor))
      melhor.set(l.fornecedor, l);
  }
  return [...melhor.values()]
    .sort((a, b) => (sentido === 'menor' ? a.valor - b.valor : b.valor - a.valor) || a.ordem - b.ordem)
    .map((l, i) => ({ fornecedor: l.fornecedor, valor: l.valor, posicao: i + 1 }));
}
