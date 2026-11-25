// Aplicação do kit de medicamentos ou de soluções na prescrição (03-PEP L107). Regra pura: o kit cadastrado vira as
// linhas que entram na prescrição, e o prescritor revisa cada uma antes de liberar.
// - kit inativo ou sem item vivo: não se aplica;
// - kit de solução: vira UMA solução com os componentes (o principal primeiro, depois o diluente, o reconstituinte e
//   os demais componentes), com a via, a frequência e a velocidade do cabeçalho; sem diluente não se aplica;
// - os outros kits: cada item vira um item da prescrição, o principal primeiro; a via e a frequência que o item não
//   traz vêm do cabeçalho do kit;
// - o material não entra como item prescrito (vai pela dispensação) e o item sem produto do cadastro fica para o
//   prescritor completar: os dois voltam na lista `revisar`, pela sequência.
import type { PAPEIS_ITEM_KIT, TIPOS_KIT } from './cadastro-protocolo.js';

export type TipoKitAplicado = (typeof TIPOS_KIT)[number];
export type PapelItemKitAplicado = (typeof PAPEIS_ITEM_KIT)[number];

export interface ItemKitParaAplicar {
  readonly sequencia: number;
  readonly item: number | null;
  readonly papel: PapelItemKitAplicado;
  readonly quantidade: number;
  readonly unidade: number | null;
  readonly via: number | null;
  readonly frequencia: number | null;
}

export interface KitParaAplicar {
  readonly id: number;
  readonly tipoKit: TipoKitAplicado;
  readonly ativo: boolean;
  readonly via: number | null;
  readonly frequencia: number | null;
  readonly velocidade: number | null;
  readonly unidadeInfusao: number | null;
  readonly itens: readonly ItemKitParaAplicar[];
}

export interface LinhaKitAplicado {
  readonly sequencia: number;
  readonly papel: PapelItemKitAplicado;
  readonly item: number;
  readonly quantidade: number;
  readonly unidade: number | null;
  readonly via: number | null;
  readonly frequencia: number | null;
  /** Na solução: o componente principal (um só). */
  readonly principal: boolean;
}

export type ProblemaAplicacaoKit = 'kit-inativo' | 'kit-sem-itens' | 'solucao-sem-diluente';

export interface AplicacaoKit {
  readonly kit: number;
  readonly forma: 'solucao' | 'itens';
  readonly linhas: readonly LinhaKitAplicado[];
  /** Sequências que não entram sozinhas (material ou item sem produto): o prescritor completa. */
  readonly revisar: readonly number[];
  readonly problema: ProblemaAplicacaoKit | null;
}

export const MENSAGENS_APLICACAO_KIT: Readonly<Record<ProblemaAplicacaoKit, string>> = {
  'kit-inativo': 'O kit está inativo e não se aplica.',
  'kit-sem-itens': 'O kit não tem item com produto do cadastro para aplicar.',
  'solucao-sem-diluente': 'O kit de solução não tem o diluente e não se aplica.',
};

const ORDEM_PAPEL: Readonly<Record<PapelItemKitAplicado, number>> = {
  principal: 0,
  diluente: 1,
  reconstituinte: 2,
  componente: 3,
  material: 4,
};

/** As linhas que o kit leva para a prescrição (ou o motivo de não se aplicar). */
export function aplicacaoDoKit(k: KitParaAplicar): AplicacaoKit {
  const forma = k.tipoKit === 'solucao' ? 'solucao' : 'itens';
  const vazio = (problema: ProblemaAplicacaoKit): AplicacaoKit => ({
    kit: k.id,
    forma,
    linhas: [],
    revisar: [],
    problema,
  });
  if (!k.ativo) return vazio('kit-inativo');
  const ordenados = [...k.itens].sort(
    (a, b) => ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.sequencia - b.sequencia,
  );
  const entram = ordenados.filter((i) => i.papel !== 'material' && i.item !== null && i.quantidade > 0);
  const revisar = ordenados.filter((i) => !entram.includes(i)).map((i) => i.sequencia);
  if (entram.length === 0) return vazio('kit-sem-itens');
  if (forma === 'solucao' && !entram.some((i) => i.papel === 'diluente'))
    return vazio('solucao-sem-diluente');
  const temPrincipal = entram.some((i) => i.papel === 'principal');
  const linhas = entram.map((i, n): LinhaKitAplicado => ({
    sequencia: i.sequencia,
    papel: i.papel,
    item: i.item!,
    quantidade: i.quantidade,
    unidade: i.unidade,
    via: forma === 'solucao' ? k.via : (i.via ?? k.via),
    frequencia: forma === 'solucao' ? k.frequencia : (i.frequencia ?? k.frequencia),
    principal: forma === 'solucao' && (temPrincipal ? i.papel === 'principal' : n === 0),
  }));
  return { kit: k.id, forma, linhas, revisar, problema: null };
}
