// Contas da plataforma (ADR 0021): login PRÓPRIO (separado da porta de entrada dos usuários do SPDATA),
// senha em Argon2id, segundo fator TOTP obrigatório fora de dev/ci, sessão no servidor (armazém Valkey)
// presa ao endereço da rede, cookie HttpOnly próprio e CSRF por token duplo, tentativas contadas antes de
// conferir. Designação (só a PLATAFORMA): cadastrar suporte por e-mail (com convite para a pessoa definir a
// senha), ativar e desativar a função e marcar os estabelecimentos; toda mudança vai à SGH_PLAT_AUDITORIA.
// Nenhuma senha, cifra, segredo TOTP ou token vai a log, resposta ou trilha.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EVENTOS_AUDITAVEIS,
  type ContaPlataformaTela,
  type ConviteTela,
  type EuPlataforma,
} from '@sgh/contratos';
import {
  cifrarSegredo,
  conferirSenha,
  cifrarSenha,
  decifrarSegredo,
  gerarSegredoBase32,
  hashConvite,
  novoConvite,
  passoTotpConferido,
  podeAcessoTotal,
  podeDesignar,
  podeEntrarComo,
  segundoFatorObrigatorio,
  uriOtpauth,
  type ContaRegra,
} from '@sgh/dominio-acesso';
import type { AtribuicaoLida, ContaLida } from '@sgh/legado';
import type { ArmazemSessao } from '../../sessao/armazem.js';
import type { RepositorioPlataforma } from './repositorio.js';

export class ErroPlataforma extends Error {
  constructor(
    readonly tipo:
      | 'credencial-invalida'
      | 'muitas-tentativas'
      | 'sessao-encerrada'
      | 'sem-permissao'
      | 'indisponivel'
      | 'entrada-invalida'
      | 'nao-encontrado'
      | 'conflito'
      | 'rede-desconhecida',
    readonly detalhe?: string,
  ) {
    super(tipo);
    this.name = 'ErroPlataforma';
  }
}

export interface RegistroPlataforma {
  readonly id: string;
  readonly idConta: string;
  readonly rede: string;
  readonly csrf: string;
  readonly criadaMs: number;
  ultimaMs: number;
  /** Marca das credenciais da conta no login (marcaCredencial): senha ou segundo fator redefinidos a mudam. */
  readonly credencial?: string;
}

/**
 * Marca das credenciais da conta (SHA-256 da cifra, do segredo TOTP cifrado e do estado do TOTP; nunca a
 * senha nem o segredo em claro). Guardada na sessão da plataforma e na sessão "como" no login: novo convite,
 * senha definida pelo convite ou segundo fator redefinido mudam a marca, e as sessões antigas deixam de valer
 * (a credencial vazada não continua dando acesso pelo cookie já emitido).
 */
export function marcaCredencial(c: Pick<ContaLida, 'cifra' | 'totpEnv' | 'totpAtivo'>): string {
  return createHash('sha256')
    .update(`sgh-plat-credencial\u0000${c.cifra ?? ''}\u0000${c.totpEnv ?? ''}\u0000${c.totpAtivo ? 1 : 0}`)
    .digest('hex')
    .slice(0, 32);
}

export interface ContaComAtribuicoes extends ContaLida {
  readonly atribuicoes: readonly AtribuicaoLida[];
}

export function regraDaConta(c: ContaComAtribuicoes): ContaRegra {
  return { papel: c.papel, ativo: c.ativo, atribuicoes: c.atribuicoes };
}

export interface ConfigPlataforma {
  readonly ambiente: string;
  readonly produto: string;
  /** PLATAFORMA_CHAVE_MESTRA (envelope do segredo TOTP); null: cadastro do TOTP indisponível. */
  readonly chaveMestra: Buffer | null;
  readonly agora?: () => number;
  /** Duração absoluta e inatividade da sessão da conta da plataforma. */
  readonly duracaoSegundos?: number;
  readonly inatividadeSegundos?: number;
}

export type ResultadoEntradaPlataforma =
  | {
      readonly tipo: 'sessao';
      readonly id: string;
      readonly csrf: string;
      readonly ttlSegundos: number;
      readonly eu: EuPlataforma;
    }
  | {
      readonly tipo: 'segundo-fator';
      readonly segundoFator: 'pedir' | 'cadastrar';
      readonly otpauth?: string;
    };

