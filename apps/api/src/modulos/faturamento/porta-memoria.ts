// Porta da conta do paciente em MEMÓRIA (M30): a sessão sintética de dev/ci (E2E). Contas, itens, fichas e preços
// SINTÉTICOS (nenhum dado real; nada vai a banco), com as mesmas validações (Zod dos contratos) e as mesmas regras do
// domínio que a porta própria confere (vetos do fechamento e da reabertura, situação derivada, explicador,
// faturabilidade, particular). A conta de internação 9001 nasce aberta e emitida, com itens "dos gatilhos" (estoque,
// SADT, internação); a ficha 7001 dela entra na fila do lançamento após o fechamento quando a conta é fechada (o
// procedimento lançado depois, pelo outro sistema, que o gatilho marca e não lança).
import {
  type AuditoriaConta,
  type CaixaLido,
  type ContaDetalhe,
  type EstadoOperacao,
  type ContaResumo,
  type ExplicacaoLida,
  type ItemConta,
  type ItemSigtap,
  type LancamentoTardio,
  type ListaContas,
  type ListaItens,
  type NotaSala,
  type OrcamentoParticular,
  type PacoteLido,
  type PagamentoLido,
  type PainelLancamentos,
  type ReciboLido,
  type RegraLida,
  type WorklistFaturamento,
} from '@sgh/contratos';
import {
  aceitaLancamento,
  avaliarFaturabilidade,
  type BaseContrato,
  conferirFechamento,
  conferirPrecoManual,
  conferirReabertura,
  conferirRecebimento,
  conferirSemCaucao,
  diasDesde,
  esquemaRegraFaturabilidade,
  explicarPreco,
  grupoDoItem,
  legendaPacoteConta,
  legendaPacoteItem,
  origemDoItem,
  precoDaTabela,
  ROTULO_GRUPO,
  ROTULO_SITUACAO,
  situacaoDerivada,
  totalOrcamento,
} from '@sgh/dominio-faturamento';
import { type EntradaTotalHonorario, simularReajusteItem } from '@sgh/dominio-preco';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import type { EstadoCatalogo } from '../cadastro/porta.js';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { ehOperacaoFaturamento, ENTRADAS_FATURAMENTO } from './esquemas.js';
import type {
  ContextoFaturamento,
  FiltroContasPorta,
  FiltroPagamentos,
  GravadorSghFaturamento,
  PedidoSimulacao,
  PortaFaturamento,
  ResultadoSimulacao,
} from './porta.js';
import { conferirRecebimentoDaConta } from './regras-conta.js';

const recusa = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem, campos ? { campos } : {});
const r2 = (n: number) => Math.round(n * 100) / 100;
const hojeIso = () => {
  const d = new Date(Date.now() - 3 * 3_600_000);
  return d.toISOString().slice(0, 10);
};
const agora = () => new Date().toISOString().slice(0, 19);

interface ContaM {
  id: number;
  ano: number;
  mes: number;
  tipoConta: 'E' | 'I';
  codigo: number;
  paciente: string;
  convenio: number;
  fechada: string;
  indEmi: string;
  remessa: number;
  dataEmissao: string | null;
  dataFechamento: string | null;
  usuarioFechamento: string;
  pacote: string;
  total: number;
  alta: string | null;
  registro: number;
  emLote: boolean;
  versao: number;
  senha: string;
  guia: string;
}

interface ItemM {
  id: number;
  conta: number;
  tipo: 1 | 2 | 3 | 4;
  data: string;
  hora: string;
  codigo: number;
  nome: string;
  quantidade: number;
  unitario: number;
  valor: number;
  ch: number;
  cop: number;
  filme: number;
  perc: number;
  veio: string;
  pacote: string;
  conferidoPor: string;
  usuario: string;
  versao: number;
  sigtap: number | null;
  origem: string | null;
}

/** Tabela de preços sintética do convênio 91 (tipo:código → base do contrato). */
const PRECOS: Readonly<Record<string, { nome: string; base: Partial<BaseContrato> }>> = {
  '3:40302199': { nome: 'EXAME SINTETICO DE SANGUE', base: { valores: { ch: 4.74, co: 0, filme: 0 } } },
  '3:40801012': { nome: 'IMAGEM SINTETICA', base: { valores: { ch: 120, co: 30.5, filme: 12.25 } } },
  '2:10102019': { nome: 'VISITA HOSPITALAR SINTETICA', base: { ch: { quantidade: 100, indice: 0.9 } } },
  '1:5315': { nome: 'DIARIA SINTETICA DE APARTAMENTO', base: { diaria: { valor: 356.73 } } },
  '1:4239': { nome: 'TAXA SINTETICA DE SALA', base: { diaria: { valor: 105.55 } } },
  // C3-001: a consulta em consultório do simulador (valor da vigência da tabela; honorário + custo operacional).
  '3:10101012': { nome: 'CONSULTA SINTETICA EM CONSULTORIO', base: { valores: { ch: 100, co: 20, filme: 0 } } },
  '4:310165': { nome: 'MATERIAL SINTETICO', base: { referencia: { valor: 10.4493, pmc: null, pf: null } } },
};
const TIPOS_PENDENCIA: readonly { id: number; nome: string; modulos: readonly number[] }[] = [
  { id: 1, nome: 'FALTA ASSINATURA (SINTETICA)', modulos: [4] },
  { id: 2, nome: 'FALTA LAUDO (SINTETICA)', modulos: [3, 4] },
];
const CONVENIOS: Readonly<Record<number, string>> = { 91: 'CONVENIO SINTETICO', 10: 'PARTICULAR' };
/** As fontes pagadoras da massa sintética de tipo particular (o tipo da fonte, não um código fixo, decide). */
const FONTES_PARTICULARES: ReadonlySet<number> = new Set([10]);

