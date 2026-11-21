// Fonte do M12 em MEMÓRIA (sessão sintética de dev/ci; E2E e testes HTTP): convênios, tabelas e preços
// SINTÉTICOS (nomes "SINTÉTICO", nenhum dado real) e as gravações com as MESMAS entradas Zod, vetos e códigos
// de recusa das operações (situação, contrato, reajuste e desfazer), a idempotência e a reautenticação da
// operação crítica. A prova contra o banco é a integração da fonte própria; aqui é a tela e a HTTP. Nada conecta
// a banco.
import {
  CAMPOS_CONTRATO,
  type DesfazerReajusteEntrada,
  type EstadoOperacao,
  TABELA_COMPARTILHADA,
  TABELAS_COM_PERCENTUAL,
} from '@sgh/contratos';
import {
  ErroOperacao,
  erroConflitoVersao,
  erroEntradaInvalida,
  erroIdempotenciaDivergente,
  erroNaoLiberada,
  erroReautenticacao,
  hashEntrada,
  REAUTENTICACAO_MS_PADRAO,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { CHAVES_CONTRATO, COLUNA_DO_CAMPO, mesmoValor, valorParaGravar } from './campos-contrato.js';
import type { ContextoGravacaoPreco, CtxPrecos, FiltroPagina, FontePrecos } from './fonte.js';
import { type NomeOperacaoPreco, OPERACOES_PRECO } from './operacoes.js';
import {
  type CabecalhoTabela,
  type CargaImportacao,
  type Componentes,
  type ConvenioPreco,
  ErroPlano,
  type FiltroConvenio,
  type ItemDiariaPreco,
  type ItemHonorarioPreco,
  type ItemMatmedPreco,
  type LinhaCargaImportacao,
  type LinhaDoLote,
  type LoteReajuste,
  type Pagina,
  type PlanoConvenio,
  type VigenciaItem,
} from './tipos.js';

const VALOR_MAXIMO_COMPONENTE = 99_999_999.99;
const casas = (v: number) => (String(v).split('.')[1] ?? '').length;
/** O componente cabe no valor gravado (até 4 casas no CH, custo e outros; 2 na anestesia e no filme). */
function componenteAceito(c: Componentes): boolean {
  const ok = (v: number, max: number) =>
    Number.isFinite(v) && v >= 0 && v <= VALOR_MAXIMO_COMPONENTE && casas(v) <= max;
  return ok(c.ch, 4) && ok(c.co, 4) && ok(c.outros, 4) && ok(c.anes, 2) && ok(c.filme, 2);
}
/** Igualdade exata dos cinco componentes (anestesia e filme comparados em centavos). */
function mesmosComponentes(a: Componentes, b: Componentes): boolean {
  const c2 = (x: number) => Math.round(x * 100);
  return a.ch === b.ch && a.co === b.co && a.outros === b.outros && c2(a.anes) === c2(b.anes) && c2(a.filme) === c2(b.filme);
}
/** A diária de acompanhante apontada é do tipo diária e do subtipo acompanhante (1/5), ou nenhuma. */
function diariaAcompanhanteValida(d: { tipo: number | null; subtipo: number | null } | null): boolean {
  if (d === null) return true;
  return !((d.tipo !== null && d.tipo !== 1) || (d.subtipo !== null && d.subtipo !== 5));
}

const ZERO: Componentes = { ch: 0, co: 0, filme: 0, anes: 0, outros: 0 };
const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

interface ConvenioMemoria extends ConvenioPreco {
  dth: { tipo: number; subtipo: number } | null;
  valores: Record<string, string | number | null>;
}

interface ItemMemoria {
  readonly tab: number;
  readonly cod: number;
  readonly nome: string;
  situacao: string;
  readonly ch: number;
  readonly porte: string | null;
  vigencias: { data: string; valores: Componentes }[];
}

interface AutoriaMemoria {
  readonly origem: string;
  readonly lote: string | null;
  readonly tab: number | null;
  readonly cod: number | null;
  readonly data: string | null;
  readonly valores: Componentes | null;
  readonly autor: string;
  readonly quando: string;
  readonly justificativa: string;
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Só as colunas públicas do convênio lido (sem os dados internos da memória). */
function lidoDoConvenio(c: ConvenioMemoria): ConvenioPreco {
  return {
    codigo: c.codigo,
    nome: c.nome,
    situacao: c.situacao,
    classificacao: c.classificacao,
    classificacaoNome: c.classificacaoNome,
    registroAns: c.registroAns,
    honorariosInternacao: c.honorariosInternacao,
    honorariosExterna: c.honorariosExterna,
    diarias: c.diarias,
    matmed: c.matmed,
    porte: c.porte,
  };
}

/** Sem uma chave do objeto (cópia rasa). */
function sem<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const r = { ...o };
  delete r[k];
  return r;
}

function convenioSintetico(
  codigo: number,
  nome: string,
  situacao: 'A' | 'I',
  thm: number,
  thmE: number,
  extra: Partial<ConvenioMemoria> = {},
): ConvenioMemoria {
  const valores: Record<string, string | number | null> = Object.fromEntries(
    CHAVES_CONTRATO.map((c) => [c, null]),
  );
  Object.assign(valores, {
    nome,
    classificacao: '6',
    registroAns: 100000 + codigo,
    cnpj: 11222333000181,
    endereco: 'RUA SINTÉTICA',
    numero: codigo,
    cidade: 'CIDADE SINTÉTICA',
    uf: 'MG',
    cep: 36000000,
    telefone: '3200000000',
    convenioEmail: 'faturamento@operadora.invalid',
    validaCarteira: 'T',
    senhaObrigatoria: '4',
    retornoDias: '30',
    prazoPagamentoDias: '30',
    situacaoAcordo: situacao === 'A' ? 'vigente' : 'suspenso',
    prazoApresentacaoDias: 60,
    exigeGuia: 'sim',
  });

  return {
    codigo,
    nome,
    situacao,
    classificacao: 6,
    classificacaoNome: 'Plano de saúde',
    registroAns: 100000 + codigo,
    honorariosInternacao: thm,
    honorariosExterna: thmE,
    diarias: 5,
    matmed: 700,
    porte: 1,
    dth: null,
    valores,
    ...extra,
  };
}

function itensSinteticos(
  tab: number,
  quantos: number,
  ch = 0,
  porte: string | null = null,
  extra: Partial<Componentes> = {},
): ItemMemoria[] {
  return Array.from({ length: quantos }, (_, i) => ({
    tab,
    cod: tab * 1000 + i + 1,
    nome: `PROCEDIMENTO SINTÉTICO ${tab}-${i + 1}`,
    situacao: 'A',
    ch,
    porte,
    vigencias: [
      { data: '2025-01-01', valores: { ...ZERO, ...extra, ch: 80 + i * 10 } },
      { data: '2026-01-15', valores: { ...ZERO, ...extra, ch: 100 + i * 10 } },
    ],
  }));
}

const pagina = (colunas: [string, string][], itens: Record<string, string | number | null>[]): Pagina => ({
  colunas: colunas.map(([campo, rotulo]) => ({ campo, rotulo })),
  itens,
  total: itens.length,
});

/** Filtro de convênio da fonte: código, lista do escopo (vazia = nenhum) ou null/undefined = todos. */
const noFiltro = (f: FiltroConvenio, c: number) =>
  f == null ? true : typeof f === 'number' ? f === c : f.includes(c);
const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
const doProfissional = (termo: string | null | undefined, conselho: number, nome: string) => {
  const t = (termo ?? '').trim();
  if (!t) return true;
  return /^\d+$/.test(t) ? String(conselho) === t : semAcento(nome).includes(semAcento(t));
};

const fatia = <T>(l: readonly T[], p: number, n: number) => l.slice(p * n, p * n + n);
const busca = (texto: string, b: string | undefined) =>
  !b || !b.trim() || texto.toUpperCase().includes(b.trim().toUpperCase());

/** Os dados sintéticos e o executor em memória (uma instância por processo da API). */
export class FontePrecosMemoria implements FontePrecos {
  readonly destino = 'memoria' as const;
  readonly gravacao = { permitida: true, motivo: null };
  private readonly convenios_: ConvenioMemoria[];
  private readonly itens: ItemMemoria[];
  private readonly autoria: AutoriaMemoria[] = [];
  private readonly cargas_: (CargaImportacao & { linhas: LinhaCargaImportacao[] })[] = [];
  private readonly planos_: (PlanoConvenio & { convenio: number })[] = [];
  private readonly idem = new Map<string, { hash: string; resultado: ResultadoOperacao; usuario: string }>();
  private seq = 0;

  constructor(
    private readonly ambiente: string,
    private readonly agora: () => number = Date.now,
  ) {
    this.convenios_ = [
      convenioSintetico(1, 'SUS SINTÉTICO', 'A', 1, TABELA_COMPARTILHADA),
      convenioSintetico(10, 'PARTICULAR SINTÉTICO', 'A', TABELA_COMPARTILHADA, TABELA_COMPARTILHADA),
      convenioSintetico(305, 'OPERADORA SINTÉTICA ALFA', 'A', 305, 305),
      convenioSintetico(306, 'OPERADORA SINTÉTICA BETA', 'A', 306, 306),
      convenioSintetico(315, 'OPERADORA SINTÉTICA GAMA', 'I', 617, 617),
      convenioSintetico(50, 'OPERADORA SINTÉTICA COM DIÁRIA INVÁLIDA', 'A', 307, 307, {
        dth: { tipo: 2, subtipo: 1 },
      }),
      // Modelos CH (AMB, tabela 53) e PORTE (CBHPM, tabela 71): componentes do valor diferentes de zero,
      // para a consulta provar que o total é a soma dos componentes (regra da sante-api), não o modelo.
      convenioSintetico(53, 'OPERADORA SINTÉTICA MODELO CH', 'A', 53, 53),
      convenioSintetico(71, 'OPERADORA SINTÉTICA MODELO PORTE', 'A', 71, 71),
      // Sem tabela de honorários da conta externa (THM_E nulo): a consulta explica, sem valor.
      convenioSintetico(60, 'OPERADORA SINTÉTICA SEM HONORÁRIO EXTERNO', 'A', 61, 61, {
        honorariosExterna: null,
      }),
    ];
    this.itens = [
      ...itensSinteticos(TABELA_COMPARTILHADA, 6),
      ...itensSinteticos(305, 12),
      ...itensSinteticos(306, 8),
      ...itensSinteticos(617, 5),
      ...itensSinteticos(53, 4, 12.5, null, { co: 7.5, filme: 1.25, outros: 0.5 }),
      ...itensSinteticos(71, 4, 0, '3A', { co: 15, anes: 30, outros: 2 }),
      ...itensSinteticos(61, 2),
    ];
  }

  /** Na memória, as quatro operações do M12 estão liberadas (só em dev/ci). */
  estado(op: string): EstadoOperacao | null {
    return Object.hasOwn(OPERACOES_PRECO, op) ? 'liberada' : null;
  }

  private agoraIso(): string {
    return new Date(this.agora()).toISOString().replace('T', ' ').slice(0, 19);
  }

  hoje(): Promise<string> {
    return Promise.resolve(hojeIso());
  }

  private conv(cod: number): ConvenioMemoria | undefined {
    return this.convenios_.find((c) => c.codigo === cod);
  }

  convenios(): Promise<ConvenioPreco[]> {
    return Promise.resolve(this.convenios_.map(lidoDoConvenio));
  }
  convenio(_c: CtxPrecos, cod: number): Promise<ConvenioPreco | null> {
    const c = this.conv(cod);
    return Promise.resolve(c ? lidoDoConvenio(c) : null);
  }
  valoresContrato(_c: CtxPrecos, cod: number) {
    const c = this.conv(cod);
    return Promise.resolve(c ? { ...c.valores } : null);
  }
  opcoesClassificacao() {
    return Promise.resolve(
      ['SUS', 'Particular', 'Gratuito', 'Diversos', 'Pagamento no ato', 'Plano de saúde'].map((r, i) => ({
        valor: String(i + 1),
        rotulo: r,
      })),
    );
  }
  vigenciasTabelas(_c: CtxPrecos, cod: number) {
    const c = this.conv(cod);
    if (!c) return Promise.resolve([]);
    return Promise.resolve([
      {
        tipo: 'honorariosExterna' as const,
        tabela: c.honorariosExterna ?? 0,
        inicio: '2024-01-01',
        fim: '2099-12-31',
      },
      {
        tipo: 'honorariosInternacao' as const,
        tabela: c.honorariosInternacao ?? 0,
        inicio: '2024-01-01',
        fim: '2099-12-31',
      },
      { tipo: 'diarias' as const, tabela: 5, inicio: '2024-01-01', fim: '2099-12-31' },
    ]);
  }
  indicesConvenio(_c: CtxPrecos, cod: number) {
    return Promise.resolve(
      cod === 305
        ? [
            { tipo: 'indice' as const, chave: '1', data: '2025-01-01', valor: 0.5 },
            { tipo: 'indice' as const, chave: '4', data: '2025-01-01', valor: 20 },
            { tipo: 'indice' as const, chave: '5', data: '2025-01-01', valor: 12 },
            { tipo: 'porte' as const, chave: '3A', data: '2025-01-01', valor: 210 },
          ]
        : [],
    );
  }
  tiss(_c: CtxPrecos, cod: number) {
    return Promise.resolve({
      configurado: cod !== 50,
      valores: { COD_CON_TISS: `SINT${cod}`, VERSAO_TISS: '4.01.00', GNGINR: 5 },
      parametros: [{ codigo: 1, nome: 'PARÂMETRO TISS SINTÉTICO', padrao: 'S' }],
    });
  }
  historico(_c: CtxPrecos, cod: number) {
    const c = this.conv(cod);
    return Promise.resolve(c ? [{ quando: '2024-01-01 10:00:00', nome: c.nome, classificacao: 6 }] : []);
  }
  planos(_c: CtxPrecos, cod: number) {
    return Promise.resolve(this.planos_.filter((p) => p.convenio === cod).map((p) => sem(p, 'convenio')));
  }
  modificadores(_c: CtxPrecos, tipo: string, cod: number, p: number, n: number) {
    const itens =
      tipo === 'honorarios' && cod === 315
        ? [
            { tabela: 625, procedimento: 625001, data: '2025-01-01', tipoPaciente: 'E', percCh: 10 },
            { tabela: 617, procedimento: 617002, data: '2025-01-01', tipoPaciente: 'I', percCh: -5 },
          ]
        : [];
    return Promise.resolve({ itens: fatia(itens, p, n), total: itens.length });
  }
  impactoSituacao(_c: CtxPrecos, cod: number) {
    const c = this.conv(cod);
    return Promise.resolve({
      agendasConsulta: 2,
      agendasExame: 1,
      agendamentosFuturos: 3,
      contasAbertas: 1,
      profissionais: 4,
      diariaAcompanhante: c?.dth ?? null,
    });
  }
  cabecalhos(_c: CtxPrecos, tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<CabecalhoTabela[]> {
    if (tipo === 'diarias')
      return Promise.resolve([{ codigo: 5, nome: 'DIÁRIAS SINTÉTICAS', situacao: 'A', modo: 'V' }]);
    if (tipo === 'matmed')
      return Promise.resolve([{ codigo: 700, nome: 'MAT/MED SINTÉTICO', situacao: 'A' }]);
    const nomes: Record<number, string> = {
      10: 'TABELA SINTÉTICA COMPARTILHADA',
      53: 'TABELA SINTÉTICA AMB',
      71: 'TABELA SINTÉTICA CBHPM',
      305: 'TABELA SINTÉTICA ALFA',
      306: 'TABELA SINTÉTICA BETA',
      617: 'TABELA SINTÉTICA COM PERCENTUAL',
    };
    return Promise.resolve(
      Object.entries(nomes).map(([cod, nome]) => ({ codigo: Number(cod), nome, situacao: 'A', modo: 'H' })),
    );
  }
  perfisHonorario() {
    const m = new Map<number, { itens: number; comCh: number; comPorte: number }>();
    for (const i of this.itens) {
      const x = m.get(i.tab) ?? { itens: 0, comCh: 0, comPorte: 0 };
      x.itens++;
      if (i.ch !== 0) x.comCh++;
      if (i.porte) x.comPorte++;
      m.set(i.tab, x);
    }
    return Promise.resolve(m);
  }

  private lido(i: ItemMemoria, data: string): ItemHonorarioPreco {
    const validas = i.vigencias.filter((v) => v.data <= data).sort((a, b) => (a.data < b.data ? 1 : -1));
    const v = validas[0] ?? null;
    const ult = [...i.vigencias].sort((a, b) => (a.data < b.data ? 1 : -1))[0]?.data ?? null;
    return {
      codigo: i.cod,
      nome: i.nome,
      situacao: i.situacao,
      ch: i.ch,
      porte: i.porte,
      fracaoPorte: i.porte ? 1 : null,
      cope: 0,
      filmeM2: 0,
      ato: 1,
      vigencia: v?.data ?? null,
      valores: v ? { ...v.valores } : null,
      vigencias: i.vigencias.length,
      ultimaData: ult,
    };
  }

  itensHonorario(_c: CtxPrecos, tab: number, f: FiltroPagina) {
    const todos = this.itens
      .filter(
        (i) =>
          i.tab === tab &&
          (/^\d+$/.test((f.busca ?? '').trim()) ? i.cod === Number(f.busca) : busca(i.nome, f.busca)),
      )
      .map((i) => this.lido(i, f.data));
    return Promise.resolve({ itens: fatia(todos, f.pagina, f.porPagina), total: todos.length });
  }
  itemHonorario(_c: CtxPrecos, tab: number, cod: number, data: string) {
    const i = this.itens.find((x) => x.tab === tab && x.cod === cod);
    return Promise.resolve(i ? this.lido(i, data) : null);
  }
  itensParaReajuste(_c: CtxPrecos, tab: number, codigos: readonly number[] | null, data: string) {
    const hoje = hojeIso();
    return Promise.resolve(
      this.itens
        .filter((i) => i.tab === tab && (codigos ? codigos.includes(i.cod) : i.situacao === 'A'))
        .map((i) => ({ ...this.lido(i, hoje), temNaData: i.vigencias.some((v) => v.data === data) })),
    );
  }
  vigenciasDoItem(_c: CtxPrecos, tab: number, cod: number): Promise<VigenciaItem[]> {
    const i = this.itens.find((x) => x.tab === tab && x.cod === cod);
    return Promise.resolve(
      (i?.vigencias ?? [])
        .map((v) => ({ data: v.data, valores: { ...v.valores } }))
        .sort((a, b) => (a.data < b.data ? 1 : -1)),
    );
  }
  autoriaDoItem(_c: CtxPrecos, tab: number, cod: number) {
    const desfeitos = new Set(
      this.autoria.filter((a) => a.origem === 'desfazer').map((a) => `${a.lote}|${a.tab}|${a.cod}|${a.data}`),
    );
    return Promise.resolve(
      this.autoria
        .filter(
          (a) =>
            (a.origem === 'reajuste' || a.origem === 'importacao') &&
            a.tab === tab &&
            a.cod === cod &&
            !desfeitos.has(`${a.lote}|${a.tab}|${a.cod}|${a.data}`),
        )
        .map((a) => ({
          data: a.data ?? '',
          autor: a.autor,
          quando: a.quando,
          origem: a.origem,
          lote: a.lote,
        }))
        .reverse(),
    );
  }
  lotes(_c: CtxPrecos, tab: number | null): Promise<LoteReajuste[]> {
    const grupos = new Map<string, AutoriaMemoria[]>();
    for (const a of this.autoria) {
      if (a.origem !== 'reajuste' && a.origem !== 'importacao') continue;
      if (tab !== null && a.tab !== tab) continue;
      const k = a.lote ?? '';
      grupos.set(k, [...(grupos.get(k) ?? []), a]);
    }
    return Promise.resolve(
      [...grupos.entries()]
        .map(([lote, l]) => ({
          lote,
          tabela: l[0]?.tab ?? 0,
          data: l[0]?.data ?? '',
          origem: l[0]?.origem ?? '',
          itens: l.length,
          autor: l[0]?.autor ?? '',
          quando: l[0]?.quando ?? '',
          justificativa: l[0]?.justificativa ?? '',
          desfeitos: l.filter((x) => this.jaDesfeito(lote, x.tab ?? 0, x.cod ?? 0, x.data ?? '')).length,
          desfeito: l.every((x) => this.jaDesfeito(lote, x.tab ?? 0, x.cod ?? 0, x.data ?? '')),
        }))
        .reverse(),
    );
  }
  linhasDoLote(_c: CtxPrecos, lote: string): Promise<LinhaDoLote[]> {
    return Promise.resolve(
      this.autoria
        .filter(
          (a) =>
            a.lote === lote &&
            (a.origem === 'reajuste' || a.origem === 'importacao') &&
            !this.jaDesfeito(lote, a.tab ?? 0, a.cod ?? 0, a.data ?? ''),
        )
        .map((a) => ({
          tabela: a.tab ?? 0,
          codigo: a.cod ?? 0,
          data: a.data ?? '',
          valores: a.valores ?? ZERO,
        })),
    );
  }
  itensDiaria(
    _c: CtxPrecos,
    _tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemDiariaPreco[]; total: number }> {
    const todos: ItemDiariaPreco[] = [
      ['DIÁRIA DE APARTAMENTO SINTÉTICA', 1, 1, 450.5],
      ['DIÁRIA DE ENFERMARIA SINTÉTICA', 1, 2, 280],
      ['DIÁRIA DE ACOMPANHANTE SINTÉTICA', 1, 5, 90],
      ['TAXA DE SALA SINTÉTICA', 2, 1, 150],
      ['OXIGÊNIO SINTÉTICO (HORA)', 3, 1, 12.75],
    ]
      .map(([nome, tipo, subtipo, valor], i) => ({
        id: 9000 + i,
        codigo: String(4000 + i),
        operacao: 100 + i,
        nome: String(nome),
        tipo: Number(tipo),
        subtipo: Number(subtipo),
        situacao: 'A',
        vigencia: '2026-01-15',
        valor: Number(valor),
        vigencias: 2,
      }))
      .filter((d) => busca(d.nome, f.busca));
    return Promise.resolve({ itens: fatia(todos, f.pagina, f.porPagina), total: todos.length });
  }
  itemDiaria(c: CtxPrecos, tab: number, ope: number, data: string) {
    return this.itensDiaria(c, tab, { pagina: 0, porPagina: 50, data }).then(
      (r) => r.itens.find((i) => i.operacao === ope) ?? null,
    );
  }
  itensMatmed(
    _c: CtxPrecos,
    _tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemMatmedPreco[]; total: number }> {
    const todos: ItemMatmedPreco[] = Array.from({ length: 8 }, (_, i) => ({
      id: 70000 + i,
      codigo: 700100 + i,
      nome: `${i % 2 ? 'MATERIAL' : 'MEDICAMENTO'} SINTÉTICO ${i + 1}`,
      classificacao: i % 2 ? 10 : 20,
      unidade: 'UN',
      referencia: `99:${5000 + i}`,
      situacao: 'A',
      vigencia: '2026-01-15',
      valor: 3.5 + i,
      pmc: 4 + i,
      pf: 3 + i,
      edicao: 1001,
    })).filter((m) => busca(m.nome, f.busca));
    return Promise.resolve({ itens: fatia(todos, f.pagina, f.porPagina), total: todos.length });
  }
  itemMatmed(c: CtxPrecos, tab: number, cod: number, data: string) {
    return this.itensMatmed(c, tab, { pagina: 0, porPagina: 50, data }).then(
      (r) => r.itens.find((i) => i.codigo === cod) ?? null,
    );
  }
  async vigenciasDiaria(c: CtxPrecos, tab: number, ope: number) {
    const d = await this.itemDiaria(c, tab, ope, '9999-12-31');
    if (!d || d.valor === null) return [];
    return [
      { data: '2026-01-15', valor: d.valor },
      { data: '2025-01-01', valor: Math.round(d.valor * 90) / 100 },
    ];
  }
  async vigenciasMatmed(c: CtxPrecos, tab: number, cod: number) {
    const m = await this.itemMatmed(c, tab, cod, '9999-12-31');
    if (!m || m.valor === null) return [];
    return [
      { data: '2026-01-15', valor: m.valor, pmc: m.pmc, pf: m.pf, edicao: 1001 },
      {
        data: '2025-01-01',
        valor: m.valor - 0.5,
        pmc: (m.pmc ?? 0) - 0.5,
        pf: (m.pf ?? 0) - 0.5,
        edicao: 1000,
      },
    ];
  }
  edicoes() {
    return Promise.resolve([
      { id: 2, versao: 1001 },
      { id: 1, versao: 1000 },
    ]);
  }
  indicesNaData(_c: CtxPrecos, conv: number) {
    return Promise.resolve(
      conv === 305 || conv === 53 || conv === 71
        ? new Map([
            [1, 0.5],
            [4, 20],
            [5, 12],
          ])
        : new Map<number, number>(),
    );
  }
  porteNaData(_c: CtxPrecos, conv: number, porte: string) {
    return Promise.resolve((conv === 305 || conv === 71) && porte === '3A' ? 210 : null);
  }
  credenciamento(
    _c: CtxPrecos,
    conv: FiltroConvenio,
    _p: number,
    _n: number,
    bancario: boolean,
    profissional?: string | null,
  ) {
    const cols: [string, string][] = [
      ['convenio', 'Convênio'],
      ['conselho', 'Registro no conselho'],
      ['profissional', 'Profissional'],
      ['codigo', 'Código no convênio'],
      ['codigoTiss', 'Código TISS'],
      ['valorConsulta', 'Valor da consulta (Particular)'],
    ];
    if (bancario) cols.push(['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta']);
    const itens = [305, 10, 305]
      .map((c, i) => ({
        convenio: c,
        conselho: 99001 + i,
        profissional: `PROFISSIONAL SINTÉTICO ${String.fromCharCode(65 + i)}`,
        codigo: `PS${100 + i}`,
        codigoTiss: `T${100 + i}`,
        valorConsulta: c === 10 ? 250 : null,
        ...(bancario ? { banco: 'BANCO SINTÉTICO', agencia: '0001', conta: `00000${i}` } : {}),
      }))
      .filter((x) => noFiltro(conv, x.convenio) && doProfissional(profissional, x.conselho, x.profissional));
    return Promise.resolve(pagina(cols, itens));
  }
  credenciamentoAtos(_c: CtxPrecos, conv: FiltroConvenio) {
    return Promise.resolve(
      pagina(
        [
          ['convenio', 'Convênio'],
          ['ato', 'Ato'],
          ['codigo', 'Código no convênio'],
        ],
        [{ convenio: 305, ato: 1, codigo: 'H305' }].filter((x) => noFiltro(conv, x.convenio)),
      ),
    );
  }
  credenciamentoComplementar() {
    return Promise.resolve({
      unimed: pagina([['convenio', 'Convênio']], []),
      auditoras: pagina(
        [
          ['codigo', 'Código'],
          ['nome', 'Empresa auditora'],
        ],
        [{ codigo: 1, nome: 'AUDITORA SINTÉTICA' }],
      ),
    });
  }
  codigosPrestador(_c: CtxPrecos, conv: FiltroConvenio) {
    return Promise.resolve(
      pagina(
        [
          ['codigo', 'Código'],
          ['convenio', 'Convênio'],
          ['atividade', 'Atividade'],
          ['codigoConvenio', 'Código do prestador no convênio'],
          ['nome', 'Descrição'],
          ['usuarios', 'Usuários com acesso'],
        ],
        [
          {
            codigo: 1,
            convenio: 305,
            atividade: 1,
            codigoConvenio: 'PREST-SINT-305',
            nome: 'PORTAL SINTÉTICO',
            usuarios: 3,
          },
          {
            codigo: 2,
            convenio: 306,
            atividade: 1,
            codigoConvenio: 'PREST-SINT-306',
            nome: 'PORTAL SINTÉTICO B',
            usuarios: 1,
          },
        ].filter((x) => noFiltro(conv, x.convenio)),
      ),
    );
  }
  dePara(_c: CtxPrecos, conv: FiltroConvenio, exame: string | null) {
    return Promise.resolve(
      pagina(
        [
          ['convenio', 'Convênio'],
          ['exame', 'Exame (código interno)'],
          ['ato', 'Ato'],
          ['codigoConvenio', 'Código no convênio'],
        ],
        [
          { convenio: 305, exame: 'HEMO', ato: 40, codigoConvenio: 40304361 },
          { convenio: 305, exame: 'GLIC', ato: 40, codigoConvenio: 40302040 },
          { convenio: 306, exame: 'HEMO', ato: 40, codigoConvenio: 40304361 },
        ].filter((x) => noFiltro(conv, x.convenio) && (!exame || x.exame === exame)),
      ),
    );
  }
  portes(_c: CtxPrecos, tab: number | null) {
    return Promise.resolve(
      pagina(
        [
          ['tabela', 'Tabela de porte'],
          ['porte', 'Porte anestésico'],
          ['data', 'Vigência'],
          ['valor', 'Valor'],
        ],
        [1, 2]
          .flatMap((t) =>
            [1, 2, 3].map((n) => ({ tabela: t, porte: String(n), data: '2025-01-01', valor: 100 * n * t })),
          )
          .filter((x) => tab === null || x.tabela === tab),
      ),
    );
  }
  terceiros(_c: CtxPrecos, tab: number, b: string) {
    return Promise.resolve(
      pagina(
        [
          ['codigo', 'Código'],
          ['nome', 'Descrição'],
          ['valor', 'Valor'],
        ],
        [1, 2, 3]
          .map((n) => ({ codigo: tab * 100 + n, nome: `REFERÊNCIA SINTÉTICA ${n}`, valor: 10 * n }))
          .filter((x) => busca(x.nome, b)),
      ),
    );
  }
  tabelasTerceiros() {
    return Promise.resolve([{ tabela: 710, itens: 3, ultima: '2022-01-01' }]);
  }
  unimed(_c: CtxPrecos, b: string) {
    return Promise.resolve(
      pagina(
        [
          ['codigo', 'Código'],
          ['nome', 'Procedimento'],
        ],
        [
          { codigo: 10101012, nome: 'CONSULTA SINTÉTICA' },
          { codigo: 40304361, nome: 'HEMOGRAMA SINTÉTICO' },
        ].filter((x) => busca(x.nome, b)),
      ),
    );
  }
  saneamento() {
    return Promise.resolve([
      {
        origem: 'percentual-matmed' as const,
        chave: 'convênio 305 · item 70001 · conta E',
        data: '0218-03-01',
      },
      { origem: 'indice' as const, chave: 'convênio 305 · índice 1', data: '0019-01-01' },
    ]);
  }
  cargas(_c: CtxPrecos, catalogo: string) {
    return Promise.resolve(
      this.cargas_
        .filter((x) => x.catalogo === catalogo)
        .map((x) => sem(x, 'linhas'))
        .reverse(),
    );
  }
  carga(_c: CtxPrecos, id: number) {
    const x = this.cargas_.find((k) => k.id === id);
    return Promise.resolve(x ? sem(x, 'linhas') : null);
  }
  linhasDaCarga(_c: CtxPrecos, id: number, p: number, n: number, cmp: string | null) {
    const l = (this.cargas_.find((k) => k.id === id)?.linhas ?? []).filter(
      (x) => !cmp || x.comparacao === cmp,
    );
    return Promise.resolve({ itens: fatia(l, p, n), total: l.length });
  }
  gravarCarga(_c: CtxPrecos, nova: Parameters<FontePrecos['gravarCarga']>[1]) {
    const id = ++this.seq;
    this.cargas_.push({
      id,
      catalogo: nova.catalogo,
      tabela: nova.tabela,
      arquivo: nova.arquivo,
      sha256: nova.sha256,
      bytes: nova.bytes,
      situacao: nova.situacao,
      responsavel: nova.responsavel,
      aprovador: null,
      criadaEm: this.agoraIso(),
      totais: nova.totais,
      lote: null,
      motivo: nova.motivo,
      versao: 1,
      linhas: nova.linhas.map((l) => ({
        ...l,
        valores: l.valores ? { ...l.valores } : null,
        anteriores: l.anteriores ? { ...l.anteriores } : null,
        nome: l.nome ?? null,
      })),
    });
    return Promise.resolve({ id });
  }
  mudarSituacaoCarga(_c: CtxPrecos, m: Parameters<FontePrecos['mudarSituacaoCarga']>[1]) {
    const i = this.cargas_.findIndex((k) => k.id === m.id);
    const x = this.cargas_[i];
    if (!x || x.versao !== m.versao)
      return Promise.reject(
        new ErroOperacao(409, 'conflito-concorrente', 'Conflito', 'A importação mudou. Releia.'),
      );
    if (!m.de.includes(x.situacao))
      return Promise.reject(
        new ErroOperacao(409, 'situacao-invalida', 'Situação', 'Situação não permite a ação.'),
      );
    this.cargas_[i] = {
      ...x,
      situacao: m.para,
      aprovador: m.aprovador,
      lote: m.lote,
      motivo: m.motivo ?? x.motivo,
      versao: x.versao + 1,
    };
    return Promise.resolve();
  }
  gravarPlano(_c: CtxPrecos, p: Parameters<FontePrecos['gravarPlano']>[1]) {
    const id = ++this.seq;
    this.planos_.push({
      id,
      convenio: p.convenio,
      nome: p.nome,
      planoLegado: p.planoLegado,
      inicio: p.inicio,
      fim: p.fim,
      ativo: true,
      criadoPor: p.autor,
      versao: 1,
    });
    return Promise.resolve({ id });
  }
  alterarPlano(_c: CtxPrecos, a: Parameters<FontePrecos['alterarPlano']>[1]) {
    const i = this.planos_.findIndex((x) => x.id === a.id && x.convenio === a.convenio);
    const x = this.planos_[i];
    if (!x) return Promise.reject(new ErroPlano('nao-encontrado', 'Plano não encontrado neste convênio.'));
    if (x.versao !== a.versao)
      return Promise.reject(
        new ErroPlano('conflito-concorrente', 'O plano mudou desde a leitura. Releia.'),
      );
    if (a.fim && a.fim < x.inicio)
      return Promise.reject(
        new ErroPlano('vigencia-invalida', `O fim (${a.fim}) não pode ser antes do início (${x.inicio}).`),
      );
    this.planos_[i] = {
      ...x,
      ...(a.nome !== undefined ? { nome: a.nome } : {}),
      ...(a.fim !== undefined ? { fim: a.fim } : {}),
      ...(a.ativo !== undefined ? { ativo: a.ativo } : {}),
      versao: x.versao + 1,
    };
    return Promise.resolve({ id: a.id, versao: x.versao + 1 });
  }

  // ── Gravação compatível em memória (as mesmas entradas, vetos e códigos das receitas) ─────────────────

  async executar(
    nome: NomeOperacaoPreco,
    c: CtxPrecos,
    bruta: unknown,
    ctx: ContextoGravacaoPreco,
  ): Promise<{ resultado: ResultadoOperacao; repetida: boolean }> {
    const op = OPERACOES_PRECO[nome];
    const hospital = c.hospital;
    if (!op || this.estado(nome) === null || !['dev', 'ci'].includes(this.ambiente))
      throw erroNaoLiberada('a memória só grava em dev/ci');
    const a = op.entrada.safeParse(bruta);
    if (!a.success)
      throw erroEntradaInvalida([...new Set(a.error.issues.map((i) => i.path.join('.') || '(entrada)'))]);
    if (op.critica) {
      const em = ctx.reautenticadoEm;
      if (em === undefined || this.agora() - em > REAUTENTICACAO_MS_PADRAO) throw erroReautenticacao();
    }
    const hash = hashEntrada(nome, a.data);
    const chave = `${hospital}|${nome}|${ctx.chaveIdempotencia}`;
    const anterior = this.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash || anterior.usuario !== ctx.login)
        throw erroIdempotenciaDivergente();
      return { resultado: anterior.resultado, repetida: true };
    }
    const resultado = this.aplicar(nome, a.data as Record<string, unknown>, ctx);
    this.idem.set(chave, { hash, resultado, usuario: ctx.login });
    return { resultado, repetida: false };
  }

  private registrar(a: Omit<AutoriaMemoria, 'quando'>): void {
    this.autoria.push({ ...a, quando: this.agoraIso() });
  }

  private aplicar(nome: string, e: Record<string, unknown>, ctx: ContextoGravacaoPreco): ResultadoOperacao {
    if (nome === 'convenio.alterarSituacao') {
      const c = this.conv(Number(e['convenio']));
      if (!c)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Registro não encontrado',
          'O convênio não existe.',
        );
      const origem = e['operacao'] === 'suspender' ? 'A' : 'I';
      const alvo = origem === 'A' ? 'I' : 'A';
      if (c.situacao === alvo) throw recusa('sem-efeito', `O convênio ${c.codigo} já está nessa situação.`);
      if (!diariaAcompanhanteValida(c.dth))
        throw recusa(
          'diaria-acompanhante-invalida',
          'A diária de acompanhante do convênio não é diária/acompanhante.',
        );
      Object.assign(c, { situacao: alvo });
      c.valores['situacaoAcordo'] = alvo === 'A' ? 'vigente' : 'suspenso';
      this.registrar({
        origem: 'situacao',
        lote: null,
        tab: null,
        cod: c.codigo,
        data: null,
        valores: null,
        autor: ctx.login,
        justificativa: String(e['justificativa']),
      });
      return { convenio: c.codigo, situacaoAntes: origem, situacaoDepois: alvo };
    }
    if (nome === 'convenio.alterarContrato') {
      const c = this.conv(Number(e['convenio']));
      if (!c)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Registro não encontrado',
          'O convênio não existe.',
        );
      const valores = e['valores'] as Record<string, string | number | null>;
      const lidos = e['lidos'] as Record<string, string | number | null>;
      const campos = Object.keys(valores).sort();
      const mudaram = campos.filter((k) => !mesmoValor(k, c.valores[COLUNA_DO_CAMPO[k] as string], lidos[k]));
      if (mudaram.length) throw erroConflitoVersao(mudaram);
      if (campos.every((k) => mesmoValor(k, c.valores[COLUNA_DO_CAMPO[k] as string], valores[k])))
        throw recusa('sem-efeito', 'Nenhum campo muda de valor.');
      if (!diariaAcompanhanteValida(c.dth))
        throw recusa(
          'diaria-acompanhante-invalida',
          'A diária de acompanhante do convênio não é diária/acompanhante.',
        );
      for (const k of campos) {
        if (!CAMPOS_CONTRATO.some((x) => x.campo === k)) throw recusa('campo-nao-editavel', `Campo ${k}.`);
        c.valores[COLUNA_DO_CAMPO[k] as string] = valorParaGravar(k, valores[k] ?? null);
      }
      if (valores['nome'] !== undefined) Object.assign(c, { nome: String(c.valores['nome']) });
      this.registrar({
        origem: 'contrato',
        lote: null,
        tab: null,
        cod: c.codigo,
        data: null,
        valores: null,
        autor: ctx.login,
        justificativa: String(e['justificativa']),
      });
      return { convenio: c.codigo, campos: campos.length, historicoAntes: 0 };
    }
    if (nome === 'preco.reajustar') return this.reajustar(e, ctx);
    if (nome === 'preco.desfazerReajuste') return this.desfazer(e, ctx);
    throw erroNaoLiberada();
  }

  private reajustar(e: Record<string, unknown>, ctx: ContextoGravacaoPreco): ResultadoOperacao {
    const tab = Number(e['tabela']);
    const data = String(e['data']);
    const itens = e['itens'] as {
      codigo: number;
      base: { vigencia: string; valores: Componentes } | null;
      novos: Componentes;
    }[];
    if (data !== hojeIso()) throw recusa('data-fora-de-hoje', 'A vigência começa na data de hoje.');
    const alvos = itens.map((i) => ({ i, m: this.itens.find((x) => x.tab === tab && x.cod === i.codigo) }));
    if (alvos.some((x) => !x.m)) throw recusa('item-inexistente', 'Algum item não existe mais na tabela.');
    const m = (x: (typeof alvos)[number]) => x.m as ItemMemoria;
    if (alvos.some((x) => m(x).ch !== 0)) throw recusa('modelo-ch', 'Itens com CH ≠ 0 (modelo AMB).');
    if (alvos.some((x) => m(x).situacao !== 'A')) throw recusa('item-inativo', 'Itens inativos.');
    if (alvos.some((x) => m(x).vigencias.some((v) => v.data === data)))
      throw recusa('vigencia-existente', `Já existe vigência em ${data}.`);
    for (const x of alvos) {
      const atual = this.lido(m(x), hojeIso());
      const igual =
        (x.i.base === null && atual.vigencia === null) ||
        (x.i.base !== null &&
          atual.vigencia === x.i.base.vigencia &&
          atual.valores !== null &&
          mesmosComponentes(atual.valores, x.i.base.valores));
      if (!igual)
        throw recusa('proposta-desatualizada', 'O preço mudou depois da proposta. Refaça a proposta.');
      if (!componenteAceito(x.i.novos)) throw recusa('valor-invalido', 'Valores inválidos.');
    }
    const confirm = e['confirmacoes'] as { tabelaCompartilhada: boolean; percentualTabela: boolean };
    const ativos = this.convenios_.filter(
      (c) => c.situacao === 'A' && (c.honorariosExterna === tab || c.honorariosInternacao === tab),
    ).length;
    if ((tab === TABELA_COMPARTILHADA || ativos > 1) && !confirm.tabelaCompartilhada)
      throw recusa('confirmacao-pendente', `A tabela ${tab} é usada por mais de um convênio: confirme.`);
    if (TABELAS_COM_PERCENTUAL.includes(tab) && !confirm.percentualTabela)
      throw recusa('confirmacao-pendente', `A tabela ${tab} tem percentual de honorário no convênio: confirme.`);
    for (const x of alvos) {
      m(x).vigencias.push({ data, valores: { ...x.i.novos } });
      this.registrar({
        origem: String(e['origem']),
        lote: String(e['lote']),
        tab,
        cod: x.i.codigo,
        data,
        valores: { ...x.i.novos },
        autor: ctx.login,
        justificativa: String(e['justificativa']),
      });
    }
    return { tabela: tab, linhas: itens.length, parte: Number(e['parte']) };
  }

  private jaDesfeito(lote: string, tab: number, cod: number, data: string): boolean {
    return this.autoria.some(
      (a) => a.origem === 'desfazer' && a.lote === lote && a.tab === tab && a.cod === cod && a.data === data,
    );
  }

  /** As mesmas condições da receita, sem mudar nada (a parte e a pré-conferência). */
  private conferirDesfazer(e: Record<string, unknown>): void {
    const tab = Number(e['tabela']);
    const data = String(e['data']);
    const lote = String(e['lote']);
    const itens = e['itens'] as { codigo: number; valores: Componentes }[];
    for (const i of itens) {
      const m = this.itens.find((x) => x.tab === tab && x.cod === i.codigo);
      const v = m?.vigencias.find((x) => x.data === data);
      if (!v) throw recusa('vigencia-inexistente', 'A vigência do lote não existe mais.');
      if (!mesmosComponentes(v.valores, i.valores))
        throw recusa('alterado-por-fora', 'Vigência do lote alterada depois do reajuste.');
      if (
        !this.autoria.some((a) => a.lote === lote && a.tab === tab && a.cod === i.codigo && a.data === data)
      )
        throw recusa('fora-do-lote', 'Item que não foi gravado por este lote.');
    }
    if (itens.some((i) => this.jaDesfeito(lote, tab, i.codigo, data)))
      throw recusa('sem-efeito', 'Estes itens do lote já foram desfeitos.');
    if (itens.some((i) => this.usadosEmConta.has(`${tab}|${i.codigo}`)))
      throw recusa('vigencia-usada', 'Há lançamento de conta dos itens com data na vigência do lote.');
  }

  preConferirDesfazer(_c: CtxPrecos, partes: readonly DesfazerReajusteEntrada[]): Promise<void> {
    try {
      for (const p of partes) this.conferirDesfazer(p as unknown as Record<string, unknown>);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Para os testes: um lançamento do item na conta hospitalar, na vigência. */
  readonly usadosEmConta = new Set<string>();

  private desfazer(e: Record<string, unknown>, ctx: ContextoGravacaoPreco): ResultadoOperacao {
    const tab = Number(e['tabela']);
    const data = String(e['data']);
    const lote = String(e['lote']);
    const itens = e['itens'] as { codigo: number; valores: Componentes }[];
    this.conferirDesfazer(e);
    for (const i of itens) {
      const m = this.itens.find((x) => x.tab === tab && x.cod === i.codigo) as ItemMemoria;
      m.vigencias = m.vigencias.filter((v) => v.data !== data);
      this.registrar({
        origem: 'desfazer',
        lote,
        tab,
        cod: i.codigo,
        data,
        valores: { ...i.valores },
        autor: ctx.login,
        justificativa: String(e['justificativa']),
      });
    }
    return { tabela: tab, linhas: itens.length, parte: Number(e['parte']) };
  }

  /** Para os testes: muda por fora a vigência (colisão). */
  mexerPorFora(tab: number, cod: number, data: string): void {
    const v = this.itens.find((x) => x.tab === tab && x.cod === cod)?.vigencias.find((x) => x.data === data);
    if (v) v.valores = { ...v.valores, ch: v.valores.ch + 1 };
  }
}
