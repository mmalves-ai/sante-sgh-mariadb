// Onde ficam as contas da plataforma, as atribuições e a auditoria do "login como" (ADR 0021). A interface é a do
// produto; a implementação em memória serve aos testes e ao dev/ci com a fonte sintética (contas SINTÉTICAS da
// plataforma, que nunca existem fora de dev/ci). A implementação sobre o banco próprio depende da decisão de onde
// ficam a credencial, o segundo fator e o convite das contas de suporte (banco plataforma × conta_plataforma do
// cliente) e das tabelas de ações e leituras da sessão "como" (pedidos do lote 01-06). A cifra da senha e o segredo
// TOTP cifrado só circulam entre o repositório e o serviço que os confere.
// Melhoria: tipos próprios (tipos.ts) e trilha do @sgh/nucleo; nenhum código de convivência.
import type { LinhaTrilha } from '@sgh/nucleo';
import type {
  AcaoLida,
  AcaoNova,
  AtorCorrecao,
  AtribuicaoLida,
  ContaLida,
  ContaNova,
  CorrecaoFeita,
  EventoConta,
  EventoContaLido,
  GrupoAlvo,
  LeituraLida,
  LinhaCruzamento,
  MudancaConta,
  PassoCorrecao,
  SessaoComoLida,
  SessaoComoNova,
  UsuarioAlvo,
} from './tipos.js';

export interface AvisoOutbox {
  readonly tipo: string;
  readonly chave: string;
  readonly carga: Record<string, string>;
}

/** Banco da plataforma: contas, atribuições, auditoria, sessões "como", escritas e leituras. */
export interface RepositorioPlataforma {
  readonly persistente: boolean;
  contaPorEmail(email: string): Promise<ContaLida | null>;
  contaPorId(id: string): Promise<ContaLida | null>;
  contaPorConvite(hash: string): Promise<ContaLida | null>;
  contas(): Promise<ContaLida[]>;
  atribuicoes(idConta?: string): Promise<AtribuicaoLida[]>;
  criarConta(c: ContaNova, evento: Omit<EventoConta, 'contaAlvo'>): Promise<string>;
  alterarConta(id: string, m: MudancaConta, evento: EventoConta | null): Promise<void>;
  definirAtribuicoes(
    id: string,
    rede: string,
    hospitais: readonly string[],
    evento: Omit<EventoConta, 'detalhe'>,
  ): Promise<{ ligados: string[]; desligados: string[] }>;
  eventosConta(limite?: number): Promise<EventoContaLido[]>;
  registrarEventoConta(evento: EventoConta): Promise<void>;
  abrirSessaoComo(s: SessaoComoNova): Promise<{ id: string; inicio: Date; expiraEm: Date }>;
  /**
   * Aviso ao Auditor da sessão "como" já aberta (a carga completa). true: gravado no outbox (o relay
   * entrega); false: sem outbox (memória), quem chama manda pela fila.
   */
  registrarAvisoComo(aviso: AvisoOutbox): Promise<boolean>;
  encerrarSessaoComo(id: string, motivo: string, por: string | null): Promise<boolean>;
  sessaoComo(id: string): Promise<SessaoComoLida | null>;
  sessoesComo(filtro: { hospital?: string; idConta?: string; limite?: number }): Promise<SessaoComoLida[]>;
  registrarAcao(a: AcaoNova): Promise<string>;
  finalizarAcao(id: string, status: AcaoNova['status'], http: number | null): Promise<void>;
  acoes(sessao: string): Promise<AcaoLida[]>;
  somarLeituras(sessao: string, caminho: string, n: number, primeira: Date, ultima: Date): Promise<void>;
  leituras(sessao: string): Promise<LeituraLida[]>;
}

/** O que o "como" lê e grava no banco de CADA estabelecimento. */
export interface FonteComoEstabelecimento {
  grupos(hospital: string): Promise<GrupoAlvo[]>;
  usuarios(hospital: string, grupo: string): Promise<UsuarioAlvo[]>;
  imagensPorAcao(
    hospital: string,
    sessao: string,
  ): Promise<Map<string, { imagens: number; corrigidas: number }>>;
  previa(
    hospital: string,
    sessao: string,
    acao?: string,
  ): Promise<{ passos: PassoCorrecao[]; tabelas: string[] }>;
  corrigir(
    hospital: string,
    pedido: { sessao: string; acao?: string; confirmarConflito: boolean; resumo?: string },
    ator: AtorCorrecao,
    linha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>,
  ): Promise<CorrecaoFeita[]>;
  cruzamento(hospital: string, janela: { alvo: string; inicio: Date; fim: Date }): Promise<LinhaCruzamento[]>;
}

