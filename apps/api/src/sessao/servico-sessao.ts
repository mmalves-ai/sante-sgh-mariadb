// Serviço de sessão do BFF (ficha do M05): login no TBUSERS do estabelecimento escolhido, sessão no
// servidor (armazém Valkey) presa à rede do endereço (ARQ-2), cookie HttpOnly e CSRF por token duplo
// conferido contra o token guardado na sessão, inatividade/duração pela política, reautenticação recente,
// bloqueio da porta por tentativas (só no novo), termo e troca de senha. As regras são de
// @sgh/dominio-acesso; o adaptador só lê. Nenhuma senha, hash ou token vai a log ou corpo.
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CATALOGO_ACESSO,
  type FalhaSenha,
  type PapelSessao,
  type Sessao,
  type TrocarSenha,
  type UnidadeSessao,
} from '@sgh/contratos';
import {
  avaliarSenhaNova,
  BLOQUEIO_PORTA_PADRAO_MINUTOS,
  inicioJanelaReutilizacao,
  JANELA_REAUTENTICACAO_PADRAO_SEGUNDOS,
  limiteTentativas,
  gerarSenhaProvisoria,
  politicaEfetiva,
  portaFechada,
  reautenticacaoRecente,
  reautenticacaoValidaAte,
  senhaExpirada,
  tempoSessao,
  termoPendente,
  type TempoSessao,
} from '@sgh/dominio-acesso';
import {
  type Autenticacao,
  cifrarSenhaLegado,
  type Combinacao,
  type ConfigLogin,
  type ContaAlvo,
  type DadosSessao,
  limiteDoPerfil,
} from '@sgh/legado';
import type { PortaSenhaLegado } from '../modulos/acesso/senha/porta-senha.js';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import {
  type Autorizacao,
  autorizacaoAcessoTotal,
  type ServicoAutorizacao,
} from '../autorizacao/servico-autorizacao.js';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { ArmazemSessao } from './armazem.js';
import type { FonteAcesso } from './fonte-acesso.js';
import type {
  InfoSegundoFatorSessao,
  ServicoIdentidade,
} from '../modulos/acesso/identidade/servico-identidade.js';

/** Erro de domínio da sessão; o controlador o traduz em Problem Details. */
export class ErroSessao extends Error {
  constructor(
    readonly tipo:
      | 'credencial-invalida'
      | 'muitas-tentativas'
      | 'segundo-fator-necessario'
      | 'reautenticacao-necessaria'
      | 'sessao-bloqueada'
      | 'sessao-encerrada'
      | 'indisponivel'
      | 'estabelecimento-invalido'
      | 'primeiro-acesso'
      | 'rede-desconhecida'
      | 'trilha-indisponivel'
      | 'senha-recusada'
      | 'troca-indisponivel'
      | 'limite-sessoes'
      | 'sessao-nao-encontrada'
      | 'pin-recusado'
      | 'troca-rapida-recusada'
      | 'troca-rapida-desligada',
    readonly detalhe?: string,
    /** M59-F2: código da extensão do Problem Details (ex.: segundo-fator-codigo, segundo-fator-cadastro). */
    readonly codigo?: string,
    /** W1-01: regras da política que a senha nova não cumpre (só códigos). */
    readonly falhas?: readonly FalhaSenha[],
  ) {
    super(tipo);
    this.name = 'ErroSessao';
  }
}

/** Registro guardado no armazém (JSON pequeno, sem senha, sem hash). */
/** M10: a marca de revogação vale mais que qualquer sessão (24 horas: acima da duração máxima da política). */
const DURACAO_REVOGACAO_SEGUNDOS = 24 * 3600;

export interface Registro {
  id: string;
  rede: string;
  estabelecimento: string;
  login: string;
  nome: string;
  idUsuario: string;
  csrf: string;
  criadaMs: number;
  ultimaAtividadeMs: number;
  autenticadoMs: number;
  unidades: UnidadeSessao[];
  unidadeAtiva: number | null;
  papeis: PapelSessao[];
  termoPendente: boolean;
  trocaSenha: Sessao['trocaSenha'];
  bloqueada: boolean;
  bloqueioInatividadeSegundos: number;
  avisoInatividadeSegundos: number;
  ultimoAcessoMs: number | null;
  falhasDesde: number;
  /** W1-01 (parte 8): navegador e sistema da entrada ("Chrome no Windows"), para "Minhas sessões". */
  dispositivo?: string;
  /** W1-01 (parte 11b2): sessão aberta pela troca rápida por PIN (sem senha nesta entrada). */
  trocaRapida?: true;
  /** W1-01 (revisão): resumo do identificador do posto em que a sessão abriu (cookie do posto). */
  posto?: string;
  /** M59-F2: o segundo fator na entrada (cadastrado, disponível, a exigência da política e o fim do prazo de adesão). */
  segundoFator?: InfoSegundoFatorSessao;
  /**
   * Sessão "como" (ADR 0021): aberta pela plataforma ou pelo suporte técnico, SEM a senha do alvo. Prazo
   * absoluto (`expiraMs`, nunca renovado); a guarda por requisição confere a sessão de suporte, a função e a
   * atribuição a cada leitura do registro (falha fechada).
   */
  como?: RegistroComo;
}

/** A marca interna da sessão "como" (no armazém; a casca recebe só `Sessao.como`). */
export interface RegistroComo {
  /** SGH_SUP_SESSAO.ID */
  readonly sessao: string;
  readonly atorTipo: 'plataforma' | 'suporte';
  /** SGH_PLAT_CONTA.ID */
  readonly idConta: string;
  readonly atorEmail: string;
  readonly alvoNome: string;
  readonly expiraMs: number;
  readonly motivo: string | null;
  /** Marca das credenciais do ator na abertura (a guarda recusa se a senha ou o segundo fator mudaram). */
  readonly credencial?: string;
  /**
   * ADR 0022: `acesso-total` (só a PLATAFORMA): todas as permissões do catálogo, sem segregação; o login do
   * registro é o usuário do SPDATA "em nome de quem gravar". Ausente: `como` (a sessão do alvo).
   */
  readonly modo?: 'como' | 'acesso-total';
}

/** Guarda da sessão "como" (servico-como.ts): 'valida' ou 'encerrada'; erro de banco sobe (503). */
export type GuardaComo = (como: RegistroComo, rede: string, estabelecimento: string) => Promise<boolean>;

export interface ConfigServicoSessao {
  readonly janelaReautenticacaoSegundos?: number;
  /** A troca de senha pelo novo está liberada (plano A); falso = plano B (só no SPDATA), DP-40/ADR 0012. */
  readonly trocaSenhaPeloNovo?: boolean;
  /** Combinação confirmada pelo spike (ACESSO_COMBINACAO_SENHA); null só em dev/ci (testa as candidatas). */
  readonly combinacao?: Combinacao | null;
  /** Prazo do bloqueio da porta (ACESSO_BLOQUEIO_PORTA_MINUTOS), em segundos. */
  readonly bloqueioPortaSegundos?: number;
  /** M06: permissões do legado (sem ela, só os recursos de toda pessoa: testes do M05). */
  readonly autorizacao?: ServicoAutorizacao;
  /** M06: trilha dupla dos eventos de sessão (login, falha, bloqueio, desbloqueio, fim). */
  readonly trilha?: RegistradorTrilha;
  /** Aviso sem dado pessoal (falha de trilha em evento que não bloqueia a resposta). */
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
  /** ADR 0021: guarda por requisição da sessão "como" (sem ela, nenhuma sessão "como" vale: falha fechada). */
  readonly guardaComo?: GuardaComo;
  /** ADR 0021: reautenticação dentro do "como" confere a senha do ATOR (nunca a do alvo). */
  readonly reautenticarAtor?: (como: RegistroComo, senha: string) => Promise<boolean>;
  /** ADR 0021: a sessão "como" acabou (voltou, sair, expirou, inatividade ou revogada). */
  readonly aoEncerrarComo?: (como: RegistroComo, motivo: string) => Promise<void>;
  /**
   * M59-F2: credencial forte (confere antes do legado e regrava no primeiro login) e segundo fator na entrada. Sem
   * ele, o login é o do M05.
   */
  readonly identidade?: GanchoIdentidade;
  /** W1-01: troca de senha pelo novo (receita acesso.trocarSenha pelo executor). Sem ela, a troca fica indisponível. */
  readonly senhaLegado?: PortaSenhaLegado;
}

/** O que o serviço de sessão usa do serviço da identidade (M59-F2). */
export type GanchoIdentidade = Pick<ServicoIdentidade, 'autenticar' | 'regravar' | 'segundoFatorNoLogin'>;

