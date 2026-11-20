// Porta do painel de migração gradual (M37; ficha, seções 4 a 7): o que as telas "Migração gradual dos usuários" e o
// diálogo "Abrir chamado" leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY do banco do estabelecimento (conexões do outro sistema, pessoas, permissões dos
//     grupos, contagens do dia, MON$) e as gravações só em SGH_ com a SGH_TRILHA na mesma transação; o lote de
//     liberação como unidade (as chaves de SGH_CFG_LIBERACAO pela função do M08 na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E): as contas sintéticas, as chaves pela fonte de configuração em
//     memória e o resto em memória, com as mesmas validações; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// A condução opcional não passa por aqui: é a operação do protocolo de permissões do grupo, pelo executor (fonte da
// administração), que grava SGH_CFG_COEX_CONDUCAO na mesma transação.
import type {
  ChamadoGravacao,
  ChecagemAgregadaLida,
  HigienizacaoAgregadaLida,
  RegistroAgregadoLido,
  ChamadoLidoBanco,
  ChaveDoLote,
  ChaveGravada,
  CompetenciaLida,
  ContagemUsuariosFim,
  ConclusaoLida,
  ConducaoLida,
  ConexaoOutroLida,
  EstadoDoLote,
  FiltroChamados,
  ItemLigarGravacao,
  ItemLigarLido,
  ContaTecnicaLida,
  CatalogoRetroLido,
  ConclusaoParaEstorno,
  EventoCrud,
  FuncaoLida,
  ItemDesligamentoPendenteAnterior,
  ItemLigarAnterior,
  VersaoTrilhaCoex,
  VersaoTrilhaLida,
  VersaoRegistroCoexLida,
  VinculoTrilhaCoex,
  ItemDesligamentoAnterior,
  ItemDesligamentoGravacao,
  ItemDesligamentoLido,
  PlataformaLida,
  SessoesLidas,
  LinhaTrilha,
  LoteCoexLido,
  MudancaChave,
  PessoaCoexLida,
  RetratoLido,
  SetorCoexLido,
  SetorGravacao,
  TrilhaLida,
  UsoDiaLido,
  UsuarioRevisaoLido,
} from '@sgh/legado';

export const PORTA_COEXISTENCIA = Symbol('PORTA_COEXISTENCIA');

export interface ContextoCoex {
  readonly rede: string;
  readonly hospital: string;
}

