// Porta do SADT (M26): o que as telas do diagnóstico e o portal de resultados leem e gravam, independente de onde (a
// API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente (MariaDB) pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura nas tabelas
//     do diagnóstico (requisicao_exame, exame_item, resultado_exame, amostra_biologica, aviso_valor_critico,
//     emissao_laudo, acesso ao portal) e gravações pelo Executor, com a trilha, a fila de integração e a idempotência
//     na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): exames, resultados, amostras e laudos SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: tipos de negócio próprios (sem tipos da porta antiga), contexto do núcleo por id.
import type {
  AmostraDetalhe,
  AvisoCritico,
  ColetaGrupo,
  EstadoAmostra,
  ExameSadt,
  IndicadoresSadt,
  ItemLiberacao,
  LaudoPortal,
  OrcamentoLido,
  RequisicaoLida,
  SetorSadt,
  ValorCriticoLido,
  ElementoDigitacao,
  PacienteSadt,
  ValorConferencia,
  LaudoPortal as LaudoPortalContrato,
} from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

// ── Tipos de negócio da porta (as telas e o portal; ids numéricos, datas ISO, sem marca S/N) ────────────────────

export type SituacaoFiltroSadt =
  'aReceber' | 'recebidos' | 'aDigitar' | 'aLiberar' | 'liberados' | 'aEmitir' | 'todos';

export interface FiltroExamesSetor {
  readonly setor?: SetorSadt | undefined;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao?: SituacaoFiltroSadt;
  readonly urgentes?: boolean;
  readonly unidade?: number;
  readonly termo?: string;
  /** Um ato só dentro do setor (a lista de trabalho DICOM filtra pelo setor de imagem na consulta). */
  readonly ato?: number;
}

export interface AtendimentoParaLancamento {
  readonly atendimento: number;
  readonly paciente: PacienteSadt;
  readonly atend: 'I' | 'E';
  readonly reg: number;
  readonly convenio: { codigo: number; nome: string };
  /** A requisição do setor já aberta para o atendimento (null: a recepção do diagnóstico abre antes de lançar). */
  readonly conta: { id: number; numero: number } | null;
  /** Versões do atendimento e do paciente lidas pela tela (controle otimista na gravação). */
  readonly retratos: { htAtendimento: number; htPaciente: number } | null;
}

export interface LaudoParaEmitir {
  readonly paciente: PacienteSadt;
  readonly atendimento: string;
  readonly convenio: string;
  readonly exames: {
    readonly id: number;
    readonly nome: string;
    readonly setor: string;
    readonly data: string;
    readonly liberadoEm: string | null;
    readonly liberadoPor: string;
    readonly valores: ValorConferencia[];
    readonly texto: string[];
    readonly emissor: string;
  }[];
}

export interface LaudoPortalLido {
  readonly laudo: LaudoPortalContrato;
  readonly ato: number;
  readonly paciente: number;
  readonly reg: number;
  readonly solicitante: number | null;
  readonly valores: ValorConferencia[];
  readonly texto: string[];
}

/** Uma liberação com valor crítico (o aviso da central parte dela). */
export interface LiberacaoVista {
  readonly exame: number;
  readonly chave: string;
  readonly liberacao: number;
  readonly liberadoEm: Date;
  readonly paciente: number;
  readonly atendimento: number;
  readonly usuario: string;
}

export interface ResultadoParaDigitacaoLido {
  readonly exame: ExameSadt;
  readonly elementos: ElementoDigitacao[];
  readonly variaveis: { codigo: number; identificacao: string; descricao: string; valor: number | null }[];
  readonly observacoes: string[];
  readonly modelos: { codigo: number; nome: string; texto: string }[];
  readonly laudo: { texto: string; html: string; emissor: string } | null;
  readonly alertaDataInvalida: boolean;
  readonly bloqueado: boolean;
  readonly grandezas: { codigo: number; nome: string; sigla: string }[];
}

export interface ApoioSadtLido {
  readonly prestadores: { id: number; ato: number; codigo: number; nome: string }[];
  readonly exames: {
    id: number;
    ato: number;
    codigo: string;
    nome: string;
    material: string | null;
    recipiente: string | null;
  }[];
  readonly kits: { codigo: number; nome: string }[];
  readonly recipientes: { codigo: number; nome: string }[];
  readonly convenios: { codigo: number; nome: string }[];
}

