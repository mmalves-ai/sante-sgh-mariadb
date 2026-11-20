// Serviço das obrigações da operadora própria com a ANS (M56, etapa 7, F6): monta as respostas da tela a partir das
// leituras da porta e decide no servidor o que a tela só mostra:
//   - a prévia e a geração de cada arquivo (SIB, SIP, DIOPS, TPS, monitoramento TISS): a competência (formato e período
//     encerrado), o plano da geração (enviado sem retorno impede; só gerado é substituído; aceito faz o retificador), as
//     fontes das fatias anteriores, a conferência (@sgh/dominio-operadora), os quadros com as parcelas, o arquivo, o
//     tamanho e o SHA-256;
//   - o aviso de ressarcimento ao SUS (os atendimentos, a análise de cada um na data, o prazo da impugnação), a decisão
//     de cada atendimento e o dossiê da impugnação no protocolo;
//   - a transmissão (o recibo só na ANS, em produção; o simulador fora dela), o retorno (o resultado dos itens, o CCO do
//     SIB), a GRU da TPS e do ressarcimento;
//   - o complemento do beneficiário para o SIB e as pendências do cadastro.
// As gravações passam pelas recusas das regras antes de chegar às SGH_; a versão vista e a situação de partida são do
// banco.
import { createHash } from 'node:crypto';
import {
  type ApoioAns,
  type ArquivoEnvioAns,
  type ComplementoSib,
  type ComplementoSibEntrada,
  type DecidirItemRessarcimentoEntrada,
  type EnvioAnsDetalhe,
  type EnvioAnsResumo,
  type EnviosAns,
  type FiltroEnviosAns,
  type GerarEnvioAnsEntrada,
  type ItemEnvioAns,
  LEIAUTE_ANS,
  MENSAGENS_ANS,
  MOVIMENTOS_SIB,
  type MotivoImpugnacaoSus,
  MOTIVOS_IMPUGNACAO_SUS,
  OBRIGACOES_ANS,
  OBRIGACOES_COM_GRU,
  type ObrigacaoAns,
  PARAMETROS_ANS,
  type PagamentoGruEntrada,
  type PendenciasSib,
  type PreviaEnvioAns,
  type ProblemaAns,
  type QuadroAns,
  type RegistrarAvisoRessarcimentoEntrada,
  type RegistrarRetornoAnsEntrada,
  type SegmentacaoProduto,
  type TransmitirEnvioAnsEntrada,
} from '@sgh/contratos';
import {
  acoesDoEnvio,
  agregarSip,
  analisarAtendimentoSus,
  arquivoDiops,
  arquivoMonitoramento,
  arquivoRessarcimento,
  arquivoSib,
  arquivoSip,
  arquivoTps,
  type BeneficiarioSib,
  bloqueiaArquivo,
  type CabecalhoAns,
  calcularTps,
  ccoValido,
  competenciaEncerrada,
  competenciaValida,
  descricaoMovimentoSib,
  destinoEnvioAns,
  type DestinoEnvioAns,
  type ItemRessarcimento,
  type ItemSip,
  mesesDoPeriodo,
  movimentoSib,
  municipioValido,
  nomeArquivoAns,
  noPrazo,
  periodoDaCompetencia,
  planoDaGeracao,
  prazoImpugnacao,
  problema,
  problemasDaDecisao,
  problemasDaTransmissao,
  problemasDiops,
  problemasDoAviso,
  problemasMonitoramento,
  problemasSib,
  quadrosDiops,
  quadrosMonitoramento,
  quadrosRessarcimento,
  quadrosSip,
  quadrosTps,
  resultadoDoRetorno,
  type RetratoSib,
  selecionarMovimentosSib,
  todosDecididos,
  ufDoMunicipio,
  valorDevido,
} from '@sgh/dominio-operadora';
import type {
  BeneficiarioSibLido,
  EnvioAnsLido,
  EnvioAnsResumoLido,
  GeracaoEnvioSgh,
  ItemEnvioAnsLido,
  ItemEnvioSgh,
  OperadoraOpeLida,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ArquivoGravado, ContextoAns, PortaAnsOperadora } from './ans-porta.js';

/** Recusa das regras: 409 com o primeiro código e os textos. */
export function recusaAns(codigos: readonly string[], extra: Record<string, unknown> = {}): ErroProblema {
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    [...new Set(codigos.map((c) => MENSAGENS_ANS[c] ?? c))].join(' '),
    { codigo: codigos[0] ?? 'recusa', bloqueios: [...codigos], ...extra },
  );
}

const naoEncontrado = (titulo = 'Envio não encontrado') =>
  new ErroProblema('nao-encontrado', 404, titulo, 'O registro não existe neste estabelecimento.');

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const json = <T>(s: string | null | undefined, padrao: T): T => {
  if (!s) return padrao;
  try {
    return JSON.parse(s) as T;
  } catch {
    return padrao;
  }
};

/** Teto de páginas ao percorrer os beneficiários (1.000 por página). */
const PAGINAS_SIB = 500;
/** Teto de páginas ao percorrer os itens do SIP (5.000 por página). */
const PAGINAS_SIP = 100;

