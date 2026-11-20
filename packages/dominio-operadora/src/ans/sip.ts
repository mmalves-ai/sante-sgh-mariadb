// SIP, o sistema de informações de produtos (M56, etapa 7, F6): os eventos e as despesas assistenciais do trimestre por
// grupo do SIP, pela segmentação do plano e pela UF de residência do beneficiário, com os beneficiários expostos (os
// ativos no último dia do trimestre, por segmentação). A fonte são os itens das contas médicas recebidas (F5) e não
// devolvidas, pela data da execução no trimestre (D-SIP-567: o "conhecido ou avisado" do SIP é aproximado pela
// execução; a ANS confere na validação). O procedimento da terminologia TUSS (tabela 22) vai ao grupo pela tabela de
// procedimentos do SIP vigente na data (TBSIPANSPROC do banco); o que não tem grupo vigente e as outras despesas
// (materiais, medicamentos, diárias, taxas) ficam em "demais despesas" (grupo 0), listadas à parte. A despesa é o valor
// liberado do item (apresentado menos a glosa), em emCentavos.
import {
  type ParcelaAns,
  type ProblemaAns,
  type QuadroAns,
  SEGMENTACOES_PRODUTO,
  type SegmentacaoProduto,
} from '@sgh/contratos';
import { documentoXml, el, problema, deCentavos, valorNoArquivo } from './comum.js';
import { type CabecalhoAns, cabecalhoXml } from './sib.js';

/** Grupo das despesas sem grupo de procedimento do SIP. */
export const GRUPO_DEMAIS_DESPESAS = 0;

export interface ItemSip {
  readonly beneficiario: number;
  readonly segmentacao: SegmentacaoProduto;
  /** UF do IBGE (2 dígitos) da residência; null: não informada. */
  readonly uf: string | null;
  readonly dataExecucao: string;
  readonly tabela: string;
  readonly codigo: string;
  readonly quantidade: number;
  /** Valor liberado (apresentado menos a glosa), em emCentavos. */
  readonly despesaCentavos: number;
}

export interface VigenciaSip {
  readonly procedimento: number;
  readonly grupo: number;
  readonly inicio: string;
  /** Null: sem fim. */
  readonly fim: string | null;
}

/** O grupo do SIP do procedimento na data (null: sem grupo vigente). */
export function grupoSipNaData(
  vigencias: readonly VigenciaSip[],
  procedimento: number,
  data: string,
): number | null {
  const v = vigencias.find(
    (x) => x.procedimento === procedimento && x.inicio <= data && (x.fim === null || x.fim >= data),
  );
  return v ? v.grupo : null;
}

export interface LinhaSip {
  readonly grupo: number;
  readonly segmentacao: SegmentacaoProduto;
  readonly uf: string;
  /** Itens (eventos) e a quantidade executada. */
  readonly eventos: number;
  readonly quantidade: number;
  /** Beneficiários distintos com evento. */
  readonly beneficiarios: number;
  readonly despesaCentavos: number;
}

export interface ResultadoSip {
  readonly linhas: readonly LinhaSip[];
  /** Expostos por segmentação (ativos no último dia do trimestre). */
  readonly expostos: Readonly<Partial<Record<SegmentacaoProduto, number>>>;
  readonly problemas: readonly ProblemaAns[];
  /** Procedimentos TUSS sem grupo vigente (código e eventos). */
  readonly naoClassificados: readonly { readonly codigo: string; readonly eventos: number }[];
}

