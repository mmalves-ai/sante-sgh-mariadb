// Porta da agenda de exames EM MEMÓRIA (M18): a sessão sintética de dev/ci (E2E) lê e grava agendas, horários,
// marcações, cancelamentos e a cobertura SINTÉTICOS, sem tocar a cópia. As gravações aplicam o mesmo Zod das receitas
// (operacao(op).entrada) e as mesmas recusas (agenda inativa, horário inexistente, ocupado ou passado, convênio
// inativo ou não aceito, paciente sem prontuário, check-in, a última linha da cobertura, prévia desatualizada); o
// relógio é o do estabelecimento (America/Sao_Paulo). Os pacientes são os do cadastro em memória (marca
// "SINTETICO"). Nenhum nome aqui é de pessoa real; os nomes de exame são do vocabulário clínico.
import { type EstadoOperacao, textoCurtoDoMotivo } from '@sgh/contratos';
import { tpAgeDaMarcacao } from '@sgh/dominio-agenda';
import {
  type AgendaExameLida,
  type CancelamentoExameLido,
  type CoberturaExameLida,
  type ContextoOperacao,
  ErroOperacao,
  type ExtensaoExameLida,
  type FonteCatalogo,
  type GeracaoLida,
  type LiberacaoConsultada,
  type LinhaEscalaExameLida,
  type MarcacaoExameLida,
  operacao,
  recusa,
  type RelogioLido,
  type ResultadoOperacao,
} from '@sgh/legado';
import { relogioLocal } from '../agenda/public-api.js';
import type { ContextoPortaM18 } from './apoio-gravacao.js';
import type { GravadorSghExame, PortaExame } from './porta.js';

const M = 'SINTETICO';

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const semana = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() + 1;
const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(2, 4));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
const passou = (h: { data: string; hora: string }, r: RelogioLido) =>
  h.data < r.hoje || (h.data === r.hoje && h.hora <= r.hhmm);

