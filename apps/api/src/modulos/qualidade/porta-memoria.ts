// Porta EM MEMÓRIA da notificação de incidentes (M48, etapa 1): dev/ci sem a cópia e os testes da API (nada conecta a
// banco; dados SINTÉTICOS). Espelha as regras do banco que a API não confere sozinha: o sequencial do protocolo por ano,
// a chave resumida única, a versão no UPDATE (o que passou ao mesmo tempo é recusado), a anônima sem notificador e a
// linha do tempo só de inclusão. A transação desfaz tudo se a função falhar (como o ROLLBACK).
import type { ContextoNotificacaoLido, ExpostoAoLote, UnidadeNotificacao } from '@sgh/contratos';
import {
  type AcaoPlanoRegistrada,
  type AnaliseRegistrada,
  type ContagemNotificacoes,
  type EventoQueixaRegistrado,
  type ProtocoloDoPaciente,
  type QueixaTecnicaRegistrada,
  type VersaoProtocoloGerenciado,
  type EventoNotificacaoNovo,
  type EventoNotificacaoRegistrado,
  type FiltroNotificacoes,
  type NotificacaoRegistrada,
  recusaVersaoNotificacao,
} from './tipos.js';
import { marcaComoAtual, recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { ErroProblema } from '../../problema.filter.js';

import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type {
  CandidatosSugestao,
  ContagensAdesaoLidas,
  ContextoQualidade,
  GravadorQualidade,
  PortaQualidade,
} from './porta.js';

/** A chave do estabelecimento da sessão na memória (o código da sessão, ou o id em texto). */
const hospitalDe = (c: ContextoQualidade): string =>
  (c as ContextoQualidade & { readonly hospital?: string }).hospital ?? String(c.estabelecimento ?? '');

/** Produtos SINTÉTICOS do cadastro (a busca da vigilância de produto) e o lote com expostos. */
export const ITENS_SINTETICOS_QUALIDADE: readonly { codigo: number; nome: string }[] = [
  { codigo: 48_201, nome: 'EQUIPO SINTETICO DE INFUSAO' },
  { codigo: 48_202, nome: 'CATETER SINTETICO VENOSO' },
  { codigo: 48_203, nome: 'MEDICAMENTO SINTETICO 500 MG' },
];
export const LOTE_SINTETICO_EXPOSTOS = { item: 48_201, lote: 'LOTE-SINT-1' } as const;
const EXPOSTOS_SINTETICOS: readonly ExpostoAoLote[] = [
  { origem: 'estoque', data: '2026-10-20', atendimento: 48_101, paciente: 48_001, quantidade: 1 },
  { origem: 'consumo-em-sala', data: '2026-10-21', atendimento: 48_102, paciente: 48_002, quantidade: 2 },
];

/** Atendimentos SINTÉTICOS com contexto (a tela de origem do E2E e dos testes). */
export const ATENDIMENTO_SINTETICO_NOTIFICACAO = 48_101;
const CONTEXTOS: readonly ContextoNotificacaoLido[] = [
  {
    atendimento: ATENDIMENTO_SINTETICO_NOTIFICACAO,
    paciente: 48_001,
    nomePaciente: 'PACIENTE SINTETICO QUALIDADE',
    prontuario: 480_001,
    sexo: 'F',
    nascimento: '1950-03-15',
    tipoAtendimento: 'internacao',
    registro: 4_801,
    unidade: 2,
    nomeUnidade: 'Unidade sintética de internação',
    leito: 'S-201',
    acomodacao: 'Enfermaria sintética',
    entradaEm: '2026-10-20T08:00:00',
    encerrado: false,
  },
  {
    atendimento: 48_102,
    paciente: 48_002,
    nomePaciente: 'OUTRO PACIENTE SINTETICO',
    prontuario: 480_002,
    sexo: 'M',
    nascimento: null,
    tipoAtendimento: 'externo',
    registro: null,
    unidade: 1,
    nomeUnidade: 'Unidade sintética',
    leito: null,
    acomodacao: null,
    entradaEm: '2026-10-21T09:00:00',
    encerrado: true,
  },
  // As internações abertas dos pacientes SINTÉTICOS do prontuário em memória (paciente × 10 + 1): o E2E @M48.1
  // notifica a partir do prontuário, e o contexto relido pelo ID do atendimento tem de existir aqui também.
  ...[
    { paciente: 1001, nome: 'JOSÉ DA SILVA SINTETICO', sexo: 'M' as const, nascimento: '1958-03-12' },
    {
      paciente: 1003,
      nome: 'CINTHYA GABRIELLA VIANNA SINTETICO',
      sexo: 'F' as const,
      nascimento: '1990-07-01',
    },
  ].map((p): ContextoNotificacaoLido => ({
    atendimento: p.paciente * 10 + 1,
    paciente: p.paciente,
    nomePaciente: p.nome,
    prontuario: 500_000 + p.paciente,
    sexo: p.sexo,
    nascimento: p.nascimento,
    tipoAtendimento: 'internacao',
    registro: 31_337,
    unidade: 2,
    nomeUnidade: 'Unidade sintética de internação',
    leito: '101A',
    acomodacao: null,
    entradaEm: '2026-10-20T08:00:00',
    encerrado: false,
  })),
];
const UNIDADES: readonly UnidadeNotificacao[] = [
  { codigo: 1, nome: 'Unidade sintética' },
  { codigo: 2, nome: 'Unidade sintética de internação' },
  { codigo: 3, nome: 'Unidade sintética de terapia intensiva' },
];
/** Os feriados nacionais fixos (recorrentes, ano 9999), como o cadastro do pc; os móveis não estão (o aviso aparece). */
const FERIADOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(
  (d) => ({
    data: `9999-${d}`,
    nome: 'Feriado sintético',
  }),
);

type Notificacao = { -readonly [K in keyof NotificacaoRegistrada]: NotificacaoRegistrada[K] } & {
  hospital: string;
  chaveResumo: string | null;
};
interface Evento extends EventoNotificacaoRegistrado {
  readonly notificacao: number;
}
type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Analise = Mutavel<AnaliseRegistrada> & { hospital: string };
type Acao = Mutavel<AcaoPlanoRegistrada> & { hospital: string };
type Queixa = Mutavel<QueixaTecnicaRegistrada> & { hospital: string };
interface Estado {
  protocolos: Map<string, number>;
  notificacoes: Notificacao[];
  eventos: Evento[];
  analises: Analise[];
  acoes: Acao[];
  resolvidas: Set<string>;
  queixas: Queixa[];
  eventosQueixa: (EventoQueixaRegistrado & { queixa: number })[];
  seq: number;
}

const clonar = (s: Estado): Estado => ({
  protocolos: new Map(s.protocolos),
  notificacoes: s.notificacoes.map((n) => ({ ...n })),
  eventos: [...s.eventos],
  analises: s.analises.map((a) => ({ ...a })),
  acoes: s.acoes.map((a) => ({ ...a })),
  resolvidas: new Set(s.resolvidas),
  queixas: s.queixas.map((q) => ({ ...q })),
  eventosQueixa: [...s.eventosQueixa],
  seq: s.seq,
});
const semHospital = <T extends { hospital: string }>(x: T): Omit<T, 'hospital'> => {
  const r: Partial<T> = { ...x };
  delete r.hospital;
  return r as Omit<T, 'hospital'>;
};
const seg = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));

