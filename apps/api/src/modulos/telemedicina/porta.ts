// Porta da telemedicina: a teleconsulta e a teleinterconsulta (tabela `teleconsulta`, com os participantes em
// `teleconsulta_participante`), com a linha da trilha na mesma transação. O atendimento da teleconsulta não passa por
// aqui: vai pela porta do atendimento, pelo executor, que liga o atendimento à teleconsulta na mesma transação.
//   - `banco`: a porta própria sobre o MariaDB (@sgh/nucleo);
//   - `memoria`: a sessão sintética de dev/ci e os testes, com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
// Melhoria: tipos de negócio (ids numéricos, datas ISO, situação do contrato); o profissional é identificado pelo id
// do vínculo, nunca pelo login truncado; a lista "minhas" filtra pelo profissional, não pelo número do conselho.
import type { MotivoEncerramentoTeleconsulta, SituacaoTeleconsulta } from '@sgh/contratos';
import type { DestinoPorta, TrilhaDaGravacao } from '../exames/public-api.js';

export const PORTA_TELEMEDICINA = Symbol('PORTA_TELEMEDICINA');

export type ModalidadeTele = 'teleconsulta' | 'teleinterconsulta';
export type ProvedorSala = 'simulado' | 'provedor';

/** Recusa da porta: versão desatualizada (ou a situação mudou), regra de situação ou registro inexistente. */
export class ErroTelemedicina extends Error {
  override readonly name = 'ErroTelemedicina';
  constructor(
    readonly codigo: 'versao-desatualizada' | 'situacao' | 'nao-encontrado',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * O contexto de quem grava ou lê: a sessão interna (cliente, estabelecimento, usuário e correlação) ou a do portal
 * (estabelecimento pelo código). A porta própria resolve o banco pelo cliente, ou pelo código do estabelecimento.
 */
export interface ContextoTelemedicina {
  readonly hospital?: string;
  readonly rede?: string;
  readonly cliente?: string;
  readonly estabelecimento?: number | null;
  readonly usuario?: number | null;
  readonly correlacao?: string;
  /** Chave de idempotência de quem pede (a repetição devolve o resultado anterior, sem gravar de novo). */
  readonly chaveIdempotencia?: string;
}

/** A teleconsulta (ou teleinterconsulta) lida. `hora` é a hora do dia "HH:MM" no fuso do estabelecimento, como no contrato da tela e no domínio. */
export interface Teleconsulta {
  readonly id: number;
  readonly modalidade: ModalidadeTele;
  readonly situacao: SituacaoTeleconsulta;
  readonly marcacao: number | null;
  /** A marcação ainda vale na agenda (null fora da teleconsulta ou sem marcação). */
  readonly marcacaoVigente: boolean | null;
  readonly nomeAgenda: string;
  /** Profissional da agenda (antes da sala aberta). */
  readonly profissionalAgenda: number | null;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly termo: { readonly versao: string; readonly aceitoEm: string } | null;
  readonly local: { readonly uf: string; readonly municipio: string; readonly tipo: string } | null;
  readonly esperaDesde: string | null;
  readonly provedor: ProvedorSala | null;
  readonly sala: string | null;
  readonly salaAbertaEm: string | null;
  readonly declaracao: string | null;
  /** Login do médico que abriu a sala (teleconsulta) ou de quem pediu (teleinterconsulta). */
  readonly medico: string | null;
  /** Vínculo do médico da sala (teleconsulta) ou de quem pediu (teleinterconsulta). */
  readonly vinculoMedico: number | null;
  readonly pacienteEntrouEm: string | null;
  readonly iniciadaEm: string | null;
  readonly encerradaEm: string | null;
  readonly motivoEncerramento: MotivoEncerramentoTeleconsulta | null;
  readonly convidado: number | null;
  readonly nomeConvidado: string | null;
  readonly motivoInterconsulta: string | null;
  readonly parecer: string | null;
  readonly respondidaEm: string | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
  /** Login de quem criou o registro ('' quando foi o portal). */
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly versao: number;
}

/** Um atendimento do histórico do paciente, para o alerta do crônico. */
export interface AtendimentoDoHistoricoClinico {
  readonly atendimento: number;
  readonly data: string;
  readonly cid: string | null;
  readonly laboratorio: boolean;
  readonly teleconsulta: boolean;
}

export interface NovaTeleconsulta {
  readonly marcacao: number | null;
  readonly agenda: number | null;
  readonly nomeAgenda: string;
  /** Profissional que atende; null: o executante da marcação. */
  readonly profissional: number | null;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly por: string;
}

export interface NovaTeleinterconsulta {
  readonly atendimento: number;
  readonly paciente: number;
  readonly data: string;
  readonly hora: string;
  readonly convidado: number;
  readonly nomeConvidado: string;
  readonly motivo: string;
  readonly solicitante: string;
  readonly vinculoSolicitante: number;
}

/** As gravações (o estabelecimento vem do contexto). */
export interface GravadorTelemedicina {
  agendar(t: NovaTeleconsulta): Promise<{ id: number }>;
  entrarSalaEspera(
    id: number,
    versao: number,
    d: { termo: string; local: { uf: string; municipio: string; tipo: string }; por: string },
  ): Promise<{ versao: number }>;
  registrarEntradaPaciente(id: number): Promise<boolean>;
  abrirSala(
    id: number,
    versao: number,
    d: {
      provedor: ProvedorSala;
      sala: string;
      declaracao: string;
      medico: string;
      vinculo: number;
      cienteAlerta: boolean;
    },
  ): Promise<{ versao: number }>;
  /**
   * Põe a teleconsulta em andamento, ligada ao atendimento aberto pelo executor do atendimento (só o médico da sala).
   * Reentrante: já em andamento com o mesmo atendimento, devolve false sem gravar; true quando ligou agora.
   */
  vincularAtendimento(d: { id: number; atendimento: number; profissional: number }): Promise<boolean>;
  encerrar(
    id: number,
    versao: number,
    d: { motivo: MotivoEncerramentoTeleconsulta; por: string; vinculo: number | null },
  ): Promise<{ versao: number }>;
  cancelarDaMarcacao(marcacao: number, por: string): Promise<number>;
  mover(d: {
    de: number;
    para: number;
    agenda: number | null;
    nomeAgenda: string;
    data: string;
    hora: string;
    por: string;
  }): Promise<number>;
  solicitarInterconsulta(t: NovaTeleinterconsulta): Promise<{ id: number }>;
  abrirSalaInterconsulta(
    id: number,
    versao: number,
    d: { provedor: ProvedorSala; sala: string; por: string },
  ): Promise<{ versao: number }>;
  responderInterconsulta(
    id: number,
    versao: number,
    d: { parecer: string; vinculo: number; por: string },
  ): Promise<{ versao: number }>;
  cancelarInterconsulta(
    id: number,
    versao: number,
    d: { motivo: string; por: string },
  ): Promise<{ versao: number }>;
}

export type TrilhaTelemedicina<T> = TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao | null) | null;

export interface PortaTelemedicina {
  readonly destino: DestinoPorta;
  gravar<T>(
    c: ContextoTelemedicina,
    trilha: TrilhaTelemedicina<T>,
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T>;
  porId(c: ContextoTelemedicina, id: number): Promise<Teleconsulta | null>;
  daMarcacao(c: ContextoTelemedicina, marcacao: number): Promise<Teleconsulta | null>;
  doPaciente(c: ContextoTelemedicina, paciente: number): Promise<Teleconsulta[]>;
  doDia(
    c: ContextoTelemedicina,
    f: { data: string; profissional: number | null; teto: number },
  ): Promise<{ itens: Teleconsulta[]; truncado: boolean }>;
  /** A teleconsulta em andamento ou encerrada ligada ao atendimento (a marca nos documentos). */
  doAtendimento(c: ContextoTelemedicina, atendimento: number): Promise<Teleconsulta | null>;
  interconsultas(
    c: ContextoTelemedicina,
    f: { convidado: number | null; solicitante: string; desde: string; teto: number },
  ): Promise<{ itens: Teleconsulta[]; truncado: boolean }>;
  /** O histórico de atendimentos do paciente para o alerta do crônico (só leitura). */
  historicoClinico(c: ContextoTelemedicina, paciente: number): Promise<AtendimentoDoHistoricoClinico[]>;
}

export const METODOS_PORTA_TELEMEDICINA: ReadonlySet<string> = new Set([
  'gravar',
  'porId',
  'daMarcacao',
  'doPaciente',
  'doDia',
  'doAtendimento',
  'interconsultas',
  'historicoClinico',
]);
