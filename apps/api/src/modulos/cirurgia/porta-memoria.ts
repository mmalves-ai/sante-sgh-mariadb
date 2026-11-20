// Porta do centro cirúrgico EM MEMÓRIA (M18): a sessão sintética de dev/ci (E2E) lê e grava salas, agendamentos,
// solicitações, pendências e cirurgias realizadas SINTÉTICOS, sem tocar a cópia. As gravações aplicam o mesmo Zod das
// receitas (operacao(op).entrada) e as mesmas recusas (sala não permitida, horário passado, sala ocupada sem exceção,
// profissional que não confere, tempos inválidos, cirurgia com procedimento adicional na remarcação); o relógio é o
// do estabelecimento (America/Sao_Paulo). Os pacientes são os do cadastro em memória (marca "SINTETICO"). Nenhum nome
// aqui é de pessoa real; os nomes de procedimento e anestesia são do vocabulário clínico.
import { type EstadoOperacao, RECURSOS_SALA } from '@sgh/contratos';
import { conferirTempos, conflitosNaSala, somarMinutos } from '@sgh/dominio-cirurgia';
import {
  type AgendamentoLido,
  type CancelamentoCirurgiaLido,
  conferirAlteracaoPedido,
  type ContextoOperacao,
  ErroOperacao,
  type EstadoCirurgiaLido,
  type FiltroRealizadas,
  type FonteCatalogo,
  type HistoricoLido,
  type LiberacaoConsultada,
  type LigacaoCirurgiaLida,
  operacao,
  type PendenciaLida,
  type RealizadaLida,
  recusa,
  type RegistroExtLido,
  type RelogioLido,
  type ResultadoOperacao,
  type VersaoPedidoLida,
} from '@sgh/legado';
import { relogioLocal } from '../agenda/public-api.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorSghCirurgia, PacienteDaCirurgia, PortaCirurgia } from './porta.js';

const M = 'SINTETICO';