export class PortaQualidadeMemoria implements PortaQualidade {
  readonly destino = 'memoria' as const;
  private estado: Estado = {
    protocolos: new Map(),
    notificacoes: [],
    eventos: [],
    analises: [],
    acoes: [],
    resolvidas: new Set(),
    queixas: [],
    eventosQueixa: [],
    seq: 0,
  };

  /** Candidatos à sugestão e contagens de adesão SINTÉTICOS (os testes e o E2E definem). */
  candidatosSinteticos: Record<string, CandidatosSugestao> = {};
  adesaoSintetica: ContagensAdesaoLidas = {
    checagens: 0,
    checagensComPulseira: 0,
    checklists: 0,
    checklistsConcluidos: 0,
    checklistsComPausa: 0,
    reavaliacoes: [],
  };
  protocolosSinteticos: { versoes: VersaoProtocoloGerenciado[]; protocolos: ProtocoloDoPaciente[] } = {
    versoes: [],
    protocolos: [],
  };

  constructor(private readonly opcoes: { agora?: () => Date } = {}) {}

  /**
   * A porta da sessão sintética de dev e do E2E @M48.2: a enfermeira sintética tem uma dose omitida na checagem de 2
   * horas atrás (a sugestão no diálogo "Notificar incidente") e o painel tem contagens de adesão SINTÉTICAS. Os testes
   * da API usam o construtor (sem nada definido) e definem os próprios dados.
   */
  static sintetica(opcoes: { agora?: () => Date } = {}): PortaQualidadeMemoria {
    const p = new PortaQualidadeMemoria(opcoes);
    const agora = opcoes.agora?.() ?? new Date();
    const horaReal = relogioDoEstabelecimento(new Date(agora.getTime() - 2 * 3_600_000)).agora.slice(0, 19);
    p.candidatosSinteticos['SINT.ENFERMEIRO'] = {
      checagens: [
        {
          id: 48_201,
          situacao: 'N',
          motivo: 'faltaItem',
          avisos: null,
          horaReal,
          atendimento: ATENDIMENTO_SINTETICO_NOTIFICACAO,
        },
      ],
      reacoes: [],
      checklists: [],
    };
    p.adesaoSintetica = {
      checagens: 40,
      checagensComPulseira: 36,
      checklists: 8,
      checklistsConcluidos: 7,
      checklistsComPausa: 8,
      reavaliacoes: [
        { escala: 'morse', devidas: 20, cumpridasNoPrazo: 17 },
        { escala: 'braden', devidas: 12, cumpridasNoPrazo: 12 },
      ],
    };
    return p;
  }

