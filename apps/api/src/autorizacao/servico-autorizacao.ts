// Autorização do usuário no servidor (ficha do M06, regras 1, 3 e 9; seção 4): as concessões (perfis e ações do
// perfil, flags), os escopos e o parâmetro de vínculo, lidos ao vivo pela fonte de acesso, com cache de 3 min no
// armazém (Valkey) por cliente, rede, estabelecimento e login: quem perde a ação perde a permissão dentro do prazo do cache. As regras são de @sgh/dominio-acesso; o
// adaptador só lê. Nenhum dado pessoal vai ao cache além do login (chave) e dos códigos.
import { ESCOPOS_SEM_RESTRICAO, type EscoposSessao, type PerfilSessao } from '@sgh/contratos';
import {
  conceder,
  concederAcessoTotal,
  type ConcessoesLegado,
  type MarcaUsuarioOrigem,
  conselhoEfetivo,
  type ParametrosConselho,
  type RegistroConselhoAvaliar,
  type PerfilConcedido,
  type PermissaoDoPerfil,
  type ResultadoConcessao,
} from '@sgh/dominio-acesso';
import type { ArmazemSessao } from '../sessao/armazem.js';
import type { AtorPlataforma } from '../sessao/tipos-acesso.js';
import { indiceDoCatalogo, indiceDoCliente, marcasDeclaradas } from './catalogo.js';
import { hojeNoEstabelecimento, type RegraConselho } from './conselho.js';

/** Validade do cache das permissões efetivas (ficha do M06, seção 4: 3 min). */
export const CACHE_AUTORIZACAO_SEGUNDOS = 180;

/** Escopos como a fonte devolve (listas só de leitura). */
export type EscoposAcesso = { readonly [K in keyof EscoposSessao]: readonly string[] };
/** @deprecated nome antigo de EscoposAcesso (módulos ainda não migrados). */
export type EscoposLegado = EscoposAcesso;

/** O que a fonte de acesso lê para calcular as permissões (a forma de @sgh/dominio-acesso, `conceder`). */
export interface DadosAutorizacao {
  readonly concessoes: ConcessoesLegado;
  readonly escopos: EscoposAcesso;
  readonly restricaoVinculo: boolean;
  readonly perfisConcedidos: readonly PerfilConcedido[];
  readonly mapaPerfis: readonly PermissaoDoPerfil[];
  /** ADR 0022: perfis do mapa grupo → perfil aprovado para o grupo do usuário (ausente: nenhum). */
  readonly perfisDoGrupo?: readonly string[];
  /**
   * W1-01 (parte 11d): os registros de conselho do papel ativo com a última conferência (ausente: a fonte não lê; a
   * conferência não muda nada). Só vem quando a concessão tem conselho.
   */
  readonly registrosConselho?: readonly RegistroConselhoAvaliar[];
  /**
   * F2-L (fonte própria): o que cada perfil do banco do cliente concede direto (perfil_acao × acao_sistema.codigo).
   * Presente, as permissões vêm só disto (pelos perfis vigentes de perfisConcedidos) e das concessões gerais do
   * catálogo, com a segregação de sempre; opções e flags do banco de origem não contam. Ausente: o cálculo antigo.
   */
  readonly acoesDoPerfil?: readonly PermissaoDoPerfil[];
  /**
   * F2-L (fonte própria): ações negadas explicitamente (perfil_acao.permitido falso) ou retiradas por recorte de
   * acesso que a sessão não sabe aplicar (falha fechada). Prevalecem sobre qualquer origem, inclusive as concessões
   * gerais do catálogo e o perfil administrador do cliente.
   */
  readonly acoesNegadas?: readonly string[];
}
/** @deprecated nome antigo de DadosAutorizacao (módulos ainda não migrados). */
export type DadosAutorizacaoLegado = DadosAutorizacao;

/**
 * W1-01 (parte 11d; D-W101-46): a categoria com conselho depois da conferência, pelo parâmetro do bloqueio dos atos
 * privativos. Sem a regra (testes, fonte sintética sem parâmetros), os dados voltam como vieram.
 */
