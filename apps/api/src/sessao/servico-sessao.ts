// Serviço de sessão do BFF (ficha do M05): login na conta (usuario) do cliente, no estabelecimento escolhido, sessão no
// servidor (armazém Valkey) presa à rede do endereço (ARQ-2), cookie HttpOnly e CSRF por token duplo
// conferido contra o token guardado na sessão, inatividade/duração pela política, reautenticação recente,
// bloqueio da porta por tentativas (só no novo), termo e troca de senha. As regras são de
// @sgh/dominio-acesso; o adaptador só lê. Nenhuma senha, hash ou token vai a log ou corpo.
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { GanchoSegundoFatorEmail } from './acesso-email-tardio.js';
import { ErroCodigoEmail } from './codigo-email.js';
import {
  CATALOGO_ACESSO,
  type FalhaSenha,
  type PapelSessao,
  type Sessao,
  type TrocarSenha,
  type UnidadeSessao,
} from '@sgh/contratos';
import {
  type Alcance2fa,
  avaliarSenhaNova,
  cifrarSenha,
  BLOQUEIO_PORTA_PADRAO_MINUTOS,
  inicioJanelaReutilizacao,
  JANELA_REAUTENTICACAO_PADRAO_SEGUNDOS,
  limiteTentativas,
  gerarSenhaProvisoria,
  politicaEfetiva,
  portaFechada,
  regrasDaPolitica,
  type RegraPoliticaSenha,
  reautenticacaoRecente,
  reautenticacaoValidaAte,
  senhaExpirada,
  tempoSessao,
  termoPendente,
  type TempoSessao,
} from '@sgh/dominio-acesso';
import type { PortaSenha } from '../modulos/acesso/senha/porta-senha.js';
import { EVENTOS_AUDITAVEIS, type Exigencia2fa } from '@sgh/contratos';
import {
  type Autorizacao,
  autorizacaoAcessoTotal,
  autorizacaoDoAtorPlataforma,
  type ServicoAutorizacao,
} from '../autorizacao/servico-autorizacao.js';
import type { RegistradorTrilha } from '../autorizacao/trilha.js';
import type { ArmazemSessao } from './armazem.js';
import type {
  Autenticacao,
  ConfigLogin,
  ContaAlvo,
  DadosSessao,
  FonteAcesso,
  FontePlataforma,
  SituacaoAdministradorPlataforma,
} from './fonte-acesso.js';
import { CONFIG_LOGIN_PADRAO } from './tipos-acesso.js';

/** Perfil-padrão dos limites de sessões simultâneas (vale para o perfil sem limite próprio). */
export const PERFIL_LIMITE_PADRAO = '*';

/** Limite de sessões simultâneas do perfil (o próprio, senão o padrão '*'); null: sem limite. */
export function limiteDoPerfil(
  limites: Readonly<Record<string, number>> | undefined,
  perfil: string | null | undefined,
): number | null {
  if (!limites) return null;
  if (perfil && limites[perfil] !== undefined) return limites[perfil] ?? null;
  return limites[PERFIL_LIMITE_PADRAO] ?? null;
}

/** O segundo fator na entrada (cadastrado, disponível, a exigência da política e o fim do prazo de adesão). */
export interface InfoSegundoFatorSessao {
  readonly cadastrado: boolean;
  readonly disponivel: boolean;
  readonly exigencia: Exigencia2fa;
  readonly prazoAdesaoAte: string | null;
}

/** A conta que a credencial do serviço da identidade conferiu (sem nada de credencial). */
export interface ContaIdentidadeSessao {
  readonly login: string;
  readonly id: number;
  readonly nomeExibicao: string;
  readonly ativo: boolean;
  readonly bloqueado: boolean;
  readonly senhaAlteradaEm: Date | null;
}

/** Desfecho da credencial do serviço da identidade; `legado`: sem credencial lá, a fonte de acesso decide. */
export type DesfechoIdentidade =
  | { readonly tipo: 'forte-ok'; readonly conta: ContaIdentidadeSessao; readonly provisoria?: boolean }
  | { readonly tipo: 'forte-invalida' }
  | { readonly tipo: 'legado' };

export type Desfecho2faSessao =
  | { readonly tipo: 'entrar'; readonly info: InfoSegundoFatorSessao }
  | { readonly tipo: 'codigo-necessario' }
  | { readonly tipo: 'codigo-invalido' }
  | { readonly tipo: 'cadastro-obrigatorio' };

export interface AtorIdentidadeSessao {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly idUsuario: number;
  readonly estacao: string | null;
  readonly correlacao: string;
}

export type OrigemCredencialSessao = 'primeiro-login' | 'troca-senha' | 'senha-provisoria';

/**
 * O que o serviço de sessão usa do serviço da identidade (M59-F2): credencial e segundo fator. Tipo estrutural, sem
 * importar o módulo da identidade (fora do boot da F2-L, entra na F2.2).
 */
export interface GanchoIdentidade {
  autenticar(estabelecimento: string, login: string, senha: string): Promise<DesfechoIdentidade>;
  regravar(a: AtorIdentidadeSessao, senha: string, origem?: OrigemCredencialSessao): Promise<boolean>;
  segundoFatorNoLogin(
    estabelecimento: string,
    conta: { readonly login: string; readonly id: number },
    alcance: Alcance2fa,
    codigo: string | undefined,
  ): Promise<Desfecho2faSessao>;
}

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

  /** Login de quem foi recusado (para o log da recusa; nunca a senha nem o resumo). */
  login?: string;

  /** A mesma recusa, marcada com o login (troca de senha: o controlador não conhece o login da sessão). */
  doLogin(login: string): this {
    this.login = login;
    return this;
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
  /**
   * Sessão do ADMINISTRADOR DA PLATAFORMA (decisão do dono 2026-11-20, b): autenticado no banco plataforma, com todas
   * as permissões só no cliente escolhido no login. O `login` do registro é o da plataforma com o prefixo
   * PREFIXO_LOGIN_PLATAFORMA (nunca colide com uma conta do cliente nas chaves de contagem, índice e revogação).
   */
  plataforma?: RegistroPlataforma;
}