interface Estado {
  seq: number;
  contas: Map<number, ContaM>;
  itens: Map<number, ItemM>;
  fichas: { registro: number; data: string; convenio: number; conta: number; depoisDoFechamento: boolean }[];
  pendencias: {
    id: number;
    conta: number;
    tipo: number;
    descricao: string;
    bloqueante: boolean;
    aberta: boolean;
    por: string;
    em: string;
    resolucao: string | null;
  }[];
  etapas: {
    id: number;
    conta: number;
    etapa: string;
    situacao: string;
    usuario: string;
    inicio: string;
    fim: string | null;
    observacao: string;
  }[];
  decisoes: Map<number, { decisao: string; por: string; motivo: string }>;
  regras: (RegraLida & { hospital?: string })[];
  pacotes: PacoteLido[];
  versoes: {
    id: number;
    conta: number;
    papel: string;
    parecer: string;
    usuario: string;
    em: string;
    total: number;
    itens: number;
  }[];
  orcamentos: OrcamentoParticular[];
  caixas: {
    id: number;
    operador: string;
    abertoEm: string;
    fechadoEm: string | null;
    saldoInicial: number;
    contado: number | null;
  }[];
  pagamentos: PagamentoLido[];
  recibos: ReciboLido[];
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

export class PortaFaturamentoMemoria implements PortaFaturamento {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(private readonly catalogo: EstadoCatalogo | null) {}

  private e(c: ContextoFaturamento): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = this.semear();
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  private semear(): Estado {
    const hoje = hojeIso();
    const ano = Number(hoje.slice(0, 4));
    const mes = Number(hoje.slice(5, 7));
    const s: Estado = {
      seq: 10_000,
      contas: new Map(),
      itens: new Map(),
      fichas: [],
      pendencias: [],
      etapas: [],
      decisoes: new Map(),
      regras: [],
      pacotes: [],
      versoes: [],
      orcamentos: [],
      caixas: [],
      pagamentos: [],
      recibos: [],
      idem: new Map(),
    };
    const conta = (x: Partial<ContaM> & { id: number }): ContaM => ({
      ano,
      mes,
      tipoConta: 'I',
      codigo: 20_000_000 + x.id,
      paciente: 'PACIENTE SINTETICO',
      convenio: 91,
      fechada: 'N',
      indEmi: 'T',
      remessa: 77,
      dataEmissao: hoje,
      dataFechamento: null,
      usuarioFechamento: '',
      pacote: 'N',
      total: 0,
      alta: hoje,
      registro: 800_000 + x.id,
      emLote: false,
      versao: 1,
      senha: 'SENHA-SINT',
      guia: 'GUIA-SINT',
      ...x,
    });
    s.contas.set(9001, conta({ id: 9001, paciente: 'PACIENTE SINTETICO INTERNADO' }));
    s.contas.set(
      9002,
      conta({
        id: 9002,
        tipoConta: 'E',
        paciente: 'PACIENTE SINTETICO EXTERNO',
        indEmi: 'F',
        remessa: 0,
        dataEmissao: null,
      }),
    );
    s.contas.set(
      9003,
      conta({
        id: 9003,
        tipoConta: 'E',
        paciente: 'PACIENTE SINTETICO APRESENTADO',
        fechada: 'A',
        dataFechamento: hoje,
        usuarioFechamento: 'SINT.CONTAS',
      }),
    );
    s.contas.set(
      9004,
      conta({
        id: 9004,
        tipoConta: 'E',
        paciente: 'PACIENTE SINTETICO FECHADO',
        fechada: 'S',
        dataFechamento: hoje,
        usuarioFechamento: 'SINT.CONTAS',
      }),
    );
    s.contas.set(
      9010,
      conta({
        id: 9010,
        tipoConta: 'E',
        convenio: 10,
        paciente: 'PACIENTE SINTETICO PARTICULAR',
        indEmi: 'F',
        remessa: 0,
        dataEmissao: null,
      }),
    );
    const item = (
      conta: number,
      tipo: 1 | 2 | 3 | 4,
      codigo: number,
      quantidade: number,
      veio: string,
      x: Partial<ItemM> = {},
    ) => {
      const p = PRECOS[`${tipo}:${codigo}`]!;
      const preco = precoDaTabela(
        grupoDoItem(tipo)!,
        { convenio: 91, tabela: 1, nomeTabela: 'TABELA SINTETICA', vigencia: `${ano}-01-01`, ...p.base },
        quantidade,
      )!;
      const id = (s.seq += 1);
      const perc = x.perc ?? 0;
      const unitario = perc
        ? Math.round(preco.unitario * (1 + perc / 100) * 10_000) / 10_000
        : preco.unitario;
      s.itens.set(id, {
        id,
        conta,
        tipo,
        data: hoje,
        hora: '0915',
        codigo,
        nome: p.nome,
        quantidade,
        unitario,
        valor: r2(unitario * quantidade),
        ch: perc ? 0 : preco.ch,
        cop: perc ? 0 : preco.cop,
        filme: perc ? 0 : preco.filme,
        perc,
        veio,
        pacote: 'N',
        conferidoPor: '',
        usuario: 'SINT.OUTRO.SISTEMA',
        versao: 1,
        sigtap: null,
        origem: null,
        ...x,
      });
    };
    item(9001, 1, 5315, 2, 'I');
    item(9001, 3, 40302199, 1, 'S');
    item(9001, 3, 40801012, 1, 'S');
    item(9001, 2, 10102019, 1, 'C');
    item(9001, 4, 310165, 3, 'E', { perc: 38.23 });
    item(9002, 3, 40302199, 2, 'S');
    item(9003, 3, 40302199, 1, 'S');
    item(9004, 1, 4239, 1, 'C');
    for (const c of s.contas.values())
      c.total = r2([...s.itens.values()].filter((i) => i.conta === c.id).reduce((t, i) => t + i.valor, 0));
    s.fichas.push({ registro: 7001, data: hoje, convenio: 91, conta: 9001, depoisDoFechamento: true });
    s.fichas.push({ registro: 7002, data: hoje, convenio: 91, conta: 9004, depoisDoFechamento: false });
    return s;
  }

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoFaturamento, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, c.hospital);
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  private contaM(s: Estado, id: number): ContaM {
    const c = s.contas.get(id);
    if (!c) throw recusa('conta-inexistente', 'A conta não existe.');
    return c;
  }
  private itensDa(s: Estado, conta: number): ItemM[] {
    return [...s.itens.values()].filter((i) => i.conta === conta).sort((a, b) => a.id - b.id);
  }
  private soma(s: Estado, conta: number) {
    const it = this.itensDa(s, conta);
    return { itens: it.length, soma: r2(it.reduce((t, i) => t + i.valor, 0)) };
  }
  private versao = (n: number) =>
    `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.${String(n).padStart(3, '0')}Z`;

