// Porta da integração da folha em memória (M53.9; dev/ci, testes e E2E): o catálogo de rotinas do produto, o de-para
// por vigência, o retorno conferido semeado pelos testes ou lido da folha em memória, o lançamento dos títulos pela ação
// `incluir-folha` de `financeiro.criarTituloPagar` (com as mesmas recusas: soma, folha repetida e a chave de
// idempotência) e o custo de pessoal somado dos fatos. Nada de dado pessoal.
import {
  type ApuracaoFolha,
  type CustoPessoalCentro,
  esquemaCriarTituloPagar,
  type IncluirTitulosFolhaEntrada,
  type IntegracaoFolhaLida,
  ROTINA_DO_DESTINO,
  type RotinaIntegracaoFolha,
} from '@sgh/contratos';
import { SUGESTAO_CLASSIFICACAO_FOLHA } from '@sgh/dominio-pessoas';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type {
  ContextoIntegracaoFolha,
  FiltroTitulosManuais,
  GravadorIntegracaoFolha,
  PortaIntegracaoFolha,
} from './porta-integracao.js';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import { type TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  type LancamentoTitulosFolha,
  ROTINAS_INTEGRACAO_FOLHA,
  type TituloFolhaLancado,
} from './apoio-folha.js';
import { type RetornoParaTitulos } from './tipos-folha.js';

/** A chave do estado em memória: o estabelecimento da sessão (a mesma que a folha em memória usa). */
export const chaveMemoria = (c: ContextoIntegracaoFolha): string => String(c.estabelecimento ?? 0);

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);

/** O catálogo de rotinas (o mesmo da porta própria). */
export const ROTINAS_SINTETICAS: readonly RotinaIntegracaoFolha[] = ROTINAS_INTEGRACAO_FOLHA;

interface TituloMemoria extends TituloFolhaLancado {
  readonly lancamento: number;
  readonly empresa: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
}

interface FatoMemoria {
  readonly lancamento: number;
  readonly empresa: number;
  readonly periodo: string;
  readonly centroCusto: number;
  readonly natureza: 'provento' | 'encargo';
  readonly valor: number;
}

