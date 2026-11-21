// "Login como" (ADR 0021): depois do próprio login, a plataforma (em todos os estabelecimentos configurados) e
// o suporte técnico (só nos atribuídos, com a função ativa) abrem a sessão do ALVO (usuário do hospital), sem a senha
// dele: as permissões são as reais do M06 e NÃO há bloqueio de uso (decisão do dono, 20/10/2026: "a palavra-
// chave é auditoria, não limites"). O controle é quem entra e onde, e a auditoria: a sessão de suporte
// (sessao_suporte, com o motivo opcional e o aviso ao Auditor pela outbox), cada escrita (método, caminho,
// status) ANTES de acontecer, cada leitura agregada por caminho, a imagem antes/depois de cada registro (no
// núcleo, na transação da escrita) e a correção. A guarda por requisição confere a sessão de suporte, a
// função e a atribuição, com cache curto (15 s) e marca de revogação no armazém compartilhado; erro: 503
// (falha fechada), nunca libera.
import {
  EVENTOS_AUDITAVEIS,
  ROTULO_SUPORTE_PARA_HOSPITAL,
  cargaAlertaSuporte,
  ehAtoClinico,
  marcaSuporteTecnico,
  naoReversivelDe,
  type AcaoComoTela,
  type AuditoriaContaTela,
  type CruzamentoTrilhaTela,
  type DetalheSessaoComoTela,
  type EntrarComo,
  type EstabelecimentoComo,
  type GrupoComo,
  type PedidoCorrecao,
  type PreviaCorrecaoTela,
  type ResultadoCorrecaoTela,
  type SessaoComoTela,
  type UsuarioComo,
} from '@sgh/contratos';
import {
  conferirSessaoComo,
  estabelecimentosDaConta,
  podeAcessoTotal,
  podeEntrarComo,
  podeEntrarNoEstabelecimento,
  tipoDoAtor,
} from '@sgh/dominio-acesso';
import type { ArmazemSessao } from '../../sessao/armazem.js';
import type { RegistroComo, ResultadoLogin, ServicoSessao } from '../../sessao/servico-sessao.js';
import type { AlertaAuditor } from '../acesso/alerta.js';
import {
  ErroCorrigirIndisponivel,
  type FonteComoEstabelecimento,
  type RepositorioPlataforma,
} from './repositorio.js';
import {
  type ContaComAtribuicoes,
  ErroPlataforma,
  marcaCredencial,
  regraDaConta,
} from './servico-plataforma.js';
import {
  AVISOS_CORRECAO,
  ErroConflitoCorrecao,
  ErroPreviaCorrecao,
  ErroRegraCorrecao,
  resumoDoPlano,
} from './correcao.js';
import type { PassoCorrecao, SessaoComoLida } from './tipos.js';

export interface ConfigComo {
  readonly rede: string;
  /** Estabelecimentos configurados (ARQ-1), com nome e disponibilidade. */
  readonly estabelecimentos: () => readonly { codigo: string; nome: string; disponivel: boolean }[];
  /** SUPORTE_SESSAO_MINUTOS (R5). */
  readonly minutos: number;
  /** SUPORTE_AVISO_AUDITOR (R2): padrão ligado. */
  readonly avisoAuditor: boolean;
  readonly alerta?: AlertaAuditor | null;
  readonly agora?: () => number;
  readonly aviso?: (m: string, c: Record<string, unknown>) => void;
  /** Validade do veredito da guarda em cache (padrão 15 s). */
  readonly cacheMs?: number;
  /**
   * ADR 0022: padrão de "em nome de quem gravar" do acesso total por estabelecimento (PLATAFORMA_EM_NOME_DE);
   * a pessoa escolhe outro no modal.
   */
  readonly emNomeDe?: (hospital: string) => string | null;
}

/** A marca da requisição "como" (req.sghComo): só identificadores. */
export interface ComoDaRequisicao extends RegistroComo {
  readonly rede: string;
  readonly hospital: string;
  readonly alvoLogin: string;
}

export const TIPO_ALERTA_SUPORTE = 'alerta-suporte';
const PREFIXO_REVOGADA = 'plataforma:como-encerrada';

