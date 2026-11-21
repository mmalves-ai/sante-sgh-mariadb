// Porta do estoque em MEMÓRIA (M28): a sessão sintética de dev/ci (E2E). Itens, locais, saldos, lotes, documentos,
// pedidos e propostas SINTÉTICOS (nomes claramente fictícios); as gravações aplicam o mesmo Zod das receitas
// (operacaoSuprimentos(op).entrada) e as mesmas regras do domínio (saldo, lote, escopo, mês fechado, cotação, conferência da nota),
// e simulam o que os gatilhos fazem no banco (número do documento, saldo, lote, custo médio, consumo). Nada vai à cópia.
// As operações de documento ficam DESLIGADAS no banco real até a prova do cenário controlado (POL-3, D-MOTOR-28): aqui,
// como as outras portas em memória, a tela percorre o fluxo inteiro.
import {
  type EfeitoDocumentoNovo,
  type LeituraNumericaOnda3,
  type TipoDocumentoOnda3,
  cnpjValido,
  type ConsumoEstoque,
  type RegistrarDevolucaoEntrada,
  type RegistrarEntradaNFEntrada,
  type RegistrarSaidaEntrada,
  type TransferirEntrada,
  type EstadoOperacao,
  type DocumentoDetalhe,
  type DocumentoEstoque,
  ESTADOS_ITEM_PEDIDO,
  type EscopoUsuarioEstoque,
  type FechamentosEstoque,
  type HistoricoCompra,
  type InventarioLido,
  type ItemBusca,
  type KitRastreavel,
  type LotesDoPaciente,
  type ParametrosEstoque,
  type PedidoDetalhe,
  type PedidoResumo,
  type PosicaoMensal,
  type RastreioLote,
  type RecalculosEstoque,
  type RequisicaoPendente,
  type SaldoItem,
  SITUACOES_PEDIDO_COMPRA,
  type TipoDocumentoEstoque,
  type TransferenciaEnviada,
} from '@sgh/contratos';
import {
  ajusteDoInventario,
  chavePonto,
  avaliarItem,
  centroTecnico,
  conferirAprovacao,
  conferirAprovacaoPedido,
  conferirCabecalhoNota,
  conferirCabecalhoSaida,
  conferirCentroCusto,
  conferirCompetencia,
  conferirCorrecaoValidade,
  conferirDestinoOrigem,
  conferirItemSaida,
  conferirItensPedido,
  conferirLocal,
  conferirLoteEntrada,
  conferirLotesSaida,
  conferirNota,
  conferirReabertura,
  conferirRecontagem,
  conferirTransferencia,
  diasParaVencer,
  type EscopoEstoque,
  escopoDasLinhas,
  exigeJustificativa,
  faixaDoValor,
  planejarVencedor,
  podeConsolidarNota,
  proximoAFechar,
  qtd3,
  quantidadeEstoque,
  reais,
  type RecusaSuprimentos,
  type TipoMovimento,
  validadeSuspeita,
  valorPelosVencedores,
  valorPrevisto,
  vencido,
} from '@sgh/dominio-suprimentos';
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { chaveMemoria, type FonteEstadoOperacao, loginDaOperacao, operacaoSuprimentos } from './operacoes.js';
import {
  contagemAgregada,
  documentosPorSistema,
  efeitosDoDocumento,
  horariosPorUnidade,
} from '@sgh/contratos/regras-suprimentos';
import type {
  ContextoSuprimentos,
  GravadorSghSuprimentos,
  ItemCadastroEstoque,
  LeituraOnda3,
  LeituraRegra1Onda3,
  PortaSuprimentos,
} from './porta.js';

// ── Estado sintético ──────────────────────────────────────────────────────────────────────────────────

