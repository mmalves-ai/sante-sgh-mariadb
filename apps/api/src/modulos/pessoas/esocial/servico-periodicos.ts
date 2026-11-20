// Periódicos do eSocial, fatia F6 (M53.7; ficha do M53, seções 1, 4, 6 a 8; regras 1, 3 e 9): o painel do período
// (fechamento da folha, S-1200 e S-1210 esperados e por situação, recibos de autônomo do repasse, situação do S-1299),
// a geração do S-1200 (remuneração, um por colaborador do período fechado), do S-1210 (pagamentos do mês), do S-1299
// (fechamento dos periódicos, só com tudo aceito) e do S-1298 (reabertura). Os eventos seguem o caminho da F5: conferidos
// no XSD, gravados (o do trabalhador cifrado), em lote ao coletor fora de `producao`, com o retorno. Só do período FECHADO
// na folha: os valores são os dos processamentos fixados. Nenhuma resposta traz CPF ou nome.
//
// D-RETIF-PER-537 (POL-5): regerar o S-1200 ou o S-1210 de quem já tem o evento aceito no período sai como retificação
// (indRetif 2 com o recibo); quem tem evento em andamento fica de fora com a pendência (descarte ou espere o retorno).
// D-TETO-PER-537 (POL-5): até 500 colaboradores por geração (o XSD custa ~0,1 s por evento): a tela gera em partes pelos
// vínculos sem evento do painel.
// D-RPA-PER-537 (POL-5): o S-1200 do autônomo do repasse (categoria 701, recibos de pagamento a autônomo) não é gerado
// nesta fatia: o painel conta os recibos e o S-1299 do período com recibo de autônomo fica pendente até ele existir,
// para o empregador nunca fechar o período sem o autônomo (regra 1).
import {
  type ContagemPeriodicoEsocial,
  type EventoEsocial,
  type GerarFechamentoEsocialEntrada,
  type GerarPagamentosEsocialEntrada,
  type GerarRemuneracaoEsocialEntrada,
  type PainelPeriodicosEsocial,
  type PendenciaEsocial,
  type PeriodoFolha,
  type ProcessoNoFechamento,
  type ResultadoGeracaoEsocial,
  type ResumoFechamentoNoPainel,
} from '@sgh/contratos';
import {
  CATEGORIA_SUGERIDA,
  contarPeriodico,
  type DemonstrativoRemuneracao,
  type EventoPeriodicoLido,
  ideDmDevDoProcesso,
  itensDaRemuneracao,
  montarS1200,
  montarS1210,
  montarS1298,
  montarS1299,
  type PagamentoTrabalhador,
  pendencia,
  pendenciasFechamentoEsocial,
  periodoDoPagamento,
  periodoDoProcesso,
  situacaoDoPeriodo,
  TIPOS_NO_S1200,
  TIPOS_NO_S1210,
  tpPgtoDoTipo,
} from '@sgh/dominio-pessoas';
import type { EventoEsocialSghLido, FechamentoFolhaLido } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { paraFechamentoApi } from '../folha/servico-fechamento.js';
import { type EventoMontado, PERMISSOES_ESOCIAL, type ServicoEsocial } from './servico-esocial.js';

const P = PERMISSOES_ESOCIAL;
const FECHAR_FOLHA = 'pessoas.folha.fechar';
const LER_FOLHA = 'pessoas.folha.ler';

/**
 * O fechamento no painel (correção da revisão do M53.7): `pessoas.esocial.ler` não dá a folha, então os totais e os
 * processamentos (com o líquido de cada um) só vão a quem tem `pessoas.folha.ler`, com a máscara de
 * `pessoas.salario.ler` da tela da folha. A tela do painel usa só o número, quem fechou e quando.
 */
function resumoNoPainel(f: FechamentoFolhaLido, s: SessaoCadastro): ResumoFechamentoNoPainel {
  const lerFolha = s.pode(LER_FOLHA);
  const api = lerFolha ? paraFechamentoApi(f, s.pode('pessoas.salario.ler')) : null;
  return {
    id: f.id,
    numero: f.numero,
    situacao: f.situacao,
    pagamento: f.pagamento,
    fechadoPor: f.fechadoPor,
    fechadoEm: f.fechadoEm,
    totais: api?.totais ?? null,
    processos: api?.processos ?? null,
  };
}
export const TETO_GERACAO_PERIODICOS = 500;
const EM_ANDAMENTO = ['gerado', 'validado', 'em-lote', 'enviado'];
const PERIODICOS: readonly EventoEsocial[] = ['S-1200', 'S-1210', 'S-1298', 'S-1299'];