const somarDia = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const diaUtil = (hoje: string, depois: number) => {
  let d = hoje;
  let k = 0;
  while (k < depois) {
    d = somarDia(d, 1);
    const s = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (s !== 0 && s !== 6) k++;
  }
  return d;
};
const instante = (data: string, hhmm: string) => `${data} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;

export const SALAS_SINTETICAS = [
  { codigo: 1, nome: `SALA CIRURGICA ${M} 1`, cdc: 101 },
  { codigo: 2, nome: `SALA CIRURGICA ${M} 2`, cdc: 102 },
  { codigo: 3, nome: `SALA CIRURGICA ${M} 3`, cdc: 103 },
];
export const PROFISSIONAIS_SINTETICOS = [
  { id: 5001, cod: 9001, nome: `CIRURGIAO ${M} A` },
  { id: 5002, cod: 9002, nome: `ANESTESISTA ${M} B` },
  { id: 5003, cod: 9003, nome: `AUXILIAR ${M} C` },
  { id: 5004, cod: 9004, nome: `INSTRUMENTADOR ${M} D` },
  { id: 5005, cod: 9005, nome: `CIRURGIAO ${M} E` },
];
/**
 * M50 (etapa 3): registros do corpo clínico que ainda não atuaram no bloco (fora das opções do mapa), como o do conselho
 * do cirurgião externo sintético (o mesmo profissional do 5001): a confirmação do pedido do portal o acrescenta.
 */
export const REGISTROS_FORA_DO_BLOCO = [{ id: 5102, cod: 54321, nome: `CIRURGIAO ${M} A` }];
const TODOS_OS_REGISTROS = [...PROFISSIONAIS_SINTETICOS, ...REGISTROS_FORA_DO_BLOCO];
/** Revisão do M46.1 (regra 3): o instrumentador sintético (5004) não é médico; os demais registros são de médico. */
export const REGISTROS_NAO_MEDICOS: ReadonlySet<number> = new Set([5004]);
export const PROCEDIMENTOS_SINTETICOS = [
  { codigo: 30101271, nome: 'COLECISTECTOMIA' },
  { codigo: 30101522, nome: 'HERNIORRAFIA INGUINAL' },
  { codigo: 30715016, nome: 'ARTROSCOPIA DE JOELHO' },
  { codigo: 31303080, nome: 'CESARIANA' },
];
const ANESTESIAS = [
  { codigo: 1, nome: 'GERAL' },
  { codigo: 2, nome: 'RAQUIDIANA' },
  { codigo: 3, nome: 'LOCAL' },
];
const CONVENIOS = [
  { codigo: 10, nome: `PARTICULAR ${M}`, ativo: true },
  { codigo: 306, nome: `OPERADORA BETA ${M}`, ativo: true },
];
const ESPECIALIDADES = [
  { codigo: 33, nome: 'CIRURGIA GERAL' },
  { codigo: 21, nome: 'ORTOPEDIA' },
  { codigo: 15, nome: 'GINECOLOGIA E OBSTETRICIA' },
];
/** Logins sintéticos que são usuários permitidos das salas 1 e 2 (a sala 3 fica sem nenhum deles). */
const LOGINS_DO_BLOCO = ['SINT.BLOCO', 'SINT.ADMIN'];

type Mut<T> = { -readonly [K in keyof T]: T[K] };
interface AgendamentoM extends Mut<AgendamentoLido> {
  idPaciente: number | null;
}
interface Estado {
  usuarios: Map<number, Set<string>>;
  agendamentos: AgendamentoM[];
  estados: Mut<EstadoCirurgiaLido>[];
  pendencias: Map<number, Mut<PendenciaLida>[]>;
  cancelados: CancelamentoCirurgiaLido[];
  historico: (HistoricoLido & { chave: string })[];
  adicionais: Map<string, number[]>;
  realizadas: RealizadaLida[];
  ligacoes: Map<number, LigacaoCirurgiaLida>;
  ext: Map<number, RegistroExtLido>;
  excecoes: Set<number>;
  /** W0-10 (script 1147): as versões anteriores dos pedidos do portal. */
  versoes: VersaoPedidoLida[];
  seq: number;
  idem: Map<string, { hash: string; resultado: ResultadoOperacao }>;
}

const paresVazios = (): Record<string, number | null> => ({
  CRM: 0,
  ID_CRM: 1,
  AUX1: 0,
  ID_AUX1: 1,
  AUX2: 0,
  ID_AUX2: 1,
  AUX3: 0,
  ID_AUX3: 1,
  INSTR: 0,
  ID_INSTR: 1,
  ANEST: 0,
  ID_ANEST: 1,
  CIRCUL: 0,
  ID_CIRCUL: 1,
  ID_TBCBOPRO_PEDIATRA: 1,
});

function semear(r: RelogioLido): Estado {
  const usuarios = new Map<number, Set<string>>([
    [1, new Set(LOGINS_DO_BLOCO)],
    [2, new Set(LOGINS_DO_BLOCO)],
    [3, new Set(['COORDENACAO.SINTETICO'])],
  ]);
  const amanha = diaUtil(r.hoje, 1);
  const ontem = somarDia(r.hoje, -1);
  const ag = (
    id: number,
    sala: number,
    data: string,
    hora: string,
    dur: number,
    pac: string,
    reg: number,
  ): AgendamentoM => ({
    id,
    sala,
    inicio: instante(data, hora),
    duracaoMin: dur,
    intervaloMin: 0,
    paciente: pac,
    prontuario: 9100 + id,
    reg,
    atendimento: 'I',
    convenio: 10,
    procedimento: 30101271,
    especialidade: 33,
    anestesia: 1,
    pares: { ...paresVazios(), CRM: 9001, ID_CRM: 5001, ANEST: 9002, ID_ANEST: 5002 },
    recursos: ['VID'],
    observacao: '',
    usuario: `COORDENACAO.${M}`,
    idPaciente: null,
  });
  // Duas cirurgias que se cruzam na sala 2 (gravadas pelo outro sistema: o mapa mostra o alerta) e uma de ontem que
  // tem o ato registrado (casamento exato pelo REG, sala e dia).
  const agendamentos = [
    ag(701, 2, amanha, '0800', 120, `PACIENTE ${M} SALA DOIS A`, 0),
    ag(702, 2, amanha, '0900', 60, `PACIENTE ${M} SALA DOIS B`, 0),
    ag(703, 1, ontem, '0700', 90, `PACIENTE ${M} REGISTRADO`, 77001),
    // M46 (etapa 3): a cirurgia do paciente já internado (REG 77004) dois dias úteis adiante, na sala 3, para o OPME
    // (a solicitação antes, o consumo em sala a internado); o cirurgião é outro registro (fora das listas do portal).
    {
      ...ag(704, 3, diaUtil(r.hoje, 2), '1000', 120, `PACIENTE ${M} OPME`, 77004),
      pares: { ...paresVazios(), CRM: 9007, ID_CRM: 5007, ANEST: 9002, ID_ANEST: 5002 },
    },
  ];
  const realizadas: RealizadaLida[] = [
    {
      id: 880,
      reg: 77001,
      data: ontem,
      sala: 1,
      porte: 'M',
      potencialContaminacao: 'L',
      tipoAnestesia: 1,
      inicio: '0715',
      fim: '0840',
      duracao: '0125',
      paciente: `PACIENTE ${M} REGISTRADO`,
      procedimentos: [
        {
          procedimento: 30101271,
          especialidade: 33,
          tecnica: 0,
          pares: { CIRUR: 9001, ID_CIRUR: 5001, ANEST: 9002, ID_ANEST: 5002, AUX1: 0, ID_AUX1: 1 },
        },
      ],
    },
  ];
  return {
    usuarios,
    agendamentos,
    estados: [],
    pendencias: new Map(),
    cancelados: [],
    historico: [],
    adicionais: new Map(),
    realizadas,
    ligacoes: new Map(),
    ext: new Map(),
    excecoes: new Set(),
    versoes: [],
    seq: 9000,
    idem: new Map(),
  };
}

export class PortaCirurgiaMemoria implements PortaCirurgia {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();
  constructor(
    private readonly catalogo: FonteCatalogo | null = null,
    private readonly lerPacientes: (
      c: ContextoPortaM18,
      ids: readonly number[],
    ) => Promise<{ id: number; nome: string; prontuario: number; ativo: boolean }[]> = async () => [],
    private readonly relogioFn: () => RelogioLido = () => relogioLocal(),
  ) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(c.hospital);
    if (!s) this.porHospital.set(c.hospital, (s = semear(this.relogioFn())));
    return s;
  }

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoPortaM18, op: string): Promise<LiberacaoConsultada> {
    const e = this.estadoOp(op, c.hospital);
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

  private exigirSala(s: Estado, sala: number, login: string) {
    if (!SALAS_SINTETICAS.some((x) => x.codigo === sala))
      throw recusa('sala-inexistente', 'A sala cirúrgica não existe.', { campos: ['sala'] });
    if (!s.usuarios.get(sala)?.has(login))
      throw recusa(
        'sala-nao-permitida',
        'Você não está entre os usuários permitidos desta sala: peça à coordenação do bloco para incluí-lo.',
        { campos: ['sala'] },
      );
  }

  private exigirFuturo(data: string, hora: string, r: RelogioLido) {
    if (data < r.hoje || (data === r.hoje && hora <= r.hhmm))
      throw recusa('horario-passado', 'O início já passou pelo relógio do servidor: escolha outro horário.');
  }

  private exigirLivre(
    s: Estado,
    id: number,
    sala: number,
    inicio: string,
    dur: number,
    preparo: number,
    excecao: boolean,
  ) {
    const conflitos = conflitosNaSala(
      { id, sala, inicio, duracaoMin: dur, intervaloMin: 0 },
      s.agendamentos.map((a) => ({
        id: a.id,
        sala: a.sala,
        inicio: a.inicio,
        duracaoMin: a.duracaoMin,
        intervaloMin: a.intervaloMin,
      })),
      preparo,
    );
    if (conflitos.length > 0 && !excecao)
      throw recusa(
        'sala-ocupada',
        `A sala está ocupada nesse horário (cruza com a cirurgia das ${conflitos[0]?.inicio.slice(11) ?? ''}): escolha outro horário ou outra sala.`,
      );
    if (s.agendamentos.some((a) => a.id !== id && a.sala === sala && a.inicio === inicio))
      throw recusa(
        'sala-ocupada',
        'Já há uma cirurgia começando nesse minuto na sala: escolha outro horário.',
      );
    return conflitos;
  }

  private exigirEquipe(equipe: Record<string, { id: number; cod: number } | null | undefined>) {
    for (const p of Object.values(equipe))
      if (p && !TODOS_OS_REGISTROS.some((x) => x.id === p.id && x.cod === p.cod))
        throw recusa(
          'profissional-invalido',
          'Um profissional da equipe não confere com o cadastro (código e registro): escolha de novo na lista.',
          { campos: ['equipe'] },
        );
  }

  private anotarHistorico(
    s: Estado,
    login: string,
    op: 'A' | 'R',
    ant: { sala: number; inicio: string },
    novo: { sala: number; inicio: string },
    justif: string | null,
  ) {
    const r = this.relogioFn();
    s.historico.push({
      chave: `${novo.sala}|${novo.inicio}`,
      quando: instante(r.hoje, r.hhmm),
      usuario: login,
      operacao: op,
      salaAnterior: ant.sala,
      inicioAnterior: ant.inicio,
      sala: novo.sala,
      inicio: novo.inicio,
      justificativa: justif,
    });
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
      case 'cirurgia.agendarCirurgia': {
        this.exigirSala(s, e['sala'], login);
        this.exigirFuturo(e['data'], e['hora'], r);
        const inicio = instante(e['data'], e['hora']);
        const id = ++s.seq;
        const conflitos = this.exigirLivre(
          s,
          id,
          e['sala'],
          inicio,
          e['duracaoMin'],
          e['preparoMinimoMin'],
          e['excecao'] !== null,
        );
        const [p] = await this.lerPacientes(c, [e['paciente']]);
        if (!p)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Paciente não encontrado',
            'O cadastro não existe.',
          );
        if (p.prontuario <= 0)
          throw recusa(
            'sem-prontuario',
            'O paciente não tem prontuário: complete o cadastro antes de agendar.',
          );
        this.exigirEquipe(e['equipe']);
        const eq = e['equipe'] as Record<string, { id: number; cod: number } | null | undefined>;
        const par = (f: string) => eq[f] ?? null;
        const pares = paresVazios();
        for (const [cod, idc, f] of [
          ['CRM', 'ID_CRM', 'cirurgiao'],
          ['AUX1', 'ID_AUX1', 'auxiliar1'],
          ['AUX2', 'ID_AUX2', 'auxiliar2'],
          ['AUX3', 'ID_AUX3', 'auxiliar3'],
          ['INSTR', 'ID_INSTR', 'instrumentador'],
          ['ANEST', 'ID_ANEST', 'anestesista'],
          ['CIRCUL', 'ID_CIRCUL', 'circulante'],
        ] as const) {
          const x = par(f);
          pares[cod] = x ? x.cod : 0;
          pares[idc] = x ? x.id : 1;
        }
        pares['ID_TBCBOPRO_PEDIATRA'] = e['pediatra'] ?? 1;
        s.agendamentos.push({
          id,
          sala: e['sala'],
          inicio,
          duracaoMin: e['duracaoMin'],
          intervaloMin: e['intervaloMin'],
          paciente: p.nome,
          prontuario: p.prontuario,
          reg: e['reg'],
          atendimento: e['atendimento'],
          convenio: e['convenio'],
          procedimento: e['procedimento'],
          especialidade: e['especialidade'],
          anestesia: e['anestesia'],
          pares,
          recursos: RECURSOS_SALA.filter((x) => (e['recursos'] as string[]).includes(x.campo)).map(
            (x) => x.coluna,
          ),
          observacao: e['observacao'] ?? '',
          usuario: login,
          idPaciente: p.id,
        });
        this.anotarHistorico(s, login, 'A', { sala: e['sala'], inicio }, { sala: e['sala'], inicio }, null);
        s.adicionais.set(`${e['sala']}|${inicio}`, [...(e['procedimentosAdicionais'] as number[])]);
        if (e['excecao'] && conflitos.length > 0) s.excecoes.add(id);
        if (e['solicitacao']) {
          const sol = s.estados.find((x) => x.id === e['solicitacao']);
          if (!sol || sol.estado !== 'solicitado')
            throw recusa('solicitacao-encerrada', 'A solicitação já foi confirmada, cancelada ou suspensa.');
          Object.assign(sol, {
            agendamento: id,
            sala: e['sala'],
            inicio,
            estado: 'confirmado',
            atualizadoEm: instante(r.hoje, r.hhmm),
            // Como no banco: o pedido do portal (sem o cadastro) recebe o paciente confirmado.
            ...(sol.idPaciente === null ? { idPaciente: p.id, reg: e['reg'], prontuario: p.prontuario } : {}),
          });
        } else
          s.estados.unshift({
            id: ++s.seq,
            agendamento: id,
            sala: e['sala'],
            inicio,
            duracaoMin: e['duracaoMin'],
            intervaloMin: e['intervaloMin'],
            reg: e['reg'],
            prontuario: p.prontuario,
            idPaciente: p.id,
            procedimento: e['procedimento'],
            convenio: e['convenio'],
            cirurgiao: eq['cirurgiao']?.id ?? null,
            carater: e['carater'],
            anestesia: e['anestesia'],
            estado: 'confirmado',
            motivo: null,
            complemento: null,
            solicitante: null,
            observacao: e['observacao'] ?? null,
            criadoPor: login,
            atualizadoEm: null,
            pendenciasAbertas: 0,
            excecao: s.excecoes.has(id),
            portal: null,
          });
        return { agendamento: id, sala: e['sala'], conflito: conflitos[0]?.com ?? 0 };
      }
      case 'cirurgia.cancelarCirurgia': {
        const a = s.agendamentos.find((x) => x.id === e['agendamento']);
        if (!a)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Agendamento não encontrado',
            'O agendamento cirúrgico não existe mais (foi cancelado ou movido em outro terminal).',
          );
        this.exigirSala(s, a.sala, login);
        if (s.realizadas.some((x) => s.ligacoes.get(x.id)?.agendamento === a.id))
          throw recusa(
            'cirurgia-realizada',
            'A cirurgia já foi registrada como realizada: não pode mais ser cancelada.',
          );
        s.cancelados.unshift({
          id: a.id,
          sala: a.sala,
          inicio: a.inicio,
          paciente: a.paciente,
          procedimento: a.procedimento,
          atualizadoEm: instante(r.hoje, r.hhmm),
          usuario: a.usuario,
        });
        s.agendamentos = s.agendamentos.filter((x) => x.id !== a.id);
        s.adicionais.delete(`${a.sala}|${a.inicio}`);
        const est = s.estados.find((x) => x.agendamento === a.id);
        const novo = e['suspender'] ? 'suspenso' : 'cancelado';
        const motivo = {
          motivo: e['motivo'],
          complemento: e['complemento'] ?? null,
          solicitante: e['solicitante'],
        };
        if (est)
          Object.assign(est, {
            estado: novo,
            ...motivo,
            agendamento: null,
            atualizadoEm: instante(r.hoje, r.hhmm),
          });
        else
          s.estados.unshift({
            id: ++s.seq,
            agendamento: null,
            sala: a.sala,
            inicio: a.inicio,
            duracaoMin: a.duracaoMin,
            intervaloMin: a.intervaloMin,
            reg: a.reg,
            prontuario: a.prontuario,
            idPaciente: a.idPaciente,
            procedimento: a.procedimento,
            convenio: a.convenio,
            cirurgiao: a.pares['ID_CRM'] ?? null,
            carater: null,
            anestesia: a.anestesia,
            estado: novo,
            ...motivo,
            observacao: null,
            criadoPor: login,
            atualizadoEm: instante(r.hoje, r.hhmm),
            pendenciasAbertas: 0,
            excecao: false,
            portal: null,
          });
        return { agendamento: a.id, sala: a.sala };
      }
      case 'cirurgia.remarcarCirurgia': {
        const a = s.agendamentos.find((x) => x.id === e['agendamento']);
        if (!a)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Agendamento não encontrado',
            'O agendamento cirúrgico não existe mais (foi cancelado ou movido em outro terminal).',
          );
        const lido = e['lido'] as { sala: number; data: string; hora: string };
        if (a.sala !== lido.sala || a.inicio !== instante(lido.data, lido.hora))
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'O agendamento mudou',
            'O agendamento foi alterado em outro terminal: confira o mapa e tente de novo.',
          );
        this.exigirSala(s, a.sala, login);
        this.exigirSala(s, e['sala'], login);
        this.exigirFuturo(e['data'], e['hora'], r);
        const inicio = instante(e['data'], e['hora']);
        if (inicio === a.inicio && e['sala'] === a.sala)
          throw recusa('mesmo-horario', 'O horário novo é o mesmo do agendamento.');
        if ((s.adicionais.get(`${a.sala}|${a.inicio}`) ?? []).length > 0)
          throw recusa(
            'cirurgia-com-adicional',
            'A cirurgia tem procedimento adicional ligado ao horário: cancele e agende de novo no horário novo.',
          );
        const dur = e['duracaoMin'] ?? a.duracaoMin;
        const conflitos = this.exigirLivre(
          s,
          a.id,
          e['sala'],
          inicio,
          dur,
          e['preparoMinimoMin'],
          e['excecao'] !== null,
        );
        const ant = { sala: a.sala, inicio: a.inicio };
        Object.assign(a, { sala: e['sala'], inicio, duracaoMin: dur });
        this.anotarHistorico(s, login, 'R', ant, { sala: a.sala, inicio }, e['justificativa']);
        if (e['excecao'] && conflitos.length > 0) s.excecoes.add(a.id);
        const est = s.estados.find((x) => x.agendamento === a.id);
        if (est) Object.assign(est, { sala: a.sala, inicio, atualizadoEm: instante(r.hoje, r.hhmm) });
        return { agendamento: a.id, sala: a.sala };
      }
      case 'cirurgia.registrarCirurgia': {
        this.exigirSala(s, e['sala'], login);
        const t = conferirTempos({
          inicio: e['inicio'],
          fim: e['fim'],
          inicioAnestesia: e['inicioAnestesia'],
          fimAnestesia: e['fimAnestesia'],
        });
        const mi = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(2, 4));
        // Como a receita: término antes do início só vale virando a meia-noite (6 h ou mais de diferença).
        if (
          e['fim'] === e['inicio'] ||
          (mi(e['fim']) < mi(e['inicio']) && mi(e['inicio']) - mi(e['fim']) < 360)
        )
          throw recusa('tempos-invalidos', 'O término tem de vir depois do início.', { campos: ['fim'] });
        if (t.problemas.length > 0)
          throw recusa('tempos-invalidos', t.problemas[0]?.texto ?? 'Tempos inválidos.');
        for (const p of e['procedimentos'] as {
          equipe: Record<string, { id: number; cod: number } | null>;
        }[])
          this.exigirEquipe(p.equipe);
        if (e['agendamento'] !== null) {
          const a = s.agendamentos.find((x) => x.id === e['agendamento']);
          if (!a) throw recusa('agendamento-inexistente', 'O agendamento informado não existe.');
          if (a.reg !== e['reg'] && a.reg !== 0)
            throw recusa('agendamento-de-outra-internacao', 'O agendamento é de outra internação.');
          if ([...s.ligacoes.values()].some((l) => l.agendamento === a.id))
            throw recusa('agendamento-ja-registrado', 'O agendamento já tem a cirurgia registrada.');
        }
        const id = ++s.seq;
        const proc = e['procedimentos'] as {
          procedimento: number;
          especialidade: number;
          tecnica: number;
          equipe: Record<string, { id: number; cod: number } | null>;
        }[];
        const mapa: [string, string, string][] = [
          ['CIRUR', 'ID_CIRUR', 'cirurgiao'],
          ['AUX1', 'ID_AUX1', 'auxiliar1'],
          ['AUX2', 'ID_AUX2', 'auxiliar2'],
          ['AUX3', 'ID_AUX3', 'auxiliar3'],
          ['INSTR', 'ID_INSTR', 'instrumentador'],
          ['ANEST', 'ID_ANEST', 'anestesista'],
          ['PED', 'ID_PED', 'pediatra'],
          ['CIRC', 'ID_CIRC', 'circulante'],
        ];
        s.realizadas.unshift({
          id,
          reg: e['reg'],
          data: e['data'],
          sala: e['sala'],
          porte: e['porte'],
          potencialContaminacao: e['potencialContaminacao'],
          tipoAnestesia: e['tipoAnestesia'],
          inicio: e['inicio'],
          fim: e['fim'],
          duracao:
            t.duracaoMin === null
              ? ''
              : `${String(Math.floor(t.duracaoMin / 60)).padStart(2, '0')}${String(t.duracaoMin % 60).padStart(2, '0')}`,
          paciente: `PACIENTE ${M} DO ATENDIMENTO ${e['reg']}`,
          procedimentos: proc.map((p) => ({
            procedimento: p.procedimento,
            especialidade: p.especialidade,
            tecnica: p.tecnica,
            pares: Object.fromEntries(
              mapa.flatMap(([cod, idc, f]) => [
                [cod, p.equipe[f]?.cod ?? 0],
                [idc, p.equipe[f]?.id ?? 1],
              ]),
            ),
          })),
        });
        s.ligacoes.set(id, { realizada: id, agendamento: e['agendamento'], origem: 'registro' });
        const x = e['extensao'] as {
          entradaSala: string | null;
          incisao: string | null;
          saidaSala: string | null;
          asa: number | null;
          observacao: string | null;
        };
        const hh = (v: string | null) => (v ? `${v.slice(0, 2)}:${v.slice(2)}` : null);
        s.ext.set(id, {
          realizada: id,
          entradaSala: hh(x.entradaSala),
          incisao: hh(x.incisao),
          saidaSala: hh(x.saidaSala),
          asa: x.asa,
          observacao: x.observacao,
        });
        if (e['agendamento'] !== null) {
          const est = s.estados.find((y) => y.agendamento === e['agendamento']);
          if (est) est.estado = 'realizado';
        }
        return { cirurgia: id, procedimentos: proc.length };
      }
      case 'cirurgia.definirSalaUsuario': {
        if (!SALAS_SINTETICAS.some((x) => x.codigo === e['sala']))
          throw recusa('sala-inexistente', 'A sala cirúrgica não existe.');
        const lista = s.usuarios.get(e['sala']) ?? new Set<string>();
        if (e['acao'] === 'incluir') {
          if (lista.has(e['usuario']))
            throw recusa('ja-permitido', 'O usuário já está entre os permitidos da sala.');
          lista.add(e['usuario']);
        } else {
          if (!lista.has(e['usuario']))
            throw recusa('nao-permitido', 'O usuário não está entre os permitidos da sala.');
          lista.delete(e['usuario']);
        }
        s.usuarios.set(e['sala'], lista);
        return { sala: e['sala'], usuarios: lista.size };
      }
      default:
        throw recusa('operacao-especificada', 'Operação ainda desligada.');
    }
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorSghCirurgia) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const r = this.relogioFn();
    return fn({
      solicitar: async (x) => {
        const id = ++s.seq;
        s.estados.unshift({
          id,
          agendamento: null,
          sala: x.sala,
          inicio: instante(x.data, x.hora),
          duracaoMin: x.duracaoMin,
          intervaloMin: 0,
          reg: x.reg,
          prontuario: x.pront,
          idPaciente: x.idPaciente,
          procedimento: x.procedimento,
          convenio: x.convenio,
          cirurgiao: x.cirurgiao,
          carater: x.carater,
          anestesia: x.anestesia,
          estado: 'solicitado',
          motivo: null,
          complemento: null,
          solicitante: null,
          observacao: x.observacao,
          criadoPor: x.usuario,
          atualizadoEm: null,
          pendenciasAbertas: 0,
          excecao: false,
          portal: x.portal ? { ...x.portal } : null,
        });
        return id;
      },
      retirarPedidoPortal: async (x) => {
        const est = s.estados.find((y) => y.id === x.id);
        if (
          !est ||
          est.portal?.acesso !== x.acesso ||
          est.estado !== 'solicitado' ||
          est.agendamento !== null
        )
          throw recusa('solicitacao-encerrada', 'O pedido já foi confirmado, cancelado ou suspenso.');
        Object.assign(est, {
          estado: 'cancelado',
          motivo: 'OUTRO',
          complemento: x.complemento,
          solicitante: 'equipe',
          atualizadoEm: instante(r.hoje, r.hhmm),
        });
      },
      alterarPedidoPortal: async (x) => {
        const est = s.estados.find((y) => y.id === x.id);
        const guardadas = s.versoes.filter((v) => v.idEstado === x.id).length;
        conferirAlteracaoPedido(
          est
            ? {
                acesso: est.portal?.acesso ?? null,
                estado: est.estado,
                agendamento: est.agendamento,
                versao: guardadas + 1,
              }
            : null,
          x,
        );
        const a = est as Mut<EstadoCirurgiaLido>;
        s.versoes.unshift({
          idEstado: a.id,
          versao: guardadas + 1,
          sala: a.sala,
          inicio: a.inicio,
          duracaoMin: a.duracaoMin,
          procedimento: a.procedimento,
          convenio: a.convenio,
          observacao: a.observacao,
          paciente: a.portal?.paciente ?? null,
          motivo: x.motivo.trim(),
          substituidaEm: instante(r.hoje, r.hhmm),
        });
        Object.assign(a, {
          sala: x.sala,
          inicio: instante(x.data, x.hora),
          duracaoMin: x.duracaoMin,
          procedimento: x.procedimento,
          convenio: x.convenio,
          cirurgiao: x.cirurgiao,
          carater: x.carater,
          anestesia: x.anestesia,
          observacao: x.observacao,
          portal: { acesso: x.acesso, paciente: x.paciente, nascimento: x.nascimento },
          atualizadoEm: instante(r.hoje, r.hhmm),
        });
        return guardadas + 2;
      },
      mudarEstado: async (x) => {
        const est = s.estados.find((y) => y.id === x.id);
        if (!est) throw recusa('registro-inexistente', 'O registro do agendamento não existe.');
        Object.assign(est, {
          estado: x.estado,
          atualizadoEm: instante(r.hoje, r.hhmm),
          ...(x.motivo !== undefined
            ? { motivo: x.motivo, complemento: x.complemento ?? null, solicitante: x.solicitante ?? null }
            : {}),
        });
      },
      gravarPendencia: async (x) => {
        const lista = s.pendencias.get(x.idEstado) ?? [];
        let p = lista.find((y) => y.tipo === x.tipo);
        if (p)
          Object.assign(p, {
            situacao: x.situacao,
            observacao: x.observacao,
            atualizadoPor: x.usuario,
            atualizadoEm: instante(r.hoje, r.hhmm),
          });
        else {
          p = {
            id: ++s.seq,
            tipo: x.tipo,
            situacao: x.situacao,
            observacao: x.observacao,
            atualizadoPor: x.usuario,
            atualizadoEm: instante(r.hoje, r.hhmm),
          };
          lista.push(p);
        }
        s.pendencias.set(x.idEstado, lista);
        const est = s.estados.find((y) => y.id === x.idEstado);
        if (est) est.pendenciasAbertas = lista.filter((y) => y.situacao === 'pendente').length;
        return p.id;
      },
      gravarLigacao: async (x) => {
        if (s.ligacoes.has(x.idCccadcir))
          throw recusa('ligacao-existente', 'A cirurgia realizada já está ligada a um agendamento.');
        if (x.idCcagenda !== null && [...s.ligacoes.values()].some((l) => l.agendamento === x.idCcagenda))
          throw recusa(
            'agendamento-ja-registrado',
            'O agendamento já está ligado a outra cirurgia realizada.',
          );
        s.ligacoes.set(x.idCccadcir, {
          realizada: x.idCccadcir,
          agendamento: x.idCcagenda,
          origem: 'revisao',
        });
      },
    });
  }

  async relogio(): Promise<RelogioLido> {
    return this.relogioFn();
  }

  async salas(c: ContextoPortaM18, login: string) {
    const s = this.e(c);
    return SALAS_SINTETICAS.map((x) => ({
      codigo: x.codigo,
      nome: x.nome,
      centroCusto: x.cdc,
      usuarios: s.usuarios.get(x.codigo)?.size ?? 0,
      permitida: s.usuarios.get(x.codigo)?.has(login) ?? false,
    }));
  }

  async usuariosDaSala(c: ContextoPortaM18, sala: number) {
    return [...(this.e(c).usuarios.get(sala) ?? [])]
      .sort()
      .map((login) => ({ login, nome: login, ativo: true }));
  }

  private lido(a: AgendamentoM): AgendamentoLido {
    return {
      id: a.id,
      sala: a.sala,
      inicio: a.inicio,
      duracaoMin: a.duracaoMin,
      intervaloMin: a.intervaloMin,
      paciente: a.paciente,
      prontuario: a.prontuario,
      reg: a.reg,
      atendimento: a.atendimento,
      convenio: a.convenio,
      procedimento: a.procedimento,
      especialidade: a.especialidade,
      anestesia: a.anestesia,
      pares: { ...a.pares },
      recursos: [...a.recursos],
      observacao: a.observacao,
      usuario: a.usuario,
    };
  }

  async agendamentos(c: ContextoPortaM18, de: string, ate: string, salas: readonly number[] | null) {
    const itens = this.e(c)
      .agendamentos.filter(
        (a) =>
          a.inicio.slice(0, 10) >= de && a.inicio.slice(0, 10) <= ate && (!salas || salas.includes(a.sala)),
      )
      .sort((x, y) => x.sala - y.sala || x.inicio.localeCompare(y.inicio))
      .map((a) => this.lido(a));
    return { itens, truncado: false };
  }

  async agendamento(c: ContextoPortaM18, id: number) {
    const a = this.e(c).agendamentos.find((x) => x.id === id);
    return a ? this.lido(a) : null;
  }

  async historicoDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    const s = this.e(c);
    const itens = s.historico
      .filter((h) => h.quando.slice(0, 10) >= de && h.quando.slice(0, 10) <= ate)
      .map((h) => {
        const a = s.agendamentos.find((x) => x.sala === h.sala && x.inicio === h.inicio);
        return {
          quando: h.quando,
          usuario: h.usuario,
          operacao: h.operacao,
          salaAnterior: h.salaAnterior,
          inicioAnterior: h.inicioAnterior,
          sala: h.sala,
          inicio: h.inicio,
          justificativa: h.justificativa,
          paciente: a?.paciente ?? '',
          reg: a && a.reg > 0 ? a.reg : null,
        };
      })
      .reverse();
    return { itens: itens.slice(0, 500), truncado: itens.length > 500 };
  }

  async adicionais(c: ContextoPortaM18, sala: number, inicio: string) {
    return [...(this.e(c).adicionais.get(`${sala}|${inicio}`) ?? [])];
  }

  async historico(c: ContextoPortaM18, sala: number, inicio: string) {
    const chave = `${sala}|${inicio}`;
    return this.e(c)
      .historico.filter((h) => h.chave === chave || `${h.salaAnterior}|${h.inicioAnterior}` === chave)
      .map((h) => ({
        quando: h.quando,
        usuario: h.usuario,
        operacao: h.operacao,
        salaAnterior: h.salaAnterior,
        inicioAnterior: h.inicioAnterior,
        sala: h.sala,
        inicio: h.inicio,
        justificativa: h.justificativa,
      }));
  }

  async cancelados(c: ContextoPortaM18, de: string, ate: string) {
    return {
      itens: this.e(c).cancelados.filter((x) => x.inicio.slice(0, 10) >= de && x.inicio.slice(0, 10) <= ate),
      truncado: false,
    };
  }

  async realizadas(c: ContextoPortaM18, f: FiltroRealizadas) {
    return {
      itens: this.e(c).realizadas.filter(
        (x) =>
          (f.de === null || x.data >= f.de) &&
          (f.ate === null || x.data <= f.ate) &&
          (f.reg === null || f.reg === undefined || x.reg === f.reg) &&
          (f.sala === null || f.sala === undefined || x.sala === f.sala),
      ),
      truncado: false,
    };
  }

  async realizada(c: ContextoPortaM18, id: number) {
    return this.e(c).realizadas.find((x) => x.id === id) ?? null;
  }

  async agendamentosDosRegs(c: ContextoPortaM18, regs: readonly number[]) {
    return this.e(c)
      .agendamentos.filter((a) => a.reg > 0 && regs.includes(a.reg))
      .map((a) => ({ id: a.id, reg: a.reg, sala: a.sala, dia: a.inicio.slice(0, 10) }));
  }

  async profissionaisDoBloco() {
    return PROFISSIONAIS_SINTETICOS.map((p) => ({ ...p }));
  }

  async buscarProfissionais(_c: ContextoPortaM18, texto: string) {
    const q = texto.trim().toUpperCase();
    if (q.length < 2) return [];
    return PROFISSIONAIS_SINTETICOS.filter((p) => p.nome.includes(q) || String(p.cod) === q);
  }

  async nomesProfissionais(_c: ContextoPortaM18, ids: readonly number[]) {
    return new Map(TODOS_OS_REGISTROS.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.nome]));
  }

  async profissionaisPorRegistro(_c: ContextoPortaM18, ids: readonly number[]) {
    return TODOS_OS_REGISTROS.filter((p) => ids.includes(p.id)).map((p) => ({
      ...p,
      medico: !REGISTROS_NAO_MEDICOS.has(p.id),
    }));
  }

  async nomesProcedimentos(_c: ContextoPortaM18, cods: readonly number[]) {
    return new Map(
      PROCEDIMENTOS_SINTETICOS.filter((p) => cods.includes(p.codigo)).map((p) => [p.codigo, p.nome]),
    );
  }

  async buscarProcedimentos(_c: ContextoPortaM18, texto: string) {
    const q = texto.trim().toUpperCase();
    if (q.length < 3) return [];
    return PROCEDIMENTOS_SINTETICOS.filter((p) => p.nome.startsWith(q) || String(p.codigo) === q);
  }

  async opcoes() {
    return {
      anestesias: [...ANESTESIAS],
      caracteres: [
        { codigo: 1, nome: 'URGENCIA' },
        { codigo: 2, nome: 'ELETIVA' },
        { codigo: 3, nome: 'ACIDENTE' },
      ],
      convenios: [...CONVENIOS],
      especialidades: [...ESPECIALIDADES],
    };
  }

  async pacientePorProntuario(c: ContextoPortaM18, pront: number) {
    const a = this.e(c).agendamentos.find((x) => x.prontuario === pront && x.idPaciente !== null);
    return a && a.idPaciente !== null ? { id: a.idPaciente, nome: a.paciente } : null;
  }

  async pacientes(c: ContextoPortaM18, ids: readonly number[]): Promise<PacienteDaCirurgia[]> {
    return ids.length === 0
      ? []
      : (await this.lerPacientes(c, ids)).map((p) => ({ id: p.id, nome: p.nome, prontuario: p.prontuario }));
  }

  async estadosDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    return this.e(c)
      .estados.filter((x) => x.inicio.slice(0, 10) >= de && x.inicio.slice(0, 10) <= ate)
      .map((x) => ({ ...x }));
  }

  async estadosDosAgendamentos(c: ContextoPortaM18, ids: readonly number[]) {
    const s = this.e(c);
    return new Map(
      s.estados
        .filter((x) => x.agendamento !== null && ids.includes(x.agendamento))
        .map((x) => [x.agendamento as number, { ...x, excecao: s.excecoes.has(x.agendamento as number) }]),
    );
  }

  async estadosDoPortal(c: ContextoPortaM18, acesso: number) {
    return this.e(c)
      .estados.filter((x) => x.portal?.acesso === acesso)
      .map((x) => ({ ...x }));
  }

  async versoesDosPedidos(c: ContextoPortaM18, ids: readonly number[]) {
    return this.e(c)
      .versoes.filter((v) => ids.includes(v.idEstado))
      .sort((a, b) => a.idEstado - b.idEstado || b.versao - a.versao)
      .map((v) => ({ ...v }));
  }

  async agendamentosDoCirurgiao(c: ContextoPortaM18, ids: readonly number[], de: string, ate: string) {
    const itens = this.e(c)
      .agendamentos.filter(
        (a) =>
          a.inicio.slice(0, 10) >= de &&
          a.inicio.slice(0, 10) <= ate &&
          ids.includes(Number(a.pares['ID_CRM'] ?? 0)),
      )
      .sort((x, y) => x.inicio.localeCompare(y.inicio) || x.sala - y.sala)
      .map((a) => this.lido(a));
    return { itens, truncado: false };
  }

  async estado(c: ContextoPortaM18, id: number) {
    const x = this.e(c).estados.find((y) => y.id === id);
    return x ? { ...x } : null;
  }

  async pendencias(c: ContextoPortaM18, idEstado: number) {
    return (this.e(c).pendencias.get(idEstado) ?? []).map((p) => ({ ...p }));
  }

  async ligacoes(c: ContextoPortaM18, ids: readonly number[]) {
    const s = this.e(c);
    return new Map([...s.ligacoes].filter(([k]) => ids.includes(k)));
  }

  async registrosExt(c: ContextoPortaM18, ids: readonly number[]) {
    const s = this.e(c);
    return new Map([...s.ext].filter(([k]) => ids.includes(k)));
  }
}

/** Fim do bloco no mapa (para os testes): início + duração. */
export const fimDoBloco = (inicio: string, dur: number) => somarMinutos(inicio, dur);
