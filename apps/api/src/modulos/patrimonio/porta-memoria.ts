// Porta do patrimônio em memória (M54, etapa 6): a sessão sintética de dev/ci (E2E) e os testes da API. Domínios,
// centros de custo, empresas e notas fiscais de entrada SINTÉTICOS, por estabelecimento; as gravações seguem as mesmas
// regras da porta própria (item da nota relido, plaqueta única, versão do bem e do pedido, cálculo único por competência, cota
// imutável, inventário encerrado sem leitura). Nenhum dado real.
import type {
  AjusteDoBem,
  AlteracaoDoBem,
  BemEsperado,
  BemRegistrado,
  BemDaCompetencia,
  BemNovo,
  CadastroDeBens,
  CalculoRegistrado,
  EstornoDeCalculo,
  CotaRegistrada,
  CotaNova,
  DominiosPatrimonio,
  FiltroBens,
  GrupoDoBem,
  GrupoBemNovo,
  InventarioRegistrado,
  LaudoDoBem,
  ItemDaNota,
  LeituraRegistrada,
  LeituraNova,
  MovimentoRegistrado,
  MovimentoNovo,
  NotaDeEntrada,
} from './tipos.js';
import { GRUPOS_BEM, type VersaoGrupoBem } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPatrimonio, PortaPatrimonio } from './porta.js';

const DOMINIOS: DominiosPatrimonio = {
  origens: [
    { id: 1, nome: 'Próprio', depreciar: true },
    { id: 2, nome: 'Doação', depreciar: true },
    { id: 3, nome: 'Terceiros', depreciar: false },
    { id: 4, nome: 'Programa estadual', depreciar: true },
    { id: 5, nome: 'Convênio', depreciar: true },
  ],
  tiposResponsavel: [
    { id: 1, nome: 'Funcionário' },
    { id: 2, nome: 'Médico' },
    { id: 3, nome: 'Cooperativa' },
    { id: 4, nome: 'Colaborador' },
  ],
  motivosBaixa: [
    { id: 1, descricao: 'Obsolescência', tipo: 'obsolescencia', exigeLaudo: true },
    { id: 2, descricao: 'Venda', tipo: 'venda', exigeLaudo: false },
    { id: 3, descricao: 'Doação', tipo: 'doacao', exigeLaudo: false },
    { id: 4, descricao: 'Furto ou perda', tipo: 'perda', exigeLaudo: false },
  ],
  coeficientes: [
    { id: 1, descricao: '1 turno de 8 horas', percentual: 1 },
    { id: 2, descricao: '2 turnos de 8 horas', percentual: 1.5 },
    { id: 3, descricao: '3 turnos de 8 horas', percentual: 2 },
  ],
  centros: [
    { id: 101, codigo: 300100, nome: 'UTI ADULTO SINTETICA', ativo: true },
    { id: 102, codigo: 300310, nome: 'CENTRO CIRURGICO SINTETICO', ativo: true },
    { id: 103, codigo: 300500, nome: 'LABORATORIO SINTETICO', ativo: true },
    { id: 104, codigo: 200130, nome: 'ALMOXARIFADO SINTETICO', ativo: true },
    { id: 109, codigo: 999900, nome: 'SETOR DESATIVADO SINTETICO', ativo: false },
  ],
  empresas: [{ id: 1, nome: 'HOSPITAL SINTETICO' }],
  parametros: [{ empresa: 1, depreciar: true, aplicarCoeficiente: true, considerarResidual: true }],
};

const NOTAS: readonly NotaDeEntrada[] = [
  {
    id: 9001,
    ano: 2026,
    mes: 3,
    doc: 1,
    numero: '000123',
    serie: '1',
    data: '2026-03-10',
    fornecedor: 'FORNECEDOR SINTETICO DE EQUIPAMENTOS',
    empresa: 1,
    totalCent: 25_300_00,
    itens: 2,
  },
  {
    id: 9002,
    ano: 2026,
    mes: 9,
    doc: 2,
    numero: '000456',
    serie: '1',
    data: '2026-09-15',
    fornecedor: 'FORNECEDOR SINTETICO DE INFORMATICA',
    empresa: 1,
    totalCent: 10_000_00,
    itens: 1,
  },
];

const ITENS: readonly Omit<ItemDaNota, 'jaCadastrados'>[] = [
  {
    id: 90011,
    nota: 9001,
    seq: 1,
    item: 7001,
    nome: 'MONITOR MULTIPARAMETRICO SINTETICO',
    quantidade: 2,
    valorTotalCent: 24_000_00,
  },
  {
    id: 90012,
    nota: 9001,
    seq: 2,
    item: 7002,
    nome: 'CADEIRA DE RODAS SINTETICA',
    quantidade: 1,
    valorTotalCent: 1_300_00,
  },
  {
    id: 90021,
    nota: 9002,
    seq: 1,
    item: 7003,
    nome: 'NOTEBOOK SINTETICO',
    quantidade: 3,
    valorTotalCent: 10_000_00,
  },
];

interface BemMem extends BemNovo {
  readonly id: number;
  readonly plaquetaFinal: string;
  situacao: 'ativo' | 'emprestado' | 'baixado';
  baixadoEm: string | null;
  centroAtual: number;
  responsavelAtual: string | null;
  campos: Omit<AlteracaoDoBem, 'id' | 'versao'>;
  versao: number;
  criadoPor: string;
  criadoEm: string;
  alteradoPor: string;
  alteradoEm: string;
}

interface MovMem {
  readonly id: number;
  readonly x: MovimentoNovo;
  situacao: string;
  decididoPor: string | null;
  decididoEm: string | null;
  decisaoMotivo: string | null;
  versao: number;
  readonly solicitadoPor: string;
  readonly solicitadoEm: string;
}

interface CotaMem extends CotaNova {
  readonly calculo: number;
  readonly empresa: number;
  readonly competencia: string;
}

interface InvMem {
  readonly id: number;
  readonly descricao: string;
  readonly centro: number | null;
  situacao: 'aberto' | 'encerrado' | 'cancelado';
  esperados: number | null;
  resumo: string | null;
  readonly abertoPor: string;
  readonly abertoEm: string;
  encerradoPor: string | null;
  encerradoEm: string | null;
  canceladoPor?: string;
  canceladoEm?: string;
  motivoCancelamento?: string;
}

