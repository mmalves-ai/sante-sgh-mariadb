// Serviço da cobrança e das mensalidades da operadora própria (M56, etapa 3, F2; ficha, seções 1, 4, 6, 7 e 8, regra
// 6): monta as respostas da tela a partir das leituras da porta e decide no servidor o que a tela só mostra. Cada rota
// exige a chave `operadora.cobranca` (só com a do módulo; regra 1) e as regras puras de @sgh/dominio-operadora antes de
// gravar: a mensalidade da competência (faixa da RN 63 com os reajustes), a coparticipação pela regra do produto, a
// baixa com a multa e os juros (ou a dispensa com o motivo), o acordo, o reajuste anual e a inadimplência (Lei
// 9.656/1998, art. 13, II; RN ANS 593/2023). O pagador vem do banco (o titular do contrato de pessoa física ou o
// contratante), nunca do pedido. O documento do pagador sai mascarado; a lista e a ficha são leituras auditadas.
// A mensagem ao beneficiário só pela Hal-AI, com a base legal e em produção (regra 6): a tela mostra o motivo.
import {
  type AcordoEntrada,
  type BaixarCobrancaEntrada,
  CHAVE_OPERADORA_COBRANCA,
  CHAVE_OPERADORA_MENSAGENS,
  type CobrancaDetalhe,
  type CobrancaResumo,
  type Cobrancas,
  EVENTOS_AUDITAVEIS,
  FAIXAS_ETARIAS_ANS,
  type FiltroCobrancas,
  type GerarMensalidadesEntrada,
  type InadimplenciaOperadora,
  type Inadimplente,
  type LancarAvulsaEntrada,
  type LancarCoparticipacaoEntrada,
  MENSAGENS_COBRANCA,
  type MotivoCobrancaEntrada,
  type NotificacaoEntrada,
  PARAMETROS_COBRANCA,
  type PreviaAcordo,
  type PreviaMensalidades,
  type ReajusteEntrada,
  type ReajusteLido,
  type ReajustesOperadora,
  type ResultadoAcordo,
  type ResultadoCobranca,
  type ResultadoGeracao,
  type TelaCobranca,
} from '@sgh/contratos';
import {
  calcularAcordo,
  competenciaDe,
  conferirReajuste,
  decidirMensagemBeneficiario,
  diasEntre,
  encargosNaData,
  mascararDocumentoContratante,
  mensalidadeDoContrato,
  primeiroDia,
  problemasDaBaixaCobranca,
  problemasDaNotificacao,
  problemasDoLancamento,
  situacaoInadimplencia,
  somarDias,
  ultimoDia,
  type CalculoCoparticipacao,
  calcularCoparticipacao,
  problemasDaCoparticipacao,
} from '@sgh/dominio-operadora';
import { recusa } from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { type DadosCobranca, type DadosReajuste, type EntradaCobranca } from './dados-portas.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema, type ExtrasProblema } from '../../problema.filter.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro } from '../cadastro/comum.js';
import type { ServicoSituacaoOperadora, SujeitoOperadora } from './aplicacao/situacao.js';
import type { GravadorCobranca, PortaCobrancaOperadora } from './cobranca-porta.js';
import { contextoGravacao } from './contexto-gravacao.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.cobranca';
const T = { cobranca: 'fatura_plano', reajuste: 'reajuste_contrato_plano' } as const;
const ZERO = { multa: 0, juros: 0, total: 0 };
/** A prévia mostra até 100 cobranças (a quantidade e o total são de todas). */
const PREVIA_MAXIMA = 100;

const mmaaaa = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const naoEncontrada = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, `${o} não existe nesta operadora.`);

/** Recusa de negócio (422) com os códigos e as frases (MENSAGENS_COBRANCA); nada é gravado. */
function recusar(
  codigos: readonly string[],
  titulo: string,
  devido?: { devido: NonNullable<ExtrasProblema['devido']>; detalhe: string },
): void {
  if (codigos.length === 0) return;
  throw new ErroProblema(
    'recusa-de-negocio',
    422,
    titulo,
    [...codigos.map((c) => MENSAGENS_COBRANCA[c] ?? c), ...(devido ? [devido.detalhe] : [])].join(' '),
    { codigo: codigos[0] as string, bloqueios: [...codigos], ...(devido ? { devido: devido.devido } : {}) },
  );
}

