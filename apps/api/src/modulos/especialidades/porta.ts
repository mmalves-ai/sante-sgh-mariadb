// Porta das especialidades sob demanda e do lactário (M45, etapa 6; ficha, seções 4 a 7; DP-32): o que as telas de
// oftalmologia, oncologia, obstetrícia e lactário leem e gravam, independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `legado`: leituras READ ONLY pelos repositórios de @sgh/legado e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com internações e cadastros sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AjusteCicloSgh,
  AlteracaoHotSgh,
  AlteracaoHotSghLida,
  AlteracaoOrdemLactarioSgh,
  EventoOncoSgh,
  EventoOncoSghLido,
  CadastrosOftalmologiaLidos,
  CicloOncologicoSgh,
  CicloOncologicoSghLido,
  ExameOftalmologicoSgh,
  ExameOftalmologicoSghLido,
  InternacaoEspecialidadeLida,
  LinhaTrilha,
  OrdemLactarioAnterior,
  OrdemLactarioSgh,
  OrdemLactarioSghLida,
  PartogramaSgh,
  PrescricaoDoCicloLida,
  PrescricaoDoCicloSgh,
  PontoPartogramaSghLido,
  ProtocoloOncologicoSgh,
  ProtocoloOncologicoSghLido,
  RecemNascidoSgh,
  RecemNascidoSghLido,
  RevogacaoVersaoSgh,
  ValidacaoCicloSgh,
} from '@sgh/legado';
import type { AndamentoCiclo, CicloDependente, VersaoCicloAnterior } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ESPECIALIDADES = Symbol('PORTA_ESPECIALIDADES');

export type ContextoEspecialidades = ContextoPortaM18;

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorEspecialidades {
  registrarExame(x: SemHospital<ExameOftalmologicoSgh>): Promise<number>;
  publicarProtocolo(x: SemHospital<ProtocoloOncologicoSgh>): Promise<{ id: number; versao: number }>;
  registrarCiclo(x: SemHospital<CicloOncologicoSgh>): Promise<number>;
  validarCiclo(x: SemHospital<ValidacaoCicloSgh>): Promise<number>;
  vincularPrescricao(x: SemHospital<PrescricaoDoCicloSgh>): Promise<number>;
  registrarPartograma(x: SemHospital<PartogramaSgh>): Promise<number>;
  registrarRecemNascido(x: SemHospital<RecemNascidoSgh>): Promise<number>;
  registrarOrdem(x: SemHospital<OrdemLactarioSgh>): Promise<number>;
  conferirOrdem(x: { id: number; usuario: string }): Promise<number>;
  // W0-05: os eventos e as mudanças de estado do protocolo e do ciclo, e a alteração e o cancelamento da ordem.
  registrarEventoOnco(x: SemHospital<EventoOncoSgh>): Promise<number>;
  /** Reconta os ciclos na transação: mais ciclos em andamento que na ciência recusa (409). */
  revogarVersao(x: SemHospital<RevogacaoVersaoSgh>): Promise<number>;
  mudarAndamentoCiclo(x: {
    id: number;
    de: readonly AndamentoCiclo[];
    para: AndamentoCiclo;
  }): Promise<number>;
  /** Devolve a versão anterior relida na transação (com a linha travada). */
  ajustarCiclo(x: SemHospital<AjusteCicloSgh>): Promise<VersaoCicloAnterior>;
  desligarPrescricao(x: { ciclo: number; prescricao: number }): Promise<number>;
  /** Devolve a ordem como estava, relida na transação (com a linha travada). */
  alterarOrdem(x: SemHospital<AlteracaoOrdemLactarioSgh>): Promise<OrdemLactarioAnterior>;
  cancelarOrdem(x: { id: number; motivo: string; usuario: string }): Promise<number>;
  marcarEtiqueta(x: { id: number }): Promise<number>;
  registrarAlteracao(x: SemHospital<AlteracaoHotSgh>): Promise<number>;
}

export interface VinculoDoLogin {
  readonly vinculo: number;
  readonly cbo: string;
  readonly ativo: boolean;
}

