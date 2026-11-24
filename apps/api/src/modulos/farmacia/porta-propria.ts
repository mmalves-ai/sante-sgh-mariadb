// Porta da farmácia hospitalar e da farmácia clínica sobre o banco do cliente (M29), pelo @sgh/nucleo: leituras
// somente leitura no modelo próprio (unidade de internação, local de estoque, insumo, lote e saldo, lista de controle
// especial, horário prescrito, dispensação e dose, entrega ao setor, razão do estoque, conferência e livro de
// controlados, avaliação e intervenção farmacêutica). Toda leitura filtra o estabelecimento da sessão e os registros
// excluídos; o insumo e as listas de controle especial são da rede inteira (não têm estabelecimento).
// Gravações pelo Executor (trilha no alvo gravado de fato, um evento no outbox por gravação e idempotência na mesma
// transação):
//   - a triagem, a decisão por item, a intervenção, a resposta do prescritor e a avaliação pelo horário
//     (gravador-avaliacao.ts);
//   - a dispensação por horário, a entrega, a devolução e o cancelamento da dose, a perda e a dupla conferência do
//     controlado, o fechamento do livro, a dispensação ambulatorial e o envio nacional (gravador-dispensacao.ts).
// Melhoria: o saldo do controlado e do lote vem do saldo por local (saldo_estoque, saldo_lote), não de recálculo de
// movimentos; os movimentos do controlado vêm do razão do estoque (movimento_estoque) com o documento de origem; horas
// no fuso do estabelecimento.
// Borda do contrato das telas (tipos.ts): o controle da entrega é a entrega ao setor (entrega_setor) e a situação dela
// vai como o número do contrato (7 em trânsito, 8 entregue, 9 estornada); o documento de saída é o documento de estoque
// da dispensação (id, número, ano e mês do movimento); a situação do horário vai como o código da regra de sugestão de
// devolução (S suspenso, N não administrado).
import { randomUUID } from 'node:crypto';
import type {
  AvaliarPrescricaoEntrada,
  CancelarDispensacaoEntrada,
  ConfirmarEntregaEntrada,
  DevolverDoseEntrada,
  DispensarHorarioEntrada,
  GravarHorariosPadraoEntrada,
  GravarRegraIntegracaoEntrada,
  ParametrosIntegracaoEditaveis,
  RegistrarPerdaControladoEntrada,
} from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z, type ZodType } from 'zod';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import { type ExtrasGravacaoFarmacia, gravadorAvaliacao, TABELAS_AVALIACAO } from './gravador-avaliacao.js';
import {
  ENTREGA_DO_NUMERO,
  gravadorDispensacao,
  NUMERO_DA_ENTREGA,
  TABELAS_DISPENSACAO,
} from './gravador-dispensacao.js';
import { gravadorParametros, lerParametrosEditaveis, TABELAS_PARAMETROS } from './gravador-parametros.js';
import { ENTRADAS_FARMACIA } from './operacoes.js';
import {
  type ContextoFarmacia,
  type GravadorSghFarmacia,
  METODOS_PORTA_FARMACIA,
  type ParametrosIntegracaoLidos,
  type PortaFarmacia,
  type UnidadeLida,
} from './porta.js';
import type {
  AvaliacaoRegistrada,
  DocumentoSaida,
  DoseDaFila,
  DoseDispensada,
  EntregaRegistrada,
  HorarioDaFila,
  IntervencaoRegistrada,
  ItemControlado,
  ItemFarmacia,
  MovimentoControlado,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoFarmacia = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';

/** Teto das listas lidas de uma vez. */
const TETO = 500;

function minutoCivil(v: unknown, fuso: string): string {
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data}T${c.hora.slice(0, 5)}`;
}

/** Código da situação do horário na regra de sugestão de devolução (contrato das telas): S suspenso, N não administrado. */
const SITUACAO_SUSPENSO = 'S';
const CODIGO_DA_CHECAGEM: Readonly<Record<string, string>> = {
  nao_administrado: 'N',
  recusado_paciente: 'N',
  administrado: 'A',
  administrado_parcial: 'A',
  pendente: 'P',
  atrasado: 'P',
  adiado: 'P',
};
/** O documento de estoque no livro e nos movimentos do controlado: S saída, D devolução, P perda; A ambulatorial. */
const PREFIXO_DOCUMENTO: Readonly<Record<string, string>> = {
  saida_paciente: 'S ',
  devolucao_interna: 'D ',
  baixa: 'P ',
};
const PREFIXO_DISPENSACAO = 'A ';

function dataCivil(v: unknown, fuso: string): string {
  return civil(v instanceof Date ? v : new Date(String(v)), fuso).data;
}

/** Parecer por item (modelo) → decisão da tela. */
const DECISAO_DO_PARECER: Readonly<Record<string, string>> = {
  aprovado: 'valido',
  aprovado_com_ressalva: 'valido',
  recusado: 'nao-aprovado',
  substituido: 'pendencia-revisao-medica',
  revisao_medica: 'pendencia-revisao-medica',
};

const SQL_INTERVENCAO = `
  SELECT iv.id, iv.avaliacao_farmaceutica_id, iv.prescricao_item_id, ti.codigo AS tipo, iv.proposta,
         iv.realizada_em, iv.aceite, iv.aceite_em, iv.justificativa_recusa, a.atendimento_id,
         ua.login AS autor, ur.login AS respondente,
         (SELECT up.login FROM usuario_vinculo_profissional uv JOIN usuario up ON up.id = uv.usuario_id
           WHERE uv.profissional_id = iv.prescritor_profissional_id AND uv.estabelecimento_id = a.estabelecimento_id
             AND uv.excluido_em IS NULL ORDER BY uv.vigencia_inicio DESC LIMIT 1) AS prescritor
    FROM intervencao_farmaceutica iv
    JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id
    JOIN tipo_intervencao_farmaceutica ti ON ti.id = iv.tipo_intervencao_farmaceutica_id
    LEFT JOIN usuario ua ON ua.id = iv.criado_por
    LEFT JOIN usuario ur ON ur.id = iv.alterado_por
   WHERE a.estabelecimento_id = ? AND iv.excluido_em IS NULL AND a.excluido_em IS NULL`;

function intervencaoDe(r: Linha, fuso: string): IntervencaoRegistrada {
  const aceite = texto(r['aceite']);
  const respondida = !['pendente', 'sem_resposta'].includes(aceite);
  return {
    id: n(r['id']),
    avaliacao: n(r['avaliacao_farmaceutica_id']),
    item: n(r['prescricao_item_id']),
    tipo: texto(r['tipo']),
    texto: texto(r['proposta']),
    autor: texto(r['autor']),
    prescritor: textoOuNulo(r['prescritor']),
    criadaEm: minutoCivil(r['realizada_em'], fuso),
    estado: respondida ? 'respondida' : 'aberta',
    resposta: aceite === 'recusada' ? 'recusada' : aceite.startsWith('aceita') ? 'aceita' : null,
    justificativa: textoOuNulo(r['justificativa_recusa']),
    respondente: respondida ? textoOuNulo(r['respondente']) : null,
    respondidaEm: r['aceite_em'] ? minutoCivil(r['aceite_em'], fuso) : null,
    atendimento: n(r['atendimento_id']),
  };
}

export class PortaFarmaciaPropria implements PortaFarmacia {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFarmacia,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFarmacia, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const r = await l.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [est],
    );
    return r?.fuso_horario || FUSO_PADRAO;
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoPortaM18, op: string): Promise<LiberacaoGravacao> {
    if (!ENTRADAS_FARMACIA[op])
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return { pode: true, codigo: null, motivo: null };
  }

  /** As operações das telas (suprimentos.*) numa operação do Executor, com a entrada conferida pelo mesmo Zod. */
  async executar(
    c: ContextoPortaM18,
    op: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    const esquema = ENTRADAS_FARMACIA[op];
    if (!esquema)
      throw new ErroOperacao(
        400,
        'operacao-desconhecida',
        'Operação desconhecida',
        `A operação ${op} não existe.`,
      );
    const a = esquema.safeParse(entrada);
    if (!a.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(a.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da farmácia exige o usuário da sessão.');
    const usuario = c.usuario;
    const reautenticadoEm = ctx.reautenticadoEm ?? null;
    const extras: ExtrasGravacaoFarmacia = { alvo: null, eventos: [] };
    const operacao = definirOperacao({
      nome: `farmacia.${op
        .replace(/^suprimentos\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`,
      tabelas: [...TABELAS_DISPENSACAO, ...TABELAS_AVALIACAO, ...TABELAS_PARAMETROS],
      entrada: esquema as ZodType<Record<string, unknown>>,
      gravar: async (tx, e): Promise<ResultadoOperacao> => {
        const g = gravadorDispensacao(tx, est, usuario, extras);
        switch (op) {
          case 'suprimentos.dispensarHorario':
            return g.dispensarHorario(e as DispensarHorarioEntrada);
          case 'suprimentos.confirmarEntrega':
            return g.confirmarEntrega(e as ConfirmarEntregaEntrada);
          case 'suprimentos.devolverDose':
            return g.devolverDose(e as DevolverDoseEntrada);
          case 'suprimentos.cancelarDispensacao':
            return g.cancelarDispensacao(e as CancelarDispensacaoEntrada);
          case 'suprimentos.registrarPerdaControlado':
            return g.registrarPerdaControlado(e as RegistrarPerdaControladoEntrada, reautenticadoEm);
          case 'suprimentos.avaliarPrescricao':
            return avaliarPeloHorario(tx, est, usuario, extras, e as AvaliarPrescricaoEntrada);
          case 'suprimentos.gravarRegraIntegracao':
            return gravadorParametros(tx, est, extras).gravarRegraIntegracao(
              e as GravarRegraIntegracaoEntrada,
            );
          case 'suprimentos.gravarHorariosPadrao':
            return gravadorParametros(tx, est, extras).gravarHorariosPadrao(e as GravarHorariosPadraoEntrada);
          default:
            throw new ErroOperacao(
              400,
              'operacao-desconhecida',
              'Operação desconhecida',
              `A operação ${op} não existe.`,
            );
        }
      },
      alvo: () => extras.alvo ?? { tabela: 'dispensacao', id: null },
      eventos: () => extras.eventos,
    });
    const ctxOp: ContextoOperacao = {
      ...contextoDe(c),
      chaveIdempotencia: ctx.chaveIdempotencia,
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
    };
    const r = await this.executor.executar(operacao, c.cliente, a.data as Record<string, unknown>, ctxOp);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  /**
   * As gravações diretas das telas numa operação do Executor (trilha, outbox e idempotência na mesma transação): a
   * triagem, a decisão, a intervenção e a resposta (gravador-avaliacao.ts); a dupla conferência e o fechamento do livro
   * do controlado, a dispensação ambulatorial e a escrituração do envio nacional (gravador-dispensacao.ts).
   */
  async gravarSgh<T>(
    c: ContextoFarmacia,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorSghFarmacia) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação da farmácia exige o usuário da sessão.');
    const usuario = c.usuario;
    let saida: { valor: T } | null = null;
    const extras: ExtrasGravacaoFarmacia = { alvo: null, eventos: [] };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'farmacia.gravacao-direta',
      tabelas: [...TABELAS_AVALIACAO, ...TABELAS_DISPENSACAO],
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        const d = gravadorDispensacao(tx, est, usuario, extras);
        saida = {
          valor: await fn({
            ...gravadorAvaliacao(tx, est, usuario, extras),
            conferirControlado: d.conferirControlado,
            fecharLivro: d.fecharLivro,
            dispensarAmbulatorial: d.dispensarAmbulatorial,
            escriturarSngpc: d.escriturarSngpc,
          }),
        };
        return {} as ResultadoOperacao;
      },
      // O alvo é a linha gravada de fato (não o rótulo da tela).
      alvo: () => extras.alvo ?? { tabela: 'avaliacao_farmaceutica', id: null },
      eventos: () => extras.eventos,
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `farmacia:${randomUUID()}`;
    await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    if (!saida) throw new Error('Gravação da farmácia sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoFarmacia) {
    return this.ler(c, async (l, est) => ({
      agora: new Date(),
      hoje: relogioNoFuso(await this.fuso(l, est)).hoje,
    }));
  }

  /** As unidades de internação do estabelecimento, com quantos internados (internação ativa) cada uma tem. */
  unidades(c: ContextoFarmacia): Promise<UnidadeLida[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT u.codigo, u.descricao,
                  (SELECT COUNT(*) FROM internacao i WHERE i.unidade_internacao_id = u.id AND i.estabelecimento_id = u.estabelecimento_id
                      AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL) AS internados
             FROM unidade_internacao u
            WHERE u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.ativo
            ORDER BY u.descricao LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({
        unidade: texto(r['codigo']),
        nome: texto(r['descricao']),
        internados: n(r['internados']),
      })),
    );
  }

  /** Os locais de estoque que dispensam (farmácia central ou satélite) e ativos. */
  locais(c: ContextoFarmacia) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome FROM local_estoque
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo
              AND tipo IN ('farmacia_central','farmacia_satelite')
            ORDER BY nome LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  /** Os lotes com saldo do insumo no local (validade primeiro), sem os bloqueados nem os vencidos. */
  lotes(c: ContextoFarmacia, item: number, local: number) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT li.id, li.numero_lote, li.validade, sl.quantidade
             FROM saldo_lote sl
             JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
             JOIN local_estoque le ON le.id = sl.local_estoque_id
            WHERE sl.estabelecimento_id = ? AND le.estabelecimento_id = ? AND sl.local_estoque_id = ?
              AND li.insumo_id = ? AND sl.excluido_em IS NULL AND sl.quantidade > 0 AND NOT sl.bloqueado
              AND li.situacao = 'liberado' AND li.validade >= CURRENT_DATE
            ORDER BY li.validade, li.numero_lote LIMIT 100`,
          [est, est, local, item],
        )
      ).map((r) => ({
        id: n(r['id']),
        lote: texto(r['numero_lote']),
        validade: dataIso(r['validade']),
        quantidade: n(r['quantidade']),
      })),
    );
  }

  /** O cadastro do insumo (rede inteira): rastreabilidade, lista de controle, classe e código de barras. */
  itens(c: ContextoFarmacia, codigos: readonly number[]): Promise<Map<number, ItemFarmacia>> {
    const ids = [...new Set(codigos)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.id, i.controla_lote, i.controlado, i.antimicrobiano, i.codigo_gtin, lc.codigo_lista
           FROM insumo i LEFT JOIN lista_controle_especial lc ON lc.id = i.lista_controle_especial_id
          WHERE i.id IN (${lista(ids.length)}) AND i.excluido_em IS NULL`,
        ids,
      );
      return new Map(
        linhas.map((r) => [
          n(r['id']),
          {
            codigo: n(r['id']),
            rastreavel: verdadeiro(r['controla_lote']),
            portaria: textoOuNulo(r['codigo_lista']),
            psico: verdadeiro(r['controlado']),
            antimicrobiano: verdadeiro(r['antimicrobiano']),
            barras: textoOuNulo(r['codigo_gtin']),
            envioAvaliacao: null,
          },
        ]),
      );
    });
  }

  /** A decisão da avaliação farmacêutica por item prescrito (o parecer mais recente de cada item). */
  avaliacoes(c: ContextoFarmacia, itens: readonly number[]): Promise<Map<number, AvaliacaoRegistrada>> {
    const ids = [...new Set(itens)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT ai.id, ai.prescricao_item_id, ai.parecer, ai.avaliado_em, u.login
           FROM avaliacao_farmaceutica_item ai
           JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id
           LEFT JOIN usuario u ON u.id = ai.criado_por
          WHERE a.estabelecimento_id = ? AND ai.prescricao_item_id IN (${lista(ids.length)})
            AND ai.excluido_em IS NULL AND a.excluido_em IS NULL
          ORDER BY ai.avaliado_em, ai.id`,
        [est, ...ids],
      );
      const r = new Map<number, AvaliacaoRegistrada>();
      for (const x of linhas)
        r.set(n(x['prescricao_item_id']), {
          id: n(x['id']),
          item: n(x['prescricao_item_id']),
          estado: 'decidido',
          decisao: DECISAO_DO_PARECER[texto(x['parecer'])] ?? null,
          destino: 'humana',
          prioridade: 0,
          achados: [],
          desde: minutoCivil(x['avaliado_em'], fuso),
          farmaceutico: textoOuNulo(x['login']),
        });
      return r;
    });
  }

  intervencoesDosItens(c: ContextoFarmacia, itens: readonly number[]): Promise<IntervencaoRegistrada[]> {
    const ids = [...new Set(itens)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `${SQL_INTERVENCAO} AND iv.prescricao_item_id IN (${lista(ids.length)}) ORDER BY iv.realizada_em, iv.id`,
          [est, ...ids],
        )
      ).map((r) => intervencaoDe(r, fuso));
    });
  }

  /** As intervenções abertas dirigidas ao prescritor (pelo login vinculado ao profissional). */
  intervencoesDoPrescritor(c: ContextoFarmacia, login: string): Promise<IntervencaoRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `${SQL_INTERVENCAO} AND iv.aceite = 'pendente' AND iv.prescritor_profissional_id IN (
             SELECT uv.profissional_id FROM usuario_vinculo_profissional uv JOIN usuario u ON u.id = uv.usuario_id
              WHERE u.login = ? AND uv.estabelecimento_id = ? AND uv.excluido_em IS NULL AND uv.profissional_id IS NOT NULL)
           ORDER BY iv.realizada_em, iv.id LIMIT ${TETO}`,
          [est, login, est],
        )
      ).map((r) => intervencaoDe(r, fuso));
    });
  }

  intervencao(c: ContextoFarmacia, id: number): Promise<IntervencaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_INTERVENCAO} AND iv.id = ?`, [est, id]);
      return r ? intervencaoDe(r, await this.fuso(l, est)) : null;
    });
  }

  totaisIntervencoes(c: ContextoFarmacia, desde: Date) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT SUM(iv.aceite = 'pendente') AS abertas, SUM(iv.aceite IN ('aceita','aceita_parcial')) AS aceitas,
                SUM(iv.aceite = 'recusada') AS recusadas
           FROM intervencao_farmaceutica iv JOIN avaliacao_farmaceutica a ON a.id = iv.avaliacao_farmaceutica_id
          WHERE a.estabelecimento_id = ? AND iv.realizada_em >= ? AND iv.excluido_em IS NULL AND a.excluido_em IS NULL`,
        [est, desde],
      );
      return { abertas: n(r?.['abertas']), aceitas: n(r?.['aceitas']), recusadas: n(r?.['recusadas']) };
    });
  }

  /** Os insumos controlados (com lista de controle especial) com o saldo no estabelecimento. */
  controlados(c: ContextoFarmacia): Promise<ItemControlado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT i.id, i.nome, lc.codigo_lista,
                  COALESCE((SELECT SUM(se.quantidade) FROM saldo_estoque se
                             WHERE se.insumo_id = i.id AND se.estabelecimento_id = ? AND se.excluido_em IS NULL), 0) AS estoque
             FROM insumo i JOIN lista_controle_especial lc ON lc.id = i.lista_controle_especial_id
            WHERE i.excluido_em IS NULL AND i.situacao = 'ativo'
            ORDER BY i.nome LIMIT ${TETO}`,
          [est],
        )
      ).map((r) => ({
        item: n(r['id']),
        nome: texto(r['nome']),
        portaria: texto(r['codigo_lista']),
        estoque: n(r['estoque']),
      })),
    );
  }

  /** F3.6 (05-SUP linha 7): as regras de integração, as grades de horário padrão e as opções da tela. */
  parametrosEditaveis(c: ContextoFarmacia): Promise<ParametrosIntegracaoEditaveis> {
    return this.ler(c, (l, est) => lerParametrosEditaveis(l, est));
  }

  async parametrosIntegracao(): Promise<ParametrosIntegracaoLidos> {
    // A integração com o sistema de dispensação automatizada não existe no modelo próprio: nada a configurar.
    return { centros: [], horarios: [], validacaoFarmaceutica: false, tipos: [] };
  }

  /** Os horários prescritos da unidade na janela (só itens com produto de estoque), com o paciente e o leito. */
  filaDaUnidade(c: ContextoFarmacia, o: { unidade: string; inicio: Date; fim: Date }) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT h.id, h.prescricao_item_id, h.prescricao_id, h.atendimento_id, h.previsto_em, h.suspenso,
                h.quantidade_prevista, pi.quantidade AS item_quantidade, pi.situacao AS item_situacao,
                pi.prioridade AS item_prioridade, p.prioridade AS prescricao_prioridade, p.situacao AS prescricao_situacao,
                tip.categoria, ip.descricao, ip.insumo_id, ins.alta_vigilancia, ins.antimicrobiano,
                up.sigla AS unidade_dose, COALESCE(vu.sigla, vu.descricao) AS via, i.paciente_id, lh.codigo AS leito,
                pf.nome, (d.id IS NOT NULL AND d.situacao <> 'cancelada') AS dispensada,
                EXISTS (SELECT 1 FROM alergia_paciente ap WHERE ap.paciente_id = i.paciente_id AND ap.ativa
                          AND ap.tipo_registro IN ('alergia','intolerancia') AND ap.excluido_em IS NULL) AS alergia,
                EXISTS (SELECT 1 FROM avaliacao_farmaceutica_item ai
                          JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id
                         WHERE ai.prescricao_item_id = pi.id AND a.estabelecimento_id = h.estabelecimento_id
                           AND ai.parecer IN ('aprovado','aprovado_com_ressalva')
                           AND ai.excluido_em IS NULL AND a.excluido_em IS NULL) AS validada
           FROM horario_administracao h
           JOIN internacao i ON i.atendimento_id = h.atendimento_id AND i.estabelecimento_id = h.estabelecimento_id
                            AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL
           JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id AND ui.estabelecimento_id = h.estabelecimento_id
           JOIN prescricao_item pi ON pi.id = h.prescricao_item_id AND pi.excluido_em IS NULL
           JOIN prescricao p ON p.id = h.prescricao_id AND p.excluido_em IS NULL AND p.situacao NOT IN ('rascunho','cancelada')
           JOIN tipo_item_prescricao tip ON tip.id = pi.tipo_item_prescricao_id
           JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id AND ip.insumo_id IS NOT NULL
           JOIN insumo ins ON ins.id = ip.insumo_id
           JOIN paciente pa ON pa.id = i.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN unidade_prescricao up ON up.id = COALESCE(h.unidade_prescricao_id, pi.unidade_prescricao_id)
           LEFT JOIN via_de_uso vu ON vu.id = pi.via_de_uso_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN dispensacao d ON d.id = h.dispensacao_id
          WHERE h.estabelecimento_id = ? AND ui.codigo = ? AND h.excluido_em IS NULL
            AND h.previsto_em >= ? AND h.previsto_em < ?
          ORDER BY h.previsto_em, h.id LIMIT ${TETO + 1}`,
        [est, o.unidade, o.inicio, o.fim],
      );
      const doses: DoseDaFila[] = linhas.slice(0, TETO).map((r) => {
        const horario: HorarioDaFila = {
          id: n(r['id']),
          item: n(r['prescricao_item_id']),
          prescricao: n(r['prescricao_id']),
          atendimento: n(r['atendimento_id']),
          previsto: minutoCivil(r['previsto_em'], fuso),
          suspenso:
            verdadeiro(r['suspenso']) ||
            ['suspenso', 'suspenso_correcao', 'cancelado'].includes(texto(r['item_situacao'])) ||
            texto(r['prescricao_situacao']) === 'suspensa',
          tipo: texto(r['categoria']),
          descricao: texto(r['descricao']),
          dose:
            r['quantidade_prevista'] !== null
              ? n(r['quantidade_prevista'])
              : r['item_quantidade'] !== null
                ? n(r['item_quantidade'])
                : null,
          unidadeDose: textoOuNulo(r['unidade_dose']),
          via: textoOuNulo(r['via']),
          produto: n(r['insumo_id']),
          altaVigilancia: verdadeiro(r['alta_vigilancia']),
          antimicrobiano: verdadeiro(r['antimicrobiano']),
        };
        return {
          horario,
          atendimento: n(r['atendimento_id']),
          paciente: n(r['paciente_id']),
          leito: texto(r['leito']),
          iniciais: iniciais(r['nome']),
          alergia: verdadeiro(r['alergia']),
          dispensada: verdadeiro(r['dispensada']),
          validadaAntes: verdadeiro(r['validada']),
          urgente:
            ['urgente', 'agora'].includes(texto(r['item_prioridade'])) ||
            texto(r['prescricao_prioridade']) === 'urgente',
        };
      });
      return { doses, cortada: linhas.length > TETO };
    });
  }

  /** O item prescrito: a justificativa de alergia registrada e o produto de estoque. */
  itensPrescritos(c: ContextoFarmacia, lancamentos: readonly number[]) {
    const ids = [...new Set(lancamentos)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0)
      return Promise.resolve(new Map<number, { alergiaJustificada: boolean; produto: number | null }>());
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT pi.id, pi.justificativa_alergia, ip.insumo_id
           FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id
           LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
          WHERE pi.id IN (${lista(ids.length)}) AND p.estabelecimento_id = ? AND pi.excluido_em IS NULL AND p.excluido_em IS NULL`,
        [...ids, est],
      );
      return new Map(
        linhas.map((r) => [
          n(r['id']),
          {
            alergiaJustificada: !!textoOuNulo(r['justificativa_alergia']),
            produto: r['insumo_id'] === null ? null : n(r['insumo_id']),
          },
        ]),
      );
    });
  }

  /** As doses dispensadas ao atendimento desde a data (as canceladas ficam de fora). */
  dosesDoAtendimento(c: ContextoFarmacia, atendimento: number, desde: Date): Promise<DoseDispensada[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `${SQL_DOSE} AND d.atendimento_id = ? AND d.dispensado_em >= ? ORDER BY d.dispensado_em, dd.id LIMIT ${TETO}`,
          [est, atendimento, desde],
        )
      ).map((r) => doseDe(r, fuso));
    });
  }

  /** A situação da checagem de cada horário, no código da regra de sugestão de devolução. */
  situacoes(c: ContextoFarmacia, horarios: readonly number[]) {
    const ids = [...new Set(horarios)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map<number, { situacao: string; em: string | null }>());
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT h.id, h.suspenso, h.suspenso_em, h.situacao_checagem_em, sc.categoria
           FROM horario_administracao h JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
          WHERE h.id IN (${lista(ids.length)}) AND h.estabelecimento_id = ? AND h.excluido_em IS NULL`,
        [...ids, est],
      );
      return new Map(
        linhas.map((r) => {
          const suspenso = verdadeiro(r['suspenso']) || texto(r['categoria']) === 'suspenso';
          const quando = suspenso && r['suspenso_em'] ? r['suspenso_em'] : r['situacao_checagem_em'];
          return [
            n(r['id']),
            {
              situacao: suspenso
                ? SITUACAO_SUSPENSO
                : (CODIGO_DA_CHECAGEM[texto(r['categoria'])] ?? texto(r['categoria'])),
              em: quando ? minutoCivil(quando, fuso) : null,
            },
          ] as const;
        }),
      );
    });
  }

  /** As entregas ao setor na situação pedida (7 em trânsito, 8 entregue, 9 estornada), mais recentes primeiro. */
  entregas(c: ContextoFarmacia, o: { situacao: number; centroCusto?: number }): Promise<EntregaRegistrada[]> {
    const situacao = ENTREGA_DO_NUMERO[o.situacao];
    if (!situacao)
      return Promise.reject(
        recusa('situacao-invalida', 'Situação de entrega inválida (7, 8 ou 9).', { campos: ['situacao'] }),
      );
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT es.id, es.situacao, es.saida_em, es.entregue_em, es.estornado_em, d.atendimento_id, d.centro_custo_id,
                ue.login AS entregador, ur.login AS recebedor, de.id AS doc_id, de.numero AS doc_numero, de.movimentado_em,
                (SELECT COUNT(*) FROM entrega_setor_item x WHERE x.entrega_setor_id = es.id AND x.excluido_em IS NULL) AS itens
           FROM entrega_setor es
           JOIN entrega_setor_item esi ON esi.entrega_setor_id = es.id AND esi.excluido_em IS NULL
                AND esi.id = (SELECT MIN(y.id) FROM entrega_setor_item y WHERE y.entrega_setor_id = es.id AND y.excluido_em IS NULL)
           JOIN dispensacao d ON d.id = esi.dispensacao_id AND d.excluido_em IS NULL
           LEFT JOIN documento_estoque de ON de.dispensacao_id = d.id AND de.tipo = 'saida_paciente' AND de.excluido_em IS NULL
           LEFT JOIN usuario ue ON ue.id = es.entregador_usuario_id
           LEFT JOIN usuario ur ON ur.id = es.recebedor_usuario_id
          WHERE es.estabelecimento_id = ? AND es.situacao = ? AND es.excluido_em IS NULL
            ${o.centroCusto ? 'AND d.centro_custo_id = ?' : ''}
          ORDER BY es.saida_em DESC, es.id DESC LIMIT ${TETO}`,
        o.centroCusto ? [est, situacao, o.centroCusto] : [est, situacao],
      );
      return linhas.map((r) => {
        const desde =
          situacao === 'entregue'
            ? r['entregue_em']
            : situacao === 'estornada'
              ? r['estornado_em']
              : r['saida_em'];
        return {
          controle: n(r['id']),
          situacao: o.situacao,
          desde: minutoCivil(desde ?? r['saida_em'], fuso),
          saida: documentoDe(r, fuso),
          atendimento: n(r['atendimento_id']),
          centroCusto: n(r['centro_custo_id']),
          usuario: texto(situacao === 'entregue' ? r['recebedor'] : r['entregador']),
          itens: n(r['itens']),
        };
      });
    });
  }

  /** As doses do documento de saída (o documento de estoque da dispensação). */
  dosesDaSaida(c: ContextoFarmacia, saida: number) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (await l.consultar(`${SQL_DOSE} AND de.id = ? ORDER BY dd.id LIMIT ${TETO}`, [est, saida])).map(
        (r) => {
          const d = doseDe(r, fuso);
          return {
            dose: d.dose,
            item: d.item,
            descricao: d.descricao,
            quantidade: d.quantidade,
            barras: d.barras,
            lote: d.lote,
            validade: d.validade,
          };
        },
      );
    });
  }

  /** O leito e as iniciais do paciente de cada atendimento (a internação aberta, ou a mais recente). */
  leitos(c: ContextoFarmacia, regs: readonly number[]) {
    const ids = [...new Set(regs)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve(new Map<number, { leito: string; iniciais: string }>());
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT a.id, pf.nome,
                (SELECT lh.codigo FROM internacao i LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
                  WHERE i.atendimento_id = a.id AND i.excluido_em IS NULL
                  ORDER BY i.situacao IN ('ativa','alta_medica') DESC, i.id DESC LIMIT 1) AS leito
           FROM atendimento a JOIN paciente pa ON pa.id = a.paciente_id JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE a.id IN (${lista(ids.length)}) AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [...ids, est],
      );
      return new Map(
        linhas.map((r) => [n(r['id']), { leito: texto(r['leito']), iniciais: iniciais(r['nome']) }] as const),
      );
    });
  }

  /** O aceite de cada entrega recebida: quem recebeu, quando e o modo (leitura da etiqueta ou tablet). */
  aceites(c: ContextoFarmacia, controles: readonly number[]) {
    const ids = [...new Set(controles)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0)
      return Promise.resolve(new Map<number, { autor: string; em: string; modo: string }>());
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT es.id, es.entregue_em, es.modo_confirmacao, u.login
           FROM entrega_setor es LEFT JOIN usuario u ON u.id = es.recebedor_usuario_id
          WHERE es.id IN (${lista(ids.length)}) AND es.estabelecimento_id = ? AND es.entregue_em IS NOT NULL AND es.excluido_em IS NULL`,
        [...ids, est],
      );
      return new Map(
        linhas.map(
          (r) =>
            [
              n(r['id']),
              {
                autor: texto(r['login']),
                em: minutoCivil(r['entregue_em'], fuso),
                modo: texto(r['modo_confirmacao']),
              },
            ] as const,
        ),
      );
    });
  }

  /** As doses dispensadas com outro produto que não o do item prescrito (a substituição feita na farmácia). */
  substituicoes(c: ContextoFarmacia, horarios: readonly number[]) {
    const ids = [...new Set(horarios)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `SELECT di.id, dd.horario_administracao_id, di.insumo_id, ins.nome, di.quantidade, um.sigla, u.login, di.criado_em
             FROM dose_dispensada dd
             JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id AND di.excluido_em IS NULL
             JOIN dispensacao d ON d.id = di.dispensacao_id AND d.excluido_em IS NULL
             JOIN prescricao_item pi ON pi.id = di.prescricao_item_id
             LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
             JOIN insumo ins ON ins.id = di.insumo_id
             JOIN unidade_medida um ON um.id = di.unidade_medida_id
             LEFT JOIN usuario u ON u.id = di.criado_por
            WHERE d.estabelecimento_id = ? AND dd.horario_administracao_id IN (${lista(ids.length)})
              AND dd.excluido_em IS NULL AND (ip.insumo_id IS NULL OR ip.insumo_id <> di.insumo_id)
            ORDER BY di.id`,
          [est, ...ids],
        )
      ).map((r) => ({
        id: n(r['id']),
        horario: r['horario_administracao_id'] === null ? null : n(r['horario_administracao_id']),
        item: n(r['insumo_id']),
        descricao: texto(r['nome']),
        quantidade: n(r['quantidade']),
        unidade: texto(r['sigla']),
        usuario: texto(r['login']),
        em: minutoCivil(r['criado_em'], fuso),
      }));
    });
  }

  /** Os lançamentos do razão do estoque dos controlados no período (o dia final inteiro), no estabelecimento. */
  movimentos(
    c: ContextoFarmacia,
    o: { itens: readonly number[]; inicio: Date; fim: Date },
  ): Promise<MovimentoControlado[]> {
    const ids = [...new Set(o.itens)].filter((x) => x > 0).slice(0, TETO);
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT m.id, m.insumo_id, m.ocorrido_em, m.natureza, tm.natureza AS tipo, m.quantidade_estoque,
                m.documento_estoque_id, de.numero AS doc_numero, de.tipo AS doc_tipo, d.id AS disp_id, d.numero AS disp_numero,
                COALESCE(p.prescritor_profissional_id, rc.prescritor_profissional_id) AS prescritor
           FROM movimento_estoque m
           JOIN tipo_movimento_estoque tm ON tm.id = m.tipo_movimento_estoque_id
           LEFT JOIN documento_estoque de ON de.id = m.documento_estoque_id
           LEFT JOIN dispensacao_item di ON di.id = m.dispensacao_item_id
           LEFT JOIN dispensacao d ON d.id = di.dispensacao_id
           LEFT JOIN prescricao p ON p.id = d.prescricao_id
           LEFT JOIN receita_controlada rc ON rc.id = d.receita_controlada_id
          WHERE m.estabelecimento_id = ? AND m.insumo_id IN (${lista(ids.length)}) AND m.excluido_em IS NULL
            AND m.ocorrido_em >= ? AND m.ocorrido_em < ?
          ORDER BY m.ocorrido_em, m.id LIMIT 5000`,
        // A janela vai da meia-noite do dia inicial à do dia seguinte ao final, no fuso do estabelecimento.
        [
          est,
          ...ids,
          instanteCivil(dataLocal(o.inicio), '00:00', fuso),
          instanteCivil(diaSeguinte(dataLocal(o.fim)), '00:00', fuso),
        ],
      );
      return linhas.map((r) => {
        const entrada = texto(r['natureza']) === 'entrada';
        const t = texto(r['tipo']);
        const tipo: MovimentoControlado['tipo'] =
          t === 'transferencia'
            ? entrada
              ? 'transferencia-entrada'
              : 'transferencia-saida'
            : t === 'perda' || t === 'baixa'
              ? 'perda'
              : t === 'devolucao' && entrada
                ? 'devolucao'
                : entrada
                  ? 'entrada'
                  : 'saida';
        const doc = r['documento_estoque_id'];
        return {
          item: n(r['insumo_id']),
          data: dataCivil(r['ocorrido_em'], fuso),
          tipo,
          quantidade: n(r['quantidade_estoque']),
          documento:
            doc !== null
              ? `${PREFIXO_DOCUMENTO[texto(r['doc_tipo'])] ?? ''}${texto(r['doc_numero'])}`
              : r['disp_id'] !== null
                ? `${PREFIXO_DISPENSACAO}${texto(r['disp_numero'])}`
                : `M ${texto(r['id'])}`,
          documentoId: doc !== null ? n(doc) : r['disp_id'] !== null ? n(r['disp_id']) : n(r['id']),
          prescritor: r['prescritor'] === null ? null : n(r['prescritor']),
        };
      });
    });
  }

  /** As conferências de controlado desde a data: o item, o documento conferido e o tipo (perda ou conferência). */
  conferencias(c: ContextoFarmacia, desde: Date) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT DISTINCT dei.insumo_id, cc.documento_tipo, cc.documento_estoque_id
             FROM conferencia_controlado cc
             JOIN documento_estoque_item dei ON dei.documento_estoque_id = cc.documento_estoque_id AND dei.excluido_em IS NULL
                  AND (cc.lote_insumo_id IS NULL OR dei.lote_insumo_id = cc.lote_insumo_id)
            WHERE cc.estabelecimento_id = ? AND cc.conferido_em >= ? AND cc.excluido_em IS NULL
            ORDER BY cc.documento_estoque_id LIMIT 5000`,
          [est, desde],
        )
      ).map((r) => ({
        item: n(r['insumo_id']),
        docTipo: texto(r['documento_tipo']),
        docId: n(r['documento_estoque_id']),
        tipo: texto(r['documento_tipo']) === 'perda' ? 'perda' : 'conferencia',
      })),
    );
  }

  /**
   * O fechamento do livro (1 a 4) que começa na data: o oficial, se houver, senão o de conferência. O conteúdo montado
   * só é guardado no fechamento oficial (no arquivo do livro); o de conferência guarda a impressão digital (hash).
   */
  livroFechado(c: ContextoFarmacia, livro: number, inicio: Date) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const r = await l.uma(
        `SELECT lc.encerrado_em, lc.guarda_ate, lc.hash_conteudo, lc.modo_fechamento, u.login
           FROM livro_controlado lc LEFT JOIN usuario u ON u.id = lc.criado_por
          WHERE lc.estabelecimento_id = ? AND lc.numero IN (?, ?) AND lc.situacao = 'encerrado' AND lc.excluido_em IS NULL
          ORDER BY lc.modo_fechamento = 'oficial' DESC, lc.id DESC LIMIT 1`,
        [est, `L${livro}-${dataLocal(inicio)}-O`, `L${livro}-${dataLocal(inicio)}-C`],
      );
      return r
        ? {
            em: minutoCivil(r['encerrado_em'], fuso),
            por: texto(r['login']),
            guardaAte: dataIso(r['guarda_ate']),
            hash: texto(r['hash_conteudo']),
            conteudo: '',
            modo: texto(r['modo_fechamento']),
          }
        : null;
    });
  }

  /** Desde quando a fila de entregas olha: a primeira saída para o setor do estabelecimento. */
  janelaEntregas(c: ContextoFarmacia) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        'SELECT MIN(saida_em) AS desde FROM entrega_setor WHERE estabelecimento_id = ? AND excluido_em IS NULL',
        [est],
      );
      return { desde: r?.['desde'] ? minutoCivil(r['desde'], await this.fuso(l, est)) : null };
    });
  }

  /** As dispensações ambulatoriais desde a data, com o lote e se já foram escrituradas no envio nacional. */
  ambulatoriais(c: ContextoFarmacia, desde: Date) {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `SELECT d.id, d.paciente_id, d.dispensado_em, di.insumo_id, li.numero_lote, di.quantidade,
                  EXISTS (SELECT 1 FROM movimento_estoque m
                            JOIN envio_controlado_nacional_item ei ON ei.movimento_estoque_id = m.id AND ei.excluido_em IS NULL
                            JOIN envio_controlado_nacional en ON en.id = ei.envio_controlado_nacional_id AND en.situacao <> 'cancelado'
                           WHERE m.dispensacao_item_id = di.id) AS escriturada
             FROM dispensacao d
             JOIN dispensacao_item di ON di.dispensacao_id = d.id AND di.sequencia = 1 AND di.excluido_em IS NULL
             LEFT JOIN lote_insumo li ON li.id = di.lote_insumo_id
            WHERE d.estabelecimento_id = ? AND d.tipo = 'ambulatorial' AND d.situacao <> 'cancelada'
              AND d.excluido_em IS NULL AND d.dispensado_em >= ?
            ORDER BY d.dispensado_em DESC, d.id DESC LIMIT ${TETO}`,
          [est, desde],
        )
      ).map((r) => ({
        id: n(r['id']),
        paciente: n(r['paciente_id']),
        item: n(r['insumo_id']),
        lote: texto(r['numero_lote']),
        quantidade: n(r['quantidade']),
        em: minutoCivil(r['dispensado_em'], fuso),
        escriturada: verdadeiro(r['escriturada']),
      }));
    });
  }
}