export interface Montagem {
  readonly previa: PreviaEnvioAns;
  readonly sequencial: number;
  readonly retificador: boolean;
  readonly substituir: readonly number[];
  readonly arquivo: string | null;
  readonly itens: readonly ItemEnvioSgh[];
  readonly valorTotal: number | null;
  readonly operadora: OperadoraOpeLida;
}

interface Partes {
  readonly registros: number;
  readonly quadros: readonly QuadroAns[];
  readonly problemas: readonly ProblemaAns[];
  readonly itens: readonly ItemEnvioSgh[];
  readonly valorTotal: number | null;
  readonly arquivo: ((cab: CabecalhoAns) => string) | null;
}

export function resumoDoEnvio(e: EnvioAnsResumoLido): EnvioAnsResumo {
  return {
    id: e.id,
    versao: e.versao,
    operadora: e.operadora,
    obrigacao: e.obrigacao,
    competencia: e.competencia,
    sequencial: e.sequencial,
    destino: e.destino,
    situacao: e.situacao,
    registros: e.registros,
    valorTotal: e.valorTotal,
    arquivoNome: e.arquivoNome,
    hash: e.hash,
    recibo: e.recibo,
    criadoEm: e.criadoEm,
    criadoPor: e.criadoPor,
    enviadoEm: e.enviadoEm,
    retornoEm: e.retornoEm,
    prazo: e.prazo,
    gru: e.gru,
    pagoEm: e.pagoEm,
    valorPago: e.valorPago,
  };
}

/** O beneficiário lido no formato da regra do SIB. */
export function beneficiarioDaRegra(b: BeneficiarioSibLido): BeneficiarioSib {
  const c = b.complemento;
  return {
    id: b.id,
    carteirinha: b.carteirinha,
    nome: b.nome,
    nascimento: b.nascimento,
    sexo: b.sexo,
    cpf: b.cpf,
    cns: b.cns,
    nomeMae: b.nomeMae,
    vinculo: b.vinculo,
    titular: b.titular,
    inclusao: b.inclusao,
    situacao: b.situacao,
    exclusao: b.exclusao,
    produto: { id: b.produto.id, natureza: b.produto.natureza, registroAns: b.produto.registroAns },
    contrato: b.contrato,
    complemento: c
      ? {
          logradouro: c.logradouro,
          numero: c.numero,
          complemento: c.complemento,
          bairro: c.bairro,
          municipio: c.municipio,
          cep: c.cep,
          resideExterior: c.resideExterior,
          dnv: c.dnv,
          coberturaParcial: c.coberturaParcial,
          itensExcluidos: c.itensExcluidos,
          cco: c.cco,
          motivoCancelamento: c.motivoCancelamento,
        }
      : null,
  };
}

function itemDaRessarcimento(i: ItemEnvioAnsLido): ItemRessarcimento {
  const d = json<{ identificacao?: string; inicio?: string; fim?: string; procedimento?: string }>(
    i.dados,
    {},
  );
  return {
    ordem: i.ordem,
    tipo: i.tipo === 'APAC' ? 'APAC' : 'AIH',
    numero: i.referencia,
    identificacao: d.identificacao ?? '',
    inicio: d.inicio ?? '',
    fim: d.fim ?? '',
    procedimento: d.procedimento ?? '',
    valor: i.valor ?? 0,
    sugestao: (i.sugestao as MotivoImpugnacaoSus | null) ?? null,
    decisao: i.decisao ?? 'pendente',
    motivo: (i.motivo as MotivoImpugnacaoSus | null) ?? null,
    justificativa: i.justificativa,
    deferida: i.resultado === 'enviado' ? null : i.resultado === 'aceito',
  };
}

export class ServicoAnsOperadora {
  readonly destino: DestinoEnvioAns;

  constructor(
    private readonly porta: PortaAnsOperadora,
    ambiente: string,
  ) {
    this.destino = destinoEnvioAns(ambiente);
  }

  // ── Apoio, lista e ficha ──────────────────────────────────────────────────────────────────────

  async apoio(c: ContextoAns, situacao: { vale: boolean; motivo: string | null }): Promise<ApoioAns> {
    const [operadoras, motivos, campos, valores] = await Promise.all([
      this.porta.operadoras(c),
      this.porta.motivosSib(c),
      this.porta.camposSib(c),
      this.porta.valoresTps(c),
    ]);
    return {
      destino: this.destino,
      leiaute: LEIAUTE_ANS,
      operadoras: operadoras.map((o) => ({
        id: o.id,
        nome: o.nomeFantasia ?? o.razaoSocial,
        registroAns: o.registroAns,
      })),
      obrigacoes: (Object.keys(OBRIGACOES_ANS) as ObrigacaoAns[]).map((codigo) => ({
        codigo,
        rotulo: OBRIGACOES_ANS[codigo].rotulo,
        periodicidade: OBRIGACOES_ANS[codigo].periodicidade,
      })),
      motivosSib: motivos,
      camposSib: campos,
      valoresTps: valores,
      situacao,
    };
  }

  async lista(c: ContextoAns, f: FiltroEnviosAns): Promise<EnviosAns> {
    const [r, totais] = await Promise.all([this.porta.envios(c, f), this.porta.totais(c)]);
    return { itens: r.itens.map(resumoDoEnvio), proxima: r.proxima, totais };
  }

