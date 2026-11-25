// Porta do cadastro do estoque EM MEMÓRIA (F3.6, 05-SUP linhas 1, 3 e 6): a sessão sintética de dev/ci (E2E) grava o
// item, o local e o escopo do usuário SINTÉTICOS com as mesmas regras do domínio e as mesmas recusas da porta própria
// (código repetido, referência inexistente, subgrupo de outro grupo, código de barras de outro item, item com saldo ou
// movimento que não troca a unidade, inativação recusada com saldo, versão lida vencida). Os itens semeados são os do
// estoque em memória (5001 a 5006), para a lista de itens abrir a ficha de edição. Nada vai ao banco; nenhum nome é
// de pessoa real. A prova do que fica no banco é o contrato de efeito da porta própria.
import {
  conferirAlteracaoItem,
  conferirAlvoConcessaoClassificacao,
  conferirConcessaoVigente,
  conferirEscopoLocal,
  conferirInativacaoItem,
  conferirInativacaoLocal,
  conferirItemEstoque,
  conferirLocalEstoque,
  type ItemEstoqueEntrada,
  type LocalEstoqueEntrada,
  type PermissaoLocalUsuario,
  type RecusaCadastroEstoque,
  retiradaDaConcessao,
  situacaoRegistroNaData,
} from '@sgh/contratos/regras-suprimentos';
import { erroConflitoVersao, recusa } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type {
  ApoioCadastroEstoque,
  ConcessaoClassificacaoAlvo,
  ConcessaoEntrada,
  ConcessaoVigente,
  EscopoCompletoUsuario,
  FichaItemEdicao,
  FichaLocalEdicao,
  ListaSeparacao,
  LocalResumo,
  Opcao,
  PortaCadastroEstoque,
} from './cadastro-estoque-porta.js';

const op = (id: number, codigo: string, nome: string, grupo?: number): Opcao => ({
  id,
  codigo,
  nome,
  ...(grupo ? { grupo } : {}),
});

export const APOIO_SINTETICO = {
  grupos: [op(1, 'MED', 'MEDICAMENTOS SINTETICOS'), op(2, 'MAT', 'MATERIAIS SINTETICOS')],
  subgrupos: [
    op(11, 'ANALG', 'ANALGESICOS SINTETICOS', 1),
    op(12, 'ANTIM', 'ANTIMICROBIANOS SINTETICOS', 1),
    op(21, 'DESC', 'DESCARTAVEIS SINTETICOS', 2),
  ],
  unidades: [
    op(1, 'UN', 'UNIDADE'),
    op(2, 'CX', 'CAIXA'),
    op(3, 'AMP', 'AMPOLA'),
    op(4, 'FA', 'FRASCO-AMPOLA'),
    op(5, 'MG', 'MILIGRAMA'),
    op(6, 'ML', 'MILILITRO'),
  ],
  vias: [op(1, 'VO', 'ORAL'), op(2, 'IV', 'INTRAVENOSA'), op(3, 'IM', 'INTRAMUSCULAR')],
  setores: [op(101, 'UTI', 'UTI SINTETICA'), op(102, 'CLM', 'CLINICA MEDICA SINTETICA')],
  centrosCusto: [op(101, 'CC101', 'CENTRO DE CUSTO SINTETICO 101'), op(102, 'CC102', 'CENTRO DE CUSTO 102')],
  guardas: [op(1, 'AMB', 'TEMPERATURA AMBIENTE'), op(2, 'REF', 'REFRIGERADO (2 A 8 GRAUS)')],
  despesas: [op(1, 'MAT', 'MATERIAIS SINTETICOS'), op(2, 'MED', 'MEDICAMENTOS SINTETICOS')],
  diluentes: [op(1, 'SF', 'CLORETO DE SODIO 0,9%'), op(2, 'SG', 'GLICOSE 5%')],
} as const;
const PRINCIPIOS = [
  op(501, 'DIP', 'DIPIRONA SINTETICA'),
  op(502, 'MOR', 'MORFINA SINTETICA'),
  op(503, 'CEF', 'CEFTRIAXONA SINTETICA'),
];
const FABRICANTES = [
  op(601, 'ALFA', 'LABORATORIO SINTETICO ALFA'),
  op(602, 'BETA', 'INDUSTRIA SINTETICA BETA'),
];
const USUARIOS = [
  op(9001, 'SINT.ALMOXARIFE', 'ALMOXARIFE SINTETICO'),
  op(9002, 'SINT.ENFERMEIRO', 'ENFERMEIRO SINTETICO'),
];

