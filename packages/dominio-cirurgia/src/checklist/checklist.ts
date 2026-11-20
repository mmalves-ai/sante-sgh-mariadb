// Checklist de cirurgia segura (ficha do M46, regra 1; cap-05a §5.5; protocolo do Ministério da Saúde de 2013, RDC
// 36/2013): três momentos na ordem (antes da indução, antes da incisão, antes de sair da sala), cada item com a resposta,
// quem confirmou e a hora; conduzido pelo circulante. Regras puras: a resposta aceita pelo tipo do item, a observação
// obrigatória, a ordem dos momentos e dos horários, o que impede concluir e o estado para o quadro do bloco.
import {
  CODIGOS_MOMENTO_CHECKLIST,
  type ItemChecklist,
  type ListaChecklist,
  type MomentoChecklist,
  type RecusaBlocoSeguro,
  type RespostaChecklist,
} from '@sgh/contratos';
import { minutosDoInstante } from '../ficha/instante.js';

/** Uma confirmação gravada (a vigente de cada item é a última). */
export interface ConfirmacaoItem {
  readonly id: number;
  readonly momento: MomentoChecklist;
  readonly item: string;
  readonly resposta: RespostaChecklist;
  readonly observacao: string | null;
  readonly em: string;
  readonly usuario: string;
}

/** O checklist como lido (sem as confirmações). */
export interface ChecklistLido {
  readonly lista: number;
  readonly versao: number;
  readonly inducaoEm: string | null;
  readonly inducaoPor: string | null;
  readonly timeoutEm: string | null;
  readonly timeoutPor: string | null;
  readonly saidaEm: string | null;
  readonly saidaPor: string | null;
  readonly excecaoEm: string | null;
  readonly excecaoPor: string | null;
  readonly excecaoMotivo: string | null;
}

export type Resultado = { ok: true } | { ok: false; codigo: RecusaBlocoSeguro; campo?: string };
const recusa = (codigo: RecusaBlocoSeguro, campo?: string): Resultado =>
  campo ? { ok: false, codigo, campo } : { ok: false, codigo };
const OK: Resultado = { ok: true };

export function itensDoMomento(lista: ListaChecklist, momento: MomentoChecklist): readonly ItemChecklist[] {
  return lista.itens.filter((i) => i.momento === momento);
}

/** As respostas que o tipo do item aceita. */
export function respostasAceitas(i: ItemChecklist): readonly RespostaChecklist[] {
  if (i.tipo === 'confirmacao') return ['sim'];
  if (i.tipo === 'confirmacaoOuNa') return ['sim', 'na'];
  return ['sim', 'nao'];
}

/**
 * Uma resposta pode ser GRAVADA? (A gravação aceita também a resposta que não conclui, como "não" num item de
 * confirmação: o circulante registra que o item não foi feito e o momento fica impedido até a correção.)
 */
export function conferirResposta(
  i: ItemChecklist | undefined,
  r: { resposta: RespostaChecklist; observacao: string | null },
): Resultado {
  if (!i) return recusa('checklist-item-desconhecido');
  if (i.tipo === 'pergunta' && r.resposta === 'na') return recusa('checklist-resposta-invalida', i.codigo);
  const exige = i.observacaoSe === r.resposta || (i.tipo !== 'pergunta' && r.resposta === 'nao');
  if (exige && !(r.observacao && r.observacao.trim().length >= 3))
    return recusa('checklist-observacao-obrigatoria', i.codigo);
  return OK;
}

/** A confirmação vigente de cada item (a última pelo ID). */
export function vigentes(confirmacoes: readonly ConfirmacaoItem[]): Map<string, ConfirmacaoItem> {
  const m = new Map<string, ConfirmacaoItem>();
  for (const c of [...confirmacoes].sort((a, b) => a.id - b.id)) m.set(`${c.momento}:${c.item}`, c);
  return m;
}

export function concluidoEm(c: ChecklistLido | null, momento: MomentoChecklist): string | null {
  if (!c) return null;
  return momento === 'inducao' ? c.inducaoEm : momento === 'incisao' ? c.timeoutEm : c.saidaEm;
}

/** O momento anterior concluído (ou, para a saída, a exceção da trava em lugar da pausa cirúrgica). */
function anteriorOk(c: ChecklistLido | null, momento: MomentoChecklist): boolean {
  if (momento === 'inducao') return true;
  if (momento === 'incisao') return !!c?.inducaoEm;
  return !!c?.timeoutEm || !!c?.excecaoEm;
}

