// Família acesso-ligacao (modulos-proprios-3): LIGA a entrada por e-mail já construída (acesso-email-proprio.ts) à
// base da API, no padrão dos GanchosComoTardios:
//   - FontesAcessoTardias: a fonte da configuração (do módulo config, montado DEPOIS da sessão) e a busca do id do
//     estabelecimento (da fonte própria) chegam tarde; os serviços da recuperação e da troca rápida são montados já,
//     sobre uma fonte que delega ao que for ligado (sem ligação: a configuração falta e a recuperação fica fechada);
//   - SegundoFatorEmailTardio: o segundo fator por código no e-mail na entrada (usuário do cliente e administrador da
//     plataforma), que o ServicoSessao recebe antes de existirem os serviços (eles precisam da própria sessão);
//   - montarLigacaoAcessoEmail: monta os serviços, liga o segundo fator e devolve os provedores do controlador e o
//     conjunto de serviços ainda não migrados SEM 'recuperacao' e 'trocaRapida'.
// O código, o token e a senha nunca vão a log, resposta ou trilha.
import type { ServicoOpcionalAcesso } from '../modulos/acesso/acesso.controller.js';
import type { FonteConfiguracao } from '../modulos/config/public-api.js';
import {
  montarAcessoEmailProprio,
  type DependenciasAcessoEmail,
  type ServicosAcessoEmail,
} from './acesso-email-proprio.js';
import type { OpcoesValidacaoCredencial, RespostaValidacao } from '@sgh/dominio-acesso';
import type { DesfechoConferenciaCodigo, MetodoSegundoFator } from './codigo-email.js';
import type { FonteParametrosTrocaRapida } from './troca-rapida.js';

/** Símbolo do provedor com os serviços da entrada por e-mail (null: não montados). */
export const SERVICOS_ACESSO_EMAIL = Symbol('SERVICOS_ACESSO_EMAIL');

export type FonteConfiguracaoAcesso = FonteConfiguracao & FonteParametrosTrocaRapida;

export class ErroConfiguracaoNaoLigada extends Error {
  constructor() {
    super('A configuração do cliente ainda não foi ligada à entrada.');
    this.name = 'ErroConfiguracaoNaoLigada';
  }
}

/** A fonte da configuração e a busca do id do estabelecimento, ligadas depois de montada a sessão. */
export class FontesAcessoTardias {
  private config: (() => FonteConfiguracaoAcesso | null) | null = null;
  private idEstabelecimento: ((hospital: string) => number | null) | null = null;
  private readonly delegada: FonteConfiguracaoAcesso;

  constructor() {
    const atual = (): FonteConfiguracaoAcesso | null => this.config?.() ?? null;
    // Toda leitura vai à fonte ligada NO MOMENTO da chamada; sem ela, a promessa recusa (o chamador fecha a porta).
    this.delegada = new Proxy({} as FonteConfiguracaoAcesso, {
      get: (_alvo, prop) => {
        if (prop === 'then') return undefined;
        const f = atual() as unknown as Record<string | symbol, unknown> | null;
        if (f && typeof f[prop] !== 'function') return f[prop];
        return (...args: unknown[]) => {
          const g = atual() as unknown as Record<string | symbol, unknown> | null;
          const m = g?.[prop];
          if (typeof m !== 'function') return Promise.reject(new ErroConfiguracaoNaoLigada());
          return (m as (...a: unknown[]) => unknown).apply(g, args);
        };
      },
    });
  }

  /** O módulo config liga a sua fonte (uma vez por aplicação; a última ligação vale). */
  ligarConfiguracao(fonte: () => FonteConfiguracaoAcesso | null): void {
    this.config = fonte;
  }

  /** A base liga a busca do id do estabelecimento (a fonte própria conhece os estabelecimentos do cliente). */
  ligarEstabelecimento(busca: (hospital: string) => number | null): void {
    this.idEstabelecimento = busca;
  }

  get configuracaoLigada(): boolean {
    return this.config?.() != null;
  }

  /** A fonte que os serviços recebem na montagem (delega à ligada). */
  configuracao(): FonteConfiguracaoAcesso {
    return this.delegada;
  }

