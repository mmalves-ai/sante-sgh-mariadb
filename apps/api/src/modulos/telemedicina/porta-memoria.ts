// Porta da telemedicina EM MEMÓRIA (M50, etapa 4): a sessão sintética de dev/ci (E2E) e os testes da API. As mesmas
// recusas do banco (versão desatualizada, a situação conferida em cada mudança, a teleconsulta viva única por
// marcação, a concluída só em andamento, o parecer só do convidado, o cancelamento só de quem pediu). Nada vai à cópia.
// A semente (D-SEMENTE-50.4): a paciente sintética 1003 com uma teleconsulta HOJE, na meia hora corrente (a sala de
// espera aberta), na agenda sintética 902, e o histórico clínico sintético de hipertensa sem consulta presencial há
// 200 dias (o alerta do crônico aparece).
import {
  ErroPortalSgh,
  type FichaDoHistoricoClinico,
  type LinhaTrilha,
  type SituacaoTeleSgh,
  type TeleconsultaLida,
} from '@sgh/legado';
import type {
  ContextoTelemedicina,
  GravadorTelemedicina,
  PortaTelemedicina,
  TrilhaTelemedicina,
} from './porta.js';

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Linha = Mutavel<TeleconsultaLida>;

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
  new ErroPortalSgh(
    'versao-desatualizada',
    `A teleconsulta foi alterada por outra pessoa ou mudou de situação (${o}); recarregue.`,
  );
const VIVAS: ReadonlySet<SituacaoTeleSgh> = new Set([
  'agendada',
  'aguardando',
  'sala-aberta',
  'em-andamento',
]);

export const PACIENTE_SEMENTE_TELE = 1003;
export const MARCACAO_SEMENTE_TELE = 880_101;

function relogio(agora: Date): { hoje: string; hhmm: string; carimbo: string } {
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
    hhmm: `${v('hour')}${v('minute')}`,
    carimbo: `${hoje}T${v('hour')}:${v('minute')}:${v('second')}.000`,
  };
}