  private async envioOu404(c: ContextoAns, id: number): Promise<EnvioAnsLido> {
    const e = await this.porta.envio(c, id);
    if (!e) throw naoEncontrado();
    return e;
  }

  async detalhe(c: ContextoAns, id: number): Promise<EnvioAnsDetalhe> {
    const [e, itens, eventos, { hoje }] = await Promise.all([
      this.envioOu404(c, id),
      this.porta.itens(c, id),
      this.porta.eventos(c, id),
      this.porta.relogio(c),
    ]);
    const ressarc = e.obrigacao === 'RESSARCIMENTO_SUS';
    return {
      ...resumoDoEnvio(e),
      quadros: json<QuadroAns[]>(e.quadros, []),
      retornoResumo: e.retornoResumo,
      itens: itens.map((i): ItemEnvioAns => ({
        id: i.id,
        ordem: i.ordem,
        tipo: i.tipo,
        referencia: i.referencia,
        descricao: i.descricao,
        valor: i.valor,
        resultado: i.resultado,
        erro: i.erro,
        sugestao: ressarc ? ((i.sugestao as MotivoImpugnacaoSus | null) ?? null) : null,
        decisao: ressarc ? (i.decisao ?? 'pendente') : null,
        motivo: ressarc ? ((i.motivo as MotivoImpugnacaoSus | null) ?? null) : null,
        justificativa: ressarc ? i.justificativa : null,
      })),
      eventos,
      acoes: acoesDoEnvio({
        obrigacao: e.obrigacao,
        situacao: e.situacao,
        temArquivo: !!e.hash,
        pago: !!e.gru,
        decidido: ressarc && todosDecididos(itens.map((i) => ({ decisao: i.decisao ?? 'pendente' }))),
        noPrazo: !!(ressarc && e.recebidoEm && noPrazo(e.recebidoEm, hoje)),
      }),
    };
  }

  async arquivo(c: ContextoAns, id: number): Promise<ArquivoEnvioAns> {
    const a = await this.porta.arquivo(c, id);
    if (!a) throw naoEncontrado('Arquivo não encontrado');
    return { nome: a.nome, tipo: 'application/xml', base64: a.base64, sha256: a.sha256 };
  }

  // ── Prévia e geração ──────────────────────────────────────────────────────────────────────────

  private async operadoraDe(c: ContextoAns, id: number): Promise<OperadoraOpeLida> {
    const o = (await this.porta.operadoras(c)).find((x) => x.id === id);
    if (!o) throw naoEncontrado('Operadora não encontrada');
    return o;
  }

  async montar(c: ContextoAns, e: GerarEnvioAnsEntrada): Promise<Montagem> {
    const operadora = await this.operadoraDe(c, e.operadora);
    const { hoje } = await this.porta.relogio(c);
    const base: ProblemaAns[] = [];
    if (operadora.situacao !== 'ativa') base.push(problema('operadora-inativa'));
    const vazia = (ps: ProblemaAns[]): Montagem => ({
      previa: {
        obrigacao: e.obrigacao,
        competencia: e.competencia,
        destino: this.destino,
        registros: 0,
        quadros: [],
        problemas: ps,
        podeGerar: false,
      },
      sequencial: 0,
      retificador: false,
      substituir: [],
      arquivo: null,
      itens: [],
      valorTotal: null,
      operadora,
    });
    if (!competenciaValida(e.obrigacao, e.competencia))
      return vazia([...base, problema('competencia-invalida')]);
    if (!competenciaEncerrada(e.obrigacao, e.competencia, hoje))
      return vazia([...base, problema('competencia-futura')]);
    const plano = planoDaGeracao(
      e.obrigacao,
      e.competencia,
      await this.porta.existentes(c, e.operadora, e.obrigacao, e.competencia),
    );
    if (plano.recusa !== null) return vazia([...base, problema(plano.recusa)]);
    const partes = await this.partes(c, e, hoje);
    const problemas = [...base, ...partes.problemas];
    if (plano.retificador) problemas.push(problema('ja-aceito', 'item'));
    if (partes.registros === 0 && !problemas.some((p) => p.alcance === 'arquivo'))
      problemas.push(problema(e.obrigacao === 'SIB' ? 'sem-movimentos' : 'sem-registros'));
    let arquivo: string | null = null;
    if (!bloqueiaArquivo(problemas) && partes.arquivo) {
      arquivo = partes.arquivo({
        registroAns: operadora.registroAns,
        cnpj: operadora.cnpj,
        competencia: e.competencia,
        sequencial: plano.sequencial,
        geradoEm: hoje,
        destino: this.destino,
      });
      if (Buffer.byteLength(arquivo, 'utf8') > PARAMETROS_ANS.maximoBytesArquivo) {
        problemas.push(problema('arquivo-grande'));
        arquivo = null;
      }
    }
    return {
      previa: {
        obrigacao: e.obrigacao,
        competencia: e.competencia,
        destino: this.destino,
        registros: partes.registros,
        quadros: partes.quadros,
        problemas,
        podeGerar: arquivo !== null && !bloqueiaArquivo(problemas),
      },
      sequencial: plano.sequencial,
      retificador: plano.retificador,
      substituir: plano.substituir,
      arquivo,
      itens: partes.itens,
      valorTotal: partes.valorTotal,
      operadora,
    };
  }

