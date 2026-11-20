// Porta da escala EM MEMÓRIA (M52.2; dev/ci com a sessão sintética; E2E): domínios sintéticos do ramo (jornada, tempo
// parcial com o limite da ref 02, trabalho/folga), regimes, escalas, plantões e a trilha da escala, com as MESMAS regras
// das gravações SGH_ (versão, chaves únicas, escala tocada a cada plantão, publicação uma vez, vigência e trilha só de
// inclusão). A Rede em memória são os outros estabelecimentos que já têm estado aqui; a mesma pessoa é achada pelo HMAC
// do CPF do vínculo na porta de pessoas em memória. A transação é tudo ou nada (o estado só troca no fim). Nada vai à
// cópia; nenhum dado real.
import type {
  AcionamentoPesLido,
  DimensionamentoPesLido,
  EscalaPesLida,
  EventoEscalaPesLido,
  LiberacaoConsultada,
  LinhaTrilha,
  OpcaoDominioLida,
  PlantaoPesLido,
  RegimePesLido,
  PlantaoNoInstanteLido,
  TempoParcialLido,
  TrocaPesLida,
  UnidadeInternacaoLida,
  VigenciaRegimeHistoricoLida,
  VigenciaRegimeLida,
  VinculoPessoasContado,
} from '@sgh/legado';
import { ErroOperacao } from '@sgh/legado';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoasMemoria } from '../porta-memoria.js';
import {
  type ContextoEscala,
  type GravadorEscala,
  type JanelaPlantoes,
  type PlantoesDaRede,
  type PortaEscala,
  soLiberados,
} from './porta-escala.js';

const JORNADAS: readonly OpcaoDominioLida[] = [
  { codigo: 1, nome: 'Normal' },
  { codigo: 2, nome: 'Escalonada' },
  { codigo: 3, nome: 'Horista, mensal' },
];
const PARCIAIS: readonly TempoParcialLido[] = [
  { codigo: 0, nome: 'Não é contrato em tempo parcial', limiteSemanalHoras: null },
  { codigo: 1, nome: 'Limitado a 25 horas semanais', limiteSemanalHoras: 25 },
  { codigo: 2, nome: 'Limitado a 30 horas semanais', limiteSemanalHoras: 30 },
  { codigo: 3, nome: 'Limitado a 26 horas semanais', limiteSemanalHoras: 26 },
];
const FOLGAS: readonly OpcaoDominioLida[] = [
  { codigo: 1, nome: 'Folga, por dias para folga conforme horário padrão' },
  { codigo: 3, nome: 'Folga, por troca de plantão' },
];

interface PlantaoMem extends PlantaoPesLido {
  readonly hospital: string;
}

interface Estado {
  seq: number;
  regimes: Map<number, RegimePesLido>;
  vigencias: (VigenciaRegimeLida & {
    id: number;
    em?: string;
    anulada?: { por: string; em: string; motivo: string } | null;
  })[];
  /** W0-06: o retrato das linhas apagadas (a SGH_HIST_EXCLUSAO em memória). */
  retratos: { tabela: string; chave: string; motivo: string; por: string }[];
  escalas: Map<number, Omit<EscalaPesLida, 'plantoes'>>;
  plantoes: Map<number, PlantaoMem>;
  eventos: (EventoEscalaPesLido & { escala: number })[];
  outbox: { tipo: string; chave: string; carga: Record<string, string | number> }[];
  trocas: Map<number, TrocaPesLida>;
  acionamentos: Map<number, AcionamentoPesLido>;
  dimensionamentos: DimensionamentoPesLido[];
}

/**
 * M52.3: a unidade de internação sintética da classificação de pacientes, com 12 internados e as classificações do
 * turno (5 mínimos, 4 intermediários, 2 de alta dependência e 1 pelo NAS); nenhum paciente real.
 */