/** A marca da sessão do administrador da plataforma (no armazém). */
export interface RegistroPlataforma {
  /** administrador_plataforma.id no banco plataforma. */
  readonly idAdministrador: number;
  /** Cliente escolhido no login (plataforma.cliente.codigo). */
  readonly cliente: string;
  /** credencial.senha_alterada_em (ms) com que a sessão abriu: outra senha derruba a sessão (releitura com cache). */
  senhaAlteradaEm?: number;
}

/** Prazo do cache da releitura da credencial da plataforma (o mesmo das permissões, 3 min). */
const CACHE_SITUACAO_PLATAFORMA_MS = 180_000;

/**
 * Prefixo do login (e do id) da sessão da plataforma. Um usuário do cliente nunca tem ':' no login (esquemaLogin e
 * ck_usuario_login_sem_dois_pontos), e o serviço recusa ':' nas portas do login comum e da gestão de usuários: os
 * espaços das chaves de tentativas, índice, último acesso e revogação ficam separados.
 */
export const PREFIXO_LOGIN_PLATAFORMA = 'plataforma:';

/** Os métodos do segundo fator que a conta escolhe (o mesmo conjunto de codigo-email.ts). */
type MetodoSegundoFatorSessao = 'aplicativo' | 'email';

/** Login do administrador da plataforma sem o prefixo da sessão. */
export function loginPuroPlataforma(login: string): string {
  return login.startsWith(PREFIXO_LOGIN_PLATAFORMA) ? login.slice(PREFIXO_LOGIN_PLATAFORMA.length) : login;
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
   * registro é o usuário do cliente "em nome de quem gravar". Ausente: `como` (a sessão do alvo).
   */
  readonly modo?: 'como' | 'acesso-total';
}

/** Guarda da sessão "como" (servico-como.ts): 'valida' ou 'encerrada'; erro de banco sobe (503). */
export type GuardaComo = (como: RegistroComo, rede: string, estabelecimento: string) => Promise<boolean>;

export interface ConfigServicoSessao {
  readonly janelaReautenticacaoSegundos?: number;
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
  /** Troca e redefinição de senha (argon2id, pelo Executor do núcleo). Sem ela, a troca fica indisponível. */
  readonly senha?: PortaSenha;
  /**
   * Decisão do dono (2026-11-20, b): o login do administrador da plataforma (credencial no banco plataforma). Sem ela,
   * a entrada da plataforma responde indisponível.
   */
  readonly plataforma?: FontePlataforma;
  /**
   * Cliente (banco) desta API: entra em todas as chaves do armazém, como no ServicoAutorizacao. Um banco por cliente;
   * rede, estabelecimentos e logins se repetem entre clientes, e o armazém (Valkey) pode ser comum: sem o cliente,
   * o cookie de um cliente valeria na API de outro. null só na fonte sintética (montar.ts recusa a própria sem ele).
   */
  readonly cliente?: string | null;
  /**
   * modulos-proprios-3 (acesso-ligacao): o segundo fator por código no e-mail, escolhido pela conta ao lado do
   * aplicativo (usuário do cliente e administrador da plataforma). Sem ele, a entrada é a de antes.
   */
  readonly segundoFatorEmail?: GanchoSegundoFatorEmail;
}

/**
 * Forma do login nas chaves de contagem, índice e revogação: a mesma igualdade da colação do banco do cliente
 * (utf8mb4_uca1400_ai_ci: sem distinguir maiúsculas nem acentos, espaços à direita ignorados). Assim 'admin',
 * 'Admin', 'ADMIN' e 'ádmin', que dão a mesma conta no banco, somam no mesmo contador. Compatibilidade (NFKD), sem
 * marcas, letras com traço que a colação iguala à base e dobra de caixa (maiúsculas e depois minúsculas: 'ß' = 'ss').
 */
