// Porta da telemedicina EM MEMÓRIA: a sessão sintética de dev/ci e os testes da API. As mesmas recusas do banco
// (versão desatualizada, a situação conferida em cada mudança, a teleconsulta viva única por marcação, a concluída só
// em andamento, o médico da sala, o parecer só do convidado, o cancelamento só de quem pediu). Nada vai a banco.
// A semente: a paciente sintética 1003 com uma teleconsulta HOJE, na meia hora corrente (a sala de espera aberta), e o
// histórico sintético de hipertensa sem consulta presencial há 200 dias (o alerta do crônico aparece).
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type AtendimentoDoHistoricoClinico,
  type ContextoTelemedicina,
  ErroTelemedicina,
  type GravadorTelemedicina,
  type PortaTelemedicina,
  type Teleconsulta,
  type TrilhaTelemedicina,
} from './porta.js';

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Linha = Mutavel<Omit<Teleconsulta, 'marcacaoVigente'>>;

interface Estado {
  linhas: Linha[];
  seq: number;
}

/** A marcação sintética da teleconsulta da semente (a abertura do atendimento em memória a conhece). */
export interface MarcacaoSinteticaTele {
  readonly id: number;
  readonly data: string;
  readonly hora: string;
  readonly paciente: number;
  readonly convenio: number;
  readonly crm: number;
  readonly especialidade: number;
  readonly unidade: number;
  readonly cdc: number;
  readonly procedimento: number;
}

const versaoVelha = (o: string) =>
  new ErroTelemedicina(
    'versao-desatualizada',
    `A teleconsulta foi alterada por outra pessoa ou mudou de situação (${o}); recarregue.`,
  );
const VIVAS: ReadonlySet<string> = new Set(['agendada', 'aguardando', 'sala-aberta', 'em-andamento']);

export const PACIENTE_SEMENTE_TELE = 1003;
export const MARCACAO_SEMENTE_TELE = 880_101;
export const VINCULO_SEMENTE_TELE = 7101;

function relogio(agora: Date): { hoje: string; hora: string; carimbo: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  const hoje = `${v('year')}-${v('month')}-${v('day')}`;
  return {
    hoje,
    hora: `${v('hour')}:${v('minute')}`,
    carimbo: `${hoje}T${v('hour')}:${v('minute')}:${v('second')}`,
  };
}

const dias = (hoje: string, n: number) =>
  new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const chaveDe = (c: ContextoTelemedicina) => c.hospital ?? `est-${c.estabelecimento ?? 0}`;

export class PortaTelemedicinaMemoria implements PortaTelemedicina {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** As linhas de trilha das gravações (para os testes). */
  readonly trilhas: TrilhaDaGravacao[] = [];

  constructor(
    private readonly agora: () => Date = () => new Date(),
    private readonly opcoes: {
      /** A semente da sessão sintética (desligada nos testes que montam o próprio estado). */
      readonly semente?: boolean;
      /** Avisa a abertura do atendimento em memória da marcação sintética. */
      readonly aoSemear?: (hospital: string, m: MarcacaoSinteticaTele) => void;
    } = {},
  ) {}

  private e(c: ContextoTelemedicina): Estado {
    const k = chaveDe(c);
    let s = this.estados.get(k);
    if (!s) {
      s = { linhas: [], seq: 90 };
      if (this.opcoes.semente) this.semear(k, s);
      this.estados.set(k, s);
    }
    return s;
  }

  private semear(hospital: string, s: Estado): void {
    const r = relogio(this.agora());
    // A meia hora corrente: a sala de espera já está aberta (abre 30 minutos antes, fecha 2 horas depois).
    const hora = `${r.hora.slice(0, 2)}:${Number(r.hora.slice(3, 5)) >= 30 ? '30' : '00'}`;
    const m: MarcacaoSinteticaTele = {
      id: MARCACAO_SEMENTE_TELE,
      data: r.hoje,
      hora,
      paciente: PACIENTE_SEMENTE_TELE,
      convenio: 306,
      crm: 52001,
      especialidade: 15,
      unidade: 1,
      cdc: 300600,
      procedimento: 10101012,
    };
    this.opcoes.aoSemear?.(hospital, m);
    s.linhas.push(
      this.nova(++s.seq, {
        modalidade: 'teleconsulta',
        situacao: 'agendada',
        marcacao: m.id,
        nomeAgenda: 'CARDIOLOGIA - ANA MEDICA SINTETICO',
        profissionalAgenda: VINCULO_SEMENTE_TELE,
        data: m.data,
        hora: m.hora,
        paciente: m.paciente,
        criadoPor: '',
      }),
    );
  }

