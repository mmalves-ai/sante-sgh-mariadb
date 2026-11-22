// Serviço das contas médicas recebidas pela operadora própria (M56, etapa 6, F5): monta as respostas da tela a partir das
// leituras da porta e decide no servidor o que a tela só mostra:
//   - o recebimento: o arquivo (tamanho, ISO-8859-1), a versão TISS, o XSD 04.03.00 e o hash do epílogo (regra 5, com o
//     validador do M31, @sgh/dominio-faturamento), a leitura do lote, a operadora de destino, o prestador pelo documento,
//     o lote repetido e, por guia, o beneficiário da operadora pela carteirinha, a autorização pela senha, a guia já
//     apresentada, as críticas na data do atendimento e a glosa automática (@sgh/dominio-operadora);
//   - a revisão: quem analisa (o auditor designado e vigente da operadora do lote), a glosa com o motivo da tabela 38 do
//     banco e a justificativa, a conclusão com os valores, a devolução, o recurso e a decisão, o pagamento;
//   - o demonstrativo de análise da conta em XML TISS, conferido no XSD antes de sair.
// As gravações passam pelas recusas das regras antes de chegar ao banco; a versão vista e a situação de partida são do
// banco.
import { createHash } from 'node:crypto';
import {
  type ApoioContas,
  type ContaMedicaDetalhe,
  type ContaMedicaResumo,
  CRITICAS_CONTA,
  type CriticaConta,
  type DecidirRecursoItensEntrada,
  type GlosarContaEntrada,
  type GuiaTissRecebida,
  MAXIMO_BYTES_CONTA,
  MENSAGENS_CONTAS,
  type PagamentoPrestador,
  type ReceberContaEntrada,
  type RegistrarRecursoItensEntrada,
  STATUS_PROTOCOLO_TISS,
  TIPOS_GUIA_CONTA,
} from '@sgh/contratos';
import {
  type ArquivoEsquema,
  carregarEsquemas,
  conferirHashEpilogo,
  ErroLoteRecebido,
  explicarErroXsd,
  iso88591,
  lerLoteRecebido,
  mensagemDemonstrativoAnalise,
  mensagemDemonstrativoPagamento,
  PADRAO_TISS,
  validarNoXsd,
} from '@sgh/dominio-faturamento';
import {
  acoesDaConta,
  type AutorizacaoDaSenha,
  carteirinhaValida,
  competenciaDoRecebimento,
  contaVencida,
  criticasDaGuia,
  type DadosElegibilidade,
  designacaoVigente,
  documentoDaOrigem,
  glosaFinalDosItens,
  glosasAutomaticas,
  PARAMETROS_CONTA,
  prazoPagamento,
  type Problema,
  problemasDaDecisaoDoRecurso,
  problemasDaGlosa,
  problemasDoLote,
  problemasDoPagamento,
  problemasDoRecurso,
  situacaoDoRecurso,
  situacaoPelosValores,
  valoresDaConta,
} from '@sgh/dominio-operadora';
import {
  type DadosAuditor,
  type DadosConta,
  type DadosContaResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosGuiaConta,
  type EntradaGuiaRecebida,
  type EntradaRecebimentoConta,
} from './dados-portas.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoContas, PortaContasOperadora } from './contas-porta.js';

/** Recusa das regras: 409 com o primeiro código, os campos e os textos. */
export function recusaDasContas(
  problemas: readonly Problema[],
  extra: { readonly avisos?: readonly string[] } = {},
): ErroProblema {
  const [p] = problemas;
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    [...new Set(problemas.map((x) => MENSAGENS_CONTAS[x.codigo] ?? x.codigo))].join(' '),
    {
      codigo: p?.codigo ?? 'recusa',
      campos: [...new Set(problemas.map((x) => x.campo).filter((c): c is string => !!c))],
      bloqueios: problemas.map((x) => x.codigo),
      ...extra,
    },
  );
}

const naoEncontrada = () =>
  new ErroProblema('nao-encontrado', 404, 'Lote não encontrado', MENSAGENS_CONTAS['conta-inexistente']!);

const mesmoLogin = (a: string | null | undefined, b: string) =>
  !!a && a.trim().toUpperCase() === b.trim().toUpperCase();

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const somaCentavos = (vs: readonly number[]) => vs.reduce((s, v) => s + Math.round(v * 100), 0);
const reaisDe = (c: number) => Math.round(c) / 100;

/** O XSD 04.03.00 do M31, carregado uma vez (conferido contra o SHA256SUMS versionado). */
let esquemasTiss: Promise<ArquivoEsquema[]> | null = null;
function esquemas(): Promise<ArquivoEsquema[]> {
  esquemasTiss ??= carregarEsquemas().catch((e: unknown) => {
    esquemasTiss = null;
    throw e;
  });
  return esquemasTiss;
}

