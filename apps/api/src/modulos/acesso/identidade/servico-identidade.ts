// Identidade do M59-F2 (ficha do M59, regras 1 a 3; cap-08 §8.16; SBIS-03, SBIS-08): a credencial forte regravada no
// primeiro login (só na fonte sintética do dev/ci), o segundo fator (cadastro, conferência no login, política por onda).
// As regras são as puras de @sgh/dominio-acesso; aqui só a orquestração sobre a porta (a própria, sobre o banco do
// cliente pelo @sgh/nucleo: leituras só leitura e gravações pelo Executor, com a trilha; a de memória em dev/ci) e a
// chave do envelope do segredo TOTP. A "senha anterior" é a credencial num algoritmo mais fraco (da migração): no banco
// ela é de redefinição obrigatória (o sistema só confere Argon2id), e o login recusa sem tentar.
// Melhoria: a exigência do cadastro do perfil (origem 'cadastro-perfil') vale como adesão sem prazo: quem não tem
//   segundo fator entra e é levado ao cadastro; nunca tranca na hora os membros do perfil.
// Melhoria: a regravação leva o autor separado da conta alvo (o gestor na redefinição), para a trilha.
// Removido (ADR 0003): a retirada da senha antiga e a contingência do sistema anterior (código de convivência).
// Nada de senha, hash ou segredo vai a log, resposta ou trilha.
import {
  type Exigencia2fa,
  type FiltroUsuariosIdentidade,
  type MeuSegundoFator,
  type NovaPolitica2fa,
  type PaginaUsuariosIdentidade,
  type Politica2fa,
  type ResumoIdentidade,
  SITUACOES_CREDENCIAL,
  SITUACOES_SEGUNDO_FATOR,
  type SegundoFatorInicio,
  type SituacaoCredencial,
  type SituacaoSegundoFator,
  type UsuarioIdentidade,
} from '@sgh/contratos';
import {
  type Alcance2fa,
  algoritmoDoPhc,
  ARGON2_PADRAO,
  avaliarPolitica2fa,
  type Avaliacao2fa,
  caminhoDoLogin,
  cifrarSegredo,
  cifrarSenha,
  conferirNovaLinha2fa,
  conferirSenha,
  contarEmFaixa,
  decifrarSegredo,
  desfecho2faNoLogin,
  faixaContagemCredencial,
  gerarSegredoBase32,
  alcanca,
  linhasDaOnda1,
  type ParametrosArgon2,
  passoTotpConferido,
  podeRemoverSegundoFator,
  type SenhaLegadoLida,
  situacaoCredencial,
  somarDias,
  TOTP_PADRAO,
  uriOtpauth,
} from '@sgh/dominio-acesso';
import type {
  AlteracaoPolitica2fa,
  ContaIdentidade,
  CredencialForte,
  GrupoContagemIdentidade,
  LinhaPolitica2faRegistrada,
  NovaCredencialForte,
  NovaLinhaPolitica2fa,
  OrigemCredencialForte,
  SegundoFatorRegistrado,
  TrilhaIdentidade,
  UsuarioIdentidadeRegistrado,
} from './tipos-identidade.js';

