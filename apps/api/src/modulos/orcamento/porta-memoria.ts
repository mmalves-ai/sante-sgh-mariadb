// Porta do orçamento empresarial em memória (M54, etapa 7): a sessão sintética de dev/ci (E2E) e os testes da API.
// Centros de custo, itens gerenciais e realizado SINTÉTICOS (determinísticos: o ano anterior a 2026 inteiro, 2026 até
// setembro, nada depois); as gravações seguem as mesmas regras do legado (versão lida, só o rascunho muda, a aprovação
// substitui a vigente do ano, nada se apaga além da linha do rascunho). Nenhum dado real.
import type {
  CentroOrcamento,
  ItemGerencialOrcamento,
  LinhaOrcamento,
  NaturezaOrcamento,
  OrcamentoVersao,
  ParametrosOrcamentoLidos,
} from '@sgh/contratos';
import type {
  GravacaoLinhasOrcamento,
  LinhaOrcamentoParaGravar,
  RealizadoAgregadoLido,
  RealizadoAnoLido,
  VersaoOrcamentoParaCriar,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ApoioOrcamentoLido, ContextoOrcamento, PortaOrcamento } from './porta.js';

const CENTROS: readonly CentroOrcamento[] = [
  { id: 101, codigo: 300100, nome: 'UTI ADULTO SINTETICA', ativo: true },
  { id: 102, codigo: 300310, nome: 'CENTRO CIRURGICO SINTETICO', ativo: true },
  { id: 103, codigo: 300500, nome: 'LABORATORIO SINTETICO', ativo: true },
  { id: 104, codigo: 200130, nome: 'LAVANDERIA SINTETICA', ativo: true },
  { id: 106, codigo: 100124, nome: 'ADMINISTRACAO SINTETICA', ativo: true },
  { id: 107, codigo: 100999, nome: 'SETOR DESATIVADO SINTETICO', ativo: false },
];

const ITENS: readonly ItemGerencialOrcamento[] = [
  {
    grupo: 100,
    subgrupo: 1,
    item: 1,
    nome: 'PARTICULAR SINTETICO',
    grupoNome: 'RECEITAS PARTICULAR',
    natureza: 'receita',
    ativo: true,
  },
  {
    grupo: 110,
    subgrupo: 1,
    item: 1,
    nome: 'CONVENIOS SINTETICOS',
    grupoNome: 'RECEITA CONVENIO',
    natureza: 'receita',
    ativo: true,
  },
  {
    grupo: 210,
    subgrupo: 1,
    item: 1,
    nome: 'SALARIOS SINTETICOS',
    grupoNome: 'PESSOAL',
    natureza: 'despesa',
    ativo: true,
  },
  {
    grupo: 230,
    subgrupo: 1,
    item: 1,
    nome: 'MATERIAL DE CONSUMO SINTETICO',
    grupoNome: 'MATERIAIS',
    natureza: 'despesa',
    ativo: true,
  },
  {
    grupo: 240,
    subgrupo: 2,
    item: 1,
    nome: 'ENERGIA ELETRICA SINTETICA',
    grupoNome: 'UTILIDADES',
    natureza: 'despesa',
    ativo: true,
  },
  {
    grupo: 240,
    subgrupo: 2,
    item: 9,
    nome: 'ITEM INATIVO SINTETICO',
    grupoNome: 'UTILIDADES',
    natureza: 'despesa',
    ativo: false,
  },
];

const PARAMETROS: ParametrosOrcamentoLidos = {
  anoInicial: 2004,
  mesInicial: 1,
  digitaCentro: true,
  regime: null,
};

/** Até que mês o ano tem realizado sintético (2026: setembro; antes: o ano inteiro; depois: nenhum). */
const mesesComRealizado = (ano: number): number => (ano < 2026 ? 12 : ano === 2026 ? 9 : 0);

