// Porta do OPME EM MEMÓRIA (M46, etapa 3): a sessão sintética de dev/ci (E2E) grava as solicitações, as etapas, os
// consumos com o rastreio e as devoluções SINTÉTICOS, com as mesmas regras e recusas da gravação (a versão vista, a
// chave do pedido, a máquina de estados, o rastreio por lote ou série, a exceção sem autorização). O consumo em sala é
// a saída do estoque simulada (o número do documento e o lançamento sintéticos). Na conta em memória, o lançamento do
// faturamento acompanha o consumo da solicitação autorizada; o consumo da exceção fica sem cobrança (a conciliação
// mostra as duas situações). Nada vai à cópia. Os itens são SINTÉTICOS (classe 50); nenhum nome é de pessoa real.
import {
  CLASSE_OPME,
  esquemaRegistrarDevolucao,
  esquemaRegistrarSaida,
  type ItemOpme,
  type RegistrarDevolucaoEntrada,
  type RegistrarSaidaEntrada,
  type SaidaLoteOpme,
  type SolicitacaoOpme,
} from '@sgh/contratos';
import {
  conferirConsumoOpme,
  conferirDevolucaoOpme,
  qtd3,
  situacaoDepoisDaEtapa,
} from '@sgh/dominio-suprimentos';
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/nucleo';
import type { ConsumoOpmeLeitura } from './opme-porta.js';
import { chaveMemoria, loginDaOperacao } from './operacoes.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorOpme, PortaOpme } from './opme-porta.js';

/** Os itens de OPME sintéticos (classe 50) do almoxarifado central (10) e do bloco (15). */
export const ITENS_OPME_SINTETICOS: readonly (ItemOpme & { classe: number; local: number })[] = [
  {
    item: 950001,
    nome: 'PLACA SINTETICA DE TITANIO 6 FUROS',
    unidade: 'UN',
    saldoLocal: 6,
    estoque: 6,
    consignado: false,
    rastreavel: false,
    lotes: [],
    classe: CLASSE_OPME,
    local: 10,
  },
  {
    item: 950002,
    nome: 'PARAFUSO SINTETICO CORTICAL 3,5 MM',
    unidade: 'UN',
    saldoLocal: 40,
    estoque: 40,
    consignado: false,
    rastreavel: false,
    lotes: [],
    classe: CLASSE_OPME,
    local: 10,
  },
  {
    item: 950003,
    nome: 'PROTESE SINTETICA DE QUADRIL CIMENTADA',
    unidade: 'UN',
    saldoLocal: 0,
    estoque: 0,
    consignado: true,
    rastreavel: false,
    lotes: [],
    classe: CLASSE_OPME,
    local: 10,
  },
  {
    item: 950090,
    nome: 'LUVA SINTETICA ESTERIL',
    unidade: 'PAR',
    saldoLocal: 100,
    estoque: 100,
    consignado: false,
    rastreavel: false,
    lotes: [],
    classe: 10,
    local: 10,
  },
];

