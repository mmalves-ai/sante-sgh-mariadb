// Regras puras do saneamento dos grupos de acesso amplo (M59-F4; ficha do M59, regra 8; cap-08 §8.7, §8.15):
// - o simulador: o antes (opções do grupo atual) e o depois (opções do grupo de destino), as ganhas, as perdidas e,
//   destas, as que o usuário usou na janela de 180 dias (só mudam com a aprovação do dono da área);
// - a sugestão do grupo de destino: o grupo de trabalho que cobre mais das opções usadas, e, no empate, o de menos
//   opções (privilégio mínimo); sem uso lido, nenhuma sugestão (nunca por adivinhação);
// - a validação de cada decisão, da aprovação, da aplicação e da dissolução do grupo vazio.
// Nada aqui lê o banco: o repositório traz os conjuntos e o serviço da API aplica pelas operações do M10.
import {
  DIAS_USO_SANEAMENTO,
  GRUPO_ADMINISTRADORES,
  GRUPOS_GENERICOS,
  type DecisaoSaneamento,
  type RecusaSaneamento,
  type SituacaoItemSaneamento,
} from '@sgh/contratos';
import { chaveGrupo } from './mapa-grupos.js';

const GENERICOS = new Set<string>(GRUPOS_GENERICOS);

/** Grupo de acesso amplo (comparado pela chave: maiúsculas, sem acento, espaços simples). */
export function ehGrupoGenerico(nome: string | null): boolean {
  return nome !== null && GENERICOS.has(chaveGrupo(nome));
}

/** Uso das opções na janela: ID da opção → quantas vezes. */
export type UsoOpcoes = ReadonlyMap<number, number>;

export interface ResultadoSimulacao {
  readonly antes: number;
  readonly depois: number;
  readonly mantidas: number;
  /** IDs das opções que o usuário ganha (ordenados). */
  readonly ganhas: readonly number[];
  /** IDs das opções que o usuário perde (ordenados; as usadas primeiro, pela contagem). */
  readonly perdidas: readonly number[];
  readonly perdidasUsadas: number;
  readonly exigeAprovacao: boolean;
}

/** O antes e o depois da troca de grupo (regra 8). */
export function simularTroca(
  antes: ReadonlySet<number>,
  depois: ReadonlySet<number>,
  uso: UsoOpcoes,
): ResultadoSimulacao {
  const ganhas = [...depois].filter((o) => !antes.has(o)).sort((a, b) => a - b);
  const perdidas = [...antes]
    .filter((o) => !depois.has(o))
    .sort((a, b) => (uso.get(b) ?? 0) - (uso.get(a) ?? 0) || a - b);
  const perdidasUsadas = perdidas.filter((o) => (uso.get(o) ?? 0) > 0).length;
  return {
    antes: antes.size,
    depois: depois.size,
    mantidas: antes.size - perdidas.length,
    ganhas,
    perdidas,
    perdidasUsadas,
    exigeAprovacao: perdidasUsadas > 0,
  };
}

export interface GrupoCandidato {
  readonly grupo: string;
  readonly ativo: boolean;
  readonly opcoes: ReadonlySet<number>;
}

export interface SugestaoDestino {
  readonly grupo: string;
  /** Opções usadas que o grupo cobre. */
  readonly cobertas: number;
  /** Opções distintas usadas na janela. */
  readonly usadas: number;
}

/** Grupo que pode ser destino: ativo, não genérico, com pelo menos uma opção. */
export function destinoValido(c: GrupoCandidato): boolean {
  return c.ativo && !ehGrupoGenerico(c.grupo) && c.opcoes.size > 0;
}

/**
 * Sugestão do grupo de destino pelo uso: maior número de opções usadas cobertas; no empate, o de menos opções
 * (privilégio mínimo) e, por fim, o nome. Sem uso (ou nenhuma opção usada coberta), null.
 */
export function sugerirDestino(
  uso: UsoOpcoes,
  candidatos: readonly GrupoCandidato[],
): SugestaoDestino | null {
  const usadas = [...uso].filter(([, n]) => n > 0).map(([o]) => o);
  if (usadas.length === 0) return null;
  let melhor: { c: GrupoCandidato; cobertas: number } | null = null;
  for (const c of candidatos) {
    if (!destinoValido(c)) continue;
    const cobertas = usadas.filter((o) => c.opcoes.has(o)).length;
    if (cobertas === 0) continue;
    if (
      !melhor ||
      cobertas > melhor.cobertas ||
      (cobertas === melhor.cobertas &&
        (c.opcoes.size < melhor.c.opcoes.size ||
          (c.opcoes.size === melhor.c.opcoes.size && c.grupo.localeCompare(melhor.c.grupo) < 0)))
    )
      melhor = { c, cobertas };
  }
  return melhor ? { grupo: melhor.c.grupo, cobertas: melhor.cobertas, usadas: usadas.length } : null;
}

/** Dias inteiros entre a última entrada (AAAA-MM-DD) e hoje (AAAA-MM-DD); null se nunca entrou. */
export function diasSemAcesso(ultimoAcesso: string | null, hoje: string): number | null {
  if (!ultimoAcesso) return null;
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.max(0, Math.round((d(hoje) - d(ultimoAcesso)) / 86_400_000));
}

/** Sem entrar há mais da janela (ou nunca entrou): pode ser bloqueado pelo saneamento. */
export function semUsoParaBloqueio(dias: number | null): boolean {
  return dias === null || dias > DIAS_USO_SANEAMENTO;
}

export interface AlvoDecisao {
  readonly login: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly diasSemAcesso: number | null;
}