  async executar(c: ContextoFaturamento, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    if (!ehOperacaoFaturamento(op)) throw new Error(`Operação ${op} sem a porta em memória.`);
    const analise = ENTRADAS_FATURAMENTO[op].safeParse(entradaBruta);
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
    // O login de quem grava, para mostrar na conta sintética (o contexto da gravação da API o leva).
    const login = (ctx as ContextoOperacao & { readonly login?: string }).login ?? '';
    const resultado = this.aplicar(s, op, analise.data as never, login, c.hospital);
    s.idem.set(chave, { hash, resultado });
    this.gravadasAqui(c.hospital).set(op, (this.gravadasAqui(c.hospital).get(op) ?? 0) + 1);
    if (op === 'faturamento.fecharConta') this.fechadasAqui(c.hospital).add(Number(resultado['conta']));
    if (op === 'faturamento.reabrirConta') this.fechadasAqui(c.hospital).delete(Number(resultado['conta']));
    return { resultado, repetida: false, trilha: null };
  }

  // M42: o acompanhamento da competência na sessão sintética. "Fechada pelo novo" é a conta fechada por esta porta
  // (como a trilha do novo no banco); as que nasceram fechadas na massa são do outro sistema.
  private readonly fechadas = new Map<string, Set<number>>();
  private readonly gravadas = new Map<string, Map<string, number>>();
  private fechadasAqui(h: string): Set<number> {
    if (!this.fechadas.has(h)) this.fechadas.set(h, new Set());
    return this.fechadas.get(h)!;
  }
  private gravadasAqui(h: string): Map<string, number> {
    if (!this.gravadas.has(h)) this.gravadas.set(h, new Map());
    return this.gravadas.get(h)!;
  }

  /** Contas da competência por convênio e situação (o formato da leitura do banco), com as fechadas aqui. */
  linhasDaCompetencia(
    hospital: string,
    ano: number,
    mes: number,
  ): { convenio: number; situacao: string; contas: number; fechadasPeloNovo: number; valor: number }[] {
    const s = this.e({ hospital } as ContextoFaturamento);
    const aqui = this.fechadasAqui(hospital);
    const grupos = new Map<
      string,
      { convenio: number; situacao: string; contas: number; fechadasPeloNovo: number; valor: number }
    >();
    for (const k of s.contas.values()) {
      if (k.ano !== ano || k.mes !== mes) continue;
      const chave = `${k.convenio}:${k.fechada}`;
      const g = grupos.get(chave) ?? {
        convenio: k.convenio,
        situacao: k.fechada,
        contas: 0,
        fechadasPeloNovo: 0,
        valor: 0,
      };
      g.contas += 1;
      g.valor = r2(g.valor + this.soma(s, k.id).soma);
      if (aqui.has(k.id)) g.fechadasPeloNovo += 1;
      grupos.set(chave, g);
    }
    return [...grupos.values()];
  }

  /** Gravações desta porta por operação (o equivalente da trilha do novo na sessão sintética). */
  gravacoesAqui(hospital: string): ReadonlyMap<string, number> {
    return this.gravadasAqui(hospital);
  }

