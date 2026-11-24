// Obrigatoriedade de documentos clínicos (03-PEP L132): o hospital configura que documento é exigido conforme o
// diagnóstico (CID-10, pelo código ou pela categoria), a faixa etária, o sexo, o setor e o tipo de atendimento, em que
// momento (admissão, durante o atendimento, periódico, alta, fechamento) e com que prazo. A regra decide, para cada
// atendimento aberto, que documentos faltam, e a lista sai para o profissional com o prazo e se a falta bloqueia o
// passo seguinte ou só alerta. Regra pura: sem banco, sem relógio próprio (o "agora" vem de quem chama).

export const MOMENTOS_OBRIGATORIEDADE = [
  'admissao',
  'durante_atendimento',
  'periodico',
  'prescricao',
  'alta',
  'fechamento_atendimento',
] as const;
export type MomentoObrigatoriedade = (typeof MOMENTOS_OBRIGATORIEDADE)[number];

export const TIPOS_ATENDIMENTO_OBRIGATORIEDADE = [
  'todos',
  'ambulatorial',
  'urgencia',
  'internacao',
  'externo',
  'domiciliar',
] as const;
export type TipoAtendimentoObrigatoriedade = (typeof TIPOS_ATENDIMENTO_OBRIGATORIEDADE)[number];

export const EXIGENCIAS_OBRIGATORIEDADE = ['bloquear', 'alertar'] as const;
export type ExigenciaObrigatoriedade = (typeof EXIGENCIAS_OBRIGATORIEDADE)[number];

/** Teto de diagnósticos por regra (a lista é de categorias e códigos, não da CID inteira). */
export const TETO_CIDS_REGRA = 200;
/** Idade máxima aceita na regra: 130 anos em dias. */
export const IDADE_MAXIMA_DIAS = 130 * 366;

export interface FalhaObrigatoriedade {
  readonly codigo: string;
  readonly mensagem: string;
}