export function chaveDoLogin(login: string): string {
  return login
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .replace(/[ħĦ]/g, 'h')
    .replace(/[ŧŦ]/g, 't')
    .replace(/ı/g, 'i')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .toUpperCase()
    .toLowerCase()
    .replace(/\s+$/u, '');
}

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
/** Cache da política (politica_senha) por rede:estabelecimento (ficha §4: 5 min). */
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
  private readonly bloqueioPortaSegundos: number;
  private readonly autorizacao: ServicoAutorizacao | null;
  private readonly trilha: RegistradorTrilha | null;
  private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void;
  private readonly guardaComo: GuardaComo | null;
  private readonly reautenticarAtor: ConfigServicoSessao['reautenticarAtor'] | null;
  private readonly aoEncerrarComo: ConfigServicoSessao['aoEncerrarComo'] | null;
  private readonly identidade: GanchoIdentidade | null;
  private readonly portaSenha: PortaSenha | null;
  private readonly cliente: string | null;
  private readonly plataforma: FontePlataforma | null;
  private readonly segundoFatorEmail: GanchoSegundoFatorEmail | null;

  constructor(
    private readonly fonte: FonteAcesso,
    private readonly armazem: ArmazemSessao,
    private readonly agora: () => number = () => Date.now(),
    config: ConfigServicoSessao = {},
  ) {
    this.janela = config.janelaReautenticacaoSegundos ?? JANELA_REAUTENTICACAO_PADRAO_SEGUNDOS;
    this.bloqueioPortaSegundos = config.bloqueioPortaSegundos ?? BLOQUEIO_PORTA_PADRAO_MINUTOS * 60;
    this.autorizacao = config.autorizacao ?? null;
    this.trilha = config.trilha ?? null;
    this.aviso = config.aviso ?? (() => undefined);
    this.guardaComo = config.guardaComo ?? null;
    this.reautenticarAtor = config.reautenticarAtor ?? null;
    this.aoEncerrarComo = config.aoEncerrarComo ?? null;
    this.identidade = config.identidade ?? null;
    this.portaSenha = config.senha ?? null;
    this.cliente = config.cliente ?? null;
    this.plataforma = config.plataforma ?? null;
    this.segundoFatorEmail = config.segundoFatorEmail ?? null;
  }

  /**
   * O segundo fator por código no e-mail, depois da senha conferida. Sem código: envia um novo e pede (401 com o
   * código segundo-fator-email). Com código: confere (uso único, tentativas limitadas). Devolve verdadeiro quando o
   * e-mail é o método da conta (o do aplicativo não é pedido); falso, segue o fluxo de antes.
   */
  private async conferirSegundoFatorEmail(
    alvo: { rede: string; estabelecimento: string; login: string },
    metodo: () => Promise<MetodoSegundoFatorSessao | null>,
    emitir: () => Promise<{ validadeMinutos: number }>,
    conferir: (codigo: string) => Promise<'ok' | 'invalido' | 'esgotado'>,
    codigo: string | undefined,
    origem: OrigemPedido,
  ): Promise<boolean> {
    if (!this.segundoFatorEmail) return false;
    let escolhido: MetodoSegundoFatorSessao | null;
    try {
      escolhido = await metodo();
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    if (escolhido !== 'email') return false;
    try {
      if (!codigo) {
        const { validadeMinutos } = await emitir();
        throw new ErroSessao(
          'segundo-fator-necessario',
          `Enviamos um código de 6 dígitos ao seu e-mail. Ele vale por ${validadeMinutos} minutos.`,
          'segundo-fator-email',
        );
      }
      const d = await conferir(codigo);
      if (d === 'ok') return true;
      await this.registrar(EVENTOS_AUDITAVEIS.loginFalho.codigo, alvo, origem, false, 'falha');
      throw d === 'esgotado'
        ? new ErroSessao(
            'segundo-fator-necessario',
            'O código venceu ou as tentativas acabaram. Entre de novo para receber outro código.',
            'segundo-fator-email-esgotado',
          )
        : new ErroSessao(
            'segundo-fator-necessario',
            'Código do segundo fator inválido.',
            'segundo-fator-invalido',
          );
    } catch (e) {
      if (e instanceof ErroSessao) throw e;
      if (e instanceof ErroCodigoEmail && e.codigo === 'muitos-envios')
        throw new ErroSessao('muitas-tentativas', e.message, 'segundo-fator-email-envios');
      if (e instanceof ErroCodigoEmail && e.codigo === 'sem-email')
        throw new ErroSessao('segundo-fator-necessario', e.message, 'segundo-fator-sem-email');
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
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
    r: Pick<Registro, 'rede' | 'estabelecimento' | 'login'> & {
      como?: RegistroComo | undefined;
      plataforma?: RegistroPlataforma | undefined;
    },
  ): Promise<Autorizacao | null> {
    // ADR 0022: acesso total da plataforma: todas as permissões, sem ler o legado do "em nome de".
    if (r.como?.modo === 'acesso-total') return autorizacaoAcessoTotal(this.agora());
    // Decisão do dono (b): o administrador da plataforma pode tudo, só no cliente escolhido no login (que tem de ser o
    // desta API; outro, ou API sem cliente: recusa, falha fechada).
    if (r.plataforma) {
      try {
        return autorizacaoDoAtorPlataforma(
          {
            tipo: 'plataforma',
            idAdministrador: r.plataforma.idAdministrador,
            nomeExibicao: '',
            cliente: r.plataforma.cliente,
          },
          this.cliente ?? '',
          this.agora(),
        );
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
    }
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

  /** Prefixo de todas as chaves do armazém: cliente e rede (um cliente nunca lê a chave de outro). */
  private pre(rede: string): string {
    return `${this.cliente ?? '-'}:${rede}`;
  }

  private chaveSessao(rede: string, id: string): string {
    return `${this.pre(rede)}:${PREFIXO_SESSAO}:${id}`;
  }
  /**
   * M10: marca de revogação das sessões de uma conta (bloqueio, redefinição). Por conta no cliente inteiro: a
   * credencial vale em todos os estabelecimentos do cliente.
   */
  private chaveRevogacao(rede: string, login: string): string {
    return `${this.pre(rede)}:${PREFIXO_SESSAO}-revogadas:${chaveDoLogin(login)}`;
  }
  /** M10: índice das sessões de uma conta, em todos os estabelecimentos do cliente. */
  private chaveIndice(rede: string, login: string): string {
    return `${this.pre(rede)}:${PREFIXO_SESSAO}-usuario:${chaveDoLogin(login)}`;
  }
  /**
   * Tentativas por conta no cliente, sem o estabelecimento (a credencial é uma só para o cliente) e pela forma do
   * login igual à da colação: nem outro estabelecimento nem outra grafia do login dão rodada nova.
   */
  private chaveTentativas(rede: string, login: string): string {
    return `${this.pre(rede)}:${PREFIXO_TENTATIVAS}:${chaveDoLogin(login)}`;
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
      await this.armazem.apagar(`${this.pre(rede)}:${PREFIXO_POLITICA}:${estabelecimento}`);
    } catch {
      // o cache vence sozinho em 5 min
    }
  }

  /** W1-01 (parte 5): a política lida (politica_senha e a camada complementar), para a tela da política. */
  configDoEstabelecimento(rede: string, estabelecimento: string): Promise<ConfigLogin> {
    return this.politica(rede, estabelecimento);
  }

  /** Política (politica_senha) com cache de 5 min no armazém, por rede:estabelecimento. */
  private async politica(rede: string, estabelecimento: string): Promise<ConfigLogin> {
    const chave = `${this.pre(rede)}:${PREFIXO_POLITICA}:${estabelecimento}`;
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
              conta: {
                login: c.login,
                id: c.id,
                nomeExibicao: c.nomeExibicao,
                ativo: c.ativo,
                bloqueado: c.bloqueado,
                senhaAlteradaEm: c.senhaAlteradaEm,
                semCifra: false,
                trocaObrigatoria: false,
              },
            },
            pelaForte: true,
            provisoria: f.provisoria === true,
          };
        }
      }
      const auth = await this.fonte.autenticar(estabelecimento, login, senha);
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
    // ':' é do espaço da plataforma (nenhum usuário do cliente o tem): nem conta tentativa na chave de outro ator.
    if (login.includes(':')) throw new ErroSessao('credencial-invalida', 'Usuário ou senha inválidos.');
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    if (!this.estabelecimentoDisponivel(estabelecimento)) {
      throw new ErroSessao('estabelecimento-invalido', 'Escolha um estabelecimento disponível.');
    }
    const config = await this.politica(rede, estabelecimento);
    const chaveTent = this.chaveTentativas(rede, login);
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
    // A troca obrigatória da credencial (senha provisória dada pelo gestor, pela recuperação ou pelo semeador) abre a
    // sessão só para trocar a senha; a do serviço da identidade (origem senha-provisoria) também.
    const trocaSenha: Sessao['trocaSenha'] =
      conta.trocaObrigatoria || provisoria ? 'senha-provisoria' : expirada ? 'senha-expirada' : null;

    // Código no e-mail (método escolhido pela conta): confere dentro da abertura, DEPOIS da política do perfil. Ele
    // substitui o do aplicativo só quando a política deixa entrar sem o código do aplicativo (sem fator do aplicativo
    // ativo e fora da exigência vencida); senão vale o aplicativo, como antes (o e-mail nunca rebaixa o fator).
    const email = (): Promise<boolean> =>
      this.conferirSegundoFatorEmail(
        { rede, estabelecimento, login: conta.login },
        () => this.segundoFatorEmail!.metodoUsuario(rede, estabelecimento, conta.login),
        () => this.segundoFatorEmail!.emitirUsuario(rede, estabelecimento, conta.login),
        (c) => this.segundoFatorEmail!.conferirUsuario(rede, estabelecimento, conta.login, c),
        entrada.codigoSegundoFator,
        origem,
      );
    // M59-F2: o segundo fator confere dentro da abertura (precisa do perfil); a tentativa só é apagada depois dele.
    const r = await this.abrirSessao(
      rede,
      estabelecimento,
      conta,
      dados,
      trocaSenha,
      falhasAntes,
      origem,
      this.segundoFatorEmail
        ? { codigo: entrada.codigoSegundoFator, email }
        : { codigo: entrada.codigoSegundoFator },
    );
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
   * Decisão do dono (2026-11-20, b): entrada do ADMINISTRADOR DA PLATAFORMA. A credencial é a do banco plataforma
   * (argon2id); o cliente é o escolhido no login ou, sem escolha, o único que esta API atende. Esta API atende um
   * cliente (CLIENTE_PADRAO): outro cliente é recusado (a escolha entre vários clientes no mesmo endereço é da F2.2).
   * A sessão abre no estabelecimento escolhido, com todas as permissões; a senha inicial ou redefinida abre só para a
   * troca. Mesma porta da entrada comum: contagem de tentativas, trilha obrigatória, identificador novo.
   */
  async entrarPlataforma(
    entrada: {
      estabelecimento: string;
      login: string;
      senha: string;
      cliente?: string | undefined;
      codigoSegundoFator?: string | undefined;
    },
    redeDoEndereco: string | null,
    idAnterior: string | null = null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    const fonte = this.plataforma;
    if (!fonte || !this.cliente)
      throw new ErroSessao('indisponivel', 'A entrada da plataforma não está disponível neste endereço.');
    const { estabelecimento, senha } = entrada;
    // O contrato já recusa fora de [a-z0-9._-] e passa a minúsculas; aqui de novo (a porta não confia no chamador).
    const loginPuro = entrada.login.toLowerCase();
    if (!/^[a-z0-9._-]{1,80}$/.test(loginPuro))
      throw new ErroSessao('credencial-invalida', 'Usuário ou senha inválidos.');
    const login = `${PREFIXO_LOGIN_PLATAFORMA}${loginPuro}`;
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    if (!this.estabelecimentoDisponivel(estabelecimento)) {
      throw new ErroSessao('estabelecimento-invalido', 'Escolha um estabelecimento disponível.');
    }
    const config = await this.politica(rede, estabelecimento);
    const chaveTent = this.chaveTentativas(rede, login);
    const falhasAntes = await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));
    // Sem escolha: o cliente desta API ("há um só"). Escolha de outro cliente: recusada depois da senha conferida.
    const cliente = entrada.cliente ?? this.cliente;
    let auth: Awaited<ReturnType<FontePlataforma['autenticar']>>;
    try {
      auth = await fonte.autenticar(loginPuro, senha, cliente);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
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
    if (auth.desfecho === 'cliente-indisponivel' || auth.ator.cliente !== this.cliente) {
      throw new ErroSessao(
        'estabelecimento-invalido',
        'O cliente escolhido não está disponível neste endereço.',
      );
    }
    const ator = auth.ator;
    await this.conferirSegundoFatorEmail(
      { rede, estabelecimento, login },
      () => this.segundoFatorEmail!.metodoPlataforma(ator.idAdministrador),
      () => this.segundoFatorEmail!.emitirPlataforma(ator.idAdministrador, origem.correlacao),
      (c) => this.segundoFatorEmail!.conferirPlataforma(ator.idAdministrador, c, origem.correlacao),
      entrada.codigoSegundoFator,
      origem,
    );
    const dados: DadosSessao = {
      papeis: [],
      unidades: [],
      termo: { vigente: false, aceitoEm: null, periodico: false, quantidadePeriodo: null, tipoPeriodo: null },
      config,
    };
    const r = await this.abrirSessao(
      rede,
      estabelecimento,
      // O id não é numérico: nenhum consumidor de usuario.id o toma por um usuário do cliente.
      { login, id: `${PREFIXO_LOGIN_PLATAFORMA}${ator.idAdministrador}`, nomeExibicao: ator.nomeExibicao },
      dados,
      ator.trocaObrigatoria ? 'senha-provisoria' : null,
      falhasAntes,
      origem,
      undefined,
      'forte',
      {
        idAdministrador: ator.idAdministrador,
        cliente: ator.cliente,
        ...(ator.senhaAlteradaEm !== undefined ? { senhaAlteradaEm: ator.senhaAlteradaEm } : {}),
      },
    );
    await this.armazem.apagar(chaveTent);
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

  /**
   * 01-ADM L61: entrada pelo provedor de identidade do hospital (login único). O provedor conferiu só a identidade; a
   * conta local segue as regras dela (EXIGENCIAS_ENTRADA_EXTERNA do domínio): conta bloqueada, inativa ou fora de grupo
   * não entra, a tentativa é contada (o bloqueio por excesso vale) e o segundo fator da política é pedido como na senha.
   */
  async entrarPorProvedorExterno(
    entrada: { estabelecimento: string; login: string; codigoSegundoFator?: string | undefined },
    redeDoEndereco: string | null,
    idAnterior: string | null = null,
    origem: OrigemPedido = ORIGEM_SERVIDOR,
  ): Promise<ResultadoLogin> {
    const rede = this.conferirRede(redeDoEndereco);
    if (idAnterior) await this.descartarAnterior(rede, idAnterior);
    const config = await this.politica(rede, entrada.estabelecimento);
    const chaveTent = this.chaveTentativas(rede, entrada.login);
    const falhasAntes = await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));
    const conta = await this.conferirAlvoComo(entrada.estabelecimento, entrada.login, redeDoEndereco);
    let dados: DadosSessao;
    try {
      dados = await this.fonte.dadosDeSessao(entrada.estabelecimento, conta.login, config);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    const r = await this.abrirSessao(rede, entrada.estabelecimento, conta, dados, null, falhasAntes, origem, {
      codigo: entrada.codigoSegundoFator,
    });
    await this.armazem.apagar(chaveTent);
    return r;
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
    segundoFator?: { readonly codigo: string | undefined; readonly email?: () => Promise<boolean> },
    /** W1-01 (parte 11b2): 'forte' (senha ou certificado: conta para a troca rápida) ou 'pin' (troca rápida). */
    entradaPor: 'forte' | 'pin' = 'forte',
    /** Decisão do dono (b): a sessão do administrador da plataforma (todas as permissões no cliente escolhido). */
    plataforma?: RegistroPlataforma,
  ): Promise<ResultadoLogin> {
    const chaveUltimo = `${this.pre(rede)}:${PREFIXO_ULTIMO_ACESSO}:${estabelecimento}:${conta.login}`;
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
      ...(plataforma ? { plataforma } : {}),
    };
    const aut = await this.autorizacaoDe(registro);
    if (segundoFator && this.identidade) {
      // O código no e-mail cumpre a exigência só onde a política deixaria entrar sem o código do aplicativo.
      const previa = segundoFator.email ? await this.previaSegundoFator(registro, aut) : null;
      if (previa?.tipo === 'entrar' && (await segundoFator.email!())) registro.segundoFator = previa.info;
      else {
        const info = await this.conferirSegundoFator(registro, aut, segundoFator.codigo, origem);
        if (info) registro.segundoFator = info;
      }
    } else if (segundoFator?.email) {
      // Sem o serviço da identidade não há política do aplicativo: vale o método escolhido pela conta.
      await segundoFator.email();
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

  /** A política do segundo fator do aplicativo SEM código (só leitura): 'entrar' quando ela não pede o aplicativo. */
  private async previaSegundoFator(
    r: Registro,
    aut: Autorizacao | null,
  ): Promise<Awaited<ReturnType<GanchoIdentidade['segundoFatorNoLogin']>>> {
    try {
      return await this.identidade!.segundoFatorNoLogin(
        r.estabelecimento,
        { login: r.login, id: Number(r.idUsuario) },
        {
          perfil: aut?.perfil?.perfil ?? null,
          complementares: aut?.perfil?.complementares ?? [],
          grupo: aut?.grupo ?? null,
        },
        undefined,
      );
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
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
    return `${this.pre(rede)}:${PREFIXO_LOGIN_FORTE}:${estabelecimento}:${login}`;
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
    const revogadoEm = await this.armazem.obter(this.chaveRevogacao(r.rede, r.login));
    if (revogadoEm !== null && Number(revogadoEm) >= r.criadaMs) {
      await this.armazem.apagar(chave);
      if (r.como) await this.encerrarComo(r.como, 'revogada');
      return null;
    }
    // Decisão do dono (b): a credencial da plataforma é relida (cache curto): administrador desativado, removido ou
    // com outra senha (trocada em outra sessão ou redefinida) derruba a sessão. Erro de banco: 503, nunca libera.
    if (r.plataforma && !(await this.plataformaVigente(r.plataforma))) {
      await this.armazem.apagar(chave);
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
      ? `${this.pre(rede)}:${PREFIXO_TENTATIVAS}:como:${r.como.idConta}`
      : this.chaveTentativas(rede, r.login);
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
    } else if (r.plataforma) {
      // Decisão do dono (b): a senha do administrador da plataforma (banco plataforma), nunca uma do cliente.
      if (!(await this.conferirPlataforma(r.plataforma, senha)))
        throw new ErroSessao('credencial-invalida', 'Senha inválida.');
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

  /** A troca de senha está disponível (porta de senha montada). */
  /**
   * As regras da política de senha vigente para a sessão (a do estabelecimento, ou a padrão do produto para o
   * administrador da plataforma), para a tela mostrar antes de digitar e conferir ao vivo. Traz o login (sem prefixo)
   * contra o qual a regra "não conter o login" é conferida. Nenhuma senha.
   */
  async regrasSenha(
    id: string,
    redeDoEndereco: string | null,
  ): Promise<{ login: string; regras: RegraPoliticaSenha[] }> {
    const rede = this.conferirRede(redeDoEndereco);
    const r = await this.carregarAtiva(rede, id);
    if (r.plataforma)
      return {
        login: loginPuroPlataforma(r.login),
        regras: regrasDaPolitica(politicaEfetiva(CONFIG_LOGIN_PADRAO.senha, CONFIG_LOGIN_PADRAO.sante)),
      };
    const config = await this.politica(rede, r.estabelecimento);
    return { login: r.login, regras: regrasDaPolitica(politicaEfetiva(config.senha, config.sante)) };
  }

  get trocaSenhaDisponivel(): boolean {
    return this.portaSenha !== null;
  }

  /**
   * W1-01: troca a própria senha. A senha atual conferida vale como reautenticação (conta no limite de tentativas);
   * a nova passa pela política efetiva (politica_senha + mínimos do produto) e pelo reuso (atual e historico_senha na
   * janela); grava o resumo argon2id pela porta de senha (credencial_usuario e historico_senha na mesma transação do
   * Executor, com a trilha) e regrava a credencial do serviço da identidade, quando houver. Nenhuma senha, resumo ou sal sai daqui (só os códigos das falhas).
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
    if (r.plataforma) return this.trocarSenhaPlataforma(r, rede, id, entrada, origem);
    const porta = this.portaSenha;
    if (!porta)
      throw new ErroSessao(
        'troca-indisponivel',
        'A troca de senha ainda não está disponível neste estabelecimento. Procure o administrador do sistema.',
      );
    const config = await this.politica(rede, r.estabelecimento);
    const chaveTent = this.chaveTentativas(rede, r.login);
    await this.contarTentativa(chaveTent, limiteTentativas(config.limiteTentativas));
    const auth = await this.autenticar(r.estabelecimento, r.login, entrada.senhaAtual);
    if (auth.desfecho !== 'ok')
      throw new ErroSessao('credencial-invalida', 'Senha atual inválida.').doLogin(r.login);
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
      let reuso: Awaited<ReturnType<PortaSenha['reuso']>>;
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
      ).doLogin(r.login);

    const resumo = await cifrarSenha(entrada.senhaNova);
    const t = this.agora();
    // Recusa da gravação (ErroOperacao do núcleo) sobe como está: o filtro de problemas a traduz.
    await porta.gravar(r.estabelecimento, r.login, resumo, {
      rede,
      estabelecimento: r.estabelecimento,
      autor: r.login,
      correlacao: origem.correlacao,
      chaveIdempotencia: randomUUID(),
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

  /** Releitura da credencial da plataforma, com cache curto por administrador (o de 3 min das permissões). */
  private readonly situacoesPlataforma = new Map<
    number,
    { situacao: SituacaoAdministradorPlataforma | null; ate: number }
  >();

  private async plataformaVigente(p: RegistroPlataforma): Promise<boolean> {
    if (!this.plataforma) return false;
    const t = this.agora();
    let c = this.situacoesPlataforma.get(p.idAdministrador);
    if (!c || c.ate <= t) {
      let situacao: SituacaoAdministradorPlataforma | null;
      try {
        situacao = await this.plataforma.situacao(p.idAdministrador);
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      c = { situacao, ate: t + CACHE_SITUACAO_PLATAFORMA_MS };
      this.situacoesPlataforma.set(p.idAdministrador, c);
    }
    const s = c.situacao;
    if (!s || !s.ativo) return false;
    return p.senhaAlteradaEm === undefined || s.senhaAlteradaEm === p.senhaAlteradaEm;
  }

  /** Decisão do dono (b): confere a senha do administrador da plataforma (erro de banco: indisponível). */
  private async conferirPlataforma(p: RegistroPlataforma, senha: string): Promise<boolean> {
    if (!this.plataforma) return false;
    try {
      return await this.plataforma.conferir(p.idAdministrador, senha);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
  }

  /**
   * Decisão do dono (b): troca da senha do administrador da plataforma (no banco plataforma). A política é a padrão do
   * produto (a da plataforma; a do estabelecimento é dos usuários do cliente), sem reuso da atual.
   */
  private async trocarSenhaPlataforma(
    r: Registro,
    rede: string,
    id: string,
    entrada: Pick<TrocarSenha, 'senhaAtual' | 'senhaNova'>,
    origem: OrigemPedido,
  ): Promise<Sessao> {
    const p = r.plataforma;
    const fonte = this.plataforma;
    if (!p || !fonte) throw new ErroSessao('troca-indisponivel', 'A troca de senha não está disponível.');
    const chaveTent = this.chaveTentativas(rede, r.login);
    await this.contarTentativa(chaveTent, limiteTentativas(CONFIG_LOGIN_PADRAO.limiteTentativas));
    if (!(await this.conferirPlataforma(p, entrada.senhaAtual)))
      throw new ErroSessao('credencial-invalida', 'Senha atual inválida.').doLogin(
        loginPuroPlataforma(r.login),
      );
    await this.armazem.apagar(chaveTent);
    const politica = politicaEfetiva(CONFIG_LOGIN_PADRAO.senha, CONFIG_LOGIN_PADRAO.sante);
    const loginPuro = loginPuroPlataforma(r.login);
    const falhas = avaliarSenhaNova(entrada.senhaNova, loginPuro, politica, {
      nome: r.nome,
      nascimento: null,
    });
    if (entrada.senhaNova === entrada.senhaAtual) falhas.push('igual-atual');
    if (falhas.length > 0)
      throw new ErroSessao(
        'senha-recusada',
        'A senha nova não cumpre a política de senha.',
        'senha-politica',
        falhas,
      ).doLogin(loginPuro);
    const resumo = await cifrarSenha(entrada.senhaNova);
    let senhaAlteradaEm: number;
    try {
      // Credencial e evento na linha do tempo do cliente (cliente_evento), na mesma transação do banco plataforma.
      senhaAlteradaEm = await fonte.gravarSenha(p.idAdministrador, resumo, origem.correlacao, p.cliente);
    } catch {
      throw new ErroSessao('indisponivel', INDISPONIVEL);
    }
    this.situacoesPlataforma.delete(p.idAdministrador);
    const t = this.agora();
    const bruto = await this.armazem.obter(this.chaveSessao(rede, id));
    const atual = bruto ? (JSON.parse(bruto) as Registro) : r;
    atual.trocaSenha = null;
    atual.autenticadoMs = t;
    atual.ultimaAtividadeMs = t;
    atual.plataforma = { ...p, senhaAlteradaEm };
    await this.salvar(atual);
    // Trilha do cliente (o ator vai como chave natural: o administrador não é usuário do cliente). Sem trilha, a troca
    // já gravada segue (o evento ficou no banco plataforma) e o erro é avisado.
    if (this.trilha) {
      try {
        await this.trilha.registrar({
          evento: EVENTOS_AUDITAVEIS.senhaPlataformaTrocada.codigo,
          rede,
          hospital: atual.estabelecimento,
          usuario: atual.login,
          estacao: origem.estacao,
          correlacao: origem.correlacao,
          recurso: 'acesso.sessao',
          resultado: 'sucesso',
          chaveNaturalAlvo: `${PREFIXO_LOGIN_PLATAFORMA}${p.idAdministrador}`,
        });
      } catch (e) {
        this.aviso('trilha: troca de senha da plataforma não registrada', {
          erro: e instanceof Error ? e.name : 'erro',
        });
      }
    }
    // As outras sessões do administrador nesta API caem já; nas APIs de outros clientes, pela releitura da credencial
    // (senha_alterada_em mudou).
    for (const x of await this.sessoesVivas(rede, null, atual.login)) {
      if (x.id === atual.id || x.plataforma?.idAdministrador !== p.idAdministrador) continue;
      await this.armazem.apagar(this.chaveSessao(rede, x.id));
      await this.registrar(EVENTOS_AUDITAVEIS.fimSessao.codigo, x, origem, false);
    }
    return this.montar(atual, true, await this.autorizacaoDe(atual));
  }

  /**
   * W1-01 (parte 2b): acesso.redefinirSenha. O gestor de acessos (já reautenticado pelo chamador, com a segregação
   * conferida) dá ao usuário `alvo` uma senha PROVISÓRIA gerada aqui: cumpre a política efetiva do estabelecimento e
   * não repete a atual nem o histórico; grava pela porta de senha com troca obrigatória (historico_senha na mesma
   * transação; a trilha do executor guarda o gestor) e regrava a credencial do serviço da identidade com origem
   * `senha-provisoria`, o que obriga a troca no próximo acesso. A senha volta só ao gestor, nesta resposta; nada dela vai a log ou trilha.
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

  /**
   * 01-ADM L57: a senha inicial da conta que o gestor está criando. Gera a provisória pela política efetiva do
   * estabelecimento e devolve a senha (só para a resposta ao gestor) e o resumo argon2id, que a receita
   * acesso.criar_usuario grava na MESMA transação da conta (credencial de troca obrigatória e histórico). A conta ainda
   * não existe: não há atual nem histórico para o reuso.
   */
  async senhaInicialDaConta(
    rede: string,
    estabelecimento: string,
    login: string,
  ): Promise<{ readonly senha: string; readonly resumo: string }> {
    if (!this.portaSenha)
      throw new ErroSessao(
        'troca-indisponivel',
        'A senha inicial ainda não está disponível neste estabelecimento. Procure o administrador do sistema.',
      );
    const configPol = await this.politica(rede, estabelecimento);
    const senha = gerarSenhaProvisoria(politicaEfetiva(configPol.senha, configPol.sante), login, (n) =>
      randomInt(n),
    );
    return { senha, resumo: await cifrarSenha(senha) };
  }

  /**
   * Depois de a conta nascer com a credencial inicial: regrava a credencial do serviço da identidade com origem
   * `senha-provisoria` (troca obrigatória). Sem o serviço, vale o que a receita gravou (troca obrigatória). A falha aqui
   * não desfaz a conta: a credencial do banco já obriga a troca.
   */
  async concluirSenhaInicial(
    rede: string,
    estabelecimento: string,
    login: string,
    idUsuario: number,
    senha: string,
    origem: OrigemPedido,
  ): Promise<boolean> {
    if (!this.identidade) return true;
    try {
      return await this.identidade.regravar(
        {
          rede,
          hospital: estabelecimento,
          login,
          idUsuario,
          estacao: origem.estacao,
          correlacao: origem.correlacao,
        },
        senha,
        'senha-provisoria',
      );
    } catch {
      return true;
    }
  }

  private async gravarSenhaProvisoria(
    gestor: { readonly rede: string; readonly estabelecimento: string; readonly login: string },
    alvo: string,
    origem: OrigemPedido,
    reautenticadoEm: number,
  ): Promise<{ readonly senhaProvisoria: string; readonly trocaObrigatoria: boolean }> {
    const porta = this.portaSenha;
    if (!porta)
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
      let reuso: Awaited<ReturnType<PortaSenha['reuso']>>;
      try {
        reuso = await porta.reuso(estabelecimento, alvo, candidata, desde);
      } catch {
        throw new ErroSessao('indisponivel', INDISPONIVEL);
      }
      if (!reuso) senha = candidata;
    }
    if (!senha) throw new ErroSessao('indisponivel', INDISPONIVEL);
    const resumo = await cifrarSenha(senha);
    const idUsuario = await porta.gravar(
      estabelecimento,
      alvo,
      resumo,
      {
        rede,
        estabelecimento,
        autor: gestor.login,
        correlacao: origem.correlacao,
        chaveIdempotencia: randomUUID(),
        estacao: origem.estacao.slice(0, 80),
        reautenticadoEm,
      },
      'redefinicao',
    );
    // A redefinição grava troca_obrigatoria (porta-senha); sem gancho de identidade, vale o que foi gravado.
    let trocaObrigatoria = idUsuario !== null;
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
    const chave = this.chaveTentativas(rede, login);
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
    // Login com ':' não é de usuário do cliente (é o espaço da plataforma): a gestão do cliente não o alcança.
    if (login.includes(':')) return;
    // A credencial e o bloqueio valem para o cliente inteiro: a revogação cai em todos os estabelecimentos e o cache
    // das permissões é invalidado em cada um (com o login como veio e com o login de cada sessão viva).
    const vivas = await this.sessoesVivas(rede, null, login);
    await this.armazem.gravar(
      this.chaveRevogacao(rede, login),
      String(this.agora()),
      DURACAO_REVOGACAO_SEGUNDOS,
    );
    const alvos = new Map<string, { estabelecimento: string; login: string }>();
    const codigos = new Set([estabelecimento, ...this.fonte.estabelecimentos.map((e) => e.codigo)]);
    for (const codigo of codigos) alvos.set(`${codigo}:${login}`, { estabelecimento: codigo, login });
    for (const x of vivas)
      alvos.set(`${x.estabelecimento}:${x.login}`, { estabelecimento: x.estabelecimento, login: x.login });
    for (const a of alvos.values())
      await this.autorizacao?.invalidar(rede, a.estabelecimento, a.login).catch(() => undefined);
  }

  /**
   * M10: guarda o id da sessão no índice do usuário (o armazém não lista chaves). Informativo: duas entradas ao
   * mesmo tempo podem perder um id no índice, nunca a sessão; as expiradas saem na leitura.
   */
  private async indexar(r: Registro, ttlSegundos: number): Promise<void> {
    const chave = this.chaveIndice(r.rede, r.login);
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
    if (login.includes(':')) return [];
    return (await this.sessoesVivas(rede, estabelecimento, login)).map((r) => ({
      inicio: new Date(r.criadaMs).toISOString(),
      ultimoUso: new Date(r.ultimaAtividadeMs).toISOString(),
      estabelecimento: r.estabelecimento,
      bloqueada: r.bloqueada,
      como: Boolean(r.como),
    }));
  }

  /** As sessões vivas do usuário pelo índice (a mais usada primeiro); limpa do índice as que caíram. */
  private async sessoesVivas(
    rede: string,
    estabelecimento: string | null,
    login: string,
  ): Promise<Registro[]> {
    const chave = this.chaveIndice(rede, login);
    const ids = JSON.parse((await this.armazem.obter(chave)) ?? '[]') as string[];
    const revogadoEm = Number((await this.armazem.obter(this.chaveRevogacao(rede, login))) ?? 0);
    const conta = chaveDoLogin(login);
    const t = this.agora();
    const vivas: Registro[] = [];
    for (const id of ids) {
      const bruto = await this.armazem.obter(this.chaveSessao(rede, id));
      if (!bruto) continue;
      const r = JSON.parse(bruto) as Registro;
      if (chaveDoLogin(r.login) !== conta) continue;
      // Sessão da plataforma só no índice da plataforma, e vice-versa (defesa além do ':' proibido).
      if (Boolean(r.plataforma) !== login.startsWith(PREFIXO_LOGIN_PLATAFORMA)) continue;
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
    // O índice é da conta no cliente inteiro; o filtro do estabelecimento é só da resposta.
    return vivas
      .filter((r) => estabelecimento === null || r.estabelecimento === estabelecimento)
      .sort((a, b) => b.ultimaAtividadeMs - a.ultimaAtividadeMs);
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
   * um perfil ATIVO. Quem chama confere ANTES de registrar a sessão de suporte (login fora da regra
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
      usuario: {
        id: r.idUsuario,
        nome: r.nome,
        login: r.login,
        ...(r.plataforma ? { ator: 'plataforma' as const } : {}),
      },
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
      // Último acesso válido e falhas desde então neste produto (o histórico importado pelo conector é do M15).
      ultimoAcesso: {
        em: r.ultimoAcessoMs === null ? null : new Date(r.ultimoAcessoMs).toISOString(),
        falhasDesde: r.falhasDesde,
      },
      termoPendente: r.termoPendente,
      trocaSenha: r.trocaSenha,
      trocaSenhaPeloNovo: r.plataforma ? this.plataforma !== null : this.trocaSenhaDisponivel,
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