interface ItemM {
  codigo: number;
  nome: string;
  unidade: string;
  rastreavel: boolean;
  controlado: boolean;
  antimicrobiano: boolean;
  consignado: boolean;
  estoque: number;
  total: number;
}
interface LoteM {
  id: number;
  item: number;
  local: number;
  lote: string;
  validade: string;
  quantidade: number;
}
interface LancamentoM {
  id: number;
  seq: number;
  item: number;
  quantidade: number;
  valor: number;
  consolidado: boolean;
  lotes: { id: number; lote: string; validade: string; quantidade: number }[];
  devolvido: number;
  /** Devolução: o lançamento da saída que volta. */
  lancamentoSaida?: number;
}
interface DocumentoM {
  tipo: TipoDocumentoEstoque;
  id: number;
  ano: number;
  mes: number;
  doc: number;
  data: string;
  hora: string;
  local: number;
  localDestino: number | null;
  destino: number | null;
  centroCusto: number | null;
  consolidado: boolean;
  usuario: string;
  observacao: string;
  paciente: { atendimento: number; nome: string } | null;
  nota: { fornecedor: number; fornecedorNome: string; numero: number; serie: string } | null;
  itens: LancamentoM[];
  ocorrencias: { tipo: string; motivo: string; autor: string; em: string }[];
  /** Requisição aberta (ainda não atendida). */
  requisicao?: boolean;
}
interface PedidoM {
  id: number;
  ano: number;
  doc: number;
  data: string;
  situacao: number | null;
  centroCusto: number;
  tipoCompra: string;
  usuario: string;
  itens: { id: number; seq: number; item: number; quantidade: number; comprada: number; estado: string }[];
  propostas: {
    id: number;
    item: number;
    seq: number;
    fornecedor: number;
    valorUnitario: number;
    quantidade: number;
    marca: string;
    vencedor: string;
    comprada: number;
  }[];
  escolhas: {
    item: number;
    seq: number;
    autor: string;
    em: string;
    justificativa: string;
    rateio: boolean;
  }[];
  aprovacao: { decisao: 'aprovado' | 'reprovado'; aprovador: string; em: string; nivel: number } | null;
}
interface EnvioM {
  id: number;
  origem: number;
  destino: number;
  etapa: 'enviada' | 'recebida' | 'divergente' | 'cancelada';
  enviadaPor: string;
  enviadaEm: string;
  observacao: string | null;
  itens: {
    item: number;
    quantidade: number;
    recebida: number | null;
    lotes: { lote: string; validade: string; quantidade: number }[];
  }[];
  documento: { ano: number; mes: number; doc: number } | null;
  motivo: string | null;
}
interface InventarioM {
  id: number;
  local: number;
  tipo: 'geral' | 'ciclico';
  situacao: 'aberto' | 'contagem' | 'recontagem' | 'aprovado' | 'cancelado';
  abertoPor: string;
  abertoEm: string;
  limitePct: number;
  itens: { item: number; saldo: number; contagens: { quantidade: number; contador: string }[] }[];
  balanco: { ano: number; mes: number; doc: number } | null;
}
interface KitM {
  id: number;
  nome: string;
  local: number;
  emergencial: boolean;
  itens: {
    id: number;
    item: number;
    lote: string | null;
    validade: string | null;
    quantidade: number;
    saldo: number;
    obrigatorio: boolean;
  }[];
  conferencia: {
    lacre: string;
    conferente: string;
    em: string;
    pendencias: string;
    completa: boolean;
  } | null;
}
interface Estado {
  seq: number;
  itens: Map<number, ItemM>;
  saldos: Map<string, number>;
  lotes: LoteM[];
  documentos: DocumentoM[];
  numeracao: Map<string, number>;
  pedidos: PedidoM[];
  envios: EnvioM[];
  inventarios: InventarioM[];
  kits: KitM[];
  fechados: { ano: number; mes: number; exportado: boolean }[];
  ocorrenciasMes: { tipo: string; ano: number; mes: number; motivo: string; autor: string; em: string }[];
  pontos: Map<string, { prazoDias: number; estoqueSeguranca: number | null }>;
  autorizacoes: Map<string, { por: string; em: string }>;
  compras: {
    item: number;
    data: string;
    fornecedor: number;
    nota: number;
    quantidade: number;
    unitario: number;
    marca: string;
  }[];
  /** Itens lançados na conta do paciente (o que o outro sistema grava na consolidação da saída e estorna na devolução). */
  conta: Map<number, { item: number; quantidade: number; doc: string }[]>;
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

const LOCAIS = [
  { codigo: 10, nome: 'ALMOXARIFADO CENTRAL' },
  { codigo: 15, nome: 'FARMÁCIA CENTRAL' },
  { codigo: 20, nome: 'FARMÁCIA SATÉLITE DA UTI' },
];
const CENTROS = [
  { codigo: 101, nome: 'CLÍNICA MÉDICA', localConsumo: 11, tecnico: false },
  { codigo: 102, nome: 'UTI ADULTO', localConsumo: 12, tecnico: false },
  { codigo: 103, nome: 'CENTRO CIRÚRGICO', localConsumo: 13, tecnico: false },
  { codigo: 9905, nome: 'CENTRAL DE ESTERILIZAÇÃO (TÉCNICO)', localConsumo: 14, tecnico: true },
];
const FORNECEDORES = new Map([
  [7001, 'DISTRIBUIDORA SINTÉTICA ALFA LTDA'],
  [7002, 'COMERCIAL SINTÉTICA BETA LTDA'],
  [7003, 'MEDICAMENTOS SINTÉTICOS GAMA SA'],
]);
const TERCEIROS = new Map([[801, 'HOSPITAL PARCEIRO SINTÉTICO']]);
/** Atendimentos sintéticos: o internado com conta, o internado sem conta e o externo. */
const ATENDIMENTOS = new Map<number, { nome: string; tipo: 'I' | 'E'; conta: boolean }>([
  [31337, { nome: 'PACIENTE SINTÉTICO INTERNADO', tipo: 'I', conta: true }],
  [31338, { nome: 'PACIENTE SINTÉTICO SEM CONTA', tipo: 'I', conta: false }],
  [41001, { nome: 'PACIENTE SINTÉTICO EXTERNO', tipo: 'E', conta: true }],
]);
/** Vínculos de médico sintéticos (prescritor do controlado e médico da saída a externo). */
const MEDICOS = new Set([9001, 9002]);

/** Escopo sintético por login (como o cadastro de usuários do estoque: local × tipo de movimento). */
const TODOS_TIPOS = ['S', 'E', 'D', 'TO', 'TD', 'I', 'R', 'V'];
const ESCOPOS: Readonly<
  Record<string, { locais: Record<number, string[]>; centros: number[]; flags: string[] }>
> = {
  'SINT.ALMOXARIFE': {
    locais: { 10: TODOS_TIPOS, 15: TODOS_TIPOS, 20: TODOS_TIPOS },
    centros: [],
    flags: [],
  },
  'SINT.COMPRADOR': { locais: { 10: ['E'] }, centros: [], flags: [] },
  'SINT.SUPERVISOR.ESTOQUE': {
    locais: { 10: TODOS_TIPOS, 15: TODOS_TIPOS, 20: TODOS_TIPOS },
    centros: [],
    flags: ['autorizarRequisicao', 'autorizarPedido', 'desbloquearFechamento'],
  },
  'SINT.ENFERMEIRO': { locais: { 15: ['R'] }, centros: [101, 102], flags: [] },
};

const hojeIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const agora = (): string => new Date().toISOString();
const horaAgora = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const somarDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const mesAnterior = (c: { ano: number; mes: number }, n = 1) => {
  let { ano, mes } = c;
  for (let i = 0; i < n; i += 1) {
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return { ano, mes };
};
const chaveSaldo = (item: number, local: number) => `${item}:${local}`;
const localNome = (c: number) => LOCAIS.find((l) => l.codigo === c)?.nome ?? `LOCAL ${c}`;

/** Recusa do domínio vira a recusa da operação (Problem Details em português, os campos). */
function recusar(r: RecusaSuprimentos | readonly RecusaSuprimentos[] | null): void {
  const lista = r === null ? [] : Array.isArray(r) ? r : [r as RecusaSuprimentos];
  const p = lista[0];
  if (p) throw recusa(p.codigo, p.mensagem, p.campos ? { campos: [...p.campos] } : {});
}

export class PortaSuprimentosMemoria implements PortaSuprimentos {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly catalogo: FonteEstadoOperacao | null) {}

  // ── Estado ─────────────────────────────────────────────────────────────────────────────────────────

  private e(c: ContextoSuprimentos): Estado {
    let s = this.estados.get(chaveMemoria(c));
    if (!s) {
      s = this.semear();
      this.estados.set(chaveMemoria(c), s);
    }
    return s;
  }

  private semear(): Estado {
    const hoje = hojeIso();
    const corrente = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
    const s: Estado = {
      seq: 1000,
      itens: new Map(),
      saldos: new Map(),
      lotes: [],
      documentos: [],
      numeracao: new Map(),
      pedidos: [],
      envios: [],
      inventarios: [],
      kits: [],
      fechados: [2, 3, 4].map((n) => ({ ...mesAnterior(corrente, n), exportado: true })),
      ocorrenciasMes: [],
      pontos: new Map(),
      autorizacoes: new Map(),
      compras: [],
      conta: new Map(),
      idem: new Map(),
    };
    const item = (i: Omit<ItemM, 'estoque' | 'total'>, saldos: Record<number, number>, custo: number) => {
      const estoque = Object.values(saldos).reduce((a, b) => a + b, 0);
      s.itens.set(i.codigo, { ...i, estoque, total: reais(estoque * custo) });
      for (const [l, q] of Object.entries(saldos)) s.saldos.set(chaveSaldo(i.codigo, Number(l)), q);
    };
    const base = { antimicrobiano: false, consignado: false, controlado: false, rastreavel: false };
    item(
      { ...base, codigo: 5001, nome: 'LUVA DE PROCEDIMENTO TAMANHO M', unidade: 'CX' },
      { 10: 120, 15: 10 },
      32.5,
    );
    item(
      { ...base, codigo: 5002, nome: 'SERINGA DESCARTÁVEL 10 ML', unidade: 'UN' },
      { 10: 800, 15: 200 },
      0.62,
    );
    item(
      {
        ...base,
        codigo: 5003,
        nome: 'DIPIRONA SÓDICA 500 MG/ML AMPOLA 2 ML',
        unidade: 'AMP',
        rastreavel: true,
      },
      { 10: 300, 15: 60 },
      1.1,
    );
    item(
      {
        ...base,
        codigo: 5004,
        nome: 'MORFINA 10 MG/ML AMPOLA 1 ML',
        unidade: 'AMP',
        rastreavel: true,
        controlado: true,
      },
      { 15: 40 },
      4.2,
    );
    item(
      {
        ...base,
        codigo: 5005,
        nome: 'CEFTRIAXONA 1 G FRASCO-AMPOLA',
        unidade: 'FA',
        rastreavel: true,
        antimicrobiano: true,
      },
      { 10: 90 },
      9.8,
    );
    item({ ...base, codigo: 5006, nome: 'CATETER INTRAVENOSO 20G', unidade: 'UN' }, { 10: 4 }, 3.4);
    const lote = (item: number, local: number, lote: string, dias: number, q: number) =>
      s.lotes.push({ id: (s.seq += 1), item, local, lote, validade: somarDias(hoje, dias), quantidade: q });
    lote(5003, 10, 'DIP-A1', 40, 100);
    lote(5003, 10, 'DIP-B2', 200, 200);
    lote(5003, 15, 'DIP-A1', 40, 60);
    lote(5004, 15, 'MOR-77', 120, 40);
    lote(5005, 10, 'CEF-09', 20, 50);
    lote(5005, 10, 'CEF-10', 300, 40);
    // Pedido em andamento com duas propostas por item (o E2E escolhe o vencedor com rateio).
    s.pedidos.push({
      id: (s.seq += 1),
      ano: corrente.ano,
      doc: 1,
      data: hoje,
      situacao: 2,
      centroCusto: 101,
      tipoCompra: 'P',
      usuario: 'SINT.COMPRADOR',
      itens: [
        { id: (s.seq += 1), seq: 1, item: 5001, quantidade: 100, comprada: 0, estado: 'O' },
        { id: (s.seq += 1), seq: 2, item: 5002, quantidade: 500, comprada: 0, estado: 'O' },
      ],
      propostas: [
        {
          id: (s.seq += 1),
          item: 5001,
          seq: 1,
          fornecedor: 7001,
          valorUnitario: 31.9,
          quantidade: 100,
          marca: 'MARCA A',
          vencedor: '',
          comprada: 0,
        },
        {
          id: (s.seq += 1),
          item: 5001,
          seq: 1,
          fornecedor: 7002,
          valorUnitario: 30.5,
          quantidade: 100,
          marca: 'MARCA B',
          vencedor: '',
          comprada: 0,
        },
        {
          id: (s.seq += 1),
          item: 5002,
          seq: 2,
          fornecedor: 7001,
          valorUnitario: 0.6,
          quantidade: 500,
          marca: 'MARCA A',
          vencedor: '',
          comprada: 0,
        },
        {
          id: (s.seq += 1),
          item: 5002,
          seq: 2,
          fornecedor: 7002,
          valorUnitario: 0.58,
          quantidade: 500,
          marca: 'MARCA B',
          vencedor: '',
          comprada: 0,
        },
      ],
      escolhas: [],
      aprovacao: null,
    });
    s.kits.push({
      id: (s.seq += 1),
      nome: 'CARRINHO DE PARADA DA UTI',
      local: 20,
      emergencial: true,
      itens: [
        {
          id: (s.seq += 1),
          item: 5003,
          lote: 'DIP-A1',
          validade: somarDias(hoje, 40),
          quantidade: 5,
          saldo: 5,
          obrigatorio: true,
        },
        {
          id: (s.seq += 1),
          item: 5002,
          lote: null,
          validade: null,
          quantidade: 10,
          saldo: 8,
          obrigatorio: true,
        },
      ],
      conferencia: null,
    });
    for (const [k, v] of [
      [5001, 4],
      [5002, 30],
    ] as const)
      s.compras.push({
        item: k,
        data: somarDias(hoje, -v),
        fornecedor: 7001,
        nota: 9000 + v,
        quantidade: 50,
        unitario: k === 5001 ? 32.5 : 0.62,
        marca: 'MARCA A',
      });
    return s;
  }

  private competencia(): { hoje: string; ano: number; mes: number } {
    const hoje = hojeIso();
    return { hoje, ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
  }

  private escopoDe(login: string): EscopoEstoque {
    const e = ESCOPOS[login];
    if (!e)
      return escopoDasLinhas([], [], {
        autorizarRequisicao: false,
        autorizarPedido: false,
        desbloquearFechamento: false,
      });
    return escopoDasLinhas(
      Object.entries(e.locais).flatMap(([l, ts]) => ts.map((tipo) => ({ local: Number(l), tipo }))),
      e.centros,
      {
        autorizarRequisicao: e.flags.includes('autorizarRequisicao'),
        autorizarPedido: e.flags.includes('autorizarPedido'),
        desbloquearFechamento: e.flags.includes('desbloquearFechamento'),
      },
    );
  }

  private numerar(s: Estado, tipo: string, ano: number, mes: number): number {
    const k = `${tipo}:${ano}:${mes}`;
    const n = (s.numeracao.get(k) ?? 0) + 1;
    s.numeracao.set(k, n);
    return n;
  }

  private item(s: Estado, codigo: number): ItemM {
    const i = s.itens.get(codigo);
    if (!i)
      throw recusa('item-inexistente', `O item ${codigo} não existe no cadastro de itens.`, {
        campos: ['itens'],
      });
    return i;
  }

  private saldo(s: Estado, item: number, local: number): number {
    return s.saldos.get(chaveSaldo(item, local)) ?? 0;
  }

  private lotesDisponiveis(s: Estado, item: number, local: number) {
    return s.lotes
      .filter((l) => l.item === item && l.local === local && l.quantidade > 0)
      .map((l) => ({ id: l.id, lote: l.lote, validade: l.validade, saldo: l.quantidade }));
  }

  /** O que os gatilhos fazem na consolidação da saída: o valor pelo custo médio, a baixa do saldo e do lote. */
  private baixar(
    s: Estado,
    item: number,
    local: number,
    quantidade: number,
    lotes: readonly { lote: string; validade: string; quantidade: number }[],
  ) {
    const i = this.item(s, item);
    const valor = valorPrevisto({ quantidade, estoque: i.estoque, total: i.total });
    i.estoque = qtd3(i.estoque - quantidade);
    i.total = reais(i.total - valor);
    s.saldos.set(chaveSaldo(item, local), qtd3(this.saldo(s, item, local) - quantidade));
    const usados: LancamentoM['lotes'] = [];
    for (const l of lotes) {
      const v = s.lotes.find(
        (x) => x.item === item && x.local === local && x.lote === l.lote && x.validade === l.validade,
      );
      if (v) {
        v.quantidade = qtd3(v.quantidade - l.quantidade);
        usados.push({ id: (s.seq += 1), lote: l.lote, validade: l.validade, quantidade: l.quantidade });
      }
    }
    return { valor, lotes: usados };
  }

  /** O que os gatilhos fazem na entrada (nota, devolução, transferência no destino): saldo, lote e custo. */
  private entrar(
    s: Estado,
    item: number,
    local: number,
    quantidade: number,
    valor: number,
    lotes: readonly { lote: string; validade: string; quantidade: number }[],
  ) {
    const i = this.item(s, item);
    i.estoque = qtd3(i.estoque + quantidade);
    i.total = reais(i.total + valor);
    s.saldos.set(chaveSaldo(item, local), qtd3(this.saldo(s, item, local) + quantidade));
    const usados: LancamentoM['lotes'] = [];
    for (const l of lotes) {
      const v = s.lotes.find(
        (x) => x.item === item && x.local === local && x.lote === l.lote && x.validade === l.validade,
      );
      if (v) v.quantidade = qtd3(v.quantidade + l.quantidade);
      else
        s.lotes.push({
          id: (s.seq += 1),
          item,
          local,
          lote: l.lote,
          validade: l.validade,
          quantidade: l.quantidade,
        });
      usados.push({ id: (s.seq += 1), lote: l.lote, validade: l.validade, quantidade: l.quantidade });
    }
    return usados;
  }

  private exigirMesAberto(s: Estado, c: { ano: number; mes: number }) {
    recusar(conferirCompetencia(c, s.fechados));
  }

  private conferirSaidaItens(
    s: Estado,
    local: number,
    itens: readonly {
      item: number;
      quantidade: number;
      lotes: readonly { lote: string; validade: string; quantidade: number }[];
      prescritorControlado?: number | undefined;
    }[],
    hoje: string,
  ) {
    for (const it of itens) {
      const i = this.item(s, it.item);
      recusar(
        conferirItemSaida({
          item: it.item,
          quantidade: it.quantidade,
          saldoLocal: this.saldo(s, it.item, local),
          estoque: i.estoque,
          total: i.total,
          custoMedio: i.estoque > 0 ? i.total / i.estoque : 0,
          consignado: i.consignado,
        }),
      );
      if (i.rastreavel)
        recusar(conferirLotesSaida(it.quantidade, it.lotes, this.lotesDisponiveis(s, it.item, local), hoje));
      if (i.controlado && !it.prescritorControlado)
        throw recusa('sem-prescritor', `O item ${i.nome} é controlado: informe o prescritor.`, {
          campos: ['itens'],
        });
    }
  }

  // ── Gravação ───────────────────────────────────────────────────────────────────────────────────────

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoSuprimentos, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, chaveMemoria(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoSuprimentos, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const o = operacaoSuprimentos(op);
    const analise = o.entrada.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave de pedido veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = this.aplicar(s, op, analise.data as never, loginDaOperacao(ctx));
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aplicar(s: Estado, op: string, e: any, usuario: string): Record<string, number | string> {
    const r = this.competencia();
    const escopo = this.escopoDe(usuario);
    switch (op) {
      case 'suprimentos.registrarSaida':
        return this.registrarSaida(s, e, usuario, r, escopo);
      case 'suprimentos.requisitarMaterial': {
        recusar(conferirCabecalhoSaida({ centroCusto: e.centroCusto, local: e.local }));
        this.exigirMesAberto(s, r);
        recusar(conferirCentroCusto(escopo, e.centroCusto));
        if (!LOCAIS.some((l) => l.codigo === e.local))
          throw recusa('local-inexistente', 'O local de estoque não existe.', { campos: ['local'] });
        for (const it of e.itens) this.item(s, it.item);
        const doc = this.numerar(s, 'saida', r.ano, r.mes);
        const d: DocumentoM = {
          tipo: 'saida',
          id: (s.seq += 1),
          ano: r.ano,
          mes: r.mes,
          doc,
          data: r.hoje,
          hora: horaAgora(),
          local: e.local,
          localDestino: null,
          destino: e.destino,
          centroCusto: e.centroCusto,
          consolidado: false,
          usuario,
          observacao: e.observacao ?? '',
          paciente: this.paciente(e.atendimento),
          nota: null,
          requisicao: true,
          ocorrencias: [],
          itens: e.itens.map((it: { item: number; quantidade: number }, k: number) => ({
            id: (s.seq += 1),
            seq: k + 1,
            item: it.item,
            quantidade: it.quantidade,
            valor: 0,
            consolidado: false,
            lotes: [],
            devolvido: 0,
          })),
        };
        s.documentos.push(d);
        return { id: d.id, ano: d.ano, mes: d.mes, doc: d.doc, itens: d.itens.length };
      }
      case 'suprimentos.registrarDevolucao':
        return this.registrarDevolucao(s, e, usuario, r, escopo);
      case 'suprimentos.transferir':
        return this.transferir(s, e, usuario, r, escopo);
      case 'suprimentos.registrarEntradaNF':
        return this.registrarNota(s, e, usuario, r, escopo);
      case 'suprimentos.criarPedido': {
        recusar(conferirItensPedido(e.itens));
        if (!CENTROS.some((x) => x.codigo === e.centroCusto))
          throw recusa('centro-inexistente', 'O centro de custo não existe.', { campos: ['centroCusto'] });
        for (const f of e.fornecedores)
          if (!FORNECEDORES.has(f))
            throw recusa('fornecedor-inexistente', 'O fornecedor não está cadastrado.', {
              campos: ['fornecedores'],
            });
        const doc = s.pedidos.filter((p) => p.ano === r.ano).reduce((m, p) => Math.max(m, p.doc), 0) + 1;
        const p: PedidoM = {
          id: (s.seq += 1),
          ano: r.ano,
          doc,
          data: r.hoje,
          situacao: e.situacao ?? (e.fornecedores.length ? 2 : 1),
          centroCusto: e.centroCusto,
          tipoCompra: e.tipoCompra,
          usuario,
          itens: [],
          propostas: [],
          escolhas: [],
          aprovacao: null,
        };
        e.itens.forEach((it: { item: number; quantidade: number }, k: number) => {
          this.item(s, it.item);
          p.itens.push({
            id: (s.seq += 1),
            seq: k + 1,
            item: it.item,
            quantidade: it.quantidade,
            comprada: 0,
            estado: e.fornecedores.length ? 'O' : 'P',
          });
          for (const f of e.fornecedores)
            p.propostas.push({
              id: (s.seq += 1),
              item: it.item,
              seq: k + 1,
              fornecedor: f,
              valorUnitario: 0,
              quantidade: it.quantidade,
              marca: '',
              vencedor: '',
              comprada: 0,
            });
        });
        s.pedidos.push(p);
        return {
          id: p.id,
          ano: p.ano,
          doc: p.doc,
          itens: p.itens.length,
          fornecedores: e.fornecedores.length,
        };
      }
      case 'suprimentos.registrarProposta': {
        const p = this.pedidoM(s, e.pedido.ano, e.pedido.doc);
        const x = p.propostas.find((y) => y.id === e.proposta);
        if (!x)
          throw recusa('proposta-inexistente', 'A proposta não é deste pedido.', { campos: ['proposta'] });
        x.valorUnitario = e.valorUnitario;
        if (e.marca !== undefined) x.marca = e.marca;
        return { id: x.id };
      }
      case 'suprimentos.definirVencedorCotacao': {
        const p = this.pedidoM(s, e.pedido.ano, e.pedido.doc);
        const propostas = p.propostas.map((x) => ({ ...x }));
        const plano = planejarVencedor(propostas, { item: e.item, seq: e.seq }, e.vencedoras);
        recusar(plano.recusas);
        if (
          exigeJustificativa(propostas, e.item, e.seq, e.vencedoras) &&
          (e.justificativa ?? '').trim().length < 10
        )
          throw recusa('sem-justificativa', 'A escolhida não é a menor proposta: escreva a justificativa.', {
            campos: ['justificativa'],
          });
        for (const m of plano.marcas) {
          const x = p.propostas.find((y) => y.id === m.id);
          if (x) x.vencedor = m.vencedor;
        }
        p.escolhas = p.escolhas.filter((x) => !(x.item === e.item && x.seq === e.seq));
        p.escolhas.push({
          item: e.item,
          seq: e.seq,
          autor: usuario,
          em: agora(),
          justificativa: e.justificativa ?? '',
          rateio: e.vencedoras.length > 1,
        });
        return { item: e.item, vencedoras: e.vencedoras.length, marcas: plano.marcas.length };
      }
      case 'suprimentos.registrarMovimentoDireto': {
        recusar(conferirLocal(escopo, e.local, 'saida'));
        this.exigirMesAberto(s, r);
        if (e.para === 'paciente' && !e.atendimento)
          throw recusa('sem-paciente', 'Informe o atendimento do paciente.', { campos: ['atendimento'] });
        this.conferirSaidaItens(
          s,
          e.local,
          e.itens.map((i: { item: number; quantidade: number }) => ({ ...i, lotes: [] })),
          r.hoje,
        );
        const doc = this.numerar(s, 'movimento', r.ano, r.mes);
        for (const it of e.itens) this.baixar(s, it.item, e.local, it.quantidade, []);
        return { id: doc, doc, itens: e.itens.length, ...(e.atendimento ? { atendimento: e.atendimento } : {}) };
      }
      case 'suprimentos.registrarBalanco': {
        const inv = s.inventarios.find((x) => x.id === e.inventario);
        if (!inv || inv.situacao !== 'aprovado')
          throw recusa('inventario-nao-aprovado', 'O inventário não foi aprovado.');
        if (inv.balanco) throw recusa('balanco-gravado', 'O balanço deste inventário já foi gravado.');
        const aj = ajusteDoInventario(
          inv.itens.map((x) => ({ item: x.item, saldoSistema: x.saldo, contagens: x.contagens })),
          inv.limitePct,
        );
        recusar(aj.recusa);
        const doc = this.numerar(s, 'balanco', r.ano, r.mes);
        const d = this.novoDocumento(s, 'balanco', r, usuario, { local: inv.local });
        d.doc = doc;
        for (const [k, l] of aj.linhas.entries()) {
          const i = this.item(s, l.item);
          const custo = i.estoque > 0 ? i.total / i.estoque : 0;
          if (l.diferenca > 0) this.entrar(s, l.item, inv.local, l.diferenca, reais(l.diferenca * custo), []);
          else this.baixar(s, l.item, inv.local, -l.diferenca, []);
          d.itens.push({
            id: (s.seq += 1),
            seq: k + 1,
            item: l.item,
            quantidade: l.diferenca,
            valor: reais(l.diferenca * custo),
            consolidado: true,
            lotes: [],
            devolvido: 0,
          });
        }
        inv.balanco = { ano: r.ano, mes: r.mes, doc };
        return { ano: r.ano, mes: r.mes, doc, inventario: inv.id };
      }
      case 'suprimentos.fecharMes': {
        const prox = proximoAFechar(s.fechados, r);
        if (prox.ano !== e.ano || prox.mes !== e.mes)
          throw recusa(
            'fora-de-ordem',
            `O próximo mês a fechar é ${String(prox.mes).padStart(2, '0')}/${prox.ano}.`,
          );
        if (e.ano * 100 + e.mes >= r.ano * 100 + r.mes)
          throw recusa('mes-corrente', 'O mês corrente só fecha depois de terminar.');
        s.fechados.push({ ano: e.ano, mes: e.mes, exportado: false });
        s.ocorrenciasMes.push({
          tipo: 'fechamento-mes',
          ano: e.ano,
          mes: e.mes,
          motivo: '',
          autor: usuario,
          em: agora(),
        });
        return { ano: e.ano, mes: e.mes };
      }
      case 'suprimentos.reabrirMes': {
        recusar(
          conferirReabertura(e, s.fechados, {
            podeReabrir: escopo.flags.desbloquearFechamento,
            motivo: e.motivo,
          }),
        );
        s.fechados = s.fechados.filter((x) => !(x.ano === e.ano && x.mes === e.mes));
        s.ocorrenciasMes.push({
          tipo: 'reabertura-mes',
          ano: e.ano,
          mes: e.mes,
          motivo: e.motivo,
          autor: usuario,
          em: agora(),
        });
        return { ano: e.ano, mes: e.mes };
      }
      case 'suprimentos.reporKitRastreavel': {
        const k = s.kits.find((x) => x.id === e.kit);
        if (!k) throw recusa('kit-inexistente', 'O carrinho não existe.');
        for (const i of e.itens) {
          const it = k.itens.find((x) => x.id === i.itemKit);
          if (!it) throw recusa('item-de-outro-kit', 'Há item que não é deste carrinho.');
          it.saldo = it.quantidade;
        }
        return { kit: k.id, itens: e.itens.length };
      }
      case 'suprimentos.desconsolidarDocumento': {
        const d = s.documentos.find(
          (x) =>
            x.tipo === e.tipo && x.id === e.documento,
        );
        if (!d) throw recusa('documento-inexistente', 'O documento não existe.');
        if (e.tipo !== 'nota')
          throw recusa('so-nota', 'Só a nota fiscal é desconsolidada aqui: para saída, use a devolução.');
        if (!d.consolidado) throw recusa('nao-consolidado', 'O documento não está consolidado.');
        for (const it of d.itens) this.baixar(s, it.item, d.local, it.quantidade, it.lotes);
        d.consolidado = false;
        d.ocorrencias.push({ tipo: 'desconsolidacao', motivo: e.motivo, autor: usuario, em: agora() });
        return { id: d.id };
      }
      case 'suprimentos.corrigirValidadeLote': {
        const l = s.lotes.find((x) => x.id === e.lote);
        if (!l) throw recusa('lote-inexistente', 'O lote não existe.');
        recusar(conferirCorrecaoValidade(l.validade, e.validade));
        l.validade = e.validade;
        return { id: l.id, ano: r.ano, mes: r.mes };
      }
      default:
        throw recusa('operacao-desconhecida', 'Operação não disponível nesta tela.');
    }
  }

  private paciente(atendimento: number | undefined): DocumentoM['paciente'] {
    if (!atendimento) return null;
    const a = ATENDIMENTOS.get(atendimento);
    return a ? { atendimento, nome: a.nome } : null;
  }

  private novoDocumento(
    s: Estado,
    tipo: TipoDocumentoEstoque,
    r: { hoje: string; ano: number; mes: number },
    usuario: string,
    o: Partial<DocumentoM> & { local: number },
  ): DocumentoM {
    const d: DocumentoM = {
      tipo,
      id: (s.seq += 1),
      ano: r.ano,
      mes: r.mes,
      doc: tipo === 'balanco' ? 0 : this.numerar(s, tipo, r.ano, r.mes),
      data: r.hoje,
      hora: horaAgora(),
      localDestino: null,
      destino: null,
      centroCusto: null,
      consolidado: true,
      usuario,
      observacao: '',
      paciente: null,
      nota: null,
      itens: [],
      ocorrencias: [],
      ...o,
    };
    s.documentos.push(d);
    return d;
  }

  private registrarSaida(
    s: Estado,
    e: RegistrarSaidaEntrada,
    usuario: string,
    r: { hoje: string; ano: number; mes: number },
    escopo: EscopoEstoque,
  ) {
    recusar(conferirCabecalhoSaida({ centroCusto: e.centroCusto, local: e.local }));
    recusar(
      conferirDestinoOrigem({
        destino: e.destino,
        origem: e.origem,
        paciente: e.destino === 5 ? null : (e.atendimento ?? null),
        terceiro: e.terceiro ? String(e.terceiro) : null,
      }),
    );
    this.exigirMesAberto(s, r);
    recusar(conferirLocal(escopo, e.local, (e.destino === 5 ? 'venda' : 'saida') as TipoMovimento));
    if (e.destino === 1) {
      const a = ATENDIMENTOS.get(e.atendimento ?? 0);
      if (!a || a.tipo !== 'I')
        throw recusa('atendimento-inexistente', 'O atendimento do paciente internado não existe.', {
          campos: ['atendimento'],
        });
      if (!a.conta)
        throw recusa(
          'sem-conta-convenio',
          'O paciente internado não tem conta de convênio aberta no período: abra ou reabra a conta antes.',
          { campos: ['atendimento'] },
        );
    }
    if (e.destino === 3) {
      const a = ATENDIMENTOS.get(e.atendimento ?? 0);
      if (!a || a.tipo !== 'E')
        throw recusa('atendimento-inexistente', 'O atendimento do paciente externo não existe.', {
          campos: ['atendimento'],
        });
      if (e.medico && !MEDICOS.has(e.medico))
        throw recusa('medico-inexistente', 'O médico não tem vínculo ativo.', { campos: ['medico'] });
    }
    if (e.destino === 5 && !TERCEIROS.has(e.terceiro ?? 0))
      throw recusa('terceiro-inexistente', 'O terceiro não está no cadastro de terceiros.', {
        campos: ['terceiro'],
      });
    for (const it of e.itens)
      if (it.prescritorControlado && !MEDICOS.has(it.prescritorControlado))
        throw recusa('prescritor-inexistente', 'O prescritor do controlado não tem vínculo ativo.', {
          campos: ['itens'],
        });
    // A requisição atendida: relida aberta (a trava do banco), os itens pedidos.
    let req: DocumentoM | null = null;
    const chaveReq = e.requisicao;
    if (chaveReq) {
      req =
        s.documentos.find(
          (d) => d.requisicao && d.id === chaveReq,
        ) ?? null;
      if (!req)
        throw recusa('requisicao-atendida', 'A requisição já foi atendida ou não existe mais.', {
          campos: ['requisicao'],
        });
      if (req.local !== e.local)
        throw recusa('local-da-requisicao', 'A requisição é de outro local de estoque.', {
          campos: ['local'],
        });
    }
    this.conferirSaidaItens(s, e.local, e.itens, r.hoje);
    let d: DocumentoM;
    if (!req) {
      d = this.novoDocumento(s, 'saida', r, usuario, {
        local: e.local,
        destino: e.destino,
        centroCusto: e.centroCusto,
        observacao: e.observacao ?? '',
        paciente:
          e.destino === 5
            ? { atendimento: e.terceiro ?? 0, nome: TERCEIROS.get(e.terceiro ?? 0) ?? '' }
            : this.paciente(e.atendimento),
      });
      e.itens.forEach((it: { item: number; quantidade: number }, k: number) =>
        d.itens.push({
          id: (s.seq += 1),
          seq: k + 1,
          item: it.item,
          quantidade: it.quantidade,
          valor: 0,
          consolidado: false,
          lotes: [],
          devolvido: 0,
        }),
      );
    } else {
      d = req;
      const atendidos = new Map<number, { item: number; quantidade: number }>(
        e.itens.map((i) => [i.seq ?? 0, i]),
      );
      const ficam: LancamentoM[] = [];
      for (const p of d.itens) {
        const a = atendidos.get(p.seq);
        if (!a || a.quantidade <= 0) continue;
        if (a.item !== p.item)
          throw recusa('item-da-requisicao', 'O item atendido não é o pedido.', { campos: ['itens'] });
        if (a.quantidade > p.quantidade)
          throw recusa('atendimento-maior', 'O atendimento passa da quantidade pedida.', {
            campos: ['itens'],
          });
        ficam.push({ ...p, quantidade: a.quantidade });
      }
      if (ficam.length === 0)
        throw recusa('nada-atendido', 'Atenda ao menos um item da requisição.', { campos: ['itens'] });
      d.itens = ficam;
      d.requisicao = false;
      d.usuario = usuario;
    }
    // Consolidação F → T: os gatilhos valorizam e baixam (e o outro sistema lança o item na conta do paciente).
    for (const l of d.itens) {
      const it = e.itens.find((x) => x.item === l.item && (req ? x.seq === l.seq : true));
      const b = this.baixar(s, l.item, d.local, l.quantidade, it?.lotes ?? []);
      l.valor = b.valor;
      l.lotes = b.lotes;
      l.consolidado = true;
    }
    d.consolidado = true;
    if ((d.destino === 1 || d.destino === 3) && d.paciente) {
      const lista = s.conta.get(d.paciente.atendimento) ?? [];
      for (const l of d.itens)
        lista.push({ item: l.item, quantidade: l.quantidade, doc: `${d.ano}/${d.mes}/${d.doc}` });
      s.conta.set(d.paciente.atendimento, lista);
    }
    return { id: d.id, ano: d.ano, mes: d.mes, doc: d.doc, itens: d.itens.length, cdc: e.centroCusto };
  }

  private registrarDevolucao(
    s: Estado,
    e: RegistrarDevolucaoEntrada,
    usuario: string,
    r: { hoje: string; ano: number; mes: number },
    escopo: EscopoEstoque,
  ) {
    this.exigirMesAberto(s, r);
    recusar(conferirLocal(escopo, e.local, 'devolucao'));
    const saida = s.documentos.find(
      (d) =>
        d.tipo === 'saida' &&
        !d.requisicao &&
        d.id === e.saida,
    );
    if (!saida || !saida.consolidado)
      throw recusa('saida-inexistente', 'A saída não existe ou não foi consolidada.', { campos: ['saida'] });
    if (saida.destino === 5)
      throw recusa('saida-a-terceiro', 'A saída a terceiro não volta por devolução.', { campos: ['saida'] });
    const d = this.novoDocumento(s, 'devolucao', r, usuario, {
      local: e.local,
      destino: saida.destino,
      centroCusto: saida.centroCusto,
      paciente: saida.paciente,
      observacao: e.observacao ?? '',
    });
    for (const [k, it] of (
      e.itens as {
        lancamentoSaida: number;
        item: number;
        quantidade: number;
        lotes: { loteSaida: number; quantidade: number }[];
      }[]
    ).entries()) {
      const l = saida.itens.find((x) => x.id === it.lancamentoSaida);
      if (!l || l.item !== it.item)
        throw recusa('item-fora-da-saida', 'O item devolvido não é desta saída.', { campos: ['itens'] });
      if (qtd3(l.devolvido + it.quantidade) > qtd3(l.quantidade))
        throw recusa(
          'quantidade-maior-que-a-saida',
          `Devolução maior que a saída: saiu ${l.quantidade} e já voltou ${l.devolvido}.`,
          { campos: ['itens'] },
        );
      const i = this.item(s, it.item);
      if (i.rastreavel && qtd3(it.lotes.reduce((a, b) => a + b.quantidade, 0)) !== qtd3(it.quantidade))
        throw recusa(
          'soma-dos-lotes',
          'A soma das quantidades por lote tem de ser igual à quantidade do item.',
          { campos: ['lotes'] },
        );
      const lotes = it.lotes.map((x) => {
        const ls = l.lotes.find((y) => y.id === x.loteSaida);
        if (!ls)
          throw recusa('lote-fora-da-saida', 'O lote devolvido não saiu nesta saída.', { campos: ['lotes'] });
        return { lote: ls.lote, validade: ls.validade, quantidade: x.quantidade };
      });
      // O valor da devolução é proporcional ao da saída (o gatilho); o lote volta ao local.
      const valor = reais((l.valor / l.quantidade) * it.quantidade);
      const usados = this.entrar(s, it.item, e.local, it.quantidade, valor, lotes);
      l.devolvido = qtd3(l.devolvido + it.quantidade);
      d.itens.push({
        id: (s.seq += 1),
        seq: k + 1,
        item: it.item,
        quantidade: it.quantidade,
        valor,
        consolidado: true,
        lotes: usados,
        devolvido: 0,
        lancamentoSaida: l.id,
      });
      if (saida.paciente && (saida.destino === 1 || saida.destino === 3)) {
        const lista = s.conta.get(saida.paciente.atendimento) ?? [];
        lista.push({ item: it.item, quantidade: -it.quantidade, doc: `${d.ano}/${d.mes}/${d.doc}` });
        s.conta.set(saida.paciente.atendimento, lista);
      }
    }
    return { id: d.id, ano: d.ano, mes: d.mes, doc: d.doc, itens: d.itens.length };
  }

  private transferir(
    s: Estado,
    e: TransferirEntrada,
    usuario: string,
    r: { hoje: string; ano: number; mes: number },
    escopo: EscopoEstoque,
  ) {
    this.exigirMesAberto(s, r);
    recusar(conferirTransferencia(escopo, e.origem, e.destino));
    let envio: EnvioM | null = null;
    if (e.envio) {
      envio = s.envios.find((x) => x.id === e.envio) ?? null;
      if (!envio || envio.etapa !== 'enviada')
        throw recusa('envio-recebido', 'O envio já foi recebido ou cancelado.');
      if (envio.origem !== e.origem || envio.destino !== e.destino)
        throw recusa('envio-de-outros-locais', 'O envio é de outros locais.');
    }
    this.conferirSaidaItens(s, e.origem, e.itens, r.hoje);
    const d = this.novoDocumento(s, 'transferencia', r, usuario, {
      local: e.origem,
      localDestino: e.destino,
      observacao: e.observacao ?? '',
    });
    for (const [k, it] of (
      e.itens as {
        item: number;
        quantidade: number;
        lotes: { lote: string; validade: string; quantidade: number }[];
      }[]
    ).entries()) {
      const i = this.item(s, it.item);
      const valor = reais((i.estoque > 0 ? i.total / i.estoque : 0) * it.quantidade);
      this.baixar(s, it.item, e.origem, it.quantidade, it.lotes);
      const usados = this.entrar(s, it.item, e.destino, it.quantidade, valor, it.lotes);
      d.itens.push({
        id: (s.seq += 1),
        seq: k + 1,
        item: it.item,
        quantidade: it.quantidade,
        valor,
        consolidado: true,
        lotes: usados,
        devolvido: 0,
      });
    }
    if (envio) {
      let divergente = false;
      for (const x of envio.itens) {
        const rec = e.itens.find((y: { item: number }) => y.item === x.item);
        x.recebida = rec ? rec.quantidade : 0;
        if (qtd3(x.recebida ?? 0) !== qtd3(x.quantidade)) divergente = true;
      }
      envio.etapa = divergente ? 'divergente' : 'recebida';
      envio.documento = { ano: d.ano, mes: d.mes, doc: d.doc };
    }
    return { id: d.id, ano: d.ano, mes: d.mes, doc: d.doc, itens: d.itens.length, envio: e.envio ?? 0 };
  }

  private registrarNota(
    s: Estado,
    e: RegistrarEntradaNFEntrada,
    usuario: string,
    r: { hoje: string; ano: number; mes: number },
    escopo: EscopoEstoque,
  ) {
    recusar(conferirCabecalhoNota(e, r.hoje));
    this.exigirMesAberto(s, r);
    recusar(conferirLocal(escopo, e.local, 'entrada'));
    if (!FORNECEDORES.has(e.fornecedor))
      throw recusa('fornecedor-inexistente', 'O fornecedor não está cadastrado.', { campos: ['fornecedor'] });
    if (
      s.documentos.some(
        (d) =>
          d.tipo === 'nota' &&
          d.nota?.fornecedor === e.fornecedor &&
          d.nota?.numero === e.numero &&
          d.nota?.serie === e.serie,
      )
    )
      throw recusa('nota-repetida', 'Esta nota do fornecedor já foi registrada.', { campos: ['numero'] });
    for (const it of e.itens) {
      const i = this.item(s, it.item);
      if (i.rastreavel && it.lotes.length === 0)
        throw recusa('sem-lote', `O item ${i.nome} é rastreável: informe o lote e a validade.`, {
          campos: ['lotes'],
        });
      for (const l of it.lotes) recusar(conferirLoteEntrada(l, r.hoje));
      if (
        it.lotes.length &&
        qtd3(it.lotes.reduce((a: number, b: { quantidade: number }) => a + b.quantidade, 0)) !==
          quantidadeEstoque(it)
      )
        throw recusa(
          'soma-dos-lotes',
          'A soma dos lotes tem de ser igual à quantidade do item (na unidade de estoque).',
          { campos: ['lotes'] },
        );
    }
    let pedido: PedidoM | null = null;
    if (e.pedido) {
      pedido = this.pedidoM(s, e.pedido.ano, e.pedido.doc);
      const conf = conferirNota(
        e.itens,
        pedido.itens.map((x) => ({
          item: x.item,
          quantidade: x.quantidade,
          comprada: x.comprada,
          valorUnitario:
            pedido!.propostas.find((p) => p.item === x.item && p.vencedor === 'T')?.valorUnitario ?? 0,
          entrega: null,
        })),
        e.tolerancias,
        r.hoje,
      );
      recusar(
        podeConsolidarNota(
          conf,
          e.aprovacaoComprador ? { aprovador: usuario, motivo: e.aprovacaoComprador } : null,
        ),
      );
    }
    const d = this.novoDocumento(s, 'nota', r, usuario, {
      local: e.local,
      observacao: e.observacao ?? '',
      nota: {
        fornecedor: e.fornecedor,
        fornecedorNome: FORNECEDORES.get(e.fornecedor) ?? '',
        numero: e.numero,
        serie: e.serie,
      },
    });
    for (const [k, it] of (
      e.itens as {
        item: number;
        quantidade: number;
        valorUnitario: number;
        fator: number;
        marca?: string;
        lotes: { lote: string; validade: string; quantidade: number }[];
      }[]
    ).entries()) {
      const q = quantidadeEstoque(it);
      const valor = reais(it.quantidade * it.valorUnitario);
      const usados = this.entrar(s, it.item, e.local, q, valor, it.lotes);
      d.itens.push({
        id: (s.seq += 1),
        seq: k + 1,
        item: it.item,
        quantidade: q,
        valor,
        consolidado: true,
        lotes: usados,
        devolvido: 0,
      });
      s.compras.push({
        item: it.item,
        data: r.hoje,
        fornecedor: e.fornecedor,
        nota: e.numero,
        quantidade: q,
        unitario: q > 0 ? reais(valor / q) : 0,
        marca: it.marca ?? '',
      });
      const pi = pedido?.itens.find((x) => x.item === it.item);
      if (pi) {
        pi.comprada = qtd3(pi.comprada + q);
        pi.estado = pi.comprada >= pi.quantidade ? 'C' : 'I';
      }
    }
    return { id: d.id, ano: d.ano, mes: d.mes, doc: d.doc, itens: d.itens.length };
  }

  private pedidoM(s: Estado, ano: number, doc: number): PedidoM {
    const p = s.pedidos.find((x) => x.ano === ano && x.doc === doc);
    if (!p) throw recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['pedido'] });
    return p;
  }

  async gravarSgh<T>(
    c: ContextoSuprimentos,
    _trilha: unknown,
    fn: (g: GravadorSghSuprimentos) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const g: GravadorSghSuprimentos = {
      aprovarPedido: async (a) => {
        const p = this.pedidoM(s, a.ano, a.doc);
        const v = valorPelosVencedores(p.propostas);
        const escopo = this.escopoDe(a.usuario);
        recusar(
          conferirAprovacaoPedido({
            valor: v.total,
            faixas: a.faixas,
            aprovador: { podeAutorizar: escopo.flags.autorizarPedido, nivel: a.nivel, login: a.usuario },
            solicitante: p.usuario,
            decisao: a.decisao,
            justificativa: a.justificativa,
            jaDecidido: p.aprovacao !== null,
          }),
        );
        if (v.parcelas.length === 0 && a.decisao === 'aprovado')
          throw recusa('sem-vencedor', 'O pedido ainda não tem vencedor escolhido na cotação.');
        const nivel = faixaDoValor(v.total, a.faixas).nivel;
        p.aprovacao = { decisao: a.decisao, aprovador: a.usuario, em: agora(), nivel };
        return { id: (s.seq += 1), valor: v.total, nivel };
      },
      enviarTransferencia: async (t) => {
        const r = this.competencia();
        recusar(conferirTransferencia(this.escopoDe(t.usuario), t.origem, t.destino));
        this.conferirSaidaItens(s, t.origem, t.itens, r.hoje);
        const id = (s.seq += 1);
        s.envios.push({
          id,
          origem: t.origem,
          destino: t.destino,
          etapa: 'enviada',
          enviadaPor: t.usuario,
          enviadaEm: agora(),
          observacao: t.observacao,
          itens: t.itens.map((x) => ({
            item: x.item,
            quantidade: x.quantidade,
            recebida: null,
            lotes: [...x.lotes],
          })),
          documento: null,
          motivo: null,
        });
        return id;
      },
      cancelarTransferencia: async (r) => {
        const x = s.envios.find((y) => y.id === r.id);
        if (!x || x.etapa !== 'enviada')
          throw recusa('envio-recebido', 'O envio já foi recebido ou cancelado.');
        if (x.enviadaPor !== r.usuario)
          recusar(conferirLocal(this.escopoDe(r.usuario), x.origem, 'transferenciaOrigem', 'origem'));
        x.etapa = 'cancelada';
        x.motivo = r.motivo;
      },
      registrarDivergencia: async (r) => {
        const x = s.envios.find((y) => y.id === r.id);
        if (x) x.motivo = r.motivo;
      },
      abrirInventario: async (i) => {
        if (i.itens.length === 0)
          throw recusa('inventario-sem-itens', 'Nenhum item com saldo neste local para inventariar.');
        if (
          s.inventarios.some(
            (x) => x.local === i.local && ['aberto', 'contagem', 'recontagem'].includes(x.situacao),
          )
        )
          throw recusa('inventario-aberto', 'Já há um inventário aberto neste local.');
        const id = (s.seq += 1);
        s.inventarios.push({
          id,
          local: i.local,
          tipo: i.tipo,
          situacao: 'contagem',
          abertoPor: i.usuario,
          abertoEm: agora(),
          limitePct: i.limitePct,
          itens: i.itens.map((x) => ({ item: x.item, saldo: x.saldo, contagens: [] })),
          balanco: null,
        });
        return id;
      },
      registrarContagem: async (c2) => {
        const inv = s.inventarios.find((x) => x.id === c2.inventario);
        if (!inv || !['contagem', 'recontagem'].includes(inv.situacao))
          throw recusa('inventario-fechado', 'O inventário não está em contagem.');
        const it = inv.itens.find((x) => x.item === c2.item);
        if (!it) throw recusa('item-fora-do-inventario', 'O item não faz parte deste inventário.');
        const av = avaliarItem(
          { item: it.item, saldoSistema: it.saldo, contagens: it.contagens },
          inv.limitePct,
        );
        if (av.situacao === 'ok' || av.situacao === 'divergente-confirmado')
          throw recusa('item-resolvido', 'O item já está contado.');
        if (it.contagens.length > 0)
          recusar(
            conferirRecontagem(
              { item: it.item, saldoSistema: it.saldo, contagens: it.contagens },
              c2.usuario,
            ),
          );
        it.contagens.push({ quantidade: c2.quantidade, contador: c2.usuario });
        const depois = avaliarItem(
          { item: it.item, saldoSistema: it.saldo, contagens: it.contagens },
          inv.limitePct,
        );
        if (depois.situacao === 'recontar') inv.situacao = 'recontagem';
        return { ordem: it.contagens.length };
      },
      decidirInventario: async (d) => {
        const inv = s.inventarios.find((x) => x.id === d.inventario);
        if (!inv) throw recusa('inventario-inexistente', 'O inventário não existe.');
        recusar(
          conferirAprovacao(
            inv.itens.map((x) => ({ item: x.item, saldoSistema: x.saldo, contagens: x.contagens })),
            d.usuario,
            d.podeAprovar,
          ),
        );
        if (d.decisao === 'aprovado') {
          const aj = ajusteDoInventario(
            inv.itens.map((x) => ({ item: x.item, saldoSistema: x.saldo, contagens: x.contagens })),
            inv.limitePct,
          );
          recusar(aj.recusa);
        }
        inv.situacao = d.decisao;
      },
      conferirCarrinho: async (k) => {
        const kit = s.kits.find((x) => x.id === k.kit);
        if (!kit) throw recusa('kit-inexistente', 'O carrinho não existe.');
        const ids = new Set(kit.itens.map((x) => x.id));
        if (k.conferidos.some((x) => !ids.has(x)))
          throw recusa('item-de-outro-kit', 'Há item conferido que não é deste carrinho.');
        if (k.conferidos.length < ids.size && !(k.pendencias ?? '').trim())
          throw recusa('sem-pendencia', 'Faltam itens no checklist: descreva a pendência.', {
            campos: ['pendencias'],
          });
        kit.conferencia = {
          lacre: k.lacre,
          conferente: k.usuario,
          em: agora(),
          pendencias: k.pendencias ?? '',
          completa: k.conferidos.length === ids.size,
        };
        return (s.seq += 1);
      },
      definirPontoPedido: async (p) => {
        s.pontos.set(chavePonto(p.item, p.local), {
          prazoDias: p.prazoDias,
          estoqueSeguranca: p.estoqueSeguranca,
        });
      },
      autorizarRequisicao: async (a) => {
        if (!this.escopoDe(a.usuario).flags.autorizarRequisicao)
          throw recusa('sem-autorizacao-requisicao', 'Seu usuário do estoque não autoriza requisição.');
        const d = s.documentos.find(
          (x) => x.requisicao && x.ano === a.ano && x.mes === a.mes && x.doc === a.doc,
        );
        if (!d) throw recusa('requisicao-atendida', 'A requisição já foi atendida ou não existe mais.');
        const k = `${a.ano}/${a.mes}/${a.doc}`;
        if (s.autorizacoes.has(k)) throw recusa('requisicao-autorizada', 'A requisição já foi autorizada.');
        s.autorizacoes.set(k, { por: a.usuario, em: agora() });
      },
    };
    return fn(g);
  }

  // ── Leituras ───────────────────────────────────────────────────────────────────────────────────────

  async relogio() {
    return this.competencia();
  }
  async locais() {
    return LOCAIS.map((l) => ({ ...l }));
  }
  async centrosCusto() {
    return CENTROS.map((x) => ({ ...x }));
  }
  async mesesFechados(c: ContextoSuprimentos) {
    return this.e(c).fechados.map((x) => ({ ...x }));
  }
  async buscarItens(c: ContextoSuprimentos, termo: string): Promise<ItemBusca[]> {
    const t = termo.trim().toUpperCase();
    return [...this.e(c).itens.values()]
      .filter((i) => !t || i.nome.includes(t) || String(i.codigo) === t)
      .slice(0, 50)
      .map((i) => ({
        codigo: i.codigo,
        nome: i.nome,
        unidade: i.unidade,
        rastreavel: i.rastreavel,
        controlado: i.controlado,
        antimicrobiano: i.antimicrobiano,
        consignado: i.consignado,
        ativo: true,
      }));
  }
  async itens(c: ContextoSuprimentos, codigos: readonly number[]) {
    const s = this.e(c);
    const r = new Map<number, ItemCadastroEstoque>();
    for (const k of codigos) {
      const i = s.itens.get(k);
      if (i)
        r.set(k, {
          codigo: i.codigo,
          nome: i.nome,
          rastreavel: i.rastreavel,
          controlado: i.controlado,
          consignado: i.consignado,
          estoque: i.estoque,
          total: i.total,
          custoMedio: i.estoque > 0 ? Math.round((i.total / i.estoque) * 10_000) / 10_000 : 0,
        });
    }
    return r;
  }
  private lotesSaldo(
    s: Estado,
    item: number,
    local: number,
    hoje: string,
    alertaDias: number,
  ): SaldoItem['lotes'] {
    return s.lotes
      .filter((l) => l.item === item && l.local === local && l.quantidade > 0)
      .sort((a, b) => a.validade.localeCompare(b.validade))
      .map((l) => ({
        id: l.id,
        lote: l.lote,
        validade: l.validade,
        quantidade: l.quantidade,
        diasParaVencer: diasParaVencer(l.validade, hoje),
        alerta: validadeSuspeita(l.validade)
          ? ('suspeita' as const)
          : vencido(l.validade, hoje)
            ? ('vencido' as const)
            : diasParaVencer(l.validade, hoje) <= alertaDias
              ? ('vence' as const)
              : ('nenhum' as const),
      }));
  }
  async saldos(
    c: ContextoSuprimentos,
    f: {
      item?: number;
      local?: number;
      termo?: string;
      comSaldo?: boolean;
      hoje: string;
      alertaDias: number;
    },
  ) {
    const s = this.e(c);
    const r = this.competencia();
    const itens: SaldoItem[] = [];
    for (const [k, q] of s.saldos) {
      const [item, local] = k.split(':').map(Number) as [number, number];
      if (f.item && f.item !== item) continue;
      if (f.local && f.local !== local) continue;
      if ((f.comSaldo ?? true) && q === 0) continue;
      const i = s.itens.get(item);
      if (!i) continue;
      if (f.termo && !i.nome.includes(f.termo.toUpperCase())) continue;
      const custo = i.estoque > 0 ? i.total / i.estoque : 0;
      itens.push({
        item,
        nome: i.nome,
        unidade: i.unidade,
        local,
        localNome: localNome(local),
        quantidade: q,
        valor: reais(q * custo),
        estoqueEmpresa: i.estoque,
        valorEmpresa: i.total,
        custoMedio: Math.round(custo * 10_000) / 10_000,
        minimo: null,
        maximo: null,
        rastreavel: i.rastreavel,
        controlado: i.controlado,
        lotes: this.lotesSaldo(s, item, local, f.hoje, f.alertaDias),
      });
    }
    itens.sort((a, b) => a.nome.localeCompare(b.nome) || a.local - b.local);
    return {
      competencia: { ano: r.ano, mes: r.mes },
      itens: itens.slice(0, 500),
      cortada: itens.length > 500,
    };
  }
  async lotesDoLocal(c: ContextoSuprimentos, item: number, local: number, hoje: string, alertaDias: number) {
    return this.lotesSaldo(this.e(c), item, local, hoje, alertaDias);
  }
  async fichaItem(c: ContextoSuprimentos, item: number) {
    const i = this.e(c).itens.get(item);
    if (!i) return null;
    return {
      item,
      classe: { codigo: 1, nome: 'MATERIAL HOSPITALAR' },
      grupo: { codigo: 10, nome: 'DESCARTAVEIS' },
      unidades: { compra: 'CX', armazenamento: i.unidade, consumo: i.unidade, prescricao: i.unidade },
      fatores: { compraConsumo: 100, consumoPrescricao: 1 },
    };
  }
  async posicaoMensal(c: ContextoSuprimentos, item: number): Promise<PosicaoMensal> {
    const s = this.e(c);
    const i = this.item(s, item);
    const r = this.competencia();
    return {
      item,
      nome: i.nome,
      meses: [{ ano: r.ano, mes: r.mes, quantidade: i.estoque, valor: i.total }],
      porLocal: LOCAIS.filter((l) => this.saldo(s, item, l.codigo) !== 0).map((l) => {
        const q = this.saldo(s, item, l.codigo);
        return {
          local: l.codigo,
          localNome: l.nome,
          quantidade: q,
          valor: i.estoque > 0 ? reais((i.total / i.estoque) * q) : 0,
        };
      }),
    };
  }
  private resumo(d: DocumentoM): DocumentoEstoque {
    return {
      tipo: d.requisicao ? 'requisicao' : d.tipo,
      id: d.id,
      chave: { ano: d.ano, mes: d.mes, doc: d.doc },
      data: d.data,
      hora: d.hora,
      local: d.local,
      localNome: localNome(d.local),
      localDestino: d.localDestino,
      destino: d.destino,
      centroCusto: d.centroCusto,
      consolidado: d.consolidado,
      usuario: d.usuario,
      itens: d.itens.length,
      valor: reais(d.itens.reduce((a, b) => a + b.valor, 0)),
      paciente: d.paciente,
      nota: d.nota,
    };
  }
  async documentos(
    c: ContextoSuprimentos,
    f: { tipo: TipoDocumentoEstoque; local?: number; inicio: string; fim: string; pagina?: number },
  ) {
    const desde = (Math.max(1, f.pagina ?? 1) - 1) * 200;
    const ls = this.e(c)
      .documentos.filter((d) =>
        f.tipo === 'requisicao' ? d.requisicao === true : d.tipo === f.tipo && !d.requisicao,
      )
      .filter(
        (d) =>
          (!f.local || d.local === f.local || d.localDestino === f.local) &&
          d.data >= f.inicio &&
          d.data <= f.fim,
      )
      .sort((a, b) => b.id - a.id)
      .map((d) => this.resumo(d));
    return { itens: ls.slice(desde, desde + 200), cortada: ls.length > desde + 200 };
  }
  async documento(
    c: ContextoSuprimentos,
    tipo: TipoDocumentoEstoque,
    chave: { ano: number; mes: number; doc: number },
  ): Promise<DocumentoDetalhe | null> {
    const s = this.e(c);
    const d = s.documentos.find(
      (x) =>
        (tipo === 'requisicao' ? x.tipo === 'saida' : x.tipo === tipo) &&
        x.ano === chave.ano &&
        x.mes === chave.mes &&
        x.doc === chave.doc,
    );
    if (!d) return null;
    return {
      ...this.resumo(d),
      observacao: d.observacao,
      itensDetalhe: d.itens.map((l) => ({
        id: l.id,
        seq: l.seq,
        item: l.item,
        nome: s.itens.get(l.item)?.nome ?? '',
        quantidade: l.quantidade,
        valor: l.valor,
        consolidado: l.consolidado,
        lotes: l.lotes.map((x) => ({ ...x })),
        devolvido: l.devolvido,
      })),
      ocorrencias: d.ocorrencias.map((x) => ({ ...x })),
    };
  }
  async requisicoes(c: ContextoSuprimentos, o: { local?: number }) {
    const s = this.e(c);
    const itens: RequisicaoPendente[] = s.documentos
      .filter((d) => d.requisicao && (!o.local || d.local === o.local))
      .map((d) => ({
        chave: { ano: d.ano, mes: d.mes, doc: d.doc },
        id: d.id,
        data: d.data,
        hora: d.hora,
        local: d.local,
        localNome: localNome(d.local),
        destino: d.destino ?? 2,
        centroCusto: d.centroCusto ?? 0,
        centroCustoNome: CENTROS.find((x) => x.codigo === d.centroCusto)?.nome ?? '',
        usuario: d.usuario,
        paciente: d.paciente,
        itens: d.itens.map((l) => ({
          seq: l.seq,
          item: l.item,
          nome: s.itens.get(l.item)?.nome ?? '',
          quantidade: l.quantidade,
          saldoLocal: this.saldo(s, l.item, d.local),
          rastreavel: s.itens.get(l.item)?.rastreavel ?? false,
        })),
        autorizacao: s.autorizacoes.get(`${d.ano}/${d.mes}/${d.doc}`) ?? null,
      }));
    return { itens, cortada: false };
  }
  async rastreio(c: ContextoSuprimentos, item: number, lote: string): Promise<RastreioLote> {
    const s = this.e(c);
    const i = this.item(s, item);
    const movimentos: RastreioLote['movimentos'] = [];
    for (const d of s.documentos) {
      if (d.requisicao) continue;
      for (const l of d.itens)
        for (const x of l.lotes)
          if (l.item === item && x.lote === lote)
            movimentos.push({
              tipo: d.tipo === 'nota' ? 'entrada' : d.tipo === 'requisicao' ? 'saida' : d.tipo,
              chave: { ano: d.ano, mes: d.mes, doc: d.doc },
              data: d.data,
              quantidade: x.quantidade,
              local: d.local,
              destino: d.destino,
              centroCusto: d.centroCusto,
              paciente: d.destino === 1 || d.destino === 3 ? d.paciente : null,
              fornecedor: d.nota?.fornecedorNome ?? null,
            });
    }
    const lotes = s.lotes.filter((l) => l.item === item && l.lote === lote);
    return {
      item,
      nome: i.nome,
      lote,
      validade: lotes[0]?.validade ?? null,
      saldos: lotes.map((l) => ({ local: l.local, localNome: localNome(l.local), quantidade: l.quantidade })),
      movimentos,
      pacientes: new Set(movimentos.filter((m) => m.paciente).map((m) => m.paciente!.atendimento)).size,
      cortada: false,
    };
  }
  async lotesDoPaciente(c: ContextoSuprimentos, atendimento: number): Promise<LotesDoPaciente> {
    const s = this.e(c);
    const itens: LotesDoPaciente['itens'] = [];
    for (const d of s.documentos)
      if (
        d.tipo === 'saida' &&
        !d.requisicao &&
        d.paciente?.atendimento === atendimento &&
        (d.destino === 1 || d.destino === 3)
      )
        for (const l of d.itens)
          for (const x of l.lotes)
            itens.push({
              item: l.item,
              nome: s.itens.get(l.item)?.nome ?? '',
              lote: x.lote,
              validade: x.validade,
              quantidade: x.quantidade,
              data: d.data,
              chave: { ano: d.ano, mes: d.mes, doc: d.doc },
            });
    return { atendimento, itens };
  }
  async consumo(
    c: ContextoSuprimentos,
    competencia: { ano: number; mes: number },
  ): Promise<Omit<ConsumoEstoque, 'fonte'>> {
    const s = this.e(c);
    const porCc = new Map<number, { quantidade: number; valor: number }>();
    const porLocal = new Map<
      number,
      { saida: number; devolucao: number; valorSaida: number; valorDevolucao: number }
    >();
    for (const d of s.documentos) {
      if (d.requisicao || d.ano !== competencia.ano || d.mes !== competencia.mes) continue;
      if (d.tipo !== 'saida' && d.tipo !== 'devolucao') continue;
      const sinal = d.tipo === 'saida' ? 1 : -1;
      const q = d.itens.reduce((a, b) => a + b.quantidade, 0);
      const v = d.itens.reduce((a, b) => a + b.valor, 0);
      if (d.centroCusto && !centroTecnico(d.centroCusto)) {
        const x = porCc.get(d.centroCusto) ?? { quantidade: 0, valor: 0 };
        x.quantidade = qtd3(x.quantidade + sinal * q);
        x.valor = reais(x.valor + sinal * v);
        porCc.set(d.centroCusto, x);
      }
      const y = porLocal.get(d.local) ?? { saida: 0, devolucao: 0, valorSaida: 0, valorDevolucao: 0 };
      if (sinal > 0) {
        y.saida = qtd3(y.saida + q);
        y.valorSaida = reais(y.valorSaida + v);
      } else {
        y.devolucao = qtd3(y.devolucao + q);
        y.valorDevolucao = reais(y.valorDevolucao + v);
      }
      porLocal.set(d.local, y);
    }
    const parcelas = [...porCc.values()].map((x) => x.valor);
    return {
      competencia,
      porCentroCusto: [...porCc.entries()].map(([k, x]) => ({
        centroCusto: k,
        nome: CENTROS.find((y) => y.codigo === k)?.nome ?? '',
        ...x,
        tecnico: centroTecnico(k),
      })),
      porLocal: [...porLocal.entries()].map(([k, x]) => ({ local: k, localNome: localNome(k), ...x })),
      total: { valor: reais(parcelas.reduce((a, b) => a + b, 0)), parcelas },
    };
  }
  async consumoMensalPorItem(
    c: ContextoSuprimentos,
    o: { local?: number; meses: readonly { ano: number; mes: number }[] },
  ) {
    const s = this.e(c);
    const r = new Map<number, { consumos: number[]; valor: number }>();
    for (const i of s.itens.values()) {
      const consumos = o.meses.map((m) =>
        s.documentos
          .filter(
            (d) =>
              d.tipo === 'saida' &&
              !d.requisicao &&
              d.ano === m.ano &&
              d.mes === m.mes &&
              (!o.local || d.local === o.local),
          )
          .flatMap((d) => d.itens)
          .filter((l) => l.item === i.codigo)
          .reduce((a, b) => a + b.quantidade, 0),
      );
      // Base sintética: o consumo médio do cadastro sintético nos meses sem documento.
      const base = consumos.map((x, k) => x + Math.round((i.codigo % 7) * 3 + k));
      r.set(i.codigo, {
        consumos: base,
        valor: reais(base.reduce((a, b) => a + b, 0) * (i.estoque > 0 ? i.total / i.estoque : 0)),
      });
    }
    return r;
  }
  async emPedidoPorItem(c: ContextoSuprimentos, desdeAno: number) {
    const r = new Map<number, number>();
    for (const p of this.e(c).pedidos)
      if (p.ano >= desdeAno)
        for (const i of p.itens)
          r.set(i.item, qtd3((r.get(i.item) ?? 0) + Math.max(0, i.quantidade - i.comprada)));
    return r;
  }
  private resumoPedido(p: PedidoM): PedidoResumo {
    const v = valorPelosVencedores(p.propostas);
    return {
      id: p.id,
      ano: p.ano,
      doc: p.doc,
      data: p.data,
      situacao: p.situacao,
      situacaoRotulo: SITUACOES_PEDIDO_COMPRA.find((x) => x.id === p.situacao)?.rotulo ?? 'Sem situação',
      centroCusto: p.centroCusto,
      centroCustoNome: CENTROS.find((x) => x.codigo === p.centroCusto)?.nome ?? '',
      tipoCompra: p.tipoCompra,
      usuario: p.usuario,
      itens: p.itens.length,
      fornecedores: new Set(p.propostas.map((x) => x.fornecedor)).size,
      valor: v,
      aprovacao: p.aprovacao,
    };
  }
  async pedidos(c: ContextoSuprimentos, o: { ano: number; situacao?: number; termo?: string }) {
    const ls = this.e(c)
      .pedidos.filter((p) => p.ano === o.ano && (o.situacao === undefined || p.situacao === o.situacao))
      .sort((a, b) => b.doc - a.doc)
      .map((p) => this.resumoPedido(p));
    return { itens: ls, cortada: false };
  }
  async pedido(c: ContextoSuprimentos, ano: number, doc: number): Promise<PedidoDetalhe | null> {
    const s = this.e(c);
    const p = s.pedidos.find((x) => x.ano === ano && x.doc === doc);
    if (!p) return null;
    return {
      ...this.resumoPedido(p),
      itensDetalhe: p.itens.map((i) => ({
        ...i,
        nome: s.itens.get(i.item)?.nome ?? '',
        estadoRotulo: ESTADOS_ITEM_PEDIDO[i.estado] ?? i.estado,
      })),
      propostas: p.propostas.map((x) => ({ ...x, fornecedorNome: FORNECEDORES.get(x.fornecedor) ?? '' })),
      escolhas: p.escolhas.map((x) => ({ ...x })),
      portal: [],
    };
  }
  async historicoCompras(c: ContextoSuprimentos, item: number): Promise<HistoricoCompra> {
    const s = this.e(c);
    const i = this.item(s, item);
    const compras = s.compras
      .filter((x) => x.item === item)
      .sort((a, b) => b.data.localeCompare(a.data))
      .map((x) => ({
        data: x.data,
        fornecedor: x.fornecedor,
        fornecedorNome: FORNECEDORES.get(x.fornecedor) ?? '',
        nota: x.nota,
        quantidade: x.quantidade,
        unitario: x.unitario,
        custo: reais(x.quantidade * x.unitario),
        marca: x.marca,
      }));
    return {
      item,
      nome: i.nome,
      compras,
      ultimoCusto: compras[0]?.unitario ?? null,
      menorUnitario: compras.length ? Math.min(...compras.map((x) => x.unitario)) : null,
      cortada: false,
    };
  }
  async fechamentos(
    c: ContextoSuprimentos,
    corrente: { ano: number; mes: number },
  ): Promise<FechamentosEstoque> {
    const s = this.e(c);
    return {
      fechados: [...s.fechados].sort((a, b) => b.ano * 100 + b.mes - (a.ano * 100 + a.mes)),
      proximo: proximoAFechar(s.fechados, corrente),
      ocorrencias: s.ocorrenciasMes.map((x) => ({ ...x })),
    };
  }
  async recalculos(): Promise<RecalculosEstoque> {
    return { itens: [] };
  }
  async parametros(c: ContextoSuprimentos, login: string): Promise<ParametrosEstoque> {
    const s = this.e(c);
    const r = this.competencia();
    return {
      usuario: login,
      parametros: [
        { chave: 'PED_NF', rotulo: 'Exige pedido na nota fiscal', valor: 'T' },
        { chave: 'UNI_DIG_COMP', rotulo: 'Unidade digitada na compra', valor: '1' },
      ],
      numeracao: ['saida', 'devolucao', 'transferencia', 'nota'].map((t) => ({
        tipo: t,
        competencia: `${String(r.mes).padStart(2, '0')}/${r.ano}`,
        ultimo: s.numeracao.get(`${t}:${r.ano}:${r.mes}`) ?? 0,
      })),
      sequencias: [
        {
          codigo: 2,
          nome: 'Pedido de compra',
          ano: r.ano,
          proximo: s.pedidos.filter((p) => p.ano === r.ano).length + 1,
        },
      ],
    };
  }
  async escopo(_c: ContextoSuprimentos, login: string): Promise<EscopoUsuarioEstoque | null> {
    const e = ESCOPOS[login];
    if (!e) return null;
    const rotulo: Record<string, string> = {
      S: 'S',
      E: 'E',
      D: 'D',
      TO: 'TO',
      TD: 'TD',
      I: 'I',
      R: 'R',
      V: 'V',
    };
    return {
      usuario: login,
      nome: login,
      locais: Object.entries(e.locais).map(([l, ts]) => ({
        local: Number(l),
        localNome: localNome(Number(l)),
        tipos: ts.map((t) => rotulo[t] ?? t),
      })),
      centrosCusto: e.centros.map((x) => ({
        codigo: x,
        nome: CENTROS.find((y) => y.codigo === x)?.nome ?? '',
      })),
      classes: [],
      flags: {
        autorizarRequisicao: e.flags.includes('autorizarRequisicao'),
        autorizarPedido: e.flags.includes('autorizarPedido'),
        autorizarNecessidade: false,
        desbloquearFechamento: e.flags.includes('desbloquearFechamento'),
        lancarControlado: true,
      },
    };
  }
  async terceiros(_c: ContextoSuprimentos, termo: string) {
    const t = termo.trim().toUpperCase();
    const itens = [
      { codigo: 1, nome: 'TERCEIRO SINTETICO UM' },
      { codigo: 2, nome: 'TERCEIRO SINTETICO DOIS' },
    ].filter((x) => !t || String(x.codigo) === t || x.nome.includes(t));
    return { itens, cortada: false };
  }
  async prestadores(_c: ContextoSuprimentos, termo: string) {
    const t = termo.trim().toUpperCase();
    const itens = [
      {
        codigo: 1,
        empresa: 1,
        nome: 'PRESTADOR SINTETICO',
        documento: '***.***.***-09',
        documentoValido: true,
        situacao: 'A',
        banco: '1 · conta ****42',
      },
    ].filter((x) => !t || String(x.codigo) === t || x.nome.includes(t));
    return { itens, cortada: false };
  }
  async fornecedores(_c: ContextoSuprimentos, termo: string) {
    const t = termo.trim().toUpperCase();
    // CNPJs sintéticos com dígitos válidos (gerados, de nenhuma empresa real conhecida).
    const docs: Record<number, string> = {
      7001: '11222333000181',
      7002: '45723174000110',
      7003: '60701190000104',
    };
    const itens = [...FORNECEDORES]
      .filter(([c, nome]) => !t || String(c) === t || nome.includes(t))
      .map(([codigo, nome]) => {
        const d = docs[codigo] ?? '';
        return {
          codigo,
          nome,
          fantasia: nome.split(' ').slice(0, 2).join(' '),
          pessoa: 'J' as const,
          documento: d
            ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
            : '',
          documentoValido: d ? cnpjValido(d) : false,
          cidade: 'CIDADE SINTÉTICA',
          uf: 'RJ',
          banco: codigo === 7001 ? '1 · conta ****42' : null,
        };
      });
    return { itens, cortada: false };
  }
  async usuarios(_c: ContextoSuprimentos, termo: string) {
    const t = termo.trim().toUpperCase();
    return Object.entries(ESCOPOS)
      .filter(([u]) => !t || u.includes(t))
      .map(([u, e]) => ({ usuario: u, nome: u, locais: Object.keys(e.locais).length }));
  }
  private kitLido(s: Estado, k: KitM, hoje: string, alertaDias: number): KitRastreavel {
    return {
      id: k.id,
      nome: k.nome,
      local: k.local,
      localNome: localNome(k.local),
      emergencial: k.emergencial,
      itens: k.itens.map((i) => ({ ...i, nome: s.itens.get(i.item)?.nome ?? '' })),
      conferencia: k.conferencia,
      vencendo: k.itens.filter((i) => i.validade && diasParaVencer(i.validade, hoje) <= alertaDias).length,
    };
  }
  async kits(c: ContextoSuprimentos, hoje: string, alertaDias: number) {
    const s = this.e(c);
    return s.kits.map((k) => this.kitLido(s, k, hoje, alertaDias));
  }
  async kit(c: ContextoSuprimentos, id: number, hoje: string, alertaDias: number) {
    const s = this.e(c);
    const k = s.kits.find((x) => x.id === id);
    return k ? this.kitLido(s, k, hoje, alertaDias) : null;
  }
  async kitsPadrao(c: ContextoSuprimentos) {
    const s = this.e(c);
    return [
      {
        codigo: 1,
        nome: 'KIT CURATIVO SIMPLES',
        itens: [{ item: 5001, nome: s.itens.get(5001)?.nome ?? '', quantidade: 1 }],
      },
    ];
  }
  async inventarios(c: ContextoSuprimentos) {
    return this.e(c).inventarios.map((x) => ({
      id: x.id,
      local: x.local,
      tipo: x.tipo,
      situacao: x.situacao,
      abertoEm: x.abertoEm,
    }));
  }
  async inventario(c: ContextoSuprimentos, id: number, cego: boolean): Promise<InventarioLido | null> {
    const s = this.e(c);
    const inv = s.inventarios.find((x) => x.id === id);
    if (!inv) return null;
    return {
      id: inv.id,
      local: inv.local,
      localNome: localNome(inv.local),
      tipo: inv.tipo,
      situacao: inv.situacao,
      abertoPor: inv.abertoPor,
      abertoEm: inv.abertoEm,
      limitePct: inv.limitePct,
      itens: inv.itens.map((i) => {
        const av = avaliarItem(
          { item: i.item, saldoSistema: i.saldo, contagens: i.contagens },
          inv.limitePct,
        );
        return {
          item: i.item,
          nome: s.itens.get(i.item)?.nome ?? '',
          contagens: i.contagens.length,
          saldo: cego ? null : i.saldo,
          contado: cego ? null : av.contado,
          diferenca: cego ? null : av.diferenca,
          divergenciaPct: cego ? null : av.divergenciaPct,
          situacao: av.situacao,
        };
      }),
      balanco: inv.balanco,
    };
  }
  async estoqueInicial() {
    return [];
  }
  async transferencias(
    c: ContextoSuprimentos,
    o: { local?: number; etapa?: string },
  ): Promise<TransferenciaEnviada[]> {
    const s = this.e(c);
    return s.envios
      .filter(
        (x) =>
          (!o.local || x.origem === o.local || x.destino === o.local) && (!o.etapa || x.etapa === o.etapa),
      )
      .sort((a, b) => b.id - a.id)
      .map((x) => ({
        id: x.id,
        origem: x.origem,
        origemNome: localNome(x.origem),
        destino: x.destino,
        destinoNome: localNome(x.destino),
        etapa: x.etapa,
        enviadaPor: x.enviadaPor,
        enviadaEm: x.enviadaEm,
        itens: x.itens.map((i) => ({
          item: i.item,
          nome: s.itens.get(i.item)?.nome ?? '',
          quantidade: i.quantidade,
          recebida: i.recebida,
        })),
        documento: x.documento,
      }));
  }
  async envio(c: ContextoSuprimentos, id: number) {
    const x = this.e(c).envios.find((y) => y.id === id);
    if (!x) return null;
    return {
      origem: x.origem,
      destino: x.destino,
      etapa: x.etapa,
      itens: x.itens.map((i) => ({
        item: i.item,
        quantidade: i.quantidade,
        lotes: i.lotes.length ? JSON.stringify(i.lotes) : null,
      })),
    };
  }
  async pontosPedido(c: ContextoSuprimentos, local?: number) {
    const r = new Map<string, { prazoDias: number; estoqueSeguranca: number | null }>();
    for (const [k, v] of this.e(c).pontos) if (!local || k.endsWith(`:${local}`)) r.set(k, v);
    return r;
  }

  // ── Onda 3 (M41): o painel de efeito, a conferência numérica e a regra 1, sobre os documentos sintéticos ──────

  /**
   * Os documentos gravados nesta sessão sintética são "do novo"; as demais estações têm contagens fixas sintéticas por
   * tipo e local. O efeito dos gatilhos é o que esta porta simula (valor, saldo mensal, lote), avaliado pela mesma regra
   * pura do banco real (efeitosDoDocumento).
   */
  async onda3(c: ContextoSuprimentos, dia: string, hoje: string): Promise<LeituraOnda3> {
    const s = this.e(c);
    const tipoOnda = (t: TipoDocumentoEstoque): TipoDocumentoOnda3 | null =>
      t === 'saida' || t === 'requisicao'
        ? 'saida'
        : t === 'devolucao' || t === 'transferencia' || t === 'nota'
          ? t
          : null;
    const doDia = s.documentos.filter((d) => d.data === dia && tipoOnda(d.tipo) !== null);
    const efeitos: EfeitoDocumentoNovo[] = [...doDia].reverse().map((d) => {
      const tipo = tipoOnda(d.tipo)!;
      const itens = d.itens.map((i) => {
        const cad = s.itens.get(i.item);
        return {
          item: i.item,
          valorMedio: i.consolidado ? (i.quantidade > 0 ? reais(i.valor / i.quantidade) : 0) : null,
          rastreavel: cad?.rastreavel ?? false,
          comLote: i.lotes.length > 0,
        };
      });
      const codigos = [...new Set(d.itens.map((i) => i.item))];
      const { efeitos: ef, alertas } = efeitosDoDocumento({
        tipo,
        consolidado: d.consolidado,
        itens,
        itensComSaldoMensal: d.consolidado ? codigos : [],
        comConsumo: tipo === 'saida' && d.centroCusto !== null && !centroTecnico(d.centroCusto) ? true : null,
        itensComSaldoLocal: codigos.filter((i) => s.saldos.has(chaveSaldo(i, d.local))),
      });
      return {
        operacao:
          d.tipo === 'requisicao' || d.requisicao
            ? 'suprimentos.requisitarMaterial'
            : `suprimentos.${
                {
                  saida: 'registrarSaida',
                  devolucao: 'registrarDevolucao',
                  transferencia: 'transferir',
                  nota: 'registrarEntradaNF',
                }[tipo as 'saida' | 'devolucao' | 'transferencia' | 'nota']
              }`,
        tipo,
        chave: { ano: d.ano, mes: d.mes, doc: d.doc },
        local: d.local,
        itens: d.itens.length,
        efeitos: ef,
        alertas,
      };
    });
    const demais: { tipo: TipoDocumentoOnda3; local: number | null; total: number }[] = [
      { tipo: 'saida', local: 10, total: 14 },
      { tipo: 'saida', local: 15, total: 6 },
      { tipo: 'devolucao', local: 10, total: 3 },
      { tipo: 'transferencia', local: 10, total: 2 },
      { tipo: 'dispensacao', local: 10, total: 9 },
    ];
    const novos = doDia.map((d) => ({ tipo: tipoOnda(d.tipo)!, local: d.tipo === 'nota' ? null : d.local }));
    const totais = [
      ...demais,
      ...novos.map((n) => ({ ...n, total: 1 })),
      // A nota entra no total sem local (o local está no item, como no banco).
    ];
    const requisicoes = new Map<number, number>();
    for (const d of s.documentos)
      if (d.requisicao && !d.consolidado) requisicoes.set(d.local, (requisicoes.get(d.local) ?? 0) + 1);
    void hoje;
    return {
      documentos: documentosPorSistema(totais, novos),
      efeitos,
      horarios: horariosPorUnidade([
        { unidade: 'CTI', prescritos: 48, dispensados: 40, dispensadosNovo: 0 },
        { unidade: '2A', prescritos: 24, dispensados: 12, dispensadosNovo: 0 },
      ]),
      requisicoes: [...requisicoes]
        .map(([local, pendentes]) => ({ local, localNome: localNome(local), pendentes }))
        .sort((a, b) => b.pendentes - a.pendentes),
      uso: LOCAIS.map((l, k) => ({
        local: l.codigo,
        localNome: l.nome,
        usuariosDoLocal: contagemAgregada(k === 0 ? 12 : 3),
        conectadosNaJanela: contagemAgregada(k === 0 ? 9 : 2),
      })),
      cortada: false,
    };
  }

  async onda3Numerica(c: ContextoSuprimentos, dia: string): Promise<LeituraNumericaOnda3[]> {
    const s = this.e(c);
    const pares = new Map<string, { item: number; local: number }>();
    for (const d of s.documentos.filter((x) => x.data === dia && x.tipo !== 'balanco'))
      for (const i of d.itens) pares.set(chaveSaldo(i.item, d.local), { item: i.item, local: d.local });
    return this.onda3LerPares(
      c,
      dia,
      [...pares.values()].sort((a, b) => a.item - b.item || a.local - b.local),
    );
  }

  async onda3LerPares(
    c: ContextoSuprimentos,
    _dia: string,
    pares: readonly { item: number; local: number | null }[],
  ): Promise<LeituraNumericaOnda3[]> {
    const s = this.e(c);
    return pares.slice(0, 500).map((p) => {
      const cad = s.itens.get(p.item);
      const empresa = [...s.saldos]
        .filter(([k]) => k.startsWith(`${p.item}:`))
        .reduce((t, [, v]) => t + v, 0);
      return {
        item: p.item,
        local: p.local,
        saldo: qtd3(p.local === null ? empresa : (s.saldos.get(chaveSaldo(p.item, p.local)) ?? 0)),
        precoMedio: cad && cad.estoque > 0 ? Math.round((cad.total / cad.estoque) * 10_000) / 10_000 : 0,
      };
    });
  }

  /** Sintético: o local 10 atende o CTI e a 2A; o novo só prescreve no CTI (a unidade-piloto da onda 2). */
  async onda3Regra1(): Promise<LeituraRegra1Onda3> {
    return {
      atendidas: [
        { local: 10, unidade: 'CTI', dispensacoes: 40 },
        { local: 10, unidade: '2A', dispensacoes: 12 },
      ],
      prescricoes: [{ unidade: 'CTI', n: 6 }],
    };
  }

  /** Testes e E2E: os itens lançados na conta do paciente (o que a consolidação do outro sistema faz). */
  contaDoPaciente(c: ContextoSuprimentos | null, atendimento: number) {
    const s = c ? this.e(c) : [...this.estados.values()][0];
    return [...(s?.conta.get(atendimento) ?? [])];
  }
}