interface Estado {
  seq: number;
  titulo: number;
  integracoes: (IntegracaoFolhaLida & { readonly empresaCod: number })[];
  lancamentos: LancamentoTitulosFolha[];
  titulos: TituloMemoria[];
  fatos: FatoMemoria[];
  retornos: Map<number, RetornoParaTitulos>;
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

const novo = (): Estado => ({
  seq: 5900,
  titulo: 81_000,
  integracoes: [],
  lancamentos: [],
  titulos: [],
  fatos: [],
  retornos: new Map(),
  idem: new Map(),
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

/** Credores sintéticos do de-para (o banco pagador, a previdência, o FGTS, a receita e o sindicato). */
export const CREDORES_SINTETICOS: readonly { codigo: number; nome: string }[] = [
  { codigo: 9001, nome: 'BANCO SINTETICO DA FOLHA' },
  { codigo: 9002, nome: 'PREVIDENCIA SINTETICA' },
  { codigo: 9003, nome: 'FUNDO DE GARANTIA SINTETICO' },
  { codigo: 9004, nome: 'RECEITA SINTETICA' },
  { codigo: 9005, nome: 'SINDICATO SINTETICO' },
];

/** As classificações sintéticas: as da sugestão do perfil (salários, encargos e impostos) e uma de outra natureza. */
export const CLASSIFICACOES_SINTETICAS: readonly {
  grupo: number;
  subgrupo: number;
  item: number;
  nome: string;
}[] = [
  ...new Map(
    Object.values(SUGESTAO_CLASSIFICACAO_FOLHA).map((c) => [
      `${c.grupo}.${c.subgrupo}.${c.item}`,
      { ...c, nome: `CLASSIFICACAO SINTETICA ${c.grupo}.${c.subgrupo}.${c.item}` },
    ]),
  ).values(),
  { grupo: 300, subgrupo: 1, item: 1, nome: 'MATERIAL SINTETICO' },
];

/** A interface com a folha externa em memória (o E2E lança pelo retorno que a F0 importou). */
export interface RetornosDaFolhaMemoria {
  retornoParaTitulos(estabelecimento: string, id: number): RetornoParaTitulos | null;
  marcarLancado(estabelecimento: string, id: number): void;
}

export class PortaIntegracaoFolhaMemoria implements PortaIntegracaoFolha {
  readonly destino = 'memoria' as const;

  constructor(private readonly folha: RetornosDaFolhaMemoria | null = null) {}
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético das gravações. */
  agoraFixo: string | null = null;
  /** Testes: quantos títulos "manuais" o contas a pagar tem por credor (o aviso da prévia). */
  readonly manuais = new Map<number, number>();

  private e(c: ContextoIntegracaoFolha): Estado {
    const chave = chaveMemoria(c);
    let s = this.estados.get(chave);
    if (!s) this.estados.set(chave, (s = novo()));
    return s;
  }
  private agora(): string {
    return this.agoraFixo ?? local(new Date());
  }

  /** Testes e E2E: um retorno da folha externa (o resumo gravado pela F0). */
  semearRetorno(c: ContextoIntegracaoFolha, r: RetornoParaTitulos): void {
    this.e(c).retornos.set(r.id, r);
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(
    c: ContextoIntegracaoFolha,
    op: string,
    bruto: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    const analise = op === 'financeiro.criarTituloPagar' ? esquemaCriarTituloPagar.safeParse(bruto) : null;
    if (!analise?.success || analise.data.acao !== 'incluir-folha')
      throw recusa('operacao-desconhecida', 'A integração da folha só lança os títulos da folha.');
    const e = analise.data as IncluirTitulosFolhaEntrada;
    const s = this.e(c);
    const hash = JSON.stringify(e);
    const chaveIdem = `${op}:${ctx.chaveIdempotencia}`;
    const anterior = s.idem.get(chaveIdem);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A chave já foi usada.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const total = e.titulos.reduce((a, t) => a + t.valor, 0);
    if (total !== e.liquido + e.encargos)
      throw recusa(
        'soma-divergente',
        'A soma dos títulos não fecha com o líquido mais os encargos da folha.',
      );
    const chaves = new Set(
      s.titulos
        .filter((t) => t.empresa === e.empresa && t.apuracao === e.apuracao && t.periodo === e.periodo)
        .map((t) => `${t.destino}:${t.vencimento}`),
    );
    if (
      s.lancamentos.some((l) => l.origem === e.origem && l.idOrigem === e.idOrigem) ||
      e.titulos.some((t) => chaves.has(`${t.destino}:${t.vencimento}`))
    )
      throw recusa('folha-repetida', 'A competência já tem os títulos da folha lançados no contas a pagar.');
    if (e.origem === 'interface') {
      const r =
        s.retornos.get(e.idOrigem) ?? this.folha?.retornoParaTitulos(chaveMemoria(c), e.idOrigem) ?? null;
      if (!r || r.situacao !== 'conferido')
        throw recusa(
          'registro-alterado',
          'O registro mudou agora há pouco (outra pessoa ou outra aba): releia.',
        );
      if (s.retornos.has(r.id)) s.retornos.set(r.id, { ...r, situacao: 'lancado' });
      else this.folha?.marcarLancado(chaveMemoria(c), r.id);
    }
    const id = ++s.seq;
    const ids = e.titulos.map(() => ++s.titulo);
    s.lancamentos.push({
      id,
      empresa: e.empresa,
      origem: e.origem,
      idOrigem: e.idOrigem,
      apuracao: e.apuracao,
      periodo: e.periodo,
      resumo: e.resumo,
      titulos: e.titulos.length,
      fatos: e.fatos.length,
      liquido: e.liquido,
      encargos: e.encargos,
      total,
      lancadoPor: ctx.usuario === null ? 'sistema' : String(ctx.usuario),
      lancadoEm: this.agora(),
    });
    for (const [i, t] of e.titulos.entries())
      s.titulos.push({
        lancamento: id,
        empresa: e.empresa,
        apuracao: e.apuracao,
        periodo: e.periodo,
        destino: t.destino,
        rotina: ROTINA_DO_DESTINO[t.destino],
        titulo: ids[i]!,
        credor: t.credor,
        documento: t.documento,
        vencimento: t.vencimento,
        valor: t.valor,
        pago: false,
      });
    for (const f of e.fatos)
      s.fatos.push({
        lancamento: id,
        empresa: e.empresa,
        periodo: e.periodo,
        centroCusto: f.centroCusto,
        natureza: f.natureza,
        valor: f.valor,
      });
    const resultado = {
      titulo: ids[0] ?? 0,
      parcelas: ids.length,
      documento: e.titulos[0]?.documento ?? 0,
      credor: e.titulos[0]?.credor ?? 0,
      tipo: 'F',
      serie: '',
      acao: 'incluir-folha',
      ids: ids.join(','),
    };
    s.idem.set(chaveIdem, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  async gravarSgh<T>(
    c: ContextoIntegracaoFolha,
    _trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorIntegracaoFolha) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const copia = [...s.integracoes];
    const g: GravadorIntegracaoFolha = {
      integracoes: async (empresa) => this.lerIntegracoes(copia, empresa),
      incluirIntegracao: async (x) => {
        if (copia.some((v) => v.empresaCod === x.empresa && v.inicio === x.inicio))
          throw recusa(
            'vigencia-repetida',
            'Já existe um de-para com este início para a empresa: escolha outra data.',
          );
        const id = ++s.seq;
        copia.push({
          id,
          empresa: x.empresa,
          empresaCod: x.empresa,
          inicio: x.inicio,
          destinos: x.destinos.map((d) => ({ ...d, rotina: ROTINA_DO_DESTINO[d.destino] })),
          criadoPor: x.por,
          criadoEm: this.agora(),
        });
        return id;
      },
    };
    const r = await fn(g);
    s.integracoes = copia;
    return r;
  }

  private lerIntegracoes(vs: Estado['integracoes'], empresa: number): IntegracaoFolhaLida[] {
    return vs
      .filter((v) => v.empresaCod === empresa)
      .sort((a, b) => b.inicio.localeCompare(a.inicio))
      .map((v) => ({
        id: v.id,
        empresa: v.empresa,
        inicio: v.inicio,
        destinos: v.destinos,
        criadoPor: v.criadoPor,
        criadoEm: v.criadoEm,
      }));
  }

  async rotinas() {
    return [...ROTINAS_SINTETICAS];
  }
  async integracoes(c: ContextoIntegracaoFolha, empresa: number) {
    return this.lerIntegracoes(this.e(c).integracoes, empresa);
  }
  async retorno(c: ContextoIntegracaoFolha, id: number) {
    return this.e(c).retornos.get(id) ?? this.folha?.retornoParaTitulos(chaveMemoria(c), id) ?? null;
  }
  async lancamentos(c: ContextoIntegracaoFolha, empresa: number, ano: number) {
    return this.e(c)
      .lancamentos.filter((l) => l.empresa === empresa && l.periodo.startsWith(String(ano)))
      .sort((a, b) => b.id - a.id);
  }
  async lancamento(c: ContextoIntegracaoFolha, id: number) {
    return this.e(c).lancamentos.find((l) => l.id === id) ?? null;
  }
  async lancamentoDaOrigem(c: ContextoIntegracaoFolha, origem: 'fechamento' | 'interface', id: number) {
    return this.e(c).lancamentos.find((l) => l.origem === origem && l.idOrigem === id) ?? null;
  }
  async titulosDoLancamento(c: ContextoIntegracaoFolha, lancamento: number): Promise<TituloFolhaLancado[]> {
    return this.e(c)
      .titulos.filter((t) => t.lancamento === lancamento)
      .map((t) => ({
        destino: t.destino,
        rotina: t.rotina,
        titulo: t.titulo,
        credor: t.credor,
        documento: t.documento,
        vencimento: t.vencimento,
        valor: t.valor,
        pago: t.pago,
      }));
  }
  async chavesLancadas(
    c: ContextoIntegracaoFolha,
    empresa: number,
    apuracao: ApuracaoFolha,
    periodo: string,
  ) {
    return this.e(c)
      .titulos.filter((t) => t.empresa === empresa && t.apuracao === apuracao && t.periodo === periodo)
      .map((t) => `${t.destino}:${t.vencimento}`);
  }
  async custoPessoal(c: ContextoIntegracaoFolha, empresa: number, periodo: string) {
    const s = this.e(c);
    const fs = s.fatos.filter((f) => f.empresa === empresa && f.periodo === periodo);
    const acc = new Map<number, { proventos: number; encargos: number }>();
    for (const f of fs) {
      const a = acc.get(f.centroCusto) ?? { proventos: 0, encargos: 0 };
      if (f.natureza === 'provento') a.proventos += f.valor;
      else a.encargos += f.valor;
      acc.set(f.centroCusto, a);
    }
    const centros: CustoPessoalCentro[] = [...acc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([centroCusto, a]) => ({ centroCusto, ...a, total: a.proventos + a.encargos }));
    const lancamentos = s.lancamentos.filter((l) => l.empresa === empresa && l.periodo === periodo).length;
    return { centros, lancamentos };
  }
  async titulosManuais(_c: ContextoIntegracaoFolha, f: FiltroTitulosManuais) {
    return this.manuais.get(f.credor) ?? 0;
  }
  async classificacoes() {
    return [...CLASSIFICACOES_SINTETICAS];
  }
  async credores(_c: ContextoIntegracaoFolha, f: { termo?: string; codigos?: readonly number[] }) {
    const termo = (f.termo ?? '').trim().toUpperCase();
    return CREDORES_SINTETICOS.filter((x) =>
      f.codigos?.length
        ? f.codigos.includes(x.codigo)
        : termo.length >= 2 && (String(x.codigo) === termo || x.nome.includes(termo)),
    );
  }
}
