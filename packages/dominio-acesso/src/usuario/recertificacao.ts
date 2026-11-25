// W1-01 (parte 9c): a regra da RECERTIFICAÇÃO DE ACESSOS. O gestor de acessos abre uma campanha por escopo (um grupo,
// um setor ou todas as contas ativas) com prazo e motivo; as contas ativas do escopo entram como itens (retrato do grupo
// e dos perfis no dia); o responsável decide cada item: MANTER ou RETIRAR (retirar = bloqueio da conta pelo executor
// acesso.bloquearUsuario ou revogação de um perfil SGH_). Puro: valida e resume; o adaptador grava (SGH_ 1206).
// Regras:
// - prazo entre amanhã e PRAZO_RECERT_MAXIMO_DIAS (D-W101-31: 1 a 90 dias; padrão 30); motivo com 10+ caracteres;
// - ninguém decide sobre a própria conta (segregação, como na concessão de perfil);
// - decisão é definitiva e só com a campanha aberta (depois do prazo ainda vale, até o gestor encerrar: o relatório
//   mostra as atrasadas); retirar exige motivo; revogação só de perfil que a conta tinha no retrato;
// - o bloqueio do último gestor de acessos ativo segue recusado pela regra do administrador mínimo (ultimo-gestor.ts),
//   que a API aplica antes do executor.

export type EscopoRecert = 'grupo' | 'setor' | 'todos';
export type DecisaoRecert = 'manter' | 'retirar';
export type AcaoRecert = 'bloqueio' | 'revogacao';
export type SituacaoCampanhaRecert = 'aberta' | 'encerrada' | 'cancelada';

/** D-W101-31 (o dono confirma): prazo padrão de 30 dias; entre 1 e 90. */
export const PRAZO_RECERT_PADRAO_DIAS = 30;
export const PRAZO_RECERT_MAXIMO_DIAS = 90;
export const MOTIVO_RECERT_MINIMO = 10;

export interface ContaRecertLida {
  readonly login: string;
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  /** Setores vigentes da conta (códigos): o escopo de setor ou a lotação de quem usa a conta. */
  readonly setores: readonly string[];
  /** Perfis SGH_ vigentes. */
  readonly perfis: readonly string[];
}

export interface NovaCampanhaRecert {
  readonly escopo: EscopoRecert;
  /** Grupo ou bloco; ignorado em 'todos'. */
  readonly alvo: string | null;
  /** Último dia para decidir (AAAA-MM-DD). */
  readonly prazo: string;
  readonly motivo: string;
}

export interface ItemRecertNovo {
  readonly login: string;
  readonly grupo: string | null;
  readonly perfis: readonly string[];
}

export interface ItemRecert extends ItemRecertNovo {
  readonly decisao: DecisaoRecert | null;
  readonly acao: AcaoRecert | null;
  readonly perfil: string | null;
}

export interface PedidoDecisaoRecert {
  readonly decisao: DecisaoRecert;
  readonly acao: AcaoRecert | null;
  readonly perfil: string | null;
  readonly motivo: string;
}

export type RecusaRecert =
  | { readonly codigo: 'escopo-invalido'; readonly mensagem: string }
  | { readonly codigo: 'alvo-obrigatorio'; readonly mensagem: string }
  | { readonly codigo: 'prazo-invalido'; readonly mensagem: string }
  | { readonly codigo: 'motivo-curto'; readonly mensagem: string }
  | { readonly codigo: 'escopo-vazio'; readonly mensagem: string }
  | { readonly codigo: 'campanha-fechada'; readonly mensagem: string }
  | { readonly codigo: 'ja-decidido'; readonly mensagem: string }
  | { readonly codigo: 'decidir-a-si'; readonly mensagem: string }
  | { readonly codigo: 'acao-invalida'; readonly mensagem: string }
  | { readonly codigo: 'perfil-ausente'; readonly mensagem: string };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function diaValido(d: string): boolean {
  if (!DIA.test(d)) return false;
  const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return x.toISOString().slice(0, 10) === d;
}

