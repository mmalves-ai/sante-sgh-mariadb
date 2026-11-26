// Fracionamento e unitarização de dose (C2-092, 05-SUP linha 11) sobre o MariaDB do cliente pelo Executor do núcleo
// (trilha na mesma transação, versão conferida, Idempotency-Key honrada). As regras são do domínio
// (`@sgh/contratos/regras-suprimentos`, unitarizacao-dose); aqui ficam a leitura, a trava e a gravação:
//   - a regra de fracionamento do insumo (origem, dose resultante, rendimento, validade depois da abertura, capela);
//   - a ordem executada de uma vez na bancada: a baixa do lote de origem aberto (movimento unitarizacao_consumo), a
//     entrada das doses no mesmo local com o número do lote de origem e a validade nova (unitarizacao_entrada, custo
//     do que saiu), a ordem e o item com o lote de origem e o lote gerado, e cada dose com a etiqueta própria
//     (tipo dose) e o lote de origem;
//   - o rastreio dose → ordem → lote de origem, com as doses irmãs do mesmo lote.
// Nada é apagado: a ordem e a dose são registro permanente da rastreabilidade (RDC 67/2007 da ANVISA).
import {
  conferirRegraFracionamento,
  conferirUnitarizacao,
  identificadorEtiqueta,
  identificadorValido,
  PERCENTUAL_VALIDADE_PADRAO,
  type RecusaSuprimentos,
  type RotuloDose,
  rotuloDaDose,
  sequencialDoIdentificador,
  type TipoOrdemUnitarizacao,
  sobraDaOrdem,
  validadeDaDose,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import {
  exigirMesAberto,
  insumoAtivo,
  localDoEstabelecimento,
  movimentar,
  tipoMovimentoId,
} from './porta-propria.js';

export const PORTA_UNITARIZACAO_DOSE = Symbol('PORTA_UNITARIZACAO_DOSE');
export const TABELAS_UNITARIZACAO_DOSE = [
  'regra_fracionamento_insumo',
  'ordem_unitarizacao',
  'ordem_unitarizacao_item',
  'dose_unitarizada',
  'etiqueta_identificacao',
  'lote_insumo',
  'saldo_estoque',
  'saldo_lote',
  'movimento_estoque',
  'movimento_lote',
  'sequencia_negocio',
] as const;
export const OPERACOES_UNITARIZACAO_DOSE = {
  regra: 'suprimentos.unitarizacao.salvar-regra',
  ativar: 'suprimentos.unitarizacao.ativar-regra',
  executar: 'suprimentos.unitarizacao.executar-ordem',
} as const;
export const TIPO_MOVIMENTO_UNITARIZACAO = {
  consumo: 'unitarizacao_consumo',
  entrada: 'unitarizacao_entrada',
} as const;
const TETO_ORDENS = 100;

export interface RegraFracionamentoEntrada {
  readonly origem: number;
  readonly resultante: number;
  readonly quantidadeOrigem: number;
  readonly rendimento: number;
  readonly unidade: number;
  readonly validadeHoras: number | null;
  readonly exigeCapela: boolean;
  readonly reaproveitaSobra: boolean;
}

export interface OrdemUnitarizacaoEntrada {
  readonly regra: number;
  readonly tipo: TipoOrdemUnitarizacao;
  readonly local: number;
  readonly lote: number;
  readonly capela: number | null;
  readonly quantidadeOrigem: number;
  readonly doses: number;
  readonly perda: number;
  readonly rupturaLacre: boolean;
  readonly percentualEstabilidade: number | null;
  readonly observacao: string | null;
}

export interface DoseEmitida extends RotuloDose {
  readonly id: number;
  readonly etiqueta: number;
  readonly validade: string;
}

export interface OrdemUnitarizacaoGravada {
  readonly id: number;
  readonly numero: number;
  readonly loteDoses: number;
  readonly movimentoSaida: number;
  readonly movimentoEntrada: number;
  readonly validadeDose: string;
  /** A sobra reaproveitada pela regra (0: nada sobrou ou foi lançado como perda) e a validade dela. */
  readonly sobra: number;
  readonly validadeSobra: string | null;
  readonly doses: DoseEmitida[];
}

export interface RegraFracionamentoLida {
  readonly id: number;
  readonly versao: number;
  readonly origem: number;
  readonly origemNome: string;
  readonly resultante: number;
  readonly resultanteNome: string;
  readonly quantidadeOrigem: number;
  readonly rendimento: number;
  readonly unidade: number;
  readonly unidadeSigla: string;
  readonly validadeHoras: number | null;
  readonly exigeCapela: boolean;
  readonly reaproveitaSobra: boolean;
  readonly ativa: boolean;
}

export interface PainelUnitarizacao {
  readonly hoje: string;
  readonly agora: string;
  readonly regras: RegraFracionamentoLida[];
  /** Os lotes liberados com saldo dos insumos de origem das regras ativas, por local. */
  readonly lotes: {
    readonly id: number;
    readonly insumo: number;
    readonly local: number;
    readonly numero: string;
    readonly validade: string;
    readonly saldo: number;
  }[];
  readonly locais: { readonly id: number; readonly nome: string }[];
  readonly capelas: { readonly id: number; readonly nome: string; readonly situacao: string }[];
  readonly unidades: { readonly id: number; readonly sigla: string }[];
  readonly ordens: {
    readonly id: number;
    readonly numero: number;
    readonly tipo: string;
    readonly executadaEm: string;
    readonly origemNome: string;
    readonly loteOrigem: string;
    readonly resultanteNome: string;
    readonly doses: number;
    readonly perda: number;
    readonly sobra: number;
    readonly validadeDose: string | null;
    readonly situacao: string;
  }[];
}

export interface RastreioDose {
  readonly dose: {
    readonly id: number;
    readonly identificador: string;
    readonly insumo: string;
    readonly quantidade: number;
    readonly unidade: string;
    readonly validadeOriginal: string | null;
    readonly validadeNova: string;
    readonly unitarizadaEm: string;
    readonly situacao: string;
    readonly etiquetaSituacao: string | null;
  };
  readonly ordem: {
    readonly id: number;
    readonly numero: number;
    readonly tipo: string;
    readonly executadaEm: string | null;
    readonly farmaceutico: string | null;
    readonly capela: string | null;
    readonly rupturaLacre: boolean;
    readonly percentualEstabilidade: number | null;
  };
  readonly loteOrigem: {
    readonly id: number;
    readonly numero: string;
    readonly validade: string;
    readonly insumo: string;
    readonly fabricante: string | null;
  } | null;
  /** As doses da mesma ordem (o recolhimento do lote alcança todas). */
  readonly irmas: { readonly identificador: string; readonly situacao: string }[];
}

export interface PortaUnitarizacaoDose {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18): Promise<PainelUnitarizacao>;
  salvarRegra(c: ContextoPortaM18, e: RegraFracionamentoEntrada, chave: string): Promise<{ id: number }>;
  ativarRegra(
    c: ContextoPortaM18,
    regra: number,
    e: { readonly ativa: boolean; readonly versaoVista: number },
    chave: string,
  ): Promise<{ id: number }>;
  executarOrdem(
    c: ContextoPortaM18,
    e: OrdemUnitarizacaoEntrada,
    chave: string,
  ): Promise<OrdemUnitarizacaoGravada>;
  rastrear(c: ContextoPortaM18, identificador: string): Promise<RastreioDose>;
}