export const UNIDADE_INTERNACAO_SINTETICA: UnidadeInternacaoLida = {
  unidade: 'UIS',
  nome: 'Internação sintética',
  internados: 12,
};
const CLASSIFICACOES_SINTETICAS = [
  ...Array.from({ length: 5 }, () => ({ instrumento: 'fugulin' as const, categoria: 'minimos', total: 14 })),
  ...Array.from({ length: 4 }, () => ({
    instrumento: 'fugulin' as const,
    categoria: 'intermediarios',
    total: 20,
  })),
  ...Array.from({ length: 2 }, () => ({
    instrumento: 'fugulin' as const,
    categoria: 'altaDependencia',
    total: 25,
  })),
  { instrumento: 'nas' as const, categoria: 'nas', total: 65.2 },
].map((x, i) => ({ ...x, paciente: 990001 + i }));

const novo = (): Estado => ({
  seq: 0,
  regimes: new Map(),
  vigencias: [],
  escalas: new Map(),
  plantoes: new Map(),
  eventos: [],
  outbox: [],
  trocas: new Map(),
  acionamentos: new Map(),
  dimensionamentos: [],
  retratos: [],
});
const copia = (s: Estado): Estado => ({
  seq: s.seq,
  regimes: new Map(s.regimes),
  vigencias: [...s.vigencias],
  escalas: new Map(s.escalas),
  plantoes: new Map(s.plantoes),
  eventos: [...s.eventos],
  outbox: [...s.outbox],
  trocas: new Map(s.trocas),
  acionamentos: new Map(s.acionamentos),
  dimensionamentos: [...s.dimensionamentos],
  retratos: [...s.retratos],
});

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'A escala mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );
const agora = () => new Date().toISOString().slice(0, 16);
const toca = (a: { inicio: string; fim: string }, j: JanelaPlantoes) =>
  a.inicio >= j.inicioDesde && a.inicio < j.ate && a.fim > j.de;

export class PortaEscalaMemoria implements PortaEscala {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: estabelecimentos da Rede que não respondem. */
  readonly indisponiveis = new Set<string>();

  constructor(private readonly pessoas: PortaPessoasMemoria | null = null) {}

