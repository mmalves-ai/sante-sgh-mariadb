// Porta do balanço hídrico EM MEMÓRIA (M45, etapa 3): a sessão sintética de dev/ci (E2E). Os internados, os horários
// checados e os sinais vitais vêm da porta da enfermagem em memória (o que o E2E checa na beira do leito aparece no
// balanço); a janela anterior de 24 horas do paciente da UTI-02 ganha uma checagem SINTÉTICA de soro em mL, um peso e
// uma diurese nos sinais vitais, para o fechamento de 24 horas ter o ganho vindo da checagem. Os lançamentos e os
// fechamentos ficam em memória, com as mesmas recusas da gravação SGH_ (janela fechada, estorno uma vez só, lançamentos
// mudados, a mesma origem uma vez só, a chave do ato repetida). Nada é de pessoa real (marca "SINTETICO M45").
import { type DominiosBalanco, type FechamentoBalancoLido, type LancamentoBalancoLido } from '@sgh/contratos';
import { janelaDoInstante, somarMinutos } from '@sgh/dominio-enfermagem';
import {
  type ChecagemLidaParaBalanco,
  type ContextoOperacao,
  type LiberacaoConsultada,
  recusa,
  type SinaisParaBalanco,
} from '@sgh/legado';
import type { ContextoBalanco, GravadorBalanco, PortaBalanco } from './balanco-porta.js';
import type { PortaEnfermagem } from './porta.js';

const M = 'SINTETICO M45';
/** O atendimento sintético da UTI-02 (porta da enfermagem em memória). */
export const ATENDIMENTO_BALANCO_SINTETICO = 25_102;
const PACIENTE_BALANCO_SINTETICO = 25_002;