  // ── Etapa 2: leituras ──

  analise(c: ContextoQualidade, notificacao: number): Promise<AnaliseRegistrada | null> {
    const a = this.estado.analises.find((x) => x.notificacao === notificacao && x.hospital === hospitalDe(c));
    return Promise.resolve(a ? semHospital(a) : null);
  }

  acoes(c: ContextoQualidade, notificacao: number): Promise<AcaoPlanoRegistrada[]> {
    return Promise.resolve(
      this.estado.acoes
        .filter((x) => x.notificacao === notificacao && x.hospital === hospitalDe(c))
        .sort((a, b) => a.sequencia - b.sequencia)
        .map(semHospital),
    );
  }

  acoesDoResponsavel(c: ContextoQualidade, login: string): Promise<AcaoPlanoRegistrada[]> {
    const u = login.trim().toUpperCase();
    return Promise.resolve(
      this.estado.acoes
        .filter(
          (x) =>
            x.hospital === hospitalDe(c) &&
            x.quem === u &&
            (x.situacao === 'planejada' || x.situacao === 'emAndamento'),
        )
        .sort((a, b) => a.quando.localeCompare(b.quando) || a.id - b.id)
        .slice(0, 200)
        .map(semHospital),
    );
  }

  queixas(
    c: ContextoQualidade,
    f: {
      readonly situacao?: string;
      readonly area?: string;
      readonly pagina: number;
      readonly porPagina: number;
    },
  ): Promise<{ itens: QueixaTecnicaRegistrada[]; temMais: boolean }> {
    const todas = this.estado.queixas
      .filter(
        (q) =>
          q.hospital === hospitalDe(c) &&
          (!f.situacao || q.situacao === f.situacao) &&
          (!f.area || q.area === f.area),
      )
      .sort((a, b) => b.registradaEm.localeCompare(a.registradaEm) || b.id - a.id);
    const ini = (f.pagina - 1) * f.porPagina;
    return Promise.resolve({
      itens: todas.slice(ini, ini + f.porPagina).map(semHospital),
      temMais: todas.length > ini + f.porPagina,
    });
  }

  queixa(c: ContextoQualidade, id: number): Promise<QueixaTecnicaRegistrada | null> {
    const q = this.estado.queixas.find((x) => x.id === id && x.hospital === hospitalDe(c));
    return Promise.resolve(q ? semHospital(q) : null);
  }

  eventosQueixa(c: ContextoQualidade, id: number): Promise<EventoQueixaRegistrado[]> {
    const q = this.estado.queixas.find((x) => x.id === id && x.hospital === hospitalDe(c));
    return Promise.resolve(
      q
        ? this.estado.eventosQueixa
            .filter((e) => e.queixa === id)
            .map((e) => ({ em: e.em, por: e.por, situacao: e.situacao, conduta: e.conduta, texto: e.texto }))
        : [],
    );
  }

  resolvidas(c: ContextoQualidade, resumos: readonly string[]): Promise<Set<string>> {
    return Promise.resolve(
      new Set(resumos.filter((r) => this.estado.resolvidas.has(`${hospitalDe(c)}:${r}`))),
    );
  }

  candidatos(_c: ContextoQualidade, login: string): Promise<CandidatosSugestao> {
    return Promise.resolve(
      this.candidatosSinteticos[login.trim().toUpperCase()] ?? { checagens: [], reacoes: [], checklists: [] },
    );
  }

  painelNotificacoes(c: ContextoQualidade, de: string, fim: string): Promise<ContagemNotificacoes[]> {
    const m = new Map<string, ContagemNotificacoes>();
    for (const n of this.estado.notificacoes) {
      if (n.hospital !== hospitalDe(c) || n.ocorridoEm.slice(0, 10) < de || n.ocorridoEm.slice(0, 10) >= fim)
        continue;
      const k = [n.tipo, n.classificacao, n.dano, n.neverEvent, n.situacao, n.anonima].join('|');
      const x = m.get(k);
      m.set(k, {
        tipo: n.tipo,
        classificacao: n.classificacao,
        dano: n.dano,
        neverEvent: n.neverEvent,
        situacao: n.situacao,
        anonima: n.anonima,
        quantidade: (x?.quantidade ?? 0) + 1,
      });
    }
    return Promise.resolve([...m.values()]);
  }

