// A política do local de estoque e a concessão do usuário por classificação, aplicadas às gravações (F3.6, 05-SUP
// linha 3). O que o cadastro do local guarda passa a decidir: que tipo de pedido o local atende (setor, paciente,
// transferência), se só atende urgente, quais setores atende, o que guarda e movimenta (grupo, subgrupo ou item) e se
// a requisição pode ser atendida em parte. E a concessão do usuário por grupo, subgrupo ou classificação de despesa
// decide o que ele requisita, movimenta e compra. Regra pura: a porta lê o cadastro e pergunta aqui.
import { recusa, type RecusaSuprimentos } from './recusa.js';

/** Um alvo da classificação do local: exatamente um dos três. */
export interface AlvoClassificacaoLocal {
  readonly grupo?: number | null;
  readonly subgrupo?: number | null;
  readonly item?: number | null;
}

export interface PoliticaLocal {
  readonly nome: string;
  readonly atendeSetor: boolean;
  readonly atendePaciente: boolean;
  readonly atendeTransferencia: boolean;
  readonly permiteAtendimentoParcial: boolean;
  readonly apenasUrgente: boolean;
  /** Setores que o local atende em requisição, vigentes no dia (nenhum: sem restrição de setor). */
  readonly setores: readonly number[];
  /** O que o local guarda e movimenta (nada cadastrado: tudo). */
  readonly classificacao: readonly AlvoClassificacaoLocal[];
}

/** O item do cadastro com o que a classificação olha. */
export interface ItemClassificado {
  readonly item: number;
  readonly nome: string;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  /** Classificações de despesa do item (pelo grupo ou pelo próprio item), quando o cadastro as liga. */
  readonly classificacoesDespesa?: readonly number[];
}

export type TipoPedidoAoLocal = 'setor' | 'paciente' | 'transferencia';

const NOME_DO_TIPO: Readonly<Record<TipoPedidoAoLocal, string>> = {
  setor: 'requisição de setor',
  paciente: 'requisição para paciente',
  transferencia: 'transferência para outro local',
};

/**
 * O local só atende o tipo de pedido marcado no cadastro. Local que nunca marcou nenhum dos três tipos ainda não foi
 * configurado e atende todos (o cadastro que chega de outro sistema não fica parado à espera da marcação); a partir
 * da primeira marcação, o que não está marcado é recusado.
 */
export function conferirTipoDePedido(p: PoliticaLocal, tipo: TipoPedidoAoLocal): RecusaSuprimentos | null {
  if (!p.atendeSetor && !p.atendePaciente && !p.atendeTransferencia) return null;
  const atende =
    tipo === 'setor' ? p.atendeSetor : tipo === 'paciente' ? p.atendePaciente : p.atendeTransferencia;
  return atende
    ? null
    : recusa(`local-nao-atende-${tipo}`, `O local ${p.nome} não atende ${NOME_DO_TIPO[tipo]}.`, [
        tipo === 'transferencia' ? 'origem' : 'local',
      ]);
}

/** Local que só atende urgência recusa a requisição comum. */
export function conferirUrgencia(p: PoliticaLocal, urgente: boolean): RecusaSuprimentos | null {
  return p.apenasUrgente && !urgente
    ? recusa(
        'local-so-urgente',
        `O local ${p.nome} só atende requisição urgente. Marque a urgência ou peça a outro local.`,
        ['urgente'],
      )
    : null;
}

/**
 * Os setores atendidos: quando o local lista setores, a requisição de setor só entra se algum setor de quem pede
 * (os do centro de custo da requisição) está na lista.
 */
export function conferirSetorAtendido(
  p: PoliticaLocal,
  setoresDoPedido: readonly number[],
): RecusaSuprimentos | null {
  if (p.setores.length === 0) return null;
  return setoresDoPedido.some((s) => p.setores.includes(s))
    ? null
    : recusa('setor-nao-atendido', `O local ${p.nome} não atende o setor deste centro de custo.`, [
        'centroCusto',
      ]);
}

