// Portal do paciente, etapa 1 do M50 (ficha, seções 4, 5, 7 e 8; regras 1, 5, 8 e 13; cap-07 §7.6; LGPD art. 14 e 18;
// SBIS-24): um domínio de identidade separado dos usuários internos (conta própria do portal, nunca a tabela de usuários internos).
//   - conta por convite do hospital (o código sai impresso: nenhuma mensagem ao paciente; DP-44 a), ativada com e-mail,
//     senha (Argon2id), aceite do termo de uso e da política e o segundo fator do aplicativo autenticador (TOTP; o
//     segredo fica cifrado com a chave mestra); entrada com e-mail, senha e código, com limite de tentativas por conta e
//     de taxa por origem, e erro sempre genérico;
//   - sessão própria (cookie HttpOnly e CSRF por token duplo, como a do portal de resultados do M26), que expira por
//     inatividade e nunca vale nas rotas internas; a cada pedido a conta e os vínculos são relidos (o bloqueio ou a
//     revogação valem na hora) e o escopo é conferido no servidor (podeAgir);
//   - resultados liberados de setor publicado (a regra do M26, com a visualização gravada pela receita do M26) e
//     documentos do novo assinados no nível mínimo (M49), nada de evolução, prescrição ou resultado não liberado;
//   - responsável legal só com prova (o hospital confere o original; quem pediu não aprova), consentimentos pelo escritor
//     do M11, pedidos do titular pelo do M10 (D-IDENT-50) e o relatório de quem acessou o próprio prontuário;
//   - lado interno: convite, situação, bloqueio, desbloqueio (refazer o acesso), encerramento, o responsável sem cadastro
//     no balcão (D-RESP-50) e a conferência dos vínculos; a vigência dos vínculos e das contas no job (varrerVigencias).
// Toda gravação vai com a SGH_TRILHA na mesma transação, sem dado pessoal (só identificadores).
import { createHash, randomBytes } from 'node:crypto';
import {
  type AbrirItemPortal,
  type AcessoTitularItem,
  type AtivacaoIniciada,
  type AtivarContaPortal,
  type BloquearContaPortal,
  CHAVE_PORTAL_CONTA,
  type ConferirCredenciaisPortal,
  type ConfirmarTrocaEmailPortal,
  type ConferirConvite,
  type ConfirmarSegundoFator,
  type ConsentimentoPortalEntrada,
  type ConsentimentoPortalItem,
  type ContaPortalResumo,
  type ConvidarContaPortal,
  type ConvidarResponsavelBalcao,
  type ConviteEmitido,
  type DecidirVinculo,
  type DesbloquearContaPortal,
  type DocumentoPortalAberto,
  type EncerrarContaPortal,
  type EncerrarVinculo,
  type EntrarContaPortal,
  type FilaVinculos,
  ESCOPO_PADRAO_VINCULO,
  type EscopoVinculo,
  EVENTOS_AUDITAVEIS,
  type FiltroAcessosTitular,
  type ItemDocumentoPortal,
  JANELA_RELATORIO_ACESSOS_DIAS,
  type LaudoPortalAberto,
  type ListaDocumentosPortal,
  NATUREZA_DO_EVENTO,
  type NivelAssinaturaDocumento,
  type PedidoTitularPortalEntrada,
  type CancelarPedidoPortal,
  DIAS_UTEIS_RESPOSTA_OUVIDORIA,
  type ManifestacaoPortalEntrada,
  type ManifestacaoPortalItem,
  PARAMETRO_PRAZO_OUVIDORIA,
  type PedidoTitularPortalItem,
  type PedirTrocaEmailPortal,
  type PedirVinculo,
  type RedefinirSegundoFatorPortal,
  type RelatorioAcessosTitular,
  type SessaoContaPortal,
  TIPOS_DOCUMENTO_PORTAL,
  type AtoCopiaItem,
  type ConferirLegitimidadeCopia,
  type CopiaNaFilaItem,
  type CopiaPortalItem,
  type EntregarCopia,
  type FiltroFilaCopias,
  type GerarCopia,
  type PedirCopiaBalcao,
  type PedirCopiaPortal,
  type TipoVinculoResponsavel,
  type TitularDaSessao,
  type TrocaEmailPedida,
  type TrocarEmailContaPortal,
  type TrocarSenhaPortal,
  type VinculoParaConferir,
  type VinculoResumo,
  type ImagemDoLaudo,
} from '@sgh/contratos';
import {
  agruparAcessos,
  bloqueioPorTentativas,
  cifrarSegredo,
  cifrarSenha,
  codigoConvite,
  conferirAtivacao,
  conferirConvite,
  conferirDecisaoVinculo,
  conferirPedidoVinculo,
  conferirSenha,
  decifrarSegredo,
  documentoVisivelNoPortal,
  escoposAprovados,
  formatarConvite,
  gerarSegredoBase32,
  idadeEm,
  idSignatario,
  idSituacaoTermo,
  janelaValida,
  MENSAGEM_ATIVACAO_GENERICA,
  mascararEmail,
  mensagemConvite,
  mensagemVinculo,
  passoTotpConferido,
  podeAgir,
  primeiroNome,
  signatarioDaSessao,
  situacaoInicialPedidoPortal,
  conferirCancelamento,
  mensagemCancelamento,
  type SituacaoPedido,
  terminoDoVinculo,
  titularPodeRevogar,
  uriOtpauth,
  validadeDoConvite,
  vigenciaDoVinculo,
  conferirAtoCopia,
  conferirSolicitacaoCopia,
  etapaDaCopia,
  gerarPdfCopia,
  marcaDaguaCopia,
  mensagemCopia,
  type AtoCopia,
  type NovoAtoCopia,
  type SecaoCopia,
  type SolicitanteCopia,
  type VinculoParaCopia,
} from '@sgh/dominio-acesso';
import {
  calendarioDeFeriados,
  prazoRespostaOuvidoria,
  protocoloManifestacao,
  somarDiasData,
} from '@sgh/dominio-qualidade';
import {
  type AlergiaIps,
  type DocumentoAssinadoIps,
  type EstabelecimentoFhir,
  type MedicamentoIps,
  type PacienteFhir,
  type ProblemaIps,
  pacoteIpsTitular,
  validarPacoteIps,
} from '@sgh/dominio-integracao';
import { dentroDaTaxa, ipParaGravar } from '@sgh/dominio-sadt';
import { ErroOperacao } from '@sgh/nucleo';
import {
  type ContaPortal,
  ErroPortal,
  ErroPedido,
  type RegistroTrilhaPortal,
  type PacientePortal,
  type VinculoPortal,
} from '../tipos.js';
import { logger } from '../../../logger.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { PortaSadt } from '../../sadt/public-api.js';
import type { ContextoPortal, ContextoPortalNucleo, GravadorPortal, PortaPortalPaciente } from '../porta.js';
import type { ArmazemProvas } from './provas.js';
import { type CanalPaciente, CanalSimulador } from './canal.js';
import { ligadaNoEstabelecimento, parametroDoEstabelecimento, parametroTexto } from './liberacao.js';

/** O usuário de integração do portal nas colunas de autoria (nunca o paciente; ficha, seção 5). */
export const USUARIO_PORTAL = 'SGH.PORTAL';
export const USUARIO_JOB_PORTAL = 'SGH.PORTAL.JOB';
/** Versões vigentes do termo de uso, da política de privacidade e do termo de consentimento do portal. */
export const VERSAO_TERMO_USO = '2026.1';
export const VERSAO_POLITICA = '2026.1';
export const VERSAO_CONSENTIMENTO = '2026.1';
const TAXA_POR_MINUTO = 10;
const ATIVACAO_MINUTOS = 10;
const TENTATIVAS_SEGUNDO_FATOR = 5;
const PRAZO_PEDIDO_DIAS = 15;
/** W0-10: minutos para confirmar o autenticador novo e tentativas do primeiro código dele. */
const TROCA_SEGUNDO_FATOR_MINUTOS = 10;
const ACESSOS_POR_PAGINA = 50;
/** Pedidos de vínculo recusados por conta numa hora antes do bloqueio (o pedido não serve de busca de cadastro). */
const RECUSAS_VINCULO_POR_HORA = 5;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const resumoEmail = (email: string) => sha256(email.trim().toLowerCase());
const resumoConvite = (codigo: string) => sha256(codigo.toUpperCase().replace(/[\s-]/g, ''));
/** O autor na trilha das ações da conta (separa "Você" de "Seu responsável" sem dado pessoal; D-USUARIO-50). */
export const quemDaConta = (conta: number) => `${USUARIO_PORTAL}.C${conta}`.slice(0, 31);
/** W0-10 (M1): a área da manifestação quando o paciente não escolhe (a ouvidoria ajusta ao encaminhar). */
/**
 * Assunto padrão da manifestação do portal: o código do motivo geral do catálogo da ouvidoria (motivo_manifestacao).
 * O texto livre que o paciente digita vale como assunto quando bate com um código ou uma descrição do catálogo; senão,
 * vai no início do relato e a manifestação fica sem motivo, para a triagem da ouvidoria (nunca recusada por isso).
 */
/** O código do erro (ErroOperacao ou ErroProblema), sem a mensagem: o log da varredura não leva dado pessoal. */
function codigoDoErro(e: unknown): string {
  const x = e as { problema?: { codigo?: string }; extras?: { codigo?: string }; codigo?: string };
  return x?.problema?.codigo ?? x?.extras?.codigo ?? (typeof x?.codigo === 'string' ? x.codigo : 'erro');
}

function avisoDaVarredura(operacao: string, e: unknown): void {
  logger.warn(
    { modulo: 'portal-paciente', operacao, codigo: codigoDoErro(e) },
    'Encerramento pela vigência falhou.',
  );
}

