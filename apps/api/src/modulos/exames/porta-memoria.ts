// Porta da agenda de exames EM MEMÓRIA (M18): a sessão sintética de dev/ci (E2E) lê e grava agendas, horários,
// marcações, cancelamentos e a cobertura SINTÉTICOS, sem tocar banco nenhum. As gravações aplicam o mesmo Zod do
// contrato (esquemas.ts, o mesmo da porta do banco) e as mesmas recusas (agenda inativa, horário inexistente, ocupado ou passado, convênio
// inativo ou não aceito, paciente sem prontuário, check-in, a última linha da cobertura, prévia desatualizada); o
// relógio é o do estabelecimento (America/Sao_Paulo). Os pacientes são os do cadastro em memória (marca
// "SINTETICO"). Nenhum nome aqui é de pessoa real; os nomes de exame são do vocabulário clínico.
import { type EstadoOperacao, textoCurtoDoMotivo } from '@sgh/contratos';
import { estadoDoHorarioExame } from '@sgh/dominio-agenda';
import { type ContextoOperacao, ErroOperacao, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import { horaDeMinutos, minutosDaHora, normalizarHora, relogioDoEstabelecimento } from './relogio.js';
import type { ContextoPortaM18, LiberacaoGravacao } from './apoio-gravacao.js';
import { ESQUEMAS_OPERACAO_EXAME, OPERACOES_EXAME_DESLIGADAS } from './esquemas.js';
import type { GravadorCoberturaExame, PortaExame } from './porta.js';
import type {
  AgendaExame,
  CancelamentoExame,
  CoberturaExame,
  ExtensaoExame,
  GeracaoGrade,
  LinhaEscalaExame,
  MarcacaoExame,
  RelogioEstabelecimento,
} from './tipos.js';

/** Faixa sintética sem pausa, uma vaga, sem feriado e vigente desde sempre. */
const FAIXA_SEM_EXTRAS = {
  intervaloInicio: null,
  intervaloFim: null,
  vagas: 1,
  atendeFeriado: false,
  vigenciaInicio: '2000-01-01',
  vigenciaFim: null,
} as const;

/** Estado de cada operação no catálogo de operações do estabelecimento (null = operação desconhecida). */
export interface CatalogoOperacoesExame {
  estado(operacao: string, estabelecimento: string): EstadoOperacao | null;
}

const M = 'SINTETICO';

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const semana = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() + 1;
const min = minutosDaHora;
const passou = (h: { data: string; hora: string }, r: RelogioEstabelecimento) =>
  h.data < r.hoje || (h.data === r.hoje && min(h.hora) <= min(r.hora));

interface AgendaM {
  id: number;
  nome: string;
  crm: number;
  exame: string;
  categoria: number;
  duracao: string;
  ativa: boolean;
  unidade: number;
  convenios: number[];
}
interface HorarioM {
  agenda: number;
  data: string;
  hora: string;
  exame: string;
  paciente: string;
  livre: string;
  situacao: string;
  tipo: string;
  conv: number;
}
interface MarcacaoM {
  id: number;
  agenda: number;
  data: string;
  hora: string;
  idPaciente: number | null;
  pront: number;
  paciente: string;
  conv: number;
  atendido: boolean;
  usuario: string;
  dtAge: string;
  hrAge: string;
  fone: string;
  celular: string;
  obs: string | null;
  senha: boolean;
}
interface Estado {
  agendas: AgendaM[];
  horarios: HorarioM[];
  marcacoes: MarcacaoM[];
  cancelamentos: (CancelamentoExame & { agenda: number })[];
  escala: Map<number, LinhaEscalaExame[]>;
  geracoes: Map<number, GeracaoGrade[]>;
  ext: Map<number, ExtensaoExame>;
  cobertura: (CoberturaExame & { ativo: boolean })[];
  seq: number;
  idem: Map<string, { hash: string; resultado: ResultadoOperacao }>;
}

export const CONVENIOS_EXAME_SINTETICOS = [
  { codigo: 10, nome: `PARTICULAR ${M}`, ativo: true },
  { codigo: 305, nome: `OPERADORA ALFA ${M}`, ativo: true },
  { codigo: 306, nome: `OPERADORA BETA ${M}`, ativo: true },
  { codigo: 307, nome: `OPERADORA GAMA ${M}`, ativo: false },
];
export const EXAMES_SINTETICOS = [
  { id: 7001, nome: 'ULTRASSONOGRAFIA DE ABDOME TOTAL', categoria: 24 },
  { id: 7002, nome: 'ULTRASSONOGRAFIA DE TIREOIDE', categoria: 24 },
  { id: 7003, nome: 'ENDOSCOPIA DIGESTIVA ALTA', categoria: 21 },
  { id: 7004, nome: 'COLONOSCOPIA', categoria: 21 },
  { id: 7005, nome: 'ELETROCARDIOGRAMA', categoria: 90 },
];
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];