export function comConselhoConferido(
  d: DadosAutorizacao,
  p: ParametrosConselho | null,
  hoje: string,
): { dados: DadosAutorizacao; motivo: string | null } {
  if (!p) return { dados: d, motivo: null };
  const r = conselhoEfetivo(d.concessoes.conselho, d.registrosConselho, p, hoje);
  if (r.conselho === d.concessoes.conselho) return { dados: d, motivo: null };
  return { dados: { ...d, concessoes: { ...d.concessoes, conselho: r.conselho } }, motivo: r.motivo };
}

export interface FonteAutorizacao {
  dadosDeAutorizacao(
    codigo: string,
    login: string,
    flags: readonly MarcaUsuarioOrigem[],
  ): Promise<DadosAutorizacao>;
}

export interface Autorizacao {
  readonly permissoes: readonly string[];
  readonly escopos: EscoposSessao;
  readonly perfil: PerfilSessao;
  readonly restricaoVinculo: boolean;
  readonly conselho: boolean;
  /** W1-01 (parte 11d): por que a conferência do conselho retirou os atos privativos (ausente: não retirou). */
  readonly conselhoBloqueio?: string;
  /** M38 (regra 3): grupo (perfil principal), para o escopo `grupo` das chaves de liberação. */
  readonly grupo: string | null;
  readonly calculadaEm: number;
}

/** A concessão com as origens (a tela "Perfis e permissões" mostra; a sessão guarda só as permissões). */
export function concessaoDe(d: DadosAutorizacao, agora: number): ResultadoConcessao {
  const r = concederDados(d, agora);
  if (!d.acoesNegadas || d.acoesNegadas.length === 0) return r;
  const negadas = new Set(d.acoesNegadas);
  return {
    ...r,
    permissoes: new Set([...r.permissoes].filter((p) => !negadas.has(p))),
    origens: new Map([...r.origens].filter(([p]) => !negadas.has(p))),
  };
}

function concederDados(d: DadosAutorizacao, agora: number): ResultadoConcessao {
  return conceder({
    legado: d.concessoes,
    catalogo: [],
    perfisConcedidos: d.perfisConcedidos.map((p) => ({
      perfil: p.perfil,
      inicio: new Date(p.inicio),
      fim: p.fim ? new Date(p.fim) : null,
    })),
    indice: d.acoesDoPerfil ? indiceDoCliente(d.acoesDoPerfil) : indiceDoCatalogo(d.mapaPerfis),
    perfisDoGrupo: d.perfisDoGrupo ?? [],
    agora: new Date(agora),
  });
}

/**
 * ADR 0022: acesso total da plataforma (o administrador da plataforma pode tudo). TODAS as permissões do catálogo,
 * sem segregação, sem restrição de escopo nem de vínculo. Não lê nada da fonte.
 */
export function autorizacaoAcessoTotal(agora: number): Autorizacao {
  const r = concederAcessoTotal(indiceDoCatalogo());
  return {
    permissoes: [...r.permissoes].sort(),
    escopos: { ...ESCOPOS_SEM_RESTRICAO },
    perfil: { tipo: 'caso-a-caso', perfil: null, categoria: null, assistencial: false, complementares: [] },
    restricaoVinculo: false,
    conselho: false,
    grupo: null,
    calculadaEm: agora,
  };
}

/** Cálculo puro (o mesmo para a sessão real e a sintética dos testes). */
export function calcularAutorizacao(d: DadosAutorizacao, agora: number): Autorizacao {
  const r = concessaoDe(d, agora);
  const destino = r.destino;
  return {
    permissoes: [...r.permissoes].sort(),
    escopos: {
      unidades: [...d.escopos.unidades],
      locais: [...d.escopos.locais],
      convenios: [...d.escopos.convenios],
      centrosCusto: [...d.escopos.centrosCusto],
      locaisEstoque: [...d.escopos.locaisEstoque],
      contasBancarias: [...d.escopos.contasBancarias],
      tiposAgenda: [...d.escopos.tiposAgenda],
      tiposProntuario: [...d.escopos.tiposProntuario],
    },
    perfil: {
      tipo: destino.tipo,
      perfil: destino.tipo === 'perfil' ? destino.perfil : null,
      categoria: destino.tipo === 'perfil' ? destino.categoria : null,
      assistencial: destino.tipo === 'perfil' && destino.assistencial,
      complementares: [...r.perfis],
    },
    restricaoVinculo: d.restricaoVinculo,
    conselho: d.concessoes.conselho,
    grupo: d.concessoes.grupo?.trim().toUpperCase() || null,
    calculadaEm: agora,
  };
}

