// Regra 2 (cap-07 §7.2): regra de contabilização VERSIONADA por origem (COTP_ORIGEM_LANCAMENTO) e tipo de fato.
// A versão publicada não muda; uma nova versão tem vigência que começa depois da anterior. Aplicar a regra ao fato é
// determinístico (mesmo fato + mesma versão + mesmo plano + mesmo de-para → o mesmo lançamento, com a mesma chave):
// por isso reprocessar um período aberto dá o mesmo resultado.
import type {
  CondicaoRegra,
  ContaPlano,
  FatoContabil,
  LancamentoGerado,
  PartidaGerada,
  RegraContabil,
  ResultadoContabilizacao,
  ValorCampoFato,
} from '@sgh/contratos';
import { ratearCentavos } from './dinheiro.js';
import { resolverDePara, type ItemDePara } from './depara.js';
import { problemasDoLancamento } from './partidas.js';
import { recusaDeLancamentoNaConta } from './plano.js';

const mesmaChave = (a: RegraContabil, b: RegraContabil) =>
  a.empresa === b.empresa && a.origem === b.origem && a.tipoFato === b.tipoFato && a.nome === b.nome;

const fimOuInfinito = (r: RegraContabil) => r.vigenciaFim ?? '9999-12-31';

/** Forma canônica da regra (base da impressão gravada na publicação e conferida no reprocessamento). */
export function conteudoCanonicoRegra(r: RegraContabil): string {
  const ordenar = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordenar)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(ordenar(r));
}

/**
 * Problemas da publicação de `nova` diante das versões já publicadas (vazio = pode publicar):
 * versão seguinte, vigência coerente e depois da anterior, sem sobreposição com outra regra de mesma prioridade,
 * percentuais por lado somando 100, contas fixas analíticas e ativas no plano.
 */
export function problemasDaPublicacao(
  nova: RegraContabil,
  publicadas: readonly RegraContabil[],
  plano: readonly ContaPlano[],
): string[] {
  const r: string[] = [];
  const mesmas = publicadas.filter((p) => mesmaChave(p, nova)).sort((a, b) => a.versao - b.versao);
  const ultima = mesmas.at(-1);
  const esperada = (ultima?.versao ?? 0) + 1;
  if (nova.versao !== esperada) r.push(`A versão tem de ser ${esperada}.`);
  if (nova.vigenciaFim && nova.vigenciaFim < nova.vigenciaInicio)
    r.push('O fim da vigência é antes do início.');
  if (ultima && nova.vigenciaInicio <= ultima.vigenciaInicio)
    r.push(
      `A vigência tem de começar depois de ${ultima.vigenciaInicio} (início da versão ${ultima.versao}).`,
    );
  const concorrentes = publicadas.filter(
    (p) =>
      !mesmaChave(p, nova) &&
      p.empresa === nova.empresa &&
      p.origem === nova.origem &&
      p.tipoFato === nova.tipoFato &&
      p.prioridade === nova.prioridade &&
      p.vigenciaInicio <= fimOuInfinito(nova) &&
      nova.vigenciaInicio <= fimOuInfinito(p),
  );
  for (const c of concorrentes)
    r.push(`Mesma prioridade e vigência sobreposta à regra "${c.nome}": mude a prioridade ou as condições.`);
  for (const lado of ['D', 'C'] as const) {
    const ps = nova.partidas.filter((p) => p.lado === lado);
    if (ps.length === 0) r.push(`Falta partida de ${lado === 'D' ? 'débito' : 'crédito'}.`);
    const perc = ps.filter((p) => p.valor.base === 'percentual');
    if (perc.length > 0) {
      const soma = perc.reduce((s, p) => s + (p.valor.base === 'percentual' ? p.valor.percentual : 0), 0);
      if (Math.abs(soma - 100) > 1e-9 || perc.length !== ps.length)
        r.push(
          `Os percentuais do ${lado === 'D' ? 'débito' : 'crédito'} têm de somar 100 e cobrir o lado inteiro.`,
        );
    }
  }
  const porCodigo = new Map(plano.filter((c) => c.empresa === nova.empresa).map((c) => [c.codigo, c]));
  for (const p of nova.partidas) {
    const codigo = p.conta.modo === 'fixa' ? p.conta.conta : p.conta.contaPadrao;
    if (!codigo) continue;
    const recusa = recusaDeLancamentoNaConta(porCodigo.get(codigo), codigo);
    if (recusa) r.push(recusa);
  }
  return r;
}

function compara(
  a: ValorCampoFato | undefined,
  op: CondicaoRegra['operador'],
  b: CondicaoRegra['valor'],
): boolean {
  const igual = (x: unknown, y: unknown) => x !== null && x !== undefined && String(x) === String(y);
  switch (op) {
    case 'igual':
      return igual(a, b);
    case 'diferente':
      return !igual(a, b);
    case 'em':
      return Array.isArray(b) && b.some((y) => igual(a, y));
    case 'maiorQue':
      return typeof a === 'number' && typeof b === 'number' && a > b;
    case 'menorQue':
      return typeof a === 'number' && typeof b === 'number' && a < b;
  }
}

export function condicoesValem(r: RegraContabil, f: FatoContabil): boolean {
  return r.condicoes.every((c) => compara(f.campos[c.campo], c.operador, c.valor));
}