/** O prazo padrão a partir de hoje (AAAA-MM-DD). */
export function prazoRecertPadrao(hoje: string): string {
  const x = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10)));
  x.setUTCDate(x.getUTCDate() + PRAZO_RECERT_PADRAO_DIAS);
  return x.toISOString().slice(0, 10);
}

/** Recusa da campanha nova (null: aceita). */
export function validarNovaCampanhaRecert(p: NovaCampanhaRecert, hoje: string): RecusaRecert | null {
  if (!['grupo', 'setor', 'todos'].includes(p.escopo))
    return {
      codigo: 'escopo-invalido',
      mensagem: 'Escolha o escopo: um grupo, um setor ou todas as contas.',
    };
  if (p.escopo !== 'todos' && !(p.alvo ?? '').trim())
    return {
      codigo: 'alvo-obrigatorio',
      mensagem: p.escopo === 'grupo' ? 'Escolha o grupo da campanha.' : 'Escolha o setor da campanha.',
    };
  if (!diaValido(p.prazo))
    return { codigo: 'prazo-invalido', mensagem: 'Informe o prazo como data (AAAA-MM-DD).' };
  const dias = diasEntre(hoje, p.prazo);
  if (dias < 1 || dias > PRAZO_RECERT_MAXIMO_DIAS)
    return {
      codigo: 'prazo-invalido',
      mensagem: `O prazo tem de ficar entre amanhã e ${PRAZO_RECERT_MAXIMO_DIAS} dias a partir de hoje.`,
    };
  if (p.motivo.trim().length < MOTIVO_RECERT_MINIMO)
    return { codigo: 'motivo-curto', mensagem: 'Justifique a campanha (ao menos 10 caracteres).' };
  return null;
}

/** A conta é do grupo quando ele é o seu grupo (perfil principal) ou um dos seus perfis vigentes: onde o perfil é a
 * unidade de concessão, a campanha por grupo revisa todo mundo que tem aquele perfil, não só quem o tem como principal. */
function temGrupoOuPerfil(c: ContaRecertLida, alvo: string): boolean {
  return (
    (c.grupo ?? '').trim().toUpperCase() === alvo || c.perfis.some((p) => p.trim().toUpperCase() === alvo)
  );
}

export interface AlvoRecert {
  readonly valor: string;
  /** Quantas contas ativas entram na campanha deste alvo. */
  readonly contas: number;
}

/**
 * Os alvos que uma campanha pode ter, cada um com a contagem das contas que entram: quem abre a campanha escolhe só
 * entre escopos que têm o que recertificar e vê o tamanho antes de confirmar (nada de "escopo vazio" depois da senha).
 */
export function alvosDaRecert(contas: readonly ContaRecertLida[]): {
  readonly todos: number;
  readonly grupos: AlvoRecert[];
  readonly setores: AlvoRecert[];
} {
  const vivas = contas.filter((c) => c.ativo && !c.bloqueado);
  const contar = (de: (c: ContaRecertLida) => readonly (string | null)[]): AlvoRecert[] => {
    const m = new Map<string, { valor: string; contas: number }>();
    for (const c of vivas) {
      const vistos = new Set<string>();
      for (const bruto of de(c)) {
        const valor = (bruto ?? '').trim();
        const chave = valor.toUpperCase();
        if (!valor || vistos.has(chave)) continue;
        vistos.add(chave);
        const a = m.get(chave) ?? { valor, contas: 0 };
        a.contas += 1;
        m.set(chave, a);
      }
    }
    return [...m.values()].sort((x, y) => x.valor.localeCompare(y.valor));
  };
  return {
    todos: vivas.length,
    grupos: contar((c) => [c.grupo, ...c.perfis]),
    setores: contar((c) => c.setores),
  };
}

