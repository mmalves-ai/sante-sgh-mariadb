// Porta do SESMT, fatia F5 (M52.5; ficha, seções 4 a 6): o que as telas do SESMT leem e gravam, independente de onde
// (a API não escreve SQL; fronteira Nx). O colaborador vem da porta da gestão de pessoas (SGH_PES_VINCULO); aqui ficam o
// prontuário ocupacional, as vacinas, os acidentes, o mapa de riscos, as entregas de EPI e os domínios do eSocial:
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os domínios sintéticos; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Regra 16: nenhuma leitura do PEP passa por aqui, e o PEP não lê nada daqui.
import type {
  AcidenteLido,
  AnulacaoAcidenteSgh,
  CancelamentoEpiSgh,
  CorrecaoPesLida,
  RetificacaoAcidenteSgh,
  DominiosSesmt,
  EmissaoCatSgh,
  EncerramentoAcidenteSgh,
  FiltroAcidentesSgh,
  FiltroRiscosSgh,
  LinhaRiscoLidaSgh,
  NovaLinhaRiscoSgh,
  NovaVacinaSgh,
  NovoAcidenteSgh,
  NovoAsoSgh,
  NovoExameOcupacionalSgh,
  NovoRegistroEpiSgh,
  OcupacionalLido,
  OpcaoDominioSesmtTexto,
  ProfilaxiaSgh,
  RegistroEpiLido,
  ResultadoSorologiaSgh,
  ResumoSesmtSgh,
  SorologiaLida,
  VacinaLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_SESMT = Symbol('PORTA_SESMT');

export type ContextoSesmt = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ da F5 numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorSesmt {
  ocupacional(vinculo: number): Promise<OcupacionalLido[]>;
  vacinas(vinculo: number): Promise<VacinaLida[]>;
  acidente(id: number): Promise<AcidenteLido | null>;
  sorologias(acidente: number): Promise<SorologiaLida[]>;
  registroEpi(id: number): Promise<RegistroEpiLido | null>;
  incluirAso(a: SemHospital<NovoAsoSgh>): Promise<number>;
  incluirExame(x: SemHospital<NovoExameOcupacionalSgh>): Promise<number>;
  incluirVacina(v: SemHospital<NovaVacinaSgh>): Promise<number>;
  incluirAcidente(a: SemHospital<NovoAcidenteSgh>): Promise<number>;
  incluirSorologia(x: { acidente: number; marco: string; prevista: string }): Promise<number>;
  atualizarProfilaxia(x: SemHospital<ProfilaxiaSgh>): Promise<void>;
  registrarSorologia(x: SemHospital<ResultadoSorologiaSgh>): Promise<number>;
  emitirCat(x: SemHospital<EmissaoCatSgh>): Promise<void>;
  encerrarAcidente(x: SemHospital<EncerramentoAcidenteSgh>): Promise<void>;
  incluirLinhaRisco(x: SemHospital<NovaLinhaRiscoSgh>): Promise<number>;
  encerrarLinhaRisco(x: { id: number; fim: string; motivo: string; por: string }): Promise<void>;
  incluirRegistroEpi(x: SemHospital<NovoRegistroEpiSgh>): Promise<number>;
  assinarEntregaEpi(x: { id: number; por: string }): Promise<void>;
  // W0-06 (1063): retificação e anulação do acidente, cancelamento da entrega, com o valor anterior na SGH_PES_CORRECAO.
  retificarAcidente(x: SemHospital<RetificacaoAcidenteSgh>): Promise<void>;
  anularAcidente(x: SemHospital<AnulacaoAcidenteSgh>): Promise<void>;
  cancelarEntregaEpi(x: SemHospital<CancelamentoEpiSgh>): Promise<void>;
  registrarCorrecao(x: {
    tabela: string;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
}

export interface PortaSesmt extends PortaGravacaoM18<GravadorSesmt> {
  relogio(c: ContextoSesmt): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoSesmt): Promise<DominiosSesmt>;
  fatoresRisco(c: ContextoSesmt, termo: string): Promise<OpcaoDominioSesmtTexto[]>;
  fatoresPorCodigo(c: ContextoSesmt, codigos: readonly string[]): Promise<Map<string, string>>;
  ocupacional(c: ContextoSesmt, vinculo: number): Promise<OcupacionalLido[]>;
  vacinas(c: ContextoSesmt, vinculo: number): Promise<VacinaLida[]>;
  acidente(c: ContextoSesmt, id: number): Promise<AcidenteLido | null>;
  listarAcidentes(
    c: ContextoSesmt,
    f: FiltroAcidentesSgh,
  ): Promise<{ itens: AcidenteLido[]; depois: number | null }>;
  sorologias(c: ContextoSesmt, acidentes: readonly number[]): Promise<SorologiaLida[]>;
  mapaRiscos(c: ContextoSesmt, f: FiltroRiscosSgh): Promise<LinhaRiscoLidaSgh[]>;
  registrosEpi(c: ContextoSesmt, vinculo: number): Promise<RegistroEpiLido[]>;
  registroEpi(c: ContextoSesmt, id: number): Promise<RegistroEpiLido | null>;
  resumo(c: ContextoSesmt, ano: number): Promise<ResumoSesmtSgh>;
  /** W0-06: o histórico de retificações (o valor anterior e o novo) dos registros de uma tabela do SESMT. */
  correcoes(c: ContextoSesmt, tabela: string, registros: readonly number[]): Promise<CorrecaoPesLida[]>;
}

export const METODOS_PORTA_SESMT: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'dominios',
  'fatoresRisco',
  'fatoresPorCodigo',
  'ocupacional',
  'vacinas',
  'acidente',
  'listarAcidentes',
  'sorologias',
  'mapaRiscos',
  'registrosEpi',
  'registroEpi',
  'resumo',
  'correcoes',
]);
