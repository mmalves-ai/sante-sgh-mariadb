// Receita de alta (regra 15 da ficha do M24; Portaria 344/98, art. 36 §6º): o internado usa só a prescrição
// diária; na alta e no ambulatório, os medicamentos da prescrição viram receitas do receituário do prontuário
// (M23), uma por tipo de receituário — simples, controle especial (uma por lista da Portaria 344/98) e
// antimicrobiano —, impressas e assinadas à mão até a DP-23. A notificação de receita das listas A e B (talão) é
// avisada: a receita sai, e a notificação é preenchida no talão. Nada de horário entra na receita: a posologia vem
// da dose, da via e da frequência do item; a quantidade e a duração são da pessoa que prescreve.
import { receituarioDaLista } from '../alertas/controlado.js';

export type TipoReceitaAlta = 'simples' | 'controle-especial' | 'antimicrobiano';

export interface ItemParaReceita {
  readonly id: number;
  /** Só os medicamentos ativos viram receita (o resto da prescrição é do hospital). */
  readonly medicamento: boolean;
  readonly ativo: boolean;
  readonly descricao: string;
  readonly dose: string | null;
  readonly via: string | null;
  readonly frequencia: string | null;
  /** Lista da Portaria 344/98 (vazio: controlado sem lista informada); null: não controlado. */
  readonly controlado: string | null;
  readonly antimicrobiano: boolean;
}

export interface ItemReceitaProposto {
  readonly item: number;
  readonly medicamento: string;
  readonly via: string | null;
  readonly posologia: string;
}

export interface ReceitaProposta {
  readonly chave: string;
  readonly tipo: TipoReceitaAlta;
  /** Receituário certo (o nome que a pessoa vê). */
  readonly receituario: string;
  readonly itens: readonly ItemReceitaProposto[];
  /** Notificação de receita (listas A e B; C2 e C5): o talão é preenchido à mão. */
  readonly aviso: string | null;
}

/** Itens por receita (o receituário do prontuário aceita até 20). */
export const MAXIMO_ITENS_RECEITA = 20;

const corta = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).trimEnd());

function posologia(i: ItemParaReceita): string {
  const partes = [i.dose, i.via, i.frequencia].map((x) => (x ?? '').trim()).filter(Boolean);
  return corta(partes.length ? partes.join(', ') : 'Conforme orientação', 70);
}

function notificacao(lista: string): string | null {
  const l = lista.trim().toUpperCase();
  if (/^(A[123]|B[12]|C[25])$/.test(l))
    return `${receituarioDaLista(l)}: preencha a notificação no talão e assine à mão.`;
  return null;
}

/** Agrupa os medicamentos ativos da prescrição nas receitas da alta, no receituário certo de cada um. */
export function receitasDaAlta(itens: readonly ItemParaReceita[]): ReceitaProposta[] {
  const grupos = new Map<
    string,
    { tipo: TipoReceitaAlta; receituario: string; aviso: string | null; itens: ItemReceitaProposto[] }
  >();
  for (const i of itens) {
    if (!i.medicamento || !i.ativo) continue;
    let chave: string;
    let tipo: TipoReceitaAlta;
    let receituario: string;
    let aviso: string | null = null;
    if (i.controlado !== null) {
      const lista = i.controlado.trim().toUpperCase();
      chave = `controle-especial:${lista || 'sem-lista'}`;
      tipo = 'controle-especial';
      receituario = receituarioDaLista(lista);
      aviso = notificacao(lista);
    } else if (i.antimicrobiano) {
      chave = 'antimicrobiano';
      tipo = 'antimicrobiano';
      receituario = 'Receita de antimicrobiano em duas vias';
    } else {
      chave = 'simples';
      tipo = 'simples';
      receituario = 'Receita simples';
    }
    const g = grupos.get(chave) ?? { tipo, receituario, aviso, itens: [] };
    g.itens.push({
      item: i.id,
      medicamento: corta(i.descricao.trim(), 80),
      via: i.via,
      posologia: posologia(i),
    });
    grupos.set(chave, g);
  }
  const r: ReceitaProposta[] = [];
  const ordem = (k: string) => (k === 'simples' ? 0 : k === 'antimicrobiano' ? 1 : 2);
  for (const [chave, g] of [...grupos.entries()].sort(
    (a, b) => ordem(a[0]) - ordem(b[0]) || a[0].localeCompare(b[0]),
  )) {
    for (let k = 0; k < g.itens.length; k += MAXIMO_ITENS_RECEITA) {
      const parte = Math.floor(k / MAXIMO_ITENS_RECEITA);
      r.push({
        chave: parte === 0 ? chave : `${chave}:${parte + 1}`,
        tipo: g.tipo,
        receituario: g.receituario,
        itens: g.itens.slice(k, k + MAXIMO_ITENS_RECEITA),
        aviso: g.aviso,
      });
    }
  }
  return r;
}