  estabelecimento(hospital: string): number | null {
    return this.idEstabelecimento ? this.idEstabelecimento(hospital) : null;
  }
}

/** O segundo fator por e-mail não pode ser conferido (sem ligação ou sem o envio montado): a entrada fecha (503). */
export class ErroSegundoFatorEmailIndisponivel extends Error {
  constructor() {
    super('O segundo fator por e-mail está indisponível.');
    this.name = 'ErroSegundoFatorEmailIndisponivel';
  }
}

/** O que o ServicoSessao usa do segundo fator por e-mail na entrada. */
export interface GanchoSegundoFatorEmail {
  /** O método escolhido pelo usuário do cliente ('aplicativo' sem escolha); recusa se 'email' não pode ser conferido. */
  metodoUsuario(rede: string, estabelecimento: string, login: string): Promise<MetodoSegundoFator>;
  emitirUsuario(rede: string, estabelecimento: string, login: string): Promise<{ validadeMinutos: number }>;
  conferirUsuario(
    rede: string,
    estabelecimento: string,
    login: string,
    codigo: string,
  ): Promise<DesfechoConferenciaCodigo>;
  /** 01-ADM L62: o desafio da chave do dispositivo na entrada (null: a conta não tem aparelho ativo). */
  opcoesDispositivoUsuario?(
    rede: string,
    estabelecimento: string,
    login: string,
    correlacao: string,
  ): Promise<OpcoesValidacaoCredencial | null>;
  /** 01-ADM L62: confere a assinatura do dispositivo (desafio de uso único); recusa com ErroOperacao. */
  conferirDispositivoUsuario?(
    rede: string,
    estabelecimento: string,
    login: string,
    resposta: RespostaValidacao,
    correlacao: string,
  ): Promise<void>;
  /** O método do administrador da plataforma (null: conta não encontrada). */
  metodoPlataforma(id: number): Promise<MetodoSegundoFator | null>;
  emitirPlataforma(id: number, correlacao: string): Promise<{ validadeMinutos: number }>;
  conferirPlataforma(id: number, codigo: string, correlacao: string): Promise<DesfechoConferenciaCodigo>;
}

/** O segundo fator por e-mail ligado depois de montados os serviços (sem ligação: a entrada recusa, 503; só se
 * passa paraSessao() ao ServicoSessao onde a ligação é montada). */
export class SegundoFatorEmailTardio implements GanchoSegundoFatorEmail {
  private s: ServicosAcessoEmail | null = null;

  ligar(servicos: ServicosAcessoEmail): void {
    this.s = servicos;
  }

  get ligado(): boolean {
    return this.s !== null;
  }

  private exigir(): ServicosAcessoEmail {
    if (!this.s) throw new ErroSegundoFatorEmailIndisponivel();
    return this.s;
  }

  // Falha FECHADA: a preferência gravada é lida sempre; quem escolheu o e-mail sem o envio montado (ou antes da
  // ligação) é recusado (o ServicoSessao traduz em 503 indisponível), nunca levado ao aplicativo sem aviso.
  async metodoUsuario(rede: string, estabelecimento: string, login: string): Promise<MetodoSegundoFator> {
    const s = this.exigir();
    const metodo = await s.preferencia.metodo(rede, estabelecimento, login);
    if (metodo === 'email' && !s.codigoUsuario) throw new ErroSegundoFatorEmailIndisponivel();
    return metodo;
  }

  emitirUsuario(rede: string, estabelecimento: string, login: string): Promise<{ validadeMinutos: number }> {
    const c = this.exigir().codigoUsuario;
    if (!c) return Promise.reject(new Error('envio de e-mail indisponível'));
    return c.emitir(rede, estabelecimento, login);
  }

  conferirUsuario(
    rede: string,
    estabelecimento: string,
    login: string,
    codigo: string,
  ): Promise<DesfechoConferenciaCodigo> {
    const c = this.exigir().codigoUsuario;
    if (!c) return Promise.reject(new Error('envio de e-mail indisponível'));
    return c.conferir(rede, estabelecimento, login, codigo);
  }