const dias = (hoje: string, n: number) =>
  new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export class PortaTelemedicinaMemoria implements PortaTelemedicina {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** As linhas de trilha das gravações (para os testes). */
  readonly trilhas: LinhaTrilha[] = [];

  constructor(
    private readonly agora: () => Date = () => new Date(),
    private readonly opcoes: {
      /** A semente da sessão sintética (desligada nos testes que montam o próprio estado). */
      readonly semente?: boolean;
      /** Avisa a abertura do atendimento em memória da marcação sintética (a ficha nasce dela). */
      readonly aoSemear?: (hospital: string, m: MarcacaoSinteticaTele) => void;
    } = {},
  ) {}

  private e(c: ContextoTelemedicina): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = { linhas: [], seq: 90 };
      if (this.opcoes.semente) this.semear(c.hospital, s);
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  private semear(hospital: string, s: Estado): void {
    const r = relogio(this.agora());
    // A meia hora corrente: a sala de espera já está aberta (abre 30 minutos antes, fecha 2 horas depois).
    const hora = `${r.hhmm.slice(0, 2)}${Number(r.hhmm.slice(2, 4)) >= 30 ? '30' : '00'}`;
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
        agenda: 902,
        nomeAgenda: 'CARDIOLOGIA - ANA MEDICA SINTETICO',
        crmAgenda: m.crm,
        data: m.data,
        hora: m.hora,
        paciente: m.paciente,
        conta: null,
        criadoPor: 'SGH.PORTAL.C1',
        criadoEm: r.carimbo,
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
      agenda: null,
      nomeAgenda: '',
      crmAgenda: 0,
      conta: null,
      cabecalho: null,
      reg: null,
      termo: null,
      local: null,
      esperaDesde: null,
      provedor: null,
      sala: null,
      salaAbertaEm: null,
      declaracao: null,
      medico: null,
      vinculoMedico: null,
      cienteAlerta: false,
      pacienteEntrouEm: null,
      iniciadaEm: null,
      encerradaEm: null,
      motivoEncerramento: null,
      convidado: null,
      nomeConvidado: null,
      motivoInterconsulta: null,
      parecer: null,
      respondidaEm: null,
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
    this.estados.set(c.hospital, copia);
    return r;
  }

  private gravador(s: Estado): GravadorTelemedicina {
    const agora = () => relogio(this.agora()).carimbo;
    const achar = (id: number, versao: number | null, o: string, ok: (l: Linha) => boolean): Linha => {
      const l = s.linhas.find((x) => x.id === id);
      if (!l || (versao !== null && l.versao !== versao) || !ok(l)) throw versaoVelha(o);
      return l;
    };
    const mudou = (l: Linha, por: string) => {
      l.versao += 1;
      void por;
    };
    return {
      agendar: async (t) => {
        if (
          s.linhas.some(
            (x) => x.modalidade === 'teleconsulta' && x.marcacao === t.marcacao && x.situacao !== 'cancelada',
          )
        )
          throw new ErroPortalSgh('situacao', 'Esta marcação já tem teleconsulta.');
        const l = this.nova(++s.seq, {
          modalidade: 'teleconsulta',
          situacao: 'agendada',
          marcacao: t.marcacao,
          agenda: t.agenda,
          nomeAgenda: t.nomeAgenda.slice(0, 40),
          crmAgenda: t.crmAgenda,
          data: t.data,
          hora: t.hora,
          paciente: t.paciente,
          conta: t.conta,
          criadoPor: t.por.slice(0, 31),
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
        l.termo = { versao: d.termo, aceitoEm: agora(), por: d.por };
        l.local = { ...d.local };
        l.esperaDesde ??= agora();
        if (l.situacao === 'agendada') l.situacao = 'aguardando';
        mudou(l, d.por);
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
          cienteAlerta: d.cienteAlerta,
        });
        mudou(l, d.medico);
        return { versao: l.versao };
      },
      vincularAtendimento: async (d) => {
        const l = s.linhas.find(
          (x) =>
            x.id === d.id &&
            x.marcacao === d.marcacao &&
            x.situacao === 'sala-aberta' &&
            x.vinculoMedico === d.profissional,
        );
        if (!l)
          throw new ErroPortalSgh(
            'situacao',
            'A teleconsulta não está com a sala aberta por este profissional para esta marcação: o atendimento não foi aberto.',
          );
        Object.assign(l, {
          situacao: 'em-andamento',
          cabecalho: d.cabecalho,
          reg: d.reg,
          iniciadaEm: agora(),
        });
        mudou(l, d.usuario);
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
            (!['sala-aberta', 'em-andamento'].includes(x.situacao) || x.medico === d.por.slice(0, 31)),
        );
        Object.assign(l, { situacao: 'encerrada', encerradaEm: agora(), motivoEncerramento: d.motivo });
        mudou(l, d.por);
        return { versao: l.versao };
      },
      cancelarDaMarcacao: async (marcacao, por) => {
        let n = 0;
        for (const l of s.linhas)
          if (
            l.modalidade === 'teleconsulta' &&
            l.marcacao === marcacao &&
            ['agendada', 'aguardando', 'sala-aberta'].includes(l.situacao)
          ) {
            l.situacao = 'cancelada';
            mudou(l, por);
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
              agenda: d.agenda,
              nomeAgenda: d.nomeAgenda.slice(0, 40),
              crmAgenda: d.crmAgenda,
              data: d.data,
              hora: d.hora,
              situacao: 'agendada',
              termo: null,
              local: null,
              esperaDesde: null,
            });
            mudou(l, d.por);
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
          cabecalho: t.cabecalho,
          reg: t.reg,
          medico: t.solicitante,
          vinculoMedico: t.vinculoSolicitante,
          convidado: t.convidado,
          nomeConvidado: t.nomeConvidado.slice(0, 70),
          motivoInterconsulta: t.motivo,
          criadoPor: t.solicitante.slice(0, 31),
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
        mudou(l, d.por);
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
        mudou(l, d.por);
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
          encerradaEm: agora(),
          motivoInterconsulta: `${l.motivoInterconsulta ?? ''} | Cancelada: ${d.motivo}`.slice(0, 1000),
        });
        mudou(l, d.por);
        return { versao: l.versao };
      },
    };
  }

  /** As marcações apagadas fora do portal e da central (o outro sistema), por estabelecimento (só testes). */
  private readonly apagadas = new Set<string>();

  /** Simula a marcação cancelada ou mudada pelo outro sistema: a leitura a dá como não vigente (como o banco). */
  apagarMarcacao(hospital: string, marcacao: number): void {
    this.apagadas.add(`${hospital}:${marcacao}`);
  }

  private copia = (l: Linha, hospital: string): TeleconsultaLida => ({
    ...structuredClone(l),
    marcacaoVigente:
      l.modalidade !== 'teleconsulta' || l.marcacao === null
        ? null
        : !this.apagadas.has(`${hospital}:${l.marcacao}`),
  });

  async porId(c: ContextoTelemedicina, id: number) {
    const l = this.e(c).linhas.find((x) => x.id === id);
    return l ? this.copia(l, c.hospital) : null;
  }

  async daMarcacao(c: ContextoTelemedicina, marcacao: number) {
    const l = this.e(c).linhas.find(
      (x) => x.modalidade === 'teleconsulta' && x.marcacao === marcacao && x.situacao !== 'cancelada',
    );
    return l ? this.copia(l, c.hospital) : null;
  }

  async doPaciente(c: ContextoTelemedicina, paciente: number) {
    return this.e(c)
      .linhas.filter((x) => x.modalidade === 'teleconsulta' && x.paciente === paciente)
      .sort((a, b) => b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora) || b.id - a.id)
      .map((x) => this.copia(x, c.hospital));
  }

  async doDia(c: ContextoTelemedicina, f: { data: string; crm: number | null; teto: number }) {
    const todas = this.e(c)
      .linhas.filter(
        (x) => x.modalidade === 'teleconsulta' && x.data === f.data && (!f.crm || x.crmAgenda === f.crm),
      )
      .sort((a, b) => a.hora.localeCompare(b.hora) || a.id - b.id);
    return {
      itens: todas.slice(0, f.teto).map((x) => this.copia(x, c.hospital)),
      truncado: todas.length > f.teto,
    };
  }

  async doCabecalho(c: ContextoTelemedicina, cabecalho: string) {
    const l = this.e(c).linhas.find(
      (x) =>
        x.modalidade === 'teleconsulta' &&
        x.cabecalho === cabecalho &&
        (x.situacao === 'em-andamento' || x.situacao === 'encerrada'),
    );
    return l ? this.copia(l, c.hospital) : null;
  }

  async regsDeTeleconsulta(c: ContextoTelemedicina, regs: readonly number[]) {
    const set = new Set(regs);
    return new Set(
      this.e(c)
        .linhas.filter((x) => x.modalidade === 'teleconsulta' && x.reg !== null && set.has(x.reg))
        .map((x) => x.reg as number),
    );
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
    return {
      itens: todas.slice(0, f.teto).map((x) => this.copia(x, c.hospital)),
      truncado: todas.length > f.teto,
    };
  }

  async historicoClinico(_c: ContextoTelemedicina, paciente: number): Promise<FichaDoHistoricoClinico[]> {
    if (paciente !== PACIENTE_SEMENTE_TELE) return [];
    const hoje = relogio(this.agora()).hoje;
    // Hipertensa (I10) com a última consulta presencial há 200 dias: o alerta do crônico (TELE-04).
    return [
      { reg: 900_001, data: dias(hoje, 200), cid: 'I10', laboratorio: false },
      { reg: 900_002, data: dias(hoje, 210), cid: null, laboratorio: true },
    ];
  }
}
