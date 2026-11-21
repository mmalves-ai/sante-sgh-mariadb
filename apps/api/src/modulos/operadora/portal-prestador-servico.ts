// Portal do prestador credenciado da operadora própria (M56, etapa 8, F7; ficha, seção 7; cap-07 §7.6, "Regras";
// cap-08 §8.3.5): um domínio de identidade separado dos usuários internos e do portal de resultados do hospital (a
// operadora é empresa distinta, regra 3). A conta (conta_portal_prestador) é criada pelo credenciamento com o código de
// ativação de uso único; o responsável no prestador ativa com o código, a senha própria (Argon2id) e o segundo fator
// (TOTP, segredo cifrado pelo servidor) e entra com o e-mail, a senha e o código do aplicativo, com o limite de taxa por
// origem e o bloqueio depois das tentativas erradas. A sessão do portal é própria (cookie HttpOnly e CSRF por token
// duplo), expira sozinha e nunca vale nas telas internas: dá a permissão `operadora.portal.acessar` só às funções que o
// credenciamento liberou, sempre sobre o prestador da conta (nada vem da tela sobre quem é o prestador). Tudo exige a
// chave `operadora.portalPrestador`; pedir e cancelar autorização exigem também a `operadora.autorizacao`.
import { randomBytes } from 'node:crypto';
import {
  type AbrirProtocoloPortalEntrada,
  type ApoioPortalPrestador,
  type AtivarPortalPrestadorEntrada,
  type AutorizacaoPortal,
  CHAVE_OPERADORA_ATENDIMENTO,
  CHAVE_OPERADORA_AUTORIZACAO,
  CHAVE_OPERADORA_PORTAL_PRESTADOR,
  type ChaveOperadora,
  type ComplementoPortal,
  type ConsultarElegibilidadePortalEntrada,
  type ConsultasElegibilidadePortal,
  type ElegibilidadePortal,
  type MotivoInelegibilidade,
  type EntrarPortalPrestadorEntrada,
  EVENTOS_AUDITAVEIS,
  FUNCAO_PORTAL,
  MENSAGENS_ATENDIMENTO,
  MENSAGENS_TROCA_CREDENCIAL,
  ROTULOS_SITUACAO_PROTOCOLO,
  type ProtocoloPortal,
  type RegistrarAutorizacaoEntrada,
  type ResponderComplementoPortalEntrada,
  type ResponderInteracaoPortalEntrada,
  type ResultadoInteracaoPortal,
  type ResultadoProtocoloPortalAberto,
  type ResultadoComplementoPortal,
  type ResultadoAutorizacao,
  type AutenticadorNovoPortalPrestador,
  type IniciarAutenticadorPortalPrestadorEntrada,
  type SessaoPortalPrestador,
  type SituacaoProtocoloOpe,
  type TrocarSenhaPortalPrestadorEntrada,
} from '@sgh/contratos';
import {
  cifrarSegredo,
  cifrarSenha,
  conferirSenha,
  decifrarSegredo,
  gerarSegredoBase32,
  uriOtpauth,
  verificarTotp,
} from '@sgh/dominio-acesso';
import {
  acessoBloqueado,
  avaliarElegibilidade,
  carteirinhaValida,
  coberturaPorAtendimento,
  depoisDaTentativaPortal,
  funcoesDoTexto,
  iniciaisDoNome,
  PARAMETROS_PORTAL_PRESTADOR,
  protocoloAtendimento,
} from '@sgh/dominio-operadora';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import type { PortaAtendimentoOperadora } from './atendimento-porta.js';
import {
  type DadosAcessoPortalParaEntrada,
  type DadosAutorizacao,
  type DadosAutorizacaoResumo,
  SITUACOES_RESPOSTA_PRESTADOR,
} from './dados-portas.js';
import {
  recusaDoAtendimento,
  rotuloDaGuia,
  ServicoAtendimentoOperadora,
  sha256,
} from './atendimento-servico.js';
import type { ContextoAutorizacao, PortaAutorizacaoOperadora } from './autorizacao-porta.js';
import { rotulosDaAutorizacao, ServicoAutorizacaoOperadora } from './autorizacao-servico.js';

export const SERVICO_PORTAL_PRESTADOR = Symbol('SERVICO_PORTAL_PRESTADOR');
export const USUARIO_PORTAL_PRESTADOR = 'SGH.PORTAL.PRESTADOR';
const TAXA_POR_MINUTO = 10;
/** W0-10: o novo autenticador pedido vale 10 minutos, só na sessão que o pediu, com até 5 códigos errados. */
const MINUTOS_AUTENTICADOR_NOVO = 10;
const ERROS_AUTENTICADOR_NOVO = 5;
const TABELA = 'conta_portal_prestador';
const E = EVENTOS_AUDITAVEIS;
/** Origem do atendimento do pedido feito pelo portal (código 4, "Portal autorizador"). */
export const ORIGEM_PORTAL = 4;

export interface SessaoPortalPrestadorInterna {
  readonly id: string;
  readonly csrf: string;
  readonly hospital: string;
  readonly acesso: number;
  readonly operadora: number;
  readonly prestador: number;
  readonly prestadorNome: string;
  readonly login: string;
  readonly nome: string;
  readonly funcoes: readonly number[];
  readonly expira: number;
}

export interface EntradaPortalPrestador {
  readonly id: string;
  readonly csrf: string;
  readonly ttlSegundos: number;
  readonly sessao: SessaoPortalPrestador;
}

const credencialInvalida = (): never => {
  throw new ErroProblema(
    'nao-autenticado',
    401,
    'Dados de acesso inválidos',
    'Confira os dados de acesso e tente de novo. Depois de várias tentativas erradas, o acesso fica bloqueado por alguns minutos.',
  );
};

const prestadorDescredenciado = (): ErroProblema =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Credenciamento encerrado',
    MENSAGENS_ATENDIMENTO['prestador-descredenciado'],
    { codigo: 'prestador-descredenciado' },
  );

