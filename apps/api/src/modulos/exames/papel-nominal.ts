// Lista nominal de usuários (02-AGE linha 40) na agenda de exames: o papel da sessão que a regra do domínio considera
// além da própria lista (gestor da agenda de exames e administrador da plataforma) e a leitura das agendas restritas
// que a sessão não vê. A regra é a mesma da agenda de consultas (`acessoNominal` em @sgh/dominio-agenda):
//   - marcação (marcar, cancelar, remarcar): só quem está na lista com "pode marcar";
//   - manutenção (gerar a grade, fontes pagadoras aceitas, cobertura por exame): quem marca e o gestor da agenda;
//   - leitura: a agenda restrita some de quem não está na lista (o gestor a vê para manter);
//   - o administrador da plataforma pode tudo (ADR 0002).
// O papel acompanha a requisição (contexto assíncrono posto pelo interceptador do controlador): as operações e as
// leituras da porta o leem aqui. Fora de uma requisição (processo interno, teste da porta) vale "sem papel": a lista
// decide sozinha (falha fechada).
import { AsyncLocalStorage } from 'node:async_hooks';
import { acessoNominal, type PermitidoNaAgenda, podeVerAgenda } from '@sgh/dominio-agenda';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { exigirGravacaoNominal, type PapelNominal } from '../agenda/usuarios-agenda.js';

const SEM_PAPEL: PapelNominal = { gestor: false, administrador: false };
const contexto = new AsyncLocalStorage<PapelNominal>();

/** O papel da requisição em curso (sem requisição: nem gestor nem administrador). */
export const papelNominalAtual = (): PapelNominal => contexto.getStore() ?? SEM_PAPEL;

/** Roda `fn` (e tudo o que ela encadear) com o papel da sessão. */
export function comPapelNominal<T>(papel: PapelNominal, fn: () => T): T {
  return contexto.run(papel, fn);
}

/** Trava da marcação de exame (marcar, cancelar, remarcar) na agenda restrita. */
export const exigirMarcacaoDeExame = (tx: TxOperacao, agenda: number, usuario: number | null) =>
  exigirGravacaoNominal(tx, agenda, usuario, 'marcacao', papelNominalAtual());

/** Trava da manutenção da agenda de exame (grade, fontes pagadoras aceitas, cobertura por exame). */
export const exigirManutencaoDeExame = (tx: TxOperacao, agenda: number, usuario: number | null) =>
  exigirGravacaoNominal(tx, agenda, usuario, 'manutencao', papelNominalAtual());

/**
 * Agendas do estabelecimento que o usuário NÃO vê pela lista nominal (as livres e as em que ele está ficam fora do
 * conjunto). Sem usuário (leitura interna do sistema), nada se esconde: a lista é das sessões de usuário.
 */
export async function agendasOcultasDoUsuario(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
  papel: PapelNominal = papelNominalAtual(),
): Promise<Set<number>> {
  const ocultas = new Set<number>();
  if (usuario === null || papel.administrador) return ocultas;
  const linhas = await l.consultar(
    `SELECT au.agenda_servico_id AS agenda, au.usuario_id, au.pode_marcar
       FROM agenda_usuario au JOIN agenda_servico a ON a.id = au.agenda_servico_id
      WHERE a.estabelecimento_id = ? AND au.excluido_em IS NULL AND a.excluido_em IS NULL`,
    [estabelecimento],
  );
  const porAgenda = new Map<number, PermitidoNaAgenda[]>();
  for (const x of linhas) {
    const id = Number(x['agenda']);
    const lista = porAgenda.get(id) ?? [];
    lista.push({ usuario: Number(x['usuario_id']), podeMarcar: Boolean(Number(x['pode_marcar'])) });
    porAgenda.set(id, lista);
  }
  for (const [id, lista] of porAgenda)
    if (!podeVerAgenda(acessoNominal(lista, usuario, papel.gestor, papel.administrador))) ocultas.add(id);
  return ocultas;
}