  painelAnalises(
    c: ContextoQualidade,
    de: string,
    fim: string,
    hoje: string,
  ): Promise<{ comPrazo: number; concluidas: number; noPrazo: number; vencidas: number }> {
    const r = { comPrazo: 0, concluidas: 0, noPrazo: 0, vencidas: 0 };
    for (const n of this.estado.notificacoes) {
      const d = n.ocorridoEm.slice(0, 10);
      if (
        n.hospital !== hospitalDe(c) ||
        d < de ||
        d >= fim ||
        n.prazoAnalise === null ||
        n.situacao === 'descartada'
      )
        continue;
      r.comPrazo++;
      if (n.analiseConcluidaEm !== null) {
        r.concluidas++;
        if (n.analiseConcluidaEm.slice(0, 10) <= n.prazoAnalise) r.noPrazo++;
      } else if (n.prazoAnalise < hoje) r.vencidas++;
    }
    return Promise.resolve(r);
  }

  painelAcoes(
    c: ContextoQualidade,
    hoje: string,
  ): Promise<{ situacao: string; eficacia: string | null; vencida: boolean; quantidade: number }[]> {
    const m = new Map<
      string,
      { situacao: string; eficacia: string | null; vencida: boolean; quantidade: number }
    >();
    for (const a of this.estado.acoes) {
      if (a.hospital !== hospitalDe(c)) continue;
      const vencida = a.quando < hoje;
      const k = `${a.situacao}|${a.eficacia ?? ''}|${String(vencida)}`;
      const x = m.get(k) ?? { situacao: a.situacao, eficacia: a.eficacia, vencida, quantidade: 0 };
      x.quantidade++;
      m.set(k, x);
    }
    return Promise.resolve([...m.values()]);
  }

  painelAdesao(): Promise<ContagensAdesaoLidas> {
    return Promise.resolve(this.adesaoSintetica);
  }

  historicoRiscos(): Promise<{ ano: number; registros: number }[]> {
    return Promise.resolve([
      { ano: 2020, registros: 80 },
      { ano: 2021, registros: 100 },
      { ano: 2022, registros: 66 },
    ]);
  }

  protocolosGerenciados(): Promise<{
    versoes: VersaoProtocoloGerenciado[];
    protocolos: ProtocoloDoPaciente[];
  }> {
    return Promise.resolve(this.protocolosSinteticos);
  }

  expostos(
    _c: ContextoQualidade,
    item: number,
    lote: string,
  ): Promise<{ itemNome: string | null; expostos: ExpostoAoLote[]; cortada: boolean }> {
    const nome = ITENS_SINTETICOS_QUALIDADE.find((i) => i.codigo === item)?.nome ?? null;
    const sim = item === LOTE_SINTETICO_EXPOSTOS.item && lote === LOTE_SINTETICO_EXPOSTOS.lote;
    return Promise.resolve({ itemNome: nome, expostos: sim ? [...EXPOSTOS_SINTETICOS] : [], cortada: false });
  }

  itens(_c: ContextoQualidade, termo: string): Promise<{ codigo: number; nome: string }[]> {
    const t = termo.trim().toUpperCase();
    return Promise.resolve(
      ITENS_SINTETICOS_QUALIDADE.filter((i) =>
        /^\d+$/.test(t) ? i.codigo === Number(t) : i.nome.includes(t),
      ),
    );
  }

  nomesDosItens(_c: ContextoQualidade, codigos: readonly number[]): Promise<Map<number, string>> {
    return Promise.resolve(
      new Map(
        ITENS_SINTETICOS_QUALIDADE.filter((i) => codigos.includes(i.codigo)).map((i) => [i.codigo, i.nome]),
      ),
    );
  }

  private agoraLocal(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora.slice(0, 19);
  }

