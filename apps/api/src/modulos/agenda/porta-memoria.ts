// Porta da agenda EM MEMÓRIA (M17): a sessão sintética de dev/ci (E2E) lê e grava agendas, horários, marcações e
// cancelamentos SINTÉTICOS, sem banco. As gravações aplicam o mesmo Zod das operações (OPERACOES_AGENDA) e as mesmas
// recusas da porta própria (horário ocupado, passado, convênio não aceito, check-in, prévia desatualizada, última
// linha da cobertura, colisão); o relógio é o do estabelecimento (America/Sao_Paulo). Nenhum nome aqui é de pessoa
// real. O estado interno é privado e sintético; tudo o que sai pela porta está nos tipos neutros (tipos.ts).
import { existsSync, readFileSync } from 'node:fs';
import { type EstadoOperacao, textoDoMotivo } from '@sgh/contratos';
import { ErroOperacao, recusa } from '@sgh/nucleo';
import { OPERACOES_AGENDA as OPERACOES_CONHECIDAS, operacaoAgenda } from './operacoes.js';
import type { ContextoAgenda, ContextoGravacao, GravadorAgenda, PortaAgenda } from './porta.js';
import type {
  Agenda,
  BloqueioAgenda,
  Cancelamento,
  ComplementoMarcacao,
  ConfirmacaoRegistrada,
  ContagensIndicadores,
  EscalaPlanejada,
  FaixaEscala,
  GeracaoGrade,
  Horario,
  ItemListaEspera,
  LiberacaoGravacao,
  Marcacao,
  PacienteDaAgenda,
  Relogio,
  ResultadoGravacao,
  SituacaoMarcacao,
  VinculoAgenda,
} from './tipos.js';
import { TEXTO_HORARIO_BLOQUEADO, vetoDeBloqueioNoEncaixe } from './regra-encaixe.js';

type ResultadoOperacao = ResultadoGravacao;

/** O que a memória usa do catálogo de operações por estabelecimento (dev/ci). */
export interface CatalogoOperacoesAgenda {
  estado(operacao: string, hospital: string): EstadoOperacao | null;
}

/** Paciente como a memória o recebe do cadastro sintético. */
export interface PacienteSintetico {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number;
  readonly telefone: string | null;
  readonly celular: string | null;
  readonly ativo: boolean;
}

const M = 'SINTETICO';

/** Opções da agenda em memória (M39): o "outro sistema" por fora (E2E) e as contagens do executor. */
export interface OpcoesAgendaMemoria {
  readonly arquivoPorFora?: string | null;
  readonly metricas?: {
    registrar(
      operacao: string,
      hospital: string,
      desfecho: 'sucesso' | 'recusa',
      quando?: Date,
      codigo?: string,
    ): void;
  };
}

interface RelogioM {
  readonly hoje: string;
  readonly hhmm: string;
}

/** Relógio civil do estabelecimento em 4 dígitos (o formato que outros módulos ainda consomem). */
export function relogioLocal(agora = new Date()): RelogioM {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return { hoje: `${v('year')}-${v('month')}-${v('day')}`, hhmm: `${v('hour')}${v('minute')}` };
}

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const semana = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() + 1;
const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(2, 4));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
/** Relógio civil do estabelecimento (HH:MM). */
export function relogioCivil(agora = new Date()): Relogio {
  const r = relogioLocal(agora);
  return { hoje: r.hoje, hora: iso(r.hhmm) };
}
const iso = (h: string) => `${h.padStart(4, '0').slice(0, 2)}:${h.padStart(4, '0').slice(2, 4)}`;
const digitos = (h: string) => h.replace(':', '').padStart(4, '0');
const minutosOuNull = (h: string | null | undefined) => (h && min(h) > 0 ? min(h) : null);
/**
 * A entrada do contrato (horas "HH:MM", duração da agenda em minutos, sinais em booleano) no formato do estado
 * interno deste dublê em memória (quatro dígitos e sinais de texto). Só aqui: o contrato e a porta própria não o
 * conhecem.
 */
function paraOInterno(v: unknown): unknown {
  if (typeof v === 'string') return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v.replace(':', '') : v;
  if (Array.isArray(v)) return v.map(paraOInterno);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraOInterno(x)]));
  return v;
}
const sinal = (b: boolean | undefined) => (b === undefined ? undefined : b ? 'S' : 'N');
const duracaoInterna = (m: number | null | undefined) => (m ? hhmm(m) : m === null ? '' : undefined);
const passou = (h: { data: string; hora: string }, r: RelogioM) =>
  h.data < r.hoje || (h.data === r.hoje && h.hora <= r.hhmm);

interface AgendaM {
  id: number;
  nome: string;
  crm: number;
  ativa: string;
  duracao: string;
  tele: string;
  convenios: number[];
  especialidades: number[];
  unidade?: number;
}
interface HorarioM {
  agenda: number;
  data: string;
  hora: string;
  paciente: string;
  livre: string;
  situacao: string;
  tipo: string;
  duracao: string;
  conv: number;
  retorno: string;
}
interface MarcacaoM {
  id: number;
  agenda: number;
  data: string;
  hora: string;
  idPaciente: number;
  pront: number;
  paciente: string;
  conv: number;
  retorno: string;
  atendido: string;
  canal: string;
  dtAge: string;
  usuario: string;
  fone: string;
  celular: string;
  obs: string | null;
  senha: boolean;
}
interface CancelamentoM {
  protocolo: number;
  agendaId: number;
  agenda: string;
  data: string;
  hora: string;
  paciente: string;
  canceladoEm: string;
  horaCancelamento: string;
  canceladoPor: string | null;
  motivo: string;
  motivoCodigo: string | null;
  solicitante: string | null;
}
interface LinhaEscalaM {
  semana: number;
  duracao: string;
  horaInicio: string;
  horaFim: string;
  intervaloInicio: string;
  intervaloFim: string;
}
interface GeracaoM {
  id: number;
  agenda: number;
  inicio: string;
  fim: string;
  em: string;
  duracao: string;
  semanas: string;
  autor: string;
  revertidaEm: string | null;
  lista: { data: string; hora: string }[];
}
interface BloqueioM extends Omit<BloqueioAgenda, 'nomeAgenda'> {
  ativo: boolean;
  lista: { data: string; hora: string }[];
}
interface PlanejadaM {
  id: number;
  vigenteDesde: string;
  autor: string;
  em: string;
  linhas: LinhaEscalaM[];
}

type Mut<T> = { -readonly [K in keyof T]: T[K] };
type EsperaM = Mut<Omit<ItemListaEspera, 'prontuario'>> & { prontuario: number };

interface Estado {
  agendas: AgendaM[];
  horarios: HorarioM[];
  marcacoes: MarcacaoM[];
  cancelamentos: CancelamentoM[];
  escala: Map<number, LinhaEscalaM[]>;
  ext: Map<number, ComplementoMarcacao>;
  geracoes: GeracaoM[];
  bloqueios: BloqueioM[];
  confirmacoes: Map<number, ConfirmacaoRegistrada[]>;
  planejadas: Map<number, PlanejadaM[]>;
  espera: EsperaM[];
  ligacoes: Map<number, VinculoAgenda>;
  seq: number;
  idem: Map<string, { hash: string; resultado: ResultadoOperacao }>;
  /** M39: os pedidos "por fora" já aplicados (E2E). */
  porFora: Set<string>;
}