export function portaUnitarizacaoDoseIndisponivel(): PortaUnitarizacaoDose {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'A unitarização de dose exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    painel: falha,
    salvarRegra: falha,
    ativarRegra: falha,
    executarOrdem: falha,
    rastrear: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tn = (v: unknown) => (v === null || v === undefined ? null : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1';
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : t(v).slice(0, 10);
const instante = (v: unknown): string =>
  v instanceof Date
    ? `${dia(v)}T${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`
    : t(v).replace(' ', 'T').slice(0, 16);

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const r = rs[0];
  if (!r) return;
  throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
    campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
  });
}

async function relogio(l: Pick<Leitor, 'uma'>, est: number): Promise<{ hoje: string; agora: string }> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  const x = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
  return { hoje: x.hoje, agora: `${x.hoje}T${x.hora}` };
}

/** O farmacêutico responsável: o profissional vigente do usuário no estabelecimento. */
async function farmaceuticoDe(tx: TxOperacao, est: number): Promise<{ id: number; nome: string }> {
  const u = tx.contexto.usuario;
  const r =
    u === null
      ? null
      : await tx.uma<Linha>(
          `SELECT v.profissional_id, pf.nome FROM usuario_vinculo_profissional v
             JOIN profissional p ON p.id = v.profissional_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
            ORDER BY v.vigencia_inicio DESC LIMIT 1`,
          [u, est],
        );
  if (!r)
    throw recusa(
      'sem-farmaceutico',
      'O usuário não tem vínculo de profissional neste estabelecimento: a ordem pede o farmacêutico responsável.',
    );
  return { id: n(r['profissional_id']), nome: t(r['nome']) };
}

