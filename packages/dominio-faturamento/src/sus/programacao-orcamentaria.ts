// Programação físico-orçamentária (FPO), tetos financeiros e cotas do SUS (F7, 06-SUS linha 54). Regras puras:
//   - o leitor do arquivo da programação que o gestor entrega (código SIGTAP do grupo, subgrupo, forma de organização ou
//     procedimento, quantidade, valor unitário e incremento), com o problema por linha e nada aceito pela metade;
//   - a conferência do teto e da cota (vigência por competência, limite físico ou financeiro, alerta em %);
//   - a apuração do saldo de cada limite (programação vigente, teto e cota) contra a produção da competência, na ordem
//     em que a produção aconteceu, e a crítica do registro que passa do limite (bloqueante quando o limite bloqueia; aviso
//     justificável quando não);
//   - a conferência e a aplicação do remanejamento de cota (entre setores, municípios ou competências), que nunca tira
//     mais do que o saldo e não é decidido por quem pediu.
import type { GravidadeCriticaSus, RegraCriticaSus } from '@sgh/contratos';

export interface ProblemaProgramacaoSus {
  readonly campo: string;
  readonly mensagem: string;
}

// --------------------------------------------------------------------------------------------- leitor da programação

export type NivelProgramacaoSus = 'grupo' | 'subgrupo' | 'forma_organizacao' | 'procedimento';

export interface ItemProgramacaoLido {
  readonly linha: number;
  readonly sequencia: number;
  readonly nivel: NivelProgramacaoSus;
  /** Código SIGTAP: 2 dígitos (grupo), 4 (subgrupo), 6 (forma de organização) ou 10 (procedimento). */
  readonly codigo: string;
  readonly quantidade: number;
  readonly valorUnitario: number | null;
  readonly valorTotal: number;
  readonly percentualIncremento: number | null;
  readonly valorIncremento: number;
  readonly valorTotalComIncremento: number;
}

export interface LeituraProgramacaoSus {
  readonly itens: readonly ItemProgramacaoLido[];
  readonly problemas: readonly (ProblemaProgramacaoSus & { linha: number })[];
  readonly quantidadeTotal: number;
  readonly valorTotal: number;
}

const NIVEL_POR_TAMANHO: Readonly<Record<number, NivelProgramacaoSus>> = {
  2: 'grupo',
  4: 'subgrupo',
  6: 'forma_organizacao',
  10: 'procedimento',
};

/** O número do arquivo: aceita a vírgula decimal e o ponto de milhar ("1.234,56") e o ponto decimal ("1234.56"). */
export function numeroDoArquivo(v: string | undefined): number | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return Number.NaN;
  return Number(normal);
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Lê o arquivo da programação: uma linha por meta, campos separados por ponto e vírgula, barra vertical ou tabulação,
 * na ordem código; quantidade; valor unitário (opcional); percentual de incremento (opcional). A primeira linha pode ser
 * o cabeçalho (o primeiro campo não é número); linha vazia e linha começada por # são ignoradas. O mesmo código duas
 * vezes, o código fora do tamanho da SIGTAP e o número inválido viram problema da linha; com problema, nada é aceito.
 */