interface AgendaM {
  id: number;
  nome: string;
  crm: number;
  exame: string;
  categoria: number;
  duracao: string;
  ativa: string;
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
  tpAge: number;
  atendido: string;
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
  cancelamentos: CancelamentoExameLido[];
  escala: Map<number, LinhaEscalaExameLida[]>;
  geracoes: Map<number, GeracaoLida[]>;
  ext: Map<number, ExtensaoExameLida>;
  cobertura: (CoberturaExameLida & { ativo: boolean })[];
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

function semear(r: RelogioLido): Estado {
  const agendas: AgendaM[] = [
    {
      id: 951,
      nome: `ULTRASSOM ${M} A`,
      crm: 0,
      exame: 'U',
      categoria: 24,
      duracao: '0020',
      ativa: 'S',
      unidade: 2,
      convenios: [],
    },
    {
      id: 952,
      nome: `ENDOSCOPIA ${M} B`,
      crm: 0,
      exame: 'E',
      categoria: 21,
      duracao: '0030',
      ativa: 'S',
      unidade: 2,
      convenios: [10, 306],
    },
    {
      id: 953,
      nome: `METODOS GRAFICOS ${M} C`,
      crm: 0,
      exame: 'O',
      categoria: 42,
      duracao: '0015',
      ativa: 'S',
      unidade: 2,
      convenios: [],
    },
    {
      id: 954,
      nome: `ULTRASSOM ${M} D`,
      crm: 0,
      exame: 'U',
      categoria: 24,
      duracao: '0020',
      ativa: 'N',
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
    951: { ini: '0700', fim: '1100' },
    952: { ini: '0700', fim: '1000' },
    953: { ini: '1300', fim: '1500' },
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
      })),
    );
    e.geracoes.set(a.id, [
      {
        status: 'C',
        inicio: somar(r.hoje, -3),
        fim: somar(r.hoje, 21),
        em: somar(r.hoje, -3),
        hora: '0900',
        duracao: a.duracao,
        semanas: 'FTTTTTF',
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
          hora: hhmm(m),
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
    private readonly catalogo: FonteCatalogo | null = null,
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
    private readonly relogioFn: () => RelogioLido = () => relogioLocal(),
  ) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) this.porHospital.set(c.hospital, (s = semear(this.relogioFn())));
    return s;
  }

  private estado(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoConsultada> {
    const e = this.estado(op, c.hospital);
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    const r = operacao(op).receita;
    if (r.pendente)
      return { pode: false, codigo: 'operacao-nao-liberada', motivo: `Falta provar: ${r.pendente}.` };
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
    const o = operacao(op);
    const analise = o.entrada.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.idempotencyKey}`;
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
    if (o.receita.pendente) throw recusa('operacao-especificada', `Falta provar: ${o.receita.pendente}.`);
    const resultado = await this.aplicar(c, s, op, analise.data as Record<string, any>, ctx.usuarioLegado); // eslint-disable-line @typescript-eslint/no-explicit-any
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

  private vaga(s: Estado, a: AgendaM, data: string, hora: string, r: RelogioLido): HorarioM {
    if (a.ativa !== 'S')
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
    r: RelogioLido,
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
      tpAge: tpAgeDaMarcacao(a.categoria, h.exame),
      atendido: 'F',
      usuario: login,
      dtAge: r.hoje,
      hrAge: r.hhmm,
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
    if (m.atendido === 'T')
      throw recusa('ja-atendido', 'O exame já foi atendido: a marcação não pode mais ser desfeita.');
    if (m.senha)
      throw recusa(
        'paciente-com-senha',
        'O paciente já fez o check-in (senha de atendimento ligada): cancelar agora exige o perfil de supervisor da recepção.',
      );
    return m;
  }

  private desfazer(s: Estado, m: MarcacaoM, motivo: string, r: RelogioLido, login: string) {
    const a = this.agendaM(s, m.agenda);
    s.cancelamentos.unshift({
      nomeAgenda: a.nome,
      data: m.data,
      hora: m.hora,
      paciente: m.paciente,
      motivo,
      canceladoEm: r.hoje,
      horaCancelamento: r.hhmm,
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
        const h = this.vaga(s, a, e['data'], e['hora'], r);
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
      case 'agenda.cancelarExame': {
        const m = this.marcacaoM(s, e['marcacao']);
        this.desfazer(s, m, textoCurtoDoMotivo(e['motivo'], e['complemento']), r, login);
        return {
          marcacao: m.id,
          nome: this.agendaM(s, m.agenda).nome,
          crm: 0,
          data: m.data,
          hora: m.hora,
          hrCan: r.hhmm,
        };
      }
      case 'agenda.remarcarExame': {
        const m = this.marcacaoM(s, e['marcacao']);
        const novo = this.agendaM(s, e['destino']['agenda']);
        if (novo.id === m.agenda && e['destino']['data'] === m.data && e['destino']['hora'] === m.hora)
          throw recusa('mesmo-horario', 'O horário novo é o mesmo da marcação.');
        const h = this.vaga(s, novo, e['destino']['data'], e['destino']['hora'], r);
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
        if (a.ativa !== 'S')
          throw recusa('agenda-inativa', 'A agenda de exames está inativa: não aceita marcação nem geração.');
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
            duracao: l.duracao,
            horaInicio: l.horaInicio,
            horaFim: l.horaFim,
            exame: a.exame,
          })),
        );
        s.geracoes.set(a.id, [
          {
            status: 'C',
            inicio: e['de'],
            fim: e['ate'],
            em: r.hoje,
            hora: r.hhmm,
            duracao: e['duracao'],
            semanas: (e['semanas'] as string[]).join(''),
            usuario: login,
          },
          ...(s.geracoes.get(a.id) ?? []),
        ]);
        return { agenda: a.id, horarios: horarios.length, dtCriacao: r.hoje, hrCriacao: r.hhmm };
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
    fn: (g: GravadorSghExame) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    return fn({
      incluirCobertura: async (r) => {
        if (
          s.cobertura.some(
            (x) => x.ativo && x.agenda === r.agenda && x.exame === r.idExame && x.convenio === r.convenio,
          )
        )
          throw recusa('ja-coberto', 'Esta cobertura já está na agenda.');
        const id = ++s.seq;
        s.cobertura.push({
          id,
          agenda: r.agenda,
          exame: r.idExame,
          exameNome: EXAMES_SINTETICOS.find((x) => x.id === r.idExame)?.nome ?? `Exame ${r.idExame}`,
          convenio: r.convenio,
          convenioNome: CONVENIOS_EXAME_SINTETICOS.find((x) => x.codigo === r.convenio)?.nome ?? null,
          ativo: true,
        });
        return id;
      },
      encerrarCobertura: async (r) => {
        let k = 0;
        for (const x of s.cobertura)
          if (x.ativo && x.agenda === r.agenda && x.exame === r.idExame && x.convenio === r.convenio) {
            x.ativo = false;
            k++;
          }
        return k;
      },
    });
  }

  async relogio(): Promise<RelogioLido> {
    return this.relogioFn();
  }

  private lida(s: Estado, a: AgendaM): AgendaExameLida {
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

  async escala(c: ContextoPortaM18, nome: string) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.nome === nome);
    return a ? (s.escala.get(a.id) ?? []) : [];
  }

  async geracoes(c: ContextoPortaM18, nome: string) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.nome === nome);
    return a ? (s.geracoes.get(a.id) ?? []) : [];
  }

  async feriados() {
    return FERIADOS.map((md) => ({ data: `9999-${md}`, nome: 'Feriado' }));
  }

  async horarios(c: ContextoPortaM18, nome: string, _crm: number, de: string, ate: string) {
    const s = this.e(c);
    const a = s.agendas.find((x) => x.nome === nome);
    const itens = s.horarios
      .filter((h) => a && h.agenda === a.id && h.data >= de && h.data <= ate)
      .sort((x, y) => (x.data + x.hora).localeCompare(y.data + y.hora))
      .map((h) => ({
        data: h.data,
        hora: h.hora,
        exame: h.exame,
        paciente: h.paciente,
        livre: h.livre,
        situacao: h.situacao,
        tipo: h.tipo,
        convenio: h.conv || null,
        marcacao:
          s.marcacoes.find((m) => m.agenda === h.agenda && m.data === h.data && m.hora === h.hora)?.id ??
          null,
      }));
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
          a?.ativa === 'S' &&
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

  private marcacaoLida(s: Estado, m: MarcacaoM): MarcacaoExameLida {
    const a = s.agendas.find((x) => x.id === m.agenda);
    const h = s.horarios.find((x) => x.agenda === m.agenda && x.data === m.data && x.hora === m.hora);
    return {
      id: m.id,
      agenda: m.agenda,
      nomeAgenda: a?.nome ?? '',
      crm: 0,
      categoriaAgenda: a?.categoria ?? 0,
      data: m.data,
      hora: m.hora,
      paciente: m.paciente,
      idPaciente: m.idPaciente,
      prontuario: m.pront,
      convenio: m.conv,
      tpAge: m.tpAge,
      atendido: m.atendido,
      situacaoHorario: h?.situacao ?? '',
      pacienteHorario: h?.paciente ?? '',
      exameHorario: h?.exame ?? '',
      temHorario: !!h,
      usuario: m.usuario,
      marcadaEm: m.dtAge,
      horaMarcacao: m.hrAge,
      temSenha: m.senha,
    };
  }

  async marcacoesDoDia(c: ContextoPortaM18, data: string, agenda: { nome: string; crm: number } | null) {
    const s = this.e(c);
    const ag = agenda ? s.agendas.find((x) => x.nome === agenda.nome) : null;
    const itens = s.marcacoes
      .filter((m) => m.data === data && (!agenda || m.agenda === ag?.id))
      .sort((x, y) => x.hora.localeCompare(y.hora))
      .map((m) => this.marcacaoLida(s, m));
    return { itens, truncado: false };
  }

  async marcacoesDoPaciente(c: ContextoPortaM18, id: number) {
    const s = this.e(c);
    const itens = s.marcacoes
      .filter((m) => m.idPaciente === id)
      .sort((x, y) => (y.data + y.hora).localeCompare(x.data + x.hora))
      .map((m) => this.marcacaoLida(s, m));
    return { itens, truncado: false };
  }

  async marcacao(c: ContextoPortaM18, id: number) {
    const s = this.e(c);
    const m = s.marcacoes.find((x) => x.id === id);
    if (!m) return null;
    return {
      marcacao: this.marcacaoLida(s, m),
      contato: { telefone: m.fone, celular: m.celular, email: '', observacao: m.obs },
    };
  }

  async cancelamentos(
    c: ContextoPortaM18,
    f: { de: string; ate: string; agendas: readonly string[] | null; pagina: number; porPagina: number },
  ) {
    const todos = this.e(c).cancelamentos.filter(
      (x) =>
        x.canceladoEm >= f.de && x.canceladoEm <= f.ate && (!f.agendas || f.agendas.includes(x.nomeAgenda)),
    );
    const ini = (f.pagina - 1) * f.porPagina;
    return { itens: todos.slice(ini, ini + f.porPagina), total: todos.length };
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
      ids.flatMap((id) => (s.ext.has(id) ? [[id, s.ext.get(id) as ExtensaoExameLida] as const] : [])),
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