  private e(c: { hospital: string }): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) this.estados.set(c.hospital, (s = novo()));
    return s;
  }

  /** Testes: o que foi à outbox no estabelecimento. */
  eventosOutbox(hospital: string) {
    return [...(this.estados.get(hospital)?.outbox ?? [])];
  }

  private comContagem(s: Estado, x: Omit<EscalaPesLida, 'plantoes'>): EscalaPesLida {
    const plantoes = [...s.plantoes.values()].filter(
      (p) => p.escala === x.id && p.situacao === 'previsto',
    ).length;
    return { ...x, plantoes };
  }

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: false, codigo: 'operacao-desconhecida', motivo: 'A escala não grava no outro sistema.' };
  }
  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'A escala só grava em SGH_.');
  }

  async gravarSgh<T>(
    c: ContextoEscala,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorEscala) => Promise<T>,
  ): Promise<T> {
    const s = copia(this.e(c));
    const h = c.hospital;
    const escala = (id: number) => s.escalas.get(id) ?? null;
    const g: GravadorEscala = {
      escala: async (id) => {
        const x = escala(id);
        return x ? this.comContagem(s, x) : null;
      },
      plantao: async (id) => s.plantoes.get(id) ?? null,
      plantoesDaEscala: async (id) => [...s.plantoes.values()].filter((p) => p.escala === id),
      plantoesDaPessoa: async (pessoa, j) =>
        [...s.plantoes.values()].filter(
          (p) => p.pessoa === pessoa && p.situacao === 'previsto' && toca(p, j),
        ),
      travarPessoa: async () => undefined,
      regime: async (id) => s.regimes.get(id) ?? null,
      incluirRegime: async (r) => {
        if ([...s.regimes.values()].some((x) => x.codigo === r.codigo))
          throw recusa('regime-existente', 'Já existe regime com esta sigla neste estabelecimento.');
        const id = ++s.seq;
        s.regimes.set(id, {
          codigo: r.codigo,
          nome: r.nome,
          jornada: r.jornada,
          contratoParcial: r.contratoParcial,
          folgaPadrao: r.folgaPadrao,
          minutosPlantao: r.minutosPlantao,
          descansoMinimoMin: r.descansoMinimoMin,
          limiteSemanalHoras: r.limiteSemanalHoras,
          acordo: r.acordo,
          ativo: r.ativo,
          id,
          hospital: h,
          versao: 0,
        });
        return id;
      },
      alterarRegime: async (r) => {
        const x = s.regimes.get(r.id);
        if (!x || x.versao !== r.versao) throw desatualizado();
        if ([...s.regimes.values()].some((y) => y.id !== r.id && y.codigo === r.codigo))
          throw recusa('regime-existente', 'Já existe regime com esta sigla neste estabelecimento.');
        s.regimes.set(r.id, {
          ...x,
          codigo: r.codigo,
          nome: r.nome,
          jornada: r.jornada,
          contratoParcial: r.contratoParcial,
          folgaPadrao: r.folgaPadrao,
          minutosPlantao: r.minutosPlantao,
          descansoMinimoMin: r.descansoMinimoMin,
          limiteSemanalHoras: r.limiteSemanalHoras,
          acordo: r.acordo,
          ativo: r.ativo,
          versao: x.versao + 1,
        });
      },
      atribuirRegime: async (a) => {
        if (s.vigencias.some((v) => v.vinculo === a.vinculo && v.desde === a.desde && !v.anulada))
          throw recusa('vigencia-repetida', 'O colaborador já tem regime registrado a partir desta data.');
        const id = ++s.seq;
        s.vigencias.push({
          id,
          vinculo: a.vinculo,
          regime: a.regime,
          desde: a.desde,
          por: a.por,
          em: agora(),
          anulada: null,
        });
        return id;
      },
      incluirEscala: async (x) => {
        if (
          [...s.escalas.values()].some(
            (y) =>
              y.unidade === x.unidade &&
              y.setor === x.setor &&
              y.competencia === x.competencia &&
              y.tipo === x.tipo,
          )
        )
          throw recusa(
            'escala-existente',
            'Já existe escala deste tipo para a unidade, o setor e a competência.',
          );
        const id = ++s.seq;
        s.escalas.set(id, {
          id,
          hospital: h,
          unidade: x.unidade,
          setor: x.setor,
          competencia: x.competencia,
          tipo: x.tipo,
          estado: 'rascunho',
          cobertura: { ...x.cobertura },
          justificativaFuro: null,
          publicadaEm: null,
          publicadaPor: null,
          versao: 0,
        });
        await g.evento({
          escala: id,
          plantao: null,
          acao: 'criada',
          descricao: `Competência ${x.competencia}; cobertura mínima ${x.cobertura.manha}/${x.cobertura.tarde}/${x.cobertura.noite}`,
          motivo: null,
          por: x.por,
        });
        return id;
      },
      alterarCobertura: async (x) => {
        const y = escala(x.id);
        if (!y || y.versao !== x.versao) throw desatualizado();
        s.escalas.set(x.id, { ...y, cobertura: { ...x.cobertura }, versao: y.versao + 1 });
      },
      tocarEscala: async (t) => {
        const y = escala(t.id);
        if (!y || y.estado !== t.estado) throw desatualizado();
        s.escalas.set(t.id, { ...y, versao: y.versao + 1 });
      },
      publicarEscala: async (p) => {
        const y = escala(p.id);
        if (!y || y.versao !== p.versao || y.estado !== 'rascunho') throw desatualizado();
        s.escalas.set(p.id, {
          ...y,
          estado: 'publicada',
          publicadaEm: agora(),
          publicadaPor: p.por,
          justificativaFuro: p.justificativaFuro,
          versao: y.versao + 1,
        });
      },
      incluirPlantao: async (p) => {
        const id = ++s.seq;
        s.plantoes.set(id, {
          id,
          hospital: h,
          escala: p.escala,
          vinculo: p.vinculo,
          pessoa: p.pessoa,
          profissional: p.profissional,
          registro: p.registro,
          tipo: p.tipo,
          inicio: p.inicio,
          fim: p.fim,
          chegadaMin: p.chegadaMin,
          situacao: 'previsto',
          alertaConselho: p.alertaConselho,
          redeNaoConferida: p.redeNaoConferida,
          motivo: p.motivo,
          versao: 0,
        });
        return id;
      },
      alterarPlantao: async (m) => {
        const x = s.plantoes.get(m.id);
        if (!x || x.versao !== m.versao || x.situacao !== 'previsto') throw desatualizado();
        s.plantoes.set(m.id, {
          ...x,
          tipo: m.tipo,
          inicio: m.inicio,
          fim: m.fim,
          chegadaMin: m.chegadaMin,
          registro: m.registro,
          alertaConselho: m.alertaConselho,
          redeNaoConferida: m.redeNaoConferida,
          motivo: m.motivo,
          versao: x.versao + 1,
        });
      },
      cancelarPlantao: async (x) => {
        const y = s.plantoes.get(x.id);
        if (!y || y.versao !== x.versao || y.situacao !== 'previsto') throw desatualizado();
        s.plantoes.set(x.id, { ...y, situacao: 'cancelado', motivo: x.motivo, versao: y.versao + 1 });
      },
      evento: async (ev) => {
        const id = ++s.seq;
        s.eventos.push({
          id,
          escala: ev.escala,
          plantao: ev.plantao,
          acao: ev.acao,
          descricao: ev.descricao.slice(0, 200),
          motivo: ev.motivo,
          por: ev.por,
          em: agora(),
        });
        return id;
      },
      outbox: async (ev) => {
        // A chave do evento é única, como na SGH_OUTBOX (CHAVE_EVENTO).
        if (s.outbox.some((o) => o.chave === ev.chave))
          throw new Error(`Chave de evento repetida: ${ev.chave}`);
        s.outbox.push(ev);
        return `mem-${s.outbox.length}`;
      },
      // ── F3 (M52.3) ──
      troca: async (id) => s.trocas.get(id) ?? null,
      plantoesEmTrocaAberta: async (ids) => emTrocaAberta(s, ids),
      incluirTroca: async (t) => {
        const id = ++s.seq;
        s.trocas.set(id, {
          id,
          hospital: h,
          tipo: t.tipo,
          estado: 'pedida',
          plantao: t.plantao,
          versaoPlantao: t.versaoPlantao,
          vinculo: t.vinculo,
          vinculoColega: t.vinculoColega,
          plantaoColega: t.plantaoColega,
          versaoColega: t.versaoColega,
          motivo: t.motivo,
          pedidoPor: t.por,
          pedidoEm: agora(),
          respostaPor: null,
          respostaEm: null,
          confirmacao: null,
          decisaoPor: null,
          decisaoEm: null,
          motivoDecisao: null,
          versao: 0,
        });
        return id;
      },
      responderTroca: async (r) => {
        const x = s.trocas.get(r.id);
        if (!x || x.versao !== r.versao || x.estado !== 'pedida') throw desatualizado();
        s.trocas.set(r.id, {
          ...x,
          estado: r.estado,
          respostaPor: r.por,
          respostaEm: agora(),
          confirmacao: r.confirmacao,
          versao: x.versao + 1,
        });
      },
      decidirTroca: async (d) => {
        const x = s.trocas.get(d.id);
        if (!x || x.versao !== d.versao || x.estado !== 'aceita') throw desatualizado();
        s.trocas.set(d.id, {
          ...x,
          estado: d.estado,
          decisaoPor: d.por,
          decisaoEm: agora(),
          motivoDecisao: d.motivo,
          versao: x.versao + 1,
        });
      },
      cancelarTroca: async (c) => {
        const x = s.trocas.get(c.id);
        if (!x || x.versao !== c.versao || (x.estado !== 'pedida' && x.estado !== 'aceita'))
          throw desatualizado();
        s.trocas.set(c.id, {
          ...x,
          estado: 'cancelada',
          decisaoPor: c.por,
          decisaoEm: agora(),
          motivoDecisao: c.motivo,
          versao: x.versao + 1,
        });
      },
      transferirPlantao: async (t) => {
        const x = s.plantoes.get(t.id);
        if (!x || x.versao !== t.versao || x.situacao !== 'previsto') throw desatualizado();
        s.plantoes.set(t.id, {
          ...x,
          vinculo: t.vinculo,
          pessoa: t.pessoa,
          profissional: t.profissional,
          registro: t.registro,
          alertaConselho: t.alertaConselho,
          redeNaoConferida: t.redeNaoConferida,
          motivo: t.motivo,
          versao: x.versao + 1,
        });
      },
      acionamento: async (id) => s.acionamentos.get(id) ?? null,
      acionamentosDosPlantoes: async (ids) => acionamentosDe(s, ids),
      incluirAcionamento: async (a) => {
        const id = ++s.seq;
        s.acionamentos.set(id, {
          id,
          plantao: a.plantao,
          situacao: 'acionado',
          acionadoEm: a.acionadoEm,
          acionadoPor: a.por,
          motivo: a.motivo,
          atendimento: a.atendimento,
          prazoChegada: a.prazoChegada,
          chegouEm: null,
          encerradoPor: null,
          motivoCancelamento: null,
          versao: 0,
        });
        return id;
      },
      registrarChegada: async (c) => {
        const x = s.acionamentos.get(c.id);
        if (!x || x.versao !== c.versao || x.situacao !== 'acionado') throw desatualizado();
        s.acionamentos.set(c.id, {
          ...x,
          situacao: 'chegou',
          chegouEm: c.chegouEm,
          encerradoPor: c.por,
          versao: x.versao + 1,
        });
      },
      cancelarAcionamento: async (c) => {
        const x = s.acionamentos.get(c.id);
        if (!x || x.versao !== c.versao || x.situacao !== 'acionado') throw desatualizado();
        s.acionamentos.set(c.id, {
          ...x,
          situacao: 'cancelado',
          motivoCancelamento: c.motivo,
          encerradoPor: c.por,
          versao: x.versao + 1,
        });
      },
      incluirDimensionamento: async (d) => {
        const id = ++s.seq;
        const { por, ...resto } = d;
        s.dimensionamentos.push({ ...resto, id, calculadoPor: por, calculadoEm: agora() });
        return id;
      },
      dependenciasEscala: async (id) => this.dependencias(s, h, id),
      excluirEscalaRascunho: async (x) => {
        const y = escala(x.id);
        if (!y || y.versao !== x.versao || y.estado !== 'rascunho') throw desatualizado();
        const v = this.dependencias(s, h, x.id);
        if (v.length > 0)
          throw recusa(
            'escala-com-vinculos',
            `A escala tem registros ligados e não pode ser excluída (${v.map((d) => `${d.grupo}: ${d.quantidade}`).join('; ')}).`,
          );
        const plantoes = [...s.plantoes.values()].filter((p) => p.escala === x.id);
        const eventos = s.eventos.filter((e) => e.escala === x.id);
        const foto = (tabela: string, id: number) => ({
          tabela,
          chave: `ID=${id}`,
          motivo: x.motivo,
          por: x.por,
        });
        s.retratos.push(
          foto('SGH_PES_ESCALA', x.id),
          ...plantoes.map((p) => foto('SGH_PES_PLANTAO', p.id)),
          ...eventos.map((e) => foto('SGH_PES_ESCALA_EVENTO', e.id)),
        );
        for (const p of plantoes) s.plantoes.delete(p.id);
        s.eventos = s.eventos.filter((e) => e.escala !== x.id);
        s.escalas.delete(x.id);
        return { retratos: 1 + plantoes.length + eventos.length, plantoes: plantoes.length };
      },
      cancelarEscala: async (x) => {
        const y = escala(x.id);
        if (!y || y.versao !== x.versao || y.estado !== 'publicada') throw desatualizado();
        s.escalas.set(x.id, {
          ...y,
          estado: 'cancelada',
          canceladaEm: agora(),
          canceladaPor: x.por,
          motivoCancelamento: x.motivo,
          versao: y.versao + 1,
        });
        let n = 0;
        for (const p of [...s.plantoes.values()])
          if (p.escala === x.id && p.situacao === 'previsto') {
            s.plantoes.set(p.id, { ...p, situacao: 'cancelado', motivo: x.motivo, versao: p.versao + 1 });
            n++;
          }
        return n;
      },
      historicoVigencias: async (v) => this.historico(s, v),
      anularVigencia: async (a) => {
        const i = s.vigencias.findIndex((v) => v.id === a.id && !v.anulada);
        if (i < 0) throw desatualizado();
        s.vigencias[i] = { ...s.vigencias[i]!, anulada: { por: a.por, em: agora(), motivo: a.motivo } };
      },
      eventosPeriodo: async () => null,
    };
    const r = await fn(g);
    this.estados.set(h, s);
    return r;
  }

  async tiposJornada(): Promise<OpcaoDominioLida[]> {
    return [...JORNADAS];
  }
  async temposParciais(): Promise<TempoParcialLido[]> {
    return [...PARCIAIS];
  }
  async tiposTrabalhoFolga(): Promise<OpcaoDominioLida[]> {
    return [...FOLGAS];
  }
  async regimes(c: ContextoEscala): Promise<RegimePesLido[]> {
    return [...this.e(c).regimes.values()].sort((a, b) => a.codigo.localeCompare(b.codigo) || a.id - b.id);
  }
  async regime(c: ContextoEscala, id: number): Promise<RegimePesLido | null> {
    return this.e(c).regimes.get(id) ?? null;
  }
  async vigencias(c: ContextoEscala, vinculos: readonly number[]): Promise<VigenciaRegimeLida[]> {
    return this.e(c)
      .vigencias.filter((v) => vinculos.includes(v.vinculo) && !v.anulada)
      .map((v) => ({ vinculo: v.vinculo, regime: v.regime, desde: v.desde, por: v.por }))
      .sort((a, b) => a.vinculo - b.vinculo || a.desde.localeCompare(b.desde));
  }
  async escalas(c: ContextoEscala, f: Parameters<PortaEscala['escalas']>[1]): Promise<EscalaPesLida[]> {
    const s = this.e(c);
    return [...s.escalas.values()]
      .filter(
        (x) =>
          (!f.competencia || x.competencia === f.competencia) &&
          (f.unidade === undefined || x.unidade === f.unidade) &&
          (!f.tipo || x.tipo === f.tipo) &&
          (!f.estado || x.estado === f.estado),
      )
      .sort((a, b) => b.competencia.localeCompare(a.competencia) || b.id - a.id)
      .slice(0, 200)
      .map((x) => this.comContagem(s, x));
  }
  async escala(c: ContextoEscala, id: number): Promise<EscalaPesLida | null> {
    const s = this.e(c);
    const x = s.escalas.get(id);
    return x ? this.comContagem(s, x) : null;
  }
  async plantoesDaEscala(c: ContextoEscala, escala: number): Promise<PlantaoPesLido[]> {
    return [...this.e(c).plantoes.values()].filter((p) => p.escala === escala).sort((a, b) => a.id - b.id);
  }
  async plantoesDaPessoa(c: ContextoEscala, pessoa: number, j: JanelaPlantoes): Promise<PlantaoPesLido[]> {
    return [...this.e(c).plantoes.values()].filter(
      (p) => p.pessoa === pessoa && p.situacao === 'previsto' && toca(p, j),
    );
  }
  async eventos(c: ContextoEscala, escala: number): Promise<EventoEscalaPesLido[]> {
    return this.e(c)
      .eventos.filter((x) => x.escala === escala)
      .sort((a, b) => b.id - a.id)
      .map((x) => ({
        id: x.id,
        plantao: x.plantao,
        acao: x.acao,
        descricao: x.descricao,
        motivo: x.motivo,
        por: x.por,
        em: x.em,
      }));
  }
  async plantoesNaRede(
    c: ContextoEscala,
    vinculo: number,
    j: JanelaPlantoes,
    liberado?: (estabelecimento: string) => Promise<boolean>,
  ): Promise<PlantoesDaRede> {
    const outros = await soLiberados(
      [...this.estados.keys()].filter((h) => h !== c.hospital),
      liberado,
    );
    if (outros.length === 0) return { intervalos: [], semResposta: 0 };
    const hmac = this.pessoas?.cpfHmacDoVinculo(c.hospital, vinculo) ?? null;
    if (!hmac) return { intervalos: [], semResposta: outros.length };
    const intervalos: { inicio: string; fim: string }[] = [];
    let semResposta = 0;
    for (const h of outros) {
      if (this.indisponiveis.has(h)) {
        semResposta++;
        continue;
      }
      for (const p of this.estados.get(h)!.plantoes.values())
        if (p.situacao === 'previsto' && toca(p, j) && this.pessoas?.cpfHmacDoVinculo(h, p.vinculo) === hmac)
          intervalos.push({ inicio: p.inicio, fim: p.fim });
    }
    return { intervalos, semResposta };
  }

  // ── F3 (M52.3) ──
  async plantao(c: ContextoEscala, id: number): Promise<PlantaoPesLido | null> {
    return this.e(c).plantoes.get(id) ?? null;
  }
  async trocas(c: ContextoEscala, f: Parameters<PortaEscala['trocas']>[1]): Promise<TrocaPesLida[]> {
    const s = this.e(c);
    const daEscala = (p: number | null) => p !== null && s.plantoes.get(p)?.escala === f.escala;
    return [...s.trocas.values()]
      .filter(
        (t) =>
          (!f.estado || t.estado === f.estado) &&
          (f.escala === undefined || daEscala(t.plantao) || daEscala(t.plantaoColega)) &&
          (!f.vinculos || f.vinculos.includes(t.vinculo) || f.vinculos.includes(t.vinculoColega)),
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, 200);
  }
  async troca(c: ContextoEscala, id: number): Promise<TrocaPesLida | null> {
    return this.e(c).trocas.get(id) ?? null;
  }
  async plantoesEmTrocaAberta(c: ContextoEscala, ids: readonly number[]): Promise<Set<number>> {
    return emTrocaAberta(this.e(c), ids);
  }
  async plantoesNoInstante(
    c: ContextoEscala,
    instante: string,
    inicioDesde: string,
    f: Parameters<PortaEscala['plantoesNoInstante']>[3],
  ): Promise<PlantaoNoInstanteLido[]> {
    const s = this.e(c);
    const r: PlantaoNoInstanteLido[] = [];
    for (const p of s.plantoes.values()) {
      const x = s.escalas.get(p.escala);
      if (!x || x.estado !== 'publicada' || p.situacao !== 'previsto') continue;
      if (!(p.inicio >= inicioDesde && p.inicio <= instante && p.fim > instante)) continue;
      if (f.unidade !== undefined && x.unidade !== f.unidade) continue;
      if (f.setor && !x.setor.toUpperCase().includes(f.setor.toUpperCase())) continue;
      if (f.tipo && p.tipo !== f.tipo) continue;
      const v = this.pessoas ? await this.pessoas.vinculo(c, p.vinculo) : null;
      r.push({
        id: p.id,
        escala: p.escala,
        unidade: x.unidade,
        setor: x.setor,
        tipoEscala: x.tipo,
        vinculo: p.vinculo,
        nome: v?.nome ?? `Vínculo ${p.vinculo}`,
        profissional: p.profissional,
        registro: p.registro,
        tipo: p.tipo,
        inicio: p.inicio,
        fim: p.fim,
        chegadaMin: p.chegadaMin,
        situacao: p.situacao,
      });
    }
    return r.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id - b.id);
  }
  async acionamentos(c: ContextoEscala, ids: readonly number[]): Promise<AcionamentoPesLido[]> {
    return acionamentosDe(this.e(c), ids);
  }
  async acionamento(c: ContextoEscala, id: number): Promise<AcionamentoPesLido | null> {
    return this.e(c).acionamentos.get(id) ?? null;
  }
  async dimensionamentos(
    c: ContextoEscala,
    f: { readonly unidade?: number },
  ): Promise<DimensionamentoPesLido[]> {
    return this.e(c)
      .dimensionamentos.filter((d) => f.unidade === undefined || d.unidade === f.unidade)
      .sort((a, b) => b.id - a.id)
      .slice(0, 100);
  }
  async unidadesInternacao(): Promise<UnidadeInternacaoLida[]> {
    return [UNIDADE_INTERNACAO_SINTETICA];
  }
  async classificacoesDoTurno(_c: ContextoEscala, unidade: string) {
    return unidade === UNIDADE_INTERNACAO_SINTETICA.unidade ? CLASSIFICACOES_SINTETICAS : [];
  }

  // ── W0-06 ──

  /**
   * Os realizados dos plantões em memória (a porta do realizado se registra aqui ao nascer, com o mesmo estado):
   * o vínculo "plantão realizado" do mapa de dependências.
   */
  realizadosDosPlantoes: ((hospital: string, plantoes: readonly number[]) => number) | null = null;

  private dependencias(s: Estado, h: string, escala: number): VinculoPessoasContado[] {
    const ids = [...s.plantoes.values()].filter((p) => p.escala === escala).map((p) => p.id);
    const r: VinculoPessoasContado[] = [];
    const trocas = [...s.trocas.values()].filter(
      (t) => ids.includes(t.plantao) || (t.plantaoColega !== null && ids.includes(t.plantaoColega)),
    ).length;
    if (trocas > 0)
      r.push({
        grupo: 'Trocas de plantão',
        tabela: 'SGH_PES_TROCA',
        coluna: 'ID_PLANTAO',
        quantidade: trocas,
      });
    const realizados = this.realizadosDosPlantoes?.(h, ids) ?? 0;
    if (realizados > 0)
      r.push({
        grupo: 'Plantões realizados',
        tabela: 'SGH_PES_PLANTAO_REALIZADO',
        coluna: 'ID_PLANTAO',
        quantidade: realizados,
      });
    const acion = acionamentosDe(s, ids).length;
    if (acion > 0)
      r.push({
        grupo: 'Acionamentos do sobreaviso',
        tabela: 'SGH_PES_ACIONAMENTO',
        coluna: 'ID_PLANTAO',
        quantidade: acion,
      });
    return r;
  }

  private historico(s: Estado, vinculo: number): VigenciaRegimeHistoricoLida[] {
    return s.vigencias
      .filter((v) => v.vinculo === vinculo)
      .sort((a, b) => a.desde.localeCompare(b.desde) || a.id - b.id)
      .map((v) => ({
        id: v.id,
        vinculo: v.vinculo,
        regime: v.regime,
        desde: v.desde,
        por: v.por,
        em: v.em ?? '',
        anulada: v.anulada ?? null,
      }));
  }

  async dependenciasEscala(c: ContextoEscala, escala: number): Promise<VinculoPessoasContado[]> {
    return this.dependencias(this.e(c), c.hospital, escala);
  }
  async historicoVigencias(c: ContextoEscala, vinculo: number): Promise<VigenciaRegimeHistoricoLida[]> {
    return this.historico(this.e(c), vinculo);
  }
  async vigencia(c: ContextoEscala, id: number): Promise<VigenciaRegimeHistoricoLida | null> {
    const v = this.e(c).vigencias.find((x) => x.id === id);
    return v ? (this.historico(this.e(c), v.vinculo).find((x) => x.id === id) ?? null) : null;
  }
  /** Testes: uma troca sintética ligada a um plantão (o vínculo do mapa de dependências, sem passar pelo fluxo). */
  semearTroca(hospital: string, plantao: number): void {
    const s = this.e({ hospital });
    const id = ++s.seq;
    s.trocas.set(id, {
      id,
      hospital,
      tipo: 'cessao',
      estado: 'pedida',
      plantao,
      versaoPlantao: 0,
      vinculo: 0,
      vinculoColega: 0,
      plantaoColega: null,
      versaoColega: null,
      motivo: 'troca sintética do teste',
      pedidoPor: 'SINT.TESTE',
      pedidoEm: agora(),
      respostaPor: null,
      respostaEm: null,
      confirmacao: null,
      decisaoPor: null,
      decisaoEm: null,
      motivoDecisao: null,
      versao: 0,
    });
  }
  /** Testes: o retrato das linhas apagadas no estabelecimento. */
  retratosDe(hospital: string): readonly { tabela: string; chave: string; motivo: string; por: string }[] {
    return this.estados.get(hospital)?.retratos ?? [];
  }
}

function emTrocaAberta(s: Estado, ids: readonly number[]): Set<number> {
  const r = new Set<number>();
  for (const t of s.trocas.values())
    if (t.estado === 'pedida' || t.estado === 'aceita')
      for (const p of [t.plantao, t.plantaoColega]) if (p !== null && ids.includes(p)) r.add(p);
  return r;
}

function acionamentosDe(s: Estado, ids: readonly number[]): AcionamentoPesLido[] {
  return [...s.acionamentos.values()].filter((a) => ids.includes(a.plantao)).sort((a, b) => b.id - a.id);
}
