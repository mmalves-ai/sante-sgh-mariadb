// Porta própria da troca TISS na visão da operadora (08-SGO linha 107, C2-061; F7) sobre o banco do cliente:
//   - troca_tiss_operadora: cada transação recebida do prestador (pedido de autorização, cancelamento de guia,
//     comunicação de internação) e cada demonstrativo enviado (análise e pagamento), com o sequencial, o protocolo, o
//     hash do epílogo e a situação; a rejeitada fica com o motivo (nunca apagada);
//   - cancelamento_guia_recebido e os itens: o pedido de cancelamento com o protocolo devolvido e o resultado guia a guia
//     (o pedido de autorização cancelado ganha a situação, o motivo e o histórico na mesma transação);
//   - comunicacao_internacao_recebida: a internação ou a alta comunicada, com o beneficiário pela carteira;
//   - demonstrativo_pagamento_emitido e o item do protocolo: o demonstrativo de pagamento entregue (a reemissão atualiza o
//     mesmo número com a versão; a trilha guarda o anterior).
// A regra vem do domínio (troca-tiss.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na mesma
// transação). O escopo é o estabelecimento da sessão e a operadora ligada a ele.
import {
  type CabecalhoTroca,
  type CancelamentoLido,
  type ComunicacaoLida,
  type PrestadorDaOrigem,
  protocoloDaTroca,
  resultadoDoCancelamento,
  type ResultadoCancelamento,
  situacaoDaComunicacao,
  situacaoDoCancelamento,
  valoresDoDemonstrativoPagamento,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  instanteIso,
  type NucleoOperadora,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_TROCA_TISS = Symbol('PORTA_TROCA_TISS_OPERADORA');

export const TABELAS_TROCA_TISS = [
  'troca_tiss_operadora',
  'cancelamento_guia_recebido',
  'cancelamento_guia_recebido_item',
  'comunicacao_internacao_recebida',
  'demonstrativo_pagamento_emitido',
  'demonstrativo_pagamento_emitido_item',
  'pedido_autorizacao_plano',
  'pedido_autorizacao_plano_historico',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
const esquemaEntrada = z.record(z.string(), z.unknown());

/** O que a conferência da mensagem precisa do banco. */
export interface ApoioRecebimentoTroca {
  readonly operadora: { readonly id: number; readonly registroAns: string } | null;
  readonly prestador: number | null;
  readonly sequencialRepetido: boolean;
  readonly hoje: string;
  /** Os tipos de guia do pedido (pelo código do domínio) e a origem do canal "troca eletrônica". */
  readonly tipoGuia: { readonly sp_sadt: number | null; readonly internacao: number | null };
  readonly origemTroca: number | null;
}

/** A transação recebida como ela chegou (cabeçalho lido e o hash conferido). */
export interface TrocaRecebida {
  readonly cabecalho: CabecalhoTroca;
  readonly canal: 'webservice' | 'portal' | 'arquivo';
  readonly hash: string | null;
  readonly operadora: number;
  readonly prestador: number | null;
}

export interface ResultadoCancelamentoRecebido extends Gravado {
  readonly troca: number;
  readonly protocolo: string;
  readonly situacao: 'respondido' | 'recusado';
  readonly guias: readonly {
    readonly numeroGuiaPrestador: string;
    readonly resultado: ResultadoCancelamento;
    readonly observacao: string | null;
  }[];
}

export interface ResultadoComunicacaoRecebida extends Gravado {
  readonly troca: number;
  readonly situacao: 'aceita' | 'recebida';
  readonly beneficiarioIdentificado: boolean;
}

export interface TrocaTissResumo {
  readonly id: number;
  readonly direcao: 'recebida' | 'enviada';
  readonly tipo: string;
  readonly canal: string;
  readonly prestador: string | null;
  readonly sequencial: string | null;
  readonly protocolo: string | null;
  readonly registradaEm: string;
  readonly situacao: string;
  readonly mensagemErro: string | null;
}

const naoEncontrado = (o: string) =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    `${o} não existe neste estabelecimento.`,
  );

const instante = (t: string) => new Date(`${t.replace(' ', 'T')}${t.length <= 19 ? 'Z' : ''}`);

export class PortaTrocaTissPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-troca-tiss' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar<T extends Gravado>(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, T>({
      nome,
      tabelas: TABELAS_TROCA_TISS,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  /** A operadora do estabelecimento (registro na agência), o prestador da rede pela origem e o sequencial repetido. */
  apoioRecebimento(
    c: ContextoPorta,
    origem: PrestadorDaOrigem,
    sequencial: string,
  ): Promise<ApoioRecebimentoTroca> {
    return this.ler(c, async (l, est) => {
      const op = await l.uma(
        `SELECT o.id, o.registro_ans FROM operadora_saude o
           JOIN operadora_saude_estabelecimento oe ON oe.operadora_saude_id = o.id
          WHERE oe.estabelecimento_id = ? AND oe.excluido_em IS NULL AND o.excluido_em IS NULL
          ORDER BY oe.principal DESC, o.id LIMIT 1`,
        [est],
      );
      const pr = await l.uma(
        `SELECT id FROM prestador_rede
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'descredenciado'
            AND ((? = 'codigo' AND codigo = ?) OR (? = 'cnpj' AND cnpj = ?) OR (? = 'cpf' AND cpf = ?))`,
        [est, origem.tipo, origem.valor, origem.tipo, origem.valor, origem.tipo, origem.valor],
      );
      const prestador = pr ? inteiro(pr['id']) : null;
      const rep = prestador
        ? await l.uma(
            `SELECT id FROM troca_tiss_operadora
              WHERE estabelecimento_id = ? AND prestador_rede_id = ? AND direcao = 'recebida' AND sequencial_transacao = ?`,
            [est, prestador, sequencial],
          )
        : null;
      const hoje = await l.uma('SELECT CURRENT_DATE() AS hoje');
      const tipos = await l.consultar(
        "SELECT id, codigo FROM tipo_guia_plano WHERE codigo IN ('sp_sadt', 'internacao') AND ativo = TRUE",
      );
      const troca = await l.uma(
        "SELECT id FROM origem_guia_plano WHERE canal = 'troca_eletronica' AND ativo = TRUE ORDER BY id LIMIT 1",
      );
      const tipo = (c: string) => inteiro(tipos.find((t) => t['codigo'] === c)?.['id']);
      return {
        tipoGuia: { sp_sadt: tipo('sp_sadt'), internacao: tipo('internacao') },
        origemTroca: troca ? inteiro(troca['id']) : null,
        operadora: op ? { id: inteiro(op['id'])!, registroAns: textoObrigatorio(op['registro_ans']) } : null,
        prestador,
        sequencialRepetido: !!rep,
        hoje: dataIso(hoje?.['hoje']) ?? new Date().toISOString().slice(0, 10),
      };
    });
  }

  /** As últimas trocas do estabelecimento (recebidas e enviadas), da mais nova para a mais antiga. */
  trocas(
    c: ContextoPorta,
    f: { readonly tipo?: string | undefined; readonly direcao?: string | undefined } = {},
  ): Promise<TrocaTissResumo[]> {
    return this.ler(c, async (l, est) => {
      const filtros = ['t.estabelecimento_id = ?', 't.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.tipo) {
        filtros.push('t.tipo_transacao = ?');
        p.push(f.tipo);
      }
      if (f.direcao) {
        filtros.push('t.direcao = ?');
        p.push(f.direcao);
      }
      const linhas = await l.consultar(
        `SELECT t.id, t.direcao, t.tipo_transacao, t.canal, pr.nome AS prestador, t.sequencial_transacao,
                t.numero_protocolo, t.registrada_em, t.situacao, t.mensagem_erro
           FROM troca_tiss_operadora t LEFT JOIN prestador_rede pr ON pr.id = t.prestador_rede_id
          WHERE ${filtros.join(' AND ')} ORDER BY t.registrada_em DESC, t.id DESC LIMIT 200`,
        p,
      );
      return linhas.map((x) => ({
        id: inteiro(x['id'])!,
        direcao: textoObrigatorio(x['direcao']) as 'recebida' | 'enviada',
        tipo: textoObrigatorio(x['tipo_transacao']),
        canal: textoObrigatorio(x['canal']),
        prestador: texto(x['prestador']),
        sequencial: texto(x['sequencial_transacao']),
        protocolo: texto(x['numero_protocolo']),
        registradaEm: instanteIso(x['registrada_em']) ?? '',
        situacao: textoObrigatorio(x['situacao']),
        mensagemErro: texto(x['mensagem_erro']),
      }));
    });
  }

  // ── Gravações ───────────────────────────────────────────────────────────────────────────────────

  private static incluirTroca(
    tx: TxOperacao,
    est: number,
    t: TrocaRecebida,
    extra: { situacao: string; protocolo?: string | null; erro?: string | null },
  ): Promise<number> {
    return tx.incluir('troca_tiss_operadora', {
      estabelecimento_id: est,
      direcao: 'recebida',
      tipo_transacao: t.cabecalho.tipo,
      canal: t.canal,
      prestador_rede_id: t.prestador,
      sequencial_transacao: t.cabecalho.sequencial.slice(0, 20),
      registrada_em: instante(t.cabecalho.registradaEm),
      versao_padrao: t.cabecalho.padrao.slice(0, 10) || '?',
      registro_ans: t.cabecalho.registroAns?.slice(0, 6) ?? null,
      numero_protocolo: extra.protocolo ?? null,
      hash_mensagem: t.hash,
      situacao: extra.situacao,
      mensagem_erro: extra.erro ?? null,
      processado_em: new Date(),
      origem: 'integracao',
    });
  }

  /**
   * A transação recebida registrada como ficou: a rejeitada com o motivo ou, no pedido de autorização, a reserva
   * 'em_processamento' gravada ANTES do pedido (o UNIQUE do sequencial recusa o envio simultâneo do mesmo sequencial;
   * a reserva é concluída por concluirRecebida). O sequencial já registrado não chega aqui (a conferência recusa antes).
   */
  registrarRecebida(
    c: ContextoPorta,
    t: TrocaRecebida,
    r: {
      readonly situacao: 'em_processamento' | 'processada' | 'rejeitada';
      readonly protocolo: string | null;
      readonly erro: string | null;
    },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.troca-tiss.registrar',
      'troca_tiss_operadora',
      trilha,
      async (tx, est) => ({
        id: await PortaTrocaTissPropria.incluirTroca(tx, est, t, {
          situacao: r.situacao,
          protocolo: r.protocolo,
          erro: r.erro?.slice(0, 2000) ?? null,
        }),
        versao: 1,
      }),
    );
  }

  /**
   * A reserva concluída: processada com o protocolo do pedido de autorização gravado, ou rejeitada com o motivo. Só a
   * troca recebida ainda 'em_processamento' deste estabelecimento muda (a já concluída nunca é reescrita).
   */
  concluirRecebida(
    c: ContextoPorta,
    id: number,
    r: {
      readonly situacao: 'processada' | 'rejeitada';
      readonly protocolo: string | null;
      readonly erro: string | null;
    },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.troca-tiss.concluir',
      'troca_tiss_operadora',
      trilha,
      async (tx, est) => {
        const x = await tx.uma(
          "SELECT versao FROM troca_tiss_operadora WHERE id = ? AND estabelecimento_id = ? AND direcao = 'recebida' AND situacao = 'em_processamento'",
          [id, est],
        );
        if (!x) throw naoEncontrado('A troca em processamento');
        const versao = await tx.alterar('troca_tiss_operadora', id, inteiro(x['versao'])!, {
          situacao: r.situacao,
          numero_protocolo: r.protocolo,
          mensagem_erro: r.erro?.slice(0, 2000) ?? null,
          processado_em: new Date(),
        });
        return { id, versao };
      },
    );
  }

  /** O cancelamento de guia recebido: a troca, o pedido com o protocolo e o resultado de cada guia, numa transação. */
  receberCancelamento(
    c: ContextoPorta,
    t: TrocaRecebida,
    x: CancelamentoLido,
    trilha: Trilha,
  ): Promise<ResultadoCancelamentoRecebido> {
    return this.gravar(
      c,
      'operadora.troca-tiss.cancelamento.receber',
      'cancelamento_guia_recebido',
      trilha,
      async (tx, est) => {
        if (!t.prestador) throw naoEncontrado('O prestador');
        const hoje = dataIso((await tx.uma('SELECT CURRENT_DATE() AS hoje'))?.['hoje'])!;
        const prefixo = protocoloDaTroca(hoje, 1).slice(0, 6);
        const n = await tx.uma(
          'SELECT COUNT(*) AS n FROM cancelamento_guia_recebido WHERE operadora_saude_id = ? AND protocolo LIKE ?',
          [t.operadora, `${prefixo}%`],
        );
        const protocolo = protocoloDaTroca(hoje, (inteiro(n?.['n']) ?? 0) + 1);
        const troca = await PortaTrocaTissPropria.incluirTroca(tx, est, t, {
          situacao: 'processada',
          protocolo,
        });
        const guias: {
          numeroGuiaPrestador: string;
          numeroGuiaOperadora: string | null;
          resultado: ResultadoCancelamento;
          observacao: string | null;
          pedido: number | null;
          conta: number | null;
        }[] = [];
        if (x.lote) {
          guias.push({
            numeroGuiaPrestador: `LOTE ${x.lote.numeroLote}`.slice(0, 20),
            numeroGuiaOperadora: null,
            resultado: 'nao_cancelada',
            observacao:
              'O lote recebido segue pela conta (devolução do lote), não pelo cancelamento de guia.',
            pedido: null,
            conta: null,
          });
        }
        let motivoCancelamento: number | null | undefined;
        for (const g of x.guias) {
          const pedido = await tx.uma(
            `SELECT id, situacao, versao FROM pedido_autorizacao_plano
              WHERE estabelecimento_id = ? AND solicitante_prestador_rede_id = ? AND excluido_em IS NULL
                AND (numero_guia_prestador = ? OR (? IS NOT NULL AND numero_guia = ?))
              ORDER BY id DESC LIMIT 1`,
            [est, t.prestador, g.numeroGuiaPrestador, g.numeroGuiaOperadora, g.numeroGuiaOperadora],
          );
          const conta = await tx.uma(
            `SELECT g.id FROM guia_conta_recebida g JOIN lote_conta_recebida l ON l.id = g.lote_conta_recebida_id
              WHERE g.estabelecimento_id = ? AND l.prestador_rede_id = ? AND g.numero_guia_prestador = ?
                AND l.situacao <> 'devolvida' AND g.excluido_em IS NULL
              ORDER BY g.id DESC LIMIT 1`,
            [est, t.prestador, g.numeroGuiaPrestador],
          );
          const d = resultadoDoCancelamento({
            pedido: pedido ? { situacao: textoObrigatorio(pedido['situacao']) } : null,
            apresentadaEmConta: !!conta,
          });
          let { resultado, observacao } = d;
          if (d.cancelarPedido && pedido) {
            if (motivoCancelamento === undefined)
              motivoCancelamento = inteiro(
                (
                  await tx.uma(
                    "SELECT id FROM motivo_cancelamento_guia_plano WHERE codigo = 'outros' AND ativo = TRUE LIMIT 1",
                  )
                )?.['id'],
              );
            if (!motivoCancelamento) {
              resultado = 'nao_cancelada';
              observacao = 'Falta o motivo de cancelamento "outros" no cadastro da operadora.';
            } else {
              const id = inteiro(pedido['id'])!;
              const texto = `Cancelada a pedido do prestador (troca eletrônica, protocolo ${protocolo}).`;
              await tx.alterar('pedido_autorizacao_plano', id, inteiro(pedido['versao'])!, {
                situacao: 'cancelada',
                motivo_cancelamento_guia_plano_id: motivoCancelamento,
                cancelada_em: new Date(),
                observacao: texto,
              });
              await tx.incluir('pedido_autorizacao_plano_historico', {
                pedido_autorizacao_plano_id: id,
                operacao: 'alteracao',
                dados: null,
                ocorrido_em: new Date(),
                usuario_id: tx.contexto.usuario,
                evento: 'cancelamento',
                situacao: 'cancelada',
                texto,
              });
            }
          }
          guias.push({
            numeroGuiaPrestador: g.numeroGuiaPrestador,
            numeroGuiaOperadora: g.numeroGuiaOperadora,
            resultado,
            observacao,
            pedido: pedido ? inteiro(pedido['id']) : null,
            conta: conta ? inteiro(conta['id']) : null,
          });
        }
        const situacao = situacaoDoCancelamento(guias.map((g) => g.resultado));
        const id = await tx.incluir('cancelamento_guia_recebido', {
          estabelecimento_id: est,
          operadora_saude_id: t.operadora,
          prestador_rede_id: t.prestador,
          protocolo,
          versao_padrao: t.cabecalho.padrao.slice(0, 10) || null,
          recebido_em: new Date(),
          situacao,
          respondido_em: new Date(),
          observacao: x.lote ? `Pedido de cancelamento do lote ${x.lote.numeroLote}.` : null,
          origem: 'integracao',
        });
        let sequencia = 0;
        for (const g of guias)
          await tx.incluir('cancelamento_guia_recebido_item', {
            cancelamento_guia_recebido_id: id,
            sequencia: ++sequencia,
            numero_guia_prestador: g.numeroGuiaPrestador,
            numero_guia_operadora: g.numeroGuiaOperadora,
            pedido_autorizacao_plano_id: g.pedido,
            guia_conta_recebida_id: g.conta,
            resultado: g.resultado,
            observacao: g.observacao?.slice(0, 500) ?? null,
            origem: 'integracao',
          });
        return {
          id,
          versao: 1,
          troca,
          protocolo,
          situacao,
          guias: guias.map((g) => ({
            numeroGuiaPrestador: g.numeroGuiaPrestador,
            resultado: g.resultado,
            observacao: g.observacao,
          })),
        };
      },
    );
  }

  /** A comunicação de internação ou alta: a troca e a comunicação com o beneficiário pela carteira, numa transação. */
  receberComunicacao(
    c: ContextoPorta,
    t: TrocaRecebida,
    x: ComunicacaoLida,
    trilha: Trilha,
  ): Promise<ResultadoComunicacaoRecebida> {
    return this.gravar(
      c,
      'operadora.troca-tiss.comunicacao.receber',
      'comunicacao_internacao_recebida',
      trilha,
      async (tx, est) => {
        if (!t.prestador) throw naoEncontrado('O prestador');
        const b = await tx.uma(
          `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
            WHERE b.matricula = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL LIMIT 1`,
          [x.carteira, est],
        );
        const beneficiario = b ? inteiro(b['id']) : null;
        const situacao = situacaoDaComunicacao(beneficiario !== null);
        const troca = await PortaTrocaTissPropria.incluirTroca(tx, est, t, { situacao: 'processada' });
        const id = await tx.incluir('comunicacao_internacao_recebida', {
          estabelecimento_id: est,
          operadora_saude_id: t.operadora,
          prestador_rede_id: t.prestador,
          numero_transacao: t.cabecalho.sequencial.slice(0, 20),
          beneficiario_plano_id: beneficiario,
          numero_carteira: x.carteira.slice(0, 30),
          recem_nascido: x.recemNascido,
          tipo_identificacao: 'carteira',
          tipo_evento: x.tipoEvento,
          evento_em: instante(`${x.dataEvento}T00:00:00`),
          tipo_internacao: x.tipoEvento === 'internacao' ? x.tipoInternacao : null,
          codigo_motivo_encerramento:
            x.tipoEvento === 'alta' ? (x.motivoEncerramento?.slice(0, 2) ?? null) : null,
          recebido_em: new Date(),
          situacao,
          respondido_em: situacao === 'aceita' ? new Date() : null,
          origem: 'integracao',
        });
        return { id, versao: 1, troca, situacao, beneficiarioIdentificado: beneficiario !== null };
      },
    );
  }

  private static async loteDoEst(l: Leitor | Escritor, est: number, lote: number) {
    const x = await l.uma(
      `SELECT l.operadora_saude_id, l.prestador_rede_id, l.numero_protocolo, l.numero_lote_prestador, l.competencia,
              l.recebido_em, o.registro_ans
         FROM lote_conta_recebida l JOIN operadora_saude o ON o.id = l.operadora_saude_id
        WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL`,
      [lote, est],
    );
    if (!x) throw naoEncontrado('O lote');
    return {
      operadora: inteiro(x['operadora_saude_id'])!,
      prestador: inteiro(x['prestador_rede_id'])!,
      protocolo: textoObrigatorio(x['numero_protocolo']),
      numeroLote: textoObrigatorio(x['numero_lote_prestador']),
      competencia: dataIso(x['competencia'])!,
      recebidoEm: dataIso(x['recebido_em']),
      registroAns: texto(x['registro_ans']),
    };
  }

  private static incluirEnviada(
    tx: TxOperacao,
    est: number,
    l: Awaited<ReturnType<typeof PortaTrocaTissPropria.loteDoEst>>,
    tipo: 'demonstrativo_pagamento' | 'demonstrativo_analise_conta',
    hash: string,
    valor: number,
  ): Promise<number> {
    return tx.incluir('troca_tiss_operadora', {
      estabelecimento_id: est,
      direcao: 'enviada',
      tipo_transacao: tipo,
      canal: 'portal',
      prestador_rede_id: l.prestador,
      registrada_em: new Date(),
      versao_padrao: '4.03.00',
      registro_ans: l.registroAns,
      numero_protocolo: l.protocolo,
      numero_lote: l.numeroLote.slice(0, 30),
      competencia: l.competencia,
      quantidade_guias: null,
      valor_informado: valor,
      hash_mensagem: hash,
      situacao: 'gerada',
      processado_em: new Date(),
      origem: 'sistema',
    });
  }

  /** A última troca enviada deste tipo para o lote (o protocolo e o número do lote), com o valor informado. */
  private ultimaEnviada(
    c: ContextoPorta,
    lote: number,
    tipo: 'demonstrativo_pagamento' | 'demonstrativo_analise_conta',
  ): Promise<{ id: number; versao: number; valor: number | null } | null> {
    return this.ler(c, async (l, est) => {
      const lt = await PortaTrocaTissPropria.loteDoEst(l, est, lote);
      const x = await l.uma(
        `SELECT id, versao, valor_informado FROM troca_tiss_operadora
          WHERE estabelecimento_id = ? AND direcao = 'enviada' AND tipo_transacao = ? AND numero_protocolo = ?
            AND numero_lote = ?
          ORDER BY id DESC LIMIT 1`,
        [est, tipo, lt.protocolo, lt.numeroLote.slice(0, 30)],
      );
      if (!x) return null;
      const v = x['valor_informado'];
      return {
        id: inteiro(x['id'])!,
        versao: inteiro(x['versao'])!,
        valor: v === null || v === undefined ? null : Number(v),
      };
    });
  }

  /**
   * O demonstrativo de análise entregue fica como troca enviada (o registro do demonstrativo é da conferência). A
   * reabertura do mesmo demonstrativo (o mesmo lote com o mesmo valor) reaproveita a troca já registrada, sem gravar;
   * só o conteúdo mudado vira uma troca nova.
   */
  async registrarEnvioAnalise(
    c: ContextoPorta,
    lote: number,
    e: { readonly hash: string; readonly informado: number },
    trilha: Trilha,
  ): Promise<Gravado & { readonly reaproveitada: boolean }> {
    const ja = await this.ultimaEnviada(c, lote, 'demonstrativo_analise_conta');
    if (ja && ja.valor === Math.round(e.informado * 100) / 100)
      return { id: ja.id, versao: ja.versao, reaproveitada: true };
    const r = await this.gravar(
      c,
      'operadora.troca-tiss.demonstrativo-analise.enviar',
      'troca_tiss_operadora',
      trilha,
      async (tx, est) => {
        const l = await PortaTrocaTissPropria.loteDoEst(tx, est, lote);
        return {
          id: await PortaTrocaTissPropria.incluirEnviada(
            tx,
            est,
            l,
            'demonstrativo_analise_conta',
            e.hash,
            e.informado,
          ),
          versao: 1,
        };
      },
    );
    return { ...r, reaproveitada: false };
  }

  /**
   * O demonstrativo de pagamento entregue: a troca enviada e o demonstrativo com a linha do protocolo pago. Só existe
   * com o pagamento (a data); o mesmo número reaberto com os mesmos valores e a mesma data devolve o registro sem gravar;
   * com o conteúdo mudado, a reemissão atualiza o registro e a linha (versão) e registra a troca nova.
   */
  async registrarDemonstrativoPagamento(
    c: ContextoPorta,
    lote: number,
    e: {
      readonly numero: string;
      readonly hash: string;
      readonly dataPagamento: string;
      readonly informado: number;
      readonly liberado: number;
      readonly glosa: number;
    },
    trilha: Trilha,
  ): Promise<Gravado & { readonly troca: number; readonly reaproveitado: boolean }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dataPagamento ?? ''))
      throw new ErroOperacao(
        409,
        'sem-pagamento',
        'Demonstrativo sem pagamento',
        'O demonstrativo de pagamento só é registrado depois do pagamento.',
      );
    const v0 = valoresDoDemonstrativoPagamento(e);
    const igual = await this.ler(c, async (l, est) => {
      const lt = await PortaTrocaTissPropria.loteDoEst(l, est, lote);
      const x = await l.uma(
        `SELECT id, versao, troca_tiss_operadora_id, data_pagamento, valor_informado, valor_liberado, valor_glosa
           FROM demonstrativo_pagamento_emitido WHERE operadora_saude_id = ? AND numero_demonstrativo = ?`,
        [lt.operadora, e.numero.slice(0, 20)],
      );
      if (
        !x ||
        x['troca_tiss_operadora_id'] === null ||
        dataIso(x['data_pagamento']) !== e.dataPagamento ||
        Number(x['valor_informado']) !== v0.informado ||
        Number(x['valor_liberado']) !== v0.liberado ||
        Number(x['valor_glosa']) !== v0.glosa
      )
        return null;
      return {
        id: inteiro(x['id'])!,
        versao: inteiro(x['versao'])!,
        troca: inteiro(x['troca_tiss_operadora_id'])!,
      };
    });
    if (igual) return { ...igual, reaproveitado: true };
    const r = await this.gravar(
      c,
      'operadora.troca-tiss.demonstrativo-pagamento.registrar',
      'demonstrativo_pagamento_emitido',
      trilha,
      async (tx, est) => {
        const l = await PortaTrocaTissPropria.loteDoEst(tx, est, lote);
        const v = valoresDoDemonstrativoPagamento(e);
        const troca = await PortaTrocaTissPropria.incluirEnviada(
          tx,
          est,
          l,
          'demonstrativo_pagamento',
          e.hash,
          v.informado,
        );
        const valores = {
          troca_tiss_operadora_id: troca,
          emitido_em: new Date(),
          data_pagamento: e.dataPagamento,
          forma_pagamento: 'credito_conta',
          valor_informado: v.informado,
          valor_processado: v.processado,
          valor_liberado: v.liberado,
          valor_glosa: v.glosa,
          valor_debitos: v.debitos,
          valor_creditos: v.creditos,
          valor_liquido: v.liquido,
          situacao: 'enviado',
        };
        const linha = {
          tipo_linha: 'protocolo',
          lote_conta_recebida_id: lote,
          numero_lote: l.numeroLote.slice(0, 20),
          numero_protocolo: l.protocolo.slice(0, 20),
          data_protocolo: l.recebidoEm,
          valor_informado: v.informado,
          valor_processado: v.processado,
          valor_liberado: v.liberado,
          valor_glosa: v.glosa,
          valor: v.liberado,
        };
        const ja = await tx.uma(
          'SELECT id, versao FROM demonstrativo_pagamento_emitido WHERE operadora_saude_id = ? AND numero_demonstrativo = ?',
          [l.operadora, e.numero],
        );
        if (ja) {
          const id = inteiro(ja['id'])!;
          const versao = await tx.alterar(
            'demonstrativo_pagamento_emitido',
            id,
            inteiro(ja['versao'])!,
            valores,
          );
          const item = await tx.uma(
            'SELECT id, versao FROM demonstrativo_pagamento_emitido_item WHERE demonstrativo_pagamento_emitido_id = ? AND sequencia = 1',
            [id],
          );
          if (item)
            await tx.alterar(
              'demonstrativo_pagamento_emitido_item',
              inteiro(item['id'])!,
              inteiro(item['versao'])!,
              linha,
            );
          else
            await tx.incluir('demonstrativo_pagamento_emitido_item', {
              demonstrativo_pagamento_emitido_id: id,
              sequencia: 1,
              ...linha,
            });
          return { id, versao, troca };
        }
        const id = await tx.incluir('demonstrativo_pagamento_emitido', {
          estabelecimento_id: est,
          operadora_saude_id: l.operadora,
          prestador_rede_id: l.prestador,
          numero_demonstrativo: e.numero.slice(0, 20),
          competencia: l.competencia,
          ...valores,
        });
        await tx.incluir('demonstrativo_pagamento_emitido_item', {
          demonstrativo_pagamento_emitido_id: id,
          sequencia: 1,
          ...linha,
        });
        return { id, versao: 1, troca };
      },
    );
    return { ...r, reaproveitado: false };
  }
}

export const METODOS_TROCA_TISS: ReadonlySet<string> = new Set([
  'apoioRecebimento',
  'trocas',
  'registrarRecebida',
  'concluirRecebida',
  'receberCancelamento',
  'receberComunicacao',
  'registrarEnvioAnalise',
  'registrarDemonstrativoPagamento',
]);
