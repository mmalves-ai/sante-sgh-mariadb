// Porta do pós-fechamento em MEMÓRIA (M31): a sessão sintética de dev/ci (E2E). Contas, lotes, itens, demonstrativos e
// competências SINTÉTICOS (nenhum dado real; nada vai à cópia), com as mesmas validações (Zod dos contratos) e as mesmas
// regras do domínio que a porta do banco confere (lote, numeração do contador, XSD 04.03.00, protocolo, baixa,
// recurso, desfecho, competência e decisão da glosa). As contas 9101 a 9103 (convênio 91) nascem emitidas e fechadas,
// prontas para o lote; o lote 8002 (do outro sistema, protocolado) tem a conta 9201 com uma glosa pendente, um item em
// recurso e um não conciliado; o lote 8001 é antigo e sem protocolo (situação inferida).
import { contasBancariasSinteticasDoEscopo } from '../financeiro/public-api.js';
import type {
  CompetenciaLida,
  ConfiguracaoTissLida,
  ContaProntaLote,
  ContaTiss,
  DemonstrativoLido,
  EndpointTissLido,
  EstadoOperacao,
  EvidenciaGlosaLida,
  GradeGlosa,
  GuiaLida,
  ItemDemonstrativoLido,
  ItemGlosaLido,
  ListaLotes,
  LoteDetalhe,
  LoteLido,
  MotivoGlosaLido,
  PainelGlosa,
  PrazoEnvio,
} from '@sgh/contratos';
import {
  avisoInferida,
  centavos,
  conferirBaixa,
  conferirCompetenciaAberta,
  conferirContaParaLote,
  conferirDecisaoGlosa,
  conferirDesfecho,
  conferirFechamentoCompetencia,
  conferirReaberturaCompetencia,
  conferirRecurso,
  conferirRegistroProtocolo,
  conferirValorRecurso,
  criarMontadorLote,
  faixaDoValor,
  indicadoresGlosa,
  loteCongelado,
  MOTIVO_NAO_INFORMADO,
  normalizarProtocolo,
  padraoRecurso,
  prazoRecurso,
  proximaEntrega,
  entregasAFrente,
  type JanelaEntrega,
  proximoNumero,
  ROTULO_SITUACAO_LOTE,
  ROTULO_TIPO_GUIA,
  semanticaGlosa,
  situacaoDoLote,
  tipoGuiaCompativel,
  VERSAO_TISS_VIGENTE,
} from '@sgh/dominio-faturamento';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import type { EstadoCatalogo } from '../cadastro/porta.js';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { ENTRADAS_TISS } from './esquemas.js';
import type { LinhaContasCompetencia } from '@sgh/contratos/regras-faturamento';
import { type ArmazemXmlTiss, armazemXmlMemoria } from './armazem-xml.js';
import type {
  ContextoTiss,
  FiltroAcompanhamentoPorta,
  FiltroContasLote,
  FiltroGlosa,
  FiltroLotes,
  GravadorSghTiss,
  LeituraAcompanhamento,
  PortaTiss,
} from './porta.js';

/** M42: a fonte das contas da competência e das gravações da conta do paciente na sessão sintética (porta do M30). */
export interface FonteContasMemoria {
  linhas(hospital: string, ano: number, mes: number): LinhaContasCompetencia[];
  gravacoes(hospital: string): ReadonlyMap<string, number>;
}

const recusa = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem, campos ? { campos } : {});
const hojeIso = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const agora = () => new Date().toISOString().slice(0, 19);
const versao = (n: number) => `2026-10-23T00:00:00.${String(n).padStart(3, '0')}Z`;

interface ContaM {
  id: number;
  convenio: number;
  tipoConta: 'E' | 'I';
  ano: number;
  mes: number;
  codigo: number;
  fechada: string;
  indEmi: string;
  carteira: string;
  dataEmissao: string;
  versao: number;
}
interface ItemM {
  id: number;
  conta: number;
  tipo: number;
  codigo: string;
  descricao: string;
  quantidade: number;
  valor: number;
  glosado: string;
  valorPago: number;
  quantidadePaga: number;
  dataPagamento: string | null;
  motivo: number;
  valorRecurso: number;
  quantidadeRecurso: number;
  dataRecurso: string | null;
  valorRetorno: number;
  quantidadeRetorno: number;
  dataRetorno: string | null;
  motivoRetorno: number;
  sequencial: number | null;
  versao: number;
}
interface LoteM {
  id: number;
  convenio: number;
  tipoGuia: number;
  numero: string;
  sequencial: string;
  protocolo: string;
  dataHora: string;
  contas: number[];
  xml: LoteLido['xml'];
}
interface Estado {
  seq: number;
  contas: Map<number, ContaM>;
  itens: Map<number, ItemM>;
  lotes: Map<number, LoteM>;
  contador: Map<number, { numero: string; sequencial: string }>;
  /** O estado atual de cada competência fechada alguma vez; reabrir marca, nunca remove (histórico nos ciclos). */
  competencias: {
    convenio: number;
    ano: number;
    mes: number;
    em: string;
    por: string;
    situacao: 'fechada' | 'reaberta';
    reabertaEm: string | null;
    reabertaPor: string;
    motivo: string;
    ciclos: { tipo: 'fechamento' | 'reabertura'; em: string; por: string; motivo: string }[];
  }[];
  protocolos: {
    lote: number;
    acao: 'registrado' | 'limpo';
    protocolo: string;
    data: string | null;
    recibo: string;
    situacao: number | null;
    por: string;
    em: string;
  }[];
  demonstrativos: (DemonstrativoLido & { itensM: ItemDemonstrativoLido[] })[];
  decisoes: Map<
    number,
    { estado: string; motivo: string; evidencia: string; por: string; em: string; prazo: string | null }
  >;
  desfechos: Map<number, string>;
  endpoints: EndpointTissLido[];
  mensagens: {
    lote: number;
    direcao: string;
    destino: string;
    transacao: string;
    situacao: string;
    tentativa: number;
    protocolo: string;
    em: string;
  }[];
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
}

const CONVENIOS: Readonly<Record<number, string>> = { 91: 'CONVENIO SINTETICO', 92: 'OPERADORA SINTETICA 2' };
const MOTIVOS: readonly MotivoGlosaLido[] = [
  { codigo: 0, nome: 'NÃO INFORMADO', tipo: 1, tipoNome: 'Não informado', reapresenta: true },
  { codigo: 1705, nome: 'COBRANÇA SINTÉTICA EM DUPLICIDADE', tipo: 5, tipoNome: 'Guia', reapresenta: true },
  {
    codigo: 1801,
    nome: 'MOTIVO SINTÉTICO SEM REAPRESENTAÇÃO',
    tipo: 10,
    tipoNome: 'Procedimento',
    reapresenta: false,
  },
  { codigo: 3095, nome: 'RECURSO DE GLOSA ACATADO', tipo: 20, tipoNome: 'Glosa', reapresenta: true },
];
const SITUACOES = [
  'RECEBIDO',
  'EM ANÁLISE',
  'LIBERADO PARA PAGAMENTO',
  'ENCERRADO SEM PAGAMENTO',
  'ANALISADO E AGUARDANDO LIBERAÇÃO PARA O PAGAMENTO',
  'PAGAMENTO EFETUADO',
  'NÃO LOCALIZADO',
  'AGUARDANDO INFORMAÇÃO COMPLEMENTAR',
  'CANCELADO',
  'BLOQUEIO JUDICIAL - PRESTADOR',
].map((nome, i) => ({ id: i + 1, nome }));

export class PortaTissMemoria implements PortaTiss {
  readonly destino = 'memoria' as const;
  readonly armazem: ArmazemXmlTiss & { objetos: Map<string, Uint8Array> } = armazemXmlMemoria();
  private readonly estados = new Map<string, Estado>();
  private readonly montador = criarMontadorLote(this.armazem.guardar);

  constructor(private readonly catalogo: EstadoCatalogo | null) {}

