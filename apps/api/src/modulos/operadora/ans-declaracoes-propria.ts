// Porta própria das declarações periódicas da operadora (08-SGO L110; F78.08) sobre o banco do cliente: a apuração
// guardada da taxa de saúde suplementar (apuracao_taxa_saude_suplementar, com guia e pagamento), a conferência
// cadastral da base devolvida pela ANS (conferencia_cadastral_ans e itens, com o arquivo recebido guardado pela porta de
// armazenamento de arquivos) e a declaração de serviços médicos à Receita (declaracao_servicos_medicos e itens, com o
// arquivo gerado guardado). A regra vem do domínio (ans/declaracoes.ts); o banco só guarda. Nada é apagado: a apuração e
// a declaração são canceladas pela situação, a divergência é concluída ou ignorada com motivo. Cada gravação é uma
// operação do Executor (trilha na mesma transação); a guarda do arquivo e a gravação ficam numa transação só. O escopo é
// a operadora ligada ao estabelecimento da sessão; fora dele, 404 sem dizer se existe. A conferência cadastral e a
// declaração são da operadora inteira (a ANS devolve a base por registro e a Receita recebe uma declaração por CNPJ):
// somam os beneficiários e os pagamentos de todos os estabelecimentos ligados a ela, e cada estabelecimento ligado vê
// as mesmas conferências e declarações; o estabelecimento gravado é o de quem importou ou gerou.
import {
  apurarTps,
  arquivoDmed,
  calcularTps,
  conferirCadastro,
  type CorrecaoDivergencia,
  fimDoTrimestre,
  lerArquivoConferencia,
  montarDmed,
  type PassoTps,
  prazoDmed,
  type ProblemaDeclaracao,
  problemasDaCorrecao,
  problemasDaDeclaracao,
  problemasDoPassoDmed,
  problemasDoPassoTps,
  type SituacaoApuracaoTps,
  type SituacaoDmed,
} from '@sgh/dominio-operadora';
import {
  type ArmazemArquivos,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { PortaAnsOperadora } from './ans-porta.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  instanteIso,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_DECLARACOES_ANS = Symbol('PORTA_DECLARACOES_ANS_OPERADORA');

export const TABELAS_DECLARACOES_ANS = [
  'apuracao_taxa_saude_suplementar',
  'conferencia_cadastral_ans',
  'conferencia_cadastral_ans_item',
  'declaracao_servicos_medicos',
  'declaracao_servicos_medicos_item',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
/** As leituras da porta da ANS que alimentam a conta da TPS (as mesmas do envio do demonstrativo). */
export type FontesTps = Pick<PortaAnsOperadora, 'planos' | 'valoresTps' | 'ativosNaData'>;

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
const desatualizado = () =>
  new ErroOperacao(409, 'versao-desatualizada', 'Registro alterado por outra pessoa', 'Recarregue e repita.');
function exigir(problemas: readonly ProblemaDeclaracao[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}

// ---- tipos de leitura e entrada ----
export interface ApuracaoTpsLida {
  id: number;
  versao: number;
  ano: number;
  trimestre: number | null;
  vigencia: string;
  vidas: number;
  valorPorVida: number;
  valorTotal: number;
  nossoNumero: string | null;
  vencimento: string | null;
  dataPagamento: string | null;
  valorPago: number | null;
  situacao: SituacaoApuracaoTps;
}
export interface ConferenciaLida {
  id: number;
  competencia: string;
  importadaEm: string;
  registros: number;
  divergencias: number;
  pendentes: number;
  situacao: string;
  observacao: string | null;
}
export interface DivergenciaLida {
  id: number;
  versao: number;
  sequencia: number;
  beneficiario: number | null;
  cco: string | null;
  tipo: string;
  campo: string | null;
  valorCadastro: string | null;
  valorAns: string | null;
  correcao: CorrecaoDivergencia;
  justificativa: string | null;
}
export interface DeclaracaoLida {
  id: number;
  versao: number;
  anoCalendario: number;
  anoReferencia: number;
  prazo: string;
  retificadora: boolean;
  retifica: number | null;
  numeroRecibo: string | null;
  responsavelNome: string;
  situacao: SituacaoDmed;
  arquivo: boolean;
  itens: number;
  total: number;
}
export interface ItemDeclaracaoLido {
  sequencia: number;
  beneficiario: number;
  titular: number | null;
  tipo: string;
  valor: number;
}
export interface EntradaDmed {
  anoCalendario: number;
  retifica: number | null;
  responsavelCpf: string;
  responsavelNome: string;
  responsavelDdd: string | null;
  responsavelTelefone: string | null;
  responsavelEmail: string | null;
}

const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaDeclaracoesAnsPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    private readonly fontesTps: FontesTps,
    /** O armazenamento de arquivos da instalação (ADR 0004); sem ele, importar e gerar arquivo respondem 503. */
    private readonly armazem: ArmazemArquivos | null,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-declaracoes' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async est(c: ContextoPorta): Promise<number> {
    const est = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-declaracoes' },
      (l) => estabelecimentoDaSessao(c, l),
    );
    if (est === null) throw semEstabelecimento();
    return est;
  }

  /**
   * Uma gravação: a guarda do arquivo (quando há) e a operação do Executor numa transação só (tudo ou nada). O arquivo
   * é guardado antes, com a própria trilha e imutável, e a operação recebe o id dele.
   */
  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string, arquivo: number | null) => Promise<Gravado>,
    arquivo?: { nome: string; mime: string; conteudo: Buffer; finalidade: string },
  ): Promise<Gravado> {
    const est = await this.est(c);
    if (arquivo && !this.armazem)
      throw new ErroOperacao(
        503,
        'armazenamento-indisponivel',
        'Armazenamento de arquivos indisponível',
        'Configure a raiz de arquivos da instalação.',
      );
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_DECLARACOES_ANS,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx, e) => {
        const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        const arq = typeof e['arquivo'] === 'number' ? e['arquivo'] : null;
        return fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10), arq);
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    return (await this.nucleo.escrever({ cliente: this.cliente, correlacao: ctx.correlacao }, async (e) => {
      let id: number | null = null;
      if (arquivo && this.armazem)
        id = (
          await this.armazem.guardar(
            {
              conteudo: arquivo.conteudo,
              nomeOriginal: arquivo.nome.slice(0, 255),
              tipoMime: arquivo.mime,
              finalidade: arquivo.finalidade,
              entidade: tabela,
              entidadeId: null,
              imutavel: true,
            },
            { ...ctx, chaveIdempotencia: `decl-arquivo:${randomUUID()}` },
            { escritor: e },
          )
        ).id;
      const r = await this.executor.executar(operacao, this.cliente, { arquivo: id }, ctx, { escritor: e });
      return r.resultado;
    })) as Gravado;
  }

  private static async operadoraDoEst(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }

  // ------------------------------------------------------------ TPS ------------------------------------------------
  apuracoesTps(c: ContextoPorta, op: number): Promise<ApuracaoTpsLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaDeclaracoesAnsPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT id, versao, ano, trimestre, vigencia_tabela, quantidade_vidas, valor_por_vida, valor_total, nosso_numero,
                vencimento, data_pagamento, valor_pago, situacao
           FROM apuracao_taxa_saude_suplementar
          WHERE operadora_saude_id = ? AND plano_comercializado_id IS NULL AND excluido_em IS NULL
          ORDER BY ano DESC, trimestre DESC, id DESC`,
        [op],
        { teto: 200 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        ano: Number(r['ano']),
        trimestre: inteiro(r['trimestre']),
        vigencia: dataIso(r['vigencia_tabela']) ?? '',
        vidas: Number(r['quantidade_vidas']),
        valorPorVida: numero(r['valor_por_vida']) ?? 0,
        valorTotal: numero(r['valor_total']) ?? 0,
        nossoNumero: texto(r['nosso_numero']),
        vencimento: dataIso(r['vencimento']),
        dataPagamento: dataIso(r['data_pagamento']),
        valorPago: numero(r['valor_pago']),
        situacao: textoObrigatorio(r['situacao']) as SituacaoApuracaoTps,
      }));
    });
  }

  /** Apura o trimestre com a mesma conta do demonstrativo (ativos no último dia de cada mês × valor vigente). */
  async apurarTps(c: ContextoPorta, op: number, ano: number, trimestre: number, trilha: Trilha) {
    await this.ler(c, (l, est) => PortaDeclaracoesAnsPropria.operadoraDoEst(l, est, op));
    const fim = fimDoTrimestre(ano, trimestre);
    const meses = [2, 1, 0].map((k) => ultimoDiaDoMes(ano, trimestre * 3 - k));
    const [planos, valores, ...porMes] = await Promise.all([
      this.fontesTps.planos(c, op),
      this.fontesTps.valoresTps(c),
      ...meses.map((m) => this.fontesTps.ativosNaData(c, op, m)),
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
    );
    const a = apurarTps(r, ano, trimestre);
    exigir(a.problemas);
    const g = await this.gravar(
      c,
      'operadora.tps.apurar',
      'apuracao_taxa_saude_suplementar',
      trilha,
      async (tx) => {
        const ja = await tx.consultarParaAtualizar(
          `SELECT id FROM apuracao_taxa_saude_suplementar WHERE operadora_saude_id = ? AND ano = ? AND trimestre = ?
            AND plano_comercializado_id IS NULL AND situacao <> 'cancelada' AND excluido_em IS NULL`,
          [op, ano, trimestre],
          { teto: 1 },
        );
        if (ja.length)
          throw recusa('ja-apurada', 'O trimestre já tem apuração; cancele-a para apurar de novo.', {
            campos: ['trimestre'],
          });
        const id = await tx.incluir('apuracao_taxa_saude_suplementar', {
          operadora_saude_id: op,
          plano_comercializado_id: null,
          periodicidade: 'trimestral',
          ano,
          trimestre,
          vigencia_tabela: a.vigencia,
          quantidade_vidas: a.quantidadeVidas,
          valor_por_vida: a.valorPorVida,
          valor_total: a.valorTotal,
          vencimento: a.vencimento,
          situacao: 'apurada',
        });
        return { id, versao: 1 };
      },
    );
    return { id: g.id, apuracao: a };
  }

  passoTps(c: ContextoPorta, id: number, versao: number, x: PassoTps, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.tps.passo',
      'apuracao_taxa_saude_suplementar',
      trilha,
      async (tx, est, hoje) => {
        const r = (
          await tx.consultarParaAtualizar(
            `SELECT a.id, a.versao, a.situacao, a.valor_total FROM apuracao_taxa_saude_suplementar a
             JOIN operadora_saude_estabelecimento oe ON oe.operadora_saude_id = a.operadora_saude_id
                  AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL
            WHERE a.id = ? AND a.excluido_em IS NULL`,
            [est, id],
            { teto: 1 },
          )
        )[0];
        if (!r) throw naoEncontrado();
        if (Number(r['versao']) !== versao) throw desatualizado();
        exigir(
          problemasDoPassoTps(
            textoObrigatorio(r['situacao']) as SituacaoApuracaoTps,
            numero(r['valor_total']) ?? 0,
            x,
            hoje,
          ),
        );
        const v: Record<string, unknown> = { situacao: x.para };
        if (x.para === 'guia_emitida') {
          v['nosso_numero'] = x.nossoNumero?.trim();
          if (x.vencimento) v['vencimento'] = x.vencimento;
        }
        if (x.para === 'paga') {
          v['data_pagamento'] = x.dataPagamento;
          v['valor_pago'] = x.valorPago;
        }
        await tx.alterar('apuracao_taxa_saude_suplementar', id, versao, v);
        return { id, versao: versao + 1 };
      },
    );
  }

  // ---------------------------------------------------- conferência cadastral ------------------------------------
  conferencias(c: ContextoPorta, op: number): Promise<ConferenciaLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaDeclaracoesAnsPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT c.id, c.competencia, c.importado_em, c.total_registros, c.situacao, c.observacao,
                (SELECT COUNT(*) FROM conferencia_cadastral_ans_item i WHERE i.conferencia_cadastral_ans_id = c.id
                    AND i.excluido_em IS NULL) AS total_divergencias,
                (SELECT COUNT(*) FROM conferencia_cadastral_ans_item i WHERE i.conferencia_cadastral_ans_id = c.id
                    AND i.correcao IN ('pendente','corrigir_cadastro','retificar_ans') AND i.excluido_em IS NULL) AS pendentes
           FROM conferencia_cadastral_ans c
          WHERE c.operadora_saude_id = ? AND c.excluido_em IS NULL
          ORDER BY c.competencia DESC, c.id DESC`,
        [op],
        { teto: 200 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
        importadaEm: instanteIso(r['importado_em']) ?? '',
        registros: Number(r['total_registros']),
        divergencias: Number(r['total_divergencias']),
        pendentes: Number(r['pendentes']),
        situacao: textoObrigatorio(r['situacao']),
        observacao: texto(r['observacao']),
      }));
    });
  }

  divergencias(c: ContextoPorta, conferencia: number): Promise<DivergenciaLida[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT i.id, i.versao, i.sequencia, i.beneficiario_plano_id, i.codigo_controle_ans, i.tipo_divergencia, i.campo,
                i.valor_cadastro, i.valor_ans, i.correcao, i.justificativa
           FROM conferencia_cadastral_ans_item i
           JOIN conferencia_cadastral_ans c ON c.id = i.conferencia_cadastral_ans_id
          WHERE c.id = ? AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = c.operadora_saude_id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)
            AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [conferencia, est],
        { teto: 100_000 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        sequencia: Number(r['sequencia']),
        beneficiario: inteiro(r['beneficiario_plano_id']),
        cco: texto(r['codigo_controle_ans']),
        tipo: textoObrigatorio(r['tipo_divergencia']),
        campo: texto(r['campo']),
        valorCadastro: texto(r['valor_cadastro']),
        valorAns: texto(r['valor_ans']),
        correcao: textoObrigatorio(r['correcao']) as CorrecaoDivergencia,
        justificativa: texto(r['justificativa']),
      }));
    });
  }

  /** Importa a base devolvida pela ANS, guarda o arquivo recebido e grava cada divergência com o cadastro próprio. */
  importarConferencia(
    c: ContextoPorta,
    op: number,
    x: { competencia: string; nome: string; base64: string },
    trilha: Trilha,
  ) {
    const conteudo = Buffer.from(x.base64, 'base64');
    const lido = lerArquivoConferencia(conteudo.toString('utf8'));
    if (lido.registros.length === 0) exigir(lido.problemas);
    const competencia = `${x.competencia}-01`;
    return this.gravar(
      c,
      'operadora.conferencia-ans.importar',
      'conferencia_cadastral_ans',
      trilha,
      async (tx, est, _hoje, arquivo) => {
        await PortaDeclaracoesAnsPropria.operadoraDoEst(tx, est, op);
        const cad = await tx.consultar(
          `SELECT b.id, b.codigo_controle_ans, b.situacao, b.fim_vigencia, pf.nome, pf.data_nascimento, pf.cpf, pf.cns,
                  pp.numero_registro_ans
             FROM beneficiario_plano b
             JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
             JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
             LEFT JOIN produto_plano pp ON pp.id = cp.produto_plano_id
            WHERE cp.operadora_saude_id = ? AND b.excluido_em IS NULL`,
          [op],
          { teto: 500_000 },
        );
        const divs = conferirCadastro(
          cad.map((r) => {
            const fim = dataIso(r['fim_vigencia']);
            return {
              id: Number(r['id']),
              cco: texto(r['codigo_controle_ans']),
              nome: textoObrigatorio(r['nome']),
              nascimento: dataIso(r['data_nascimento']),
              cpf: texto(r['cpf']),
              cns: texto(r['cns']),
              registroPlano: texto(r['numero_registro_ans']),
              ativo: textoObrigatorio(r['situacao']) === 'ativo' && (fim === null || fim >= competencia),
            };
          }),
          lido.registros,
        );
        const id = await tx.incluir('conferencia_cadastral_ans', {
          estabelecimento_id: est,
          operadora_saude_id: op,
          competencia,
          arquivo_id: arquivo,
          importado_em: new Date(),
          total_registros: lido.registros.length,
          // Registros da base da agência com alguma divergência (o beneficiário que a agência não devolveu é item à parte).
          total_divergencias: new Set(divs.filter((d) => d.tipo !== 'nao_localizado_ans').map((d) => d.cco))
            .size,
          situacao: divs.length ? 'em_conferencia' : 'conferida',
          conferida_em: divs.length ? null : new Date(),
          conferida_por_usuario_id: divs.length ? null : c.usuario,
          observacao: lido.problemas.length
            ? `${lido.problemas.length} linha(s) fora do leiaute não importada(s).`
            : null,
        });
        for (const [k, d] of divs.entries())
          await tx.incluir('conferencia_cadastral_ans_item', {
            conferencia_cadastral_ans_id: id,
            sequencia: k + 1,
            beneficiario_plano_id: d.beneficiario,
            codigo_controle_ans: d.cco?.slice(0, 12) ?? null,
            tipo_divergencia: d.tipo,
            campo: d.campo,
            valor_cadastro: d.valorCadastro?.slice(0, 250) ?? null,
            valor_ans: d.valorAns?.slice(0, 250) ?? null,
            ativo_na_ans: d.ativoNaAns,
            correcao: 'pendente',
          });
        return { id, versao: 1 };
      },
      { nome: x.nome, mime: 'text/csv', conteudo, finalidade: 'conferencia_cadastral_ans' },
    );
  }

  /** Trata a divergência; sem nenhuma pendente, a conferência fica concluída. */
  tratarDivergencia(
    c: ContextoPorta,
    item: number,
    versao: number,
    x: { para: CorrecaoDivergencia; justificativa: string | null },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.conferencia-ans.tratar',
      'conferencia_cadastral_ans_item',
      trilha,
      async (tx, est) => {
        const r = (
          await tx.consultarParaAtualizar(
            `SELECT i.id, i.versao, i.correcao, i.conferencia_cadastral_ans_id, c.versao AS versao_conferencia
             FROM conferencia_cadastral_ans_item i JOIN conferencia_cadastral_ans c ON c.id = i.conferencia_cadastral_ans_id
            WHERE i.id = ? AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = c.operadora_saude_id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)
              AND i.excluido_em IS NULL`,
            [item, est],
            { teto: 1 },
          )
        )[0];
        if (!r) throw naoEncontrado();
        if (Number(r['versao']) !== versao) throw desatualizado();
        exigir(
          problemasDaCorrecao(
            textoObrigatorio(r['correcao']) as CorrecaoDivergencia,
            x.para,
            x.justificativa,
          ),
        );
        const final = x.para === 'corrigida' || x.para === 'ignorada';
        await tx.alterar('conferencia_cadastral_ans_item', item, versao, {
          correcao: x.para,
          justificativa: x.justificativa?.trim() || null,
          ...(final ? { corrigido_em: new Date(), corrigido_por_usuario_id: c.usuario } : {}),
        });
        const conf = Number(r['conferencia_cadastral_ans_id']);
        const resta = await tx.uma<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM conferencia_cadastral_ans_item WHERE conferencia_cadastral_ans_id = ?
            AND correcao IN ('pendente','corrigir_cadastro','retificar_ans') AND excluido_em IS NULL`,
          [conf],
        );
        if (Number(resta?.['n'] ?? 0) === 0)
          await tx.alterar('conferencia_cadastral_ans', conf, Number(r['versao_conferencia']), {
            situacao: 'conferida',
            conferida_em: new Date(),
            conferida_por_usuario_id: c.usuario,
          });
        return { id: item, versao: versao + 1 };
      },
    );
  }

  // ---------------------------------------------------------------- DMED -----------------------------------------
  declaracoes(c: ContextoPorta, op: number): Promise<DeclaracaoLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaDeclaracoesAnsPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT d.id, d.versao, d.ano_calendario, d.ano_referencia, d.retificadora, d.retificada_declaracao_servicos_medicos_id,
                d.numero_recibo, d.responsavel_nome, d.situacao, d.arquivo_id,
                (SELECT COUNT(*) FROM declaracao_servicos_medicos_item i WHERE i.declaracao_servicos_medicos_id = d.id AND i.excluido_em IS NULL) AS itens,
                (SELECT COALESCE(SUM(i.valor_ano), 0) FROM declaracao_servicos_medicos_item i WHERE i.declaracao_servicos_medicos_id = d.id AND i.excluido_em IS NULL) AS total
           FROM declaracao_servicos_medicos d
          WHERE d.operadora_saude_id = ? AND d.excluido_em IS NULL
          ORDER BY d.ano_calendario DESC, d.id DESC`,
        [op],
        { teto: 200 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        anoCalendario: Number(r['ano_calendario']),
        anoReferencia: Number(r['ano_referencia']),
        prazo: prazoDmed(Number(r['ano_calendario'])),
        retificadora: booleano(r['retificadora']),
        retifica: inteiro(r['retificada_declaracao_servicos_medicos_id']),
        numeroRecibo: texto(r['numero_recibo']),
        responsavelNome: textoObrigatorio(r['responsavel_nome']),
        situacao: textoObrigatorio(r['situacao']) as SituacaoDmed,
        arquivo: r['arquivo_id'] !== null && r['arquivo_id'] !== undefined,
        itens: Number(r['itens']),
        total: numero(r['total']) ?? 0,
      }));
    });
  }

  itensDeclaracao(c: ContextoPorta, id: number): Promise<ItemDeclaracaoLido[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT i.sequencia, i.beneficiario_plano_id, i.titular_beneficiario_plano_id, i.tipo_beneficiario, i.valor_ano
           FROM declaracao_servicos_medicos_item i JOIN declaracao_servicos_medicos d ON d.id = i.declaracao_servicos_medicos_id
          WHERE d.id = ? AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = d.operadora_saude_id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)
            AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [id, est],
        { teto: 500_000 },
      );
      return rs.map((r) => ({
        sequencia: Number(r['sequencia']),
        beneficiario: Number(r['beneficiario_plano_id']),
        titular: inteiro(r['titular_beneficiario_plano_id']),
        tipo: textoObrigatorio(r['tipo_beneficiario']),
        valor: numero(r['valor_ano']) ?? 0,
      }));
    });
  }

  /**
   * Gera a declaração do ano-calendário: o que cada pessoa física pagou nas faturas pagas no ano (o lançamento do
   * beneficiário, ou o da fatura do beneficiário pagador, na proporção do valor pago), titular antes dos dependentes,
   * com o arquivo guardado. A fatura paga pelo contratante pessoa jurídica fica fora (não é pagamento da pessoa).
   */
  async gerarDmed(c: ContextoPorta, op: number, x: EntradaDmed, trilha: Trilha) {
    const dados = await this.ler(c, async (l, est) => {
      await PortaDeclaracoesAnsPropria.operadoraDoEst(l, est, op);
      const h = await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
      const opr = await l.uma(
        `SELECT o.registro_ans, pj.cnpj, pj.razao_social FROM operadora_saude o
           LEFT JOIN pessoa_juridica pj ON pj.id = o.pessoa_juridica_id WHERE o.id = ?`,
        [op],
      );
      const anterior = x.retifica
        ? await l.uma(
            `SELECT numero_recibo, ano_calendario FROM declaracao_servicos_medicos WHERE id = ? AND operadora_saude_id = ?
                AND situacao IN ('transmitida','aceita') AND excluido_em IS NULL`,
            [x.retifica, op],
          )
        : null;
      if (x.retifica && (!anterior || Number(anterior['ano_calendario']) !== x.anoCalendario))
        throw naoEncontrado();
      const pags = await l.consultar(
        `SELECT b.id, b.titular_beneficiario_plano_id, pf.nome, pf.cpf, pf.data_nascimento,
                SUM((CASE WHEN i.natureza = 'credito' THEN -i.valor ELSE i.valor END)
                    * (CASE WHEN f.situacao = 'paga_parcial' AND f.valor_total > 0 THEN COALESCE(f.valor_pago, 0) / f.valor_total ELSE 1 END)) AS pago
           FROM fatura_plano f
           JOIN fatura_plano_item i ON i.fatura_plano_id = f.id AND i.excluido_em IS NULL
           JOIN contrato_plano cp ON cp.id = f.contrato_plano_id
           JOIN contratante_plano ct ON ct.id = cp.contratante_plano_id
           JOIN beneficiario_plano b ON b.id = COALESCE(i.beneficiario_plano_id, f.responsavel_beneficiario_plano_id)
           JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
          WHERE cp.operadora_saude_id = ? AND f.excluido_em IS NULL
            AND f.situacao IN ('paga','paga_parcial') AND f.data_pagamento BETWEEN ? AND ?
            AND (f.responsavel_beneficiario_plano_id IS NOT NULL OR ct.pessoa_fisica_id IS NOT NULL)
          GROUP BY b.id, b.titular_beneficiario_plano_id, pf.nome, pf.cpf, pf.data_nascimento`,
        [op, `${x.anoCalendario}-01-01`, `${x.anoCalendario}-12-31`],
        { teto: 500_000 },
      );
      return { hoje: dataIso(h?.['hoje']) ?? '', opr, anterior, pags };
    });
    exigir(
      problemasDaDeclaracao(
        {
          anoCalendario: x.anoCalendario,
          retificadora: x.retifica !== null,
          reciboAnterior: texto(dados.anterior?.['numero_recibo']),
          responsavelCpf: x.responsavelCpf,
          responsavelNome: x.responsavelNome,
        },
        dados.hoje,
      ),
    );
    const m = montarDmed(
      x.anoCalendario,
      dados.pags.map((r) => ({
        beneficiario: Number(r['id']),
        titular: inteiro(r['titular_beneficiario_plano_id']),
        nome: textoObrigatorio(r['nome']),
        cpf: texto(r['cpf']),
        nascimento: dataIso(r['data_nascimento']),
        centavos: Math.round((numero(r['pago']) ?? 0) * 100),
      })),
    );
    exigir(m.problemas);
    if (m.itens.length === 0)
      exigir([
        {
          codigo: 'sem-pagamentos',
          campo: 'anoCalendario',
          detalhe: 'Nenhum pagamento de pessoa física no ano.',
        },
      ]);
    const cab = {
      anoCalendario: x.anoCalendario,
      anoReferencia: x.anoCalendario + 1,
      retificadora: x.retifica !== null,
      reciboAnterior: texto(dados.anterior?.['numero_recibo']),
      responsavelCpf: x.responsavelCpf.replace(/\D/g, ''),
      responsavelNome: x.responsavelNome.trim(),
      responsavelDdd: x.responsavelDdd,
      responsavelTelefone: x.responsavelTelefone,
      responsavelEmail: x.responsavelEmail,
      cnpj: texto(dados.opr?.['cnpj']) ?? '',
      razaoSocial: texto(dados.opr?.['razao_social']) ?? '',
      registroAns: texto(dados.opr?.['registro_ans']) ?? '',
    };
    const conteudo = Buffer.from(arquivoDmed(cab, m.itens), 'latin1');
    return this.gravar(
      c,
      'operadora.dmed.gerar',
      'declaracao_servicos_medicos',
      trilha,
      async (tx, est, _hoje, arquivo) => {
        // O declarante é a operadora (um CNPJ): a trava vale para todos os estabelecimentos ligados a ela.
        const doAno = await tx.consultarParaAtualizar(
          `SELECT id, situacao, retificadora FROM declaracao_servicos_medicos WHERE operadora_saude_id = ? AND ano_calendario = ?
              AND situacao IN ('em_preparacao','gerada','transmitida','aceita') AND excluido_em IS NULL`,
          [op, x.anoCalendario],
          { teto: 1_000 },
        );
        if (doAno.some((d) => ['em_preparacao', 'gerada'].includes(String(d['situacao']))))
          throw recusa(
            'declaracao-aberta',
            'Já há declaração deste ano ainda não entregue; entregue-a ou cancele-a.',
            {
              campos: ['anoCalendario'],
            },
          );
        exigir(
          problemasDaDeclaracao(
            {
              anoCalendario: cab.anoCalendario,
              retificadora: cab.retificadora,
              reciboAnterior: cab.reciboAnterior,
              responsavelCpf: cab.responsavelCpf,
              responsavelNome: cab.responsavelNome,
            },
            dados.hoje,
            doAno.some(
              (d) =>
                !booleano(d['retificadora']) && ['transmitida', 'aceita'].includes(String(d['situacao'])),
            ),
          ),
        );
        const id = await tx.incluir('declaracao_servicos_medicos', {
          estabelecimento_id: est,
          operadora_saude_id: op,
          ano_calendario: cab.anoCalendario,
          ano_referencia: cab.anoReferencia,
          retificadora: cab.retificadora,
          retificada_declaracao_servicos_medicos_id: x.retifica,
          tipo_declarante: 'operadora',
          situacao_especial: 'normal',
          responsavel_cpf: cab.responsavelCpf,
          responsavel_nome: cab.responsavelNome.slice(0, 150),
          responsavel_ddd: cab.responsavelDdd,
          responsavel_telefone: cab.responsavelTelefone,
          responsavel_email: cab.responsavelEmail,
          situacao: 'gerada',
          processado_em: new Date(),
          arquivo_id: arquivo,
        });
        for (const i of m.itens)
          await tx.incluir('declaracao_servicos_medicos_item', {
            declaracao_servicos_medicos_id: id,
            sequencia: i.sequencia,
            beneficiario_plano_id: i.beneficiario,
            titular_beneficiario_plano_id: i.tipo === 'dependente' ? i.titular : null,
            tipo_beneficiario: i.tipo,
            tipo_valor: 'mensalidade',
            valor_ano: i.valor,
            valor_anos_anteriores: 0,
            incluido_envio: true,
          });
        return { id, versao: 1 };
      },
      {
        nome: `DMED_${cab.anoReferencia}_${cab.registroAns || op}.txt`,
        mime: 'text/plain',
        conteudo,
        finalidade: 'declaracao_servicos_medicos',
      },
    );
  }

  passoDmed(
    c: ContextoPorta,
    id: number,
    versao: number,
    x: { para: SituacaoDmed; recibo: string | null },
    trilha: Trilha,
  ) {
    return this.gravar(c, 'operadora.dmed.passo', 'declaracao_servicos_medicos', trilha, async (tx, est) => {
      const r = (
        await tx.consultarParaAtualizar(
          `SELECT d.id, d.versao, d.situacao FROM declaracao_servicos_medicos d WHERE d.id = ? AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = d.operadora_saude_id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)
              AND d.excluido_em IS NULL`,
          [id, est],
          { teto: 1 },
        )
      )[0];
      if (!r) throw naoEncontrado();
      if (Number(r['versao']) !== versao) throw desatualizado();
      exigir(problemasDoPassoDmed(textoObrigatorio(r['situacao']) as SituacaoDmed, x.para, x.recibo));
      await tx.alterar('declaracao_servicos_medicos', id, versao, {
        situacao: x.para,
        ...(x.para === 'transmitida' ? { numero_recibo: x.recibo?.trim(), transmitido_em: new Date() } : {}),
      });
      return { id, versao: versao + 1 };
    });
  }

  /** O arquivo guardado da declaração (o mesmo que foi gerado; nunca regerado na leitura). */
  async arquivoDeclaracao(
    c: ContextoPorta,
    id: number,
  ): Promise<{ nome: string; base64: string; sha256: string } | null> {
    const ref = await this.ler(c, (l, est) =>
      l.uma(
        `SELECT d.arquivo_id FROM declaracao_servicos_medicos d WHERE d.id = ? AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe WHERE oe.operadora_saude_id = d.operadora_saude_id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL)
            AND d.excluido_em IS NULL`,
        [id, est],
      ),
    );
    const arq = inteiro(ref?.['arquivo_id']);
    if (arq === null || !this.armazem) return null;
    const r = await this.armazem.ler(
      {
        cliente: this.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'dmed-arquivo',
      },
      arq,
    );
    return { nome: r.metadado.nomeOriginal, base64: r.conteudo.toString('base64'), sha256: r.metadado.hash };
  }
}

function ultimoDiaDoMes(ano: number, mes: number): string {
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}

/** Os métodos da porta (a indisponível, sem núcleo, recusa cada um com 503). */
export const METODOS_DECLARACOES_ANS: ReadonlySet<string> = new Set([
  'apuracoesTps',
  'apurarTps',
  'passoTps',
  'conferencias',
  'divergencias',
  'importarConferencia',
  'tratarDivergencia',
  'declaracoes',
  'itensDeclaracao',
  'gerarDmed',
  'passoDmed',
  'arquivoDeclaracao',
]);