interface ItemM {
  id: number;
  versao: number;
  situacao: 'ativo' | 'inativo' | 'em_analise';
  dados: ItemEstoqueEntrada;
  saldoTotal: number;
  movimentos: number;
  requisicoesAbertas: number;
  pedidosAbertos: number;
}
interface LocalM {
  id: number;
  versao: number;
  ativo: boolean;
  estabelecimento: number | null;
  dados: LocalEstoqueEntrada;
  saldoTotal: number;
  requisicoesAbertas: number;
}
interface ConcessaoM {
  id: number;
  usuario: number;
  estabelecimento: number | null;
  alvo: number | null;
  alvo2: number | null;
  despesa: number | null;
  inicio: string;
  fim: string | null;
  permissoes: string[];
  cancelada: boolean;
}
interface EscopoM {
  usuario: number;
  local: number;
  permissoes: PermissaoLocalUsuario[];
  variacaoValorPct: number | null;
  padrao: boolean;
}
interface Estado {
  seq: number;
  itens: Map<number, ItemM>;
  locais: Map<number, LocalM>;
  escopos: Map<string, EscopoM>;
  classificacoes: ConcessaoM[];
  centros: ConcessaoM[];
}

const hojeLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** As recusas do domínio viram um 409 com todos os campos (nada gravado), como na porta própria. */
function recusarTodas(f: readonly RecusaCadastroEstoque[]): void {
  if (f.length)
    throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(f.flatMap((x) => x.campos ?? []))],
    });
}
const recusarUma = (x: RecusaCadastroEstoque | null) => recusarTodas(x ? [x] : []);

const itemBase = (
  codigo: string,
  nome: string,
  tipo: ItemEstoqueEntrada['tipo'],
  unidadeEstoque: number,
  mais: Partial<ItemEstoqueEntrada> = {},
): ItemEstoqueEntrada => ({
  codigo,
  nome,
  nomeResumido: null,
  tipo,
  grupo: tipo === 'medicamento' ? 1 : 2,
  subgrupo: null,
  unidadeEstoque,
  unidadeCompra: null,
  fatorCompraEstoque: 1,
  unidadeConsumo: null,
  fatorEstoqueConsumo: 1,
  unidadePrescricao: null,
  fatorConsumoPrescricao: 1,
  fabricante: null,
  gtin: null,
  ncm: null,
  cest: null,
  classeRisco: null,
  controlaLote: false,
  controlaValidade: false,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: false,
  estoqueMinimo: null,
  estoqueMaximo: null,
  principiosAtivos: [],
  vias: [],
  codigosBarras: [],
  apresentacoes: [],
  estabilidades: [],
  ...mais,
});

const localBase = (
  codigo: string,
  nome: string,
  tipo: LocalEstoqueEntrada['tipo'],
  mais: Partial<LocalEstoqueEntrada> = {},
): LocalEstoqueEntrada => ({
  codigo,
  nome,
  tipo,
  setor: null,
  centroCusto: null,
  localOrigem: null,
  localDevolucao: null,
  atendeSetor: true,
  atendePaciente: false,
  atendeTransferencia: true,
  atendimentoParcial: true,
  verificaSaldo: true,
  usaCodigoBarras: false,
  apenasUrgente: false,
  tipoReposicao: null,
  horasAntecedencia: null,
  setores: [],
  classificacoes: [],
  ...mais,
});

export class PortaCadastroEstoqueMemoria implements PortaCadastroEstoque {
  readonly destino = 'memoria' as const;
  private readonly porCliente = new Map<string, Estado>();

  constructor(private readonly hoje: () => string = hojeLocal) {}