  private e(c: ContextoTiss): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = this.semear();
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  private semear(): Estado {
    const hoje = hojeIso();
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
    const s: Estado = {
      seq: 100,
      contas: new Map(),
      itens: new Map(),
      lotes: new Map(),
      contador: new Map([
        [91, { numero: '000000000041', sequencial: '000000000041' }],
        [92, { numero: '000000000007', sequencial: '000000000007' }],
      ]),
      competencias: [
        {
          convenio: 91,
          ano: anterior.mes === 1 ? anterior.ano - 1 : anterior.ano,
          mes: anterior.mes === 1 ? 12 : anterior.mes - 1,
          em: `${hoje}T08:00:00`,
          por: 'SINT.TISS',
          situacao: 'fechada',
          reabertaEm: null,
          reabertaPor: '',
          motivo: '',
          ciclos: [{ tipo: 'fechamento', em: `${hoje}T08:00:00`, por: 'SINT.TISS', motivo: '' }],
        },
      ],
      protocolos: [],
      demonstrativos: [],
      decisoes: new Map(),
      desfechos: new Map(),
      endpoints: [],
      mensagens: [],
      idem: new Map(),
    };
    const conta = (id: number, tipoConta: 'E' | 'I', fechada: string, convenio = 91) =>
      s.contas.set(id, {
        id,
        convenio,
        tipoConta,
        ano: anterior.ano,
        mes: anterior.mes,
        codigo: 50_000 + id,
        fechada,
        indEmi: 'T',
        carteira: `SINTETICO${String(id).padStart(7, '0')}`,
        dataEmissao: hoje,
        versao: 1,
      });
    let seqItem = 0;
    const item = (
      conta: number,
      tipo: number,
      codigo: string,
      descricao: string,
      valor: number,
      x: Partial<ItemM> = {},
    ) => {
      const id = 70_000 + s.itens.size + 1;
      seqItem += 1;
      s.itens.set(id, {
        id,
        conta,
        tipo,
        codigo,
        descricao,
        quantidade: 1,
        valor,
        glosado: 'F',
        valorPago: 0,
        quantidadePaga: 0,
        dataPagamento: null,
        motivo: 0,
        valorRecurso: 0,
        quantidadeRecurso: 0,
        dataRecurso: null,
        valorRetorno: 0,
        quantidadeRetorno: 0,
        dataRetorno: null,
        motivoRetorno: 0,
        sequencial: x.sequencial === undefined ? seqItem : x.sequencial,
        versao: 1,
        ...x,
      });
    };
    conta(9101, 'E', 'S');
    conta(9102, 'E', 'S');
    conta(9103, 'I', 'S');
    conta(9104, 'E', 'N');
    item(9101, 3, '40302199', 'EXAME SINTÉTICO DE SANGUE', 120);
    item(9101, 3, '40801012', 'IMAGEM SINTÉTICA', 380.5);
    item(9101, 4, '310165', 'MATERIAL SINTÉTICO', 42.3);
    item(9102, 3, '40302199', 'EXAME SINTÉTICO DE SANGUE', 60);
    item(9103, 2, '10102019', 'VISITA HOSPITALAR SINTÉTICA', 90);
    item(9103, 1, '5315', 'DIÁRIA SINTÉTICA DE APARTAMENTO', 356.73);
    item(9104, 3, '40302199', 'EXAME SINTÉTICO DE SANGUE', 60);
    // O lote do outro sistema (protocolado) com a conta 9201 já apresentada.
    conta(9201, 'E', 'A');
    seqItem = 0;
    item(9201, 3, '40302199', 'EXAME SINTÉTICO DE SANGUE', 200, {
      glosado: 'T',
      valorPago: 120,
      quantidadePaga: 1,
      dataPagamento: hoje,
      motivo: 1705,
    });
    item(9201, 3, '40801012', 'IMAGEM SINTÉTICA', 300, {
      glosado: 'T',
      valorPago: 100,
      quantidadePaga: 1,
      dataPagamento: hoje,
      motivo: 1801,
      valorRecurso: 200,
      quantidadeRecurso: 1,
      dataRecurso: hoje,
    });
    item(9201, 2, '10102019', 'VISITA HOSPITALAR SINTÉTICA', 90);
    s.lotes.set(8001, {
      id: 8001,
      convenio: 91,
      tipoGuia: 2,
      numero: '000000000039',
      sequencial: '000000000039',
      protocolo: '',
      dataHora: `${hoje}T07:00:00`,
      contas: [],
      xml: null,
    });
    s.lotes.set(8002, {
      id: 8002,
      convenio: 91,
      tipoGuia: 2,
      numero: '000000000040',
      sequencial: '000000000040',
      protocolo: 'P00000000040',
      dataHora: `${hoje}T07:30:00`,
      contas: [9201],
      xml: null,
    });
    return s;
  }

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoTiss, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, c.hospital);
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento.',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoTiss, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const esquema = ENTRADAS_TISS[op];
    if (!esquema) throw recusa('operacao-desconhecida', `Operação ${op} sem gravação em memória.`);
    const analise = esquema.safeParse(entradaBruta);
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
          'A mesma chave veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = await this.aplicar(
      s,
      c,
      op,
      analise.data as never,
      (ctx as ContextoOperacao & { readonly login?: string }).login ?? '',
    );
    s.idem.set(chave, { hash, resultado });
    const g = this.gravadas.get(c.hospital) ?? new Map<string, number>();
    g.set(op, (g.get(op) ?? 0) + 1);
    this.gravadas.set(c.hospital, g);
    return { resultado, repetida: false, trilha: null };
  }

  // ── M42: acompanhamento da competência (sessão sintética) ─────────────────────────────────────────────────
  private readonly gravadas = new Map<string, Map<string, number>>();

  /**
   * As contas da conta do paciente (porta do M30 em memória, ligada pelo módulo da aplicação), somadas às do
   * pós-fechamento daqui (todas do outro sistema: nasceram fechadas na massa).
   */
  fonteContas: FonteContasMemoria | null = null;

  async contasBancariasDoEscopo(_c: ContextoTiss, login: string | null): Promise<number[] | null> {
    return contasBancariasSinteticasDoEscopo(login);
  }

  async acompanhamento(c: ContextoTiss, f: FiltroAcompanhamentoPorta): Promise<LeituraAcompanhamento> {
    const s = this.e(c);
    const noEscopo = (conv: number) =>
      (f.convenio === null || conv === f.convenio) && (f.convenios === null || f.convenios.includes(conv));
    const daqui = () => {
      const m = new Map<string, LinhaContasCompetencia>();
      for (const k of s.contas.values()) {
        if (k.ano !== f.ano || k.mes !== f.mes) continue;
        const ch = `${k.convenio}:${k.fechada}`;
        const x = m.get(ch) ?? {
          convenio: k.convenio,
          situacao: k.fechada,
          contas: 0,
          fechadasPeloNovo: 0,
          valor: 0,
        };
        const valor = [...s.itens.values()].filter((i) => i.conta === k.id).reduce((t, i) => t + i.valor, 0);
        m.set(ch, { ...x, contas: x.contas + 1, valor: centavos(x.valor + valor) });
      }
      return [...m.values()];
    };
    // As contas da conta do paciente (porta do M30) e as do pós-fechamento daqui (ids distintos na massa sintética).
    const contas = [...(this.fonteContas?.linhas(c.hospital, f.ano, f.mes) ?? []), ...daqui()].filter((l) =>
      noEscopo(l.convenio),
    );
    const contasDoMes = [...s.contas.values()].filter(
      (k) => k.ano === f.ano && k.mes === f.mes && noEscopo(k.convenio),
    );
    const idsDoMes = new Set(contasDoMes.map((k) => k.id));
    const lotes = [...s.lotes.values()].filter((l) => l.contas.some((k) => idsDoMes.has(k)));
    const conveniosComConta = new Set(contasDoMes.map((k) => k.convenio));
    const fechados = s.competencias.filter(
      (x) => x.situacao === 'fechada' && x.ano === f.ano && x.mes === f.mes && noEscopo(x.convenio),
    ).length;
    const lidas = new Map([...(this.gravadas.get(c.hospital) ?? new Map<string, number>())]);
    for (const [op, n] of this.fonteContas?.gravacoes(c.hospital) ?? [])
      lidas.set(op, (lidas.get(op) ?? 0) + n);
    return {
      contas,
      lotes: {
        lotes: lotes.length,
        comProtocolo: lotes.filter((l) => l.protocolo.trim() !== '').length,
        contasEmLote: new Set(lotes.flatMap((l) => l.contas.filter((k) => idsDoMes.has(k)))).size,
        conveniosFechados: fechados,
        conveniosComConta: conveniosComConta.size,
      },
      // Títulos e repasse sintéticos (a sessão sintética não liga o financeiro e o repasse a esta porta).
      titulos: f.titulos
        ? {
            aPagar: { titulos: 12, valor: 18_400, pagos: 9, valorPago: 13_250.5 },
            aReceber: { titulos: 6, valor: 22_310.4, recebidos: 4, valorRecebido: 15_002 },
            // O movimento sintético por conta bancária: o tipo I na conta 1 e o O na conta 2 (escopo da regra 15).
            movimento: [
              { conta: 1, tipo: 'I', lancamentos: 7, valor: 9_120 },
              { conta: 2, tipo: 'O', lancamentos: 11, valor: 13_250.5 },
            ]
              .filter((m) => f.contasBancarias === null || f.contasBancarias.includes(m.conta))
              .map(({ tipo, lancamentos, valor }) => ({ tipo, lancamentos, valor })),
          }
        : null,
      repasse: f.repasse
        ? { itensIntegrados: 5, valorIntegrado: 3_150, eventos: 3, valorEventos: 420, rpas: 2 }
        : null,
      gravacoes: f.operacoes.map((operacao) => ({ operacao, peloNovo: lidas.get(operacao) ?? 0 })),
      uso: f.uso
        ? f.uso.grupos.map((grupo, i) => ({ grupo, usuarios: 8 - i, conectadosDesde: 6 - i }))
        : null,
    };
  }

  private item(s: Estado, it: { item: number; versao: string }): ItemM {
    const i = s.itens.get(it.item);
    if (!i) throw recusa('item-inexistente', `O item ${it.item} não existe.`);
    if (versao(i.versao) !== it.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Registro alterado',
        'O item mudou desde a leitura; releia.',
        {
          campos: [`item ${it.item}`],
        },
      );
    return i;
  }

  private contaTiss(s: Estado, id: number, tipoGuia: 1 | 2 | 3 | 4): ContaTiss {
    const c = s.contas.get(id)!;
    const itens = [...s.itens.values()].filter((i) => i.conta === id);
    return {
      conta: id,
      tipoGuia,
      numeroGuia: String(c.codigo),
      carteira: c.carteira,
      atendimentoRN: false,
      inicio: { data: c.dataEmissao, hora: '08:00:00' },
      fim: { data: c.dataEmissao, hora: '12:00:00' },
      caraterAtendimento: '1',
      tipoConsulta: '1',
      tipoAtendimento: '23',
      senha: '',
      guiaSolicitacao: '',
      dataAutorizacao: '',
      tipoFaturamento: '4',
      tipoInternacao: '1',
      regimeInternacao: '1',
      motivoEncerramento: '12',
      profissional: { conselho: '06', numeroConselho: '0', uf: '33', cbos: '225125' },
      profissionalNome: 'PROFISSIONAL SINTÉTICO',
      profissionalCodigo: '',
      itens: itens.map((i, k) => {
        const natureza = i.tipo === 1 ? 'taxa' : i.tipo === 4 ? 'material' : 'procedimento';
        return {
          sequencial: k + 1,
          tipo: i.tipo,
          natureza,
          data: c.dataEmissao,
          codigo: i.codigo,
          codigoTabela: i.tipo === 1 ? '18' : i.tipo === 4 ? '19' : '22',
          descricao: i.descricao,
          quantidade: i.quantidade,
          valorUnitario: i.valor / i.quantidade,
        };
      }),
    };
  }

  private async aplicar(
    s: Estado,
    c: ContextoTiss,
    op: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    e: any,
    usuario: string,
  ): Promise<Record<string, number | string>> {
    const hoje = hojeIso();
    switch (op) {
      case 'faturamento.gerarLote': {
        for (const it of e.contas as { id: number; versao: string }[]) {
          const ct = s.contas.get(it.id);
          if (!ct) throw recusa('conta-inexistente', `A conta ${it.id} não existe.`);
          if (versao(ct.versao) !== it.versao)
            throw new ErroOperacao(
              409,
              'conflito-versao',
              'Registro alterado',
              'A conta mudou desde a leitura.',
            );
          const r = conferirContaParaLote(
            {
              id: ct.id,
              convenio: ct.convenio,
              tipoConta: ct.tipoConta,
              fechada: ct.fechada,
              indEmi: ct.indEmi,
              lotes: [...s.lotes.values()].filter((l) => l.contas.includes(ct.id)).length,
              ano: ct.ano,
              mes: ct.mes,
            },
            e,
          );
          if (r) throw recusa(r.codigo, r.mensagem);
          // Regra 9: a conta de competência fechada para o convênio não entra em lote.
          const f = conferirCompetenciaAberta(
            s.competencias.some(
              (k) =>
                k.situacao === 'fechada' &&
                k.convenio === ct.convenio &&
                k.ano === ct.ano &&
                k.mes === ct.mes,
            ),
          );
          if (f) throw recusa(f.codigo, f.mensagem);
        }
        const k = s.contador.get(e.convenio);
        if (!k) throw recusa('sem-contador', 'O convênio não tem o contador de lotes.');
        const numeroLote = proximoNumero(k.numero);
        const sequencial = proximoNumero(k.sequencial);
        const m = await this.montador({
          hospital: c.hospital,
          lote: 0,
          convenio: e.convenio,
          numeroLote,
          sequencial,
          prestador: {
            registroAns: '999999',
            codigoPrestador: 'PRESTSINT01',
            cnes: '9999999',
            nome: 'HOSPITAL SINTÉTICO',
          },
          contas: (e.contas as { id: number }[]).map((x) => this.contaTiss(s, x.id, e.tipoGuia)),
          agora: new Date(),
        });
        if (!m.valido)
          throw recusa(
            'xsd-invalido',
            `O XML do lote não passou no XSD da TISS 04.03.00: ${m.explicacao.slice(0, 3).join(' ')}`,
          );
        s.contador.set(e.convenio, { numero: numeroLote, sequencial });
        const id = 8_100 + s.lotes.size;
        s.lotes.set(id, {
          id,
          convenio: e.convenio,
          tipoGuia: e.tipoGuia,
          numero: numeroLote,
          sequencial,
          protocolo: '',
          dataHora: agora(),
          contas: (e.contas as { id: number }[]).map((x) => x.id),
          xml: {
            versao: m.versao,
            hashEpilogo: m.hashEpilogo,
            hashArquivo: m.hashArquivo,
            chave: m.chaveObjeto,
            valido: true,
            erros: [],
          },
        });
        let seq = 0;
        for (const x of e.contas as { id: number }[]) {
          const ct = s.contas.get(x.id)!;
          ct.fechada = 'A';
          ct.versao += 1;
          for (const i of [...s.itens.values()].filter((i) => i.conta === x.id)) i.sequencial = seq += 1;
        }
        return { lote: id, convenio: e.convenio, numeroLote, sequencial, contas: e.contas.length };
      }
      case 'faturamento.registrarProtocolo': {
        const l = s.lotes.get(e.lote);
        if (!l) throw recusa('lote-inexistente', 'O lote não existe.');
        const n = normalizarProtocolo(e.protocolo);
        if (!n.ok) throw recusa(n.recusa.codigo, n.recusa.mensagem, ['protocolo']);
        const r = conferirRegistroProtocolo(l.protocolo, e.acao, n.protocolo);
        if (r) throw recusa(r.codigo, r.mensagem);
        const anterior = l.protocolo;
        l.protocolo = e.acao === 'registrar' ? n.protocolo : '';
        s.protocolos.unshift({
          lote: l.id,
          acao: e.acao === 'registrar' ? 'registrado' : 'limpo',
          protocolo: e.acao === 'registrar' ? n.protocolo : anterior,
          data: e.data,
          recibo: e.recibo,
          situacao: e.situacao,
          por: usuario,
          em: agora(),
        });
        return { lote: l.id, protocolo: l.protocolo, anterior, limpou: n.limpou ? 1 : 0 };
      }
      case 'faturamento.registrarGlosa': {
        const lidos = (e.itens as { item: number; versao: string }[]).map((x) => this.item(s, x));
        e.itens.forEach((it: { valorPago: number; quantidadePaga: number; motivo: number }, k: number) => {
          const i = lidos[k]!;
          const conta = s.contas.get(i.conta)!;
          if (conta.fechada !== 'A')
            throw recusa('conta-nao-apresentada', 'A conta do item ainda não foi apresentada.');
          const r = conferirBaixa({
            valorCobrado: i.valor,
            valorPago: it.valorPago,
            quantidadePaga: it.quantidadePaga,
            motivo: it.motivo,
            motivoExiste: MOTIVOS.some((m) => m.codigo === it.motivo),
            jaBaixado: i.glosado === 'T',
          });
          if (r) throw recusa(r.codigo, `Item ${i.id}: ${r.mensagem}`);
        });
        e.itens.forEach((it: { valorPago: number; quantidadePaga: number; motivo: number }, k: number) => {
          const i = lidos[k]!;
          Object.assign(i, {
            glosado: 'T',
            valorPago: it.valorPago,
            quantidadePaga: it.quantidadePaga,
            dataPagamento: e.dataPagamento,
            motivo: it.motivo,
          });
          i.versao += 1;
          if (e.demonstrativo) {
            const d = s.demonstrativos.find((x) => x.id === e.demonstrativo);
            const di = d?.itensM.find((x) => x.item === i.id);
            if (di) Object.assign(di, { situacao: 'baixado' });
          }
        });
        return { itens: e.itens.length, primeiro: e.itens[0].item };
      }
      case 'faturamento.registrarRecurso': {
        const lidos = (e.itens as { item: number; versao: string }[]).map((x) => this.item(s, x));
        const alertas: string[] = [];
        e.itens.forEach((it: { valor: number | null; quantidade: number | null }, k: number) => {
          const i = lidos[k]!;
          const r = conferirRecurso({
            glosado: i.glosado,
            valorCobrado: i.valor,
            valorPago: i.valorPago,
            valorRecurso: i.valorRecurso,
          });
          if (r) throw recusa(r.codigo, `Item ${i.id}: ${r.mensagem}`);
          const p = padraoRecurso({
            valorCobrado: i.valor,
            valorPago: i.valorPago,
            quantidade: i.quantidade,
            quantidadePaga: i.quantidadePaga,
          });
          const rv = conferirValorRecurso(it.valor ?? p.valor, p.valor);
          if (rv) throw recusa(rv.codigo, rv.mensagem, ['valor']);
          if (MOTIVOS.find((m) => m.codigo === i.motivo)?.reapresenta === false)
            alertas.push(
              'O motivo desta glosa não admite reapresentação pela tabela da operadora: o recurso pode ser negado.',
            );
        });
        e.itens.forEach((it: { valor: number | null; quantidade: number | null }, k: number) => {
          const i = lidos[k]!;
          const p = padraoRecurso({
            valorCobrado: i.valor,
            valorPago: i.valorPago,
            quantidade: i.quantidade,
            quantidadePaga: i.quantidadePaga,
          });
          Object.assign(i, {
            valorRecurso: it.valor ?? p.valor,
            quantidadeRecurso: it.quantidade ?? p.quantidade,
            dataRecurso: e.dataProtocolo,
          });
          i.versao += 1;
          const d = s.decisoes.get(i.id);
          if (d) d.estado = 'recorrida';
        });
        return { itens: e.itens.length, primeiro: e.itens[0].item, alertas: [...new Set(alertas)].join(' ') };
      }
      case 'faturamento.registrarRetornoRecurso': {
        const lidos = (e.itens as { item: number; versao: string }[]).map((x) => this.item(s, x));
        const valores = e.itens.map(
          (
            it: { desfecho: 'acatado' | 'parcial' | 'negado'; valor: number | null; motivo: number | null },
            k: number,
          ) => {
            const i = lidos[k]!;
            const d = conferirDesfecho({
              item: i,
              desfecho: it.desfecho,
              data: e.data,
              numeroDemonstrativo: e.numeroDemonstrativo,
              valor: it.valor,
              motivo: it.motivo,
            });
            if (!d.ok) throw recusa(d.recusa.codigo, `Item ${i.id}: ${d.recusa.mensagem}`, d.recusa.campos);
            if (
              d.valores.motivo !== MOTIVO_NAO_INFORMADO &&
              !MOTIVOS.some((m) => m.codigo === d.valores.motivo)
            )
              throw recusa('motivo-inexistente', 'O motivo não existe.', ['motivo']);
            return d.valores;
          },
        );
        e.itens.forEach((it: { desfecho: string }, k: number) => {
          const i = lidos[k]!;
          const v = valores[k];
          Object.assign(i, {
            valorRetorno: v.valor,
            quantidadeRetorno: v.quantidade,
            dataRetorno: e.data,
            motivoRetorno: v.motivo,
          });
          i.versao += 1;
          s.desfechos.set(i.id, it.desfecho);
          const d = s.decisoes.get(i.id);
          if (d) d.estado = 'encerrada';
        });
        return { itens: e.itens.length, primeiro: e.itens[0].item };
      }
      case 'faturamento.fecharCompetencia': {
        if (!CONVENIOS[e.convenio]) throw recusa('convenio-inexistente', 'O convênio não existe.');
        const r = conferirFechamentoCompetencia({
          jaFechada: s.competencias.some(
            (x) =>
              x.situacao === 'fechada' && x.convenio === e.convenio && x.ano === e.ano && x.mes === e.mes,
          ),
          ano: e.ano,
          mes: e.mes,
          hoje,
        });
        if (r) throw recusa(r.codigo, r.mensagem);
        const em = agora();
        const ciclo = { tipo: 'fechamento' as const, em, por: usuario, motivo: '' };
        const ja = s.competencias.find(
          (x) => x.convenio === e.convenio && x.ano === e.ano && x.mes === e.mes,
        );
        if (ja)
          Object.assign(ja, {
            em,
            por: usuario,
            situacao: 'fechada',
            reabertaEm: null,
            reabertaPor: '',
            motivo: '',
          });
        else
          s.competencias.unshift({
            convenio: e.convenio,
            ano: e.ano,
            mes: e.mes,
            em,
            por: usuario,
            situacao: 'fechada',
            reabertaEm: null,
            reabertaPor: '',
            motivo: '',
            ciclos: [],
          });
        (ja ?? s.competencias[0]!).ciclos.push(ciclo);
        return { convenio: e.convenio, ano: e.ano, mes: e.mes };
      }
      case 'faturamento.reabrirCompetencia': {
        const k = s.competencias.find((x) => x.convenio === e.convenio && x.ano === e.ano && x.mes === e.mes);
        const doMes = [...s.contas.values()].filter(
          (x) => x.convenio === e.convenio && x.ano === e.ano && x.mes === e.mes && x.fechada === 'A',
        );
        const r = conferirReaberturaCompetencia({
          fechada: k?.situacao === 'fechada',
          motivo: e.motivo,
          impacto: { contasApresentadas: doMes.length, valorApresentado: 0 },
          confirmarImpacto: e.confirmarImpacto,
        });
        if (r) throw recusa(r.codigo, r.mensagem);
        // Histórico nunca é apagado: marca reaberta com quando, quem e o motivo; o retrato do fechamento fica.
        const em = agora();
        const motivo = e.motivo.trim();
        Object.assign(k!, { situacao: 'reaberta', reabertaEm: em, reabertaPor: usuario, motivo });
        k!.ciclos.push({ tipo: 'reabertura', em, por: usuario, motivo });
        return { convenio: e.convenio, ano: e.ano, mes: e.mes };
      }
      default:
        throw recusa('operacao-desconhecida', `Operação ${op} sem gravação em memória.`);
    }
  }

  async gravarSgh<T>(c: ContextoTiss, _trilha: unknown, fn: (g: GravadorSghTiss) => Promise<T>): Promise<T> {
    const s = this.e(c);
    const g: GravadorSghTiss = {
      importarDemonstrativo: async (d) => {
        const l = s.lotes.get(d.lote);
        if (!l) throw recusa('lote-inexistente', 'O lote não existe.');
        const ja = s.demonstrativos.find(
          (x) =>
            (x.convenio === l.convenio && x.numero === d.numero && x.tipo === d.tipo) ||
            (d.hashArquivo && (x as { hash?: string }).hash === d.hashArquivo),
        );
        if (ja) return { id: ja.id, repetido: true, casados: ja.casados, semCasamento: ja.semCasamento };
        const doLote = [...s.itens.values()].filter((i) => l.contas.includes(i.conta));
        const id = (s.seq += 1);
        const itensM: ItemDemonstrativoLido[] = d.itens.map((it, k) => {
          const casado = doLote.find((i) => i.sequencial === it.sequencial);
          return {
            id: id * 1000 + k,
            item: casado?.id ?? null,
            versaoItem: casado ? versao(casado.versao) : null,
            conta: casado?.conta ?? null,
            numeroGuia: it.numeroGuia,
            sequencial: it.sequencial,
            codigoProcedimento: it.codigoProcedimento,
            valorCobrado: casado?.valor ?? null,
            valorInformado: it.valorInformado,
            valorPago: it.valorPago,
            quantidadePaga: it.quantidadePaga,
            motivo: it.motivo,
            motivoNome: MOTIVOS.find((m) => m.codigo === it.motivo)?.nome ?? '',
            situacao: casado ? 'casado' : 'sem-casamento',
          };
        });
        const casados = itensM.filter((i) => i.item !== null).length;
        s.demonstrativos.unshift({
          id,
          lote: l.id,
          convenio: l.convenio,
          tipo: d.tipo,
          origem: d.origem,
          numero: d.numero,
          dataEmissao: d.dataEmissao,
          itens: d.itens.length,
          casados,
          semCasamento: d.itens.length - casados,
          baixados: 0,
          valorInformado: centavos(d.itens.reduce((t, i) => t + i.valorInformado, 0)),
          valorPago: centavos(d.itens.reduce((t, i) => t + i.valorPago, 0)),
          importadoPor: d.usuario,
          importadoEm: agora(),
          itensM,
          ...(d.hashArquivo ? { hash: d.hashArquivo } : {}),
        });
        return { id, repetido: false, casados, semCasamento: d.itens.length - casados };
      },
      decidirGlosa: async (d) => {
        const i = s.itens.get(d.item);
        if (!i) throw recusa('item-inexistente', 'O item não existe.');
        const g0 = semanticaGlosa({ glosado: i.glosado, valorCobrado: i.valor, valorPago: i.valorPago });
        const atual = s.decisoes.get(i.id)?.estado as
          'pendente' | 'aceita' | 'recorrida' | 'encerrada' | undefined;
        const r = conferirDecisaoGlosa({
          conciliado: g0.conciliado,
          glosa: g0.glosa,
          estadoAtual: i.valorRecurso > 0 ? 'recorrida' : (atual ?? null),
          decisao: d.decisao,
          texto: d.texto,
        });
        if (r) throw recusa(r.codigo, r.mensagem, r.campos);
        const estado = d.decisao === 'aceitar' ? 'aceita' : 'recorrida';
        s.decisoes.set(i.id, {
          estado,
          motivo: d.texto,
          evidencia: d.decisao === 'recorrer' ? (d.evidencia ?? '').slice(0, 250) : '',
          por: d.usuario,
          em: agora(),
          prazo: d.prazo,
        });
        return { id: i.id, estado, conta: i.conta, glosa: g0.glosaPositiva };
      },
      editarEndpoint: async (d) => {
        if (!CONVENIOS[d.convenio]) throw recusa('convenio-inexistente', 'O convênio não existe.');
        const k = s.endpoints.findIndex((x) => x.convenio === d.convenio && x.transacao === d.transacao);
        const novo: EndpointTissLido = {
          convenio: d.convenio,
          transacao: d.transacao,
          url: d.url,
          referenciaCofre: d.referenciaCofre,
          ativo: d.ativo,
          alteradoPor: d.usuario,
          alteradoEm: agora(),
        };
        if (k >= 0) s.endpoints[k] = novo;
        else s.endpoints.push(novo);
        return { id: k >= 0 ? k + 1 : s.endpoints.length };
      },
      registrarMensagem: async (m) => {
        s.mensagens.unshift({
          lote: m.lote ?? 0,
          direcao: m.direcao,
          destino: m.destino,
          transacao: m.transacao,
          situacao: m.situacao,
          tentativa: m.tentativa,
          protocolo: m.protocolo ?? '',
          em: agora(),
        });
        return { id: s.mensagens.length };
      },
    };
    return fn(g);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────

  async hoje(): Promise<string> {
    return hojeIso();
  }
  async convenios(): Promise<{ codigo: number; nome: string }[]> {
    return Object.entries(CONVENIOS).map(([codigo, nome]) => ({ codigo: Number(codigo), nome }));
  }
  async situacoesProtocolo() {
    return SITUACOES;
  }
  async motivos() {
    return [...MOTIVOS];
  }

  async contasProntas(c: ContextoTiss, f: FiltroContasLote): Promise<ContaProntaLote[]> {
    const s = this.e(c);
    return [...s.contas.values()]
      .filter(
        (x) =>
          x.convenio === f.convenio &&
          x.fechada === 'S' &&
          x.indEmi === 'T' &&
          tipoGuiaCompativel(f.tipoGuia, x.tipoConta) &&
          ![...s.lotes.values()].some((l) => l.contas.includes(x.id)) &&
          (!f.ano || (x.ano === f.ano && x.mes === f.mes)),
      )
      .map((x) => {
        const itens = [...s.itens.values()].filter((i) => i.conta === x.id);
        return {
          conta: x.id,
          versao: versao(x.versao),
          convenio: x.convenio,
          tipoConta: x.tipoConta,
          competencia: `${x.ano}-${String(x.mes).padStart(2, '0')}`,
          chave: `${x.codigo}/${x.tipoConta}/${x.ano}/${String(x.mes).padStart(2, '0')}`,
          beneficiario: `••••${x.carteira.slice(-4)}`,
          total: centavos(itens.reduce((t, i) => t + i.valor, 0)),
          itens: itens.length,
          dataEmissao: x.dataEmissao,
          tiposGuia: [1, 2, 3, 4].filter((t) => tipoGuiaCompativel(t, x.tipoConta)),
        };
      });
  }

  async guias(
    c: ContextoTiss,
    f: {
      convenio: number | null;
      ano: number | null;
      mes: number | null;
      convenios: readonly number[] | null;
    },
  ): Promise<GuiaLida[]> {
    const s = this.e(c);
    return [...s.contas.values()]
      .filter(
        (x) =>
          x.indEmi === 'T' &&
          (f.convenios === null || f.convenios.includes(x.convenio)) &&
          (f.convenio === null || x.convenio === f.convenio) &&
          (f.ano === null || x.ano === f.ano) &&
          (f.mes === null || x.mes === f.mes),
      )
      .map((x) => {
        const lote = [...s.lotes.values()].find((l) => l.contas.includes(x.id));
        const tipoGuia = lote?.tipoGuia ?? (x.tipoConta === 'I' ? 3 : 2);
        return {
          conta: x.id,
          versao: versao(x.versao),
          chave: `${x.codigo}/${x.tipoConta}/${x.ano}/${String(x.mes).padStart(2, '0')}`,
          convenio: x.convenio,
          convenioNome: CONVENIOS[x.convenio] ?? '',
          tipoConta: x.tipoConta,
          tipoGuia,
          tipoGuiaNome: ROTULO_TIPO_GUIA[tipoGuia] ?? '',
          numeroGuia: String(x.codigo),
          beneficiario: `••••${x.carteira.slice(-4)}`,
          emitida: true,
          dataEmissao: x.dataEmissao,
          total: centavos(
            [...s.itens.values()].filter((i) => i.conta === x.id).reduce((t, i) => t + i.valor, 0),
          ),
          lote: lote?.id ?? null,
        };
      });
  }

  private loteLido(s: Estado, l: LoteM, hoje: string): LoteLido {
    const itens = [...s.itens.values()].filter((i) => l.contas.includes(i.conta));
    const sit = situacaoDoLote({
      protocolo: l.protocolo,
      registradoNoNovo: l.xml !== null,
      demonstrativos: s.demonstrativos.filter((d) => d.lote === l.id).length,
      itensBaixados: itens.filter((i) => i.glosado === 'T').length,
      itensComRecurso: itens.filter((i) => i.valorRecurso > 0).length,
      itensRecursoAberto: itens.filter((i) => i.valorRecurso > 0 && i.dataRetorno === null).length,
    });
    const dias = Math.round(
      (Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${l.dataHora.slice(0, 10)}T12:00:00Z`)) / 86_400_000,
    );
    return {
      id: l.id,
      convenio: l.convenio,
      convenioNome: CONVENIOS[l.convenio] ?? '',
      tipoGuia: l.tipoGuia,
      tipoGuiaNome: ROTULO_TIPO_GUIA[l.tipoGuia] ?? '',
      transacao: 4,
      numero: l.numero,
      sequencial: l.sequencial,
      protocolo: l.protocolo,
      congelado: loteCongelado(l.protocolo),
      dataHora: l.dataHora,
      contas: l.contas.length,
      valor: centavos(itens.reduce((t, i) => t + i.valor, 0)),
      situacao: sit.situacao,
      situacaoRotulo: ROTULO_SITUACAO_LOTE[sit.situacao],
      inferida: sit.inferida,
      aviso: avisoInferida(sit.inferida),
      xml: l.xml,
      diasSemProtocolo: l.protocolo ? null : dias,
    };
  }

  async lotes(c: ContextoTiss, f: FiltroLotes): Promise<ListaLotes> {
    const s = this.e(c);
    const todos = [...s.lotes.values()]
      .filter(
        (l) =>
          (f.convenio === null || l.convenio === f.convenio) &&
          (f.convenios === null || f.convenios.includes(l.convenio)) &&
          (!f.semProtocolo || !l.protocolo),
      )
      .sort((a, b) => b.id - a.id);
    return {
      itens: todos
        .slice(f.pagina * f.porPagina, (f.pagina + 1) * f.porPagina)
        .map((l) => this.loteLido(s, l, f.hoje)),
      total: todos.length,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  async lote(c: ContextoTiss, id: number, hoje: string): Promise<LoteDetalhe | null> {
    const s = this.e(c);
    const l = s.lotes.get(id);
    if (!l) return null;
    const totalDaConta = (cid: number) =>
      centavos([...s.itens.values()].filter((i) => i.conta === cid).reduce((t, i) => t + i.valor, 0));
    // A fatura ao pagador nasce com o lote (como na porta própria): fechada; protocolada com o protocolo e a entrega.
    const ultimo = s.protocolos.find((p) => p.lote === id && p.acao === 'registrado');
    return {
      ...this.loteLido(s, l, hoje),
      fatura:
        l.contas.length > 0
          ? {
              numero: String(l.id),
              situacao: l.protocolo ? 'protocolada' : 'fechada',
              contas: l.contas.length,
              valorApresentado: centavos(l.contas.reduce((t, cid) => t + totalDaConta(cid), 0)),
              protocolo: l.protocolo,
              entrega: l.protocolo ? (ultimo?.data ?? hoje) : null,
            }
          : null,
      contasDoLote: l.contas.map((cid) => {
        const x = s.contas.get(cid)!;
        return {
          conta: cid,
          chave: `${x.codigo}/${x.tipoConta}/${x.ano}/${String(x.mes).padStart(2, '0')}`,
          beneficiario: `••••${x.carteira.slice(-4)}`,
          total: centavos(
            [...s.itens.values()].filter((i) => i.conta === cid).reduce((t, i) => t + i.valor, 0),
          ),
          fechada: x.fechada,
        };
      }),
      historico: s.protocolos
        .filter((p) => p.lote === id)
        .map((p) => ({
          acao: p.acao,
          protocolo: p.protocolo,
          data: p.data,
          recibo: p.recibo,
          situacao: p.situacao,
          situacaoNome: SITUACOES.find((x) => x.id === p.situacao)?.nome ?? '',
          autor: p.por,
          em: p.em,
        })),
      mensagens: s.mensagens
        .filter((m) => m.lote === id)
        .map((m) => ({
          direcao: m.direcao,
          destino: m.destino,
          transacao: m.transacao,
          situacao: m.situacao,
          tentativa: m.tentativa,
          protocolo: m.protocolo,
          em: m.em,
        })),
    };
  }

  async convenioDoLote(c: ContextoTiss, id: number) {
    return this.e(c).lotes.get(id)?.convenio ?? null;
  }

  async prazos(
    c: ContextoTiss,
    o: { hoje: string; paradoDias: number; prazoRecurso: string; convenios: readonly number[] | null },
  ): Promise<PrazoEnvio[]> {
    const s = this.e(c);
    return Object.keys(CONVENIOS)
      .map(Number)
      .filter((cv) => o.convenios === null || o.convenios.includes(cv))
      .map((cv) => {
        const sem = [...s.lotes.values()].filter((l) => l.convenio === cv && !l.protocolo);
        const parados = sem.filter(
          (l) =>
            (Date.parse(`${o.hoje}T12:00:00Z`) - Date.parse(`${l.dataHora.slice(0, 10)}T12:00:00Z`)) /
              86_400_000 >=
            o.paradoDias,
        );
        const p = prazoRecurso(o.prazoRecurso, cv, o.hoje);
        // Calendário sintético: a janela do dia 10 ao 15 do mês corrente (competência anterior) e a do mês seguinte.
        const mes = o.hoje.slice(0, 8);
        const seguinte = new Date(Date.parse(`${mes}01T12:00:00Z`) + 32 * 86_400_000)
          .toISOString()
          .slice(0, 8);
        const anterior = new Date(Date.parse(`${mes}01T12:00:00Z`) - 86_400_000).toISOString().slice(0, 8);
        const cal: JanelaEntrega[] = [
          { competencia: `${anterior}01`, entregaInicio: `${mes}10`, entregaFim: `${mes}15` },
          { competencia: `${mes}01`, entregaInicio: `${seguinte}10`, entregaFim: `${seguinte}15` },
        ].map((x) => ({ ...x, pagamentoPrevisto: null, prazoPagamentoDias: 30, restritivo: false }));
        const proxima = proximaEntrega(cal, o.hoje);
        return {
          convenio: cv,
          convenioNome: CONVENIOS[cv] ?? '',
          entregas: entregasAFrente(cal, o.hoje),
          proximaEntrega: proxima?.janela.entregaInicio ?? null,
          entrega: proxima
            ? {
                competencia: proxima.janela.competencia,
                inicio: proxima.janela.entregaInicio,
                fim: proxima.janela.entregaFim,
                situacao: proxima.situacao,
                dias: proxima.dias,
                pagamentoPrevisto: proxima.pagamentoPrevisto,
                restritivo: proxima.janela.restritivo,
              }
            : null,
          lotesSemProtocolo: sem.length,
          lotesParados: parados.length,
          maisAntigoSemProtocolo: sem.map((l) => l.dataHora.slice(0, 10)).sort()[0] ?? null,
          prazoRecursoDias: p.prazo
            ? Math.round(
                (Date.parse(`${p.prazo}T12:00:00Z`) - Date.parse(`${o.hoje}T12:00:00Z`)) / 86_400_000,
              )
            : null,
        };
      });
  }

  async competencias(
    c: ContextoTiss,
    f: { convenio: number | null; ano: number | null; convenios: readonly number[] | null },
  ): Promise<CompetenciaLida[]> {
    return this.e(c)
      .competencias.filter(
        (x) =>
          (f.convenio === null || x.convenio === f.convenio) &&
          (f.ano === null || x.ano === f.ano) &&
          (f.convenios === null || f.convenios.includes(x.convenio)),
      )
      .map((x) => ({
        convenio: x.convenio,
        convenioNome: CONVENIOS[x.convenio] ?? '',
        ano: x.ano,
        mes: x.mes,
        fechada: x.situacao === 'fechada',
        fechadaEm: x.situacao === 'fechada' ? x.em : null,
        fechadaPor: x.situacao === 'fechada' ? x.por : '',
        reaberta: x.situacao === 'reaberta',
        reabertaEm: x.reabertaEm,
        reabertaPor: x.reabertaPor,
        motivoReabertura: x.motivo,
        ciclos: x.ciclos.length,
        contas: 0,
        emLote: 0,
        valor: 0,
      }));
  }

  async resumoCompetencia(
    c: ContextoTiss,
    x: { convenio: number; ano: number; mes: number },
  ): Promise<CompetenciaLida> {
    const s = this.e(c);
    const contas = [...s.contas.values()].filter(
      (k) => k.convenio === x.convenio && k.ano === x.ano && k.mes === x.mes,
    );
    const f = s.competencias.find((k) => k.convenio === x.convenio && k.ano === x.ano && k.mes === x.mes);
    return {
      ...x,
      convenioNome: CONVENIOS[x.convenio] ?? '',
      fechada: f?.situacao === 'fechada',
      fechadaEm: f?.situacao === 'fechada' ? f.em : null,
      fechadaPor: f?.situacao === 'fechada' ? f.por : '',
      reaberta: f?.situacao === 'reaberta',
      reabertaEm: f?.reabertaEm ?? null,
      reabertaPor: f?.reabertaPor ?? '',
      motivoReabertura: f?.motivo ?? '',
      ciclos: f?.ciclos.length ?? 0,
      contas: contas.length,
      emLote: contas.filter((k) => k.fechada === 'A').length,
      valor: centavos(
        [...s.itens.values()]
          .filter((i) => contas.some((k) => k.id === i.conta))
          .reduce((t, i) => t + i.valor, 0),
      ),
    };
  }

  private itemLido(s: Estado, i: ItemM, prazoParam: string): ItemGlosaLido {
    const conta = s.contas.get(i.conta)!;
    const g = semanticaGlosa({ glosado: i.glosado, valorCobrado: i.valor, valorPago: i.valorPago });
    const desf = (s.desfechos.get(i.id) as ItemGlosaLido['desfecho']) ?? null;
    const dec = s.decisoes.get(i.id);
    const estado: ItemGlosaLido['estado'] = !g.conciliado
      ? 'nao-conciliado'
      : !(g.glosa > 0)
        ? 'sem-glosa'
        : desf
          ? 'encerrada'
          : i.valorRecurso > 0
            ? 'recorrida'
            : dec?.estado === 'aceita' || dec?.estado === 'recorrida'
              ? dec.estado
              : 'pendente';
    const p = prazoRecurso(prazoParam, conta.convenio, i.dataPagamento);
    const m = MOTIVOS.find((x) => x.codigo === i.motivo);
    return {
      item: i.id,
      versao: versao(i.versao),
      sequencial: i.sequencial,
      conta: i.conta,
      convenio: conta.convenio,
      competencia: `${conta.ano}-${String(conta.mes).padStart(2, '0')}`,
      tipo: i.tipo,
      codigo: i.codigo,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorCobrado: i.valor,
      conciliado: g.conciliado,
      valorPago: i.valorPago,
      quantidadePaga: i.quantidadePaga,
      dataPagamento: i.dataPagamento,
      glosa: g.glosa,
      motivo: i.motivo,
      motivoNome: m?.nome ?? '',
      reapresenta: m?.reapresenta ?? true,
      valorRecurso: i.valorRecurso,
      quantidadeRecurso: i.quantidadeRecurso,
      dataRecurso: i.dataRecurso,
      valorRetorno: i.valorRetorno,
      dataRetorno: i.dataRetorno,
      motivoRetorno: i.motivoRetorno,
      estado,
      desfecho: desf,
      prazoRecurso: estado === 'pendente' ? p.prazo : null,
      alertaPrazo: estado === 'pendente' ? p.alerta : null,
      decisao:
        dec && dec.estado !== 'pendente'
          ? { motivo: dec.motivo, por: dec.por, em: dec.em, temEvidencia: Boolean(dec.evidencia) }
          : null,
    };
  }

  async grade(c: ContextoTiss, f: FiltroGlosa): Promise<GradeGlosa> {
    const s = this.e(c);
    const contas = [...s.contas.values()]
      .filter(
        (x) =>
          x.fechada === 'A' &&
          x.ano === f.ano &&
          x.mes === f.mes &&
          (f.convenio === null || x.convenio === f.convenio) &&
          (f.convenios === null || f.convenios.includes(x.convenio)),
      )
      .map((x) => {
        const itens = [...s.itens.values()]
          .filter((i) => i.conta === x.id)
          .map((i) => this.itemLido(s, i, ''));
        return {
          conta: x.id,
          chave: `${x.codigo}/${x.tipoConta}/${x.ano}/${String(x.mes).padStart(2, '0')}`,
          convenio: x.convenio,
          competencia: `${x.ano}-${String(x.mes).padStart(2, '0')}`,
          beneficiario: `••••${x.carteira.slice(-4)}`,
          cobrado: centavos(itens.reduce((t, i) => t + i.valorCobrado, 0)),
          pago: centavos(itens.filter((i) => i.conciliado).reduce((t, i) => t + i.valorPago, 0)),
          glosa: centavos(itens.reduce((t, i) => t + i.glosa, 0)),
          itensGlosados: itens.filter((i) => i.glosa > 0).length,
          itensEmRecurso: itens.filter((i) => i.estado === 'recorrida').length,
          prazoMaisProximo: itens.find((i) => i.estado === 'pendente')?.dataPagamento ?? null,
          naoConciliados: itens.filter((i) => !i.conciliado).length,
        };
      })
      .filter((x) =>
        f.estado === 'com-glosa'
          ? x.itensGlosados > 0
          : f.estado === 'em-recurso'
            ? x.itensEmRecurso > 0
            : f.estado === 'nao-conciliadas'
              ? x.naoConciliados > 0
              : true,
      )
      .map((x) => {
        const r: Partial<typeof x> = { ...x };
        delete r.naoConciliados;
        return r as Omit<typeof x, 'naoConciliados'>;
      });
    return { regua: 'competencia', contas, total: contas.length, pagina: f.pagina, porPagina: f.porPagina };
  }

  async itensDaConta(c: ContextoTiss, conta: number, prazo: string): Promise<ItemGlosaLido[]> {
    const s = this.e(c);
    return [...s.itens.values()].filter((i) => i.conta === conta).map((i) => this.itemLido(s, i, prazo));
  }
  async evidenciaDoItem(c: ContextoTiss, item: number): Promise<EvidenciaGlosaLida | null> {
    const d = this.e(c).decisoes.get(item);
    return d?.evidencia ? { item, evidencia: d.evidencia, decididoPor: d.por, decididoEm: d.em } : null;
  }
  async convenioDaConta(c: ContextoTiss, conta: number) {
    return this.e(c).contas.get(conta)?.convenio ?? null;
  }
  async contaDoItem(c: ContextoTiss, item: number) {
    const s = this.e(c);
    const i = s.itens.get(item);
    return i ? { conta: i.conta, convenio: s.contas.get(i.conta)!.convenio } : null;
  }

  async demonstrativos(
    c: ContextoTiss,
    f: { lote: number | null; convenios: readonly number[] | null },
  ): Promise<DemonstrativoLido[]> {
    return this.e(c)
      .demonstrativos.filter(
        (d) =>
          (f.lote === null || d.lote === f.lote) &&
          (f.convenios === null || f.convenios.includes(d.convenio)),
      )
      .map(({ itensM, ...d }) => ({
        ...d,
        baixados: itensM.filter((i) => i.situacao === 'baixado').length,
        casados: itensM.filter((i) => i.situacao === 'casado').length,
      }))
      .map((d) => {
        const r: Partial<typeof d & { hash?: string }> = { ...d };
        delete r.hash;
        return r as typeof d;
      });
  }

  async demonstrativo(c: ContextoTiss, id: number) {
    const s = this.e(c);
    const d = s.demonstrativos.find((x) => x.id === id);
    if (!d) return null;
    return {
      lote: d.lote,
      convenio: d.convenio,
      itens: d.itensM.map((i) => {
        const it = i.item ? s.itens.get(i.item) : undefined;
        return { ...i, versaoItem: it ? versao(it.versao) : i.versaoItem };
      }),
    };
  }

  async configuracao(c: ContextoTiss): Promise<ConfiguracaoTissLida> {
    const s = this.e(c);
    return {
      versoes: [
        { codigo: '4.01.00', conhecidaNoOutroSistema: true },
        { codigo: '4.02.00', conhecidaNoOutroSistema: true },
        { codigo: VERSAO_TISS_VIGENTE, conhecidaNoOutroSistema: false },
      ],
      transacoes: [
        { id: 4, nome: 'Lote Guias', tipo: 'ENVIO_LOTE_GUIAS' },
        { id: 5, nome: 'Recurso Glosa', tipo: 'RECURSO_GLOSA' },
        { id: 9, nome: 'Solicitação Status Protocolo', tipo: 'SOLIC_STATUS_PROTOCOLO' },
        { id: 15, nome: 'Demonstrativo Análise Conta', tipo: 'DEMONSTRATIVO_ANALISE_CONTA' },
      ],
      webservicesOutroSistema: [
        { convenio: 91, transacao: 4, url: 'http://127.0.0.1:9/operadora-sintetica' },
      ],
      urlsPadrao: [],
      convenios: Object.entries(CONVENIOS).map(([k, nome]) => ({
        convenio: Number(k),
        nome,
        codigoPrestador: 'PRESTSINT01',
        versaoConfigurada: '4.01.00',
        registroAns: '999999',
      })),
      endpoints: [...s.endpoints],
      versaoGerada: VERSAO_TISS_VIGENTE,
    };
  }

  async painel(
    c: ContextoTiss,
    f: { de: string; ate: string; convenios: readonly number[] | null },
  ): Promise<PainelGlosa> {
    const s = this.e(c);
    const itens = [...s.itens.values()]
      .filter((i) => {
        const k = s.contas.get(i.conta)!;
        const comp = `${k.ano}-${String(k.mes).padStart(2, '0')}`;
        return comp >= f.de && comp <= f.ate && (f.convenios === null || f.convenios.includes(k.convenio));
      })
      .map((i) => this.itemLido(s, i, ''));
    const conc = itens.filter((i) => i.conciliado);
    const somas = {
      emitido: centavos(itens.reduce((t, i) => t + i.valorCobrado, 0)),
      itensEmitidos: itens.length,
      conciliado: centavos(conc.reduce((t, i) => t + i.valorCobrado, 0)),
      itensConciliados: conc.length,
      pago: centavos(conc.reduce((t, i) => t + i.valorPago, 0)),
      glosaLiquida: centavos(conc.reduce((t, i) => t + i.glosa, 0)),
      glosaPositiva: centavos(conc.reduce((t, i) => t + Math.max(0, i.glosa), 0)),
      itensPagosAMaior: conc.filter((i) => i.glosa < 0).length,
      contestado: centavos(conc.reduce((t, i) => t + i.valorRecurso, 0)),
      recuperado: centavos(conc.reduce((t, i) => t + i.valorRetorno, 0)),
      nuncaRecorrido: 0,
    };
    const ind = indicadoresGlosa(somas);
    somas.nuncaRecorrido = ind.nuncaRecorrido;
    const glosados = conc.filter((i) => i.glosa > 0);
    const porMotivo = new Map<number, { g: number; n: number }>();
    for (const i of glosados) {
      const x = porMotivo.get(i.motivo) ?? { g: 0, n: 0 };
      porMotivo.set(i.motivo, { g: x.g + i.glosa, n: x.n + 1 });
    }
    const porFaixa = new Map<string, { g: number; n: number }>();
    for (const i of glosados) {
      const k = faixaDoValor(i.glosa);
      const x = porFaixa.get(k) ?? { g: 0, n: 0 };
      porFaixa.set(k, { g: x.g + i.glosa, n: x.n + 1 });
    }
    return {
      regua: 'competencia',
      de: f.de,
      ate: f.ate,
      somas,
      indicadores: {
        taxaLiquida: ind.taxaLiquida,
        taxaPositiva: ind.taxaPositiva,
        exito: ind.exito,
        exitoRotulo: ind.exitoRotulo,
      },
      porMotivo: [...porMotivo].map(([codigo, x]) => ({
        codigo,
        nome: MOTIVOS.find((m) => m.codigo === codigo)?.nome ?? '',
        glosa: centavos(x.g),
        itens: x.n,
      })),
      porConvenio: Object.entries(CONVENIOS).map(([k, nome]) => {
        const doConv = conc.filter((i) => i.convenio === Number(k));
        const i2 = indicadoresGlosa({
          emitido: 0,
          conciliado: doConv.reduce((t, i) => t + i.valorCobrado, 0),
          pago: 0,
          glosaLiquida: doConv.reduce((t, i) => t + i.glosa, 0),
          glosaPositiva: doConv.reduce((t, i) => t + Math.max(0, i.glosa), 0),
          contestado: doConv.reduce((t, i) => t + i.valorRecurso, 0),
          recuperado: doConv.reduce((t, i) => t + i.valorRetorno, 0),
        });
        return {
          convenio: Number(k),
          nome,
          conciliado: centavos(doConv.reduce((t, i) => t + i.valorCobrado, 0)),
          glosa: centavos(doConv.reduce((t, i) => t + i.glosa, 0)),
          contestado: centavos(doConv.reduce((t, i) => t + i.valorRecurso, 0)),
          recuperado: centavos(doConv.reduce((t, i) => t + i.valorRetorno, 0)),
          exitoRotulo: i2.exitoRotulo,
        };
      }),
      porFaturador: [{ faturador: 'SINT.TISS', glosa: somas.glosaPositiva, itens: glosados.length }],
      porFaixa: [...porFaixa].map(([faixa, x]) => ({ faixa, itens: x.n, glosa: centavos(x.g) })),
      ciclo: { mediaDias: null, itens: 0, foraDaFaixa: 0 },
      fila: {
        pendentes: itens.filter((i) => i.estado === 'pendente').length,
        emRecurso: itens.filter((i) => i.estado === 'recorrida').length,
        semPrazo: itens.filter((i) => i.estado === 'pendente' && !i.prazoRecurso).length,
      },
      geradoEm: new Date().toISOString(),
      emCache: false,
    };
  }

  async xmlDoLote(c: ContextoTiss, lote: number) {
    const l = this.e(c).lotes.get(lote);
    return l?.xml ? { chave: l.xml.chave, hashArquivo: l.xml.hashArquivo, convenio: l.convenio } : null;
  }
}
