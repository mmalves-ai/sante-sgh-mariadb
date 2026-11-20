// Porta do ponto em memória (M52.4): a sessão sintética de dev/ci e o E2E. Os domínios são os rótulos do vocabulário
// (os mesmos códigos do ramo), os feriados são os nacionais fixos, e os registros vivem por estabelecimento, numa cópia
// por transação (o erro no meio desfaz tudo). Nada vai à cópia do banco. As regras de banco que importam ao teste também
// valem aqui: só inclusão no arquivo, nas marcações, na trilha do período e no banco; a mesma marcação do mesmo relógio
// uma vez; o mesmo arquivo uma vez; a decisão só do ajuste pendente, com a versão, por outra pessoa.
import { CLASSES_HORA, DESTINOS_BANCO, EVENTOS_FOLHA, INICIOS_BANCO } from '@sgh/contratos';
import {
  type AjustePontoLido,
  type ArquivoAfdLido,
  type FiltroArquivosAfdSgh,
  type DominiosPonto,
  ErroOperacao,
  type EventoPeriodoLidoSgh,
  type FeriadoLido,
  type LinhaTrilha,
  type MarcacaoPontoLida,
  type MovimentoBancoLidoSgh,
  type RegraBancoLida,
  type CorrecaoPesLida,
  type VinculoPorHmacLido,
} from '@sgh/legado';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoasMemoria } from '../porta-memoria.js';
import type { ContextoPonto, GravadorPonto, PortaPonto } from './porta-ponto.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

interface MarcacaoMem extends MarcacaoPontoLida {
  readonly cpfHmac: string;
}
interface Estado {
  seq: number;
  arquivos: ArquivoAfdLido[];
  marcacoes: MarcacaoMem[];
  ajustes: AjustePontoLido[];
  periodo: EventoPeriodoLidoSgh[];
  regras: RegraBancoLida[];
  correcoes: CorrecaoPesLida[];
  banco: MovimentoBancoLidoSgh[];
  outbox: { tipo: string; chave: string; carga: Record<string, string | number> }[];
}
const novo = (): Estado => ({
  seq: 5240,
  arquivos: [],
  marcacoes: [],
  ajustes: [],
  periodo: [],
  regras: [],
  correcoes: [],
  banco: [],
  outbox: [],
});
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  arquivos: [...s.arquivos],
  marcacoes: [...s.marcacoes],
  ajustes: s.ajustes.map((a) => ({ ...a })),
  periodo: [...s.periodo],
  regras: s.regras.map((r) => ({ ...r })),
  correcoes: [...s.correcoes],
  banco: [...s.banco],
  outbox: [...s.outbox],
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const opcoes = (o: Readonly<Record<number, string>>) =>
  Object.entries(o).map(([k, v]) => ({ codigo: Number(k), nome: v }));

/** Domínios do ramo para a sessão sintética (os rótulos do vocabulário, nos mesmos códigos). */
export const DOMINIOS_PONTO_SINTETICOS: DominiosPonto = {
  classesHora: opcoes(CLASSES_HORA),
  eventosFolha: opcoes(EVENTOS_FOLHA),
  destinosBanco: opcoes(DESTINOS_BANCO),
  iniciosBanco: opcoes(INICIOS_BANCO),
  modelosRelogio: [
    { codigo: 0, nome: 'Não se aplica' },
    { codigo: 1, nome: 'Relógio sintético modelo A' },
  ],
  justificativas: [
    { codigo: 1, nome: 'Consulta médica' },
    { codigo: 2, nome: 'Treinamento externo' },
  ],
  periodos: [
    { codigo: 0, nome: '1ª Entrada' },
    { codigo: 1, nome: '1ª Saída' },
    { codigo: 2, nome: '2ª Entrada' },
    { codigo: 3, nome: '2ª Saída' },
  ],
  movimentos: [
    { codigo: 4, nome: 'Falta' },
    { codigo: 7, nome: 'Atestado médico' },
    { codigo: 8, nome: 'Faltas justificadas' },
    { codigo: 9, nome: 'Falta abonada' },
    { codigo: 14, nome: 'Compensação de horas' },
  ],
};