export function resumoDaConta(c: DadosContaResumo, hoje: string): ContaMedicaResumo {
  const v = valoresDaConta(c, c.situacao);
  return {
    id: c.id,
    protocolo: c.protocolo,
    operadora: c.operadora,
    prestador: c.prestador,
    prestadorNome: c.prestadorNome,
    numeroLote: c.numeroLote,
    tipoGuia: c.tipoGuia,
    competencia: c.competencia,
    guias: c.guias,
    recebidaEm: c.recebidaEm,
    prazoPagamento: c.prazoPagamento,
    vencida: c.vencida || contaVencida(c.situacao, c.prazoPagamento, hoje),
    situacao: c.situacao,
    recursosPendentes: c.recursosPendentes,
    ...v,
    versao: c.versao,
  };
}

export function pagamentoDe(c: DadosContaResumo, hoje: string): PagamentoPrestador {
  const r = resumoDaConta(c, hoje);
  return {
    id: r.id,
    protocolo: r.protocolo,
    prestador: r.prestador,
    prestadorNome: r.prestadorNome,
    competencia: r.competencia,
    numeroLote: r.numeroLote,
    prazoPagamento: r.prazoPagamento,
    vencida: r.vencida,
    situacao: r.situacao,
    liberado: r.liberado,
    pago: r.pago,
    saldo: r.saldo,
    versao: r.versao,
  };
}

function dadosDe(el: DadosElegibilidadeBeneficiario): DadosElegibilidade {
  return {
    beneficiario: { situacao: el.beneficiario.situacao, inclusao: el.beneficiario.inclusao },
    contrato: { situacao: el.contrato.situacao as 'ativo', inicio: el.contrato.inicio, fim: el.contrato.fim },
    produto: {
      situacao: el.produto.situacao as 'ativo',
      natureza: el.produto.natureza,
      carencias: el.produto.carencias,
    },
  };
}

export interface RecebimentoConferido {
  readonly recebimento: Omit<EntradaRecebimentoConta, 'hospital' | 'protocolo' | 'usuario' | 'texto'>;
  readonly guias: number;
  readonly glosadoAutomatico: number;
  readonly itensGlosados: number;
  readonly guiasComCritica: number;
}

export class ServicoContasOperadora {
  constructor(readonly porta: PortaContasOperadora) {}

  /** A designação vigente do usuário na operadora (ou em qualquer uma, sem a operadora). */
  async designacao(c: ContextoContas, login: string, operadora: number | null): Promise<DadosAuditor | null> {
    const [ds, { hoje }] = await Promise.all([this.porta.designacoes(c, login), this.porta.relogio(c)]);
    return (
      ds.find((d) => (operadora === null || d.operadora === operadora) && designacaoVigente(d, hoje)) ?? null
    );
  }

  /** Os motivos de glosa da tabela 38 (os de 4 dígitos: os códigos locais não vão ao TISS). */
  async motivos(c: ContextoContas): Promise<Map<number, { rotulo: string; grupo: string }>> {
    const m = await this.porta.motivos(c);
    return new Map(
      m
        .filter((x) => x.codigo >= 1000 && x.codigo <= 9999)
        .map((x) => [x.codigo, { rotulo: x.nome || String(x.codigo), grupo: x.tipoNome || 'Outros' }]),
    );
  }

  async apoio(
    c: ContextoContas,
    x: {
      ligada: boolean;
      motivo: string | null;
      podeLer: boolean;
      podeReceber: boolean;
      podeAnalisar: boolean;
      podePagar: boolean;
      login: string;
    },
  ): Promise<ApoioContas> {
    const relogio = await this.porta.relogio(c);
    // Com a fatia desligada, nada da operadora é lido (D-LEITURA-56).
    const [operadoras, prestadores, motivos, auditor] = x.ligada
      ? await Promise.all([
          this.porta.operadoras(c),
          this.porta.prestadores(c),
          this.motivos(c),
          this.designacao(c, x.login, null),
        ])
      : [[], [], new Map<number, { rotulo: string; grupo: string }>(), null];
    return {
      operadoras: operadoras.map((o) => ({
        id: o.id,
        nome: o.nomeFantasia ?? o.razaoSocial,
        registroAns: o.registroAns,
      })),
      prestadores,
      motivos: [...motivos].map(([codigo, m]) => ({ codigo, rotulo: m.rotulo, grupo: m.grupo })),
      auditor: auditor
        ? { id: auditor.id, operadora: auditor.operadora, nome: auditor.nome, categoria: auditor.categoria }
        : null,
      ligada: x.ligada,
      motivo: x.motivo,
      podeLer: x.podeLer && x.ligada,
      podeReceber: x.podeReceber && x.ligada,
      podeAnalisar: x.podeAnalisar && x.ligada,
      podePagar: x.podePagar && x.ligada,
      hoje: relogio.hoje,
      parametros: {
        diasPagamento: PARAMETROS_CONTA.diasPagamento,
        maximoKilobytes: MAXIMO_BYTES_CONTA / 1000,
      },
    };
  }

  // ── Recebimento ─────────────────────────────────────────────────────────────────────────────