const naoAberto = (i: { situacao: string }) =>
  i.situacao === 'cancelado'
    ? recusa('inventario-cancelado', 'Inventário cancelado', 'O inventário foi cancelado.')
    : recusa('inventario-encerrado', 'Inventário encerrado', 'O inventário já foi encerrado.');

interface LeituraMem extends LeituraNova {
  readonly id: number;
  readonly lidoPor: string;
  readonly lidoEm: string;
}

interface Estado {
  bens: BemMem[];
  movs: MovMem[];
  calculos: CalculoRegistrado[];
  cotas: CotaMem[];
  /** W0-08 (1103): os estornos de cálculo (o cálculo e as cotas ficam, sem valer). */
  estornos: EstornoDeCalculo[];
  /** W0-08 (M1, 1105): os ajustes de valor do bem (o estorno é um fato novo dentro dele). */
  ajustes: AjusteDoBem[];
  /** Achado 6 (1109): os laudos anexados aos bens (o PDF fica no armazenamento em memória). */
  laudos: LaudoDoBem[];
  invs: InvMem[];
  leituras: LeituraMem[];
  plaqueta: number;
  id: number;
  /** W0-08: o cadastro do grupo do bem (null: nada gravado, vale a semente) e as versões anteriores. */
  grupos: GrupoMem[] | null;
  versoesGrupo: (VersaoGrupoBem & { readonly grupo: number })[];
}

type GrupoMem = Omit<GrupoDoBem, 'bens' | 'id'> & { id: number | null };

const sementeMem = (): GrupoMem[] =>
  Object.entries(GRUPOS_BEM).map(([codigo, g]) => ({
    id: null,
    codigo,
    nome: g.rotulo,
    vidaUtilMeses: g.vidaUtilMeses,
    conta: null,
    ativo: true,
    semente: true,
    inativadoEm: null,
    motivoInativacao: null,
    versao: 0,
  }));

const recusa = (codigo: string, titulo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, { codigo });
const desatualizado = (o = 'O bem') =>
  recusa('desatualizado', 'Registro desatualizado', `${o} mudou depois que você abriu. Abra de novo.`);

export class PortaPatrimonioMemoria implements PortaPatrimonio {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Relógio dos carimbos (os testes fixam). */
  agora: () => string = () => new Date().toISOString().slice(0, 23);

  private est(c: ContextoPatrimonio): Estado {
    let e = this.estados.get(c.hospital);
    if (!e) {
      e = {
        bens: [],
        movs: [],
        calculos: [],
        cotas: [],
        estornos: [],
        ajustes: [],
        laudos: [],
        invs: [],
        leituras: [],
        plaqueta: 0,
        id: 0,
        grupos: null,
        versoesGrupo: [],
      };
      this.estados.set(c.hospital, e);
    }
    return e;
  }

  private centro(id: number) {
    const c = DOMINIOS.centros.find((x) => x.id === id);
    return { id, codigo: c?.codigo ?? null, nome: c?.nome ?? '' };
  }

  /** Lotes contábeis exportados (empresa e período AAAA-MM ou AAAA): os testes da API marcam para provar a recusa. */
  readonly lotesExportados: { empresa: number; periodo: string; exportadoEm: string }[] = [];

  /** W0-08 (M1): há regra contábil vigente do impairment (os testes desligam para provar a recusa `sem-conta`). */
  contasImpairmentConfiguradas = true;

  /** O marco vigente do bem (o ajuste de revisão ou impairment mais novo não estornado), antes da competência. */
  private marcoDe(e: Estado, bem: number, antesDe?: string) {
    const a = e.ajustes
      .filter(
        (x) =>
          x.bem === bem &&
          x.tipo !== 'reavaliacao' &&
          !x.estorno &&
          (antesDe === undefined || x.competenciaMarco < antesDe),
      )
      .sort((x, y) => y.id - x.id)[0];
    return a
      ? {
          ajuste: a.id,
          competencia: a.competenciaMarco,
          acumuladaCent: a.acumuladaMarcoCent,
          baseCent: a.valorContabilDepoisCent,
          residualCent: a.residualCent,
          vidaRestanteMeses: a.vidaRestanteMeses,
        }
      : null;
  }

  private lotesDe(empresa: number, data: string) {
    const comp = data.slice(0, 7);
    return this.lotesExportados
      .filter((l) => l.empresa === empresa && (l.periodo === comp || l.periodo === comp.slice(0, 4)))
      .map((l) => ({ periodo: l.periodo }));
  }

  /** As cotas que valem: as dos cálculos não estornados. */
  private cotasVigentes(e: Estado): CotaMem[] {
    const estornados = new Set(e.estornos.map((x) => x.calculo));
    return e.cotas.filter((k) => !estornados.has(k.calculo));
  }

  private vistaBem(e: Estado, b: BemMem): BemRegistrado {
    const nota = b.nota === null ? null : NOTAS.find((n) => n.id === b.nota);
    const item = b.itemNota === null ? null : ITENS.find((i) => i.id === b.itemNota);
    const coef = DOMINIOS.coeficientes.find((k) => k.id === b.campos.coeficiente) ?? null;
    const tipo = DOMINIOS.tiposResponsavel.find((t) => t.id === b.campos.tipoResponsavel) ?? null;
    const cotas = this.cotasVigentes(e).filter((k) => k.bem === b.id);
    const pend = e.movs.find((m) => m.x.bem === b.id && m.situacao === 'pendente');
    return {
      id: b.id,
      plaqueta: b.plaquetaFinal,
      descricao: b.campos.descricao,
      grupo: b.campos.grupo,
      origem: { id: b.origem, nome: DOMINIOS.origens.find((o) => o.id === b.origem)?.nome ?? '' },
      documento: b.documento,
      nota:
        b.documento === 'nota'
          ? {
              id: b.nota ?? 0,
              idItem: b.itemNota ?? 0,
              numero: nota?.numero ?? null,
              serie: nota?.serie ?? null,
              data: nota?.data ?? null,
              fornecedor: nota?.fornecedor ?? null,
              item: item?.item ?? null,
              itemNome: item?.nome ?? null,
            }
          : null,
      termo: b.termo,
      empresa: b.empresa,
      dataAquisicao: b.dataAquisicao,
      valorCent: b.valorCent,
      residualCent: b.campos.residualCent,
      vidaUtilMeses: b.campos.vidaUtilMeses,
      coeficiente: coef,
      inicioDepreciacao: b.campos.inicioDepreciacao,
      depreciavel: b.campos.depreciavel,
      centro: this.centro(b.centroAtual),
      localDetalhe: b.campos.localDetalhe,
      tipoResponsavel: tipo,
      responsavel: b.responsavelAtual,
      marca: b.campos.marca,
      modelo: b.campos.modelo,
      numeroSerie: b.campos.numeroSerie,
      situacao: b.situacao,
      baixadoEm: b.baixadoEm,
      acumuladaCent: cotas.reduce((s, k) => s + k.valorCent, 0),
      cotas: cotas.length,
      ultimaCompetencia:
        cotas
          .map((k) => k.competencia)
          .sort()
          .at(-1) ?? null,
      movimentoPendente: pend ? { id: pend.id, tipo: pend.x.tipo } : null,
      versao: b.versao,
      criadoPor: b.criadoPor,
      criadoEm: b.criadoEm,
      alteradoPor: b.alteradoPor,
      alteradoEm: b.alteradoEm,
    };
  }