/** Os itens do momento sem resposta que conclui (o rótulo de cada um). */
export function pendentesDoMomento(
  lista: ListaChecklist,
  momento: MomentoChecklist,
  confirmacoes: readonly ConfirmacaoItem[],
): ItemChecklist[] {
  const v = vigentes(confirmacoes);
  return itensDoMomento(lista, momento).filter((i) => {
    const c = v.get(`${momento}:${i.codigo}`);
    return !c || !respostasAceitas(i).includes(c.resposta);
  });
}

/** Pode confirmar itens deste momento agora? (Momento ainda aberto; momentos anteriores não precisam estar concluídos.) */
export function podeConfirmar(c: ChecklistLido | null, momento: MomentoChecklist): Resultado {
  if (concluidoEm(c, momento)) return recusa('checklist-momento-concluido');
  if (c?.saidaEm) return recusa('checklist-momento-concluido');
  return OK;
}

/** O horário não pode vir antes do último registrado no checklist (os momentos andam para frente). */
function horarioOk(c: ChecklistLido | null, em: string): boolean {
  const ultimos = [c?.inducaoEm, c?.timeoutEm, c?.saidaEm].filter((x): x is string => !!x);
  return ultimos.every((u) => minutosDoInstante(em) >= minutosDoInstante(u));
}

/** O que impede concluir o momento agora (null: pode concluir). */
export function impedimentoDoMomento(
  lista: ListaChecklist,
  c: ChecklistLido | null,
  momento: MomentoChecklist,
  confirmacoes: readonly ConfirmacaoItem[],
): RecusaBlocoSeguro | null {
  if (concluidoEm(c, momento)) return 'checklist-momento-concluido';
  if (!anteriorOk(c, momento)) return 'checklist-momento-fora-de-ordem';
  if (pendentesDoMomento(lista, momento, confirmacoes).length > 0) return 'checklist-itens-pendentes';
  return null;
}

/** Concluir o momento no horário dado (regra 1: na ordem, com todos os itens respondidos). */
export function conferirConclusao(
  lista: ListaChecklist,
  c: ChecklistLido | null,
  momento: MomentoChecklist,
  confirmacoes: readonly ConfirmacaoItem[],
  em: string,
): Resultado {
  const imp = impedimentoDoMomento(lista, c, momento, confirmacoes);
  if (imp) return recusa(imp);
  if (!horarioOk(c, em)) return recusa('checklist-horario-fora-de-ordem');
  const doMomento = confirmacoes.filter((x) => x.momento === momento);
  if (doMomento.some((x) => minutosDoInstante(x.em) > minutosDoInstante(em)))
    return recusa('checklist-horario-fora-de-ordem');
  return OK;
}

/** Os itens em alerta pela resposta vigente (alergia, via aérea difícil, sangramento, equipamento). */
export function alertasDoChecklist(
  lista: ListaChecklist,
  confirmacoes: readonly ConfirmacaoItem[],
): ItemChecklist[] {
  const v = vigentes(confirmacoes);
  return lista.itens.filter((i) => i.alertaSe && v.get(`${i.momento}:${i.codigo}`)?.resposta === i.alertaSe);
}

/** A incisão pode ser registrada (pausa cirúrgica concluída ou exceção registrada)? */
export function incisaoLiberada(c: ChecklistLido | null): boolean {
  return !!c?.timeoutEm || !!c?.excecaoEm;
}

/** O resumo para o quadro do bloco (três momentos, exceção e alertas). */
export function segurancaNoQuadro(
  lista: ListaChecklist,
  c: ChecklistLido | null,
  confirmacoes: readonly ConfirmacaoItem[],
): { inducao: boolean; incisao: boolean; saida: boolean; excecao: boolean; alertas: number } {
  return {
    inducao: !!c?.inducaoEm,
    incisao: !!c?.timeoutEm,
    saida: !!c?.saidaEm,
    excecao: !!c?.excecaoEm,
    alertas: alertasDoChecklist(lista, confirmacoes).length,
  };
}

export const ORDEM_MOMENTOS: readonly MomentoChecklist[] = CODIGOS_MOMENTO_CHECKLIST;