/** O Corrigir recusado (fora do ambiente que permite a correção). */
export class ErroCorrigirIndisponivel extends Error {
  override readonly name = 'ErroCorrigirIndisponivel';
}

// ── Memória (testes e dev/ci com a fonte sintética) ────────────────────────────────────────────

/**
 * Contas SINTÉTICAS da plataforma (dev/ci com a fonte sintética e E2E): nomes e e-mails claramente fictícios
 * (domínio .invalid), senha sintética no repositório. Nunca existem fora de
 * dev/ci nem com ACESSO_FONTE_DEV=copia (aí a conta é criada por `pnpm plataforma:criar-admin`).
 */
export const CONTAS_PLATAFORMA_SINTETICAS = {
  plataforma: 'plataforma@sintetico.invalid',
  suporte: 'suporte@sintetico.invalid',
  suporteSemAtribuicao: 'suporte.livre@sintetico.invalid',
} as const;
export const SENHA_PLATAFORMA_SINTETICA = 'Sintetico#Plataforma2026';

export class RepositorioPlataformaMemoria implements RepositorioPlataforma {
  readonly persistente = false;
  private pronto: Promise<void> = Promise.resolve();
  /** Semeadura das contas sintéticas, adiada até o primeiro uso (a cifra custa ~200 ms de CPU). */
  private semear: (() => Promise<void>) | null = null;

  /**
   * Repositório em memória com as contas sintéticas: a plataforma, um suporte atribuído ao primeiro
   * estabelecimento e um suporte sem estabelecimento. Só dev/ci (o chamador confere).
   */
  static sintetico(
    rede: string,
    hospitais: readonly string[],
    cifrar: (senha: string) => Promise<string>,
  ): RepositorioPlataformaMemoria {
    const r = new RepositorioPlataformaMemoria();
    r.semear = async () => {
      const cifra = await cifrar(SENHA_PLATAFORMA_SINTETICA);
      const base = { cifra, conviteHash: null, conviteAte: null, criadoPor: null };
      const ev = { ator: null, evento: 'plataforma.conta.sintetica', detalhe: null, estacao: null };
      r.criarSemEsperar(
        {
          ...base,
          email: CONTAS_PLATAFORMA_SINTETICAS.plataforma,
          nome: 'Plataforma sintética',
          papel: 'PLATAFORMA',
        },
        ev,
      );
      const sup = r.criarSemEsperar(
        { ...base, email: CONTAS_PLATAFORMA_SINTETICAS.suporte, nome: 'Suporte sintético', papel: 'SUPORTE' },
        ev,
      );
      r.criarSemEsperar(
        {
          ...base,
          email: CONTAS_PLATAFORMA_SINTETICAS.suporteSemAtribuicao,
          nome: 'Suporte sintético sem estabelecimento',
          papel: 'SUPORTE',
        },
        ev,
      );
      if (hospitais[0]) r.atribuicoesMem.push({ idConta: sup, rede, hospital: hospitais[0], ativo: true });
    };
    return r;
  }
  private n = 1_000;
  readonly contasMem = new Map<string, ContaLida>();
  readonly atribuicoesMem: (AtribuicaoLida & { ativo: boolean })[] = [];
  readonly eventos: EventoContaLido[] = [];
  readonly sessoes = new Map<string, SessaoComoLida>();
  readonly acoesMem: AcaoLida[] = [];
  readonly leiturasMem = new Map<string, LeituraLida>();
  readonly avisos: AvisoOutbox[] = [];
  /** Falha simulada (testes do fail-closed). */
  falhar = false;

  constructor(private readonly agora: () => number = () => Date.now()) {}

  private async ok<T>(v: T): Promise<T> {
    if (this.semear) {
      this.pronto = this.semear();
      this.semear = null;
    }
    await this.pronto;
    if (this.falhar) throw new Error('banco da plataforma indisponível (simulado)');
    return v;
  }
  private novo(): string {
    return String(++this.n);
  }