export function agregarSip(
  itens: readonly ItemSip[],
  vigencias: readonly VigenciaSip[],
  expostos: Readonly<Partial<Record<SegmentacaoProduto, number>>>,
): ResultadoSip {
  const mapa = new Map<string, { l: Omit<LinhaSip, 'beneficiarios'>; b: Set<number> }>();
  const semGrupo = new Map<string, number>();
  for (const i of itens) {
    let grupo = GRUPO_DEMAIS_DESPESAS;
    if (i.tabela === '22' && /^\d{1,10}$/.test(i.codigo)) {
      const g = grupoSipNaData(vigencias, Number(i.codigo), i.dataExecucao);
      if (g === null) semGrupo.set(i.codigo, (semGrupo.get(i.codigo) ?? 0) + 1);
      else grupo = g;
    }
    const uf = i.uf ?? 'NI';
    const k = `${grupo}|${i.segmentacao}|${uf}`;
    const x = mapa.get(k) ?? {
      l: { grupo, segmentacao: i.segmentacao, uf, eventos: 0, quantidade: 0, despesaCentavos: 0 },
      b: new Set<number>(),
    };
    x.l = {
      ...x.l,
      eventos: x.l.eventos + 1,
      quantidade: Math.round((x.l.quantidade + i.quantidade) * 10_000) / 10_000,
      despesaCentavos: x.l.despesaCentavos + i.despesaCentavos,
    };
    x.b.add(i.beneficiario);
    mapa.set(k, x);
  }
  const linhas = [...mapa.values()]
    .map(({ l, b }) => ({ ...l, beneficiarios: b.size }))
    .sort(
      (a, b) => a.grupo - b.grupo || a.segmentacao.localeCompare(b.segmentacao) || a.uf.localeCompare(b.uf),
    );
  const naoClassificados = [...semGrupo.entries()]
    .map(([codigo, eventos]) => ({ codigo, eventos }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
  const problemas = naoClassificados.map((n) => problema('procedimento-sem-grupo', 'item', n.codigo));
  return { linhas, expostos, problemas, naoClassificados };
}

/** Os quadros do SIP: a despesa por grupo (com as parcelas) e os expostos por segmentação. */
export function quadrosSip(r: ResultadoSip, nomes: ReadonlyMap<number, string>): QuadroAns[] {
  const porGrupo = new Map<number, { eventos: number; emCentavos: number }>();
  for (const l of r.linhas) {
    const g = porGrupo.get(l.grupo) ?? { eventos: 0, emCentavos: 0 };
    porGrupo.set(l.grupo, { eventos: g.eventos + l.eventos, emCentavos: g.emCentavos + l.despesaCentavos });
  }
  const nome = (g: number) =>
    g === GRUPO_DEMAIS_DESPESAS ? 'Demais despesas' : (nomes.get(g) ?? `Grupo ${g}`);
  const parcelas: ParcelaAns[] = [...porGrupo.entries()].map(([g, x]) => ({
    rotulo: `${g} ${nome(g)}`,
    valor: deCentavos(x.emCentavos),
    quantidade: x.eventos,
  }));
  const soma = [...porGrupo.values()].reduce((a, x) => ({ e: a.e + x.eventos, c: a.c + x.emCentavos }), {
    e: 0,
    c: 0,
  });
  const expostos: ParcelaAns[] = (Object.keys(r.expostos) as SegmentacaoProduto[]).map((s) => ({
    rotulo: SEGMENTACOES_PRODUTO[s],
    valor: 0,
    quantidade: r.expostos[s] ?? 0,
  }));
  return [
    {
      titulo: 'Eventos e despesas por grupo',
      parcelas,
      total: { rotulo: 'Total', valor: deCentavos(soma.c), quantidade: soma.e },
    },
    {
      titulo: 'Beneficiários expostos por segmentação',
      parcelas: expostos,
      total: { rotulo: 'Total', valor: 0, quantidade: expostos.reduce((a, x) => a + (x.quantidade ?? 0), 0) },
    },
  ];
}

export function arquivoSip(cab: CabecalhoAns, r: ResultadoSip): string {
  return documentoXml(
    el('mensagemSIP', [
      cabecalhoXml(cab, r.linhas.length),
      el(
        'expostos',
        (Object.keys(r.expostos) as SegmentacaoProduto[]).map((s) =>
          el('segmentacao', el('quantidade', r.expostos[s] ?? 0), { codigo: s }),
        ),
      ),
      el(
        'eventos',
        r.linhas.map((l) =>
          el(
            'grupo',
            [
              el('eventos', l.eventos),
              el('quantidade', l.quantidade),
              el('beneficiarios', l.beneficiarios),
              el('despesa', valorNoArquivo(deCentavos(l.despesaCentavos))),
            ],
            { codigo: l.grupo, segmentacao: l.segmentacao, uf: l.uf },
          ),
        ),
      ),
    ]),
  );
}