  private vistaMov(e: Estado, m: MovMem): MovimentoRegistrado {
    const b = e.bens.find((x) => x.id === m.x.bem);
    return {
      id: m.id,
      bem: { id: m.x.bem, plaqueta: b?.plaquetaFinal ?? '', descricao: b?.campos.descricao ?? '' },
      tipo: m.x.tipo,
      situacao: m.situacao,
      data: m.x.data,
      origem: this.centro(m.x.origem),
      destino: m.x.destino === null ? null : this.centro(m.x.destino),
      destinoResponsavel: m.x.destinoResponsavel,
      terceiro: m.x.terceiro,
      retornoPrevisto: m.x.retornoPrevisto,
      termoNumero: m.x.termoNumero,
      motivo: m.x.motivo,
      valorVendaCent: m.x.valorVendaCent,
      referencia: m.x.referencia,
      solicitadoPor: m.solicitadoPor,
      solicitadoEm: m.solicitadoEm,
      decididoPor: m.decididoPor,
      decididoEm: m.decididoEm,
      decisaoMotivo: m.decisaoMotivo,
      versao: m.versao,
    };
  }

  private vistaInv(i: InvMem): InventarioRegistrado {
    return {
      id: i.id,
      descricao: i.descricao,
      centro: i.centro === null ? null : this.centro(i.centro),
      situacao: i.situacao,
      esperados: i.esperados,
      resumo: i.resumo,
      abertoPor: i.abertoPor,
      abertoEm: i.abertoEm,
      encerradoPor: i.encerradoPor,
      encerradoEm: i.encerradoEm,
      canceladoPor: i.canceladoPor ?? null,
      canceladoEm: i.canceladoEm ?? null,
      motivoCancelamento: i.motivoCancelamento ?? null,
    };
  }

  private item(e: Estado, id: number): ItemDaNota | null {
    const i = ITENS.find((x) => x.id === id);
    return i ? { ...i, jaCadastrados: e.bens.filter((b) => b.itemNota === id).length } : null;
  }

  async dominios(): Promise<DominiosPatrimonio> {
    return DOMINIOS;
  }

  async bens(c: ContextoPatrimonio, f: FiltroBens) {
    const e = this.est(c);
    const busca = f.busca?.trim();
    const todos = e.bens
      .map((b) => this.vistaBem(e, b))
      .filter(
        (b) =>
          (f.centro === undefined || b.centro.id === f.centro) &&
          (f.situacao === undefined || b.situacao === f.situacao) &&
          (f.grupo === undefined || b.grupo === f.grupo) &&
          (!busca ||
            b.plaqueta.startsWith(busca.toUpperCase()) ||
            b.descricao.toUpperCase().includes(busca.toUpperCase()) ||
            b.numeroSerie === busca),
      )
      .sort((a, b) => a.plaqueta.localeCompare(b.plaqueta));
    return { bens: todos.slice((f.pagina - 1) * f.tamanho, f.pagina * f.tamanho), total: todos.length };
  }

  async bem(c: ContextoPatrimonio, id: number) {
    const e = this.est(c);
    const b = e.bens.find((x) => x.id === id);
    return b ? this.vistaBem(e, b) : null;
  }

  async bemPorPlaqueta(c: ContextoPatrimonio, p: string) {
    const e = this.est(c);
    const b = e.bens.find((x) => x.plaquetaFinal === p);
    return b ? this.vistaBem(e, b) : null;
  }

  async notas(_c: ContextoPatrimonio, ano: number, mes: number, busca?: string) {
    const b = busca?.trim().toUpperCase();
    return {
      notas: NOTAS.filter(
        (n) => n.ano === ano && n.mes === mes && (!b || n.numero === b || (n.fornecedor ?? '').includes(b)),
      ),
      truncado: false,
    };
  }

  async nota(_c: ContextoPatrimonio, id: number) {
    return NOTAS.find((n) => n.id === id) ?? null;
  }

  async itensDaNota(c: ContextoPatrimonio, n: NotaDeEntrada) {
    const e = this.est(c);
    return ITENS.filter((i) => i.nota === n.id).map((i) => this.item(e, i.id) as ItemDaNota);
  }

  async itemNota(c: ContextoPatrimonio, id: number) {
    return this.item(this.est(c), id);
  }