  private aplicar(
    s: Estado,
    op: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    e: any,
    usuario: string,
    hospital: string,
  ): Record<string, number | string> {
    const conta = this.contaM(s, e.conta);
    const conferirVersao = () => {
      if (e.versao !== this.versao(conta.versao))
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Registro alterado',
          'A conta foi alterada por outra pessoa desde que você a abriu. Releia a conta.',
          {
            campos: ['versao'],
          },
        );
    };
    switch (op) {
      case 'faturamento.fecharConta': {
        conferirVersao();
        const so = this.soma(s, conta.id);
        const r = conferirFechamento({
          fechada: conta.fechada,
          remessa: conta.remessa,
          dataEmissao: conta.dataEmissao,
          indEmi: conta.indEmi,
          pacote: conta.pacote,
          itens: so.itens,
          somaItens: so.soma,
          totalConta: conta.total,
          preVoo: {
            medicoSolicitanteValido: true,
            medicoContaValido: true,
            procedimentoNaTabela: true,
            tituloReceberExiste: true,
          },
          pendenciasBloqueantes: s.pendencias.filter((p) => p.conta === conta.id && p.aberta && p.bloqueante)
            .length,
        });
        if (r) throw recusa(r.codigo, r.mensagem, r.campos);
        conta.fechada = 'S';
        conta.dataFechamento = hojeIso();
        conta.usuarioFechamento = usuario;
        conta.versao += 1;
        this.etapa(s, conta.id, 'fechamento', 'registrada', usuario, '');
        return { conta: conta.id };
      }
      case 'faturamento.reabrirConta': {
        conferirVersao();
        const r = conferirReabertura({
          fechada: conta.fechada,
          lotesTiss: conta.emLote ? 1 : 0,
          supervisor: true,
          motivo: e.motivo,
        });
        if (r) throw recusa(r.codigo, r.mensagem, r.campos);
        conta.fechada = 'N';
        conta.dataFechamento = null;
        conta.usuarioFechamento = '';
        conta.versao += 1;
        this.etapa(s, conta.id, 'reabertura', 'registrada', usuario, e.motivo);
        return { conta: conta.id };
      }
      case 'faturamento.conferirItem': {
        if (conta.fechada !== 'N')
          throw recusa('conta-fechada', 'A conta não está aberta: a conferência é feita na conta aberta.');
        const mudaram: string[] = [];
        for (const x of e.itens as { id: number; versao: string }[]) {
          const it = s.itens.get(x.id);
          if (!it || it.conta !== conta.id)
            throw recusa('item-de-outra-conta', `O item ${x.id} não é desta conta.`, ['itens']);
          if (this.versao(it.versao) !== x.versao) mudaram.push(`item ${x.id}`);
        }
        if (mudaram.length)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado',
            'Itens alterados desde a leitura: releia a conta.',
            { campos: mudaram },
          );
        for (const x of e.itens as { id: number }[]) {
          const it = s.itens.get(x.id)!;
          it.conferidoPor = usuario;
          it.versao += 1;
        }
        this.etapa(s, conta.id, 'conferencia-item', 'registrada', usuario, `${e.itens.length} item(ns)`);
        return { conta: conta.id, itens: e.itens.length };
      }
      case 'faturamento.lancarItem': {
        if (!aceitaLancamento(conta.fechada, conta.indEmi))
          throw recusa(
            'conta-fechada',
            'A conta está fechada, apresentada ou emitida: o item não entra nela. Registre a decisão na fila de lançamento após o fechamento.',
          );
        const p = PRECOS[`${e.tipo}:${e.codigo}`];
        if (!p)
          throw recusa('item-fora-da-tabela', 'O item não está na tabela do convênio da conta.', ['codigo']);
        const grupo = grupoDoItem(e.tipo)!;
        let preco = precoDaTabela(
          grupo,
          { convenio: conta.convenio, tabela: 1, nomeTabela: null, vigencia: null, ...p.base },
          e.quantidade,
        );
        if (e.precoManual) {
          const r = conferirPrecoManual({
            tabela: preco?.unitario ?? 0,
            manual: e.precoManual.unitario,
            faixa: { abaixo: 0.1, acima: 0.2 },
            aprovador: e.precoManual.aprovador,
            justificativa: e.precoManual.justificativa,
            operador: usuario,
          });
          if (r) throw recusa(r.codigo, r.mensagem, r.campos);
          preco = {
            modelo: 'digitado',
            unitario: e.precoManual.unitario,
            ch: e.precoManual.unitario,
            cop: 0,
            filme: 0,
            valor: r2(e.precoManual.unitario * e.quantidade),
          };
        }
        if (!preco)
          throw recusa(
            'item-sem-preco',
            'O item não tem preço vigente na tabela do convênio: informe o preço manual.',
            ['precoManual'],
          );
        const id = (s.seq += 1);
        s.itens.set(id, {
          id,
          conta: conta.id,
          tipo: e.tipo,
          data: e.data,
          hora: e.hora,
          codigo: e.codigo,
          nome: p.nome,
          quantidade: e.quantidade,
          unitario: preco.unitario,
          valor: preco.valor,
          ch: preco.ch,
          cop: preco.cop,
          filme: preco.filme,
          perc: 0,
          veio: 'C',
          pacote: 'N',
          conferidoPor: '',
          usuario,
          versao: 1,
          sigtap: null,
          origem: e.origem ? `${e.origem.tipo} ${e.origem.id}` : 'manual',
        });
        conta.total = this.soma(s, conta.id).soma;
        conta.versao += 1;
        void hospital;
        return { id, conta: conta.id, valor: preco.valor };
      }
      default:
        throw new Error(`Operação ${op} sem a porta em memória.`);
    }
  }

  private etapa(
    s: Estado,
    conta: number,
    etapa: string,
    situacao: string,
    usuario: string,
    observacao: string,
  ): number {
    const id = (s.seq += 1);
    s.etapas.push({
      id,
      conta,
      etapa,
      situacao,
      usuario,
      inicio: agora(),
      fim: situacao === 'em-andamento' ? null : agora(),
      observacao,
    });
    return id;
  }

  async gravarSgh<T>(
    c: ContextoFaturamento,
    _trilha: unknown,
    fn: (g: GravadorSghFaturamento) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const g: GravadorSghFaturamento = {
      registrarPendencia: async (p) => {
        this.contaM(s, p.conta);
        const id = (s.seq += 1);
        s.pendencias.push({
          id,
          conta: p.conta,
          tipo: p.tipo,
          descricao: p.descricao,
          bloqueante: p.bloqueante,
          aberta: true,
          por: p.usuario,
          em: agora(),
          resolucao: null,
        });
        return id;
      },
      resolverPendencia: async (r) => {
        const p = s.pendencias.find((x) => x.id === r.id && x.aberta);
        if (!p) throw recusa('pendencia-resolvida', 'A pendência não existe ou já foi resolvida.');
        p.aberta = false;
        p.resolucao = r.resolucao;
        return { conta: p.conta };
      },
      registrarEtapa: async (x) => {
        const conta = this.contaM(s, x.conta);
        if (conta.fechada !== 'N')
          throw recusa('conta-fechada', 'A conferência e a auditoria são feitas na conta aberta.');
        const aberta = s.etapas.find(
          (y) => y.conta === x.conta && y.etapa === x.etapa && y.situacao === 'em-andamento',
        );
        if (x.acao === 'iniciar') {
          if (aberta) throw recusa('etapa-em-andamento', 'A etapa desta conta já está em andamento.');
          return this.etapa(s, x.conta, x.etapa, 'em-andamento', x.usuario, x.observacao);
        }
        if (!aberta) throw recusa('etapa-nao-iniciada', 'Não há etapa em andamento para concluir.');
        aberta.situacao = 'concluida';
        aberta.fim = agora();
        return aberta.id;
      },
      decidirLancamentoTardio: async (d) => {
        const f = s.fichas.find((x) => x.registro === d.registro);
        if (!f) throw recusa('ficha-inexistente', 'A ficha de atendimento não existe.');
        if (s.decisoes.has(d.registro))
          throw recusa('ja-decidido', 'A decisão desta ficha já foi registrada.');
        s.decisoes.set(d.registro, { decisao: d.decisao, por: d.usuario, motivo: d.motivo });
        return (s.seq += 1);
      },
      editarRegra: async (r) => {
        const id = r.id ?? (s.seq += 1);
        const lida: RegraLida = {
          id,
          convenio: r.regra.convenio,
          nome: r.regra.nome,
          exige: r.regra.exige,
          seletor: {
            tipoConta: r.regra.seletor.tipoConta,
            grupos: [...r.regra.seletor.grupos],
            codigos: [...r.regra.seletor.codigos],
          },
          bloqueiaFechamento: r.regra.bloqueiaFechamento,
          inicio: r.regra.inicio,
          fim: r.regra.fim,
          ativa: r.ativa,
          autor: r.usuario,
        };
        s.regras = [...s.regras.filter((x) => x.id !== id), lida];
        return id;
      },
      editarPacote: async (p) => {
        const id = p.id ?? (s.seq += 1);
        s.pacotes = [
          ...s.pacotes.filter((x) => x.id !== id),
          {
            id,
            convenio: p.convenio,
            codigo: p.codigo,
            nome: p.nome,
            valor: p.valor,
            inicio: p.inicio,
            fim: p.fim,
            ativo: p.ativo,
            itens: p.itens.map((i) => ({ ...i })),
          },
        ];
        return id;
      },
      registrarVersaoAuditoria: async (v) => {
        this.contaM(s, v.conta);
        const so = this.soma(s, v.conta);
        const id = (s.seq += 1);
        s.versoes.push({
          id,
          conta: v.conta,
          papel: v.papel,
          parecer: v.parecer,
          usuario: v.usuario,
          em: agora(),
          total: so.soma,
          itens: so.itens,
        });
        return id;
      },
      registrarOrcamento: async (o) => {
        const r = conferirSemCaucao({ urgencia: o.urgencia, exigeGarantiaAntes: o.exigeGarantiaAntes });
        if (r) throw recusa(r.codigo, r.mensagem);
        const id = (s.seq += 1);
        const total = totalOrcamento(o.itens, o.desconto);
        const v = new Date(Date.now() + o.validadeDias * 86_400_000).toISOString().slice(0, 10);
        s.orcamentos.unshift({
          id,
          prontuario: o.prontuario,
          nome: o.nome,
          total,
          desconto: o.desconto,
          validoAte: v,
          urgencia: o.urgencia,
          situacao: 'aberto',
          pago: 0,
          itens: o.itens.map((i) => ({ ...i })),
          criadoPor: o.usuario,
          criadoEm: agora(),
        });
        return { id, total };
      },
      abrirCaixa: async (x) => {
        if (s.caixas.some((y) => y.operador === x.usuario && y.fechadoEm === null))
          throw recusa('caixa-aberto', 'Você já tem um caixa aberto: feche-o antes de abrir outro.');
        const id = (s.seq += 1);
        s.caixas.unshift({
          id,
          operador: x.usuario,
          abertoEm: agora(),
          fechadoEm: null,
          saldoInicial: x.saldoInicial,
          contado: null,
        });
        return id;
      },
      fecharCaixa: async (x) => {
        const cx = s.caixas.find((y) => y.id === x.id && y.operador === x.usuario && y.fechadoEm === null);
        if (!cx) throw recusa('caixa-fechado', 'O caixa não está aberto em seu nome.');
        cx.fechadoEm = agora();
        cx.contado = x.contado;
        const dinheiro = s.pagamentos
          .filter((p) => p.caixa === x.id && p.forma === 'dinheiro' && p.situacao === 'aprovado')
          .reduce((t, p) => t + p.valor, 0);
        return { esperado: r2(cx.saldoInicial + dinheiro) };
      },
      receberParticular: async (r) => {
        const cx = s.caixas.find((y) => y.id === r.caixa && y.operador === r.usuario && y.fechadoEm === null);
        if (!cx) throw recusa('caixa-fechado', 'Abra o seu caixa antes de receber.', ['caixa']);
        const orc = r.orcamento ? s.orcamentos.find((o) => o.id === r.orcamento) : undefined;
        if (r.orcamento && !orc)
          throw recusa('orcamento-inexistente', 'O orçamento não existe.', ['orcamento']);
        if (orc && orc.situacao !== 'aberto')
          throw recusa('orcamento-fechado', 'O orçamento já foi pago ou cancelado.');
        if (!orc && r.conta) {
          const np = conferirRecebimentoDaConta(FONTES_PARTICULARES.has(this.contaM(s, r.conta).convenio));
          if (np) throw recusa(np.codigo, np.mensagem, ['conta']);
        }
        const saldo = orc ? r2(orc.total - orc.pago) : r.conta ? this.contaM(s, r.conta).total : 0;
        const ok = conferirRecebimento({ saldo, pagamentos: r.pagamentos });
        if (ok) throw recusa(ok.codigo, ok.mensagem);
        const ids: number[] = [];
        let recebido = 0;
        for (const p of r.pagamentos) {
          const eletronico = p.forma === 'pix' || p.forma.startsWith('cartao');
          if (eletronico && !p.comprovante && !r.simulado)
            throw recusa(
              'sem-conector',
              'O conector de Pix e cartão não está configurado: registre o comprovante à mão.',
              ['pagamentos'],
            );
          const id = (s.seq += 1);
          const conector = p.forma === 'dinheiro' ? 'dinheiro' : p.comprovante ? 'manual' : 'simulado';
          s.pagamentos.unshift({
            id,
            caixa: r.caixa,
            orcamento: r.orcamento,
            conta: r.conta,
            forma: p.forma,
            valor: p.valor,
            parcelas: p.parcelas,
            situacao: 'aprovado',
            comprovante: p.comprovante ?? `SIM-${p.forma.toUpperCase().slice(0, 4)}-${id}`,
            conector,
            recibo: null,
            em: agora(),
          });
          recebido += p.valor;
          ids.push(id);
        }
        if (orc) {
          orc.pago = r2(orc.pago + recebido);
          if (orc.pago >= orc.total) orc.situacao = 'pago';
        }
        return { pagamentos: ids, troco: Math.max(0, r2(recebido - saldo)) };
      },
      emitirRecibo: async (x) => {
        const p = s.pagamentos.find((y) => y.id === x.pagamento);
        if (!p) throw recusa('pagamento-inexistente', 'O pagamento não existe.');
        if (p.recibo !== null)
          throw recusa('recibo-emitido', `O recibo deste pagamento já foi emitido (nº ${p.recibo}).`);
        const id = (s.seq += 1);
        p.recibo = id;
        s.recibos.unshift({
          id,
          numero: id,
          pagamento: p.id,
          pagador: x.pagador,
          referente: x.referente,
          valor: p.valor,
          em: agora(),
          emitidoPor: x.usuario,
          origem: 'novo',
        });
        return { id, numero: id };
      },
    };
    return fn(g);
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────

  async hoje(): Promise<string> {
    return hojeIso();
  }

  private resumo(s: Estado, c: ContaM, hoje: string): ContaResumo {
    const etapa = s.etapas.find(
      (y) =>
        y.conta === c.id &&
        y.situacao === 'em-andamento' &&
        (y.etapa === 'conferencia' || y.etapa === 'auditoria'),
    );
    const sd = situacaoDerivada({
      fechada: c.fechada,
      indEmi: c.indEmi,
      emLote: c.emLote,
      protocolada: false,
      valorRetorno: 0,
      valorRecurso: 0,
      etapaNovo: (etapa?.etapa as 'conferencia' | 'auditoria' | undefined) ?? null,
    });
    return {
      id: c.id,
      ano: c.ano,
      mes: c.mes,
      tipoConta: c.tipoConta,
      codigo: c.codigo,
      paciente: c.paciente,
      convenio: c.convenio,
      convenioNome: CONVENIOS[c.convenio] ?? '',
      situacao: sd.situacao,
      situacaoRotulo: sd.rotulo,
      inferida: sd.inferida,
      fechada: c.fechada,
      emitida: c.indEmi === 'T',
      alta: c.alta,
      diasDesdeAlta: diasDesde(c.alta, hoje),
      total: c.total,
      pacote: c.pacote,
      pendencias: s.pendencias.filter((p) => p.conta === c.id && p.aberta).length,
    };
  }

  async setoresDoSimulador(): Promise<{ id: number; nome: string }[]> {
    return [];
  }

  async convenios(): Promise<{ codigo: number; nome: string }[]> {
    return Object.entries(CONVENIOS).map(([k, nome]) => ({ codigo: Number(k), nome }));
  }

  async contas(c: ContextoFaturamento, f: FiltroContasPorta, hoje: string): Promise<ListaContas> {
    const s = this.e(c);
    let l = [...s.contas.values()].filter((x) => f.convenios === null || f.convenios.includes(x.convenio));
    if (f.tipoConta) l = l.filter((x) => x.tipoConta === f.tipoConta);
    if (f.ano) l = l.filter((x) => x.ano === f.ano && (!f.mes || x.mes === f.mes));
    const ate = f.altaAte;
    if (ate) l = l.filter((x) => x.alta !== null && x.alta <= ate);
    const t = (f.termo ?? '').trim();
    if (/^\d+$/.test(t)) l = l.filter((x) => x.id === Number(t) || x.codigo === Number(t));
    else if (t.length >= 3) l = l.filter((x) => x.paciente.startsWith(t.toUpperCase()));
    let r = l.map((x) => this.resumo(s, x, hoje));
    if (f.situacao) r = r.filter((x) => x.situacao === f.situacao);
    return {
      contas: r.slice(f.pagina * f.porPagina, (f.pagina + 1) * f.porPagina),
      total: r.length,
      pagina: f.pagina,
      porPagina: f.porPagina,
      regua: 'competencia',
    };
  }

  async conta(c: ContextoFaturamento, id: number, hoje: string): Promise<ContaDetalhe | null> {
    const s = this.e(c);
    const x = s.contas.get(id);
    if (!x) return null;
    const so = this.soma(s, id);
    const pac = legendaPacoteConta(x.pacote);
    const pre =
      x.fechada === 'N'
        ? conferirFechamento({
            fechada: x.fechada,
            remessa: x.remessa,
            dataEmissao: x.dataEmissao,
            indEmi: x.indEmi,
            pacote: x.pacote,
            itens: so.itens,
            somaItens: so.soma,
            totalConta: x.total,
            preVoo: {
              medicoSolicitanteValido: true,
              medicoContaValido: true,
              procedimentoNaTabela: true,
              tituloReceberExiste: true,
            },
            pendenciasBloqueantes: s.pendencias.filter((p) => p.conta === id && p.aberta && p.bloqueante)
              .length,
          })
        : null;
    const regras = s.regras
      .filter((r) => r.ativa)
      .map((r) => esquemaRegraFaturabilidade.safeParse({ ...r, seletor: r.seletor }))
      .filter((p) => p.success)
      .map((p) => p.data);
    const avisos = avaliarFaturabilidade(regras, {
      convenio: x.convenio,
      tipoConta: x.tipoConta,
      dataBase: hoje,
      senha: x.senha,
      guia: x.guia,
      cid: null,
      validadeCarteira: null,
      itens: this.itensDa(s, id).map((i) => ({
        grupo: grupoDoItem(i.tipo),
        codigo: i.codigo,
        autorizacao: null,
      })),
    }).map((v) => v.mensagem);
    return {
      ...this.resumo(s, x, hoje),
      versao: this.versao(x.versao),
      remessa: x.remessa,
      dataEmissao: x.dataEmissao,
      dataFechamento: x.dataFechamento,
      usuarioFechamento: x.usuarioFechamento,
      indEmi: x.indEmi,
      pacoteRotulo: pac.rotulo,
      pacoteAConfirmar: pac.aConfirmar,
      tipoNota: 1,
      guia: x.guia,
      senha: x.senha,
      registroAtendimento: x.registro,
      somaItens: so.soma,
      itens: so.itens,
      lotesTiss: x.emLote ? 1 : 0,
      beneficiario: {
        matricula: 'MAT-SINT-001',
        validadeCarteira: null,
        cpfMascarado: '***.***.***-00',
        plano: 'PLANO SINTETICO',
      },
      guias: [{ tipo: 'R', principal: x.guia, secundaria: '', senha: x.senha, sequencia: 1 }],
      parciais: [],
      pendenciasLista: s.pendencias
        .filter((p) => p.conta === id)
        .map((p) => ({
          id: p.id,
          tipo: p.tipo,
          tipoNome: p.tipo === 0 ? 'Regra do novo (faturabilidade, item sem preço)' : `Tipo ${p.tipo}`,
          descricao: p.descricao,
          bloqueante: p.bloqueante,
          aberta: p.aberta,
          registradaPor: p.por,
          registradaEm: p.em,
          resolucao: p.resolucao,
          origem: 'novo' as const,
        })),
      etapas: s.etapas
        .filter((e) => e.conta === id)
        .map((e) => ({
          id: e.id,
          etapa: e.etapa as never,
          situacao: e.situacao as never,
          usuario: e.usuario,
          inicio: e.inicio,
          fim: e.fim,
          observacao: e.observacao,
        }))
        .reverse(),
      avisos,
      preVooFechamento: pre ? { codigo: pre.codigo, mensagem: pre.mensagem } : null,
    };
  }

  private itemLido(i: ItemM): ItemConta {
    const g = grupoDoItem(i.tipo);
    const o = origemDoItem(i.veio);
    return {
      id: i.id,
      versao: this.versao(i.versao),
      tipo: i.tipo,
      grupo: g ? ROTULO_GRUPO[g] : '',
      data: i.data,
      hora: i.hora,
      codigo: i.codigo,
      nome: i.nome,
      quantidade: i.quantidade,
      unitario: i.unitario,
      valor: i.valor,
      ch: i.ch,
      cop: i.cop,
      filme: i.filme,
      perc: i.perc,
      veio: i.veio,
      origemRotulo: o.rotulo,
      origemAConfirmar: o.aConfirmar,
      documentoOrigem: i.origem,
      pacote: i.pacote,
      pacoteRotulo: legendaPacoteItem(i.pacote).rotulo,
      conferidoPor: i.conferidoPor,
      usuario: i.usuario,
      sigtap: i.sigtap,
    };
  }

  async itens(
    c: ContextoFaturamento,
    conta: number,
    o: {
      pagina: number;
      porPagina: number;
      tipo?: number | null;
      naoConferidos?: boolean;
      regua?: 'competencia' | 'data-item';
    },
  ): Promise<ListaItens> {
    const s = this.e(c);
    let l = this.itensDa(s, conta);
    if (o.tipo) l = l.filter((i) => i.tipo === o.tipo);
    if (o.naoConferidos) l = l.filter((i) => !i.conferidoPor);
    const p = l.slice(o.pagina * o.porPagina, (o.pagina + 1) * o.porPagina).map((i) => this.itemLido(i));
    return {
      itens: p,
      total: l.length,
      pagina: o.pagina,
      porPagina: o.porPagina,
      somaPagina: r2(p.reduce((t, i) => t + i.valor, 0)),
      regua: o.regua ?? 'competencia',
    };
  }

  async explicar(c: ContextoFaturamento, item: number): Promise<ExplicacaoLida | null> {
    const s = this.e(c);
    const i = s.itens.get(item);
    if (!i) return null;
    const p = PRECOS[`${i.tipo}:${i.codigo}`];
    const x = explicarPreco(
      {
        grupo: grupoDoItem(i.tipo)!,
        data: i.data,
        quantidade: i.quantidade,
        unitario: i.unitario,
        valor: i.valor,
        ch: i.ch,
        cop: i.cop,
        filme: i.filme,
        perc: i.perc,
        percE: 0,
        formula: 1,
        pacote: i.pacote,
        codigo: i.codigo,
      },
      p
        ? {
            convenio: 91,
            tabela: 1,
            nomeTabela: 'TABELA SINTETICA',
            vigencia: `${i.data.slice(0, 4)}-01-01`,
            ...p.base,
          }
        : null,
    );
    return { item, ...x, passos: [...x.passos] };
  }

  async contaDaPendencia(c: ContextoFaturamento, id: number): Promise<number | null> {
    return this.e(c).pendencias.find((p) => p.id === id)?.conta ?? null;
  }

  async contaParticular(c: ContextoFaturamento, conta: number): Promise<boolean | null> {
    const x = this.e(c).contas.get(conta);
    return x ? FONTES_PARTICULARES.has(x.convenio) : null;
  }

  async convenioDaConta(c: ContextoFaturamento, conta: number): Promise<number | null> {
    return this.e(c).contas.get(conta)?.convenio ?? null;
  }

  async convenioDoItem(c: ContextoFaturamento, item: number): Promise<number | null> {
    const s = this.e(c);
    const i = s.itens.get(item);
    return i ? (s.contas.get(i.conta)?.convenio ?? null) : null;
  }

  async sigtap(c: ContextoFaturamento, conta: number): Promise<ItemSigtap[]> {
    return this.itensDa(this.e(c), conta)
      .filter((i) => i.tipo === 2 || i.tipo === 3)
      .map((i) => ({ item: i.id, codigo: i.codigo, nome: i.nome, sigtap: i.sigtap, sigtapCodigo: null }));
  }

  private tardiosDe(s: Estado, convenios: readonly number[] | null): LancamentoTardio[] {
    return s.fichas
      .filter((f) => convenios === null || convenios.includes(f.convenio))
      .filter((f) => !f.depoisDoFechamento || (s.contas.get(f.conta)?.fechada ?? 'N') !== 'N')
      .map((f) => {
        const conta = s.contas.get(f.conta);
        const d = s.decisoes.get(f.registro);
        return {
          registro: f.registro,
          data: f.data,
          convenio: f.convenio,
          conta: conta?.id ?? null,
          contaSituacao: conta
            ? ROTULO_SITUACAO[
                situacaoDerivada({
                  fechada: conta.fechada,
                  indEmi: null,
                  emLote: false,
                  protocolada: false,
                  valorRetorno: 0,
                  valorRecurso: 0,
                  etapaNovo: null,
                }).situacao
              ]
            : 'sem conta',
          paciente: conta?.paciente ?? '',
          decisao: d?.decisao ?? null,
          decididoPor: d?.por ?? null,
          motivo: d?.motivo ?? null,
        };
      });
  }

  async painelLancamentos(
    c: ContextoFaturamento,
    o: { convenios: readonly number[] | null },
  ): Promise<PainelLancamentos> {
    const s = this.e(c);
    const por = new Map<string, { itens: number; valor: number }>();
    for (const i of s.itens.values()) {
      const x = por.get(i.veio) ?? { itens: 0, valor: 0 };
      x.itens += 1;
      x.valor = r2(x.valor + i.valor);
      por.set(i.veio, x);
    }
    const t = this.tardiosDe(s, o.convenios);
    return {
      porOrigem: [...por.entries()].map(([veio, x]) => ({ veio, ...origemDoItem(veio), ...x })),
      tardios: t,
      totalTardios: t.length,
      pendentesDecisao: t.filter((x) => x.decisao === null).length,
    };
  }

  async tardios(
    c: ContextoFaturamento,
    o: { convenios: readonly number[] | null; pagina: number; porPagina: number },
  ) {
    const t = this.tardiosDe(this.e(c), o.convenios);
    return { itens: t.slice(o.pagina * o.porPagina, (o.pagina + 1) * o.porPagina), total: t.length };
  }

  async auditoria(c: ContextoFaturamento, conta: number): Promise<AuditoriaConta> {
    const s = this.e(c);
    this.contaM(s, conta);
    return {
      conta,
      retratoLegado: null,
      diferencas: [],
      versoes: s.versoes.filter((v) => v.conta === conta).reverse(),
      irregularidades: s.pendencias
        .filter((p) => p.conta === conta)
        .map((p) => ({
          id: p.id,
          tipo: p.tipo,
          nome: TIPOS_PENDENCIA.find((x) => x.id === p.tipo)?.nome ?? `Tipo ${p.tipo}`,
          descricao: p.descricao,
          aberta: p.aberta,
          registradaEm: p.em,
        })),
    };
  }

  async tiposPendencia() {
    return TIPOS_PENDENCIA.map((x) => ({ ...x, modulos: [...x.modulos] }));
  }

  async apoioPacotes() {
    return {
      controles: [
        { id: 1, nome: 'Sim' },
        { id: 2, nome: 'Não' },
      ],
      orcamentosPadrao: [
        {
          convenio: 10,
          procedimento: 40302199,
          tipo: 3,
          nome: 'EXAME SINTETICO DE SANGUE',
          valor: 50,
          quantidade: 1,
        },
      ],
      orcamentoAntigo: 0,
    };
  }

  async regras(c: ContextoFaturamento): Promise<RegraLida[]> {
    return [...this.e(c).regras].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async pacotes(c: ContextoFaturamento): Promise<PacoteLido[]> {
    return [...this.e(c).pacotes];
  }

  async notaSala(c: ContextoFaturamento, cirurgia: number): Promise<NotaSala | null> {
    if (cirurgia !== 5001) return null;
    const s = this.e(c);
    return {
      cirurgia,
      data: hojeIso(),
      sala: 'SALA SINTETICA 1',
      procedimentos: [{ codigo: 30730031, nome: 'PROCEDIMENTO CIRURGICO SINTETICO' }],
      equipe: [{ funcao: 'Cirurgião', profissional: 'registro 1' }],
      itensConta: this.itensDa(s, 9001).map((i) => this.itemLido(i)),
      conta: 9001,
    };
  }

  async cirurgias() {
    return [{ id: 5001, data: hojeIso(), sala: 1, conta: 9001 }];
  }

  async orcamentos(c: ContextoFaturamento): Promise<OrcamentoParticular[]> {
    return [...this.e(c).orcamentos];
  }

  async caixas(c: ContextoFaturamento, operador: string | null): Promise<CaixaLido[]> {
    const s = this.e(c);
    return s.caixas
      .filter((x) => operador === null || x.operador === operador)
      .map((x) => {
        const ps = s.pagamentos.filter((p) => p.caixa === x.id && p.situacao === 'aprovado');
        const porForma: Record<string, number> = {};
        for (const p of ps) porForma[p.forma] = r2((porForma[p.forma] ?? 0) + p.valor);
        const recebido = r2(ps.reduce((t, p) => t + p.valor, 0));
        return {
          ...x,
          recebido,
          diferenca:
            x.contado === null ? null : r2(x.contado - (x.saldoInicial + (porForma['dinheiro'] ?? 0))),
          porForma,
        };
      });
  }

  async pagamentos(c: ContextoFaturamento, f: FiltroPagamentos): Promise<PagamentoLido[]> {
    const porPagina = Math.min(300, Math.max(1, f.porPagina ?? 300));
    const pagina = Math.max(0, f.pagina ?? 0);
    return this.e(c)
      .pagamentos.filter(
        (p) =>
          (!f.caixa || p.caixa === f.caixa) &&
          (!f.forma || p.forma === f.forma) &&
          (!f.situacao || p.situacao === f.situacao) &&
          (!f.desde || p.em.slice(0, 10) >= f.desde) &&
          (!f.ate || p.em.slice(0, 10) <= f.ate),
      )
      .slice(pagina * porPagina, (pagina + 1) * porPagina);
  }

  async recibos(c: ContextoFaturamento, antigos: boolean): Promise<ReciboLido[]> {
    const novos = [...this.e(c).recibos];
    return antigos
      ? [
          ...novos,
          {
            id: 1,
            numero: 501,
            pagamento: null,
            pagador: 'PAGADOR SINTETICO',
            referente: 'Recibo do período 2020 a 2021',
            valor: 80,
            em: '2021-03-10',
            emitidoPor: 'SINT.ANTIGO',
            origem: 'antigo',
          },
        ]
      : novos;
  }

  async worklist(
    c: ContextoFaturamento,
    o: { convenios: readonly number[] | null; hoje: string; prazoDias: number },
  ): Promise<WorklistFaturamento> {
    const s = this.e(c);
    const contas = [...s.contas.values()].filter(
      (x) => o.convenios === null || o.convenios.includes(x.convenio),
    );
    const por = new Map<string, { rotulo: string; contas: number; valor: number }>();
    for (const x of contas.filter((y) => y.fechada === 'N' || y.fechada === 'S')) {
      const r = this.resumo(s, x, o.hoje);
      const v = por.get(r.situacao) ?? { rotulo: r.situacaoRotulo, contas: 0, valor: 0 };
      v.contas += 1;
      v.valor = r2(v.valor + x.total);
      por.set(r.situacao, v);
    }
    const abertas = contas.filter((x) => x.fechada === 'N');
    return {
      porSituacao: [...por.entries()].map(([situacao, v]) => ({ situacao, ...v })),
      porPrazo: [{ faixa: `Até ${o.prazoDias} dias da alta`, contas: abertas.length }],
      comPendencia: new Set(s.pendencias.filter((p) => p.aberta).map((p) => p.conta)).size,
      tardiosPendentes: this.tardiosDe(s, o.convenios).filter((t) => t.decisao === null).length,
      emAuditoria: s.etapas.filter((e) => e.etapa === 'auditoria' && e.situacao === 'em-andamento').length,
    };
  }

  async simular(_c: ContextoFaturamento, x: PedidoSimulacao): Promise<ResultadoSimulacao> {
    const p = PRECOS[`${x.tipo}:${x.codigo}`];
    if (!p) return { encontrado: false, nome: '', preco: null, vigencia: null };
    const vig = `${x.data.slice(0, 4)}-01-01`;
    const preco = precoDaTabela(
      grupoDoItem(x.tipo)!,
      { convenio: x.convenio, tabela: 1, nomeTabela: null, vigencia: vig, ...p.base },
      x.quantidade,
    );
    if (!preco) return { encontrado: true, nome: p.nome, preco: null, vigencia: null };
    // A mesma explicação e o mesmo impacto da fonte própria (origem: a vigência do valor da tabela sintética).
    const outros = Math.round((preco.unitario - preco.ch - preco.cop - preco.filme) * 100) / 100;
    const passos = [
      `Vigência de ${vig} da tabela 1: honorário ${preco.ch} + custo operacional ${preco.cop} + filme ${preco.filme} = ${preco.unitario}.`,
      `Valor = ${preco.unitario} × ${x.quantidade} = ${preco.valor}.`,
    ];
    let impacto: ResultadoSimulacao['impacto'] = null;
    if (x.reajuste) {
      const entrada: EntradaTotalHonorario = {
        item: { ch: 0 },
        vigente: { ch: preco.ch, co: preco.cop, filme: preco.filme, anes: 0, outros },
        indices: { valores: new Map(), origem: new Map() },
        porte: null,
      };
      const r = simularReajusteItem(entrada, x.reajuste, x.quantidade);
      impacto = {
        atual: r.atual.total,
        novo: r.novo.total,
        diferenca: r.diferenca,
        percentual: r.percentual,
        afetadoPor: r.afetadoPor,
        passos: r.novo.passos,
      };
    }
    return { encontrado: true, nome: p.nome, preco, vigencia: vig, origem: 'vigencia', passos, impacto };
  }

}