  private e(c: ContextoPortaM18): Estado {
    const chave = String(c.cliente ?? '');
    let s = this.porCliente.get(chave);
    if (!s) {
      s = this.semear(c.estabelecimento ?? null);
      this.porCliente.set(chave, s);
    }
    return s;
  }

  private semear(est: number | null): Estado {
    const s: Estado = {
      seq: 36_100,
      itens: new Map(),
      locais: new Map(),
      escopos: new Map(),
      classificacoes: [],
      centros: [],
    };
    const item = (id: number, dados: ItemEstoqueEntrada, saldoTotal: number, abertas = 0) =>
      s.itens.set(id, {
        id,
        versao: 1,
        situacao: 'ativo',
        dados,
        saldoTotal,
        movimentos: saldoTotal > 0 ? 1 : 0,
        requisicoesAbertas: abertas,
        pedidosAbertos: 0,
      });
    // Os mesmos itens do estoque em memória (a lista de itens abre a edição pelo código).
    item(5001, itemBase('5001', 'LUVA DE PROCEDIMENTO TAMANHO M', 'material', 2), 130);
    item(5002, itemBase('5002', 'SERINGA DESCARTÁVEL 10 ML', 'material', 1), 1000);
    const lote = { controlaLote: true, controlaValidade: true };
    item(
      5003,
      itemBase('5003', 'DIPIRONA SÓDICA 500 MG/ML AMPOLA 2 ML', 'medicamento', 3, {
        ...lote,
        prescritivel: true,
        principiosAtivos: [{ principio: 501, concentracao: 500, unidade: 5, principal: true }],
        vias: [{ via: 2, padrao: true }],
      }),
      360,
    );
    item(
      5004,
      itemBase('5004', 'MORFINA 10 MG/ML AMPOLA 1 ML', 'medicamento', 3, {
        ...lote,
        controlado: true,
        altaVigilancia: true,
        prescritivel: true,
        principiosAtivos: [{ principio: 502, concentracao: 10, unidade: 5, principal: true }],
        vias: [{ via: 2, padrao: true }],
      }),
      40,
    );
    item(
      5005,
      itemBase('5005', 'CEFTRIAXONA 1 G FRASCO-AMPOLA', 'medicamento', 4, {
        ...lote,
        antimicrobiano: true,
        prescritivel: true,
        principiosAtivos: [{ principio: 503, concentracao: 1000, unidade: 5, principal: true }],
        vias: [{ via: 2, padrao: true }],
      }),
      90,
    );
    item(5006, itemBase('5006', 'CATETER INTRAVENOSO 20G', 'material', 1), 4);
    // Sem saldo e sem movimento, mas pedido em requisição aberta: a inativação é recusada pelo outro motivo.
    item(5090, itemBase('5090', 'ESPARADRAPO SINTETICO 10 CM', 'material', 1), 0, 1);
    const local = (id: number, dados: LocalEstoqueEntrada, saldoTotal: number) =>
      s.locais.set(id, {
        id,
        versao: 1,
        ativo: true,
        estabelecimento: est,
        dados,
        saldoTotal,
        requisicoesAbertas: 0,
      });
    local(10, localBase('ALM', 'ALMOXARIFADO CENTRAL SINTETICO', 'almoxarifado'), 1314);
    local(
      15,
      localBase('FAR', 'FARMACIA CENTRAL SINTETICA', 'farmacia_central', {
        atendePaciente: true,
        localOrigem: 10,
        setores: [{ setor: 101, tipo: 'ambos', padrao: true }],
      }),
      310,
    );
    local(20, localBase('POS', 'POSTO SINTETICO DA CLINICA MEDICA', 'posto', { localOrigem: 15 }), 0);
    s.escopos.set('9001|10', {
      usuario: 9001,
      local: 10,
      permissoes: ['requisitar', 'atender', 'receberNota'],
      variacaoValorPct: null,
      padrao: true,
    });
    return s;
  }

  // ── Apoio e busca ────────────────────────────────────────────────────────────────────────────────────────────