/** O que o serviço precisa do núcleo (o adaptador implementa; os testes usam a memória). */
export interface PortaIdentidade {
  prontas(h: string): Promise<boolean>;
  conta(h: string, login: string): Promise<ContaIdentidade | null>;
  forte(h: string, login: string, id: number): Promise<CredencialForte | null>;
  autenticarForte(
    h: string,
    login: string,
    id: number,
    senha: string,
    conferir: (senha: string, hash: string | null) => Promise<boolean>,
  ): Promise<{ confere: boolean; credencial: CredencialForte } | null>;
  gravarForte(h: string, c: NovaCredencialForte, t: TrilhaIdentidade): Promise<void>;
  segundoFator(h: string, login: string, id: number): Promise<SegundoFatorRegistrado | null>;
  iniciar2fa(
    h: string,
    c: { idUsuario: number; login: string; segredoEnvelope: string },
    t: TrilhaIdentidade,
  ): Promise<{ id: string } | null>;
  confirmar2fa(h: string, id: string, t: TrilhaIdentidade): Promise<boolean>;
  revogar2fa(h: string, id: string, t: TrilhaIdentidade): Promise<boolean>;
  marcar2fa(h: string, id: string, instanteDoPasso: Date): Promise<boolean>;
  politicas(h: string): Promise<LinhaPolitica2faRegistrada[]>;
  incluirPolitica(h: string, p: NovaLinhaPolitica2fa, t: TrilhaIdentidade): Promise<{ id: string }>;
  encerrarPolitica(
    h: string,
    c: { id: string; hospital: string; por: string; motivo: string },
    t: TrilhaIdentidade,
  ): Promise<boolean>;
  /** W0-09: encerra a vigente ("Alterada") e inclui a nova (mesma onda e início) na mesma transação. */
  alterarPolitica(
    h: string,
    a: AlteracaoPolitica2fa,
    t: TrilhaIdentidade,
  ): Promise<{ id: string; anterior: string } | null>;
  usuarios(
    h: string,
    /** `senha`: só os usuários da situação, filtrados ANTES da paginação (a página e o temMais já filtrados). */
    f: { busca?: string; senha?: SituacaoCredencial; pagina: number; tamanho: number },
  ): Promise<{ itens: UsuarioIdentidadeRegistrado[]; temMais: boolean }>;
  contagens(h: string): Promise<GrupoContagemIdentidade[]>;
}

/** Quem age (a sessão) e de onde, para a trilha. */
export interface AtorIdentidade {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly idUsuario: number;
  readonly estacao: string | null;
  readonly correlacao: string;
}