export const DOMINIOS_BALANCO_SINTETICOS: DominiosBalanco = {
  grupos: [
    { codigo: 1, nome: 'VO' },
    { codigo: 2, nome: 'Enteral' },
    { codigo: 3, nome: 'Parenteral' },
    { codigo: 4, nome: 'EV' },
  ],
  tiposEliminacao: [
    {
      codigo: 1,
      nome: 'Diurese',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    {
      codigo: 2,
      nome: 'Dreno',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    { codigo: 3, nome: 'Êmese', ativo: true, pedeIntensidade: true, aceitaEstimado: true, pedeAspecto: true },
    {
      codigo: 4,
      nome: 'Evacuação',
      ativo: true,
      pedeIntensidade: true,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    {
      codigo: 5,
      nome: 'Hemorragia',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
    {
      codigo: 6,
      nome: 'SNG/ SNE',
      ativo: true,
      pedeIntensidade: false,
      aceitaEstimado: true,
      pedeAspecto: true,
    },
  ],
  intensidades: [1, 2, 3, 4].map((codigo) => ({ codigo, nome: `${codigo}+/4+` })),
  tiposFechamento: [
    { codigo: 1, nome: 'PARCIAL' },
    { codigo: 2, nome: 'TOTAL' },
  ],
  vias: [
    { codigo: 'EV', nome: 'ENDOVENOSA' },
    { codigo: 'SL', nome: 'SUBLINGUAL' },
    { codigo: 'VE', nome: 'VIA SONDA NASOENTERAL' },
    { codigo: 'VO', nome: 'VIA ORAL' },
  ],
};

/** Os horários administrados do atendimento no intervalo, pela porta da enfermagem (a mesma conta do legado). */
export async function checagensPelaEnfermagem(
  enf: PortaEnfermagem,
  c: ContextoBalanco,
  o: { atendimento: number; de: string; ate: string },
): Promise<{ itens: ChecagemLidaParaBalanco[]; cortada: boolean }> {
  const lido = await enf.horarios(c, {
    atendimentos: [o.atendimento],
    inicio: somarMinutos(o.de, -24 * 60),
    fim: o.ate,
    teto: 2_000,
  });
  const adm = lido.itens.filter((h) => h.situacao === 'A');
  const ids = adm.map((h) => h.id);
  const [atos, inf] = ids.length
    ? await Promise.all([enf.atos(c, ids), enf.eventosInfusao(c, ids)])
    : [[], []];
  const primeiro = new Map<number, { horaReal: string; quantidade: number | null }>();
  for (const a of atos)
    if (a.tipo === 'checagem' && a.situacao === 'A' && !primeiro.has(a.horario))
      primeiro.set(a.horario, { horaReal: a.horaReal, quantidade: a.quantidade });
  const vol = new Map<number, number>();
  for (const e of inf)
    if (e.volumeInfundidoMl !== null)
      vol.set(e.horario, Math.max(vol.get(e.horario) ?? 0, e.volumeInfundidoMl));
  const itens = adm
    .map((h) => ({
      horario: h.id,
      tipo: h.tipo,
      situacao: h.situacao,
      descricao: h.descricao,
      dose: h.dose,
      unidadeDose: h.unidadeDose,
      via: h.via,
      checadoEm: h.checadoEm,
      horaReal: primeiro.get(h.id)?.horaReal ?? null,
      quantidade: primeiro.get(h.id)?.quantidade ?? h.quantidade,
      volumeInfundidoMl: vol.get(h.id) ?? null,
    }))
    .filter((x) => {
      const q = (x.horaReal ?? x.checadoEm ?? '').slice(0, 16);
      return q >= o.de && q < o.ate;
    });
  return { itens, cortada: lido.cortada };
}

interface Lancamento extends Omit<LancamentoBalancoLido, 'estornadoPor'> {
  readonly atendimento: number;
  readonly paciente: number;
  readonly chave: string | null;
}

interface Estado {
  seq: number;
  lancamentos: Lancamento[];
  fechamentos: (FechamentoBalancoLido & { atendimento: number })[];
  /** A checagem e os sinais sintéticos da janela anterior (gerados uma vez, em torno do relógio). */
  checagens: ChecagemLidaParaBalanco[];
  sinais: { id: number; tipo: string; valor: number; horaReal: string }[];
  /** A entrada sintética de todo atendimento: 30 horas antes do começo da janela anterior. */
  entrada: string;
}

export class PortaBalancoMemoria implements PortaBalanco {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly enfermagem: PortaEnfermagem) {}

  private async e(c: ContextoBalanco): Promise<Estado> {
    let s = this.estados.get(c.hospital);
    if (!s) {
      // A janela anterior pela hora de corte padrão (7 h): a checagem às 22 h, o peso às 8 h e a diurese às 18 h.
      const agora = (await this.enfermagem.relogio(c)).slice(0, 16);
      const anterior = somarMinutos(janelaDoInstante(agora, '0700').inicio, -24 * 60);
      s = {
        seq: 45_300,
        entrada: somarMinutos(anterior, -30 * 60),
        lancamentos: [],
        fechamentos: [],
        checagens: [
          {
            horario: 45_301,
            tipo: 'solucao',
            situacao: 'A',
            descricao: `SORO GLICOSADO ${M} 5% 500 ML`,
            dose: 500,
            unidadeDose: 'ML',
            via: 'EV',
            checadoEm: somarMinutos(anterior, 15 * 60),
            horaReal: somarMinutos(anterior, 15 * 60),
            quantidade: 500,
            volumeInfundidoMl: null,
          },
          {
            horario: 45_302,
            tipo: 'medicamento',
            situacao: 'A',
            descricao: `DIPIRONA ${M} 1 G`,
            dose: 1,
            unidadeDose: 'G',
            via: 'EV',
            checadoEm: somarMinutos(anterior, 16 * 60),
            horaReal: somarMinutos(anterior, 16 * 60),
            quantidade: 1,
            volumeInfundidoMl: null,
          },
        ],
        sinais: [
          { id: 45_351, tipo: 'peso', valor: 70, horaReal: somarMinutos(anterior, 60) },
          { id: 45_352, tipo: 'diurese', valor: 600, horaReal: somarMinutos(anterior, 11 * 60) },
          { id: 45_353, tipo: 'temperatura', valor: 37.2, horaReal: somarMinutos(anterior, 11 * 60) },
        ],
      };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(c: ContextoBalanco, op: string, e: unknown, x: ContextoOperacao): never {
    void [c, e, x];
    throw new Error(`Operação ${op} sem simulação em memória: o balanço grava só no novo.`);
  }

  async gravarSgh<T>(
    c: ContextoBalanco,
    _trilha: unknown,
    fn: (g: GravadorBalanco) => Promise<T>,
  ): Promise<T> {
    const s = await this.e(c);
    const temTotal = (atendimento: number, inicio: string) =>
      s.fechamentos.some((f) => f.atendimento === atendimento && f.tipo === 'total' && f.inicio === inicio);
    const estornadoPor = (id: number) => s.lancamentos.find((l) => l.estornado === id)?.id ?? null;
    const agora = (await this.enfermagem.relogio(c)).slice(0, 16);
    const g: GravadorBalanco = {
      lancar: async ({ janelaInicio, ...l }) => {
        const chave = l.chave ? `${c.hospital}:${l.chave}` : null;
        const ja = chave ? s.lancamentos.find((x) => x.chave === chave) : undefined;
        if (ja && (ja.atendimento !== l.atendimento || ja.usuario.toUpperCase() !== l.usuario.toUpperCase()))
          throw recusa(
            'chave-reutilizada',
            'A chave deste pedido já foi usada em outro lançamento: refaça o lançamento na tela.',
          );
        if (ja) return { id: ja.id, repetida: true };
        if (temTotal(l.atendimento, janelaInicio))
          throw recusa(
            'janela-fechada',
            'O balanço de 24 horas desta hora já foi fechado: o lançamento não entra mais nele.',
          );
        const id = ++s.seq;
        s.lancamentos.push({
          ...l,
          id,
          origem: 'manual',
          horario: null,
          sinal: null,
          estornado: null,
          motivo: null,
          gravadoEm: agora,
          chave,
        });
        return { id, repetida: false };
      },
      estornar: async (x) => {
        const o = s.lancamentos.find((l) => l.id === x.id);
        if (!o || o.atendimento !== x.atendimento)
          throw recusa('nao-encontrado', 'O lançamento não foi encontrado neste atendimento.');
        if (o.origem === 'estorno') throw recusa('estorno-de-estorno', 'Um estorno não se estorna.');
        if (estornadoPor(o.id) !== null) throw recusa('ja-estornado', 'O lançamento já foi estornado.');
        if (temTotal(x.atendimento, x.janelaInicio(o.horaReal)))
          throw recusa(
            'janela-fechada',
            'O balanço de 24 horas deste lançamento já foi fechado: o lançamento não se estorna mais.',
          );
        const id = ++s.seq;
        s.lancamentos.push({
          ...o,
          id,
          origem: 'estorno',
          horario: null,
          sinal: null,
          estornado: o.id,
          motivo: x.motivo,
          usuario: x.usuario,
          gravadoEm: agora,
          chave: null,
          origemOffline: false,
        });
        return id;
      },
      fechar: async (f) => {
        if (temTotal(f.atendimento, f.inicio))
          throw recusa('ja-fechado', 'O balanço de 24 horas desta janela já foi fechado.');
        const naJanela = s.lancamentos.filter(
          (l) =>
            l.atendimento === f.atendimento &&
            l.horaReal >= f.inicio &&
            (f.fimInclusivo ? l.horaReal <= f.fim : l.horaReal < f.fim),
        );
        const vig = naJanela
          .filter((l) => l.origem !== 'estorno' && estornadoPor(l.id) === null)
          .map((l) => l.id)
          .sort((a, b) => a - b);
        const vistos = [...f.lancamentosVistos].sort((a, b) => a - b);
        if (vig.length !== vistos.length || vig.some((v, i) => v !== vistos[i]))
          throw recusa(
            'balanco-mudou',
            'O balanço mudou depois da leitura (outro lançamento ou estorno): confira e feche de novo.',
          );
        const importados: number[] = [];
        for (const p of f.pendentes) {
          const ja = s.lancamentos.some((l) =>
            p.origem === 'checagem' ? l.horario === p.referencia : l.sinal === p.referencia,
          );
          if (ja)
            throw recusa(
              'balanco-mudou',
              'Um ganho da checagem ou uma diurese já entrou no balanço: confira e feche de novo.',
            );
          const id = ++s.seq;
          s.lancamentos.push({
            id,
            atendimento: f.atendimento,
            paciente: f.paciente,
            sentido: p.sentido,
            origem: p.origem,
            grupo: p.grupo,
            via: p.via,
            tipoEliminacao: p.tipoEliminacao,
            intensidade: null,
            aspecto: null,
            estimado: false,
            volumeMl: p.volumeMl,
            horaReal: p.horaReal,
            descricao: p.descricao,
            horario: p.origem === 'checagem' ? p.referencia : null,
            sinal: p.origem === 'sinal' ? p.referencia : null,
            estornado: null,
            motivo: null,
            origemOffline: false,
            usuario: f.usuario,
            gravadoEm: agora,
            chave: null,
          });
          importados.push(id);
        }
        const id = ++s.seq;
        s.fechamentos.push({
          id,
          atendimento: f.atendimento,
          tipo: f.tipo,
          inicio: f.inicio,
          fim: f.fim,
          horaCorte: f.horaCorte.replace(':', ''),
          ganhosMl: f.ganhosMl,
          perdasMl: f.perdasMl,
          insensiveisMl: f.insensiveisMl,
          saldoMl: f.saldoMl,
          diureseMl: f.diureseMl,
          pesoKg: f.pesoKg,
          debitoUrinario: f.debitoUrinario,
          oliguria: f.oliguria,
          formula: f.formula,
          lancamentos: f.lancamentos,
          parcelas: f.parcelas,
          usuario: f.usuario,
          gravadoEm: agora,
        });
        return { id, importados };
      },
    };
    return fn(g);
  }

  relogio(c: ContextoBalanco): Promise<string> {
    return this.enfermagem.relogio(c);
  }

  internado(c: ContextoBalanco, atendimento: number) {
    return this.enfermagem.internado(c, atendimento);
  }

  async entrada(c: ContextoBalanco): Promise<string | null> {
    return (await this.e(c)).entrada;
  }

  async dominios(): Promise<DominiosBalanco> {
    return DOMINIOS_BALANCO_SINTETICOS;
  }

  async checagens(c: ContextoBalanco, o: { atendimento: number; de: string; ate: string }) {
    const s = await this.e(c);
    const vivo = await checagensPelaEnfermagem(this.enfermagem, c, o);
    const sinteticas =
      o.atendimento === ATENDIMENTO_BALANCO_SINTETICO
        ? s.checagens.filter((x) => (x.horaReal ?? '') >= o.de && (x.horaReal ?? '') < o.ate)
        : [];
    return { itens: [...sinteticas, ...vivo.itens], cortada: vivo.cortada };
  }

  async lancamentos(c: ContextoBalanco, o: { atendimento: number; de: string; ate: string }) {
    const s = await this.e(c);
    const itens = s.lancamentos
      .filter((l) => l.atendimento === o.atendimento && l.horaReal >= o.de && l.horaReal < o.ate)
      .sort((a, b) => a.horaReal.localeCompare(b.horaReal) || a.id - b.id)
      .map((l) => this.lido(s, l));
    return { itens, cortada: false };
  }

  private lido(s: Estado, l: Lancamento): LancamentoBalancoLido {
    return {
      id: l.id,
      sentido: l.sentido,
      origem: l.origem,
      grupo: l.grupo,
      via: l.via,
      tipoEliminacao: l.tipoEliminacao,
      intensidade: l.intensidade,
      aspecto: l.aspecto,
      estimado: l.estimado,
      volumeMl: l.volumeMl,
      horaReal: l.horaReal,
      descricao: l.descricao,
      horario: l.horario,
      sinal: l.sinal,
      estornado: l.estornado,
      estornadoPor: s.lancamentos.find((x) => x.estornado === l.id)?.id ?? null,
      motivo: l.motivo,
      origemOffline: l.origemOffline,
      usuario: l.usuario,
      gravadoEm: l.gravadoEm,
    };
  }

  async lancamento(c: ContextoBalanco, id: number) {
    const s = await this.e(c);
    const l = s.lancamentos.find((x) => x.id === id);
    return l ? { ...this.lido(s, l), atendimento: l.atendimento } : null;
  }

  async origensLancadas(c: ContextoBalanco, o: { horarios: readonly number[]; sinais: readonly number[] }) {
    const s = await this.e(c);
    return {
      horarios: new Set(
        s.lancamentos.map((l) => l.horario).filter((h): h is number => h !== null && o.horarios.includes(h)),
      ),
      sinais: new Set(
        s.lancamentos.map((l) => l.sinal).filter((h): h is number => h !== null && o.sinais.includes(h)),
      ),
    };
  }

  async fechamentos(c: ContextoBalanco, atendimento: number): Promise<FechamentoBalancoLido[]> {
    const s = await this.e(c);
    return s.fechamentos
      .filter((f) => f.atendimento === atendimento)
      .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.fim.localeCompare(a.fim) || b.id - a.id)
      .map((f) => {
        const r: Partial<typeof f> = { ...f };
        delete r.atendimento;
        return r as FechamentoBalancoLido;
      });
  }

  async sinais(
    c: ContextoBalanco,
    o: { paciente: number; de: string; ate: string },
  ): Promise<SinaisParaBalanco> {
    const s = await this.e(c);
    // Os da enfermagem em memória (o que o E2E registra) e os sintéticos do paciente da UTI-02.
    const vivos = (
      await this.enfermagem.sinais(c, {
        paciente: o.paciente,
        de: somarMinutos(o.ate, -30 * 24 * 60),
        ate: o.ate,
      })
    ).itens;
    const substituidos = new Set(vivos.map((x) => x.anterior).filter((x): x is number => x !== null));
    const todos = [
      ...(o.paciente === PACIENTE_BALANCO_SINTETICO ? s.sinais : []),
      ...vivos
        .filter((x) => !substituidos.has(x.id))
        .map((x) => ({ id: x.id, tipo: x.tipo, valor: x.valor, horaReal: x.horaReal })),
    ];
    const naJanela = todos.filter((x) => x.horaReal >= o.de && x.horaReal < o.ate);
    const temps = naJanela.filter((x) => x.tipo === 'temperatura').map((x) => x.valor);
    const peso = todos
      .filter((x) => x.tipo === 'peso' && x.horaReal < o.ate)
      .sort((a, b) => b.horaReal.localeCompare(a.horaReal) || b.id - a.id)[0];
    return {
      diurese: naJanela
        .filter((x) => x.tipo === 'diurese')
        .map((x) => ({ id: x.id, valor: x.valor, horaReal: x.horaReal })),
      temperaturaMaxima: temps.length ? Math.max(...temps) : null,
      peso: peso ? { valor: peso.valor, quando: peso.horaReal } : null,
    };
  }
}
