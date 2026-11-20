// Porta da CCIH (M48, etapa 3; ADR 0031): as leituras do outro sistema e das SGH_ de outros marcos (internados, leitos,
// antimicrobianos prescritos e dispensados, culturas, cirurgias, temperaturas, censo, tipos de surto) e as gravações e
// leituras só do novo (SGH_QUA_* da CCIH e o estado do leito do M21) numa transação SGH_ com a SGH_TRILHA junto.
// Duas implementações: sobre o núcleo do legado (a cópia) e em memória (dev/ci e os testes; dados sintéticos).
import type { ChaveLeito, UnidadeNotificacao } from '@sgh/contratos';
import type {
  BundleSghLido,
  CompetenciaQuaLida,
  DependentesQua,
  TabelaCorrigivelQua,
  VersaoQuaLida,
  AntimicrobianoPrescritoLido,
  CulturaLida,
  DispositivoInvasivoSghLido,
  DispositivoInvasivoSgh,
  InternadoCcihLido,
  IrasSgh,
  IrasSghLida,
  ItemAntimicrobianoSghLido,
  LiberacaoSgh,
  LiberacaoSghLida,
  ObservacaoMaosSghLida,
  PrecaucaoSgh,
  PrecaucaoSghLida,
  SurtoSghLido,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_CCIH = Symbol('PORTA_CCIH');

export type ContextoCcih = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;
type Versionada = {
  readonly id: number;
  readonly versao: number;
  readonly agora: string;
  readonly usuario: string;
};

/** Gravações só do novo (as regras puras conferidas antes, na API). */
export interface GravadorCcih {
  registrarDispositivo(d: SemHospital<DispositivoInvasivoSgh>): Promise<{ id: number }>;
  retirarDispositivo(
    r: Versionada & {
      readonly retiradoEm: string;
      readonly motivo: string;
      readonly observacao: string | null;
    },
  ): Promise<{ versao: number }>;
  registrarIras(i: SemHospital<IrasSgh>): Promise<{ id: number }>;
  descartarIras(d: Versionada & { readonly justificativa: string }): Promise<{ versao: number }>;
  configurarAntimicrobiano(c: {
    readonly item: number;
    readonly restrito: boolean;
    readonly atc: string | null;
    readonly dddGramas: number | null;
    readonly gramasPorUnidade: number | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ criado: boolean }>;
  liberarAntimicrobiano(x: SemHospital<LiberacaoSgh>): Promise<{ id: number }>;
  revisarAntimicrobiano(
    r: Versionada & {
      readonly marco: 'd3' | 'd7';
      readonly conduta: string;
      readonly observacao: string | null;
    },
  ): Promise<{ versao: number }>;
  definirPrecaucao(p: SemHospital<PrecaucaoSgh>): Promise<{ id: number; bloqueados: number; leito: string }>;
  encerrarPrecaucao(
    r: Versionada & {
      readonly leito: ChaveLeito;
      readonly tipoDoLeito: 'contato' | 'goticulas' | 'aerossois' | null;
      readonly bloqueios: readonly ChaveLeito[];
      readonly motivo: string;
      readonly observacao: string | null;
    },
  ): Promise<{ versao: number; liberados: number }>;
  registrarObservacaoMaos(o: {
    readonly unidade: number;
    readonly setor: string | null;
    readonly observadoEm: string;
    readonly categoria: string;
    readonly oportunidades: number;
    readonly conformes: number;
    readonly detalhe: readonly { momento: string; acao: string; luvas: boolean }[];
    readonly observacao: string | null;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  registrarConsumoAlcool(c: {
    readonly unidade: number;
    readonly setor: string | null;
    readonly competencia: string;
    readonly mililitros: number;
    readonly usuario: string;
  }): Promise<{ id: number | null; criado: boolean }>;
  registrarSurto(s: {
    readonly titulo: string;
    readonly tipoSurto: number | null;
    readonly agente: string | null;
    readonly unidade: number;
    readonly setor: string | null;
    readonly inicio: string;
    readonly casos: number;
    readonly medidas: string | null;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  atualizarSurto(
    s: Versionada & {
      readonly situacao: string;
      readonly casos: number;
      readonly medidas: string | null;
      readonly encerradoEm: string | null;
    },
  ): Promise<{ versao: number }>;
  // W0-04: correção por versão e cancelamento com motivo (a versão anterior vai à SGH_QUA_VERSAO).
  corrigirDispositivo(
    c: Corrigida & {
      readonly tipo: string;
      readonly sitio: string | null;
      readonly inseridoEm: string;
      readonly retiradoEm: string | null;
      readonly responsavel?: { readonly registro: number; readonly nome: string } | null;
    },
  ): Promise<{ versao: number }>;
  cancelarDispositivo(c: Corrigida): Promise<{ versao: number }>;
  corrigirIras(
    c: Corrigida & {
      readonly dataInfeccao: string;
      readonly criterios: readonly string[];
      readonly microrganismo: string | null;
      readonly multirresistente: boolean;
      readonly descricao: string | null;
      /** Revisão do W0-04: a associação recalculada com a data nova (undefined = não muda). */
      readonly dispositivo?: number | null;
    },
  ): Promise<{ versao: number }>;
  alterarPrecaucao(
    c: Corrigida & {
      readonly tipo: 'contato' | 'goticulas' | 'aerossois';
      readonly motivo: string;
      readonly motivoOutro: string | null;
      readonly multirresistente: boolean;
      readonly leito: ChaveLeito;
      readonly tipoDoLeito: 'contato' | 'goticulas' | 'aerossois' | null;
      readonly manter: readonly ChaveLeito[];
      readonly bloquear: readonly ChaveLeito[];
      readonly liberar: readonly ChaveLeito[];
    },
  ): Promise<{ versao: number; bloqueados: number; liberados: number }>;
  corrigirObservacaoMaos(
    c: Corrigida & {
      readonly observadoEm: string;
      readonly categoria: string;
      readonly oportunidades: number;
      readonly conformes: number;
      readonly detalhe: readonly { momento: string; acao: string; luvas: boolean }[];
      readonly observacao: string | null;
    },
  ): Promise<{ versao: number }>;
  estornarObservacaoMaos(c: Corrigida): Promise<{ versao: number }>;
  fecharCompetencia(c: {
    readonly competencia: string;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number; versao: number }>;
  reabrirCompetencia(c: Corrigida): Promise<{ versao: number }>;
  // W0-04 (M1): o checklist do bundle por turno (só inclusão).
  registrarBundle(c: {
    readonly dispositivo: number;
    readonly data: string;
    readonly turno: 'manha' | 'tarde' | 'noite';
    readonly itens: Readonly<Record<string, boolean>>;
    readonly conforme: boolean;
    readonly indicacaoRevisada: boolean;
    readonly observacao: string | null;
    readonly agora: string;
    readonly usuario: string;
  }): Promise<{ id: number }>;
  // Revisão do W0-04 (1026): o checklist do bundle se corrige por versão e se estorna.
  corrigirBundle(
    c: Corrigida & {
      readonly itens: Readonly<Record<string, boolean>>;
      readonly conforme: boolean;
      readonly indicacaoRevisada: boolean;
      readonly observacao: string | null;
    },
  ): Promise<{ versao: number }>;
  estornarBundle(c: Corrigida): Promise<{ versao: number }>;
}

/** A mudança versionada: o ID, a versão lida, o motivo, o relógio do banco e quem. */
export type Corrigida = Versionada & { readonly justificativa: string };

type C = ContextoCcih;

export interface PortaCcih extends PortaGravacaoM18<GravadorCcih> {
  /** O relógio do banco do estabelecimento (instante local `AAAA-MM-DDTHH:mm:ss`). */
  relogio(c: C): Promise<string>;
  unidades(c: C): Promise<UnidadeNotificacao[]>;
  internados(c: C): Promise<{ itens: InternadoCcihLido[]; cortada: boolean }>;
  internacao(c: C, reg: number): Promise<InternadoCcihLido | null>;
  /** A alta de cada internação (null enquanto aberta): o dispositivo-dia para na alta (D-ALTA-DISP-48.3). */
  altasDas(c: C, regs: readonly number[]): Promise<{ reg: number; alta: string | null }[]>;
  vizinhos(c: C, leito: ChaveLeito): Promise<(ChaveLeito & { ocupado: boolean })[]>;
  antimicrobianos(
    c: C,
    regs: readonly number[],
    desde: string | null,
  ): Promise<{ itens: AntimicrobianoPrescritoLido[]; cortada: boolean }>;
  antimicrobianoPrescrito(c: C, itemPrescricao: number): Promise<AntimicrobianoPrescritoLido | null>;
  vigencias(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: AntimicrobianoPrescritoLido[]; cortada: boolean }>;
  consumoDispensado(
    c: C,
    ano: number,
    mes: number,
  ): Promise<{ item: number; nome: string; unidades: number }[]>;
  itensAntimicrobianos(c: C): Promise<{ item: number; nome: string }[]>;
  itemDoCadastro(c: C, item: number): Promise<{ item: number; nome: string; antimicrobiano: boolean } | null>;
  fichas(c: C, itensPrescricao: readonly number[]): Promise<Map<number, number>>;
  culturas(c: C, regs: readonly number[], desde: string): Promise<CulturaLida[]>;
  exame(c: C, id: number): Promise<CulturaLida | null>;
  cirurgias(
    c: C,
    regs: readonly number[],
    desde: string,
  ): Promise<{ id: number; reg: number; data: string }[]>;
  cirurgia(c: C, id: number): Promise<{ id: number; reg: number; data: string } | null>;
  temperaturas(
    c: C,
    pacientes: readonly number[],
    desde: string,
  ): Promise<{ paciente: number; valor: number; em: string }[]>;
  censo(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ porSetor: { setor: string; pacientesDia: number }[]; diasFechados: number }>;
  tiposSurto(c: C): Promise<{ codigo: number; nome: string }[]>;
  dispositivo(c: C, id: number): Promise<DispositivoInvasivoSghLido | null>;
  dispositivosDas(c: C, regs: readonly number[]): Promise<DispositivoInvasivoSghLido[]>;
  dispositivosNoPeriodo(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: DispositivoInvasivoSghLido[]; cortada: boolean }>;
  iras(c: C, id: number): Promise<IrasSghLida | null>;
  irasDas(c: C, regs: readonly number[]): Promise<IrasSghLida[]>;
  irasNoPeriodo(c: C, de: string, ate: string): Promise<{ itens: IrasSghLida[]; cortada: boolean }>;
  itensConfigurados(c: C): Promise<ItemAntimicrobianoSghLido[]>;
  liberacao(c: C, id: number): Promise<LiberacaoSghLida | null>;
  liberacoesDos(c: C, itensPrescricao: readonly number[]): Promise<LiberacaoSghLida[]>;
  precaucao(c: C, id: number): Promise<PrecaucaoSghLida | null>;
  precaucoesAbertas(c: C): Promise<PrecaucaoSghLida[]>;
  precaucoesDa(c: C, reg: number): Promise<PrecaucaoSghLida[]>;
  observacoesMaos(
    c: C,
    de: string,
    ate: string,
  ): Promise<{ itens: ObservacaoMaosSghLida[]; cortada: boolean }>;
  consumoAlcool(
    c: C,
    competencia: string,
  ): Promise<{ unidade: number; setor: string | null; mililitros: number }[]>;
  surto(c: C, id: number): Promise<SurtoSghLido | null>;
  surtos(c: C, desde: string): Promise<SurtoSghLido[]>;
  // W0-04
  /** As sessões com as estornadas (a lista da tela; a adesão usa `observacoesMaos`, sem elas). */
  sessoesMaos(c: C, de: string, ate: string): Promise<{ itens: ObservacaoMaosSghLida[]; cortada: boolean }>;
  observacaoMaos(c: C, id: number): Promise<ObservacaoMaosSghLida | null>;
  versoes(c: C, tabela: TabelaCorrigivelQua, id: number): Promise<VersaoQuaLida[]>;
  competencias(c: C, competencias?: readonly string[]): Promise<CompetenciaQuaLida[]>;
  dependentes(c: C, tabela: string, id: number): Promise<DependentesQua[]>;
  /** W0-04 (M1): os checklists do bundle dos dispositivos. */
  bundles(c: C, dispositivos: readonly number[]): Promise<BundleSghLido[]>;
  /** Revisão do W0-04: um checklist pelo ID (correção e estorno). */
  bundle(c: C, id: number): Promise<BundleSghLido | null>;
  /** Revisão do W0-04: a busca do profissional responsável pela inserção e o nome pelo registro. */
  buscarProfissionais(c: C, texto: string): Promise<{ id: number; cod: number; nome: string }[]>;
  profissionaisPorRegistro(
    c: C,
    ids: readonly number[],
  ): Promise<{ id: number; cod: number; nome: string }[]>;
}

export const METODOS_PORTA_CCIH: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'unidades',
  'internados',
  'internacao',
  'altasDas',
  'vizinhos',
  'antimicrobianos',
  'antimicrobianoPrescrito',
  'vigencias',
  'consumoDispensado',
  'itensAntimicrobianos',
  'itemDoCadastro',
  'fichas',
  'culturas',
  'exame',
  'cirurgias',
  'cirurgia',
  'temperaturas',
  'censo',
  'tiposSurto',
  'dispositivo',
  'dispositivosDas',
  'dispositivosNoPeriodo',
  'iras',
  'irasDas',
  'irasNoPeriodo',
  'itensConfigurados',
  'liberacao',
  'liberacoesDos',
  'precaucao',
  'precaucoesAbertas',
  'precaucoesDa',
  'observacoesMaos',
  'consumoAlcool',
  'surto',
  'surtos',
  'sessoesMaos',
  'observacaoMaos',
  'versoes',
  'competencias',
  'dependentes',
  'bundles',
  'bundle',
  'buscarProfissionais',
  'profissionaisPorRegistro',
]);