  async bensParaDepreciar(c: ContextoPatrimonio, empresa: number, competencia: string) {
    const e = this.est(c);
    const bens: BemDaCompetencia[] = e.bens
      .filter(
        (b) =>
          b.empresa === empresa && (b.situacao !== 'baixado' || (b.baixadoEm ?? '') >= `${competencia}-01`),
      )
      .map((b) => ({
        id: b.id,
        plaqueta: b.plaquetaFinal,
        descricao: b.campos.descricao,
        grupo: b.campos.grupo,
        centro: b.centroAtual,
        valorCent: b.valorCent,
        residualCent: b.campos.residualCent,
        vidaUtilMeses: b.campos.vidaUtilMeses,
        coeficiente: DOMINIOS.coeficientes.find((k) => k.id === b.campos.coeficiente)?.percentual ?? null,
        inicioDepreciacao: b.campos.inicioDepreciacao,
        depreciavel: b.campos.depreciavel,
        situacao: b.situacao,
        baixadoEm: b.baixadoEm,
        acumuladaCent: this.cotasVigentes(e)
          .filter((k) => k.bem === b.id && k.competencia < competencia)
          .reduce((s, k) => s + k.valorCent, 0),
        temCotaNaCompetencia: this.cotasVigentes(e).some(
          (k) => k.bem === b.id && k.competencia === competencia,
        ),
        marco: this.marcoDe(e, b.id, competencia),
      }));
    return { bens, truncado: false };
  }

  async calculos(c: ContextoPatrimonio, empresa: number, competencia: string) {
    const e = this.est(c);
    const estornados = new Set(e.estornos.map((x) => x.calculo));
    const doEmp = e.calculos.filter((k) => k.empresa === empresa && !estornados.has(k.id));
    return {
      daCompetencia: doEmp.find((k) => k.competencia === competencia) ?? null,
      ultimo: [...doEmp].sort((a, b) => b.competencia.localeCompare(a.competencia))[0] ?? null,
    };
  }

  async cotas(c: ContextoPatrimonio, calculo: number): Promise<CotaRegistrada[]> {
    const e = this.est(c);
    return e.cotas
      .filter((k) => k.calculo === calculo)
      .map((k) => {
        const b = e.bens.find((x) => x.id === k.bem);
        return {
          bem: k.bem,
          plaqueta: k.plaqueta,
          descricao: b?.campos.descricao ?? '',
          grupo: k.grupo,
          centro: k.centro,
          baseCent: k.baseCent,
          residualCent: k.residualCent,
          vidaUtilMeses: k.vidaUtilMeses,
          coeficiente: k.coeficiente,
          acumuladaAntesCent: k.acumuladaAntesCent,
          valorCent: k.valorCent,
          inicioDepreciacao: b?.campos.inicioDepreciacao ?? '',
        };
      })
      .sort((a, b) => a.plaqueta.localeCompare(b.plaqueta));
  }

  async movimentos(c: ContextoPatrimonio, f: { situacao?: string | undefined; bem?: number | undefined }) {
    const e = this.est(c);
    return e.movs
      .filter(
        (m) =>
          (f.situacao === undefined || m.situacao === f.situacao) &&
          (f.bem === undefined || m.x.bem === f.bem),
      )
      .sort((a, b) => b.id - a.id)
      .map((m) => this.vistaMov(e, m));
  }

  async movimento(c: ContextoPatrimonio, id: number) {
    const e = this.est(c);
    const m = e.movs.find((x) => x.id === id);
    return m ? this.vistaMov(e, m) : null;
  }

  async ultimaSaida(c: ContextoPatrimonio, bem: number) {
    const m = this.est(c)
      .movs.filter((x) => x.x.bem === bem && (x.x.tipo === 'emprestimo' || x.x.tipo === 'comodato'))
      .sort((a, b) => b.id - a.id)[0];
    return m?.id ?? null;
  }

  async inventarios(c: ContextoPatrimonio) {
    return [...this.est(c).invs].sort((a, b) => b.id - a.id).map((i) => this.vistaInv(i));
  }

  async inventario(c: ContextoPatrimonio, id: number) {
    const i = this.est(c).invs.find((x) => x.id === id);
    return i ? this.vistaInv(i) : null;
  }

  async leituras(c: ContextoPatrimonio, inventario: number) {
    const e = this.est(c);
    const leituras: LeituraRegistrada[] = e.leituras
      .filter((l) => l.inventario === inventario)
      .map((l) => {
        const b = l.bem === null ? null : e.bens.find((x) => x.id === l.bem);
        return {
          id: l.id,
          codigo: l.codigo,
          bem: b
            ? { id: b.id, plaqueta: b.plaquetaFinal, descricao: b.campos.descricao, centro: b.centroAtual }
            : null,
          centroLido: l.centroLido,
          resultado: l.resultado,
          observacao: l.observacao,
          lidoPor: l.lidoPor,
          lidoEm: l.lidoEm,
        };
      });
    return { leituras, truncado: false };
  }

  async esperados(c: ContextoPatrimonio, centro: number | null) {
    const bens: BemEsperado[] = this.est(c)
      .bens.filter((b) => b.situacao === 'ativo' && (centro === null || b.centroAtual === centro))
      .map((b) => ({
        id: b.id,
        plaqueta: b.plaquetaFinal,
        descricao: b.campos.descricao,
        centro: b.centroAtual,
        situacao: 'ativo' as const,
      }))
      .sort((a, b) => a.plaqueta.localeCompare(b.plaqueta));
    return { bens, truncado: false };
  }

  async cadastrar(c: ContextoPatrimonio, x: CadastroDeBens, por: string, gerar: (n: number) => string) {
    const e = this.est(c);
    if (x.item) {
      const relido = this.item(e, x.item.id);
      if (!relido)
        throw recusa('item-nota', 'Item da nota', 'O item não existe mais na nota fiscal de entrada.');
      if (relido.jaCadastrados !== x.item.jaCadastrados) throw desatualizado('O item da nota');
      if (relido.jaCadastrados + x.bens.length > x.item.unidades)
        throw recusa(
          'item-quantidade',
          'Item da nota',
          'O item da nota não tem mais unidades sem bem cadastrado.',
        );
    }
    const novos: BemMem[] = [];
    let seq = e.plaqueta;
    for (const b of x.bens) {
      const plaqueta = b.plaqueta ?? gerar(++seq);
      if ([...e.bens, ...novos].some((y) => y.plaquetaFinal === plaqueta))
        throw recusa('plaqueta-repetida', 'Plaqueta repetida', `A plaqueta ${plaqueta} já é de outro bem.`);
      const agora = this.agora();
      novos.push({
        ...b,
        id: e.id + novos.length + 1,
        plaquetaFinal: plaqueta,
        situacao: 'ativo',
        baixadoEm: null,
        centroAtual: b.centro,
        responsavelAtual: b.responsavel,
        campos: {
          descricao: b.descricao,
          grupo: b.grupo,
          localDetalhe: b.localDetalhe,
          tipoResponsavel: b.tipoResponsavel,
          responsavel: b.responsavel,
          marca: b.marca,
          modelo: b.modelo,
          numeroSerie: b.numeroSerie,
          vidaUtilMeses: b.vidaUtilMeses,
          residualCent: b.residualCent,
          coeficiente: b.coeficiente,
          inicioDepreciacao: b.inicioDepreciacao,
          depreciavel: b.depreciavel,
        },
        versao: 0,
        criadoPor: por.slice(0, 31),
        criadoEm: agora,
        alteradoPor: por.slice(0, 31),
        alteradoEm: agora,
      });
    }
    e.plaqueta = seq;
    e.id += novos.length;
    e.bens.push(...novos);
    return novos.map((b) => this.vistaBem(e, b));
  }