const iso = (d: Date) => {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

export class ServicoPortalPrestador {
  private readonly sessoes = new Map<string, SessaoPortalPrestadorInterna>();
  private readonly taxa = new Map<string, number[]>();
  /** W0-10: o segredo do autenticador novo à espera da confirmação, por sessão (nunca vai ao banco antes dela). */
  private readonly autenticadoresNovos = new Map<
    string,
    { segredo: string; validoAte: number; erros: number }
  >();
  readonly autorizacao: ServicoAutorizacaoOperadora;

  constructor(
    private readonly porta: PortaAtendimentoOperadora,
    private readonly autorizacoes: PortaAutorizacaoOperadora,
    private readonly situacoes: ServicoSituacaoOperadora,
    private readonly rede: string,
    private readonly chaveMestra: Buffer | null,
    private readonly produto: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.autorizacao = new ServicoAutorizacaoOperadora(autorizacoes);
  }

  /** O contexto das portas: o estabelecimento por id; a conta do portal não é usuário interno (usuário nulo). */
  private c(hospital: string): ContextoPorta {
    return {
      ...contextoDoEstabelecimento(hospital),
      usuario: null,
      correlacao: `portal-prestador-${randomBytes(6).toString('hex')}`,
      rede: this.rede,
      hospital,
    };
  }

  private async exigirLigado(hospital: string, chave: ChaveOperadora = CHAVE_OPERADORA_PORTAL_PRESTADOR) {
    await this.situacoes.exigir(
      { rede: this.rede, hospital, login: USUARIO_PORTAL_PRESTADOR, setor: null },
      chave,
    );
  }

  private conferirTaxa(ip: string): void {
    const agora = this.agora().getTime();
    const lista = (this.taxa.get(ip) ?? []).filter((x) => agora - x < 60_000);
    if (lista.length >= TAXA_POR_MINUTO)
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitas tentativas',
        'Aguarde um minuto antes de tentar de novo.',
      );
    lista.push(agora);
    this.taxa.set(ip, lista);
  }

  private trilha(
    hospital: string,
    evento: string,
    idAlvo: string,
    resultado: 'sucesso' | 'falha',
    ip: string,
    tabela = TABELA,
  ): RegistroTrilhaTela {
    return {
      estabelecimento: contextoDoEstabelecimento(hospital).estabelecimento,
      usuario: null,
      acao: 'operacao',
      entidade: tabela,
      entidadeId: /^\d{1,15}$/.test(idAlvo) ? Number(idAlvo) : null,
      dadosDepois: {
        evento,
        recurso: CHAVE_OPERADORA_PORTAL_PRESTADOR,
        operacao: evento,
        usuario: USUARIO_PORTAL_PRESTADOR,
        resultado,
        estacao: ip.slice(0, 80),
      },
      correlacao: `portal-prestador-${randomBytes(6).toString('hex')}`,
    };
  }

  /** A ativação com o código de uso único: a senha e o segredo do segundo fator; o URI do autenticador sai uma vez. */
  async ativar(
    hospital: string,
    e: AtivarPortalPrestadorEntrada,
    ip: string,
  ): Promise<{ otpauth: string; mensagem: string }> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    if (!this.chaveMestra)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Ativação indisponível',
        'O cadastro do segundo fator não está configurado neste ambiente.',
      );
    const resumo = sha256(e.codigo);
    const a = await this.porta.acessoParaEntrada(this.c(hospital), { ativacaoResumo: resumo });
    const agora = iso(this.agora());
    if (
      !a ||
      a.login !== e.login ||
      a.situacao !== 'pendente' ||
      !a.ativacaoValidaAte ||
      a.ativacaoValidaAte <= agora
    )
      throw recusaDoAtendimento([{ codigo: 'ativacao-invalida', campo: 'codigo' }]);
    const segredo = gerarSegredoBase32();
    const senhaResumo = await cifrarSenha(e.senha);
    await this.porta.gravar(
      this.c(hospital),
      this.trilha(hospital, E.operadoraPortalAtivado.codigo, String(a.id), 'sucesso', ip),
      (g) =>
        g.ativarAcesso({
          id: a.id,
          ativacaoResumo: resumo,
          senhaResumo,
          segundoFator: cifrarSegredo(segredo, this.chaveMestra as Buffer),
          usuario: USUARIO_PORTAL_PRESTADOR,
        }),
    );
    return {
      otpauth: uriOtpauth(a.login, this.produto, segredo),
      mensagem:
        'Acesso ativado. Cadastre o código no aplicativo autenticador agora: ele não aparece de novo. Depois, entre com o e-mail, a senha e o código do aplicativo.',
    };
  }

  private segundoFatorConfere(envelope: string | null, codigo: string): boolean {
    if (!this.chaveMestra || !envelope) return false;
    try {
      return verificarTotp(decifrarSegredo(envelope, this.chaveMestra), codigo, this.agora().getTime());
    } catch {
      return false;
    }
  }

  async entrar(
    hospital: string,
    e: EntrarPortalPrestadorEntrada,
    ip: string,
  ): Promise<EntradaPortalPrestador> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const a = await this.porta.acessoParaEntrada(this.c(hospital), { login: e.login });
    // A senha é conferida mesmo sem conta (tempo constante: não revela se o e-mail tem acesso).
    const senhaOk = await conferirSenha(e.senha, a?.senhaResumo ?? null);
    const fatorOk = this.segundoFatorConfere(a?.segundoFator ?? null, e.codigo);
    if (!a || a.situacao !== 'ativo') return credencialInvalida();
    const agora = iso(this.agora());
    // Bloqueada, a conta responde como credencial inválida (não revela que o e-mail tem acesso nem se a senha confere).
    if (acessoBloqueado(a.bloqueadoAte, agora)) return credencialInvalida();
    const acertou = senhaOk && fatorOk;
    // O credenciamento vale a cada entrada (a conta pode seguir ativa depois do descredenciamento).
    if (acertou && !(await this.prestadorCredenciado(hospital, a.prestador))) throw prestadorDescredenciado();
    // O banco decide o contador (soma atômica; no limite, bloqueia e zera): pedidos simultâneos não se perdem.
    const r = await this.porta.gravar(
      this.c(hospital),
      this.trilha(hospital, E.operadoraPortalEntrada.codigo, String(a.id), acertou ? 'sucesso' : 'falha', ip),
      (g) =>
        g.tentativaPortal({
          id: a.id,
          acertou,
          agora,
          limite: PARAMETROS_PORTAL_PRESTADOR.tentativas,
          bloqueioAte: depoisDaTentativaPortal(PARAMETROS_PORTAL_PRESTADOR.tentativas - 1, false, agora)
            .bloqueadoAte as string,
        }),
    );
    // Nenhuma linha alterada: a conta deixou de estar ativa (ou foi bloqueada) entre a leitura e a gravação.
    if (r.alteradas !== 1) return credencialInvalida();
    if (!acertou) return credencialInvalida();
    const minutos = PARAMETROS_PORTAL_PRESTADOR.minutosSessao;
    const id = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const expira = this.agora().getTime() + minutos * 60_000;
    const s: SessaoPortalPrestadorInterna = {
      id,
      csrf,
      hospital,
      acesso: a.id,
      operadora: a.operadora,
      prestador: a.prestador,
      prestadorNome: a.prestadorNome,
      login: a.login,
      nome: a.nome,
      funcoes: funcoesDoTexto(a.funcoes),
      expira,
    };
    this.sessoes.set(id, s);
    return { id, csrf, ttlSegundos: minutos * 60, sessao: this.eu(s) };
  }

  /** A sessão viva do portal (e o CSRF por token duplo nas que mudam estado); a conta tem de seguir ativa. */
  sessao(
    id: string | null,
    csrf?: { cookie: string | null; cabecalho: string | null },
  ): SessaoPortalPrestadorInterna {
    const s = id ? this.sessoes.get(id) : undefined;
    if (!s || s.expira < this.agora().getTime()) {
      if (id) this.sessoes.delete(id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'Entre de novo no portal.',
      );
    }
    if (csrf && (!csrf.cookie || csrf.cookie !== csrf.cabecalho || csrf.cabecalho !== s.csrf))
      throw new ErroProblema('sem-permissao', 403, 'Requisição não autenticada (CSRF)');
    return s;
  }

  sair(id: string | null): void {
    if (id) {
      this.sessoes.delete(id);
      this.autenticadoresNovos.delete(id);
    }
  }

  eu(s: SessaoPortalPrestadorInterna): SessaoPortalPrestador {
    return {
      nome: s.nome,
      prestador: s.prestador,
      prestadorNome: s.prestadorNome,
      operadora: s.operadora,
      funcoes: [...s.funcoes],
      expiraEm: new Date(s.expira).toISOString(),
    };
  }

  /** O prestador da conta segue credenciado (a saída agendada vale até a data efetiva, como na rede). */
  private async prestadorCredenciado(hospital: string, prestador: number): Promise<boolean> {
    const p = await this.porta.prestador(this.c(hospital), prestador);
    return !!p && p.situacao === 'credenciado';
  }

  /** A conta segue ativa e com a função liberada (o credenciamento pode ter encerrado ou mudado depois da entrada). */
  private async exigirFuncao(s: SessaoPortalPrestadorInterna, funcao: number): Promise<void> {
    const a = await this.exigirConta(s);
    if (!funcoesDoTexto(a.funcoes).includes(funcao))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Função não liberada',
        'Esta função do portal não está liberada para o seu acesso.',
        { codigo: 'funcao-nao-liberada' },
      );
  }

  /** A conta da sessão segue ativa e o prestador credenciado (senão a sessão cai). */
  private async exigirConta(s: SessaoPortalPrestadorInterna) {
    await this.exigirLigado(s.hospital);
    const a = await this.porta.acesso(this.c(s.hospital), s.acesso);
    if (!a || a.situacao !== 'ativo') {
      this.sessoes.delete(s.id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'Entre de novo no portal.',
      );
    }
    if (!(await this.prestadorCredenciado(s.hospital, a.prestador))) {
      this.sessoes.delete(s.id);
      throw prestadorDescredenciado();
    }
    return a;
  }

  /**
   * W0-10 (M8): para as contas do portal (outro serviço): a conta da sessão segue ativa, o prestador credenciado e a
   * chave pedida também ligada.
   */
  async exigirContaComChave(s: SessaoPortalPrestadorInterna, chave: ChaveOperadora): Promise<void> {
    await this.exigirConta(s);
    await this.exigirLigado(s.hospital, chave);
  }

  /** W0-10 (M8): o contexto da rede e do estabelecimento da sessão. */
  contextoDe(s: SessaoPortalPrestadorInterna): ContextoPorta {
    return this.c(s.hospital);
  }

  /** W0-10 (M8): a linha da trilha do portal (usuário do portal, recurso do portal, a estação pelo IP). */
  linhaDoPortal(
    s: SessaoPortalPrestadorInterna,
    evento: string,
    idAlvo: string,
    resultado: 'sucesso' | 'falha',
    ip: string,
    tabela: string,
  ): RegistroTrilhaTela {
    return this.trilha(s.hospital, evento, idAlvo, resultado, ip, tabela);
  }

  // ── W0-10: a troca da senha e do autenticador pelo próprio prestador ─────────────────────────────

  /**
   * Confere a senha atual e o código do aplicativo da conta da sessão (a reautenticação das trocas). O erro conta no
   * mesmo contador da entrada (no limite, a conta fica bloqueada por alguns minutos) e vai à trilha como falha.
   */
  private async reautenticar(
    s: SessaoPortalPrestadorInterna,
    senha: string,
    codigo: string,
    evento: string,
    ip: string,
  ): Promise<DadosAcessoPortalParaEntrada> {
    await this.exigirConta(s);
    this.conferirTaxa(ip);
    const a = await this.porta.acessoParaEntrada(this.c(s.hospital), { login: s.login });
    if (!a || a.id !== s.acesso || a.situacao !== 'ativo') {
      this.sessoes.delete(s.id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'Entre de novo no portal.',
      );
    }
    const agora = iso(this.agora());
    if (acessoBloqueado(a.bloqueadoAte, agora))
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Acesso bloqueado por alguns minutos',
        MENSAGENS_TROCA_CREDENCIAL['acesso-bloqueado'],
        { codigo: 'acesso-bloqueado' },
      );
    const senhaOk = await conferirSenha(senha, a.senhaResumo);
    const fatorOk = this.segundoFatorConfere(a.segundoFator, codigo);
    if (senhaOk && fatorOk) return a;
    await this.porta.gravar(
      this.c(s.hospital),
      this.trilha(s.hospital, evento, String(a.id), 'falha', ip),
      (g) =>
        g.tentativaPortal({
          id: a.id,
          acertou: false,
          agora,
          limite: PARAMETROS_PORTAL_PRESTADOR.tentativas,
          bloqueioAte: depoisDaTentativaPortal(PARAMETROS_PORTAL_PRESTADOR.tentativas - 1, false, agora)
            .bloqueadoAte as string,
        }),
    );
    throw new ErroProblema(
      'recusa-de-negocio',
      422,
      'Senha ou código não confere',
      MENSAGENS_TROCA_CREDENCIAL['credencial-nao-confere'],
      { codigo: 'credencial-nao-confere', campos: ['senha', 'codigo'] },
    );
  }

  /** As outras sessões da mesma conta caem depois da troca (só a que trocou segue). */
  private encerrarOutrasSessoes(s: SessaoPortalPrestadorInterna): void {
    for (const [id, x] of this.sessoes) if (x.acesso === s.acesso && id !== s.id) this.sessoes.delete(id);
  }

  /** A troca da senha: a atual e o código do aplicativo conferidos; a nova (Argon2id) vale já, a trilha vai junto. */
  async trocarSenha(
    s: SessaoPortalPrestadorInterna,
    e: TrocarSenhaPortalPrestadorEntrada,
    ip: string,
  ): Promise<{ mensagem: string }> {
    const evento = E.operadoraPortalSenhaTrocada.codigo;
    const a = await this.reautenticar(s, e.senhaAtual, e.codigo, evento, ip);
    const senhaResumo = await cifrarSenha(e.senhaNova);
    await this.porta.gravar(
      this.c(s.hospital),
      this.trilha(s.hospital, evento, String(a.id), 'sucesso', ip),
      (g) =>
        g.trocarCredencial({
          id: a.id,
          versao: a.versao,
          usuario: USUARIO_PORTAL_PRESTADOR,
          senhaResumo,
          segundoFator: null,
        }),
    );
    this.encerrarOutrasSessoes(s);
    return { mensagem: MENSAGENS_TROCA_CREDENCIAL['senha-trocada'] as string };
  }

  /** O início da troca do autenticador: confere a senha e o código atual e devolve o novo (só nesta sessão). */
  async iniciarAutenticador(
    s: SessaoPortalPrestadorInterna,
    e: IniciarAutenticadorPortalPrestadorEntrada,
    ip: string,
  ): Promise<AutenticadorNovoPortalPrestador> {
    if (!this.chaveMestra)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Troca indisponível',
        'O cadastro do segundo fator não está configurado neste ambiente.',
      );
    await this.reautenticar(s, e.senha, e.codigo, E.operadoraPortalAutenticadorTrocado.codigo, ip);
    const segredo = gerarSegredoBase32();
    const validoAte = this.agora().getTime() + MINUTOS_AUTENTICADOR_NOVO * 60_000;
    this.autenticadoresNovos.set(s.id, { segredo, validoAte, erros: 0 });
    return {
      otpauth: uriOtpauth(s.login, this.produto, segredo),
      validoAte: new Date(validoAte).toISOString(),
      mensagem: MENSAGENS_TROCA_CREDENCIAL['autenticador-novo'] as string,
    };
  }

  /** A confirmação: um código certo do aplicativo novo grava o segredo novo (cifrado); o antigo deixa de valer. */
  async confirmarAutenticador(
    s: SessaoPortalPrestadorInterna,
    codigo: string,
    ip: string,
  ): Promise<{ mensagem: string }> {
    const a = await this.exigirConta(s);
    const novo = this.autenticadoresNovos.get(s.id);
    if (!novo || novo.validoAte < this.agora().getTime() || !this.chaveMestra) {
      this.autenticadoresNovos.delete(s.id);
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Troca não iniciada ou vencida',
        MENSAGENS_TROCA_CREDENCIAL['autenticador-sem-pedido'],
        { codigo: 'autenticador-sem-pedido' },
      );
    }
    if (!verificarTotp(novo.segredo, codigo, this.agora().getTime())) {
      novo.erros += 1;
      if (novo.erros >= ERROS_AUTENTICADOR_NOVO) this.autenticadoresNovos.delete(s.id);
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Código não confere',
        MENSAGENS_TROCA_CREDENCIAL['codigo-novo-nao-confere'],
        { codigo: 'codigo-novo-nao-confere', campos: ['codigo'] },
      );
    }
    const segundoFator = cifrarSegredo(novo.segredo, this.chaveMestra);
    await this.porta.gravar(
      this.c(s.hospital),
      this.trilha(s.hospital, E.operadoraPortalAutenticadorTrocado.codigo, String(a.id), 'sucesso', ip),
      (g) =>
        g.trocarCredencial({
          id: a.id,
          versao: a.versao,
          usuario: USUARIO_PORTAL_PRESTADOR,
          senhaResumo: null,
          segundoFator,
        }),
    );
    this.autenticadoresNovos.delete(s.id);
    this.encerrarOutrasSessoes(s);
    return { mensagem: MENSAGENS_TROCA_CREDENCIAL['autenticador-trocado'] as string };
  }

  private paraPortal(a: DadosAutorizacaoResumo, senhaValidade: string | null = null): AutorizacaoPortal {
    return {
      id: a.id,
      protocolo: a.protocolo,
      carteirinha: a.carteirinha,
      beneficiarioIniciais: iniciaisDoNome(a.beneficiarioNome),
      tipoGuia: a.tipoGuia,
      situacao: a.situacao,
      situacaoRotulo: rotuloDaGuia(a.situacao),
      solicitadaEm: a.solicitadaEm,
      prazoEm: a.prazoEm,
      senha: a.senha,
      senhaValidade,
      versao: a.versao,
    };
  }

  async autorizacoesDoPrestador(
    s: SessaoPortalPrestadorInterna,
    f: { busca?: string; apos?: number },
    ip: string,
  ): Promise<{ itens: AutorizacaoPortal[]; proxima: number | null }> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.consultar);
    const r = await this.autorizacoes.autorizacoes(this.c(s.hospital), {
      prestador: s.prestador,
      ...(f.busca ? { busca: f.busca } : {}),
      ...(f.apos ? { apos: f.apos } : {}),
    });
    await this.registrarLeitura(s, ip);
    return { itens: r.itens.map((a) => this.paraPortal(a)), proxima: r.proxima };
  }

  /** A leitura das autorizações vai à trilha (sem dado pessoal; o alvo é a conta do portal). */
  private async registrarLeitura(s: SessaoPortalPrestadorInterna, ip: string): Promise<void> {
    if (this.porta.destino !== 'banco') return;
    await this.porta.gravar(
      this.c(s.hospital),
      this.trilha(s.hospital, E.operadoraPortalAutorizacaoLida.codigo, String(s.acesso), 'sucesso', ip),
      async () => ({ id: s.acesso }),
    );
  }

  async autorizacaoDoPrestador(
    s: SessaoPortalPrestadorInterna,
    id: number,
    ip: string,
  ): Promise<
    AutorizacaoPortal & {
      itens: { codigo: string; descricao: string; solicitada: number; autorizada: number | null }[];
      complemento: ComplementoPortal;
    }
  > {
    await this.exigirFuncao(s, FUNCAO_PORTAL.consultar);
    const a = await this.autorizacoes.autorizacao(this.c(s.hospital), id);
    if (!a || a.prestador !== s.prestador)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Pedido não encontrado',
        'O pedido não é deste prestador.',
      );
    const [itens, complemento] = await Promise.all([
      this.autorizacoes.itens(this.c(s.hospital), id),
      this.complementoDoPedido(this.c(s.hospital), a),
    ]);
    await this.registrarLeitura(s, ip);
    return {
      ...this.paraPortal(a),
      complemento,
      itens: itens.map((i) => ({
        codigo: i.codigo,
        descricao: i.descricao,
        solicitada: i.quantidadeSolicitada,
        autorizada: i.quantidadeAutorizada,
      })),
    };
  }

  /** W0-10: o complemento no detalhe: o que o auditor pediu e as respostas (texto e anexos, sem conteúdo), em ordem. */
  private async complementoDoPedido(c: ContextoAutorizacao, a: DadosAutorizacao): Promise<ComplementoPortal> {
    const [eventos, anexos] = await Promise.all([
      this.autorizacoes.eventos(c, a.id),
      this.autorizacoes.anexosDoComplemento(c, a.id),
    ]);
    return {
      pedido: a.complementoPedido,
      aguardando: a.situacao === 'pendente',
      respostas: eventos
        .filter((x) => x.evento === 'complemento-resposta')
        .map((x) => ({
          evento: x.id,
          em: x.em,
          texto: x.texto,
          anexos: anexos
            .filter((y) => y.evento === x.id)
            .map((y) => ({ id: y.id, nome: y.nome, tipo: y.tipo, tamanho: y.tamanho, sha256: y.sha256 })),
        })),
    };
  }

  /**
   * W0-10: o prestador responde ao complemento pedido pelo auditor numa autorização dele, com até 5 anexos (PDF, PNG ou
   * JPEG até 2 MB, conferidos pelo conteúdo). A resposta e os anexos são registro novo (nada se edita depois); o pedido
   * volta à análise e a trilha vai na mesma transação.
   */
  async responderComplemento(
    s: SessaoPortalPrestadorInterna,
    id: number,
    e: ResponderComplementoPortalEntrada,
    ip: string,
  ): Promise<ResultadoComplementoPortal> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.solicitar);
    await this.exigirLigado(s.hospital, CHAVE_OPERADORA_AUTORIZACAO);
    const c = this.c(s.hospital);
    const atual = await this.autorizacoes.autorizacao(c, id);
    if (!atual || atual.prestador !== s.prestador)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Pedido não encontrado',
        'O pedido não é deste prestador.',
      );
    const anexos = e.anexos.map((x) => ({
      nome: x.nome,
      bytes: new Uint8Array(Buffer.from(x.conteudo, 'base64')),
    }));
    const r = await this.autorizacoes
      .gravar(
        c,
        this.trilha(
          s.hospital,
          E.operadoraPortalComplementoRespondido.codigo,
          String(id),
          'sucesso',
          ip,
          'pedido_autorizacao_plano',
        ),
        (g) =>
          g.responderComplementoPortal({
            id,
            versao: e.versao,
            usuario: USUARIO_PORTAL_PRESTADOR,
            prestador: s.prestador,
            acesso: s.acesso,
            resposta: e.resposta,
            anexos,
          }),
      )
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    return {
      ok: true,
      id,
      versao: r.versao,
      evento: r.evento,
      anexos: r.anexos.length,
      mensagem: 'Resposta enviada. O pedido voltou para a análise do auditor.',
    };
  }

  /** W0-10: um anexo de resposta ao complemento de uma autorização do prestador (o download vai à trilha de leitura). */
  async anexoDoComplemento(
    s: SessaoPortalPrestadorInterna,
    id: number,
    anexo: number,
    ip: string,
  ): Promise<{ nome: string; tipo: string; sha256: string; bytes: Buffer }> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.consultar);
    const x = await this.autorizacoes.anexoDoComplemento(this.c(s.hospital), anexo, s.prestador);
    if (!x || x.autorizacao !== id)
      throw new ErroProblema('nao-encontrado', 404, 'Anexo não encontrado', 'O anexo não é deste prestador.');
    await this.registrarLeitura(s, ip);
    return { nome: x.nome, tipo: x.tipo, sha256: x.sha256, bytes: x.bytes };
  }

  /** W0-10 (M7): a elegibilidade é de quem pede ou consulta autorização (função 1 ou 3). */
  private async exigirElegibilidade(s: SessaoPortalPrestadorInterna): Promise<void> {
    const a = await this.exigirConta(s);
    const f = funcoesDoTexto(a.funcoes);
    if (!f.includes(FUNCAO_PORTAL.solicitar) && !f.includes(FUNCAO_PORTAL.consultar))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Função não liberada',
        'Esta função do portal não está liberada para o seu acesso.',
        { codigo: 'funcao-nao-liberada' },
      );
  }

  /**
   * W0-10 (M7): a elegibilidade do beneficiário pela carteirinha na data do atendimento (situação, vigência do contrato,
   * validade da carteirinha, carências e cobertura pela segmentação), com o registro da consulta
   * (consulta_elegibilidade_recebida) e a trilha na mesma transação. Beneficiário de outra operadora não é mostrado (fica como
   * "não encontrado"). O resultado é do momento: a autorização confere de novo ao pedir.
   */
  async elegibilidade(
    s: SessaoPortalPrestadorInterna,
    e: ConsultarElegibilidadePortalEntrada,
    ip: string,
  ): Promise<ElegibilidadePortal> {
    await this.exigirElegibilidade(s);
    const c = this.c(s.hospital);
    const dia = e.data ?? (await this.porta.relogio(c)).hoje;
    const lida = carteirinhaValida(e.carteirinha) ? await this.porta.elegibilidade(c, e.carteirinha) : null;
    const linha = lida && lida.beneficiario.operadora === s.operadora ? lida : null;
    const r = avaliarElegibilidade(
      e.carteirinha,
      linha
        ? {
            beneficiario: { situacao: linha.beneficiario.situacao, inclusao: linha.beneficiario.inclusao },
            contrato: {
              situacao: linha.contrato.situacao as 'ativo',
              inicio: linha.contrato.inicio,
              fim: linha.contrato.fim,
            },
            produto: {
              situacao: linha.produto.situacao as 'ativo',
              natureza: linha.produto.natureza,
              carencias: linha.produto.carencias,
            },
          }
        : null,
      dia,
    );
    const validade = linha ? await this.porta.validadeCarteirinha(c, linha.beneficiario.id) : null;
    const vencida = validade !== null && validade < dia;
    const motivos: MotivoInelegibilidade[] = [...r.motivos];
    if (vencida) motivos.push('carteirinha-vencida');
    const elegivel = motivos.length === 0;
    const { id } = await this.porta.gravar(
      c,
      (y: { id: number }) =>
        this.trilha(
          s.hospital,
          E.operadoraPortalElegibilidadeConsultada.codigo,
          String(y.id),
          elegivel ? 'sucesso' : 'falha',
          ip,
          'consulta_elegibilidade_recebida',
        ),
      (g) =>
        g.registrarElegibilidade({
          operadora: s.operadora,
          prestador: s.prestador,
          acesso: s.acesso,
          carteirinha: e.carteirinha,
          data: dia,
          elegivel,
          motivos,
          beneficiario: linha?.beneficiario.id ?? null,
          usuario: USUARIO_PORTAL_PRESTADOR,
        }),
    );
    return {
      carteirinha: e.carteirinha,
      data: dia,
      elegivel,
      motivos,
      beneficiario: linha
        ? {
            id: linha.beneficiario.id,
            nome: linha.beneficiario.nomeSocial ?? linha.beneficiario.nome,
            situacao: linha.beneficiario.situacao,
          }
        : null,
      plano: linha
        ? {
            nome: linha.produto.nome,
            registroAns: linha.produto.registroAns,
            natureza: linha.produto.natureza,
            segmentacao: linha.produto.segmentacao,
            abrangencia: linha.produto.abrangencia,
            acomodacao: linha.produto.acomodacao,
          }
        : null,
      carencias: r.carencias,
      validadeCarteirinha: validade,
      carteirinhaVencida: vencida,
      cobertura: linha ? coberturaPorAtendimento(linha.produto.natureza, linha.produto.segmentacao) : [],
      registro: id,
    };
  }

  /** W0-10 (M7): as últimas consultas de elegibilidade do prestador da sessão (sem o nome do beneficiário). */
  async consultasElegibilidade(s: SessaoPortalPrestadorInterna): Promise<ConsultasElegibilidadePortal> {
    await this.exigirElegibilidade(s);
    const xs = await this.porta.consultasElegibilidade(this.c(s.hospital), s.prestador);
    return {
      itens: xs.map((x) => ({
        id: x.id,
        carteirinha: x.carteirinha,
        data: x.data,
        elegivel: x.elegivel,
        motivos: x.motivos as MotivoInelegibilidade[],
        em: x.em,
      })),
    };
  }

  /** O apoio do pedido pelo portal: os tipos de guia do domínio e a data do servidor (função 1). */
  async apoio(s: SessaoPortalPrestadorInterna): Promise<ApoioPortalPrestador> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.solicitar);
    const c = this.c(s.hospital);
    const [dominios, relogio] = await Promise.all([
      this.autorizacoes.dominios(c),
      this.autorizacoes.relogio(c),
    ]);
    return { tiposGuia: rotulosDaAutorizacao(dominios).tipoGuia, hoje: relogio.hoje };
  }

  /** A busca na terminologia TUSS para o pedido pelo portal (código ou trecho do nome; só vigentes; função 1). */
  async procedimentos(s: SessaoPortalPrestadorInterna, termo: string) {
    await this.exigirFuncao(s, FUNCAO_PORTAL.solicitar);
    return { itens: await this.autorizacoes.buscarTuss(this.c(s.hospital), termo) };
  }

  /** O pedido de autorização do prestador da sessão (a origem é o portal; o prestador vem da conta). */
  async solicitar(
    s: SessaoPortalPrestadorInterna,
    /** A entrada já com o prestador da conta e a origem do portal (o controlador sobrepõe o que a tela mandou). */
    e: RegistrarAutorizacaoEntrada,
    ip: string,
  ): Promise<ResultadoAutorizacao> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.solicitar);
    await this.exigirLigado(s.hospital, CHAVE_OPERADORA_AUTORIZACAO);
    const c = this.c(s.hospital);
    const x = await this.autorizacao.conferirRegistro(c, {
      ...e,
      prestador: s.prestador,
      origem: ORIGEM_PORTAL,
    });
    if (x.registro.operadora !== s.operadora)
      throw recusaDoAtendimento([{ codigo: 'beneficiario-de-outra-operadora', campo: 'carteirinha' }]);
    let protocolo = '';
    const r = await this.autorizacoes.gravar(
      c,
      (y: { id: number }) =>
        this.trilha(
          s.hospital,
          E.operadoraAutorizacaoRegistrada.codigo,
          String(y.id),
          'sucesso',
          ip,
          'pedido_autorizacao_plano',
        ),
      async (g) => {
        protocolo = protocoloAtendimento(x.registroAns, x.registro.solicitadaEm, await g.proximoProtocolo());
        return g.registrar({ ...x.registro, protocolo, usuario: USUARIO_PORTAL_PRESTADOR });
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      situacao: 'em-analise',
      protocolo,
      senha: null,
      mensagem: ServicoAutorizacaoOperadora.mensagemDoRegistro(
        protocolo,
        x.registro.prazoTipo,
        x.registro.prazoEm,
      ),
      avisos: x.avisos,
    };
  }

  /** O prestador cancela o pedido dele ainda não decidido. */
  async cancelar(
    s: SessaoPortalPrestadorInterna,
    id: number,
    e: { versao: number; motivo: string },
    ip: string,
  ): Promise<ResultadoAutorizacao> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.cancelar);
    await this.exigirLigado(s.hospital, CHAVE_OPERADORA_AUTORIZACAO);
    const c = this.c(s.hospital);
    const atual = await this.autorizacoes.autorizacao(c, id);
    if (!atual || atual.prestador !== s.prestador)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Pedido não encontrado',
        'O pedido não é deste prestador.',
      );
    if (!['em-analise', 'pendente'].includes(atual.situacao))
      throw recusaDoAtendimento([{ codigo: 'situacao-nao-permite' }]);
    const a = await this.autorizacao.conferirCancelamento(c, id);
    const r = await this.autorizacoes.gravar(
      c,
      this.trilha(
        s.hospital,
        E.operadoraAutorizacaoCancelada.codigo,
        String(id),
        'sucesso',
        ip,
        'pedido_autorizacao_plano',
      ),
      (g) => g.cancelar({ id, versao: e.versao, motivo: e.motivo, usuario: USUARIO_PORTAL_PRESTADOR }),
    );
    return {
      ok: true,
      id,
      versao: r.versao,
      situacao: 'cancelada',
      protocolo: a.protocolo,
      senha: null,
      mensagem: 'Pedido cancelado.',
      avisos: [],
    };
  }

  /**
   * A situação de um protocolo do prestador (atendimento ou autorização), pelo número; no de atendimento, também a versão
   * e as interações da operadora, cada uma com a resposta do prestador, se já dada (W0-10).
   */
  async protocolo(s: SessaoPortalPrestadorInterna, numero: string): Promise<ProtocoloPortal> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.protocolo);
    if (!/^\d{20}$/.test(numero))
      throw new ErroProblema('entrada-invalida', 400, 'Protocolo inválido', 'O protocolo tem 20 dígitos.');
    const r = await this.porta.consulta(this.c(s.hospital), numero, s.prestador);
    if (!r) throw recusaDoAtendimento([{ codigo: 'protocolo-inexistente', campo: 'numero' }]);
    return {
      tipo: r.tipo,
      id: r.id,
      protocolo: r.protocolo,
      situacao: r.situacao,
      situacaoRotulo:
        r.tipo === 'atendimento'
          ? (ROTULOS_SITUACAO_PROTOCOLO[r.situacao as SituacaoProtocoloOpe] ?? r.situacao)
          : rotuloDaGuia(r.situacao),
      abertoEm: r.abertoEm,
      prazoEm: r.prazoEm,
      vencido: r.vencido,
      ...(await this.interacoesDoProtocolo(s, r.tipo, r.id)),
    };
  }

  /**
   * W0-10: o prestador abre um protocolo de atendimento pelo portal (função 7). Mesmas regras do registro interno
   * (ServicoAtendimentoOperadora.conferirRegistro), com o canal do portal, o solicitante "prestador", a operadora, o
   * prestador e o nome de quem fez o contato vindos da conta; a operadora responde e interage pela ficha interna.
   */
  async abrirProtocolo(
    s: SessaoPortalPrestadorInterna,
    e: AbrirProtocoloPortalEntrada,
    ip: string,
  ): Promise<ResultadoProtocoloPortalAberto> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.protocolo);
    await this.exigirLigado(s.hospital, CHAVE_OPERADORA_ATENDIMENTO);
    const c = this.c(s.hospital);
    const x = await new ServicoAtendimentoOperadora(this.porta, this.autorizacoes).conferirRegistro(
      c,
      {
        operadora: s.operadora,
        instancia: 'atendimento',
        natureza: e.natureza,
        canal: 'portal-prestador',
        origem: ORIGEM_PORTAL,
        solicitante: 'prestador',
        solicitanteNome: s.nome.slice(0, 120),
        carteirinha: e.carteirinha,
        urgente: false,
        altaComplexidade: false,
        assunto: e.assunto,
        relato: e.relato,
        escritaPedida: false,
      },
      { prestador: s.prestador },
    );
    let protocolo = '';
    const r = await this.porta
      .gravar(
        c,
        (y: { id: number }) =>
          this.trilha(
            s.hospital,
            E.operadoraProtocoloRegistrado.codigo,
            String(y.id),
            'sucesso',
            ip,
            'protocolo_beneficiario',
          ),
        async (g) => {
          protocolo = protocoloAtendimento(x.registroAns, x.registro.abertoEm, await g.proximoProtocolo());
          return g.registrar({ ...x.registro, protocolo, usuario: USUARIO_PORTAL_PRESTADOR });
        },
      )
      .catch((z: unknown) => {
        throw problemaDoCadastro(z);
      });
    return {
      ok: true,
      id: r.id,
      protocolo,
      prazoEm: x.registro.prazoEm,
      mensagem: ServicoAtendimentoOperadora.mensagemDoRegistro(
        protocolo,
        x.registro.prazoTipo,
        x.registro.prazoEm,
      ),
    };
  }

  /** W0-10: a versão e as interações da operadora (não as respostas do prestador), cada uma com as respostas dele. */
  private async interacoesDoProtocolo(
    s: SessaoPortalPrestadorInterna,
    tipo: 'atendimento' | 'autorizacao',
    id: number,
  ): Promise<Pick<ProtocoloPortal, 'versao' | 'respondivel' | 'interacoes'>> {
    if (tipo !== 'atendimento') return { versao: null, respondivel: false, interacoes: [] };
    const c = this.c(s.hospital);
    const [p, eventos, respostas] = await Promise.all([
      this.porta.protocolo(c, id),
      this.porta.eventos(c, id),
      this.porta.respostasPrestador(c, id),
    ]);
    if (!p || p.prestador !== s.prestador) return { versao: null, respondivel: false, interacoes: [] };
    const geradas = new Set(respostas.map((r) => r.evento));
    return {
      versao: p.versao,
      respondivel: (SITUACOES_RESPOSTA_PRESTADOR as readonly string[]).includes(p.situacao),
      interacoes: eventos
        .filter((e) => e.evento === 'interacao' && !geradas.has(e.id))
        .map((e) => ({
          evento: e.id,
          em: e.em,
          texto: e.texto,
          respostas: respostas
            .filter((r) => r.interacao === e.id)
            .map((r) => ({
              id: r.id,
              interacao: r.interacao,
              evento: r.evento,
              texto: r.texto,
              anexo: r.anexo,
              em: r.em,
            })),
        })),
    };
  }

  /**
   * W0-10: o prestador responde, pelo portal, a uma interação da operadora num protocolo de atendimento dele, com um
   * anexo opcional (PDF, PNG ou JPEG até 2 MB, conferido pelo conteúdo). A resposta é registro novo (nada se edita); o
   * histórico ganha o evento e a trilha vai na mesma transação.
   */
  async responderInteracao(
    s: SessaoPortalPrestadorInterna,
    id: number,
    interacao: number,
    e: ResponderInteracaoPortalEntrada,
    ip: string,
  ): Promise<ResultadoInteracaoPortal> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.protocolo);
    await this.exigirLigado(s.hospital, CHAVE_OPERADORA_ATENDIMENTO);
    const c = this.c(s.hospital);
    const p = await this.porta.protocolo(c, id);
    if (!p || p.prestador !== s.prestador)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Protocolo não encontrado',
        'O protocolo não é deste prestador.',
      );
    const anexo = e.anexo
      ? { nome: e.anexo.nome, bytes: new Uint8Array(Buffer.from(e.anexo.conteudo, 'base64')) }
      : null;
    const r = await this.porta
      .gravar(
        c,
        this.trilha(
          s.hospital,
          E.operadoraPortalInteracaoRespondida.codigo,
          String(id),
          'sucesso',
          ip,
          'protocolo_beneficiario',
        ),
        (g) =>
          g.responderInteracaoPrestador({
            id,
            versao: e.versao,
            usuario: USUARIO_PORTAL_PRESTADOR,
            prestador: s.prestador,
            acesso: s.acesso,
            interacao,
            texto: e.texto,
            anexo,
          }),
      )
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    return {
      ok: true,
      id,
      versao: r.versao,
      resposta: r.resposta,
      evento: r.evento,
      mensagem: 'Resposta enviada à operadora.',
    };
  }

  /** W0-10: o anexo de uma resposta do prestador num protocolo dele (o download vai à trilha de leitura). */
  async anexoDoProtocolo(
    s: SessaoPortalPrestadorInterna,
    id: number,
    resposta: number,
    ip: string,
  ): Promise<{ nome: string; tipo: string; sha256: string; bytes: Buffer }> {
    await this.exigirFuncao(s, FUNCAO_PORTAL.protocolo);
    const x = await this.porta.anexoDaResposta(this.c(s.hospital), resposta, s.prestador);
    if (!x || x.protocolo !== id)
      throw new ErroProblema('nao-encontrado', 404, 'Anexo não encontrado', 'O anexo não é deste prestador.');
    await this.registrarLeitura(s, ip);
    return { nome: x.nome, tipo: x.tipo, sha256: x.sha256, bytes: x.bytes };
  }
}