export type TrilhaCoex = Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorCoex {
  gravarSetor(s: SetorGravacao, usuario: string): Promise<{ incluido: boolean }>;
  publicarTrilha(
    t: {
      papel: string;
      onda: number;
      nome: string;
      carga: string;
      tarefas: readonly string[];
      exercicio: string;
    },
    usuario: string,
  ): Promise<{ versao: number }>;
  registrarConclusoes(
    c: {
      pessoas: readonly { id: number; login: string }[];
      papel: string;
      onda: number;
      versao: number;
      turma: string;
      turno: string | null;
      concluidoEm: string;
      resultado: 'aprovado' | 'refazer';
    },
    usuario: string,
  ): Promise<{ registradas: number }>;
  abrirChamado(c: ChamadoGravacao, alertar: { encarregado: boolean; s1: boolean }): Promise<string>;
  triarChamado(
    id: string,
    t: {
      severidade: string;
      situacao: string;
      nivel: string;
      comandante: string | null;
      contorno: string | null;
      prazoResposta: Date;
      prazoSolucao: Date;
    },
    usuario: string,
  ): Promise<number>;
  gravarUsoDia(
    linhas: readonly {
      dia: string;
      setor: string;
      operacao: string;
      noNovo: number;
      noLegado: number;
      colisoes?: number;
      esperasTrava?: number;
      recusasOcupado?: number;
      p50Ms?: number | null;
      p95Ms?: number | null;
    }[],
  ): Promise<{ gravadas: number }>;
  /** M39 (regra 1): os itens da lista para ligar um setor da onda 1 (SGH_CFG_COEX_LIGAR). */
  gravarItensLigar(
    setor: string,
    itens: readonly ItemLigarGravacao[],
    usuario: string,
  ): Promise<{ gravados: number }>;
  /** M58 (F1, regra 2): o registro de um item da checklist do desligamento (SGH_CFG_COEX_DESLIG). */
  gravarItemDesligamento(
    i: ItemDesligamentoGravacao,
    usuario: string,
  ): Promise<{ registradoEm: string; incluido: boolean; anterior: ItemDesligamentoAnterior | null }>;
  // ── W0-09 (CRUD completo; script 1122): o ciclo de vida, sempre com o evento (motivo e valor anterior) ──────────
  /** Volta o item do critério a pendente; null: sem linha ou já pendente. */
  voltarItemLigarPendente(setor: string, item: string, usuario: string): Promise<ItemLigarAnterior | null>;
  /** Volta o item da checklist do desligamento a pendente; null: sem linha ou já pendente. */
  voltarItemDesligamentoPendente(
    item: string,
    usuario: string,
  ): Promise<ItemDesligamentoPendenteAnterior | null>;
  lerConclusaoParaEstorno(id: string): Promise<ConclusaoParaEstorno | null>;
  estornarConclusao(id: string, motivo: string, usuario: string): Promise<void>;
  lerVersaoTrilha(v: VersaoTrilhaCoex): Promise<VersaoTrilhaLida | null>;
  /** O mapa de dependências da versão (packages/legado, dependencias-coexistencia.ts); vazio: pode excluir. */
  contarVinculosTrilha(v: VersaoTrilhaCoex): Promise<VinculoTrilhaCoex[]>;
  /** O retrato da linha inteira na SGH_HIST_EXCLUSAO, antes da exclusão física. */
  retratarVersaoTrilha(
    v: VersaoTrilhaCoex,
    quem: { operacao: string; motivo: string; usuario: string },
  ): Promise<void>;
  retirarVersaoTrilha(
    v: VersaoTrilhaCoex & { eraVigente: boolean },
    modo: 'excluir' | 'inativar',
  ): Promise<{ promovida: number | null }>;
  /** O evento (motivo e valor anterior) na SGH_CRUD_EVENTO. */
  registrarEvento(ev: EventoCicloCoex): Promise<void>;
  /** W0-09 (script 1123): a versão nova do registro do fim ou da retrocompatibilidade (null: volta ao arquivo). */
  gravarVersaoRegistro(
    tipo: string,
    conteudo: Record<string, unknown> | null,
    motivo: string,
    usuario: string,
  ): Promise<number>;
}

export interface EventoCicloCoex {
  readonly operacao: string;
  readonly recurso: string;
  readonly evento: EventoCrud;
  readonly tabela: string;
  readonly chave: string;
  readonly motivo: string;
  readonly valorAnterior: Readonly<Record<string, unknown>> | null;
  readonly idempotencia: string;
  readonly estacao: string | null;
  readonly usuario: string;
}

/** M58 (F1): o que o painel do desligamento lê do banco do estabelecimento, numa transação de leitura. */
export interface LeituraDesligamento {
  readonly sessoes: SessoesLidas;
  /** null quando o pedido dispensou (o serviço guarda as contas por 15 minutos: a leitura leva segundos). */
  readonly contas: { declaradas: ContaTecnicaLida[]; naoDeclaradas: number } | null;
  readonly plataforma: PlataformaLida;
  readonly funcoes: FuncaoLida[];
  readonly itens: ItemDesligamentoLido[];
}

export interface PedidoLotePorta {
  readonly setor: string;
  readonly alvoTipo: 'usuarios' | 'grupo' | 'setor';
  readonly alvo: string;
  readonly chaves: readonly ChaveDoLote[];
  readonly incluidos: readonly string[];
  readonly fora: readonly { login: string; motivo: string }[];
  readonly justificativa: string;
  readonly autorizacao: string | null;
  readonly autor: string;
  /** O lote inclui a condução do setor (gravado em SGH_CFG_COEX_LOTE.CONDUCAO). */
  readonly conducao?: boolean;
  readonly conferir?: (chave: ChaveDoLote, estado: EstadoDoLote) => void;
  readonly planejar: (chave: ChaveDoLote, estado: EstadoDoLote) => readonly MudancaChave[];
}