/** Acesso ao portal de resultados (paciente pelo protocolo; médico externo pela conta). */
export interface AcessoPortalLido {
  readonly id: number;
  readonly perfil: 'paciente' | 'medicoExterno';
  readonly paciente: number | null;
  readonly reg: number | null;
  readonly conselho: string | null;
  readonly uf: string | null;
  readonly numero: string | null;
  readonly solicitante: number | null;
  readonly nome: string | null;
  readonly senhaResumo: string | null;
  readonly segundoFator: string | null;
  readonly situacao: string;
  readonly tentativas: number;
  readonly bloqueadoAte: Date | null;
}

export interface AutocadastroPortalLido {
  readonly id: number;
  readonly nome: string;
  readonly conselho: string;
  readonly uf: string;
  readonly numero: string;
  readonly situacao: 'pendente' | 'aprovado' | 'recusado';
  /** A situação da conta aprovada (ativo, bloqueado ou encerrado). */
  readonly situacaoConta?: string;
  readonly pedidoEm: string;
  readonly origem: 'novo' | 'outroSistema';
  readonly candidatos: { id: number; nome: string }[];
}

export const PORTA_SADT = Symbol('PORTA_SADT');

/** O contexto do núcleo; o código do estabelecimento e da rede acompanham quando a sessão os tem (parâmetros, avisos). */
export type ContextoSadt = ContextoPortaM18 & {
  readonly rede?: string;
  readonly hospital?: string;
  /** A chave de idempotência da requisição (a tela a manda); sem ela, cada gravação é nova. */
  readonly chaveIdempotencia?: string;
};

/** Gravações pelo Executor do núcleo, com a trilha na mesma transação (o estabelecimento vem do contexto). */
export interface GravadorSghSadt {
  registrarColeta(a: {
    codigo: (id: number) => string;
    paciente: number;
    atendimento: number;
    reg: number;
    atend: 'I' | 'E';
    recipiente: number | null;
    exames: readonly { id: number; chave: string }[];
    pulseiraConferida: boolean;
    origem?: number | null;
    estacao: string | null;
    usuario: string;
  }): Promise<{ id: number; codigo: string }>;
  mudarEstadoAmostra(r: {
    amostra: number;
    de: EstadoAmostra;
    para: EstadoAmostra;
    motivo: string | null;
    detalhe: string | null;
    usuario: string;
    estacao: string | null;
  }): Promise<void>;
  gravarValorCritico(f: {
    ato: number;
    exame: string;
    elemento: number;
    abaixoDe: number | null;
    acimaDe: number | null;
    prazoMinutos: number;
    aprovacao: string;
    ativo: boolean;
    usuario: string;
  }): Promise<number>;
  /** Avisos dos elementos críticos de uma liberação (no banco, nasce na própria operação de liberação). */
  avisarCriticos(a: {
    /** O exame pedido (exame_item). */
    exameItem: number;
    chave: string;
    idLiberacao: number;
    liberadoEm: Date;
    paciente: number;
    atendimento: number;
  }): Promise<number>;
  comunicarAviso(r: {
    aviso: number;
    canal: string;
    destinatario: string;
    observacao: string | null;
    usuario: string;
  }): Promise<void>;
  escalonarAviso(r: { aviso: number; nivel: number }): Promise<boolean>;
  /** A primeira abertura do resultado do exame pedido (exame_item) pelo usuário; a repetida não grava de novo. */
  registrarLeitura(r: { exameItem: number; origem: 'pep' | 'portal'; usuario: string }): Promise<void>;
  marcarOrcamentoConvertido(r: { orcamento: number; atendimento: number; usuario: string }): Promise<void>;
  registrarLaudoEmitido(r: {
    impressao: number;
    codigo: string;
    via: number;
    exames: number;
    hashPdf: string | null;
    motivo: string | null;
    usuario: string;
    idsExames?: readonly number[];
  }): Promise<{ id: number; numero: string }>;
  criarProtocoloPortal(r: {
    paciente: number;
    reg: number;
    protocoloResumo: string;
    usuario: string;
  }): Promise<number>;
  registrarAutocadastro(r: {
    nome: string;
    conselho: string;
    uf: string;
    numero: string;
    /** CPF do médico (11 dígitos, verificadores conferidos no contrato). */
    cpf: string;
    email: string;
    senhaResumo: string;
    segundoFator: string;
  }): Promise<number>;
  decidirAutocadastro(r: {
    id: number;
    aprovar: boolean;
    solicitante: number | null;
    motivo: string | null;
    usuario: string;
  }): Promise<void>;
  registrarTentativaPortal(r: {
    id: number;
    tentativas: number;
    bloqueadoAte: Date | null;
    acertou: boolean;
  }): Promise<void>;
}