export interface ContextoDecisao {
  /** Quem decide (ninguém decide sobre si). */
  readonly ator: string;
  readonly destino: GrupoCandidato | null;
  /** Máximo de administradores do estabelecimento. */
  readonly administradoresMaximo: number;
  /** Administradores já marcados para ficar (sem contar o alvo). */
  readonly administradoresMantidos: number;
}

/** Valida uma decisão de saneamento (null = aceita). */
export function validarDecisao(
  alvo: AlvoDecisao,
  decisao: Exclude<DecisaoSaneamento, 'dissolver-grupo'>,
  ctx: ContextoDecisao,
): RecusaSaneamento | null {
  if (!ehGrupoGenerico(alvo.grupo)) return 'grupo-nao-generico';
  if (alvo.login === ctx.ator) return 'a-si-mesmo';
  if (decisao === 'bloquear') {
    if (alvo.bloqueado) return 'ja-bloqueado';
    return semUsoParaBloqueio(alvo.diasSemAcesso) ? null : 'bloqueio-com-uso-recente';
  }
  if (decisao === 'manter-administrador') {
    // Só fica como administrador quem está ativo; o inativo ou bloqueado do grupo amplo sai por troca de grupo, que
    // não exige estar ativo (achado 2 da revisão do M59.4: senão o desbloqueio o devolveria com o acesso amplo).
    if (!alvo.ativo || alvo.bloqueado) return 'usuario-inativo';
    if (chaveGrupo(alvo.grupo ?? '') !== GRUPO_ADMINISTRADORES) return 'administrador-so-no-master';
    return ctx.administradoresMantidos >= ctx.administradoresMaximo ? 'administradores-no-limite' : null;
  }
  const d = ctx.destino;
  if (!d) return 'destino-invalido';
  if (ehGrupoGenerico(d.grupo)) return 'destino-generico';
  if (!destinoValido(d) || chaveGrupo(d.grupo) === chaveGrupo(alvo.grupo ?? '')) return 'destino-invalido';
  return null;
}

export interface ItemParaRegra {
  readonly login: string | null;
  readonly decisao: DecisaoSaneamento;
  readonly situacao: SituacaoItemSaneamento;
  readonly exigeAprovacao: boolean;
  readonly perdasUsadas: number;
  readonly criadoPor: string;
}

/** Aprovação do dono da área: só quando exige, só do proposto, nunca de quem propôs nem do próprio usuário. */
export function validarAprovacao(item: ItemParaRegra, aprovador: string): RecusaSaneamento | null {
  if (item.situacao !== 'proposto') return 'situacao-nao-permite';
  if (!item.exigeAprovacao) return 'aprovacao-desnecessaria';
  if (aprovador === item.criadoPor) return 'aprovacao-pelo-proponente';
  if (item.login !== null && aprovador === item.login) return 'aprovacao-pelo-proprio';
  return null;
}

/**
 * Aplicação: aprovado, ou proposto que não exige aprovação; a simulação é refeita na hora e, se as perdas usadas
 * aumentaram desde a decisão (o grupo de destino mudou), recusa (decide-se de novo).
 */
export function validarAplicacao(
  item: ItemParaRegra,
  ator: string,
  perdasUsadasAgora: number,
): RecusaSaneamento | null {
  if (item.situacao !== 'proposto' && item.situacao !== 'aprovado') return 'situacao-nao-permite';
  if (item.login !== null && item.login === ator) return 'a-si-mesmo';
  if (perdasUsadasAgora > item.perdasUsadas) return 'perdas-aumentaram';
  if (item.situacao === 'proposto' && (item.exigeAprovacao || perdasUsadasAgora > 0))
    return 'exige-aprovacao';
  return null;
}

/** Descartar: só o que ainda não foi aplicado. */
export function validarDescarte(item: ItemParaRegra): RecusaSaneamento | null {
  return item.situacao === 'proposto' || item.situacao === 'aprovado' || item.situacao === 'falhou'
    ? null
    : 'situacao-nao-permite';
}

/** Dissolução (retirada das opções): grupo genérico, nunca o MASTER, sem usuário ativo e com opções. */
export function validarDissolucao(grupo: string, ativos: number, opcoes: number): RecusaSaneamento | null {
  if (!ehGrupoGenerico(grupo)) return 'grupo-nao-generico';
  if (chaveGrupo(grupo) === GRUPO_ADMINISTRADORES) return 'master-nao-dissolve';
  if (ativos > 0) return 'grupo-com-ativos';
  return opcoes > 0 ? null : 'grupo-sem-opcoes';
}

/** Lotes de opções (a receita do M10 recebe a lista; cada lote é uma transação). */
export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const t = Math.max(1, Math.trunc(tamanho));
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += t) r.push(itens.slice(i, i + t));
  return r;
}

/**
 * Entrada no grupo de acesso total fora do saneamento (troca de grupo, criação ou desbloqueio pela tela de Usuários):
 * recusa quando o número de ativos do MASTER passaria do máximo configurado (achado 1 da revisão do M59.4). `entra`
 * diz se a operação faz um usuário ativo e desbloqueado passar a contar no MASTER.
 */
export function validarEntradaNoMaster(
  entra: boolean,
  ativosNoMaster: number,
  administradoresMaximo: number,
): RecusaSaneamento | null {
  return entra && ativosNoMaster + 1 > administradoresMaximo ? 'administradores-no-limite' : null;
}

/** Item vivo (conta para o plano e para o limite de administradores). */
export function itemVivo(s: SituacaoItemSaneamento): boolean {
  return s === 'proposto' || s === 'aprovado';
}
