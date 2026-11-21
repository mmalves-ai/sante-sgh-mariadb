// Porta EM MEMÓRIA da CCIH (M48, etapa 3): dev/ci sem a cópia e os testes da API (nada conecta a banco; dados
// SINTÉTICOS, com as datas relativas ao relógio para o E2E valer em qualquer dia). Espelha as travas do banco que a API
// não confere sozinha: a versão no UPDATE, a decisão única por item prescrito, o estado do leito (um "precaução" e um
// "bloqueio" abertos por leito) e o consumo por setor e competência. A transação desfaz tudo se a função falhar.
import type { ChaveLeito, UnidadeNotificacao } from '@sgh/contratos';
import { type BundleRegistrado, type CompetenciaFechada, type DependentesRegistro, type TabelaCorrigivel, type VersaoRegistro, type AntimicrobianoPrescrito, type CulturaDoPaciente, type DispositivoInvasivoRegistrado, type InternadoCcih, type IrasRegistrada, type ItemAntimicrobianoConfigurado, type LiberacaoAntimicrobianoRegistrada, type ObservacaoMaosRegistrada, type PrecaucaoRegistrada, recusaVersaoCcih, type SurtoRegistrado } from './tipos.js';
import { recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { ContextoCcih, GravadorCcih, PortaCcih } from './porta-ccih.js';

const HORA = 3_600_000;
const local = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const msDe = (t: string) =>
  Date.parse(`${(t.length === 10 ? `${t}T00:00:00` : t.length === 16 ? `${t}:00` : t).slice(0, 19)}Z`);
const chave = (l: ChaveLeito) => `${l.bloco}|${l.acomodacao}|${l.leito}`;

/** Itens SINTÉTICOS do cadastro de produtos (dois antimicrobianos e um que não é). */
export const ITENS_SINTETICOS_CCIH = [
  { item: 9001, nome: 'MEROPENEM 1 G SINTETICO', antimicrobiano: true },
  { item: 9002, nome: 'CEFTRIAXONA 1 G SINTETICA', antimicrobiano: true },
  { item: 9003, nome: 'DIPIRONA 1 G SINTETICA', antimicrobiano: false },
] as const;
/** A internação SINTÉTICA com o restrito sem liberação, a cultura e a febre (a do E2E). */
export const INTERNACAO_SINTETICA_CCIH = 4_801;
export const ITEM_PRESCRITO_SINTETICO_CCIH = 480_101;
/**
 * O atendimento da internação 4801: o mesmo da internação do paciente sintético 1003 do prontuário em memória
 * (paciente × 10 + 1), para o alerta ao prescritor aparecer na tela da prescrição no E2E @M48.3.
 */
export const ATENDIMENTO_SINTETICO_CCIH = 10_031;
/** O paciente da internação 4801: o 1003 do prontuário em memória (a precaução aparece no cabeçalho dele). */
export const PACIENTE_SINTETICO_CCIH = 1_003;

const UNIDADES: readonly UnidadeNotificacao[] = [
  { codigo: 1, nome: 'Unidade sintética' },
  { codigo: 2, nome: 'Unidade sintética de internação' },
];
const LEITOS: readonly ChaveLeito[] = [
  { bloco: 'UTI', acomodacao: '01', leito: 'A' },
  { bloco: 'UTI', acomodacao: '01', leito: 'B' },
  { bloco: 'UTI', acomodacao: '01', leito: 'C' },
  { bloco: 'CM', acomodacao: '201', leito: 'A' },
];

interface Estado {
  dispositivos: DispositivoInvasivoRegistrado[];
  iras: IrasRegistrada[];
  itens: ItemAntimicrobianoConfigurado[];
  liberacoes: LiberacaoAntimicrobianoRegistrada[];
  precaucoes: PrecaucaoRegistrada[];
  maos: (ObservacaoMaosRegistrada & { tipo: 'observacao' })[];
  /** W0-04: as versões anteriores (tabela|id → versões) e as competências fechadas. */
  versoes: Map<string, VersaoRegistro[]>;
  competencias: CompetenciaFechada[];
  /** W0-04 (M1): os checklists do bundle por turno. */
  bundles: BundleRegistrado[];
  consumo: { unidade: number; setor: string | null; competencia: string; mililitros: number }[];
  surtos: SurtoRegistrado[];
  /** Estados abertos do leito (M21): chave do leito → estado → tipo da precaução. */
  leitos: Map<string, Map<string, string | null>>;
  seq: number;
}

const clonar = (s: Estado): Estado => ({
  dispositivos: s.dispositivos.map((x) => ({ ...x })),
  iras: s.iras.map((x) => ({ ...x })),
  itens: s.itens.map((x) => ({ ...x })),
  liberacoes: s.liberacoes.map((x) => ({ ...x })),
  precaucoes: s.precaucoes.map((x) => ({ ...x })),
  maos: s.maos.map((x) => ({ ...x })),
  versoes: new Map([...s.versoes].map(([k, v]) => [k, [...v]])),
  competencias: s.competencias.map((x) => ({ ...x })),
  bundles: s.bundles.map((x) => ({ ...x })),
  consumo: s.consumo.map((x) => ({ ...x })),
  surtos: s.surtos.map((x) => ({ ...x })),
  leitos: new Map([...s.leitos].map(([k, v]) => [k, new Map(v)])),
  seq: s.seq,
});

export class PortaCcihMemoria implements PortaCcih {
  readonly destino = 'memoria' as const;
  private estado: Estado;
  private readonly t0: number;

  constructor(private readonly opcoes: { agora?: () => Date } = {}) {
    this.t0 = msDe(this.agoraLocal());
    this.estado = {
      dispositivos: [],
      iras: [],
      itens: [
        {
          item: 9001,
          restrito: true,
          atc: 'J01DH02',
          dddGramas: 3,
          gramasPorUnidade: 1,
          atualizadoPor: 'SINT.ADMIN',
          atualizadoEm: local(this.t0 - 240 * HORA),
        },
      ],
      liberacoes: [],
      precaucoes: [],
      maos: [],
      versoes: new Map(),
      competencias: [],
      bundles: [],
      consumo: [],
      surtos: [],
      leitos: new Map(),
      seq: 0,
    };
  }

  private agoraLocal(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora.slice(0, 19);
  }
  private dia(deslocDias: number): string {
    return local(this.t0 + deslocDias * 24 * HORA).slice(0, 10);
  }

  /** Alta (a data) ou transferência (o leito novo) feitas no outro sistema, para os testes da reconciliação. */
  private readonly foraDoSante = new Map<number, { alta: string } | { leito: ChaveLeito }>();

  /** O outro sistema deu alta à internação (o novo não soube). */
  simularAlta(reg: number, alta: string): void {
    this.foraDoSante.set(reg, { alta });
  }
  /** O outro sistema transferiu o internado de leito (o novo não soube). */
  simularTransferencia(reg: number, leito: ChaveLeito): void {
    this.foraDoSante.set(reg, { leito: { ...leito } });
  }
  /** Um bloqueio aberto por outro motivo (manutenção, NIR), fora da CCIH. */
  bloquearLeito(l: ChaveLeito, motivo: string): void {
    const m = this.estado.leitos.get(chave(l)) ?? new Map<string, string | null>();
    m.set('bloqueio', motivo);
    this.estado.leitos.set(chave(l), m);
  }

  /** Os internados de agora: os sintéticos menos as altas, com as transferências aplicadas. */
  private get internadosSinteticos(): InternadoCcih[] {
    return this.todosSinteticos.flatMap((i) => {
      const f = this.foraDoSante.get(i.reg);
      if (!f) return [i];
      if ('alta' in f) return [];
      return [{ ...i, bloco: f.leito.bloco, acomodacao: f.leito.acomodacao, leito: f.leito.leito }];
    });
  }

  /** Os internados SINTÉTICOS (o 4801 na UTI com o restrito; o 4802 vizinho; o 4803 em pós-operatório). */
  private get todosSinteticos(): InternadoCcih[] {
    const base = { aberta: true, pront: 0 };
    return [
      {
        ...base,
        reg: 4801,
        pront: 480_001,
        paciente: PACIENTE_SINTETICO_CCIH,
        nome: 'PACIENTE SINTETICO CCIH',
        atendimento: ATENDIMENTO_SINTETICO_CCIH,
        bloco: 'UTI',
        acomodacao: '01',
        leito: 'A',
        entrada: this.dia(-6),
      },
      {
        ...base,
        reg: 4802,
        pront: 480_002,
        paciente: 48_002,
        nome: 'OUTRO PACIENTE SINTETICO CCIH',
        atendimento: 48_102,
        bloco: 'UTI',
        acomodacao: '01',
        leito: 'C',
        entrada: this.dia(-2),
      },
      {
        ...base,
        reg: 4803,
        pront: 480_003,
        paciente: 48_003,
        nome: 'TERCEIRO PACIENTE SINTETICO',
        atendimento: 48_103,
        bloco: 'CM',
        acomodacao: '201',
        leito: 'A',
        entrada: this.dia(-8),
      },
    ];
  }

  private get prescritos(): AntimicrobianoPrescrito[] {
    return [
      {
        reg: 4801,
        prescricao: 48_011,
        itemPrescricao: ITEM_PRESCRITO_SINTETICO_CCIH,
        item: 9001,
        nome: 'MEROPENEM 1 G SINTETICO',
        prescritoEm: local(this.t0 - 50 * HORA),
        inicioVigencia: local(this.t0 - 50 * HORA),
        fimVigencia: local(this.t0 + 22 * HORA),
        suspensoEm: null,
      },
      {
        reg: 4803,
        prescricao: 48_031,
        itemPrescricao: 480_301,
        item: 9002,
        nome: 'CEFTRIAXONA 1 G SINTETICA',
        prescritoEm: local(this.t0 - 5 * HORA),
        inicioVigencia: local(this.t0 - 5 * HORA),
        fimVigencia: local(this.t0 + 19 * HORA),
        suspensoEm: null,
      },
    ];
  }

  podeGravar(): Promise<LiberacaoGravacao> {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }
  executar(_c: ContextoCcih, op: string): Promise<never> {
    return Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`));
  }
  relogio(): Promise<string> {
    return Promise.resolve(this.agoraLocal());
  }
  unidades(): Promise<UnidadeNotificacao[]> {
    return Promise.resolve([...UNIDADES]);
  }
  internados(): Promise<{ itens: InternadoCcih[]; cortada: boolean }> {
    return Promise.resolve({ itens: this.internadosSinteticos, cortada: false });
  }
  internacao(_c: ContextoCcih, reg: number): Promise<InternadoCcih | null> {
    const i = this.internadosSinteticos.find((x) => x.reg === reg);
    if (i) return Promise.resolve(i);
    const saiu = this.todosSinteticos.find((x) => x.reg === reg);
    return Promise.resolve(saiu ? { ...saiu, aberta: false } : null);
  }
  altasDas(_c: ContextoCcih, regs: readonly number[]) {
    return Promise.resolve(
      [...new Set(regs)].map((reg) => {
        const f = this.foraDoSante.get(reg);
        return { reg, alta: f && 'alta' in f ? f.alta : null };
      }),
    );
  }
  vizinhos(_c: ContextoCcih, l: ChaveLeito): Promise<(ChaveLeito & { ocupado: boolean })[]> {
    const ocup = new Set(this.internadosSinteticos.map((i) => `${i.bloco}|${i.acomodacao}|${i.leito}`));
    return Promise.resolve(
      LEITOS.filter((x) => x.bloco === l.bloco && x.acomodacao === l.acomodacao && x.leito !== l.leito).map(
        (x) => ({
          ...x,
          ocupado: ocup.has(chave(x)),
        }),
      ),
    );
  }
  antimicrobianos(_c: ContextoCcih, regs: readonly number[], desde: string | null) {
    return Promise.resolve({
      itens: this.prescritos.filter(
        (p) =>
          regs.includes(p.reg) &&
          (desde === null || p.fimVigencia === null || msDe(p.fimVigencia) >= msDe(desde)),
      ),
      cortada: false,
    });
  }
  antimicrobianoPrescrito(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.prescritos.find((p) => p.itemPrescricao === id) ?? null);
  }
  vigencias(_c: ContextoCcih, de: string, ate: string) {
    const fim = msDe(ate) + 24 * HORA;
    return Promise.resolve({
      itens: this.prescritos.filter(
        (p) => msDe(p.inicioVigencia) < fim && msDe(p.fimVigencia ?? p.inicioVigencia) >= msDe(de),
      ),
      cortada: false,
    });
  }
  consumoDispensado() {
    return Promise.resolve([
      { item: 9001, nome: 'MEROPENEM 1 G SINTETICO', unidades: 60 },
      { item: 9002, nome: 'CEFTRIAXONA 1 G SINTETICA', unidades: 30 },
    ]);
  }
  itensAntimicrobianos() {
    return Promise.resolve(
      ITENS_SINTETICOS_CCIH.filter((i) => i.antimicrobiano).map(({ item, nome }) => ({ item, nome })),
    );
  }
  itemDoCadastro(_c: ContextoCcih, item: number) {
    const i = ITENS_SINTETICOS_CCIH.find((x) => x.item === item);
    return Promise.resolve(i ? { item: i.item, nome: i.nome, antimicrobiano: i.antimicrobiano } : null);
  }
  fichas() {
    return Promise.resolve(new Map<number, number>());
  }
  private get culturasSinteticas(): CulturaDoPaciente[] {
    return [
      { id: 480_000_000_001, reg: 4801, exame: 'HEMOCULTURA SINTETICA', data: this.dia(-2), liberado: true },
    ];
  }
  culturas(_c: ContextoCcih, regs: readonly number[], desde: string) {
    return Promise.resolve(this.culturasSinteticas.filter((x) => regs.includes(x.reg) && x.data >= desde));
  }
  exame(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.culturasSinteticas.find((x) => x.id === id) ?? null);
  }
  private get cirurgiasSinteticas() {
    return [{ id: 48_301, reg: 4803, data: this.dia(-5) }];
  }
  cirurgias(_c: ContextoCcih, regs: readonly number[], desde: string) {
    return Promise.resolve(this.cirurgiasSinteticas.filter((x) => regs.includes(x.reg) && x.data >= desde));
  }
  cirurgia(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.cirurgiasSinteticas.find((x) => x.id === id) ?? null);
  }
  temperaturas(_c: ContextoCcih, pacientes: readonly number[], desde: string) {
    const t = [{ paciente: PACIENTE_SINTETICO_CCIH, valor: 38.4, em: local(this.t0 - 6 * HORA) }];
    return Promise.resolve(t.filter((x) => pacientes.includes(x.paciente) && msDe(x.em) >= msDe(desde)));
  }
  censo(_c: ContextoCcih, de: string, ate: string) {
    // Censo sintético: 8 internados na UTI e 20 na clínica médica em cada dia fechado do período (até ontem).
    const ontem = this.dia(-1);
    let dias = 0;
    for (let d = msDe(de); d <= msDe(ate); d += 24 * HORA) if (local(d).slice(0, 10) <= ontem) dias++;
    return Promise.resolve({
      porSetor: dias
        ? [
            { setor: 'CM', pacientesDia: 20 * dias },
            { setor: 'UTI', pacientesDia: 8 * dias },
          ]
        : [],
      diasFechados: dias,
    });
  }
  tiposSurto() {
    return Promise.resolve([{ codigo: 1, nome: 'Surto hospitalar sintético' }]);
  }
  dispositivo(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.dispositivos.find((d) => d.id === id) ?? null);
  }
  dispositivosDas(_c: ContextoCcih, regs: readonly number[]) {
    return Promise.resolve(this.estado.dispositivos.filter((d) => regs.includes(d.reg)));
  }
  dispositivosNoPeriodo(_c: ContextoCcih, de: string, ate: string) {
    const fim = msDe(ate) + 24 * HORA;
    return Promise.resolve({
      itens: this.estado.dispositivos.filter(
        (d) =>
          !d.canceladoEm &&
          msDe(d.inseridoEm) < fim &&
          (d.retiradoEm === null || msDe(d.retiradoEm) >= msDe(de)),
      ),
      cortada: false,
    });
  }
  iras(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.iras.find((i) => i.id === id) ?? null);
  }
  irasDas(_c: ContextoCcih, regs: readonly number[]) {
    return Promise.resolve(this.estado.iras.filter((i) => regs.includes(i.reg)));
  }
  irasNoPeriodo(_c: ContextoCcih, de: string, ate: string) {
    return Promise.resolve({
      itens: this.estado.iras.filter((i) => i.dataInfeccao >= de && i.dataInfeccao <= ate),
      cortada: false,
    });
  }
  itensConfigurados() {
    return Promise.resolve(this.estado.itens.map((x) => ({ ...x })));
  }
  liberacao(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.liberacoes.find((x) => x.id === id) ?? null);
  }
  liberacoesDos(_c: ContextoCcih, itens: readonly number[]) {
    return Promise.resolve(this.estado.liberacoes.filter((x) => itens.includes(x.itemPrescricao)));
  }
  precaucao(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.precaucoes.find((x) => x.id === id) ?? null);
  }
  precaucoesAbertas() {
    return Promise.resolve(this.estado.precaucoes.filter((x) => x.fimEm === null));
  }
  precaucoesDa(_c: ContextoCcih, reg: number) {
    return Promise.resolve(this.estado.precaucoes.filter((x) => x.reg === reg));
  }
  observacoesMaos(c: ContextoCcih, de: string, ate: string) {
    return this.sessoesMaos(c, de, ate).then((r) => ({ ...r, itens: r.itens.filter((o) => !o.estornadoEm) }));
  }
  sessoesMaos(_c: ContextoCcih, de: string, ate: string) {
    return Promise.resolve({
      itens: this.estado.maos.filter(
        (o) => o.observadoEm.slice(0, 10) >= de && o.observadoEm.slice(0, 10) <= ate,
      ),
      cortada: false,
    });
  }
  observacaoMaos(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.maos.find((o) => o.id === id) ?? null);
  }
  versoes(_c: ContextoCcih, tabela: TabelaCorrigivel, id: number) {
    return Promise.resolve([...(this.estado.versoes.get(`${tabela}|${id}`) ?? [])].reverse());
  }
  competencias(_c: ContextoCcih, comps?: readonly string[]) {
    return Promise.resolve(
      this.estado.competencias
        .filter((x) => !comps?.length || comps.includes(x.competencia))
        .map((x) => ({ ...x })),
    );
  }
  bundles(_c: ContextoCcih, ids: readonly number[]): Promise<BundleRegistrado[]> {
    return Promise.resolve(
      this.estado.bundles
        .filter((b) => ids.includes(b.dispositivo))
        .sort((a, b) => b.registradoEm.localeCompare(a.registradoEm) || b.id - a.id)
        .map((b) => ({ ...b, itens: { ...b.itens } })),
    );
  }
  bundle(_c: ContextoCcih, id: number): Promise<BundleRegistrado | null> {
    const b = this.estado.bundles.find((x) => x.id === id);
    return Promise.resolve(b ? { ...b, itens: { ...b.itens } } : null);
  }
  /** Profissionais sintéticos para a busca do responsável pela inserção. */
  private static readonly PROFISSIONAIS = [
    { id: 9101, cod: 9101, nome: 'SINT MEDICO PLANTONISTA' },
    { id: 9102, cod: 9102, nome: 'SINT ENFERMEIRA UTI' },
    { id: 9103, cod: 9103, nome: 'SINT MEDICO INTENSIVISTA' },
  ];
  buscarProfissionais(_c: ContextoCcih, texto: string) {
    const q = texto.trim().toUpperCase();
    if (q.length < 2) return Promise.resolve([]);
    return Promise.resolve(
      PortaCcihMemoria.PROFISSIONAIS.filter((p) => p.nome.includes(q) || String(p.cod) === q),
    );
  }
  profissionaisPorRegistro(_c: ContextoCcih, ids: readonly number[]) {
    return Promise.resolve(PortaCcihMemoria.PROFISSIONAIS.filter((p) => ids.includes(p.id)));
  }
  dependentes(_c: ContextoCcih, tabela: string, id: number): Promise<DependentesRegistro[]> {
    if (tabela !== 'dispositivo_invasivo_paciente') return Promise.resolve([]);
    const ids = this.estado.iras
      .filter((i) => i.dispositivo === id && i.situacao === 'confirmada')
      .map((i) => i.id);
    return Promise.resolve(
      ids.length
        ? [{ grupo: 'Fichas de IRAS confirmadas', dependente: 'caso_infeccao', quantidade: ids.length, ids }]
        : [],
    );
  }
  consumoAlcool(_c: ContextoCcih, competencia: string) {
    return Promise.resolve(
      this.estado.consumo
        .filter((x) => x.competencia === competencia)
        .map(({ unidade, setor, mililitros }) => ({ unidade, setor, mililitros })),
    );
  }
  surto(_c: ContextoCcih, id: number) {
    return Promise.resolve(this.estado.surtos.find((x) => x.id === id) ?? null);
  }
  surtos(_c: ContextoCcih, desde: string) {
    return Promise.resolve(this.estado.surtos.filter((x) => x.situacao !== 'encerrado' || x.inicio >= desde));
  }

  /** O estado "precaução" do leito (para os testes e o mapa em memória). */
  estadoDoLeito(l: ChaveLeito): ReadonlyMap<string, string | null> {
    return this.estado.leitos.get(chave(l)) ?? new Map();
  }

  async gravarSgh<T>(_c: ContextoCcih, _trilha: unknown, fn: (g: GravadorCcih) => Promise<T>): Promise<T> {
    const antes = clonar(this.estado);
    const s = this.estado;
    const id = () => ++s.seq;
    const versao = <X extends { id: number; versao: number }>(
      xs: X[],
      i: number,
      v: number,
      cabe: (x: X) => boolean,
    ) => {
      const x = xs.find((y) => y.id === i);
      if (!x || x.versao !== v || !cabe(x)) throw recusaVersaoCcih();
      return x;
    };
    const estados = (l: ChaveLeito) => {
      const m = s.leitos.get(chave(l)) ?? new Map<string, string | null>();
      s.leitos.set(chave(l), m);
      return m;
    };
    const ajustar = (
      l: ChaveLeito,
      tipo: string | null,
    ): 'manteve' | 'abriu' | 'trocou' | 'encerrou' | 'nada' => {
      const m = estados(l);
      const atual = m.has('precaucao') ? (m.get('precaucao') ?? null) : undefined;
      if (atual !== undefined && atual === tipo) return 'manteve';
      if (tipo === null) {
        m.delete('precaucao');
        return atual === undefined ? 'nada' : 'encerrou';
      }
      m.set('precaucao', tipo);
      return atual === undefined ? 'abriu' : 'trocou';
    };
    /** O retrato da versão anterior (como a trilha_auditoria guarda) e a versão nova. */
    const versionar = <X extends { id: number; versao?: number }>(
      tabela: TabelaCorrigivel,
      x: X,
      acao: VersaoRegistro['acao'],
      motivo: string,
      usuario: string,
    ) => {
      const k = `${tabela}|${x.id}`;
      const lista = s.versoes.get(k) ?? [];
      lista.push({
        versao: x.versao ?? 1,
        acao,
        motivo,
        alteradoPor: usuario,
        alteradoEm: this.agoraLocal(),
        dados: JSON.parse(JSON.stringify(x)) as Record<string, unknown>,
      });
      s.versoes.set(k, lista);
    };
    const seg = (t: string) => (t.length === 16 ? `${t}:00` : t);
    const g: GravadorCcih = {
      registrarBundle: (c) => {
        // O índice único do 1026: um por dispositivo, dia e turno entre os não estornados.
        if (
          s.bundles.some(
            (b) =>
              b.dispositivo === c.dispositivo && b.data === c.data && b.turno === c.turno && !b.estornadoEm,
          )
        )
          throw recusa(
            'bundle-ja-registrado',
            'O checklist deste turno já foi registrado para o dispositivo.',
          );
        const novo = id();
        s.bundles.push({
          id: novo,
          dispositivo: c.dispositivo,
          data: c.data,
          turno: c.turno,
          itens: { ...c.itens },
          conforme: c.conforme,
          indicacaoRevisada: c.indicacaoRevisada,
          observacao: c.observacao,
          registradoPor: c.usuario,
          registradoEm: c.agora.length === 16 ? `${c.agora}:00` : c.agora.slice(0, 19),
          versao: 1,
          estornadoEm: null,
          estornadoPor: null,
          motivoEstorno: null,
        });
        return Promise.resolve({ id: novo });
      },
      corrigirBundle: async (c) => {
        const x = versao(s.bundles, c.id, c.versao, (y) => !y.estornadoEm);
        versionar('verificacao_bundle', x, 'correcao', c.justificativa, c.usuario);
        const novo = {
          ...x,
          itens: { ...c.itens },
          conforme: c.conforme,
          indicacaoRevisada: c.indicacaoRevisada,
          observacao: c.observacao,
          versao: x.versao + 1,
        };
        s.bundles = s.bundles.map((y) => (y.id === x.id ? novo : y));
        return { versao: novo.versao };
      },
      estornarBundle: async (c) => {
        const x = versao(s.bundles, c.id, c.versao, (y) => !y.estornadoEm);
        versionar('verificacao_bundle', x, 'estorno', c.justificativa, c.usuario);
        const novo = {
          ...x,
          estornadoEm: seg(c.agora.slice(0, 19)),
          estornadoPor: c.usuario,
          motivoEstorno: c.justificativa,
          versao: x.versao + 1,
        };
        s.bundles = s.bundles.map((y) => (y.id === x.id ? novo : y));
        return { versao: novo.versao };
      },
      corrigirDispositivo: async (c) => {
        const x = versao(s.dispositivos, c.id, c.versao, (y) => !y.canceladoEm);
        versionar('dispositivo_invasivo_paciente', x, 'correcao', c.justificativa, c.usuario);
        Object.assign(x, {
          tipo: c.tipo,
          sitio: c.sitio,
          inseridoEm: seg(c.inseridoEm),
          ...(c.retiradoEm ? { retiradoEm: seg(c.retiradoEm) } : {}),
          ...(c.responsavel === undefined ? {} : { responsavel: c.responsavel }),
          versao: x.versao + 1,
        });
        return { versao: x.versao };
      },
      cancelarDispositivo: async (c) => {
        const x = versao(s.dispositivos, c.id, c.versao, (y) => !y.canceladoEm);
        versionar('dispositivo_invasivo_paciente', x, 'cancelamento', c.justificativa, c.usuario);
        Object.assign(x, { canceladoEm: c.agora, motivoCancelamento: c.justificativa, versao: x.versao + 1 });
        // A mesma conferência dos dependentes dentro da transação (exigirSemDependentesQua no banco).
        if (s.iras.some((i) => i.dispositivo === c.id && i.situacao === 'confirmada'))
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        return { versao: x.versao };
      },
      corrigirIras: async (c) => {
        const x = versao(s.iras, c.id, c.versao, (y) => y.situacao === 'confirmada');
        versionar('caso_infeccao', x, 'correcao', c.justificativa, c.usuario);
        Object.assign(x, {
          dataInfeccao: c.dataInfeccao,
          criterios: [...new Set(c.criterios)],
          microrganismo: c.microrganismo,
          multirresistente: c.multirresistente,
          descricao: c.descricao,
          ...(c.dispositivo === undefined ? {} : { dispositivo: c.dispositivo }),
          versao: x.versao + 1,
        });
        return { versao: x.versao };
      },
      alterarPrecaucao: async (c) => {
        const x = versao(s.precaucoes, c.id, c.versao, (y) => y.fimEm === null);
        versionar('isolamento_paciente', x, 'correcao', c.justificativa, c.usuario);
        const bloqueados: ChaveLeito[] = [];
        for (const v of c.bloquear) {
          const m = estados(v);
          if (m.has('bloqueio')) continue;
          m.set('bloqueio', 'isolamento');
          bloqueados.push(v);
        }
        let liberados = 0;
        for (const v of c.liberar) {
          const m = estados(v);
          if (m.get('bloqueio') === 'isolamento' && m.delete('bloqueio')) liberados++;
        }
        Object.assign(x, {
          tipo: c.tipo,
          motivo: c.motivo,
          motivoOutro: c.motivoOutro,
          multirresistente: c.multirresistente,
          bloqueios: [...c.manter, ...bloqueados].map((v) => ({ ...v })),
          versao: x.versao + 1,
        });
        ajustar(c.leito, c.tipoDoLeito);
        return { versao: x.versao, bloqueados: bloqueados.length, liberados };
      },
      corrigirObservacaoMaos: async (c) => {
        const x = s.maos.find((y) => y.id === c.id);
        if (!x || (x.versao ?? 1) !== c.versao || x.estornadoEm) throw recusaVersaoCcih();
        versionar('observacao_higiene_maos', x, 'correcao', c.justificativa, c.usuario);
        Object.assign(x, {
          observadoEm: seg(c.observadoEm),
          categoria: c.categoria,
          oportunidades: c.oportunidades,
          conformes: c.conformes,
          detalhe: [...c.detalhe],
          observacao: c.observacao,
          versao: c.versao + 1,
        });
        return { versao: c.versao + 1 };
      },
      estornarObservacaoMaos: async (c) => {
        const x = s.maos.find((y) => y.id === c.id);
        if (!x || (x.versao ?? 1) !== c.versao || x.estornadoEm) throw recusaVersaoCcih();
        versionar('observacao_higiene_maos', x, 'estorno', c.justificativa, c.usuario);
        Object.assign(x, { estornadoEm: c.agora, motivoEstorno: c.justificativa, versao: c.versao + 1 });
        return { versao: c.versao + 1 };
      },
      fecharCompetencia: async (c) => {
        const x = s.competencias.find((y) => y.competencia === c.competencia);
        if (!x) {
          const n = id();
          s.competencias.push({
            id: n,
            area: 'ccih',
            competencia: c.competencia,
            situacao: 'fechada',
            fechadaPor: c.usuario,
            fechadaEm: c.agora,
            reabertaPor: null,
            reabertaEm: null,
            motivoReabertura: null,
            versao: 1,
          });
          return { id: n, versao: 1 };
        }
        if (x.situacao === 'fechada') throw recusa('competencia-fechada', 'A competência já está fechada.');
        versionar('fechamento_vigilancia_iras', x, 'fechamento', 'Fechamento depois da reabertura', c.usuario);
        Object.assign(x, {
          situacao: 'fechada',
          fechadaPor: c.usuario,
          fechadaEm: c.agora,
          reabertaPor: null,
          reabertaEm: null,
          motivoReabertura: null,
          versao: x.versao + 1,
        });
        return { id: x.id, versao: x.versao };
      },
      reabrirCompetencia: async (c) => {
        const x = versao(s.competencias, c.id, c.versao, (y) => y.situacao === 'fechada');
        versionar('fechamento_vigilancia_iras', x, 'reabertura', c.justificativa, c.usuario);
        Object.assign(x, {
          situacao: 'reaberta',
          reabertaPor: c.usuario,
          reabertaEm: c.agora,
          motivoReabertura: c.justificativa,
          versao: x.versao + 1,
        });
        return { versao: x.versao };
      },
      registrarDispositivo: async (d) => {
        const n = id();
        s.dispositivos.push({
          id: n,
          reg: d.reg,
          paciente: d.paciente,
          setor: d.leito.bloco,
          acomodacao: d.leito.acomodacao,
          leito: d.leito.leito,
          tipo: d.tipo,
          sitio: d.sitio,
          inseridoEm: d.inseridoEm.length === 16 ? `${d.inseridoEm}:00` : d.inseridoEm,
          itemPrescricao: d.itemPrescricao,
          observacao: d.observacao,
          retiradoEm: null,
          motivoRetirada: null,
          registradoPor: d.usuario,
          versao: 1,
          responsavel: d.responsavel ?? null,
        });
        return { id: n };
      },
      retirarDispositivo: async (r) => {
        const x = versao(s.dispositivos, r.id, r.versao, (y) => y.retiradoEm === null);
        Object.assign(x, {
          retiradoEm: r.retiradoEm.length === 16 ? `${r.retiradoEm}:00` : r.retiradoEm,
          motivoRetirada: r.motivo,
          versao: x.versao + 1,
        });
        return { versao: x.versao };
      },
      registrarIras: async (i) => {
        if (i.dispositivo !== null && s.dispositivos.find((d) => d.id === i.dispositivo)?.canceladoEm)
          throw recusa(
            'dispositivo-cancelado',
            'O dispositivo associado à ficha foi cancelado nesse meio-tempo.',
          );
        const n = id();
        s.iras.push({
          id: n,
          reg: i.reg,
          paciente: i.paciente,
          setor: i.setor,
          sitio: i.sitio,
          dataInfeccao: i.dataInfeccao,
          criterios: [...new Set(i.criterios)],
          nivelIsc: i.nivelIsc,
          cirurgia: i.cirurgia,
          implante: i.implante,
          exame: i.exame,
          microrganismo: i.microrganismo,
          multirresistente: i.multirresistente,
          dispositivo: i.dispositivo,
          descricao: i.descricao,
          situacao: 'confirmada',
          motivoDescarte: null,
          registradoPor: i.usuario,
          registradoEm: this.agoraLocal(),
          versao: 1,
        });
        return { id: n };
      },
      descartarIras: async (d) => {
        const x = versao(s.iras, d.id, d.versao, (y) => y.situacao === 'confirmada');
        Object.assign(x, { situacao: 'descartada', motivoDescarte: d.justificativa, versao: x.versao + 1 });
        return { versao: x.versao };
      },
      configurarAntimicrobiano: async (c) => {
        const x = s.itens.find((y) => y.item === c.item);
        const linha: ItemAntimicrobianoConfigurado = {
          item: c.item,
          restrito: c.restrito,
          atc: c.atc,
          dddGramas: c.dddGramas,
          gramasPorUnidade: c.gramasPorUnidade,
          atualizadoPor: c.usuario,
          atualizadoEm: c.agora,
        };
        if (x) {
          Object.assign(x, linha);
          return { id: s.itens.indexOf(x) + 1, criado: false };
        }
        s.itens.push(linha);
        return { id: s.itens.length, criado: true };
      },
      liberarAntimicrobiano: async (x) => {
        if (s.liberacoes.some((y) => y.itemPrescricao === x.itemPrescricao))
          throw recusa('ja-decidido', 'A CCIH já decidiu sobre este item da prescrição: recarregue a fila.');
        const n = id();
        s.liberacoes.push({
          id: n,
          itemPrescricao: x.itemPrescricao,
          prescricao: x.prescricao,
          reg: x.reg,
          paciente: x.paciente,
          item: x.item,
          ficha: x.ficha,
          prescritoEm: x.prescritoEm,
          inicioTratamento: x.inicioTratamento,
          decisao: x.decisao,
          diasAutorizados: x.diasAutorizados,
          justificativa: x.justificativa,
          noPrazo: x.noPrazo,
          decididoEm: x.agora,
          decididoPor: x.usuario,
          revisoes: { d3: null, d7: null },
          versao: 1,
        });
        return { id: n };
      },
      revisarAntimicrobiano: async (r) => {
        const x = versao(s.liberacoes, r.id, r.versao, (y) => y.revisoes[r.marco] === null);
        const rev = { em: r.agora, por: r.usuario, conduta: r.conduta, observacao: r.observacao };
        Object.assign(x, { revisoes: { ...x.revisoes, [r.marco]: rev }, versao: x.versao + 1 });
        return { versao: x.versao };
      },
      definirPrecaucao: async (p) => {
        const bloqueados: ChaveLeito[] = [];
        for (const v of p.bloquear) {
          const m = estados(v);
          if (m.has('bloqueio')) continue;
          m.set('bloqueio', 'isolamento');
          bloqueados.push(v);
        }
        const lista = [...bloqueados, ...(p.compartilhar ?? []).map((v) => ({ ...v }))];
        const leito = ajustar(p.leito, p.tipoDoLeito);
        const n = id();
        s.precaucoes.push({
          id: n,
          reg: p.reg,
          paciente: p.paciente,
          leito: { ...p.leito },
          motivo: p.motivo,
          motivoOutro: p.motivoOutro,
          tipo: p.tipo,
          origem: p.origem,
          exame: p.exame,
          multirresistente: p.multirresistente,
          bloqueios: lista,
          observacao: p.observacao,
          inicioEm: p.agora,
          inicioPor: p.usuario,
          fimEm: null,
          motivoFim: null,
          versao: 1,
        });
        return { id: n, bloqueados: bloqueados.length, leito };
      },
      encerrarPrecaucao: async (r) => {
        const x = versao(s.precaucoes, r.id, r.versao, (y) => y.fimEm === null);
        Object.assign(x, { fimEm: r.agora, motivoFim: r.motivo, versao: x.versao + 1 });
        ajustar(r.leito, r.tipoDoLeito);
        let liberados = 0;
        for (const v of r.bloqueios) {
          const m = estados(v);
          if (m.get('bloqueio') === 'isolamento' && m.delete('bloqueio')) liberados++;
        }
        return { versao: x.versao, liberados };
      },
      registrarObservacaoMaos: async (o) => {
        const n = id();
        s.maos.push({
          tipo: 'observacao',
          id: n,
          unidade: o.unidade,
          setor: o.setor,
          observadoEm: o.observadoEm.length === 16 ? `${o.observadoEm}:00` : o.observadoEm,
          categoria: o.categoria,
          oportunidades: o.oportunidades,
          conformes: o.conformes,
          detalhe: [...o.detalhe],
          registradoPor: o.usuario,
          versao: 1,
          observacao: o.observacao,
          estornadoEm: null,
          motivoEstorno: null,
        });
        return { id: n };
      },
      registrarConsumoAlcool: async (c) => {
        const x = s.consumo.find(
          (y) =>
            y.unidade === c.unidade && y.competencia === c.competencia && (y.setor ?? '') === (c.setor ?? ''),
        );
        if (x) {
          x.mililitros = c.mililitros;
          return { id: null, criado: false };
        }
        s.consumo.push({
          unidade: c.unidade,
          setor: c.setor,
          competencia: c.competencia,
          mililitros: c.mililitros,
        });
        return { id: id(), criado: true };
      },
      registrarSurto: async (x) => {
        const n = id();
        s.surtos.push({
          id: n,
          titulo: x.titulo,
          tipoSurto: x.tipoSurto,
          agente: x.agente,
          unidade: x.unidade,
          setor: x.setor,
          inicio: x.inicio,
          casos: x.casos,
          medidas: x.medidas,
          situacao: 'investigacao',
          encerradoEm: null,
          registradoPor: x.usuario,
          versao: 1,
        });
        return { id: n };
      },
      atualizarSurto: async (a) => {
        const x = versao(s.surtos, a.id, a.versao, (y) => y.situacao !== 'encerrado');
        Object.assign(x, {
          situacao: a.situacao,
          casos: a.casos,
          medidas: a.medidas,
          encerradoEm: a.encerradoEm,
          versao: x.versao + 1,
        });
        return { versao: x.versao };
      },
    };
    try {
      return await fn(g);
    } catch (e) {
      this.estado = antes;
      throw e;
    }
  }
}