  /** A geração conferida (o que vai à gravação; recusa 409 quando a prévia não deixa gerar). */
  async gerar(
    c: ContextoAns,
    e: GerarEnvioAnsEntrada,
  ): Promise<Omit<GeracaoEnvioSgh, 'hospital' | 'usuario'>> {
    const m = await this.montar(c, e);
    if (!m.previa.podeGerar || !m.arquivo)
      throw recusaAns(
        m.previa.problemas.filter((p) => p.alcance === 'arquivo').map((p) => p.codigo),
        { problemas: m.previa.problemas },
      );
    return {
      operadora: e.operadora,
      obrigacao: e.obrigacao,
      competencia: e.competencia,
      sequencial: m.sequencial,
      retificador: m.retificador,
      destino: this.destino,
      leiaute: LEIAUTE_ANS,
      registros: m.previa.registros,
      valorTotal: m.valorTotal,
      quadros: JSON.stringify(m.previa.quadros),
      arquivo: arquivoGravado(
        nomeArquivoAns(e.obrigacao, m.operadora.registroAns, e.competencia, m.sequencial),
        m.arquivo,
      ),
      aviso: null,
      substituir: m.substituir,
      itens: m.itens,
    };
  }

  private async partes(c: ContextoAns, e: GerarEnvioAnsEntrada, hoje: string): Promise<Partes> {
    const periodo = periodoDaCompetencia(e.obrigacao, e.competencia);
    switch (e.obrigacao) {
      case 'SIB':
        return this.partesSib(c, e.operadora, hoje);
      case 'SIP':
        return this.partesSip(c, e.operadora, periodo.inicio, periodo.fim);
      case 'DIOPS':
        return this.partesDiops(c, e, periodo.inicio, periodo.fim);
      case 'TPS':
        return this.partesTps(c, e, periodo.inicio, periodo.fim);
      default:
        return this.partesMonitoramento(c, e.operadora, periodo.inicio, periodo.fim);
    }
  }

  private async todosBeneficiarios(c: ContextoAns, operadora: number): Promise<BeneficiarioSibLido[]> {
    const r: BeneficiarioSibLido[] = [];
    let apos = 0;
    for (let k = 0; k < PAGINAS_SIB; k++) {
      const p = await this.porta.beneficiariosSib(c, operadora, apos);
      r.push(...p.itens);
      if (p.proxima === null) return r;
      apos = p.proxima;
    }
    throw recusaAns(['arquivo-grande']);
  }

  private async partesSib(c: ContextoAns, operadora: number, hoje: string): Promise<Partes> {
    const lidos = await this.todosBeneficiarios(c, operadora);
    const aceitos = new Map<number, RetratoSib>();
    for (const b of lidos) {
      const r = json<RetratoSib | null>(b.complemento?.aceito, null);
      if (r) aceitos.set(b.id, r);
    }
    const s = selecionarMovimentosSib(lidos.map(beneficiarioDaRegra), aceitos, hoje);
    const porTipo = new Map<string, number>();
    for (const m of s.movimentos)
      porTipo.set(m.movimento.movimento, (porTipo.get(m.movimento.movimento) ?? 0) + 1);
    const parcelas = [...porTipo.entries()].map(([t, q]) => ({
      rotulo: MOVIMENTOS_SIB[t as keyof typeof MOVIMENTOS_SIB].rotulo,
      valor: 0,
      quantidade: q,
    }));
    const quadros: QuadroAns[] = [
      {
        titulo: 'Movimentos do cadastro de beneficiários',
        parcelas,
        total: { rotulo: 'Total no arquivo', valor: 0, quantidade: s.movimentos.length },
      },
      {
        titulo: 'Fora deste arquivo',
        parcelas: [
          { rotulo: 'Com pendência no cadastro', valor: 0, quantidade: s.pendentes.length },
          { rotulo: 'Para o arquivo seguinte (teto do arquivo)', valor: 0, quantidade: s.excedentes },
        ],
        total: { rotulo: 'Total', valor: 0, quantidade: s.pendentes.length + s.excedentes },
      },
    ];
    return {
      registros: s.movimentos.length,
      quadros,
      problemas: s.pendentes.flatMap((p) => p.problemas),
      valorTotal: null,
      itens: s.movimentos.map((m) => ({
        ordem: m.ordem,
        tipo: m.movimento.movimento,
        referencia: m.beneficiario.carteirinha,
        descricao: descricaoMovimentoSib(m.movimento),
        beneficiario: m.beneficiario.id,
        valor: null,
        dados: JSON.stringify(m.retrato),
      })),
      arquivo: (cab) => arquivoSib(cab, s.movimentos),
    };
  }

