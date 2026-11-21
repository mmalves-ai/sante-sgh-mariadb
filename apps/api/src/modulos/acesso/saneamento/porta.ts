// Porta do saneamento dos perfis de acesso amplo (M59-F4): as leituras (perfis, quem os tem, ações de cada perfil, uso
// das ações na trilha) e o plano de decisões, sobre o banco do cliente (porta-propria.ts, pelo @sgh/nucleo) ou em
// memória (porta-memoria.ts: unitários; porta-sintetica.ts: a fonte sintética do dev/ci). A troca de perfil, o bloqueio
// e a retirada das ações vão pelas operações do executor (ExecutorSaneamento), nunca por aqui.
// Vocabulário: "grupo" é o código do perfil de acesso (perfil_acesso.codigo); "opção" é a ação do catálogo
// (acao_sistema.id). Datas em ISO; nada de S/N nem sentinela.
import type { DecisaoSaneamento, ItemSaneamento } from '@sgh/contratos';

/** Situação de um perfil de acesso amplo no estabelecimento. */
export interface SituacaoGrupo {
  readonly grupo: string;
  /** O perfil existe (no estabelecimento ou na rede). */
  readonly existe: boolean;
  readonly ativo: boolean;
  /** Contas com o perfil vigente no estabelecimento. */
  readonly usuarios: number;
  /** Dessas, as que estão ativas e sem bloqueio. */
  readonly ativos: number;
  /** Ações permitidas pelo perfil. */
  readonly opcoes: number;
}

/** Uma conta com o perfil (ou a conta pedida pelo login), com a situação e a última entrada (AAAA-MM-DD). */
export interface UsuarioDoGrupo {
  readonly login: string;
  readonly idUsuario: number;
  readonly nome: string | null;
  /**
   * O perfil de acesso amplo que a conta tem (o pedido, na lista do perfil); null: nenhum perfil vigente neste
   * estabelecimento, e a conta fica fora do alcance do saneamento (sem grupo "sentinela").
   */
  readonly grupo: string | null;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly ultimoAcesso: string | null;
  /** A conta tem perfil vigente em outro estabelecimento (o bloqueio, que vale na rede toda, não se aplica). */
  readonly emOutroEstabelecimento?: boolean;
}

/** Nova decisão do plano (o login de quem decide em `criadoPor`). */
export interface DecisaoSaneamentoNova {
  readonly hospital: string;
  readonly grupoOrigem: string;
  readonly idUsuario: number | null;
  readonly login: string | null;
  readonly decisao: DecisaoSaneamento;
  readonly grupoDestino: string | null;
  readonly perdasTotal: number;
  readonly perdasUsadas: number;
  readonly exigeAprovacao: boolean;
  readonly motivo: string;
  readonly criadoPor: string;
}

/** O evento auditável de cada gravação do plano (só códigos e o login de quem opera). */
export interface TrilhaSaneamento {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

export interface GrupoComOpcoes {
  readonly grupo: string;
  readonly ativo: boolean;
  readonly opcoes: readonly number[];
}

export interface PortaSaneamento {
  pronto(hospital: string): Promise<boolean>;
  grupos(hospital: string, nomes: readonly string[]): Promise<SituacaoGrupo[]>;
  usuarios(hospital: string, grupo: string): Promise<UsuarioDoGrupo[]>;
  usuario(hospital: string, login: string): Promise<UsuarioDoGrupo | null>;
  gruposComOpcoes(hospital: string): Promise<GrupoComOpcoes[]>;
  titulos(hospital: string, ids: readonly number[]): Promise<Map<number, string>>;
  /** Uso das ações por login na janela. Lança se o registro do uso não está disponível (nunca um mapa vazio por falta). */
  uso(hospital: string, grupo: string, desde: Date): Promise<Map<string, Map<number, number>>>;
  plano(hospital: string, grupo?: string): Promise<ItemSaneamento[]>;
  item(hospital: string, id: string): Promise<ItemSaneamento | null>;
  incluir(hospital: string, n: DecisaoSaneamentoNova, t: TrilhaSaneamento): Promise<{ id: string }>;
  aprovar(
    hospital: string,
    a: { id: string; area: string; aprovadoPor: string; motivo: string },
    t: TrilhaSaneamento,
  ): Promise<boolean>;
  descartar(hospital: string, d: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean>;
  /** Reserva o item vivo para a aplicação, antes da gravação no banco (false: outro pedido o reservou ou o mudou). */
  reservar(hospital: string, r: { id: string; por: string }, t: TrilhaSaneamento): Promise<boolean>;
  /** Conclui o item reservado por `por` (aplicado, ou falhou soltando a reserva). */
  concluir(
    hospital: string,
    c: { id: string; por: string; resultado: 'aplicado' | 'falhou'; erro: string | null },
    t: TrilhaSaneamento,
  ): Promise<boolean>;
}