const SQL_REGRA = `SELECT r.id, r.versao, r.origem_insumo_id, io.nome AS origem_nome, r.resultante_insumo_id,
       ir.nome AS resultante_nome, r.quantidade_origem, r.rendimento, r.unidade_medida_id, u.sigla, r.validade_horas,
       r.exige_capela, r.reaproveita_sobra, r.ativo
  FROM regra_fracionamento_insumo r
  JOIN insumo io ON io.id = r.origem_insumo_id
  JOIN insumo ir ON ir.id = r.resultante_insumo_id
  JOIN unidade_medida u ON u.id = r.unidade_medida_id`;

const regraDe = (r: Linha): RegraFracionamentoLida => ({
  id: n(r['id']),
  versao: n(r['versao']),
  origem: n(r['origem_insumo_id']),
  origemNome: t(r['origem_nome']),
  resultante: n(r['resultante_insumo_id']),
  resultanteNome: t(r['resultante_nome']),
  quantidadeOrigem: n(r['quantidade_origem']),
  rendimento: n(r['rendimento']),
  unidade: n(r['unidade_medida_id']),
  unidadeSigla: t(r['sigla']),
  validadeHoras: nn(r['validade_horas']),
  exigeCapela: b(r['exige_capela']),
  reaproveitaSobra: b(r['reaproveita_sobra']),
  ativa: b(r['ativo']),
});