  async alterar(
    c: ContextoPatrimonio,
    x: AlteracaoDoBem,
    por: string,
    conferir: (antes: BemRegistrado) => string | null,
  ) {
    const e = this.est(c);
    const b = e.bens.find((y) => y.id === x.id);
    if (!b) return null;
    const antes = this.vistaBem(e, b);
    if (b.versao !== x.versao) throw desatualizado();
    const problema = conferir(antes);
    if (problema) throw recusa('bem-alteracao', 'Alteração recusada', problema);
    const campos = Object.fromEntries(
      Object.entries(x).filter(([k]) => k !== 'id' && k !== 'versao'),
    ) as Omit<AlteracaoDoBem, 'id' | 'versao'>;
    const atuais: Record<string, unknown> = { ...b.campos, responsavel: b.responsavelAtual };
    if (Object.entries(campos).every(([k, v]) => atuais[k] === v))
      return { antes, depois: antes, mudou: false };
    b.campos = campos;
    b.responsavelAtual = campos.responsavel;
    b.versao += 1;
    b.alteradoPor = por.slice(0, 31);
    b.alteradoEm = this.agora();
    return { antes, depois: this.vistaBem(e, b), mudou: true };
  }

  async registrarMovimento(c: ContextoPatrimonio, x: MovimentoNovo, por: string) {
    const e = this.est(c);
    const b = e.bens.find((y) => y.id === x.bem);
    if (!b || b.versao !== x.versaoBem) throw desatualizado();
    if (x.efeito) {
      b.situacao = x.efeito.situacao;
      b.baixadoEm = x.efeito.baixadoEm;
    }
    b.versao += 1;
    b.alteradoPor = por.slice(0, 31);
    b.alteradoEm = this.agora();
    const m: MovMem = {
      id: ++e.id,
      x,
      situacao: x.situacao,
      decididoPor: x.situacao === 'pendente' ? null : por.slice(0, 31),
      decididoEm: x.situacao === 'pendente' ? null : this.agora(),
      decisaoMotivo: null,
      versao: 0,
      solicitadoPor: por.slice(0, 31),
      solicitadoEm: this.agora(),
    };
    e.movs.push(m);
    return { movimento: this.vistaMov(e, m), bem: this.vistaBem(e, b) };
  }

  async decidir(
    c: ContextoPatrimonio,
    x: { id: number; versao: number; aceitar: boolean; motivo: string | null },
    por: string,
    conferir: (m: MovimentoRegistrado, bem: BemRegistrado) => string | null,
  ) {
    const e = this.est(c);
    const m = e.movs.find((y) => y.id === x.id);
    const b = m ? e.bens.find((y) => y.id === m.x.bem) : undefined;
    if (!m || !b) return null;
    const antes = this.vistaMov(e, m);
    const problema = conferir(antes, this.vistaBem(e, b));
    if (problema) throw recusa('movimento-decisao', 'Decisão recusada', problema);
    if (m.versao !== x.versao || m.situacao !== 'pendente') throw desatualizado('O pedido');
    if (x.aceitar && (b.situacao !== 'ativo' || b.centroAtual !== m.x.origem))
      throw recusa('bem-mudou', 'Bem mudou', 'O bem não está mais em uso no setor de origem.');
    m.situacao = x.aceitar ? 'aceito' : 'recusado';
    m.decididoPor = por.slice(0, 31);
    m.decididoEm = this.agora();
    m.decisaoMotivo = x.motivo;
    m.versao += 1;
    if (x.aceitar) {
      b.centroAtual = m.x.destino ?? b.centroAtual;
      b.responsavelAtual = m.x.destinoResponsavel ?? b.responsavelAtual;
    }
    b.versao += 1;
    b.alteradoPor = por.slice(0, 31);
    b.alteradoEm = this.agora();
    return { antes, movimento: this.vistaMov(e, m), bem: this.vistaBem(e, b) };
  }

  async cancelar(
    c: ContextoPatrimonio,
    x: { id: number; versao: number; motivo: string },
    por: string,
    conferir: (m: MovimentoRegistrado) => string | null,
  ) {
    const e = this.est(c);
    const m = e.movs.find((y) => y.id === x.id);
    if (!m) return null;
    const antes = this.vistaMov(e, m);
    const problema = conferir(antes);
    if (problema) throw recusa('movimento-cancelamento', 'Cancelamento recusado', problema);
    if (m.versao !== x.versao || m.situacao !== 'pendente') throw desatualizado('O pedido');
    m.situacao = 'cancelado';
    m.decididoPor = por.slice(0, 31);
    m.decididoEm = this.agora();
    m.decisaoMotivo = x.motivo;
    m.versao += 1;
    const b = e.bens.find((y) => y.id === m.x.bem);
    if (b) b.versao += 1;
    return { antes, movimento: this.vistaMov(e, m) };
  }

