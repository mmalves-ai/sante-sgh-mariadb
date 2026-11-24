// Aplicação do financeiro e fiscal (M32): as gravações das telas (pelo executor, com a trilha na mesma transação, ou
// pelas gravações diretas da porta, também com a trilha junto), a alçada e a segregação conferidas no servidor (regras 4 e 5), os títulos da
// competência (regra 10), a glosa no título (regra 12), a conciliação por regra, o fluxo de caixa, a DRE em duas réguas,
// os indicadores com as parcelas, e o fiscal (NFS-e, DMED, EFD-REINF, lote contábil e remessa) gerado como arquivo,
// guardado no disco local com hash, e enviado só ao SIMULADOR fora de produção (nada sai para banco, prefeitura ou Receita).
import { createHash } from 'node:crypto';
import {
  type AprovarTituloEntrada,
  type ProrrogarVencimentoEntrada,
  type AtribuirCreditoEntrada,
  type AprovarAdiantamentoEntrada,
  type CompensarAdiantamentoEntrada,
  type ConcederAdiantamentoEntrada,
  type DevolverAdiantamentoEntrada,
  type PagarAdiantamentoEntrada,
  type BaixarTituloEntrada,
  type ConciliacaoResposta,
  type CreditoPendenteResposta,
  type ConciliarEntrada,
  type CriarTituloPagarEntrada,
  type CriarTituloReceberEntrada,
  type DetalheTituloPagarResposta,
  type DetalheTituloReceberResposta,
  type DreResposta,
  type EmitirNfseEntrada,
  EVENTOS_AUDITAVEIS,
  type ExportarLoteContabilEntrada,
  type FaixaAlcadaEntrada,
  type FluxoCaixaResposta,
  type GerarDeclaracaoEntrada,
  type GerarRemessaEntrada,
  type ImportarExtratoEntrada,
  type IndicadorResposta,
  type ItemFilaAprovacao,
  type LancarMovimentoEntrada,
  PERMISSOES_CONTRATO_CODIGOS,
  type RegistrarGlosaTituloEntrada,
  type ResultadoFinanceiro,
  type WorklistFinanceiro,
} from '@sgh/contratos';
import {
  aberturaPorGrupo,
  alcadaAplicavel,
  calcularNfse,
  conferirNfse,
  creditosSemCasamento,
  destinoNfse,
  ErroExtrato,
  gerarCnab240,
  gerarDmed,
  gerarReinf,
  indicadorContasSemTitulo,
  indicadorCredorOrfao,
  indicadorPagosSemAprovacao,
  legendaStatusPagar,
  lerExtrato,
  montarDre,
  montarFluxo,
  dePararFatos,
  montarLoteContabil,
  saldoMostrado,
  simularPrefeitura,
  simularRetorno,
  situacaoAprovacao,
  somarDias,
  sugerirConciliacao,
  type TipoCredor,
  xmlNfse,
} from '@sgh/dominio-financeiro';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ApoiosFinanceiro } from './apoios.js';
import { type ArmazemFinanceiro, ErroSobrescritaArquivo } from './armazem.js';

/** A chave ocupada é o mesmo arquivo (a chave sai do hash): segue; outra falha da guarda (disco, raiz) sobe. */
const jaGuardado = (e: unknown): void => {
  if (!(e instanceof ErroSobrescritaArquivo)) throw e;
};
import type { ContextoFinanceiro, PortaFinanceiro } from './porta.js';

const ctx = (s: SessaoCadastro): ContextoFinanceiro => s.porta;

/**
 * A sessão com a Idempotency-Key do pedido no contexto da porta: a gravação direta usa a chave do pedido, e o reenvio
 * (duplo clique, nova tentativa) devolve o resultado gravado em vez de gravar de novo.
 */
function comChave(s: SessaoCadastro): SessaoCadastro {
  const bruto = s.req?.headers?.['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !/^[A-Za-z0-9._:-]{8,80}$/.test(chave)) return s;
  const porta: ContextoFinanceiro & { chaveIdempotencia: string } = { ...s.porta, chaveIdempotencia: chave };
  return Object.assign(Object.create(Object.getPrototypeOf(s) as object) as SessaoCadastro, s, { porta });
}
const E = EVENTOS_AUDITAVEIS;
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const bytes = (t: string) => new TextEncoder().encode(t);

const MENSAGENS: Readonly<Record<string, string>> = {
  'financeiro.criarTituloPagar': 'Título a pagar gravado.',
  'financeiro.baixarTitulo': 'Título baixado.',
  'financeiro.criarTituloReceber': 'Título a receber criado e ligado à conta.',
  'financeiro.lancarMovimento': 'Movimento lançado.',
};

export const resultadoFin = (
  mensagem: string,
  repetida: boolean,
  ids: Record<string, unknown>,
  avisos: string[] = [],
): ResultadoFinanceiro => ({
  mensagem,
  repetida,
  ids: Object.fromEntries(
    Object.entries(ids).filter(
      (e): e is [string, number | string] => typeof e[1] === 'number' || typeof e[1] === 'string',
    ),
  ),
  avisos,
});

const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);

export class ServicoFinanceiro {
  constructor(
    private readonly porta: PortaFinanceiro,
    readonly apoios: ApoiosFinanceiro,
    private readonly ambiente: string,
    private readonly armazem: ArmazemFinanceiro,
    /** A permissão efetiva do usuário da sessão (o aprovador precisa da permissão da faixa). */
    private readonly podeSessao: (s: SessaoCadastro, permissao: string) => boolean = (s, p) => s.pode(p),
  ) {}