  private async partesSip(c: ContextoAns, operadora: number, inicio: string, fim: string): Promise<Partes> {
    const lidos: Awaited<ReturnType<PortaAnsOperadora['itensSip']>>['itens'] = [];
    let apos = 0;
    for (let k = 0; ; k++) {
      if (k >= PAGINAS_SIP) throw recusaAns(['arquivo-grande']);
      const p = await this.porta.itensSip(c, operadora, inicio, fim, apos);
      lidos.push(...p.itens);
      if (p.proxima === null) break;
      apos = p.proxima;
    }
    const codigos = lidos
      .filter((i) => i.tabela === '22' && /^\d{1,10}$/.test(i.codigo))
      .map((i) => Number(i.codigo));
    const [vigencias, grupos, ativos] = await Promise.all([
      this.porta.vigenciasSip(c, codigos),
      this.porta.gruposSip(c),
      this.porta.ativosNaData(c, operadora, fim),
    ]);
    const semBenef = lidos.filter((i) => i.beneficiario === null || !i.segmentacao).length;
    const itens: ItemSip[] = lidos
      .filter((i) => i.beneficiario !== null && i.segmentacao)
      .map((i) => ({
        beneficiario: i.beneficiario as number,
        segmentacao: i.segmentacao as SegmentacaoProduto,
        uf: ufDoMunicipio(i.municipio),
        dataExecucao: i.dataExecucao,
        tabela: i.tabela,
        codigo: i.codigo,
        quantidade: i.quantidade,
        despesaCentavos: Math.round(i.apresentado * 100) - Math.round(i.glosado * 100),
      }));
    const expostos: Partial<Record<SegmentacaoProduto, number>> = {};
    for (const a of ativos)
      if (a.segmentacao)
        expostos[a.segmentacao as SegmentacaoProduto] =
          (expostos[a.segmentacao as SegmentacaoProduto] ?? 0) + a.quantidade;
    const r = agregarSip(itens, vigencias, expostos);
    const quadros = quadrosSip(r, new Map(grupos.map((g) => [g.id, g.nome])));
    const problemas: ProblemaAns[] = [...r.problemas];
    if (semBenef) problemas.push({ ...problema('guia-sem-beneficiario', 'item', `${semBenef} item(ns)`) });
    const registros = r.linhas.length + (r.linhas.length === 0 && Object.keys(expostos).length ? 1 : 0);
    return {
      registros,
      quadros,
      problemas,
      valorTotal: quadros[0]?.total.valor ?? 0,
      itens: r.linhas.map((l, k) => ({
        ordem: k + 1,
        tipo: 'grupo',
        referencia: `${l.grupo}|${l.segmentacao}|${l.uf}`,
        descricao: `Grupo ${l.grupo}, ${l.segmentacao}, UF ${l.uf}: ${l.eventos} evento(s)`,
        beneficiario: null,
        valor: Math.round(l.despesaCentavos) / 100,
        dados: null,
      })),
      arquivo: (cab) => arquivoSip(cab, r),
    };
  }

  private async partesDiops(
    c: ContextoAns,
    e: GerarEnvioAnsEntrada,
    inicio: string,
    fim: string,
  ): Promise<Partes> {
    const meses = mesesDoPeriodo({ inicio, fim }).map((m) => m.mes);
    const [cobrancas, contas, ativos] = await Promise.all([
      this.porta.cobrancasDiops(c, e.operadora, meses, inicio, fim),
      this.porta.contasDiops(c, e.operadora, inicio, fim),
      this.porta.ativosNaData(c, e.operadora, fim),
    ]);
    const beneficiarios: Record<number, number> = {};
    for (const a of ativos)
      beneficiarios[a.tipoContratacao] = (beneficiarios[a.tipoContratacao] ?? 0) + a.quantidade;
    const balancete = e.balancete ?? null;
    const quadros = quadrosDiops({
      periodo: { inicio, fim },
      cobrancas,
      contas: contas.contas,
      pagamentos: contas.pagamentos,
      beneficiarios,
      balancete,
    });
    return {
      registros: quadros.length,
      quadros,
      problemas: problemasDiops(balancete),
      valorTotal: quadros[0]?.total.valor ?? 0,
      itens: quadros.map((q, k) => ({
        ordem: k + 1,
        tipo: 'quadro',
        referencia: String(k + 1),
        descricao: q.titulo.slice(0, 200),
        beneficiario: null,
        valor: q.total.valor,
        dados: null,
      })),
      arquivo: balancete ? (cab) => arquivoDiops(cab, quadros, balancete) : null,
    };
  }

  private async partesTps(
    c: ContextoAns,
    e: GerarEnvioAnsEntrada,
    inicio: string,
    fim: string,
  ): Promise<Partes> {
    const meses = mesesDoPeriodo({ inicio, fim });
    const [planos, valores, ...porMes] = await Promise.all([
      this.porta.planos(c, e.operadora),
      this.porta.valoresTps(c),
      ...meses.map((m) => this.porta.ativosNaData(c, e.operadora, m.ultimoDia)),
    ]);
    const r = calcularTps(
      planos.map((p) => ({
        produto: p.produto,
        nome: p.nome,
        registroAns: p.registroAns,
        beneficiariosPorMes: porMes.map((m) =>
          m.filter((a) => a.produto === p.produto).reduce((s, a) => s + a.quantidade, 0),
        ),
      })),
      valores,
      fim,
      e.descontos ?? [],
    );
    const quadros = quadrosTps(r);
    return {
      registros: r.linhas.length,
      quadros,
      problemas: r.problemas,
      valorTotal: r.totalCentavos / 100,
      itens: r.linhas.map((l, k) => ({
        ordem: k + 1,
        tipo: 'plano',
        referencia: l.registroAns ?? String(l.produto),
        descricao: (quadros[0]?.parcelas[k]?.rotulo ?? l.nome).slice(0, 200),
        beneficiario: null,
        valor: l.valorCentavos / 100,
        dados: null,
      })),
      arquivo: (cab) => arquivoTps(cab, r),
    };
  }