  async calcular(
    c: ContextoPatrimonio,
    x: { empresa: number; competencia: string },
    por: string,
    montar: Parameters<PortaPatrimonio['calcular']>[3],
  ) {
    const e = this.est(c);
    const { bens } = await this.bensParaDepreciar(c, x.empresa, x.competencia);
    const { ultimo, daCompetencia } = await this.calculos(c, x.empresa, x.competencia);
    const plano = montar({ bens, ultimo });
    if (plano.impedimentos.length > 0)
      throw recusa('calculo-impedido', 'Cálculo impedido', plano.impedimentos.join(' '));
    if (daCompetencia)
      throw recusa('ja-calculado', 'Já calculada', 'A depreciação desta competência já foi calculada.');
    if (plano.cotas.reduce((s, k) => s + k.valorCent, 0) !== plano.totalCent)
      throw new Error('O total do cálculo não é a soma das cotas.');
    const calculo: CalculoRegistrado = {
      id: ++e.id,
      empresa: x.empresa,
      competencia: x.competencia,
      bens: plano.cotas.length,
      ignorados: plano.ignorados,
      totalCent: plano.totalCent,
      calculadoPor: por.slice(0, 31),
      calculadoEm: this.agora(),
      rodada: e.estornos.filter((y) => y.empresa === x.empresa && y.competencia === x.competencia).length + 1,
    };
    e.calculos.push(calculo);
    for (const k of plano.cotas) {
      e.cotas.push({ ...k, calculo: calculo.id, empresa: x.empresa, competencia: x.competencia });
      // Como no núcleo (D-BAIXA-DEPREC-546): a cota sobe a versão do bem.
      const b = e.bens.find((y) => y.id === k.bem);
      if (b) b.versao += 1;
    }
    return { calculo, plano };
  }

  async estornos(c: ContextoPatrimonio, empresa: number, competencia: string): Promise<EstornoDeCalculo[]> {
    return this.est(c)
      .estornos.filter((x) => x.empresa === empresa && x.competencia === competencia)
      .sort((a, b) => b.id - a.id);
  }

  async estornar(
    c: ContextoPatrimonio,
    x: { empresa: number; competencia: string; motivo: string; origem: string },
    por: string,
    conferir: Parameters<PortaPatrimonio['estornar']>[3],
  ) {
    const e = this.est(c);
    const { daCompetencia, ultimo } = await this.calculos(c, x.empresa, x.competencia);
    const ano = x.competencia.slice(0, 4);
    const doCalculo = daCompetencia ? e.cotas.filter((k) => k.calculo === daCompetencia.id) : [];
    const impedimento = conferir({
      daCompetencia,
      ultimo,
      lotesExportados: this.lotesExportados
        .filter((l) => l.empresa === x.empresa && (l.periodo === x.competencia || l.periodo === ano))
        .map((l) => ({ periodo: l.periodo, exportadoEm: l.exportadoEm })),
      bensBaixados: doCalculo
        .filter((k) => e.bens.find((b) => b.id === k.bem)?.situacao === 'baixado')
        .map((k) => k.plaqueta),
    });
    if (impedimento) throw recusa(impedimento.codigo, 'Operação recusada', impedimento.detalhe);
    if (!daCompetencia) throw recusa('sem-calculo', 'Operação recusada', 'Sem cálculo vigente.');
    const posteriores = e.ajustes.filter(
      (y) =>
        y.empresa === x.empresa &&
        y.tipo !== 'reavaliacao' &&
        !y.estorno &&
        y.competenciaMarco >= x.competencia,
    );
    if (posteriores.length > 0)
      throw recusa(
        'ajuste-posterior',
        'Operação recusada',
        `Há ajuste de valor registrado depois desta depreciação (bens ${posteriores
          .map((y) => y.plaqueta)
          .join(', ')}): estorne o ajuste antes.`,
      );
    const estorno: EstornoDeCalculo = {
      id: ++e.id,
      calculo: daCompetencia.id,
      empresa: x.empresa,
      competencia: x.competencia,
      bens: daCompetencia.bens,
      totalCent: daCompetencia.totalCent,
      motivo: x.motivo.trim().slice(0, 500),
      origem: x.origem.slice(0, 40),
      estornadoPor: por.slice(0, 31),
      estornadoEm: this.agora(),
    };
    e.estornos.push(estorno);
    for (const k of doCalculo) {
      const b = e.bens.find((y) => y.id === k.bem);
      if (b) b.versao += 1;
    }
    return { estorno, calculo: daCompetencia };
  }

  async ajustes(c: ContextoPatrimonio, bem: number): Promise<AjusteDoBem[]> {
    return this.est(c)
      .ajustes.filter((x) => x.bem === bem)
      .sort((a, b) => b.id - a.id);
  }

  async laudos(c: ContextoPatrimonio, bem: number): Promise<LaudoDoBem[]> {
    return this.est(c)
      .laudos.filter((x) => x.bem === bem)
      .sort((a, b) => b.id - a.id);
  }

  async laudo(c: ContextoPatrimonio, id: number): Promise<LaudoDoBem | null> {
    return this.est(c).laudos.find((x) => x.id === id) ?? null;
  }

  async anexarLaudo(
    c: ContextoPatrimonio,
    x: { bem: number; nome: string; descricao: string; chave: string; sha256: string; tamanho: number },
    por: string,
  ): Promise<LaudoDoBem> {
    const e = this.est(c);
    if (!e.bens.some((y) => y.id === x.bem))
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Bem não encontrado.');
    const laudo: LaudoDoBem = {
      id: ++e.id,
      bem: x.bem,
      nome: x.nome.trim().slice(0, 120),
      descricao: x.descricao.trim().slice(0, 200),
      chave: x.chave,
      sha256: x.sha256,
      tamanho: x.tamanho,
      enviadoPor: por.slice(0, 31),
      enviadoEm: this.agora(),
    };
    e.laudos.push(laudo);
    return laudo;
  }