  private async executar(s: SessaoCadastro, op: string, entrada: unknown): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.daOperacao(op).executar(s, op, entrada, MENSAGENS[op] ?? 'Gravado.');
    return resultadoFin(r.mensagem, r.repetida, r.resultado);
  }

  // ── Contas a pagar ────────────────────────────────────────────────────────────────────────────────────────────

  async criarTituloPagar(s: SessaoCadastro, e: CriarTituloPagarEntrada): Promise<ResultadoFinanceiro> {
    // M55 (etapa 3): o título ligado a contrato só com a permissão de ligar ao contrato (a mesma da tela de contratos)
    // e com os contratos ligados no estabelecimento (POL-3).
    if (e.acao === 'incluir' && e.contrato) {
      await this.apoios.apoios.contratos.exigirPermissao(s, PERMISSOES_CONTRATO_CODIGOS.editar);
      await this.apoios.apoios.contratos.exigirLiberacao(s);
    }
    const r = await this.executar(s, 'financeiro.criarTituloPagar', e);
    return e.acao === 'excluir'
      ? { ...r, mensagem: 'Título em aberto excluído (a classificação e o cabeçalho também).' }
      : {
          ...r,
          mensagem: `Título ${String(r.ids['documento'] ?? '')} lançado em ${String(r.ids['parcelas'] ?? 1)} parcela(s); aguarda a aprovação na alçada.`,
        };
  }

  async detalheTituloPagar(s: SessaoCadastro, id: number): Promise<DetalheTituloPagarResposta> {
    const hoje = await this.porta.hoje(ctx(s));
    const t = await this.porta.tituloPagar(ctx(s), id, hoje);
    if (!t) throw naoEncontrado('Título');
    const faixas = await this.porta.faixas(ctx(s));
    const faixa = alcadaAplicavel(
      faixas,
      {
        empresa: 1,
        centroCusto: t.rateio[0]?.centroCusto ?? null,
        tipo: t.tipo as TipoCredor,
        valor: t.valorDocumento,
      },
      hoje,
    );
    const ap = (await this.porta.aprovacoesDosTitulos(ctx(s), [id])).get(id) ?? [];
    const sit = situacaoAprovacao(
      faixa,
      ap.map((a) => ({ aprovador: a.aprovador, ordem: 1, faixa: a.faixa, em: '' })),
    );
    return {
      ...t,
      alcada: {
        faixa: faixa?.id ?? null,
        exigidas: sit.exigidas,
        feitas: sit.feitas,
        aprovado: sit.aprovado,
      },
      legendaStatus: legendaStatusPagar(t.status),
    };
  }

  async filaAprovacao(s: SessaoCadastro, dias: number): Promise<ItemFilaAprovacao[]> {
    const hoje = await this.porta.hoje(ctx(s));
    const lista = await this.porta.filaAprovacao(ctx(s), hoje, somarDias(hoje, dias));
    const faixas = await this.porta.faixas(ctx(s));
    const ap = await this.porta.aprovacoesDosTitulos(
      ctx(s),
      lista.map((t) => t.id),
    );
    return lista.map((t) => {
      const faixa = alcadaAplicavel(
        faixas,
        { empresa: 1, centroCusto: null, tipo: t.tipo as TipoCredor, valor: t.valorDocumento },
        hoje,
      );
      const sit = situacaoAprovacao(
        faixa,
        (ap.get(t.id) ?? []).map((a) => ({
          aprovador: a.aprovador,
          ordem: 1 as const,
          faixa: a.faixa,
          em: '',
        })),
      );
      return {
        ...t,
        faixa: faixa?.id ?? null,
        exigidas: sit.exigidas,
        feitas: sit.feitas,
        permissaoDaFaixa: faixa?.permissao ?? null,
      };
    });
  }

  async aprovar(s: SessaoCadastro, e: AprovarTituloEntrada): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroTituloAprovado.codigo,
      'financeiro.contasPagar',
      () => ({ tabela: 'parcela_pagar', id: String(e.titulo) }),
      (g) =>
        g.aprovarTitulo({
          titulo: e.titulo,
          observacao: e.observacao,
          usuario: s.login,
          temPermissao: (p) => this.podeSessao(s, p),
        }),
    );
    return resultadoFin(
      r.aprovado
        ? 'Título aprovado na alçada: pode ser pago (por outra pessoa).'
        : `Primeira aprovação registrada: falta ${r.faltam} aprovação(ões) de outra pessoa.`,
      false,
      { aprovacao: r.id, ordem: r.ordem },
    );
  }

  /** F3.8 (07-FIN linha 63): prorroga o vencimento da parcela a pagar (motivo da lista; o original fica). */
  async prorrogarVencimento(s: SessaoCadastro, e: ProrrogarVencimentoEntrada): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroVencimentoProrrogado.codigo,
      'financeiro.contasPagar',
      () => ({ tabela: 'parcela_pagar', id: String(e.parcela) }),
      (g) =>
        g.prorrogarVencimento({
          ...e,
          usuario: s.login,
          podeAprovar: s.pode('financeiro.tituloPagar.aprovar'),
        }),
    );
    return resultadoFin(
      `Vencimento prorrogado de ${r.vencimentoAnterior} para ${r.vencimento} (o original, ${r.vencimentoOriginal}, fica no título).`,
      false,
      { prorrogacao: r.id },
    );
  }

  async salvarFaixa(s: SessaoCadastro, e: FaixaAlcadaEntrada): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAlcadaEditada.codigo,
      'financeiro.contasPagar',
      (x: { id: number }) => ({ tabela: 'fluxo_aprovacao', id: String(x.id) }),
      (g) => g.salvarFaixa({ ...e, usuario: s.login }),
    );
    return resultadoFin('Faixa de alçada gravada.', false, { faixa: r.id });
  }

  async baixar(s: SessaoCadastro, e: BaixarTituloEntrada): Promise<ResultadoFinanceiro> {
    if (e.cenario === 'receber') {
      if (!s.pode('financeiro.tituloReceber.baixarManual'))
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem permissão',
          'A baixa manual pede a permissão própria do contas a receber.',
          {
            codigo: 'sem-permissao-baixa-manual',
          },
        );
      await this.apoios.apoios.contasReceber.exigirLiberacao(s);
    }
    const r = await this.executar(s, 'financeiro.baixarTitulo', e);
    const b = Number(r.ids['bordero'] ?? 0);
    return {
      ...r,
      mensagem:
        e.cenario === 'receber'
          ? 'Título a receber baixado (baixa manual, com o motivo).'
          : b > 0
            ? `Borderô ${b} pago com ${String(r.ids['titulos'] ?? '')} título(s).`
            : `${String(r.ids['titulos'] ?? '')} título(s) pago(s) sem borderô.`,
    };
  }

  async gerarRemessa(s: SessaoCadastro, e: GerarRemessaEntrada): Promise<ResultadoFinanceiro> {
    const contas = await this.porta.contas(ctx(s), s.login);
    const conta = contas.find((c) => c.id === e.conta);
    if (!conta)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo',
        'A conta bancária não está no seu escopo de contas.',
      );
    const hoje = await this.porta.hoje(ctx(s));
    const titulos = [];
    for (const id of e.titulos) {
      const t = await this.porta.tituloPagar(ctx(s), id, hoje);
      if (!t) throw naoEncontrado(`Título ${id}`);
      if (t.dataPagamento)
        throw new ErroProblema('recusa-de-negocio', 409, 'Título já pago', `O título ${id} já foi pago.`);
      titulos.push({
        titulo: id,
        valor: t.valor,
        vencimento: t.vencimento ?? hoje,
        favorecido: t.credorNome,
      });
    }
    const arquivo = gerarCnab240(
      conta.banco,
      { agencia: conta.agencia, numero: conta.codigo },
      titulos.length,
      titulos,
    );
    const hash = sha256(arquivo.conteudo);
    const chave = `remessa/${conta.id}/${hoje}-${hash.slice(0, 16)}.rem`;
    const conteudoRemessa = bytes(arquivo.conteudo);
    await this.armazem.guardar(chave, conteudoRemessa, 'text/plain');
    // Fora de produção, nada sai para o banco: o simulador devolve o retorno (ocorrência 00 = crédito efetuado).
    const retorno = this.ambiente === 'producao' ? null : simularRetorno(titulos);
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroRemessaGerada.codigo,
      'financeiro.contasPagar',
      (x: { id: number }) => ({ tabela: 'remessa_bancaria', id: String(x.id) }),
      (g) =>
        g.registrarRemessa({
          usuario: s.login,
          conta: conta.id,
          leiaute: e.leiaute,
          titulos: titulos.length,
          valorTotal: arquivo.total,
          hashArquivo: hash,
          // As parcelas enviadas ficam ligadas à remessa até o retorno (a prorrogação é recusada enquanto pendentes).
          parcelas: titulos.map((t) => ({ parcela: t.titulo, valor: t.valor, vencimento: t.vencimento })),
          arquivo: { chave, tamanhoBytes: conteudoRemessa.length, tipoMime: 'text/plain' },
          destino: this.ambiente === 'producao' ? 'banco' : 'simulador',
          situacao: retorno ? 'retornada' : 'gerada',
          hashRetorno: retorno ? sha256(JSON.stringify(retorno)) : null,
          ocorrencias: retorno ? retorno.map((o) => `${o.titulo}:${o.ocorrencia}`).join(',') : null,
        }),
    );
    return resultadoFin(
      retorno
        ? `Remessa ${r.sequencial} gerada (${titulos.length} título(s)) e respondida pelo simulador do banco: nada saiu do estabelecimento.`
        : `Remessa ${r.sequencial} gerada.`,
      false,
      { remessa: r.id, sequencial: r.sequencial },
    );
  }

  // ── Contas a receber ──────────────────────────────────────────────────────────────────────────────────────────

  async criarTituloReceber(s: SessaoCadastro, e: CriarTituloReceberEntrada): Promise<ResultadoFinanceiro> {
    return this.executar(s, 'financeiro.criarTituloReceber', e);
  }

  /** Regra 10: toda conta apresentada da competência ganha título (um por convênio e tipo; o particular, um por conta). */
  async titulosDaCompetencia(
    s: SessaoCadastro,
    d: { convenio: number; ano: number; mes: number; vencimento: string; documento: number },
  ): Promise<ResultadoFinanceiro> {
    const contas = await this.porta.contasSemTitulo(ctx(s), { convenio: d.convenio, ano: d.ano, mes: d.mes });
    if (contas.length === 0)
      return resultadoFin('A competência não tem conta apresentada sem título: nada a gerar.', false, {
        titulos: 0,
      });
    const ids: number[] = [];
    for (const entrada of entradasDaCompetencia(contas, d)) {
      const r = await this.executar(s, 'financeiro.criarTituloReceber', entrada);
      ids.push(Number(r.ids['titulo'] ?? 0));
    }
    return resultadoFin(
      `${ids.length} título(s) a receber criado(s) para ${contas.length} conta(s) da competência.`,
      false,
      {
        titulos: ids.length,
        contas: contas.length,
        ids: ids.join(','),
      },
    );
  }

  async detalheTituloReceber(s: SessaoCadastro, id: number): Promise<DetalheTituloReceberResposta> {
    const hoje = await this.porta.hoje(ctx(s));
    const t = await this.porta.tituloReceber(ctx(s), id, hoje);
    if (!t) throw naoEncontrado('Título');
    const { recursoDeferido, ...detalhe } = t;
    // O recurso deferido vem somado da porta (banco); sem ele, da lista das glosas (memória).
    const deferido =
      recursoDeferido ??
      t.glosas.filter((g) => g.situacao === 'recurso-deferido').reduce((x, g) => x + g.valor, 0);
    const sm = saldoMostrado({
      valorTitulo: t.valor,
      recebido: t.recebido,
      glosaAceita: t.glosaAceita,
      recursoDeferido: deferido,
    });
    return { ...detalhe, saldo: sm.saldo, recebivelRecurso: sm.recebivelRecurso };
  }

  async registrarGlosa(s: SessaoCadastro, e: RegistrarGlosaTituloEntrada): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasReceber.sgh(
      comChave(s),
      E.financeiroGlosaTituloRegistrada.codigo,
      'financeiro.contasReceber',
      () => ({ tabela: 'titulo_receber', id: String(e.tituloReceber) }),
      (g) => g.registrarGlosaTitulo({ ...e, usuario: s.login, origem: 'tela' }),
    );
    return resultadoFin(
      e.situacao === 'aceita'
        ? 'Glosa aceita registrada no título: o saldo mostrado diminuiu.'
        : 'Desfecho do recurso registrado no título.',
      r.repetida,
      { glosa: r.id },
    );
  }

  // ── Tesouraria ────────────────────────────────────────────────────────────────────────────────────────────────

  async lancarMovimento(s: SessaoCadastro, e: LancarMovimentoEntrada): Promise<ResultadoFinanceiro> {
    return this.executar(s, 'financeiro.lancarMovimento', e);
  }

  async importarExtrato(s: SessaoCadastro, e: ImportarExtratoEntrada): Promise<ResultadoFinanceiro> {
    const contas = await this.porta.contas(ctx(s), s.login);
    if (!contas.some((c) => c.id === e.conta))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo',
        'A conta bancária não está no seu escopo de contas.',
      );
    let linhas;
    try {
      linhas = lerExtrato(e.origem, e.conteudo);
    } catch (x) {
      if (x instanceof ErroExtrato)
        throw new ErroProblema('entrada-invalida', 400, 'Extrato inválido', x.message);
      throw x;
    }
    const hash = sha256(e.conteudo);
    const chave = `extrato/${e.conta}/${hash}.${e.origem}`;
    const conteudoExtrato = bytes(e.conteudo);
    // O mesmo arquivo já guardado (imutável): a importação é idempotente pelo hash. Outra falha da guarda sobe.
    await this.armazem.guardar(chave, conteudoExtrato, 'text/plain').catch(jaGuardado);
    const r = await this.apoios.apoios.tesouraria.sgh(
      comChave(s),
      E.financeiroExtratoImportado.codigo,
      'financeiro.tesouraria',
      (x: { id: number }) => ({ tabela: 'extrato_bancario', id: String(x.id) }),
      (g) =>
        g.importarExtrato({
          usuario: s.login,
          conta: e.conta,
          origem: e.origem,
          hashArquivo: hash,
          arquivo: { chave, tamanhoBytes: conteudoExtrato.length, tipoMime: 'text/plain' },
          linhas,
        }),
    );
    return resultadoFin(
      r.repetido
        ? 'O mesmo extrato já tinha sido importado: nada mudou.'
        : `Extrato importado: ${r.linhas} linha(s).`,
      r.repetido,
      { extrato: r.id, linhas: r.linhas },
    );
  }

  async conciliacao(s: SessaoCadastro, conta: number): Promise<ConciliacaoResposta> {
    const hoje = await this.porta.hoje(ctx(s));
    const linhas = await this.porta.linhasExtrato(ctx(s), conta, null);
    const pendentes = linhas.filter((l) => l.situacao === 'pendente');
    const datas = pendentes.map((l) => l.data).sort();
    const de = somarDias(datas[0] ?? hoje, -5);
    const ate = somarDias(datas[datas.length - 1] ?? hoje, 5);
    const movimentos = await this.porta.movimento(ctx(s), conta, de, ate);
    const pagos = (
      await this.porta.titulosPagar(ctx(s), {
        situacao: 'pago',
        vencimentoDe: null,
        vencimentoAte: null,
        credor: null,
        tipo: null,
        pagina: 0,
        hoje,
      })
    ).itens;
    const receber = (
      await this.porta.titulosReceber(ctx(s), {
        devedor: null,
        convenio: null,
        aberto: null,
        vencimentoDe: null,
        vencimentoAte: null,
        pagina: 0,
        hoje,
      })
    ).itens;
    const candidatos = [
      ...movimentos.map((m) => ({
        tipo: 'movimento' as const,
        id: m.id,
        data: m.data ?? hoje,
        valor: (m.contaCredito === conta ? 1 : -1) * m.valor,
        documento: String(m.documento),
      })),
      ...pagos
        .filter((t) => t.dataPagamento)
        .map((t) => ({
          tipo: 'titulo-pagar' as const,
          id: t.id,
          data: t.dataPagamento ?? hoje,
          valor: -t.pago,
          documento: String(t.documento),
        })),
      ...receber.map((t) => ({
        tipo: 'titulo-receber' as const,
        id: t.id,
        data: t.dataRecebimento ?? t.vencimento ?? hoje,
        valor: t.dataRecebimento ? t.recebido : t.valor,
        documento: String(t.documento),
      })),
    ];
    const sugestoes = sugerirConciliacao(pendentes, candidatos);
    return {
      conta,
      linhas,
      sugestoes: sugestoes.map((x) => ({
        linha: x.linha,
        tipo: x.candidato.tipo,
        id: x.candidato.id,
        data: x.candidato.data,
        valor: x.candidato.valor,
        regra: x.regra,
      })),
      creditosSemCasamento: creditosSemCasamento(pendentes, sugestoes).map((l) => l.id),
    };
  }

  /** Os ids das contas do escopo do usuário (permissao_conta_bancaria; regra 15). */
  private async idsDoEscopo(s: SessaoCadastro): Promise<number[]> {
    return (await this.porta.contas(ctx(s), s.login)).map((c) => c.id);
  }

  /** A fila de créditos não identificados, só das contas do escopo do usuário (regra 15). */
  async creditosDoEscopo(s: SessaoCadastro, dias: number): Promise<CreditoPendenteResposta[]> {
    const hoje = await this.porta.hoje(ctx(s));
    const ids = new Set(await this.idsDoEscopo(s));
    return (await this.porta.creditosPendentes(ctx(s), somarDias(hoje, -dias))).filter((c) =>
      ids.has(c.conta),
    );
  }

  async conciliar(s: SessaoCadastro, e: ConciliarEntrada): Promise<ResultadoFinanceiro> {
    const contasEscopo = await this.idsDoEscopo(s);
    const r = await this.apoios.apoios.tesouraria.sgh(
      comChave(s),
      E.financeiroConciliacaoConfirmada.codigo,
      'financeiro.tesouraria',
      (x: { id: number }) => ({ tabela: 'conciliacao_bancaria_item', id: String(x.id) }),
      (g) => g.conciliar({ ...e, usuario: s.login, contasEscopo }),
    );
    return resultadoFin(
      e.alvo.tipo === 'credito-pendente'
        ? 'Crédito sem casamento enviado à fila de crédito não identificado.'
        : 'Conciliação confirmada.',
      false,
      { conciliacao: r.id },
    );
  }

  async atribuirCredito(s: SessaoCadastro, e: AtribuirCreditoEntrada): Promise<ResultadoFinanceiro> {
    const contasEscopo = await this.idsDoEscopo(s);
    const r = await this.apoios.apoios.tesouraria.sgh(
      comChave(s),
      E.financeiroCreditoAtribuido.codigo,
      'financeiro.tesouraria',
      () => ({ tabela: 'credito_nao_identificado', id: String(e.credito) }),
      (g) => g.atribuirCredito({ ...e, usuario: s.login, contasEscopo }),
    );
    return resultadoFin('Crédito atribuído ao título a receber.', false, { credito: r.id });
  }

  // ── Adiantamento (F3.8, 07-FIN linha 67) ──────────────────────────────────────────────────────────────────────

  async concederAdiantamento(
    s: SessaoCadastro,
    e: ConcederAdiantamentoEntrada,
  ): Promise<ResultadoFinanceiro> {
    const contasEscopo = await this.idsDoEscopo(s);
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAdiantamentoConcedido.codigo,
      'financeiro.contasPagar',
      (x: { id: number }) => ({ tabela: 'adiantamento', id: String(x.id) }),
      (g) => g.concederAdiantamento({ ...e, usuario: s.login, contasEscopo }),
    );
    return resultadoFin(
      `Pedido do adiantamento ${r.numero} registrado: aguarda a aprovação na alçada e o pagamento por outra pessoa.`,
      false,
      { adiantamento: r.id },
    );
  }

  async aprovarAdiantamento(s: SessaoCadastro, e: AprovarAdiantamentoEntrada): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAdiantamentoAprovado.codigo,
      'financeiro.contasPagar',
      () => ({ tabela: 'adiantamento', id: String(e.adiantamento) }),
      (g) =>
        g.aprovarAdiantamento({
          ...e,
          usuario: s.login,
          temPermissao: (p) => this.podeSessao(s, p),
        }),
    );
    return resultadoFin(
      r.aprovado
        ? 'Adiantamento aprovado na alçada: pode ser pago (por outra pessoa).'
        : `Primeira aprovação do adiantamento registrada: falta ${r.faltam} aprovação(ões) de outra pessoa.`,
      false,
      { aprovacao: r.id, ordem: r.ordem },
    );
  }

  async pagarAdiantamento(s: SessaoCadastro, e: PagarAdiantamentoEntrada): Promise<ResultadoFinanceiro> {
    const contasEscopo = await this.idsDoEscopo(s);
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAdiantamentoPago.codigo,
      'financeiro.contasPagar',
      () => ({ tabela: 'adiantamento', id: String(e.adiantamento) }),
      (g) => g.pagarAdiantamento({ ...e, usuario: s.login, contasEscopo }),
    );
    return resultadoFin('Adiantamento pago: a saída foi lançada na conta.', false, {
      adiantamento: r.id,
      movimento: r.movimento,
    });
  }

  async compensarAdiantamento(
    s: SessaoCadastro,
    e: CompensarAdiantamentoEntrada,
  ): Promise<ResultadoFinanceiro> {
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAdiantamentoCompensado.codigo,
      'financeiro.contasPagar',
      (x: { id: number }) => ({ tabela: 'compensacao_adiantamento', id: String(x.id) }),
      (g) => g.compensarAdiantamento({ ...e, usuario: s.login }),
    );
    return resultadoFin('Adiantamento compensado no título.', false, { compensacao: r.id, saldo: r.saldo });
  }

  async devolverAdiantamento(
    s: SessaoCadastro,
    e: DevolverAdiantamentoEntrada,
  ): Promise<ResultadoFinanceiro> {
    const contasEscopo = await this.idsDoEscopo(s);
    const r = await this.apoios.apoios.contasPagar.sgh(
      comChave(s),
      E.financeiroAdiantamentoDevolvido.codigo,
      'financeiro.contasPagar',
      () => ({ tabela: 'adiantamento', id: String(e.adiantamento) }),
      (g) => g.devolverAdiantamento({ ...e, usuario: s.login, contasEscopo }),
    );
    return resultadoFin('Devolução do saldo registrada.', false, { adiantamento: r.id, saldo: r.saldo });
  }

  async fluxoCaixa(
    s: SessaoCadastro,
    d: { de: string; ate: string; agrupamento: 'dia' | 'semana' | 'mes' },
  ): Promise<FluxoCaixaResposta> {
    const contas = await this.porta.contas(ctx(s), s.login);
    const saldoInicial = Math.round(contas.reduce((x, c) => x + c.saldo, 0) * 100) / 100;
    const lanc = await this.porta.lancamentosFluxo(ctx(s), d.de, d.ate);
    const premissas = await this.porta.historicosConvenio(ctx(s), somarDias(d.de, -365));
    const linhas = montarFluxo(
      saldoInicial,
      lanc,
      d.agrupamento,
      new Map(premissas.map((p) => [p.convenio, p])),
    );
    return { agrupamento: d.agrupamento, de: d.de, ate: d.ate, saldoInicial, linhas, premissas };
  }

  async dre(
    s: SessaoCadastro,
    d: { de: string; ate: string; regua: 'competencia' | 'caixa' },
  ): Promise<DreResposta> {
    const n = (m: string) => Number(m.slice(0, 4)) * 100 + Number(m.slice(5, 7));
    const b = await this.porta.basesDre(ctx(s), n(d.de), n(d.ate));
    const meses: string[] = [];
    for (
      let a = Number(d.de.slice(0, 4)), m = Number(d.de.slice(5, 7));
      a * 100 + m <= n(d.ate) && meses.length < 36;
    ) {
      meses.push(`${a}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m === 13) {
        m = 1;
        a += 1;
      }
    }
    return {
      regua: d.regua,
      linhas: montarDre(meses, b.receitas, b.despesas, b.caixa),
      aberturaDespesas: aberturaPorGrupo(
        d.regua === 'competencia' ? b.despesas : b.caixa.filter((c) => c.natureza === 'despesa'),
      ),
    };
  }

  async indicadores(s: SessaoCadastro, de: string, ate: string): Promise<IndicadorResposta[]> {
    const b = await this.porta.basesIndicadores(ctx(s), de, ate);
    return [
      indicadorPagosSemAprovacao(b.pagos, b.aprovados, b.pagosPeloNovo),
      indicadorContasSemTitulo(b.contas, b.contasComTitulo),
      indicadorCredorOrfao(b.titulos, b.orfaos),
    ];
  }

  async worklist(s: SessaoCadastro): Promise<WorklistFinanceiro> {
    const hoje = await this.porta.hoje(ctx(s));
    const cartoes: { codigo: string; titulo: string; quantidade: number; rota: string; prazo: string }[] = [];
    if (s.pode('financeiro.tituloPagar.aprovar')) {
      const f = await this.filaAprovacao(s, 7);
      cartoes.push({
        codigo: 'aprovar',
        titulo: 'Títulos a aprovar (vencem em 7 dias)',
        quantidade: f.filter((t) => t.feitas < t.exigidas).length,
        rota: '/financeiro/pagar/aprovacao',
        prazo: somarDias(hoje, 7),
      });
    }
    if (s.pode('financeiro.tituloPagar.baixar')) {
      const f = await this.filaAprovacao(s, 0);
      cartoes.push({
        codigo: 'pagar-hoje',
        titulo: 'Títulos que vencem hoje ou vencidos',
        quantidade: f.length,
        rota: '/financeiro/pagar/borderos',
        prazo: hoje,
      });
    }
    if (s.pode('financeiro.tituloReceber.criar')) {
      const c = await this.porta.contasSemTitulo(ctx(s), {
        convenio: null,
        ano: Number(hoje.slice(0, 4)),
        mes: null,
      });
      cartoes.push({
        codigo: 'contas-sem-titulo',
        titulo: 'Contas apresentadas sem título a receber',
        quantidade: c.length,
        rota: '/financeiro/receber/titulos',
        prazo: hoje,
      });
    }
    if (s.pode('financeiro.conciliacao.ler')) {
      const cr = await this.creditosDoEscopo(s, 90);
      cartoes.push({
        codigo: 'creditos',
        titulo: 'Créditos não identificados',
        quantidade: cr.filter((x) => x.situacao === 'pendente').length,
        rota: '/financeiro/tesouraria/conciliacao',
        prazo: hoje,
      });
    }
    const fiscal = await this.pendenciasFiscais(s, hoje);
    if (fiscal)
      cartoes.push({
        codigo: 'fiscal',
        titulo: 'Obrigações fiscais e contábeis a gerar',
        quantidade: fiscal.quantidade,
        rota: fiscal.rota,
        prazo: fiscal.prazo,
      });
    return { cartoes };
  }

  /**
   * O cartão do fiscal (ficha, seção 3): o que falta gerar, conforme a permissão de cada um. A EFD-REINF R-4000 e o lote
   * contábil da competência anterior (vencem no dia 15 do mês corrente) e a DMED do ano anterior (vence no último dia
   * útil de fevereiro; mostrada de janeiro a fevereiro). Nada gerado é enviado (DP-38): o cartão lembra de gerar.
   */
  private async pendenciasFiscais(
    s: SessaoCadastro,
    hoje: string,
  ): Promise<{ quantidade: number; rota: string; prazo: string } | null> {
    const reinf = s.pode('financeiro.reinf.gerar');
    const dmed = s.pode('financeiro.dmed.gerar');
    const lote = s.pode('financeiro.exportacaoContabil.exportar');
    if (!reinf && !dmed && !lote) return null;
    const ano = Number(hoje.slice(0, 4));
    const mes = Number(hoje.slice(5, 7));
    const anterior = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
    const prazoMes = `${hoje.slice(0, 7)}-15`;
    const pend: { rota: string; prazo: string }[] = [];
    if (reinf || dmed) {
      const decl = await this.porta.registrosFiscais(ctx(s), 'declaracao');
      const tem = (tipo: string, periodo: string) =>
        decl.some((d) => d['TIPO'] === tipo && String(d['PERIODO']) === periodo);
      if (reinf && !tem('reinf-r4000', anterior))
        pend.push({ rota: '/financeiro/fiscal/reinf', prazo: prazoMes });
      if (dmed && mes <= 2 && !tem('dmed', String(ano - 1)))
        pend.push({ rota: '/financeiro/fiscal/dmed', prazo: `${ano}-02-28` });
    }
    if (lote) {
      const lotes = await this.porta.registrosFiscais(ctx(s), 'lote');
      if (!lotes.some((l) => String(l['PERIODO']) === anterior))
        pend.push({ rota: '/financeiro/contabil/exportacao', prazo: prazoMes });
    }
    // Sem pendência, o cartão leva à primeira tela fiscal da pessoa (a lista do que já foi gerado).
    const rota =
      pend[0]?.rota ??
      (reinf
        ? '/financeiro/fiscal/reinf'
        : dmed
          ? '/financeiro/fiscal/dmed'
          : '/financeiro/contabil/exportacao');
    return { quantidade: pend.length, rota, prazo: pend.map((p) => p.prazo).sort()[0] ?? prazoMes };
  }

  // ── Fiscal ────────────────────────────────────────────────────────────────────────────────────────────────────

  async emitirNfse(s: SessaoCadastro, e: EmitirNfseEntrada): Promise<ResultadoFinanceiro> {
    const r1 = conferirNfse(e);
    if (r1)
      throw new ErroProblema('recusa-de-negocio', 409, 'NFS-e recusada', r1.mensagem, { codigo: r1.codigo });
    const calc = calcularNfse(e);
    const destino = destinoNfse(this.ambiente, false);
    const xml = xmlNfse({
      ...calc,
      numeroRps: String(Date.now() % 1_000_000_000),
      tomador: e.tituloReceber ? `titulo ${e.tituloReceber}` : `conta ${e.conta}`,
      itemServico: e.itemServico,
    });
    const hash = sha256(xml);
    const chave = `nfse/${hash}.xml`;
    const conteudoXml = bytes(xml);
    await this.armazem.guardar(chave, conteudoXml, 'application/xml');
    const sim = simularPrefeitura(xml, Date.now() % 1_000_000_000);
    const r = await this.apoios.apoios.fiscal.sgh(
      comChave(s),
      E.financeiroNfseEmitida.codigo,
      'financeiro.fiscal',
      (x: { id: number }) => ({ tabela: 'nota_servico', id: String(x.id) }),
      (g) =>
        g.registrarNfse({
          usuario: s.login,
          tituloReceber: e.tituloReceber,
          conta: e.conta,
          momento: e.momento,
          classificacao: e.classificacao,
          itemServico: e.itemServico,
          valorServicos: calc.baseCalculo,
          aliquotaIss: e.aliquotaIss,
          valorIss: calc.valorIss,
          issRetido: calc.issRetido,
          valorIbs: calc.valorIbs,
          valorCbs: calc.valorCbs,
          retencoes: calc.retencoesFederais,
          valorLiquido: calc.valorLiquido,
          destino,
          situacao: 'simulada',
          numero: sim.numero,
          hashXml: hash,
          arquivo: { chave, tamanhoBytes: conteudoXml.length, tipoMime: 'application/xml' },
        }),
    );
    return resultadoFin(
      `NFS-e ${sim.numero} simulada (a emissão real fica para depois da DP-38): líquido de ${calc.valorLiquido.toFixed(2)}.`,
      false,
      {
        nfse: r.id,
        numero: sim.numero,
      },
    );
  }

  async gerarDeclaracao(s: SessaoCadastro, e: GerarDeclaracaoEntrada): Promise<ResultadoFinanceiro> {
    const ano = Number(e.periodo.slice(0, 4));
    const mes = Number(e.periodo.slice(5, 7) || 1);
    let arquivo: { conteudo: string; registros: number; valorTotal: number };
    let leiaute: string;
    if (e.tipo === 'dmed') {
      // Os recebimentos de pessoa física do ano (os títulos do particular baixados), por titular.
      const t = await this.porta.titulosReceber(ctx(s), {
        devedor: 'E',
        convenio: null,
        aberto: false,
        vencimentoDe: `${ano}-01-01`,
        vencimentoAte: `${ano}-12-31`,
        pagina: 0,
        hoje: `${ano}-12-31`,
      });
      arquivo = gerarDmed(
        ano,
        { cnpj: '0', nome: 'ESTABELECIMENTO', responsavelCpf: '0' },
        t.itens.map((x) => ({ cpfTitular: String(x.codigo), nomeTitular: x.nome, valor: x.recebido })),
      );
      leiaute = `DMED ${ano + 1}`;
    } else {
      const r = await this.porta.retencoesDaCompetencia(ctx(s), ano, mes);
      arquivo = gerarReinf(e.tipo === 'reinf-r2000' ? 'R-2000' : 'R-4000', e.periodo, '0', r);
      leiaute = e.tipo === 'reinf-r2000' ? 'EFD-REINF R-2010 v2.1.2' : 'EFD-REINF R-4020 v2.1.2';
    }
    const hash = sha256(arquivo.conteudo);
    const chave = `declaracao/${e.tipo}/${e.periodo}-${hash.slice(0, 16)}`;
    const conteudoDeclaracao = bytes(arquivo.conteudo);
    await this.armazem.guardar(chave, conteudoDeclaracao, 'text/plain').catch(jaGuardado);
    const r = await this.apoios.apoios.fiscal.sgh(
      comChave(s),
      E.financeiroDeclaracaoGerada.codigo,
      'financeiro.fiscal',
      (x: { id: number }) => ({ tabela: 'declaracao_dmed', id: String(x.id) }),
      (g) =>
        g.registrarDeclaracao({
          usuario: s.login,
          tipo: e.tipo,
          periodo: e.periodo,
          leiaute,
          registros: arquivo.registros,
          valorTotal: arquivo.valorTotal,
          hashArquivo: hash,
          arquivo: { chave, tamanhoBytes: conteudoDeclaracao.length, tipoMime: 'text/plain' },
        }),
    );
    return resultadoFin(
      `${leiaute} gerada (${arquivo.registros} registro(s)): situação "gerado, não enviado" até a DP-38.`,
      false,
      {
        declaracao: r.id,
      },
    );
  }

  async exportarLoteContabil(
    s: SessaoCadastro,
    e: ExportarLoteContabilEntrada,
  ): Promise<ResultadoFinanceiro> {
    const de = `${e.periodo}-01`;
    const ate = somarDias(
      `${e.periodo.slice(0, 4)}-${String((Number(e.periodo.slice(5, 7)) % 12) + 1).padStart(2, '0')}-01`,
      -1,
    );
    const fim = Number(e.periodo.slice(5, 7)) === 12 ? `${e.periodo.slice(0, 4)}-12-31` : ate;
    // F3.8, 07-FIN linha 100: os fatos do período com a conta de cada lado pelo de-para por evento mantido na tela
    // (contabil-fiscal.controller.ts), mais o código externo do centro de custo e do credor.
    const dp = await this.porta.deParaContabil(ctx(s), { de, ate: fim, regua: e.regua });
    const { eventos, depara } = dePararFatos(dp.fatos, dp.regras, dp.centros, dp.credores);
    const lote = montarLoteContabil(eventos, depara);
    const hash = sha256(lote.conteudo);
    const chave = `contabil/${e.periodo}-${e.regua}-${hash.slice(0, 16)}.txt`;
    const conteudoLote = bytes(lote.conteudo);
    await this.armazem.guardar(chave, conteudoLote, 'text/plain').catch(jaGuardado);
    const r = await this.apoios.apoios.fiscal.sgh(
      comChave(s),
      E.financeiroLoteContabilExportado.codigo,
      'financeiro.fiscal',
      (x: { id: number }) => ({ tabela: 'lote_exportacao_contabil', id: String(x.id) }),
      (g) =>
        g.registrarLoteContabil({
          usuario: s.login,
          periodo: e.periodo,
          regua: e.regua,
          lancamentos: lote.lancamentos,
          somaDebitos: lote.somaDebitos,
          somaCreditos: lote.somaCreditos,
          semDePara: lote.semDePara.length,
          hashArquivo: hash,
          arquivo: { chave, tamanhoBytes: conteudoLote.length, tipoMime: 'text/plain' },
        }),
    );
    return resultadoFin(
      `Lote contábil exportado: ${lote.lancamentos} lançamento(s), débitos ${lote.somaDebitos.toFixed(2)} = créditos ${lote.somaCreditos.toFixed(2)}; ${lote.semDePara.length} sem de-para (fora do lote).`,
      false,
      { lote: r.id, lancamentos: lote.lancamentos },
      lote.semDePara.length
        ? [`${lote.semDePara.length} lançamento(s) sem de-para: cadastre o de-para contábil.`]
        : [],
    );
  }
}

/**
 * Regra 10: as contas apresentadas sem título da competência do convênio viram um título por tipo de conta (externa e
 * internação, como o outro sistema agrupa), com o vencimento e o número da fatura dados na tela (um número por título).
 */
export function entradasDaCompetencia(
  contas: readonly { id: number; tipo: string; versao: string }[],
  d: { ano: number; mes: number; vencimento: string; documento: number },
): {
  contas: { conta: number; versao: string }[];
  vencimento: string;
  documento: number;
  referente: string;
}[] {
  const grupos = new Map<string, { conta: number; versao: string }[]>();
  for (const c of contas)
    grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), { conta: c.id, versao: c.versao }]);
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g], i) => ({
      contas: g,
      vencimento: d.vencimento,
      // Um número de fatura por título: o segundo grupo (internação) leva o número seguinte (a chave do título a
      // receber repete convênio, apresentação e documento; D-FATURA-32).
      documento: d.documento > 0 ? d.documento + i : 0,
      referente: `Competência ${d.ano}-${String(d.mes).padStart(2, '0')}`,
    }));
}
