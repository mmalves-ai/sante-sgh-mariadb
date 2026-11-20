// W1-01 (parte 10): a regra do PEDIDO DE ACESSO. Quem precisa de um perfil SGH_ pede (perfil, setor, período e motivo;
// botão na tela 403); o pedido passa por DOIS NÍVEIS de aprovação (1º o gestor do setor, 2º o gestor de acessos) e,
// aprovado, vira concessão do perfil com início e fim (SGH_ACESSO_PERFIL_USUARIO.INICIO/FIM), que expira sozinha no
// fim. Puro: valida e resume; o adaptador grava (SGH_ 1207) e a API concede.
// Regras (D-W101-33, o dono confirma):
// - período: início de hoje em diante, fim no início ou depois, no máximo PERIODO_PEDIDO_MAXIMO_DIAS (365) dias; o fim é o
//   último dia de acesso (a concessão termina às 00:00 do dia seguinte);
// - motivo com 10+ caracteres; não se pede perfil já vigente nem se repete pedido em andamento do mesmo perfil;
// - segregação: ninguém aprova o próprio pedido e os dois níveis são de pessoas diferentes;
// - 1º nível: gestor do setor pedido; no setor sem gestor cadastrado, um gestor de acessos faz o 1º nível (o 2º fica
//   com outro gestor de acessos);
// - recusar exige motivo (qualquer nível); o solicitante cancela enquanto o perfil não foi concedido;
// - aprovar o 2º nível com o período já vencido é recusado (o pedido fica para recusa ou cancelamento).

export type SituacaoPedidoAcesso =
  'pendente' | 'aprovado-setor' | 'aprovado' | 'concedido' | 'recusado' | 'cancelado';
export type NivelPedidoAcesso = 'setor' | 'acessos';
export type DecisaoPedidoAcesso = 'aprovar' | 'recusar';

/** D-W101-33 (o dono confirma): período de até 365 dias; motivo com 10+ caracteres. */
export const PERIODO_PEDIDO_MAXIMO_DIAS = 365;
export const MOTIVO_PEDIDO_MINIMO = 10;

/** Situações em andamento (ainda sem concessão nem fechamento). */
export const PEDIDO_EM_ANDAMENTO: readonly SituacaoPedidoAcesso[] = [
  'pendente',
  'aprovado-setor',
  'aprovado',
];

export interface NovoPedidoAcesso {
  readonly login: string;
  readonly perfil: string;
  /** Bloco do setor (SGH_ACESSO_ESCOPO_SETOR) onde o acesso será usado. */
  readonly setor: string;
  /** Primeiro dia (AAAA-MM-DD). */
  readonly inicio: string;
  /** Último dia (AAAA-MM-DD). */
  readonly fim: string;
  readonly motivo: string;
}

export interface ContextoNovoPedido {
  readonly hoje: string;
  readonly contaAtiva: boolean;
  /** Perfis conhecidos (catálogo de perfis SGH_); null = não conferir. */
  readonly perfisConhecidos: readonly string[] | null;
  /** Perfis SGH_ vigentes da conta. */
  readonly perfisVigentes: readonly string[];
  /** Perfis com pedido em andamento da conta. */
  readonly perfisEmAndamento: readonly string[];
}

export interface PedidoAcessoLido {
  readonly login: string;
  readonly perfil: string;
  readonly setor: string;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: SituacaoPedidoAcesso;
  /** Quem aprovou o 1º nível (null antes). */
  readonly setorPor: string | null;
}

export interface PapeisAprovador {
  /** Gestor do setor pedido. */
  readonly gestorDoSetor: boolean;
  /** Gestor de acessos do estabelecimento. */
  readonly gestorAcessos: boolean;
  /** O setor pedido tem gestor cadastrado. */
  readonly setorTemGestor: boolean;
}