  async registrarAjuste(
    c: ContextoPatrimonio,
    x: { bem: number; versao: number; motivo: string; hoje: string },
    por: string,
    planejar: Parameters<PortaPatrimonio['registrarAjuste']>[3],
  ): Promise<AjusteDoBem> {
    const e = this.est(c);
    const b = e.bens.find((y) => y.id === x.bem);
    if (!b) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Bem não encontrado.');
    if (b.versao !== x.versao) throw desatualizado();
    const bem = this.vistaBem(e, b);
    const { ultimo } = await this.calculos(c, bem.empresa, x.hoje.slice(0, 7));
    const r = planejar({
      bem,
      marco: this.marcoDe(e, x.bem),
      ultimaCalculada: ultimo?.competencia ?? null,
      contasConfiguradas: this.contasImpairmentConfiguradas,
      lotesExportados: this.lotesDe(bem.empresa, x.hoje),
    });
    if ('impedimento' in r) throw recusa(r.impedimento.codigo, 'Operação recusada', r.impedimento.detalhe);
    const a = r.ajuste;
    if (a.laudo !== null && !e.laudos.some((l) => l.id === a.laudo && l.bem === x.bem))
      throw recusa(
        'laudo-inexistente',
        'Laudo não anexado',
        `O laudo ${a.laudo} não está anexado a este bem: anexe o PDF do laudo e escolha-o na lista.`,
      );
    const ajuste: AjusteDoBem = {
      id: ++e.id,
      bem: x.bem,
      empresa: bem.empresa,
      tipo: a.tipo,
      competenciaMarco: a.competenciaMarco,
      data: a.data,
      centro: bem.centro.id,
      grupo: bem.grupo.slice(0, 30),
      plaqueta: bem.plaqueta,
      valorContabilAntesCent: a.valorContabilAntesCent,
      valorContabilDepoisCent: a.valorContabilDepoisCent,
      acumuladaMarcoCent: a.acumuladaMarcoCent,
      perdaCent: a.perdaCent,
      residualCent: a.residualCent,
      vidaRestanteMeses: a.vidaRestanteMeses,
      valorJustoCent: a.valorJustoCent,
      laudo: a.laudo,
      motivo: x.motivo.trim().slice(0, 500),
      origem: a.origem.slice(0, 40),
      registradoPor: por.slice(0, 31),
      registradoEm: this.agora(),
      estorno: null,
    };
    e.ajustes.push(ajuste);
    b.versao += 1;
    return ajuste;
  }

  async estornarAjuste(
    c: ContextoPatrimonio,
    x: { ajuste: number; motivo: string; origem: string; hoje: string },
    por: string,
    conferir: Parameters<PortaPatrimonio['estornarAjuste']>[3],
  ): Promise<AjusteDoBem> {
    const e = this.est(c);
    const i = e.ajustes.findIndex((y) => y.id === x.ajuste);
    const ajuste = e.ajustes[i];
    if (!ajuste) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Ajuste não encontrado.');
    const marco = this.marcoDe(e, ajuste.bem);
    const impedimento = conferir({
      ajuste,
      ultimoComMarco: marco ? { id: marco.ajuste } : null,
      cotasPosteriores: [
        ...new Set(
          this.cotasVigentes(e)
            .filter((k) => k.bem === ajuste.bem && k.competencia > ajuste.competenciaMarco)
            .map((k) => k.competencia),
        ),
      ].sort(),
      lotesExportados: this.lotesDe(ajuste.empresa, ajuste.data),
    });
    if (impedimento) throw recusa(impedimento.codigo, 'Operação recusada', impedimento.detalhe);
    const estornado: AjusteDoBem = {
      ...ajuste,
      estorno: {
        data: x.hoje,
        motivo: x.motivo.trim().slice(0, 500),
        origem: x.origem.slice(0, 40),
        estornadoPor: por.slice(0, 31),
        estornadoEm: this.agora(),
      },
    };
    e.ajustes[i] = estornado;
    const b = e.bens.find((y) => y.id === ajuste.bem);
    if (b) b.versao += 1;
    return estornado;
  }

  async abrirInventario(c: ContextoPatrimonio, x: { descricao: string; centro: number | null }, por: string) {
    const e = this.est(c);
    const inv: InvMem = {
      id: ++e.id,
      descricao: x.descricao,
      centro: x.centro,
      situacao: 'aberto',
      esperados: null,
      resumo: null,
      abertoPor: por.slice(0, 31),
      abertoEm: this.agora(),
      encerradoPor: null,
      encerradoEm: null,
    };
    e.invs.push(inv);
    return inv.id;
  }

  async registrarLeitura(c: ContextoPatrimonio, x: LeituraNova, por: string) {
    const e = this.est(c);
    const inv = e.invs.find((i) => i.id === x.inventario);
    if (!inv) throw recusa('inventario', 'Inventário', 'Inventário não encontrado.');
    if (inv.situacao !== 'aberto') throw naoAberto(inv);
    const l: LeituraMem = { ...x, id: ++e.id, lidoPor: por.slice(0, 31), lidoEm: this.agora() };
    e.leituras.push(l);
    return l.id;
  }

  async encerrarInventario(
    c: ContextoPatrimonio,
    x: { id: number; esperados: number; resumo: string },
    por: string,
  ) {
    const inv = this.est(c).invs.find((i) => i.id === x.id);
    if (!inv) return false;
    if (inv.situacao !== 'aberto') throw naoAberto(inv);
    inv.situacao = 'encerrado';
    inv.esperados = x.esperados;
    inv.resumo = x.resumo;
    inv.encerradoPor = por.slice(0, 31);
    inv.encerradoEm = this.agora();
    return true;
  }

  async cancelarInventario(c: ContextoPatrimonio, x: { id: number; motivo: string }, por: string) {
    const inv = this.est(c).invs.find((i) => i.id === x.id);
    if (!inv) return false;
    if (inv.situacao !== 'aberto') throw naoAberto(inv);
    inv.situacao = 'cancelado';
    inv.canceladoPor = por.slice(0, 31);
    inv.canceladoEm = this.agora();
    inv.motivoCancelamento = x.motivo.trim().slice(0, 500);
    return true;
  }

  // ── W0-08: grupo do bem (as mesmas regras do núcleo: semente na versão 0, versão lida, sem órfão) ──────────────────