/** A avaliação farmacêutica pelo horário prescrito: a decisão vale para o item prescrito do horário. */
async function avaliarPeloHorario(
  tx: TxOperacao,
  est: number,
  usuario: number,
  extras: ExtrasGravacaoFarmacia,
  e: AvaliarPrescricaoEntrada,
): Promise<ResultadoOperacao> {
  const h = await tx.uma<Linha>(
    'SELECT prescricao_item_id FROM horario_administracao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [e.horario, est],
  );
  if (!h) throw recusa('horario-inexistente', 'O horário prescrito não existe.', { campos: ['horario'] });
  const item = n(h['prescricao_item_id']);
  const r = await gravadorAvaliacao(tx, est, usuario, extras).decidir({
    item,
    decisao: e.decisao,
    justificativa: e.justificativa,
    farmaceutico: '',
    triagem: {
      item,
      horario: e.horario,
      classe: 'comum',
      destino: 'humana',
      prioridade: 0,
      achados: [],
      regra: 'avaliacao-pelo-horario',
    },
  });
  return { id: r.id, item, decisao: e.decisao };
}

const SQL_DOSE = `
  SELECT dd.id, dd.horario_administracao_id, dd.quantidade, dd.etiqueta_emitida, di.id AS item_id, di.insumo_id,
         ins.nome, ins.codigo_gtin, di.lote_insumo_id, li.numero_lote, di.data_validade, di.quantidade_devolvida,
         d.dispensado_em, de.id AS doc_id, de.numero AS doc_numero, de.movimentado_em, dei.id AS doc_item,
         (SELECT es.situacao FROM entrega_setor_item esi JOIN entrega_setor es ON es.id = esi.entrega_setor_id
           WHERE esi.dose_dispensada_id = dd.id AND esi.excluido_em IS NULL ORDER BY es.id DESC LIMIT 1) AS entrega
    FROM dose_dispensada dd
    JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id AND di.excluido_em IS NULL
    JOIN dispensacao d ON d.id = di.dispensacao_id AND d.excluido_em IS NULL
    JOIN insumo ins ON ins.id = di.insumo_id
    LEFT JOIN lote_insumo li ON li.id = di.lote_insumo_id
    LEFT JOIN documento_estoque de ON de.dispensacao_id = d.id AND de.tipo = 'saida_paciente' AND de.excluido_em IS NULL
    LEFT JOIN documento_estoque_item dei ON dei.documento_estoque_id = de.id AND dei.dispensacao_item_id = di.id
   WHERE d.estabelecimento_id = ? AND dd.excluido_em IS NULL AND dd.situacao <> 'cancelada'`;