type Mut<T> = { -readonly [K in keyof T]: T[K] };
type ItemSintetico = Mut<(typeof ITENS_OPME_SINTETICOS)[number]>;
/** O cadastro de compras sintético que as etapas citam: os fornecedores, o pedido 2026/9 e a nota 2026/10/55. */
export const FORNECEDORES_OPME_SINTETICOS: readonly { codigo: number; nome: string }[] = [
  { codigo: 7001, nome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA' },
  { codigo: 7002, nome: 'COMERCIAL SINTÉTICA BETA LTDA' },
];
const PEDIDOS_SINTETICOS = new Map<string, number[]>([['2026/9', [7001]]]);
const NFS_SINTETICAS = new Map<string, number>([['2026/10/55', 7001]]);

/** Uma saída sintética do lote L-77 feita por outro caminho do estoque (o recall tem de achá-la). */
const SAIDAS_LOTE_SINTETICAS: readonly (SaidaLoteOpme & { lote: string })[] = [
  {
    saida: { ano: 2026, mes: 10, doc: 7_001 },
    data: '2026-10-20',
    item: 950001,
    lote: 'L-77',
    atendimento: 77_999,
    paciente: 99_001,
    quantidade: 1,
    origem: 'estoque',
  },
];
const nomeFornecedor = (c: number) =>
  FORNECEDORES_OPME_SINTETICOS.find((x) => x.codigo === c)?.nome ?? `FORNECEDOR SINTETICO ${c}`;

interface Estado {
  itens: ItemSintetico[];
  etapasPorChave: Map<string, { id: number; solicitacao: number }>;
  solicitacoes: (Mut<Omit<SolicitacaoOpme, 'etapas'>> & {
    etapas: Mut<SolicitacaoOpme['etapas'][number]>[];
    chave: string | null;
  })[];
  consumos: (Mut<ConsumoOpmeLeitura> & { chave: string | null; local: number })[];
  conta: { conta: number; item: number; quantidade: number }[];
  chaves: Map<string, number>;
  seq: number;
  doc: number;
}

const agoraLocal = () => {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return p.replace(' ', 'T');
};
/** A conta sintética do atendimento (a do período). */
const contaDe = (reg: number) => 700_000 + (reg % 100_000);

export class PortaOpmeMemoria implements PortaOpme {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(chaveMemoria(c));
    if (!s) {
      s = {
        itens: structuredClone(ITENS_OPME_SINTETICOS) as ItemSintetico[],
        etapasPorChave: new Map(),
        solicitacoes: [],
        consumos: [],
        conta: [],
        chaves: new Map(),
        seq: 46_300,
        doc: 8_800,
      };
      this.porHospital.set(chaveMemoria(c), s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoPortaM18, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const ja = s.chaves.get(chave);
    if (ja !== undefined) return { resultado: { id: ja }, repetida: true, trilha: null };
    let resultado: Record<string, number>;
    if (op === 'suprimentos.registrarSaida') {
      const a = esquemaRegistrarSaida.safeParse(entradaBruta);
      if (!a.success)
        throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.');
      resultado = this.saida(s, a.data, loginDaOperacao(ctx));
    } else if (op === 'suprimentos.registrarDevolucao') {
      const a = esquemaRegistrarDevolucao.safeParse(entradaBruta);
      if (!a.success)
        throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.');
      resultado = this.devolucao(s, a.data, loginDaOperacao(ctx));
    } else throw new Error(`Operação ${op} fora do OPME em memória.`);
    s.chaves.set(chave, resultado['id'] as number);
    return { resultado, repetida: false, trilha: null };
  }

  private saida(s: Estado, e: RegistrarSaidaEntrada, usuario: string): Record<string, number> {
    const o = e.opme;
    const it = e.itens[0];
    if (!o || !it) throw new Error('A saída em memória é só a do consumo de OPME.');
    const item = s.itens.find((i) => i.item === it.item);
    if (!item) throw recusa('item-inexistente', 'O item não está no cadastro.', { campos: ['itens'] });
    if (!item.consignado && it.quantidade > item.saldoLocal)
      throw recusa('saldo-insuficiente', 'A quantidade passa do saldo do local.', { campos: ['itens'] });
    const sol = o.solicitacao !== null ? s.solicitacoes.find((x) => x.id === o.solicitacao) : null;
    if (o.solicitacao !== null && !sol)
      throw recusa('solicitacao-inexistente', 'A solicitação de OPME não existe mais.', {
        campos: ['solicitacao'],
      });
    if (sol && o.versaoVista !== null && sol.versao !== o.versaoVista)
      throw recusa('opme-mudou', 'A solicitação de OPME mudou em outra tela: recarregue e confira.');
    const agora = agoraLocal();
    const r = conferirConsumoOpme({
      solicitacao: sol ?? null,
      item: it.item,
      classeItem: item.classe,
      quantidade: it.quantidade,
      lote: o.lote,
      serie: o.serie,
      fabricante: o.fabricante,
      registroAnvisa: o.registroAnvisa,
      validade: o.validade,
      hoje: agora.slice(0, 10),
      justificativa: o.semAutorizacao?.motivo ?? null,
      podeExcecao: o.semAutorizacao !== null,
    })[0];
    if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
    if (!item.consignado) item.saldoLocal = qtd3(item.saldoLocal - it.quantidade);
    const doc = (s.doc += 1);
    const id = (s.seq += 1);
    const ano = Number(agora.slice(0, 4));
    const mes = Number(agora.slice(5, 7));
    const conta = contaDe(e.atendimento ?? 0);
    s.consumos.push({
      id,
      solicitacao: sol?.id ?? null,
      agendamento: o.agendamento,
      sala: o.sala,
      dataHora: o.dataHora,
      atendimento: e.atendimento ?? 0,
      paciente: o.paciente,
      cirurgiao: o.cirurgiao,
      item: it.item,
      itemNome: item.nome,
      quantidade: it.quantidade,
      devolvida: 0,
      saida: { ano, mes, doc },
      lancamento: 900_000 + doc,
      conta,
      lote: o.lote,
      serie: o.serie,
      fabricante: o.fabricante,
      modelo: o.modelo,
      registroAnvisa: o.registroAnvisa,
      validade: o.validade,
      consignado: o.consignado || item.consignado,
      fornecedor: o.fornecedor,
      semAutorizacao: o.semAutorizacao,
      usuario,
      em: agora,
      chave: o.chave,
      local: e.local,
    });
    if (sol) {
      sol.consumida = qtd3(sol.consumida + it.quantidade);
      sol.situacao = situacaoDepoisDaEtapa(sol.situacao, 'consumo', sol);
      sol.versao += 1;
      sol.etapas.push(this.etapa(sol, 'consumo', agora, usuario, { quantidade: it.quantidade, consumo: id }));
      // O lançamento do faturamento na conta (o consumo autorizado; o da exceção fica sem cobrança).
      s.conta.push({ conta, item: it.item, quantidade: it.quantidade });
    }
    return { id: doc, ano, mes, doc, itens: 1 };
  }

  private devolucao(s: Estado, e: RegistrarDevolucaoEntrada, usuario: string): Record<string, number> {
    const o = e.opme;
    const it = e.itens[0];
    if (!o || !it) throw new Error('A devolução em memória é só a do OPME não usado.');
    const c = s.consumos.find((x) => x.id === o.consumo);
    if (!c)
      throw recusa('consumo-inexistente', 'O consumo de OPME não existe mais.', { campos: ['consumo'] });
    // A mesma conferência do executor (M28): a devolução volta ao local de onde a saída partiu.
    if (c.saida.ano !== e.saida.ano || c.saida.mes !== e.saida.mes || c.saida.doc !== e.saida.doc)
      throw recusa('saida-inexistente', 'A saída a devolver não existe ou não foi consolidada.', {
        campos: ['saida'],
      });
    if (c.local !== e.local)
      throw recusa('local-da-saida', 'A devolução volta ao local de onde saiu.', { campos: ['local'] });
    if (c.lancamento !== it.lancamentoSaida || c.item !== it.item)
      throw recusa('consumo-de-outra-saida', 'O item devolvido não é o do consumo de OPME.', {
        campos: ['consumo'],
      });
    const r = conferirDevolucaoOpme({
      consumida: c.quantidade,
      devolvida: c.devolvida,
      quantidade: it.quantidade,
      motivo: o.motivo,
    })[0];
    if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
    c.devolvida = qtd3(c.devolvida + it.quantidade);
    const item = s.itens.find((i) => i.item === it.item);
    if (item && !item.consignado) item.saldoLocal = qtd3(item.saldoLocal + it.quantidade);
    const agora = agoraLocal();
    const doc = (s.doc += 1);
    const sol = c.solicitacao !== null ? s.solicitacoes.find((x) => x.id === c.solicitacao) : null;
    if (sol) {
      sol.devolvida = qtd3(sol.devolvida + it.quantidade);
      sol.situacao = situacaoDepoisDaEtapa(sol.situacao, 'devolucao', sol);
      sol.versao += 1;
      sol.etapas.push(
        this.etapa(sol, 'devolucao', agora, usuario, {
          quantidade: it.quantidade,
          consumo: c.id,
          observacao: o.motivo,
        }),
      );
      // O estorno do lançamento na conta.
      s.conta.push({ conta: c.conta, item: c.item, quantidade: -it.quantidade });
    }
    return { id: doc, ano: Number(agora.slice(0, 4)), mes: Number(agora.slice(5, 7)), doc, itens: 1 };
  }

  private etapa(
    sol: Estado['solicitacoes'][number],
    etapa: SolicitacaoOpme['etapas'][number]['etapa'],
    em: string,
    usuario: string,
    x: Partial<SolicitacaoOpme['etapas'][number]> = {},
  ): Mut<SolicitacaoOpme['etapas'][number]> {
    return {
      seq: sol.etapas.length + 1,
      etapa,
      em,
      quantidade: null,
      fornecedor: null,
      senha: null,
      guia: null,
      validade: null,
      pedido: null,
      nf: null,
      saida: null,
      lancamento: null,
      consumo: null,
      observacao: null,
      usuario,
      ...x,
    };
  }

  async gravarSgh<T>(c: ContextoPortaM18, _trilha: unknown, fn: (g: GravadorOpme) => Promise<T>): Promise<T> {
    const s = this.e(c);
    // Transação em memória: a cópia do estado; a recusa no meio não deixa nada gravado.
    const copia = {
      solicitacoes: structuredClone(s.solicitacoes),
      etapasPorChave: new Map(s.etapasPorChave),
      seq: s.seq,
    };
    const g: GravadorOpme = {
      solicitacao: async (id) =>
        (copia.solicitacoes.find((x) => x.id === id) as SolicitacaoOpme | undefined) ?? null,
      etapaPelaChave: async (chave) => copia.etapasPorChave.get(chave) ?? null,
      solicitar: async (x) => {
        if (x.chave) {
          const ja = copia.solicitacoes.find((y) => y.chave === x.chave);
          if (ja) {
            if (ja.agendamento !== x.agendamento || ja.item !== x.item)
              throw recusa(
                'chave-de-outra-solicitacao',
                'A chave do pedido já foi usada em outra solicitação de OPME.',
              );
            return { id: ja.id, versao: ja.versao, repetida: true };
          }
        }
        const item = s.itens.find((i) => i.item === x.item);
        const id = (copia.seq += 1);
        const nova: Estado['solicitacoes'][number] = {
          id,
          agendamento: x.agendamento,
          sala: x.sala,
          dataHora: x.dataHora,
          atendimento: x.reg,
          item: x.item,
          itemNome: item?.nome ?? null,
          tuss: x.tuss,
          quantidade: x.quantidade,
          fornecedor: x.fornecedor,
          fornecedorNome: x.fornecedor ? nomeFornecedor(x.fornecedor) : null,
          justificativa: x.justificativa,
          situacao: 'solicitada',
          autorizada: 0,
          consumida: 0,
          devolvida: 0,
          consignado: x.consignado,
          senha: null,
          guia: null,
          validadeSenha: null,
          versao: 1,
          criadoPor: x.usuario,
          criadoEm: x.em,
          etapas: [],
          chave: x.chave,
        };
        nova.etapas.push(this.etapa(nova, 'solicitacao', x.em, x.usuario, { quantidade: x.quantidade }));
        copia.solicitacoes.push(nova);
        return { id, versao: 1, repetida: false };
      },
      avancar: async (x) => {
        const sol = copia.solicitacoes.find((y) => y.id === x.solicitacao);
        if (!sol || sol.versao !== x.versaoVista)
          throw recusa('opme-mudou', 'A solicitação de OPME mudou em outra tela: recarregue e confira.');
        const m = x.mudanca;
        sol.situacao = m.situacao;
        if (m.autorizada !== undefined) sol.autorizada = m.autorizada;
        if (m.senha !== undefined) sol.senha = m.senha;
        if (m.guia !== undefined) sol.guia = m.guia;
        if (m.validade !== undefined) sol.validadeSenha = m.validade;
        if (m.fornecedor !== undefined) {
          sol.fornecedor = m.fornecedor;
          sol.fornecedorNome = m.fornecedor ? nomeFornecedor(m.fornecedor) : null;
        }
        if (m.consignado !== undefined) sol.consignado = m.consignado;
        sol.versao += 1;
        const et = this.etapa(sol, x.etapa, x.em, x.usuario, {
          quantidade: x.quantidade ?? null,
          fornecedor: x.fornecedor ?? null,
          senha: x.senha ?? null,
          guia: x.guia ?? null,
          validade: x.validade ?? null,
          pedido: x.pedido ?? null,
          nf: x.nf ?? null,
          observacao: x.observacao ?? null,
        });
        sol.etapas.push(et);
        const idEtapa = sol.id * 1000 + et.seq;
        if (x.chave) copia.etapasPorChave.set(x.chave, { id: idEtapa, solicitacao: sol.id });
        return { etapa: idEtapa, versao: sol.versao };
      },
    };
    const r = await fn(g);
    s.solicitacoes = copia.solicitacoes;
    s.seq = copia.seq;
    s.etapasPorChave = copia.etapasPorChave;
    return r;
  }

  async solicitacoesDosAgendamentos(c: ContextoPortaM18, as: readonly number[]) {
    return this.e(c)
      .solicitacoes.filter((x) => as.includes(x.agendamento))
      .map((x) => this.solic(x));
  }

  async solicitacoesDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    const itens = this.e(c)
      .solicitacoes.filter((x) => x.dataHora.slice(0, 10) >= de && x.dataHora.slice(0, 10) <= ate)
      .map((x) => this.solic(x));
    return { itens, cortada: false };
  }

  async solicitacao(c: ContextoPortaM18, id: number) {
    const x = this.e(c).solicitacoes.find((y) => y.id === id);
    return x ? this.solic(x) : null;
  }

  private solic(x: Estado['solicitacoes'][number]): SolicitacaoOpme {
    const { chave: _c, ...resto } = x;
    void _c;
    return structuredClone(resto);
  }

  private cons(x: Estado['consumos'][number]): ConsumoOpmeLeitura {
    const { chave: _c, local: _l, ...resto } = x;
    void _c;
    void _l;
    return structuredClone(resto);
  }

  async consumosDosAgendamentos(c: ContextoPortaM18, as: readonly number[]) {
    return this.e(c)
      .consumos.filter((x) => as.includes(x.agendamento))
      .map((x) => this.cons(x));
  }

  async consumosDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    const itens = this.e(c)
      .consumos.filter((x) => x.em.slice(0, 10) >= de && x.em.slice(0, 10) <= ate)
      .map((x) => this.cons(x));
    return { itens, cortada: false };
  }

  async consumo(c: ContextoPortaM18, id: number) {
    const x = this.e(c).consumos.find((y) => y.id === id);
    return x ? this.cons(x) : null;
  }

  async consumoPelaChave(c: ContextoPortaM18, chave: string) {
    const x = this.e(c).consumos.find((y) => y.chave === chave);
    return x ? this.cons(x) : null;
  }

  async localDaSaida(c: ContextoPortaM18, saida: { ano: number; mes: number; doc: number }) {
    const x = this.e(c).consumos.find(
      (k) => k.saida.ano === saida.ano && k.saida.mes === saida.mes && k.saida.doc === saida.doc,
    );
    return x ? x.local : null;
  }

  async documentosCompra(
    _c: ContextoPortaM18,
    d: {
      fornecedor: number | null;
      pedido: { ano: number; doc: number } | null;
      nf: { ano: number; mes: number; doc: number } | null;
    },
  ) {
    const f =
      d.fornecedor !== null ? FORNECEDORES_OPME_SINTETICOS.find((x) => x.codigo === d.fornecedor) : null;
    const p = d.pedido ? PEDIDOS_SINTETICOS.get(`${d.pedido.ano}/${d.pedido.doc}`) : undefined;
    const n = d.nf ? NFS_SINTETICAS.get(`${d.nf.ano}/${d.nf.mes}/${d.nf.doc}`) : undefined;
    return {
      fornecedor: f?.nome ?? null,
      pedido: p ? { fornecedores: [...p] } : null,
      nf: n !== undefined ? { fornecedor: n } : null,
    };
  }

  async localComSaldo(c: ContextoPortaM18, locais: readonly number[]) {
    // Os itens sintéticos guardam o local; os consignados contam (o saldo deles é o da consignação).
    const com = new Set(
      this.e(c)
        .itens.filter((i) => i.classe === CLASSE_OPME && (i.saldoLocal > 0 || i.consignado))
        .map((i) => i.local),
    );
    return locais.find((l) => com.has(l)) ?? null;
  }

  async fornecedores(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toUpperCase();
    return {
      itens: FORNECEDORES_OPME_SINTETICOS.filter((x) => !t || String(x.codigo) === t || x.nome.includes(t)),
      cortada: false,
    };
  }

  async itens(c: ContextoPortaM18, f: { termo: string; local: number; hoje: string }) {
    const t = f.termo.trim().toUpperCase();
    const itens = this.e(c)
      .itens.filter(
        (i) =>
          i.classe === CLASSE_OPME &&
          (/^\d+$/.test(t)
            ? i.item === Number(t)
            : t.length >= 2
              ? i.nome.includes(t)
              : i.saldoLocal > 0 || i.consignado),
      )
      .map((i): ItemOpme => ({
        item: i.item,
        nome: i.nome,
        unidade: i.unidade,
        saldoLocal: f.local === 10 ? i.saldoLocal : 0,
        estoque: i.estoque,
        consignado: i.consignado,
        rastreavel: i.rastreavel,
        lotes: i.lotes,
      }));
    return { itens, cortada: false };
  }

  async classeDoItem(c: ContextoPortaM18, item: number) {
    return this.e(c).itens.find((i) => i.item === item)?.classe ?? null;
  }

  async itemConsignado(c: ContextoPortaM18, item: number) {
    return this.e(c).itens.find((i) => i.item === item)?.consignado ?? false;
  }

  async rastreioReverso(
    c: ContextoPortaM18,
    f: { item: number | null; lote: string | null; serie: string | null; registroAnvisa?: string | null },
  ) {
    const doFiltro = this.e(c).consumos.filter(
      (x) =>
        (f.item === null || x.item === f.item) &&
        (!f.lote || x.lote === f.lote) &&
        (!f.serie || x.serie === f.serie) &&
        (!f.registroAnvisa || x.registroAnvisa === f.registroAnvisa),
    );
    // As saídas do lote no estoque (só com o item e o lote): as do consumo em sala e as de outro caminho do estoque.
    const saidasEstoque: SaidaLoteOpme[] =
      f.item !== null && f.lote
        ? [
            ...doFiltro.map((x) => ({
              saida: x.saida,
              data: x.dataHora.slice(0, 10),
              item: x.item,
              atendimento: x.atendimento,
              paciente: x.paciente,
              quantidade: x.quantidade,
              origem: 'consumo-em-sala' as const,
            })),
            ...SAIDAS_LOTE_SINTETICAS.filter((x) => x.item === f.item && x.lote === f.lote).map(
              (x): SaidaLoteOpme => ({
                saida: x.saida,
                data: x.data,
                item: x.item,
                atendimento: x.atendimento,
                paciente: x.paciente,
                quantidade: x.quantidade,
                origem: x.origem,
              }),
            ),
          ]
        : [];
    const expostos = doFiltro.map((x) => ({
      consumo: x.id,
      atendimento: x.atendimento,
      paciente: x.paciente,
      agendamento: x.agendamento,
      sala: x.sala,
      dataHora: x.dataHora,
      cirurgiao: x.cirurgiao,
      quantidade: x.quantidade,
      devolvida: x.devolvida,
      saida: x.saida,
      lote: x.lote,
      serie: x.serie,
      registroAnvisa: x.registroAnvisa,
      usuario: x.usuario,
    }));
    return {
      itemNome: f.item !== null ? (this.e(c).itens.find((i) => i.item === f.item)?.nome ?? null) : null,
      expostos,
      saidasDoLote: saidasEstoque.length,
      saidasEstoque,
      cortada: false,
    };
  }

  async itensDaConta(c: ContextoPortaM18, contas: readonly number[], itens: readonly number[]) {
    const soma = new Map<string, { conta: number; item: number; quantidade: number }>();
    for (const x of this.e(c).conta) {
      if (!contas.includes(x.conta) || !itens.includes(x.item)) continue;
      const k = `${x.conta}:${x.item}`;
      const v = soma.get(k) ?? { conta: x.conta, item: x.item, quantidade: 0 };
      v.quantidade = qtd3(v.quantidade + x.quantidade);
      soma.set(k, v);
    }
    return [...soma.values()].filter((x) => x.quantidade > 0);
  }
}