  podeGravar(): Promise<LiberacaoGravacao> {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoQualidade, op: string): Promise<never> {
    return Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`));
  }

  relogio(): Promise<string> {
    return Promise.resolve(this.agoraLocal());
  }

  contexto(_c: ContextoQualidade, atendimento: number): Promise<ContextoNotificacaoLido | null> {
    return Promise.resolve(CONTEXTOS.find((x) => x.atendimento === atendimento) ?? null);
  }

  unidades(): Promise<UnidadeNotificacao[]> {
    return Promise.resolve([...UNIDADES]);
  }

  feriados(): Promise<{ data: string; nome: string }[]> {
    return Promise.resolve([...FERIADOS]);
  }

  usuarioAtivo(_c: ContextoQualidade, login: string): Promise<boolean> {
    const c = CONTAS_SINTETICAS[login.trim().toUpperCase()];
    return Promise.resolve(c !== undefined && c.ativo && !c.bloqueado);
  }

  gestores(_c: ContextoQualidade, termo: string): Promise<{ login: string; nome: string }[]> {
    const t = termo.trim().toUpperCase();
    if (t.length < 2) return Promise.resolve([]);
    return Promise.resolve(
      Object.entries(CONTAS_SINTETICAS)
        .filter(([l, c]) => c.ativo && !c.bloqueado && l.includes(t))
        .map(([l]) => ({ login: l, nome: l }))
        .sort((a, b) => a.login.localeCompare(b.login))
        .slice(0, 20),
    );
  }

  private publica(n: Notificacao): NotificacaoRegistrada {
    const r: Partial<Notificacao> = { ...n };
    delete r.hospital;
    delete r.chaveResumo;
    return { ...(r as NotificacaoRegistrada), notificador: n.anonima ? null : n.notificador };
  }

  notificacao(c: ContextoQualidade, id: number): Promise<NotificacaoRegistrada | null> {
    const n = this.estado.notificacoes.find((x) => x.id === id && x.hospital === hospitalDe(c));
    return Promise.resolve(n ? this.publica(n) : null);
  }

  porProtocolo(c: ContextoQualidade, protocolo: string): Promise<NotificacaoRegistrada | null> {
    const n = this.estado.notificacoes.find((x) => x.protocolo === protocolo && x.hospital === hospitalDe(c));
    return Promise.resolve(n ? this.publica(n) : null);
  }

  eventos(c: ContextoQualidade, id: number): Promise<EventoNotificacaoRegistrado[]> {
    const n = this.estado.notificacoes.find((x) => x.id === id && x.hospital === hospitalDe(c));
    return Promise.resolve(
      n
        ? this.estado.eventos
            .filter((e) => e.notificacao === id)
            .map((e) => ({ tipo: e.tipo, em: e.em, por: e.por, texto: e.texto, dados: e.dados }))
        : [],
    );
  }

  lista(
    c: ContextoQualidade,
    f: Omit<FiltroNotificacoes, 'hospital'>,
  ): Promise<{ itens: NotificacaoRegistrada[]; temMais: boolean }> {
    const ids = f.ids ? new Set(f.ids) : null;
    const todas = this.estado.notificacoes
      .filter(
        (n) =>
          n.hospital === hospitalDe(c) &&
          (!f.situacao || n.situacao === f.situacao) &&
          (!f.situacoes || f.situacoes.includes(n.situacao)) &&
          (!f.tipo || n.tipo === f.tipo) &&
          (!f.classificacao || n.classificacao === f.classificacao) &&
          (f.unidade === undefined || (n.unidadeAnalise ?? n.unidade) === f.unidade) &&
          (!f.de || n.notificadaEm.slice(0, 10) >= f.de) &&
          (!f.ate || n.notificadaEm.slice(0, 10) <= f.ate) &&
          (!f.protocolo || n.protocolo === f.protocolo) &&
          (f.gestor === undefined || n.gestor === f.gestor.trim().toUpperCase()) &&
          (!ids || ids.has(n.id)),
      )
      .sort((a, b) => b.notificadaEm.localeCompare(a.notificadaEm) || b.id - a.id);
    const ini = (f.pagina - 1) * f.porPagina;
    return Promise.resolve({
      itens: todas.slice(ini, ini + f.porPagina).map((n) => this.publica(n)),
      temMais: todas.length > ini + f.porPagina,
    });
  }

  comPrazo(c: ContextoQualidade): Promise<{ itens: NotificacaoRegistrada[]; cortada: boolean }> {
    const itens = this.estado.notificacoes
      .filter(
        (n) =>
          n.hospital === hospitalDe(c) &&
          n.situacao !== 'descartada' &&
          ((n.classificacao === 'eventoAdverso' && n.notivisaTranscritaEm === null) ||
            ((n.dano === 'obito' || n.neverEvent) && n.analiseConcluidaEm === null)),
      )
      .sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm) || a.id - b.id)
      .map((n) => this.publica(n));
    return Promise.resolve({ itens, cortada: false });
  }

  async gravarSgh<T>(
    c: ContextoQualidade,
    _trilha: unknown,
    fn: (g: GravadorQualidade) => Promise<T>,
  ): Promise<T> {
    const antes = clonar(this.estado);
    const s = this.estado;
    // Sessão "como": a mesma marca `suporte` em DADOS que a porta do legado grava (ADR 0021, R1).
    const suporte = marcaComoAtual() !== null;
    const evento = (id: number, em: string, evs: readonly EventoNotificacaoNovo[]) => {
      for (const e0 of evs) {
        const e = suporte ? { ...e0, dados: { ...(e0.dados ?? {}), suporte: true } } : e0;
        s.eventos.push({
          notificacao: id,
          tipo: e.tipo,
          em: em.length === 16 ? `${em}:00` : em.slice(0, 19),
          por: e.por,
          texto: e.texto ?? null,
          dados: e.dados ? JSON.stringify(e.dados) : null,
        });
      }
    };
    const linha = (id: number) => {
      const n = s.notificacoes.find((x) => x.id === id && x.hospital === hospitalDe(c));
      if (!n) throw new ErroProblema('nao-encontrado', 404, 'Notificação não encontrada');
      return n;
    };
    const atualizar = (id: number, versao: number, mudar: (n: Notificacao) => void) => {
      const n = linha(id);
      if (n.versao !== versao) throw recusaVersaoNotificacao();
      mudar(n);
      n.versao += 1;
      return { versao: n.versao };
    };
    const mudarAcao = (
      a: { readonly id: number; readonly versao: number; readonly usuario: string; readonly agora: string },
      mudar: (x: Acao) => void,
    ) => {
      const x = s.acoes.find((y) => y.id === a.id && y.hospital === hospitalDe(c));
      if (!x || x.versao !== a.versao)
        throw recusa('versao-desatualizada', 'A ação mudou desde que você abriu a tela.');
      mudar(x);
      x.versao += 1;
      return { versao: x.versao };
    };
    const g: GravadorQualidade = {
      notificar: (x) => {
        if (x.chaveResumo) {
          const ja = s.notificacoes.find((n) => n.chaveResumo === x.chaveResumo);
          if (ja) return Promise.resolve({ id: ja.id, protocolo: ja.protocolo, repetida: true });
        }
        const ano = Number(x.agora.slice(0, 4));
        const k = `${hospitalDe(c)}:${ano}`;
        const seq = (s.protocolos.get(k) ?? 0) + 1;
        if (seq > 999_999)
          throw recusa('protocolo-esgotado', 'O sequencial de notificações do ano chegou ao limite.');
        s.protocolos.set(k, seq);
        const id = ++s.seq;
        const protocolo = x.protocoloDe(ano, seq);
        s.notificacoes.push({
          id,
          hospital: hospitalDe(c),
          protocolo,
          codigoResumo: x.codigoResumo,
          chaveResumo: x.chaveResumo,
          notificadaEm: x.agora.slice(0, 19),
          ocorridoEm: x.ocorridoEm.length === 16 ? `${x.ocorridoEm}:00` : x.ocorridoEm.slice(0, 19),
          atendimento: x.atendimento,
          paciente: x.paciente,
          unidade: x.unidade,
          leito: x.leito,
          local: x.local,
          tipo: x.tipo,
          tipoOutro: x.tipoOutro,
          chegouAoPaciente: x.chegouAoPaciente,
          danoPercebido: x.danoPercebido,
          classificacao: x.classificacao,
          dano: x.danoPercebido,
          neverEvent: false,
          descricao: x.descricao,
          anonima: x.anonima,
          notificador: x.anonima ? null : x.notificador,
          origemTela: x.origemTela,
          origemSugestao: x.origemSugestao,
          situacao: 'recebida',
          triada: false,
          versao: 1,
          gestor: null,
          unidadeAnalise: null,
          prazoAnalise: null,
          motivoDescarte: null,
          duplicadaDe: null,
          notivisaExportadaEm: null,
          notivisaNumero: null,
          notivisaTranscritaEm: null,
          analiseConcluidaEm: null,
        });
        evento(id, x.agora, [{ tipo: 'recebida', por: x.anonima ? 'anonimo' : x.notificador }]);
        return Promise.resolve({ id, protocolo, repetida: false });
      },
      travar: (id) => Promise.resolve(this.publica(linha(id))),
      triar: (t) => {
        const r = atualizar(t.id, t.versao, (n) => {
          n.tipo = t.tipo;
          n.tipoOutro = t.tipo === 'outro' ? t.tipoOutro : null;
          n.classificacao = t.classificacao;
          n.dano = t.dano;
          n.neverEvent = t.neverEvent;
          n.triada = true;
          if (n.situacao === 'recebida') n.situacao = 'triada';
        });
        evento(
          t.id,
          t.agora,
          t.eventos.map((tipo) => ({
            tipo,
            por: t.usuario,
            texto: tipo === 'reclassificada' ? t.justificativa : null,
          })),
        );
        return Promise.resolve(r);
      },
      descartar: (d) => {
        const r = atualizar(d.id, d.versao, (n) => {
          n.situacao = 'descartada';
          n.motivoDescarte = d.motivo;
          n.duplicadaDe = d.duplicadaDe;
        });
        evento(d.id, d.agora, [{ tipo: 'descartada', por: d.usuario, texto: d.justificativa }]);
        return Promise.resolve(r);
      },
      distribuir: (d) => {
        const r = atualizar(d.id, d.versao, (n) => {
          n.situacao = 'distribuida';
          n.gestor = d.gestor;
          n.unidadeAnalise = d.unidade;
          n.prazoAnalise = d.prazoAnalise;
        });
        evento(d.id, d.agora, [{ tipo: 'distribuida', por: d.usuario, texto: d.orientacao }]);
        return Promise.resolve(r);
      },
      devolver: (d) => {
        const r = atualizar(d.id, d.versao, () => undefined);
        evento(d.id, d.agora, [{ tipo: 'devolutiva', por: d.usuario, texto: d.texto }]);
        return Promise.resolve(r);
      },
      notivisaExportada: (m) => {
        const n = linha(m.id);
        if (n.notivisaExportadaEm !== null) return Promise.resolve({ marcou: false });
        n.notivisaExportadaEm = m.agora.slice(0, 19);
        evento(m.id, m.agora, [{ tipo: 'notivisaExportada', por: m.usuario }]);
        return Promise.resolve({ marcou: true });
      },
      travarAnalise: (n) => this.analise(c, n),
      acoesNaTransacao: (n) => this.acoes(c, n),
      registrarAnalise: (a) => {
        const concl = a.concluir;
        let id: number;
        let versao: number;
        if (a.atual === null) {
          if (s.analises.some((x) => x.notificacao === a.notificacao && x.hospital === hospitalDe(c)))
            throw recusa('versao-desatualizada', 'A análise mudou desde que você abriu a tela.');
          id = ++s.seq;
          versao = 1;
          s.analises.push({
            id,
            hospital: hospitalDe(c),
            notificacao: a.notificacao,
            metodo: a.metodo,
            conteudo: a.conteudo,
            causaRaiz: a.causaRaiz,
            fatores: [...a.fatores],
            licoes: a.licoes,
            semAcaoJustificativa: a.semAcaoJustificativa,
            situacao: concl ? 'concluida' : 'rascunho',
            versao,
            registradaPor: a.usuario,
            registradaEm: seg(a.agora),
            atualizadaEm: null,
            concluidaEm: concl ? seg(a.agora) : null,
            concluidaPor: concl ? a.usuario : null,
          });
        } else {
          const atual = a.atual;
          const x = s.analises.find((y) => y.id === atual.id && y.hospital === hospitalDe(c));
          if (!x || x.versao !== atual.versao || x.situacao !== 'rascunho')
            throw recusa('versao-desatualizada', 'A análise mudou desde que você abriu a tela.');
          Object.assign(x, {
            metodo: a.metodo,
            conteudo: a.conteudo,
            causaRaiz: a.causaRaiz,
            fatores: [...a.fatores],
            licoes: a.licoes,
            semAcaoJustificativa: a.semAcaoJustificativa,
            situacao: concl ? 'concluida' : 'rascunho',
            versao: x.versao + 1,
            atualizadaEm: seg(a.agora),
            concluidaEm: concl ? seg(a.agora) : null,
            concluidaPor: concl ? a.usuario : null,
          });
          id = x.id;
          versao = x.versao;
        }
        let versaoNotificacao = a.versaoNotificacao;
        const novaSituacao = a.situacaoNotificacao;
        if (novaSituacao !== null)
          versaoNotificacao = atualizar(a.notificacao, a.versaoNotificacao, (n) => {
            n.situacao = novaSituacao;
            if (concl) n.analiseConcluidaEm = seg(a.agora);
          }).versao;
        evento(
          a.notificacao,
          a.agora,
          a.eventos.map((tipo) => ({ tipo, por: a.usuario })),
        );
        return Promise.resolve({ id, versao, versaoNotificacao });
      },
      travarAcao: (n, id) => {
        const x = s.acoes.find((y) => y.id === id && y.notificacao === n && y.hospital === hospitalDe(c));
        if (!x) throw new ErroProblema('nao-encontrado', 404, 'A ação não encontrado');
        return Promise.resolve(semHospital(x));
      },
      incluirAcao: (a) => {
        const sequencia =
          Math.max(
            0,
            ...s.acoes
              .filter((x) => x.notificacao === a.notificacao && x.hospital === hospitalDe(c))
              .map((x) => x.sequencia),
          ) + 1;
        const id = ++s.seq;
        s.acoes.push({
          id,
          hospital: hospitalDe(c),
          notificacao: a.notificacao,
          sequencia,
          ...a.acao,
          quem: a.acao.quem.trim().toUpperCase(),
          situacao: 'planejada',
          texto: null,
          concluidaEm: null,
          eficacia: null,
          eficaciaTexto: null,
          eficaciaEm: null,
          eficaciaPor: null,
          versao: 1,
          criadaPor: a.usuario,
          criadaEm: seg(a.agora),
        });
        return Promise.resolve({ id, sequencia, versao: 1 });
      },
      alterarAcao: (a) =>
        Promise.resolve(
          mudarAcao(a, (x) => Object.assign(x, { ...a.acao, quem: a.acao.quem.trim().toUpperCase() })),
        ),
      situacaoAcao: (a) =>
        Promise.resolve(
          mudarAcao(a, (x) => {
            x.situacao = a.situacao;
            if (a.encerra) {
              x.texto = a.texto;
              x.concluidaEm = seg(a.agora);
            }
          }),
        ),
      eficaciaAcao: (a) =>
        Promise.resolve(
          mudarAcao(a, (x) => {
            x.eficacia = a.eficacia;
            x.eficaciaTexto = a.texto;
            x.eficaciaEm = seg(a.agora);
            x.eficaciaPor = a.usuario;
          }),
        ),
      resolverSugestao: (r) => {
        const k = `${hospitalDe(c)}:${r.resumo}`;
        if (s.resolvidas.has(k)) return Promise.resolve({ gravou: false });
        s.resolvidas.add(k);
        return Promise.resolve({ gravou: true });
      },
      abrirQueixa: (q) => {
        const id = ++s.seq;
        s.queixas.push({
          id,
          hospital: hospitalDe(c),
          area: q.area,
          tipo: q.tipo,
          item: q.item,
          produto: q.produto,
          lote: q.lote,
          serie: q.serie,
          fabricante: q.fabricante,
          registroAnvisa: q.registroAnvisa,
          descricao: q.descricao,
          notificacao: q.notificacao,
          alerta: q.alerta,
          conduta: q.conduta,
          situacao: 'aberta',
          notivisaNumero: null,
          versao: 1,
          registradaPor: q.usuario,
          registradaEm: seg(q.agora),
          atualizadaEm: null,
          encerradaEm: null,
        });
        s.eventosQueixa.push({
          queixa: id,
          em: seg(q.agora),
          por: q.usuario,
          situacao: 'aberta',
          conduta: q.conduta,
          texto: null,
        });
        return Promise.resolve({ id, versao: 1 });
      },
      travarQueixa: (id) => {
        const q = s.queixas.find((x) => x.id === id && x.hospital === hospitalDe(c));
        if (!q) throw new ErroProblema('nao-encontrado', 404, 'O registro não encontrado');
        return Promise.resolve(semHospital(q));
      },
      andamentoQueixa: (a) => {
        const q = s.queixas.find((x) => x.id === a.id && x.hospital === hospitalDe(c));
        if (!q || q.versao !== a.versao || q.situacao === 'encerrada')
          throw recusa('versao-desatualizada', 'O registro mudou desde que você abriu a tela.');
        Object.assign(q, {
          situacao: a.situacao,
          conduta: a.conduta,
          notivisaNumero: a.notivisaNumero,
          encerradaEm: a.encerra ? seg(a.agora) : null,
          versao: q.versao + 1,
          atualizadaEm: seg(a.agora),
        });
        s.eventosQueixa.push({
          queixa: a.id,
          em: seg(a.agora),
          por: a.usuario,
          situacao: a.situacao,
          conduta: a.conduta,
          texto: a.texto,
        });
        return Promise.resolve({ versao: q.versao });
      },
      transcricao: (t) => {
        const r = atualizar(t.id, t.versao, (n) => {
          n.notivisaNumero = t.numeroNotivisa;
          n.notivisaTranscritaEm = t.transcritaEm.length === 16 ? `${t.transcritaEm}:00` : t.transcritaEm;
          n.notivisaExportadaEm ??= t.agora.slice(0, 19);
        });
        evento(t.id, t.agora, [{ tipo: 'notivisaTranscrita', por: t.usuario }]);
        return Promise.resolve(r);
      },
    };
    try {
      return await fn(g);
    } catch (x) {
      this.estado = antes;
      throw x;
    }
  }
}