/**
 * Decisão do dono (2026-11-20, b): o acesso total vem SÓ do ator da plataforma (autenticado no banco plataforma),
 * e só no cliente que ele escolheu no login. Nenhuma coluna do banco do cliente concede isto.
 */
export function autorizacaoDoAtorPlataforma(
  ator: AtorPlataforma,
  cliente: string,
  agora: number,
): Autorizacao {
  if (ator.tipo !== 'plataforma' || ator.cliente !== cliente)
    throw new Error('Ator da plataforma fora do cliente escolhido no login.');
  return autorizacaoAcessoTotal(agora);
}

/** O catálogo (opção → permissão) foi gerado da árvore de outro estabelecimento: falha fechada. */
export class ErroCatalogoDeOutroEstabelecimento extends Error {
  constructor(estabelecimento: string) {
    super(`Catálogo de permissões não gerado da árvore de opções de ${estabelecimento} (HS-1).`);
    this.name = 'ErroCatalogoDeOutroEstabelecimento';
  }
}

export class ServicoAutorizacao {
  /**
   * @param catalogoDe estabelecimentos cuja árvore de ações gerou o catálogo (os IDs de opção são do banco de
   * cada um). Com o núcleo real, qualquer outro é recusado (falha fechada, revisão do M06): ninguém recebe
   * permissão por ID de opção de outro banco. null (fonte sintética dos testes): sem conferência.
   */
  constructor(
    private readonly fonte: FonteAutorizacao,
    private readonly armazem: ArmazemSessao,
    private readonly agora: () => number = () => Date.now(),
    private readonly catalogoDe: ReadonlySet<string> | null = null,
    /**
     * Cliente (banco) cuja fonte este serviço lê: entra em todas as chaves do armazém. Um banco por cliente, e os
     * códigos de estabelecimento e os logins se repetem entre clientes (o ADMIN do semeador em todos): sem o
     * cliente, dois clientes da mesma rede dividiriam o cache e a invalidação. null só na fonte sintética.
     */
    private readonly cliente: string | null = null,
  ) {}

  /** Prefixo das chaves: cliente e rede. */
  private prefixo(rede: string): string {
    return `${this.cliente ?? '-'}:${rede}`;
  }

  private regraConselho: RegraConselho | null = null;

  /** W1-01 (parte 11d): liga o bloqueio dos atos privativos pela conferência do conselho (parâmetros por nível). */
  definirRegraConselho(regra: RegraConselho | null): void {
    this.regraConselho = regra;
  }

  /** A regra ligada (a ficha do usuário mostra os mesmos parâmetros); null sem ela. */
  get regraDoConselho(): RegraConselho | null {
    return this.regraConselho;
  }

  private async conferido(
    rede: string,
    estabelecimento: string,
    d: DadosAutorizacao,
  ): Promise<{ dados: DadosAutorizacao; motivo: string | null }> {
    if (!this.regraConselho || !d.concessoes.conselho) return { dados: d, motivo: null };
    const p = await this.regraConselho(rede, estabelecimento);
    return comConselhoConferido(d, p, hojeNoEstabelecimento(this.agora()));
  }

  private chave(rede: string, estabelecimento: string, login: string): string {
    return `${this.prefixo(rede)}:autorizacao:${estabelecimento}:${Buffer.from(login, 'utf8').toString('base64url')}`;
  }

  /**
   * ADR 0022: geração das permissões do estabelecimento no armazém compartilhado. Mudança que vale para muitos
   * (opções de um grupo ou de um papel, mapa grupo → perfil, perfil → permissão) troca a geração: todo cache
   * calculado antes deixa de valer na hora, em todos os processos.
   */
  private chaveGeracao(rede: string, estabelecimento: string): string {
    return `${this.prefixo(rede)}:autorizacao-geracao:${estabelecimento}`;
  }