/** As contas que entram na campanha: ativas (bloqueadas ficam fora: já não acessam) do escopo, por login. */
export function itensDaCampanhaRecert(
  contas: readonly ContaRecertLida[],
  escopo: EscopoRecert,
  alvo: string | null,
): ItemRecertNovo[] {
  const a = (alvo ?? '').trim().toUpperCase();
  return contas
    .filter((c) => c.ativo && !c.bloqueado)
    .filter((c) =>
      escopo === 'todos'
        ? true
        : escopo === 'grupo'
          ? temGrupoOuPerfil(c, a)
          : c.setores.some((s) => s.trim().toUpperCase() === a),
    )
    .map((c) => ({ login: c.login, grupo: c.grupo, perfis: [...c.perfis].sort() }))
    .sort((x, y) => x.login.localeCompare(y.login));
}

/** Recusa da decisão de um item (null: aceita). */
export function validarDecisaoRecert(
  situacao: SituacaoCampanhaRecert,
  item: ItemRecert,
  p: PedidoDecisaoRecert,
  por: string,
): RecusaRecert | null {
  if (situacao !== 'aberta')
    return { codigo: 'campanha-fechada', mensagem: 'Esta campanha já foi encerrada ou cancelada.' };
  if (item.decisao !== null)
    return {
      codigo: 'ja-decidido',
      mensagem: 'Esta conta já foi decidida nesta campanha (a decisão é definitiva).',
    };
  if (item.login.trim().toUpperCase() === por.trim().toUpperCase())
    return { codigo: 'decidir-a-si', mensagem: 'Ninguém decide a recertificação da própria conta.' };
  if (p.decisao === 'manter') {
    if (p.acao !== null || p.perfil !== null)
      return { codigo: 'acao-invalida', mensagem: 'Manter não leva ação nem perfil.' };
    return null;
  }
  if (p.decisao !== 'retirar' || (p.acao !== 'bloqueio' && p.acao !== 'revogacao'))
    return {
      codigo: 'acao-invalida',
      mensagem: 'Retirar pede a ação: bloquear a conta ou revogar um perfil.',
    };
  if (p.motivo.trim().length < MOTIVO_RECERT_MINIMO)
    return { codigo: 'motivo-curto', mensagem: 'Justifique a retirada (ao menos 10 caracteres).' };
  if (p.acao === 'bloqueio' && p.perfil !== null)
    return { codigo: 'acao-invalida', mensagem: 'O bloqueio da conta não leva perfil.' };
  if (p.acao === 'revogacao' && (!p.perfil || !item.perfis.includes(p.perfil)))
    return {
      codigo: 'perfil-ausente',
      mensagem: 'Escolha um perfil que a conta tinha na abertura da campanha.',
    };
  return null;
}

export interface RelatorioRecert {
  readonly total: number;
  readonly mantidas: number;
  readonly bloqueadas: number;
  readonly revogadas: number;
  readonly pendentes: number;
  /** Pendentes depois do prazo (campanha aberta). */
  readonly atrasadas: number;
  /** Decididas / total, em %, arredondado para baixo (0 sem itens). */
  readonly percentual: number;
}

/** O relatório da campanha: quantas mantidas, retiradas (bloqueio e revogação), pendentes e atrasadas. */
export function relatorioRecert(
  itens: readonly Pick<ItemRecert, 'decisao' | 'acao'>[],
  prazo: string,
  hoje: string,
  situacao: SituacaoCampanhaRecert,
): RelatorioRecert {
  const mantidas = itens.filter((i) => i.decisao === 'manter').length;
  const bloqueadas = itens.filter((i) => i.decisao === 'retirar' && i.acao === 'bloqueio').length;
  const revogadas = itens.filter((i) => i.decisao === 'retirar' && i.acao === 'revogacao').length;
  const pendentes = itens.length - mantidas - bloqueadas - revogadas;
  const atrasadas = situacao === 'aberta' && diasEntre(prazo, hoje) > 0 ? pendentes : 0;
  const decididas = itens.length - pendentes;
  return {
    total: itens.length,
    mantidas,
    bloqueadas,
    revogadas,
    pendentes,
    atrasadas,
    percentual: itens.length === 0 ? 0 : Math.floor((decididas * 100) / itens.length),
  };
}
