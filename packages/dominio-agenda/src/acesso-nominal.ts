// Usuários permitidos por agenda (02-AGE linha 40): a agenda "restrita" tem uma lista nominal de quem a vê e de quem
// marca nela. Agenda sem ninguém na lista segue só o escopo do cargo (unidade e tipo de agenda). Com lista:
//   - quem está na lista com "pode marcar" vê e marca;
//   - quem está na lista só para consulta vê, mas não marca;
//   - quem não está na lista não vê nem marca; o gestor de agendas (cargo com a manutenção da agenda) vê para
//     manter a lista, mas só marca se estiver nela.
// O administrador da plataforma pode tudo (ADR 0002): vê e marca em qualquer agenda, sem entrar na lista.
// Gravações na agenda restrita (decisão do domínio, 02-AGE 40):
//   - "marcação" (marcar, encaixar, remarcar, cancelar, confirmar, registrar falta, desfazer encaixe, incluir na
//     espera, registrar contato de confirmação): só quem marca (livre, marca, administrador);
//   - "manutenção" (gerar e reverter grade, bloquear horários, escala, cobertura, dados da agenda): quem marca e o
//     gestor de agendas; quem só consulta e quem está fora da lista não mantêm a agenda.
// A lista nunca fica num estado em que ninguém marca: retirar ou rebaixar o último que marca é recusado (a agenda
// viraria só leitura para todos); para abrir a agenda de novo, retira-se a lista inteira, de uma vez.

export type AcessoNominal = 'livre' | 'marca' | 'consulta' | 'gestor' | 'administrador' | 'sem-acesso';

/** O tipo de gravação na agenda, para a trava nominal. */
export type GravacaoNaAgenda = 'marcacao' | 'manutencao';

export interface PermitidoNaAgenda {
  readonly usuario: number;
  readonly podeMarcar: boolean;
}

/** O acesso do usuário à agenda pela lista nominal (lista vazia = agenda livre, vale só o escopo). */
export function acessoNominal(
  lista: readonly PermitidoNaAgenda[],
  usuario: number | null,
  gestor = false,
  administrador = false,
): AcessoNominal {
  if (lista.length === 0) return 'livre';
  if (administrador) return 'administrador';
  const eu = usuario === null ? undefined : lista.find((p) => p.usuario === usuario);
  if (eu) return eu.podeMarcar ? 'marca' : 'consulta';
  return gestor ? 'gestor' : 'sem-acesso';
}

export const podeVerAgenda = (a: AcessoNominal): boolean => a !== 'sem-acesso';
export const podeMarcarNaAgenda = (a: AcessoNominal): boolean =>
  a === 'livre' || a === 'marca' || a === 'administrador';

/** A gravação é aceita pela lista nominal? Marcação exige marcar; manutenção aceita também o gestor de agendas. */
export const podeGravarNaAgenda = (a: AcessoNominal, tipo: GravacaoNaAgenda): boolean =>
  tipo === 'marcacao' ? podeMarcarNaAgenda(a) : podeMarcarNaAgenda(a) || a === 'gestor';

export type MudancaNaLista =
  | { readonly acao: 'incluir'; readonly usuario: number; readonly podeMarcar: boolean }
  | { readonly acao: 'alterar'; readonly usuario: number; readonly podeMarcar: boolean }
  | { readonly acao: 'remover'; readonly usuario: number }
  | { readonly acao: 'liberarTodos' };

export interface RecusaLista {
  readonly codigo: string;
  readonly mensagem: string;
}

/** Aplica a mudança na lista; devolve a lista nova ou a recusa (validação na hora, antes de gravar). */
export function mudarLista(
  lista: readonly PermitidoNaAgenda[],
  m: MudancaNaLista,
): { lista: PermitidoNaAgenda[] } | { recusa: RecusaLista } {
  if (m.acao === 'liberarTodos') {
    if (lista.length === 0)
      return { recusa: { codigo: 'agenda-ja-livre', mensagem: 'A agenda já não tem lista de usuários.' } };
    return { lista: [] };
  }
  const ja = lista.find((p) => p.usuario === m.usuario);
  let nova: PermitidoNaAgenda[];
  if (m.acao === 'incluir') {
    if (ja)
      return { recusa: { codigo: 'usuario-ja-na-lista', mensagem: 'O usuário já está na lista da agenda.' } };
    if (lista.length === 0 && !m.podeMarcar)
      return {
        recusa: {
          codigo: 'lista-sem-quem-marca',
          mensagem: 'O primeiro usuário da lista precisa poder marcar: senão ninguém marcaria na agenda.',
        },
      };
    nova = [...lista, { usuario: m.usuario, podeMarcar: m.podeMarcar }];
  } else {
    if (!ja) return { recusa: { codigo: 'usuario-fora-da-lista', mensagem: 'O usuário não está na lista.' } };
    if (m.acao === 'alterar' && ja.podeMarcar === m.podeMarcar)
      return { recusa: { codigo: 'sem-mudanca', mensagem: 'O usuário já tem esse acesso na agenda.' } };
    nova =
      m.acao === 'remover'
        ? lista.filter((p) => p.usuario !== m.usuario)
        : lista.map((p) => (p.usuario === m.usuario ? { ...p, podeMarcar: m.podeMarcar } : p));
  }
  if (nova.length > 0 && !nova.some((p) => p.podeMarcar))
    return {
      recusa: {
        codigo: 'lista-sem-quem-marca',
        mensagem:
          'Ninguém mais marcaria na agenda: deixe ao menos um usuário que marca, ou libere a agenda para todos.',
      },
    };
  return { lista: nova };
}