/** Estação e correlação do pedido, para a trilha (MAQUINA_USUARIO "ESTACAO:origem"). */
export interface OrigemPedido {
  readonly estacao: string;
  readonly correlacao: string;
  /** W1-01 (parte 8): navegador e sistema (do User-Agent, resumido); só para "Minhas sessões". */
  readonly dispositivo?: string;
  /**
   * W1-01 (revisão): resumo SHA-256 do identificador do posto (cookie HttpOnly emitido no login forte). É ele, e não o
   * IP, que identifica a máquina na troca rápida; o valor do cookie nunca chega aqui.
   */
  readonly posto?: string;
}

/** W1-01 (parte 8): uma sessão da própria pessoa ("Minhas sessões"), sem id, token, CSRF nem endereço. */
export interface MinhaSessao {
  /** Referência opaca (resumo do id): serve só para encerrar aquela sessão. */
  readonly ref: string;
  readonly inicio: string;
  readonly ultimoUso: string;
  readonly dispositivo: string | null;
  readonly atual: boolean;
  readonly bloqueada: boolean;
}

const ORIGEM_SERVIDOR: OrigemPedido = { estacao: 'SGH-WEB:servidor', correlacao: 'sessao' };

export interface ResultadoLogin {
  readonly sessao: Sessao;
  readonly idSessao: string;
  readonly csrf: string;
  readonly ttlSegundos: number;
}

/**
 * Recursos novos concedidos a todos os perfis de pessoa (ficha do M05 §7): bridge POL-1 enquanto o mapa
 * de permissões do legado (M06) não existe. É o mesmo conjunto que a sessão sintética do M07 já usava.
 */
const PERMISSOES_TODOS_OS_PERFIS: string[] = CATALOGO_ACESSO.filter(
  (p) => p.concessaoPorPerfil === 'todos-os-perfis-de-pessoa',
).map((p) => p.codigo);

const PREFIXO_SESSAO = 'sessao';
const PREFIXO_TENTATIVAS = 'login-tentativas';
const PREFIXO_POLITICA = 'politica';
const PREFIXO_ULTIMO_ACESSO = 'ultimo-acesso';
/** W1-01 (parte 11b2): logins fortes (senha ou certificado) por estação e dia civil, para a troca rápida por PIN. */
const PREFIXO_LOGIN_FORTE = 'login-forte';
/** Guarda os logins fortes por 36 h (cobre o dia civil inteiro em qualquer fuso do país) e no máximo 20 por conta. */
const LOGIN_FORTE_SEGUNDOS = 36 * 3600;
const LOGIN_FORTE_MAXIMO = 20;
/** Dia civil do estabelecimento (AAAA-MM-DD; o fuso da obra, como as demais rotinas do acesso). */
export function diaCivilSessao(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms));
}
/** Cache da política (TBCFGLOGIN) por rede:estabelecimento (ficha §4: 5 min). */
const CACHE_POLITICA_SEGUNDOS = 5 * 60;
/** Último acesso válido no novo: guardado por 400 dias (cobre a revisão anual de acessos). */
const ULTIMO_ACESSO_SEGUNDOS = 400 * 24 * 3600;

function iguaisSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

const INDISPONIVEL = 'O serviço de autenticação está indisponível.';

export class ServicoSessao {
  private readonly janela: number;
  private readonly trocaPeloNovo: boolean;
  private readonly combinacao: Combinacao | null;
  private readonly bloqueioPortaSegundos: number;
  private readonly autorizacao: ServicoAutorizacao | null;
  private readonly trilha: RegistradorTrilha | null;
  private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void;
  private readonly guardaComo: GuardaComo | null;
  private readonly reautenticarAtor: ConfigServicoSessao['reautenticarAtor'] | null;
  private readonly aoEncerrarComo: ConfigServicoSessao['aoEncerrarComo'] | null;
  private readonly identidade: GanchoIdentidade | null;
  private readonly senhaLegado: PortaSenhaLegado | null;

  constructor(
    private readonly fonte: FonteAcesso,
    private readonly armazem: ArmazemSessao,
    private readonly agora: () => number = () => Date.now(),
    config: ConfigServicoSessao = {},
  ) {
    this.janela = config.janelaReautenticacaoSegundos ?? JANELA_REAUTENTICACAO_PADRAO_SEGUNDOS;
    this.trocaPeloNovo = config.trocaSenhaPeloNovo ?? false;
    this.combinacao = config.combinacao ?? null;
    this.bloqueioPortaSegundos = config.bloqueioPortaSegundos ?? BLOQUEIO_PORTA_PADRAO_MINUTOS * 60;
    this.autorizacao = config.autorizacao ?? null;
    this.trilha = config.trilha ?? null;
    this.aviso = config.aviso ?? (() => undefined);
    this.guardaComo = config.guardaComo ?? null;
    this.reautenticarAtor = config.reautenticarAtor ?? null;
    this.aoEncerrarComo = config.aoEncerrarComo ?? null;
    this.identidade = config.identidade ?? null;
    this.senhaLegado = config.senhaLegado ?? null;
  }

  /** ADR 0022: o serviço de autorização (a tela "Perfis e permissões" explica e invalida o cache). */
  get servicoAutorizacao(): ServicoAutorizacao | null {
    return this.autorizacao;
  }

  /** ADR 0022: a fonte de acesso (a tela "Perfis e permissões" lê as concessões ao vivo). */
  get fonteAcesso(): FonteAcesso {
    return this.fonte;
  }