/** O que a tela manda ao gravar a regra (ids já conferidos no banco por quem grava). */
export interface RegraObrigatoriedadeEntrada {
  readonly modelo: number;
  readonly setor: number | null;
  readonly sexo: number | null;
  readonly tipoAtendimento: TipoAtendimentoObrigatoriedade;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly cids: readonly string[];
  readonly momento: MomentoObrigatoriedade;
  readonly exigencia: ExigenciaObrigatoriedade;
  readonly prazoMinutos: number | null;
  readonly intervaloDias: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** A regra como o avaliador precisa: a entrada gravada, o id e o título do documento exigido. */
export interface RegraObrigatoriedade extends RegraObrigatoriedadeEntrada {
  readonly id: number;
  readonly titulo: string;
  readonly ativo: boolean;
}

/** O atendimento como a regra o enxerga (vocabulário neutro). */
export interface AtendimentoAvaliado {
  readonly tipo: Exclude<TipoAtendimentoObrigatoriedade, 'todos'> | null;
  readonly setor: number | null;
  readonly sexo: number | null;
  /** Data de nascimento AAAA-MM-DD; sem ela, regra com faixa etária não se aplica (não se presume a idade). */
  readonly nascimento: string | null;
  /** CID-10 ativos do atendimento (com ou sem ponto). */
  readonly cids: readonly string[];
  /** ISO da entrada. */
  readonly entrada: string;
  /** ISO da alta médica, quando houver. */
  readonly altaMedica: string | null;
  /** ISO da saída (fechamento do atendimento), quando houver. */
  readonly saida: string | null;
  /** Há item prescrito no atendimento (o momento "prescricao" conta a partir do primeiro). */
  readonly primeiraPrescricao: string | null;
}

/** Documento do atendimento (não suspenso) pelo modelo e o momento clínico de referência. */
export interface DocumentoDoAtendimento {
  readonly modelo: number;
  readonly em: string;
}

export interface PendenciaObrigatoria {
  readonly regra: number;
  readonly modelo: number;
  readonly titulo: string;
  readonly momento: MomentoObrigatoriedade;
  readonly exigencia: ExigenciaObrigatoriedade;
  /** Desde quando o documento é exigido (ISO). */
  readonly exigidoDesde: string;
  /** Prazo para preencher (ISO); sem prazo na regra, null. */
  readonly prazo: string | null;
  readonly vencida: boolean;
  /** Por que a regra se aplicou, em texto para o profissional. */
  readonly motivo: string;
}

const DIA = 86_400_000;
const MIN = 60_000;

/** CID-10 sem ponto, em maiúsculas; o formato aceito é o da tabela (letra, 2 dígitos e até 3 complementos). */
export function normalizarCid(cid: string): string {
  return cid.replace(/[.\s-]/g, '').toUpperCase();
}
const CID_VALIDO = /^[A-Z][0-9]{2}[0-9A-Z]{0,3}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere a regra antes de gravar: devolve as falhas (lista vazia = pode gravar). */
export function validarRegraObrigatoriedade(e: RegraObrigatoriedadeEntrada): FalhaObrigatoriedade[] {
  const f: FalhaObrigatoriedade[] = [];
  const min = e.idadeMinimaDias;
  const max = e.idadeMaximaDias;
  for (const [v, rotulo] of [
    [min, 'mínima'],
    [max, 'máxima'],
  ] as const)
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > IDADE_MAXIMA_DIAS))
      f.push({ codigo: 'idade-invalida', mensagem: `A idade ${rotulo} precisa estar entre 0 e 130 anos.` });
  if (min !== null && max !== null && min > max)
    f.push({ codigo: 'faixa-etaria-invertida', mensagem: 'A idade mínima passa da máxima.' });
  if (e.momento === 'periodico' && (e.intervaloDias === null || e.intervaloDias < 1))
    f.push({
      codigo: 'periodico-sem-intervalo',
      mensagem: 'O documento periódico precisa do intervalo em dias.',
    });
  if (e.momento !== 'periodico' && e.intervaloDias !== null)
    f.push({
      codigo: 'intervalo-fora-do-periodico',
      mensagem: 'O intervalo só vale para o momento periódico.',
    });
  if (e.prazoMinutos !== null && (!Number.isInteger(e.prazoMinutos) || e.prazoMinutos < 1))
    f.push({ codigo: 'prazo-invalido', mensagem: 'O prazo precisa ser de pelo menos 1 minuto.' });
  if (!DATA.test(e.vigenciaInicio))
    f.push({ codigo: 'vigencia-invalida', mensagem: 'Informe o início da vigência (AAAA-MM-DD).' });
  if (e.vigenciaFim !== null && (!DATA.test(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    f.push({ codigo: 'vigencia-invertida', mensagem: 'O fim da vigência é anterior ao início.' });
  if (e.cids.length > TETO_CIDS_REGRA)
    f.push({ codigo: 'cids-demais', mensagem: `No máximo ${TETO_CIDS_REGRA} diagnósticos por regra.` });
  const vistos = new Set<string>();
  for (const c of e.cids) {
    const n = normalizarCid(c);
    if (!CID_VALIDO.test(n)) {
      f.push({ codigo: 'cid-invalido', mensagem: `O código ${c} não é um CID-10 válido.` });
      continue;
    }
    if (vistos.has(n)) f.push({ codigo: 'cid-repetido', mensagem: `O CID ${n} está repetido na regra.` });
    vistos.add(n);
  }
  return f;
}

/** Idade em dias completos na data de referência (nascimento AAAA-MM-DD). */
export function idadeEmDias(nascimento: string, referencia: Date): number {
  const n = Date.UTC(+nascimento.slice(0, 4), +nascimento.slice(5, 7) - 1, +nascimento.slice(8, 10));
  const r = Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), referencia.getUTCDate());
  return Math.floor((r - n) / DIA);
}

/** A regra cobre o diagnóstico: o código da regra é o próprio CID ou a categoria dele (I21 cobre I210). */
export function cidCoberto(regra: readonly string[], doAtendimento: readonly string[]): string | null {
  const alvos = doAtendimento.map(normalizarCid);
  for (const r of regra.map(normalizarCid)) {
    const achado = alvos.find((a) => a.startsWith(r));
    if (achado) return achado;
  }
  return null;
}

