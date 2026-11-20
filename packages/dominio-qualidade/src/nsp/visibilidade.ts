// Regra 1 do M48 (cap-05b §5.11, Regras: notificação não punitiva; ficha, seção 7: "gestor vê só as da área, sem o
// notificador"; seção 8, regra 11: sem o notificador anônimo na trilha):
//   - o NSP vê tudo, e quem notificou só quando a notificação NÃO é anônima (a anônima nem grava o notificador);
//   - o gestor da área vê só as notificações distribuídas a ele, nunca quem notificou, nem quem fez cada passo do NSP
//     (a linha do tempo vem sem autor);
//   - o notificador vê só o acompanhamento (situação e devolutivas), pelo número e pelo código;
//   - qualquer outro não vê nada (null, e a API responde como "não encontrada", sem dizer que existe).
// A projeção é a última barreira: a API já filtra na consulta (a lista do gestor vem pela distribuição).
import type { AcompanhamentoNotificacao, EventoNotificacaoLido, NotificacaoDetalhe } from '@sgh/contratos';

/** Quem lê, como a API o reconhece (perfil e permissões da sessão). */
export type LeitorNotificacao =
  | { readonly papel: 'nsp' }
  | { readonly papel: 'gestor'; readonly login: string }
  | { readonly papel: 'outro' };

/** O detalhe completo, como o repositório lê (o notificador só existe se não for anônima). */
export type NotificacaoCompleta = NotificacaoDetalhe;

const mesmoLogin = (a: string | null, b: string) =>
  a !== null && a.trim().toUpperCase() === b.trim().toUpperCase();

/** O detalhe como o leitor pode ver, ou null. */
export function projetarNotificacao(
  n: NotificacaoCompleta,
  leitor: LeitorNotificacao,
): NotificacaoDetalhe | null {
  if (leitor.papel === 'nsp') return { ...n, notificador: n.anonima ? null : n.notificador };
  if (leitor.papel === 'gestor') {
    if (!mesmoLogin(n.gestor, leitor.login)) return null;
    const eventos: EventoNotificacaoLido[] = n.eventos.map((e) => ({ ...e, por: null }));
    return { ...n, notificador: null, eventos };
  }
  return null;
}

/** O que o notificador vê ao acompanhar (só a situação e as devolutivas). */
export function acompanhamentoDe(n: NotificacaoCompleta): AcompanhamentoNotificacao {
  return {
    protocolo: n.protocolo,
    notificadaEm: n.notificadaEm,
    situacao: n.situacao,
    devolutivas: n.eventos
      .filter((e) => e.tipo === 'devolutiva' && e.texto !== null)
      .map((e) => ({ em: e.em, texto: e.texto ?? '' })),
  };
}

/** O marcador de ator da trilha e da linha do tempo para a notificação anônima. */
export const ATOR_ANONIMO = 'anonimo';

/**
 * Quem vai na trilha (SGH_TRILHA) e em SGH_QUA_NOTIF_EVENTO.POR no ato de notificar: o login, ou o marcador quando é
 * anônima. O resto da trilha (estação, IP, sessão) também fica em branco na anônima: a API passa `semOrigem`.
 */
export function atorDaNotificacao(
  anonima: boolean,
  login: string,
): { readonly ator: string; readonly semOrigem: boolean } {
  return anonima ? { ator: ATOR_ANONIMO, semOrigem: true } : { ator: login, semOrigem: false };
}

/** O payload da trilha da regra 11: só o ID e o protocolo (nenhum dado clínico, nome nem notificador). */
export function payloadDaTrilha(n: { readonly id: number; readonly protocolo: string }): {
  readonly notificacao: number;
  readonly protocolo: string;
} {
  return { notificacao: n.id, protocolo: n.protocolo };
}