  /** Permissões efetivas (cache de 3 min); sem o serviço (testes do M05), null. */
  private async autorizacaoDe(
    r: Pick<Registro, 'rede' | 'estabelecimento' | 'login'> & { como?: RegistroComo | undefined },
  ): Promise<Autorizacao | null> {
    // ADR 0022: acesso total da plataforma: todas as permissões, sem ler o legado do "em nome de".
    if (r.como?.modo === 'acesso-total') return autorizacaoAcessoTotal(this.agora());
    if (!this.autorizacao) return null;
    try {
      return await this.autorizacao.obter(r.rede, r.estabelecimento, r.login);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
  }

  /**
   * Evento de sessão na trilha dupla. `obrigatorio`: sem trilha, a ação não acontece (login); senão o erro
   * é avisado e a resposta segue (falha de login, fim de sessão, bloqueio por inatividade).
   */
  private async registrar(
    evento: string,
    r: { rede: string; estabelecimento: string; login: string },
    origem: OrigemPedido,
    obrigatorio: boolean,
    resultado: 'sucesso' | 'falha' = 'sucesso',
  ): Promise<void> {
    if (!this.trilha) return;
    try {
      await this.trilha.registrar({
        evento,
        rede: r.rede,
        hospital: r.estabelecimento,
        usuario: r.login,
        estacao: origem.estacao,
        correlacao: origem.correlacao,
        recurso: 'acesso.sessao',
        resultado,
      });
    } catch (e) {
      this.aviso('trilha: evento de sessão não registrado', {
        evento,
        estabelecimento: r.estabelecimento,
        erro: e instanceof Error ? e.name : 'erro',
      });
      if (obrigatorio)
        throw new ErroSessao(
          'trilha-indisponivel',
          'A entrada não pôde ser registrada na trilha; tente de novo.',
        );
    }
  }

  /** A rede que esta fonte atende. */
  get rede(): string {
    return this.fonte.rede;
  }

  /** A rede resolvida pelo endereço tem de ser a desta fonte; senão, o endereço não serve (ARQ-2). */
  private conferirRede(rede: string | null): string {
    if (!rede || rede !== this.fonte.rede) {
      throw new ErroSessao('rede-desconhecida', 'Este endereço não pertence a uma rede configurada.');
    }
    return rede;
  }

  private chaveSessao(rede: string, id: string): string {
    return `${rede}:${PREFIXO_SESSAO}:${id}`;
  }
  /** M10: marca de revogação das sessões de um usuário (bloqueio pela tela de usuários). */
  private chaveRevogacao(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:${PREFIXO_SESSAO}-revogadas:${estabelecimento}:${login}`;
  }
  /** M10: índice das sessões de um usuário (ficha do usuário: "sessões no sistema"). */
  private chaveIndice(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:${PREFIXO_SESSAO}-usuario:${estabelecimento}:${login}`;
  }
  private chaveTentativas(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:${PREFIXO_TENTATIVAS}:${estabelecimento}:${login}`;
  }

  private estabelecimentoDisponivel(codigo: string): boolean {
    return this.fonte.saude().some((s) => s.codigo === codigo && s.disponivel);
  }

  /** Lista do seletor (ARQ-1/ARQ-2): só os estabelecimentos da rede do endereço, com a situação. */
  estabelecimentos(redeDoEndereco: string | null): {
    rede: string;
    estabelecimentos: { codigo: string; nome: string; disponivel: boolean }[];
  } {
    const rede = this.conferirRede(redeDoEndereco);
    return {
      rede,
      estabelecimentos: this.fonte
        .saude()
        .map((s) => ({ codigo: s.codigo, nome: s.nomeConfigurado, disponivel: s.disponivel })),
    };
  }

  /**
   * W1-01 (parte 5): esquece a política guardada do estabelecimento (depois de publicar ou cancelar uma versão da
   * política do Sante, a próxima troca já lê a nova). Falha do armazém não derruba a publicação (o cache vence em 5 min).
   */
  async esquecerPolitica(rede: string, estabelecimento: string): Promise<void> {
    try {
      await this.armazem.apagar(`${rede}:${PREFIXO_POLITICA}:${estabelecimento}`);
    } catch {
      // o cache vence sozinho em 5 min
    }
  }

  /** W1-01 (parte 5): a política lida (TBCFGLOGIN e a camada do Sante), para a tela da política. */
  configDoEstabelecimento(rede: string, estabelecimento: string): Promise<ConfigLogin> {
    return this.politica(rede, estabelecimento);
  }

  /** Política (TBCFGLOGIN) com cache de 5 min no armazém, por rede:estabelecimento. */
  private async politica(rede: string, estabelecimento: string): Promise<ConfigLogin> {
    const chave = `${rede}:${PREFIXO_POLITICA}:${estabelecimento}`;
    try {
      const guardada = await this.armazem.obter(chave);
      if (guardada) return JSON.parse(guardada) as ConfigLogin;
      const lida = await this.fonte.configLogin(estabelecimento);
      await this.armazem.gravar(chave, JSON.stringify(lida), CACHE_POLITICA_SEGUNDOS);
      return lida;
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
  }

  /**
   * Conta a tentativa ANTES de conferir a senha (INCR atômico): pedidos em paralelo não furam o limite.
   * Devolve quantas tentativas já havia antes desta.
   */
  private async contarTentativa(chave: string, limite: number): Promise<number> {
    const n = await this.armazem.incrementar(chave, this.bloqueioPortaSegundos);
    if (portaFechada(n - 1, limite)) {
      throw new ErroSessao('muitas-tentativas', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    }
    return n - 1;
  }

  private async autenticar(estabelecimento: string, login: string, senha: string): Promise<Autenticacao> {
    return (await this.autenticarComOrigem(estabelecimento, login, senha)).auth;
  }

  /**
   * M59-F2 (regra 2): a credencial forte confere primeiro (e decide, quando vigente); sem ela, a senha do legado.
   * `pelaForte` diz qual conferiu (o login regrava só quando foi a do legado).
   */
  private async autenticarComOrigem(
    estabelecimento: string,
    login: string,
    senha: string,
  ): Promise<{ auth: Autenticacao; pelaForte: boolean; provisoria?: boolean }> {
    try {
      if (this.identidade) {
        const f = await this.identidade.autenticar(estabelecimento, login, senha);
        if (f.tipo === 'forte-invalida')
          return { auth: { desfecho: 'credencial-invalida' }, pelaForte: true };
        if (f.tipo === 'forte-ok') {
          const c = f.conta;
          return {
            auth: {
              desfecho: 'ok',
              combinacao: null,
              conta: {
                login: c.login,
                id: c.id,
                nomeExibicao: c.nomeExibicao,
                ativo: c.ativo,
                bloqueado: c.bloqueado,
                criptografada: c.criptografada,
                doisFatoresLegado: false,
                senhaAlteradaEm: c.senhaAlteradaEm,
                semCifra: !c.criptografada && !c.senhaPresente,
              },
            },
            pelaForte: true,
            provisoria: f.provisoria === true,
          };
        }
      }
      const auth = await this.fonte.autenticar(estabelecimento, login, senha, this.combinacao ?? undefined);
      return { auth, pelaForte: false };
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
  }

  /**
   * Entrar. `idAnterior`: sessão que o navegador ainda trazia; é apagada no servidor (identificador sempre
   * novo no login, regra 8).
   */
  async entrar(
    entrada: {
      estabelecimento: string;
      login: string;
      senha: string;
      codigoSegundoFator?: string | undefined;
    },
    redeDoEndereco: string | null,
    idAnterior: string | null = null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    const { estabelecimento, login, senha } = entrada;
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    if (!this.estabelecimentoDisponivel(estabelecimento)) {
      throw new ErroSessao('estabelecimento-invalido', 'Escolha um estabelecimento disponível.');
    }
    const config = await this.politica(rede, estabelecimento);
    const chaveTent = this.chaveTentativas(rede, estabelecimento, login);
    const falhasAntes = await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));

    const { auth, pelaForte, provisoria } = await this.autenticarComOrigem(estabelecimento, login, senha);
    if (auth.desfecho === 'credencial-invalida' || auth.desfecho === 'conta-impedida') {
      await this.registrar(
        EVENTOS_AUDITAVEIS.loginFalho.codigo,
        { rede, estabelecimento, login },
        origem,
        false,
        'falha',
      );
      throw new ErroSessao('credencial-invalida', 'Usuário ou senha inválidos.');
    }
    if (auth.desfecho === 'sem-cifra') {
      // Sem senha guardada, nada foi conferido: nunca abre sessão (a tentativa continua contada).
      throw new ErroSessao(
        'primeiro-acesso',
        'Primeiro acesso: a sua senha ainda não foi definida. Procure o administrador do sistema.',
      );
    }
    const conta = auth.conta;
    let dados: DadosSessao;
    try {
      dados = await this.fonte.dadosDeSessao(estabelecimento, conta.login, config);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    const politica = politicaEfetiva(dados.config.senha, dados.config.sante);
    const expirada = senhaExpirada(conta.senhaAlteradaEm, new Date(this.agora()), politica.periodoTrocaDias);
    // Regra 3: conta sem cifra (SENHA_CRIPTOGRAFADA='F'), qualquer que seja o valor guardado, vai à troca.
    // W1-01: a senha provisória dada pelo gestor (credencial forte com origem senha-provisoria) também obriga a troca.
    const trocaSenha: Sessao['trocaSenha'] = !conta.criptografada
      ? 'senha-sem-cifra'
      : provisoria
        ? 'senha-provisoria'
        : expirada
          ? 'senha-expirada'
          : null;

    // M59-F2: o segundo fator confere dentro da abertura (precisa do perfil); a tentativa só é apagada depois dele.
    const r = await this.abrirSessao(rede, estabelecimento, conta, dados, trocaSenha, falhasAntes, origem, {
      codigo: entrada.codigoSegundoFator,
    });
    await this.armazem.apagar(chaveTent);
    // Regra 2: a senha do legado conferiu: regrava no esquema forte (falha só avisa; a próxima entrada tenta de novo).
    if (!pelaForte && this.identidade) {
      await this.identidade.regravar(
        {
          rede,
          hospital: estabelecimento,
          login: conta.login,
          idUsuario: conta.id,
          estacao: origem.estacao,
          correlacao: origem.correlacao,
        },
        senha,
      );
    }
    return r;
  }

  /**
   * M49 (etapa 3): entrar com o certificado ICP-Brasil. A posse da chave, a cadeia, a revogação, o CPF e o vínculo do
   * certificado com a conta já foram conferidos por quem chama (o serviço da assinatura); aqui, a mesma porta de
   * entrada sem a senha: a conta tem de existir, estar ativa, sem bloqueio e num grupo ativo; a sessão é a de sempre
   * (identificador novo, trilha obrigatória). A troca de senha vencida não é pedida (a senha não foi usada).
   */
  async entrarComCertificado(
    entrada: { estabelecimento: string; login: string },
    redeDoEndereco: string | null,
    idAnterior: string | null = null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    const conta = await this.conferirAlvoComo(entrada.estabelecimento, entrada.login, redeDoEndereco);
    const config = await this.politica(rede, entrada.estabelecimento);
    let dados: DadosSessao;
    try {
      dados = await this.fonte.dadosDeSessao(entrada.estabelecimento, conta.login, config);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    return this.abrirSessao(rede, entrada.estabelecimento, conta, dados, null, 0, origem);
  }

  private async abrirSessao(
    rede: string,
    estabelecimento: string,
    conta: { readonly login: string; readonly id: number | string; readonly nomeExibicao: string },
    dados: DadosSessao,
    trocaSenha: Sessao['trocaSenha'],
    falhasAntes: number,
    origem: OrigemPedido,
    /** M59-F2: o login por senha passa o código (ou nada); o certificado ICP-Brasil não passa (já é posse). */
    segundoFator?: { readonly codigo: string | undefined },
    /** W1-01 (parte 11b2): 'forte' (senha ou certificado: conta para a troca rápida) ou 'pin' (troca rápida). */
    entradaPor: 'forte' | 'pin' = 'forte',
  ): Promise<ResultadoLogin> {
    const chaveUltimo = `${rede}:${PREFIXO_ULTIMO_ACESSO}:${estabelecimento}:${conta.login}`;
    const ultimo = await this.armazem.obter(chaveUltimo);
    const tempo = tempoSessao(dados.config.tempo);
    const t = this.agora();
    await this.armazem.gravar(chaveUltimo, String(t), ULTIMO_ACESSO_SEGUNDOS);
    const registro: Registro = {
      id: randomUUID(),
      rede,
      estabelecimento,
      login: conta.login,
      nome: conta.nomeExibicao,
      idUsuario: String(conta.id),
      csrf: randomUUID(),
      criadaMs: t,
      ultimaAtividadeMs: t,
      autenticadoMs: t,
      unidades: dados.unidades,
      unidadeAtiva: dados.unidades.length === 1 ? (dados.unidades[0]?.codigo ?? null) : null,
      papeis: dados.papeis,
      termoPendente: termoPendente(dados.termo, new Date(t)),
      trocaSenha,
      bloqueada: false,
      bloqueioInatividadeSegundos: tempo.inatividadeSegundos,
      avisoInatividadeSegundos: tempo.avisoSegundos,
      ultimoAcessoMs: ultimo ? Number(ultimo) : null,
      falhasDesde: falhasAntes,
      ...(origem.dispositivo ? { dispositivo: origem.dispositivo } : {}),
      ...(entradaPor === 'pin' ? { trocaRapida: true as const } : {}),
      ...(origem.posto ? { posto: origem.posto } : {}),
    };
    const aut = await this.autorizacaoDe(registro);
    if (segundoFator && this.identidade) {
      const info = await this.conferirSegundoFator(registro, aut, segundoFator.codigo, origem);
      if (info) registro.segundoFator = info;
    }
    // W1-01 (parte 8), depois do segundo fator: limite de sessões simultâneas do perfil no estabelecimento (o próprio, senão o padrão '*').
    const limite = limiteDoPerfil(dados.config.limitesSessao, aut?.perfil?.perfil);
    if (limite !== null) {
      const abertas = (await this.sessoesVivas(rede, estabelecimento, conta.login)).filter((x) => !x.como);
      if (abertas.length >= limite) {
        await this.registrar(
          EVENTOS_AUDITAVEIS.loginFalho.codigo,
          { rede, estabelecimento, login: conta.login },
          origem,
          false,
          'falha',
        );
        throw new ErroSessao(
          'limite-sessoes',
          `Você já tem ${abertas.length} ${abertas.length === 1 ? 'sessão aberta' : 'sessões abertas'}, o limite do seu perfil. Saia de uma delas (ou encerre-as em Minhas sessões) para entrar aqui.`,
          'limite-sessoes',
        );
      }
    }
    // Sem trilha, sem sessão: o login só vale registrado nas duas trilhas (ficha do M06, seção 12).
    await this.registrar(EVENTOS_AUDITAVEIS.loginOk.codigo, registro, origem, true);
    await this.salvar(registro);
    await this.indexar(registro, tempo.duracaoMaximaSegundos);
    // W1-01 (revisão): o login forte vale para a troca rápida só no POSTO (cookie), nunca pelo IP.
    if (entradaPor === 'forte' && origem.posto)
      await this.anotarLoginForte(registro, `POSTO:${origem.posto}`);
    return {
      sessao: this.montar(registro, false, aut),
      idSessao: registro.id,
      csrf: registro.csrf,
      ttlSegundos: tempo.duracaoMaximaSegundos,
    };
  }

  /** M59-F2 (regra 3): o código, a política e a adesão; recusa com o código da extensão para a tela. */
  private async conferirSegundoFator(
    r: Registro,
    aut: Autorizacao | null,
    codigo: string | undefined,
    origem: OrigemPedido,
  ): Promise<InfoSegundoFatorSessao | undefined> {
    if (!this.identidade) return undefined;
    const alcance = {
      perfil: aut?.perfil?.perfil ?? null,
      complementares: aut?.perfil?.complementares ?? [],
      grupo: aut?.grupo ?? null,
    };
    let d: Awaited<ReturnType<GanchoIdentidade['segundoFatorNoLogin']>>;
    try {
      d = await this.identidade.segundoFatorNoLogin(
        r.estabelecimento,
        { login: r.login, id: Number(r.idUsuario) },
        alcance,
        codigo,
      );
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    if (d.tipo === 'entrar') return d.info;
    if (d.tipo === 'codigo-invalido') {
      await this.registrar(EVENTOS_AUDITAVEIS.loginFalho.codigo, r, origem, false, 'falha');
      throw new ErroSessao(
        'segundo-fator-necessario',
        'Código do segundo fator inválido.',
        'segundo-fator-invalido',
      );
    }
    if (d.tipo === 'codigo-necessario') {
      throw new ErroSessao(
        'segundo-fator-necessario',
        'Informe o código de 6 dígitos do aplicativo autenticador.',
        'segundo-fator-codigo',
      );
    }
    await this.registrar(EVENTOS_AUDITAVEIS.loginFalho.codigo, r, origem, false, 'falha');
    throw new ErroSessao(
      'segundo-fator-necessario',
      'O segundo fator é obrigatório para o seu perfil e ainda não foi cadastrado. Procure o gestor de acessos.',
      'segundo-fator-cadastro',
    );
  }

  private tempoDoRegistro(r: Registro): TempoSessao {
    return tempoSessao({
      inatividadeSegundos: r.bloqueioInatividadeSegundos,
      avisoSegundos: r.avisoInatividadeSegundos,
    });
  }

  private chaveLoginForte(rede: string, estabelecimento: string, login: string): string {
    return `${rede}:${PREFIXO_LOGIN_FORTE}:${estabelecimento}:${login}`;
  }

  /** W1-01 (parte 11b2): anota o login forte (dia civil e estação); falha só avisa (a troca rápida fica recusada). */
  private async anotarLoginForte(r: Registro, estacao: string): Promise<void> {
    const chave = this.chaveLoginForte(r.rede, r.estabelecimento, r.login);
    try {
      const lista = JSON.parse((await this.armazem.obter(chave)) ?? '[]') as {
        dia: string;
        estacao: string;
      }[];
      const novo = { dia: diaCivilSessao(this.agora()), estacao: estacao.slice(0, 100) };
      const sem = lista.filter((x) => x.dia !== novo.dia || x.estacao !== novo.estacao);
      await this.armazem.gravar(
        chave,
        JSON.stringify([novo, ...sem].slice(0, LOGIN_FORTE_MAXIMO)),
        LOGIN_FORTE_SEGUNDOS,
      );
    } catch (e) {
      this.aviso('sessao: login forte não anotado para a troca rápida', {
        estabelecimento: r.estabelecimento,
        erro: e instanceof Error ? e.name : 'erro',
      });
    }
  }

  /** W1-01 (parte 11b2): os logins fortes recentes da conta (dia civil e estação), o mais novo primeiro. */
  async loginsFortes(
    rede: string,
    estabelecimento: string,
    login: string,
  ): Promise<{ dia: string; estacao: string }[]> {
    const bruto = await this.armazem.obter(this.chaveLoginForte(rede, estabelecimento, login));
    return bruto ? (JSON.parse(bruto) as { dia: string; estacao: string }[]) : [];
  }

  /**
   * W1-01 (parte 11b2): abre a sessão da TROCA RÁPIDA (o PIN e a regra já foram conferidos pelo ServicoTrocaRapida).
   * A conta passa pela mesma conferência do "como" (ativa, sem bloqueio, grupo ativo); termo pendente e limite de
   * sessões valem como em toda entrada; o segundo fator não é pedido (a pessoa já entrou com a senha hoje nesta
   * estação). A sessão anterior da estação NÃO se encerra: fica BLOQUEADA (a dona volta com a senha ou o PIN).
   */
  async entrarPorTrocaRapida(
    entrada: { estabelecimento: string; login: string },
    redeDoEndereco: string | null,
    idAnterior: string | null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    const conta = await this.conferirAlvoComo(entrada.estabelecimento, entrada.login, redeDoEndereco);
    const config = await this.politica(rede, entrada.estabelecimento);
    let dados: DadosSessao;
    try {
      dados = await this.fonte.dadosDeSessao(entrada.estabelecimento, conta.login, config);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    const res = await this.abrirSessao(
      rede,
      entrada.estabelecimento,
      conta,
      dados,
      null,
      0,
      origem,
      undefined,
      'pin',
    );
    if (idAnterior) await this.bloquearAnterior(rede, idAnterior, origem);
    return res;
  }

  /** A sessão anterior da estação fica bloqueada (a "como" se encerra: não há senha do alvo para voltar). */
  private async bloquearAnterior(rede: string, id: string, origem: OrigemPedido): Promise<void> {
    const r = await this.carregar(rede, id);
    if (!r) return;
    if (r.como) {
      await this.descartarAnterior(rede, id);
      return;
    }
    if (r.bloqueada) return;
    r.bloqueada = true;
    await this.salvar(r);
    await this.registrar(EVENTOS_AUDITAVEIS.bloqueio.codigo, r, origem, false);
  }

  /** Grava com o TTL que falta até a duração máxima (o registro nunca vive além das 12 h). */
  private async salvar(r: Registro): Promise<void> {
    const fimPolitica = r.criadaMs + this.tempoDoRegistro(r).duracaoMaximaSegundos * 1000;
    // Sessão "como": nunca vive além do prazo absoluto (ADR 0021, R5).
    const fim = r.como ? Math.min(fimPolitica, r.como.expiraMs) : fimPolitica;
    const ttl = Math.max(1, Math.ceil((fim - this.agora()) / 1000));
    await this.armazem.gravar(this.chaveSessao(r.rede, r.id), JSON.stringify(r), ttl);
  }

  /**
   * Carrega a sessão e aplica o relógio: passou da duração máxima → apaga (null); passou da inatividade →
   * marca bloqueada E GRAVA (o bloqueio só sai por reautenticação). Sessão de outra rede → null.
   */
  private async carregar(rede: string, id: string | null): Promise<Registro | null> {
    if (!id) return null;
    const chave = this.chaveSessao(rede, id);
    const bruto = await this.armazem.obter(chave);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Registro;
    if (r.rede !== rede) return null;
    const tempo = this.tempoDoRegistro(r);
    const t = this.agora();
    if (t - r.criadaMs >= tempo.duracaoMaximaSegundos * 1000) {
      await this.armazem.apagar(chave);
      if (r.como) await this.encerrarComo(r.como, 'expirada');
      return null;
    }
    // M10: usuário bloqueado pela tela de usuários depois do login: as sessões dele caem na próxima requisição.
    const revogadoEm = await this.armazem.obter(this.chaveRevogacao(r.rede, r.estabelecimento, r.login));
    if (revogadoEm !== null && Number(revogadoEm) >= r.criadaMs) {
      await this.armazem.apagar(chave);
      if (r.como) await this.encerrarComo(r.como, 'revogada');
      return null;
    }
    if (r.como) {
      // Sessão "como" (ADR 0021): prazo absoluto e guarda por requisição; a inatividade também encerra (não
      // há senha do alvo para desbloquear). Erro da guarda: 503, nunca libera.
      const inativa =
        tempo.inatividadeSegundos > 0 && t - r.ultimaAtividadeMs >= tempo.inatividadeSegundos * 1000;
      const motivo = t >= r.como.expiraMs ? 'expirada' : inativa ? 'inatividade' : null;
      if (motivo) {
        await this.armazem.apagar(chave);
        await this.encerrarComo(r.como, motivo);
        return null;
      }
      let vale: boolean;
      try {
        vale = this.guardaComo ? await this.guardaComo(r.como, r.rede, r.estabelecimento) : false;
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      if (!vale) {
        await this.armazem.apagar(chave);
        return null;
      }
      return r;
    }
    if (
      !r.bloqueada &&
      tempo.inatividadeSegundos > 0 &&
      t - r.ultimaAtividadeMs >= tempo.inatividadeSegundos * 1000
    ) {
      r.bloqueada = true;
      await this.salvar(r);
      await this.registrar(EVENTOS_AUDITAVEIS.bloqueio.codigo, r, ORIGEM_SERVIDOR, false);
    }
    return r;
  }

  /** Sessão ativa (não bloqueada) para as rotas que mudam estado. */
  private async carregarAtiva(rede: string, id: string): Promise<Registro> {
    const r = await this.carregar(rede, id);
    if (!r) throw new ErroSessao('sessao-encerrada', 'Sessão encerrada; entre de novo.');
    if (r.bloqueada) throw new ErroSessao('sessao-bloqueada', 'Sessão bloqueada; confirme a senha.');
    return r;
  }

  /** Lê a sessão pelo id do cookie; aplica inatividade/duração. null: ausente, expirada ou de outra rede. */
  async ler(
    id: string | null,
    redeDoEndereco: string | null,
  ): Promise<{ registro: Registro; sessao: Sessao } | null> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregar(rede, id);
    if (!r) return null;
    const recente = reautenticacaoRecente(r.autenticadoMs, this.agora(), this.janela);
    return { registro: r, sessao: this.montar(r, recente, await this.autorizacaoDe(r)) };
  }

  /** Marca atividade (adia a inatividade) sem reautenticar. Sessão bloqueada não é tocada. */
  async tocar(id: string, redeDoEndereco: string | null): Promise<void> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregar(rede, id);
    if (!r || r.bloqueada) return;
    r.ultimaAtividadeMs = this.agora();
    await this.salvar(r);
  }

  /** Token duplo: o cabeçalho tem de ser igual ao token GUARDADO na sessão (tempo constante). */
  async csrfConfere(id: string, redeDoEndereco: string | null, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const rede = this.conferirRede(redeDoEndereco);
    const bruto = await this.armazem.obter(this.chaveSessao(rede, id));
    if (!bruto) return false;
    return iguaisSeguro((JSON.parse(bruto) as Registro).csrf, token);
  }

  /** Reautentica (desbloqueia e renova a janela de operações críticas) conferindo a senha de novo. */
  async reautenticar(
    id: string,
    redeDoEndereco: string | null,
    senha: string,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<Sessao> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregar(rede, id);
    if (!r) throw new ErroSessao('sessao-encerrada', 'Sessão encerrada; entre de novo.');
    const config = await this.politica(rede, r.estabelecimento);
    const chaveTent = r.como
      ? `${rede}:${PREFIXO_TENTATIVAS}:como:${r.como.idConta}`
      : this.chaveTentativas(rede, r.estabelecimento, r.login);
    await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));
    if (r.como) {
      // ADR 0021: no "como", a senha conferida é a do ATOR (a conta da plataforma), nunca a do alvo.
      let ok: boolean;
      try {
        ok = this.reautenticarAtor ? await this.reautenticarAtor(r.como, senha) : false;
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      if (!ok) throw new ErroSessao('credencial-invalida', 'Senha inválida.');
    } else {
      const auth = await this.autenticar(r.estabelecimento, r.login, senha);
      // Só a senha conferida desbloqueia: "sem-cifra" (nada conferido) nunca vale.
      if (auth.desfecho !== 'ok') throw new ErroSessao('credencial-invalida', 'Senha inválida.');
    }
    await this.armazem.apagar(chaveTent);
    // Relê antes de gravar: preserva o que outra requisição tenha mudado (ex.: unidade escolhida).
    const atual = (await this.carregar(rede, id)) ?? r;
    const estavaBloqueada = atual.bloqueada;
    const t = this.agora();
    atual.autenticadoMs = t;
    atual.ultimaAtividadeMs = t;
    atual.bloqueada = false;
    if (estavaBloqueada) await this.registrar(EVENTOS_AUDITAVEIS.desbloqueio.codigo, atual, origem, true);
    await this.salvar(atual);
    return this.montar(atual, true, await this.autorizacaoDe(atual));
  }

  /** W1-01: a troca de senha pelo novo está disponível (chave ligada, porta montada e combinação confirmada). */
  get trocaSenhaDisponivel(): boolean {
    const c = this.senhaLegado?.combinacao ?? null;
    return this.trocaPeloNovo && c !== null && c !== 'texto-puro';
  }

  /**
   * W1-01: troca a própria senha. A senha atual conferida vale como reautenticação (conta no limite de tentativas);
   * a nova passa pela política efetiva (TBCFGLOGIN + mínimos do novo) e pelo reuso (atual e TBHISTSENHA na janela);
   * grava no legado pela receita acesso.trocarSenha (o gatilho do legado guarda o histórico) e regrava a credencial
   * forte. Nenhuma senha, resumo ou sal sai daqui (só os códigos das falhas).
   */
  async trocarSenha(
    id: string,
    redeDoEndereco: string | null,
    entrada: Pick<TrocarSenha, 'senhaAtual' | 'senhaNova'>,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<Sessao> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (r.como)
      throw new ErroSessao(
        'troca-indisponivel',
        'Nesta sessão a senha do usuário não se troca: use "Redefinir senha" na ficha do usuário.',
      );
    const porta = this.senhaLegado;
    const combinacao = porta?.combinacao ?? null;
    if (!porta || !this.trocaSenhaDisponivel || combinacao === null)
      throw new ErroSessao(
        'troca-indisponivel',
        'A troca de senha ainda não está disponível neste estabelecimento. Procure o administrador do sistema.',
      );
    const config = await this.politica(rede, r.estabelecimento);
    const chaveTent = this.chaveTentativas(rede, r.estabelecimento, r.login);
    await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));
    const auth = await this.autenticar(r.estabelecimento, r.login, entrada.senhaAtual);
    if (auth.desfecho !== 'ok') throw new ErroSessao('credencial-invalida', 'Senha atual inválida.');
    await this.armazem.apagar(chaveTent);

    const politica = politicaEfetiva(config.senha, config.sante);
    // W1-01 (parte 5): o nome da sessão vale para a recusa de senha derivada do nome (se a política do Sante pedir).
    // Revisão: a data de nascimento vem do profissional vinculado ao usuário (porta), só quando a política a recusa.
    // A redefinição pelo gestor e o "Esqueci a senha" geram senha provisória aleatória e forçam esta troca: a senha
    // escolhida pela pessoa passa sempre por aqui.
    let nascimento: string | null = null;
    if (politica.recusaNascimento && porta.nascimento) {
      try {
        nascimento = await porta.nascimento(r.estabelecimento, r.login);
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
    }
    const falhas = avaliarSenhaNova(entrada.senhaNova, r.login, politica, { nome: r.nome, nascimento });
    if (entrada.senhaNova === entrada.senhaAtual) falhas.push('igual-atual');
    if (falhas.length === 0) {
      const desde =
        politica.periodoReutilizacaoDias > 0
          ? inicioJanelaReutilizacao(new Date(this.agora()), politica.periodoReutilizacaoDias)
          : null;
      let reuso: Awaited<ReturnType<PortaSenhaLegado['reuso']>>;
      try {
        reuso = await porta.reuso(r.estabelecimento, r.login, entrada.senhaNova, desde);
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      if (reuso) falhas.push(reuso);
    }
    if (falhas.length > 0)
      throw new ErroSessao(
        'senha-recusada',
        'A senha nova não cumpre a política de senha.',
        'senha-politica',
        falhas,
      );

    const cifrada = cifrarSenhaLegado(entrada.senhaNova, combinacao);
    const t = this.agora();
    await porta.gravar(r.estabelecimento, r.login, cifrada, {
      rede,
      hospital: r.estabelecimento,
      traceId: origem.correlacao,
      usuarioLegado: r.login,
      idempotencyKey: randomUUID(),
      estacao: origem.estacao.slice(0, 80),
      reautenticadoEm: t,
    });
    if (this.identidade) {
      await this.identidade.regravar(
        {
          rede,
          hospital: r.estabelecimento,
          login: r.login,
          idUsuario: Number(r.idUsuario),
          estacao: origem.estacao,
          correlacao: origem.correlacao,
        },
        entrada.senhaNova,
        'troca-senha',
      );
    }
    const atual = (await this.carregar(rede, id)) ?? r;
    atual.trocaSenha = null;
    atual.autenticadoMs = t;
    atual.ultimaAtividadeMs = t;
    await this.salvar(atual);
    return this.montar(atual, true, await this.autorizacaoDe(atual));
  }

  /**
   * W1-01 (parte 2b): acesso.redefinirSenha. O gestor de acessos (já reautenticado pelo chamador, com a segregação
   * conferida) dá ao usuário `alvo` uma senha PROVISÓRIA gerada aqui: cumpre a política efetiva do estabelecimento e
   * não repete a atual nem o histórico; grava no legado pela receita acesso.redefinirSenha (o gatilho do legado guarda o
   * histórico; a trilha do executor guarda o gestor) e regrava a credencial forte com origem `senha-provisoria`, o que
   * obriga a troca no próximo acesso ao Sante. A senha volta só ao gestor, nesta resposta; nada dela vai a log ou trilha.
   */
  async redefinirSenha(
    gestor: { readonly rede: string; readonly estabelecimento: string; readonly login: string },
    alvo: string,
    origem: OrigemPedido,
    reautenticadoEm: number,
  ): Promise<{ readonly senhaProvisoria: string; readonly trocaObrigatoria: boolean }> {
    if (alvo === gestor.login)
      throw new ErroSessao(
        'troca-indisponivel',
        'A sua própria senha se troca em "Trocar senha", não pela redefinição.',
      );
    return this.gravarSenhaProvisoria(gestor, alvo, origem, reautenticadoEm);
  }

  /**
   * W1-01 (parte 7), "Esqueci a senha": o token de uso único do e-mail institucional (conferido e consumido por quem
   * chama) vale como a prova de posse; a senha provisória é a mesma da redefinição (receita acesso.redefinirSenha, com
   * o próprio usuário como autor na trilha) e a troca fica obrigatória no próximo acesso.
   */
  async redefinirPorRecuperacao(
    rede: string,
    estabelecimento: string,
    login: string,
    origem: OrigemPedido,
  ): Promise<{ readonly senhaProvisoria: string; readonly trocaObrigatoria: boolean }> {
    return this.gravarSenhaProvisoria({ rede, estabelecimento, login }, login, origem, this.agora());
  }

  private async gravarSenhaProvisoria(
    gestor: { readonly rede: string; readonly estabelecimento: string; readonly login: string },
    alvo: string,
    origem: OrigemPedido,
    reautenticadoEm: number,
  ): Promise<{ readonly senhaProvisoria: string; readonly trocaObrigatoria: boolean }> {
    const porta = this.senhaLegado;
    const combinacao = porta?.combinacao ?? null;
    if (!porta || !this.trocaSenhaDisponivel || combinacao === null)
      throw new ErroSessao(
        'troca-indisponivel',
        'A redefinição de senha ainda não está disponível neste estabelecimento. Procure o administrador do sistema.',
      );
    const { rede, estabelecimento } = gestor;
    const configPol = await this.politica(rede, estabelecimento);
    const politica = politicaEfetiva(configPol.senha, configPol.sante);
    const desde =
      politica.periodoReutilizacaoDias > 0
        ? inicioJanelaReutilizacao(new Date(this.agora()), politica.periodoReutilizacaoDias)
        : null;
    let senha = '';
    for (let i = 0; i < 5 && !senha; i++) {
      const candidata = gerarSenhaProvisoria(politica, alvo, (n) => randomInt(n));
      let reuso: Awaited<ReturnType<PortaSenhaLegado['reuso']>>;
      try {
        reuso = await porta.reuso(estabelecimento, alvo, candidata, desde);
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      if (!reuso) senha = candidata;
    }
    if (!senha) throw new ErroSessao('indisponivel', INDISPONIVEL);
    const cifrada = cifrarSenhaLegado(senha, combinacao);
    const idUsuario = await porta.gravar(
      estabelecimento,
      alvo,
      cifrada,
      {
        rede,
        hospital: estabelecimento,
        traceId: origem.correlacao,
        usuarioLegado: gestor.login,
        idempotencyKey: randomUUID(),
        estacao: origem.estacao.slice(0, 80),
        reautenticadoEm,
      },
      'redefinicao',
    );
    let trocaObrigatoria = false;
    if (this.identidade && idUsuario !== null) {
      trocaObrigatoria = await this.identidade.regravar(
        {
          rede,
          hospital: estabelecimento,
          login: alvo,
          idUsuario,
          estacao: origem.estacao,
          correlacao: origem.correlacao,
        },
        senha,
        'senha-provisoria',
      );
    }
    // As sessões do usuário no Sante caem: a senha anterior deixou de valer.
    await this.revogarSessoesDoUsuario(rede, estabelecimento, alvo);
    return { senhaProvisoria: senha, trocaObrigatoria };
  }

  /**
   * M25 (regra 7, dupla checagem): confere a senha de OUTRO profissional, o segundo da checagem, no estabelecimento da
   * sessão de quem checa, sem abrir sessão para ele; a tentativa conta no limite do login dele (a porta fecha como no
   * login). Devolve se a senha conferiu e as permissões dele (a de conferir a administração é exigida por quem chama).
   * O próprio login da sessão nunca é o segundo profissional.
   */
  async conferirSegundoProfissional(
    id: string,
    redeDoEndereco: string | null,
    login: string,
    senha: string,
  ): Promise<{ readonly conferiu: boolean; readonly permissoes: readonly string[] }> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (r.login.trim().toUpperCase() === login.trim().toUpperCase())
      return { conferiu: false, permissoes: [] };
    const config = await this.politica(rede, r.estabelecimento);
    const chave = this.chaveTentativas(rede, r.estabelecimento, login);
    await this.contarTentativa(chave, limiteTentativas(config.limiteTentativas));
    const auth = await this.autenticar(r.estabelecimento, login, senha);
    if (auth.desfecho !== 'ok') return { conferiu: false, permissoes: [] };
    await this.armazem.apagar(chave);
    const a = await this.autorizacaoDe({ rede, estabelecimento: r.estabelecimento, login });
    return { conferiu: true, permissoes: a?.permissoes ?? [] };
  }

  /** Operações críticas (regra 11): fora da janela de reautenticação → reautenticacao-necessaria. */
  async exigirReautenticacaoRecente(id: string, redeDoEndereco: string | null): Promise<Registro> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (!reautenticacaoRecente(r.autenticadoMs, this.agora(), this.janela)) {
      throw new ErroSessao('reautenticacao-necessaria', 'Confirme a sua senha para continuar.');
    }
    return r;
  }

  async escolherUnidade(id: string, redeDoEndereco: string | null, codigo: number): Promise<Sessao> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (!r.unidades.some((u) => u.codigo === codigo)) {
      throw new ErroSessao('estabelecimento-invalido', 'Unidade fora do seu acesso.');
    }
    r.unidadeAtiva = codigo;
    r.ultimaAtividadeMs = this.agora();
    await this.salvar(r);
    return this.montar(
      r,
      reautenticacaoRecente(r.autenticadoMs, this.agora(), this.janela),
      await this.autorizacaoDe(r),
    );
  }

  /**
   * M10 (acesso.bloquearUsuario): derruba as sessões do usuário no estabelecimento. Não há índice de sessões por
   * usuário: grava a marca da revogação (o instante), e toda sessão criada antes dela cai ao ser lida; vale pelo
   * prazo máximo da sessão. O cache das permissões do usuário é invalidado.
   */
  async revogarSessoesDoUsuario(rede: string, estabelecimento: string, login: string): Promise<void> {
    await this.armazem.gravar(
      this.chaveRevogacao(rede, estabelecimento, login),
      String(this.agora()),
      DURACAO_REVOGACAO_SEGUNDOS,
    );
    await this.autorizacao?.invalidar(rede, estabelecimento, login).catch(() => undefined);
  }

  /**
   * M10: guarda o id da sessão no índice do usuário (o armazém não lista chaves). Informativo: duas entradas ao
   * mesmo tempo podem perder um id no índice, nunca a sessão; as expiradas saem na leitura.
   */
  private async indexar(r: Registro, ttlSegundos: number): Promise<void> {
    const chave = this.chaveIndice(r.rede, r.estabelecimento, r.login);
    const ids = new Set<string>(JSON.parse((await this.armazem.obter(chave)) ?? '[]') as string[]);
    ids.add(r.id);
    await this.armazem.gravar(chave, JSON.stringify([...ids].slice(-50)), ttlSegundos);
  }

  /**
   * M10 (ficha do usuário): as sessões ativas do usuário no estabelecimento, sem token, CSRF nem endereço:
   * início, último uso, se está bloqueada por inatividade e se é sessão "como". As derrubadas pela revogação e
   * as expiradas não aparecem (e saem do índice).
   */
  async sessoesDoUsuario(
    rede: string,
    estabelecimento: string,
    login: string,
  ): Promise<
    { inicio: string; ultimoUso: string; estabelecimento: string; bloqueada: boolean; como: boolean }[]
  > {
    return (await this.sessoesVivas(rede, estabelecimento, login)).map((r) => ({
      inicio: new Date(r.criadaMs).toISOString(),
      ultimoUso: new Date(r.ultimaAtividadeMs).toISOString(),
      estabelecimento: r.estabelecimento,
      bloqueada: r.bloqueada,
      como: Boolean(r.como),
    }));
  }

  /** As sessões vivas do usuário pelo índice (a mais usada primeiro); limpa do índice as que caíram. */
  private async sessoesVivas(rede: string, estabelecimento: string, login: string): Promise<Registro[]> {
    const chave = this.chaveIndice(rede, estabelecimento, login);
    const ids = JSON.parse((await this.armazem.obter(chave)) ?? '[]') as string[];
    const revogadoEm = Number(
      (await this.armazem.obter(this.chaveRevogacao(rede, estabelecimento, login))) ?? 0,
    );
    const t = this.agora();
    const vivas: Registro[] = [];
    for (const id of ids) {
      const bruto = await this.armazem.obter(this.chaveSessao(rede, id));
      if (!bruto) continue;
      const r = JSON.parse(bruto) as Registro;
      if (r.login !== login || r.estabelecimento !== estabelecimento) continue;
      if (revogadoEm && r.criadaMs <= revogadoEm) continue;
      if (t - r.criadaMs >= this.tempoDoRegistro(r).duracaoMaximaSegundos * 1000) continue;
      vivas.push(r);
    }
    if (vivas.length !== ids.length) {
      const ttl = Math.max(
        1,
        ...vivas.map((r) =>
          Math.ceil((r.criadaMs + this.tempoDoRegistro(r).duracaoMaximaSegundos * 1000 - t) / 1000),
        ),
      );
      if (vivas.length === 0) await this.armazem.apagar(chave);
      else await this.armazem.gravar(chave, JSON.stringify(vivas.map((r) => r.id)), ttl);
    }
    return vivas.sort((a, b) => b.ultimaAtividadeMs - a.ultimaAtividadeMs);
  }

  /** W1-01 (parte 8): referência opaca da sessão (nunca o id, que é a credencial do cookie). */
  private static ref(id: string): string {
    return createHash('sha256').update(`sessao:${id}`).digest('hex').slice(0, 24);
  }

  /**
   * W1-01 (parte 8): "Minhas sessões" — as sessões da própria pessoa no estabelecimento (as de suporte "como" não
   * entram), com a atual marcada. A sessão tem de estar ativa (não bloqueada).
   */
  async minhasSessoes(id: string, redeDoEndereco: string | null): Promise<MinhaSessao[]> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (r.como) return [];
    return (await this.sessoesVivas(rede, r.estabelecimento, r.login))
      .filter((x) => !x.como)
      .map((x) => ({
        ref: ServicoSessao.ref(x.id),
        inicio: new Date(x.criadaMs).toISOString(),
        ultimoUso: new Date(x.ultimaAtividadeMs).toISOString(),
        dispositivo: x.dispositivo ?? null,
        atual: x.id === r.id,
        bloqueada: x.bloqueada,
      }));
  }

  /**
   * W1-01 (parte 8): encerra as outras sessões da própria pessoa (`ref` ausente) ou só a da referência. A atual não se
   * encerra por aqui (é o "Sair"). Cada encerrada vai à trilha como fim de sessão. Devolve quantas caíram.
   */
  async encerrarMinhasSessoes(
    id: string,
    redeDoEndereco: string | null,
    ref: string | null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<number> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (r.como) return 0;
    const outras = (await this.sessoesVivas(rede, r.estabelecimento, r.login)).filter(
      (x) => !x.como && x.id !== r.id && (ref === null || ServicoSessao.ref(x.id) === ref),
    );
    if (ref !== null && outras.length === 0)
      throw new ErroSessao(
        'sessao-nao-encontrada',
        'Esta sessão já foi encerrada ou é a atual (para ela, use Sair).',
      );
    for (const x of outras) {
      await this.armazem.apagar(this.chaveSessao(rede, x.id));
      await this.registrar(EVENTOS_AUDITAVEIS.fimSessao.codigo, x, origem, false);
    }
    return outras.length;
  }

  /** M10: o termo vigente foi aceito pela tela: a sessão deixa de ter o termo pendente. */
  async marcarTermoAceito(id: string, redeDoEndereco: string | null): Promise<void> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregar(rede, id);
    if (!r || !r.termoPendente) return;
    r.termoPendente = false;
    await this.salvar(r);
  }

  async sair(
    id: string | null,
    redeDoEndereco: string | null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<void> {
    const rede = this.conferirRede(redeDoEndereco);
    if (!id) return;
    const bruto = await this.armazem.obter(this.chaveSessao(rede, id));
    await this.armazem.apagar(this.chaveSessao(rede, id));
    if (bruto) {
      const r = JSON.parse(bruto) as Registro;
      // Sessão "como": sair é voltar (encerra a sessão de suporte); o cache de permissões do alvo fica.
      if (r.como) {
        await this.encerrarComo(r.como, 'voltou');
        return;
      }
      await this.autorizacao?.invalidar(r.rede, r.estabelecimento, r.login).catch(() => undefined);
      await this.registrar(EVENTOS_AUDITAVEIS.fimSessao.codigo, r, origem, false);
    }
  }

  /**
   * A sessão que o navegador ainda trazia, substituída por um login novo (ou por outro "como"): apagada no
   * servidor; se era "como", a sessão de suporte é encerrada na auditoria ('substituida').
   */
  private async descartarAnterior(rede: string, id: string): Promise<void> {
    const chave = this.chaveSessao(rede, id);
    const bruto = await this.armazem.obter(chave);
    await this.armazem.apagar(chave);
    if (!bruto) return;
    const r = JSON.parse(bruto) as Registro;
    if (r.como) await this.encerrarComo(r.como, 'substituida');
  }

  private async encerrarComo(como: RegistroComo, motivo: string): Promise<void> {
    await this.aoEncerrarComo?.(como, motivo).catch((e: unknown) =>
      this.aviso('suporte: encerramento da sessão "como" não registrado', {
        sessao: como.sessao,
        erro: e instanceof Error ? e.name : 'erro',
      }),
    );
  }

  /**
   * Abre a sessão "como" (ADR 0021): a sessão do ALVO, com as permissões reais do M06, SEM a senha dele. Quem
   * chama (servico-como.ts) já conferiu a conta, a função e a atribuição e já registrou a SGH_SUP_SESSAO. O
   * termo e a troca de senha do alvo não são pedidos (são atos pessoais dele); o prazo é absoluto.
   */
  /**
   * A conta-alvo do "como" (ADR 0021), conferida com a MESMA regra do modal: existe, ativa, não bloqueada e de
   * um grupo ATIVO do TBGRUUSU. Quem chama confere ANTES de registrar a sessão de suporte (login fora da regra
   * não gera sessão nem aviso ao Auditor).
   */
  async conferirAlvoComo(
    estabelecimento: string,
    login: string,
    redeDoEndereco: string | null,
  ): Promise<ContaAlvo> {
    this.conferirRede(redeDoEndereco);
    if (!this.estabelecimentoDisponivel(estabelecimento))
      throw new ErroSessao('estabelecimento-invalido', 'Escolha um estabelecimento disponível.');
    if (!this.fonte.contaAlvo) throw new ErroSessao('indisponivel', INDISPONIVEL);
    let conta: ContaAlvo | null;
    try {
      conta = await this.fonte.contaAlvo(estabelecimento, login);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    if (!conta || !conta.ativo || conta.bloqueado || !conta.grupo || !conta.grupoAtivo)
      throw new ErroSessao(
        'credencial-invalida',
        'Usuário inexistente, inativo, bloqueado ou fora de grupo ativo.',
      );
    return conta;
  }

  async abrirComo(
    entrada: { estabelecimento: string; login: string; como: RegistroComo },
    redeDoEndereco: string | null,
    idAnterior: string | null = null,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    const conta = await this.conferirAlvoComo(entrada.estabelecimento, entrada.login, redeDoEndereco);
    const config = await this.politica(rede, entrada.estabelecimento);
    let dados: DadosSessao;
    try {
      dados = await this.fonte.dadosDeSessao(entrada.estabelecimento, conta.login, config);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    const tempo = tempoSessao(dados.config.tempo);
    const t = this.agora();
    const registro: Registro = {
      id: randomUUID(),
      rede,
      estabelecimento: entrada.estabelecimento,
      login: conta.login,
      nome: conta.nomeExibicao,
      idUsuario: String(conta.id),
      csrf: randomUUID(),
      criadaMs: t,
      ultimaAtividadeMs: t,
      // A reautenticação dentro do "como" é a do ATOR (que acabou de entrar com a própria senha).
      autenticadoMs: t,
      unidades: dados.unidades,
      unidadeAtiva: dados.unidades.length === 1 ? (dados.unidades[0]?.codigo ?? null) : null,
      papeis: dados.papeis,
      termoPendente: false,
      trocaSenha: null,
      bloqueada: false,
      bloqueioInatividadeSegundos: tempo.inatividadeSegundos,
      avisoInatividadeSegundos: tempo.avisoSegundos,
      ultimoAcessoMs: null,
      falhasDesde: 0,
      // O nome de exibição do alvo vem do legado (a marca do documento e a faixa usam o nome).
      como: { ...entrada.como, alvoNome: conta.nomeExibicao },
    };
    const aut = await this.autorizacaoDe(registro);
    await this.salvar(registro);
    const ttl = Math.max(
      1,
      Math.ceil((Math.min(entrada.como.expiraMs, t + tempo.duracaoMaximaSegundos * 1000) - t) / 1000),
    );
    await this.indexar(registro, ttl);
    return {
      sessao: this.montar(registro, true, aut),
      idSessao: registro.id,
      csrf: registro.csrf,
      ttlSegundos: ttl,
    };
  }

  private montar(r: Registro, reautRecente: boolean, aut: Autorizacao | null = null): Sessao {
    const t = this.agora();
    return {
      usuario: { id: r.idUsuario, nome: r.nome, login: r.login },
      rede: r.rede,
      // Para a troca (novo login): só os disponíveis agora.
      estabelecimentos: this.fonte
        .saude()
        .filter((s) => s.disponivel || s.codigo === r.estabelecimento)
        .map((s) => ({ codigo: s.codigo, nome: s.nomeConfigurado })),
      estabelecimentoAtivo: r.estabelecimento,
      unidades: r.unidades,
      unidadeAtiva: r.unidadeAtiva,
      papeis: r.papeis,
      // M06: as permissões do legado (grupo, papéis, flags) mais os recursos novos por perfil, com a
      // segregação aplicada (ServicoAutorizacao, cache de 3 min). Sem o serviço (testes do M05), só os
      // recursos de toda pessoa.
      permissoes: aut ? [...aut.permissoes] : PERMISSOES_TODOS_OS_PERFIS,
      ...(aut
        ? {
            escopos: aut.escopos,
            perfil: aut.perfil,
            restricaoVinculo: aut.restricaoVinculo,
            grupoLegado: aut.grupo ?? null,
          }
        : {}),
      sintetica: false,
      bloqueioInatividadeSegundos: r.bloqueioInatividadeSegundos,
      avisoInatividadeSegundos: r.avisoInatividadeSegundos,
      bloqueada: r.bloqueada,
      expiraEm: new Date(r.criadaMs + this.tempoDoRegistro(r).duracaoMaximaSegundos * 1000).toISOString(),
      // Último acesso válido e falhas desde então NO NOVO (o do SPDATA, TBCABTRILHA evento 6, é do M15).
      ultimoAcesso: {
        em: r.ultimoAcessoMs === null ? null : new Date(r.ultimoAcessoMs).toISOString(),
        falhasDesde: r.falhasDesde,
      },
      termoPendente: r.termoPendente,
      trocaSenha: r.trocaSenha,
      trocaSenhaPeloNovo: this.trocaSenhaDisponivel,
      segundoFator: r.segundoFator
        ? {
            cadastrado: r.segundoFator.cadastrado,
            disponivel: r.segundoFator.disponivel,
            exigencia: r.segundoFator.exigencia,
            prazoAdesaoAte: r.segundoFator.prazoAdesaoAte,
          }
        : { cadastrado: false, disponivel: false },
      reautenticacaoValidaAte: reautRecente
        ? new Date(reautenticacaoValidaAte(r.autenticadoMs, this.janela) ?? t).toISOString()
        : null,
      ...(r.como
        ? {
            expiraEm: new Date(
              Math.min(r.como.expiraMs, r.criadaMs + this.tempoDoRegistro(r).duracaoMaximaSegundos * 1000),
            ).toISOString(),
            como: {
              ator: { tipo: r.como.atorTipo, email: r.como.atorEmail },
              alvo: { login: r.login, nome: r.como.alvoNome },
              expiraEm: new Date(r.como.expiraMs).toISOString(),
              motivo: r.como.motivo,
              modo: r.como.modo ?? 'como',
              estabelecimentoNome:
                this.fonte.saude().find((x) => x.codigo === r.estabelecimento)?.nomeConfigurado ??
                r.estabelecimento,
            },
          }
        : {}),
    };
  }
}