export const CONVENIOS_SINTETICOS = [
  { codigo: 10, nome: `PARTICULAR ${M}`, ativo: true },
  { codigo: 305, nome: `OPERADORA ALFA ${M}`, ativo: true },
  { codigo: 306, nome: `OPERADORA BETA ${M}`, ativo: true },
  { codigo: 307, nome: `OPERADORA GAMA ${M}`, ativo: false },
];
export const ESPECIALIDADES_SINTETICAS = [
  { codigo: 3, nome: 'CARDIOLOGIA' },
  { codigo: 9, nome: 'CLINICA MEDICA' },
  { codigo: 21, nome: 'ORTOPEDIA' },
  { codigo: 25, nome: 'PEDIATRIA' },
];
// Feriados fixos da sessão sintética, por mês e dia (repetem todo ano; a regra completa é a da porta própria).
const FERIADOS = [
  { mesDia: '01-01', nome: 'CONFRATERNIZACAO' },
  { mesDia: '04-21', nome: 'TIRADENTES' },
  { mesDia: '09-07', nome: 'INDEPENDENCIA' },
  { mesDia: '11-02', nome: 'FINADOS' },
  { mesDia: '11-15', nome: 'REPUBLICA' },
  { mesDia: '12-25', nome: 'NATAL' },
];
const ehFeriado = (d: string) => FERIADOS.some((f) => f.mesDia === d.slice(5));

function semear(r: RelogioM): Estado {
  const agendas: AgendaM[] = [
    {
      id: 901,
      nome: `CARDIOLOGIA - DR ${M} A`,
      crm: 0,
      ativa: 'S',
      duracao: '0015',
      tele: 'N',
      convenios: [],
      especialidades: [3],
    },
    {
      id: 902,
      nome: `CARDIOLOGIA - DRA ${M} B`,
      crm: 0,
      ativa: 'S',
      duracao: '0015',
      tele: 'N',
      convenios: [10, 306],
      especialidades: [3],
    },
    {
      id: 903,
      nome: `ORTOPEDIA - DR ${M} C`,
      crm: 0,
      ativa: 'S',
      duracao: '0020',
      tele: 'N',
      convenios: [10],
      especialidades: [21],
      // Agenda com unidade informada: exercita o escopo por unidade.
      unidade: 1,
    },
    {
      id: 904,
      nome: `PEDIATRIA - DRA ${M} D`,
      crm: 0,
      ativa: 'N',
      duracao: '0030',
      tele: 'S',
      convenios: [],
      especialidades: [25],
    },
  ];
  const e: Estado = {
    agendas,
    horarios: [],
    marcacoes: [],
    cancelamentos: [],
    escala: new Map(),
    ext: new Map(),
    geracoes: [],
    bloqueios: [],
    confirmacoes: new Map(),
    planejadas: new Map(),
    espera: [],
    ligacoes: new Map(),
    seq: 5000,
    idem: new Map(),
    porFora: new Set(),
  };
  // Grade dos próximos 21 dias úteis (e a de ontem, para o fechamento do dia), como uma geração do outro sistema.
  const faixas: Record<number, { ini: string; fim: string }> = {
    901: { ini: '0800', fim: '1200' },
    902: { ini: '0800', fim: '1000' },
    903: { ini: '1400', fim: '1700' },
  };
  for (const a of agendas.slice(0, 3)) {
    const f = faixas[a.id] as { ini: string; fim: string };
    const dur = min(a.duracao);
    e.escala.set(
      a.id,
      [2, 3, 4, 5, 6].map((s) => ({
        semana: s,
        duracao: a.duracao,
        horaInicio: f.ini,
        horaFim: f.fim,
        intervaloInicio: '0000',
        intervaloFim: '0000',
      })),
    );
    const geracao: GeracaoM = {
      id: ++e.seq,
      agenda: a.id,
      inicio: somar(r.hoje, -3),
      fim: somar(r.hoje, 21),
      em: `${somar(r.hoje, -3)}T09:00`,
      duracao: a.duracao,
      semanas: 'FTTTTTF',
      autor: `COORDENACAO.${M}`,
      revertidaEm: null,
      lista: [],
    };
    e.geracoes.push(geracao);
    for (let i = -3; i <= 21; i++) {
      const d = somar(r.hoje, i);
      if (semana(d) === 1 || semana(d) === 7 || ehFeriado(d)) continue;
      for (let m = min(f.ini); m + dur <= min(f.fim); m += dur) {
        geracao.lista.push({ data: d, hora: hhmm(m) });
        e.horarios.push({
          agenda: a.id,
          data: d,
          hora: hhmm(m),
          paciente: '',
          livre: 'S',
          situacao: '',
          tipo: 'N',
          duracao: a.duracao,
          conv: 0,
          retorno: 'N',
        });
      }
    }
  }
  // Duas marcações SINTÉTICAS no último dia útil passado, sem chegada: os candidatos do fechamento do dia.
  const passados = e.horarios.filter((h) => h.agenda === 902 && h.data < r.hoje).map((h) => h.data);
  const ultimo = passados.sort().at(-1);
  if (ultimo)
    for (const [k, hora] of ['0800', '0815'].entries()) {
      const h = e.horarios.find((x) => x.agenda === 902 && x.data === ultimo && x.hora === hora);
      if (!h) continue;
      const nome = `PACIENTE ${M} FALTA ${k + 1}`;
      h.paciente = nome;
      h.conv = 10;
      e.marcacoes.push({
        id: ++e.seq,
        agenda: 902,
        data: ultimo,
        hora,
        idPaciente: 1001 + k,
        pront: 9001 + k,
        paciente: nome,
        conv: 10,
        retorno: 'N',
        atendido: 'N',
        canal: 'telefone',
        dtAge: somar(ultimo, -10),
        usuario: `COORDENACAO.${M}`,
        fone: '',
        celular: '',
        obs: null,
        senha: false,
      });
    }
  // M50 (etapa 2): uma consulta SINTÉTICA já atendida da paciente 1003 no último dia útil passado (ortopedia, 14:00):
  // a pesquisa de satisfação do portal fica aberta para ela (D-SEMENTE-50).
  const passados903 = e.horarios.filter((h) => h.agenda === 903 && h.data < r.hoje).map((h) => h.data);
  const ultimo903 = passados903.sort().at(-1);
  const h903 = ultimo903
    ? e.horarios.find((x) => x.agenda === 903 && x.data === ultimo903 && x.hora === '1400')
    : undefined;
  if (h903 && ultimo903) {
    h903.paciente = `CINTHYA GABRIELLA VIANNA ${M}`;
    h903.conv = 10;
    e.marcacoes.push({
      id: ++e.seq,
      agenda: 903,
      data: ultimo903,
      hora: '1400',
      idPaciente: 1003,
      pront: 501003,
      paciente: `CINTHYA GABRIELLA VIANNA ${M}`,
      conv: 10,
      retorno: 'N',
      atendido: 'S',
      canal: 'telefone',
      dtAge: somar(ultimo903, -7),
      usuario: `COORDENACAO.${M}`,
      fone: '',
      celular: '',
      obs: null,
      senha: true,
    });
  }
  return e;
}

export class PortaAgendaMemoria implements PortaAgenda {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();
  constructor(
    private readonly catalogo: CatalogoOperacoesAgenda | null = null,
    private readonly lerPacientes: (
      c: ContextoAgenda,
      ids: readonly number[],
    ) => Promise<readonly PacienteSintetico[]> = async () => [],
    private readonly relogioFn: () => Relogio = () => relogioCivil(),
    private readonly memoria: OpcoesAgendaMemoria = {},
  ) {}

  /** O relógio em 4 dígitos (o estado sintético guarda as horas assim). */
  private rel(): RelogioM {
    const r = this.relogioFn();
    return { hoje: r.hoje, hhmm: digitos(r.hora) };
  }