function semear(r: RelogioEstabelecimento): Estado {
  const agendas: AgendaM[] = [
    {
      id: 951,
      nome: `ULTRASSOM ${M} A`,
      crm: 0,
      exame: 'U',
      categoria: 24,
      duracao: '00:20',
      ativa: true,
      unidade: 2,
      convenios: [],
    },
    {
      id: 952,
      nome: `ENDOSCOPIA ${M} B`,
      crm: 0,
      exame: 'E',
      categoria: 21,
      duracao: '00:30',
      ativa: true,
      unidade: 2,
      convenios: [10, 306],
    },
    {
      id: 953,
      nome: `METODOS GRAFICOS ${M} C`,
      crm: 0,
      exame: 'O',
      categoria: 42,
      duracao: '00:15',
      ativa: true,
      unidade: 2,
      convenios: [],
    },
    {
      id: 954,
      nome: `ULTRASSOM ${M} D`,
      crm: 0,
      exame: 'U',
      categoria: 24,
      duracao: '00:20',
      ativa: false,
      unidade: 2,
      convenios: [],
    },
  ];
  const e: Estado = {
    agendas,
    horarios: [],
    marcacoes: [],
    cancelamentos: [],
    escala: new Map(),
    geracoes: new Map(),
    ext: new Map(),
    cobertura: [
      {
        id: 1,
        agenda: 951,
        exame: 7001,
        exameNome: EXAMES_SINTETICOS[0]!.nome,
        convenio: null,
        convenioNome: null,
        ativo: true,
      },
      {
        id: 2,
        agenda: 951,
        exame: 7002,
        exameNome: EXAMES_SINTETICOS[1]!.nome,
        convenio: null,
        convenioNome: null,
        ativo: true,
      },
    ],
    seq: 8000,
    idem: new Map(),
  };
  const faixas: Record<number, { ini: string; fim: string }> = {
    951: { ini: '07:00', fim: '11:00' },
    952: { ini: '07:00', fim: '10:00' },
    953: { ini: '13:00', fim: '15:00' },
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
        exame: a.exame,
        ...FAIXA_SEM_EXTRAS,
      })),
    );
    e.geracoes.set(a.id, [
      {
        situacao: 'gerada',
        inicio: somar(r.hoje, -3),
        fim: somar(r.hoje, 21),
        em: somar(r.hoje, -3),
        hora: '09:00',
        duracao: a.duracao,
        dias: [2, 3, 4, 5, 6],
        usuario: `COORDENACAO.${M}`,
      },
    ]);
    for (let i = -3; i <= 21; i++) {
      const d = somar(r.hoje, i);
      if (semana(d) === 1 || semana(d) === 7 || FERIADOS.includes(d.slice(5))) continue;
      for (let m = min(f.ini); m + dur <= min(f.fim); m += dur)
        e.horarios.push({
          agenda: a.id,
          data: d,
          hora: horaDeMinutos(m),
          exame: a.exame,
          paciente: '',
          livre: 'S',
          situacao: '',
          tipo: 'N',
          conv: 0,
        });
    }
  }
  // Resíduo SINTÉTICO: um horário passado 'C' sem paciente (cancelamento antigo) e um futuro ocupado sem a marcação.
  const antigo = e.horarios.find((h) => h.agenda === 951 && h.data < r.hoje);
  if (antigo) antigo.situacao = 'C';
  const futuro = e.horarios.find((h) => h.agenda === 953 && h.data > r.hoje);
  if (futuro) futuro.paciente = `PACIENTE ${M} INCOMPLETO`;
  return e;
}

