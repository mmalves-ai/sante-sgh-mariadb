// Registro dos fatos em SGH_CTB_FATO e a simulação da regra (M54-F1; regras 1, 2 e 6). Puro: o worker e a API chamam
// com o que leram do banco.
//   - `fatosAtivos`: os fatos que valem hoje para cada linha e tipo (o não estornado que nenhum estorno referencia);
//   - `impressaoSemColisao`: a idempotência de SGH_CTB_FATO é (linha, tipo, impressão, estorno). Um fato que volta ao
//     que era (A → B → A) teria a impressão de um fato já estornado: a nova ocorrência leva um sufixo (D-REOCORRE-541);
//   - `contextoDeAplicacao`: o de-para da exportação (TBINTCRC, o MESMO do M32; regra 6) como mapa para `contabilizar`;
//   - `simularRegra`: aplica a regra (rascunho ou publicada) aos fatos de uma competência, sem gravar, e devolve as
//     contagens por situação, uma amostra e os totais com as parcelas (regra 5).
import {
  type ContaPlano,
  type FatoContabil,
  type LancamentoGerado,
  type RegraContabil,
  type SituacaoFato,
  SITUACOES_FATO,
} from '@sgh/contratos';
import { chaveDePara, type ItemDePara } from './depara.js';
import { impressaoDaLinha } from './fatos.js';
import { equilibrioDoPeriodo } from './partidas.js';
import { contabilizar, type ContextoAplicacao } from './regra.js';

const chaveDaLinha = (f: Pick<FatoContabil, 'tabela' | 'id' | 'tipo'>) => `${f.tabela}:${f.id}:${f.tipo}`;

/** Fatos ativos: não estornados e sem estorno que os referencie (por linha e tipo, o último que vale). */
export function fatosAtivos(registrados: readonly FatoContabil[]): FatoContabil[] {
  const estornados = new Set(
    registrados.filter((f) => f.estorno && f.referencia).map((f) => `${chaveDaLinha(f)}:${f.referencia}`),
  );
  return registrados.filter((f) => !f.estorno && !estornados.has(`${chaveDaLinha(f)}:${f.impressao}`));
}

/**
 * A impressão do fato a gravar sem colidir com uma já registrada da mesma linha, tipo e lado (estorno ou não). Sem
 * colisão, a própria; com colisão (reocorrência), a impressão de {base, ocorrência n} com o menor n livre.
 */
export function impressaoSemColisao(f: FatoContabil, registradas: ReadonlySet<string>): string {
  if (!registradas.has(f.impressao)) return f.impressao;
  for (let n = 2; n < 1000; n += 1) {
    const i = impressaoDaLinha({ base: f.impressao, ocorrencia: n });
    if (!registradas.has(i)) return i;
  }
  throw new RangeError('Ocorrências demais do mesmo fato.');
}

/**
 * Fatos a gravar, com a impressão sem colisão e o estorno apontando para a impressão gravada (a que estava ativa).
 * `registrados` são todos os fatos já gravados das linhas do lote.
 */
export function fatosParaGravar(
  novos: readonly FatoContabil[],
  registrados: readonly FatoContabil[],
): FatoContabil[] {
  const usadas = new Map<string, Set<string>>();
  const chave = (f: FatoContabil) => `${chaveDaLinha(f)}:${f.estorno ? 'S' : 'N'}`;
  for (const f of registrados) {
    const k = chave(f);
    if (!usadas.has(k)) usadas.set(k, new Set());
    usadas.get(k)!.add(f.impressao);
  }
  return novos.map((f) => {
    const k = chave(f);
    const s = usadas.get(k) ?? new Set<string>();
    const impressao = impressaoSemColisao(f, s);
    s.add(impressao);
    usadas.set(k, s);
    return impressao === f.impressao ? f : { ...f, impressao };
  });
}

/** Item do de-para da exportação como a leitura do banco devolve (TBINTCRC). */
export interface ItemDeParaExportacao {
  readonly convenio: number | null;
  readonly tipoConta: string;
  readonly tipoLancamento: number | null;
  readonly tipoAto: number | null;
  readonly subtipoDiaria: number | null;
  readonly contaExportacao: number | null;
}

