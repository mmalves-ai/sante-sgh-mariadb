// Porta da telemedicina (M50, etapa 4): a teleconsulta e a teleinterconsulta SÓ do novo (script 0954), com a
// SGH_TRILHA na mesma transação. O atendimento da teleconsulta não passa por aqui: vai pela porta do atendimento (M20),
// pelo executor, que liga a ficha à teleconsulta na mesma transação; a marcação, pela porta da agenda (M17).
//   - `legado`: o núcleo (READ ONLY nas leituras; transação SGH_ nas gravações);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type {
  FichaDoHistoricoClinico,
  LinhaTrilha,
  NovaTeleconsulta,
  NovaTeleinterconsulta,
  TeleconsultaLida,
} from '@sgh/legado';

export const PORTA_TELEMEDICINA = Symbol('PORTA_TELEMEDICINA');

export interface ContextoTelemedicina {
  readonly rede: string;
  readonly hospital: string;
}

/** As gravações (o estabelecimento vem do contexto). */
export interface GravadorTelemedicina {
  agendar(t: Omit<NovaTeleconsulta, 'hospital'>): Promise<{ id: number }>;
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
      provedor: 'simulado' | 'provedor';
      sala: string;
      declaracao: string;
      medico: string;
      vinculo: number;
      cienteAlerta: boolean;
    },
  ): Promise<{ versao: number }>;
  /** Só a memória: no banco, a receita do M20 liga a ficha na mesma transação (registrarSgh). */
  vincularAtendimento(d: {
    id: number;
    marcacao: number;
    cabecalho: string;
    reg: number;
    usuario: string;
    /** O vínculo de quem abre a ficha: tem de ser o do médico que abriu a sala. */
    profissional: number;
  }): Promise<void>;
  encerrar(id: number, versao: number, d: { motivo: string; por: string }): Promise<{ versao: number }>;
  cancelarDaMarcacao(marcacao: number, por: string): Promise<number>;
  mover(d: {
    de: number;
    para: number;
    agenda: number;
    nomeAgenda: string;
    crmAgenda: number;
    data: string;
    hora: string;
    por: string;
  }): Promise<number>;
  solicitarInterconsulta(t: Omit<NovaTeleinterconsulta, 'hospital'>): Promise<{ id: number }>;
  abrirSalaInterconsulta(
    id: number,
    versao: number,
    d: { provedor: 'simulado' | 'provedor'; sala: string; por: string },
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

export type TrilhaTelemedicina<T> = LinhaTrilha | ((r: T) => LinhaTrilha | null) | null;

export interface PortaTelemedicina {
  readonly destino: 'legado' | 'memoria';
  gravar<T>(
    c: ContextoTelemedicina,
    trilha: TrilhaTelemedicina<T>,
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T>;
  porId(c: ContextoTelemedicina, id: number): Promise<TeleconsultaLida | null>;
  daMarcacao(c: ContextoTelemedicina, marcacao: number): Promise<TeleconsultaLida | null>;
  doPaciente(c: ContextoTelemedicina, paciente: number): Promise<TeleconsultaLida[]>;
  doDia(
    c: ContextoTelemedicina,
    f: { data: string; crm: number | null; teto: number },
  ): Promise<{ itens: TeleconsultaLida[]; truncado: boolean }>;
  doCabecalho(c: ContextoTelemedicina, cabecalho: string): Promise<TeleconsultaLida | null>;
  regsDeTeleconsulta(c: ContextoTelemedicina, regs: readonly number[]): Promise<Set<number>>;
  interconsultas(
    c: ContextoTelemedicina,
    f: { convidado: number | null; solicitante: string; desde: string; teto: number },
  ): Promise<{ itens: TeleconsultaLida[]; truncado: boolean }>;
  /** O histórico clínico do legado para o alerta do crônico (só leitura). */
  historicoClinico(c: ContextoTelemedicina, paciente: number): Promise<FichaDoHistoricoClinico[]>;
}

export const METODOS_PORTA_TELEMEDICINA: ReadonlySet<string> = new Set([
  'gravar',
  'porId',
  'daMarcacao',
  'doPaciente',
  'doDia',
  'doCabecalho',
  'regsDeTeleconsulta',
  'interconsultas',
  'historicoClinico',
]);
