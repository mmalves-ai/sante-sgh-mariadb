// Porta da enfermagem beira-leito (M25): o que as telas de trabalho leem e gravam, independente de onde (a API não
// escreve SQL fora das portas):
//   - `banco`: a porta própria sobre o banco do cliente (porta-propria.ts, pelo @sgh/nucleo; a checagem, o aprazamento
//     e o estorno pelo Executor, com a trilha na mesma transação; as demais gravações por gravação direta do Executor);
//   - `memoria`: a sessão sintética de dev/ci (E2E): unidade, pacientes, prescrições e horários SINTÉTICOS em memória,
//     com as mesmas validações (o Zod das operações) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  ExtrasContingencia,
  AprazamentoRegistrado,
  AtoChecagem,
  ConflitoSincronizacao,
  AparelhoBeiraLeito,
  EventoHistoricoHorario,
  EventoInfusao,
  HorarioEnfermagem,
  Internado,
  NotaPlantao,
  PassagemPlantao,
  VinculoEnfermagem,
  RegraHorario,
  SinalParaRetificar,
  SinalVitalNovo,
  SinalVitalRegistrado,
  UnidadeComInternados,
} from './tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ENFERMAGEM = Symbol('PORTA_ENFERMAGEM');

export type ContextoEnfermagem = ContextoPortaM18;

/** Gravações diretas da porta (fora das operações de tela), numa transação com a linha da trilha junto. */
export interface GravadorSghEnfermagem {
  gravarSinal(r: Omit<SinalVitalNovo, 'hospital'>): Promise<number>;
  retificarSinal(r: {
    id: number;
    /** A versão lida na tela (trava otimista: outra retificação no meio recusa). */
    versao?: number;
    valor: number;
    foraDaFaixa: boolean;
    justificativa: string;
    usuario: string;
  }): Promise<number>;
  gravarEventoInfusao(r: {
    horario: number;
    solucao: number | null;
    paciente: number;
    evento: string;
    velocidadeMlH: number | null;
    volumeMl: number | null;
    observacao: string | null;
    horaReal: string;
    usuario: string;
  }): Promise<number>;
  gravarAprazamento(r: {
    horario: number;
    item: number;
    paciente: number;
    acao: 'aprazar' | 'reaprazar' | 'suprimir';
    previsto: string;
    proposto: string;
    confirmado: string | null;
    motivo: string | null;
    usuario: string;
  }): Promise<number>;
  registrarConflito(r: {
    horario: number;
    paciente: number;
    chave: string;
    tipo: 'suspenso' | 'jaChecado' | 'mudou';
    situacaoEncontrada: string;
    desfechoTentado: string;
    horaReal: string;
    dispositivo: string | null;
    /** Revisão W0-03: o aparelho foi exigido no começo do lote (sem o cadastro, a gravação recusa). */
    aparelhoExigido?: boolean;
    usuario: string;
  }): Promise<{ id: number; novo: boolean }>;
  resolverConflito(r: {
    id: number;
    resolucao: string;
    observacao: string;
    usuario: string;
  }): Promise<number>;
  passarPlantao(r: {
    unidade: string;
    turno: 'diurno' | 'noturno';
    data: string;
    passadoPor: string;
    recebedor: string;
    notas: readonly NotaPlantao[];
  }): Promise<number>;
  responderPlantao(r: {
    id: number;
    aceite: boolean;
    observacao: string | null;
    usuario: string;
  }): Promise<number>;
  gravarDispositivo(r: {
    nome: string;
    unidade: string;
    tipo: 'tablet' | 'coletor' | 'celular';
    identificador: string;
    usuario: string;
  }): Promise<number>;
  /** W0-03: cancelar a passagem (quem passou, com o motivo, só antes do aceite). */
  cancelarPlantao(r: { id: number; motivo: string; usuario: string }): Promise<number>;
  alterarDispositivo(r: {
    id: number;
    ativo?: boolean | undefined;
    nome?: string | undefined;
    unidade?: string | undefined;
    usuario?: string | undefined;
    motivo?: string | undefined;
  }): Promise<number>;
  /** W0-03: excluir o aparelho só sem leituras vinculadas (recusa com a contagem), com o retrato da linha. */
  excluirDispositivo(r: { id: number; motivo: string; usuario: string }): Promise<number>;
  marcarSincronismo(r: { identificador: string }): Promise<boolean>;
  registrarEstornoPedido(r: {
    horario: number;
    item: number;
    prescricao: number;
    atendimento: number;
    paciente: number;
    situacao: string;
    justificativa: string;
    usuario: string;
  }): Promise<number>;
  /**
   * A anotação de enfermagem feita sem rede na beira do leito: grava o registro assistencial do atendimento (modelo de
   * documento da anotação de enfermagem) e, nele, a resposta de extensão com a chave do ato. O reenvio da mesma chave
   * devolve o registro gravado da primeira vez. Devolve o id do registro assistencial.
   */
  registrarAnotacaoOffline(r: {
    paciente: number;
    atendimento: number;
    chave: string;
    texto: string;
    horaReal: string;
    usuario: string;
  }): Promise<number>;
  gravarRespostaExt(r: {
    registro: number;
    paciente: number;
    componente: 'sinalVital' | 'mapaCorporal' | 'anexo';
    chave: string;
    valor: string | null;
    referencia: number | null;
    usuario: string;
  }): Promise<number>;
}