const PREFIXO = 'plataforma';
/** Tentativas por e-mail E endereço de origem (quem erra de outro lugar não fecha a porta do dono). */
const TENTATIVAS_LIMITE = 5;
/** Teto por endereço de origem, somando todos os e-mails (varredura de contas a partir de um lugar). */
const TENTATIVAS_LIMITE_ORIGEM = 30;
const TENTATIVAS_JANELA_S = 15 * 60;
/** Último passo TOTP aceito por conta: dura mais que a janela de ±1 passo (90 s). */
const TOTP_PASSO_TTL_S = 120;
export const CONVITE_HORAS = 72;

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class ServicoPlataforma {
  private readonly agora: () => number;
  private readonly duracao: number;
  private readonly inatividade: number;

  constructor(
    readonly repo: RepositorioPlataforma,
    private readonly armazem: ArmazemSessao,
    private readonly cfg: ConfigPlataforma,
  ) {
    this.agora = cfg.agora ?? (() => Date.now());
    this.duracao = cfg.duracaoSegundos ?? 8 * 3600;
    this.inatividade = cfg.inatividadeSegundos ?? 30 * 60;
  }

  get segundoFatorObrigatorio(): boolean {
    return segundoFatorObrigatorio(this.cfg.ambiente);
  }

  private chave(id: string): string {
    return `${PREFIXO}:sessao:${id}`;
  }

  private async tentar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroPlataforma) throw e;
      throw new ErroPlataforma('indisponivel', 'O serviço da plataforma está indisponível.');
    }
  }

  async contaCompleta(id: string): Promise<ContaComAtribuicoes | null> {
    return this.tentar(async () => {
      const c = await this.repo.contaPorId(id);
      if (!c) return null;
      return { ...c, atribuicoes: c.papel === 'SUPORTE' ? await this.repo.atribuicoes(id) : [] };
    });
  }

  eu(c: ContaComAtribuicoes, r: RegistroPlataforma): EuPlataforma {
    const regra = regraDaConta(c);
    return {
      conta: { id: c.id, email: c.email, nome: c.nome, papel: c.papel },
      podeEntrarComo: podeEntrarComo(regra),
      podeDesignar: podeDesignar(regra),
      podeAcessoTotal: podeAcessoTotal(regra),
      expiraEm: new Date(r.criadaMs + this.duracao * 1000).toISOString(),
      segundoFatorObrigatorio: this.segundoFatorObrigatorio,
    };
  }

  /**
   * Entrar com e-mail, senha e (quando exigido) o código TOTP. A tentativa é contada ANTES de conferir
   * (INCR atômico), pelo par e-mail + endereço de origem e por endereço de origem: quem erra a senha do dono
   * de outro lugar não fecha a porta dele. Conta inexistente gasta o mesmo tempo de uma conferência.
   */
  async entrar(
    pedido: { email: string; senha: string; codigo?: string | undefined },
    rede: string | null,
    idAnterior: string | null,
    estacao: string,
    origem = 'desconhecida',
  ): Promise<ResultadoEntradaPlataforma> {
    if (!rede)
      throw new ErroPlataforma('rede-desconhecida', 'Este endereço não pertence a uma rede configurada.');
    if (idAnterior) await this.armazem.apagar(this.chave(idAnterior)).catch(() => undefined);
    const de = origem.replace(/[^0-9A-Za-z:.-]/g, '').slice(0, 45) || 'desconhecida';
    const email = pedido.email.trim().toLowerCase();
    const chaveTent = `${PREFIXO}:tentativas:${email}:${de}`;
    const chaveOrigem = `${PREFIXO}:tentativas-origem:${de}`;
    const [n, nOrigem] = await this.tentar(() =>
      Promise.all([
        this.armazem.incrementar(chaveTent, TENTATIVAS_JANELA_S),
        this.armazem.incrementar(chaveOrigem, TENTATIVAS_JANELA_S),
      ]),
    );
    if (n > TENTATIVAS_LIMITE || nOrigem > TENTATIVAS_LIMITE_ORIGEM)
      throw new ErroPlataforma(
        'muitas-tentativas',
        'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
      );
    const conta = await this.tentar(() => this.repo.contaPorEmail(pedido.email));
    const confere = await conferirSenha(pedido.senha, conta?.cifra ?? null);
    if (!conta || !confere || !conta.ativo) {
      await this.repo
        .registrarEventoConta({
          ator: conta?.id ?? null,
          evento: 'plataforma.login.falho',
          contaAlvo: conta?.id ?? null,
          detalhe: null,
          estacao,
        })
        .catch(() => undefined);
      throw new ErroPlataforma('credencial-invalida', 'E-mail ou senha inválidos.');
    }
    // Segundo fator: obrigatório fora de dev/ci; em dev/ci, só se a pessoa já o cadastrou.
    if (conta.totpAtivo || this.segundoFatorObrigatorio) {
      const r = await this.segundoFator(conta, pedido.codigo);
      if (r) return r;
    }
    await this.armazem.apagar(chaveTent).catch(() => undefined);
    // A conta relida depois do segundo fator (o cadastro do TOTP muda a marca das credenciais).
    const completa = await this.contaCompleta(conta.id);
    if (!completa || !completa.ativo)
      throw new ErroPlataforma('credencial-invalida', 'E-mail ou senha inválidos.');
    const t = this.agora();
    const registro: RegistroPlataforma = {
      id: randomUUID(),
      idConta: conta.id,
      rede,
      csrf: randomUUID(),
      criadaMs: t,
      ultimaMs: t,
      credencial: marcaCredencial(completa),
    };
    await this.tentar(() =>
      this.armazem.gravar(this.chave(registro.id), JSON.stringify(registro), this.duracao),
    );
    await this.repo
      .registrarEventoConta({
        ator: conta.id,
        evento: 'plataforma.login',
        contaAlvo: conta.id,
        detalhe: null,
        estacao,
      })
      .catch(() => undefined);
    return {
      tipo: 'sessao',
      id: registro.id,
      csrf: registro.csrf,
      ttlSegundos: this.duracao,
      eu: this.eu(completa, registro),
    };
  }

  /** null: o código conferiu (e, no cadastro, o segundo fator foi ativado). */
  private async segundoFator(
    conta: ContaLida,
    codigo: string | undefined,
  ): Promise<ResultadoEntradaPlataforma | null> {
    const chave = this.cfg.chaveMestra;
    if (!chave)
      throw new ErroPlataforma(
        'indisponivel',
        'Segundo fator indisponível: a chave mestra (PLATAFORMA_CHAVE_MESTRA) não está configurada.',
      );
    let segredo: string;
    try {
      segredo = conta.totpEnv ? decifrarSegredo(conta.totpEnv, chave) : '';
    } catch {
      throw new ErroPlataforma('indisponivel', 'Segredo do segundo fator ilegível com a chave mestra atual.');
    }
    if (conta.totpAtivo) {
      if (!codigo) return { tipo: 'segundo-fator', segundoFator: 'pedir' };
      if (!(await this.passoNovo(conta.id, passoTotpConferido(segredo, codigo, this.agora()))))
        throw new ErroPlataforma('credencial-invalida', 'Código do segundo fator inválido.');
      return null;
    }
    // Cadastro: o segredo pendente é gerado uma vez e só é ativado quando o primeiro código confere.
    if (!segredo) {
      segredo = gerarSegredoBase32();
      await this.tentar(() =>
        this.repo.alterarConta(conta.id, { totpEnv: cifrarSegredo(segredo, chave), totpAtivo: false }, null),
      );
    }
    if (codigo && (await this.passoNovo(conta.id, passoTotpConferido(segredo, codigo, this.agora())))) {
      await this.tentar(() =>
        this.repo.alterarConta(
          conta.id,
          { totpAtivo: true },
          {
            ator: conta.id,
            evento: 'plataforma.segundoFator.ativado',
            contaAlvo: conta.id,
            detalhe: null,
            estacao: null,
          },
        ),
      );
      return null;
    }
    if (codigo) throw new ErroPlataforma('credencial-invalida', 'Código do segundo fator inválido.');
    return {
      tipo: 'segundo-fator',
      segundoFator: 'cadastrar',
      otpauth: uriOtpauth(conta.email, this.cfg.produto, segredo),
    };
  }

  /**
   * O código TOTP vale UMA vez (RFC 6238 §5.2): recusa passo menor ou igual ao último aceito da conta. O
   * INCR do passo resolve dois pedidos simultâneos com o mesmo código (só o primeiro passa).
   */
  private async passoNovo(idConta: string, passo: number | null): Promise<boolean> {
    if (passo === null) return false;
    const chaveUltimo = `${PREFIXO}:totp-ultimo:${idConta}`;
    const ultimo = await this.tentar(() => this.armazem.obter(chaveUltimo));
    if (ultimo !== null && passo <= Number(ultimo)) return false;
    const n = await this.tentar(() =>
      this.armazem.incrementar(`${PREFIXO}:totp-passo:${idConta}:${passo}`, TOTP_PASSO_TTL_S),
    );
    if (n > 1) return false;
    await this.tentar(() => this.armazem.gravar(chaveUltimo, String(passo), TOTP_PASSO_TTL_S));
    return true;
  }

  /**
   * Sessão da conta da plataforma (ou null): conta existente e ativa, credenciais iguais às do login (novo
   * convite, senha definida ou segundo fator redefinido encerram as sessões antigas), rede do endereço,
   * inatividade.
   */
  async ler(
    id: string | null,
    rede: string | null,
  ): Promise<{ registro: RegistroPlataforma; conta: ContaComAtribuicoes } | null> {
    if (!id || !rede) return null;
    const bruto = await this.tentar(() => this.armazem.obter(this.chave(id)));
    if (!bruto) return null;
    const r = JSON.parse(bruto) as RegistroPlataforma;
    const t = this.agora();
    if (r.rede !== rede) return null;
    if (t - r.criadaMs >= this.duracao * 1000 || t - r.ultimaMs >= this.inatividade * 1000) {
      await this.armazem.apagar(this.chave(id)).catch(() => undefined);
      return null;
    }
    const conta = await this.contaCompleta(r.idConta);
    if (!conta || !conta.ativo || r.credencial !== marcaCredencial(conta)) {
      await this.armazem.apagar(this.chave(id)).catch(() => undefined);
      return null;
    }
    r.ultimaMs = t;
    const resta = Math.max(1, Math.ceil((r.criadaMs + this.duracao * 1000 - t) / 1000));
    await this.armazem.gravar(this.chave(id), JSON.stringify(r), resta).catch(() => undefined);
    return { registro: r, conta };
  }

  async csrfConfere(id: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const bruto = await this.armazem.obter(this.chave(id)).catch(() => null);
    if (!bruto) return false;
    return iguais((JSON.parse(bruto) as RegistroPlataforma).csrf, token);
  }

  async sair(id: string | null): Promise<void> {
    if (id) await this.armazem.apagar(this.chave(id)).catch(() => undefined);
  }

  /** Confere a senha do ATOR (reautenticação dentro do "como"). */
  async conferirSenhaDaConta(idConta: string, senha: string): Promise<boolean> {
    const c = await this.repo.contaPorId(idConta);
    return !!c && c.ativo && (await conferirSenha(senha, c.cifra));
  }

  // ── Convite (definir a senha) ─────────────────────────────────────────────────────────────────

  /** Devolve a conta (quem chama encerra as sessões "como" abertas com a credencial antiga). */
  async aceitarConvite(token: string, senha: string, estacao: string): Promise<string> {
    const conta = await this.tentar(() => this.repo.contaPorConvite(hashConvite(token)));
    if (!conta || !conta.conviteAte || conta.conviteAte.getTime() < this.agora())
      throw new ErroPlataforma('nao-encontrado', 'Convite inválido ou vencido: peça um novo à plataforma.');
    const cifra = await cifrarSenha(senha);
    await this.tentar(() =>
      this.repo.alterarConta(
        conta.id,
        { cifra, conviteHash: null, conviteAte: null },
        { ator: conta.id, evento: 'plataforma.senha.definida', contaAlvo: conta.id, detalhe: null, estacao },
      ),
    );
    return conta.id;
  }

  // ── Designação (só a PLATAFORMA) ─────────────────────────────────────────────────────────────

  exigirDesignar(c: ContaComAtribuicoes): void {
    if (!podeDesignar(regraDaConta(c)))
      throw new ErroPlataforma('sem-permissao', 'Só a plataforma designa o suporte técnico.');
  }

  async listarContas(ator: ContaComAtribuicoes): Promise<ContaPlataformaTela[]> {
    this.exigirDesignar(ator);
    return this.tentar(async () => {
      const [contas, atribuicoes] = await Promise.all([this.repo.contas(), this.repo.atribuicoes()]);
      return contas.map((c) => ({
        id: c.id,
        email: c.email,
        nome: c.nome,
        papel: c.papel,
        ativo: c.ativo,
        senhaDefinida: c.cifra !== null,
        segundoFator: c.totpAtivo,
        criadoEm: c.criadoEm.toISOString(),
        atribuicoes: atribuicoes
          .filter((a) => a.idConta === c.id)
          .map((a) => ({ rede: a.rede, estabelecimento: a.hospital })),
      }));
    });
  }

  private convite(): { token: string; hash: string; ate: Date } {
    const c = novoConvite();
    return { ...c, ate: new Date(this.agora() + CONVITE_HORAS * 3600_000) };
  }

  async criarSuporte(
    ator: ContaComAtribuicoes,
    email: string,
    nome: string | null,
    estacao: string,
  ): Promise<{ id: string; convite: ConviteTela }> {
    this.exigirDesignar(ator);
    const existe = await this.tentar(() => this.repo.contaPorEmail(email));
    if (existe) throw new ErroPlataforma('conflito', 'Já existe conta com este e-mail.');
    const cv = this.convite();
    const id = await this.tentar(() =>
      this.repo.criarConta(
        {
          email,
          nome,
          papel: 'SUPORTE',
          cifra: null,
          conviteHash: cv.hash,
          conviteAte: cv.ate,
          criadoPor: ator.id,
        },
        { ator: ator.id, evento: EVENTOS_AUDITAVEIS.suporteContaCriada.codigo, detalhe: null, estacao },
      ),
    );
    return { id, convite: { token: cv.token, expiraEm: cv.ate.toISOString() } };
  }

  /**
   * Conta que a designação muda (novo convite, função): o suporte técnico e OUTRA conta da plataforma (para
   * revogar a credencial perdida ou roubada de quem é da plataforma); a própria conta, nunca (sempre resta
   * uma plataforma ativa).
   */
  private async alvoDaDesignacao(ator: ContaComAtribuicoes, id: string): Promise<ContaComAtribuicoes> {
    const alvo = await this.contaCompleta(id);
    if (!alvo || (alvo.papel !== 'SUPORTE' && alvo.papel !== 'PLATAFORMA'))
      throw new ErroPlataforma('nao-encontrado', 'Conta não encontrada.');
    if (alvo.id === ator.id)
      throw new ErroPlataforma('conflito', 'A própria conta não é redefinida nem desativada por aqui.');
    return alvo;
  }

  /**
   * Novo convite: zera a senha e o segundo fator (a marca das credenciais muda e as sessões da plataforma
   * abertas com a credencial antiga deixam de valer; o controller encerra as sessões "como").
   */
  async novoConvite(ator: ContaComAtribuicoes, id: string, estacao: string): Promise<ConviteTela> {
    this.exigirDesignar(ator);
    await this.alvoDaDesignacao(ator, id);
    const cv = this.convite();
    await this.tentar(() =>
      this.repo.alterarConta(
        id,
        { cifra: null, conviteHash: cv.hash, conviteAte: cv.ate, totpAtivo: false, totpEnv: null },
        { ator: ator.id, evento: 'suporte.convite.gerado', contaAlvo: id, detalhe: null, estacao },
      ),
    );
    return { token: cv.token, expiraEm: cv.ate.toISOString() };
  }

  async definirFuncao(ator: ContaComAtribuicoes, id: string, ativo: boolean, estacao: string): Promise<void> {
    this.exigirDesignar(ator);
    await this.alvoDaDesignacao(ator, id);
    await this.tentar(() =>
      this.repo.alterarConta(
        id,
        { ativo },
        {
          ator: ator.id,
          evento: EVENTOS_AUDITAVEIS.suporteFuncaoAlterada.codigo,
          contaAlvo: id,
          detalhe: JSON.stringify({ ativo }),
          estacao,
        },
      ),
    );
  }

  async definirAtribuicoes(
    ator: ContaComAtribuicoes,
    id: string,
    rede: string,
    hospitais: readonly string[],
    configurados: readonly string[],
    estacao: string,
  ): Promise<{ ligados: string[]; desligados: string[] }> {
    this.exigirDesignar(ator);
    const fora = hospitais.filter((h) => !configurados.includes(h));
    if (fora.length > 0)
      throw new ErroPlataforma('entrada-invalida', 'Estabelecimento fora da configuração.');
    const alvo = await this.contaCompleta(id);
    if (!alvo || alvo.papel !== 'SUPORTE')
      throw new ErroPlataforma('nao-encontrado', 'Suporte não encontrado.');
    return this.tentar(() =>
      this.repo.definirAtribuicoes(id, rede, [...new Set(hospitais)], {
        ator: ator.id,
        evento: EVENTOS_AUDITAVEIS.suporteAtribuicoesAlteradas.codigo,
        contaAlvo: id,
        estacao,
      }),
    );
  }
}