/** Feriados nacionais fixos (Lei 662/1949 e seguintes): a sessão sintética não tem o calendário do estabelecimento. */
const FERIADOS_FIXOS: readonly [string, string][] = [
  ['01-01', 'Confraternização universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do trabalho'],
  ['09-07', 'Independência'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia da consciência negra'],
  ['12-25', 'Natal'],
];

export class PortaPontoMemoria implements PortaPonto {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético. */
  agoraFixo: string | null = null;

  constructor(private readonly pessoas: PortaPessoasMemoria | null = null) {}

  private e(c: { hospital: string }): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) this.estados.set(c.hospital, (s = novo()));
    return s;
  }

  /** Testes: o que foi à outbox no estabelecimento. */
  eventos(hospital: string) {
    return [...(this.estados.get(hospital)?.outbox ?? [])];
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'O ponto não usa o executor.');
  }

  async gravarSgh<T>(
    c: ContextoPonto,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorPonto) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const id = () => ++s.seq;
    const { agora } = await this.relogio();
    const g: GravadorPonto = {
      arquivoPorHash: async (h) => s.arquivos.find((a) => a.hash === h) ?? null,
      nsrsImportados: async (rep, de, ate) =>
        new Set(
          s.marcacoes.filter((m) => m.numeroRep === rep && m.nsr >= de && m.nsr <= ate).map((m) => m.nsr),
        ),
      incluirArquivo: async (a) => {
        if (s.arquivos.some((x) => x.hash === a.hash))
          throw recusa('arquivo-ja-importado', 'Este arquivo já foi importado (mesmo conteúdo).');
        const n = id();
        const { por, ...resto } = a;
        s.arquivos.push({ ...resto, id: n, hospital: c.hospital, importadoPor: por, importadoEm: agora });
        return n;
      },
      incluirMarcacao: async (m) => {
        if (s.marcacoes.some((x) => x.numeroRep === m.numeroRep && x.nsr === m.nsr))
          throw recusa('marcacao-ja-importada', 'A marcação deste relógio já foi importada.');
        const n = id();
        s.marcacoes.push({
          id: n,
          arquivo: m.arquivo,
          numeroRep: m.numeroRep,
          nsr: m.nsr,
          tipoRegistro: m.tipoRegistro,
          instante: m.instante,
          criadoEm: agora,
          cpfHmac: m.cpfHmac,
        });
        return n;
      },
      marcacoes: async (h, de, ate) => this.daPessoa(s, h, de, ate),
      ajuste: async (i) => s.ajustes.find((a) => a.id === i) ?? null,
      ajustes: async (v, de, ate) => s.ajustes.filter((a) => a.vinculo === v && a.dia >= de && a.dia <= ate),
      incluirAjuste: async (a) => {
        const n = id();
        s.ajustes.push({
          id: n,
          vinculo: a.vinculo,
          dia: a.dia,
          tipo: a.tipo,
          marcacao: a.marcacao,
          instante: a.instante,
          movimento: a.movimento,
          justificativa: a.justificativa,
          periodo: a.periodo,
          minutos: a.minutos,
          motivo: a.motivo,
          situacao: 'pendente',
          pedidoPor: a.por,
          pedidoEm: agora,
          decididoPor: null,
          decididoEm: null,
          motivoDecisao: null,
          versao: 0,
        });
        return n;
      },
      decidirAjuste: async (d) => {
        const i = s.ajustes.findIndex(
          (a) => a.id === d.id && a.versao === d.versao && a.situacao === 'pendente',
        );
        if (i < 0) throw desatualizado();
        const a = s.ajustes[i]!;
        if (a.pedidoPor.toUpperCase() === d.por.toUpperCase())
          throw recusa('aprovador-e-solicitante', 'Quem pediu o ajuste não o aprova.');
        s.ajustes[i] = {
          ...a,
          situacao: d.situacao,
          decididoPor: d.por,
          decididoEm: agora,
          motivoDecisao: d.motivo,
          versao: a.versao + 1,
        };
      },
      eventosPeriodo: async (v) => s.periodo.filter((x) => x.vinculo === v),
      incluirEventoPeriodo: async (p) => {
        const n = id();
        s.periodo.push({
          id: n,
          vinculo: p.vinculo,
          competencia: p.competencia,
          acao: p.acao,
          ref: p.ref,
          hash: p.hash,
          totais: p.totais,
          concorda: p.concorda,
          texto: p.texto,
          registradoPor: p.por,
          registradoEm: agora,
        });
        return n;
      },
      movimentosBanco: async (v) => s.banco.filter((x) => x.vinculo === v),
      incluirMovimentoBanco: async (m) => {
        if (m.minutos === 0) throw recusa('minutos', 'Movimento sem minutos.');
        const n = id();
        s.banco.push({
          id: n,
          vinculo: m.vinculo,
          competencia: m.competencia,
          origem: m.origem,
          destino: m.destino,
          minutos: m.minutos,
          fechamento: m.fechamento,
          motivo: m.motivo,
          registradoPor: m.por,
          registradoEm: agora,
        });
        return n;
      },
      regrasBanco: async () => s.regras.map((r) => ({ ...r })),
      gravarRegraBanco: async (r) => {
        const i = s.regras.findIndex((x) => x.regime === r.regime);
        if (r.versao === null) {
          if (i >= 0) throw recusa('regra-existente', 'O regime já tem a regra do banco: altere-a.');
          const n = id();
          s.regras.push({ id: n, ...campos(r), alteradoPor: r.por, versao: 0 });
          return n;
        }
        const atual = s.regras[i];
        if (!atual || atual.versao !== r.versao) throw desatualizado();
        s.regras[i] = { ...atual, ...campos(r), alteradoPor: r.por, versao: atual.versao + 1 };
        return atual.id;
      },
      desistirAjuste: async (d) => {
        const i = s.ajustes.findIndex(
          (a) =>
            a.id === d.id &&
            a.versao === d.versao &&
            a.situacao === 'pendente' &&
            a.pedidoPor.toUpperCase() === d.por.toUpperCase(),
        );
        if (i < 0) throw desatualizado();
        const a = s.ajustes[i]!;
        s.ajustes[i] = {
          ...a,
          situacao: 'desistido',
          decididoPor: d.por,
          decididoEm: agora,
          motivoDecisao: d.motivo,
          versao: a.versao + 1,
        };
      },
      situacaoRegraBanco: async (x) => {
        const i = s.regras.findIndex(
          (r) => r.regime === x.regime && r.versao === x.versao && (r.ativo !== false) !== x.ativo,
        );
        if (i < 0) throw desatualizado();
        const atual = s.regras[i]!;
        s.regras[i] = {
          ...atual,
          ativo: x.ativo,
          motivoSituacao: x.motivo,
          alteradoPor: x.por,
          versao: atual.versao + 1,
        };
        return atual.id;
      },
      registrarCorrecao: async (x) => {
        s.correcoes.unshift({
          id: id(),
          tabela: x.tabela,
          registro: x.registro,
          operacao: x.operacao,
          antes: structuredClone(x.antes),
          depois: structuredClone(x.depois),
          motivo: x.motivo,
          por: x.por,
          em: local(new Date()),
        });
      },
      travarPessoa: async () => undefined,
      outbox: async (ev) => {
        s.outbox.push(ev);
        return String(id());
      },
    };
    const r = await fn(g);
    this.estados.set(c.hospital, s);
    return r;
  }

  private daPessoa(s: Estado, h: string, de: string, ate: string): MarcacaoPontoLida[] {
    return s.marcacoes
      .filter((m) => m.cpfHmac === h && m.instante >= de && m.instante < ate)
      .sort((a, b) => (a.instante === b.instante ? a.id - b.id : a.instante < b.instante ? -1 : 1))
      .map((m) => ({
        id: m.id,
        arquivo: m.arquivo,
        numeroRep: m.numeroRep,
        nsr: m.nsr,
        tipoRegistro: m.tipoRegistro,
        instante: m.instante,
        criadoEm: m.criadoEm,
      }));
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = this.agoraFixo ?? local(new Date());
    return { hoje: agora.slice(0, 10), agora };
  }
  async dominios(): Promise<DominiosPonto> {
    return DOMINIOS_PONTO_SINTETICOS;
  }
  async feriados(_c: ContextoPonto, de: string, ate: string): Promise<FeriadoLido[]> {
    const r: FeriadoLido[] = [];
    for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++)
      for (const [md, nome] of FERIADOS_FIXOS) {
        const data = `${ano}-${md}`;
        if (data >= de && data <= ate) r.push({ data, nome });
      }
    return r;
  }
  async arquivos(c: ContextoPonto, f: FiltroArquivosAfdSgh) {
    return [...this.e(c).arquivos]
      .reverse()
      .filter(
        (a) =>
          (!f.situacao || a.situacao === f.situacao) &&
          (!f.de || (a.dataFinal !== null && a.dataFinal >= f.de)) &&
          (!f.ate || (a.dataInicial !== null && a.dataInicial <= f.ate)),
      )
      .slice(f.pular, f.pular + f.limite);
  }
  async arquivo(c: ContextoPonto, id: number) {
    return this.e(c).arquivos.find((a) => a.id === id) ?? null;
  }
  async arquivosDoPeriodo(c: ContextoPonto, de: string, ate: string) {
    return this.e(c)
      .arquivos.filter(
        (a) => a.situacao === 'importado' && (a.dataInicial ?? '') <= ate && (a.dataFinal ?? '') >= de,
      )
      .reverse();
  }
  async marcacoes(c: ContextoPonto, h: string, de: string, ate: string) {
    return this.daPessoa(this.e(c), h, de, ate);
  }
  async contagemMarcacoes(c: ContextoPonto, hs: readonly string[], de: string, ate: string) {
    const r = new Map<string, number>();
    for (const h of new Set(hs)) {
      const k = this.daPessoa(this.e(c), h, de, ate).length;
      if (k > 0) r.set(h, k);
    }
    return r;
  }
  async hmacs(c: ContextoPonto, vs: readonly number[]) {
    const r = new Map<number, string>();
    for (const v of vs) {
      const h = this.pessoas?.cpfHmacDoVinculo(c.hospital, v) ?? null;
      if (h) r.set(v, h);
    }
    return r;
  }
  async ajustes(c: ContextoPonto, v: number, de: string, ate: string) {
    return this.e(c).ajustes.filter((a) => a.vinculo === v && a.dia >= de && a.dia <= ate);
  }
  async ajuste(c: ContextoPonto, id: number) {
    return this.e(c).ajustes.find((a) => a.id === id) ?? null;
  }
  async pendentesPorVinculo(c: ContextoPonto, de: string, ate: string) {
    const r = new Map<number, number>();
    for (const a of this.e(c).ajustes)
      if (a.situacao === 'pendente' && a.dia >= de && a.dia <= ate)
        r.set(a.vinculo, (r.get(a.vinculo) ?? 0) + 1);
    return r;
  }
  async eventosPeriodo(c: ContextoPonto, v: number) {
    return this.e(c).periodo.filter((x) => x.vinculo === v);
  }
  async eventosDaCompetencia(c: ContextoPonto, comp: string) {
    return this.e(c).periodo.filter((x) => x.competencia === comp);
  }
  async regrasBanco(c: ContextoPonto) {
    return this.e(c).regras.map((r) => ({ ...r }));
  }
  async correcoes(c: ContextoPonto, tabela: string, registros: readonly number[]) {
    return this.e(c).correcoes.filter((x) => x.tabela === tabela && registros.includes(x.registro));
  }
  async movimentosBanco(c: ContextoPonto, v: number) {
    return this.e(c).banco.filter((x) => x.vinculo === v);
  }
  async saldosBanco(c: ContextoPonto, vs: readonly number[]) {
    const r = new Map<number, number>();
    for (const m of this.e(c).banco)
      if (vs.includes(m.vinculo)) r.set(m.vinculo, (r.get(m.vinculo) ?? 0) + m.minutos);
    return r;
  }
  async vinculosDoLogin(c: ContextoPonto, login: string) {
    if (!this.pessoas) return [];
    const usuario = idUsuarioSintetico(login);
    const r = await this.pessoas.listarVinculos(c, { estado: 'todos', limite: 1000 });
    return r.itens.filter((v) => v.usuario === usuario).map((v) => v.id);
  }
  async vinculosPorHmacs(c: ContextoPonto, hs: readonly string[]) {
    const r = new Map<string, VinculoPorHmacLido[]>();
    if (!this.pessoas) return r;
    const todos = await this.pessoas.listarVinculos(c, { estado: 'todos', limite: 1000 });
    for (const v of todos.itens) {
      const h = this.pessoas.cpfHmacDoVinculo(c.hospital, v.id);
      if (!h || !hs.includes(h)) continue;
      r.set(h, [
        ...(r.get(h) ?? []),
        { vinculo: v.id, pessoa: v.pessoa, admissao: v.admissao, desligamento: v.desligamento },
      ]);
    }
    return r;
  }
}

function campos(r: {
  regime: number;
  destino: number;
  inicio: number;
  desde: string;
  cicloMeses: number;
  faltaDebita: boolean;
}) {
  return {
    regime: r.regime,
    destino: r.destino,
    inicio: r.inicio,
    desde: r.desde,
    cicloMeses: r.cicloMeses,
    faltaDebita: r.faltaDebita,
  };
}