  private async partesMonitoramento(
    c: ContextoAns,
    operadora: number,
    inicio: string,
    fim: string,
  ): Promise<Partes> {
    const teto = PARAMETROS_ANS.maximoGuiasMonitoramento;
    const lidas = await this.porta.guiasMonitoramento(c, operadora, inicio, fim, teto);
    if (lidas.length > teto)
      return {
        registros: 0,
        quadros: [],
        problemas: [problema('arquivo-grande')],
        valorTotal: null,
        itens: [],
        arquivo: null,
      };
    const guias = lidas.map((g) => ({
      ...g,
      beneficiario: g.beneficiario
        ? {
            carteirinha: g.beneficiario.carteirinha,
            cns: g.beneficiario.cns,
            sexo: g.beneficiario.sexo,
            nascimento: g.beneficiario.nascimento,
            municipio: g.beneficiario.municipio,
            cco: g.beneficiario.cco,
          }
        : null,
    }));
    const quadros = quadrosMonitoramento(guias);
    return {
      registros: guias.length,
      quadros,
      problemas: problemasMonitoramento(guias),
      valorTotal: quadros[0]?.total.valor ?? 0,
      itens: guias.map((g, k) => ({
        ordem: k + 1,
        tipo: 'guia',
        referencia: `${g.protocolo}/${g.numeroGuiaPrestador}`.slice(0, 40),
        descricao: `Guia ${g.numeroGuiaPrestador} do protocolo ${g.protocolo}`,
        beneficiario: lidas[k]?.beneficiario?.id ?? null,
        valor:
          Math.round(
            g.itens.reduce((s, i) => s + Math.round(i.informado * 100) - Math.round(i.glosado * 100), 0),
          ) / 100,
        dados: null,
      })),
      arquivo: (cab) => arquivoMonitoramento(cab, guias),
    };
  }

  // ── Ressarcimento ao SUS ──────────────────────────────────────────────────────────────────────

  async registrarAviso(
    c: ContextoAns,
    e: RegistrarAvisoRessarcimentoEntrada,
  ): Promise<Omit<GeracaoEnvioSgh, 'hospital' | 'usuario'>> {
    const operadora = await this.operadoraDe(c, e.operadora);
    const { hoje } = await this.porta.relogio(c);
    const ps = problemasDoAviso(e.recebidoEm, e.atendimentos);
    if (operadora.situacao !== 'ativa') ps.unshift('operadora-inativa');
    if (e.recebidoEm > hoje) ps.push('competencia-futura');
    if (ps.length) throw recusaAns(ps);
    const plano = planoDaGeracao(
      'RESSARCIMENTO_SUS',
      e.recebidoEm,
      await this.porta.existentes(c, e.operadora, 'RESSARCIMENTO_SUS', e.recebidoEm),
    );
    if (plano.recusa !== null) throw recusaAns([plano.recusa]);
    const [benefs, cobrados] = await Promise.all([
      this.porta.beneficiariosRessarcimento(
        c,
        e.operadora,
        e.atendimentos.map((a) => a.identificacao),
      ),
      this.porta.atendimentosJaCobrados(c, e.atendimentos),
    ]);
    const porIdent = new Map(benefs.map((b) => [b.identificacao, b]));
    const itens: ItemRessarcimento[] = [];
    const gravar: ItemEnvioSgh[] = [];
    e.atendimentos.forEach((a, k) => {
      const b = porIdent.get(a.identificacao) ?? null;
      const sugestao = analisarAtendimentoSus(
        a,
        b
          ? {
              carteirinha: b.carteirinha,
              segmentacao: (b.produto.segmentacao as SegmentacaoProduto | null) ?? null,
              coberturaParcial: b.coberturaParcial,
              dados: {
                beneficiario: { situacao: b.situacao, inclusao: b.inclusao },
                contrato: {
                  situacao: b.contrato.situacao as 'ativo',
                  inicio: b.contrato.inicio,
                  fim: b.contrato.fim,
                },
                produto: {
                  situacao: b.produto.situacao as 'ativo',
                  natureza: b.produto.natureza,
                  carencias: json(b.produto.carencias, { urgencia: 0, partos: 0, demais: 0, cpt: 0 }),
                },
              },
            }
          : null,
        cobrados.has(`${a.tipo}${a.numero}`),
      );
      const item: ItemRessarcimento = {
        ordem: k + 1,
        tipo: a.tipo,
        numero: a.numero,
        identificacao: a.identificacao,
        inicio: a.inicio,
        fim: a.fim,
        procedimento: a.procedimento,
        valor: a.valor,
        sugestao,
        decisao: 'pendente',
        motivo: null,
        justificativa: null,
        deferida: null,
      };
      itens.push(item);
      gravar.push({
        ordem: k + 1,
        tipo: a.tipo,
        referencia: a.numero,
        descricao: `${a.tipo} ${a.numero}, de ${a.inicio.split('-').reverse().join('/')} a ${a.fim.split('-').reverse().join('/')}`,
        beneficiario: b?.id ?? null,
        valor: a.valor,
        dados: JSON.stringify({
          identificacao: a.identificacao,
          inicio: a.inicio,
          fim: a.fim,
          procedimento: a.procedimento,
        }),
        sugestao,
        decisao: 'pendente',
      });
    });
    const quadros = quadrosRessarcimento(itens);
    return {
      operadora: e.operadora,
      obrigacao: 'RESSARCIMENTO_SUS',
      competencia: e.recebidoEm,
      sequencial: plano.sequencial,
      retificador: false,
      destino: this.destino,
      leiaute: LEIAUTE_ANS,
      registros: itens.length,
      valorTotal: quadros[0]?.total.valor ?? 0,
      quadros: JSON.stringify(quadros),
      arquivo: null,
      aviso: { numero: e.aviso, recebidoEm: e.recebidoEm, prazo: prazoImpugnacao(e.recebidoEm) },
      substituir: [],
      itens: gravar,
    };
  }