  private nova(
    id: number,
    d: Partial<Linha> & Pick<Linha, 'modalidade' | 'situacao' | 'data' | 'hora' | 'paciente' | 'criadoPor'>,
  ): Linha {
    return {
      id,
      marcacao: null,
      nomeAgenda: '',
      profissionalAgenda: null,
      atendimento: null,
      termo: null,
      local: null,
      esperaDesde: null,
      provedor: null,
      sala: null,
      salaAbertaEm: null,
      declaracao: null,
      medico: null,
      vinculoMedico: null,
      pacienteEntrouEm: null,
      iniciadaEm: null,
      encerradaEm: null,
      motivoEncerramento: null,
      convidado: null,
      nomeConvidado: null,
      motivoInterconsulta: null,
      parecer: null,
      respondidaEm: null,
      canceladaEm: null,
      motivoCancelamento: null,
      criadoEm: relogio(this.agora()).carimbo,
      versao: 1,
      ...d,
    };
  }

  async gravar<T>(
    c: ContextoTelemedicina,
    trilha: TrilhaTelemedicina<T>,
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ): Promise<T> {
    // Transação: o estado é copiado e só volta se a função terminar sem erro.
    const copia = structuredClone(this.e(c));
    const r = await fn(this.gravador(copia));
    const linha = typeof trilha === 'function' ? trilha(r) : trilha;
    if (linha) this.trilhas.push(linha);
    this.estados.set(chaveDe(c), copia);
    return r;
  }