export type RecusaPedidoAcesso = { readonly codigo: string; readonly mensagem: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function diaValido(d: string): boolean {
  if (!DIA.test(d)) return false;
  const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return x.toISOString().slice(0, 10) === d;
}

function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** O dia seguinte (AAAA-MM-DD): a concessão termina às 00:00 dele. */
export function diaSeguinte(d: string): string {
  const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

const igual = (a: string | null, b: string | null) =>
  (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** Recusa do pedido novo (null: aceito). */
export function validarNovoPedidoAcesso(
  p: NovoPedidoAcesso,
  c: ContextoNovoPedido,
): RecusaPedidoAcesso | null {
  if (!c.contaAtiva)
    return { codigo: 'conta-inativa', mensagem: 'A conta está inativa ou bloqueada: não pode pedir acesso.' };
  const perfil = p.perfil.trim();
  if (!perfil) return { codigo: 'perfil-obrigatorio', mensagem: 'Escolha o perfil que você precisa.' };
  if (c.perfisConhecidos && !c.perfisConhecidos.includes(perfil))
    return { codigo: 'perfil-desconhecido', mensagem: 'Perfil não encontrado no catálogo de perfis.' };
  if (!p.setor.trim())
    return { codigo: 'setor-obrigatorio', mensagem: 'Escolha o setor onde o acesso será usado.' };
  if (!diaValido(p.inicio) || !diaValido(p.fim))
    return { codigo: 'periodo-invalido', mensagem: 'Informe o início e o fim como datas (AAAA-MM-DD).' };
  if (diasEntre(c.hoje, p.inicio) < 0)
    return { codigo: 'periodo-invalido', mensagem: 'O início tem de ser hoje ou depois.' };
  const dias = diasEntre(p.inicio, p.fim);
  if (dias < 0) return { codigo: 'periodo-invalido', mensagem: 'O fim tem de ser no início ou depois.' };
  if (dias + 1 > PERIODO_PEDIDO_MAXIMO_DIAS)
    return {
      codigo: 'periodo-invalido',
      mensagem: `O período pedido passa de ${PERIODO_PEDIDO_MAXIMO_DIAS} dias: peça de novo perto do fim.`,
    };
  if (p.motivo.trim().length < MOTIVO_PEDIDO_MINIMO)
    return {
      codigo: 'motivo-curto',
      mensagem: 'Explique para que precisa do acesso (ao menos 10 caracteres).',
    };
  if (c.perfisVigentes.includes(perfil))
    return { codigo: 'perfil-ja-vigente', mensagem: 'Você já tem este perfil em vigor.' };
  if (c.perfisEmAndamento.includes(perfil))
    return { codigo: 'pedido-repetido', mensagem: 'Já há um pedido deste perfil em andamento.' };
  return null;
}

/** O nível que o pedido espera (null: não espera decisão). */
export function nivelDoPedido(s: SituacaoPedidoAcesso): NivelPedidoAcesso | null {
  return s === 'pendente' ? 'setor' : s === 'aprovado-setor' ? 'acessos' : null;
}

/** Recusa da decisão (aprovar ou recusar) do nível que o pedido espera (null: aceita). */
export function validarDecisaoPedidoAcesso(
  p: PedidoAcessoLido,
  decisao: DecisaoPedidoAcesso,
  motivo: string,
  por: string,
  papeis: PapeisAprovador,
  hoje: string,
): RecusaPedidoAcesso | null {
  const nivel = nivelDoPedido(p.situacao);
  if (!nivel)
    return {
      codigo: 'pedido-fechado',
      mensagem: 'Este pedido não espera decisão (já decidido ou cancelado).',
    };
  if (decisao !== 'aprovar' && decisao !== 'recusar')
    return { codigo: 'decisao-invalida', mensagem: 'Escolha aprovar ou recusar.' };
  if (igual(p.login, por))
    return { codigo: 'decidir-a-si', mensagem: 'Ninguém decide o próprio pedido de acesso.' };
  if (nivel === 'setor') {
    const pode = papeis.gestorDoSetor || (!papeis.setorTemGestor && papeis.gestorAcessos);
    if (!pode)
      return {
        codigo: 'sem-papel',
        mensagem: papeis.setorTemGestor
          ? 'O 1º nível é do gestor do setor pedido.'
          : 'O setor não tem gestor cadastrado: o 1º nível cabe a um gestor de acessos.',
      };
  } else {
    if (!papeis.gestorAcessos) return { codigo: 'sem-papel', mensagem: 'O 2º nível é do gestor de acessos.' };
    if (igual(p.setorPor, por))
      return {
        codigo: 'mesmo-aprovador',
        mensagem: 'Os dois níveis têm de ser aprovados por pessoas diferentes.',
      };
  }
  if (decisao === 'recusar') {
    if (motivo.trim().length < MOTIVO_PEDIDO_MINIMO)
      return { codigo: 'motivo-curto', mensagem: 'Justifique a recusa (ao menos 10 caracteres).' };
    return null;
  }
  if (diasEntre(hoje, p.fim) < 0)
    return {
      codigo: 'periodo-vencido',
      mensagem: 'O período pedido já terminou: recuse o pedido ou peça ao solicitante um novo.',
    };
  return null;
}

/** Recusa do cancelamento (só o solicitante, antes da concessão; null: aceito). */
export function validarCancelamentoPedidoAcesso(
  p: Pick<PedidoAcessoLido, 'login' | 'situacao'>,
  por: string,
  motivo: string,
): RecusaPedidoAcesso | null {
  // Achado 2 da revisão: 'aprovado' (concessão a caminho) não se cancela; o acesso concedido se revoga.
  if (p.situacao === 'aprovado')
    return {
      codigo: 'pedido-aprovado',
      mensagem: 'Este pedido já foi aprovado nos dois níveis: peça a revogação do perfil.',
    };
  if (!PEDIDO_EM_ANDAMENTO.includes(p.situacao))
    return { codigo: 'pedido-fechado', mensagem: 'Este pedido já foi concedido, recusado ou cancelado.' };
  if (!igual(p.login, por))
    return { codigo: 'cancelar-de-outro', mensagem: 'Só quem pediu pode cancelar o pedido.' };
  if (motivo.trim().length < MOTIVO_PEDIDO_MINIMO)
    return { codigo: 'motivo-curto', mensagem: 'Diga por que cancela (ao menos 10 caracteres).' };
  return null;
}

export interface ConcessaoDoPedido {
  readonly login: string;
  readonly perfil: string;
  /** Início da concessão (AAAA-MM-DD, 00:00): o início pedido ou hoje, o que vier depois. */
  readonly inicio: string;
  /** Fim exclusivo (AAAA-MM-DD, 00:00): o dia seguinte ao último dia pedido. */
  readonly fim: string;
  /** Setor que aprovou (SGH_ACESSO_PERFIL_USUARIO.AREA_APROVOU). */
  readonly areaAprovou: string;
  readonly motivo: string;
}

/** A concessão que o pedido aprovado nos dois níveis gera (com fim: expira sozinha). */
export function concessaoDoPedido(
  id: string,
  p: Pick<PedidoAcessoLido, 'login' | 'perfil' | 'setor' | 'inicio' | 'fim'> & { readonly motivo: string },
  hoje: string,
): ConcessaoDoPedido {
  const inicio = diasEntre(hoje, p.inicio) > 0 ? p.inicio : hoje;
  return {
    login: p.login,
    perfil: p.perfil,
    inicio,
    fim: diaSeguinte(p.fim),
    areaAprovou: p.setor,
    motivo: `Pedido de acesso ${id}: ${p.motivo.trim()}`.slice(0, 200),
  };
}

/** Situação de uma concessão com início e fim (fim exclusivo; null = sem fim) num instante. */
export function situacaoConcessao(
  inicio: Date,
  fim: Date | null,
  agora: Date,
): 'futura' | 'vigente' | 'expirada' {
  if (agora.getTime() < inicio.getTime()) return 'futura';
  if (fim && agora.getTime() >= fim.getTime()) return 'expirada';
  return 'vigente';
}