export interface VinculoDaSessao {
  readonly vinculo: number;
  readonly conselho: number;
  readonly nome: string;
  readonly codigoCbo: string;
  readonly ativo: boolean;
}

export interface PortaSadt extends PortaGravacaoM18<GravadorSghSadt> {
  relogio(c: ContextoSadt): Promise<{ hoje: string; agora: string }>;
  examesDoSetor(
    c: ContextoSadt,
    f: FiltroExamesSetor,
  ): Promise<{ itens: ExameSadt[]; cortada: boolean; contagens: Record<string, number> }>;
  exame(c: ContextoSadt, id: number): Promise<ExameSadt | null>;
  examesPorId(c: ContextoSadt, ids: readonly number[]): Promise<ExameSadt[]>;
  coleta(
    c: ContextoSadt,
    f: { inicio: string; fim: string; unidade?: number; deHora?: string; ateHora?: string },
  ): Promise<{ grupos: ColetaGrupo[]; cortada: boolean; unidades: { codigo: number; exames: number }[] }>;
  mapa(
    c: ContextoSadt,
    f: { setor: SetorSadt; inicio: string; fim: string },
  ): Promise<{
    bancadas: { codigo: number | null; nome: string; urgentes: number; exames: ExameSadt[] }[];
    cortada: boolean;
  }>;
  digitacao(c: ContextoSadt, id: number): Promise<ResultadoParaDigitacaoLido | null>;
  conferencia(c: ContextoSadt, id: number): Promise<ItemLiberacao | null>;
  filaLiberacao(
    c: ContextoSadt,
    f: { setor?: SetorSadt | undefined; inicio: string; fim: string },
  ): Promise<{ itens: ItemLiberacao[]; cortada: boolean }>;
  liberacaoVigente(
    c: ContextoSadt,
    id: number,
  ): Promise<{ id: number; em: string | null; visualizada: boolean } | null>;
  liberadosComCritico(c: ContextoSadt, o: { desde: Date; hoje: string }): Promise<LiberacaoVista[]>;
  avisos(c: ContextoSadt, o: { inicio: string; fim: string; pendentes?: boolean }): Promise<AvisoCritico[]>;
  valoresCriticos(c: ContextoSadt): Promise<ValorCriticoLido[]>;
  elementos(
    c: ContextoSadt,
    exame: string,
  ): Promise<{ codigo: number; nome: string; unidade: string | null }[]>;
  amostras(
    c: ContextoSadt,
    o: { data: string; estado?: EstadoAmostra },
  ): Promise<{
    itens: AmostraDetalhe[];
    cortada: boolean;
    rejeicoes: { motivo: string; quantidade: number }[];
  }>;
  amostraPorCodigo(c: ContextoSadt, codigo: string): Promise<AmostraDetalhe | null>;
  amostraPorId(c: ContextoSadt, id: number): Promise<AmostraDetalhe | null>;
  atendimentoDosExames(
    c: ContextoSadt,
    ids: readonly number[],
  ): Promise<{
    paciente: number;
    atendimento: number;
    reg: number;
    atend: 'I' | 'E';
    prontuario: number;
    mesmos: boolean;
  } | null>;
  laudosDoExame(
    c: ContextoSadt,
    id: number,
  ): Promise<{ codigo: string; emitidoEm: string; emitidoPor: string; segundasVias: number }[]>;
  impressaoDosExames(
    c: ContextoSadt,
    ids: readonly number[],
  ): Promise<{ impressao: number; codigo: string } | null>;
  validarLaudo(
    c: ContextoSadt,
    codigo: string,
  ): Promise<{ valido: boolean; emitidoEm: string | null; exames: number }>;
  laudoParaEmitir(c: ContextoSadt, ids: readonly number[]): Promise<LaudoParaEmitir | null>;
  requisicoes(
    c: ContextoSadt,
    o: { data: string; termo?: string },
  ): Promise<{ itens: RequisicaoLida[]; cortada: boolean }>;
  atendimento(c: ContextoSadt, atendimento: number): Promise<AtendimentoParaLancamento | null>;
  atendimentosPorNumero(c: ContextoSadt, reg: number): Promise<AtendimentoParaLancamento[]>;
  orcamentos(
    c: ContextoSadt,
    o: { inicio: string; fim: string; hoje: string; termo?: string; validadeDias: number },
  ): Promise<{ itens: OrcamentoLido[]; cortada: boolean }>;
  orcamento(
    c: ContextoSadt,
    id: number,
    o: { hoje: string; validadeDias: number },
  ): Promise<(OrcamentoLido & { readonly nomeRegistrado: string }) | null>;
  apoio(c: ContextoSadt, setor?: SetorSadt): Promise<ApoioSadtLido>;
  vinculos(c: ContextoSadt, login: string): Promise<VinculoDaSessao[]>;
  /** O login do médico do atendimento (destinatário do aviso de valor crítico na central de avisos). */
  /** O login de quem recebe o aviso do valor crítico do exame pedido: o solicitante da requisição (usuário ativo). */
  destinatarioDoCritico(c: ContextoSadt, exameItem: number): Promise<string | null>;
  profissionais(
    c: ContextoSadt,
    termo: string,
  ): Promise<{ id: number; nome: string; conselho: string; cbo: string }[]>;
  solicitantes(
    c: ContextoSadt,
    o: { termo?: string; numero?: number; uf?: string },
  ): Promise<{ id: number; nome: string; registro: string; ativo: boolean }[]>;
  parametros(
    c: ContextoSadt,
    setor: SetorSadt,
    usuario: string,
  ): Promise<{ campos: { campo: string; rotulo: string; valor: string }[]; ocultos: string[] }>;
  indicadores(
    c: ContextoSadt,
    o: { inicio: string; fim: string; setor?: SetorSadt | undefined; agora: Date },
  ): Promise<Omit<IndicadoresSadt, 'inicio' | 'fim'>>;
  laudosPortalDoPaciente(
    c: ContextoSadt,
    o: { paciente: number; reg: number | null; atos: readonly number[] },
  ): Promise<{ laudos: LaudoPortal[]; cortada: boolean }>;
  laudosPortalDoMedico(
    c: ContextoSadt,
    o: { solicitante: number; atos: readonly number[]; desde: string },
  ): Promise<{ laudos: LaudoPortal[]; cortada: boolean }>;
  laudoPortal(c: ContextoSadt, liberacao: number): Promise<LaudoPortalLido | null>;
  pacienteDoAtendimento(
    c: ContextoSadt,
    reg: number,
  ): Promise<{ paciente: number; nome: string; nascimento: string | null } | null>;
  nascimentoDoPaciente(
    c: ContextoSadt,
    paciente: number,
  ): Promise<{ nome: string; nascimento: string | null } | null>;
  acessoPorProtocolo(c: ContextoSadt, resumo: string): Promise<AcessoPortalLido | null>;
  acessoDoMedico(
    c: ContextoSadt,
    m: { conselho: string; uf: string; numero: string },
  ): Promise<AcessoPortalLido | null>;
  acessoPorId(c: ContextoSadt, id: number): Promise<AcessoPortalLido | null>;
  autocadastros(c: ContextoSadt, o: { desde: string }): Promise<AutocadastroPortalLido[]>;
  atosPublicados(c: ContextoSadt): Promise<number[]>;
}

export const METODOS_PORTA_SADT: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'examesDoSetor',
  'exame',
  'examesPorId',
  'coleta',
  'mapa',
  'digitacao',
  'conferencia',
  'filaLiberacao',
  'liberacaoVigente',
  'liberadosComCritico',
  'avisos',
  'valoresCriticos',
  'elementos',
  'amostras',
  'amostraPorCodigo',
  'amostraPorId',
  'atendimentoDosExames',
  'laudosDoExame',
  'impressaoDosExames',
  'validarLaudo',
  'laudoParaEmitir',
  'requisicoes',
  'atendimento',
  'atendimentosPorNumero',
  'orcamentos',
  'orcamento',
  'apoio',
  'vinculos',
  'destinatarioDoCritico',
  'profissionais',
  'solicitantes',
  'parametros',
  'indicadores',
  'laudosPortalDoPaciente',
  'laudosPortalDoMedico',
  'laudoPortal',
  'pacienteDoAtendimento',
  'nascimentoDoPaciente',
  'acessoPorProtocolo',
  'acessoDoMedico',
  'acessoPorId',
  'autocadastros',
  'atosPublicados',
]);