  async contaPorEmail(email: string) {
    await this.ok(null);
    return [...this.contasMem.values()].find((c) => c.email === email) ?? null;
  }
  async contaPorId(id: string) {
    await this.ok(null);
    return this.contasMem.get(id) ?? null;
  }
  async contaPorConvite(hash: string) {
    await this.ok(null);
    return [...this.contasMem.values()].find((c) => c.conviteHash === hash) ?? null;
  }
  async contas() {
    await this.ok(null);
    return [...this.contasMem.values()];
  }
  async atribuicoes(idConta?: string) {
    await this.ok(null);
    return this.atribuicoesMem
      .filter((a) => a.ativo && (!idConta || a.idConta === idConta))
      .map(({ idConta: i, rede, hospital }) => ({ idConta: i, rede, hospital }));
  }
  async criarConta(c: ContaNova, evento: Omit<EventoConta, 'contaAlvo'>) {
    await this.ok(null);
    return this.criarSemEsperar(c, evento);
  }

  private criarSemEsperar(c: ContaNova, evento: Omit<EventoConta, 'contaAlvo'>): string {
    if ([...this.contasMem.values()].some((x) => x.email === c.email))
      throw new Error('uq_conta_plataforma_email');
    const id = this.novo();
    this.contasMem.set(id, {
      id,
      email: c.email,
      nome: c.nome,
      papel: c.papel,
      ativo: true,
      cifra: c.cifra,
      totpEnv: null,
      totpAtivo: false,
      conviteHash: c.conviteHash,
      conviteAte: c.conviteAte,
      criadoEm: new Date(this.agora()),
    });
    this.eventoMem({ ...evento, contaAlvo: id });
    return id;
  }
  private eventoMem(e: EventoConta) {
    this.eventos.unshift({ ...e, id: this.novo(), dataHora: new Date(this.agora()) });
  }
  async alterarConta(id: string, m: MudancaConta, evento: EventoConta | null) {
    await this.ok(null);
    const c = this.contasMem.get(id);
    if (!c) throw new Error('conta_plataforma: conta não alterada.');
    this.contasMem.set(id, {
      ...c,
      ...(m.ativo !== undefined ? { ativo: m.ativo } : {}),
      ...(m.cifra !== undefined ? { cifra: m.cifra } : {}),
      ...(m.totpEnv !== undefined ? { totpEnv: m.totpEnv } : {}),
      ...(m.totpAtivo !== undefined ? { totpAtivo: m.totpAtivo } : {}),
      ...(m.conviteHash !== undefined ? { conviteHash: m.conviteHash } : {}),
      ...(m.conviteAte !== undefined ? { conviteAte: m.conviteAte } : {}),
    });
    if (evento) this.eventoMem(evento);
  }
  async definirAtribuicoes(
    id: string,
    rede: string,
    hospitais: readonly string[],
    evento: Omit<EventoConta, 'detalhe'>,
  ) {
    await this.ok(null);
    const ligados: string[] = [];
    const desligados: string[] = [];
    const pedidos = new Set(hospitais);
    for (const a of this.atribuicoesMem.filter((x) => x.idConta === id && x.rede === rede)) {
      const quer = pedidos.has(a.hospital);
      pedidos.delete(a.hospital);
      if (a.ativo !== quer) (quer ? ligados : desligados).push(a.hospital);
      a.ativo = quer;
    }
    for (const h of pedidos) {
      this.atribuicoesMem.push({ idConta: id, rede, hospital: h, ativo: true });
      ligados.push(h);
    }
    const r = { ligados: ligados.sort(), desligados: desligados.sort() };
    this.eventoMem({ ...evento, detalhe: JSON.stringify({ rede, ...r }) });
    return r;
  }
  async eventosConta(limite = 200) {
    await this.ok(null);
    return this.eventos.slice(0, limite);
  }
  async registrarEventoConta(evento: EventoConta) {
    await this.ok(null);
    this.eventoMem(evento);
  }
  async abrirSessaoComo(s: SessaoComoNova) {
    await this.ok(null);
    const id = this.novo();
    const inicio = new Date(this.agora());
    const expiraEm = new Date(inicio.getTime() + s.minutos * 60_000);
    this.sessoes.set(id, {
      id,
      idConta: s.idConta,
      atorTipo: s.atorTipo,
      rede: s.rede,
      hospital: s.hospital,
      alvoLogin: s.alvoLogin,
      motivo: s.motivo,
      modo: s.modo ?? 'como',
      inicio,
      expiraEm,
      fim: null,
      encerramento: null,
      escritas: 0,
      atosClinicos: 0,
    });
    return { id, inicio, expiraEm };
  }
  async registrarAvisoComo(aviso: AvisoOutbox) {
    await this.ok(null);
    this.avisos.push(aviso);
    // Em memória, não há outbox: o serviço envia o aviso pela fila (como a quebra de vidro sintética).
    return false;
  }
  async encerrarSessaoComo(id: string, motivo: string) {
    await this.ok(null);
    const s = this.sessoes.get(id);
    if (!s || s.fim) return false;
    this.sessoes.set(id, { ...s, fim: new Date(this.agora()), encerramento: motivo });
    return true;
  }
  async sessaoComo(id: string) {
    await this.ok(null);
    const s = this.sessoes.get(id);
    if (!s) return null;
    const acoes = this.acoesMem.filter((a) => a.sessao === id);
    return { ...s, escritas: acoes.length, atosClinicos: acoes.filter((a) => a.clinico).length };
  }
  async sessoesComo(filtro: { hospital?: string; idConta?: string; limite?: number }) {
    await this.ok(null);
    const r: SessaoComoLida[] = [];
    for (const s of [...this.sessoes.values()].reverse())
      if (
        (!filtro.hospital || s.hospital === filtro.hospital) &&
        (!filtro.idConta || s.idConta === filtro.idConta)
      ) {
        const x = await this.sessaoComo(s.id);
        if (x) r.push(x);
      }
    return r.slice(0, filtro.limite ?? 200);
  }
  async registrarAcao(a: AcaoNova) {
    await this.ok(null);
    const id = this.novo();
    this.acoesMem.push({ ...a, id, dataHora: new Date(this.agora()) });
    return id;
  }
  async finalizarAcao(id: string, status: AcaoNova['status'], http: number | null) {
    await this.ok(null);
    const i = this.acoesMem.findIndex((a) => a.id === id);
    const a = this.acoesMem[i];
    if (a) this.acoesMem[i] = { ...a, status, http };
  }
  async acoes(sessao: string) {
    await this.ok(null);
    return this.acoesMem.filter((a) => a.sessao === sessao);
  }
  async somarLeituras(sessao: string, caminho: string, n: number, primeira: Date, ultima: Date) {
    await this.ok(null);
    const k = `${sessao}\u0000${caminho}`;
    const l = this.leiturasMem.get(k);
    this.leiturasMem.set(k, {
      sessao,
      caminho,
      quantidade: (l?.quantidade ?? 0) + n,
      primeira: l?.primeira ?? primeira,
      ultima,
    });
  }
  async leituras(sessao: string) {
    await this.ok(null);
    return [...this.leiturasMem.values()].filter((l) => l.sessao === sessao);
  }
}

/** O "como" sobre a fonte sintética: grupos e logins sintéticos; nada grava (sem imagens, sem correção). */
export class FonteComoMemoria implements FonteComoEstabelecimento {
  constructor(
    private readonly alvos: {
      gruposAlvo(codigo: string): Promise<GrupoAlvo[]>;
      usuariosAlvo(codigo: string, grupo: string): Promise<UsuarioAlvo[]>;
    },
  ) {}
  grupos(hospital: string) {
    return this.alvos.gruposAlvo(hospital);
  }
  usuarios(hospital: string, grupo: string) {
    return this.alvos.usuariosAlvo(hospital, grupo);
  }
  imagensPorAcao() {
    return Promise.resolve(new Map<string, { imagens: number; corrigidas: number }>());
  }
  previa() {
    return Promise.resolve({ passos: [] as PassoCorrecao[], tabelas: [] as string[] });
  }
  corrigir() {
    return Promise.resolve([] as CorrecaoFeita[]);
  }
  cruzamento() {
    return Promise.resolve([] as LinhaCruzamento[]);
  }
}