export interface PortaEnfermagem extends PortaGravacaoM18<GravadorSghEnfermagem> {
  /** O relógio do banco do estabelecimento (AAAA-MM-DDTHH:mm:ss, hora local). */
  relogio(c: ContextoEnfermagem): Promise<string>;
  unidades(c: ContextoEnfermagem): Promise<UnidadeComInternados[]>;
  internados(c: ContextoEnfermagem, unidade: string): Promise<Internado[]>;
  internado(c: ContextoEnfermagem, atendimento: number): Promise<Internado | null>;
  horarios(
    c: ContextoEnfermagem,
    o: { atendimentos: readonly number[]; inicio: string; fim: string; teto: number },
  ): Promise<{ itens: HorarioEnfermagem[]; cortada: boolean }>;
  horario(c: ContextoEnfermagem, id: number): Promise<HorarioEnfermagem | null>;
  faixasDoHorario(
    c: ContextoEnfermagem,
    h: Pick<HorarioEnfermagem, 'id' | 'item' | 'previsto'>,
  ): Promise<{ id: number; situacao: string; faixa: number }[]>;
  historico(
    c: ContextoEnfermagem,
    id: number,
  ): Promise<{ eventos: EventoHistoricoHorario[]; cortado: boolean }>;
  situacoes(c: ContextoEnfermagem, ids: readonly number[]): Promise<Map<number, string>>;
  mudancas(
    c: ContextoEnfermagem,
    o: { inicio: string; fim: string; desde: string },
  ): Promise<{ id: number; situacao: string; quando: string }[]>;
  vinculos(c: ContextoEnfermagem, login: string): Promise<VinculoEnfermagem[]>;
  nomesVinculos(c: ContextoEnfermagem, cbos: readonly number[]): Promise<Map<number, string>>;
  laboratorio(
    c: ContextoEnfermagem,
    o: { paciente: number; de: string; ate: string },
  ): Promise<{ exame: string; nome: string; valor: number; quando: string }[]>;
  regrasHorario(
    c: ContextoEnfermagem,
  ): Promise<{ regras: RegraHorario[]; porBloco: ReadonlyMap<string, number> }>;
  atos(c: ContextoEnfermagem, horarios: readonly number[]): Promise<AtoChecagem[]>;
  eventosInfusao(c: ContextoEnfermagem, horarios: readonly number[]): Promise<EventoInfusao[]>;
  sinais(
    c: ContextoEnfermagem,
    o: { paciente: number; de: string; ate: string },
  ): Promise<{ itens: SinalVitalRegistrado[]; cortada: boolean }>;
  /** O sinal vital pelo id (o paciente, o tipo e a versão vêm do banco, nunca do pedido). */
  sinalPorId(c: ContextoEnfermagem, id: number): Promise<SinalParaRetificar | null>;
  ultimosSinais(c: ContextoEnfermagem, pacientes: readonly number[]): Promise<Map<number, string>>;
  aprazamentos(
    c: ContextoEnfermagem,
    horarios: readonly number[],
  ): Promise<Map<number, AprazamentoRegistrado>>;
  conflitos(c: ContextoEnfermagem, o: { abertos: boolean }): Promise<ConflitoSincronizacao[]>;
  passagens(c: ContextoEnfermagem, o: { unidade?: string; id?: number }): Promise<PassagemPlantao[]>;
  dispositivos(c: ContextoEnfermagem): Promise<AparelhoBeiraLeito[]>;
  /** O aparelho autorizado (ativo) pelo identificador que o tablet manda (a porta guarda só o hash). */
  dispositivoAutorizado(c: ContextoEnfermagem, identificador: string): Promise<AparelhoBeiraLeito | null>;
  /**
   * M40 (regra 6): o que o relatório de contingência do posto precisa além da linha do tempo — os nomes das alergias,
   * a lista de problemas, as justificativas de alerta, as amostras em rastreio e a higienização em andamento.
   */
  extrasContingencia(
    c: ContextoEnfermagem,
    o: {
      unidade: string;
      pacientes: readonly number[];
      atendimentos: readonly number[];
      prescricoes: readonly number[];
    },
  ): Promise<ExtrasContingencia>;
}

export const METODOS_PORTA_ENFERMAGEM: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'podeGravar',
  'relogio',
  'unidades',
  'internados',
  'internado',
  'horarios',
  'horario',
  'faixasDoHorario',
  'historico',
  'situacoes',
  'mudancas',
  'vinculos',
  'nomesVinculos',
  'laboratorio',
  'regrasHorario',
  'atos',
  'eventosInfusao',
  'sinais',
  'sinalPorId',
  'ultimosSinais',
  'aprazamentos',
  'conflitos',
  'passagens',
  'dispositivos',
  'dispositivoAutorizado',
  'extrasContingencia',
]);