  /**
   * Geração do usuário: a invalidação de um login troca este valor (não só apaga o cache). Um cálculo que leu
   * a fonte ANTES da gravação e grava o cache DEPOIS da invalidação leva a geração antiga e é descartado na
   * leitura seguinte (sem a corrida que devolvia a permissão revogada por até 3 min).
   */
  private chaveGeracaoUsuario(rede: string, estabelecimento: string, login: string): string {
    return `${this.prefixo(rede)}:autorizacao-geracao:${estabelecimento}:${Buffer.from(login, 'utf8').toString('base64url')}`;
  }

  private async geracao(rede: string, estabelecimento: string, login: string): Promise<string> {
    const [geral, usuario] = await Promise.all([
      this.armazem.obter(this.chaveGeracao(rede, estabelecimento)),
      this.armazem.obter(this.chaveGeracaoUsuario(rede, estabelecimento, login)),
    ]);
    return `${geral ?? '0'}|${usuario ?? '0'}`;
  }

  private novaGeracao(): string {
    return `${this.agora().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Permissões efetivas (cache de 3 min; frio: lê a fonte ao vivo). */
  async obter(rede: string, estabelecimento: string, login: string): Promise<Autorizacao> {
    if (this.catalogoDe && !this.catalogoDe.has(estabelecimento))
      throw new ErroCatalogoDeOutroEstabelecimento(estabelecimento);
    const chave = this.chave(rede, estabelecimento, login);
    // As gerações são lidas ANTES do cálculo: uma invalidação durante a leitura da fonte vence.
    const geracao = await this.geracao(rede, estabelecimento, login);
    const guardada = await this.armazem.obter(chave);
    if (guardada) {
      const a = JSON.parse(guardada) as Autorizacao & { geracao?: string };
      if (this.agora() - a.calculadaEm < CACHE_AUTORIZACAO_SEGUNDOS * 1000 && a.geracao === geracao) return a;
    }
    const c = await this.conferido(
      rede,
      estabelecimento,
      await this.fonte.dadosDeAutorizacao(estabelecimento, login, marcasDeclaradas()),
    );
    const base = calcularAutorizacao(c.dados, this.agora());
    const a = c.motivo ? { ...base, conselhoBloqueio: c.motivo } : base;
    await this.armazem.gravar(chave, JSON.stringify({ ...a, geracao }), CACHE_AUTORIZACAO_SEGUNDOS);
    return a;
  }

  /**
   * ADR 0022: a concessão AO VIVO, com as origens de cada permissão e o que a segregação retirou (a tela
   * "Perfis e permissões"; não usa nem grava o cache).
   */
  async explicar(
    estabelecimento: string,
    login: string,
    /** W1-01 (parte 11d): com a rede, a conferência do conselho vale como na sessão. */
    rede?: string,
  ): Promise<ResultadoConcessao & { calculadaEm: number }> {
    if (this.catalogoDe && !this.catalogoDe.has(estabelecimento))
      throw new ErroCatalogoDeOutroEstabelecimento(estabelecimento);
    const lidos = await this.fonte.dadosDeAutorizacao(estabelecimento, login, marcasDeclaradas());
    const dados = rede ? (await this.conferido(rede, estabelecimento, lidos)).dados : lidos;
    const agora = this.agora();
    return { ...concessaoDe(dados, agora), calculadaEm: agora };
  }

  /** Invalidação (troca de grupo pela tela do M10, saída da sessão): a próxima leitura vai à fonte. */
  async invalidar(rede: string, estabelecimento: string, login: string): Promise<void> {
    await this.armazem.gravar(
      this.chaveGeracaoUsuario(rede, estabelecimento, login),
      this.novaGeracao(),
      CACHE_AUTORIZACAO_SEGUNDOS * 4,
    );
    await this.armazem.apagar(this.chave(rede, estabelecimento, login));
  }

  /** ADR 0022: invalida o cache de TODOS os usuários do estabelecimento (nova geração). */
  async invalidarEstabelecimento(rede: string, estabelecimento: string): Promise<void> {
    await this.armazem.gravar(
      this.chaveGeracao(rede, estabelecimento),
      this.novaGeracao(),
      CACHE_AUTORIZACAO_SEGUNDOS * 4,
    );
  }
}