  /**
   * M39 (regra 2): o "outro sistema" marca por fora (E2E): cada pedido do arquivo ocupa o horário (agenda, data e hora)
   * como a marcação feita em outro terminal, uma vez só. Só dev/ci (o arquivo vem de AGENDA_SINTETICA_POR_FORA).
   */
  private aplicarPorFora(s: Estado): void {
    const arq = this.memoria.arquivoPorFora;
    if (!arq || !existsSync(arq)) return;
    try {
      const j = JSON.parse(readFileSync(arq, 'utf8')) as {
        ocupar?: { id: string; agenda?: number | null; data: string; hora: string }[];
        /** M50 (etapa 2): a chegada registrada pela recepção (a senha ligada à marcação), como o check-in do M19. */
        chegar?: { id: string; marcacao: number }[];
      };
      for (const o of j.chegar ?? []) {
        if (s.porFora.has(o.id)) continue;
        s.porFora.add(o.id);
        const m = s.marcacoes.find((x) => x.id === o.marcacao);
        if (m) m.senha = true;
      }
      for (const o of j.ocupar ?? []) {
        if (s.porFora.has(o.id)) continue;
        s.porFora.add(o.id);
        const h = s.horarios.find(
          (x) =>
            (o.agenda == null || x.agenda === o.agenda) &&
            x.data === o.data &&
            x.hora === o.hora &&
            !x.paciente,
        );
        if (h) Object.assign(h, { paciente: 'MARCACAO DO OUTRO TERMINAL SINTETICO', livre: 'S' });
      }
    } catch {
      // Arquivo do E2E ilegível: nada muda.
    }
  }