export interface CargaAgora {
  readonly conexoesPorSistema: readonly { sistema: string; conexoes: number }[];
  readonly transacoesLongas: number;
  readonly esperasPorTrava: number;
  readonly em: string;
}

export interface AcompanhamentoLido {
  readonly checagem: readonly ChecagemAgregadaLida[];
  readonly higienizacao: readonly HigienizacaoAgregadaLida[];
  readonly registros: {
    readonly totais: readonly RegistroAgregadoLido[];
    readonly peloNovo: readonly RegistroAgregadoLido[];
  };
}

export interface PortaCoexistencia {
  readonly destino: 'legado' | 'memoria';
  relogio(c: ContextoCoex): Promise<{ agora: Date; hoje: string }>;
  pessoas(c: ContextoCoex): Promise<PessoaCoexLida[]>;
  conexoesOutro(c: ContextoCoex): Promise<ConexaoOutroLida[]>;
  /** O último dia de uso do novo (SGH_TRILHA) dos logins pedidos, desde `desde` (AAAA-MM-DD). */
  ultimoUsoNovo(
    c: ContextoCoex,
    logins: readonly string[],
    desde: string,
  ): Promise<{ login: string; dia: string }[]>;
  publicoPorGrupo(c: ContextoCoex): Promise<{ porGrupo: Readonly<Record<string, number>>; total: number }>;
  setores(c: ContextoCoex): Promise<SetorCoexLido[]>;
  trilhas(c: ContextoCoex): Promise<TrilhaLida[]>;
  conclusoes(c: ContextoCoex): Promise<ConclusaoLida[]>;
  retratos(c: ContextoCoex, desde: string): Promise<RetratoLido[]>;
  usoDia(c: ContextoCoex, desde: string): Promise<UsoDiaLido[]>;
  usoAoVivo(
    c: ContextoCoex,
    dia: string,
  ): Promise<{ operacao: string; setor: string; linhasDoDia: number; doNovo: number }[]>;
  lotes(c: ContextoCoex, id?: string): Promise<LoteCoexLido[]>;
  conducoes(c: ContextoCoex, setor?: string): Promise<ConducaoLida[]>;
  opcoesDosGrupos(
    c: ContextoCoex,
    grupos: readonly string[],
  ): Promise<{ grupo: string; opcao: number; titulo: string | null }[]>;
  chamados(c: ContextoCoex, f?: FiltroChamados): Promise<ChamadoLidoBanco[]>;
  contarChamados(c: ContextoCoex, f?: FiltroChamados): Promise<number>;
  chaves(c: ContextoCoex): Promise<ChaveGravada[]>;
  /** M39 (regra 1): os itens registrados da lista para ligar os setores da onda 1. */
  itensLigar(c: ContextoCoex): Promise<ItemLigarLido[]>;
  carga(c: ContextoCoex): Promise<CargaAgora | null>;
  /**
   * M42 (regra 1): o cadastro de feriados do estabelecimento no período (AAAA-MM-DD; o feriado de todo ano já vem no ano
   * de cada data do período). Os nacionais de lei a regra soma por conta própria. Ausente: nenhum feriado local.
   */
  feriados?(c: ContextoCoex, de: string, ate: string): Promise<string[]>;
  /** M43 (regras 4 e 5): os ativos sem grupo e todos os logins do grupo de painéis (login, grupo e as letras). */
  usuariosRevisao(c: ContextoCoex): Promise<UsuarioRevisaoLido[]>;
  /** M43: as contagens agregadas da tabela de usuários para o painel de fim. */
  contagemUsuariosFim(c: ContextoCoex): Promise<ContagemUsuariosFim>;
  /** M43: os grupos ativos (o destino da troca de grupo). */
  gruposAtivos(c: ContextoCoex): Promise<string[]>;
  /** M43 (regra 1, item 4): a última competência fechada, com o que o novo fechou e enviou; null sem fechamento. */
  competenciaFim(c: ContextoCoex): Promise<CompetenciaLida | null>;
  /** M43 (regra 3): o pico diário das conexões do outro sistema ao banco desde `desde` (dias com coleta). */
  serieOutroSistema(c: ContextoCoex, desde: string): Promise<{ dia: string; conexoes: number }[]>;
  /** M40 (campo 4): os agregados do acompanhamento da onda 2 no período (só contagens; nenhum dado de pessoa). */
  acompanhamentoOnda2(c: ContextoCoex, de: string, ate: string): Promise<AcompanhamentoLido>;
  /**
   * M58 (F1): as sessões de pessoa na tabela de conexões desde `desde` (janela a partir de `inicioJanela`, fora as
   * contas excluídas), as contas técnicas, a plataforma, as funções e a checklist gravada. Só agregados e estrutura.
   */
  leituraDesligamento(
    c: ContextoCoex,
    p: { desde: string; inicioJanela: string; excluidos: readonly string[]; comContas: boolean },
  ): Promise<LeituraDesligamento>;
  /** M58 (F1): a plataforma e as funções do banco (o cartão da verificação de schema). */
  plataformaBanco(c: ContextoCoex): Promise<{ plataforma: PlataformaLida; funcoes: FuncaoLida[] }>;
  /** M59 (F6): o catálogo do banco para o plano de evolução do modelo (só estrutura: tabelas, colunas, gatilhos, chaves). */
  catalogoRetrocompatibilidade(c: ContextoCoex): Promise<CatalogoRetroLido>;
  /** W0-09 (script 1123): as versões do registro gravado pela tela, da mais nova para a mais antiga. */
  versoesRegistro(c: ContextoCoex, tipo: string): Promise<VersaoRegistroCoexLida[]>;
  gravarSgh<T>(
    c: ContextoCoex,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorCoex) => Promise<T>,
  ): Promise<T>;
  aplicarLote(
    c: ContextoCoex,
    p: PedidoLotePorta,
    trilha: TrilhaCoex,
  ): Promise<{
    id: string;
    chaves: { tipo: string; chave: string; loteLiberacao: string; alteradas: number }[];
  }>;
  recolherLote(
    c: ContextoCoex,
    p: {
      id: string;
      justificativa: string;
      autor: string;
      chaves: readonly { tipo: 'operacao' | 'recurso'; chave: string; loteLiberacao: string }[];
    },
    trilha: TrilhaCoex,
  ): Promise<{ recolhido: boolean; alteradas: number }>;
  /** Só na memória: o registro da condução que a receita do banco faz na mesma transação. */
  registrarConducaoMemoria?(
    c: ContextoCoex,
    acao: 'retirar' | 'devolver',
    p: {
      setor: string;
      grupo: string;
      opcoes: readonly number[];
      autorizacao: string;
      lote?: string;
      usuario: string;
    },
  ): void;
}

export const METODOS_PORTA_COEXISTENCIA: ReadonlySet<string> = new Set([
  'relogio',
  'pessoas',
  'conexoesOutro',
  'ultimoUsoNovo',
  'publicoPorGrupo',
  'setores',
  'trilhas',
  'conclusoes',
  'retratos',
  'usoDia',
  'usoAoVivo',
  'lotes',
  'conducoes',
  'opcoesDosGrupos',
  'chamados',
  'contarChamados',
  'chaves',
  'itensLigar',
  'carga',
  'acompanhamentoOnda2',
  'usuariosRevisao',
  'contagemUsuariosFim',
  'gruposAtivos',
  'competenciaFim',
  'serieOutroSistema',
  'leituraDesligamento',
  'plataformaBanco',
  'catalogoRetrocompatibilidade',
  'versoesRegistro',
  'gravarSgh',
  'aplicarLote',
  'recolherLote',
]);