  async conferirDecisao(
    c: ContextoAns,
    id: number,
    item: number,
    e: DecidirItemRessarcimentoEntrada,
  ): Promise<{ envio: EnvioAnsLido; texto: string }> {
    const [envio, itens, { hoje }] = await Promise.all([
      this.envioOu404(c, id),
      this.porta.itens(c, id),
      this.porta.relogio(c),
    ]);
    if (envio.obrigacao !== 'RESSARCIMENTO_SUS' || envio.situacao !== 'gerado')
      throw recusaAns(['situacao-nao-permite']);
    if (envio.versao !== e.versao) throw recusaAns(['envio-desatualizado']);
    const it = itens.find((i) => i.id === item);
    if (!it) throw recusaAns(['item-de-outro-envio']);
    const ps = problemasDaDecisao(e, envio.recebidoEm ? noPrazo(envio.recebidoEm, hoje) : false);
    if (ps.length) throw recusaAns(ps);
    const texto =
      e.decisao === 'aceitar'
        ? `${it.tipo} ${it.referencia} aceito para ressarcimento (${brl(it.valor ?? 0)}).`
        : `${it.tipo} ${it.referencia} impugnado: ${MOTIVOS_IMPUGNACAO_SUS[e.motivo ?? 'outro']}.`;
    return { envio, texto };
  }

  // ── Transmissão, retorno e GRU ────────────────────────────────────────────────────────────────

  async conferirTransmissao(
    c: ContextoAns,
    id: number,
    e: TransmitirEnvioAnsEntrada,
  ): Promise<{ envio: EnvioAnsLido; recibo: string | null; arquivo: ArquivoGravado | null; texto: string }> {
    const envio = await this.envioOu404(c, id);
    if (envio.situacao !== 'gerado') throw recusaAns(['situacao-nao-permite']);
    if (envio.versao !== e.versao) throw recusaAns(['envio-desatualizado']);
    const recibo = e.recibo?.trim() ? e.recibo.trim() : null;
    const ps = problemasDaTransmissao(envio.destino, recibo);
    if (ps.length) throw recusaAns(ps);
    let arquivo: ArquivoGravado | null = null;
    if (envio.obrigacao === 'RESSARCIMENTO_SUS') {
      const [itens, { hoje }, operadoras] = await Promise.all([
        this.porta.itens(c, id),
        this.porta.relogio(c),
        this.porta.operadoras(c),
      ]);
      const its = itens.map(itemDaRessarcimento);
      if (!todosDecididos(its)) throw recusaAns(['decisao-pendente']);
      if (its.some((i) => i.decisao === 'impugnar') && envio.recebidoEm && !noPrazo(envio.recebidoEm, hoje))
        throw recusaAns(['prazo-vencido']);
      const o = operadoras.find((x) => x.id === envio.operadora.id);
      const xml = arquivoRessarcimento(
        {
          registroAns: envio.operadora.registroAns,
          cnpj: o?.cnpj ?? '',
          competencia: envio.competencia,
          sequencial: envio.sequencial,
          geradoEm: hoje,
          destino: envio.destino,
        },
        { numero: envio.aviso ?? '', recebidoEm: envio.recebidoEm ?? envio.competencia },
        its,
      );
      arquivo = arquivoGravado(
        nomeArquivoAns('RESSARCIMENTO_SUS', envio.operadora.registroAns, envio.competencia, envio.sequencial),
        xml,
      );
    }
    const texto =
      envio.destino === 'ans'
        ? `Enviado à ANS com o recibo ${recibo}.`
        : `Enviado ao simulador (fora de produção nada vai à ANS).`;
    return { envio, recibo, arquivo, texto };
  }