/** O realizado sintético de um ano (determinístico; centavos). */
export function realizadoSintetico(ano: number): RealizadoAnoLido {
  const ate = mesesComRealizado(ano);
  const agregado: RealizadoAgregadoLido[] = [];
  const rateados: RealizadoAnoLido['rateados'][number][] = [];
  const fator = ano - 2020;
  for (let mes = 1; mes <= ate; mes++) {
    const base = { mes, codigoCentro: null };
    agregado.push(
      {
        ...base,
        natureza: 'receita',
        grupo: 100,
        subgrupo: 1,
        item: 1,
        centavos: 2_500_000 + mes * 5_000 + fator * 10_000,
      },
      { ...base, natureza: 'receita', grupo: 110, subgrupo: 1, item: 1, centavos: 6_000_000 + mes * 7_000 },
      { ...base, natureza: 'despesa', grupo: 210, subgrupo: 1, item: 1, centavos: 4_000_000 + mes * 10_000 },
      {
        ...base,
        natureza: 'despesa',
        grupo: 240,
        subgrupo: 2,
        item: 1,
        centavos: 350_000 + (mes % 3) * 25_000,
      },
      {
        mes,
        codigoCentro: 300100,
        natureza: 'consumo',
        grupo: 0,
        subgrupo: 0,
        item: 0,
        centavos: 800_000 + mes * 1_000,
      },
      { mes, codigoCentro: 200130, natureza: 'consumo', grupo: 0, subgrupo: 0, item: 0, centavos: 120_000 },
    );
    rateados.push({
      documento: `sintetico-${ano}-${mes}`,
      grupo: 230,
      subgrupo: 1,
      item: 1,
      mes,
      centavos: 300_001,
      centros: [
        { codigoCentro: 300100, percentual: 60 },
        { codigoCentro: 300310, percentual: 40 },
      ],
    });
  }
  return {
    agregado,
    rateados,
    ultimoMovimento: ate === 0 ? null : `${ano}-${String(ate).padStart(2, '0')}-${ate === 9 ? '30' : '31'}`,
    ultimoMesConsumo: ate === 0 ? null : ate,
  };
}

interface VersaoMemoria {
  hospital: string;
  cab: Omit<OrcamentoVersao, 'linhas' | 'totalCentavos' | 'totaisPorNatureza'>;
  linhas: Map<string, LinhaOrcamento>;
}

const chave = (l: Omit<LinhaOrcamentoParaGravar, 'meses' | 'observacao'>) =>
  `${l.natureza}|${l.centro}|${l.grupo}|${l.subgrupo}|${l.item}`;

const desatualizado = () =>
  new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    'O orçamento mudou depois que você abriu (outra pessoa gravou, aprovou ou descartou). Abra de novo para ver a versão atual.',
    { codigo: 'desatualizado' },
  );

const paraLinha = (l: LinhaOrcamentoParaGravar): LinhaOrcamento => ({
  centro: l.centro,
  natureza: l.natureza,
  grupo: l.grupo,
  subgrupo: l.subgrupo,
  item: l.item,
  meses: [...l.meses],
  totalCentavos: l.meses.reduce((s, v) => s + v, 0),
  observacao: l.observacao,
});

export class PortaOrcamentoMemoria implements PortaOrcamento {
  readonly destino = 'memoria' as const;
  private readonly versoesGravadas = new Map<number, VersaoMemoria>();
  private proximoId = 1;

  private agora(): string {
    return new Date().toISOString();
  }

  private publica(v: VersaoMemoria): OrcamentoVersao {
    const porNatureza: Record<NaturezaOrcamento, number> = { despesa: 0, receita: 0, consumo: 0 };
    for (const l of v.linhas.values()) porNatureza[l.natureza] += l.totalCentavos;
    return {
      ...v.cab,
      linhas: v.linhas.size,
      totalCentavos: porNatureza.despesa + porNatureza.receita + porNatureza.consumo,
      totaisPorNatureza: porNatureza,
    };
  }

  private daSessao(c: ContextoOrcamento, id: number): VersaoMemoria | null {
    const v = this.versoesGravadas.get(id);
    return v && v.hospital === c.hospital ? v : null;
  }

  async apoio(): Promise<ApoioOrcamentoLido> {
    return { centros: [...CENTROS], itens: [...ITENS], empresas: [1], parametros: PARAMETROS };
  }

  async versoes(c: ContextoOrcamento, ano: number | null): Promise<OrcamentoVersao[]> {
    return [...this.versoesGravadas.values()]
      .filter((v) => v.hospital === c.hospital && (ano === null || v.cab.ano === ano))
      .sort((a, b) => b.cab.ano - a.cab.ano || a.cab.empresa - b.cab.empresa || b.cab.numero - a.cab.numero)
      .map((v) => this.publica(v));
  }