/** O item cabe na classificação do local? (nada cadastrado: tudo cabe). */
export function localGuarda(p: PoliticaLocal, i: ItemClassificado): boolean {
  if (p.classificacao.length === 0) return true;
  return p.classificacao.some(
    (a) =>
      (a.item != null && a.item === i.item) ||
      (a.subgrupo != null && a.subgrupo === i.subgrupo) ||
      (a.grupo != null && a.grupo === i.grupo),
  );
}

/** Os itens que o local não guarda nem movimenta (um por item, na ordem recebida). */
export function conferirItensDoLocal(
  p: PoliticaLocal,
  itens: readonly ItemClassificado[],
  campo = 'itens',
): RecusaSuprimentos[] {
  return itens
    .filter((i) => !localGuarda(p, i))
    .map((i) =>
      recusa('item-fora-do-local', `O local ${p.nome} não guarda nem movimenta o item ${i.nome}.`, [campo]),
    );
}

/** O que falta atender de um item da requisição e o que a saída atende dele. */
export interface ItemEmAtendimento {
  readonly pendente: number;
  readonly atendido: number;
}

/**
 * Atendimento em parte: quando o local não permite, a saída que atende a requisição leva tudo o que está pendente,
 * em todos os itens (nem item de fora, nem quantidade menor).
 */
export function conferirAtendimentoParcial(
  p: PoliticaLocal,
  itens: readonly ItemEmAtendimento[],
): RecusaSuprimentos | null {
  if (p.permiteAtendimentoParcial) return null;
  return itens.some((i) => i.pendente > 0 && i.atendido + 1e-9 < i.pendente)
    ? recusa(
        'atendimento-parcial-nao-permitido',
        `O local ${p.nome} não atende requisição em parte: atenda todos os itens na quantidade pendente.`,
        ['itens'],
      )
    : null;
}

/** Uma concessão do usuário por classificação (vigente ou não: a história conta para saber se há restrição). */
export interface ConcessaoClassificacao {
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly classificacaoDespesa: number | null;
  readonly requisitar: boolean;
  readonly movimentar: boolean;
  readonly comprar: boolean;
  readonly vigente: boolean;
}

export type AcaoClassificada = 'requisitar' | 'movimentar' | 'comprar';

const VERBO: Readonly<Record<AcaoClassificada, string>> = {
  requisitar: 'requisita',
  movimentar: 'movimenta',
  comprar: 'compra',
};

function concessaoCobre(c: ConcessaoClassificacao, i: ItemClassificado): boolean {
  if (c.grupo == null && c.classificacaoDespesa == null) return false;
  if (c.grupo != null && (c.grupo !== i.grupo || (c.subgrupo != null && c.subgrupo !== i.subgrupo)))
    return false;
  if (c.classificacaoDespesa != null && !(i.classificacoesDespesa ?? []).includes(c.classificacaoDespesa))
    return false;
  return true;
}

/**
 * A concessão por classificação: usuário que nunca teve concessão no estabelecimento não tem restrição (como nos
 * centros de custo); quem tem ou já teve só requisita, movimenta ou compra o item coberto por uma concessão vigente
 * com a ação marcada. Retirar a última concessão não abre todos os itens.
 */
export function conferirClassificacaoDoUsuario(
  concessoes: readonly ConcessaoClassificacao[],
  itens: readonly ItemClassificado[],
  acao: AcaoClassificada,
  campo = 'itens',
): RecusaSuprimentos[] {
  if (concessoes.length === 0) return [];
  const vigentes = concessoes.filter((c) => c.vigente && c[acao]);
  return itens
    .filter((i) => !vigentes.some((c) => concessaoCobre(c, i)))
    .map((i) =>
      recusa(
        'item-fora-do-escopo',
        `Seu usuário não ${VERBO[acao]} o item ${i.nome} (grupo fora da sua concessão).`,
        [campo],
      ),
    );
}