  async conferirRetorno(
    c: ContextoAns,
    id: number,
    e: RegistrarRetornoAnsEntrada,
  ): Promise<{
    envio: EnvioAnsLido;
    situacao: 'aceito' | 'aceitoParcial' | 'rejeitado';
    itens: { id: number; aceito: boolean; cco: string | null; erro: string | null }[];
    texto: string;
  }> {
    const [envio, itens] = await Promise.all([this.envioOu404(c, id), this.porta.itens(c, id)]);
    if (envio.situacao !== 'enviado') throw recusaAns(['situacao-nao-permite']);
    if (envio.versao !== e.versao) throw recusaAns(['envio-desatualizado']);
    const r = resultadoDoRetorno(
      envio.obrigacao,
      envio.destino,
      itens.map((i) => ({ id: i.id, ordem: i.ordem, tipo: i.tipo, beneficiario: i.beneficiario })),
      e,
    );
    if (!('situacao' in r)) throw recusaAns(r.problemas);
    const situacao = r.situacao as 'aceito' | 'aceitoParcial' | 'rejeitado';
    const aceitos = r.itens.filter((i) => i.aceito).length;
    let texto = `Retorno ${envio.destino === 'ans' ? 'da ANS' : 'do simulador'}: ${aceitos} aceito(s), ${r.itens.length - aceitos} rejeitado(s).`;
    if (envio.obrigacao === 'RESSARCIMENTO_SUS') {
      const devido = valorDevido(
        itens.map((i) => ({
          ...itemDaRessarcimento(i),
          deferida: r.itens.find((x) => x.id === i.id)?.aceito ?? null,
        })),
      );
      texto += ` Valor a ressarcir: ${brl(devido)}.`;
    }
    return { envio, situacao, itens: [...r.itens], texto };
  }

  async conferirPagamento(c: ContextoAns, id: number, e: PagamentoGruEntrada): Promise<EnvioAnsLido> {
    const envio = await this.envioOu404(c, id);
    if (!OBRIGACOES_COM_GRU.includes(envio.obrigacao)) throw recusaAns(['sem-gru']);
    if (envio.situacao !== 'aceito' && envio.situacao !== 'aceitoParcial')
      throw recusaAns(['gru-antes-do-aceite']);
    if (envio.gru) throw recusaAns(['situacao-nao-permite']);
    if (envio.versao !== e.versao) throw recusaAns(['envio-desatualizado']);
    return envio;
  }

  // ── Complemento e pendências do SIB ───────────────────────────────────────────────────────────

  async complemento(c: ContextoAns, beneficiario: number): Promise<ComplementoSib> {
    const b = await this.porta.beneficiarioDaOperadora(c, beneficiario);
    if (!b) throw naoEncontrado('Beneficiário não encontrado');
    const x = await this.porta.complementoSib(c, beneficiario);
    return {
      beneficiario,
      versao: x?.versao ?? 0,
      logradouro: x?.logradouro ?? null,
      numero: x?.numero ?? null,
      complemento: x?.complemento ?? null,
      bairro: x?.bairro ?? null,
      municipio: x?.municipio ?? null,
      cep: x?.cep ?? null,
      resideExterior: x?.resideExterior ?? false,
      dnv: x?.dnv ?? null,
      coberturaParcial: x?.coberturaParcial ?? false,
      itensExcluidos: x?.itensExcluidos ?? false,
      cco: x?.cco ?? null,
      motivoCancelamento: x?.motivoCancelamento ?? null,
      aceitoEm: x?.aceitoEm ?? null,
    };
  }

  async conferirComplemento(c: ContextoAns, beneficiario: number, e: ComplementoSibEntrada): Promise<void> {
    const b = await this.porta.beneficiarioDaOperadora(c, beneficiario);
    if (!b) throw naoEncontrado('Beneficiário não encontrado');
    const ps: string[] = [];
    if (e.municipio !== null && !municipioValido(e.municipio)) ps.push('municipio-invalido');
    if (e.cco !== null && !ccoValido(e.cco)) ps.push('cco-invalido');
    if (ps.length) throw recusaAns(ps);
    const atual = await this.porta.complementoSib(c, beneficiario);
    if ((atual?.versao ?? 0) !== e.versao) throw recusaAns(['envio-desatualizado']);
  }

  async pendenciasSib(c: ContextoAns, operadora: number, apos: number): Promise<PendenciasSib> {
    const [{ hoje }, pagina] = await Promise.all([
      this.porta.relogio(c),
      this.porta.beneficiariosSib(c, operadora, apos),
    ]);
    const itens = pagina.itens.flatMap((b) => {
      const regra = beneficiarioDaRegra(b);
      const m = movimentoSib(regra, json<RetratoSib | null>(b.complemento?.aceito, null));
      if (!m) return [];
      const ps = problemasSib(regra, m, hoje, new Set());
      // O dependente cujo titular entra no mesmo arquivo não é pendência (o arquivo leva os dois).
      const reais = ps.filter((p) => p.codigo !== 'titular-sem-cco');
      if (!reais.length) return [];
      return [
        {
          beneficiario: b.id,
          carteirinha: b.carteirinha,
          nome: b.nome,
          movimento: m.movimento,
          problemas: reais,
        },
      ];
    });
    return { itens, proxima: pagina.proxima };
  }
}

/** O arquivo gerado (texto UTF-8) com o tamanho, o SHA-256 e o base64. */
export function arquivoGravado(nome: string, texto: string): ArquivoGravado {
  const bytes = Buffer.from(texto, 'utf8');
  return {
    nome,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  };
}