  async apoio(c: ContextoPortaM18): Promise<ApoioCadastroEstoque> {
    const s = this.e(c);
    return {
      hoje: this.hoje(),
      grupos: [...APOIO_SINTETICO.grupos],
      subgrupos: [...APOIO_SINTETICO.subgrupos],
      unidades: [...APOIO_SINTETICO.unidades],
      vias: [...APOIO_SINTETICO.vias],
      setores: [...APOIO_SINTETICO.setores],
      centrosCusto: [...APOIO_SINTETICO.centrosCusto],
      locais: this.locaisDe(s, c)
        .filter((l) => l.ativo)
        .map((l) => op(l.id, l.dados.codigo, l.dados.nome)),
      guardas: [...APOIO_SINTETICO.guardas],
      despesas: [...APOIO_SINTETICO.despesas],
      diluentes: [...APOIO_SINTETICO.diluentes],
    };
  }

  async buscar(
    _c: ContextoPortaM18,
    tipo: 'principios' | 'fabricantes' | 'usuarios',
    termo: string,
  ): Promise<Opcao[]> {
    const lista = tipo === 'principios' ? PRINCIPIOS : tipo === 'fabricantes' ? FABRICANTES : USUARIOS;
    const alvo = termo.trim().toUpperCase();
    return alvo ? lista.filter((o) => o.nome.includes(alvo) || o.codigo.toUpperCase().includes(alvo)) : [];
  }

  // ── Item ─────────────────────────────────────────────────────────────────────────────────────────────────────

  async fichaItem(c: ContextoPortaM18, id: number): Promise<FichaItemEdicao | null> {
    const i = this.e(c).itens.get(id);
    if (!i) return null;
    const hoje = this.hoje();
    const fabricantes = [i.dados.fabricante, ...i.dados.apresentacoes.map((a) => a.fabricante)];
    return {
      ...structuredClone(i.dados),
      id: i.id,
      versao: i.versao,
      situacao: i.situacao,
      saldoTotal: i.saldoTotal,
      registrosNaData: i.dados.apresentacoes.map((a) =>
        a.registro
          ? situacaoRegistroNaData(a.registro.situacao ?? 'valido', a.registro.validade, hoje)
          : null,
      ),
      nomesPrincipios: Object.fromEntries(
        i.dados.principiosAtivos.map((p) => [
          p.principio,
          PRINCIPIOS.find((x) => x.id === p.principio)?.nome ?? '',
        ]),
      ),
      nomesFabricantes: Object.fromEntries(
        fabricantes
          .filter((x): x is number => x != null)
          .map((x) => [x, FABRICANTES.find((o) => o.id === x)?.nome ?? '']),
      ),
    };
  }

  /** As referências do item existem (a recusa aponta o campo), como na porta própria. */
  private referenciasItem(e: ItemEstoqueEntrada): void {
    const existe = (
      lista: readonly Opcao[],
      id: number | null | undefined,
      campo: string,
      nome: string,
      sufixo = ' inexistente ou inativo.',
    ) => {
      if (id === null || id === undefined) return;
      if (!lista.some((x) => x.id === id))
        throw recusa('referencia-inexistente', `${nome}${sufixo}`, { campos: [campo] });
    };
    existe(APOIO_SINTETICO.grupos, e.grupo, 'grupo', 'Grupo');
    if (e.subgrupo && APOIO_SINTETICO.subgrupos.find((x) => x.id === e.subgrupo)?.grupo !== e.grupo)
      throw recusa('subgrupo-fora-do-grupo', 'O subgrupo não pertence ao grupo escolhido.', {
        campos: ['subgrupo'],
      });
    const un = APOIO_SINTETICO.unidades;
    existe(un, e.unidadeEstoque, 'unidadeEstoque', 'Unidade de estoque');
    existe(un, e.unidadeCompra, 'unidadeCompra', 'Unidade de compra');
    existe(un, e.unidadeConsumo, 'unidadeConsumo', 'Unidade de consumo');
    existe(un, e.unidadePrescricao, 'unidadePrescricao', 'Unidade de prescrição');
    existe(FABRICANTES, e.fabricante, 'fabricante', 'Fabricante');
    for (const p of e.principiosAtivos) {
      existe(PRINCIPIOS, p.principio, 'principiosAtivos', 'Princípio ativo');
      existe(un, p.unidade, 'principiosAtivos', 'Unidade da concentração');
    }
    for (const v of e.vias) existe(APOIO_SINTETICO.vias, v.via, 'vias', 'Via de uso');
    for (const b of e.codigosBarras) existe(un, b.unidade, 'codigosBarras', 'Unidade do código de barras');
    for (const a of e.apresentacoes)
      existe(FABRICANTES, a.fabricante, 'apresentacoes', 'Fabricante da apresentação');
    for (const x of e.estabilidades) {
      existe(APOIO_SINTETICO.guardas, x.condicaoArmazenamento, 'estabilidades', 'Condição de guarda');
      existe(APOIO_SINTETICO.diluentes, x.diluente, 'estabilidades', 'Diluente');
    }
  }