export class PortaUnitarizacaoDosePropria implements PortaUnitarizacaoDose {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'unitarizacao-dose',
    };
  }

  private async executar<R extends { id: number }>(
    c: ContextoPortaM18,
    nome: string,
    alvo: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_UNITARIZACAO_DOSE],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo: null }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  painel(c: ContextoPortaM18): Promise<PainelUnitarizacao> {
    const ctx = this.contexto(c);
    const est = ctx.estabelecimento;
    return this.nucleo.lerSomente(ctx, async (l) => {
      const { hoje, agora } = await relogio(l, est);
      const regras = (await l.consultar<Linha>(`${SQL_REGRA} ORDER BY io.nome, ir.nome LIMIT 300`, [])).map(
        regraDe,
      );
      const origens = [...new Set(regras.filter((r) => r.ativa).map((r) => r.origem))];
      const lotes = origens.length
        ? await l.consultar<Linha>(
            `SELECT li.id, li.insumo_id, sl.local_estoque_id, li.numero_lote, li.validade,
                    sl.quantidade - sl.quantidade_reservada AS quantidade
               FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
              WHERE sl.estabelecimento_id = ? AND li.insumo_id IN (${origens.map(() => '?').join(', ')})
                AND sl.quantidade - sl.quantidade_reservada > 0 AND sl.bloqueado = FALSE AND li.situacao = 'liberado' AND li.validade >= ?
                AND li.excluido_em IS NULL
              ORDER BY li.validade, li.id LIMIT 500`,
            [est, ...origens, hoje],
          )
        : [];
      const locais = await l.consultar<Linha>(
        `SELECT id, nome FROM local_estoque
          WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 200`,
        [est],
      );
      const capelas = await l.consultar<Linha>(
        `SELECT id, nome, situacao FROM capela_manipulacao
          WHERE estabelecimento_id = ? AND situacao <> 'inativa' ORDER BY nome LIMIT 100`,
        [est],
      );
      const unidades = await l.consultar<Linha>(
        'SELECT id, sigla FROM unidade_medida WHERE ativo = TRUE ORDER BY sigla LIMIT 300',
        [],
      );
      const ordens = await l.consultar<Linha>(
        `SELECT o.id, o.numero, o.tipo, o.executada_em, o.situacao, io.nome AS origem_nome, li.numero_lote,
                ir.nome AS resultante_nome, it.quantidade_produzida, it.quantidade_perda, it.quantidade_sobra,
                it.validade_resultante
           FROM ordem_unitarizacao o
           JOIN ordem_unitarizacao_item it ON it.ordem_unitarizacao_id = o.id AND it.sequencia = 1
           JOIN insumo io ON io.id = it.origem_insumo_id
           JOIN insumo ir ON ir.id = it.resultante_insumo_id
           LEFT JOIN lote_insumo li ON li.id = it.origem_lote_insumo_id
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL
          ORDER BY o.id DESC LIMIT ${TETO_ORDENS}`,
        [est],
      );
      return {
        hoje,
        agora,
        regras,
        lotes: lotes.map((x) => ({
          id: n(x['id']),
          insumo: n(x['insumo_id']),
          local: n(x['local_estoque_id']),
          numero: t(x['numero_lote']),
          validade: dia(x['validade']),
          saldo: n(x['quantidade']),
        })),
        locais: locais.map((x) => ({ id: n(x['id']), nome: t(x['nome']) })),
        capelas: capelas.map((x) => ({ id: n(x['id']), nome: t(x['nome']), situacao: t(x['situacao']) })),
        unidades: unidades.map((x) => ({ id: n(x['id']), sigla: t(x['sigla']) })),
        ordens: ordens.map((x) => ({
          id: n(x['id']),
          numero: n(x['numero']),
          tipo: t(x['tipo']),
          executadaEm: instante(x['executada_em']),
          origemNome: t(x['origem_nome']),
          loteOrigem: t(x['numero_lote']),
          resultanteNome: t(x['resultante_nome']),
          doses: n(x['quantidade_produzida']),
          perda: n(x['quantidade_perda']),
          sobra: n(x['quantidade_sobra']),
          validadeDose: x['validade_resultante'] ? dia(x['validade_resultante']) : null,
          situacao: t(x['situacao']),
        })),
      };
    });
  }

  salvarRegra(c: ContextoPortaM18, e: RegraFracionamentoEntrada, chave: string): Promise<{ id: number }> {
    return this.executar(
      c,
      OPERACOES_UNITARIZACAO_DOSE.regra,
      'regra_fracionamento_insumo',
      { ...e },
      chave,
      async (tx) => {
        recusarTodas(conferirRegraFracionamento(e));
        await insumoAtivo(tx, e.origem);
        await insumoAtivo(tx, e.resultante);
        const u = await tx.uma<Linha>('SELECT id FROM unidade_medida WHERE id = ? AND ativo = TRUE', [
          e.unidade,
        ]);
        if (!u) throw recusa('unidade-inexistente', 'A unidade da dose não existe.', { campos: ['unidade'] });
        const valores = {
          quantidade_origem: e.quantidadeOrigem,
          rendimento: e.rendimento,
          unidade_medida_id: e.unidade,
          validade_horas: e.validadeHoras,
          exige_capela: e.exigeCapela,
          reaproveita_sobra: e.reaproveitaSobra,
          ativo: true,
        };
        const [ja] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao FROM regra_fracionamento_insumo WHERE origem_insumo_id = ? AND resultante_insumo_id = ?',
          [e.origem, e.resultante],
        );
        if (ja) {
          await tx.alterar('regra_fracionamento_insumo', n(ja['id']), n(ja['versao']), valores);
          return { id: n(ja['id']) };
        }
        const id = await tx.incluir('regra_fracionamento_insumo', {
          origem_insumo_id: e.origem,
          resultante_insumo_id: e.resultante,
          ...valores,
        });
        return { id };
      },
    );
  }

  ativarRegra(
    c: ContextoPortaM18,
    regra: number,
    e: { readonly ativa: boolean; readonly versaoVista: number },
    chave: string,
  ): Promise<{ id: number }> {
    const entrada = { regra, ...e };
    return this.executar(
      c,
      OPERACOES_UNITARIZACAO_DOSE.ativar,
      'regra_fracionamento_insumo',
      entrada,
      chave,
      async (tx) => {
        const [r] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao FROM regra_fracionamento_insumo WHERE id = ?',
          [regra],
        );
        if (!r)
          throw recusa('regra-inexistente', 'A regra de fracionamento não existe.', { campos: ['regra'] });
        if (n(r['versao']) !== e.versaoVista)
          throw recusa('regra-mudou', 'A regra mudou em outra tela: recarregue e confira.');
        await tx.alterar('regra_fracionamento_insumo', regra, n(r['versao']), { ativo: e.ativa });
        return { id: regra };
      },
    );
  }

  executarOrdem(
    c: ContextoPortaM18,
    e: OrdemUnitarizacaoEntrada,
    chave: string,
  ): Promise<OrdemUnitarizacaoGravada> {
    return this.executar(
      c,
      OPERACOES_UNITARIZACAO_DOSE.executar,
      'ordem_unitarizacao',
      { ...e },
      chave,
      async (tx, est) => {
        const regraLinha = await tx.uma<Linha>(`${SQL_REGRA} WHERE r.id = ?`, [e.regra]);
        const regra = regraLinha ? regraDe(regraLinha) : null;
        await localDoEstabelecimento(tx, est, e.local);
        if (e.capela !== null) {
          const cap = await tx.uma<Linha>(
            `SELECT id FROM capela_manipulacao WHERE id = ? AND estabelecimento_id = ? AND situacao IN ('disponivel','em_uso')`,
            [e.capela, est],
          );
          if (!cap)
            throw recusa('capela-indisponivel', 'A capela não está disponível neste estabelecimento.', {
              campos: ['capela'],
            });
        }
        // O saldo que a ordem pode abrir é o LIVRE, no lote e no item do local: o reservado para a separação de uma
        // requisição não sai (C1-118), a mesma regra das outras saídas de suprimentos.
        const [lote] = await tx.consultarParaAtualizar<Linha>(
          `SELECT li.id, li.numero_lote, DATE_FORMAT(li.validade, '%Y-%m-%d') AS validade, li.situacao, li.fabricante_id,
                LEAST(sl.quantidade - sl.quantidade_reservada,
                      COALESCE(se.quantidade - se.quantidade_reservada, 0)) AS quantidade, sl.bloqueado
           FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
           LEFT JOIN saldo_estoque se ON se.local_estoque_id = sl.local_estoque_id AND se.insumo_id = li.insumo_id
            AND se.estabelecimento_id = sl.estabelecimento_id AND se.excluido_em IS NULL
          WHERE sl.lote_insumo_id = ? AND sl.local_estoque_id = ? AND sl.estabelecimento_id = ? AND li.insumo_id = ?
            AND li.excluido_em IS NULL`,
          [e.lote, e.local, est, regra?.origem ?? 0],
        );
        const { hoje, agora } = await relogio(tx, est);
        // O lote migrado sem validade não vira dose: primeiro informam a validade (nunca "vencido").
        if (lote && (lote['validade'] === null || lote['validade'] === undefined))
          throw recusa(
            'lote-sem-validade',
            `Lote ${t(lote['numero_lote'])} sem validade (não informada na origem): informe a validade do lote antes de usar.`,
            { campos: ['lote'] },
          );
        recusarTodas(
          conferirUnitarizacao({
            regra,
            tipo: e.tipo,
            quantidadeOrigem: e.quantidadeOrigem,
            doses: e.doses,
            perda: e.perda,
            capela: e.capela,
            lote: lote
              ? {
                  validade: t(lote['validade']),
                  situacao: t(lote['situacao']),
                  bloqueado: b(lote['bloqueado']),
                  saldo: n(lote['quantidade']),
                }
              : null,
            hoje,
            percentualEstabilidade: e.percentualEstabilidade,
            observacao: e.observacao,
          }),
        );
        if (!regra || !lote) throw new Error('conferência sem regra ou lote');
        const validadeOriginal = t(lote['validade']);
        const percentual = e.percentualEstabilidade ?? PERCENTUAL_VALIDADE_PADRAO;
        const validade = validadeDaDose({
          executadaEm: agora,
          validadeOriginal,
          validadeHoras: regra.validadeHoras,
          percentual,
        });
        if (!validade) throw recusa('lote-vencido', 'O lote de origem está vencido.', { campos: ['lote'] });
        // A sobra do que foi aberto: o domínio já recusou a que não tem destino; a reaproveitada fica no item da ordem
        // com a validade da embalagem aberta (a mesma conta da dose, RDC 67/2007).
        const sobra = regra.reaproveitaSobra ? sobraDaOrdem(regra, e.quantidadeOrigem, e.doses, e.perda) : 0;
        await exigirMesAberto(tx, est, hoje);
        const origem = await insumoAtivo(tx, regra.origem);
        await insumoAtivo(tx, regra.resultante);
        const farm = await farmaceuticoDe(tx, est);
        const numeroLote = t(lote['numero_lote']);
        const fabricante = nn(lote['fabricante_id']);

        // Baixa do lote de origem aberto (sai pelo custo médio do local).
        const saida = await movimentar(tx, est, {
          local: e.local,
          insumo: regra.origem,
          quantidade: e.quantidadeOrigem,
          natureza: 'saida',
          tipoMovimento: await tipoMovimentoId(tx, TIPO_MOVIMENTO_UNITARIZACAO.consumo),
          lotes: [{ id: e.lote, quantidade: e.quantidadeOrigem }],
          hoje,
          profissional: farm.id,
        });
        // O lote das doses: o mesmo número do lote de origem, com a validade nova (o rastreio impresso na dose).
        const jaLote = await tx.uma<Linha>(
          'SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade = ?',
          [est, regra.resultante, numeroLote, validade],
        );
        const loteDoses = jaLote
          ? n(jaLote['id'])
          : await tx.incluir('lote_insumo', {
              estabelecimento_id: est,
              insumo_id: regra.resultante,
              numero_lote: numeroLote,
              validade,
              validade_original: validadeOriginal,
              fabricado_em: hoje,
              fabricante_id: fabricante,
              situacao: 'liberado',
            });
        const entrada = await movimentar(tx, est, {
          local: e.local,
          insumo: regra.resultante,
          quantidade: e.doses,
          natureza: 'entrada',
          tipoMovimento: await tipoMovimentoId(tx, TIPO_MOVIMENTO_UNITARIZACAO.entrada),
          valorEntrada: saida.valor,
          lotes: [{ id: loteDoses, quantidade: e.doses }],
          hoje,
          profissional: farm.id,
        });
        await garantirSequencia(
          tx,
          { tipo: 'ordem_unitarizacao', estabelecimento: est, prefixo: null },
          { usuario: tx.contexto.usuario ?? null, agora: new Date() },
        );
        const numero = Number((await tx.proximoNumero('ordem_unitarizacao')).valor);
        const momento = `${agora.replace('T', ' ')}:00`;
        const ordem = await tx.incluir('ordem_unitarizacao', {
          estabelecimento_id: est,
          numero,
          tipo: e.tipo,
          local_estoque_id: e.local,
          capela_manipulacao_id: e.capela,
          regra_fracionamento_insumo_id: regra.id,
          farmaceutico_profissional_id: farm.id,
          solicitada_em: momento,
          executada_em: momento,
          ruptura_lacre: e.rupturaLacre,
          percentual_estabilidade: percentual,
          situacao: 'concluida',
          observacao: e.observacao,
        });
        await tx.incluir('ordem_unitarizacao_item', {
          ordem_unitarizacao_id: ordem,
          sequencia: 1,
          origem_insumo_id: regra.origem,
          origem_lote_insumo_id: e.lote,
          origem_unidade_medida_id: n(origem['estoque_unidade_medida_id']),
          quantidade_origem: e.quantidadeOrigem,
          resultante_insumo_id: regra.resultante,
          resultante_lote_insumo_id: loteDoses,
          resultante_unidade_medida_id: regra.unidade,
          quantidade_produzida: e.doses,
          quantidade_perda: e.perda,
          quantidade_sobra: sobra,
          validade_sobra: sobra > 0 ? validade : null,
          validade_resultante: validade,
          movimento_estoque_id: saida.id,
        });
        // Uma etiqueta e uma dose por unidade: o identificador pelo sequencial do estabelecimento (o mesmo da etiqueta de
        // identificação), travado; a chave única por estabelecimento e identificador barra a corrida que sobrar.
        const ultimas = await tx.consultarParaAtualizar<Linha>(
          `SELECT identificador FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND origem = 'sistema'
          ORDER BY id DESC LIMIT 20`,
          [est],
        );
        let seq = Math.max(0, ...ultimas.map((r) => sequencialDoIdentificador(t(r['identificador'])) ?? 0));
        const doses: DoseEmitida[] = [];
        for (let i = 0; i < e.doses; i++) {
          let identificador = identificadorEtiqueta(++seq);
          while (
            await tx.uma<Linha>(
              'SELECT id FROM etiqueta_identificacao WHERE estabelecimento_id = ? AND identificador = ?',
              [est, identificador],
            )
          )
            identificador = identificadorEtiqueta(++seq);
          const etiqueta = await tx.incluir('etiqueta_identificacao', {
            estabelecimento_id: est,
            identificador,
            insumo_id: regra.resultante,
            lote_insumo_id: loteDoses,
            unidade_medida_id: regra.unidade,
            quantidade: 1,
            local_estoque_id: e.local,
            fabricante_id: fabricante,
            movimento_estoque_id: entrada.id,
            ordem_unitarizacao_id: ordem,
            responsavel_profissional_id: farm.id,
            tipo: 'dose',
            data_validade: validade,
            impressoes: 1,
            situacao: 'ativa',
            origem: 'sistema',
          });
          const id = await tx.incluir('dose_unitarizada', {
            estabelecimento_id: est,
            ordem_unitarizacao_id: ordem,
            insumo_id: regra.resultante,
            origem_lote_insumo_id: e.lote,
            etiqueta_identificacao_id: etiqueta,
            identificador,
            unidade_medida_id: regra.unidade,
            quantidade: 1,
            validade_original: validadeOriginal,
            validade_nova: validade,
            unitarizado_em: momento,
            responsavel_profissional_id: farm.id,
            situacao: 'disponivel',
          });
          doses.push({
            id,
            etiqueta,
            validade,
            ...rotuloDaDose({
              identificador,
              insumo: regra.resultanteNome,
              quantidade: 1,
              unidade: regra.unidadeSigla,
              loteOrigem: numeroLote,
              validadeOriginal,
              validadeNova: validade,
              fracionadoEm: agora,
              farmaceutico: farm.nome,
            }),
          });
        }
        return {
          id: ordem,
          numero,
          loteDoses,
          movimentoSaida: saida.id,
          movimentoEntrada: entrada.id,
          validadeDose: validade,
          sobra,
          validadeSobra: sobra > 0 ? validade : null,
          doses,
        };
      },
    );
  }

  rastrear(c: ContextoPortaM18, identificador: string): Promise<RastreioDose> {
    const ctx = this.contexto(c);
    const est = ctx.estabelecimento;
    const id = identificador.trim().toUpperCase();
    return this.nucleo.lerSomente(ctx, async (l) => {
      const d = await l.uma<Linha>(
        `SELECT d.id, d.identificador, d.quantidade, d.validade_original, d.validade_nova, d.unitarizado_em, d.situacao,
                d.ordem_unitarizacao_id, d.origem_lote_insumo_id, i.nome AS insumo_nome, u.sigla, e.situacao AS etq_situacao
           FROM dose_unitarizada d JOIN insumo i ON i.id = d.insumo_id JOIN unidade_medida u ON u.id = d.unidade_medida_id
           LEFT JOIN etiqueta_identificacao e ON e.id = d.etiqueta_identificacao_id
          WHERE d.estabelecimento_id = ? AND d.identificador = ? AND d.excluido_em IS NULL`,
        [est, id],
      );
      if (!d)
        throw recusa(
          'dose-inexistente',
          identificadorValido(id)
            ? 'Nenhuma dose com esse código neste estabelecimento.'
            : 'O código lido não é de uma etiqueta do hospital.',
          { campos: ['identificador'] },
        );
      const o = await l.uma<Linha>(
        `SELECT o.id, o.numero, o.tipo, o.executada_em, o.ruptura_lacre, o.percentual_estabilidade,
                pf.nome AS farmaceutico, c.nome AS capela
           FROM ordem_unitarizacao o
           LEFT JOIN profissional p ON p.id = o.farmaceutico_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN capela_manipulacao c ON c.id = o.capela_manipulacao_id
          WHERE o.id = ?`,
        [d['ordem_unitarizacao_id']],
      );
      const lo =
        d['origem_lote_insumo_id'] === null
          ? null
          : await l.uma<Linha>(
              `SELECT li.id, li.numero_lote, li.validade, i.nome AS insumo_nome, f.nome AS fabricante
                 FROM lote_insumo li JOIN insumo i ON i.id = li.insumo_id
                 LEFT JOIN fabricante f ON f.id = li.fabricante_id
                WHERE li.id = ?`,
              [d['origem_lote_insumo_id']],
            );
      const irmas = await l.consultar<Linha>(
        `SELECT identificador, situacao FROM dose_unitarizada
          WHERE ordem_unitarizacao_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 500`,
        [d['ordem_unitarizacao_id']],
      );
      return {
        dose: {
          id: n(d['id']),
          identificador: t(d['identificador']),
          insumo: t(d['insumo_nome']),
          quantidade: n(d['quantidade']),
          unidade: t(d['sigla']),
          validadeOriginal: d['validade_original'] ? dia(d['validade_original']) : null,
          validadeNova: dia(d['validade_nova']),
          unitarizadaEm: instante(d['unitarizado_em']),
          situacao: t(d['situacao']),
          etiquetaSituacao: tn(d['etq_situacao']),
        },
        ordem: {
          id: n(o?.['id']),
          numero: n(o?.['numero']),
          tipo: t(o?.['tipo']),
          executadaEm: o?.['executada_em'] ? instante(o['executada_em']) : null,
          farmaceutico: tn(o?.['farmaceutico']),
          capela: tn(o?.['capela']),
          rupturaLacre: b(o?.['ruptura_lacre']),
          percentualEstabilidade: nn(o?.['percentual_estabilidade']),
        },
        loteOrigem: lo
          ? {
              id: n(lo['id']),
              numero: t(lo['numero_lote']),
              validade: dia(lo['validade']),
              insumo: t(lo['insumo_nome']),
              fabricante: tn(lo['fabricante']),
            }
          : null,
        irmas: irmas.map((x) => ({ identificador: t(x['identificador']), situacao: t(x['situacao']) })),
      };
    });
  }
}