/** A regra que vale para o fato: empresa, origem, tipo, vigência na data e condições; vence a menor prioridade. */
export function regraDoFato(regras: readonly RegraContabil[], f: FatoContabil): RegraContabil | null {
  const candidatas = regras
    .filter(
      (r) =>
        r.empresa === f.empresa &&
        r.origem === f.origem &&
        r.tipoFato === f.tipo &&
        r.vigenciaInicio <= f.data &&
        f.data <= fimOuInfinito(r) &&
        condicoesValem(r, f),
    )
    .sort((a, b) => a.prioridade - b.prioridade || b.versao - a.versao || a.nome.localeCompare(b.nome));
  return candidatas[0] ?? null;
}

/** Histórico com os marcadores {campo} trocados (documento, competência e campos do fato). */
export function montarHistorico(modelo: string, f: FatoContabil): string {
  const valores: Record<string, ValorCampoFato> = {
    ...f.campos,
    documento: f.documento,
    competencia: f.competencia,
  };
  const t = modelo.replace(/\{([a-zA-Z0-9]+)\}/g, (_, k: string) => {
    const v = valores[k];
    return v === null || v === undefined ? '' : String(v);
  });
  return (f.estorno ? `Estorno: ${t}` : t).slice(0, 120);
}

export function chaveDoLancamento(f: FatoContabil, r: RegraContabil): string {
  return [f.tabela, f.id, f.tipo, f.impressao, r.nome, r.versao].join(':');
}

export interface ContextoAplicacao {
  readonly plano: readonly ContaPlano[];
  readonly dePara: ReadonlyMap<string, ItemDePara>;
  /** Monta a chave do de-para a partir do valor do campo do fato (o leiaute do de-para é da fonte). */
  readonly chaveDoCampo: (campo: string, f: FatoContabil) => string;
}

/** Aplica a regra vigente ao fato. Nunca inventa conta: sem regra → semRegra; sem conta → semConta. */
export function contabilizar(
  f: FatoContabil,
  regras: readonly RegraContabil[],
  ctx: ContextoAplicacao,
): ResultadoContabilizacao {
  if (f.valorCentavos === 0) return { situacao: 'ignorado', lancamento: null, motivo: 'Fato sem valor.' };
  const r = regraDoFato(regras, f);
  if (!r) return { situacao: 'semRegra', lancamento: null, motivo: 'Nenhuma regra vigente para o fato.' };
  const valorAbs = Math.abs(f.valorCentavos);
  // Fato negativo (devolução, por exemplo) e estorno invertem os lados, sempre com valor positivo nas partidas.
  const inverter = f.estorno !== f.valorCentavos < 0;
  const partidas: PartidaGerada[] = [];
  const planoEmpresa = ctx.plano.filter((c) => c.empresa === f.empresa);
  const porCodigo = new Map(planoEmpresa.map((c) => [c.codigo, c]));
  for (const lado of ['D', 'C'] as const) {
    const ps = r.partidas.filter((p) => p.lado === lado);
    const percentuais = ps.every((p) => p.valor.base === 'percentual')
      ? ratearCentavos(
          valorAbs,
          ps.map((p) => (p.valor.base === 'percentual' ? p.valor.percentual : 0)),
        )
      : null;
    for (const [i, p] of ps.entries()) {
      let conta: string | null;
      if (p.conta.modo === 'fixa') conta = p.conta.conta;
      else {
        const res = resolverDePara(
          ctx.chaveDoCampo(p.conta.campoChave, f),
          ctx.dePara,
          planoEmpresa,
          p.conta.contaPadrao,
        );
        conta = res.conta;
        if (!conta)
          return {
            situacao: 'semConta',
            lancamento: null,
            motivo: `De-para sem conta (${res.motivo}) para "${p.conta.campoChave}".`,
          };
      }
      const recusa = recusaDeLancamentoNaConta(porCodigo.get(conta), conta);
      if (recusa) return { situacao: 'semConta', lancamento: null, motivo: recusa };
      let v: number;
      if (percentuais) v = percentuais[i] ?? 0;
      else if (p.valor.base === 'campo') {
        const bruto = f.campos[p.valor.campo];
        v = Math.abs(typeof bruto === 'number' ? Math.round(bruto) : 0);
      } else v = valorAbs;
      if (v === 0) continue;
      partidas.push({
        lado: inverter ? (lado === 'D' ? 'C' : 'D') : lado,
        conta,
        valorCentavos: v,
        historico: montarHistorico(p.historico, f),
        centroCusto: p.centroCusto === 'doFato' ? f.centroCusto : null,
      });
    }
  }
  const problemas = problemasDoLancamento(partidas);
  if (problemas.length > 0) return { situacao: 'semConta', lancamento: null, motivo: problemas.join(' ') };
  const lancamento: LancamentoGerado = {
    chave: chaveDoLancamento(f, r),
    fato: { tabela: f.tabela, id: f.id, tipo: f.tipo, impressao: f.impressao },
    regra: { nome: r.nome, versao: r.versao },
    empresa: f.empresa,
    data: f.data,
    competencia: f.competencia,
    partidas: [...partidas].sort((a, b) =>
      a.lado === b.lado ? a.conta.localeCompare(b.conta) : a.lado === 'D' ? -1 : 1,
    ),
  };
  return { situacao: 'contabilizado', lancamento, motivo: null };
}