/** A regra se aplica ao atendimento? Devolve o motivo (texto) ou null. Data de referência: o "agora". */
export function regraAplica(r: RegraObrigatoriedade, a: AtendimentoAvaliado, agora: Date): string | null {
  if (!r.ativo) return null;
  const hoje = agora.toISOString().slice(0, 10);
  if (r.vigenciaInicio > hoje || (r.vigenciaFim !== null && r.vigenciaFim < hoje)) return null;
  const motivos: string[] = [];
  if (r.tipoAtendimento !== 'todos') {
    if (a.tipo !== r.tipoAtendimento) return null;
    motivos.push(`atendimento ${r.tipoAtendimento}`);
  }
  if (r.setor !== null) {
    if (a.setor !== r.setor) return null;
    motivos.push('setor do atendimento');
  }
  if (r.sexo !== null) {
    if (a.sexo !== r.sexo) return null;
    motivos.push('sexo');
  }
  if (r.idadeMinimaDias !== null || r.idadeMaximaDias !== null) {
    if (!a.nascimento) return null;
    const idade = idadeEmDias(a.nascimento, agora);
    if (r.idadeMinimaDias !== null && idade < r.idadeMinimaDias) return null;
    if (r.idadeMaximaDias !== null && idade > r.idadeMaximaDias) return null;
    motivos.push('faixa etária');
  }
  if (r.cids.length > 0) {
    const cid = cidCoberto(r.cids, a.cids);
    if (!cid) return null;
    motivos.push(`diagnóstico ${cid}`);
  }
  return motivos.length ? `Exigido por: ${motivos.join(', ')}.` : 'Exigido para todo atendimento.';
}

/** Desde quando o documento é exigido no momento da regra; null quando o momento ainda não chegou. */
function exigidoDesde(r: RegraObrigatoriedade, a: AtendimentoAvaliado): string | null {
  switch (r.momento) {
    case 'admissao':
    case 'durante_atendimento':
    case 'periodico':
      return a.entrada;
    case 'prescricao':
      return a.primeiraPrescricao;
    case 'alta':
      return a.altaMedica;
    case 'fechamento_atendimento':
      return a.saida ?? a.altaMedica;
  }
}

/**
 * As pendências do atendimento pelas regras: para cada regra que se aplica, cujo momento chegou e cujo documento não
 * foi feito na janela, uma pendência com o prazo (início do momento + prazo da regra) e se venceu. No periódico, a
 * janela é o ciclo corrente (entrada + k × intervalo); fora dele, qualquer documento do modelo a partir da entrada
 * vale. A mesma regra para o mesmo modelo não gera duas pendências.
 */
export function pendenciasObrigatorias(
  regras: readonly RegraObrigatoriedade[],
  a: AtendimentoAvaliado,
  documentos: readonly DocumentoDoAtendimento[],
  agora: Date,
): PendenciaObrigatoria[] {
  const r: PendenciaObrigatoria[] = [];
  const modelosVistos = new Set<string>();
  const t = agora.getTime();
  for (const regra of regras) {
    const motivo = regraAplica(regra, a, agora);
    if (!motivo) continue;
    let desde = exigidoDesde(regra, a);
    if (!desde) continue;
    if (regra.momento === 'periodico' && regra.intervaloDias) {
      const passo = regra.intervaloDias * DIA;
      const inicio = new Date(desde).getTime();
      const ciclos = Math.max(0, Math.floor((t - inicio) / passo));
      desde = new Date(inicio + ciclos * passo).toISOString();
    }
    const base = regra.momento === 'periodico' ? new Date(desde).getTime() : new Date(a.entrada).getTime();
    const feito = documentos.some((d) => d.modelo === regra.modelo && new Date(d.em).getTime() >= base);
    if (feito) continue;
    const chave = `${regra.modelo}|${regra.momento}`;
    if (modelosVistos.has(chave)) continue;
    modelosVistos.add(chave);
    const prazo =
      regra.prazoMinutos === null
        ? null
        : new Date(new Date(desde).getTime() + regra.prazoMinutos * MIN).toISOString();
    r.push({
      regra: regra.id,
      modelo: regra.modelo,
      titulo: regra.titulo,
      momento: regra.momento,
      exigencia: regra.exigencia,
      exigidoDesde: desde,
      prazo,
      vencida: prazo !== null && new Date(prazo).getTime() < t,
      motivo,
    });
  }
  // Vencidas e bloqueantes primeiro; depois pelo prazo mais próximo.
  return r.sort(
    (x, y) =>
      Number(y.vencida) - Number(x.vencida) ||
      Number(y.exigencia === 'bloquear') - Number(x.exigencia === 'bloquear') ||
      (x.prazo ?? '9').localeCompare(y.prazo ?? '9'),
  );
}

/** Tipo de atendimento da regra a partir do tipo-base da categoria do atendimento. */
export function tipoAtendimentoDaCategoria(
  tipoBase: string | null,
): Exclude<TipoAtendimentoObrigatoriedade, 'todos'> | null {
  switch (tipoBase) {
    case 'ambulatorio':
    case 'telessaude':
      return 'ambulatorial';
    case 'pronto_atendimento':
      return 'urgencia';
    case 'internacao':
      return 'internacao';
    case 'externo':
      return 'externo';
    default:
      return null;
  }
}