  private gruposLidos(c: ContextoPatrimonio): GrupoDoBem[] {
    const e = this.est(c);
    return [...(e.grupos ?? sementeMem())]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo))
      .map((g) => ({ ...g, bens: e.bens.filter((b) => b.campos.grupo === g.codigo).length }));
  }

  /** A primeira gravação grava a semente (ids próprios, versão 0). */
  private gruposGravados(c: ContextoPatrimonio): GrupoMem[] {
    const e = this.est(c);
    e.grupos ??= sementeMem().map((g) => ({ ...g, id: ++e.id }));
    return e.grupos;
  }

  private grupoPelaVersao(c: ContextoPatrimonio, codigo: string, versao: number): GrupoMem {
    const g = this.gruposGravados(c).find((x) => x.codigo === codigo);
    if (!g)
      throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado', 'Grupo do bem não encontrado.');
    if (g.versao !== versao) throw desatualizado('O grupo do bem');
    return g;
  }

  private lido(c: ContextoPatrimonio, codigo: string): GrupoDoBem {
    const g = this.gruposLidos(c).find((x) => x.codigo === codigo);
    if (!g)
      throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado', 'Grupo do bem não encontrado.');
    return g;
  }

  async grupos(c: ContextoPatrimonio) {
    return this.gruposLidos(c);
  }

  /** Revisão W0-08: o plano sintético do imobilizado (só as analíticas e ativas; os testes trocam para provar a recusa). */
  contasPlano: { codigo: string; nome: string }[] = [
    { codigo: '1.2.3.01', nome: 'Equipamentos médico-hospitalares' },
    { codigo: '1.2.3.09', nome: 'Outros bens do imobilizado' },
  ];

  async contasDoGrupo() {
    return this.contasPlano.map((x) => ({ ...x }));
  }

  async versoesGrupo(c: ContextoPatrimonio, id: number | null) {
    return this.est(c)
      .versoesGrupo.filter((v) => v.grupo === id)
      .sort((a, b) => b.versao - a.versao)
      .map((v): VersaoGrupoBem => ({
        versao: v.versao,
        operacao: v.operacao,
        nome: v.nome,
        vidaUtilMeses: v.vidaUtilMeses,
        conta: v.conta,
        ativo: v.ativo,
        motivo: v.motivo,
        por: v.por,
        em: v.em,
      }));
  }

  async incluirGrupo(c: ContextoPatrimonio, x: GrupoBemNovo, por: string) {
    const gs = this.gruposGravados(c);
    if (gs.some((g) => g.codigo === x.codigo))
      throw recusa('codigo-em-uso', 'Código em uso', `Já existe um grupo com o código ${x.codigo}.`);
    void por;
    gs.push({
      ...x,
      id: ++this.est(c).id,
      ativo: true,
      semente: false,
      inativadoEm: null,
      motivoInativacao: null,
      versao: 1,
    });
    return this.lido(c, x.codigo);
  }

  private versionar(
    c: ContextoPatrimonio,
    g: GrupoMem,
    operacao: VersaoGrupoBem['operacao'],
    motivo: string,
    por: string,
  ) {
    this.est(c).versoesGrupo.push({
      grupo: g.id ?? 0,
      versao: g.versao,
      operacao,
      nome: g.nome,
      vidaUtilMeses: g.vidaUtilMeses,
      conta: g.conta,
      ativo: g.ativo,
      motivo,
      por: por.slice(0, 31),
      em: this.agora(),
    });
  }

  async alterarGrupo(
    c: ContextoPatrimonio,
    x: GrupoBemNovo & { versaoVista: number; motivo: string },
    por: string,
  ) {
    const g = this.grupoPelaVersao(c, x.codigo, x.versaoVista);
    const antes = this.lido(c, x.codigo);
    this.versionar(c, g, 'alteracao', x.motivo, por);
    Object.assign(g, { nome: x.nome, vidaUtilMeses: x.vidaUtilMeses, conta: x.conta, versao: g.versao + 1 });
    return { antes, depois: this.lido(c, x.codigo) };
  }

  async situacaoGrupo(
    c: ContextoPatrimonio,
    x: { codigo: string; versaoVista: number; motivo: string; ativo: boolean },
    por: string,
  ) {
    const g = this.grupoPelaVersao(c, x.codigo, x.versaoVista);
    if (g.ativo === x.ativo)
      throw recusa(
        x.ativo ? 'ja-ativo' : 'ja-inativo',
        'Grupo do bem',
        x.ativo ? 'O grupo do bem já está ativo.' : 'O grupo do bem já está inativo.',
      );
    if (!x.ativo && this.gruposGravados(c).filter((k) => k.ativo).length <= 1)
      throw recusa(
        'ultimo-grupo',
        'Último grupo ativo',
        'É o último grupo ativo: inclua ou reative outro grupo antes de inativar este.',
      );
    const antes = this.lido(c, x.codigo);
    this.versionar(c, g, x.ativo ? 'reativacao' : 'inativacao', x.motivo, por);
    Object.assign(g, {
      ativo: x.ativo,
      inativadoEm: x.ativo ? null : this.agora(),
      motivoInativacao: x.ativo ? null : x.motivo,
      versao: g.versao + 1,
    });
    return { antes, depois: this.lido(c, x.codigo) };
  }

  async excluirGrupo(c: ContextoPatrimonio, x: { codigo: string; versaoVista: number; motivo: string }) {
    const g = this.grupoPelaVersao(c, x.codigo, x.versaoVista);
    const e = this.est(c);
    const bens = e.bens.filter((b) => b.campos.grupo === x.codigo);
    const cotas = e.cotas.filter((k) => k.grupo === x.codigo);
    const dependentes = [
      ...(bens.length
        ? [
            {
              rotulo: 'Bens patrimoniais',
              quantidade: bens.length,
              amostra: bens.slice(0, 5).map((b) => b.plaquetaFinal),
              origem: 'logica' as const,
            },
          ]
        : []),
      ...(cotas.length
        ? [
            {
              rotulo: 'Cotas de depreciação calculadas',
              quantidade: cotas.length,
              amostra: cotas.slice(0, 5).map((k) => k.plaqueta),
              origem: 'logica' as const,
            },
          ]
        : []),
    ];
    if (dependentes.length > 0) {
      const total = dependentes.reduce((t, d) => t + d.quantidade, 0);
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        `O grupo do bem tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${dependentes.map((d) => `${d.quantidade} em ${d.rotulo}`).join('; ')}. Inative o grupo em vez de excluir.`,
        { codigo: 'com-dependentes', dependentes, podeInativar: true },
      );
    }
    const gs = this.gruposGravados(c);
    if (gs.length <= 1)
      throw recusa(
        'ultimo-grupo',
        'Último grupo',
        'É o último grupo do estabelecimento: inclua outro antes de excluir este.',
      );
    const lido = this.lido(c, x.codigo);
    e.grupos = gs.filter((k) => k !== g);
    e.versoesGrupo = e.versoesGrupo.filter((v) => v.grupo !== g.id);
    return lido;
  }
}