const recusa = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo, ...extra });

/** A competência de referência do empregador no período (o anual: dezembro). */
const competenciaDo = (p: PeriodoFolha) => (p.apuracao === 'anual' ? `${p.periodo}-12` : p.periodo);
/** O último dia do período (a data dos dados do trabalhador no evento). */
const fimDo = (p: PeriodoFolha) => {
  const comp = competenciaDo(p);
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return `${comp}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const paraLido = (e: EventoEsocialSghLido): EventoPeriodicoLido => ({
  id: e.id,
  evento: e.evento,
  vinculo: e.vinculo,
  situacao: e.situacao,
  criadoEm: e.criadoEm,
});

interface PagamentoDoVinculo {
  readonly processo: ProcessoNoFechamento;
  readonly vinculo: number;
  readonly vrLiq: number;
}

export class ServicoPeriodicosEsocial {
  constructor(readonly esocial: ServicoEsocial) {}

  private get porta() {
    return this.esocial.porta;
  }
  private get calculo() {
    return this.esocial.calculo;
  }

  private async fechamentoVigente(s: SessaoCadastro, p: PeriodoFolha): Promise<FechamentoFolhaLido | null> {
    const xs = await this.calculo.fechamentos(s.porta, {
      empresa: p.empresa,
      apuracao: p.apuracao,
      periodo: p.periodo,
      situacao: 'fechada',
    });
    return xs[0] ?? null;
  }

  /** Os eventos periódicos da empresa no período (a data de referência é o período). */
  private async eventosDoPeriodo(s: SessaoCadastro, empresa: number, periodo: string) {
    const xs = await this.porta.eventos(s.porta, { empresa, eventos: PERIODICOS, de: periodo, ate: periodo });
    return xs.filter((x) => x.dataReferencia === periodo);
  }

  /** Os vínculos de cada processamento fixado que vai ao S-1200 (e os itens por rubrica deles). */
  private async remuneracoes(s: SessaoCadastro, f: FechamentoFolhaLido) {
    const porVinculo = new Map<number, DemonstrativoRemuneracao[]>();
    for (const p of f.processos.filter((x) => TIPOS_NO_S1200.includes(x.tipo))) {
      const itens = await this.calculo.itensRubricaDoProcesso(s.porta, p.id);
      const doVinculo = new Map<number, typeof itens>();
      for (const i of itens) doVinculo.set(i.vinculo, [...(doVinculo.get(i.vinculo) ?? []), i]);
      for (const [v, is] of doVinculo)
        porVinculo.set(v, [
          ...(porVinculo.get(v) ?? []),
          {
            ideDmDev: ideDmDevDoProcesso(p.tipo, p.id, null),
            processo: p.id,
            tipo: p.tipo,
            itens: itensDaRemuneracao(is),
          },
        ]);
    }
    return porVinculo;
  }

  /** Os pagamentos feitos no mês: os processamentos fixados (em períodos fechados) com a data de pagamento nele. */
  private async pagamentos(s: SessaoCadastro, empresa: number, mes: string) {
    const ano = Number(mes.slice(0, 4));
    const fechados = (
      await Promise.all(
        [String(ano - 1), String(ano)].map((a) =>
          this.calculo.fechamentos(s.porta, { empresa, ano: a, situacao: 'fechada' }),
        ),
      )
    ).flat();
    const processos = fechados
      .flatMap((f) => f.processos)
      .filter(
        (p) => TIPOS_NO_S1210.includes(p.tipo) && p.pagamento && periodoDoPagamento(p.pagamento) === mes,
      );
    const rescisoes = processos.some((p) => p.tipo === 'rescisao')
      ? await this.calculo.rescisoes(s.porta, { empresa })
      : [];
    const rescisaoDo = new Map(rescisoes.map((r) => [r.processo, r.id]));
    const porVinculo = new Map<number, PagamentoDoVinculo[]>();
    for (const p of processos) {
      const rs = await this.calculo.resumoVinculos(s.porta, p.id);
      for (const r of rs)
        porVinculo.set(r.vinculo, [
          ...(porVinculo.get(r.vinculo) ?? []),
          { processo: p, vinculo: r.vinculo, vrLiq: r.proventos - r.descontos },
        ]);
    }
    return { porVinculo, rescisaoDo };
  }

  private contagem(
    evento: 'S-1200' | 'S-1210',
    esperados: readonly number[],
    eventos: readonly EventoPeriodicoLido[],
  ): ContagemPeriodicoEsocial {
    return contarPeriodico(evento, esperados, eventos);
  }

  async painel(s: SessaoCadastro, p: PeriodoFolha): Promise<PainelPeriodicosEsocial> {
    const [folha, eventos, repasse] = await Promise.all([
      this.fechamentoVigente(s, p),
      this.eventosDoPeriodo(s, p.empresa, p.periodo),
      p.apuracao === 'mensal'
        ? this.porta.recibosAutonomo(s.porta, p.empresa, p.periodo)
        : Promise.resolve(0),
    ]);
    const lidos = eventos.map(paraLido);
    const esperadosR = folha ? [...(await this.remuneracoes(s, folha)).keys()] : [];
    const esperadosP =
      p.apuracao === 'mensal'
        ? [...(await this.pagamentos(s, p.empresa, p.periodo)).porVinculo.keys()]
        : null;
    const remuneracao = this.contagem('S-1200', esperadosR, lidos);
    const pagamentos = esperadosP ? this.contagem('S-1210', esperadosP, lidos) : null;
    const sit = situacaoDoPeriodo(lidos);
    const emAndamento = lidos.filter(
      (x) => (x.evento === 'S-1200' || x.evento === 'S-1210') && EM_ANDAMENTO.includes(x.situacao),
    ).length;
    const pendencias = pendenciasFechamentoEsocial({
      apuracao: p.apuracao,
      folhaFechada: folha !== null,
      remuneracao,
      pagamentos,
      emAndamento,
      repasse,
      remuneracaoAutonomo: 0,
    });
    const gerar = s.pode(P.gerar);
    const fecharFolha = s.pode(FECHAR_FOLHA);
    return {
      empresa: p.empresa,
      apuracao: p.apuracao,
      periodo: p.periodo,
      folha: folha ? resumoNoPainel(folha, s) : null,
      remuneracao,
      pagamentos,
      repasse,
      situacao: sit.situacao,
      eventoFechamento: sit.evento,
      pendencias,
      acoes: {
        gerar: gerar && folha !== null && sit.situacao === 'aberto',
        fecharEsocial: gerar && pendencias.length === 0 && sit.situacao === 'aberto',
        reabrirEsocial: gerar && sit.situacao === 'fechado',
        fecharFolha: fecharFolha && folha === null,
        reabrirFolha: fecharFolha && folha !== null && sit.situacao === 'aberto',
      },
    };
  }

  /** Recusa gerar remuneração ou pagamento com o período do eSocial fechado (ou fechando). */
  private exigirPeriodoAberto(eventos: readonly EventoEsocialSghLido[]) {
    const sit = situacaoDoPeriodo(eventos.map(paraLido)).situacao;
    if (sit !== 'aberto')
      throw recusa(
        'periodo-ja-fechado',
        'Os periódicos deste período estão fechados no eSocial: gere e envie a reabertura (S-1298) antes.',
      );
  }

  /** O evento do vínculo no período: em andamento (fica de fora) ou aceito (vira retificação). */
  private anteriorDo(eventos: readonly EventoEsocialSghLido[], evento: 'S-1200' | 'S-1210', vinculo: number) {
    const doV = eventos.filter((x) => x.evento === evento && x.vinculo === vinculo);
    const andamento = doV.find((x) => EM_ANDAMENTO.includes(x.situacao));
    const aceito = doV.find((x) => x.situacao === 'aceito' && x.recibo);
    return { andamento: andamento ?? null, aceito: aceito ?? null };
  }

  private exigirTeto(n: number) {
    if (n > TETO_GERACAO_PERIODICOS)
      throw recusa(
        'geracao-grande',
        `Gere em partes: até ${TETO_GERACAO_PERIODICOS} colaboradores por vez (escolha os vínculos).`,
      );
  }

  private semMontagem(
    evento: EventoEsocial,
    origem: string,
    referencia: number,
    vinculo: number | null,
    pendencias: readonly PendenciaEsocial[],
  ): EventoMontado {
    return {
      evento,
      operacao: null,
      origem,
      referencia,
      vinculo,
      montagem: { ok: false, pendencias },
      valido: false,
      errosXsd: [],
      eventoAnterior: null,
    };
  }

  /** S-1200 do período fechado (prévia sem XML, como os do trabalhador; ou gravado). */
  async gerarRemuneracao(
    s: SessaoCadastro,
    x: GerarRemuneracaoEsocialEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.esocial.apoio.exigirLiberacao(s);
    const folha = await this.fechamentoVigente(s, x);
    if (!folha)
      throw recusa('folha-nao-fechada', 'Feche o período na folha antes de gerar a remuneração do eSocial.');
    const eventos = await this.eventosDoPeriodo(s, x.empresa, x.periodo);
    this.exigirPeriodoAberto(eventos);
    const emp = await this.esocial.empregadorPara(s, x.empresa, competenciaDo(x));
    const porVinculo = await this.remuneracoes(s, folha);
    const alvo = [...porVinculo.keys()].filter((v) => x.vinculos.length === 0 || x.vinculos.includes(v));
    this.exigirTeto(alvo.length);
    const ctx = this.esocial.contexto(emp.leiaute);
    const montados: EventoMontado[] = [];
    for (const v of alvo.sort((a, b) => a - b)) {
      const { andamento, aceito } = this.anteriorDo(eventos, 'S-1200', v);
      if (andamento) {
        montados.push(
          this.semMontagem('S-1200', 'remuneracao', v, v, [
            pendencia(
              'evento-em-andamento',
              `O S-1200 deste colaborador (evento ${andamento.id}) está em andamento.`,
            ),
          ]),
        );
        continue;
      }
      const vin = await this.esocial.vinculoOu404(s, v);
      const t = await this.esocial.trabalhadorPara(s, vin, fimDo(x));
      const m = montarS1200(ctx, emp, t, x, porVinculo.get(v)!, aceito?.recibo ?? null);
      const conf = await this.esocial.conferir(m, 'S-1200', emp.leiaute);
      montados.push({
        evento: 'S-1200',
        operacao: null,
        origem: 'remuneracao',
        referencia: v,
        vinculo: v,
        montagem: m,
        valido: conf.valido,
        errosXsd: conf.erros,
        eventoAnterior: aceito?.id ?? null,
      });
    }
    if (!x.gravar) return this.esocial.resultado(montados, null, false);
    const ids = await this.esocial.gravarEventos(s, x.empresa, emp.leiaute, montados, true);
    return this.esocial.resultado(montados, ids, false);
  }

  /** S-1210 dos pagamentos do mês (prévia sem XML ou gravado). */
  async gerarPagamentos(
    s: SessaoCadastro,
    x: GerarPagamentosEsocialEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.esocial.apoio.exigirLiberacao(s);
    const eventos = await this.eventosDoPeriodo(s, x.empresa, x.periodo);
    this.exigirPeriodoAberto(eventos);
    const emp = await this.esocial.empregadorPara(s, x.empresa, x.periodo);
    const { porVinculo, rescisaoDo } = await this.pagamentos(s, x.empresa, x.periodo);
    if (porVinculo.size === 0)
      throw recusa(
        'sem-pagamentos',
        'Nenhum pagamento de período fechado na folha cai neste mês: feche o período antes de gerar os pagamentos.',
      );
    const alvo = [...porVinculo.keys()].filter((v) => x.vinculos.length === 0 || x.vinculos.includes(v));
    this.exigirTeto(alvo.length);
    const ctx = this.esocial.contexto(emp.leiaute);
    const montados: EventoMontado[] = [];
    for (const v of alvo.sort((a, b) => a - b)) {
      const { andamento, aceito } = this.anteriorDo(eventos, 'S-1210', v);
      if (andamento) {
        montados.push(
          this.semMontagem('S-1210', 'pagamento', v, v, [
            pendencia(
              'evento-em-andamento',
              `O S-1210 deste colaborador (evento ${andamento.id}) está em andamento.`,
            ),
          ]),
        );
        continue;
      }
      const vin = await this.esocial.vinculoOu404(s, v);
      const t = await this.esocial.trabalhadorPara(s, vin, `${x.periodo}-01`);
      const categoria = t.ficha?.categoria ?? CATEGORIA_SUGERIDA[t.tipo] ?? '101';
      const pgs: PagamentoTrabalhador[] = porVinculo.get(v)!.map((pg) => ({
        dtPgto: pg.processo.pagamento!,
        tpPgto: tpPgtoDoTipo(pg.processo.tipo, categoria),
        perRef: periodoDoProcesso(pg.processo.tipo, pg.processo.competencia).periodo,
        ideDmDev: ideDmDevDoProcesso(
          pg.processo.tipo,
          pg.processo.id,
          rescisaoDo.get(pg.processo.id) ?? null,
        ),
        vrLiq: pg.vrLiq,
      }));
      const semRescisao = porVinculo
        .get(v)!
        .some((pg) => pg.processo.tipo === 'rescisao' && !rescisaoDo.has(pg.processo.id));
      const m = semRescisao
        ? ({
            ok: false,
            pendencias: [pendencia('rescisao-ausente', 'A rescisão do pagamento não foi encontrada.')],
          } as const)
        : montarS1210(ctx, emp, t, x.periodo, pgs, aceito?.recibo ?? null);
      const conf = await this.esocial.conferir(m, 'S-1210', emp.leiaute);
      montados.push({
        evento: 'S-1210',
        operacao: null,
        origem: 'pagamento',
        referencia: v,
        vinculo: v,
        montagem: m,
        valido: conf.valido,
        errosXsd: conf.erros,
        eventoAnterior: aceito?.id ?? null,
      });
    }
    if (!x.gravar) return this.esocial.resultado(montados, null, false);
    const ids = await this.esocial.gravarEventos(s, x.empresa, emp.leiaute, montados, true);
    return this.esocial.resultado(montados, ids, false);
  }

  /** S-1299 do período: só com a folha fechada, todos os periódicos aceitos e nada em andamento. */
  async gerarFechamento(
    s: SessaoCadastro,
    x: GerarFechamentoEsocialEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.esocial.apoio.exigirLiberacao(s);
    const painel = await this.painel(s, x);
    if (painel.situacao !== 'aberto')
      throw recusa(
        'periodo-ja-fechado',
        'Os periódicos deste período já estão fechados (ou fechando) no eSocial.',
      );
    const emp = await this.esocial.empregadorPara(s, x.empresa, competenciaDo(x));
    const m = montarS1299(
      this.esocial.contexto(emp.leiaute),
      emp,
      x,
      { remuneracao: painel.remuneracao.esperados > 0, pagamentos: (painel.pagamentos?.esperados ?? 0) > 0 },
      painel.pendencias,
    );
    return this.gravarDoPeriodo(s, x, emp.leiaute, 'S-1299', 'fechamento-periodo', m);
  }

  /** S-1298 do período: reabre os periódicos fechados (o S-1299 aceito) para retificar. */
  async gerarReabertura(
    s: SessaoCadastro,
    x: GerarFechamentoEsocialEntrada,
  ): Promise<ResultadoGeracaoEsocial> {
    if (x.gravar) await this.esocial.apoio.exigirLiberacao(s);
    const eventos = await this.eventosDoPeriodo(s, x.empresa, x.periodo);
    if (situacaoDoPeriodo(eventos.map(paraLido)).situacao !== 'fechado')
      throw recusa('periodo-nao-fechado', 'Só se reabre o período com o fechamento (S-1299) aceito.');
    const emp = await this.esocial.empregadorPara(s, x.empresa, competenciaDo(x));
    const m = montarS1298(this.esocial.contexto(emp.leiaute), emp, x, []);
    return this.gravarDoPeriodo(s, x, emp.leiaute, 'S-1298', 'reabertura-periodo', m);
  }

  private async gravarDoPeriodo(
    s: SessaoCadastro,
    x: GerarFechamentoEsocialEntrada,
    leiaute: Parameters<ServicoEsocial['conferir']>[2],
    evento: 'S-1299' | 'S-1298',
    origem: string,
    m: Parameters<ServicoEsocial['conferir']>[0],
  ): Promise<ResultadoGeracaoEsocial> {
    const conf = await this.esocial.conferir(m, evento, leiaute);
    const montado: EventoMontado = {
      evento,
      operacao: null,
      origem,
      referencia: x.empresa,
      vinculo: null,
      montagem: m,
      valido: conf.valido,
      errosXsd: conf.erros,
      eventoAnterior: null,
      situacoesRepetido: EM_ANDAMENTO,
    };
    if (!x.gravar) return this.esocial.resultado([montado], null, true);
    const ids = await this.esocial.gravarEventos(s, x.empresa, leiaute, [montado], false);
    return this.esocial.resultado([montado], ids, true);
  }
}