export function lerArquivoProgramacao(conteudo: string): LeituraProgramacaoSus {
  const itens: ItemProgramacaoLido[] = [];
  const problemas: (ProblemaProgramacaoSus & { linha: number })[] = [];
  const vistos = new Map<string, number>();
  const linhas = conteudo.replace(/^\uFEFF/, '').split(/\r?\n/);
  linhas.forEach((bruta, i) => {
    const linha = i + 1;
    const t = bruta.trim();
    if (!t || t.startsWith('#')) return;
    const campos = t.split(/[;|\t]/).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    const codigo = (campos[0] ?? '').replace(/[.\-\s]/g, '');
    if (!/^\d+$/.test(codigo)) {
      if (itens.length === 0 && problemas.length === 0 && vistos.size === 0) return; // cabeçalho
      problemas.push({ linha, campo: 'codigo', mensagem: `Linha ${linha}: o código SIGTAP não é numérico.` });
      return;
    }
    const nivel = NIVEL_POR_TAMANHO[codigo.length];
    if (!nivel) {
      problemas.push({
        linha,
        campo: 'codigo',
        mensagem: `Linha ${linha}: o código ${codigo} não tem 2, 4, 6 ou 10 dígitos da tabela unificada.`,
      });
      return;
    }
    const anterior = vistos.get(codigo);
    if (anterior !== undefined) {
      problemas.push({
        linha,
        campo: 'codigo',
        mensagem: `Linha ${linha}: o código ${codigo} já veio na linha ${anterior}.`,
      });
      return;
    }
    vistos.set(codigo, linha);
    const quantidade = numeroDoArquivo(campos[1]);
    const unitario = numeroDoArquivo(campos[2]);
    const incremento = numeroDoArquivo(campos[3]);
    if (quantidade === null || Number.isNaN(quantidade) || quantidade < 0) {
      problemas.push({ linha, campo: 'quantidade', mensagem: `Linha ${linha}: a quantidade é inválida.` });
      return;
    }
    if (unitario !== null && (Number.isNaN(unitario) || unitario < 0)) {
      problemas.push({
        linha,
        campo: 'valorUnitario',
        mensagem: `Linha ${linha}: o valor unitário é inválido.`,
      });
      return;
    }
    if (incremento !== null && (Number.isNaN(incremento) || incremento < 0 || incremento > 1000)) {
      problemas.push({
        linha,
        campo: 'incremento',
        mensagem: `Linha ${linha}: o percentual de incremento é inválido.`,
      });
      return;
    }
    const valorTotal = unitario === null ? 0 : centavos(quantidade * unitario);
    const valorIncremento = incremento === null ? 0 : centavos((valorTotal * incremento) / 100);
    itens.push({
      linha,
      sequencia: itens.length + 1,
      nivel,
      codigo,
      quantidade,
      valorUnitario: unitario,
      valorTotal,
      percentualIncremento: incremento,
      valorIncremento,
      valorTotalComIncremento: centavos(valorTotal + valorIncremento),
    });
  });
  if (!itens.length && !problemas.length)
    problemas.push({
      linha: 0,
      campo: 'conteudo',
      mensagem: 'O arquivo não traz nenhuma linha de programação.',
    });
  return {
    itens: problemas.length ? [] : itens,
    problemas,
    quantidadeTotal: itens.reduce((s, x) => s + x.quantidade, 0),
    valorTotal: centavos(itens.reduce((s, x) => s + x.valorTotalComIncremento, 0)),
  };
}