  /** O arquivo, o XSD, o hash, o lote e as críticas de cada guia; devolve o que a gravação leva (sem o protocolo). */
  async conferirRecebimento(c: ContextoContas, e: ReceberContaEntrada): Promise<RecebimentoConferido> {
    const bytes = new Uint8Array(Buffer.from(e.arquivo.replace(/\s+/g, ''), 'base64'));
    if (bytes.length === 0) throw recusaDasContas([{ codigo: 'arquivo-invalido', campo: 'arquivo' }]);
    if (bytes.length > MAXIMO_BYTES_CONTA)
      throw recusaDasContas([{ codigo: 'arquivo-grande', campo: 'arquivo' }]);
    const texto = iso88591(bytes);
    if (!/<(?:[A-Za-z0-9_]+:)?mensagemTISS\b/.test(texto))
      throw recusaDasContas([{ codigo: 'arquivo-invalido', campo: 'arquivo' }]);
    const padrao = /<(?:[A-Za-z0-9_]+:)?Padrao>([^<]*)</.exec(texto)?.[1] ?? null;
    if (padrao !== PADRAO_TISS) throw recusaDasContas([{ codigo: 'versao-recusada', campo: 'arquivo' }]);
    const xsd = await validarNoXsd(bytes, await esquemas());
    if (!xsd.valido)
      throw recusaDasContas([{ codigo: 'xsd-invalido', campo: 'arquivo' }], {
        avisos: xsd.erros.slice(0, 10).map(explicarErroXsd),
      });
    if (!conferirHashEpilogo(texto).confere)
      throw recusaDasContas([{ codigo: 'hash-nao-confere', campo: 'arquivo' }]);
    let lote;
    try {
      lote = lerLoteRecebido(texto);
    } catch (x) {
      if (x instanceof ErroLoteRecebido) throw recusaDasContas([{ codigo: x.codigo, campo: 'arquivo' }]);
      throw x;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [operadoras, prestador, relogio] = await Promise.all([
      this.porta.operadoras(c),
      this.porta.prestadorPorDocumento(c, documentoDaOrigem(lote.prestador)),
      this.porta.relogio(c),
    ]);
    const operadora = operadoras.find((o) => o.registroAns === lote.registroAnsDestino) ?? null;
    const loteJaRecebido =
      operadora && prestador
        ? await this.porta.loteJaRecebido(c, {
            operadora: operadora.id,
            prestador: prestador.id,
            numeroLote: lote.numeroLote,
            sha256,
          })
        : false;
    const problemas = problemasDoLote(lote, {
      operadora: operadora
        ? { id: operadora.id, registroAns: operadora.registroAns, ativa: operadora.situacao === 'ativa' }
        : null,
      prestadorEncontrado: prestador !== null,
      loteJaRecebido,
    });
    if (problemas.length || !operadora || !prestador) throw recusaDasContas(problemas);
    const hoje = relogio.hoje;
    const carteiras = [...new Set(lote.guias.map((g) => g.carteirinha.replace(/\D/g, '')))].filter(
      carteirinhaValida,
    );
    const [elegs, autorizacoes, apresentadas] = await Promise.all([
      Promise.all(carteiras.map(async (k) => [k, await this.porta.elegibilidade(c, k)] as const)),
      this.porta.autorizacoesPorSenha(c, lote.guias.map((g) => g.senha ?? '').filter(Boolean)),
      this.porta.guiasJaApresentadas(
        c,
        prestador.id,
        lote.guias.map((g) => g.numeroGuiaPrestador),
      ),
    ]);
    const porCarteira = new Map(elegs);
    const porSenha = new Map(autorizacoes.map((a) => [a.senha, a]));
    // O prestador como foi gravado: a saída agendada conta da data efetiva (SITUACAO_EM).
    const prestadorGravado = {
      id: prestador.id,
      contratoInicio: prestador.contrato.inicio,
      situacao:
        prestador.situacao === 'descredenciado' || prestador.saidaEm !== null
          ? 'descredenciado'
          : 'credenciado',
      situacaoEm: prestador.saidaEm ?? prestador.situacaoEm,
    };
    let glosadoAutomatico = 0;
    let itensGlosados = 0;
    let guiasComCritica = 0;
    const guias: EntradaGuiaRecebida[] = lote.guias.map((g: GuiaTissRecebida, i) => {
      const carteira = g.carteirinha.replace(/\D/g, '');
      const el = porCarteira.get(carteira) ?? null;
      const daOperadora = el && el.beneficiario.operadora === operadora.id ? el : null;
      const a = g.senha ? porSenha.get(g.senha) : undefined;
      const autorizacao: AutorizacaoDaSenha | null = a
        ? {
            id: a.id,
            protocolo: a.protocolo,
            situacao: a.situacao as AutorizacaoDaSenha['situacao'],
            beneficiario: a.beneficiario,
            prestadores: a.prestadores,
            validade: a.validade,
            itens: a.itens,
          }
        : null;
      const criticas = criticasDaGuia(
        { ...g, carteirinha: carteira || g.carteirinha },
        {
          hoje,
          prestador: prestadorGravado,
          beneficiario: daOperadora ? { id: daOperadora.beneficiario.id, dados: dadosDe(daOperadora) } : null,
          autorizacao,
          jaApresentada: apresentadas.has(g.numeroGuiaPrestador),
        },
      );
      if (criticas.length) guiasComCritica++;
      const glosas = new Map(glosasAutomaticas(g, criticas, autorizacao).map((x) => [x.indice, x]));
      const itens = g.itens.map((it, k) => {
        const gl = glosas.get(k);
        if (gl) {
          glosadoAutomatico += Math.round(gl.glosado * 100);
          itensGlosados++;
        }
        return {
          ordem: k + 1,
          sequencial: it.sequencial || k + 1,
          grupo: it.grupo,
          codigoDespesa: it.codigoDespesa,
          tabela: it.tabela,
          codigo: it.codigo,
          descricao: it.descricao,
          data: it.data || g.inicio,
          quantidade: it.quantidade,
          fator: it.fator,
          valorUnitario: it.valorUnitario,
          apresentado: it.valorTotal,
          glosado: gl?.glosado ?? 0,
          motivo: gl?.motivo ?? null,
          justificativa: gl?.justificativa ?? null,
          critica: gl?.critica ?? null,
        };
      });
      return {
        ordem: i + 1,
        numeroGuiaPrestador: g.numeroGuiaPrestador,
        numeroGuiaOperadora: g.numeroGuiaOperadora,
        senha: g.senha,
        carteirinha: carteira || g.carteirinha,
        beneficiario: daOperadora?.beneficiario.id ?? null,
        // A autorização só fica ligada quando é do beneficiário da guia.
        autorizacao:
          autorizacao && daOperadora && autorizacao.beneficiario === daOperadora.beneficiario.id
            ? autorizacao.id
            : null,
        carater: g.carater,
        inicio: g.inicio,
        fim: g.fim < g.inicio ? g.inicio : g.fim,
        criticas,
        apresentado: reaisDe(somaCentavos(g.itens.map((x) => x.valorTotal))),
        itens,
      };
    });
    return {
      recebimento: {
        operadora: operadora.id,
        prestador: prestador.id,
        numeroLote: lote.numeroLote,
        tipoGuia: lote.tipoGuia,
        competencia: competenciaDoRecebimento(hoje),
        prazoPagamento: prazoPagamento(hoje),
        arquivo: {
          nome: e.nome,
          bytes: bytes.length,
          sha256,
          base64: Buffer.from(bytes).toString('base64'),
          hashEpilogo: conferirHashEpilogo(texto).calculado,
        },
        apresentado: reaisDe(somaCentavos(guias.map((g) => g.apresentado))),
        guias,
      },
      guias: guias.length,
      glosadoAutomatico: reaisDe(glosadoAutomatico),
      itensGlosados,
      guiasComCritica,
    };
  }

  static textoDoRecebimento(protocolo: string, r: RecebimentoConferido): string {
    const base = `Protocolo ${protocolo}: ${r.guias} guia(s) de ${TIPOS_GUIA_CONTA[r.recebimento.tipoGuia]}, apresentado ${brl(r.recebimento.apresentado)}.`;
    return r.itensGlosados
      ? `${base} Glosa automática de ${brl(r.glosadoAutomatico)} em ${r.itensGlosados} item(ns) de ${r.guiasComCritica || r.itensGlosados} guia(s); o auditor revê na análise.`
      : `${base} Nenhuma crítica no recebimento.`;
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────

  private async contaOuNada(c: ContextoContas, id: number): Promise<DadosConta> {
    const conta = await this.porta.conta(c, id);
    if (!conta) throw naoEncontrada();
    return conta;
  }

  async detalhe(
    c: ContextoContas,
    id: number,
    x: { login: string; podeAnalisar: boolean; podeReceber: boolean; podePagar: boolean },
  ): Promise<ContaMedicaDetalhe> {
    const conta = await this.contaOuNada(c, id);
    const [guias, itens, eventos, motivos, auditor, relogio, recursosItens] = await Promise.all([
      this.porta.guias(c, id),
      this.porta.itens(c, id),
      this.porta.eventos(c, id),
      this.motivos(c),
      this.designacao(c, x.login, conta.operadora),
      this.porta.relogio(c),
      this.porta.recursosItens(c, id),
    ]);
    const resumo = resumoDaConta(conta, relogio.hoje);
    const recorriveis = guias.filter((g) => g.glosado > 0 && !g.recurso).length;
    return {
      ...resumo,
      operadoraNome: conta.operadoraNome,
      registroAns: conta.registroAns,
      arquivo: { ...conta.arquivo },
      analisadaEm: conta.analisadaEm,
      analisadaPor: conta.analisadaPor,
      observacao: conta.observacao,
      motivoDevolucao: conta.motivoDevolucao,
      guiasDetalhe: guias.map((g) => ({
        id: g.id,
        ordem: g.ordem,
        numeroGuiaPrestador: g.numeroGuiaPrestador,
        numeroGuiaOperadora: g.numeroGuiaOperadora,
        senha: g.senha,
        carteirinha: g.carteirinha,
        beneficiario: g.beneficiario,
        autorizacao: g.autorizacao,
        carater: g.carater,
        inicio: g.inicio,
        fim: g.fim,
        apresentado: g.apresentado,
        glosado: g.glosado,
        acatado: g.acatado,
        criticas: g.criticas.map((k) => ({
          codigo: k,
          motivo: CRITICAS_CONTA[k as CriticaConta]?.motivo ?? 0,
          texto: MENSAGENS_CONTAS[k] ?? k,
        })),
        recurso: g.recurso
          ? {
              situacao: g.recurso.situacao,
              valor: g.recurso.valor,
              justificativa: g.recurso.justificativa,
              registradoEm: g.recurso.registradoEm,
              registradoPor: g.recurso.registradoPor,
              valorAcatado: g.recurso.situacao === 'pendente' ? null : g.acatado,
              parecer: g.recurso.parecer,
              decididoEm: g.recurso.decididoEm,
              decididoPor: g.recurso.decididoPor,
            }
          : null,
        recursosItens: recursosItens
          .filter((r) => r.guia === g.id)
          .map((r) => ({
            id: r.id,
            item: r.item,
            valor: r.valor,
            justificativa: r.justificativa,
            em: r.em,
            por: r.por,
            decisao: r.decisao ? { ...r.decisao } : null,
          })),
        itens: itens
          .filter((i) => i.guia === g.id)
          .map((i) => ({
            id: i.id,
            sequencial: i.sequencial,
            grupo: i.grupo,
            codigoDespesa: i.codigoDespesa,
            tabela: i.tabela,
            codigo: i.codigo,
            descricao: i.descricao,
            data: i.data,
            quantidade: i.quantidade,
            valorUnitario: i.valorUnitario,
            apresentado: i.apresentado,
            glosado: i.glosado,
            motivo: i.motivo,
            motivoNome: i.motivo === null ? null : (motivos.get(i.motivo)?.rotulo ?? String(i.motivo)),
            justificativa: i.justificativa,
            origem: i.origem,
            critica: i.critica,
          })),
      })),
      eventos: eventos.map((ev) => ({
        id: ev.id,
        evento: ev.evento,
        situacao: ev.situacao,
        guia: ev.guia,
        valor: ev.valor,
        texto:
          ev.evento === 'pagamento' && ev.pagoEm
            ? `Pago em ${ev.pagoEm.split('-').reverse().join('/')}`
            : ev.texto,
        documento: ev.documento,
        em: ev.em,
        por: ev.por,
      })),
      acoes: acoesDaConta({
        situacao: conta.situacao,
        saldo: resumo.saldo,
        auditorDesignado: auditor !== null,
        podeAnalisar: x.podeAnalisar,
        podeReceber: x.podeReceber,
        podePagar: x.podePagar,
        guiasRecorriveis: recorriveis,
        recursosPendentes: guias.filter((g) => g.recurso?.situacao === 'pendente').length,
      }),
    };
  }

  // ── Revisão do auditor ──────────────────────────────────────────────────────────────────────

  private async exigirAuditor(c: ContextoContas, login: string, conta: DadosConta): Promise<DadosAuditor> {
    const auditor = await this.designacao(c, login, conta.operadora);
    if (!auditor) throw recusaDasContas([{ codigo: 'auditor-nao-designado' }]);
    return auditor;
  }

  private exigirSituacao(conta: DadosConta, de: readonly DadosConta['situacao'][]): void {
    if (!de.includes(conta.situacao)) throw recusaDasContas([{ codigo: 'situacao-nao-permite' }]);
  }

  async conferirGlosa(c: ContextoContas, id: number, e: GlosarContaEntrada, login: string) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['recebida']);
    await this.exigirAuditor(c, login, conta);
    const [itens, motivos] = await Promise.all([this.porta.itens(c, id), this.motivos(c)]);
    const problemas = problemasDaGlosa(
      itens.map((i) => ({ id: i.id, apresentado: i.apresentado })),
      e.itens,
      new Set(motivos.keys()),
    );
    if (problemas.length) throw recusaDasContas(problemas);
    const glosado = somaCentavos(e.itens.map((i) => i.valorGlosado));
    const desfeita = glosado === 0;
    return {
      conta,
      desfeita,
      texto: desfeita
        ? `Glosa desfeita em ${e.itens.length} item(ns).`
        : `Glosa de ${brl(reaisDe(glosado))} em ${e.itens.filter((i) => i.valorGlosado > 0).length} item(ns)` +
          (e.itens.some((i) => i.valorGlosado === 0) ? '; glosa desfeita nos demais.' : '.'),
    };
  }