  private unicidadeItem(s: Estado, id: number | null, e: ItemEstoqueEntrada): void {
    const codigo = e.codigo.trim();
    for (const o of s.itens.values()) {
      if (o.id === id) continue;
      if (o.dados.codigo.trim() === codigo)
        throw recusa('item-codigo-existente', `Já existe item com o código ${codigo}.`, {
          campos: ['codigo'],
        });
      const barras = e.codigosBarras.find((b) => o.dados.codigosBarras.some((x) => x.codigo === b.codigo));
      if (barras)
        throw recusa('codigo-barras-de-outro-item', `O código ${barras.codigo} já é de outro item.`, {
          campos: ['codigosBarras'],
        });
    }
  }

  async incluirItem(c: ContextoPortaM18, e: ItemEstoqueEntrada) {
    recusarTodas(conferirItemEstoque(e));
    const s = this.e(c);
    this.unicidadeItem(s, null, e);
    this.referenciasItem(e);
    const id = (s.seq += 1);
    s.itens.set(id, {
      id,
      versao: 1,
      situacao: 'ativo',
      dados: structuredClone(e),
      saldoTotal: 0,
      movimentos: 0,
      requisicoesAbertas: 0,
      pedidosAbertos: 0,
    });
    return { id, versao: 1 };
  }

  async alterarItem(c: ContextoPortaM18, id: number, versao: number, e: ItemEstoqueEntrada) {
    recusarTodas(conferirItemEstoque(e));
    const s = this.e(c);
    const atual = s.itens.get(id);
    if (!atual) throw recusa('item-inexistente', 'Item inexistente.', { campos: ['id'] });
    recusarTodas(conferirAlteracaoItem(atual.dados, e, atual));
    this.unicidadeItem(s, id, e);
    this.referenciasItem(e);
    if (atual.versao !== versao) throw erroConflitoVersao(['versao']);
    atual.dados = structuredClone(e);
    atual.versao += 1;
    return { id, versao: atual.versao };
  }

  async situacaoItem(c: ContextoPortaM18, id: number, versao: number, ativo: boolean, motivo: string) {
    const i = this.e(c).itens.get(id);
    if (!i) throw recusa('item-inexistente', 'Item inexistente.', { campos: ['id'] });
    if (!ativo) recusarUma(conferirInativacaoItem({ motivo, ...i }));
    else if (motivo.trim().length < 5)
      throw recusa('reativar-sem-motivo', 'Informe o motivo da reativação.', { campos: ['motivo'] });
    if (i.versao !== versao) throw erroConflitoVersao(['versao']);
    i.situacao = ativo ? 'ativo' : 'inativo';
    i.versao += 1;
    return { id, versao: i.versao };
  }

  // ── Local ────────────────────────────────────────────────────────────────────────────────────────────────────

  private locaisDe(s: Estado, c: ContextoPortaM18): LocalM[] {
    return [...s.locais.values()].filter((l) => l.estabelecimento === (c.estabelecimento ?? null));
  }