  private e(c: ContextoAgenda): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) this.porHospital.set(c.hospital, (s = semear(this.rel())));
    return s;
  }

  private estado(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoAgenda, op: string): Promise<LiberacaoGravacao> {
    const e = this.estado(op, c.hospital);
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    if (!Object.hasOwn(OPERACOES_CONHECIDAS, op))
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação da agenda desconhecida.' };
    return { pode: true, codigo: null, motivo: null };
  }

  private agendaM(s: Estado, id: number): AgendaM {
    const a = s.agendas.find((x) => x.id === id);
    if (!a)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Agenda não encontrada',
        'A agenda não existe mais.',
      );
    return a;
  }

  private async pacienteM(c: ContextoAgenda, id: number) {
    const [p] = await this.lerPacientes(c, [id]);
    if (!p)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Paciente não encontrado',
        'O cadastro não existe.',
      );
    if (!p.ativo)
      throw recusa('paciente-inativo', 'O cadastro do paciente está inativo ou foi unificado em outro.');
    if (p.prontuario <= 0)
      throw recusa('sem-prontuario', 'O paciente não tem prontuário: complete o cadastro antes de marcar.');
    return p;
  }

  private exigirCoberturaM(a: AgendaM, conv: number) {
    const c = CONVENIOS_SINTETICOS.find((x) => x.codigo === conv);
    if (!c) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
    if (!c.ativo)
      throw recusa('convenio-inativo', 'O convênio está suspenso: não aceita marcação.', {
        campos: ['convenio'],
      });
    if (a.convenios.length > 0 && !a.convenios.includes(conv))
      throw recusa(
        'convenio-nao-aceito',
        'A agenda não atende este convênio: escolha outra agenda do mesmo procedimento ou outro convênio.',
        { campos: ['convenio'] },
      );
  }

  private vaga(s: Estado, a: AgendaM, data: string, hora: string): HorarioM {
    const h = s.horarios.find((x) => x.agenda === a.id && x.data === data && x.hora === hora);
    if (!h) throw recusa('horario-inexistente', 'O horário não existe na grade da agenda.');
    if (
      h.paciente ||
      h.livre === 'N' ||
      h.situacao ||
      h.tipo === 'E' ||
      this.marcacaoNoHorario(s, a.id, data, hora)
    )
      throw recusa(
        'horario-ocupado',
        'O horário foi ocupado ou bloqueado em outro terminal enquanto você marcava. Escolha outro horário.',
      );
    return h;
  }

  private marcacaoNoHorario(s: Estado, agenda: number, data: string, hora: string) {
    return s.marcacoes.find((m) => m.agenda === agenda && m.data === data && m.hora === hora) ?? null;
  }

  private novaMarcacao(
    s: Estado,
    a: AgendaM,
    h: { data: string; hora: string },
    p: { id: number; nome: string; prontuario: number; telefone: string | null; celular: string | null },
    e: { convenio: number; retorno: boolean; canal: string; observacao?: string | null | undefined },
    login: string,
  ): MarcacaoM {
    const m: MarcacaoM = {
      id: ++s.seq,
      agenda: a.id,
      data: h.data,
      hora: h.hora,
      idPaciente: p.id,
      pront: p.prontuario,
      paciente: p.nome,
      conv: e.convenio,
      retorno: e.retorno ? 'S' : 'N',
      atendido: 'N',
      canal: e.canal,
      dtAge: this.rel().hoje,
      usuario: login,
      fone: p.telefone ?? '',
      celular: p.celular ?? '',
      obs: e.observacao ?? null,
      senha: false,
    };
    s.marcacoes.push(m);
    return m;
  }

  private marcacaoM(s: Estado, id: number): MarcacaoM {
    const m = s.marcacoes.find((x) => x.id === id);
    if (!m)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Marcação não encontrada',
        'A marcação não existe mais.',
      );
    return m;
  }

  private antesDoCheckin(m: MarcacaoM) {
    if (m.atendido === 'S')
      throw recusa('ja-atendido', 'O paciente já foi atendido: a marcação não pode mais ser desfeita.');
    if (m.senha)
      throw recusa(
        'paciente-com-senha',
        'O paciente já fez o check-in (senha de atendimento ligada): cancelar agora exige o perfil de supervisor da recepção.',
      );
  }

  private cancelar(s: Estado, m: MarcacaoM, motivo: string, login: string, liberar: boolean): number {
    const a = this.agendaM(s, m.agenda);
    const r = this.rel();
    const protocolo = ++s.seq;
    s.cancelamentos.push({
      protocolo,
      agendaId: a.id,
      agenda: a.nome,
      data: m.data,
      hora: m.hora,
      paciente: m.paciente,
      canceladoEm: r.hoje,
      horaCancelamento: r.hhmm,
      canceladoPor: login,
      motivo,
      motivoCodigo: null,
      solicitante: null,
    });
    if (liberar) {
      const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
      if (h) Object.assign(h, { paciente: '', conv: 0, retorno: 'N' });
    }
    s.marcacoes = s.marcacoes.filter((x) => x.id !== m.id);
    return protocolo;
  }

  async executar(c: ContextoGravacao, op: string, entradaBruta: unknown) {
    const o = operacaoAgenda(op);
    const analise = o.entrada.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${c.chaveIdempotencia}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave de pedido veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    this.aplicarPorFora(s);
    let resultado: ResultadoOperacao;
    try {
      resultado = await this.aplicar(
        c,
        s,
        op,
        paraOInterno(analise.data) as Record<string, unknown>,
        c.login,
      );
    } catch (erro) {
      // M39: as recusas contam nos indicadores de disputa como no executor do banco (desfecho e código).
      if (erro instanceof ErroOperacao)
        this.memoria.metricas?.registrar(op, c.hospital, 'recusa', new Date(), erro.problema.codigo);
      throw erro;
    }
    this.memoria.metricas?.registrar(op, c.hospital, 'sucesso');
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  private async aplicar(
    c: ContextoAgenda,
    s: Estado,
    op: string,
    e: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    login: string,
  ): Promise<ResultadoOperacao> {
    const r = this.rel();
    switch (op) {
      case 'agenda.gerarGrade': {
        const a = this.agendaM(s, e['agenda']);
        if (a.ativa !== 'S')
          throw recusa('agenda-inativa', 'A agenda está inativa: não aceita marcação nem geração.');
        const horarios = e['horarios'] as { data: string; hora: string }[];
        if (
          horarios.some(
            (h) =>
              passou(h, r) ||
              s.horarios.some((x) => x.agenda === a.id && x.data === h.data && x.hora === h.hora),
          )
        )
          throw recusa(
            'previa-desatualizada',
            'A agenda mudou desde a prévia (um horário apareceu em outro terminal): refaça a prévia.',
          );
        for (const h of horarios)
          s.horarios.push({
            agenda: a.id,
            ...h,
            paciente: '',
            livre: 'S',
            situacao: '',
            tipo: 'N',
            duracao: e['duracao'],
            conv: 0,
            retorno: 'N',
          });
        const anterior = s.escala.get(a.id) ?? [];
        const nova = e['escala'] as LinhaEscalaM[];
        const chaveE = (x: LinhaEscalaM) => `${x.semana}|${x.duracao}|${x.horaInicio}`;
        s.escala.set(a.id, [...anterior.filter((x) => !nova.some((n) => chaveE(n) === chaveE(x))), ...nova]);
        const id = ++s.seq;
        s.geracoes.unshift({
          id,
          agenda: a.id,
          inicio: e['de'],
          fim: e['ate'],
          em: `${r.hoje}T${iso(r.hhmm)}`,
          duracao: e['duracao'],
          semanas: (e['semanas'] as string[]).join(''),
          autor: login,
          revertidaEm: null,
          lista: horarios,
        });
        return { agenda: a.id, geracao: id, horarios: horarios.length };
      }
      case 'agenda.reverterGrade': {
        const g = s.geracoes.find((x) => x.id === e['geracao']);
        if (!g)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Geração não encontrada',
            'A geração não existe.',
          );
        if (g.revertidaEm) throw recusa('geracao-revertida', 'A geração já foi revertida.');
        let removidos = 0;
        for (const h of g.lista) {
          const i = s.horarios.findIndex(
            (x) =>
              x.agenda === g.agenda &&
              x.data === h.data &&
              x.hora === h.hora &&
              x.tipo === 'N' &&
              !x.paciente,
          );
          if (i >= 0 && !this.marcacaoNoHorario(s, g.agenda, h.data, h.hora)) {
            s.horarios.splice(i, 1);
            removidos++;
          }
        }
        g.revertidaEm = new Date().toISOString();
        return { geracao: g.id, removidos, mantidos: g.lista.length - removidos };
      }
      case 'agenda.agendarConsulta':
      case 'agenda.encaixar': {
        const a = this.agendaM(s, e['agenda']);
        if (a.ativa !== 'S')
          throw recusa('agenda-inativa', 'A agenda está inativa: não aceita marcação nem geração.');
        if (passou(e as { data: string; hora: string }, r))
          throw recusa('horario-passado', 'O horário já passou pelo relógio do servidor: escolha outro.');
        let h: HorarioM;
        if (op === 'agenda.encaixar') {
          // O encaixe não passa por cima de bloqueio de período ativo (instante local como relógio de parede).
          const parede = (data: string, hhmm: string) =>
            Date.parse(`${data}T${hhmm.replace(':', '').replace(/^(\d\d)(\d\d)$/, '$1:$2')}:00Z`);
          const veto = vetoDeBloqueioNoEncaixe(parede(e['data'], e['hora']), {
            horarioBloqueado: false,
            bloqueios: s.bloqueios
              .filter((b) => b.agenda === a.id && b.ativo)
              .map((b) => ({
                inicio: parede(b.inicio, b.horaInicio ?? '00:00'),
                fim: b.horaFim ? parede(b.fim, b.horaFim) : parede(b.fim, '00:00') + 86_400_000,
              })),
          });
          if (veto) throw recusa(veto, TEXTO_HORARIO_BLOQUEADO);
          if (
            s.horarios.some((x) => x.agenda === a.id && x.data === e['data'] && x.hora === e['hora']) ||
            this.marcacaoNoHorario(s, a.id, e['data'], e['hora'])
          )
            throw recusa('minuto-ocupado', 'O minuto já existe na agenda: escolha outro minuto livre.');
          h = {
            agenda: a.id,
            data: e['data'],
            hora: e['hora'],
            paciente: '',
            livre: 'S',
            situacao: '',
            tipo: 'E',
            duracao: a.duracao,
            conv: 0,
            retorno: 'N',
          };
        } else h = this.vaga(s, a, e['data'], e['hora']);
        const p = await this.pacienteM(c, e['paciente']);
        this.exigirCoberturaM(a, e['convenio']);
        if (op === 'agenda.encaixar') s.horarios.push(h);
        Object.assign(h, { paciente: p.nome, conv: e['convenio'], retorno: e['retorno'] ? 'S' : 'N' });
        const m = this.novaMarcacao(s, a, h, p, e as never, login);
        s.ext.set(m.id, {
          marcacao: m.id,
          canal: e['canal'],
          encaixe: op === 'agenda.encaixar',
          motivoEncaixe: e['motivo'] ?? null,
          remarcadaDe: null,
          modoRemarcacao: null,
          criadoPor: login,
        });
        return { marcacao: m.id, agenda: a.id };
      }
      case 'agenda.cancelarConsulta':
      case 'agenda.desfazerEncaixe': {
        const m = this.marcacaoM(s, e['marcacao']);
        const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
        if (op === 'agenda.desfazerEncaixe' && h?.tipo !== 'E')
          throw recusa('nao-e-encaixe', 'A marcação não é de encaixe: use o cancelamento.');
        this.antesDoCheckin(m);
        const motivo = textoDoMotivo(e['motivo'], e['complemento']);
        const protocolo = this.cancelar(s, m, motivo, login, op === 'agenda.cancelarConsulta');
        if (op === 'agenda.desfazerEncaixe') s.horarios = s.horarios.filter((x) => x !== h);
        const canc = s.cancelamentos.find((x) => x.protocolo === protocolo);
        if (canc)
          Object.assign(canc, { motivoCodigo: e['motivo'], solicitante: e['solicitante'] ?? 'hospital' });
        return { protocolo, marcacao: m.id };
      }
      case 'agenda.remarcarConsulta': {
        const m = this.marcacaoM(s, e['marcacao']);
        this.antesDoCheckin(m);
        const d = e['destino'] as { agenda: number; data: string; hora: string };
        const a = this.agendaM(s, d.agenda);
        if (a.ativa !== 'S')
          throw recusa('agenda-inativa', 'A agenda está inativa: não aceita marcação nem geração.');
        if (passou(d, r))
          throw recusa(
            'horario-passado',
            'O horário novo já passou pelo relógio do servidor: escolha outro.',
          );
        const h = this.vaga(s, a, d.data, d.hora);
        const convenio = e['convenio'] ?? m.conv;
        this.exigirCoberturaM(a, convenio);
        const p = await this.pacienteM(c, m.idPaciente);
        let protocolo = 0;
        if (e['modo'] === 'transferir') {
          const velho = s.horarios.find(
            (x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora,
          );
          if (velho) velho.situacao = 'T';
        } else protocolo = this.cancelar(s, m, textoDoMotivo(e['motivo'], e['complemento']), login, true);
        Object.assign(h, { paciente: p.nome, conv: convenio, retorno: m.retorno });
        const nova = this.novaMarcacao(
          s,
          a,
          h,
          p,
          { convenio, retorno: m.retorno === 'S', canal: e['canal'], observacao: e['observacao'] ?? m.obs },
          login,
        );
        s.ext.set(nova.id, {
          marcacao: nova.id,
          canal: e['canal'],
          encaixe: false,
          motivoEncaixe: null,
          remarcadaDe: m.id,
          modoRemarcacao: e['modo'],
          criadoPor: login,
        });
        return { marcacao: nova.id, anterior: m.id, protocolo };
      }
      case 'agenda.confirmarConsulta':
      case 'agenda.registrarFalta': {
        const m = this.marcacaoM(s, e['marcacao']);
        this.antesDoCheckin(m);
        const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
        if (!h) throw recusa('horario-inexistente', 'A marcação não tem horário na grade.');
        if (op === 'agenda.confirmarConsulta') {
          if (h.situacao)
            throw recusa('ja-confirmada', 'A marcação já tem situação (confirmada, falta ou outra).');
          if (passou(m, r)) throw recusa('horario-passado', 'A consulta já passou.');
          h.situacao = 'C';
          const lista = s.confirmacoes.get(m.id) ?? [];
          lista.unshift({
            resultado: 'confirmado',
            canal: 'telefone',
            em: new Date().toISOString(),
            por: login,
          });
          s.confirmacoes.set(m.id, lista);
        } else {
          if (h.situacao && h.situacao !== 'C')
            throw recusa(
              'situacao-mudou',
              'A marcação já tem outra situação (falta, chegada ou transferência).',
            );
          if (!passou(m, r))
            throw recusa(
              'consulta-futura',
              'A consulta ainda não aconteceu: a falta só se registra depois do horário.',
            );
          h.situacao = 'F';
        }
        return { marcacao: m.id };
      }
      case 'agenda.bloquearHorarios': {
        const a = this.agendaM(s, e['agenda']);
        const bloquear = e['acao'] === 'bloquear';
        const lista = e['horarios'] as { data: string; hora: string }[];
        const alvos = lista.map((x) => {
          const h = s.horarios.find((y) => y.agenda === a.id && y.data === x.data && y.hora === x.hora);
          if (!h) throw recusa('horario-inexistente', 'Um dos horários não existe mais na grade.');
          if (h.paciente)
            throw recusa(
              'horario-ocupado',
              'Um dos horários tem paciente marcado: remarque antes de bloquear.',
            );
          if (h.livre !== (bloquear ? 'S' : 'N'))
            throw recusa(
              'situacao-mudou',
              `Um dos horários já está ${bloquear ? 'bloqueado' : 'desbloqueado'}.`,
            );
          return h;
        });
        for (const h of alvos) h.livre = bloquear ? 'N' : 'S';
        if (bloquear) {
          const datas = lista.map((x) => x.data).sort();
          s.bloqueios.unshift({
            id: ++s.seq,
            agenda: a.id,
            inicio: datas[0] as string,
            fim: datas.at(-1) as string,
            horaInicio: null,
            horaFim: null,
            motivo: e['motivo'],
            complemento: e['complemento'] ?? null,
            previsaoRetorno: e['previsaoRetorno'] ?? null,
            horarios: lista.length,
            autor: login,
            criadoEm: new Date().toISOString(),
            ativo: true,
            lista,
          });
        } else
          for (const b of s.bloqueios)
            if (
              b.agenda === a.id &&
              b.ativo &&
              b.lista.some((x) => lista.some((y) => y.data === x.data && y.hora === x.hora))
            )
              b.ativo = false;
        return { agenda: a.id, horarios: lista.length };
      }
      case 'agenda.definirCobertura':
      case 'agenda.definirEspecialidade': {
        const a = this.agendaM(s, e['agenda']);
        const cob = op === 'agenda.definirCobertura';
        const cod = cob ? e['convenio'] : e['especialidade'];
        const lista = cob ? a.convenios : a.especialidades;
        const existe = cob
          ? CONVENIOS_SINTETICOS.some((x) => x.codigo === cod)
          : ESPECIALIDADES_SINTETICAS.some((x) => x.codigo === cod);
        if (!existe)
          throw recusa(
            cob ? 'convenio-inexistente' : 'especialidade-inexistente',
            cob ? 'O convênio não existe.' : 'A especialidade não existe.',
          );
        if (e['acao'] === 'incluir') {
          if (lista.includes(cod))
            throw recusa(
              cob ? 'ja-aceito' : 'ja-ligada',
              cob ? 'O convênio já está na lista da agenda.' : 'A especialidade já está ligada à agenda.',
            );
          lista.push(cod);
        } else {
          if (!lista.includes(cod))
            throw recusa(
              cob ? 'nao-aceito' : 'nao-ligada',
              cob ? 'O convênio não está na lista da agenda.' : 'A especialidade não está ligada à agenda.',
            );
          if (cob && lista.length === 1 && !e['confirmarAceitarTodos'])
            throw recusa(
              'confirmar-aceitar-todos',
              'É o último convênio da lista: removê-lo faz a agenda aceitar TODOS os convênios. Confirme para seguir.',
            );
          lista.splice(lista.indexOf(cod), 1);
        }
        return cob ? { agenda: a.id, convenio: cod } : { agenda: a.id, especialidade: cod };
      }
      case 'agenda.incluirAgenda': {
        if (s.agendas.some((x) => x.nome === e['nome']))
          throw recusa('nome-existente', 'Já existe agenda com este nome.', { campos: ['nome'] });
        const id = ++s.seq;
        s.agendas.push({
          id,
          nome: e['nome'],
          crm: 0,
          ativa: 'S',
          duracao: hhmm(e['duracaoMinutos'] as number),
          tele: e['teleatendimento'] ? 'S' : 'N',
          convenios: [],
          especialidades: [],
        });
        return { agenda: id };
      }
      case 'agenda.alterarAgenda': {
        const a = this.agendaM(s, e['agenda']);
        const l = e['lidos'] as { duracaoMinutos: number | null; ativa: boolean; teleatendimento: boolean };
        const lidos = {
          duracao: duracaoInterna(l.duracaoMinutos) ?? '',
          ativa: sinal(l.ativa),
          teleatendimento: sinal(l.teleatendimento),
        };
        const mudou = (
          [
            ['duracaoMinutos', a.duracao, lidos.duracao],
            ['ativa', a.ativa, lidos.ativa],
            ['teleatendimento', a.tele, lidos.teleatendimento],
          ] as const
        ).filter(([, x, y]) => x !== y);
        if (mudou.length > 0)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado no outro sistema',
            'A agenda foi alterada desde a leitura. Releia e confira antes de salvar.',
            {
              colunas: mudou.map(([k]) => k),
            },
          );
        const vb = e['valores'] as { duracaoMinutos?: number; ativa?: boolean; teleatendimento?: boolean };
        const v = Object.fromEntries(
          Object.entries({
            duracao: duracaoInterna(vb.duracaoMinutos),
            ativa: sinal(vb.ativa),
            teleatendimento: sinal(vb.teleatendimento),
          }).filter(([, x]) => x !== undefined),
        ) as { duracao?: string; ativa?: string; teleatendimento?: string };
        if (
          (v.duracao ?? a.duracao) === a.duracao &&
          (v.ativa ?? a.ativa) === a.ativa &&
          (v.teleatendimento ?? a.tele) === a.tele
        )
          throw recusa('sem-efeito', 'Nenhum campo muda de valor.');
        Object.assign(a, {
          duracao: v.duracao ?? a.duracao,
          ativa: v.ativa ?? a.ativa,
          tele: v.teleatendimento ?? a.tele,
        });
        return { agenda: a.id, campos: Object.keys(v).length };
      }
      default:
        throw recusa('operacao-especificada', 'Operação ainda desligada.');
    }
  }

  async gravar<T>(c: ContextoGravacao, fn: (g: GravadorAgenda) => Promise<T>): Promise<T> {
    const s = this.e(c);
    const login = c.login;
    const g: GravadorAgenda = {
      planejarEscala: async (r) => {
        const id = ++s.seq;
        const lista = s.planejadas.get(r.agenda) ?? [];
        lista.unshift({
          id,
          vigenteDesde: r.vigenteDesde,
          autor: login,
          em: new Date().toISOString(),
          linhas: r.faixas.map((f) => ({
            semana: f.diaSemana,
            duracao: f.duracaoMinutos ? hhmm(f.duracaoMinutos) : '',
            horaInicio: digitos(f.inicio),
            horaFim: digitos(f.fim),
            intervaloInicio: f.intervaloInicio ? digitos(f.intervaloInicio) : '',
            intervaloFim: f.intervaloFim ? digitos(f.intervaloFim) : '',
          })),
        });
        s.planejadas.set(r.agenda, lista);
        return id;
      },
      cancelarEscalaPlanejada: async (r) => {
        const lista = s.planejadas.get(r.agenda) ?? [];
        if (!lista.some((x) => x.id === r.id))
          throw recusa('escala-inexistente', 'A escala planejada não existe ou já foi cancelada.');
        s.planejadas.set(
          r.agenda,
          lista.filter((x) => x.id !== r.id),
        );
      },
      gravarConfirmacao: async (r) => {
        const lista = s.confirmacoes.get(r.marcacao) ?? [];
        lista.unshift({ resultado: r.resultado, canal: r.canal, em: new Date().toISOString(), por: login });
        s.confirmacoes.set(r.marcacao, lista);
        return ++s.seq;
      },
      gravarBloqueioPeriodo: async (r) => {
        const id = ++s.seq;
        s.bloqueios.unshift({
          id,
          ...r,
          horarios: 0,
          autor: login,
          criadoEm: new Date().toISOString(),
          ativo: true,
          lista: [],
        });
        return id;
      },
      encerrarBloqueio: async (r) => {
        const b = s.bloqueios.find((x) => x.id === r.id && x.agenda === r.agenda && x.ativo);
        if (!b) throw recusa('bloqueio-inexistente', 'O bloqueio não existe ou já foi encerrado.');
        b.ativo = false;
      },
      incluirEspera: async (r) => {
        const [p] = await this.lerPacientes(c, [r.paciente]);
        const id = ++s.seq;
        s.espera.push({
          id,
          paciente: r.paciente,
          prontuario: p?.prontuario ?? 0,
          agenda: r.agenda,
          especialidade: r.especialidade,
          prioridade: r.prioridade,
          situacao: 'aguardando',
          observacao: r.observacao,
          desde: new Date().toISOString(),
          oferta: null,
          marcacao: null,
        });
        return id;
      },
      ofertarEspera: async (r) => {
        const x = s.espera.find((y) => y.id === r.id && ['aguardando', 'ofertado'].includes(y.situacao));
        if (!x) throw recusa('espera-encerrada', 'O pedido da lista de espera já foi encerrado.');
        Object.assign(x, { situacao: 'ofertado', oferta: { agenda: r.agenda, data: r.data, hora: r.hora } });
      },
      encerrarEspera: async (r) => {
        const x = s.espera.find((y) => y.id === r.id && ['aguardando', 'ofertado'].includes(y.situacao));
        if (!x) throw recusa('espera-encerrada', 'O pedido da lista de espera já foi encerrado.');
        Object.assign(x, { situacao: r.situacao, marcacao: r.marcacao });
      },
      gravarVinculo: async (r) => {
        s.ligacoes.set(r.agenda, {
          agenda: r.agenda,
          profissional: r.profissional,
          especialidade: r.especialidade,
          local: r.local,
          unidade: r.unidade,
          situacao: 'revisada',
        });
      },
    };
    return fn(g);
  }

  // ── Leituras (tipos neutros) ─────────────────────────────────────────────────────────────────────

  async relogio(): Promise<Relogio> {
    return this.relogioFn();
  }

  private agendaNeutra(s: Estado, a: AgendaM): Agenda {
    const r = this.rel();
    const futuras = s.horarios
      .filter((h) => h.agenda === a.id && !passou(h, r))
      .map((h) => h.data)
      .sort();
    return {
      id: a.id,
      nome: a.nome,
      profissional: null,
      registroProfissional: a.crm || null,
      ativa: a.ativa === 'S',
      duracaoMinutos: minutosOuNull(a.duracao),
      teleatendimento: a.tele === 'S',
      gradeInicio: futuras[0] ?? null,
      gradeFim: futuras.at(-1) ?? null,
      convenios: a.convenios.length,
      especialidades: a.especialidades.length,
      unidade: a.unidade ?? null,
      categoria: null,
      versao: 1,
    };
  }

  async agendas(c: ContextoAgenda) {
    const s = this.e(c);
    return s.agendas.map((a) => this.agendaNeutra(s, a)).sort((x, y) => x.nome.localeCompare(y.nome));
  }
  async agenda(c: ContextoAgenda, id: number) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.id === id);
    return a ? this.agendaNeutra(s, a) : null;
  }
  async conveniosDaAgenda(c: ContextoAgenda, id: number) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.id === id);
    const r = this.rel();
    return (a?.convenios ?? []).map((cod) => {
      const cv = CONVENIOS_SINTETICOS.find((x) => x.codigo === cod);
      return {
        codigo: cod,
        nome: cv?.nome ?? String(cod),
        ativo: cv?.ativo ?? false,
        marcadosFuturos: s.marcacoes.filter((m) => m.agenda === id && m.conv === cod && m.data >= r.hoje)
          .length,
      };
    });
  }
  async cobertura(c: ContextoAgenda, ids: readonly number[]) {
    const s = this.e(c);
    return new Map(
      s.agendas
        .filter((a) => ids.includes(a.id) && a.convenios.length > 0)
        .map((a) => [a.id, [...a.convenios]]),
    );
  }
  async especialidadesDaAgenda(c: ContextoAgenda, id: number) {
    const a = this.e(c).agendas.find((x) => x.id === id);
    return (a?.especialidades ?? []).map((cod) => ({
      codigo: cod,
      nome: ESPECIALIDADES_SINTETICAS.find((x) => x.codigo === cod)?.nome ?? String(cod),
    }));
  }
  async opcoes() {
    return {
      convenios: CONVENIOS_SINTETICOS.map((x) => ({ ...x })),
      especialidades: ESPECIALIDADES_SINTETICAS.map((x) => ({ ...x })),
      locais: [
        { codigo: 11, nome: `CONSULTORIO 1 ${M}` },
        { codigo: 12, nome: `CONSULTORIO 2 ${M}` },
      ],
      unidades: [
        { codigo: 1, nome: `UNIDADE 1 ${M}` },
        { codigo: 2, nome: `UNIDADE 2 ${M}` },
      ],
    };
  }
  private faixa(l: LinhaEscalaM): FaixaEscala {
    const intervalo = !!l.intervaloInicio && l.intervaloInicio !== '0000';
    return {
      diaSemana: l.semana,
      duracaoMinutos: minutosOuNull(l.duracao),
      inicio: iso(l.horaInicio),
      fim: iso(l.horaFim),
      intervaloInicio: intervalo ? iso(l.intervaloInicio) : null,
      intervaloFim: intervalo ? iso(l.intervaloFim) : null,
    };
  }
  async escala(c: ContextoAgenda, agenda: number) {
    return [...(this.e(c).escala.get(agenda) ?? [])]
      .sort((x, y) => x.semana - y.semana || x.horaInicio.localeCompare(y.horaInicio))
      .map((l) => this.faixa(l));
  }
  async geracoes(c: ContextoAgenda, agenda: number): Promise<GeracaoGrade[]> {
    return this.e(c)
      .geracoes.filter((g) => g.agenda === agenda)
      .map((g) => ({
        id: g.id,
        agenda: g.agenda,
        inicio: g.inicio,
        fim: g.fim,
        em: g.em,
        autor: g.autor,
        duracaoMinutos: minutosOuNull(g.duracao),
        diasSemana: [...g.semanas].flatMap((x, i) => (x === 'T' ? [i + 1] : [])),
        horarios: g.lista.length,
        revertidaEm: g.revertidaEm,
      }));
  }
  async agendaDaGeracao(c: ContextoAgenda, id: number) {
    return this.e(c).geracoes.find((g) => g.id === id)?.agenda ?? null;
  }
  async feriados(_c: ContextoAgenda, de: string, ate: string) {
    const r: { data: string; nome: string }[] = [];
    for (let a = Number(de.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++)
      for (const f of FERIADOS) r.push({ data: `${a}-${f.mesDia}`, nome: f.nome });
    return r.filter((f) => f.data >= de && f.data <= ate);
  }
  private situacaoNoHorario(h: HorarioM, m: MarcacaoM | null): SituacaoMarcacao | null {
    if (!m && !h.paciente) return null;
    if (m?.atendido === 'S') return 'realizada';
    if (h.situacao === 'F') return 'falta';
    if (h.situacao === 'T') return 'transferida';
    if (h.situacao === 'A' || m?.senha) return 'chegou';
    if (h.situacao === 'C') return 'confirmada';
    return 'marcada';
  }
  async horarios(c: ContextoAgenda, agenda: number, de: string, ate: string) {
    const s = this.e(c);
    const itens: Horario[] = s.horarios
      .filter((h) => h.agenda === agenda && h.data >= de && h.data <= ate)
      .sort((x, y) => `${x.data}${x.hora}`.localeCompare(`${y.data}${y.hora}`))
      .map((h) => {
        const m = this.marcacaoNoHorario(s, h.agenda, h.data, h.hora);
        return {
          data: h.data,
          hora: iso(h.hora),
          encaixe: h.tipo === 'E',
          bloqueado: h.livre === 'N',
          duracaoMinutos: minutosOuNull(h.duracao),
          marcacao: m?.id ?? null,
          paciente: h.paciente || null,
          situacao: this.situacaoNoHorario(h, m),
          convenio: h.paciente ? h.conv : null,
        };
      });
    return { itens, truncado: false };
  }
  async horasMarcadas(c: ContextoAgenda, agenda: number, data: string) {
    return this.e(c)
      .marcacoes.filter((m) => m.agenda === agenda && m.data === data)
      .map((m) => iso(m.hora));
  }
  private marcacaoNeutra(s: Estado, m: MarcacaoM): Marcacao {
    const a = s.agendas.find((x) => x.id === m.agenda);
    const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
    return {
      id: m.id,
      agenda: m.agenda,
      nomeAgenda: a?.nome ?? '',
      data: m.data,
      hora: iso(m.hora),
      paciente: m.paciente,
      idPaciente: m.idPaciente,
      prontuario: m.pront,
      convenio: m.conv,
      nomeConvenio: CONVENIOS_SINTETICOS.find((x) => x.codigo === m.conv)?.nome ?? null,
      retorno: m.retorno === 'S',
      encaixe: h?.tipo === 'E',
      situacao: h
        ? (this.situacaoNoHorario(h, m) ?? 'marcada')
        : m.atendido === 'S'
          ? 'realizada'
          : 'marcada',
      canal: m.canal,
      marcadaEm: m.dtAge,
      marcadaPor: m.usuario,
    };
  }
  async marcacoesDaJanela(c: ContextoAgenda, agenda: number, de: string, ate: string) {
    const s = this.e(c);
    return {
      itens: s.marcacoes
        .filter((m) => m.agenda === agenda && m.data >= de && m.data <= ate)
        .sort((x, y) => `${x.data}${x.hora}`.localeCompare(`${y.data}${y.hora}`))
        .map((m) => this.marcacaoNeutra(s, m)),
      truncado: false,
    };
  }
  async marcacoesDoDia(c: ContextoAgenda, data: string) {
    const s = this.e(c);
    return {
      itens: s.marcacoes
        .filter((m) => m.data === data)
        .sort((x, y) => x.hora.localeCompare(y.hora))
        .map((m) => this.marcacaoNeutra(s, m)),
      truncado: false,
    };
  }
  async marcacao(c: ContextoAgenda, id: number) {
    const s = this.e(c);
    const m = s.marcacoes.find((x) => x.id === id);
    return m
      ? {
          marcacao: this.marcacaoNeutra(s, m),
          contato: { telefone: m.fone || null, celular: m.celular || null, observacao: m.obs },
        }
      : null;
  }
  async marcacoesDoPaciente(c: ContextoAgenda, id: number) {
    const s = this.e(c);
    // M50 (etapa 2): o que a recepção registrou por fora (a chegada) vale também na leitura do portal.
    this.aplicarPorFora(s);
    return {
      itens: s.marcacoes
        .filter((m) => m.idPaciente === id)
        .sort((x, y) => `${y.data}${y.hora}`.localeCompare(`${x.data}${x.hora}`))
        .map((m) => this.marcacaoNeutra(s, m)),
      truncado: false,
      preCadastros: [],
    };
  }
  async vagas(
    c: ContextoAgenda,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ) {
    const s = this.e(c);
    const r = this.rel();
    const limite = f.limite ?? 500;
    const todas = s.horarios
      .filter((h) => {
        const a = s.agendas.find((x) => x.id === h.agenda);
        return (
          a?.ativa === 'S' &&
          (!f.agendas || f.agendas.length === 0 || f.agendas.includes(h.agenda)) &&
          h.data >= f.de &&
          h.data <= f.ate &&
          !passou(h, r) &&
          !h.paciente &&
          h.livre !== 'N' &&
          !h.situacao &&
          h.tipo !== 'E'
        );
      })
      .sort((x, y) => `${x.data}${x.hora}`.localeCompare(`${y.data}${y.hora}`));
    return {
      truncado: todas.length > limite,
      itens: todas.slice(0, limite).map((h) => ({
        agenda: h.agenda,
        nomeAgenda: s.agendas.find((x) => x.id === h.agenda)?.nome ?? '',
        data: h.data,
        hora: iso(h.hora),
      })),
    };
  }
  async proximasVagas(c: ContextoAgenda, agendas: readonly number[], depoisDe: string, ate: string) {
    const v = await this.vagas(c, { agendas, de: somar(depoisDe, 1), ate, limite: 5000 });
    const r = new Map<number, (typeof v.itens)[number]>();
    for (const x of v.itens) if (!r.has(x.agenda)) r.set(x.agenda, x);
    return [...r.values()];
  }
  async cancelamentos(
    c: ContextoAgenda,
    f: {
      de: string;
      ate: string;
      agendas: readonly number[] | null;
      motivo?: string | null;
      pagina: number;
      porPagina: number;
    },
  ) {
    const s = this.e(c);
    const todos = s.cancelamentos
      .filter(
        (x) =>
          x.canceladoEm >= f.de &&
          x.canceladoEm <= f.ate &&
          (!f.agendas || f.agendas.includes(x.agendaId)) &&
          (!f.motivo || x.motivoCodigo === f.motivo),
      )
      .sort((x, y) => y.protocolo - x.protocolo);
    const itens: Cancelamento[] = todos
      .slice((f.pagina - 1) * f.porPagina, f.pagina * f.porPagina)
      .map((x) => ({
        protocolo: x.protocolo,
        agenda: x.agendaId,
        nomeAgenda: x.agenda,
        data: x.data,
        hora: iso(x.hora),
        paciente: x.paciente,
        canceladoEm: x.canceladoEm,
        horaCancelamento: iso(x.horaCancelamento),
        canceladoPor: x.canceladoPor,
        motivo: x.motivo,
        motivoCodigo: x.motivoCodigo,
        solicitante: x.solicitante,
      }));
    return { total: todos.length, itens };
  }
  async indicadores(c: ContextoAgenda, de: string, ate: string): Promise<ContagensIndicadores> {
    const s = this.e(c);
    const hs = s.horarios.filter((h) => h.data >= de && h.data <= ate);
    const ms = s.marcacoes.filter((m) => m.data >= de && m.data <= ate);
    const porAgenda = new Map<string, { h: number; o: number; m: number; c: number }>();
    for (const h of hs) {
      const n = s.agendas.find((a) => a.id === h.agenda)?.nome ?? '';
      const x = porAgenda.get(n) ?? { h: 0, o: 0, m: 0, c: 0 };
      x.h++;
      if (h.paciente) x.o++;
      porAgenda.set(n, x);
    }
    for (const m of ms) {
      const n = s.agendas.find((a) => a.id === m.agenda)?.nome ?? '';
      const x = porAgenda.get(n) ?? { h: 0, o: 0, m: 0, c: 0 };
      x.m++;
      if (m.atendido === 'S') x.c++;
      porAgenda.set(n, x);
    }
    const faixa = (m: MarcacaoM) => {
      const d = Math.round(
        (Date.parse(`${m.data}T00:00:00Z`) - Date.parse(`${m.dtAge}T00:00:00Z`)) / 86_400_000,
      );
      return d <= 0 ? 'mesmo-dia' : d <= 7 ? 'ate-7' : d <= 30 ? 'de-8-a-30' : 'mais-de-30';
    };
    const ant = new Map<string, { m: number; c: number }>();
    for (const m of ms) {
      const k = faixa(m);
      const x = ant.get(k) ?? { m: 0, c: 0 };
      x.m++;
      if (m.atendido === 'S') x.c++;
      ant.set(k, x);
    }
    const canal = new Map<string, number>();
    for (const m of ms) canal.set(m.canal, (canal.get(m.canal) ?? 0) + 1);
    return {
      ocupacao: [...porAgenda.entries()]
        .filter(([, v]) => v.h > 0)
        .map(([agenda, v]) => ({ agenda, horarios: v.h, ocupados: v.o })),
      porAntecedencia: [...ant.entries()].map(([chave, v]) => ({ chave, marcados: v.m, compareceu: v.c })),
      porAgenda: [...porAgenda.entries()]
        .filter(([, v]) => v.m > 0)
        .map(([chave, v]) => ({ chave, marcados: v.m, compareceu: v.c })),
      funil: {
        horarios: hs.length,
        livres: hs.filter((h) => !h.paciente).length,
        marcados: ms.length,
        compareceu: ms.filter((m) => m.atendido === 'S').length,
        cancelados: s.cancelamentos.filter((x) => x.data >= de && x.data <= ate).length,
        encaixes: hs.filter((h) => h.tipo === 'E').length,
      },
      porCanal: [...canal.entries()].map(([k, marcados]) => ({ canal: k, marcados })),
    };
  }
  async pacientes(c: ContextoAgenda, ids: readonly number[]): Promise<PacienteDaAgenda[]> {
    return (await this.lerPacientes(c, ids)).map((p) => ({
      id: p.id,
      nome: p.nome,
      prontuario: p.prontuario,
    }));
  }
  async complementos(c: ContextoAgenda, ids: readonly number[]) {
    const s = this.e(c);
    return new Map([...s.ext.entries()].filter(([k]) => ids.includes(k)));
  }
  async bloqueios(
    c: ContextoAgenda,
    f: { agenda?: number | null; ativos?: boolean; de?: string | null; ate?: string | null },
  ): Promise<BloqueioAgenda[]> {
    const s = this.e(c);
    return s.bloqueios
      .filter(
        (b) =>
          (!f.agenda || b.agenda === f.agenda) &&
          (!f.ativos || b.ativo) &&
          (!f.de || !f.ate || (b.inicio <= f.ate && b.fim >= f.de)),
      )
      .map((linha) => {
        const { lista, ...b } = linha;
        void lista;
        return { ...b, nomeAgenda: s.agendas.find((a) => a.id === b.agenda)?.nome ?? '' };
      });
  }
  async horariosDoBloqueio(c: ContextoAgenda, id: number) {
    return (this.e(c).bloqueios.find((b) => b.id === id)?.lista ?? []).map((h) => ({
      data: h.data,
      hora: iso(h.hora),
    }));
  }
  async confirmacoes(c: ContextoAgenda, marcacao: number) {
    return this.e(c).confirmacoes.get(marcacao) ?? [];
  }
  async escalasPlanejadas(c: ContextoAgenda, agenda: number): Promise<EscalaPlanejada[]> {
    return (this.e(c).planejadas.get(agenda) ?? []).map((p) => ({
      id: p.id,
      vigenteDesde: p.vigenteDesde,
      autor: p.autor,
      em: p.em,
      faixas: p.linhas.map((l) => this.faixa(l)),
    }));
  }
  async espera(
    c: ContextoAgenda,
    f: { situacoes: readonly string[]; agenda?: number | null; especialidade?: number | null },
  ): Promise<ItemListaEspera[]> {
    return this.e(c).espera.filter(
      (x) =>
        f.situacoes.includes(x.situacao) &&
        (!f.agenda || x.agenda === f.agenda) &&
        (f.especialidade === null || f.especialidade === undefined || x.especialidade === f.especialidade),
    );
  }
  async vinculos(c: ContextoAgenda) {
    return new Map(this.e(c).ligacoes);
  }
  async profissionais() {
    return [
      { id: 501, nome: `DR ${M} A` },
      { id: 502, nome: `DRA ${M} B` },
      { id: 503, nome: `DR ${M} C` },
      { id: 504, nome: `DRA ${M} D` },
    ];
  }
  async cancelamentosPorMotivo(c: ContextoAgenda, de: string, ate: string) {
    const m = new Map<string, number>();
    for (const x of this.e(c).cancelamentos)
      if (x.motivoCodigo && x.data >= de && x.data <= ate)
        m.set(x.motivoCodigo, (m.get(x.motivoCodigo) ?? 0) + 1);
    return [...m.entries()].map(([motivo, total]) => ({ motivo, total }));
  }

  /** Testes e E2E: põe a senha de atendimento (check-in) numa marcação (o check-in é do M19). */
  marcarChegada(c: ContextoAgenda, marcacao: number): void {
    const m = this.e(c).marcacoes.find((x) => x.id === marcacao);
    if (m) m.senha = true;
  }
}
