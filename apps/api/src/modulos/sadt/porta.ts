// Porta do SADT (M26): o que as telas do diagnóstico e o portal de resultados leem e gravam, independente de onde (a
// API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do M04 (receitas sadt.*,
//     com a trilha na mesma transação); as só do novo (amostra, faixa e aviso crítico, leitura do resultado, acesso ao
//     portal, orçamento, laudo emitido) em transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): exames, resultados, amostras e laudos SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
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
} from '@sgh/contratos';
import type {
  AcessoPortalLido,
  ApoioSadtLido,
  AtendimentoParaLancamento,
  AutocadastroPortalLido,
  FiltroExamesSetor,
  LaudoParaEmitir,
  LaudoPortalLido,
  LiberacaoVista,
  ResultadoParaDigitacaoLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_SADT = Symbol('PORTA_SADT');

export type ContextoSadt = ContextoPortaM18;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto (o estabelecimento vem do contexto). */
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
  /** Avisos dos elementos críticos de uma liberação (feita no outro sistema: a vigia). */
  avisarCriticos(a: {
    idSilanexa: number;
    chave: string;
    idLiberacao: number;
    liberadoEm: Date;
    origem: 'novo' | 'outroSistema';
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
  registrarLeitura(r: { idSilanexa: number; origem: 'pep' | 'portal'; usuario: string }): Promise<void>;
  registrarOrcamento(o: {
    nome: string;
    ato: number;
    data: Date;
    paciente: number | null;
    convenio: number;
    itens: number;
    total: number;
    validade: Date;
    usuario: string;
  }): Promise<number>;
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
  }): Promise<number>;
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
  ): Promise<(OrcamentoLido & { readonly nomeLegado: string }) | null>;
  apoio(c: ContextoSadt, setor?: SetorSadt): Promise<ApoioSadtLido>;
  vinculos(c: ContextoSadt, login: string): Promise<VinculoDaSessao[]>;
  /** O login do médico do atendimento (destinatário do aviso de valor crítico na central de avisos). */
  responsavelDoAtendimento(c: ContextoSadt, atendimento: number): Promise<string | null>;
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
  'responsavelDoAtendimento',
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