/**
 * O de-para como mapa da regra (D-DEPARA-541): a partida `dePara` diz o campo do fato que é a chave; a chave é
 * `campo|valor`. O de-para da exportação é indexado por convênio (`convenio|<CONV>`) e por tipo de lançamento
 * (`tipoLancamento|<TIPO_LANC>`, a linha sem convênio). A primeira linha de cada chave vale (a ordem é a da chave
 * primária). "Sem detalhe" é NULL ou 0: no pc as colunas da chave são NOT NULL e o nível do convênio é a linha com
 * TIPO_ATO = 0 e SUBTIPO_DIARIA = 0 e um tipo de lançamento (medido na cópia em 29/10/2026: 53 linhas em 52 convênios;
 * nenhuma com CONV ou TIPO_LANC vazios). Para o convênio vale primeiro a linha sem tipo de lançamento, ato nem subtipo;
 * na falta dela, a primeira sem ato nem subtipo (correção da revisão do M54.1, no dourado da cópia).
 */
export function contextoDeAplicacao(
  plano: readonly ContaPlano[],
  itens: readonly ItemDeParaExportacao[],
): ContextoAplicacao {
  const dePara = new Map<string, ItemDePara>();
  const por = (k: string, conta: number | null) => {
    if (!dePara.has(k)) dePara.set(k, { chave: k, contaExportacao: conta });
  };
  const vazio = (v: number | null) => v === null || v === 0;
  const doConvenio = itens.filter((i) => !vazio(i.convenio) && vazio(i.tipoAto) && vazio(i.subtipoDiaria));
  for (const i of doConvenio)
    if (vazio(i.tipoLancamento)) por(chaveDePara(['convenio', i.convenio]), i.contaExportacao);
  for (const i of doConvenio) por(chaveDePara(['convenio', i.convenio]), i.contaExportacao);
  for (const i of itens)
    if (vazio(i.convenio) && !vazio(i.tipoLancamento))
      por(chaveDePara(['tipoLancamento', i.tipoLancamento]), i.contaExportacao);
  return {
    plano,
    dePara,
    chaveDoCampo: (campo, f) => chaveDePara([campo, f.campos[campo] ?? null]),
  };
}

export interface ResultadoSimulacao {
  readonly fatos: number;
  readonly porSituacao: Readonly<Record<SituacaoFato, number>>;
  /** Até `amostra` lançamentos gerados, na ordem dos fatos. */
  readonly lancamentos: readonly LancamentoGerado[];
  /** Até `amostra` motivos de fato sem regra ou sem conta (fato e motivo). */
  readonly recusas: readonly {
    readonly fato: string;
    readonly situacao: SituacaoFato;
    readonly motivo: string;
  }[];
  /** Totais dos lançamentos gerados (todos, não só a amostra), com as parcelas por conta e lado. */
  readonly totais: {
    readonly debitos: number;
    readonly creditos: number;
    readonly equilibrado: boolean;
    readonly parcelas: readonly {
      readonly lado: 'D' | 'C';
      readonly conta: string;
      readonly valorCentavos: number;
    }[];
  };
}

/** Aplica as regras aos fatos sem gravar (a simulação do editor e a conferência do reprocessamento). */
export function simularRegra(
  fatos: readonly FatoContabil[],
  regras: readonly RegraContabil[],
  ctx: ContextoAplicacao,
  amostra = 20,
): ResultadoSimulacao & { readonly todos: readonly LancamentoGerado[] } {
  const porSituacao = Object.fromEntries(Object.keys(SITUACOES_FATO).map((s) => [s, 0])) as Record<
    SituacaoFato,
    number
  >;
  const todos: LancamentoGerado[] = [];
  const recusas: { fato: string; situacao: SituacaoFato; motivo: string }[] = [];
  for (const f of fatos) {
    const r = contabilizar(f, regras, ctx);
    porSituacao[r.situacao] += 1;
    if (r.lancamento) todos.push(r.lancamento);
    else if (r.motivo && recusas.length < amostra)
      recusas.push({ fato: f.documento, situacao: r.situacao, motivo: r.motivo });
  }
  const e = equilibrioDoPeriodo(todos);
  const parcelas = new Map<string, { lado: 'D' | 'C'; conta: string; valorCentavos: number }>();
  for (const l of todos)
    for (const p of l.partidas) {
      const k = `${p.lado}|${p.conta}`;
      const x = parcelas.get(k) ?? { lado: p.lado, conta: p.conta, valorCentavos: 0 };
      x.valorCentavos += p.valorCentavos;
      parcelas.set(k, x);
    }
  return {
    fatos: fatos.length,
    porSituacao,
    lancamentos: todos.slice(0, amostra),
    recusas,
    todos,
    totais: {
      debitos: e.debitos,
      creditos: e.creditos,
      equilibrado: e.debitos === e.creditos,
      parcelas: [...parcelas.values()].sort((a, b) =>
        a.lado === b.lado ? a.conta.localeCompare(b.conta) : a.lado === 'D' ? -1 : 1,
      ),
    },
  };
}
