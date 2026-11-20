// Fachada do núcleo: estabelecimentos da configuração (ARQ-1), pools da rede (ARQ-2), leitura somente
// leitura, conferência do nome com o banco e verificação de schema na partida. Um estabelecimento que não
// conecta, não passa no schema-check ou tem configuração recusada (ex.: SYSDBA) fica "indisponível" para
// o seletor do M05, sem derrubar os demais.
import type { Ambiente } from './arquivo-ambiente.js';
import { conferirFusoFixo } from './codec.js';
import { conferirUsuarioFirebird, type ConfiguracaoNucleo, lerConfiguracaoNucleo } from './configuracao.js';
import { type ContextoLegado } from './contexto.js';
import type { DriverFirebird } from './driver.js';
import { type Estabelecimento, lerEstabelecimentos, lerRedePadrao } from './estabelecimentos.js';
import {
  conferirCharsetPartida,
  ErroCharset,
  lerCharsetTexto,
  registrarCharsetTexto,
} from './codec/charset.js';
import { type IdentificacaoBanco, lerIdentificacao, nomeConfere } from './identificacao.js';
import { PoolsDaRede, type EstadoPool } from './pool.js';
import { lerCatalogoLegado, type CatalogoLegado } from './schema/catalogo.js';
import { calcularImpressao, compararImpressoes, type ImpressaoDigital } from './schema/impressao.js';
import { lerHomologada, marcarSchema, type MarcaSchema, RegistroSchema } from './schema/verificacao.js';
import {
  type Escritor,
  escreverReservado,
  type Leitor,
  lerSomente,
  type OpcoesConsultaLeitura,
} from './transacao.js';
import { PORTAS_OCUPADAS } from './trava-saidas.js';
import { comImagens, contextoComo, marcaComoAtual } from './como.js';
import {
  type AtorCorrecao,
  type CorrecaoFeita,
  executarCorrecao,
  lerImagens,
  type PassoCorrecao,
  planejarCorrecao,
} from '../suporte/correcao.js';
import { gravarOutbox as gravarOutboxSgh } from './sgh/tecnicas.js';
import {
  type ContaAlvo,
  type GrupoAlvo,
  lerContaAlvo,
  lerGruposAlvo,
  lerUsuariosDoGrupo,
  type UsuarioAlvo,
} from '../acesso/repositorios/alvos.js';
import type { FonteCatalogo } from './catalogo-operacoes.js';
import { type EntidadeBusca, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { alimentarFilaIncremental, type AvaliarPar } from '../cadastro/gravacao/duplicidade.js';
import {
  cicloVigiaBusca,
  contagemIndice,
  lotecargaBusca,
  type MemoriaVigia,
  novaMemoriaVigia,
  type ResultadoVigia,
} from '../cadastro/gravacao/vigia-busca.js';
import { Executor, type MetricasExecutor } from './executor.js';
import {
  aplicarScripts,
  type OpcoesAplicacao,
  type ResultadoAplicacao,
  type ResultadoSimulacao,
  simularScripts,
} from './sgh/aplicador.js';
import { type OpcoesRecolhimento, recolherSgh, type ResultadoRecolhimento } from './sgh/recolhimento.js';
import type { ScriptSgh } from './sgh/scripts.js';
import { cicloRelay, type ConfiguracaoRelay, type Publicador, type ResultadoCiclo } from './sgh/relay.js';
import type { Combinacao } from '../acesso/credencial.js';
import {
  autenticarComLeitor,
  dadosDeSessao,
  politicaDeLogin,
  type Autenticacao,
  type DadosSessao,
} from '../acesso/login.js';
import type { ConfigLogin } from '../acesso/repositorios/politica.js';
import {
  lerEmergenciaVigente,
  lerMapaPerfis,
  lerPerfisConcedidos,
  type EmergenciaVigente,
  type PerfilConcedidoLegado,
  type PermissaoDoPerfilLegado,
} from '../acesso/repositorios/perfis-sgh.js';
import { lerPerfisDoGrupo } from '../acesso/repositorios/gestao.js';
import {
  conferenciasConselhoVigentes,
  lerConferenciasConselho,
  lerRegistrosConselhoDoUsuario,
  type SituacaoConselhoLegado,
} from '../acesso/gravacao/conselho-conferencia-sgh.js';
import { gravarOutbox, gravarTrilha, type LinhaTrilha } from './sgh/tecnicas.js';
import {
  type AberturaEmergencia,
  EVENTO_ALERTA_EMERGENCIA,
  gravarAberturaEmergencia,
} from '../acesso/gravacao/emergencia.js';
import {
  type ConcessoesUsuario,
  type EscoposUsuario,
  type FlagDeclarada,
  lerConcessoesUsuario,
  lerEscoposUsuario,
  lerRestricaoVinculo,
} from '../acesso/repositorios/permissoes.js';

export { somenteSgh } from './sgh/somente-sgh.js';
import { somenteSgh } from './sgh/somente-sgh.js';

export interface SaudeEstabelecimento {
  readonly codigo: string;
  readonly nomeConfigurado: string;
  /** Conectou e o schema confere com o homologado: pode aparecer no seletor do M05. */
  readonly disponivel: boolean;
  readonly motivo: string | null;
  readonly conectado: boolean;
  /** null: ainda não conferido (banco indisponível). */
  readonly nomeConfere: boolean | null;
  readonly identificacao: IdentificacaoBanco | null;
  readonly sysdbaDev: boolean;
  readonly schema: MarcaSchema | null;
}

export interface OpcoesNucleo {
  readonly env: Ambiente;
  readonly driver: DriverFirebird;
  /** Pasta de tools/schema-check/homologado. */
  readonly pastaHomologada: string;
  /** Rede destes pools; padrão: REDE_PADRAO. */
  readonly rede?: string;
  readonly aviso?: (mensagem: string, campos: Record<string, unknown>) => void;
}

interface Situacao {
  conectado: boolean;
  motivo: string | null;
  identificacao: IdentificacaoBanco | null;
  nomeConfere: boolean | null;
}

/** M11: autor das gravações SGH_ do vigia na trilha própria (não é login do legado). */
export const USUARIO_VIGIA = 'SGH.VIGIA';

export class NucleoLegado {
  readonly rede: string;
  readonly config: ConfiguracaoNucleo;
  readonly estabelecimentos: readonly Estabelecimento[];
  readonly schema = new RegistroSchema();
  private readonly pools: PoolsDaRede;
  private readonly driver: DriverFirebird;
  private readonly pastaHomologada: string;
  private readonly recusados = new Map<string, string>();
  private readonly situacao = new Map<string, Situacao>();
  private readonly impressoes = new Map<string, ImpressaoDigital>();
  private readonly aviso: (mensagem: string, campos: Record<string, unknown>) => void;
  /** M11: memória do vigia do índice de busca por estabelecimento e entidade (janela e varredura). */
  private readonly memoriasVigia = new Map<string, MemoriaVigia>();
  private temporizador: ReturnType<typeof setInterval> | undefined;
  private readonly ambiente: string;
  private reverificando = false;

  constructor(opcoes: OpcoesNucleo) {
    conferirFusoFixo(); // TIMESTAMP do legado: sem horário de verão no processo (codec.ts)
    const rede = opcoes.rede ?? lerRedePadrao(opcoes.env);
    if (!rede) throw new Error('REDE_PADRAO ausente: o núcleo precisa do código da rede (ARQ-2).');
    this.rede = rede;
    this.ambiente = opcoes.env['AMBIENTE']?.trim() ?? '';
    this.config = lerConfiguracaoNucleo(opcoes.env);
    this.estabelecimentos = lerEstabelecimentos(opcoes.env);
    this.driver = opcoes.driver;
    this.pastaHomologada = opcoes.pastaHomologada;
    this.aviso = opcoes.aviso ?? (() => undefined);
    const aceitos: Estabelecimento[] = [];
    for (const est of this.estabelecimentos) {
      try {
        if (conferirUsuarioFirebird(est, opcoes.env)) {
          this.aviso('conta SYSDBA aceita só em dev (pendência DP-15: conta própria)', {
            estabelecimento: est.codigo,
          });
        }
        aceitos.push(est);
      } catch (e) {
        this.recusados.set(est.codigo, e instanceof Error ? e.message : String(e));
      }
    }
    this.pools = new PoolsDaRede(rede, aceitos, this.driver, this.config, opcoes.env);
  }

  private contexto(hospital: string): Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'> {
    return { rede: this.rede, hospital, traceId: 'nucleo' };
  }

  /**
   * Leitura somente leitura no banco do estabelecimento do contexto. M59-F1: com `modulo` (o grupo do adaptador dono
   * da consulta), a transação usa a conta do módulo quando a TI já a configurou (D-LEITURA-59).
   */
  lerSomente<T>(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId' | 'modulo'>,
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T> {
    return lerSomente(this.pools, this.config, contexto, fn);
  }

  /**
   * Transação de escrita SEMPRE desfeita (ROLLBACK), só na cópia descartável: AMBIENTE=dev ou ci explícito,
   * host em loopback e nunca porta de outro projeto (3050 = sante-firebird). Serve à captura de assinatura
   * (M03): o cenário grava, a ferramenta retrata o depois dentro da transação e tudo é desfeito. A escrita
   * que confirma é só do executor do M04.
   */
  desfazendoNaCopia<T>(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (e: Escritor) => Promise<T>,
    /**
     * M19: `semEspera` abre a transação READ COMMITTED NO WAIT (a da fila concorrente: chamar a senha), para o teste
     * de integração provar que a trava ocupada por outra conexão falha na hora. Sem a opção: SNAPSHOT, como a captura.
     */
    opcoes: { readonly semEspera?: true } = {},
  ): Promise<T> {
    if (this.ambiente !== 'dev' && this.ambiente !== 'ci') {
      return Promise.reject(new Error('Gravação desfeita só na cópia descartável (AMBIENTE=dev ou ci).'));
    }
    const est = this.estabelecimentos.find((e) => e.codigo === contexto.hospital);
    if (
      !est ||
      !['127.0.0.1', 'localhost', '::1'].includes(est.host) ||
      PORTAS_OCUPADAS.includes(est.porta)
    ) {
      return Promise.reject(new Error('Gravação desfeita só em cópia do projeto em loopback.'));
    }
    // SNAPSHOT: o antes e o depois da captura não veem COMMIT de outro sistema na cópia compartilhada.
    // Numa sessão "como" (testes do ADR 0021), a imagem antes/depois é retratada como na escrita confirmada.
    return escreverReservado(
      this.pools,
      this.config,
      contexto,
      (e) => fn(this.retratando(e)),
      opcoes.semEspera ? { confirmar: false, semEspera: true } : { confirmar: false, instantaneo: true },
    );
  }

  /** Sessão "como" em curso (ADR 0021): o escritor retrata a imagem ANTES/DEPOIS na mesma transação. */
  private retratando(e: Escritor): Escritor {
    const marca = marcaComoAtual();
    return marca ? comImagens(e, marca, this.rede) : e;
  }

  /**
   * Transação de escrita CONFIRMADA: reservada ao executor (operações do catálogo) e ao `sgh:aplicar`
   * (scripts SGH_). Não é caminho de repositório nem de tela (guardas:legado).
   */
  private escreverConfirmando<T>(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (e: Escritor) => Promise<T>,
    confirmar = true,
    semEspera = false,
  ): Promise<T> {
    return escreverReservado(this.pools, this.config, contexto, (e) => fn(this.retratando(e)), {
      confirmar,
      ...(semEspera ? { semEspera: true as const } : {}),
    });
  }

  /** Executor de operações deste núcleo (passos 0 a 7; ficha do M04). */
  criarExecutor(opcoes: {
    readonly catalogo: FonteCatalogo;
    readonly metricas?: MetricasExecutor;
    readonly aoConfirmar?: (hospital: string, eventos: readonly string[]) => void;
    readonly log?: (mensagem: string, campos: Record<string, unknown>) => void;
  }): Executor {
    return new Executor({
      ambiente: this.ambiente,
      catalogo: opcoes.catalogo,
      schema: this.schema,
      ler: (ctx, fn) => this.lerSomente(ctx, fn),
      escrever: (ctx, fn, confirmar, semEspera) =>
        this.escreverConfirmando(ctx, fn, confirmar, semEspera === true),
      ...(opcoes.metricas ? { metricas: opcoes.metricas } : {}),
      ...(opcoes.aoConfirmar ? { aoConfirmar: opcoes.aoConfirmar } : {}),
      ...(opcoes.log ? { log: opcoes.log } : {}),
    });
  }

  /**
   * `pnpm sgh:aplicar`: aplica os scripts SGH_ que faltam no banco do estabelecimento (conta de scripts) e
   * registra cada um em SGH_VERSAO_SCRIPT. O ambiente pedido tem de ser o do arquivo de ambiente.
   */
  aplicarScriptsSgh(
    codigo: string,
    scripts: readonly ScriptSgh[],
    opcoes: OpcoesAplicacao,
  ): Promise<ResultadoAplicacao> {
    if (opcoes.ambiente !== this.ambiente) {
      return Promise.reject(
        new Error(`Ambiente pedido (${opcoes.ambiente}) difere do AMBIENTE configurado.`),
      );
    }
    const ctx = this.contexto(codigo);
    return aplicarScripts(
      {
        ler: (fn) => this.lerSomente(ctx, fn),
        escreverConfirmando: (fn) => this.escreverConfirmando(ctx, fn),
      },
      scripts,
      opcoes,
    );
  }

  /** M60 (`sgh:aplicar --simular`): o plano da aplicação só com leitura (conta de leitura), sem gravar nada. */
  simularScriptsSgh(
    codigo: string,
    scripts: readonly ScriptSgh[],
    opcoes: Pick<OpcoesAplicacao, 'ambiente' | 'aceitarDeOutrosRamos'>,
  ): Promise<ResultadoSimulacao> {
    if (opcoes.ambiente !== this.ambiente) {
      return Promise.reject(
        new Error(`Ambiente pedido (${opcoes.ambiente}) difere do AMBIENTE configurado.`),
      );
    }
    const ctx = this.contexto(codigo);
    return simularScripts((fn) => this.lerSomente(ctx, fn), scripts, opcoes);
  }

  /**
   * M60 (`sgh:aplicar --recolher`): remove todos os objetos SGH_ do banco do estabelecimento (conta de
   * scripts), em ordem reversa de dependência. Só ensaio e cópia; produção com a autorização própria.
   */
  recolherObjetosSgh(codigo: string, opcoes: OpcoesRecolhimento): Promise<ResultadoRecolhimento> {
    if (opcoes.ambiente !== this.ambiente) {
      return Promise.reject(
        new Error(`Ambiente pedido (${opcoes.ambiente}) difere do AMBIENTE configurado.`),
      );
    }
    const ctx = this.contexto(codigo);
    return recolherSgh(
      {
        ler: (fn) => this.lerSomente(ctx, fn),
        escreverConfirmando: (fn) => this.escreverConfirmando(ctx, fn),
      },
      opcoes,
    );
  }

  /** Um ciclo do relay da outbox do estabelecimento (worker): pendentes em ordem de ID, publica e marca. */
  cicloRelayOutbox(codigo: string, publicar: Publicador, cfg?: ConfiguracaoRelay): Promise<ResultadoCiclo> {
    const ctx = this.contexto(codigo);
    return cicloRelay(
      { ler: (fn) => this.lerSomente(ctx, fn), escrever: (fn) => this.escreverConfirmando(ctx, fn) },
      codigo,
      publicar,
      cfg,
    );
  }

  /** Atalho de uma consulta só. */
  consultar(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    sql: string,
    parametros: readonly unknown[] = [],
    opcoes: OpcoesConsultaLeitura = {},
  ): Promise<Record<string, unknown>[]> {
    return this.lerSomente(contexto, (l) => l.consultar(sql, parametros, opcoes));
  }

  async lerCatalogoLegado(codigo: string): Promise<CatalogoLegado> {
    return this.lerSomente(this.contexto(codigo), (l) => lerCatalogoLegado(l));
  }

  /**
   * Login no TBUSERS do estabelecimento escolhido (M05), em transação READ ONLY. O hash nunca sai do
   * verificador (packages/legado/src/acesso). Devolve só o desfecho e, no sucesso, a conta sem senha.
   */
  autenticar(codigo: string, login: string, senha: string, fixa?: Combinacao): Promise<Autenticacao> {
    return this.lerSomente(this.contexto(codigo), (l) => autenticarComLeitor(l, login, senha, fixa));
  }

  /** Dados de sessão (papéis SBIS, unidades, termo, política) do usuário já autenticado. */
  dadosDeSessao(codigo: string, login: string, config?: ConfigLogin): Promise<DadosSessao> {
    return this.lerSomente(this.contexto(codigo), (l) => dadosDeSessao(l, login, config));
  }

  /** ADR 0021: a conta-alvo do "login como" (sem colunas de senha), READ ONLY. */
  contaAlvo(codigo: string, login: string): Promise<ContaAlvo | null> {
    return this.lerSomente(this.contexto(codigo), (l) => lerContaAlvo(l, login));
  }

  /** ADR 0021: grupos ativos do TBGRUUSU com a contagem de logins não bloqueados, READ ONLY. */
  gruposAlvo(codigo: string): Promise<GrupoAlvo[]> {
    return this.lerSomente(this.contexto(codigo), (l) => lerGruposAlvo(l));
  }

  /** ADR 0021: logins não bloqueados do grupo, READ ONLY. */
  usuariosAlvo(codigo: string, grupo: string): Promise<UsuarioAlvo[]> {
    return this.lerSomente(this.contexto(codigo), (l) => lerUsuariosDoGrupo(l, grupo));
  }

  /** Concessões do legado para o usuário (M06): grupo, papéis SBIS, flags declaradas e conselho. */
  concessoesDoUsuario(
    codigo: string,
    login: string,
    flags: readonly FlagDeclarada[] = [],
  ): Promise<ConcessoesUsuario> {
    return this.lerSomente(this.contexto(codigo), (l) => lerConcessoesUsuario(l, login, flags));
  }

  /** Escopos do usuário (M06), lidos ao vivo das tabelas de vínculo do legado. */
  escoposDoUsuario(codigo: string, login: string): Promise<EscoposUsuario> {
    return this.lerSomente(this.contexto(codigo), (l) => lerEscoposUsuario(l, login));
  }

  /**
   * Tudo o que a autorização do usuário precisa (M06), numa transação READ ONLY: concessões do legado,
   * escopos, o parâmetro de vínculo e, das tabelas SGH_, os perfis concedidos e o mapa aprovado.
   */
  dadosDeAutorizacao(
    codigo: string,
    login: string,
    flags: readonly FlagDeclarada[] = [],
  ): Promise<{
    concessoes: ConcessoesUsuario;
    escopos: EscoposUsuario;
    restricaoVinculo: boolean;
    perfisConcedidos: PerfilConcedidoLegado[];
    mapaPerfis: PermissaoDoPerfilLegado[];
    perfisDoGrupo: string[];
    registrosConselho?: {
      registro: number;
      conferencia: { situacao: SituacaoConselhoLegado; conferidoEm: string } | null;
    }[];
  }> {
    return this.lerSomente(this.contexto(codigo), async (l) => {
      const concessoes = await lerConcessoesUsuario(l, login, flags);
      // W1-01 (parte 11d): com conselho, os registros do papel ativo e a última conferência de cada (SGH_ 1211).
      const registrosConselho = concessoes.conselho
        ? await (async () => {
            const vigentes = conferenciasConselhoVigentes(await lerConferenciasConselho(l, codigo, login));
            return (await lerRegistrosConselhoDoUsuario(l, login)).map((r) => {
              const c = vigentes.get(r.registro);
              return {
                registro: r.registro,
                conferencia: c ? { situacao: c.situacao, conferidoEm: c.conferidoEm } : null,
              };
            });
          })()
        : undefined;
      return {
        ...(registrosConselho ? { registrosConselho } : {}),
        concessoes,
        escopos: await lerEscoposUsuario(l, login),
        restricaoVinculo: await lerRestricaoVinculo(l),
        perfisConcedidos: await lerPerfisConcedidos(l, login),
        mapaPerfis: await lerMapaPerfis(l),
        // ADR 0022: o mapa grupo → perfil aprovado vale para todo o grupo.
        perfisDoGrupo: await lerPerfisDoGrupo(l, concessoes.grupo),
      };
    });
  }

  /** Quebra de vidro vigente do login para o paciente (M06). */
  emergenciaVigente(codigo: string, login: string, idPaciente: number): Promise<EmergenciaVigente | null> {
    return this.lerSomente(this.contexto(codigo), (l) => lerEmergenciaVigente(l, codigo, login, idPaciente));
  }

  /**
   * Transação CONFIRMADA só sobre tabelas SGH_ (M06: quebra de vidro, trilha própria dos eventos que o
   * legado não registra): toda escrita em tabela sem o prefixo SGH_ é recusada antes de chegar ao banco.
   * Não precisa de assinatura do legado (ficha do M06, seção 5).
   */
  gravarSgh<T>(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (e: Escritor) => Promise<T>,
  ): Promise<T> {
    return this.escreverConfirmando(contexto, (e) => fn(somenteSgh(e)));
  }

  /**
   * Quebra de vidro (M06, regra 8): a abertura em SGH_ACESSO_EMERGENCIA e o evento na SGH_TRILHA, na mesma
   * transação SGH_ (sem trilha, sem acesso), com o alerta ao Auditor na SGH_OUTBOX (o relay do M04 publica
   * na fila email-<rede>; se a fila cair, o alerta espera na outbox e não se perde). A justificativa nunca
   * vai à trilha nem ao alerta.
   */
  registrarEmergencia(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    abertura: AberturaEmergencia,
    linha: Omit<LinhaTrilha, 'idAlvo' | 'tabelaAlvo'>,
  ): Promise<{ id: string; inicio: Date; fim: Date; trilha: string }> {
    return this.gravarSgh(contexto, async (e) => {
      const a = await gravarAberturaEmergencia(e, abertura);
      const t = await gravarTrilha(e, { ...linha, tabelaAlvo: 'SGH_ACESSO_EMERGENCIA', idAlvo: a.id });
      await gravarOutbox(e, {
        rede: abertura.rede,
        hospital: abertura.hospital,
        tipo: EVENTO_ALERTA_EMERGENCIA,
        chave: `emergencia:${abertura.hospital}:${a.id}`,
        carga: {
          idEmergencia: a.id,
          idUsuario: String(abertura.idUsuario),
          motivo: abertura.motivo,
          inicio: a.inicio.toISOString(),
          fim: a.fim.toISOString(),
        },
      });
      return { ...a, trilha: t.id };
    });
  }

  /**
   * Prévia do "Corrigir" (ADR 0021): as imagens da sessão (ou da escrita) e o plano da compensação, em ordem
   * inversa, com a mudança posterior apontada. Só leitura.
   */
  previaCorrecaoComo(
    hospital: string,
    sessao: string,
    acao?: string,
  ): Promise<{ passos: PassoCorrecao[]; tabelas: string[] }> {
    return this.lerSomente(this.contexto(hospital), async (l) => {
      const imagens = await lerImagens(l, sessao, acao);
      return {
        passos: await planejarCorrecao(l, imagens),
        tabelas: [...new Set(imagens.map((i) => i.tabela))],
      };
    });
  }

  /**
   * Executa a correção (ADR 0021, regra 5b) na transação curta do núcleo, a mesma do executor do M04 (READ
   * COMMITTED, LOCK TIMEOUT, trava e releitura), com a marca de schema conferida como no executor; a correção
   * vai à SGH_SUP_CORRECAO e à SGH_TRILHA na MESMA transação. Fora de qualquer sessão "como" (a correção não
   * gera imagem nova).
   */
  corrigirComo(
    hospital: string,
    pedido: { sessao: string; acao?: string; confirmarConflito: boolean; resumo?: string },
    ator: AtorCorrecao,
    linha: Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>,
  ): Promise<CorrecaoFeita[]> {
    return contextoComo.exit(() =>
      this.escreverConfirmando(this.contexto(hospital), async (e) => {
        const imagens = await lerImagens(e, pedido.sessao, pedido.acao);
        const tabelas = [...new Set(imagens.map((i) => i.tabela))];
        if (this.schema.bloqueada(hospital, tabelas))
          throw new Error('Estrutura do banco diferente da homologada: correção bloqueada (M02).');
        return executarCorrecao(
          e,
          imagens,
          ator,
          pedido.confirmarConflito,
          async (p, idCorrecao) => {
            await gravarTrilha(e, {
              ...linha,
              tabelaAlvo: p.imagem.tabela,
              idAlvo: `C${idCorrecao}`,
              chaveNaturalAlvo: `imagem:${p.imagem.id}:${p.compensacao}`,
            });
          },
          pedido.resumo,
        );
      }),
    );
  }

  /**
   * Transação SGH_ com a SGH_OUTBOX (ADR 0021: aviso ao Auditor da sessão "como", gravado depois que a sessão
   * do alvo abriu, com a carga completa).
   */
  gravarSghComOutbox<T>(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (
      e: Escritor,
      outbox: (ev: { tipo: string; chave: string; carga: Record<string, string> }) => Promise<string>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.gravarSgh(contexto, (e) =>
      fn(e, (ev) =>
        gravarOutboxSgh(e, {
          rede: contexto.rede,
          hospital: contexto.hospital,
          tipo: ev.tipo,
          chave: ev.chave,
          carga: ev.carga,
        }),
      ),
    );
  }

  /**
   * M11: um ciclo da leitura incremental do índice de busca (pacientes, profissionais e solicitantes) no
   * estabelecimento, cada entidade numa transação SGH_ curta (lê o legado, grava só SGH_BUSCA_NOME).
   */
  async cicloIndiceBusca(codigo: string): Promise<ResultadoVigia[]> {
    const r: ResultadoVigia[] = [];
    for (const entidade of ['paciente', 'profissional', 'solicitante'] as const) {
      // A memória do vigia (versões vistas na janela, cursor da varredura) só muda se a transação confirmar.
      const chave = `${codigo}\u0000${entidade}`;
      const atual = this.memoriasVigia.get(chave) ?? novaMemoriaVigia();
      const copia: MemoriaVigia = { vistos: new Set(atual.vistos), varredura: atual.varredura };
      r.push(await this.gravarSgh(this.contexto(codigo), (e) => cicloVigiaBusca(e, entidade, copia)));
      this.memoriasVigia.set(chave, copia);
    }
    return r;
  }

  /**
   * M11: leitura incremental da fila de duplicidades: os pacientes que o vigia reindexou contra os candidatos do
   * índice; os pares aceitos pela regra pura (`avaliar`) vão a SGH_CAD_DUPLICIDADE com a linha da SGH_TRILHA na
   * mesma transação SGH_ (autor: o vigia).
   */
  alimentarFilaDuplicidade(codigo: string, ids: readonly number[], avaliar: AvaliarPar): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);
    const contexto = this.contexto(codigo);
    return this.gravarSgh(contexto, async (e) => {
      const n = await alimentarFilaIncremental(e, codigo, ids, avaliar);
      if (n > 0)
        await gravarTrilha(e, {
          rede: contexto.rede,
          hospital: codigo,
          usuario: USUARIO_VIGIA,
          evento: EVENTOS_AUDITAVEIS.duplicidadeFilaAtualizada.codigo,
          recurso: 'cadastro.duplicidade',
          operacao: 'cadastro.filaIncremental',
          tabelaAlvo: 'SGH_CAD_DUPLICIDADE',
          idAlvo: null,
          chaveNaturalAlvo: `novos:${n}`,
          resultado: 'sucesso',
          estacao: 'SGH-WORKER:vigia',
          correlacao: `vigia-fila-${Date.now()}`.slice(0, 64),
        });
      return n;
    });
  }

  /** M11: conferência do índice (entidades distintas no índice × linhas da tabela do legado), só contagens. */
  contagemIndiceBusca(codigo: string, entidade: EntidadeBusca): Promise<{ indice: number; legado: number }> {
    return this.lerSomente(this.contexto(codigo), (l) => contagemIndice(l, entidade));
  }

  /** M11: um lote da carga inicial do índice de busca (`pnpm cadastro:indexar`), em transação SGH_ curta. */
  loteCargaIndiceBusca(
    codigo: string,
    entidade: EntidadeBusca,
    desde: number,
  ): Promise<{ ultimo: number | null; indexados: number }> {
    return this.gravarSgh(this.contexto(codigo), (e) => lotecargaBusca(e, entidade, desde));
  }

  /** Evento só na trilha própria (tipos novos da SBIS ou usuário que o legado não conhece), transação curta. */
  registrarTrilhaPropria(
    contexto: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    linha: LinhaTrilha,
  ): Promise<{ id: string; hash: string }> {
    return this.gravarSgh(contexto, (e) => gravarTrilha(e, linha));
  }

  /** PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND do banco do estabelecimento (M06). */
  restricaoVinculo(codigo: string): Promise<boolean> {
    return this.lerSomente(this.contexto(codigo), (l) => lerRestricaoVinculo(l));
  }

  /** Política de senha e sessão (TBCFGLOGIN, linha única) do estabelecimento. */
  configLogin(codigo: string): Promise<ConfigLogin> {
    // W1-01 (parte 5): com a versão vigente da política do Sante (SGH_ACESSO_POLITICA_SENHA) em `sante`.
    return this.lerSomente(this.contexto(codigo), (l) =>
      politicaDeLogin(l, { hospital: codigo, agora: new Date() }),
    );
  }

  /**
   * Calcula a impressão digital atual e compara com a homologada; registra a marca de bloqueio. Se o
   * banco estava fora (partida sem conexão), confere a conexão e o nome de novo antes; se a leitura do
   * catálogo falha, o estabelecimento volta a "não conectado" e a impressão antiga é apagada (nunca se
   * compara banco com impressão velha).
   */
  async verificarSchema(codigo: string): Promise<MarcaSchema> {
    const recusa = this.recusados.get(codigo);
    if (recusa) {
      this.impressoes.delete(codigo);
      const m = marcarSchema(codigo, null, null, { motivo: recusa });
      this.schema.registrar(m);
      return m;
    }
    if (!this.situacao.get(codigo)?.conectado) {
      await this.conferirEstabelecimento(codigo);
      const s = this.situacao.get(codigo);
      if (!s?.conectado) {
        this.impressoes.delete(codigo);
        const m = marcarSchema(codigo, null, null, { motivo: s?.motivo ?? 'Banco indisponível.' });
        this.schema.registrar(m);
        return m;
      }
    }
    const inicio = performance.now();
    let atual: ImpressaoDigital;
    try {
      atual = calcularImpressao(codigo, await this.lerCatalogoLegado(codigo));
    } catch (e) {
      this.impressoes.delete(codigo);
      const motivo = 'Não foi possível ler o catálogo do banco.';
      const anterior = this.situacao.get(codigo);
      this.situacao.set(codigo, {
        conectado: false,
        motivo,
        identificacao: anterior?.identificacao ?? null,
        nomeConfere: anterior?.nomeConfere ?? null,
      });
      const m = marcarSchema(codigo, null, null, { motivo });
      this.schema.registrar(m);
      this.aviso('schema-check: banco indisponível', {
        estabelecimento: codigo,
        erro: e instanceof Error ? e.name : 'erro',
      });
      return m;
    }
    this.impressoes.set(codigo, atual);
    let homologada: ImpressaoDigital | null;
    try {
      homologada = lerHomologada(this.pastaHomologada, codigo);
    } catch {
      homologada = null; // arquivo ilegível conta como sem homologação (bloqueia as escritas)
    }
    let m = marcarSchema(codigo, atual, homologada, { duracaoMs: Math.round(performance.now() - inicio) });
    const outro = homologada ? this.homologadaDivergente(codigo, homologada) : null;
    if (m.estado === 'homologado' && outro) {
      // Critério de saída 2 da Fase 0: os bancos da rede têm o mesmo modelo. Homologadas diferentes
      // entre si bloqueiam todas as escritas dos dois, até o responsável técnico decidir.
      m = {
        ...m,
        estado: 'divergente',
        bloqueiaTudo: true,
        motivo: `Impressão homologada diferente da de "${outro}": os bancos da rede não têm o mesmo modelo.`,
      };
    }
    this.schema.registrar(m);
    if (m.estado !== 'homologado') {
      this.aviso('schema-check: escritas bloqueadas', { estabelecimento: codigo, estado: m.estado });
    }
    return m;
  }

  /** Outro estabelecimento configurado com homologada diferente desta (o primeiro achado), ou null. */
  private homologadaDivergente(codigo: string, homologada: ImpressaoDigital): string | null {
    for (const e of this.estabelecimentos) {
      if (e.codigo === codigo) continue;
      let outra: ImpressaoDigital | null;
      try {
        outra = lerHomologada(this.pastaHomologada, e.codigo);
      } catch {
        outra = null;
      }
      if (outra && !compararImpressoes(homologada, outra).iguais) return e.codigo;
    }
    return null;
  }

  ultimaImpressao(codigo: string): ImpressaoDigital | undefined {
    return this.impressoes.get(codigo);
  }

  /** Conecta, lê a identificação do banco e confere o nome configurado. */
  async conferirEstabelecimento(codigo: string): Promise<void> {
    const est = this.estabelecimentos.find((e) => e.codigo === codigo);
    if (!est) throw new Error(`Estabelecimento "${codigo}" não configurado.`);
    const recusa = this.recusados.get(codigo);
    if (recusa) {
      this.situacao.set(codigo, { conectado: false, motivo: recusa, identificacao: null, nomeConfere: null });
      return;
    }
    try {
      const id = await this.lerSomente(this.contexto(codigo), (l) => lerIdentificacao(l));
      // M58-F3: o charset do texto (parâmetro legado.charset) conferido contra o declarado do banco; o desencontro
      // tira o estabelecimento do ar (gravar CP1252 num banco UTF-8, ou o contrário, corromperia o texto).
      const cs = await this.lerSomente(this.contexto(codigo), (l) => lerCharsetTexto(l)).catch(
        (e: unknown) => (e instanceof ErroCharset ? e : null),
      );
      if (cs instanceof ErroCharset) throw cs;
      if (cs) registrarCharsetTexto(codigo, conferirCharsetPartida(cs.charsetBanco, cs.parametro));
      const confere = nomeConfere(est.nome, id);
      if (!confere) this.aviso('nome configurado diverge do banco', { estabelecimento: codigo });
      this.situacao.set(codigo, { conectado: true, motivo: null, identificacao: id, nomeConfere: confere });
    } catch (e) {
      if (e instanceof ErroCharset) {
        this.situacao.set(codigo, {
          conectado: false,
          motivo: e.message,
          identificacao: null,
          nomeConfere: null,
        });
        this.aviso('charset do banco não confere com o parâmetro', { estabelecimento: codigo });
        return;
      }
      this.situacao.set(codigo, {
        conectado: false,
        motivo: 'Não conectou ao banco do estabelecimento.',
        identificacao: null,
        nomeConfere: null,
      });
      this.aviso('estabelecimento indisponível', {
        estabelecimento: codigo,
        erro: e instanceof Error ? e.name : 'erro',
      });
    }
  }

  /** Partida: conferência e schema-check de todos, em paralelo; nunca lança. */
  async partida(): Promise<SaudeEstabelecimento[]> {
    await Promise.all(
      this.estabelecimentos.map(async (e) => {
        // verificarSchema confere a conexão e o nome antes (situação ainda vazia na partida).
        this.situacao.delete(e.codigo);
        await this.verificarSchema(e.codigo);
      }),
    );
    return this.saude();
  }

  saude(): SaudeEstabelecimento[] {
    const estados = new Map<string, EstadoPool>(this.pools.estados().map((p) => [p.estabelecimento, p]));
    return this.estabelecimentos.map((e) => {
      const s = this.situacao.get(e.codigo);
      const marca = this.schema.marca(e.codigo) ?? null;
      const disponivel = Boolean(s?.conectado) && marca?.estado === 'homologado';
      const motivo =
        this.recusados.get(e.codigo) ??
        s?.motivo ??
        (marca && marca.estado !== 'homologado' ? marca.motivo : null) ??
        (s ? null : 'Ainda não verificado.');
      return {
        codigo: e.codigo,
        nomeConfigurado: e.nome,
        disponivel,
        motivo: disponivel ? null : motivo,
        conectado: Boolean(s?.conectado),
        nomeConfere: s?.nomeConfere ?? null,
        identificacao: s?.identificacao ?? null,
        sysdbaDev: estados.get(e.codigo)?.sysdbaDev ?? false,
        schema: marca,
      };
    });
  }

  /**
   * Nova tentativa periódica dos estabelecimentos indisponíveis (banco fora na partida ou depois): o
   * seletor do M05 os recebe quando o banco volta, sem reiniciar a API. Recusa de configuração não é
   * tentada de novo (exige corrigir o ambiente).
   */
  reverificarPeriodicamente(intervaloMs: number): void {
    this.pararReverificacao();
    this.temporizador = setInterval(() => {
      if (this.reverificando) return;
      this.reverificando = true;
      const alvos = this.saude().filter((s) => !s.disponivel && !this.recusados.has(s.codigo));
      void Promise.all(alvos.map((s) => this.verificarSchema(s.codigo).catch(() => undefined))).finally(
        () => {
          this.reverificando = false;
        },
      );
    }, intervaloMs);
    this.temporizador.unref();
  }

  private pararReverificacao(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = undefined;
  }

  estadosDosPools(): EstadoPool[] {
    return this.pools.estados();
  }

  async encerrar(): Promise<void> {
    this.pararReverificacao();
    await this.pools.encerrar();
    await this.driver.encerrar();
  }
}
