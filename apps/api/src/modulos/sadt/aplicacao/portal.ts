// Portal de resultados (ficha do M26, regra 9; cap-08 §8.3): um domínio de identidade separado dos usuários internos.
//   - paciente: o código do protocolo (impresso na ficha; só o resumo SHA-256 fica guardado) e a data de nascimento;
//   - médico externo: conselho, UF e número, a senha da conta própria (Argon2id) e o código do segundo fator (TOTP);
// com limite de tentativas por credencial (bloqueio temporário, parâmetros do estabelecimento) e de taxa por origem. A
// sessão do portal é própria (cookie HttpOnly e CSRF por token duplo, como a da plataforma), expira sozinha e nunca vale
// nas telas internas. Só aparecem exames liberados de setores publicados; o médico vê só os pedidos em que é o
// solicitante (DP-43). Toda visualização e todo download gravam data e IP.
// Melhoria: o portal opera no banco do cliente pelo contexto do núcleo (cliente e estabelecimento pelo código do
// endereço, sem usuário interno: o acesso é o do portal), e cada tentativa, entrada e leitura vai à trilha_auditoria
// do cliente com a tabela do modelo (acesso_resultado_portal ou conta_portal_profissional_externo), o IP e o paciente.
import { createHash, randomBytes } from 'node:crypto';
import {
  type AutocadastroMedicoEntrada,
  type ImagemDoLaudo,
  CHAVES_SADT,
  type EntrarPortalMedicoEntrada,
  type EntrarPortalPacienteEntrada,
  EVENTOS_AUDITAVEIS,
  type LaudoPortalAberto,
  type ListaPortal,
  type SessaoPortal,
  type ValidacaoLaudo,
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
import { bloqueada, dentroDaTaxa, depoisDaTentativa, ipParaGravar } from '@sgh/dominio-sadt';
import { ErroOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../../problema.filter.js';
import { contextoDoEstabelecimento } from '../../cadastro/contexto-nucleo.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { ContextoSadt, PortaSadt } from '../porta.js';
import { ligadaNoEstabelecimento, parametroDoEstabelecimento } from './liberacao.js';
import { TABELA_CONTA_MEDICO_PORTAL, TABELA_PORTAL } from './servico.js';

export const USUARIO_PORTAL = 'SGH.PORTAL';
const TAXA_POR_MINUTO = 10;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

/** Contexto do portal: o do núcleo, com o código da rede e do estabelecimento (parâmetros e imagens do laudo). */
export type ContextoPortal = ContextoSadt & { readonly rede: string; readonly hospital: string };

/** O acesso ao portal como a porta o lê (protocolo do paciente ou conta do médico externo). */
export type AcessoPortal = NonNullable<Awaited<ReturnType<PortaSadt['acessoPorId']>>>;

interface SessaoInterna {
  readonly id: string;
  readonly csrf: string;
  readonly hospital: string;
  readonly perfil: 'paciente' | 'medicoExterno';
  readonly acesso: number;
  readonly paciente: number | null;
  readonly reg: number | null;
  readonly solicitante: number | null;
  readonly nome: string;
  readonly expira: number;
}

export interface EntradaFeita {
  readonly id: string;
  readonly csrf: string;
  readonly ttlSegundos: number;
  readonly sessao: SessaoPortal;
}

const credencialInvalida = (): never => {
  throw new ErroProblema(
    'nao-autenticado',
    401,
    'Dados de acesso inválidos',
    'Confira os dados de acesso e tente de novo.',
  );
};

export class ServicoPortal {
  private readonly sessoes = new Map<string, SessaoInterna>();
  private readonly taxa = new Map<string, number[]>();

  constructor(
    private readonly porta: PortaSadt,
    private readonly rede: string,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly chaveMestra: Buffer | null,
    private readonly produto: string,
    /** O estabelecimento do endereço sem código (o primeiro configurado). */
    readonly estabelecimentoPadrao: string | null = null,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Contexto do núcleo do portal: o estabelecimento do endereço, sem usuário interno (o acesso é o do portal). */
  private c(hospital: string, correlacao = `portal-${randomBytes(6).toString('hex')}`): ContextoPortal {
    return { ...contextoDoEstabelecimento(hospital), usuario: null, correlacao, rede: this.rede, hospital };
  }

  /** M47 (etapa 3): quem dá o link das imagens do laudo aberto (a lista de trabalho DICOM); sem ele, sem link. */
  imagens: ((c: ContextoPortal, exame: number) => Promise<ImagemDoLaudo | null>) | null = null;

  private async exigirLigado(hospital: string): Promise<void> {
    const memoria = this.porta.destino === 'memoria' && !this.configuracao;
    if (
      memoria ||
      (await ligadaNoEstabelecimento(
        this.configuracao,
        this.rede,
        hospital,
        CHAVES_SADT.portal,
        USUARIO_PORTAL,
      ))
    )
      return;
    throw new ErroProblema(
      'recurso-desligado',
      403,
      'Portal indisponível',
      'O portal de resultados ainda não foi liberado neste estabelecimento.',
      { codigo: 'recurso-desligado' },
    );
  }

  /** Limite de taxa por origem (10 pedidos de acesso por minuto). */
  private conferirTaxa(ip: string): void {
    const agora = this.agora().getTime();
    const lista = (this.taxa.get(ip) ?? []).filter((x) => agora - x < 60_000);
    if (!dentroDaTaxa(lista, agora, TAXA_POR_MINUTO))
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
    acesso: number,
    resultado: 'sucesso' | 'falha',
    ip: string,
    paciente: number | null,
    perfil: 'paciente' | 'medicoExterno' = paciente !== null ? 'paciente' : 'medicoExterno',
  ): TrilhaDaGravacao {
    const c = this.c(hospital);
    return {
      estabelecimento: c.estabelecimento,
      usuario: null,
      acao: 'operacao',
      entidade: perfil === 'paciente' ? TABELA_PORTAL : TABELA_CONTA_MEDICO_PORTAL,
      entidadeId: acesso > 0 ? acesso : null,
      dadosDepois: {
        evento: EVENTOS_AUDITAVEIS.sadtPortalAcesso.codigo,
        recurso: CHAVES_SADT.portal,
        operacao: 'acesso ao portal de resultados',
        resultado,
        ...(paciente ? { paciente } : {}),
      },
      enderecoIp: ipParaGravar(ip).slice(0, 45),
      correlacao: c.correlacao,
    };
  }

  /** O resultado da tentativa: as erradas e o bloqueio (os parâmetros do estabelecimento) e a trilha. */
  private async tentativa(hospital: string, a: AcessoPortal, acertou: boolean, ip: string): Promise<void> {
    const limite =
      (await parametroDoEstabelecimento(this.configuracao, this.rede, hospital, 'sadt.portalTentativas')) ||
      5;
    const minutos =
      (await parametroDoEstabelecimento(
        this.configuracao,
        this.rede,
        hospital,
        'sadt.portalBloqueioMinutos',
      )) || 15;
    const agora = this.agora().toISOString();
    const t = depoisDaTentativa(
      { erradas: a.tentativas, bloqueadaAte: a.bloqueadoAte ? a.bloqueadoAte.toISOString() : null },
      acertou,
      agora,
      limite,
      minutos,
    );
    await this.porta.gravarSgh(
      this.c(hospital),
      this.trilha(hospital, a.id, acertou ? 'sucesso' : 'falha', ip, a.paciente, a.perfil),
      (g) =>
        g.registrarTentativaPortal({
          id: a.id,
          tentativas: t.erradas,
          bloqueadoAte: t.bloqueadaAte ? new Date(t.bloqueadaAte) : null,
          acertou,
        }),
    );
  }

  private exigirNaoBloqueada(a: AcessoPortal): void {
    const agora = this.agora().toISOString();
    if (
      bloqueada(
        { erradas: a.tentativas, bloqueadaAte: a.bloqueadoAte ? a.bloqueadoAte.toISOString() : null },
        agora,
      )
    )
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Acesso bloqueado por um tempo',
        'Muitas tentativas erradas: o acesso fica bloqueado por alguns minutos.',
      );
  }

  private async abrirSessao(
    hospital: string,
    s: Omit<SessaoInterna, 'id' | 'csrf' | 'expira' | 'hospital'>,
  ): Promise<EntradaFeita> {
    const minutos =
      (await parametroDoEstabelecimento(
        this.configuracao,
        this.rede,
        hospital,
        'sadt.portalSessaoMinutos',
      )) || 20;
    const id = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const expira = this.agora().getTime() + minutos * 60_000;
    this.sessoes.set(id, { ...s, id, csrf, hospital, expira });
    return {
      id,
      csrf,
      ttlSegundos: minutos * 60,
      sessao: { perfil: s.perfil, nome: s.nome, expiraEm: new Date(expira).toISOString() },
    };
  }

  async entrarPaciente(hospital: string, e: EntrarPortalPacienteEntrada, ip: string): Promise<EntradaFeita> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const a = await this.porta.acessoPorProtocolo(this.c(hospital), sha256(e.protocolo));
    if (!a || a.situacao !== 'ativo' || a.perfil !== 'paciente' || a.paciente === null)
      return credencialInvalida();
    this.exigirNaoBloqueada(a);
    const p = await this.porta.nascimentoDoPaciente(this.c(hospital), a.paciente);
    const acertou = !!p && p.nascimento === e.nascimento;
    await this.tentativa(hospital, a, acertou, ip);
    if (!acertou || !p) return credencialInvalida();
    return this.abrirSessao(hospital, {
      perfil: 'paciente',
      acesso: a.id,
      paciente: a.paciente,
      reg: a.reg,
      solicitante: null,
      nome: p.nome.split(' ')[0] ?? '',
    });
  }

  async entrarMedico(hospital: string, e: EntrarPortalMedicoEntrada, ip: string): Promise<EntradaFeita> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    const a = await this.porta.acessoDoMedico(this.c(hospital), {
      conselho: e.conselho,
      uf: e.uf,
      numero: e.numero,
    });
    // A senha é conferida mesmo sem conta (tempo constante: não revela se o médico tem cadastro).
    const senhaOk = await conferirSenha(e.senha, a?.senhaResumo ?? null);
    if (!a || a.perfil !== 'medicoExterno') return credencialInvalida();
    this.exigirNaoBloqueada(a);
    // A situação do cadastro (em análise, recusado) só aparece para quem acertou a senha: conselho, UF e número são
    // públicos, e a resposta não pode revelar se o médico pediu acesso. A senha errada conta tentativa também aqui.
    if (a.situacao !== 'ativo' && !senhaOk) {
      await this.tentativa(hospital, a, false, ip);
      return credencialInvalida();
    }
    if (a.situacao !== 'ativo')
      throw new ErroProblema(
        'nao-autenticado',
        401,
        a.situacao === 'pendente'
          ? 'Cadastro em análise'
          : a.situacao === 'bloqueado'
            ? 'Acesso bloqueado'
            : 'Cadastro sem acesso',
        a.situacao === 'pendente'
          ? 'O cadastro ainda está em análise pelo hospital: você recebe a resposta pelo contato informado.'
          : a.situacao === 'bloqueado'
            ? 'O acesso ao portal está bloqueado pelo hospital: fale com o hospital.'
            : 'O cadastro não tem acesso ao portal.',
      );
    const totpOk = this.segundoFatorConfere(a.segundoFator, e.codigo);
    const acertou = senhaOk && totpOk;
    await this.tentativa(hospital, a, acertou, ip);
    if (!acertou) return credencialInvalida();
    return this.abrirSessao(hospital, {
      perfil: 'medicoExterno',
      acesso: a.id,
      paciente: null,
      reg: null,
      solicitante: a.solicitante,
      nome: a.nome ?? '',
    });
  }

  /** W0-10: a senha e o código atuais da conta conferidos de novo (quem troca a senha ou o e-mail é o titular). */
  async credenciaisConferem(a: AcessoPortal, senha: string, codigo: string): Promise<boolean> {
    const senhaOk = await conferirSenha(senha, a.senhaResumo);
    return senhaOk && this.segundoFatorConfere(a.segundoFator, codigo);
  }

  /** W0-10: encerra as sessões abertas da conta (menos `manter`, a de quem trocou a credencial). */
  encerrarSessoesDaConta(hospital: string, acesso: number, manter: string | null = null): void {
    for (const s of this.sessoes.values())
      if (s.hospital === hospital && s.acesso === acesso && s.id !== manter) this.sessoes.delete(s.id);
  }

  private segundoFatorConfere(envelope: string | null, codigo: string): boolean {
    if (!this.chaveMestra || !envelope) return false;
    try {
      return verificarTotp(decifrarSegredo(envelope, this.chaveMestra), codigo, this.agora().getTime());
    } catch {
      return false;
    }
  }

  /** O autocadastro do médico solicitante (pendente até a aprovação interna; o segredo do autenticador sai uma vez). */
  async autocadastro(
    hospital: string,
    e: AutocadastroMedicoEntrada,
    ip: string,
  ): Promise<{ otpauth: string; mensagem: string }> {
    await this.exigirLigado(hospital);
    this.conferirTaxa(ip);
    if (!this.chaveMestra)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cadastro indisponível',
        'O cadastro do segundo fator não está configurado neste ambiente.',
      );
    const segredo = gerarSegredoBase32();
    const senhaResumo = await cifrarSenha(e.senha);
    await this.porta.gravarSgh(
      this.c(hospital),
      (id: number) => this.trilha(hospital, id, 'sucesso', ip, null),
      (g) =>
        g.registrarAutocadastro({
          nome: e.nome,
          conselho: e.conselho,
          uf: e.uf,
          numero: e.numero,
          cpf: e.cpf,
          email: e.email,
          senhaResumo,
          segundoFator: cifrarSegredo(segredo, this.chaveMestra as Buffer),
        }),
    );
    return {
      otpauth: uriOtpauth(`${e.conselho}-${e.uf}-${e.numero}`, this.produto, segredo),
      mensagem:
        'Cadastro enviado. Guarde o código no aplicativo autenticador agora: o acesso começa depois da aprovação do hospital.',
    };
  }

  /** A sessão do portal pelo cookie (401 sem ela); nas escritas, o CSRF por token duplo. */
  sessao(id: string | null, csrf?: { cookie: string | null; cabecalho: string | null }): SessaoInterna {
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
    if (id) this.sessoes.delete(id);
  }

  eu(s: SessaoInterna): SessaoPortal {
    return { perfil: s.perfil, nome: s.nome, expiraEm: new Date(s.expira).toISOString() };
  }

  async laudos(s: SessaoInterna): Promise<ListaPortal> {
    await this.exigirLigado(s.hospital);
    const atos = await this.porta.atosPublicados(this.c(s.hospital));
    if (s.perfil === 'paciente' && s.paciente !== null)
      return this.porta.laudosPortalDoPaciente(this.c(s.hospital), {
        paciente: s.paciente,
        reg: s.reg,
        atos,
      });
    if (s.perfil === 'medicoExterno' && s.solicitante !== null) {
      const desde = new Date(this.agora().getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
      return this.porta.laudosPortalDoMedico(this.c(s.hospital), { solicitante: s.solicitante, atos, desde });
    }
    return { laudos: [], cortada: false };
  }

  /**
   * O laudo aberto: o dono confere (paciente ou o médico solicitante), o setor publicado e a liberação vigente; a
   * visualização (ou o download) grava data e IP pela receita do portal e a leitura vai à versão do resultado.
   */
  async abrir(
    s: SessaoInterna,
    liberacao: number,
    ip: string,
    acao: 'visualizacao' | 'download',
  ): Promise<LaudoPortalAberto> {
    await this.exigirLigado(s.hospital);
    const c = this.c(s.hospital);
    const l = await this.porta.laudoPortal(c, liberacao);
    const atos = await this.porta.atosPublicados(c);
    const dono =
      l !== null &&
      ((s.perfil === 'paciente' && l.paciente === s.paciente && (s.reg === null || l.reg === s.reg)) ||
        (s.perfil === 'medicoExterno' && s.solicitante !== null && l.solicitante === s.solicitante));
    const publicado = l !== null && atos.includes(l.ato);
    if (!l || !dono || !publicado)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Laudo não encontrado',
        'O laudo não está disponível para este acesso.',
      );
    if (!l.laudo.visualizado)
      await this.porta
        .executar(
          c,
          'sadt.registrarVisualizacaoPortal',
          { liberacao, ip: ipParaGravar(ip), acao },
          {
            ...contextoDoEstabelecimento(s.hospital),
            usuario: null,
            correlacao: `portal-${liberacao}`,
            chaveIdempotencia: `portal-${s.acesso}-${liberacao}-${acao}`,
          },
        )
        .catch((e: unknown) => {
          // Já registrada por outra aba: a leitura segue.
          if (e instanceof ErroOperacao && e.problema.codigo === 'ja-visto') return null;
          throw e;
        });
    await this.porta
      .gravarSgh(c, this.trilha(s.hospital, s.acesso, 'sucesso', ip, l.paciente), (g) =>
        g.registrarLeitura({
          exameItem: l.laudo.exame,
          origem: 'portal',
          usuario: `${USUARIO_PORTAL}.${s.acesso}`.slice(0, 31),
        }),
      )
      .catch(() => undefined);
    return {
      laudo: {
        ...l.laudo,
        visualizado: true,
        paciente: s.perfil === 'medicoExterno' ? l.laudo.paciente : null,
      },
      valores: l.valores,
      texto: l.texto,
      // M47 (etapa 3): o link das imagens do exame (estudo concluído no PACS; o laudo aberto já está liberado).
      imagem: this.imagens ? await this.imagens(c, l.laudo.exame) : null,
    };
  }

  /** Validação pública do laudo pelo código (sem conteúdo clínico nem dado do paciente). */
  async validar(hospital: string, codigo: string): Promise<ValidacaoLaudo> {
    const r = await this.porta.validarLaudo(this.c(hospital), codigo);
    return {
      valido: r.valido,
      numero: r.numero,
      emitidoEm: r.emitidoEm,
      estabelecimento: r.valido ? hospital : null,
      exames: r.exames,
    };
  }
}