  async conferirConclusao(c: ContextoContas, id: number, login: string) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['recebida']);
    const auditor = await this.exigirAuditor(c, login, conta);
    const v = valoresDaConta(conta, 'analisada');
    const situacao = situacaoPelosValores(v.liberado, conta.pago) as 'analisada' | 'paga';
    return {
      conta,
      auditor,
      situacao,
      texto: `Análise concluída: apresentado ${brl(v.apresentado)}, glosado ${brl(v.glosado)}, liberado ${brl(v.liberado)}.`,
      liberado: v.liberado,
    };
  }

  async conferirDevolucao(c: ContextoContas, id: number, login: string) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['recebida']);
    await this.exigirAuditor(c, login, conta);
    return { conta };
  }

  private async guiaDaConta(c: ContextoContas, id: number, guia: number): Promise<DadosGuiaConta> {
    const g = (await this.porta.guias(c, id)).find((x) => x.id === guia);
    if (!g) throw recusaDasContas([{ codigo: 'guia-inexistente', campo: 'guia' }]);
    return g;
  }

  async conferirRecurso(c: ContextoContas, id: number, e: { guia: number; valor: number }) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['analisada', 'paga']);
    const g = await this.guiaDaConta(c, id, e.guia);
    const problemas = problemasDoRecurso({ glosado: g.glosado, recurso: g.recurso }, e.valor);
    if (problemas.length) throw recusaDasContas(problemas);
    return { conta, guia: g, situacao: conta.situacao as 'analisada' | 'paga' };
  }

  async conferirDecisaoRecurso(
    c: ContextoContas,
    id: number,
    e: { guia: number; valorAcatado: number },
    login: string,
  ) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['analisada', 'paga']);
    await this.exigirAuditor(c, login, conta);
    const g = await this.guiaDaConta(c, id, e.guia);
    const problemas = problemasDaDecisaoDoRecurso({ glosado: g.glosado, recurso: g.recurso }, e.valorAcatado);
    if (problemas.length || !g.recurso) throw recusaDasContas(problemas);
    // D-RECURSO-PROPRIO-566: quem registrou o recurso não o decide (segunda pessoa obrigatória).
    if (mesmoLogin(g.recurso.registradoPor, login))
      throw recusaDasContas([{ codigo: 'recurso-do-proprio-auditor', campo: 'guia' }]);
    // W0-10 (M8): o recurso feito por item se decide item a item (senão os itens ficariam sem decisão).
    if ((await this.porta.recursosItens(c, id)).some((r) => r.guia === e.guia && !r.decisao))
      throw recusaDasContas([{ codigo: 'recurso-por-item', campo: 'guia' }]);
    const v = valoresDaConta({ ...conta, acatado: conta.acatado + e.valorAcatado }, 'analisada');
    return {
      conta,
      guia: g,
      situacaoRecurso: situacaoDoRecurso(g.recurso.valor, e.valorAcatado) as
        'acatado' | 'parcial' | 'mantido',
      situacao: situacaoPelosValores(v.liberado, conta.pago) as 'analisada' | 'paga',
    };
  }

  /**
   * W0-10 (M8): a decisão do recurso por item de uma guia: o auditor designado (outra pessoa, não quem recorreu) decide
   * cada item recorrido, uma vez cada, com o valor acatado de zero até o recorrido; a guia é decidida pela soma.
   */
  async conferirDecisaoRecursoItens(
    c: ContextoContas,
    id: number,
    guia: number,
    e: DecidirRecursoItensEntrada,
    login: string,
  ) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['analisada', 'paga']);
    await this.exigirAuditor(c, login, conta);
    const g = await this.guiaDaConta(c, id, guia);
    if (g.recurso?.situacao !== 'pendente')
      throw recusaDasContas([{ codigo: 'sem-recurso-pendente', campo: 'guia' }]);
    if (mesmoLogin(g.recurso.registradoPor, login))
      throw recusaDasContas([{ codigo: 'recurso-do-proprio-auditor', campo: 'guia' }]);
    const pendentes = (await this.porta.recursosItens(c, id)).filter((r) => r.guia === guia && !r.decisao);
    if (pendentes.length === 0) throw recusaDasContas([{ codigo: 'sem-recurso-por-item', campo: 'guia' }]);
    const porItem = new Map(e.decisoes.map((d) => [d.item, d]));
    if (porItem.size !== e.decisoes.length)
      throw recusaDasContas([{ codigo: 'item-repetido', campo: 'decisoes' }]);
    if (porItem.size !== pendentes.length || pendentes.some((r) => !porItem.has(r.item)))
      throw recusaDasContas([{ codigo: 'decisao-incompleta', campo: 'decisoes' }]);
    let acatado = 0;
    for (const r of pendentes) {
      const d = porItem.get(r.item);
      const v = Math.round((d?.valorAcatado ?? 0) * 100);
      if (v < 0 || v > Math.round(r.valor * 100))
        throw recusaDasContas([{ codigo: 'acatado-acima-do-recurso-do-item', campo: 'decisoes' }]);
      acatado += v;
    }
    const valorAcatado = acatado / 100;
    const v = valoresDaConta({ ...conta, acatado: conta.acatado + valorAcatado }, 'analisada');
    return {
      conta,
      guia: g,
      valorAcatado,
      situacao: situacaoPelosValores(v.liberado, conta.pago) as 'analisada' | 'paga',
    };
  }

  /**
   * W0-10 (M8): o recurso por item que o prestador manda pelo portal: lote analisado ou pago, guia do lote com glosa e
   * ainda sem recurso, cada item da guia com glosa, uma vez cada, valor de um centavo até o glosado no item.
   */
  async conferirRecursoItens(c: ContextoContas, id: number, e: RegistrarRecursoItensEntrada) {
    const conta = await this.contaOuNada(c, id);
    this.exigirSituacao(conta, ['analisada', 'paga']);
    const g = await this.guiaDaConta(c, id, e.guia);
    if (g.recurso) throw recusaDasContas([{ codigo: 'recurso-ja-registrado', campo: 'guia' }]);
    if (new Set(e.itens.map((i) => i.item)).size !== e.itens.length)
      throw recusaDasContas([{ codigo: 'item-repetido', campo: 'itens' }]);
    const itens = new Map(
      (await this.porta.itens(c, id)).filter((i) => i.guia === e.guia).map((i) => [i.id, i] as const),
    );
    for (const i of e.itens) {
      const it = itens.get(i.item);
      if (!it) throw recusaDasContas([{ codigo: 'item-nao-encontrado', campo: 'itens' }]);
      if (Math.round(it.glosado * 100) <= 0)
        throw recusaDasContas([{ codigo: 'item-sem-glosa', campo: 'itens' }]);
      if (Math.round(i.valor * 100) > Math.round(it.glosado * 100))
        throw recusaDasContas([{ codigo: 'recurso-acima-da-glosa-do-item', campo: 'itens' }]);
    }
    const valor = e.itens.reduce((t, i) => t + Math.round(i.valor * 100), 0) / 100;
    return { conta, guia: g, valor, situacao: conta.situacao as 'analisada' | 'paga' };
  }

  async conferirPagamento(c: ContextoContas, id: number, e: { valor: number; data: string }) {
    const [conta, { hoje }] = await Promise.all([this.contaOuNada(c, id), this.porta.relogio(c)]);
    const v = valoresDaConta(conta, conta.situacao);
    const problemas = problemasDoPagamento(
      { situacao: conta.situacao, saldo: v.saldo, analisadaEm: conta.analisadaEm },
      e,
      hoje,
    );
    if (problemas.length) throw recusaDasContas(problemas);
    return {
      conta,
      situacao: situacaoPelosValores(v.liberado, conta.pago + e.valor) as 'analisada' | 'paga',
      saldoDepois: reaisDe(Math.round(v.saldo * 100) - Math.round(e.valor * 100)),
    };
  }

  // ── Demonstrativo de análise da conta ─────────────────────────────────────────────────────────

  async demonstrativo(
    c: ContextoContas,
    id: number,
  ): Promise<{ nome: string; xmlBase64: string; hash: string }> {
    const conta = await this.contaOuNada(c, id);
    if (conta.situacao === 'devolvida') throw recusaDasContas([{ codigo: 'demonstrativo-da-devolvida' }]);
    if (conta.situacao === 'recebida') throw recusaDasContas([{ codigo: 'demonstrativo-antes-da-analise' }]);
    const [guias, itens, relogio] = await Promise.all([
      this.porta.guias(c, id),
      this.porta.itens(c, id),
      this.porta.relogio(c),
    ]);
    const prestador = prestadorTiss(conta.prestadorDocumento);
    const status = STATUS_PROTOCOLO_TISS[conta.situacao];
    const m = mensagemDemonstrativoAnalise({
      sequencialTransacao: String(conta.id).slice(-12),
      data: relogio.hoje,
      hora: relogio.agora.slice(11, 19),
      registroAns: conta.registroAns,
      nomeOperadora: conta.operadoraNome,
      cnpjOperadora: conta.operadoraCnpj,
      numeroDemonstrativo: conta.protocolo,
      prestador,
      cnes: conta.prestadorCnes ?? '',
      numeroLote: conta.numeroLote,
      protocolo: conta.protocolo,
      dataProtocolo: conta.recebidaEm.slice(0, 10),
      situacao: status,
      observacao: conta.observacao,
      guias: guias.map((g) => {
        const daGuia = itens.filter((i) => i.guia === g.id);
        const finais = glosaFinalDosItens(
          daGuia.map((i) => i.glosado),
          g.acatado,
        );
        return {
          numeroGuiaPrestador: g.numeroGuiaPrestador,
          numeroGuiaOperadora: g.numeroGuiaOperadora,
          senha: g.senha,
          numeroCarteira: g.carteirinha,
          inicio: g.inicio,
          fim: g.fim,
          situacao: status,
          itens: daGuia.map((i, k) => ({
            sequencial: i.sequencial,
            data: i.data,
            tabela: i.tabela,
            codigo: i.codigo,
            descricao: i.descricao,
            informado: i.apresentado,
            quantidade: i.quantidade,
            liberado: reaisDe(Math.round(i.apresentado * 100) - Math.round(finais[k]! * 100)),
            glosas:
              finais[k]! > 0 && i.motivo !== null ? [{ valor: finais[k]!, tipo: String(i.motivo) }] : [],
          })),
        };
      }),
    });
    return entregarDemonstrativo(m, `demonstrativo-${conta.protocolo}.xml`);
  }

  // ── Demonstrativo de pagamento (W0-10, M8) ─────────────────────────────────────────────────────

  /**
   * O demonstrativo de pagamento do lote quitado (só a conta paga), em XML TISS validado no XSD. Os pagamentos parciais
   * ficam numa só data, a da quitação (D-W0-10-DEMPAG-DATA), com cada data e valor na observação; a forma é a
   * transferência bancária (1), a única que a operadora usa (D-W0-10-DEMPAG-FORMA); a guia com valor acatado em recurso
   * sai como pagamento de recurso (2). Sem débitos nem créditos: o líquido é o liberado.
   */
  async demonstrativoPagamento(
    c: ContextoContas,
    id: number,
  ): Promise<{ nome: string; xmlBase64: string; hash: string }> {
    const conta = await this.contaOuNada(c, id);
    if (conta.situacao !== 'paga')
      throw recusaDasContas([{ codigo: 'demonstrativo-pagamento-antes-da-quitacao' }]);
    const [guias, eventos, relogio] = await Promise.all([
      this.porta.guias(c, id),
      this.porta.eventos(c, id),
      this.porta.relogio(c),
    ]);
    const pagamentos = eventos.filter((e) => e.evento === 'pagamento' && e.pagoEm && e.valor !== null);
    const quitacao =
      pagamentos
        .map((e) => e.pagoEm!)
        .sort()
        .at(-1) ?? relogio.hoje;
    const m = mensagemDemonstrativoPagamento({
      sequencialTransacao: String(conta.id).slice(-12),
      data: relogio.hoje,
      hora: relogio.agora.slice(11, 19),
      registroAns: conta.registroAns,
      nomeOperadora: conta.operadoraNome,
      cnpjOperadora: conta.operadoraCnpj,
      numeroDemonstrativo: `P${conta.protocolo}`,
      prestador: prestadorTiss(conta.prestadorDocumento),
      cnes: conta.prestadorCnes ?? '',
      pagamentos: [
        {
          data: quitacao,
          forma: '1',
          protocolos: [
            {
              dataProtocolo: conta.recebidaEm.slice(0, 10),
              protocolo: conta.protocolo,
              numeroLote: conta.numeroLote,
              guias: guias.map((g) => {
                const glosa = reaisDe(Math.round(g.glosado * 100) - Math.round(g.acatado * 100));
                return {
                  numeroGuiaPrestador: g.numeroGuiaPrestador,
                  numeroGuiaOperadora: g.numeroGuiaOperadora,
                  senha: g.senha,
                  recurso: g.acatado > 0,
                  informado: g.apresentado,
                  liberado: reaisDe(Math.round(g.apresentado * 100) - Math.round(glosa * 100)),
                  glosa,
                };
              }),
            },
          ],
        },
      ],
      observacao: pagamentos.length
        ? `Pagamentos: ${pagamentos.map((e) => `${e.pagoEm!.split('-').reverse().join('/')} ${brl(e.valor!)}`).join('; ')}.`
        : null,
    });
    return entregarDemonstrativo(m, `demonstrativo-pagamento-${conta.protocolo}.xml`);
  }
}

function prestadorTiss(doc: string) {
  return /^\d{11}$/.test(doc)
    ? ({ tipo: 'cpf', valor: doc } as const)
    : /^\d{14}$/.test(doc)
      ? ({ tipo: 'cnpj', valor: doc } as const)
      : ({ tipo: 'codigo', valor: doc } as const);
}

/** Confere no XSD da TISS antes de entregar: o que não passa não sai (500, nada entregue). */
async function entregarDemonstrativo(
  m: { bytes: Uint8Array; hash: string },
  nome: string,
): Promise<{ nome: string; xmlBase64: string; hash: string }> {
  const v = await validarNoXsd(m.bytes, await esquemas());
  if (!v.valido)
    throw new ErroProblema(
      'erro-interno',
      500,
      'Demonstrativo inválido',
      'O demonstrativo gerado não passou no XSD da TISS; nada foi entregue.',
      { avisos: v.erros.slice(0, 5) },
    );
  return { nome, xmlBase64: Buffer.from(m.bytes).toString('base64'), hash: m.hash };
}