/** Caminho sem query string nem fragmento (nunca vai à auditoria). */
export function caminhoAuditado(url: string | undefined): string {
  const c = (url ?? '').split(/[?#]/)[0] ?? '';
  return (c || '/').slice(0, 300);
}

function codigo(v: string | null): string {
  return v && /^[A-Za-z0-9._:-]{1,64}$/.test(v) ? v : v ? 'informado' : 'nao-informado';
}

export class ServicoComo {
  private readonly agora: () => number;
  private readonly cacheMs: number;
  private readonly cache = new Map<string, number>();
  private readonly leiturasPendentes = new Map<
    string,
    { sessao: string; caminho: string; n: number; primeira: Date; ultima: Date }
  >();
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private sessaoServico: ServicoSessao | null = null;

  constructor(
    readonly repo: RepositorioPlataforma,
    private readonly fonte: FonteComoEstabelecimento,
    private readonly armazem: ArmazemSessao,
    private readonly cfg: ConfigComo,
  ) {
    this.agora = cfg.agora ?? (() => Date.now());
    this.cacheMs = cfg.cacheMs ?? 15_000;
  }

  /** O serviço de sessão é montado depois (ele usa a guarda deste serviço). */
  ligarSessao(s: ServicoSessao | null): void {
    this.sessaoServico = s;
  }

  private configurados(): string[] {
    return this.cfg.estabelecimentos().map((e) => e.codigo);
  }

  private exigirComo(c: ContaComAtribuicoes): void {
    if (!podeEntrarComo(regraDaConta(c)))
      throw new ErroPlataforma('sem-permissao', 'Esta conta não entra como outro usuário.');
  }

  private exigirEstabelecimento(c: ContaComAtribuicoes, hospital: string): void {
    if (!podeEntrarNoEstabelecimento(regraDaConta(c), this.cfg.rede, hospital, this.configurados()))
      throw new ErroPlataforma('sem-permissao', 'Estabelecimento fora do seu acesso.');
  }

  private async tentar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroPlataforma || e instanceof ErroConflitoCorrecao || e instanceof ErroPreviaCorrecao)
        throw e;
      if (e instanceof ErroCorrigirIndisponivel || e instanceof ErroRegraCorrecao)
        throw new ErroPlataforma('conflito', e.message);
      throw new ErroPlataforma('indisponivel', 'O serviço do suporte técnico está indisponível.');
    }
  }

  // ── Modal do "login como" ─────────────────────────────────────────────────────────────────────

  estabelecimentos(c: ContaComAtribuicoes): EstabelecimentoComo[] {
    this.exigirComo(c);
    const permitidos = new Set(estabelecimentosDaConta(regraDaConta(c), this.cfg.rede, this.configurados()));
    return this.cfg
      .estabelecimentos()
      .filter((e) => permitidos.has(e.codigo))
      .map((e) => ({ rede: this.cfg.rede, codigo: e.codigo, nome: e.nome, disponivel: e.disponivel }));
  }

  async grupos(c: ContaComAtribuicoes, hospital: string): Promise<GrupoComo[]> {
    this.exigirComo(c);
    this.exigirEstabelecimento(c, hospital);
    return this.tentar(async () =>
      (await this.fonte.grupos(hospital)).map((g) => ({ grupo: g.grupo, usuarios: g.usuarios })),
    );
  }

  async usuarios(c: ContaComAtribuicoes, hospital: string, grupo: string): Promise<UsuarioComo[]> {
    this.exigirComo(c);
    this.exigirEstabelecimento(c, hospital);
    return this.tentar(() => this.fonte.usuarios(hospital, grupo));
  }

  /** ADR 0022: o padrão de "em nome de" do estabelecimento (só para quem tem acesso total). */
  emNomeDePadrao(
    c: ContaComAtribuicoes,
    hospital: string,
  ): { estabelecimento: string; login: string | null } {
    this.exigirAcessoTotal(c);
    this.exigirEstabelecimento(c, hospital);
    return { estabelecimento: hospital, login: this.cfg.emNomeDe?.(hospital) ?? null };
  }

  /** ADR 0022: só a PLATAFORMA ativa tem acesso total; o suporte técnico nunca. */
  private exigirAcessoTotal(c: ContaComAtribuicoes): void {
    if (!podeAcessoTotal(regraDaConta(c)))
      throw new ErroPlataforma('sem-permissao', 'Só a conta da plataforma tem acesso total.');
  }

  /**
   * Abre a sessão "como". Ordem: (1) conta, função, atribuição e rede; (2) a conta-alvo pela MESMA regra do
   * modal (existe, ativa, não bloqueada, de grupo ativo do TBGRUUSU), e o login fora dela é recusado sem
   * sessão de suporte nem aviso (a tentativa vai só à auditoria das contas); (3) a sessão de suporte
   * (sessao_suporte); (4) a sessão do alvo; (5) o aviso ao Auditor, com a carga completa (outbox ou fila).
   * Sem o aviso registrado, a sessão do alvo é desfeita (falha fechada).
   */
  async entrar(
    c: ContaComAtribuicoes,
    pedido: EntrarComo,
    redeDoEndereco: string | null,
    idAnterior: string | null,
    estacao: string,
  ): Promise<ResultadoLogin> {
    this.exigirComo(c);
    const modo = pedido.modo ?? 'como';
    // ADR 0022: o acesso total é da PLATAFORMA; o suporte continua só com o "como" nos atribuídos.
    if (modo === 'acesso-total') this.exigirAcessoTotal(c);
    this.exigirEstabelecimento(c, pedido.estabelecimento);
    if (redeDoEndereco !== this.cfg.rede)
      throw new ErroPlataforma('rede-desconhecida', 'Este endereço não pertence a esta rede.');
    const sessao = this.sessaoServico;
    if (!sessao) throw new ErroPlataforma('indisponivel', 'O serviço de sessão está indisponível.');
    const atorTipo = tipoDoAtor(c.papel);
    const motivo = pedido.motivo?.trim() || null;
    try {
      await sessao.conferirAlvoComo(pedido.estabelecimento, pedido.login, redeDoEndereco);
    } catch (e) {
      await this.repo
        .registrarEventoConta({
          ator: c.id,
          evento: 'suporte.como.recusado',
          contaAlvo: c.id,
          detalhe: JSON.stringify({ estabelecimento: pedido.estabelecimento }),
          estacao,
        })
        .catch(() => undefined);
      throw e;
    }
    const aberta = await this.tentar(() =>
      this.repo.abrirSessaoComo({
        idConta: c.id,
        atorTipo,
        rede: this.cfg.rede,
        hospital: pedido.estabelecimento,
        alvoLogin: pedido.login,
        alvoId: null,
        motivo,
        minutos: this.cfg.minutos,
        estacao,
        modo,
      }),
    );
    if (modo === 'acesso-total')
      await this.repo
        .registrarEventoConta({
          ator: c.id,
          evento: EVENTOS_AUDITAVEIS.acessoTotalAberto.codigo,
          contaAlvo: c.id,
          detalhe: JSON.stringify({ estabelecimento: pedido.estabelecimento, sessao: aberta.id }),
          estacao,
        })
        .catch(() => undefined);
    const como: RegistroComo = {
      sessao: aberta.id,
      atorTipo,
      idConta: c.id,
      atorEmail: c.email,
      alvoNome: pedido.login,
      expiraMs: aberta.expiraEm.getTime(),
      motivo,
      credencial: marcaCredencial(c),
      modo,
    };
    let r: ResultadoLogin;
    try {
      r = await sessao.abrirComo(
        { estabelecimento: pedido.estabelecimento, login: pedido.login, como },
        redeDoEndereco,
        idAnterior,
      );
    } catch (e) {
      // O alvo não abriu: a sessão de suporte fica encerrada (a tentativa continua na auditoria), sem aviso.
      await this.repo.encerrarSessaoComo(aberta.id, 'nao-aberta', c.id).catch(() => undefined);
      throw e;
    }
    if (this.cfg.avisoAuditor) {
      const carga = cargaAlertaSuporte({
        estabelecimento: pedido.estabelecimento,
        idSessao: aberta.id,
        atorTipo,
        idUsuario: r.sessao.usuario.id,
        motivo: codigo(motivo),
        inicio: aberta.inicio.toISOString(),
        fim: aberta.expiraEm.toISOString(),
      });
      try {
        const naOutbox = await this.repo.registrarAvisoComo({
          tipo: TIPO_ALERTA_SUPORTE,
          chave: `suporte:${pedido.estabelecimento}:${aberta.id}`,
          carga: { ...carga },
        });
        if (!naOutbox)
          await this.cfg.alerta
            ?.suporteSessaoAberta?.({ ...carga, rede: this.cfg.rede, hospital: pedido.estabelecimento })
            .catch(() => 'sem-fila');
      } catch {
        // Sem o aviso ao Auditor, a sessão "como" não fica aberta (R2: quem entra e onde é conhecido).
        await this.repo.encerrarSessaoComo(aberta.id, 'aviso-nao-registrado', c.id).catch(() => undefined);
        await sessao.sair(r.idSessao, redeDoEndereco).catch(() => undefined);
        throw new ErroPlataforma(
          'indisponivel',
          'O aviso ao Auditor não pôde ser registrado; tente de novo.',
        );
      }
    }
    return r;
  }

  // ── Guarda por requisição ─────────────────────────────────────────────────────────────────────

  /** true: a sessão "como" vale. Erro de banco ou do armazém: sobe (o serviço de sessão responde 503). */
  async guarda(como: RegistroComo, rede: string, hospital: string): Promise<boolean> {
    const t = this.agora();
    if (t >= como.expiraMs) return false;
    // Revogação: marca no armazém compartilhado (todos os processos veem na hora).
    if (await this.armazem.obter(`${PREFIXO_REVOGADA}:${como.sessao}`)) return false;
    const ate = this.cache.get(como.sessao);
    if (ate !== undefined && ate > t) return true;
    const [s, conta] = await Promise.all([
      this.repo.sessaoComo(como.sessao),
      this.repo.contaPorId(como.idConta),
    ]);
    // Credencial do ator redefinida depois da abertura (novo convite, senha, segundo fator): acabou.
    if (conta && como.credencial !== marcaCredencial(conta)) {
      this.cache.delete(como.sessao);
      if (s && s.fim === null)
        await this.repo.encerrarSessaoComo(como.sessao, 'credencial-redefinida', null).catch(() => undefined);
      return false;
    }
    const atribuicoes = conta && conta.papel === 'SUPORTE' ? await this.repo.atribuicoes(conta.id) : [];
    const v = conferirSessaoComo({
      sessao: s
        ? {
            idConta: s.idConta,
            atorTipo: s.atorTipo,
            rede: s.rede,
            hospital: s.hospital,
            expiraMs: Math.min(s.expiraEm.getTime(), como.expiraMs),
            encerrada: s.fim !== null,
            modo: s.modo,
          }
        : null,
      conta: conta ? { id: conta.id, papel: conta.papel, ativo: conta.ativo, atribuicoes } : null,
      configurados: this.configurados(),
      agoraMs: t,
    });
    const confere = v.valida && s?.rede === rede && s.hospital === hospital;
    if (!confere) {
      this.cache.delete(como.sessao);
      if (s && s.fim === null)
        await this.repo
          .encerrarSessaoComo(como.sessao, v.valida ? 'divergente' : v.motivo, null)
          .catch(() => undefined);
      return false;
    }
    this.cache.set(como.sessao, t + this.cacheMs);
    return true;
  }

  /** A sessão "como" acabou do lado do alvo (voltou, sair, expirou, inatividade). */
  async aoEncerrar(como: RegistroComo, motivo: string): Promise<void> {
    this.cache.delete(como.sessao);
    await this.repo.encerrarSessaoComo(como.sessao, motivo, como.idConta);
  }

  /** Revogar (aba Auditoria): encerra na hora, em todos os processos. */
  async revogar(ator: ContaComAtribuicoes, idSessao: string): Promise<void> {
    const s = await this.tentar(() => this.repo.sessaoComo(idSessao));
    if (!s) throw new ErroPlataforma('nao-encontrado', 'Sessão não encontrada.');
    this.exigirVer(ator, s);
    await this.marcarRevogada(idSessao);
    await this.tentar(() => this.repo.encerrarSessaoComo(idSessao, 'revogada', ator.id));
  }

  private async marcarRevogada(idSessao: string): Promise<void> {
    this.cache.delete(idSessao);
    await this.tentar(() => this.armazem.gravar(`${PREFIXO_REVOGADA}:${idSessao}`, '1', 24 * 3600));
  }

  /** Função retirada ou atribuição desligada: encerra as sessões abertas afetadas, na hora. */
  async encerrarDaConta(
    idConta: string,
    hospitais: readonly string[] | null,
    motivo: string,
  ): Promise<number> {
    const abertas = (await this.tentar(() => this.repo.sessoesComo({ idConta, limite: 1_000 }))).filter(
      (s) => s.fim === null && (hospitais === null || hospitais.includes(s.hospital)),
    );
    for (const s of abertas) {
      await this.marcarRevogada(s.id);
      await this.repo.encerrarSessaoComo(s.id, motivo, null).catch(() => undefined);
    }
    return abertas.length;
  }

  // ── Auditoria das escritas e leituras ────────────────────────────────────────────────────────

  /** Antes da escrita (fail-closed): sem a linha da escrita, a escrita não acontece. */
  registrarEscrita(como: ComoDaRequisicao, metodo: string, caminho: string): Promise<string> {
    return this.repo.registrarAcao({
      sessao: como.sessao,
      metodo: metodo.toUpperCase(),
      caminho,
      status: 'aborted',
      http: null,
      clinico: ehAtoClinico(caminho),
      naoReversivel: naoReversivelDe(caminho),
    });
  }

  async finalizarEscrita(id: string, status: 'ok' | 'error' | 'blocked', http: number | null): Promise<void> {
    await this.repo.finalizarAcao(id, status, http).catch((e: unknown) =>
      this.cfg.aviso?.('suporte: status final da escrita não registrado', {
        acao: id,
        erro: e instanceof Error ? e.name : 'erro',
      }),
    );
  }

  /** Escrita recusada antes do handler (permissão, CSRF, bloqueio): registrada como "blocked". */
  async registrarBloqueada(
    como: ComoDaRequisicao,
    metodo: string,
    caminho: string,
    http: number,
  ): Promise<void> {
    await this.repo
      .registrarAcao({
        sessao: como.sessao,
        metodo: metodo.toUpperCase(),
        caminho,
        status: 'blocked',
        http,
        clinico: ehAtoClinico(caminho),
        naoReversivel: null,
      })
      .catch(() => undefined);
  }

  /** Leitura agregada por caminho (gravada em lote, a cada 10 s e antes de cada consulta da auditoria). */
  leitura(como: ComoDaRequisicao, caminho: string): void {
    const k = `${como.sessao}\u0000${caminho}`;
    const agora = new Date(this.agora());
    const l = this.leiturasPendentes.get(k);
    if (l) {
      l.n++;
      l.ultima = agora;
    } else
      this.leiturasPendentes.set(k, { sessao: como.sessao, caminho, n: 1, primeira: agora, ultima: agora });
    if (!this.temporizador) {
      this.temporizador = setInterval(() => void this.gravarLeituras(), 10_000);
      this.temporizador.unref?.();
    }
  }

  async gravarLeituras(): Promise<void> {
    const lote = [...this.leiturasPendentes.values()];
    this.leiturasPendentes.clear();
    for (const l of lote)
      await this.repo.somarLeituras(l.sessao, l.caminho, l.n, l.primeira, l.ultima).catch(() => {
        const k = `${l.sessao}\u0000${l.caminho}`;
        const outra = this.leiturasPendentes.get(k);
        this.leiturasPendentes.set(k, outra ? { ...outra, n: outra.n + l.n, primeira: l.primeira } : l);
      });
  }

  encerrar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  // ── Aba Auditoria ─────────────────────────────────────────────────────────────────────────────

  /** Plataforma: todas; suporte: só as próprias, nos estabelecimentos atribuídos. */
  private exigirVer(c: ContaComAtribuicoes, s: SessaoComoLida): void {
    const regra = regraDaConta(c);
    if (c.papel === 'PLATAFORMA' && c.ativo) return;
    if (s.idConta === c.id && podeEntrarNoEstabelecimento(regra, s.rede, s.hospital, this.configurados()))
      return;
    throw new ErroPlataforma('sem-permissao', 'Sessão fora do seu acesso.');
  }

  private async emailsDasContas(): Promise<Map<string, string>> {
    return new Map((await this.repo.contas()).map((c) => [c.id, c.email]));
  }

  private tela(s: SessaoComoLida, emails: Map<string, string>): SessaoComoTela {
    return {
      id: s.id,
      atorTipo: s.atorTipo,
      atorEmail: emails.get(s.idConta) ?? `conta ${s.idConta}`,
      rede: s.rede,
      estabelecimento: s.hospital,
      alvoLogin: s.alvoLogin,
      motivo: s.motivo,
      modo: s.modo,
      inicio: s.inicio.toISOString(),
      expiraEm: s.expiraEm.toISOString(),
      fim: s.fim?.toISOString() ?? null,
      encerramento: s.encerramento,
      aberta: s.fim === null && s.expiraEm.getTime() > this.agora(),
      escritas: s.escritas,
      atosClinicos: s.atosClinicos,
    };
  }

  async sessoes(c: ContaComAtribuicoes, filtro: { hospital?: string }): Promise<SessaoComoTela[]> {
    return this.tentar(async () => {
      const lista = await this.repo.sessoesComo({
        ...(filtro.hospital ? { hospital: filtro.hospital } : {}),
        ...(c.papel === 'PLATAFORMA' ? {} : { idConta: c.id }),
      });
      const emails = await this.emailsDasContas();
      const r: SessaoComoTela[] = [];
      for (const s of lista) {
        try {
          this.exigirVer(c, s);
          r.push(this.tela(s, emails));
        } catch {
          /* fora do acesso */
        }
      }
      return r;
    });
  }

  async detalhe(c: ContaComAtribuicoes, id: string): Promise<DetalheSessaoComoTela> {
    await this.gravarLeituras();
    const s = await this.tentar(() => this.repo.sessaoComo(id));
    if (!s) throw new ErroPlataforma('nao-encontrado', 'Sessão não encontrada.');
    this.exigirVer(c, s);
    return this.tentar(async () => {
      const [acoes, leituras, emails] = await Promise.all([
        this.repo.acoes(id),
        this.repo.leituras(id),
        this.emailsDasContas(),
      ]);
      const imagens = await this.fonte.imagensPorAcao(s.hospital, id).catch(() => new Map());
      const marca = marcaSuporteTecnico(s.alvoLogin);
      return {
        sessao: this.tela(s, emails),
        acoes: acoes.map((a): AcaoComoTela => ({
          id: a.id,
          sessao: a.sessao,
          dataHora: a.dataHora.toISOString(),
          metodo: a.metodo,
          caminho: a.caminho,
          status: a.status,
          http: a.http,
          clinico: a.clinico,
          marca: a.clinico ? marca : null,
          naoReversivel: a.naoReversivel,
          imagens: imagens.get(a.id)?.imagens ?? 0,
          corrigida: (imagens.get(a.id)?.corrigidas ?? 0) > 0,
        })),
        leituras: leituras.map((l) => ({
          sessao: l.sessao,
          caminho: l.caminho,
          quantidade: l.quantidade,
          primeira: l.primeira.toISOString(),
          ultima: l.ultima.toISOString(),
        })),
      };
    });
  }

  private async sessaoParaCorrigir(c: ContaComAtribuicoes, pedido: PedidoCorrecao): Promise<SessaoComoLida> {
    const s = await this.tentar(() => this.repo.sessaoComo(pedido.sessao));
    if (!s || s.hospital !== pedido.estabelecimento)
      throw new ErroPlataforma('nao-encontrado', 'Sessão não encontrada neste estabelecimento.');
    // Corrige a plataforma e o suporte ATRIBUÍDO àquele estabelecimento (regra 5b).
    if (!podeEntrarNoEstabelecimento(regraDaConta(c), s.rede, s.hospital, this.configurados()))
      throw new ErroPlataforma('sem-permissao', 'Estabelecimento fora do seu acesso.');
    return s;
  }

  private naoReversiveis(
    acoes: readonly { id: string; caminho: string; naoReversivel: string | null; status: string }[],
    acao?: string,
  ) {
    return acoes
      .filter((a) => a.naoReversivel && a.status === 'ok' && (!acao || a.id === acao))
      .map((a) => ({ acao: `${a.id} ${a.caminho}`, motivo: a.naoReversivel as string }));
  }

  private passoTela(p: PassoCorrecao): PreviaCorrecaoTela['passos'][number] {
    const chave: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.imagem.chave))
      chave[k] = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return {
      imagem: p.imagem.id,
      tabela: p.imagem.tabela,
      chave,
      // O contrato da tela ainda nomeia a operação pelo comando SQL (pedido de contrato da onda 2).
      operacaoOriginal: OPERACAO_NA_TELA[p.imagem.operacao],
      compensacao: p.compensacao,
      mudancas: p.mudancas,
      conflito: p.conflito,
      naoReversivel: p.bloqueio,
    };
  }

  async previa(c: ContaComAtribuicoes, pedido: PedidoCorrecao): Promise<PreviaCorrecaoTela> {
    const s = await this.sessaoParaCorrigir(c, pedido);
    return this.tentar(async () => {
      const [plano, acoes] = await Promise.all([
        this.fonte.previa(s.hospital, s.id, pedido.acao),
        this.repo.acoes(s.id),
      ]);
      const passos = plano.passos.map((p) => this.passoTela(p));
      return {
        passos,
        naoReversiveis: [
          ...this.naoReversiveis(acoes, pedido.acao),
          // Regra das receitas de acesso que a compensação violaria (a execução recusa).
          ...plano.passos.flatMap((p) =>
            p.bloqueio ? [{ acao: `${p.imagem.tabela} (imagem ${p.imagem.id})`, motivo: p.bloqueio }] : [],
          ),
        ],
        exigeConfirmacao: plano.passos.some((p) => p.conflito.length > 0),
        avisos: AVISOS_CORRECAO,
        resumo: resumoDoPlano(plano.passos),
      };
    });
  }

  async corrigir(
    c: ContaComAtribuicoes,
    pedido: PedidoCorrecao,
    estacao: string,
    correlacao: string,
  ): Promise<ResultadoCorrecaoTela> {
    const s = await this.sessaoParaCorrigir(c, pedido);
    const atorTipo = tipoDoAtor(c.papel);
    const feitas = await this.tentar(() =>
      this.fonte.corrigir(
        s.hospital,
        {
          sessao: s.id,
          ...(pedido.acao ? { acao: pedido.acao } : {}),
          confirmarConflito: pedido.confirmarConflito === true,
          // A execução fica presa à prévia mostrada (o esquema exige o resumo quando previa=false).
          ...(pedido.resumo ? { resumo: pedido.resumo } : {}),
        },
        { atorTipo, idConta: c.id },
        {
          // A linha da trilha do núcleo: sem usuário do hospital (quem corrige é a conta da plataforma, no JSON).
          estabelecimento: null,
          usuario: null,
          acao: 'operacao',
          entidade: 'sessao_suporte',
          entidadeId: /^\d{1,15}$/.test(s.id) ? Number(s.id) : null,
          dadosDepois: {
            evento: EVENTOS_AUDITAVEIS.suporteEscritaCorrigida.codigo,
            recurso: 'suporte.correcao',
            operacao: 'suporte.corrigirEscrita',
            autor: USUARIO_CORRECAO,
            estacao,
            origem: `SUPORTE:${atorTipo}:${c.id}:S${s.id}`,
          },
          correlacao: correlacao.slice(0, 64),
          ocorridoEm: new Date(),
        },
      ),
    );
    // ADR 0022 (decisão 12): a compensação pode ter desfeito grupo, papel, opções, perfil ou mapa; o cache das
    // permissões (3 min) do estabelecimento inteiro recalcula na hora (sem isso o privilégio desfeito valia).
    const permissoes = feitas.length > 0 ? await this.invalidarPermissoes(s.rede, s.hospital) : undefined;
    const acoes = await this.repo.acoes(s.id).catch(() => []);
    await this.repo
      .registrarEventoConta({
        ator: c.id,
        evento: EVENTOS_AUDITAVEIS.suporteEscritaCorrigida.codigo,
        contaAlvo: s.idConta,
        detalhe: JSON.stringify({ sessao: s.id, acao: pedido.acao ?? null, corrigidos: feitas.length }),
        estacao,
      })
      .catch(() => undefined);
    return {
      corrigidos: feitas.length,
      correcoes: feitas.map((f) => ({ imagem: f.imagem, correcao: f.correcao, compensacao: f.compensacao })),
      naoReversiveis: this.naoReversiveis(acoes, pedido.acao),
      ...(permissoes ? { permissoes } : {}),
    };
  }

  private async invalidarPermissoes(
    rede: string,
    hospital: string,
  ): Promise<'recalculadas' | 'no-prazo-do-cache'> {
    const a = this.sessaoServico?.servicoAutorizacao;
    if (!a) return 'no-prazo-do-cache';
    try {
      await a.invalidarEstabelecimento(rede, hospital);
      return 'recalculadas';
    } catch {
      return 'no-prazo-do-cache';
    }
  }

  /** R3: a TBCABTRILHA da janela da sessão, com o autor real. */
  async cruzamento(c: ContaComAtribuicoes, idSessao: string): Promise<CruzamentoTrilhaTela[]> {
    const s = await this.tentar(() => this.repo.sessaoComo(idSessao));
    if (!s) throw new ErroPlataforma('nao-encontrado', 'Sessão não encontrada.');
    this.exigirVer(c, s);
    const linhas = await this.tentar(() =>
      this.fonte.cruzamento(s.hospital, { alvo: s.alvoLogin, inicio: s.inicio, fim: s.fim ?? s.expiraEm }),
    );
    // O contrato da tela ainda usa os nomes antigos dos campos (pedido de contrato da onda 2): aqui é a trilha
    // própria do estabelecimento.
    return linhas.map((l) => ({
      idTrilhaLegado: l.idTrilha,
      dataHora: l.dataHora?.toISOString() ?? '',
      usuarioLegado: l.usuarioLogin,
      tipo: l.tipo,
      estacao: l.estacao,
      autorReal: l.doSuporte
        ? `${ROTULO_SUPORTE_PARA_HOSPITAL} (sessão ${s.id})`
        : `${l.usuarioLogin} (próprio usuário)`,
      ligada: l.doSuporte,
    }));
  }

  async eventosConta(c: ContaComAtribuicoes): Promise<AuditoriaContaTela[]> {
    if (!(c.papel === 'PLATAFORMA' && c.ativo)) throw new ErroPlataforma('sem-permissao', 'Só a plataforma.');
    return this.tentar(async () => {
      const [eventos, emails] = await Promise.all([this.repo.eventosConta(300), this.emailsDasContas()]);
      return eventos.map((e) => ({
        id: e.id,
        dataHora: e.dataHora.toISOString(),
        ator: e.ator ? (emails.get(e.ator) ?? `conta ${e.ator}`) : '(desconhecido)',
        evento: e.evento,
        contaAlvo: e.contaAlvo ? (emails.get(e.contaAlvo) ?? `conta ${e.contaAlvo}`) : null,
        detalhe: e.detalhe,
      }));
    });
  }
}

/** Autor na trilha da correção (quem corrige não é usuário do hospital; o ator vai na origem). */
export const USUARIO_CORRECAO = '(suporte)';

/** Operação da imagem (modelo próprio) → forma da tela. */
const OPERACAO_NA_TELA = { inclusao: 'INSERT', alteracao: 'UPDATE', exclusao: 'DELETE' } as const;