  private localDe(s: Estado, c: ContextoPortaM18, id: number): LocalM {
    const l = s.locais.get(id);
    if (!l || l.estabelecimento !== (c.estabelecimento ?? null))
      throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
        campos: ['local'],
      });
    return l;
  }

  async locais(c: ContextoPortaM18): Promise<LocalResumo[]> {
    const s = this.e(c);
    return this.locaisDe(s, c)
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.dados.nome.localeCompare(b.dados.nome))
      .map((l) => ({
        id: l.id,
        codigo: l.dados.codigo,
        nome: l.dados.nome,
        tipo: l.dados.tipo,
        ativo: l.ativo,
        versao: l.versao,
        usuarios: [...s.escopos.values()].filter((x) => x.local === l.id).length,
      }));
  }

  async fichaLocal(c: ContextoPortaM18, id: number): Promise<FichaLocalEdicao | null> {
    const l = this.e(c).locais.get(id);
    if (!l || l.estabelecimento !== (c.estabelecimento ?? null)) return null;
    return { ...structuredClone(l.dados), id: l.id, versao: l.versao, ativo: l.ativo };
  }

  private conferirLocal(s: Estado, c: ContextoPortaM18, id: number | null, e: LocalEstoqueEntrada): void {
    recusarTodas(conferirLocalEstoque(e, id));
    if (this.locaisDe(s, c).some((o) => o.id !== id && o.dados.codigo.trim() === e.codigo.trim()))
      throw recusa('local-codigo-existente', `Já existe local com o código ${e.codigo.trim()}.`, {
        campos: ['codigo'],
      });
    const ref = (ok: boolean, campo: string, nome: string) => {
      if (!ok)
        throw recusa('referencia-inexistente', `${nome} inexistente neste estabelecimento.`, {
          campos: [campo],
        });
    };
    const local = (x: number | null | undefined) => x == null || this.locaisDe(s, c).some((o) => o.id === x);
    const em = (lista: readonly Opcao[], x: number | null | undefined) =>
      x == null || lista.some((o) => o.id === x);
    ref(em(APOIO_SINTETICO.setores, e.setor), 'setor', 'Setor');
    ref(em(APOIO_SINTETICO.centrosCusto, e.centroCusto), 'centroCusto', 'Centro de custo');
    ref(local(e.localOrigem), 'localOrigem', 'Local que abastece');
    ref(local(e.localDevolucao), 'localDevolucao', 'Local de devolução');
    for (const x of e.setores) ref(em(APOIO_SINTETICO.setores, x.setor), 'setores', 'Setor atendido');
    for (const x of e.classificacoes) {
      ref(em(APOIO_SINTETICO.grupos, x.grupo), 'classificacoes', 'Grupo');
      ref(em(APOIO_SINTETICO.subgrupos, x.subgrupo), 'classificacoes', 'Subgrupo');
      ref(x.item == null || s.itens.has(x.item), 'classificacoes', 'Item');
    }
  }

  async incluirLocal(c: ContextoPortaM18, e: LocalEstoqueEntrada) {
    const s = this.e(c);
    this.conferirLocal(s, c, null, e);
    const id = (s.seq += 1);
    s.locais.set(id, {
      id,
      versao: 1,
      ativo: true,
      estabelecimento: c.estabelecimento ?? null,
      dados: structuredClone(e),
      saldoTotal: 0,
      requisicoesAbertas: 0,
    });
    return { id, versao: 1 };
  }

  async alterarLocal(c: ContextoPortaM18, id: number, versao: number, e: LocalEstoqueEntrada) {
    const s = this.e(c);
    const l = this.localDe(s, c, id);
    this.conferirLocal(s, c, id, e);
    if (l.versao !== versao) throw erroConflitoVersao(['versao']);
    l.dados = structuredClone(e);
    l.versao += 1;
    return { id, versao: l.versao };
  }

  async situacaoLocal(c: ContextoPortaM18, id: number, versao: number, ativo: boolean, motivo: string) {
    const l = this.localDe(this.e(c), c, id);
    if (!ativo) recusarUma(conferirInativacaoLocal({ motivo, ...l }));
    else if (motivo.trim().length < 5)
      throw recusa('reativar-sem-motivo', 'Informe o motivo da reativação.', { campos: ['motivo'] });
    if (l.versao !== versao) throw erroConflitoVersao(['versao']);
    l.ativo = ativo;
    l.versao += 1;
    return { id, versao: l.versao };
  }

  // ── Escopo do usuário ────────────────────────────────────────────────────────────────────────────────────────

  private usuario(id: number): Opcao {
    const u = USUARIOS.find((x) => x.id === id);
    if (!u) throw recusa('usuario-inexistente', 'Usuário inexistente.', { campos: ['usuario'] });
    return u;
  }

  private vigentes(
    lista: readonly ConcessaoM[],
    c: ContextoPortaM18,
    usuario: number,
    nome: (x: ConcessaoM) => string,
  ): ConcessaoVigente[] {
    const hoje = this.hoje();
    return lista
      .filter((x) => x.usuario === usuario && x.estabelecimento === (c.estabelecimento ?? null))
      .filter((x) => !x.cancelada)
      .map((x) => ({
        id: x.id,
        alvo: x.alvo,
        alvo2: x.alvo2,
        despesa: x.despesa,
        nome: nome(x),
        inicio: x.inicio,
        fim: x.fim,
        permissoes: [...x.permissoes],
        vigente: x.inicio <= hoje && (x.fim === null || x.fim >= hoje),
      }));
  }

  async escopoUsuario(c: ContextoPortaM18, usuario: number): Promise<EscopoCompletoUsuario | null> {
    const u = USUARIOS.find((x) => x.id === usuario);
    if (!u) return null;
    const s = this.e(c);
    const nomeDe = (lista: readonly Opcao[], id: number | null) => lista.find((o) => o.id === id)?.nome ?? '';
    return {
      usuario: u.id,
      login: u.codigo,
      nome: u.nome,
      locais: [...s.escopos.values()]
        .filter((x) => x.usuario === usuario)
        .flatMap((x) => {
          const l = s.locais.get(x.local);
          return l && l.estabelecimento === (c.estabelecimento ?? null)
            ? [
                {
                  local: x.local,
                  codigo: l.dados.codigo,
                  nome: l.dados.nome,
                  permissoes: [...x.permissoes],
                  variacaoValorPct: x.variacaoValorPct,
                  padrao: x.padrao,
                },
              ]
            : [];
        }),
      classificacoes: this.vigentes(s.classificacoes, c, usuario, (x) =>
        x.alvo === null
          ? nomeDe(APOIO_SINTETICO.despesas, x.despesa)
          : [nomeDe(APOIO_SINTETICO.grupos, x.alvo), nomeDe(APOIO_SINTETICO.subgrupos, x.alvo2)]
              .filter(Boolean)
              .join(' · '),
      ),
      centrosCusto: this.vigentes(s.centros, c, usuario, (x) => nomeDe(APOIO_SINTETICO.centrosCusto, x.alvo)),
    };
  }

  async gravarEscopoLocal(
    c: ContextoPortaM18,
    usuario: number,
    local: number,
    e: { permissoes: PermissaoLocalUsuario[]; variacaoValorPct?: number | null; padrao?: boolean },
  ) {
    recusarUma(conferirEscopoLocal(e));
    const s = this.e(c);
    this.usuario(usuario);
    this.localDe(s, c, local);
    if (e.padrao) for (const x of s.escopos.values()) if (x.usuario === usuario) x.padrao = false;
    s.escopos.set(`${usuario}|${local}`, {
      usuario,
      local,
      permissoes: [...e.permissoes],
      variacaoValorPct: e.variacaoValorPct ?? null,
      padrao: e.padrao ?? false,
    });
    return { id: local };
  }

  async retirarEscopoLocal(c: ContextoPortaM18, usuario: number, local: number) {
    const s = this.e(c);
    this.localDe(s, c, local);
    if (!s.escopos.delete(`${usuario}|${local}`))
      throw recusa('escopo-inexistente', 'O usuário não tem este local.', { campos: ['local'] });
    return { id: local };
  }

  private conceder(
    lista: ConcessaoM[],
    s: Estado,
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada,
    alvo: number | null,
    alvo2: number | null,
    oQue: string,
    despesa: number | null = null,
  ): { id: number } {
    const permissoes = [
      ...(e.requisitar ? ['requisitar'] : []),
      ...(e.movimentar ? ['movimentar'] : []),
      ...(e.comprar ? ['comprar'] : []),
    ];
    recusarUma(conferirConcessaoVigente({ inicio: e.inicio, fim: e.fim ?? null, permissoes }));
    this.usuario(usuario);
    const est = c.estabelecimento ?? null;
    const fim = e.fim ?? null;
    const sobrepoe = lista.some(
      (x) =>
        !x.cancelada &&
        x.usuario === usuario &&
        x.estabelecimento === est &&
        x.alvo === alvo &&
        (x.alvo2 ?? 0) === (alvo2 ?? 0) &&
        x.despesa === despesa &&
        (x.fim === null || x.fim >= e.inicio) &&
        (fim === null || x.inicio <= fim),
    );
    if (sobrepoe)
      throw recusa('concessao-sobreposta', `Já há concessão vigente ${oQue} no período: retire-a antes.`, {
        campos: ['inicio'],
      });
    const id = (s.seq += 1);
    lista.push({
      id,
      usuario,
      estabelecimento: est,
      alvo,
      alvo2,
      despesa,
      inicio: e.inicio,
      fim,
      permissoes,
      cancelada: false,
    });
    return { id };
  }

  async concederClassificacao(
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada & ConcessaoClassificacaoAlvo,
  ) {
    const s = this.e(c);
    recusarUma(conferirAlvoConcessaoClassificacao(e));
    if (e.grupo == null) {
      if (!APOIO_SINTETICO.despesas.some((x) => x.id === e.classificacaoDespesa))
        throw recusa('referencia-inexistente', 'Classificação de despesa inexistente ou inativa.', {
          campos: ['classificacaoDespesa'],
        });
      return this.conceder(
        s.classificacoes,
        s,
        c,
        usuario,
        e,
        null,
        null,
        'desta classificação',
        e.classificacaoDespesa ?? null,
      );
    }
    if (!APOIO_SINTETICO.grupos.some((g) => g.id === e.grupo))
      throw recusa('referencia-inexistente', 'Grupo inexistente ou inativo.', { campos: ['grupo'] });
    if (e.subgrupo && APOIO_SINTETICO.subgrupos.find((x) => x.id === e.subgrupo)?.grupo !== e.grupo)
      throw recusa('subgrupo-fora-do-grupo', 'O subgrupo não pertence ao grupo escolhido.', {
        campos: ['subgrupo'],
      });
    return this.conceder(
      s.classificacoes,
      s,
      c,
      usuario,
      e,
      e.grupo,
      e.subgrupo ?? null,
      'desta classificação',
    );
  }

  async concederCentroCusto(
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada & { centroCusto: number },
  ) {
    const s = this.e(c);
    if (!APOIO_SINTETICO.centrosCusto.some((x) => x.id === e.centroCusto))
      throw recusa('referencia-inexistente', 'Centro de custo inexistente neste estabelecimento.', {
        campos: ['centroCusto'],
      });
    return this.conceder(s.centros, s, c, usuario, e, e.centroCusto, null, 'deste centro de custo');
  }

  async retirarConcessao(
    c: ContextoPortaM18,
    tipo: 'classificacao' | 'centro-custo',
    id: number,
    motivo: string,
  ) {
    const s = this.e(c);
    const x = (tipo === 'classificacao' ? s.classificacoes : s.centros).find(
      (o) => o.id === id && !o.cancelada && o.estabelecimento === (c.estabelecimento ?? null),
    );
    if (!x) throw recusa('concessao-inexistente', 'Concessão inexistente.', { campos: ['id'] });
    const d = retiradaDaConcessao({ inicio: x.inicio, fim: x.fim, motivo }, this.hoje());
    if (d.acao === 'recusar') recusarTodas([d.recusa]);
    else if (d.acao === 'cancelar') x.cancelada = true;
    else x.fim = d.fim;
    return { id, fim: x.fim, cancelada: x.cancelada };
  }

  // ── Lista de separação ───────────────────────────────────────────────────────────────────────────────────────

  /** A lista de separação lê a requisição, os saldos e os lotes do banco próprio: sem ele, 503 (nada inventado). */
  separacao(): Promise<ListaSeparacao | null> {
    return Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Lista de separação indisponível',
        'A lista de separação lê a requisição e os lotes do banco próprio do cliente.',
        { codigo: 'servico-indisponivel' },
      ),
    );
  }
}