export const AREA_OUVIDORIA_PORTAL = 'geral';
/** O instante civil do estabelecimento (AAAA-MM-DDTHH:mm:ss), como a ouvidoria grava. */
export function instanteLocal(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}`;
}
const dia = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface BaseConferencia {
  readonly idade: number;
  readonly hoje: string;
  readonly incapazes: ReadonlySet<number>;
}

export interface TitularInterno extends TitularDaSessao {
  readonly paciente: number;
  readonly prontuario: number;
  readonly nascimento: string | null;
}

export interface SessaoPortalInterna {
  readonly id: string;
  readonly csrf: string;
  readonly hospital: string;
  readonly conta: number;
  expira: number;
  ativo: string | null;
  /** Arquivos de prova enviados nesta sessão (a chave → o SHA-256): o pedido só aceita um destes. */
  readonly provas: Map<string, string>;
}

interface AtivacaoInterna {
  readonly id: string;
  readonly csrf: string;
  readonly hospital: string;
  readonly conta: number;
  readonly versao: number;
  readonly expira: number;
  tentativas: number;
  dados: {
    email: string;
    senhaResumo: string;
    segredo: string;
    termoUso: string;
    politica: string;
  } | null;
}

/** O resultado de uma entrada (o controlador põe os cookies). */
export interface SessaoAberta {
  readonly id: string;
  readonly csrf: string;
  readonly ttlSegundos: number;
  readonly sessao: SessaoContaPortal;
}

export interface AtivacaoAberta {
  readonly id: string;
  readonly csrf: string;
  readonly ttlSegundos: number;
}

/** A sessão do portal resolvida no pedido: a conta relida e os titulares vigentes. */
export interface PortalNoPedido {
  readonly s: SessaoPortalInterna;
  /** O contexto do estabelecimento da sessão, com o do núcleo (as portas de agenda, exame e cadastro o pedem). */
  readonly c: ContextoPortalNucleo;
  readonly conta: ContaPortal;
  readonly titulares: TitularInterno[];
  readonly ativo: TitularInterno;
}

/** A sessão interna (recepção, privacidade) que chega das rotas com @Permissao. */
export interface QuemInterno {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
  readonly origem: string | null;
}

export interface ConfigPortalPaciente {
  readonly rede: string;
  readonly produto: string;
  readonly chaveMestra: Buffer | null;
  readonly estabelecimentoPadrao: string | null;
  /** Os estabelecimentos do job da vigência (os configurados). */
  readonly estabelecimentos?: readonly string[];
  /** W0-10: o endereço público do portal no link da confirmação do e-mail (sem ele, o caminho relativo). */
  readonly enderecoPublico?: string | null;
}

/** W0-10 (M2): o conteúdo do prontuário para a cópia (os leitores do PEP; nada daqui vai à trilha). */
export type LeitorProntuarioCopia = (c: ContextoPortal, paciente: number) => Promise<SecaoCopia[]>;

/**
 * W0-10 (M3): os dados do titular para o pacote de portabilidade em FHIR/IPS (identificação, estabelecimento e o
 * resumo clínico pelos leitores do PEP). Os PDFs assinados vêm dos documentos do portal (mesma regra de visibilidade).
 */
export interface DadosIpsTitular {
  readonly paciente: PacienteFhir;
  readonly estabelecimento: EstabelecimentoFhir;
  readonly problemas: readonly ProblemaIps[];
  readonly alergias: readonly AlergiaIps[];
  readonly medicamentos: readonly MedicamentoIps[];
}
export type FonteDadosIps = (c: ContextoPortal, paciente: number) => Promise<DadosIpsTitular>;

export type GeradorPdfAssinado = (c: ContextoPortal, assinatura: number) => Promise<Uint8Array>;

const generica = (): never => {
  throw new ErroProblema(
    'nao-autenticado',
    401,
    'Dados de acesso inválidos',
    'E-mail, senha ou código não conferem.',
    { codigo: 'credencial-invalida' },
  );
};
const conviteGenerico = (): never => {
  throw new ErroProblema('nao-autenticado', 401, 'Convite não confere', MENSAGEM_ATIVACAO_GENERICA, {
    codigo: 'convite-invalido',
  });
};
const naoEncontrado = (
  titulo = 'Não encontrado',
  detalhe = 'O item não está disponível para este acesso.',
): never => {
  throw new ErroProblema('nao-encontrado', 404, titulo, detalhe, { codigo: 'nao-encontrado' });
};
const recusa = (codigo: string, detalhe: string, status = 409): never => {
  throw new ErroProblema(
    status === 503 ? 'indisponivel' : 'recusa-de-negocio',
    status,
    'Pedido recusado',
    detalhe,
    { codigo },
  );
};

/** Erros do adaptador (versão, e-mail em uso) e do executor em Problem Details em português. */
function traduzir(e: unknown): never {
  if (e instanceof ErroProblema) throw e;
  if (e instanceof ErroPortal) {
    if (e.codigo === 'email-em-uso')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'E-mail indisponível',
        'Não foi possível usar este e-mail. Use outro.',
        {
          codigo: 'email-em-uso',
        },
      );
    if (e.codigo === 'nao-encontrado') naoEncontrado();
    throw new ErroProblema('conflito-de-versao', 409, 'Registro alterado', e.message, { codigo: e.codigo });
  }
  if (e instanceof ErroPedido) {
    if (e.codigo === 'pedido-inexistente') naoEncontrado('Pedido não encontrado');
    throw new ErroProblema('recusa-de-negocio', 409, 'Pedido protocolado', e.message, { codigo: e.codigo });
  }
  if (e instanceof ErroOperacao)
    throw new ErroProblema('recusa-de-negocio', e.problema.status, e.problema.title, e.problema.detail, {
      codigo: e.problema.codigo ?? 'recusa',
    });
  throw e;
}

export class ServicoPortalPaciente {
  private readonly sessoes = new Map<string, SessaoPortalInterna>();
  private readonly ativacoes = new Map<string, AtivacaoInterna>();
  private readonly taxa = new Map<string, number[]>();
  /** O último passo do autenticador aceito por conta (`hospital:conta`): o código vale uma vez (RFC 6238 §5.2). */
  private readonly passosTotp = new Map<string, number>();
  /** As recusas do pedido de vínculo por conta (`hospital:conta`) na última hora. */
  private readonly recusasVinculo = new Map<string, number[]>();
  /** M47 (etapa 3): quem dá o link das imagens do laudo aberto (a lista de trabalho DICOM); sem ele, sem link. */
  imagens: ((c: { rede: string; hospital: string }, exame: number) => Promise<ImagemDoLaudo | null>) | null =
    null;
  /**
   * W0-10: o canal das mensagens ao paciente (o link da confirmação do e-mail novo). O padrão é o simulador em memória
   * (nada sai do processo); fora de dev/ci o módulo liga o da Hal-AI, com a trava de saídas.
   */
  canal: CanalPaciente = new CanalSimulador();
  /** W0-10 (M2): o texto dos registros do prontuário na cópia (o módulo liga o leitor do PEP). */
  prontuarioCopia: LeitorProntuarioCopia | null = null;
  /** W0-10 (M3): os dados do pacote de portabilidade FHIR/IPS (o módulo liga o cadastro e os leitores do PEP). */
  fonteIps: FonteDadosIps | null = null;
  /** W0-10: o autenticador novo à espera do primeiro código (`hospital:conta`), em memória como as ativações. */
  private readonly trocasSegundoFator = new Map<
    string,
    { segredo: string; expira: number; tentativas: number }
  >();

  constructor(
    private readonly porta: PortaPortalPaciente,
    private readonly sadt: PortaSadt | null,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly provas: ArmazemProvas,
    private readonly cfg: ConfigPortalPaciente,
    private readonly pdfAssinado: GeradorPdfAssinado | null = null,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get destino(): 'banco' | 'memoria' {
    return this.porta.destino;
  }

  get estabelecimentoPadrao(): string | null {
    return this.cfg.estabelecimentoPadrao;
  }

  private ctx(hospital: string): ContextoPortal {
    return { rede: this.cfg.rede, hospital };
  }

  /** O contexto do núcleo do estabelecimento (telas internas da agenda online e do pré-check-in). */
  contextoDoEstabelecimento(hospital: string): Promise<ContextoPortalNucleo> {
    return this.porta.contexto(this.ctx(hospital));
  }

  private async param(hospital: string, chave: string, padrao: number): Promise<number> {
    return (await parametroDoEstabelecimento(this.configuracao, this.cfg.rede, hospital, chave)) || padrao;
  }

  /** A chave `portal.conta` ligada no estabelecimento (na memória sem fonte de configuração, ligada). */
  async ligado(hospital: string): Promise<boolean> {
    if (this.porta.destino === 'memoria' && !this.configuracao) return true;
    return ligadaNoEstabelecimento(
      this.configuracao,
      this.cfg.rede,
      hospital,
      CHAVE_PORTAL_CONTA,
      USUARIO_PORTAL,
      this.agora(),
    );
  }

  private async exigirLigado(hospital: string): Promise<void> {
    if (await this.ligado(hospital)) return;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Portal indisponível',
      'O portal do paciente ainda não foi liberado neste estabelecimento.',
      { codigo: 'recurso-desligado' },
    );
  }

  /** Limite de taxa por origem (10 pedidos de entrada por minuto). */
  private conferirTaxa(ip: string): void {
    const agora = this.agora().getTime();
    const lista = (this.taxa.get(ip) ?? []).filter((x) => agora - x < 60_000);
    if (!dentroDaTaxa(lista, agora, TAXA_POR_MINUTO))
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitas tentativas',
        'Aguarde um minuto antes de tentar de novo.',
        { codigo: 'muitas-tentativas' },
      );
    lista.push(agora);
    this.taxa.set(ip, lista);
    if (this.taxa.size > 10_000) this.taxa.delete(this.taxa.keys().next().value as string);
  }

  private trilha(
    hospital: string,
    d: {
      evento: string;
      operacao: string;
      tabela: string | null;
      id: number | string | null;
      resultado?: 'sucesso' | 'falha';
      usuario?: string;
      paciente?: number | null;
      chave?: string | null;
      estacao?: string;
      origem?: string | null;
      correlacao?: string;
    },
  ): RegistroTrilhaPortal {
    return {
      rede: this.cfg.rede,
      hospital,
      usuario: (d.usuario ?? USUARIO_PORTAL).slice(0, 31),
      evento: d.evento,
      recurso: CHAVE_PORTAL_CONTA,
      operacao: d.operacao,
      tabelaAlvo: d.tabela,
      idAlvo: d.id === null ? null : String(d.id),
      chaveNaturalAlvo: d.chave ?? null,
      resultado: d.resultado ?? 'sucesso',
      estacao: (d.estacao ?? 'SGH-PORTAL').slice(0, 80),
      correlacao: d.correlacao ?? `portal-${randomBytes(6).toString('hex')}`,
      origem: d.origem ?? null,
      idPaciente: d.paciente ?? null,
    };
  }

  private async gravar<T>(
    c: ContextoPortal,
    fn: (g: GravadorPortal) => Promise<T>,
    trilha: RegistroTrilhaPortal | ((r: T) => RegistroTrilhaPortal | null) | null,
  ): Promise<T> {
    try {
      return await this.porta.gravar(c, fn, trilha);
    } catch (e) {
      return traduzir(e);
    }
  }

  // ── Sessão do portal ─────────────────────────────────────────────────────────────────────────────────────────────

  private async minutosSessao(hospital: string): Promise<number> {
    return this.param(hospital, 'portal.sessaoMinutos', 20);
  }

  private async idadeContaPropria(hospital: string): Promise<number> {
    return this.param(hospital, 'portal.idadeContaPropria', 18);
  }

  /** Os titulares que a conta pode ver hoje: o próprio (com idade de conta própria) e os representados vigentes. */
  private async titulares(c: ContextoPortal, conta: ContaPortal): Promise<TitularInterno[]> {
    const hoje = dia(this.agora());
    const idade = await this.idadeContaPropria(c.hospital);
    const r: TitularInterno[] = [];
    if (conta.tipo === 'paciente' && conta.paciente !== null) {
      const p = await this.porta.paciente(c, conta.paciente);
      const i = idadeEm(p?.nascimento ?? null, hoje);
      if (p && p.ativo && !p.obito && i !== null && i >= idade)
        r.push({
          vinculo: null,
          paciente: p.id,
          prontuario: p.prontuario,
          nascimento: p.nascimento,
          primeiroNome: p.primeiroNome,
          idade: i,
          escopos: ['agendamentos', 'consentimentos', 'documentos', 'pedidos'],
        });
    }
    for (const v of await this.porta.vinculosDaConta(c, conta.id)) {
      if (v.situacao !== 'ativo') continue;
      const p = await this.porta.paciente(c, v.titular);
      if (!p) continue;
      const titular = { nascimento: p.nascimento, obito: p.obito, ativo: p.ativo };
      const regra = {
        tipo: v.tipo as TipoVinculoResponsavel,
        situacao: v.situacao,
        validade: v.validade,
        escopos: v.escopos as EscopoVinculo[],
      };
      if (!vigenciaDoVinculo(regra, titular, hoje, idade).vigente) continue;
      r.push({
        vinculo: String(v.id),
        paciente: p.id,
        prontuario: p.prontuario,
        nascimento: p.nascimento,
        primeiroNome: p.primeiroNome,
        idade: idadeEm(p.nascimento, hoje),
        escopos: [...(v.escopos as EscopoVinculo[])].sort(),
      });
    }
    return r;
  }

  private nomeDaConta(conta: ContaPortal, titulares: readonly TitularInterno[], p: PacientePortal | null) {
    if (conta.tipo === 'responsavel') return primeiroNome(conta.nome);
    return p?.primeiroNome ?? titulares.find((t) => t.vinculo === null)?.primeiroNome ?? '';
  }

  private visao(n: PortalNoPedido, nome: string): SessaoContaPortal {
    const semDetalhe = (t: TitularInterno): TitularDaSessao => ({
      vinculo: t.vinculo,
      primeiroNome: t.primeiroNome,
      idade: t.idade,
      escopos: t.escopos,
    });
    return {
      hospital: n.c.hospital,
      primeiroNome: nome,
      ativo: semDetalhe(n.ativo),
      titulares: n.titulares.map(semDetalhe),
      expiraEm: new Date(n.s.expira).toISOString(),
      soResponsavel: !n.titulares.some((t) => t.vinculo === null),
    };
  }

  private async abrirSessao(hospital: string, conta: ContaPortal): Promise<SessaoAberta> {
    const minutos = await this.minutosSessao(hospital);
    const id = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const s: SessaoPortalInterna = {
      id,
      csrf,
      hospital,
      conta: conta.id,
      expira: this.agora().getTime() + minutos * 60_000,
      ativo: null,
      provas: new Map(),
    };
    this.sessoes.set(id, s);
    const n = await this.resolver(s);
    return { id, csrf, ttlSegundos: minutos * 60, sessao: await this.eu(n) };
  }

  /** A sessão do portal pelo cookie (401 sem ela); nas escritas, o CSRF por token duplo; expira por inatividade. */
  async sessao(
    id: string | null,
    csrf?: { cookie: string | null; cabecalho: string | null },
  ): Promise<PortalNoPedido> {
    const s = id ? this.sessoes.get(id) : undefined;
    const agora = this.agora().getTime();
    if (!s || s.expira < agora) {
      if (id) this.sessoes.delete(id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'Sua sessão terminou por segurança. Entre de novo.',
        { codigo: 'sessao-encerrada' },
      );
    }
    if (csrf && (!csrf.cookie || csrf.cookie !== csrf.cabecalho || csrf.cabecalho !== s.csrf))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Requisição não autenticada (CSRF)',
        'Recarregue a página e tente de novo.',
        { codigo: 'csrf' },
      );
    await this.exigirLigado(s.hospital);
    s.expira = agora + (await this.minutosSessao(s.hospital)) * 60_000;
    return this.resolver(s);
  }

  private async resolver(s: SessaoPortalInterna): Promise<PortalNoPedido> {
    const c = await this.porta.contexto(this.ctx(s.hospital));
    const conta = await this.porta.conta(c, s.conta);
    // A conta bloqueada ou encerrada depois da entrada derruba a sessão na hora.
    if (!conta || conta.situacao !== 'ativa' || (conta.bloqueadoAte && conta.bloqueadoAte > this.agora())) {
      this.sessoes.delete(s.id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Sessão do portal encerrada',
        'Entre de novo no portal.',
        { codigo: 'sessao-encerrada' },
      );
    }
    const titulares = await this.titulares(c, conta);
    let ativo = titulares.find((t) => t.vinculo === s.ativo) ?? titulares[0];
    if (!ativo) {
      // Conta só de responsável sem representado vigente: a sessão vale para pedir o vínculo (sem dados de ninguém).
      ativo = {
        vinculo: null,
        paciente: 0,
        prontuario: 0,
        nascimento: null,
        primeiroNome: primeiroNome(conta.nome),
        idade: null,
        escopos: [],
      };
    }
    s.ativo = ativo.vinculo;
    return { s, c, conta, titulares, ativo };
  }

  async eu(n: PortalNoPedido): Promise<SessaoContaPortal> {
    const p = n.conta.paciente !== null ? await this.porta.paciente(n.c, n.conta.paciente) : null;
    return this.visao(n, this.nomeDaConta(n.conta, n.titulares, p));
  }

  sair(id: string | null): void {
    if (id) this.sessoes.delete(id);
  }

  async escolherTitular(n: PortalNoPedido, vinculo: string | null): Promise<SessaoContaPortal> {
    const t = n.titulares.find((x) => x.vinculo === vinculo);
    if (!t) naoEncontrado('Pessoa não encontrada', 'Você não tem acesso aos dados desta pessoa.');
    n.s.ativo = vinculo;
    return this.eu(await this.resolver(n.s));
  }

  /** Etapa 2 (agenda, pré-check-in, pagamento e pesquisa): o titular escolhido, se o acesso inclui o escopo (403). */
  titularComEscopo(n: PortalNoPedido, escopo: EscopoVinculo): TitularInterno {
    return this.exigirEscopo(n, escopo);
  }

  get rede(): string {
    return this.cfg.rede;
  }

  private exigirEscopo(n: PortalNoPedido, escopo: EscopoVinculo): TitularInterno {
    if (n.ativo.paciente === 0 || !podeAgir(n.titulares, n.ativo.vinculo, escopo))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem acesso',
        'O seu acesso a esta pessoa não inclui esta ação.',
        { codigo: 'sem-escopo' },
      );
    return n.ativo;
  }

  // ── Primeiro acesso: convite, dados e segundo fator ──────────────────────────────────────────────────────────────

  private async nascimentoDaConta(c: ContextoPortal, k: ContaPortal): Promise<string | null> {
    if (k.tipo === 'responsavel') return k.nascimento;
    const p = k.paciente !== null ? await this.porta.paciente(c, k.paciente) : null;
    return p && p.ativo && !p.obito ? p.nascimento : null;
  }

  /** Passo 1: o código do convite e a data de nascimento (erro único e genérico; limite por convite e por origem). */
  async conferirConvite(hospital: string, e: ConferirConvite, ip: string): Promise<AtivacaoAberta> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const c = this.ctx(hospital);
    const k = await this.porta.contaPorConvite(c, resumoConvite(e.codigo));
    const limite = await this.param(hospital, 'portal.tentativas', 5);
    const convidada = k !== null && k.situacao === 'convidada';
    const nascimento = convidada ? await this.nascimentoDaConta(c, k) : null;
    const r = conferirAtivacao(
      convidada && k.conviteValidoAte
        ? { validoAte: k.conviteValidoAte, usadoEm: k.conviteUsadoEm, erradas: k.conviteErradas }
        : null,
      nascimento,
      e.nascimento,
      this.agora(),
      limite,
    );
    if (r !== null) {
      if (convidada && r === 'convite-invalido')
        await this.gravar(
          c,
          (g) => g.registrarErroConvite(k.id),
          this.trilha(hospital, {
            evento: EVENTOS_AUDITAVEIS.portalLogin.codigo,
            operacao: 'portal.criarConta',
            tabela: 'conta_portal_paciente',
            id: k.id,
            resultado: 'falha',
            estacao: ipParaGravar(ip),
          }),
        );
      return conviteGenerico();
    }
    const id = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    this.ativacoes.set(id, {
      id,
      csrf,
      hospital,
      conta: k!.id,
      versao: k!.versao,
      expira: this.agora().getTime() + ATIVACAO_MINUTOS * 60_000,
      tentativas: 0,
      dados: null,
    });
    if (this.ativacoes.size > 5_000) this.ativacoes.delete(this.ativacoes.keys().next().value as string);
    return { id, csrf, ttlSegundos: ATIVACAO_MINUTOS * 60 };
  }

  private ativacao(
    id: string | null,
    csrf: { cookie: string | null; cabecalho: string | null },
  ): AtivacaoInterna {
    const a = id ? this.ativacoes.get(id) : undefined;
    if (!a || a.expira < this.agora().getTime()) {
      if (id) this.ativacoes.delete(id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Primeiro acesso encerrado',
        'O tempo do primeiro acesso acabou. Comece de novo pelo convite.',
        { codigo: 'ativacao-encerrada' },
      );
    }
    if (!csrf.cookie || csrf.cookie !== csrf.cabecalho || csrf.cabecalho !== a.csrf)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Requisição não autenticada (CSRF)',
        'Recarregue a página e tente de novo.',
        { codigo: 'csrf' },
      );
    return a;
  }

  /** Passo 2: e-mail, senha e os termos; o segredo do autenticador sai UMA vez (o endereço otpauth para o QR). */
  async iniciarAtivacao(
    id: string | null,
    csrf: { cookie: string | null; cabecalho: string | null },
    e: AtivarContaPortal,
  ): Promise<AtivacaoIniciada> {
    const a = this.ativacao(id, csrf);
    const c = this.ctx(a.hospital);
    const k = await this.porta.conta(c, a.conta);
    if (!k || k.situacao !== 'convidada' || k.conviteResumo !== resumoConvite(e.codigo))
      return conviteGenerico();
    if ((await this.nascimentoDaConta(c, k)) !== e.nascimento) return conviteGenerico();
    if (e.termoUso !== VERSAO_TERMO_USO || e.politicaPrivacidade !== VERSAO_POLITICA)
      recusa(
        'termo-desatualizado',
        'O termo de uso ou a política mudou. Recarregue a página e leia a versão nova.',
      );
    const usuario = e.email.split('@')[0] ?? '';
    if (e.senha.length < 8 || (usuario.length >= 3 && e.senha.toLowerCase().includes(usuario)))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Senha fraca',
        'Use pelo menos 8 caracteres, sem repetir o seu e-mail.',
        { codigo: 'senha-fraca', campos: ['senha'] },
      );
    const outra = await this.porta.contaPorEmail(c, resumoEmail(e.email));
    if (outra && outra.id !== k.id)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'E-mail indisponível',
        'Não foi possível usar este e-mail. Use outro.',
        {
          codigo: 'email-em-uso',
        },
      );
    if (!this.cfg.chaveMestra)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cadastro indisponível',
        'O segundo fator não está configurado neste ambiente.',
        { codigo: 'sem-segundo-fator' },
      );
    const segredo = gerarSegredoBase32();
    a.dados = {
      email: e.email,
      senhaResumo: await cifrarSenha(e.senha),
      segredo,
      termoUso: e.termoUso,
      politica: e.politicaPrivacidade,
    };
    return {
      metodo: 'totp',
      otpauth: uriOtpauth(mascararEmail(e.email) ?? 'conta', this.cfg.produto, segredo),
    };
  }

  /** Passo 3: o primeiro código do autenticador confirma o segundo fator; só então a conta fica ativa e a sessão abre. */
  async confirmarSegundoFator(
    id: string | null,
    csrf: { cookie: string | null; cabecalho: string | null },
    e: ConfirmarSegundoFator,
  ): Promise<SessaoAberta> {
    const a = this.ativacao(id, csrf);
    if (!a.dados || !this.cfg.chaveMestra) return conviteGenerico();
    const passo = passoTotpConferido(a.dados.segredo, e.codigo, this.agora().getTime());
    if (passo === null) {
      a.tentativas++;
      if (a.tentativas >= TENTATIVAS_SEGUNDO_FATOR) this.ativacoes.delete(a.id);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Código não confere',
        'Confira o código no aplicativo e digite de novo.',
        { codigo: 'codigo-invalido' },
      );
    }
    const c = this.ctx(a.hospital);
    const dados = a.dados;
    await this.gravar(
      c,
      (g) =>
        g.ativar(a.conta, a.versao, {
          email: dados.email,
          emailResumo: resumoEmail(dados.email),
          senhaResumo: dados.senhaResumo,
          segundoFator: cifrarSegredo(dados.segredo, this.cfg.chaveMestra as Buffer),
          termoUso: dados.termoUso,
          politica: dados.politica,
        }),
      this.trilha(a.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalContaAtivada.codigo,
        operacao: 'portal.criarConta',
        tabela: 'conta_portal_paciente',
        id: a.conta,
        usuario: quemDaConta(a.conta),
        chave: `${VERSAO_TERMO_USO}:${VERSAO_POLITICA}`,
      }),
    );
    this.ativacoes.delete(a.id);
    // O código da ativação também não vale de novo na entrada.
    this.passosTotp.set(`${a.hospital}:${a.conta}`, passo);
    const k = await this.porta.conta(c, a.conta);
    if (!k) return conviteGenerico();
    return this.abrirSessao(a.hospital, k);
  }

  // ── Entrada ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * O código do autenticador confere e ainda não foi usado: o passo aceito fica guardado por conta e um passo menor ou
   * igual ao último é recusado (o mesmo código não entra duas vezes na janela de tolerância). Em memória, como as
   * sessões do portal.
   */
  private segundoFatorConfere(
    hospital: string,
    conta: number,
    envelope: string | null,
    codigo: string,
  ): boolean {
    if (!this.cfg.chaveMestra || !envelope) return false;
    let passo: number | null;
    try {
      passo = passoTotpConferido(
        decifrarSegredo(envelope, this.cfg.chaveMestra),
        codigo,
        this.agora().getTime(),
      );
    } catch {
      return false;
    }
    if (passo === null) return false;
    const chave = `${hospital}:${conta}`;
    const ultimo = this.passosTotp.get(chave);
    if (ultimo !== undefined && passo <= ultimo) return false;
    this.passosTotp.delete(chave);
    this.passosTotp.set(chave, passo);
    if (this.passosTotp.size > 10_000) this.passosTotp.delete(this.passosTotp.keys().next().value as string);
    return true;
  }

  async entrar(hospital: string, e: EntrarContaPortal, ip: string): Promise<SessaoAberta> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const c = this.ctx(hospital);
    const k = await this.porta.contaPorEmail(c, resumoEmail(e.email));
    // A senha é conferida mesmo sem conta (tempo constante: não revela se o e-mail tem conta).
    const senhaOk = await conferirSenha(e.senha, k?.senhaResumo ?? null);
    if (!k || (k.situacao !== 'ativa' && k.situacao !== 'bloqueada')) return generica();
    const agora = this.agora();
    if (k.bloqueadoAte && k.bloqueadoAte > agora) {
      const minutos = Math.max(1, Math.ceil((k.bloqueadoAte.getTime() - agora.getTime()) / 60_000));
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Acesso bloqueado por um tempo',
        `Muitas tentativas. Tente de novo em ${minutos} minutos.`,
        { codigo: 'bloqueio-temporario' },
      );
    }
    const acertou = senhaOk && this.segundoFatorConfere(hospital, k.id, k.segundoFator, e.codigo);
    const limite = await this.param(hospital, 'portal.tentativas', 5);
    const minutos = await this.param(hospital, 'portal.bloqueioMinutos', 15);
    const tentativas = acertou ? 0 : k.tentativas + 1;
    const b = bloqueioPorTentativas(tentativas, limite, agora, minutos);
    if (k.situacao === 'ativa')
      await this.gravar(
        c,
        (g) =>
          g.registrarEntrada(k.id, { acertou, tentativas: b.bloquear ? 0 : tentativas, bloqueadoAte: b.ate }),
        this.trilha(hospital, {
          evento: EVENTOS_AUDITAVEIS.portalLogin.codigo,
          operacao: 'portal.entrar',
          tabela: 'conta_portal_paciente',
          id: k.id,
          resultado: acertou ? 'sucesso' : 'falha',
          usuario: quemDaConta(k.id),
          estacao: ipParaGravar(ip),
        }),
      );
    if (!acertou) return generica();
    if (k.situacao === 'bloqueada')
      throw new ErroProblema(
        'recusa-de-negocio',
        403,
        'Conta bloqueada',
        'A sua conta está bloqueada. Procure a recepção do hospital.',
        {
          codigo: 'conta-bloqueada',
        },
      );
    const atual = await this.porta.conta(c, k.id);
    return this.abrirSessao(hospital, atual ?? k);
  }

  /** Trocar a senha: a atual e o código do autenticador conferidos de novo. */
  async trocarSenha(n: PortalNoPedido, e: TrocarSenhaPortal): Promise<void> {
    const ok =
      (await conferirSenha(e.atual, n.conta.senhaResumo)) &&
      this.segundoFatorConfere(n.c.hospital, n.conta.id, n.conta.segundoFator, e.codigo);
    if (!ok)
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Dados não conferem',
        'A senha atual ou o código não conferem.',
        { codigo: 'dados-nao-conferem' },
      );
    if (e.nova.length < 8)
      throw new ErroProblema('entrada-invalida', 400, 'Senha fraca', 'Use pelo menos 8 caracteres.', {
        codigo: 'senha-fraca',
        campos: ['nova'],
      });
    const resumo = await cifrarSenha(e.nova);
    await this.gravar(
      n.c,
      (g) => g.trocarSenha(n.conta.id, n.conta.versao, resumo),
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalSegundoFatorTrocado.codigo,
        operacao: 'portal.trocarSenha',
        tabela: 'conta_portal_paciente',
        id: n.conta.id,
        usuario: quemDaConta(n.conta.id),
        chave: 'senha',
      }),
    );
    // A senha nova encerra as outras sessões abertas da conta (fica só a de quem trocou).
    for (const s of this.sessoes.values())
      if (s.conta === n.conta.id && s.hospital === n.c.hospital && s.id !== n.s.id) this.sessoes.delete(s.id);
  }

  // ── W0-10: troca do e-mail de acesso e do autenticador ───────────────────────────────────────────────────────────

  /** A senha atual e o código do autenticador atual conferidos de novo (quem pede a troca é o titular da conta). */
  private async conferirCredenciais(n: PortalNoPedido, e: ConferirCredenciaisPortal): Promise<void> {
    const ok =
      (await conferirSenha(e.senha, n.conta.senhaResumo)) &&
      this.segundoFatorConfere(n.c.hospital, n.conta.id, n.conta.segundoFator, e.codigo);
    if (!ok)
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Dados não conferem',
        'A senha atual ou o código não conferem.',
        {
          codigo: 'dados-nao-conferem',
        },
      );
  }

  private encerrarSessoes(hospital: string, conta: number, manter: string | null = null): void {
    for (const s of this.sessoes.values())
      if (s.conta === conta && s.hospital === hospital && s.id !== manter) this.sessoes.delete(s.id);
  }

  /**
   * Abre o pedido da troca do e-mail e manda o link ao e-mail NOVO pelo canal (simulador no dev, Hal-AI fora dele). O
   * pedido só é gravado se o canal puder enviar; o pendente anterior da conta é cancelado na mesma transação.
   */
  private async abrirTrocaEmail(
    c: ContextoPortal,
    k: ContaPortal,
    d: {
      email: string;
      origem: 'portal' | 'balcao';
      motivo: string;
      por: string;
      trilha: RegistroTrilhaPortal;
    },
  ): Promise<TrocaEmailPedida> {
    if (k.situacao !== 'ativa' && k.situacao !== 'bloqueada')
      recusa('conta-nao-ativa', 'Só a conta ativa (ou bloqueada) troca o e-mail de acesso.');
    const resumo = resumoEmail(d.email);
    if (resumo === k.emailResumo) recusa('mesmo-email', 'O e-mail novo é igual ao atual.');
    const outra = await this.porta.contaPorEmail(c, resumo);
    if (outra && outra.id !== k.id)
      traduzir(new ErroPortal('email-em-uso', 'E-mail já usado em outra conta.'));
    const canal = await this.canal.disponivel(c.hospital);
    if (!canal.envio)
      return recusa('canal-desligado', canal.motivo ?? 'O envio ao paciente está desligado.', 503);
    const token = randomBytes(32).toString('base64url');
    const horas = await this.param(c.hospital, 'portal.trocaEmailValidadeHoras', 24);
    const validoAte = new Date(this.agora().getTime() + horas * 3_600_000);
    const envio = canal.envio;
    await this.gravar(
      c,
      (g) =>
        g.pedirTrocaEmail({
          conta: k.id,
          emailNovo: d.email,
          emailNovoResumo: resumo,
          tokenResumo: sha256(token),
          validoAte,
          origem: d.origem,
          motivo: d.motivo,
          pedidoPor: d.por,
          envio,
        }),
      d.trilha,
    );
    const caminho = `/paciente/email/confirmar?h=${encodeURIComponent(c.hospital)}&t=${token}`;
    await this.canal.enviar({
      rede: c.rede,
      hospital: c.hospital,
      conta: k.id,
      tipo: 'confirmacao-email',
      destino: d.email,
      link: `${(this.cfg.enderecoPublico ?? '').replace(/\/$/, '')}${caminho}`,
      validoAte: validoAte.toISOString(),
    });
    return {
      envio,
      emailMascarado: mascararEmail(d.email),
      validoAte: validoAte.toISOString(),
      origem: d.origem,
    };
  }

  /** O paciente pede a troca do e-mail (senha e código atuais); a conta segue com o e-mail antigo até a confirmação. */
  async pedirTrocaEmail(n: PortalNoPedido, e: PedirTrocaEmailPortal): Promise<TrocaEmailPedida> {
    await this.conferirCredenciais(n, e);
    return this.abrirTrocaEmail(n.c, n.conta, {
      email: e.email,
      origem: 'portal',
      motivo: 'pedido-do-titular',
      por: quemDaConta(n.conta.id),
      trilha: this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalEmailTrocaPedida.codigo,
        operacao: 'portal.trocarEmail',
        tabela: 'conta_portal_paciente',
        id: n.conta.id,
        usuario: quemDaConta(n.conta.id),
        chave: 'portal:pedido-do-titular',
      }),
    });
  }

  /** O pedido pendente da conta (a tela mostra para onde foi o link e até quando vale). */
  async trocaEmailPendente(c: ContextoPortal, conta: number): Promise<TrocaEmailPedida | null> {
    const t = await this.porta.trocaEmailPendente(c, conta);
    if (!t || t.validoAte <= this.agora()) return null;
    return {
      envio: t.envio,
      emailMascarado: mascararEmail(t.emailNovo),
      validoAte: t.validoAte.toISOString(),
      origem: t.origem,
    };
  }

  /** O paciente desiste do pedido pendente (fica cancelado; nada é apagado). */
  async cancelarTrocaEmail(n: PortalNoPedido): Promise<void> {
    const t = await this.porta.trocaEmailPendente(n.c, n.conta.id);
    if (!t) return naoEncontrado('Nenhuma troca de e-mail pendente');
    await this.gravar(
      n.c,
      (g) => g.cancelarTrocaEmail(t.id),
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalEmailTrocaPedida.codigo,
        operacao: 'portal.trocarEmail',
        tabela: 'conta_portal_paciente',
        id: n.conta.id,
        usuario: quemDaConta(n.conta.id),
        chave: 'cancelada',
      }),
    );
  }

  /**
   * O link do e-mail novo confirmado (rota pública, com a taxa por origem): a conta passa ao e-mail novo e as sessões
   * abertas dela são encerradas. O link usado, cancelado ou vencido não vale (410).
   */
  async confirmarTrocaEmail(
    hospital: string,
    e: ConfirmarTrocaEmailPortal,
    ip: string,
  ): Promise<{ emailMascarado: string | null }> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const c = this.ctx(hospital);
    const t = await this.porta.trocaEmailPorToken(c, sha256(e.token));
    if (!t || t.situacao !== 'pendente' || t.validoAte <= this.agora())
      return recusa(
        'link-invalido',
        'Este link de confirmação não vale mais. Peça a troca do e-mail de novo.',
        410,
      );
    const k = await this.porta.conta(c, t.conta);
    if (!k) return naoEncontrado('Conta não encontrada');
    await this.gravar(
      c,
      (g) => g.confirmarTrocaEmail(t.id, k.id, k.versao, { email: t.emailNovo, resumo: t.emailNovoResumo }),
      this.trilha(hospital, {
        evento: EVENTOS_AUDITAVEIS.portalEmailTrocado.codigo,
        operacao: 'portal.trocarEmail',
        tabela: 'conta_portal_paciente',
        id: k.id,
        usuario: quemDaConta(k.id),
        paciente: k.paciente,
        chave: `confirmada:${t.origem}`,
        estacao: ipParaGravar(ip),
      }),
    );
    this.encerrarSessoes(hospital, k.id);
    return { emailMascarado: mascararEmail(t.emailNovo) };
  }

  /** Troca do autenticador, passo 1: senha e código atuais; o segredo novo sai uma vez (o otpauth para o QR). */
  async iniciarTrocaSegundoFator(n: PortalNoPedido, e: ConferirCredenciaisPortal): Promise<AtivacaoIniciada> {
    await this.conferirCredenciais(n, e);
    const segredo = gerarSegredoBase32();
    this.trocasSegundoFator.set(`${n.c.hospital}:${n.conta.id}`, {
      segredo,
      expira: this.agora().getTime() + TROCA_SEGUNDO_FATOR_MINUTOS * 60_000,
      tentativas: 0,
    });
    return {
      metodo: 'totp',
      otpauth: uriOtpauth(mascararEmail(n.conta.email) ?? 'conta', this.cfg.produto, segredo),
    };
  }

  /** Troca do autenticador, passo 2: o primeiro código do aplicativo novo; só então o segredo novo vale. */
  async confirmarTrocaSegundoFator(n: PortalNoPedido, e: ConfirmarSegundoFator): Promise<void> {
    const chave = `${n.c.hospital}:${n.conta.id}`;
    const p = this.trocasSegundoFator.get(chave);
    if (!p || p.expira <= this.agora().getTime() || !this.cfg.chaveMestra) {
      this.trocasSegundoFator.delete(chave);
      return recusa('troca-expirada', 'A troca do autenticador expirou. Comece de novo.', 410);
    }
    const passo = passoTotpConferido(p.segredo, e.codigo, this.agora().getTime());
    if (passo === null) {
      p.tentativas++;
      if (p.tentativas >= TENTATIVAS_SEGUNDO_FATOR) this.trocasSegundoFator.delete(chave);
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Código não confere',
        'Confira o código no aplicativo novo.',
        {
          codigo: 'codigo-invalido',
        },
      );
    }
    const envelope = cifrarSegredo(p.segredo, this.cfg.chaveMestra);
    await this.gravar(
      n.c,
      (g) => g.trocarSegundoFator(n.conta.id, n.conta.versao, envelope),
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalSegundoFatorTrocado.codigo,
        operacao: 'portal.trocarSegundoFator',
        tabela: 'conta_portal_paciente',
        id: n.conta.id,
        usuario: quemDaConta(n.conta.id),
        chave: 'autenticador',
      }),
    );
    this.trocasSegundoFator.delete(chave);
    this.passosTotp.set(chave, passo);
    this.encerrarSessoes(n.c.hospital, n.conta.id, n.s.id);
  }

  /** O e-mail mascarado e o último acesso (tela Conta e segurança). */
  async seguranca(n: PortalNoPedido): Promise<{
    emailMascarado: string | null;
    ultimoAcessoEm: string | null;
    ativadaEm: string | null;
    trocaEmail: TrocaEmailPedida | null;
  }> {
    return {
      emailMascarado: mascararEmail(n.conta.email),
      ultimoAcessoEm: iso(n.conta.ultimoAcessoEm),
      ativadaEm: iso(n.conta.ativadaEm),
      trocaEmail: await this.trocaEmailPendente(n.c, n.conta.id),
    };
  }

  // ── Resultados e documentos ──────────────────────────────────────────────────────────────────────────────────────

  private async nivelMinimo(hospital: string): Promise<NivelAssinaturaDocumento> {
    const v = await parametroTexto(
      this.configuracao,
      this.cfg.rede,
      hospital,
      'portal.nivelMinimoAssinatura',
    );
    return v === 'eletronica-avancada' ? 'eletronica-avancada' : 'icp-brasil';
  }

  private async vistos(c: ContextoPortal, paciente: number): Promise<Set<string>> {
    const hoje = this.agora();
    const de = dia(new Date(hoje.getTime() - (JANELA_RELATORIO_ACESSOS_DIAS - 1) * 86_400_000));
    const r = await this.porta.leituras(
      c,
      paciente,
      [EVENTOS_AUDITAVEIS.portalDocumentoVisto.codigo],
      de,
      dia(hoje),
    );
    return new Set(r.itens.map((l) => l.idAlvo ?? '').filter((x) => x.length > 0));
  }

  async documentos(n: PortalNoPedido, pagina: number): Promise<ListaDocumentosPortal> {
    const t = this.exigirEscopo(n, 'documentos');
    const itens: ItemDocumentoPortal[] = [];
    let haMais = false;
    if (this.sadt && pagina === 1) {
      const cn = await this.porta.contexto(n.c);
      const atos = await this.sadt.atosPublicados(cn);
      const r = await this.sadt.laudosPortalDoPaciente(cn, { paciente: t.paciente, reg: null, atos });
      haMais ||= r.cortada;
      for (const l of r.laudos)
        itens.push({
          origem: 'resultado',
          item: String(l.liberacao),
          titulo: l.nome,
          data: l.liberadoEm || l.data,
          profissional: null,
          assinatura: null,
          visto: l.visualizado,
          verificacao: null,
        });
    }
    const minimo = await this.nivelMinimo(n.c.hospital);
    const docs = await this.porta.documentos(n.c, t.paciente, TIPOS_DOCUMENTO_PORTAL, pagina);
    haMais ||= docs.haMais;
    const vistos = await this.vistos(n.c, t.paciente);
    for (const d of docs.itens)
      if (
        documentoVisivelNoPortal(
          { ...d, eventos: d.eventos, nivelAssinatura: d.nivelAssinatura },
          t.paciente,
          minimo,
        )
      )
        itens.push(this.itemDoDocumento(d, vistos));
    itens.sort((a, b) => b.data.localeCompare(a.data));
    const icpLigada =
      this.porta.destino === 'memoria' && !this.configuracao
        ? true
        : await ligadaNoEstabelecimento(
            this.configuracao,
            this.cfg.rede,
            n.c.hospital,
            'assinatura.icp',
            USUARIO_PORTAL,
            this.agora(),
          );
    return { itens, haMais, semDocumentosAssinados: !icpLigada };
  }

  private itemDoDocumento(
    d: Awaited<ReturnType<PortaPortalPaciente['documentos']>>['itens'][number],
    vistos: Set<string>,
  ): ItemDocumentoPortal {
    return {
      origem: 'documento',
      item: String(d.id),
      titulo: d.tipo,
      data: d.criadoEm,
      profissional: null,
      assinatura:
        (['icp-brasil', 'eletronica-avancada', 'eletronica-simples'] as const).find(
          (x) => x === d.nivelAssinatura,
        ) ?? null,
      visto: vistos.has(String(d.id)),
      verificacao: d.codigoVerificacao,
    };
  }

  private trilhaVisto(
    n: PortalNoPedido,
    t: TitularInterno,
    item: AbrirItemPortal,
    ip: string,
  ): RegistroTrilhaPortal {
    return this.trilha(n.c.hospital, {
      evento: EVENTOS_AUDITAVEIS.portalDocumentoVisto.codigo,
      operacao: item.origem === 'resultado' ? 'sadt.registrarVisualizacaoPortal' : 'portal.abrirDocumento',
      tabela: item.origem === 'resultado' ? 'resultado_exame' : 'documento_assinado',
      id: item.item,
      usuario: quemDaConta(n.conta.id),
      paciente: t.paciente,
      chave: `${item.origem}:${item.baixar ? 'download' : 'visualizacao'}`,
      estacao: ipParaGravar(ip),
    });
  }

  /** O resultado aberto: o dono e o setor publicado conferidos; a visualização gravada pela receita do M26. */
  async abrirResultado(n: PortalNoPedido, item: AbrirItemPortal, ip: string): Promise<LaudoPortalAberto> {
    const t = this.exigirEscopo(n, 'documentos');
    if (!this.sadt) return naoEncontrado('Resultado não encontrado');
    const sadt = this.sadt;
    const liberacao = Number(item.item);
    const cn = await this.porta.contexto(n.c);
    const l = await sadt.laudoPortal(cn, liberacao);
    const atos = await sadt.atosPublicados(cn);
    if (!l || l.paciente !== t.paciente || !atos.includes(l.ato))
      return naoEncontrado('Resultado não encontrado', 'O resultado não está disponível para este acesso.');
    const acao = item.baixar ? 'download' : 'visualizacao';
    if (!l.laudo.visualizado)
      await sadt
        .executar(
          cn,
          'sadt.registrarVisualizacaoPortal',
          { liberacao, ip: ipParaGravar(ip), acao },
          {
            ...cn,
            correlacao: `portal-paciente-${liberacao}`.slice(0, 64),
            chaveIdempotencia: `portal-conta-${n.conta.id}-${liberacao}-${acao}`.slice(0, 80),
          },
        )
        .catch((e: unknown) => {
          // Já registrada por outra aba (ou pelo portal do outro sistema): a leitura segue.
          if (e instanceof ErroOperacao && e.problema.codigo === 'ja-visto') return null;
          throw e;
        });
    await this.gravar(n.c, async () => null, this.trilhaVisto(n, t, item, ip));
    // M47 (etapa 3): o link das imagens do exame, como no portal de resultados (estudo concluído no PACS).
    const imagem = this.imagens ? await this.imagens(n.c, l.laudo.exame) : null;
    return {
      laudo: { ...l.laudo, visualizado: true, paciente: null },
      valores: l.valores,
      texto: l.texto,
      imagem,
    };
  }

  private async documentoVisivel(n: PortalNoPedido, t: TitularInterno, id: number) {
    const minimo = await this.nivelMinimo(n.c.hospital);
    const r = await this.porta.documentos(n.c, t.paciente, TIPOS_DOCUMENTO_PORTAL, 1, id);
    const d = r.itens.find((x) => x.id === id);
    if (!d || !documentoVisivelNoPortal(d, t.paciente, minimo))
      return naoEncontrado('Documento não encontrado', 'O documento não está disponível para este acesso.');
    return d;
  }

  /** O documento aberto (o que a tela mostra) e a visualização na trilha (PORTAL_DOCUMENTO_VISTO). */
  async abrirDocumento(n: PortalNoPedido, item: AbrirItemPortal, ip: string): Promise<DocumentoPortalAberto> {
    const t = this.exigirEscopo(n, 'documentos');
    const d = await this.documentoVisivel(n, t, Number(item.item));
    await this.gravar(n.c, async () => null, this.trilhaVisto(n, t, { ...item, baixar: false }, ip));
    return {
      item: { ...this.itemDoDocumento(d, new Set()), visto: true },
      temPdf: d.assinaturaIcp !== null && this.pdfAssinado !== null,
    };
  }

  /** O PDF assinado do documento (o mesmo que se valida fora); o download vai à trilha. */
  async pdfDoDocumento(n: PortalNoPedido, id: number, ip: string): Promise<Uint8Array> {
    const t = this.exigirEscopo(n, 'documentos');
    const d = await this.documentoVisivel(n, t, id);
    if (d.assinaturaIcp === null || !this.pdfAssinado)
      recusa('sem-pdf', 'Este documento ainda não tem o arquivo assinado para baixar.');
    const pdf = await this.pdfAssinado!(n.c, d.assinaturaIcp!).catch(() =>
      recusa(
        'pdf-indisponivel',
        'O arquivo assinado não está disponível agora. Tente de novo em instantes.',
        503,
      ),
    );
    await this.gravar(
      n.c,
      async () => null,
      this.trilhaVisto(n, t, { origem: 'documento', item: String(id), baixar: true }, ip),
    );
    return pdf;
  }

  // ── Responsáveis ─────────────────────────────────────────────────────────────────────────────────────────────────

  private async resumoVinculo(
    c: ContextoPortal,
    v: VinculoPortal,
    outro: string,
    idade: number,
  ): Promise<VinculoResumo> {
    const titular = await this.porta.paciente(c, v.titular);
    const termina = terminoDoVinculo(
      { tipo: v.tipo as TipoVinculoResponsavel, validade: v.validade },
      titular?.nascimento ?? null,
      idade,
    );
    return {
      vinculo: String(v.id),
      tipo: v.tipo as VinculoResumo['tipo'],
      prova: v.prova as VinculoResumo['prova'],
      situacao: v.situacao,
      escopos: v.escopos as EscopoVinculo[],
      pedidoEm: v.pedidoEm.toISOString(),
      decididoEm: iso(v.decididoEm),
      validade: v.validade,
      terminaEm: termina,
      motivoFim: (v.motivoFim as VinculoResumo['motivoFim']) ?? null,
      primeiroNomeOutro: outro,
    };
  }

  /**
   * O vínculo chegou a ser aprovado (ativo, ou encerrado depois da decisão)? Só então quem pediu vê o primeiro nome do
   * titular: o pedido pendente ou recusado não confirma o cadastro de outra pessoa. O pedido encerrado sem decisão
   * recebe a decisão no mesmo instante do fim (UPDATE do banco).
   */
  private foiAprovado(v: VinculoPortal): boolean {
    if (v.situacao === 'ativo') return true;
    if (v.situacao !== 'encerrado' || !v.decididoEm || !v.encerradoEm) return false;
    return v.decididoEm.getTime() < v.encerradoEm.getTime();
  }

  private async nomeDoResponsavel(c: ContextoPortal, conta: number): Promise<string> {
    const k = await this.porta.conta(c, conta);
    if (!k) return '';
    if (k.tipo === 'responsavel') return primeiroNome(k.nome);
    const p = k.paciente !== null ? await this.porta.paciente(c, k.paciente) : null;
    return p?.primeiroNome ?? '';
  }

  async vinculos(
    n: PortalNoPedido,
  ): Promise<{ meus: VinculoResumo[]; deMim: VinculoResumo[]; recusa: string | null }> {
    const idade = await this.idadeContaPropria(n.c.hospital);
    const meus: VinculoResumo[] = [];
    for (const v of await this.porta.vinculosDaConta(n.c, n.conta.id)) {
      const p = this.foiAprovado(v) ? await this.porta.paciente(n.c, v.titular) : null;
      meus.push(await this.resumoVinculo(n.c, v, p?.primeiroNome ?? '', idade));
    }
    const deMim: VinculoResumo[] = [];
    if (n.conta.paciente !== null)
      for (const v of await this.porta.vinculosDoTitular(n.c, n.conta.paciente))
        if (v.conta !== n.conta.id && (v.situacao === 'ativo' || v.situacao === 'pendente'))
          deMim.push(await this.resumoVinculo(n.c, v, await this.nomeDoResponsavel(n.c, v.conta), idade));
    const ultimaRecusa = meus.find((m) => m.situacao === 'recusado');
    const lido = ultimaRecusa ? await this.porta.vinculo(n.c, Number(ultimaRecusa.vinculo)) : null;
    return { meus, deMim, recusa: lido?.motivoRecusa ?? null };
  }

  /** O arquivo da prova (foto ou PDF; tipo conferido pelos primeiros bytes), ao armazenamento de objetos. */
  async enviarProva(n: PortalNoPedido, tipo: string, bytes: Uint8Array): Promise<{ arquivo: string }> {
    const assinaturas: Record<string, number[]> = {
      'image/jpeg': [0xff, 0xd8, 0xff],
      'image/png': [0x89, 0x50, 0x4e, 0x47],
      'application/pdf': [0x25, 0x50, 0x44, 0x46],
    };
    const esperado = assinaturas[tipo] ?? [0];
    if (bytes.length < 16 || bytes.length > 700_000 || !esperado.every((v, i) => bytes[i] === v))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo inválido',
        'Envie uma foto (JPEG ou PNG) ou um PDF de até 700 KB.',
        { codigo: 'arquivo-invalido', campos: ['conteudo'] },
      );
    if (n.s.provas.size >= 10)
      recusa('muitos-arquivos', 'Muitos arquivos nesta sessão. Saia e entre de novo.');
    const chave = await this.provas.guardar(n.c.hospital, tipo, bytes);
    n.s.provas.set(chave, createHash('sha256').update(bytes).digest('hex'));
    return { arquivo: chave };
  }

  /** As recusas da conta na última hora (o pedido de vínculo). */
  private recusasDaConta(n: PortalNoPedido): number[] {
    const agora = this.agora().getTime();
    return (this.recusasVinculo.get(`${n.c.hospital}:${n.conta.id}`) ?? []).filter(
      (x) => agora - x < 3_600_000,
    );
  }

  /**
   * Recusa o pedido de vínculo: conta a recusa da conta, consome o arquivo enviado (cada tentativa pede um envio novo)
   * e grava a falha na SGH_TRILHA (sem o cadastro procurado), antes de responder.
   */
  private async recusarPedidoVinculo(
    n: PortalNoPedido,
    arquivo: string,
    codigo: string,
    mensagem: string,
    ip: string,
  ): Promise<never> {
    const lista = this.recusasDaConta(n);
    lista.push(this.agora().getTime());
    this.recusasVinculo.set(`${n.c.hospital}:${n.conta.id}`, lista);
    if (this.recusasVinculo.size > 10_000)
      this.recusasVinculo.delete(this.recusasVinculo.keys().next().value as string);
    n.s.provas.delete(arquivo);
    await this.gravar(
      n.c,
      async () => null,
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalVinculoPedido.codigo,
        operacao: 'portal.vincularResponsavel',
        tabela: 'conta_portal_paciente_dependente',
        id: null,
        resultado: 'falha',
        usuario: quemDaConta(n.conta.id),
        estacao: ipParaGravar(ip),
        chave: codigo,
      }),
    );
    return recusa(codigo, mensagem);
  }

  /**
   * O pedido de vínculo pelo portal. Não serve de busca de cadastro: limite de taxa por origem, no máximo
   * RECUSAS_VINCULO_POR_HORA recusas por conta (depois, 429 por uma hora), o arquivo consumido em cada recusa, a recusa
   * na SGH_TRILHA, e o primeiro nome do titular só depois da aprovação do hospital.
   */
  async pedirVinculo(n: PortalNoPedido, e: PedirVinculo, ip: string): Promise<VinculoResumo> {
    this.conferirTaxa(`vinculo:${ip}`);
    if (this.recusasDaConta(n).length >= RECUSAS_VINCULO_POR_HORA)
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitas tentativas',
        'Muitos pedidos não conferiram. Tente de novo daqui a uma hora ou procure a recepção do hospital.',
        { codigo: 'muitas-tentativas' },
      );
    const hash = n.s.provas.get(e.arquivo);
    if (!hash)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo não enviado',
        'Envie o documento antes de pedir o acesso.',
        { codigo: 'arquivo-ausente', campos: ['arquivo'] },
      );
    const hoje = dia(this.agora());
    const idade = await this.idadeContaPropria(n.c.hospital);
    const maxDias = await this.param(n.c.hospital, 'portal.procuracaoValidadeMaximaDias', 365);
    const achados = await this.porta.pacientesPorProntuario(n.c, e.prontuario);
    const titular = achados.length === 1 && achados[0]!.nascimento === e.nascimento ? achados[0]! : null;
    if (!titular)
      return this.recusarPedidoVinculo(
        n,
        e.arquivo,
        'titular-inativo',
        mensagemVinculo('titular-inativo'),
        ip,
      );
    const t = titular;
    const existentes = await this.porta.vinculosDaConta(n.c, n.conta.id);
    const r = conferirPedidoVinculo(
      {
        tipo: e.tipo,
        prova: e.prova,
        validade: e.validade,
        paraSiMesmo: n.conta.paciente === t.id,
        jaExiste: existentes.some(
          (v) => v.titular === t.id && (v.situacao === 'pendente' || v.situacao === 'ativo'),
        ),
      },
      { nascimento: t.nascimento, obito: t.obito, ativo: t.ativo && t.unificadoEm === null },
      hoje,
      idade,
      maxDias,
    );
    // Óbito e nascimento ausente dão a mesma resposta do inativo (o portal não revela o cadastro de outra pessoa).
    if (r) {
      // A mensagem do motivo real (como antes); o código do inativo para óbito e nascimento ausente.
      const codigo = r === 'obito' || r === 'sem-nascimento' ? 'titular-inativo' : r;
      return this.recusarPedidoVinculo(n, e.arquivo, codigo, mensagemVinculo(r), ip);
    }
    const por = quemDaConta(n.conta.id);
    const v = await this.gravar(
      n.c,
      (g) =>
        g.pedirVinculo({
          conta: n.conta.id,
          titular: t.id,
          prontuarioTitular: t.prontuario,
          tipo: e.tipo,
          prova: e.prova,
          arquivoChave: e.arquivo,
          arquivoHash: hash,
          validade: e.validade,
          escopos: ESCOPO_PADRAO_VINCULO[e.tipo],
          canal: 'portal',
          por,
          decididoPor: null,
        }),
      (x) =>
        this.trilha(n.c.hospital, {
          evento: EVENTOS_AUDITAVEIS.portalVinculoPedido.codigo,
          operacao: 'portal.vincularResponsavel',
          tabela: 'conta_portal_paciente_dependente',
          id: x.id,
          usuario: por,
          paciente: t.id,
          chave: e.tipo,
        }),
    );
    n.s.provas.delete(e.arquivo);
    const lido = await this.porta.vinculo(n.c, v.id);
    // Pendente: o nome do titular só aparece depois da aprovação do hospital.
    return this.resumoVinculo(n.c, lido!, '', idade);
  }

  /** O titular revoga o acesso de um procurador (curador só por decisão judicial; pai e mãe acabam na maioridade). */
  async revogarVinculo(n: PortalNoPedido, vinculo: number): Promise<void> {
    const v = await this.porta.vinculo(n.c, vinculo);
    if (!v || n.conta.paciente === null || v.titular !== n.conta.paciente)
      return naoEncontrado('Acesso não encontrado');
    if (!titularPodeRevogar(v.tipo as TipoVinculoResponsavel))
      recusa(
        'nao-revogavel',
        'Este acesso só termina por decisão judicial ou na data prevista. Procure a área de privacidade.',
      );
    await this.gravar(
      n.c,
      (g) =>
        g.encerrarVinculo(v.id, v.versao, { motivo: 'revogado-pelo-titular', por: quemDaConta(n.conta.id) }),
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalVinculoDecidido.codigo,
        operacao: 'portal.vincularResponsavel',
        tabela: 'conta_portal_paciente_dependente',
        id: v.id,
        usuario: quemDaConta(n.conta.id),
        paciente: v.titular,
        chave: 'revogado-pelo-titular',
      }),
    );
  }

  // ── Consentimentos ───────────────────────────────────────────────────────────────────────────────────────────────

  async consentimentos(n: PortalNoPedido): Promise<ConsentimentoPortalItem[]> {
    const t = this.exigirEscopo(n, 'consentimentos');
    const dom = await this.porta.dominiosConsentimento(n.c);
    const sim = idSituacaoTermo(true, dom.situacoes);
    const representante = idSignatario('representante-legal', dom.signatarios);
    return (await this.porta.consentimentos(n.c, t.paciente))
      .filter((k) =>
        ['atendimento', 'comunicacao', 'pesquisa', 'compartilhamento-rede'].includes(k.finalidade),
      )
      .map((k) => ({
        consentimento: k.id,
        finalidade: k.finalidade as ConsentimentoPortalItem['finalidade'],
        versao: k.versao,
        consentiu: k.situacao === sim,
        registradoEm: k.registradoEm,
        signatario: k.signatario === representante ? ('representante-legal' as const) : ('paciente' as const),
        revogadoEm: k.revogadoEm,
        editavel: k.finalidade !== 'atendimento',
      }));
  }

  async registrarConsentimento(
    n: PortalNoPedido,
    e: ConsentimentoPortalEntrada,
  ): Promise<ConsentimentoPortalItem[]> {
    const t = this.exigirEscopo(n, 'consentimentos');
    const dom = await this.porta.dominiosConsentimento(n.c);
    const revogacao =
      dom.revogacoes.find((d) => d.ativo && /revoga/i.test(d.descricao))?.id ??
      dom.revogacoes.find((d) => d.ativo)?.id;
    if (revogacao === undefined)
      recusa('dominio-ausente', 'O cadastro de tipos de revogação está vazio. Procure o hospital.', 503);
    const atuais = await this.porta.consentimentos(n.c, t.paciente);
    const vinculo = n.ativo.vinculo === null ? null : Number(n.ativo.vinculo);
    const trilha = (id: number, chave: string) =>
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalConsentimentoRegistrado.codigo,
        operacao: 'portal.registrarConsentimento',
        tabela: 'consentimento_titular',
        id,
        usuario: quemDaConta(n.conta.id),
        paciente: t.paciente,
        chave,
      });
    if (e.acao === 'revogar') {
      const k = atuais.find((x) => x.id === e.consentimento && x.revogadoEm === null);
      if (!k || k.finalidade === 'atendimento') return naoEncontrado('Consentimento não encontrado');
      await this.gravar(
        n.c,
        (g) =>
          g.revogarConsentimento({
            idPaciente: t.paciente,
            id: k.id,
            motivo: revogacao!,
            usuario: USUARIO_PORTAL,
          }),
        trilha(k.id, `${k.finalidade}:revogado`),
      );
      return this.consentimentos(n);
    }
    if (e.versao !== VERSAO_CONSENTIMENTO)
      recusa('termo-desatualizado', 'O termo mudou. Recarregue a página e leia a versão nova.');
    const situacao = idSituacaoTermo(e.acao === 'consentir', dom.situacoes);
    const signatario = idSignatario(signatarioDaSessao(n.ativo.vinculo), dom.signatarios);
    if (situacao === null || signatario === null)
      recusa(
        'dominio-ausente',
        'O cadastro de situações ou de signatários do termo está incompleto. Procure o hospital.',
        503,
      );
    const anteriores = atuais.filter((x) => x.finalidade === e.finalidade && x.revogadoEm === null);
    await this.gravar(
      n.c,
      async (g) => {
        // A decisão nova substitui a anterior da mesma finalidade (a anterior fica revogada; nada é apagado).
        for (const a of anteriores)
          await g.revogarConsentimento({
            idPaciente: t.paciente,
            id: a.id,
            motivo: revogacao!,
            usuario: USUARIO_PORTAL,
          });
        return g.registrarConsentimento({
          idPaciente: t.paciente,
          pront: t.prontuario,
          finalidade: e.finalidade,
          versao: e.versao,
          situacao: situacao!,
          signatario: signatario!,
          usuario: USUARIO_PORTAL,
          conta: n.conta.id,
          vinculo,
        });
      },
      (r) => trilha(r.id, `${e.finalidade}:${e.acao}:${e.versao}`),
    );
    return this.consentimentos(n);
  }

  // ── Pedidos do titular ───────────────────────────────────────────────────────────────────────────────────────────

  async pedidos(n: PortalNoPedido): Promise<PedidoTitularPortalItem[]> {
    const t = this.exigirEscopo(n, 'pedidos');
    const agora = this.agora().toISOString();
    return (await this.porta.pedidos(n.c, n.conta.id, t.paciente)).map((p) => ({
      protocolo: p.protocolo,
      tipo: p.tipo as PedidoTitularPortalItem['tipo'],
      situacao: p.situacao as PedidoTitularPortalItem['situacao'],
      abertoEm: p.abertoEm,
      prazo: p.prazo,
      atrasado: (p.situacao === 'aberto' || p.situacao === 'identidade-verificada') && p.prazo < agora,
      respondidoEm: p.decididoEm,
      resposta: p.situacao === 'atendido' || p.situacao === 'negado' ? p.resposta : null,
      fundamento: p.fundamento,
      motivoCancelamento: p.motivoCancelamento as PedidoTitularPortalItem['motivoCancelamento'],
      cancelavel: conferirCancelamento({ situacao: p.situacao as SituacaoPedido }) === null,
      pacoteIps: p.tipo === 'portabilidade' && p.situacao === 'atendido' && this.fonteIps !== null,
    }));
  }

  /**
   * W0-10: o titular cancela com motivo o pedido ainda não respondido (o protocolado não se edita: só a situação muda,
   * com o motivo, quem e quando). O respondido ou já cancelado devolve 409; a trilha leva o protocolo e o motivo.
   */
  async cancelarPedido(n: PortalNoPedido, protocolo: string, e: CancelarPedidoPortal): Promise<void> {
    const t = this.exigirEscopo(n, 'pedidos');
    await this.gravar(
      n.c,
      (g) =>
        g.cancelarPedido(
          {
            protocolo,
            idPaciente: t.paciente,
            conta: n.conta.id,
            motivo: e.motivo,
            observacao: e.observacao,
            por: quemDaConta(n.conta.id),
            conferir: (situacao) => {
              const r = conferirCancelamento({ situacao: situacao as SituacaoPedido });
              return r ? mensagemCancelamento(r) : null;
            },
          },
          {
            rede: this.cfg.rede,
            hospital: n.c.hospital,
            usuario: quemDaConta(n.conta.id),
            evento: EVENTOS_AUDITAVEIS.portalPedidoTitularCancelado.codigo,
            recurso: CHAVE_PORTAL_CONTA,
            operacao: 'portal.cancelarPedidoTitular',
            resultado: 'sucesso',
            estacao: 'SGH-PORTAL',
            correlacao: `portal-${randomBytes(6).toString('hex')}`,
            idPaciente: t.paciente,
          },
        ),
      null,
    );
  }

  // ── Portabilidade em FHIR/IPS (W0-10, M3) ────────────────────────────────────────────────────────────────────────

  /**
   * O pacote de portabilidade do titular (LGPD art. 18 V): o Bundle FHIR R4/IPS com o resumo clínico e os PDFs
   * assinados, só quando o pedido de portabilidade foi atendido pela área de privacidade. Gerado a cada download
   * (determinístico para os mesmos dados), validado contra o recorte do perfil IPS (recusa se houver problema) e com o
   * SHA-256 na trilha; o JSON não é guardado. O envio ao app nacional fica atrás do credenciamento na RNDS (desligado).
   */
  async pacoteIps(n: PortalNoPedido, protocolo: string): Promise<{ json: string; hash: string }> {
    const t = this.exigirEscopo(n, 'pedidos');
    const p = (await this.porta.pedidos(n.c, n.conta.id, t.paciente)).find(
      (x) => x.protocolo === protocolo && x.tipo === 'portabilidade',
    );
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Pedido não encontrado',
        'Pedido de portabilidade não encontrado.',
      );
    if (p.situacao !== 'atendido')
      recusa(
        'portabilidade-nao-atendida',
        'O pacote fica disponível quando o pedido de portabilidade é atendido.',
      );
    if (!this.fonteIps)
      recusa(
        'portabilidade-indisponivel',
        'O pacote de portabilidade não está disponível agora. Tente de novo em instantes.',
        503,
      );
    const dados = await this.fonteIps!(n.c, t.paciente);
    const bundle = pacoteIpsTitular({
      protocolo,
      geradoEm: new Date(p.decididoEm ?? this.agora().toISOString()),
      ...dados,
      documentos: await this.documentosIps(n.c, t.paciente),
    });
    const problemas = validarPacoteIps(bundle);
    if (problemas.length)
      recusa(
        'portabilidade-invalida',
        `O pacote não passou na validação do perfil IPS (${problemas.length} problema(s)). Procure o atendimento.`,
        503,
      );
    const json = JSON.stringify(bundle);
    const hash = sha256(json);
    await this.gravar(
      n.c,
      async () => null,
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalPortabilidadeIps.codigo,
        operacao: 'portal.portabilidadeIps',
        tabela: 'pedido_titular',
        id: p.id,
        chave: `${protocolo}:ips:${hash}`,
        usuario: quemDaConta(n.conta.id),
        paciente: t.paciente,
      }),
    );
    return { json, hash };
  }

  /** Os documentos assinados (ICP-Brasil) visíveis no portal, com o PDF; o que não abre agora fica de fora. */
  private async documentosIps(c: ContextoPortal, paciente: number): Promise<DocumentoAssinadoIps[]> {
    if (!this.pdfAssinado) return [];
    const minimo = await this.nivelMinimo(c.hospital);
    const r = await this.porta.documentos(c, paciente, TIPOS_DOCUMENTO_PORTAL, 1);
    const docs: DocumentoAssinadoIps[] = [];
    for (const d of r.itens) {
      if (d.assinaturaIcp === null || !documentoVisivelNoPortal(d, paciente, minimo)) continue;
      const pdf = await this.pdfAssinado(c, d.assinaturaIcp).catch(() => null);
      if (!pdf) continue;
      docs.push({
        id: String(d.id),
        titulo: d.tipo,
        emitidoEm: new Date(d.criadoEm),
        pdf,
        assinatura: `ICP-Brasil${d.codigoVerificacao ? `, verificação ${d.codigoVerificacao}` : ''}`,
      });
    }
    return docs;
  }

  // ── Ouvidoria pelo portal (W0-10, M1) ────────────────────────────────────────────────────────────────────────────

  /** As manifestações do paciente ativo feitas pelo portal: protocolo, prazo, situação e a resposta da ouvidoria. */
  async manifestacoes(n: PortalNoPedido): Promise<ManifestacaoPortalItem[]> {
    const t = this.exigirEscopo(n, 'pedidos');
    return (await this.porta.manifestacoes(n.c, t.paciente)).map((m) => ({
      protocolo: m.protocolo,
      tipo: m.tipo as ManifestacaoPortalItem['tipo'],
      area: m.area,
      relato: m.relato,
      recebidaEm: m.recebidaEm,
      prazoEm: m.prazoEm,
      situacao: (m.canceladaEm ? 'cancelada' : m.situacao) as ManifestacaoPortalItem['situacao'],
      resposta: m.situacao === 'respondida' && !m.canceladaEm ? m.resposta : null,
      respondidaEm: m.situacao === 'respondida' && !m.canceladaEm ? m.respondidaEm : null,
    }));
  }

  /**
   * W0-10 (M1): a manifestação (elogio, reclamação, sugestão...) vai à ouvidoria interna pelo escritor dela (canal
   * "portal", identificada com o paciente da sessão), com o protocolo OUV-AAAA-NNNNNN e o prazo em dias úteis do
   * calendário do estabelecimento; a trilha leva o evento da ouvidoria (o relato não vai à trilha).
   */
  async registrarManifestacao(
    n: PortalNoPedido,
    e: ManifestacaoPortalEntrada,
  ): Promise<{ protocolo: string; prazoEm: string }> {
    const t = this.exigirEscopo(n, 'pedidos');
    const recebidaEm = instanteLocal(this.agora());
    const dia0 = recebidaEm.slice(0, 10);
    const ate = somarDiasData(dia0, 60);
    const anos = [...new Set([Number(dia0.slice(0, 4)), Number(ate.slice(0, 4))])];
    const feriados = calendarioDeFeriados(await this.porta.feriados(n.c, dia0, ate), anos);
    const dias = await this.param(n.c.hospital, PARAMETRO_PRAZO_OUVIDORIA, DIAS_UTEIS_RESPOSTA_OUVIDORIA);
    const prazoEm = prazoRespostaOuvidoria(recebidaEm, feriados, dias);
    const quem = quemDaConta(n.conta.id);
    const r = await this.gravar(
      n.c,
      (g) =>
        g.registrarManifestacao({
          protocoloDe: (k) => protocoloManifestacao(recebidaEm, k),
          tipo: e.tipo,
          paciente: t.paciente,
          area: e.area?.trim() || AREA_OUVIDORIA_PORTAL,
          relato: e.relato.trim(),
          recebidaEm,
          prazoEm,
          usuario: quem,
        }),
      (x) =>
        this.trilha(n.c.hospital, {
          evento: EVENTOS_AUDITAVEIS.qualidadeManifestacaoRegistrada.codigo,
          operacao: 'portal.registrarManifestacao',
          tabela: 'manifestacao_ouvidoria',
          id: x.id,
          chave: x.protocolo,
          usuario: quem,
          paciente: t.paciente,
        }),
    );
    return { protocolo: r.protocolo, prazoEm };
  }

  async registrarPedido(
    n: PortalNoPedido,
    e: PedidoTitularPortalEntrada,
  ): Promise<{ protocolo: string; prazo: string }> {
    const t = this.exigirEscopo(n, 'pedidos');
    const identidade =
      situacaoInicialPedidoPortal({
        ativa: n.conta.situacao === 'ativa',
        segundoFatorConfirmado: n.conta.segundoFatorEm !== null,
      }) === 'identidade-verificada';
    const r = await this.gravar(
      n.c,
      (g) =>
        g.registrarPedido(
          {
            idPaciente: t.paciente,
            tipo: e.tipo,
            descricao: e.descricao,
            por: USUARIO_PORTAL,
            prazoDias: PRAZO_PEDIDO_DIAS,
            conta: n.conta.id,
            identidadeVerificada: identidade,
          },
          {
            rede: this.cfg.rede,
            hospital: n.c.hospital,
            usuario: quemDaConta(n.conta.id),
            evento: EVENTOS_AUDITAVEIS.portalPedidoTitularRegistrado.codigo,
            recurso: CHAVE_PORTAL_CONTA,
            operacao: 'portal.registrarPedidoTitular',
            resultado: 'sucesso',
            estacao: 'SGH-PORTAL',
            correlacao: `portal-${randomBytes(6).toString('hex')}`,
            idPaciente: t.paciente,
          },
        ),
      null,
    );
    const lista = await this.porta.pedidos(n.c, n.conta.id, t.paciente);
    return { protocolo: r.protocolo, prazo: lista.find((p) => p.protocolo === r.protocolo)?.prazo ?? '' };
  }

  // ── Cópia do prontuário (W0-10, M2) ──────────────────────────────────────────────────────────────────────────────

  private trilhaCopia(
    hospital: string,
    d: { usuario: string; estacao: string; correlacao?: string; origem?: string | null; paciente: number },
  ) {
    return {
      rede: this.cfg.rede,
      hospital,
      usuario: d.usuario.slice(0, 31),
      evento: EVENTOS_AUDITAVEIS.portalCopiaProntuario.codigo,
      recurso: CHAVE_PORTAL_CONTA,
      operacao: 'portal.copiaProntuario',
      resultado: 'sucesso' as const,
      estacao: d.estacao.slice(0, 80),
      correlacao: d.correlacao ?? `portal-${randomBytes(6).toString('hex')}`,
      origem: d.origem ?? null,
      idPaciente: d.paciente,
    };
  }

  /** O vínculo do representante como a regra da cópia o vê hoje (do paciente, vigente, com os escopos). */
  private async vinculoParaCopia(
    c: ContextoPortal,
    vinculo: string | null,
    paciente: number,
  ): Promise<VinculoParaCopia | null> {
    if (vinculo === null) return null;
    const v = await this.porta.vinculo(c, Number(vinculo));
    if (!v) return null;
    const titular = await this.porta.paciente(c, v.titular);
    const vigente =
      titular !== null &&
      vigenciaDoVinculo(
        {
          tipo: v.tipo as TipoVinculoResponsavel,
          situacao: v.situacao,
          validade: v.validade,
          escopos: v.escopos as EscopoVinculo[],
        },
        { nascimento: titular.nascimento, obito: titular.obito, ativo: titular.ativo },
        dia(this.agora()),
        await this.idadeContaPropria(c.hospital),
      ).vigente;
    return { doPaciente: v.titular === paciente, vigente, escopos: v.escopos };
  }

  private recusaCopia(r: Parameters<typeof mensagemCopia>[0]): never {
    return recusa(r, mensagemCopia(r), 422);
  }

  /** A regra do ato sobre a linha travada (na porta): a etapa sai dos atos já feitos. */
  private conferirAto(novo: NovoAtoCopia) {
    return (situacao: string, atos: readonly { readonly ato: string }[]) => {
      const r = conferirAtoCopia(
        { situacaoPedido: situacao as SituacaoPedido, atos: atos.map((a) => ({ ato: a.ato as AtoCopia })) },
        novo,
      );
      return r ? mensagemCopia(r) : null;
    };
  }

  /** As cópias do paciente ativo (portal): etapa, prazo e se o PDF entregue pelo portal pode ser baixado. */
  async copias(n: PortalNoPedido): Promise<CopiaPortalItem[]> {
    const t = this.exigirEscopo(n, 'documentos');
    const agora = this.agora().getTime();
    const fila = (await this.porta.filaCopias(n.c, { pendentes: false, idPaciente: t.paciente })).slice(
      0,
      50,
    );
    const r: CopiaPortalItem[] = [];
    for (const f of fila) {
      const atos = await this.porta.atosCopia(n.c, f.idPedido);
      const entrega = atos.find((a) => a.ato === 'entrega') ?? null;
      const pendente = f.situacao === 'aberto' || f.situacao === 'identidade-verificada';
      r.push({
        protocolo: f.protocolo,
        situacao: f.situacao as CopiaPortalItem['situacao'],
        etapa: etapaDaCopia(atos.map((a) => ({ ato: a.ato as AtoCopia }))),
        solicitante: f.solicitante as SolicitanteCopia,
        abertoEm: f.abertoEm.toISOString(),
        prazo: f.prazo.toISOString(),
        atrasado: pendente && f.prazo.getTime() < agora,
        entregueEm: entrega ? entrega.em.toISOString() : null,
        meio: (entrega?.meio ?? null) as CopiaPortalItem['meio'],
        baixavel: entrega?.meio === 'portal' && atos.some((a) => a.ato === 'geracao' && a.prova),
      });
    }
    return r;
  }

  /**
   * O titular (ou o representante com vínculo vigente e escopo de documentos) pede a cópia: o pedido de acesso do M10
   * e o ato da solicitação na mesma transação. O familiar do falecido pede no balcão.
   */
  async pedirCopia(n: PortalNoPedido, e: PedirCopiaPortal): Promise<{ protocolo: string; prazo: string }> {
    const t = this.exigirEscopo(n, 'documentos');
    const solicitante: SolicitanteCopia = t.vinculo === null ? 'titular' : 'representante';
    const vinculo = await this.vinculoParaCopia(n.c, t.vinculo, t.paciente);
    const r0 = conferirSolicitacaoCopia({ solicitante, canal: 'portal', vinculo, prova: null });
    if (r0) this.recusaCopia(r0);
    const identidade =
      situacaoInicialPedidoPortal({
        ativa: n.conta.situacao === 'ativa',
        segundoFatorConfirmado: n.conta.segundoFatorEm !== null,
      }) === 'identidade-verificada';
    const quem = quemDaConta(n.conta.id);
    const base = { usuario: quem, estacao: 'SGH-PORTAL', paciente: t.paciente };
    const r = await this.gravar(
      n.c,
      (g) =>
        g.pedirCopia(
          {
            idPaciente: t.paciente,
            canal: 'portal',
            conta: n.conta.id,
            identidadeVerificada: identidade,
            descricao: e.observacao,
            por: USUARIO_PORTAL,
            prazoDias: PRAZO_PEDIDO_DIAS,
            solicitante,
            vinculo: t.vinculo,
            prova: null,
          },
          {
            pedido: {
              ...this.trilhaCopia(n.c.hospital, base),
              evento: EVENTOS_AUDITAVEIS.portalPedidoTitularRegistrado.codigo,
              operacao: 'portal.registrarPedidoTitular',
            },
            copia: this.trilhaCopia(n.c.hospital, base),
          },
        ),
      null,
    );
    const f = await this.porta.filaCopias(n.c, { pendentes: true, idPaciente: t.paciente });
    return {
      protocolo: r.protocolo,
      prazo: f.find((x) => x.protocolo === r.protocolo)?.prazo.toISOString() ?? '',
    };
  }

  /** O PDF da cópia entregue pelo portal (a última geração; o hash é conferido). O download vai à trilha. */
  async pdfDaCopia(n: PortalNoPedido, protocolo: string): Promise<Uint8Array> {
    const t = this.exigirEscopo(n, 'documentos');
    const f = (await this.porta.filaCopias(n.c, { pendentes: false, idPaciente: t.paciente })).find(
      (x) => x.protocolo === protocolo,
    );
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Cópia não encontrada', 'Pedido não encontrado.');
    const atos = await this.porta.atosCopia(n.c, f.idPedido);
    const geracao = atos.filter((a) => a.ato === 'geracao' && a.prova).at(-1);
    if (atos.find((a) => a.ato === 'entrega')?.meio !== 'portal' || !geracao)
      recusa('copia-nao-entregue', 'A cópia ainda não foi entregue pelo portal.');
    const arq = await this.provas.ler(n.c.hospital, geracao!.prova!);
    if (!arq || createHash('sha256').update(arq.bytes).digest('hex') !== geracao!.hash)
      recusa(
        'copia-indisponivel',
        'O arquivo da cópia não está disponível agora. Procure o atendimento.',
        503,
      );
    await this.gravar(
      n.c,
      async () => null,
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalCopiaProntuario.codigo,
        operacao: 'portal.copiaProntuario',
        tabela: 'solicitacao_copia_prontuario',
        id: geracao!.id,
        chave: `${protocolo}:copia:download`,
        usuario: quemDaConta(n.conta.id),
        paciente: t.paciente,
      }),
    );
    return arq!.bytes;
  }

  // Balcão (permissão portal.copia.conferir).

  async filaCopias(q: QuemInterno, f: FiltroFilaCopias): Promise<CopiaNaFilaItem[]> {
    const agora = this.agora().getTime();
    const fila = await this.porta.filaCopias(this.ctx(q.hospital), {
      pendentes: f.pendentes,
      ...(f.paciente === undefined ? {} : { idPaciente: f.paciente }),
    });
    return fila.map((x) => ({
      protocolo: x.protocolo,
      situacao: x.situacao as CopiaNaFilaItem['situacao'],
      canal: x.canal,
      paciente: x.idPaciente,
      prontuario: x.prontuario,
      abertoEm: x.abertoEm.toISOString(),
      prazo: x.prazo.toISOString(),
      atrasado:
        (x.situacao === 'aberto' || x.situacao === 'identidade-verificada') && x.prazo.getTime() < agora,
      solicitante: x.solicitante as SolicitanteCopia,
      vinculo: x.vinculo,
      etapa: x.entregue
        ? 'entregue'
        : x.geracoes > 0
          ? 'gerada'
          : x.legitimidade
            ? 'legitimidade-conferida'
            : 'aguardando-conferencia',
      geracoes: x.geracoes,
    }));
  }

  private async copiaDaFila(q: QuemInterno, protocolo: string) {
    const c = this.ctx(q.hospital);
    const f = (await this.porta.filaCopias(c, { pendentes: false, protocolo }))[0];
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Cópia não encontrada', 'Pedido não encontrado.');
    return { c, f };
  }

  async atosDaCopia(q: QuemInterno, protocolo: string): Promise<AtoCopiaItem[]> {
    const { c, f } = await this.copiaDaFila(q, protocolo);
    return (await this.porta.atosCopia(c, f.idPedido)).map((a) => ({
      ato: a.ato,
      em: a.em.toISOString(),
      usuario: a.usuario,
      hash: a.hash,
      paginas: a.paginas,
      meio: a.meio as AtoCopiaItem['meio'],
    }));
  }

  /** O pedido de cópia de quem veio ao balcão (o familiar do falecido só aqui, com a prova descrita). */
  async pedirCopiaNoBalcao(q: QuemInterno, e: PedirCopiaBalcao): Promise<{ protocolo: string }> {
    const c = this.ctx(q.hospital);
    if (!(await this.porta.paciente(c, e.paciente)))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado', 'Paciente não encontrado.');
    const vinculo =
      e.solicitante === 'representante' ? await this.vinculoParaCopia(c, e.vinculo, e.paciente) : null;
    const r0 = conferirSolicitacaoCopia({
      solicitante: e.solicitante,
      canal: 'balcao',
      vinculo,
      prova: e.prova,
    });
    if (r0) this.recusaCopia(r0);
    const base = {
      usuario: q.login,
      estacao: q.estacao,
      correlacao: q.correlacao,
      origem: q.origem,
      paciente: e.paciente,
    };
    const r = await this.gravar(
      c,
      (g) =>
        g.pedirCopia(
          {
            idPaciente: e.paciente,
            canal: 'balcao',
            conta: null,
            identidadeVerificada: false,
            descricao: e.observacao,
            por: q.login,
            prazoDias: PRAZO_PEDIDO_DIAS,
            solicitante: e.solicitante,
            vinculo: e.solicitante === 'representante' ? e.vinculo : null,
            prova: e.prova,
          },
          {
            pedido: {
              ...this.trilhaCopia(q.hospital, base),
              evento: EVENTOS_AUDITAVEIS.portalPedidoTitularRegistrado.codigo,
              operacao: 'portal.registrarPedidoTitular',
            },
            copia: this.trilhaCopia(q.hospital, base),
          },
        ),
      null,
    );
    return { protocolo: r.protocolo };
  }

  /** A conferência da legitimidade de quem pede (titular, representante com vínculo vigente, familiar com prova). */
  async conferirLegitimidadeCopia(q: QuemInterno, e: ConferirLegitimidadeCopia): Promise<void> {
    const { c, f } = await this.copiaDaFila(q, e.protocolo);
    const vinculo =
      e.solicitante === 'representante' ? await this.vinculoParaCopia(c, e.vinculo, f.idPaciente) : null;
    const novo: NovoAtoCopia = { ato: 'legitimidade', solicitante: e.solicitante, vinculo, prova: e.prova };
    await this.gravar(
      c,
      (g) =>
        g.registrarAtoCopia(
          {
            protocolo: e.protocolo,
            idPaciente: null,
            ato: 'legitimidade',
            solicitante: e.solicitante,
            vinculo: e.solicitante === 'representante' ? e.vinculo : null,
            prova: e.prova,
            por: q.login,
            conferir: this.conferirAto(novo),
          },
          this.trilhaCopia(q.hospital, { ...q, usuario: q.login, paciente: f.idPaciente }),
        ),
      null,
    );
  }

  /**
   * Gera o PDF da cópia (o prontuário do paciente com a marca d'água do protocolo em cada página), guarda o arquivo
   * no armazém e registra a geração com o hash e as páginas; cada geração vai à trilha.
   */
  async gerarCopia(
    q: QuemInterno,
    e: GerarCopia,
  ): Promise<{ pdf: Uint8Array; hash: string; paginas: number }> {
    const { c, f } = await this.copiaDaFila(q, e.protocolo);
    const pre = this.conferirAto({ ato: 'geracao' })(f.situacao, await this.porta.atosCopia(c, f.idPedido));
    if (pre) recusa('transicao', pre);
    const agora = this.agora();
    const { pdf, paginas } = gerarPdfCopia({
      titulo: `Cópia do prontuário — protocolo ${f.protocolo}`,
      secoes: await this.secoesCopia(c, f.idPaciente, agora),
      marca: marcaDaguaCopia(f.protocolo, f.solicitante as SolicitanteCopia, agora),
    });
    const hash = createHash('sha256').update(pdf).digest('hex');
    const chave = await this.provas.guardar(q.hospital, 'application/pdf', pdf);
    await this.gravar(
      c,
      (g) =>
        g.registrarAtoCopia(
          {
            protocolo: e.protocolo,
            idPaciente: null,
            ato: 'geracao',
            hash,
            paginas,
            prova: chave,
            por: q.login,
            conferir: this.conferirAto({ ato: 'geracao' }),
          },
          this.trilhaCopia(q.hospital, { ...q, usuario: q.login, paciente: f.idPaciente }),
        ),
      null,
    );
    return { pdf, hash, paginas };
  }

  /** A entrega (pelo portal, no balcão ou pelo correio, com quem recebeu): o pedido fica atendido. */
  async entregarCopia(q: QuemInterno, e: EntregarCopia): Promise<void> {
    const { c, f } = await this.copiaDaFila(q, e.protocolo);
    await this.gravar(
      c,
      (g) =>
        g.registrarAtoCopia(
          {
            protocolo: e.protocolo,
            idPaciente: null,
            ato: 'entrega',
            meio: e.meio,
            recebedor: e.meio === 'portal' ? null : e.recebedor,
            por: q.login,
            conferir: this.conferirAto({ ato: 'entrega', meio: e.meio, recebedor: e.recebedor }),
          },
          this.trilhaCopia(q.hospital, { ...q, usuario: q.login, paciente: f.idPaciente }),
        ),
      null,
    );
  }

  /** As seções do PDF: a identificação, os documentos assinados e resultados, e o texto dos registros (PEP). */
  private async secoesCopia(c: ContextoPortal, paciente: number, agora: Date): Promise<SecaoCopia[]> {
    const p = await this.porta.paciente(c, paciente);
    const secoes: SecaoCopia[] = [
      {
        titulo: 'Identificação',
        linhas: [
          `Prontuário: ${p?.prontuario ?? '-'}`,
          `Nascimento: ${p?.nascimento ?? '-'}`,
          `Gerada em: ${instanteLocal(agora).replace('T', ' ').slice(0, 16)}`,
        ],
      },
    ];
    const docs = await this.porta.documentos(c, paciente, TIPOS_DOCUMENTO_PORTAL, 1);
    secoes.push({
      titulo: 'Documentos emitidos',
      linhas: docs.itens.length
        ? docs.itens.map(
            (d) =>
              `${d.criadoEm.slice(0, 10)} · ${d.tipo} · ${d.nivelAssinatura}${d.codigoVerificacao ? ` · verificação ${d.codigoVerificacao}` : ''}`,
          )
        : ['Nenhum documento emitido.'],
    });
    if (this.prontuarioCopia) secoes.push(...(await this.prontuarioCopia(c, paciente)));
    return secoes;
  }

  // ── Relatório de quem acessou o próprio prontuário ───────────────────────────────────────────────────────────────

  async acessos(n: PortalNoPedido, f: FiltroAcessosTitular): Promise<RelatorioAcessosTitular> {
    const t = this.exigirEscopo(n, 'documentos');
    if (!janelaValida(f.de, f.ate, JANELA_RELATORIO_ACESSOS_DIAS))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período longo demais',
        `Escolha um período de até ${JANELA_RELATORIO_ACESSOS_DIAS} dias.`,
        { codigo: 'janela-longa', campos: ['de'] },
      );
    const lidas = await this.porta.leituras(n.c, t.paciente, Object.keys(NATUREZA_DO_EVENTO), f.de, f.ate);
    const grupos = agruparAcessos(lidas.itens);
    const propria = await this.porta.contaDoPaciente(n.c, t.paciente);
    const nomes = await this.porta.nomes(
      n.c,
      grupos.map((g) => g.usuario).filter((u) => !u.startsWith(USUARIO_PORTAL)),
    );
    const de = (f.pagina - 1) * ACESSOS_POR_PAGINA;
    const itens: AcessoTitularItem[] = grupos.slice(de, de + ACESSOS_POR_PAGINA).map((g) => ({
      dia: g.dia,
      natureza: g.natureza,
      quem: g.usuario.startsWith(USUARIO_PORTAL)
        ? propria && g.usuario === quemDaConta(propria.id)
          ? 'Você'
          : 'Seu responsável'
        : (nomes.get(g.usuario) ?? 'Profissional do hospital'),
      funcao: null,
      vezes: g.vezes,
      primeiraEm: g.primeiraEm,
      ultimaEm: g.ultimaEm,
    }));
    await this.gravar(
      n.c,
      async () => null,
      this.trilha(n.c.hospital, {
        evento: EVENTOS_AUDITAVEIS.portalAcessosConsultados.codigo,
        operacao: 'portal.consultarAcessos',
        tabela: null,
        id: null,
        usuario: quemDaConta(n.conta.id),
        chave: `${f.de}:${f.ate}`,
      }),
    );
    return { itens, de: f.de, ate: f.ate, haMais: lidas.haMais || grupos.length > de + ACESSOS_POR_PAGINA };
  }

  // ── Lado interno: conta do paciente ──────────────────────────────────────────────────────────────────────────────

  private trilhaInterna(
    q: QuemInterno,
    d: Parameters<ServicoPortalPaciente['trilha']>[1],
  ): RegistroTrilhaPortal {
    return this.trilha(q.hospital, {
      ...d,
      usuario: q.login,
      estacao: q.estacao,
      correlacao: q.correlacao,
      origem: q.origem,
    });
  }

  async contaDoPaciente(q: QuemInterno, paciente: number): Promise<ContaPortalResumo | null> {
    const c = this.ctx(q.hospital);
    const k = await this.porta.contaDoPaciente(c, paciente);
    if (!k) return null;
    const vinculos = await this.porta.vinculosDoTitular(c, paciente);
    return this.resumoConta(k, vinculos.filter((v) => v.situacao === 'ativo').length);
  }

  private resumoConta(k: ContaPortal, responsaveis: number): ContaPortalResumo {
    return {
      conta: String(k.id),
      situacao: k.situacao,
      emailMascarado: mascararEmail(k.email),
      segundoFator: k.segundoFatorEm !== null,
      criadaEm: k.criadaEm.toISOString(),
      ativadaEm: iso(k.ativadaEm),
      ultimoAcessoEm: iso(k.ultimoAcessoEm),
      bloqueadaAte: iso(k.bloqueadoAte),
      motivo:
        k.situacao === 'bloqueada' || k.bloqueadoAte
          ? k.motivoBloqueio
          : k.situacao === 'encerrada'
            ? k.motivoEncerramento
            : null,
      responsaveis,
    };
  }

  private async novoConvite(hospital: string): Promise<{ codigo: string; validoAte: Date }> {
    const horas = await this.param(hospital, 'portal.conviteValidadeHoras', 72);
    return { codigo: codigoConvite(randomBytes(12)), validoAte: validadeDoConvite(this.agora(), horas) };
  }

  private emitido(conta: number, codigo: string, validoAte: Date): ConviteEmitido {
    return {
      conta: String(conta),
      codigo: formatarConvite(codigo),
      validoAte: validoAte.toISOString(),
      destino: this.porta.destino,
    };
  }

  /** Emitir o convite (a recepção confere a pessoa uma vez; o código sai impresso). */
  async convidar(q: QuemInterno, e: ConvidarContaPortal): Promise<ConviteEmitido> {
    await this.exigirLigado(q.hospital);
    const c = this.ctx(q.hospital);
    const p = await this.porta.paciente(c, e.idPaciente);
    if (!p) return naoEncontrado('Paciente não encontrado');
    const atual = await this.porta.contaDoPaciente(c, p.id);
    const situacao = atual && atual.situacao !== 'encerrada' ? atual.situacao : null;
    const r = conferirConvite(
      { ativo: p.ativo, obito: p.obito, unificadoEmOutro: p.unificadoEm !== null, nascimento: p.nascimento },
      situacao,
      dia(this.agora()),
      await this.idadeContaPropria(q.hospital),
    );
    if (r) recusa(r, mensagemConvite(r));
    const { codigo, validoAte } = await this.novoConvite(q.hospital);
    const conta = await this.gravar(
      c,
      async (g) => {
        if (atual && situacao === 'convidada') {
          await g.reemitirConvite(atual.id, atual.versao, {
            conviteResumo: resumoConvite(codigo),
            conviteValidoAte: validoAte,
            origem: e.origem,
            por: q.login,
            refazer: false,
          });
          return atual.id;
        }
        return (
          await g.criarConta({
            tipo: 'paciente',
            paciente: p.id,
            prontuario: p.prontuario,
            nome: null,
            nascimento: null,
            conviteResumo: resumoConvite(codigo),
            conviteValidoAte: validoAte,
            origem: e.origem,
            por: q.login,
          })
        ).id;
      },
      (id) =>
        this.trilhaInterna(q, {
          evento: EVENTOS_AUDITAVEIS.portalContaConvidada.codigo,
          operacao: 'portal.criarConta',
          tabela: 'conta_portal_paciente',
          id,
          paciente: p.id,
          chave: e.origem,
        }),
    );
    return this.emitido(conta, codigo, validoAte);
  }

  /** O responsável que não é paciente, no balcão (D-RESP-50): a conta de responsável e o vínculo já liberado. */
  async convidarResponsavel(q: QuemInterno, e: ConvidarResponsavelBalcao): Promise<ConviteEmitido> {
    await this.exigirLigado(q.hospital);
    const c = this.ctx(q.hospital);
    const t = await this.porta.paciente(c, e.idTitular);
    if (!t) return naoEncontrado('Paciente não encontrado');
    const hoje = dia(this.agora());
    const idade = await this.idadeContaPropria(q.hospital);
    const r = conferirPedidoVinculo(
      { tipo: e.tipo, prova: e.prova, validade: e.validade, paraSiMesmo: false, jaExiste: false },
      { nascimento: t.nascimento, obito: t.obito, ativo: t.ativo && t.unificadoEm === null },
      hoje,
      idade,
      await this.param(q.hospital, 'portal.procuracaoValidadeMaximaDias', 365),
    );
    if (r) recusa(r, mensagemVinculo(r));
    const ir = idadeEm(e.nascimento, hoje);
    if (ir === null || ir < 18) recusa('responsavel-menor', 'O responsável precisa ser maior de idade.');
    if (e.tipo === 'procurador' && e.escopos.length === 0)
      recusa('procurador-sem-escopo', 'Marque o que a procuração permite antes de aprovar.');
    const escopos = escoposAprovados(e.tipo, e.escopos.length ? e.escopos : ESCOPO_PADRAO_VINCULO[e.tipo]);
    const { codigo, validoAte } = await this.novoConvite(q.hospital);
    const conta = await this.gravar(
      c,
      async (g) => {
        const k = await g.criarConta({
          tipo: 'responsavel',
          paciente: null,
          prontuario: null,
          nome: e.nome.toUpperCase(),
          nascimento: e.nascimento,
          conviteResumo: resumoConvite(codigo),
          conviteValidoAte: validoAte,
          origem: 'recepcao',
          por: q.login,
        });
        // Quem pede é o próprio responsável, no balcão; quem decide é quem conferiu o original (segregação do banco).
        await g.pedirVinculo({
          conta: k.id,
          titular: t.id,
          prontuarioTitular: t.prontuario,
          tipo: e.tipo,
          prova: e.prova,
          arquivoChave: null,
          arquivoHash: null,
          validade: e.validade,
          escopos,
          canal: 'balcao',
          por: quemDaConta(k.id),
          decididoPor: q.login,
        });
        return k.id;
      },
      (id) =>
        this.trilhaInterna(q, {
          evento: EVENTOS_AUDITAVEIS.portalContaConvidada.codigo,
          operacao: 'portal.vincularResponsavel',
          tabela: 'conta_portal_paciente',
          id,
          paciente: t.id,
          chave: `balcao:${e.tipo}`,
        }),
    );
    return this.emitido(conta, codigo, validoAte);
  }

  private async contaParaAgir(q: QuemInterno, conta: string): Promise<ContaPortal> {
    const k = await this.porta.conta(this.ctx(q.hospital), Number(conta));
    if (!k) return naoEncontrado('Conta não encontrada');
    return k;
  }

  async bloquear(q: QuemInterno, e: BloquearContaPortal): Promise<ContaPortalResumo> {
    const k = await this.contaParaAgir(q, e.conta);
    if (k.situacao !== 'ativa' && k.situacao !== 'bloqueada')
      recusa('convidada-nao-bloqueia', 'Só a conta ativa pode ser bloqueada.');
    if (k.situacao === 'bloqueada') recusa('ja-bloqueada', 'A conta já está bloqueada.');
    const c = this.ctx(q.hospital);
    await this.gravar(
      c,
      (g) => g.bloquear(k.id, k.versao, { motivo: e.motivo, por: q.login }),
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalContaBloqueada.codigo,
        operacao: 'portal.bloquearConta',
        tabela: 'conta_portal_paciente',
        id: k.id,
        paciente: k.paciente,
        chave: `bloqueio:${e.motivo}`,
      }),
    );
    for (const s of this.sessoes.values())
      if (s.conta === k.id && s.hospital === q.hospital) this.sessoes.delete(s.id);
    return (await this.resumoAtual(q, k.id))!;
  }

  private async resumoAtual(q: QuemInterno, conta: number): Promise<ContaPortalResumo | null> {
    const c = this.ctx(q.hospital);
    const k = await this.porta.conta(c, conta);
    if (!k) return null;
    const v = k.paciente !== null ? await this.porta.vinculosDoTitular(c, k.paciente) : [];
    return this.resumoConta(k, v.filter((x) => x.situacao === 'ativo').length);
  }

  /** W0-10: o atendente registra o e-mail novo no balcão; a troca também só vale com o link confirmado no e-mail novo. */
  async trocarEmailNoBalcao(q: QuemInterno, e: TrocarEmailContaPortal): Promise<TrocaEmailPedida> {
    const k = await this.contaParaAgir(q, e.conta);
    return this.abrirTrocaEmail(this.ctx(q.hospital), k, {
      email: e.email,
      origem: 'balcao',
      motivo: e.motivo,
      por: q.login,
      trilha: this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalEmailTrocaPedida.codigo,
        operacao: 'portal.trocarEmail',
        tabela: 'conta_portal_paciente',
        id: k.id,
        paciente: k.paciente,
        chave: `balcao:${e.motivo}`,
      }),
    });
  }

  /** W0-10: o pedido pendente da conta visto pela recepção (o e-mail novo mascarado e a validade). */
  async trocaEmailDaConta(q: QuemInterno, conta: string): Promise<TrocaEmailPedida | null> {
    const k = await this.contaParaAgir(q, conta);
    return this.trocaEmailPendente(this.ctx(q.hospital), k.id);
  }

  /** W0-10: o atendente cancela o pedido pendente da troca do e-mail (com o motivo na trilha). */
  async cancelarTrocaEmailNoBalcao(q: QuemInterno, conta: string): Promise<void> {
    const k = await this.contaParaAgir(q, conta);
    const c = this.ctx(q.hospital);
    const t = await this.porta.trocaEmailPendente(c, k.id);
    if (!t) return naoEncontrado('Nenhuma troca de e-mail pendente');
    await this.gravar(
      c,
      (g) => g.cancelarTrocaEmail(t.id),
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalEmailTrocaPedida.codigo,
        operacao: 'portal.trocarEmail',
        tabela: 'conta_portal_paciente',
        id: k.id,
        paciente: k.paciente,
        chave: 'cancelada:balcao',
      }),
    );
  }

  /**
   * W0-10: o atendente redefine o segundo fator (aparelho perdido ou trocado, suspeita de fraude): a conta volta a
   * convidada, sem senha nem autenticador, e sai um convite novo impresso (o paciente refaz o acesso).
   */
  async redefinirSegundoFator(
    q: QuemInterno,
    e: RedefinirSegundoFatorPortal,
  ): Promise<{ conta: ContaPortalResumo; convite: ConviteEmitido }> {
    const k = await this.contaParaAgir(q, e.conta);
    if (k.situacao !== 'ativa' && k.situacao !== 'bloqueada')
      recusa('nao-ativada', 'A conta ainda não foi ativada (ou já foi encerrada).');
    const convite = await this.refazerAcesso(q, k, `redefinir:${e.motivo}`);
    return { conta: (await this.resumoAtual(q, k.id))!, convite };
  }

  private async refazerAcesso(q: QuemInterno, k: ContaPortal, chave: string): Promise<ConviteEmitido> {
    const { codigo, validoAte } = await this.novoConvite(q.hospital);
    await this.gravar(
      this.ctx(q.hospital),
      (g) =>
        g.reemitirConvite(k.id, k.versao, {
          conviteResumo: resumoConvite(codigo),
          conviteValidoAte: validoAte,
          origem: 'recepcao',
          por: q.login,
          refazer: true,
        }),
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalSegundoFatorTrocado.codigo,
        operacao: 'portal.bloquearConta',
        tabela: 'conta_portal_paciente',
        id: k.id,
        paciente: k.paciente,
        chave,
      }),
    );
    this.encerrarSessoes(q.hospital, k.id);
    return this.emitido(k.id, codigo, validoAte);
  }

  /** Desbloquear; com `refazerSegundoFator`, a conta volta a convidada e sai um convite novo (aparelho perdido). */
  async desbloquear(
    q: QuemInterno,
    e: DesbloquearContaPortal,
  ): Promise<{ conta: ContaPortalResumo; convite: ConviteEmitido | null }> {
    const k = await this.contaParaAgir(q, e.conta);
    if (k.situacao !== 'bloqueada' && !k.bloqueadoAte && !e.refazerSegundoFator)
      recusa('nao-bloqueada', 'A conta não está bloqueada.');
    if (k.situacao !== 'ativa' && k.situacao !== 'bloqueada')
      recusa('nao-bloqueada', 'A conta ainda não foi ativada.');
    const c = this.ctx(q.hospital);
    let convite: ConviteEmitido | null = null;
    if (e.refazerSegundoFator) convite = await this.refazerAcesso(q, k, 'refazer-acesso');
    else
      await this.gravar(
        c,
        (g) => g.desbloquear(k.id, k.versao, q.login),
        this.trilhaInterna(q, {
          evento: EVENTOS_AUDITAVEIS.portalContaBloqueada.codigo,
          operacao: 'portal.bloquearConta',
          tabela: 'conta_portal_paciente',
          id: k.id,
          paciente: k.paciente,
          chave: 'desbloqueio',
        }),
      );
    for (const s of this.sessoes.values())
      if (s.conta === k.id && s.hospital === q.hospital) this.sessoes.delete(s.id);
    return { conta: (await this.resumoAtual(q, k.id))!, convite };
  }

  async encerrar(q: QuemInterno, e: EncerrarContaPortal): Promise<ContaPortalResumo> {
    const k = await this.contaParaAgir(q, e.conta);
    if (k.situacao === 'encerrada') recusa('encerrada', 'A conta já está encerrada.');
    const c = this.ctx(q.hospital);
    const meus = await this.porta.vinculosDaConta(c, k.id);
    const deMim =
      e.motivo === 'obito' && k.paciente !== null ? await this.porta.vinculosDoTitular(c, k.paciente) : [];
    await this.gravar(
      c,
      async (g) => {
        await g.encerrar(k.id, k.versao, { motivo: e.motivo, por: q.login });
        for (const v of meus.filter((x) => x.situacao === 'ativo' || x.situacao === 'pendente'))
          await g.encerrarVinculo(v.id, v.versao, { motivo: 'revogado-pelo-hospital', por: q.login });
        for (const v of deMim.filter((x) => x.situacao === 'ativo' || x.situacao === 'pendente'))
          await g.encerrarVinculo(v.id, v.versao, { motivo: 'obito-do-titular', por: q.login });
      },
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalContaEncerrada.codigo,
        operacao: 'portal.encerrarConta',
        tabela: 'conta_portal_paciente',
        id: k.id,
        paciente: k.paciente,
        chave: e.motivo,
      }),
    );
    for (const s of this.sessoes.values())
      if (s.conta === k.id && s.hospital === q.hospital) this.sessoes.delete(s.id);
    return (await this.resumoAtual(q, k.id))!;
  }

  // ── Lado interno: conferência dos vínculos ───────────────────────────────────────────────────────────────────────

  /** O que a conferência precisa de cada vínculo, lido uma vez por pedido (a idade da conta própria e os incapazes). */
  private async baseConferencia(c: ContextoPortal): Promise<BaseConferencia> {
    const capacidades = await this.porta.capacidadesCivis(c);
    return {
      idade: await this.idadeContaPropria(c.hospital),
      hoje: dia(this.agora()),
      incapazes: new Set(capacidades.filter((x) => /incapaz/i.test(x.descricao)).map((x) => x.id)),
    };
  }

  /** Um vínculo como a conferência o mostra (o titular, o responsável e os sinais do cadastro). */
  private async paraConferir(
    c: ContextoPortal,
    v: VinculoPortal,
    b: BaseConferencia,
  ): Promise<VinculoParaConferir> {
    const t = await this.porta.paciente(c, v.titular);
    const resp = await this.porta.conta(c, v.conta);
    const base = await this.resumoVinculo(c, v, t?.primeiroNome ?? '', b.idade);
    const guardiao =
      resp?.paciente !== null &&
      resp?.paciente !== undefined &&
      (v.tipo === 'guardiao' || v.tipo === 'pai-mae' || v.tipo === 'tutor')
        ? (await this.porta.guardiaoConfere(c, v.titular, resp.paciente))
          ? ('confere' as const)
          : ('nao-confere' as const)
        : null;
    return {
      ...base,
      prontuarioTitular: v.prontuarioTitular,
      idadeTitular: idadeEm(t?.nascimento ?? null, b.hoje),
      responsavelConta: String(v.conta),
      primeiroNomeResponsavel: await this.nomeDoResponsavel(c, v.conta),
      diasNaFila: Math.max(0, Math.floor((this.agora().getTime() - v.pedidoEm.getTime()) / 86_400_000)),
      canal: v.canal,
      temArquivo: v.arquivoChave !== null,
      guardiao,
      curatelado:
        t?.capacidadeCivil !== null && t?.capacidadeCivil !== undefined && b.incapazes.has(t.capacidadeCivil),
      motivoRecusa: v.motivoRecusa,
    };
  }

  /**
   * A fila da conferência, uma página por vez (por ordem de chegada; o cursor é o ID do último item): uma situação ou
   * todas, e a busca pelo prontuário do titular (os cadastros do prontuário, pelo índice do titular).
   */
  async fila(
    q: QuemInterno,
    f: {
      situacao: VinculoPortal['situacao'] | null;
      prontuario?: number | null;
      depoisDe?: number | null;
    },
  ): Promise<FilaVinculos> {
    const c = this.ctx(q.hospital);
    const titulares =
      f.prontuario !== null && f.prontuario !== undefined
        ? (await this.porta.pacientesPorProntuario(c, f.prontuario)).map((p) => p.id)
        : null;
    const pagina = await this.porta.filaVinculos(c, {
      situacao: f.situacao,
      titulares,
      depoisDe: f.depoisDe ?? null,
    });
    const b = await this.baseConferencia(c);
    const itens: VinculoParaConferir[] = [];
    for (const v of pagina.itens) itens.push(await this.paraConferir(c, v, b));
    const ultimo = pagina.itens.at(-1);
    return { itens, proximo: pagina.haMais && ultimo ? String(ultimo.id) : null };
  }

  /** Os responsáveis vigentes (pendentes e ativos) de um paciente, na ficha do paciente (encerrar daqui). */
  async responsaveisDoPaciente(q: QuemInterno, paciente: number): Promise<VinculoParaConferir[]> {
    const c = this.ctx(q.hospital);
    const vigentes = (await this.porta.vinculosDoTitular(c, paciente)).filter(
      (v) => v.situacao === 'ativo' || v.situacao === 'pendente',
    );
    if (vigentes.length === 0) return [];
    const b = await this.baseConferencia(c);
    const r: VinculoParaConferir[] = [];
    for (const v of vigentes) r.push(await this.paraConferir(c, v, b));
    return r;
  }

  /** O arquivo da prova, para quem confere (a leitura vai à trilha). */
  async prova(q: QuemInterno, vinculo: number): Promise<{ tipo: string; conteudo: string }> {
    const c = this.ctx(q.hospital);
    const v = await this.porta.vinculo(c, vinculo);
    if (!v || !v.arquivoChave) return naoEncontrado('Documento não encontrado');
    const f = await this.provas.ler(q.hospital, v.arquivoChave);
    if (!f) return naoEncontrado('Documento não encontrado', 'O arquivo do documento não está disponível.');
    await this.gravar(
      c,
      async () => null,
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalVinculoDecidido.codigo,
        operacao: 'portal.vincularResponsavel',
        tabela: 'conta_portal_paciente_dependente',
        id: v.id,
        paciente: v.titular,
        chave: 'prova-lida',
      }),
    );
    return { tipo: f.tipo, conteudo: Buffer.from(f.bytes).toString('base64') };
  }

  async decidir(q: QuemInterno, e: DecidirVinculo): Promise<VinculoParaConferir> {
    const c = this.ctx(q.hospital);
    const v = await this.porta.vinculo(c, Number(e.vinculo));
    if (!v) return naoEncontrado('Pedido não encontrado');
    const aprovar = e.decisao === 'aprovar';
    const escopos = aprovar ? escoposAprovados(v.tipo as TipoVinculoResponsavel, e.escopos) : [];
    const r = conferirDecisaoVinculo(
      { situacao: v.situacao, tipo: v.tipo as TipoVinculoResponsavel },
      { aprovar, escopos },
      v.pedidoPor === q.login,
    );
    if (r)
      recusa(
        r,
        {
          'ja-decidido': 'Este pedido já foi decidido.',
          'quem-pediu-nao-decide': 'Quem pediu o acesso não pode aprovar o próprio pedido.',
          'procurador-sem-escopo': 'Marque o que a procuração permite antes de aprovar.',
        }[r],
      );
    const validade = aprovar ? ((e.decisao === 'aprovar' ? e.validade : null) ?? v.validade) : null;
    if (aprovar && v.tipo === 'procurador') {
      const max = await this.param(q.hospital, 'portal.procuracaoValidadeMaximaDias', 365);
      const t = await this.porta.paciente(c, v.titular);
      const rv = conferirPedidoVinculo(
        { tipo: 'procurador', prova: 'procuracao', validade, paraSiMesmo: false, jaExiste: false },
        { nascimento: t?.nascimento ?? null, obito: t?.obito ?? false, ativo: t?.ativo ?? false },
        dia(this.agora()),
        await this.idadeContaPropria(q.hospital),
        max,
      );
      if (rv) recusa(rv, mensagemVinculo(rv));
    }
    await this.gravar(
      c,
      (g) =>
        g.decidirVinculo(
          v.id,
          v.versao,
          e.decisao === 'aprovar'
            ? { aprovar: true, escopos, validade, por: q.login }
            : { aprovar: false, motivo: e.motivo, por: q.login },
        ),
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalVinculoDecidido.codigo,
        operacao: 'portal.vincularResponsavel',
        tabela: 'conta_portal_paciente_dependente',
        id: v.id,
        paciente: v.titular,
        chave: aprovar ? `aprovado:${escopos.join(',')}` : 'recusado',
      }),
    );
    // A resposta é o vínculo decidido, relido (nunca a fila inteira filtrada).
    const lido = await this.porta.vinculo(c, v.id);
    if (!lido) return naoEncontrado('Pedido não encontrado');
    return this.paraConferir(c, lido, await this.baseConferencia(c));
  }

  async encerrarVinculo(q: QuemInterno, e: EncerrarVinculo): Promise<void> {
    const c = this.ctx(q.hospital);
    const v = await this.porta.vinculo(c, Number(e.vinculo));
    if (!v) return naoEncontrado('Acesso não encontrado');
    if (v.situacao !== 'ativo' && v.situacao !== 'pendente')
      recusa('ja-encerrado', 'Este acesso já terminou.');
    await this.gravar(
      c,
      (g) => g.encerrarVinculo(v.id, v.versao, { motivo: e.motivo, por: q.login }),
      this.trilhaInterna(q, {
        evento: EVENTOS_AUDITAVEIS.portalVinculoDecidido.codigo,
        operacao: 'portal.vincularResponsavel',
        tabela: 'conta_portal_paciente_dependente',
        id: v.id,
        paciente: v.titular,
        chave: e.motivo,
      }),
    );
  }

  private temporizador: ReturnType<typeof setInterval> | null = null;

  /** O job da vigência a cada `intervaloMs` (padrão 6 h), em todos os estabelecimentos configurados. */
  iniciarVigia(intervaloMs = 6 * 3_600_000): void {
    if (this.temporizador) return;
    let emCiclo = false;
    this.temporizador = setInterval(() => {
      if (emCiclo) return;
      emCiclo = true;
      void (async () => {
        for (const h of this.cfg.estabelecimentos ?? []) {
          try {
            await this.varrerVigencias(h);
          } catch (e) {
            const codigo = codigoDoErro(e);
            logger.warn(
              { modulo: 'portal-paciente', operacao: 'vigia-vigencia', codigo, estabelecimento: h },
              'Varredura da vigência do portal falhou.',
            );
            // Sem o modelo da conta ou do vínculo no banco, a varredura nunca vai passar: o job para (aviso único).
            if (codigo === 'recurso-sem-modelo') {
              this.pararVigia();
              return;
            }
          }
        }
      })().finally(() => {
        emCiclo = false;
      });
    }, intervaloMs);
    this.temporizador.unref?.();
  }

  pararVigia(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  // ── Job: vigência dos vínculos e das contas ──────────────────────────────────────────────────────────────────────

  /**
   * Encerra os vínculos que deixaram de valer (maioridade, validade, óbito do titular) e as contas de pacientes com
   * óbito ou unificados em outro cadastro (D-UNIF-50: a conta encerra com `unificacao`; o convite sai pelo cadastro que
   * ficou). Idempotente: o que já foi encerrado não é achado de novo.
   */
  async varrerVigencias(hospital: string): Promise<{ vinculos: number; contas: number }> {
    if (!(await this.ligado(hospital))) return { vinculos: 0, contas: 0 };
    const c = this.ctx(hospital);
    const hoje = dia(this.agora());
    const idade = await this.idadeContaPropria(hospital);
    let vinculos = 0;
    let contas = 0;
    const linha = (tabela: string, id: number, paciente: number | null, chave: string, evento: string) =>
      this.trilha(hospital, {
        evento,
        operacao: 'portal.vigencia',
        tabela,
        id,
        usuario: USUARIO_JOB_PORTAL,
        paciente,
        chave,
      });
    for (const v of await this.porta.vinculosAtivos(c)) {
      const p = await this.porta.paciente(c, v.titular);
      const vig = vigenciaDoVinculo(
        {
          tipo: v.tipo as TipoVinculoResponsavel,
          situacao: 'ativo',
          validade: v.validade,
          escopos: v.escopos as EscopoVinculo[],
        },
        { nascimento: p?.nascimento ?? null, obito: p?.obito ?? false, ativo: p?.ativo ?? false },
        hoje,
        idade,
      );
      const motivo = vig.vigente
        ? p && p.unificadoEm === null
          ? null
          : 'revogado-pelo-hospital'
        : (vig.motivo ?? 'validade');
      if (!motivo) continue;
      await this.gravar(
        c,
        (g) => g.encerrarVinculo(v.id, null, { motivo, por: USUARIO_JOB_PORTAL }),
        linha(
          'conta_portal_paciente_dependente',
          v.id,
          v.titular,
          motivo,
          EVENTOS_AUDITAVEIS.portalVinculoDecidido.codigo,
        ),
      ).catch((e: unknown) => avisoDaVarredura('encerrar-vinculo', e));
      vinculos++;
    }
    for (const k of await this.porta.contasAbertas(c)) {
      const p = await this.porta.paciente(c, k.paciente);
      const motivo = !p ? null : p.obito ? 'obito' : p.unificadoEm !== null ? 'unificacao' : null;
      if (!motivo) continue;
      await this.gravar(
        c,
        (g) => g.encerrar(k.conta, null, { motivo, por: USUARIO_JOB_PORTAL }),
        linha(
          'conta_portal_paciente',
          k.conta,
          k.paciente,
          motivo,
          EVENTOS_AUDITAVEIS.portalContaEncerrada.codigo,
        ),
      ).catch((e: unknown) => avisoDaVarredura('encerrar-conta', e));
      contas++;
    }
    return { vinculos, contas };
  }
}