  // 01-ADM L62: a entrada ainda não tem sessão; o desafio fica guardado pela conta (uso único, validade curta).
  async opcoesDispositivoUsuario(
    rede: string,
    estabelecimento: string,
    login: string,
    correlacao: string,
  ): Promise<OpcoesValidacaoCredencial | null> {
    const d = this.exigir().dispositivo;
    const ator = { rede, hospital: estabelecimento, login, estacao: null, correlacao };
    if ((await d.listar(ator)).length === 0) return null;
    return d.iniciarValidacao(chaveEntradaDispositivo(rede, estabelecimento, login), ator);
  }

  async conferirDispositivoUsuario(
    rede: string,
    estabelecimento: string,
    login: string,
    resposta: RespostaValidacao,
    correlacao: string,
  ): Promise<void> {
    const ator = { rede, hospital: estabelecimento, login, estacao: null, correlacao };
    await this.exigir().dispositivo.concluirValidacao(
      chaveEntradaDispositivo(rede, estabelecimento, login),
      ator,
      resposta,
    );
  }

  async metodoPlataforma(id: number): Promise<MetodoSegundoFator | null> {
    const p = this.exigir().recuperacaoPlataforma;
    if (!p) throw new ErroSegundoFatorEmailIndisponivel();
    const metodo = await p.metodoSegundoFator(id);
    if (metodo === 'email' && !p.disponivel) throw new ErroSegundoFatorEmailIndisponivel();
    return metodo;
  }

  emitirPlataforma(id: number, correlacao: string): Promise<{ validadeMinutos: number }> {
    const p = this.exigir().recuperacaoPlataforma;
    if (!p) return Promise.reject(new Error('banco plataforma indisponível'));
    return p.emitirCodigo(id, null, correlacao);
  }

  conferirPlataforma(id: number, codigo: string, correlacao: string): Promise<DesfechoConferenciaCodigo> {
    const p = this.exigir().recuperacaoPlataforma;
    if (!p) return Promise.reject(new Error('banco plataforma indisponível'));
    return p.conferirCodigo(id, codigo, null, correlacao);
  }

  /** O formato da configuração do ServicoSessao. */
  paraSessao(): { segundoFatorEmail: GanchoSegundoFatorEmail } {
    return { segundoFatorEmail: this };
  }
}

export interface LigacaoAcessoEmail {
  readonly servicos: ServicosAcessoEmail;
  /** Provedores do controlador da entrada (recuperação, troca rápida e os serviços por e-mail). */
  readonly provedores: readonly { provide: symbol; useValue: unknown }[];
  /** Os serviços que continuam fora (respondem 501): sem 'recuperacao' e 'trocaRapida'. */
  readonly naoMigrados: ReadonlySet<ServicoOpcionalAcesso>;
}

/** Monta e liga a entrada por e-mail (os símbolos dos provedores vêm de quem chama, para não haver ciclo). */
export function montarLigacaoAcessoEmail(
  d: Omit<DependenciasAcessoEmail, 'configuracao' | 'estabelecimento'>,
  fontes: FontesAcessoTardias,
  segundoFator: SegundoFatorEmailTardio,
  simbolos: { readonly recuperacao: symbol; readonly trocaRapida: symbol },
  naoMigrados: ReadonlySet<ServicoOpcionalAcesso>,
): LigacaoAcessoEmail {
  const servicos = montarAcessoEmailProprio({
    ...d,
    configuracao: () => fontes.configuracao(),
    estabelecimento: (h) => fontes.estabelecimento(h),
  });
  segundoFator.ligar(servicos);
  const restantes = new Set([...naoMigrados].filter((s) => s !== 'recuperacao' && s !== 'trocaRapida'));
  return {
    servicos,
    provedores: [
      { provide: simbolos.recuperacao, useValue: servicos.recuperacao },
      { provide: simbolos.trocaRapida, useValue: servicos.trocaRapida },
      { provide: SERVICOS_ACESSO_EMAIL, useValue: servicos },
    ],
    naoMigrados: restantes,
  };
}

/** A chave do desafio da entrada (sem sessão aberta): a conta no estabelecimento da rede. */
export function chaveEntradaDispositivo(rede: string, estabelecimento: string, login: string): string {
  return `entrada:${rede}:${estabelecimento}:${login}`;
}