// ------------------------------------------------------------------------------------------------- vigência e limites

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ultimoDiaDoMes = (d: string) => {
  const [a, m] = d.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

/** A vigência por competência: começa no primeiro dia de um mês e, quando termina, termina no último dia de um mês. */
export function conferirVigenciaCompetencia(inicio: string, fim: string | null): ProblemaProgramacaoSus[] {
  const p: ProblemaProgramacaoSus[] = [];
  if (!DIA.test(inicio) || !inicio.endsWith('-01'))
    p.push({ campo: 'vigenciaInicio', mensagem: 'A vigência começa no primeiro dia da competência.' });
  if (fim !== null) {
    if (!DIA.test(fim) || ultimoDiaDoMes(fim) !== fim)
      p.push({ campo: 'vigenciaFim', mensagem: 'A vigência termina no último dia da competência.' });
    else if (fim < inicio)
      p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
  }
  return p;
}

/** O dia anterior (AAAA-MM-DD): o fim da programação substituída. */
export function vesperaDe(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** A competência AAAAMM pelo primeiro dia (AAAA-MM-01) e o período dela. */
export function periodoDaCompetenciaSus(competencia: string): { inicio: string; fim: string } | null {
  if (!/^\d{6}$/.test(competencia)) return null;
  const m = Number(competencia.slice(4));
  if (m < 1 || m > 12) return null;
  const inicio = `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`;
  return { inicio, fim: ultimoDiaDoMes(inicio) };
}

export type InstrumentoLimiteSus = 'bpa' | 'apac' | 'aih' | 'raas' | 'ciha' | 'todos';
export type TipoLimiteSus = 'programacao' | 'teto' | 'cota';

export interface EntradaLimiteSus {
  readonly tipo: 'teto' | 'cota';
  readonly instrumento: InstrumentoLimiteSus;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly quantidade: number | null;
  readonly valor: number | null;
  readonly percentualAlerta: number | null;
  readonly procedimento: string | null;
  readonly grupo: string | null;
  readonly financiamento: string | null;
}

/** O teto e a cota: vigência por competência, ao menos um limite (físico ou financeiro), alerta entre 0 e 100%. */
export function conferirLimiteSus(e: EntradaLimiteSus): ProblemaProgramacaoSus[] {
  const p = conferirVigenciaCompetencia(e.vigenciaInicio, e.vigenciaFim);
  if (e.quantidade === null && e.valor === null)
    p.push({ campo: 'quantidade', mensagem: 'Informe o limite físico, o financeiro ou os dois.' });
  if (e.quantidade !== null && !(e.quantidade >= 0))
    p.push({ campo: 'quantidade', mensagem: 'A quantidade não pode ser negativa.' });
  if (e.valor !== null && !(e.valor >= 0))
    p.push({ campo: 'valor', mensagem: 'O valor não pode ser negativo.' });
  if (e.percentualAlerta !== null && (e.percentualAlerta < 0 || e.percentualAlerta > 100))
    p.push({ campo: 'percentualAlerta', mensagem: 'O alerta é um percentual entre 0 e 100.' });
  if (e.tipo === 'cota' && (e.instrumento === 'todos' || e.quantidade === null))
    p.push({
      campo: 'instrumento',
      mensagem: 'A cota é de um instrumento só (BPA, APAC ou AIH) e tem quantidade física.',
    });
  if (e.procedimento !== null && !/^\d{10}$/.test(e.procedimento))
    p.push({ campo: 'procedimento', mensagem: 'O procedimento tem os 10 dígitos da tabela unificada.' });
  if (e.grupo !== null && !/^(\d{2}|\d{4}|\d{6})$/.test(e.grupo))
    p.push({ campo: 'grupo', mensagem: 'O grupo tem 2, 4 ou 6 dígitos da tabela unificada.' });
  if (e.procedimento !== null && e.grupo !== null && !e.procedimento.startsWith(e.grupo))
    p.push({ campo: 'grupo', mensagem: 'O procedimento não pertence ao grupo informado.' });
  if (e.financiamento !== null && !/^\d{2}$/.test(e.financiamento))
    p.push({ campo: 'financiamento', mensagem: 'A forma de financiamento tem 2 dígitos (ex.: 06).' });
  return p;
}

// ------------------------------------------------------------------------------------------------ saldo e crítica

/** Um limite em vigor na competência: o item da programação vigente, o teto ou a cota. */
export interface LimiteSus {
  readonly tipo: TipoLimiteSus;
  readonly id: number;
  readonly instrumento: InstrumentoLimiteSus;
  readonly setor: number | null;
  readonly municipio: number | null;
  /** Código de 10 dígitos do procedimento; null vale para todos. */
  readonly procedimento: string | null;
  /** Prefixo do grupo, subgrupo ou forma de organização (2, 4 ou 6 dígitos); null vale para todos. */
  readonly grupo: string | null;
  readonly financiamento: string | null;
  readonly quantidade: number | null;
  readonly valor: number | null;
  readonly percentualAlerta: number;
  /** O excedente vira crítica bloqueante (senão, aviso justificável). */
  readonly bloqueia: boolean;
  readonly descricao: string;
}

/** Um registro de produção da competência (linha do BPA, APAC ou conta de AIH), sem dado pessoal. */
export interface RegistroProducaoSus {
  readonly chave: string;
  readonly instrumento: 'bpa' | 'apac' | 'aih';
  readonly procedimento: string;
  readonly financiamento: string | null;
  readonly setor: number | null;
  /** Id do município de origem do paciente. */
  readonly municipio: number | null;
  readonly quantidade: number;
  readonly valor: number;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly item: number | null;
}

export type SituacaoSaldoSus = 'livre' | 'alerta' | 'excedido';

export interface SaldoLimiteSus {
  readonly limite: LimiteSus;
  readonly registros: number;
  readonly consumoQuantidade: number;
  readonly consumoValor: number;
  readonly saldoQuantidade: number | null;
  readonly saldoValor: number | null;
  /** O maior consumo, em %, entre o físico e o financeiro (null sem limite com valor positivo). */
  readonly percentual: number | null;
  readonly situacao: SituacaoSaldoSus;
  /** Chaves dos registros que passaram do limite, na ordem da produção. */
  readonly excedentes: readonly string[];
}

/** O registro entra no limite? (instrumento, setor, município, procedimento ou grupo e financiamento). */
export function limiteAlcancaRegistro(l: LimiteSus, r: RegistroProducaoSus): boolean {
  if (l.instrumento !== 'todos' && l.instrumento !== r.instrumento) return false;
  if (l.setor !== null && l.setor !== r.setor) return false;
  if (l.municipio !== null && l.municipio !== r.municipio) return false;
  if (l.procedimento !== null && l.procedimento !== r.procedimento) return false;
  if (l.grupo !== null && !r.procedimento.startsWith(l.grupo)) return false;
  if (l.financiamento !== null && l.financiamento !== r.financiamento) return false;
  return true;
}

/**
 * Apura cada limite contra a produção na ordem dada (a da produção): soma quantidade e valor dos registros alcançados e
 * marca como excedente o registro que, somado, passa do limite físico ou do financeiro (e todos os seguintes).
 */
export function apurarSaldosSus(
  limites: readonly LimiteSus[],
  registros: readonly RegistroProducaoSus[],
): SaldoLimiteSus[] {
  return limites.map((l) => {
    let q = 0;
    let v = 0;
    let n = 0;
    const excedentes: string[] = [];
    for (const r of registros) {
      if (!limiteAlcancaRegistro(l, r)) continue;
      n += 1;
      q += r.quantidade;
      v = centavos(v + r.valor);
      if ((l.quantidade !== null && q > l.quantidade) || (l.valor !== null && v > l.valor))
        excedentes.push(r.chave);
    }
    const pct = (consumo: number, limite: number | null) =>
      limite !== null && limite > 0 ? Math.round((consumo * 10000) / limite) / 100 : null;
    const pq = pct(q, l.quantidade);
    const pv = pct(v, l.valor);
    const percentual = pq === null ? pv : pv === null ? pq : Math.max(pq, pv);
    const passou = excedentes.length > 0 || (l.quantidade === 0 && q > 0) || (l.valor === 0 && v > 0);
    return {
      limite: l,
      registros: n,
      consumoQuantidade: q,
      consumoValor: v,
      saldoQuantidade: l.quantidade === null ? null : l.quantidade - q,
      saldoValor: l.valor === null ? null : centavos(l.valor - v),
      percentual,
      situacao: passou
        ? 'excedido'
        : percentual !== null && percentual >= l.percentualAlerta
          ? 'alerta'
          : 'livre',
      excedentes,
    };
  });
}

export interface CriticaLimiteSus {
  readonly chave: string;
  readonly regra: RegraCriticaSus;
  readonly gravidade: GravidadeCriticaSus;
  readonly conta: number | null;
  readonly atendimento: number | null;
  readonly item: number | null;
  readonly detalhe: Record<string, string | number | null>;
}

/**
 * A crítica do registro que passou do limite: `producao-acima-da-cota` (cota) ou `producao-acima-do-teto` (teto e
 * programação). Bloqueante quando o limite bloqueia (a geração do instrumento fica impedida até corrigir ou remanejar);
 * aviso, justificável, quando não. A chave é estável (limite e registro) para a crítica seguinte reconhecer a mesma.
 */
export function criticasDeLimiteSus(
  saldos: readonly SaldoLimiteSus[],
  registros: readonly RegistroProducaoSus[],
): CriticaLimiteSus[] {
  const porChave = new Map(registros.map((r) => [r.chave, r]));
  const out: CriticaLimiteSus[] = [];
  for (const s of saldos)
    for (const chave of s.excedentes) {
      const r = porChave.get(chave);
      if (!r) continue;
      const l = s.limite;
      out.push({
        chave: `limite:${l.tipo}:${l.id}:${chave}`,
        regra: l.tipo === 'cota' ? 'producao-acima-da-cota' : 'producao-acima-do-teto',
        gravidade: l.bloqueia ? 'bloqueante' : 'aviso',
        conta: r.conta,
        atendimento: r.atendimento,
        item: r.item,
        detalhe: {
          limite: l.tipo,
          limiteId: l.id,
          procedimento: r.procedimento,
          limiteQuantidade: l.quantidade,
          limiteValor: l.valor,
          consumoQuantidade: s.consumoQuantidade,
          consumoValor: s.consumoValor,
        },
      });
    }
  return out;
}

// --------------------------------------------------------------------------------------------- remanejamento de cota

export type TipoRemanejamentoSus = 'setor' | 'municipio' | 'competencia';

export interface CotaParaRemanejar {
  readonly setor: number | null;
  readonly municipio: number | null;
  readonly quantidadeCota: number;
  readonly valorCota: number | null;
  readonly consumoQuantidade: number;
  readonly consumoValor: number;
}

export interface PedidoRemanejamentoSus {
  readonly tipo: TipoRemanejamentoSus;
  readonly destinoSetor: number | null;
  readonly destinoMunicipio: number | null;
  readonly origemCompetencia: number | null;
  readonly destinoCompetencia: number | null;
  readonly quantidade: number | null;
  readonly valor: number | null;
  readonly motivo: string;
}

/** O remanejamento só tira do saldo livre da cota, com as pontas do tipo e o motivo escrito. */
export function conferirRemanejamentoCota(
  origem: CotaParaRemanejar,
  p: PedidoRemanejamentoSus,
): ProblemaProgramacaoSus[] {
  const e: ProblemaProgramacaoSus[] = [];
  if ((p.quantidade ?? 0) <= 0 && (p.valor ?? 0) <= 0)
    e.push({ campo: 'quantidade', mensagem: 'Informe a quantidade ou o valor remanejado.' });
  const saldoQ = origem.quantidadeCota - origem.consumoQuantidade;
  if (p.quantidade !== null && p.quantidade > saldoQ)
    e.push({
      campo: 'quantidade',
      mensagem: `A quantidade remanejada passa do saldo livre da cota (${Math.max(0, saldoQ)}).`,
    });
  if (p.valor !== null) {
    if (origem.valorCota === null)
      e.push({ campo: 'valor', mensagem: 'A cota de origem não tem limite financeiro para remanejar.' });
    else if (p.valor > centavos(origem.valorCota - origem.consumoValor))
      e.push({ campo: 'valor', mensagem: 'O valor remanejado passa do saldo financeiro da cota.' });
  }
  if (
    p.tipo === 'setor' &&
    (p.destinoSetor === null || origem.setor === null || p.destinoSetor === origem.setor)
  )
    e.push({
      campo: 'destinoSetor',
      mensagem: 'O remanejamento entre setores sai do setor da cota para outro setor.',
    });
  if (
    p.tipo === 'municipio' &&
    (p.destinoMunicipio === null || origem.municipio === null || p.destinoMunicipio === origem.municipio)
  )
    e.push({
      campo: 'destinoMunicipio',
      mensagem: 'O remanejamento entre municípios sai do município da cota para outro município.',
    });
  if (
    p.tipo === 'competencia' &&
    (p.origemCompetencia === null ||
      p.destinoCompetencia === null ||
      p.origemCompetencia === p.destinoCompetencia)
  )
    e.push({
      campo: 'destinoCompetencia',
      mensagem: 'Informe competências de origem e de destino diferentes.',
    });
  if (p.motivo.trim().length < 10)
    e.push({ campo: 'motivo', mensagem: 'Escreva o motivo do remanejamento (ao menos 10 caracteres).' });
  return e;
}

/** A decisão é de outra pessoa (segregação de funções) e só sobre o pedido ainda solicitado. */
export function conferirDecisaoRemanejamento(
  situacao: string,
  solicitante: number,
  decisor: number,
): ProblemaProgramacaoSus[] {
  if (situacao !== 'solicitada')
    return [{ campo: 'situacao', mensagem: 'O remanejamento já foi decidido ou cancelado.' }];
  if (solicitante === decisor)
    return [{ campo: 'aprovador', mensagem: 'Quem pediu o remanejamento não o decide.' }];
  return [];
}

/** Os limites novos da cota de origem e da de destino depois do remanejamento aprovado. */
export function aplicarRemanejamentoCota(
  origem: { quantidadeCota: number; valorCota: number | null },
  destino: { quantidadeCota: number; valorCota: number | null } | null,
  p: Pick<PedidoRemanejamentoSus, 'quantidade' | 'valor'>,
): {
  origem: { quantidadeCota: number; valorCota: number | null };
  destino: { quantidadeCota: number; valorCota: number | null };
} {
  const q = p.quantidade ?? 0;
  const v = p.valor ?? 0;
  return {
    origem: {
      quantidadeCota: origem.quantidadeCota - q,
      valorCota: origem.valorCota === null ? null : centavos(origem.valorCota - v),
    },
    destino: {
      quantidadeCota: (destino?.quantidadeCota ?? 0) + q,
      valorCota:
        destino === null || destino.valorCota === null
          ? p.valor === null
            ? null
            : centavos(v)
          : centavos(destino.valorCota + v),
    },
  };
}