export interface DependenciasIdentidade {
  readonly porta: PortaIdentidade;
  /** Chave do envelope do segredo TOTP (32 bytes); null: o cadastro do segundo fator fica indisponível. */
  readonly chave: Buffer | null;
  /** Nome do produto no aplicativo autenticador (DP-49: da configuração da rede). */
  readonly emissor: string;
  readonly argon2?: ParametrosArgon2;
  readonly agora?: () => number;
  /** Aviso sem dado pessoal (regravação que falhou não impede o login). */
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

export class ErroIdentidade extends Error {
  constructor(
    readonly codigo:
      | 'indisponivel'
      | 'usuario-inexistente'
      | 'codigo-invalido'
      | 'ja-cadastrado'
      | 'sem-cadastro'
      | 'remocao-recusada'
      | 'politica-invalida'
      | 'politica-inexistente',
    readonly detalhe: string,
    readonly status = 409,
  ) {
    super(codigo);
    this.name = 'ErroIdentidade';
  }
}

/** Desfecho da credencial no login: a forte decidiu, ou o chamador segue pela fonte de acesso (senha anterior). */
export type DesfechoForte =
  | {
      readonly tipo: 'forte-ok';
      readonly conta: ContaIdentidade;
      /** W1-01: a credencial viva é a senha provisória dada pelo gestor (troca obrigatória). */
      readonly provisoria?: boolean;
    }
  | { readonly tipo: 'forte-invalida' }
  | { readonly tipo: 'legado' };

/** Desfecho do segundo fator no login. */
export type Desfecho2fa =
  | { readonly tipo: 'entrar'; readonly info: InfoSegundoFatorSessao }
  | { readonly tipo: 'codigo-necessario' }
  | { readonly tipo: 'codigo-invalido' }
  | { readonly tipo: 'cadastro-obrigatorio' };

export interface InfoSegundoFatorSessao {
  readonly cadastrado: boolean;
  readonly disponivel: boolean;
  readonly exigencia: Exigencia2fa;
  readonly prazoAdesaoAte: string | null;
}

const TAMANHO_PAGINA = 50;
const FUSO = 'America/Sao_Paulo';
/** Validade do cadastro pendente: o código tem de chegar em 10 min. */
const VALIDADE_CADASTRO_MS = 10 * 60_000;

function senhaAnterior(c: ContaIdentidade): SenhaLegadoLida {
  return {
    presente: c.senhaPresente,
    criptografada: c.criptografada,
    comSalt: c.comSalt,
    alteradaEm: c.senhaAlteradaEm,
  };
}

function situacao2fa(f: SegundoFatorRegistrado | null): SituacaoSegundoFator {
  return f ? f.situacao : 'ausente';
}

function politicaDe(l: LinhaPolitica2faRegistrada): Politica2fa {
  return {
    id: l.id,
    estabelecimento: l.hospital,
    alvo: l.alvo,
    valor: l.valor,
    onda: l.onda,
    inicio: l.inicio,
    prazoAdesaoDias: l.prazoAdesaoDias,
    ativa: l.encerradaEm === null,
    criadaPor: l.criadaPor,
    criadaEm: l.criadaEm ? l.criadaEm.toISOString() : '',
    encerradaEm: l.encerradaEm ? l.encerradaEm.toISOString() : null,
  };
}

const linhaPura = (l: LinhaPolitica2faRegistrada) => ({ ...l, ativa: l.encerradaEm === null });
/** Só as linhas da política por onda (a exigência do cadastro do perfil não entra nas conferências do gestor). */
const daPolitica = (linhas: readonly LinhaPolitica2faRegistrada[]) =>
  linhas.filter((l) => l.origem !== 'cadastro-perfil');

export class ServicoIdentidade {
  private readonly argon2: ParametrosArgon2;
  constructor(private readonly d: DependenciasIdentidade) {
    this.argon2 = d.argon2 ?? ARGON2_PADRAO;
  }

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  /** Dia civil do estabelecimento (AAAA-MM-DD). */
  hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(this.agora()));
  }

  private trilha(
    a: AtorIdentidade,
    evento: string,
    operacao: string,
    resultado = 'sucesso',
  ): TrilhaIdentidade {
    return {
      rede: a.rede,
      hospital: a.hospital,
      usuario: a.login,
      idUsuario: a.idUsuario,
      evento,
      recurso: 'acesso.identidade',
      operacao,
      resultado,
      estacao: a.estacao,
      correlacao: a.correlacao,
    };
  }

  private async prontas(h: string): Promise<boolean> {
    try {
      return await this.d.porta.prontas(h);
    } catch {
      return false;
    }
  }

  // ── login ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Regra 2: quem tem credencial forte vigente confere só ela. Sem tabela, sem conta, sem forte (ou forte
   * desatualizada): o chamador segue pela fonte de acesso (a senha anterior). Erro de banco sobe (o login responde indisponível).
   */
  async autenticar(h: string, login: string, senha: string): Promise<DesfechoForte> {
    if (!(await this.prontas(h))) return { tipo: 'legado' };
    const conta = await this.d.porta.conta(h, login);
    if (!conta) return { tipo: 'legado' };
    // Credencial que o sistema não confere (não Argon2id): recusa sem tentar (tempo constante); só o gestor redefine.
    if (conta.redefinicaoObrigatoria) {
      await conferirSenha(senha, null);
      this.d.aviso?.('credencial a redefinir pelo gestor', { hospital: h });
      return { tipo: 'forte-invalida' };
    }
    const forte = await this.d.porta.forte(h, login, conta.id);
    if (caminhoDoLogin(forte, senhaAnterior(conta)) !== 'forte') return { tipo: 'legado' };
    if (!conta.ativo || conta.bloqueado) {
      await conferirSenha(senha, null);
      return { tipo: 'forte-invalida' };
    }
    const r = await this.d.porta.autenticarForte(h, login, conta.id, senha, conferirSenha);
    if (!r) return { tipo: 'legado' };
    if (!r.confere) return { tipo: 'forte-invalida' };
    return { tipo: 'forte-ok', conta, provisoria: r.credencial.origem === 'senha-provisoria' };
  }

  /**
   * Depois que a senha anterior conferiu: regrava no esquema forte (primeiro login). Falha não impede o login
   * (vai ao aviso, sem dado pessoal); a próxima entrada tenta de novo.
   */
  async regravar(
    a: AtorIdentidade,
    senha: string,
    origem: OrigemCredencialForte = 'primeiro-login',
    /** Quem age, quando não é o dono da conta (o gestor na redefinição): vai à trilha como usuário. */
    autor?: AtorIdentidade,
  ): Promise<boolean> {
    try {
      if (!(await this.prontas(a.hospital))) return false;
      // Sem a conta (a fonte sintética do dev/ci só conhece as suas): nada a regravar, sem o custo do hash.
      if (!(await this.d.porta.conta(a.hospital, a.login))) return false;
      const hashPhc = await cifrarSenha(senha, this.argon2);
      const p = this.argon2;
      await this.d.porta.gravarForte(
        a.hospital,
        {
          idUsuario: a.idUsuario,
          login: a.login,
          hashPhc,
          algoritmo: algoritmoDoPhc(hashPhc) ?? 'argon2id',
          parametros: `m=${p.memoria},t=${p.passes},p=${p.paralelismo}`,
          origem,
        },
        this.trilha(autor ?? a, 'acesso.credencial.regravada', 'regravar'),
      );
      return true;
    } catch (e) {
      this.d.aviso?.('credencial forte não regravada', {
        hospital: a.hospital,
        erro: e instanceof Error ? e.name : 'desconhecido',
      });
      return false;
    }
  }

  private async avaliacao(h: string, alcance: Alcance2fa): Promise<Avaliacao2fa> {
    const linhas = await this.d.porta.politicas(h);
    const av = avaliarPolitica2fa(daPolitica(linhas).map(linhaPura), alcance, this.hoje());
    if (av.exigencia !== 'opcional') return av;
    // A exigência do cadastro do perfil: adesão sem prazo (entrar e cadastrar), nunca obrigatório imediato.
    const doPerfil = linhas.find(
      (l) => l.origem === 'cadastro-perfil' && l.encerradaEm === null && alcanca(linhaPura(l), alcance),
    );
    return doPerfil ? { exigencia: 'adesao', linha: doPerfil.id, prazoAdesaoAte: null } : av;
  }

  /**
   * Regra 3 no login (senha já conferida): com segundo fator ativo, o código é obrigatório e conferido (sem repetir o
   * passo); sem ele, a política decide (entrar, entrar e cadastrar no prazo, ou recusar). Sem as tabelas: entra
   * como no M05 (o segundo fator ainda não existe no estabelecimento).
   */
  async segundoFatorNoLogin(
    h: string,
    conta: { readonly login: string; readonly id: number },
    alcance: Alcance2fa,
    codigo: string | undefined,
  ): Promise<Desfecho2fa> {
    const disponivel = this.d.chave !== null;
    if (!(await this.prontas(h))) {
      return {
        tipo: 'entrar',
        info: { cadastrado: false, disponivel: false, exigencia: 'opcional', prazoAdesaoAte: null },
      };
    }
    const [f, av] = await Promise.all([
      this.d.porta.segundoFator(h, conta.login, conta.id),
      this.avaliacao(h, alcance),
    ]);
    const des = desfecho2faNoLogin(situacao2fa(f), av);
    const info = (cadastrado: boolean): InfoSegundoFatorSessao => ({
      cadastrado,
      disponivel,
      exigencia: av.exigencia,
      prazoAdesaoAte: av.prazoAdesaoAte,
    });
    if (des.tipo === 'recusar') return { tipo: 'cadastro-obrigatorio' };
    if (des.tipo !== 'conferir-codigo' || !f) return { tipo: 'entrar', info: info(false) };
    if (!codigo) return { tipo: 'codigo-necessario' };
    if (!(await this.conferirCodigo(h, f, codigo))) return { tipo: 'codigo-invalido' };
    return { tipo: 'entrar', info: info(true) };
  }

  private async conferirCodigo(h: string, f: SegundoFatorRegistrado, codigo: string): Promise<boolean> {
    if (!this.d.chave || f.situacao === 'revogado') return false;
    let segredo: string;
    try {
      segredo = decifrarSegredo(f.segredoEnvelope, this.d.chave);
    } catch {
      return false;
    }
    const opcoes = { passoSegundos: f.passoSegundos, digitos: f.digitos };
    const passo = passoTotpConferido(segredo, codigo, this.agora(), opcoes);
    if (passo === null) return false;
    if (f.situacao !== 'ativo') return true;
    // O mesmo passo não vale duas vezes (RFC 6238 §5.2).
    return this.d.porta.marcar2fa(h, f.id, new Date(passo * opcoes.passoSegundos * 1000));
  }

  // ── o próprio segundo fator (/preferencias/seguranca) ─────────────────────────────────────────

  async meuSegundoFator(a: AtorIdentidade, alcance: Alcance2fa): Promise<MeuSegundoFator> {
    if (!(await this.prontas(a.hospital))) {
      return {
        situacao: 'ausente',
        exigencia: 'opcional',
        prazoAdesaoAte: null,
        confirmadoEm: null,
        disponivel: false,
      };
    }
    const [f, av, conta] = await Promise.all([
      this.d.porta.segundoFator(a.hospital, a.login, a.idUsuario),
      this.avaliacao(a.hospital, alcance),
      this.d.porta.conta(a.hospital, a.login),
    ]);
    return {
      situacao: situacao2fa(f),
      exigencia: av.exigencia,
      prazoAdesaoAte: av.prazoAdesaoAte,
      confirmadoEm: f?.confirmadoEm ? f.confirmadoEm.toISOString() : null,
      // Sem a conta (a fonte sintética só conhece as suas), o cadastro não está disponível.
      disponivel: this.d.chave !== null && conta !== null,
    };
  }

  /** Inicia o cadastro: segredo novo, guardado cifrado como pendente; a resposta leva o segredo e o URI uma vez. */
  async iniciarCadastro(a: AtorIdentidade): Promise<SegundoFatorInicio> {
    if (
      !this.d.chave ||
      !(await this.prontas(a.hospital)) ||
      !(await this.d.porta.conta(a.hospital, a.login))
    ) {
      throw new ErroIdentidade(
        'indisponivel',
        'O cadastro do segundo fator não está disponível neste estabelecimento.',
        503,
      );
    }
    const segredo = gerarSegredoBase32();
    const r = await this.d.porta.iniciar2fa(
      a.hospital,
      { idUsuario: a.idUsuario, login: a.login, segredoEnvelope: cifrarSegredo(segredo, this.d.chave) },
      this.trilha(a, 'acesso.segundofator.iniciado', 'iniciar'),
    );
    if (!r)
      throw new ErroIdentidade(
        'ja-cadastrado',
        'O segundo fator já está ativo. Remova-o antes de cadastrar outro.',
      );
    return {
      segredo,
      uri: uriOtpauth(a.login, this.d.emissor, segredo, TOTP_PADRAO),
      expiraEm: new Date(this.agora() + VALIDADE_CADASTRO_MS).toISOString(),
    };
  }

  /** Confirma o cadastro com o primeiro código certo (pendente há menos de 10 min). */
  async confirmarCadastro(a: AtorIdentidade, codigo: string): Promise<void> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const f = await this.d.porta.segundoFator(a.hospital, a.login, a.idUsuario);
    if (!f || f.situacao !== 'pendente')
      throw new ErroIdentidade('sem-cadastro', 'Comece o cadastro do segundo fator.');
    if (f.criadoEm && this.agora() - f.criadoEm.getTime() > VALIDADE_CADASTRO_MS) {
      throw new ErroIdentidade('sem-cadastro', 'O cadastro expirou. Comece de novo.');
    }
    if (!(await this.conferirCodigo(a.hospital, f, codigo))) {
      throw new ErroIdentidade(
        'codigo-invalido',
        'Código inválido. Confira o horário do celular e tente de novo.',
        422,
      );
    }
    const ok = await this.d.porta.confirmar2fa(
      a.hospital,
      f.id,
      this.trilha(a, 'acesso.segundofator.confirmado', 'confirmar'),
    );
    if (!ok) throw new ErroIdentidade('sem-cadastro', 'O cadastro mudou; comece de novo.');
  }

  /** Remove o próprio segundo fator (só quando a política não o exige). */
  async removerProprio(a: AtorIdentidade, alcance: Alcance2fa): Promise<void> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const [f, av] = await Promise.all([
      this.d.porta.segundoFator(a.hospital, a.login, a.idUsuario),
      this.avaliacao(a.hospital, alcance),
    ]);
    if (!f || f.situacao === 'revogado')
      throw new ErroIdentidade('sem-cadastro', 'Não há segundo fator cadastrado.');
    if (!podeRemoverSegundoFator(av)) {
      throw new ErroIdentidade(
        'remocao-recusada',
        'O segundo fator é obrigatório para o seu perfil. Para trocar de aparelho, procure o gestor de acessos.',
      );
    }
    await this.d.porta.revogar2fa(
      a.hospital,
      f.id,
      this.trilha(a, 'acesso.segundofator.removido', 'remover'),
    );
  }

  /** Gestor de acessos: revoga o segundo fator de outro usuário (troca de aparelho; o usuário cadastra de novo). */
  async revogarDeOutro(a: AtorIdentidade, login: string): Promise<void> {
    if (login === a.login)
      throw new ErroIdentidade('remocao-recusada', 'Use as suas preferências para o seu segundo fator.');
    const conta = await this.d.porta.conta(a.hospital, login);
    if (!conta) throw new ErroIdentidade('usuario-inexistente', 'Usuário inexistente.', 404);
    const f = await this.d.porta.segundoFator(a.hospital, conta.login, conta.id);
    if (!f || f.situacao === 'revogado')
      throw new ErroIdentidade('sem-cadastro', 'O usuário não tem segundo fator.');
    await this.d.porta.revogar2fa(
      a.hospital,
      f.id,
      this.trilha(a, 'acesso.segundofator.revogado', 'revogar'),
    );
  }

  // ── gestão ───────────────────────────────────────────────────────────────────────────────────

  async resumo(_rede: string, h: string): Promise<ResumoIdentidade> {
    // Sem convivência com o sistema anterior (ADR 0003): não há contingência; o campo sai do contrato (pedido).
    const contingencia = false;
    if (!(await this.prontas(h))) {
      return {
        estabelecimento: h,
        ativos: 0,
        porSenha: contarEmFaixa(SITUACOES_CREDENCIAL, []),
        porSegundoFator: contarEmFaixa(SITUACOES_SEGUNDO_FATOR, []),
        contingencia,
        tabelasProntas: false,
      };
    }
    const grupos = await this.d.porta.contagens(h);
    const senha = grupos.flatMap((g) => {
      const c = g.forteVigente
        ? 'forte'
        : situacaoCredencial(null, {
            presente: g.senhaPresente,
            criptografada: g.criptografada,
            comSalt: g.comSalt,
            alteradaEm: null,
          });
      return Array<typeof c>(g.n).fill(c);
    });
    const f2 = grupos.flatMap((g) => Array<SituacaoSegundoFator>(g.n).fill(g.segundoFator));
    return {
      estabelecimento: h,
      ativos: faixaContagemCredencial(grupos.reduce((s, g) => s + g.n, 0)),
      porSenha: contarEmFaixa(SITUACOES_CREDENCIAL, senha),
      porSegundoFator: contarEmFaixa(SITUACOES_SEGUNDO_FATOR, f2),
      contingencia,
      tabelasProntas: true,
    };
  }

  async usuarios(h: string, f: FiltroUsuariosIdentidade): Promise<PaginaUsuariosIdentidade> {
    if (!(await this.prontas(h))) return { itens: [], pagina: f.pagina, temMais: false };
    // Filtro por situação: na porta, antes da paginação (na porta própria, em SQL com a mesma regra de situacaoCredencial).
    const p = await this.d.porta.usuarios(h, {
      ...(f.busca ? { busca: f.busca } : {}),
      ...(f.senha ? { senha: f.senha } : {}),
      pagina: f.pagina,
      tamanho: TAMANHO_PAGINA,
    });
    const itens: UsuarioIdentidade[] = p.itens.map((u) => {
      const forte = u.forteEm ? { criadaEm: u.forteEm, algoritmo: u.forteAlgoritmo ?? '' } : null;
      return {
        login: u.login,
        nome: u.nomeExibicao,
        grupo: u.grupo,
        ativo: u.ativo,
        bloqueado: u.bloqueado,
        senha: situacaoCredencial(forte, senhaAnterior(u)),
        senhaLegadoPresente: u.senhaPresente,
        credencialEm: u.forteEm ? u.forteEm.toISOString() : null,
        segundoFator: u.segundoFator,
      };
    });
    return { itens, pagina: f.pagina, temMais: p.temMais };
  }

  async politicas(h: string): Promise<Politica2fa[]> {
    if (!(await this.prontas(h))) return [];
    return (await this.d.porta.politicas(h)).map(politicaDe);
  }

  async incluirPolitica(a: AtorIdentidade, p: NovaPolitica2fa): Promise<Politica2fa> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const existentes = daPolitica(await this.d.porta.politicas(a.hospital)).map(linhaPura);
    const problemas = conferirNovaLinha2fa(p, existentes, this.hoje());
    if (problemas.length) throw new ErroIdentidade('politica-invalida', problemas.join(' '), 422);
    const { id } = await this.d.porta.incluirPolitica(
      a.hospital,
      { hospital: a.hospital, ...p, criadaPor: a.login },
      this.trilha(a, 'acesso.politicaSegundoFator.incluida', 'incluir'),
    );
    const lida = (await this.d.porta.politicas(a.hospital)).find((l) => l.id === id);
    if (!lida) throw new ErroIdentidade('indisponivel', 'A linha não foi relida.', 503);
    return politicaDe(lida);
  }

  /**
   * Abre a onda 1 de uma vez (ficha, regra 3): uma linha por perfil crítico e por grupo administrador, com o mesmo
   * início, prazo e motivo. As que já têm linha ativa ficam como estão (contadas em `jaExistiam`).
   */
  async abrirOnda1(
    a: AtorIdentidade,
    p: { inicio: string; prazoAdesaoDias: number; motivo: string },
  ): Promise<{ incluidas: number; jaExistiam: number }> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const existentes = daPolitica(await this.d.porta.politicas(a.hospital)).map(linhaPura);
    const novas = linhasDaOnda1().map((l) => ({ ...l, onda: 1 as const, ...p }));
    const faltam = novas.filter((n) => conferirNovaLinha2fa(n, existentes, this.hoje()).length === 0);
    if (!faltam.length) {
      const problemas = novas.length ? conferirNovaLinha2fa(novas[0]!, existentes, this.hoje()) : [];
      const soDuplicadas = problemas.every((x) => x.startsWith('Já existe'));
      if (!soDuplicadas) throw new ErroIdentidade('politica-invalida', problemas.join(' '), 422);
      return { incluidas: 0, jaExistiam: novas.length };
    }
    for (const n of faltam)
      await this.d.porta.incluirPolitica(
        a.hospital,
        { hospital: a.hospital, ...n, criadaPor: a.login },
        this.trilha(a, 'acesso.politicaSegundoFator.incluida', 'incluir'),
      );
    return { incluidas: faltam.length, jaExistiam: novas.length - faltam.length };
  }

  async encerrarPolitica(a: AtorIdentidade, id: string, motivo: string): Promise<void> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const ok = await this.d.porta.encerrarPolitica(
      a.hospital,
      { id, hospital: a.hospital, por: a.login, motivo },
      this.trilha(a, 'acesso.politicaSegundoFator.encerrada', 'encerrar'),
    );
    if (!ok) throw new ErroIdentidade('politica-inexistente', 'Linha inexistente ou já encerrada.', 404);
  }

  /**
   * W0-09: alterar o prazo e o alvo da linha VIGENTE com motivo. O anterior fica visível (encerrada como
   * "Alterada: <motivo>"); a nova mantém a onda e o início. As mesmas conferências da inclusão, sem contar a própria
   * linha (o início que já passou vale como hoje: a obrigatoriedade continua de onde estava).
   */
  async alterarPolitica(
    a: AtorIdentidade,
    id: string,
    p: { alvo: 'perfil' | 'grupo' | 'todos'; valor: string | null; prazoAdesaoDias: number; motivo: string },
  ): Promise<Politica2fa> {
    if (!(await this.prontas(a.hospital))) throw new ErroIdentidade('indisponivel', 'Indisponível.', 503);
    const linhas = await this.d.porta.politicas(a.hospital);
    const atual = daPolitica(linhas).find((l) => l.id === id && l.encerradaEm === null);
    if (!atual) throw new ErroIdentidade('politica-inexistente', 'Linha inexistente ou já encerrada.', 404);
    const hoje = this.hoje();
    const outras = daPolitica(linhas)
      .filter((l) => l.id !== id)
      .map(linhaPura);
    const problemas = conferirNovaLinha2fa(
      { alvo: p.alvo, valor: p.valor, onda: atual.onda, inicio: atual.inicio < hoje ? hoje : atual.inicio },
      outras,
      hoje,
    );
    const valor = p.alvo === 'todos' ? null : p.valor;
    if (
      atual.alvo === p.alvo &&
      (atual.valor ?? null) === valor &&
      atual.prazoAdesaoDias === p.prazoAdesaoDias
    )
      problemas.push('Nada mudou: altere o prazo ou o alvo.');
    if (problemas.length) throw new ErroIdentidade('politica-invalida', problemas.join(' '), 422);
    const r = await this.d.porta.alterarPolitica(
      a.hospital,
      {
        id,
        hospital: a.hospital,
        por: a.login,
        alvo: p.alvo,
        valor,
        prazoAdesaoDias: p.prazoAdesaoDias,
        motivo: p.motivo,
      },
      this.trilha(a, 'acesso.politicaSegundoFator.alterada', 'alterar'),
    );
    if (!r) throw new ErroIdentidade('politica-inexistente', 'Linha inexistente ou já encerrada.', 404);
    const lida = (await this.d.porta.politicas(a.hospital)).find((l) => l.id === r.id);
    if (!lida) throw new ErroIdentidade('indisponivel', 'A linha não foi relida.', 503);
    return politicaDe(lida);
  }

  /** Fim do prazo de adesão de uma linha (para a tela). */
  static fimDaAdesao(p: Pick<Politica2fa, 'inicio' | 'prazoAdesaoDias'>): string {
    return somarDias(p.inicio, Math.max(0, p.prazoAdesaoDias - 1));
  }
}