function documentoDe(r: Linha, fuso: string): DocumentoSaida | null {
  if (r['doc_id'] === null || r['doc_id'] === undefined) return null;
  const data = dataCivil(r['movimentado_em'], fuso);
  return {
    id: n(r['doc_id']),
    ano: Number(data.slice(0, 4)),
    mes: Number(data.slice(5, 7)),
    doc: n(r['doc_numero']),
  };
}

function doseDe(r: Linha, fuso: string): DoseDispensada {
  const entrega = textoOuNulo(r['entrega']);
  return {
    dose: n(r['id']),
    horario: r['horario_administracao_id'] === null ? null : n(r['horario_administracao_id']),
    item: n(r['insumo_id']),
    descricao: texto(r['nome']),
    quantidade: n(r['quantidade']),
    dispensadaEm: minutoCivil(r['dispensado_em'], fuso),
    etiquetaEmitida: verdadeiro(r['etiqueta_emitida']),
    saida: documentoDe(r, fuso),
    itemSaida: r['doc_item'] === null ? null : n(r['doc_item']),
    lote: textoOuNulo(r['numero_lote']),
    validade: r['data_validade'] ? dataIso(r['data_validade']) : null,
    loteSaida: r['lote_insumo_id'] === null ? null : n(r['lote_insumo_id']),
    situacaoEntrega: entrega ? (NUMERO_DA_ENTREGA[entrega] ?? null) : null,
    barras: textoOuNulo(r['codigo_gtin']),
    devolvido: n(r['quantidade_devolvida']),
  };
}

/** As iniciais do nome (a etiqueta e a fila não mostram o nome inteiro). */
function iniciais(nome: unknown): string {
  return texto(nome)
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
    .slice(0, 6);
}

/** A data local (AAAA-MM-DD) de uma data das telas (meia-noite local). */
function dataLocal(d: Date): string {
  const p2 = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** O dia civil seguinte (AAAA-MM-DD), sem depender do fuso do processo. */
function diaSeguinte(data: string): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

function contextoDe(c: ContextoPortaM18) {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'farmacia').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaFarmaciaIndisponivel(): PortaFarmacia {
  return portaIndisponivel<PortaFarmacia>(METODOS_PORTA_FARMACIA);
}