export interface InternacaoDaBusca {
  readonly reg: number;
  readonly prontuario: number;
  readonly nome: string;
  readonly leito: { bloco: string; acomodacao: string; leito: string };
  readonly entrada: string;
}

export interface PortaEspecialidades extends PortaGravacaoM18<GravadorEspecialidades> {
  /** O relógio do banco ("AAAA-MM-DDTHH:MM" e "AAAA-MM-DD"). */
  relogio(c: ContextoEspecialidades): Promise<{ agora: string; hoje: string }>;
  vinculos(c: ContextoEspecialidades, login: string): Promise<VinculoDoLogin[]>;
  internacoes(
    c: ContextoEspecialidades,
    termo: string,
  ): Promise<{ itens: InternacaoDaBusca[]; cortada: boolean }>;
  internacao(c: ContextoEspecialidades, reg: number): Promise<InternacaoEspecialidadeLida | null>;
  cadastrosOftalmologia(c: ContextoEspecialidades): Promise<CadastrosOftalmologiaLidos>;
  tiposProtocolo(c: ContextoEspecialidades): Promise<{ codigo: number; nome: string }[]>;
  tiposParto(c: ContextoEspecialidades): Promise<{ codigo: number; nome: string }[]>;
  exames(c: ContextoEspecialidades, reg: number): Promise<ExameOftalmologicoSghLido[]>;
  protocolos(c: ContextoEspecialidades): Promise<ProtocoloOncologicoSghLido[]>;
  protocolo(
    c: ContextoEspecialidades,
    id: number,
  ): Promise<(ProtocoloOncologicoSghLido & { vigente: boolean }) | null>;
  ciclosDoPaciente(c: ContextoEspecialidades, paciente: number): Promise<CicloOncologicoSghLido[]>;
  ciclo(c: ContextoEspecialidades, id: number): Promise<CicloOncologicoSghLido | null>;
  ciclosAValidar(c: ContextoEspecialidades): Promise<CicloOncologicoSghLido[]>;
  /** As prescrições gerais da internação que valem no dia (para ligar ao ciclo). */
  prescricoesDoDia(
    c: ContextoEspecialidades,
    reg: number,
    paciente: number,
    dia: string,
  ): Promise<PrescricaoDoCicloLida[]>;
  partograma(c: ContextoEspecialidades, reg: number): Promise<PontoPartogramaSghLido[]>;
  recemNascidos(c: ContextoEspecialidades, reg: number): Promise<RecemNascidoSghLido[]>;
  ordensDoDia(c: ContextoEspecialidades, dia: string): Promise<OrdemLactarioSghLida[]>;
  ordem(c: ContextoEspecialidades, id: number): Promise<OrdemLactarioSghLida | null>;
  // ── W0-05 ──
  eventosProtocolos(c: ContextoEspecialidades): Promise<EventoOncoSghLido[]>;
  eventosCiclos(c: ContextoEspecialidades, ciclos: readonly number[]): Promise<EventoOncoSghLido[]>;
  ciclosDaVersao(
    c: ContextoEspecialidades,
    protocolo: number,
  ): Promise<{ total: number; emAndamento: number; cortada: boolean; itens: CicloDependente[] }>;
  alteracoesOrdens(c: ContextoEspecialidades, ids: readonly number[]): Promise<AlteracaoHotSghLida[]>;
}

export const METODOS_PORTA_ESPECIALIDADES: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'vinculos',
  'internacoes',
  'internacao',
  'cadastrosOftalmologia',
  'tiposProtocolo',
  'tiposParto',
  'exames',
  'protocolos',
  'protocolo',
  'ciclosDoPaciente',
  'ciclo',
  'ciclosAValidar',
  'prescricoesDoDia',
  'partograma',
  'recemNascidos',
  'ordensDoDia',
  'ordem',
  'eventosProtocolos',
  'eventosCiclos',
  'ciclosDaVersao',
  'alteracoesOrdens',
]);

export type { LinhaTrilha };