  async versao(c: ContextoOrcamento, id: number): Promise<OrcamentoVersao | null> {
    const v = this.daSessao(c, id);
    return v ? this.publica(v) : null;
  }

  async linhas(c: ContextoOrcamento, id: number): Promise<LinhaOrcamento[]> {
    const v = this.daSessao(c, id);
    return v ? [...v.linhas.values()].map((l) => ({ ...l, meses: [...l.meses] })) : [];
  }

  async realizado(_c: ContextoOrcamento, _empresa: number, ano: number): Promise<RealizadoAnoLido> {
    return realizadoSintetico(ano);
  }

  async criar(
    c: ContextoOrcamento,
    x: VersaoOrcamentoParaCriar,
    por: string,
  ): Promise<{ id: number; numero: number; linhas: number }> {
    const numero =
      Math.max(
        0,
        ...[...this.versoesGravadas.values()]
          .filter((v) => v.hospital === c.hospital && v.cab.empresa === x.empresa && v.cab.ano === x.ano)
          .map((v) => v.cab.numero),
      ) + 1;
    const id = this.proximoId++;
    const agora = this.agora();
    this.versoesGravadas.set(id, {
      hospital: c.hospital,
      cab: {
        id,
        empresa: x.empresa,
        ano: x.ano,
        numero,
        descricao: x.descricao,
        situacao: 'rascunho',
        base: x.base,
        versao: 0,
        criadoPor: por,
        criadoEm: agora,
        alteradoPor: por,
        alteradoEm: agora,
        aprovadoPor: null,
        aprovadoEm: null,
        observacaoAprovacao: null,
        descartadoPor: null,
        motivoDescarte: null,
      },
      linhas: new Map(x.linhas.map((l) => [chave(l), paraLinha(l)])),
    });
    return { id, numero, linhas: x.linhas.length };
  }

  async gravarLinhas(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    g: GravacaoLinhasOrcamento,
    por: string,
  ): Promise<{ versao: number }> {
    const v = this.daSessao(c, id);
    if (!v || v.cab.situacao !== 'rascunho' || v.cab.versao !== versao) throw desatualizado();
    const linhas = new Map(v.linhas);
    for (const l of g.remover) if (!linhas.delete(chave(l))) throw desatualizado();
    for (const l of g.alterar) {
      if (!linhas.has(chave(l))) throw desatualizado();
      linhas.set(chave(l), paraLinha(l));
    }
    for (const l of g.incluir) {
      if (linhas.has(chave(l))) throw desatualizado();
      linhas.set(chave(l), paraLinha(l));
    }
    v.linhas = linhas;
    v.cab = { ...v.cab, versao: versao + 1, alteradoPor: por, alteradoEm: this.agora() };
    return { versao: versao + 1 };
  }

  async aprovar(
    c: ContextoOrcamento,
    x: { readonly id: number; readonly versao: number; readonly empresa: number; readonly ano: number },
    observacao: string | null,
    por: string,
  ): Promise<{ substituida: number | null }> {
    const v = this.daSessao(c, x.id);
    if (!v || v.cab.situacao !== 'rascunho' || v.cab.versao !== x.versao) throw desatualizado();
    const anterior = [...this.versoesGravadas.values()].find(
      (o) =>
        o.hospital === c.hospital &&
        o.cab.empresa === x.empresa &&
        o.cab.ano === x.ano &&
        o.cab.situacao === 'aprovado' &&
        o.cab.id !== x.id,
    );
    if (anterior) anterior.cab = { ...anterior.cab, situacao: 'substituido' };
    v.cab = {
      ...v.cab,
      situacao: 'aprovado',
      aprovadoPor: por,
      aprovadoEm: this.agora(),
      observacaoAprovacao: observacao,
      versao: v.cab.versao + 1,
    };
    return { substituida: anterior?.cab.id ?? null };
  }

  async descartar(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    motivo: string,
    por: string,
  ): Promise<void> {
    const v = this.daSessao(c, id);
    if (!v || v.cab.situacao !== 'rascunho' || v.cab.versao !== versao) throw desatualizado();
    v.cab = {
      ...v.cab,
      situacao: 'descartado',
      descartadoPor: por,
      motivoDescarte: motivo,
      versao: versao + 1,
    };
  }
}