const brlTexto = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/** O devido calculado, para a recusa da baixa dizer que valor digitar (o valor, a multa e os juros da data). */
export function textoDoDevido(
  data: string,
  valor: number,
  encargos: { multa: number; juros: number },
  devido: number,
  dispensado: boolean,
): string {
  const dataBr = `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
  return dispensado
    ? `O devido em ${dataBr} é ${brlTexto(devido)} (o valor, com a multa e os juros dispensados).`
    : `O devido em ${dataBr} é ${brlTexto(devido)} (valor ${brlTexto(valor)}, multa ${brlTexto(encargos.multa)} e juros ${brlTexto(encargos.juros)}).`;
}

export function resumoDaCobranca(x: DadosCobranca, hoje: string): CobrancaResumo {
  const vencida = x.situacao === 'aberta' && x.vencimento < hoje;
  return {
    id: x.id,
    operadora: x.operadora,
    contrato: x.contrato,
    contratoNumero: x.contratoNumero,
    tipoContrato: x.tipoContrato,
    pagadorNome: x.pagadorNome,
    pagadorDocumento: mascararDocumentoContratante(x.pagadorDocumento),
    tipo: x.tipo,
    competencia: x.competencia,
    descricao: x.descricao,
    valor: x.valor,
    vencimento: x.vencimento,
    situacao: x.situacao,
    situacaoEm: x.situacaoEm,
    vencida,
    diasAtraso: vencida ? diasEntre(x.vencimento, hoje) : 0,
    encargosHoje: x.situacao === 'aberta' ? encargosNaData(x.valor, x.vencimento, hoje) : ZERO,
    acordoOrigem: x.acordoOrigem,
    parcela: x.parcela,
    parcelas: x.parcelas,
    notificadoEm: x.notificadoEm,
    versao: x.versao,
  };
}

const reajusteDto = (r: DadosReajuste): ReajusteLido => ({
  id: r.id,
  contrato: r.contrato,
  contratoNumero: r.contratoNumero,
  tipoContratacao: r.tipoContratacao,
  competencia: r.competencia,
  percentual: r.percentual,
  tetoAns: r.tetoAns,
  oficioAns: r.oficioAns,
  vidas: r.vidas,
  motivo: r.motivo,
  situacao: r.situacao,
  canceladoMotivo: r.canceladoMotivo,
  registradoEm: r.registradoEm,
  registradoPor: r.registradoPor,
});

const MEIOS = new Set(['carta-ar', 'pessoal', 'edital']);
const meio = (v: string | null) => (v && MEIOS.has(v) ? (v as 'carta-ar' | 'pessoal' | 'edital') : null);

export class ServicoCobrancaOperadora {
  constructor(
    private readonly porta: PortaCobrancaOperadora,
    private readonly situacoes: ServicoSituacaoOperadora,
    private readonly trilha: RegistradorTrilha | null,
    private readonly ambiente: string,
  ) {}

  private sujeito(s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: s.req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A fatia vale (módulo e cobrança ligados) ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  exigirFatia(s: SessaoCadastro): Promise<void> {
    return this.situacoes.exigir(this.sujeito(s), CHAVE_OPERADORA_COBRANCA);
  }

  /** Gravação com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<R extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    tabela: string,
    chave: (r: R) => string | null,
    fn: (g: GravadorCobranca) => Promise<R>,
  ): Promise<R> {
    const linha = (r: R): RegistroTrilhaTela =>
      linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id), chave: chave(r) });
    const r = await this.porta.gravar(contextoGravacao(s, operacao), linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria' && this.trilha)
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: RECURSO,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(r.id),
      });
    return r;
  }

  /** A operadora pedida (que tem de existir no estabelecimento) ou a primeira. */
  private async operadoraDe(s: SessaoCadastro, pedida?: number): Promise<number | null> {
    const ops = await this.porta.operadoras(s.porta);
    if (pedida !== undefined) {
      if (!ops.some((o) => o.id === pedida)) throw naoEncontrada('Operadora');
      return pedida;
    }
    return ops[0]?.id ?? null;
  }

  private async contratoDe(s: SessaoCadastro, id: number) {
    const k = await this.porta.contrato(s.porta, id);
    if (!k) throw naoEncontrada('Contrato');
    return k;
  }

  private async cobrancaDe(s: SessaoCadastro, id: number): Promise<DadosCobranca> {
    const x = await this.porta.cobranca(s.porta, id);
    if (!x) throw naoEncontrada('Cobrança');
    return x;
  }

  /** O pagador do contrato: o titular na pessoa física (o mais recente não excluído), null na jurídica. */
  private async pagador(s: SessaoCadastro, contrato: { id: number; tipo: number }): Promise<number | null> {
    if (contrato.tipo !== 1) return null;
    return (await this.porta.titular(s.porta, contrato.id))?.id ?? null;
  }

  // ── Tela ────────────────────────────────────────────────────────────────────────────────────────────────────

  async tela(s: SessaoCadastro): Promise<TelaCobranca> {
    const situacao = await this.situacoes.situacao(this.sujeito(s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_COBRANCA);
    const msgs = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_MENSAGENS);
    const ligada = fatia?.situacao === 'ligada';
    const motivo = ligada ? null : (fatia?.motivo ?? situacao.modulo.motivo);
    // A chave das mensagens só liga com a base legal registrada (pré-requisito da DP-44 a).
    const mensagensLigada = msgs?.situacao === 'ligada';
    const decisao = decidirMensagemBeneficiario({
      ambiente: this.ambiente,
      baseLegalAprovada: mensagensLigada,
      chaveLigada: mensagensLigada,
    });
    const P = PARAMETROS_COBRANCA;
    const base = {
      liberacao: { ligada, motivo },
      mensagens: {
        enviar: decisao.enviar,
        motivo: decisao.enviar ? null : MENSAGENS_MOTIVO_MENSAGEM[decisao.motivo],
      },
      parametros: {
        multaPercentual: P.multaPercentual,
        jurosPercentualMes: P.jurosPercentualMes,
        diasLimiteNotificacao: P.diasLimiteNotificacao,
        diasInadimplencia: P.diasInadimplencia,
        diasPrazoNotificacao: P.diasPrazoNotificacao,
        parcelasMaximas: P.parcelasMaximas,
      },
    };
    if (!ligada) return { ...base, acoes: { gerar: false, motivo }, operadoras: [], hoje: '' };
    const [operadoras, hoje] = [await this.porta.operadoras(s.porta), await this.porta.hoje(s.porta)];
    const gerar = s.pode('operadora.cobranca.gerar');
    return {
      ...base,
      acoes: { gerar, motivo: gerar ? null : 'Seu perfil só consulta a cobrança da operadora.' },
      operadoras: operadoras.map((o) => ({
        id: o.id,
        razaoSocial: o.razaoSocial,
        registroAns: o.registroAns,
      })),
      hoje,
    };
  }

  // ── Listas e ficha ──────────────────────────────────────────────────────────────────────────────────────────

  async cobrancas(s: SessaoCadastro, f: FiltroCobrancas): Promise<Cobrancas> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDe(s, f.operadora);
    const hoje = await this.porta.hoje(s.porta);
    if (operadora === null)
      return {
        itens: [],
        proxima: null,
        totais: {
          abertas: 0,
          valorAberto: 0,
          vencidas: 0,
          valorVencido: 0,
          pagasNoMes: 0,
          valorPagoNoMes: 0,
        },
      };
    const r = await this.porta.cobrancas(s.porta, {
      operadora,
      ...(f.competencia ? { competencia: f.competencia } : {}),
      ...(f.situacao ? { situacao: f.situacao } : {}),
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(f.contrato ? { contrato: f.contrato } : {}),
      ...(f.vencidas ? { vencidasAntesDe: hoje } : {}),
      ...(f.busca ? { numero: f.busca } : {}),
      ...(f.apos ? { apos: f.apos } : {}),
    });
    const totais = await this.porta.totais(s.porta, operadora, hoje);
    return { itens: r.itens.map((x) => resumoDaCobranca(x, hoje)), proxima: r.proxima, totais };
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<CobrancaDetalhe> {
    await this.exigirFatia(s);
    const x = await this.cobrancaDe(s, id);
    const hoje = await this.porta.hoje(s.porta);
    const itens = await this.porta.itens(s.porta, id);
    const renegociadas =
      x.acordoOrigem !== null ? await this.porta.renegociadas(s.porta, x.acordoOrigem) : [];
    return {
      ...resumoDaCobranca(x, hoje),
      itens: itens.map((i) => ({
        beneficiario: i.beneficiario,
        beneficiarioNome: i.beneficiarioNome,
        descricao: i.descricao,
        faixa: i.faixa,
        idade: i.idade,
        valorBase: i.valorBase,
        valor: i.valor,
      })),
      pagoEm: x.pagoEm,
      valorPago: x.valorPago,
      multa: x.multa,
      juros: x.juros,
      dispensaMotivo: x.dispensaMotivo,
      motivo: x.motivo,
      acordoDestino: x.acordoDestino,
      notificacaoMeio: meio(x.notificacaoMeio),
      notificacaoReferencia: x.notificacaoReferencia,
      renegociadas: renegociadas.map((r) => ({
        id: r.id,
        tipo: r.tipo,
        competencia: r.competencia,
        valor: r.valor,
        vencimento: r.vencimento,
      })),
      criadoEm: x.criadoEm,
      criadoPor: x.criadoPor,
      alteradoEm: x.alteradoEm,
      alteradoPor: x.alteradoPor,
    };
  }

  // ── Mensalidades ────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A prévia (confirmar false) ou a geração das mensalidades da competência, página a página de contratos: cada
   * página numa transação (a mensalidade gerada por outra pessoa no meio do caminho relê a página uma vez).
   */
  async mensalidades(
    s: SessaoCadastro,
    e: GerarMensalidadesEntrada,
    confirmar: boolean,
  ): Promise<PreviaMensalidades | ResultadoGeracao> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDe(s, e.operadora);
    if (operadora === null) throw naoEncontrada('Operadora');
    if (e.contrato !== null) {
      const k = await this.contratoDe(s, e.contrato);
      if (k.operadora !== operadora) throw naoEncontrada('Contrato');
    }
    const c = e.competencia;
    const filtro = {
      operadora,
      competencia: c,
      primeiroDia: primeiroDia(c),
      ultimoDia: ultimoDia(c),
      contrato: e.contrato,
    };
    const previa: PreviaMensalidades['cobrancas'] = [];
    const ignorados: PreviaMensalidades['ignorados'] = [];
    let quantidade = 0;
    let valorTotal = 0;
    let jaGeradas = 0;
    let geradas = 0;
    let apos: number | null = null;
    for (;;) {
      let tentativa = 0;
      let pagina: Awaited<ReturnType<PortaCobrancaOperadora['baseMensalidades']>>;
      let montadas: {
        cobranca: EntradaCobranca;
        pagadorNome: string;
        numero: string;
        nomes: Map<number, string>;
      }[];
      for (;;) {
        pagina = await this.porta.baseMensalidades(s.porta, { ...filtro, apos });
        montadas = [];
        const ignoradosPagina: typeof ignorados = [];
        let jaPagina = 0;
        for (const k of pagina.itens) {
          const m = mensalidadeDoContrato({
            contrato: k,
            beneficiarios: k.beneficiarios,
            reajustes: k.reajustes,
            competencia: c,
            jaGerada: k.jaGerada,
          });
          if (!m.gerar) {
            if (m.motivo === 'ja-gerada') jaPagina++;
            else ignoradosPagina.push({ contrato: k.id, contratoNumero: k.numero, motivo: m.motivo });
            continue;
          }
          const nomes = new Map(k.beneficiarios.map((b) => [b.id, b.nome]));
          const titular = m.beneficiario !== null ? nomes.get(m.beneficiario) : undefined;
          montadas.push({
            numero: k.numero,
            pagadorNome: titular ?? k.contratanteNome,
            nomes,
            cobranca: {
              operadora,
              contrato: k.id,
              beneficiario: m.beneficiario,
              tipo: 1,
              competencia: c,
              descricao: `Mensalidade ${mmaaaa(c)}`,
              valor: m.valor,
              vencimento: m.vencimento,
              acordoOrigem: null,
              parcela: null,
              parcelas: null,
              reajustes: k.reajustes,
              itens: m.itens.map((i) => ({
                beneficiario: i.beneficiario,
                descricao: `Faixa ${FAIXAS_ETARIAS_ANS[i.faixa]?.rotulo ?? ''}`.trim(),
                idade: i.idade,
                faixa: i.faixa,
                valorBase: i.valorTabela,
                valor: i.valor,
              })),
            },
          });
        }
        if (!confirmar || montadas.length === 0) {
          ignorados.push(...ignoradosPagina);
          jaGeradas += jaPagina;
          break;
        }
        try {
          const lote = montadas;
          await this.gravar(
            s,
            E.operadoraCobrancaGerada.codigo,
            'operadora.gerarMensalidades',
            T.cobranca,
            (r: { id: number; n: number }) => `competencia:${c};mensalidades:${r.n}`,
            async (g) => {
              const ids: number[] = [];
              for (const x of lote) ids.push((await g.incluir({ ...x.cobranca, por: s.login })).id);
              return { id: ids[0] ?? 0, n: ids.length };
            },
          );
          ignorados.push(...ignoradosPagina);
          jaGeradas += jaPagina;
          break;
        } catch (x) {
          if (
            tentativa === 0 &&
            x instanceof ErroProblema &&
            ['mensalidade-ja-gerada', 'reajuste-mudou'].includes(
              (x.extras as { codigo?: string }).codigo ?? '',
            )
          ) {
            tentativa++;
            continue;
          }
          throw x;
        }
      }
      for (const x of montadas) {
        quantidade++;
        valorTotal += x.cobranca.valor;
        if (confirmar) geradas++;
        if (previa.length < PREVIA_MAXIMA)
          previa.push({
            contrato: x.cobranca.contrato,
            contratoNumero: x.numero,
            pagadorNome: x.pagadorNome,
            vencimento: x.cobranca.vencimento,
            valor: x.cobranca.valor,
            itens: x.cobranca.itens.map((i) => ({
              beneficiario: i.beneficiario ?? 0,
              nome: x.nomes.get(i.beneficiario ?? 0) ?? '',
              faixa: i.faixa ?? 0,
              idade: i.idade ?? 0,
              valorTabela: i.valorBase ?? 0,
              valor: i.valor,
            })),
          });
      }
      if (pagina.proxima === null) break;
      apos = pagina.proxima;
    }
    valorTotal = Math.round(valorTotal * 100) / 100;
    if (!confirmar)
      return { competencia: c, cobrancas: previa, quantidade, valorTotal, ignorados, jaGeradas };
    return {
      ok: true,
      competencia: c,
      geradas,
      valorTotal,
      jaGeradas,
      ignorados: ignorados.length,
      mensagem:
        geradas === 0
          ? `Nenhuma mensalidade nova em ${mmaaaa(c)}.`
          : `${geradas} mensalidade(s) de ${mmaaaa(c)} gerada(s).`,
    };
  }

  // ── Lançamentos avulsos ─────────────────────────────────────────────────────────────────────────────────────

  async coparticipacao(s: SessaoCadastro, e: LancarCoparticipacaoEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const b = await this.porta.beneficiario(s.porta, e.beneficiario);
    if (!b) throw naoEncontrada('Beneficiário');
    const k = await this.contratoDe(s, b.contrato);
    const lancamento = problemasDoLancamento({ competencia: e.competencia, vencimento: e.vencimento });
    recusar(lancamento, 'Coparticipação não lançada');
    const pagador = k.tipo === 1 ? (b.titular ?? b.id) : null;
    // A regra vigente na competência do evento (a do contrato ou a do plano) com os tetos por evento, mês e ano: lida,
    // calculada e gravada na mesma transação, com o beneficiário travado (08-SGO L98). Dois lançamentos simultâneos
    // não passam juntos do teto: o segundo espera o primeiro e calcula com o que ele gravou.
    let calculo: CalculoCoparticipacao | null = null;
    const r = await this.gravar(
      s,
      E.operadoraCobrancaGerada.codigo,
      'operadora.lancarCoparticipacao',
      T.cobranca,
      () => `contrato:${k.id};competencia:${e.competencia};tipo:2`,
      async (g) => {
        const { regra, acumulado } = await g.coparticipacaoTravada({
          contrato: k.id,
          beneficiario: b.id,
          competencia: e.competencia,
        });
        const x = calcularCoparticipacao(regra, e.valorEvento, acumulado);
        const [problema] = problemasDaCoparticipacao(x);
        if (problema) throw recusa(problema, MENSAGENS_COBRANCA[problema] ?? problema);
        calculo = x;
        return g.incluir({
          operadora: k.operadora,
          contrato: k.id,
          beneficiario: pagador,
          tipo: 2,
          competencia: e.competencia,
          descricao: `Coparticipação: ${e.descricao}`.slice(0, 200),
          valor: x.valor!,
          vencimento: e.vencimento,
          acordoOrigem: null,
          parcela: null,
          parcelas: null,
          itens: [
            {
              beneficiario: b.id,
              descricao: e.descricao,
              idade: null,
              faixa: null,
              valorBase: e.valorEvento,
              valor: x.valor!,
            },
          ],
          por: s.login,
        });
      },
    );
    const feito = calculo as CalculoCoparticipacao | null;
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: 'Coparticipação lançada.',
      avisos: feito?.limitadoPor
        ? [
            `${MENSAGENS_COBRANCA[`coparticipacao-limitada-${feito.limitadoPor}`]} Calculado R$ ${feito.calculado!.toFixed(2)}, lançado R$ ${feito.valor!.toFixed(2)}.`,
          ]
        : [],
    };
  }

  async avulsa(s: SessaoCadastro, e: LancarAvulsaEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const k = await this.contratoDe(s, e.contrato);
    if (e.beneficiario !== null) {
      const b = await this.porta.beneficiario(s.porta, e.beneficiario);
      if (!b) throw naoEncontrada('Beneficiário');
      if (b.contrato !== k.id) recusar(['beneficiario-de-outro-contrato'], 'Cobrança não lançada');
    }
    recusar(
      problemasDoLancamento({ competencia: e.competencia, vencimento: e.vencimento }),
      'Cobrança não lançada',
    );
    const pagador = await this.pagador(s, k);
    const r = await this.gravar(
      s,
      E.operadoraCobrancaGerada.codigo,
      'operadora.lancarCobrancaAvulsa',
      T.cobranca,
      () => `contrato:${k.id};competencia:${e.competencia};tipo:3`,
      (g) =>
        g.incluir({
          operadora: k.operadora,
          contrato: k.id,
          beneficiario: pagador,
          tipo: 3,
          competencia: e.competencia,
          descricao: e.descricao,
          valor: e.valor,
          vencimento: e.vencimento,
          acordoOrigem: null,
          parcela: null,
          parcelas: null,
          itens: [
            {
              beneficiario: e.beneficiario,
              descricao: e.descricao,
              idade: null,
              faixa: null,
              valorBase: null,
              valor: e.valor,
            },
          ],
          por: s.login,
        }),
    );
    return { ok: true, id: r.id, versao: r.versao, mensagem: 'Cobrança avulsa lançada.', avisos: [] };
  }

  // ── Baixa, cancelamento e estorno ───────────────────────────────────────────────────────────────────────────

  async baixar(s: SessaoCadastro, id: number, e: BaixarCobrancaEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const x = await this.cobrancaDe(s, id);
    const hoje = await this.porta.hoje(s.porta);
    const conf = problemasDaBaixaCobranca({
      situacao: x.situacao,
      valor: x.valor,
      vencimento: x.vencimento,
      emitidaEm: x.emitidaEm,
      hoje,
      pagoEm: e.pagoEm,
      valorPago: e.valorPago,
      dispensarEncargos: e.dispensarEncargos,
      motivoDispensa: e.motivoDispensa ?? null,
    });
    recusar(
      conf.problemas,
      'Baixa não registrada',
      conf.problemas.includes('valor-divergente')
        ? {
            devido: {
              data: e.pagoEm,
              valor: x.valor,
              multa: conf.encargos.multa,
              juros: conf.encargos.juros,
              total: conf.devido,
              dispensado: e.dispensarEncargos,
            },
            detalhe: textoDoDevido(e.pagoEm, x.valor, conf.encargos, conf.devido, e.dispensarEncargos),
          }
        : undefined,
    );
    const dispensado = e.dispensarEncargos && encargosNaData(x.valor, x.vencimento, e.pagoEm).total > 0;
    const r = await this.gravar(
      s,
      E.operadoraCobrancaBaixada.codigo,
      'operadora.baixarCobranca',
      T.cobranca,
      () => `pago:${e.pagoEm};valor:${conf.devido.toFixed(2)}${dispensado ? ';dispensa' : ''}`,
      (g) =>
        g.baixar({
          id,
          versao: e.versao,
          pagoEm: e.pagoEm,
          valorPago: e.valorPago,
          multa: conf.encargos.multa,
          juros: conf.encargos.juros,
          dispensaMotivo: dispensado ? (e.motivoDispensa ?? null) : null,
          por: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: `Pagamento de R$ ${conf.devido.toFixed(2).replace('.', ',')} registrado.`,
      avisos: dispensado ? ['Multa e juros dispensados com o motivo.'] : [],
    };
  }

  async cancelar(s: SessaoCadastro, id: number, e: MotivoCobrancaEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const x = await this.cobrancaDe(s, id);
    recusar(x.situacao === 'aberta' ? [] : ['nao-aberta'], 'Cobrança não cancelada');
    const r = await this.gravar(
      s,
      E.operadoraCobrancaCancelada.codigo,
      'operadora.cancelarCobranca',
      T.cobranca,
      () => `contrato:${x.contrato};competencia:${x.competencia};tipo:${x.tipo}`,
      (g) => g.cancelar({ id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { ok: true, id: r.id, versao: r.versao, mensagem: 'Cobrança cancelada.', avisos: [] };
  }

  async estornar(s: SessaoCadastro, id: number, e: MotivoCobrancaEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const x = await this.cobrancaDe(s, id);
    recusar(x.situacao === 'paga' ? [] : ['nao-paga'], 'Estorno não registrado');
    const r = await this.gravar(
      s,
      E.operadoraCobrancaEstornada.codigo,
      'operadora.estornarBaixaCobranca',
      T.cobranca,
      () => `pago:${x.pagoEm ?? ''};valor:${(x.valorPago ?? 0).toFixed(2)}`,
      (g) => g.estornar({ id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: 'Baixa estornada: a cobrança voltou a ficar em aberto.',
      avisos: [],
    };
  }

  // ── Acordo ──────────────────────────────────────────────────────────────────────────────────────────────────

  private async montarAcordo(s: SessaoCadastro, e: AcordoEntrada) {
    await this.exigirFatia(s);
    const k = await this.contratoDe(s, e.contrato);
    const hoje = await this.porta.hoje(s.porta);
    const cobrancas: DadosCobranca[] = [];
    for (const c of e.cobrancas) cobrancas.push(await this.cobrancaDe(s, c.id));
    const { problemas, acordo } = calcularAcordo({
      contrato: k.id,
      cobrancas,
      hoje,
      parcelas: e.parcelas,
      primeiroVencimento: e.primeiroVencimento,
      dispensarEncargos: e.dispensarEncargos,
      motivoDispensa: e.motivoDispensa ?? null,
    });
    recusar(problemas, 'Acordo não feito');
    return { k, hoje, acordo };
  }

  async previaAcordo(s: SessaoCadastro, e: AcordoEntrada): Promise<PreviaAcordo> {
    const { k, hoje, acordo } = await this.montarAcordo(s, e);
    return {
      contrato: k.id,
      data: hoje,
      principal: acordo.principal,
      encargos: acordo.encargos,
      total: acordo.total,
      cobrancas: acordo.cobrancas.map((c) => ({ ...c })),
      parcelas: acordo.parcelas.map((p) => ({ ...p })),
    };
  }

  async acordo(s: SessaoCadastro, e: AcordoEntrada): Promise<ResultadoAcordo> {
    const { k, hoje, acordo } = await this.montarAcordo(s, e);
    const pagador = await this.pagador(s, k);
    const r = await this.gravar(
      s,
      E.operadoraCobrancaAcordo.codigo,
      'operadora.fazerAcordo',
      T.cobranca,
      (x: { id: number; acordo: number; ids: number[] }) =>
        `acordo:${x.acordo};renegociadas:${e.cobrancas.length};parcelas:${x.ids.length}`,
      async (g) => {
        const { acordo: numero } = await g.registrarAcordo({
          contrato: k.id,
          data: hoje,
          principal: acordo.principal,
          encargos: acordo.encargos,
          total: acordo.total,
          cobrancas: e.cobrancas.map((c) => {
            const x = acordo.cobrancas.find((a) => a.id === c.id);
            return {
              id: c.id,
              versao: c.versao,
              valor: x?.valor ?? 0,
              multa: x?.encargos.multa ?? 0,
              juros: x?.encargos.juros ?? 0,
            };
          }),
          parcelas: acordo.parcelas.map((p) => ({ ...p })),
          dispensaMotivo: e.dispensarEncargos ? (e.motivoDispensa ?? null) : null,
          por: s.login,
        });
        const ids: number[] = [];
        for (const p of acordo.parcelas) {
          const descricao = `Parcela ${p.numero}/${acordo.parcelas.length} do acordo ${numero}`;
          const x = await g.incluir({
            operadora: k.operadora,
            contrato: k.id,
            beneficiario: pagador,
            tipo: 4,
            competencia: competenciaDe(p.vencimento),
            descricao,
            valor: p.valor,
            vencimento: p.vencimento,
            acordoOrigem: numero,
            parcela: p.numero,
            parcelas: acordo.parcelas.length,
            itens: [
              { beneficiario: null, descricao, idade: null, faixa: null, valorBase: null, valor: p.valor },
            ],
            por: s.login,
          });
          ids.push(x.id);
        }
        return { id: ids[0] ?? 0, acordo: numero, ids };
      },
    );
    return {
      ok: true,
      acordo: r.acordo,
      parcelas: r.ids,
      total: acordo.total,
      mensagem: `Acordo ${r.acordo} feito em ${r.ids.length} parcela(s).`,
    };
  }

  // ── Inadimplência ───────────────────────────────────────────────────────────────────────────────────────────

  async inadimplencia(
    s: SessaoCadastro,
    f: { operadora?: number | undefined; apos?: number | undefined },
  ): Promise<InadimplenciaOperadora> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDe(s, f.operadora);
    if (operadora === null) return { itens: [], proxima: null };
    const hoje = await this.porta.hoje(s.porta);
    const pagina = await this.porta.inadimplentes(s.porta, {
      operadora,
      hoje,
      ...(f.apos ? { apos: f.apos } : {}),
    });
    const historico = await this.porta.doContrato(
      s.porta,
      pagina.itens.map((i) => i.contrato),
      // Dois anos de vencimentos: a vencida antes da janela de 12 meses e paga dentro dela conta os dias na janela.
      somarDias(hoje, -731),
    );
    const itens: Inadimplente[] = [];
    for (const i of pagina.itens) {
      const doContrato = historico.filter((x) => x.contrato === i.contrato);
      const um = doContrato[0];
      if (!um) continue;
      const r = situacaoInadimplencia({ cobrancas: doContrato, hoje, tipoContratacao: um.tipoContratacao });
      itens.push({
        contrato: i.contrato,
        contratoNumero: um.contratoNumero,
        tipoContratacao: um.tipoContratacao,
        pagadorNome: um.pagadorNome,
        pagadorDocumento: mascararDocumentoContratante(um.pagadorDocumento),
        vencidas: i.vencidas,
        valorVencido: i.valorVencido,
        vencimentoMaisAntigo: i.maisAntigo,
        diasAtrasoAtual: r.diasAtrasoAtual,
        diasAcumulados12m: r.diasAcumulados12m,
        mensalidadesEmAtraso12m: r.mensalidadesEmAtraso12m,
        situacao: r.situacao,
        notificadoEm: r.notificadoEm,
        notificacaoMeio: meio(r.notificacaoMeio),
        prazoNotificacao: r.prazoNotificacao,
        prazoPagamento: r.prazoPagamento,
      });
    }
    return { itens, proxima: pagina.proxima };
  }

  async notificar(s: SessaoCadastro, e: NotificacaoEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const k = await this.contratoDe(s, e.contrato);
    const hoje = await this.porta.hoje(s.porta);
    const abertas = (await this.porta.doContrato(s.porta, [k.id], hoje))
      .filter((x) => x.situacao === 'aberta' && x.vencimento < hoje)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    recusar(
      problemasDaNotificacao({ em: e.em, hoje, vencimentoMaisAntigo: abertas[0]?.vencimento ?? null }),
      'Notificação não registrada',
    );
    const r = await this.gravar(
      s,
      E.operadoraCobrancaNotificada.codigo,
      'operadora.notificarInadimplencia',
      T.cobranca,
      (x: { id: number; cobrancas: number }) => `contrato:${k.id};meio:${e.meio};cobrancas:${x.cobrancas}`,
      async (g) => {
        const n = await g.notificar({
          contrato: k.id,
          hoje,
          em: e.em,
          meio: e.meio,
          referencia: e.referencia,
          por: s.login,
        });
        return { id: abertas[0]?.id ?? k.id, cobrancas: n.cobrancas };
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: 0,
      mensagem: `Notificação registrada em ${r.cobrancas} cobrança(s) vencida(s).`,
      avisos: [],
    };
  }

  // ── Reajuste ────────────────────────────────────────────────────────────────────────────────────────────────

  async reajustes(
    s: SessaoCadastro,
    f: { operadora?: number | undefined; contrato?: number | undefined; apos?: number | undefined },
  ): Promise<ReajustesOperadora> {
    await this.exigirFatia(s);
    const operadora = await this.operadoraDe(s, f.operadora);
    if (operadora === null) return { itens: [], proxima: null };
    const r = await this.porta.reajustes(s.porta, {
      operadora,
      ...(f.contrato ? { contrato: f.contrato } : {}),
      ...(f.apos ? { apos: f.apos } : {}),
    });
    return { itens: r.itens.map(reajusteDto), proxima: r.proxima };
  }

  async reajustar(s: SessaoCadastro, e: ReajusteEntrada): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const k = await this.contratoDe(s, e.contrato);
    const sit = await this.porta.situacaoReajuste(s.porta, k.id, e.competencia);
    // C1-086: no individual ou familiar sem teto digitado, vale o teto da ANS cadastrado para a competência.
    const doIndice = k.tipoContratacao === 1 && e.tetoAns == null && sit.teto ? sit.teto : null;
    const tetoAns = e.tetoAns ?? doIndice?.percentual ?? null;
    const oficioAns = e.oficioAns ?? doIndice?.protocolo ?? null;
    const { problemas, avisos } = conferirReajuste({
      competencia: e.competencia,
      percentual: e.percentual,
      tetoAns,
      oficioAns,
      contrato: {
        situacao: k.situacao,
        inicio: k.inicio,
        mesReajuste: k.mesReajuste,
        tipoContratacao: k.tipoContratacao,
      },
      reajustesVigentes: sit.vigentes,
      ultimaMensalidade: sit.ultimaMensalidade,
      vidas: sit.vidas,
    });
    recusar(problemas, 'Reajuste não registrado');
    const r = await this.gravar(
      s,
      E.operadoraReajusteRegistrado.codigo,
      'operadora.reajustarContrato',
      T.reajuste,
      () => `contrato:${k.id};competencia:${e.competencia};percentual:${e.percentual}`,
      (g) =>
        g.registrarReajuste({
          operadora: k.operadora,
          contrato: k.id,
          competencia: e.competencia,
          percentual: e.percentual,
          tetoAns,
          oficioAns,
          indice: doIndice?.id ?? null,
          vidas: sit.vidas,
          motivo: e.motivo,
          por: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      versao: 0,
      mensagem: `Reajuste de ${String(e.percentual).replace('.', ',')}% registrado para ${mmaaaa(e.competencia)}.`,
      avisos: avisos.map((a) => MENSAGENS_COBRANCA[a] ?? a),
    };
  }

  async cancelarReajuste(s: SessaoCadastro, id: number, motivo: string): Promise<ResultadoCobranca> {
    await this.exigirFatia(s);
    const r0 = await this.porta.reajuste(s.porta, id);
    if (!r0) throw naoEncontrada('Reajuste');
    const sit = await this.porta.situacaoReajuste(s.porta, r0.contrato);
    recusar(
      r0.situacao !== 'vigente'
        ? ['reajuste-cancelado']
        : sit.ultimaMensalidade !== null && sit.ultimaMensalidade >= r0.competencia
          ? ['reajuste-ja-cobrado']
          : [],
      'Reajuste não cancelado',
    );
    const r = await this.gravar(
      s,
      E.operadoraReajusteCancelado.codigo,
      'operadora.cancelarReajuste',
      T.reajuste,
      () => `contrato:${r0.contrato};competencia:${r0.competencia}`,
      (g) =>
        g.cancelarReajuste({
          id,
          motivo,
          por: s.login,
          ...(r0.versao !== undefined ? { versao: r0.versao } : {}),
        }),
    );
    return { ok: true, id: r.id, versao: 0, mensagem: 'Reajuste cancelado.', avisos: [] };
  }
}

/** Por que a mensagem ao beneficiário não sai (regra 6; a decisão de @sgh/dominio-operadora). */
export const MENSAGENS_MOTIVO_MENSAGEM: Readonly<
  Record<'chave-desligada' | 'sem-base-legal' | 'fora-de-producao', string>
> = {
  'chave-desligada':
    'As mensagens ao beneficiário estão desligadas: o aviso de cobrança e a notificação saem por carta, pessoalmente ou por edital.',
  'sem-base-legal':
    'Falta a base legal das mensagens ao beneficiário aprovada pelo encarregado de dados: o aviso sai por carta, pessoalmente ou por edital.',
  'fora-de-producao': 'Fora de produção nenhuma mensagem sai ao beneficiário.',
};