export class PortaExameMemoria implements PortaExame {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();
  constructor(
    private readonly catalogo: CatalogoOperacoesExame | null = null,
    private readonly lerPacientes: (
      c: ContextoPortaM18,
      ids: readonly number[],
    ) => Promise<
      {
        id: number;
        nome: string;
        prontuario: number;
        telefone: string | null;
        celular: string | null;
        ativo: boolean;
      }[]
    > = async () => [],
    private readonly relogioFn: () => RelogioEstabelecimento = () => relogioDoEstabelecimento(),
  ) {}

  private e(c: ContextoPortaM18): Estado {
    const chave = estabelecimentoDe(c);
    let s = this.porHospital.get(chave);
    if (!s) this.porHospital.set(chave, (s = semear(this.relogioFn())));
    return s;
  }

  private estado(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    const e = this.estado(op, estabelecimentoDe(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    const desligada = OPERACOES_EXAME_DESLIGADAS[op];
    if (desligada)
      return { pode: false, codigo: 'operacao-nao-liberada', motivo: `Operação desligada: ${desligada}.` };
    return { pode: true, codigo: null, motivo: null };
  }

  private agendaM(s: Estado, id: number): AgendaM {
    const a = s.agendas.find((x) => x.id === id);
    if (!a)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Agenda não encontrada',
        'A agenda de exames não existe mais.',
      );
    return a;
  }

  async executar(c: ContextoPortaM18, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const esquema = ESQUEMAS_OPERACAO_EXAME[op];
    if (!esquema) throw recusa('operacao-especificada', 'Operação desconhecida na agenda de exames.');
    const analise = esquema.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
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
    const desligada = OPERACOES_EXAME_DESLIGADAS[op];
    if (desligada) throw recusa('operacao-especificada', `Operação desligada: ${desligada}.`);
    const login = `USUARIO.${ctx.usuario ?? 0}`;
    const resultado = await this.aplicar(c, s, op, analise.data as Record<string, any>, login); // eslint-disable-line @typescript-eslint/no-explicit-any
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  private exigirConvenio(a: AgendaM, convenio: number) {
    const c = CONVENIOS_EXAME_SINTETICOS.find((x) => x.codigo === convenio);
    if (!c) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
    if (!c.ativo)
      throw recusa('convenio-inativo', 'O convênio está suspenso: não aceita marcação.', {
        campos: ['convenio'],
      });
    if (a.convenios.length > 0 && !a.convenios.includes(convenio))
      throw recusa(
        'convenio-nao-aceito',
        'A agenda não atende este convênio: escolha outra agenda do mesmo exame ou outro convênio.',
        { campos: ['convenio'] },
      );
  }

  private async paciente(c: ContextoPortaM18, id: number) {
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
      throw recusa(
        'sem-prontuario',
        'O paciente não tem prontuário: use a marcação sem prontuário ou complete o cadastro.',
      );
    return p;
  }

  private vaga(s: Estado, a: AgendaM, data: string, hora: string, r: RelogioEstabelecimento): HorarioM {
    if (!a.ativa)
      throw recusa('agenda-inativa', 'A agenda de exames está inativa: não aceita marcação nem geração.');
    if (passou({ data, hora }, r))
      throw recusa('horario-passado', 'O horário já passou pelo relógio do servidor: escolha outro.');
    const h = s.horarios.find((x) => x.agenda === a.id && x.data === data && x.hora === hora);
    if (!h) throw recusa('horario-inexistente', 'O horário não existe na grade da agenda de exames.');
    if (h.paciente !== '' || h.livre === 'N' || h.situacao !== '' || h.tipo === 'E')
      throw recusa(
        'horario-ocupado',
        'O horário foi ocupado ou bloqueado em outro terminal enquanto você marcava. Escolha outro horário.',
      );
    return h;
  }

  private marcar(
    s: Estado,
    a: AgendaM,
    h: HorarioM,
    p: { id: number; nome: string; prontuario: number; telefone: string | null; celular: string | null },
    conv: number,
    obs: string | null,
    r: RelogioEstabelecimento,
    login: string,
  ): MarcacaoM {
    h.paciente = p.nome;
    h.conv = conv;
    const m: MarcacaoM = {
      id: ++s.seq,
      agenda: a.id,
      data: h.data,
      hora: h.hora,
      idPaciente: p.id,
      pront: p.prontuario,
      paciente: p.nome,
      conv,
      atendido: false,
      usuario: login,
      dtAge: r.hoje,
      hrAge: r.hora,
      fone: p.telefone ?? '',
      celular: p.celular ?? '',
      obs,
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
    if (m.atendido)
      throw recusa('ja-atendido', 'O exame já foi atendido: a marcação não pode mais ser desfeita.');
    if (m.senha)
      throw recusa(
        'paciente-com-senha',
        'O paciente já fez o check-in (senha de atendimento ligada): cancelar agora exige o perfil de supervisor da recepção.',
      );
    return m;
  }

  private desfazer(s: Estado, m: MarcacaoM, motivo: string, r: RelogioEstabelecimento, login: string) {
    const a = this.agendaM(s, m.agenda);
    s.cancelamentos.unshift({
      agenda: a.id,
      nomeAgenda: a.nome,
      data: m.data,
      hora: m.hora,
      paciente: m.paciente,
      motivo,
      canceladoEm: r.hoje,
      horaCancelamento: r.hora,
      canceladoPor: login,
      marcadoPor: m.usuario,
      convenio: m.conv,
    });
    const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
    if (h) Object.assign(h, { paciente: '', conv: 0, situacao: '' });
    s.marcacoes = s.marcacoes.filter((x) => x.id !== m.id);
  }

  private async aplicar(
    c: ContextoPortaM18,
    s: Estado,
    op: string,
    e: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    login: string,
  ): Promise<ResultadoOperacao> {
    const r = this.relogioFn();
    switch (op) {
      case 'agenda.agendarExame': {
        const a = this.agendaM(s, e['agenda']);
        const h = this.vaga(s, a, e['data'], normalizarHora(e['hora']), r);
        const p = await this.paciente(c, e['paciente']);
        this.exigirConvenio(a, e['convenio']);
        const m = this.marcar(s, a, h, p, e['convenio'], e['observacao'] ?? null, r, login);
        const ex = EXAMES_SINTETICOS.find((x) => x.id === e['exame']);
        s.ext.set(m.id, {
          marcacao: m.id,
          idExame: e['exame'] ?? null,
          exameNome: ex?.nome ?? null,
          solicitante: e['solicitante'] ?? null,
          retorno: e['retorno'] === true,
          canal: e['canal'],
        });
        return { marcacao: m.id, agenda: a.id };
      }
      // 02-AGE 44: sem prontuário (na memória, a pessoa fica na marcação; o banco grava o pré-cadastro).
      case 'agenda.agendarExameSemProntuario': {
        const a = this.agendaM(s, e['agenda']);
        const h = this.vaga(s, a, e['data'], normalizarHora(e['hora']), r);
        this.exigirConvenio(a, e['convenio']);
        const fone = String(e['telefone']);
        const pessoa = { id: 0, nome: String(e['nome']), prontuario: 0, telefone: fone, celular: null };
        const m = this.marcar(s, a, h, pessoa, e['convenio'], null, r, login);
        m.idPaciente = null;
        const ex = EXAMES_SINTETICOS.find((x) => x.id === e['exame']);
        s.ext.set(m.id, {
          marcacao: m.id,
          idExame: e['exame'] ?? null,
          exameNome: ex?.nome ?? null,
          solicitante: null,
          retorno: false,
          canal: e['canal'],
        });
        return { marcacao: m.id, agenda: a.id };
      }
      case 'agenda.cancelarExame': {
        const m = this.marcacaoM(s, e['marcacao']);
        this.desfazer(s, m, textoCurtoDoMotivo(e['motivo'], e['complemento']), r, login);
        return { marcacao: m.id, agenda: m.agenda, data: m.data, hora: m.hora };
      }
      case 'agenda.remarcarExame': {
        const m = this.marcacaoM(s, e['marcacao']);
        const novo = this.agendaM(s, e['destino']['agenda']);
        const horaDestino = normalizarHora(e['destino']['hora']);
        if (novo.id === m.agenda && e['destino']['data'] === m.data && horaDestino === m.hora)
          throw recusa('mesmo-horario', 'O horário novo é o mesmo da marcação.');
        const h = this.vaga(s, novo, e['destino']['data'], horaDestino, r);
        if (m.pront <= 0 || m.idPaciente === null)
          throw recusa(
            'sem-prontuario',
            'A marcação não tem cadastro com prontuário: marque de novo pelo cadastro.',
          );
        const p = await this.paciente(c, m.idPaciente);
        const conv = e['convenio'] ?? m.conv;
        this.exigirConvenio(novo, conv);
        if (e['modo'] === 'transferir') {
          const velho = s.horarios.find(
            (x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora,
          );
          if (velho) velho.situacao = 'T';
        } else this.desfazer(s, m, textoCurtoDoMotivo(e['motivo'], e['complemento']), r, login);
        const n = this.marcar(s, novo, h, p, conv, e['observacao'] ?? m.obs, r, login);
        const ant = s.ext.get(m.id);
        s.ext.set(n.id, {
          marcacao: n.id,
          idExame: ant?.idExame ?? null,
          exameNome: ant?.exameNome ?? null,
          solicitante: ant?.solicitante ?? null,
          retorno: ant?.retorno ?? false,
          canal: e['canal'],
        });
        return { marcacao: n.id, anterior: m.id };
      }
      case 'agenda.gerarGradeExame': {
        const a = this.agendaM(s, e['agenda']);
        if (!a.ativa)
          throw recusa('agenda-inativa', 'A agenda de exames está inativa: não aceita marcação nem geração.');
        const horarios = (e['horarios'] as { data: string; hora: string }[]).map((h) => ({
          data: h.data,
          hora: normalizarHora(h.hora),
        }));
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
            data: h.data,
            hora: h.hora,
            exame: a.exame,
            paciente: '',
            livre: 'S',
            situacao: '',
            tipo: 'N',
            conv: 0,
          });
        const escala = e['escala'] as {
          semana: number;
          duracao: string;
          horaInicio: string;
          horaFim: string;
        }[];
        s.escala.set(
          a.id,
          escala.map((l) => ({
            semana: l.semana,
            duracao: normalizarHora(l.duracao),
            horaInicio: normalizarHora(l.horaInicio),
            horaFim: normalizarHora(l.horaFim),
            exame: a.exame,
            ...FAIXA_SEM_EXTRAS,
          })),
        );
        s.geracoes.set(a.id, [
          {
            situacao: 'gerada',
            inicio: e['de'],
            fim: e['ate'],
            em: r.hoje,
            hora: r.hora,
            duracao: normalizarHora(e['duracao']),
            dias: (e['semanas'] as string[]).flatMap((x, i) => (x === 'T' ? [i + 1] : [])),
            usuario: login,
          },
          ...(s.geracoes.get(a.id) ?? []),
        ]);
        return { agenda: a.id, horarios: horarios.length };
      }
      case 'agenda.definirCoberturaExame': {
        const a = this.agendaM(s, e['agenda']);
        const conv = e['convenio'] as number;
        if (e['acao'] === 'incluir') {
          if (!CONVENIOS_EXAME_SINTETICOS.some((x) => x.codigo === conv))
            throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
          if (a.convenios.includes(conv)) throw recusa('ja-coberto', 'O convênio já está na agenda.');
          a.convenios.push(conv);
        } else {
          if (!a.convenios.includes(conv)) throw recusa('nao-coberto', 'O convênio não está na agenda.');
          if (a.convenios.length === 1 && e['confirmarAceitarTodos'] !== true)
            throw recusa(
              'ultima-linha',
              'É o último convênio da agenda: sem nenhum, a agenda passa a aceitar TODOS os convênios. Confirme para seguir.',
            );
          a.convenios = a.convenios.filter((x) => x !== conv);
        }
        return { agenda: a.id, convenio: conv };
      }
      default:
        throw recusa('operacao-especificada', 'Operação ainda desligada.');
    }
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorCoberturaExame) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    return fn({
      incluirCobertura: async (r) => {
        if (
          s.cobertura.some(
            (x) => x.ativo && x.agenda === r.agenda && x.exame === r.exame && x.convenio === r.convenio,
          )
        )
          throw recusa('ja-coberto', 'Esta cobertura já está na agenda.');
        const id = ++s.seq;
        s.cobertura.push({
          id,
          agenda: r.agenda,
          exame: r.exame,
          exameNome: EXAMES_SINTETICOS.find((x) => x.id === r.exame)?.nome ?? `Exame ${r.exame}`,
          convenio: r.convenio,
          convenioNome: CONVENIOS_EXAME_SINTETICOS.find((x) => x.codigo === r.convenio)?.nome ?? null,
          ativo: true,
        });
        return id;
      },
      encerrarCobertura: async (r) => {
        let k = 0;
        for (const x of s.cobertura)
          if (x.ativo && x.agenda === r.agenda && x.exame === r.exame && x.convenio === r.convenio) {
            x.ativo = false;
            k++;
          }
        return k;
      },
    });
  }

  async relogio(): Promise<RelogioEstabelecimento> {
    return this.relogioFn();
  }

  private lida(s: Estado, a: AgendaM): AgendaExame {
    const datas = s.horarios
      .filter((h) => h.agenda === a.id)
      .map((h) => h.data)
      .sort();
    return {
      id: a.id,
      nome: a.nome,
      crm: a.crm,
      exame: a.exame,
      categoria: a.categoria,
      duracao: a.duracao,
      ativa: a.ativa,
      unidade: a.unidade,
      inicio: datas[0] ?? null,
      fim: datas.at(-1) ?? null,
      convenios: a.convenios.length,
    };
  }

  async agendas(c: ContextoPortaM18) {
    const s = this.e(c);
    return s.agendas.map((a) => this.lida(s, a));
  }

  async agenda(c: ContextoPortaM18, id: number) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.id === id);
    return a ? this.lida(s, a) : null;
  }

  async convenios(c: ContextoPortaM18, id: number) {
    const a = this.e(c).agendas.find((x) => x.id === id);
    return (a?.convenios ?? []).map((k) => ({
      codigo: k,
      nome: CONVENIOS_EXAME_SINTETICOS.find((x) => x.codigo === k)?.nome ?? `Convênio ${k}`,
    }));
  }

  async escala(c: ContextoPortaM18, agenda: number, periodo?: { de: string; ate: string }) {
    const linhas = this.e(c).escala.get(agenda) ?? [];
    return periodo
      ? linhas.filter(
          (l) => l.vigenciaInicio <= periodo.ate && (l.vigenciaFim === null || l.vigenciaFim >= periodo.de),
        )
      : linhas;
  }

  async horariosExistentes(c: ContextoPortaM18, agenda: number, de: string, ate: string) {
    return this.e(c)
      .horarios.filter((h) => h.agenda === agenda && h.data >= de && h.data <= ate)
      .map((h) => `${h.data} ${h.hora}`);
  }

  async geracoes(c: ContextoPortaM18, agenda: number) {
    return this.e(c).geracoes.get(agenda) ?? [];
  }

  async feriados() {
    return FERIADOS.map((md) => ({ data: `9999-${md}`, nome: 'Feriado' }));
  }

  async horarios(c: ContextoPortaM18, agenda: number, de: string, ate: string) {
    const s = this.e(c);
    const itens = s.horarios
      .filter((h) => h.agenda === agenda && h.data >= de && h.data <= ate)
      .sort((x, y) => (x.data + x.hora).localeCompare(y.data + y.hora))
      .map((h) => {
        const marcacao =
          s.marcacoes.find((m) => m.agenda === h.agenda && m.data === h.data && m.hora === h.hora)?.id ??
          null;
        return {
          data: h.data,
          hora: h.hora,
          exame: h.exame,
          estado: estadoDoHorarioExame({ ...h, temMarcacao: marcacao !== null }),
          paciente: h.paciente || null,
          convenio: h.conv || null,
          marcacao,
        };
      });
    return { itens, truncado: false };
  }

  async vagas(
    c: ContextoPortaM18,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ) {
    const s = this.e(c);
    const r = this.relogioFn();
    const teto = Math.min(f.limite ?? 500, 500);
    const todas = s.horarios
      .filter((h) => {
        const a = s.agendas.find((x) => x.id === h.agenda);
        return (
          a?.ativa === true &&
          (!f.agendas || f.agendas.includes(h.agenda)) &&
          h.data >= f.de &&
          h.data <= f.ate &&
          !passou(h, r) &&
          h.paciente === '' &&
          h.livre !== 'N' &&
          h.situacao === '' &&
          h.tipo !== 'E'
        );
      })
      .sort((x, y) => (x.data + x.hora).localeCompare(y.data + y.hora));
    return {
      truncado: todas.length > teto,
      itens: todas.slice(0, teto).map((h) => {
        const a = s.agendas.find((x) => x.id === h.agenda) as AgendaM;
        return {
          agenda: a.id,
          nomeAgenda: a.nome,
          categoria: a.categoria,
          data: h.data,
          hora: h.hora,
          exame: h.exame,
        };
      }),
    };
  }

  private marcacaoDe(s: Estado, m: MarcacaoM): MarcacaoExame {
    const a = s.agendas.find((x) => x.id === m.agenda);
    const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
    const estado = h ? estadoDoHorarioExame({ ...h, livre: 'N', tipo: 'N', temMarcacao: true }) : 'outro';
    return {
      id: m.id,
      agenda: m.agenda,
      nomeAgenda: a?.nome ?? '',
      categoriaAgenda: a?.categoria ?? 0,
      data: m.data,
      hora: m.hora,
      paciente: m.paciente,
      idPaciente: m.idPaciente,
      prontuario: m.pront,
      convenio: m.conv,
      estado,
      situacao: SITUACAO_DO_ESTADO[estado],
      atendido: m.atendido,
      usuario: m.usuario,
      marcadaEm: m.dtAge,
      temSenha: m.senha,
    };
  }

  async marcacoesDoDia(c: ContextoPortaM18, data: string, agenda: number | null) {
    const s = this.e(c);
    const itens = s.marcacoes
      .filter((m) => m.data === data && (agenda === null || m.agenda === agenda))
      .sort((x, y) => x.hora.localeCompare(y.hora))
      .map((m) => this.marcacaoDe(s, m));
    return { itens, truncado: false };
  }

  async marcacoesDoPaciente(c: ContextoPortaM18, id: number) {
    const s = this.e(c);
    const itens = s.marcacoes
      .filter((m) => m.idPaciente === id)
      .sort((x, y) => (y.data + y.hora).localeCompare(x.data + x.hora))
      .map((m) => this.marcacaoDe(s, m));
    return { itens, truncado: false };
  }

  async marcacao(c: ContextoPortaM18, id: number) {
    const s = this.e(c);
    const m = s.marcacoes.find((x) => x.id === id);
    if (!m) return null;
    return {
      marcacao: this.marcacaoDe(s, m),
      contato: { telefone: m.fone, celular: m.celular, email: '', observacao: m.obs },
    };
  }

  async cancelamentos(
    c: ContextoPortaM18,
    f: { de: string; ate: string; agendas: readonly number[] | null; pagina: number; porPagina: number },
  ) {
    const todos = this.e(c).cancelamentos.filter(
      (x) => x.canceladoEm >= f.de && x.canceladoEm <= f.ate && (!f.agendas || f.agendas.includes(x.agenda)),
    );
    const ini = (f.pagina - 1) * f.porPagina;
    return {
      itens: todos.slice(ini, ini + f.porPagina).map((linha) => {
        const { agenda, ...x } = linha;
        void agenda;
        return x;
      }),
      total: todos.length,
    };
  }

  async residuo(c: ContextoPortaM18, de: string, ate: string) {
    const s = this.e(c);
    const porAgenda = new Map<
      number,
      { agenda: number; nomeAgenda: string; confirmadosSemPaciente: number; ocupadosSemMarcacao: number }
    >();
    const horarios: {
      nomeAgenda: string;
      data: string;
      hora: string;
      tipo: 'confirmado-sem-paciente' | 'sem-marcacao';
    }[] = [];
    for (const h of s.horarios.filter((x) => x.data >= de && x.data <= ate)) {
      const a = s.agendas.find((x) => x.id === h.agenda) as AgendaM;
      const semMarc =
        h.paciente !== '' &&
        !s.marcacoes.some((m) => m.agenda === h.agenda && m.data === h.data && m.hora === h.hora);
      const conf = h.paciente === '' && h.situacao === 'C';
      if (!semMarc && !conf) continue;
      const linha = porAgenda.get(a.id) ?? {
        agenda: a.id,
        nomeAgenda: a.nome,
        confirmadosSemPaciente: 0,
        ocupadosSemMarcacao: 0,
      };
      if (conf) linha.confirmadosSemPaciente++;
      else linha.ocupadosSemMarcacao++;
      porAgenda.set(a.id, linha);
      horarios.push({
        nomeAgenda: a.nome,
        data: h.data,
        hora: h.hora,
        tipo: conf ? 'confirmado-sem-paciente' : 'sem-marcacao',
      });
    }
    return { porAgenda: [...porAgenda.values()], horarios, truncado: false };
  }

  async opcoes() {
    return { convenios: [...CONVENIOS_EXAME_SINTETICOS], exames: [...EXAMES_SINTETICOS] };
  }

  async extensoes(c: ContextoPortaM18, ids: readonly number[]) {
    const s = this.e(c);
    return new Map(
      ids.flatMap((id) => (s.ext.has(id) ? [[id, s.ext.get(id) as ExtensaoExame] as const] : [])),
    );
  }

  async cobertura(c: ContextoPortaM18, agenda: number | null) {
    return this.e(c)
      .cobertura.filter((x) => x.ativo && (agenda === null || x.agenda === agenda))
      .map((x) => ({
        id: x.id,
        agenda: x.agenda,
        exame: x.exame,
        exameNome: x.exameNome,
        convenio: x.convenio,
        convenioNome: x.convenioNome,
      }));
  }
}

/** Chave do estado sintético: o cliente e o estabelecimento da sessão. */
function estabelecimentoDe(c: ContextoPortaM18): string {
  return `${c.cliente}:${c.estabelecimento ?? 0}`;
}

/** Situação da marcação (vocabulário do cadastro: situacao_marcacao.significado) a partir do estado do horário. */
const SITUACAO_DO_ESTADO: Readonly<Record<MarcacaoExame['estado'], string>> = {
  vago: 'aguardando',
  bloqueado: 'bloqueada',
  marcado: 'aguardando',
  confirmado: 'confirmada',
  realizado: 'realizada',
  transferido: 'cancelada',
  'marcacao-incompleta': 'aguardando',
  'residuo-confirmado-sem-paciente': 'confirmada',
  outro: 'aguardando',
};