  private gravador(s: Estado): GravadorTelemedicina {
    const agora = () => relogio(this.agora()).carimbo;
    const achar = (id: number, versao: number | null, o: string, ok: (l: Linha) => boolean): Linha => {
      const l = s.linhas.find((x) => x.id === id);
      if (!l || (versao !== null && l.versao !== versao) || !ok(l)) throw versaoVelha(o);
      return l;
    };
    const mudou = (l: Linha) => {
      l.versao += 1;
    };
    return {
      agendar: async (t) => {
        if (
          t.marcacao !== null &&
          s.linhas.some(
            (x) => x.modalidade === 'teleconsulta' && x.marcacao === t.marcacao && x.situacao !== 'cancelada',
          )
        )
          throw new ErroTelemedicina('situacao', 'Esta marcação já tem teleconsulta.');
        const l = this.nova(++s.seq, {
          modalidade: 'teleconsulta',
          situacao: 'agendada',
          marcacao: t.marcacao,
          nomeAgenda: t.nomeAgenda.slice(0, 70),
          profissionalAgenda: t.profissional,
          data: t.data,
          hora: t.hora,
          paciente: t.paciente,
          criadoPor: t.por,
        });
        s.linhas.push(l);
        return { id: l.id };
      },
      entrarSalaEspera: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'sala de espera',
          (x) =>
            x.modalidade === 'teleconsulta' && ['agendada', 'aguardando', 'sala-aberta'].includes(x.situacao),
        );
        l.termo = { versao: d.termo, aceitoEm: agora() };
        l.local = { ...d.local };
        l.esperaDesde ??= agora();
        if (l.situacao === 'agendada') l.situacao = 'aguardando';
        mudou(l);
        return { versao: l.versao };
      },
      registrarEntradaPaciente: async (id) => {
        const l = s.linhas.find((x) => x.id === id);
        if (!l || l.pacienteEntrouEm || !['sala-aberta', 'em-andamento'].includes(l.situacao)) return false;
        l.pacienteEntrouEm = agora();
        return true;
      },
      abrirSala: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'abertura da sala',
          (x) => x.modalidade === 'teleconsulta' && x.situacao === 'aguardando' && !!x.termo && !!x.local,
        );
        Object.assign(l, {
          situacao: 'sala-aberta',
          provedor: d.provedor,
          sala: d.sala,
          salaAbertaEm: agora(),
          declaracao: d.declaracao,
          medico: d.medico,
          vinculoMedico: d.vinculo,
        });
        mudou(l);
        return { versao: l.versao };
      },
      vincularAtendimento: async (d) => {
        const l = s.linhas.find((x) => x.id === d.id && x.modalidade === 'teleconsulta');
        if (!l) throw new ErroTelemedicina('nao-encontrado', 'Teleconsulta não encontrada.');
        if (l.vinculoMedico !== d.profissional)
          throw new ErroTelemedicina(
            'situacao',
            'A sala desta teleconsulta foi aberta por outro profissional: o atendimento não foi ligado.',
          );
        if (l.atendimento !== null && l.atendimento !== d.atendimento)
          throw new ErroTelemedicina('situacao', 'A teleconsulta já está ligada a outro atendimento.');
        if (l.situacao === 'em-andamento') return false;
        if (l.situacao !== 'sala-aberta')
          throw new ErroTelemedicina(
            'situacao',
            'A teleconsulta não está com a sala aberta: o atendimento não foi ligado.',
          );
        Object.assign(l, { situacao: 'em-andamento', atendimento: d.atendimento, iniciadaEm: agora() });
        mudou(l);
        return true;
      },
      encerrar: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'encerramento',
          (x) =>
            x.modalidade === 'teleconsulta' &&
            VIVAS.has(x.situacao) &&
            (d.motivo !== 'concluida' || x.situacao === 'em-andamento') &&
            (!['sala-aberta', 'em-andamento'].includes(x.situacao) || x.vinculoMedico === d.vinculo),
        );
        Object.assign(l, { situacao: 'encerrada', encerradaEm: agora(), motivoEncerramento: d.motivo });
        mudou(l);
        return { versao: l.versao };
      },
      cancelarDaMarcacao: async (marcacao) => {
        let n = 0;
        for (const l of s.linhas)
          if (
            l.modalidade === 'teleconsulta' &&
            l.marcacao === marcacao &&
            ['agendada', 'aguardando', 'sala-aberta'].includes(l.situacao)
          ) {
            Object.assign(l, {
              situacao: 'cancelada',
              canceladaEm: agora(),
              motivoCancelamento: 'Marcação cancelada.',
            });
            mudou(l);
            n++;
          }
        return n;
      },
      mover: async (d) => {
        let n = 0;
        for (const l of s.linhas)
          if (
            l.modalidade === 'teleconsulta' &&
            l.marcacao === d.de &&
            ['agendada', 'aguardando'].includes(l.situacao)
          ) {
            Object.assign(l, {
              marcacao: d.para,
              nomeAgenda: d.nomeAgenda.slice(0, 70),
              data: d.data,
              hora: d.hora,
              situacao: 'agendada',
              termo: null,
              local: null,
              esperaDesde: null,
            });
            mudou(l);
            n++;
          }
        return n;
      },
      solicitarInterconsulta: async (t) => {
        const l = this.nova(++s.seq, {
          modalidade: 'teleinterconsulta',
          situacao: 'solicitada',
          data: t.data,
          hora: t.hora,
          paciente: t.paciente,
          atendimento: t.atendimento,
          medico: t.solicitante,
          vinculoMedico: t.vinculoSolicitante,
          convidado: t.convidado,
          nomeConvidado: t.nomeConvidado.slice(0, 70),
          motivoInterconsulta: t.motivo,
          criadoPor: t.solicitante,
        });
        s.linhas.push(l);
        return { id: l.id };
      },
      abrirSalaInterconsulta: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'sala da teleinterconsulta',
          (x) => x.modalidade === 'teleinterconsulta' && x.situacao === 'solicitada',
        );
        Object.assign(l, {
          situacao: 'sala-aberta',
          provedor: d.provedor,
          sala: d.sala,
          salaAbertaEm: agora(),
        });
        mudou(l);
        return { versao: l.versao };
      },
      responderInterconsulta: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'parecer',
          (x) =>
            x.modalidade === 'teleinterconsulta' &&
            ['solicitada', 'sala-aberta'].includes(x.situacao) &&
            x.convidado === d.vinculo,
        );
        Object.assign(l, { situacao: 'respondida', parecer: d.parecer, respondidaEm: agora() });
        mudou(l);
        return { versao: l.versao };
      },
      cancelarInterconsulta: async (id, versao, d) => {
        const l = achar(
          id,
          versao,
          'cancelamento',
          (x) =>
            x.modalidade === 'teleinterconsulta' &&
            ['solicitada', 'sala-aberta'].includes(x.situacao) &&
            x.criadoPor === d.por,
        );
        Object.assign(l, {
          situacao: 'cancelada',
          canceladaEm: agora(),
          motivoCancelamento: d.motivo.slice(0, 200),
        });
        mudou(l);
        return { versao: l.versao };
      },
    };
  }

  /** As marcações apagadas fora do portal e da central, por estabelecimento (só testes). */
  private readonly apagadas = new Set<string>();

  /** Simula a marcação cancelada ou mudada por fora: a leitura a dá como não vigente (como o banco). */
  apagarMarcacao(hospital: string, marcacao: number): void {
    this.apagadas.add(`${hospital}:${marcacao}`);
  }

  private copia = (l: Linha, c: ContextoTelemedicina): Teleconsulta => ({
    ...structuredClone(l),
    marcacaoVigente:
      l.modalidade !== 'teleconsulta' || l.marcacao === null
        ? null
        : !this.apagadas.has(`${chaveDe(c)}:${l.marcacao}`),
  });

  async porId(c: ContextoTelemedicina, id: number) {
    const l = this.e(c).linhas.find((x) => x.id === id);
    return l ? this.copia(l, c) : null;
  }

  async daMarcacao(c: ContextoTelemedicina, marcacao: number) {
    const l = this.e(c).linhas.find(
      (x) => x.modalidade === 'teleconsulta' && x.marcacao === marcacao && x.situacao !== 'cancelada',
    );
    return l ? this.copia(l, c) : null;
  }

  async doPaciente(c: ContextoTelemedicina, paciente: number) {
    return this.e(c)
      .linhas.filter((x) => x.modalidade === 'teleconsulta' && x.paciente === paciente)
      .sort((a, b) => b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora) || b.id - a.id)
      .map((x) => this.copia(x, c));
  }

  async doDia(c: ContextoTelemedicina, f: { data: string; profissional: number | null; teto: number }) {
    const todas = this.e(c)
      .linhas.filter(
        (x) =>
          x.modalidade === 'teleconsulta' &&
          x.data === f.data &&
          (f.profissional === null || (x.vinculoMedico ?? x.profissionalAgenda) === f.profissional),
      )
      .sort((a, b) => a.hora.localeCompare(b.hora) || a.id - b.id);
    return { itens: todas.slice(0, f.teto).map((x) => this.copia(x, c)), truncado: todas.length > f.teto };
  }

  async doAtendimento(c: ContextoTelemedicina, atendimento: number) {
    const l = this.e(c).linhas.find(
      (x) =>
        x.modalidade === 'teleconsulta' &&
        x.atendimento === atendimento &&
        (x.situacao === 'em-andamento' || x.situacao === 'encerrada'),
    );
    return l ? this.copia(l, c) : null;
  }

  async interconsultas(
    c: ContextoTelemedicina,
    f: { convidado: number | null; solicitante: string; desde: string; teto: number },
  ) {
    const todas = this.e(c)
      .linhas.filter(
        (x) =>
          x.modalidade === 'teleinterconsulta' &&
          (x.convidado === f.convidado || x.criadoPor === f.solicitante) &&
          (['solicitada', 'sala-aberta'].includes(x.situacao) || x.data >= f.desde),
      )
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    return { itens: todas.slice(0, f.teto).map((x) => this.copia(x, c)), truncado: todas.length > f.teto };
  }

  async historicoClinico(
    c: ContextoTelemedicina,
    paciente: number,
  ): Promise<AtendimentoDoHistoricoClinico[]> {
    if (paciente !== PACIENTE_SEMENTE_TELE) return [];
    const hoje = relogio(this.agora()).hoje;
    const tele = new Set(this.e(c).linhas.map((x) => x.atendimento));
    // Hipertensa (I10) com a última consulta presencial há 200 dias: o alerta do crônico.
    return [
      {
        atendimento: 900_001,
        data: dias(hoje, 200),
        cid: 'I10',
        laboratorio: false,
        teleconsulta: tele.has(900_001),
      },
      { atendimento: 900_002, data: dias(hoje, 210), cid: null, laboratorio: true, teleconsulta: false },
    ];
  }
}
