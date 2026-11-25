// Porta das especialidades sob demanda e do lactário (M45, etapa 6; ficha, seções 4 a 7; DP-32): o que as telas de
// oftalmologia, oncologia, obstetrícia e lactário leem e gravam, independente de onde (a API não escreve SQL; fronteira
// Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura; gravações pela
//     operação do Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com internações e cadastros sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { LinhaTrilha } from '@sgh/nucleo';
import type { AndamentoCiclo, CicloDependente, VersaoCicloAnterior } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type {
  AjusteCiclo,
  AlteracaoLactarioRegistrada,
  AlteracaoOrdemLactario,
  CadastrosOftalmologia,
  CicloOncologicoRegistrado,
  EventoOncologicoRegistrado,
  ExameOftalmologicoRegistrado,
  InternacaoEspecialidadeLida,
  NovaAlteracaoLactario,
  NovaOrdemLactario,
  NovoCicloOncologico,
  NovoEventoOncologico,
  NovoExameOftalmologico,
  NovoPontoPartograma,
  NovoProtocoloOncologico,
  NovoRecemNascido,
  OrdemLactarioAnterior,
  OrdemLactarioRegistrada,
  PontoPartograma,
  PrescricaoDoCiclo,
  ProtocoloOncologicoRegistrado,
  RecemNascidoRegistrado,
  RevogacaoVersaoProtocolo,
  ValidacaoCiclo,
  VinculoPrescricaoCiclo,
} from './tipos.js';

export const PORTA_ESPECIALIDADES = Symbol('PORTA_ESPECIALIDADES');

export type ContextoEspecialidades = ContextoPortaM18;

/** Gravações das telas, numa transação com a linha da trilha junto. */
export interface GravadorEspecialidades {
  registrarExame(x: NovoExameOftalmologico): Promise<number>;
  publicarProtocolo(x: NovoProtocoloOncologico): Promise<{ id: number; versao: number }>;
  registrarCiclo(x: NovoCicloOncologico): Promise<number>;
  validarCiclo(x: ValidacaoCiclo): Promise<number>;
  vincularPrescricao(x: VinculoPrescricaoCiclo): Promise<number>;
  registrarPartograma(x: NovoPontoPartograma): Promise<number>;
  registrarRecemNascido(x: NovoRecemNascido): Promise<number>;
  registrarOrdem(x: NovaOrdemLactario): Promise<number>;
  conferirOrdem(x: { id: number; usuario: string }): Promise<number>;
  // Os eventos e as mudanças de estado do protocolo e do ciclo, e a alteração e o cancelamento da ordem.
  registrarEventoOnco(x: NovoEventoOncologico): Promise<number>;
  /** Reconta os ciclos na transação: mais ciclos em andamento que na ciência recusa (409). */
  revogarVersao(x: RevogacaoVersaoProtocolo): Promise<number>;
  mudarAndamentoCiclo(x: {
    id: number;
    de: readonly AndamentoCiclo[];
    para: AndamentoCiclo;
  }): Promise<number>;
  /** Devolve a versão anterior relida na transação (com a linha travada). */
  ajustarCiclo(x: AjusteCiclo): Promise<VersaoCicloAnterior>;
  /** O motivo fica na ligação desfeita (e no evento do ciclo). */
  desligarPrescricao(x: { ciclo: number; prescricao: number; motivo?: string }): Promise<number>;
  /** Devolve a ordem como estava, relida na transação (com a linha travada). */
  alterarOrdem(x: AlteracaoOrdemLactario): Promise<OrdemLactarioAnterior>;
  cancelarOrdem(x: { id: number; motivo: string; usuario: string }): Promise<number>;
  marcarEtiqueta(x: { id: number }): Promise<number>;
  registrarAlteracao(x: NovaAlteracaoLactario): Promise<number>;
}

export interface VinculoDoLogin {
  /** Id do vínculo profissional (profissional). */
  readonly vinculo: number;
  readonly cbo: string;
  readonly ativo: boolean;
}

export interface InternacaoDaBusca {
  /** Id da internação. */
  readonly internacao: number;
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
  internacao(c: ContextoEspecialidades, internacao: number): Promise<InternacaoEspecialidadeLida | null>;
  cadastrosOftalmologia(c: ContextoEspecialidades): Promise<CadastrosOftalmologia>;
  tiposProtocolo(c: ContextoEspecialidades): Promise<{ codigo: number; nome: string }[]>;
  tiposParto(c: ContextoEspecialidades): Promise<{ codigo: number; nome: string }[]>;
  exames(c: ContextoEspecialidades, internacao: number): Promise<ExameOftalmologicoRegistrado[]>;
  protocolos(c: ContextoEspecialidades): Promise<ProtocoloOncologicoRegistrado[]>;
  protocolo(
    c: ContextoEspecialidades,
    id: number,
  ): Promise<(ProtocoloOncologicoRegistrado & { vigente: boolean }) | null>;
  ciclosDoPaciente(c: ContextoEspecialidades, paciente: number): Promise<CicloOncologicoRegistrado[]>;
  ciclo(c: ContextoEspecialidades, id: number): Promise<CicloOncologicoRegistrado | null>;
  ciclosAValidar(c: ContextoEspecialidades): Promise<CicloOncologicoRegistrado[]>;
  /** As prescrições gerais da internação que valem no dia (para ligar ao ciclo). */
  prescricoesDoDia(
    c: ContextoEspecialidades,
    internacao: number,
    paciente: number,
    dia: string,
  ): Promise<PrescricaoDoCiclo[]>;
  /**
   * Os registros do partograma, com os alertas de cada um como na gravação: os do ponto (BCF, contrações, PA, febre,
   * mecônio) e os das linhas de alerta e de ação sobre os registros anteriores, com a dilatação do início da fase
   * ativa do parâmetro do estabelecimento (faseAtivaCm; padrão FASE_ATIVA_CM_PADRAO).
   */
  partograma(c: ContextoEspecialidades, internacao: number, faseAtivaCm?: number): Promise<PontoPartograma[]>;
  recemNascidos(c: ContextoEspecialidades, internacao: number): Promise<RecemNascidoRegistrado[]>;
  ordensDoDia(c: ContextoEspecialidades, dia: string): Promise<OrdemLactarioRegistrada[]>;
  ordem(c: ContextoEspecialidades, id: number): Promise<OrdemLactarioRegistrada | null>;
  // ── Eventos, versões e alterações ──
  eventosProtocolos(c: ContextoEspecialidades): Promise<EventoOncologicoRegistrado[]>;
  eventosCiclos(c: ContextoEspecialidades, ciclos: readonly number[]): Promise<EventoOncologicoRegistrado[]>;
  ciclosDaVersao(
    c: ContextoEspecialidades,
    protocolo: number,
  ): Promise<{ total: number; emAndamento: number; cortada: boolean; itens: CicloDependente[] }>;
  alteracoesOrdens(c: ContextoEspecialidades, ids: readonly number[]): Promise<AlteracaoLactarioRegistrada[]>;
}

/** A dilatação (cm) do início da fase ativa quando o parâmetro do estabelecimento falta. */
export const FASE_ATIVA_CM_PADRAO = 4;

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
