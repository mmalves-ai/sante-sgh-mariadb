// C2-042 (03-PEP L134): os protocolos clínicos gerenciados (sepse, dor torácica, AVC) com os critérios de entrada
// avaliados pelo sistema e as etapas com meta de tempo, sem banco (a API e a tela usam as mesmas regras):
//   - o critério (sinal vital, diagnóstico, resultado, escala, idade) conferido na configuração e avaliado contra os
//     fatos clínicos do paciente (o dado mais recente dentro da janela de validade; sexo e faixa de idade);
//   - os grupos de critério combinados pela fórmula de entrada (E, OU, NAO, PELO_MENOS n (…), parênteses), com a
//     fórmula conferida antes de gravar (grupo inexistente, sintaxe);
//   - o alerta de paciente elegível: atende à fórmula, cabe no público do protocolo e não tem o protocolo aberto;
//   - as etapas da inclusão com o prazo de cada meta a partir do horário zero, pela faixa etária do paciente; a
//     conclusão no prazo (meta atingida) ou fora dele (meta perdida, com justificativa obrigatória); o relógio de cada
//     etapa (no prazo, vencendo, vencida);
//   - os modelos de mercado configuráveis: pacote da 1ª hora da sepse (Surviving Sepsis Campaign 2021, ILAS), dor
//     torácica (ECG em 10 min, porta-agulha 30 min, porta-balão 90 min; SBC/AHA) e AVC (porta-TC 25 min, porta-agulha
//     60 min; AHA/ASA, Ministério da Saúde).
// Base: RDC 36/2013 (protocolos de segurança do paciente); a etapa e o critério nunca são apagados (inativação).
import { diferencaMinutos, somarMinutos } from '../tempo.js';

// ── Critérios ────────────────────────────────────────────────────────────────────────────────────────

export const CATEGORIAS_CRITERIO = [
  'diagnostico',
  'sinal_vital',
  'resultado_exame',
  'escala',
  'idade',
] as const;
export type CategoriaCriterio = (typeof CATEGORIAS_CRITERIO)[number];
export type FinalidadeCriterio = 'entrada' | 'saida' | 'sugestao';
export type SexoCriterio = 'todos' | 'feminino' | 'masculino';

export interface CriterioProtocolo {
  readonly id: number;
  readonly sequencia: number;
  readonly finalidade: FinalidadeCriterio;
  readonly grupo: string | null;
  readonly categoria: CategoriaCriterio;
  /** Sinal vital, analito do exame ou escala (o código); nulo no diagnóstico e na idade. */
  readonly campo: string | null;
  /** O termo do diagnóstico (CID). */
  readonly termo: number | null;
  readonly valorTexto: string | null;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly sexo: SexoCriterio;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly validadeHoras: number | null;
  readonly descricao: string | null;
  readonly ativo: boolean;
}

/** Um dado do paciente que os critérios avaliam (a aferição, o diagnóstico, o resultado, o escore). */
export interface FatoClinico {
  readonly categoria: CategoriaCriterio;
  /** O código do sinal vital, do analito, da escala; no diagnóstico, o id do termo. */
  readonly chave: string;
  readonly valor: number | null;
  readonly texto: string | null;
  /** AAAA-MM-DDTHH:mm (hora local do estabelecimento). */
  readonly em: string;
}

export interface PacienteAvaliado {
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly idadeDias: number | null;
}

export interface ResultadoCriterio {
  readonly criterio: number;
  readonly sequencia: number;
  readonly grupo: string;
  readonly descricao: string;
  readonly chave: string | null;
  readonly atendido: boolean;
  readonly valorEncontrado: string | null;
  readonly motivo: string;
}

/** A janela padrão do dado quando o critério não diz (o sinal vital de 24 h atrás já não descreve o paciente). */
export const VALIDADE_PADRAO_HORAS: Readonly<Record<CategoriaCriterio, number | null>> = {
  sinal_vital: 6,
  resultado_exame: 24,
  escala: 24,
  diagnostico: null,
  idade: null,
};

const GRUPO = /^[a-z][a-z0-9_]{0,59}$/;

export const grupoDoCriterio = (c: Pick<CriterioProtocolo, 'grupo' | 'sequencia'>): string =>
  c.grupo ?? `criterio_${c.sequencia}`;

const chaveDoCriterio = (c: CriterioProtocolo): string | null =>
  c.categoria === 'diagnostico' ? (c.termo === null ? null : String(c.termo)) : c.campo;

const fmt = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

/** A descrição do critério para a tela e para o registro da inclusão. */
export function descreverCriterio(c: CriterioProtocolo): string {
  if (c.descricao) return c.descricao;
  const alvo =
    c.categoria === 'diagnostico'
      ? `diagnóstico ${c.termo ?? '?'}`
      : c.categoria === 'idade'
        ? 'idade'
        : `${c.campo ?? '?'}`;
  const partes: string[] = [];
  if (c.valorTexto) partes.push(`= ${c.valorTexto}`);
  if (c.valorMinimo !== null) partes.push(`≥ ${fmt(c.valorMinimo)}`);
  if (c.valorMaximo !== null) partes.push(`≤ ${fmt(c.valorMaximo)}`);
  return partes.length ? `${alvo} ${partes.join(' e ')}` : alvo;
}

export function avaliarCriterio(
  c: CriterioProtocolo,
  fatos: readonly FatoClinico[],
  paciente: PacienteAvaliado,
  agora: string,
): ResultadoCriterio {
  const base = {
    criterio: c.id,
    sequencia: c.sequencia,
    grupo: grupoDoCriterio(c),
    descricao: descreverCriterio(c),
    chave: chaveDoCriterio(c),
  };
  const nao = (motivo: string, valorEncontrado: string | null = null): ResultadoCriterio => ({
    ...base,
    atendido: false,
    valorEncontrado,
    motivo,
  });
  if (c.sexo !== 'todos' && paciente.sexo !== c.sexo) return nao('Vale só para outro sexo.');
  if (c.idadeMinimaDias !== null || c.idadeMaximaDias !== null) {
    if (paciente.idadeDias === null) return nao('A idade do paciente não está registrada.');
    if (c.idadeMinimaDias !== null && paciente.idadeDias < c.idadeMinimaDias)
      return nao('Abaixo da idade do critério.', `${paciente.idadeDias} dias`);
    if (c.idadeMaximaDias !== null && paciente.idadeDias > c.idadeMaximaDias)
      return nao('Acima da idade do critério.', `${paciente.idadeDias} dias`);
  }
  if (c.categoria === 'idade')
    return {
      ...base,
      atendido: true,
      valorEncontrado: `${paciente.idadeDias} dias`,
      motivo: 'Idade na faixa.',
    };
  const chave = base.chave;
  if (chave === null) return nao('Critério sem o dado avaliado.');
  const validade = c.validadeHoras ?? VALIDADE_PADRAO_HORAS[c.categoria];
  const candidatos = fatos.filter(
    (f) =>
      f.categoria === c.categoria &&
      f.chave === chave &&
      diferencaMinutos(f.em, agora) >= 0 &&
      (validade === null || diferencaMinutos(f.em, agora) <= validade * 60),
  );
  if (candidatos.length === 0)
    return nao(validade === null ? 'Sem o dado no atendimento.' : `Sem o dado nas últimas ${validade} h.`);
  // O dado mais recente descreve o paciente agora.
  const f = candidatos.reduce((m, x) => (x.em > m.em ? x : m));
  const encontrado = f.valor !== null ? fmt(f.valor) : (f.texto ?? 'registrado');
  if (c.valorTexto !== null) {
    const ok = (f.texto ?? '').trim().toLowerCase() === c.valorTexto.trim().toLowerCase();
    return ok
      ? { ...base, atendido: true, valorEncontrado: encontrado, motivo: 'Valor igual ao do critério.' }
      : nao('Valor diferente do critério.', encontrado);
  }
  if (c.valorMinimo !== null || c.valorMaximo !== null) {
    if (f.valor === null) return nao('O dado não tem valor numérico.', encontrado);
    if (c.valorMinimo !== null && f.valor < c.valorMinimo)
      return nao('Abaixo do valor do critério.', encontrado);
    if (c.valorMaximo !== null && f.valor > c.valorMaximo)
      return nao('Acima do valor do critério.', encontrado);
    return { ...base, atendido: true, valorEncontrado: encontrado, motivo: 'Valor na faixa do critério.' };
  }
  // Sem valor de referência: a presença do dado basta (o diagnóstico registrado).
  return { ...base, atendido: true, valorEncontrado: encontrado, motivo: 'Dado registrado.' };
}

export interface CriterioEntrada {
  readonly finalidade: FinalidadeCriterio;
  readonly grupo: string | null;
  readonly categoria: CategoriaCriterio;
  readonly campo: string | null;
  readonly termo: number | null;
  readonly valorTexto: string | null;
  readonly valorMinimo: number | null;
  readonly valorMaximo: number | null;
  readonly sexo: SexoCriterio;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly validadeHoras: number | null;
}

export type ProblemaCriterio =
  | 'grupo-invalido'
  | 'campo-obrigatorio'
  | 'termo-obrigatorio'
  | 'valor-obrigatorio'
  | 'faixa-invertida'
  | 'idade-obrigatoria'
  | 'idade-invertida'
  | 'validade-invalida';

export const MENSAGENS_CRITERIO: Readonly<Record<ProblemaCriterio, string>> = {
  'grupo-invalido': 'O grupo usa letras minúsculas, números e sublinhado, começando por letra.',
  'campo-obrigatorio': 'Escolha o dado avaliado (sinal vital, analito ou escala).',
  'termo-obrigatorio': 'Escolha o diagnóstico (CID) que dispara o critério.',
  'valor-obrigatorio': 'Informe o valor mínimo, o máximo ou o texto esperado.',
  'faixa-invertida': 'O valor máximo é menor que o mínimo.',
  'idade-obrigatoria': 'O critério de idade precisa da idade mínima ou máxima.',
  'idade-invertida': 'A idade máxima é menor que a mínima.',
  'validade-invalida': 'A janela de validade vai de 1 a 720 horas.',
};

/** A conferência da configuração do critério (a tela avisa na hora; a API recusa sem gravar). */
export function problemasDoCriterio(e: CriterioEntrada): ProblemaCriterio[] {
  const p: ProblemaCriterio[] = [];
  if (e.grupo !== null && !GRUPO.test(e.grupo)) p.push('grupo-invalido');
  if (['sinal_vital', 'resultado_exame', 'escala'].includes(e.categoria)) {
    if (!e.campo?.trim()) p.push('campo-obrigatorio');
    if (e.valorMinimo === null && e.valorMaximo === null && !e.valorTexto?.trim())
      p.push('valor-obrigatorio');
  }
  if (e.categoria === 'diagnostico' && e.termo === null) p.push('termo-obrigatorio');
  if (e.categoria === 'idade' && e.idadeMinimaDias === null && e.idadeMaximaDias === null)
    p.push('idade-obrigatoria');
  if (e.valorMinimo !== null && e.valorMaximo !== null && e.valorMaximo < e.valorMinimo)
    p.push('faixa-invertida');
  if (e.idadeMinimaDias !== null && e.idadeMaximaDias !== null && e.idadeMaximaDias < e.idadeMinimaDias)
    p.push('idade-invertida');
  if (e.validadeHoras !== null && (e.validadeHoras < 1 || e.validadeHoras > 720)) p.push('validade-invalida');
  return p;
}

// ── Fórmula de entrada ───────────────────────────────────────────────────────────────────────────────

type No =
  | { t: 'grupo'; nome: string }
  | { t: 'e' | 'ou'; a: No; b: No }
  | { t: 'nao'; a: No }
  | { t: 'pelo_menos'; n: number; itens: No[] };

export class ErroFormula extends Error {
  override readonly name = 'ErroFormula';
}

function tokens(f: string): string[] {
  const r = f.match(/\(|\)|,|[A-Za-z_][A-Za-z0-9_]*|\d+|\S/g);
  return r ?? [];
}

function analisar(f: string): No {
  const tk = tokens(f);
  let i = 0;
  const ver = () => tk[i];
  const comer = (esperado?: string): string => {
    const x = tk[i];
    if (x === undefined || (esperado !== undefined && x !== esperado))
      throw new ErroFormula(
        esperado ? `Esperado "${esperado}" na fórmula.` : 'A fórmula termina antes da hora.',
      );
    i++;
    return x;
  };
  const ou = (): No => {
    let a = e();
    while (ver() === 'OU') {
      comer();
      a = { t: 'ou', a, b: e() };
    }
    return a;
  };
  const e = (): No => {
    let a = unario();
    while (ver() === 'E') {
      comer();
      a = { t: 'e', a, b: unario() };
    }
    return a;
  };
  const unario = (): No => {
    const x = ver();
    if (x === 'NAO') {
      comer();
      return { t: 'nao', a: unario() };
    }
    if (x === 'PELO_MENOS') {
      comer();
      const n = Number(comer());
      if (!Number.isInteger(n) || n < 1)
        throw new ErroFormula('PELO_MENOS pede um número inteiro de 1 em diante.');
      comer('(');
      const itens = [ou()];
      while (ver() === ',') {
        comer();
        itens.push(ou());
      }
      comer(')');
      if (n > itens.length) throw new ErroFormula(`PELO_MENOS ${n} com só ${itens.length} item(ns).`);
      return { t: 'pelo_menos', n, itens };
    }
    if (x === '(') {
      comer();
      const a = ou();
      comer(')');
      return a;
    }
    if (x !== undefined && GRUPO.test(x)) {
      comer();
      return { t: 'grupo', nome: x };
    }
    throw new ErroFormula(
      x === undefined ? 'A fórmula está vazia ou incompleta.' : `Termo inesperado: "${x}".`,
    );
  };
  const raiz = ou();
  if (i < tk.length) throw new ErroFormula(`Termo inesperado: "${tk[i]}".`);
  return raiz;
}

function gruposDe(n: No, s = new Set<string>()): Set<string> {
  if (n.t === 'grupo') s.add(n.nome);
  else if (n.t === 'nao') gruposDe(n.a, s);
  else if (n.t === 'pelo_menos') n.itens.forEach((x) => gruposDe(x, s));
  else {
    gruposDe(n.a, s);
    gruposDe(n.b, s);
  }
  return s;
}

function avaliarNo(n: No, g: ReadonlyMap<string, boolean>): boolean {
  switch (n.t) {
    case 'grupo':
      return g.get(n.nome) ?? false;
    case 'e':
      return avaliarNo(n.a, g) && avaliarNo(n.b, g);
    case 'ou':
      return avaliarNo(n.a, g) || avaliarNo(n.b, g);
    case 'nao':
      return !avaliarNo(n.a, g);
    case 'pelo_menos':
      return n.itens.filter((x) => avaliarNo(x, g)).length >= n.n;
  }
}

/** A fórmula padrão quando o protocolo não tem uma: todos os grupos (E). */
export const formulaPadrao = (grupos: readonly string[]): string => [...new Set(grupos)].join(' E ');

/** Confere a fórmula contra os grupos dos critérios de entrada ativos; devolve a mensagem do problema ou null. */
export function problemaDaFormula(formula: string, grupos: readonly string[]): string | null {
  if (formula.trim().length > 4000) return 'A fórmula passa de 4000 caracteres.';
  try {
    const usados = gruposDe(analisar(formula));
    const faltam = [...usados].filter((x) => !grupos.includes(x));
    return faltam.length ? `Grupo(s) sem critério ativo: ${faltam.join(', ')}.` : null;
  } catch (e) {
    if (e instanceof ErroFormula) return e.message;
    throw e;
  }
}

export interface AvaliacaoEntrada {
  readonly elegivel: boolean;
  readonly formula: string;
  readonly grupos: readonly { nome: string; atendido: boolean }[];
  readonly resultados: readonly ResultadoCriterio[];
  /** A expressão como foi avaliada (vai ao registro da inclusão). */
  readonly regraAvaliada: string;
}

/**
 * Avalia os critérios de entrada ativos: um grupo vale quando um dos seus critérios é atendido; a fórmula combina os
 * grupos. Sem critério de entrada ativo, o protocolo nunca é sugerido (a inclusão é manual).
 */
export function avaliarEntrada(
  formula: string | null,
  criterios: readonly CriterioProtocolo[],
  fatos: readonly FatoClinico[],
  paciente: PacienteAvaliado,
  agora: string,
): AvaliacaoEntrada {
  const ativos = criterios.filter((c) => c.ativo && c.finalidade === 'entrada');
  const resultados = ativos.map((c) => avaliarCriterio(c, fatos, paciente, agora));
  const g = new Map<string, boolean>();
  for (const r of resultados) g.set(r.grupo, (g.get(r.grupo) ?? false) || r.atendido);
  const nomes = [...g.keys()];
  const f = formula?.trim() || formulaPadrao(nomes);
  let elegivel = false;
  if (ativos.length > 0 && problemaDaFormula(f, nomes) === null) elegivel = avaliarNo(analisar(f), g);
  const grupos = nomes.map((nome) => ({ nome, atendido: g.get(nome) ?? false }));
  return {
    elegivel,
    formula: f,
    grupos,
    resultados,
    regraAvaliada: `${f} → ${grupos.map((x) => `${x.nome}: ${x.atendido ? 'sim' : 'não'}`).join('; ')}`,
  };
}

// ── Público e alerta de elegível ─────────────────────────────────────────────────────────────────────

export type PublicoProtocolo = 'todos' | 'adulto' | 'pediatrico' | 'neonatal' | 'obstetrico';
const DIAS_ANO = 365;

/** O paciente cabe no público do protocolo (sem idade registrada, só o público "todos"). */
export function cabeNoPublico(publico: PublicoProtocolo, p: PacienteAvaliado): boolean {
  if (publico === 'todos') return true;
  if (publico === 'obstetrico') return p.sexo === 'feminino';
  if (p.idadeDias === null) return false;
  if (publico === 'neonatal') return p.idadeDias < 28;
  if (publico === 'pediatrico') return p.idadeDias < 18 * DIAS_ANO;
  return p.idadeDias >= 18 * DIAS_ANO;
}

export interface ProtocoloParaAvaliar {
  readonly id: number;
  readonly nome: string;
  readonly tipo: string;
  readonly publico: PublicoProtocolo;
  readonly formula: string | null;
  readonly mensagem: string | null;
  readonly criterios: readonly CriterioProtocolo[];
}

export interface CandidatoAvaliado {
  readonly atendimento: number;
  readonly paciente: number;
  readonly dados: PacienteAvaliado;
  readonly fatos: readonly FatoClinico[];
}

export interface AlertaElegivel {
  readonly atendimento: number;
  readonly paciente: number;
  readonly protocolo: number;
  readonly nome: string;
  readonly tipo: string;
  readonly mensagem: string | null;
  readonly criteriosAtendidos: readonly string[];
  readonly regraAvaliada: string;
  /** A hora do dado mais recente que fez o paciente elegível (o tempo zero sugerido). */
  readonly desde: string | null;
}

/** Os pacientes que atendem à entrada de um protocolo ativo sem tê-lo aberto no atendimento. */
export function alertasDeElegiveis(
  candidatos: readonly CandidatoAvaliado[],
  protocolos: readonly ProtocoloParaAvaliar[],
  abertos: ReadonlySet<string>,
  agora: string,
): AlertaElegivel[] {
  const r: AlertaElegivel[] = [];
  for (const c of candidatos)
    for (const p of protocolos) {
      if (abertos.has(`${c.atendimento}|${p.id}`) || !cabeNoPublico(p.publico, c.dados)) continue;
      const a = avaliarEntrada(p.formula, p.criterios, c.fatos, c.dados, agora);
      if (!a.elegivel) continue;
      const atendidos = a.resultados.filter((x) => x.atendido);
      const horas = c.fatos
        .filter((f) => atendidos.some((x) => x.chave === f.chave))
        .map((f) => f.em)
        .filter((em) => em <= agora)
        .sort();
      r.push({
        atendimento: c.atendimento,
        paciente: c.paciente,
        protocolo: p.id,
        nome: p.nome,
        tipo: p.tipo,
        mensagem: p.mensagem,
        criteriosAtendidos: atendidos.map((x) => `${x.descricao} (${x.valorEncontrado ?? '—'})`),
        regraAvaliada: a.regraAvaliada,
        desde: horas.at(-1) ?? null,
      });
    }
  return r.sort((a, b) => (a.desde ?? '').localeCompare(b.desde ?? '') || a.atendimento - b.atendimento);
}

// ── Etapas com meta de tempo ─────────────────────────────────────────────────────────────────────────

export const TIPOS_ETAPA = [
  'avaliacao',
  'exame',
  'medicacao',
  'documento',
  'consulta',
  'reavaliacao',
  'desfecho',
  'outro',
] as const;
export type TipoEtapa = (typeof TIPOS_ETAPA)[number];
export type FaixaEtapa = 'todas' | 'adulto' | 'pediatrico' | 'neonatal' | 'idoso';

export interface EtapaProtocolo {
  readonly id: number;
  readonly sequencia: number;
  readonly nome: string;
  readonly tipo: TipoEtapa;
  readonly metaMinutos: number | null;
  readonly faixaEtaria: FaixaEtapa;
  readonly obrigatoria: boolean;
}

export function faixaDoPaciente(idadeDias: number | null): Exclude<FaixaEtapa, 'todas'> | null {
  if (idadeDias === null) return null;
  if (idadeDias < 28) return 'neonatal';
  if (idadeDias < 18 * DIAS_ANO) return 'pediatrico';
  if (idadeDias >= 60 * DIAS_ANO) return 'idoso';
  return 'adulto';
}

/** A etapa vale para o paciente: "todas", a mesma faixa, ou a do adulto para o idoso (sem idade, só "todas"). */
export function etapaValeParaPaciente(faixa: FaixaEtapa, idadeDias: number | null): boolean {
  if (faixa === 'todas') return true;
  const f = faixaDoPaciente(idadeDias);
  return f === faixa || (faixa === 'adulto' && f === 'idoso');
}

export interface EtapaPlanejada {
  readonly etapa: number;
  readonly sequencia: number;
  readonly iniciadaEm: string;
  readonly prazoMetaEm: string | null;
}

/** As etapas da inclusão, na ordem, com o prazo de cada meta contado do horário zero. */
export function planoDasEtapas(
  etapas: readonly EtapaProtocolo[],
  horarioZero: string,
  idadeDias: number | null,
): EtapaPlanejada[] {
  return [...etapas]
    .filter((e) => etapaValeParaPaciente(e.faixaEtaria, idadeDias))
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((e, i) => ({
      etapa: e.id,
      sequencia: i + 1,
      iniciadaEm: horarioZero,
      prazoMetaEm: e.metaMinutos === null ? null : somarMinutos(horarioZero, e.metaMinutos),
    }));
}

export type SituacaoEtapa = 'em_andamento' | 'meta_atingida' | 'meta_perdida' | 'cancelada';

export const situacaoAoConcluir = (prazo: string | null, concluidaEm: string): SituacaoEtapa =>
  prazo === null || diferencaMinutos(concluidaEm, prazo) >= 0 ? 'meta_atingida' : 'meta_perdida';

export type ProblemaEtapa =
  | 'etapa-ja-concluida'
  | 'conclusao-antes-do-inicio'
  | 'conclusao-no-futuro'
  | 'justificativa-obrigatoria'
  | 'motivo-obrigatorio'
  | 'etapa-obrigatoria';

export const MENSAGENS_ETAPA: Readonly<Record<ProblemaEtapa, string>> = {
  'etapa-ja-concluida': 'Esta etapa já foi concluída ou cancelada.',
  'conclusao-antes-do-inicio': 'A hora da conclusão é anterior ao início do protocolo.',
  'conclusao-no-futuro': 'A hora da conclusão não pode estar no futuro.',
  'justificativa-obrigatoria': 'A meta foi perdida: escreva a justificativa (10 caracteres ou mais).',
  'motivo-obrigatorio': 'Escreva o motivo do cancelamento (10 caracteres ou mais).',
  'etapa-obrigatoria':
    'Etapa obrigatória: registre a conclusão (com a justificativa, se a meta foi perdida).',
};

const textoMinimo = (t: string | null) => (t ?? '').trim().length >= 10;

export function problemaDaConclusao(p: {
  situacaoAtual: SituacaoEtapa;
  iniciadaEm: string;
  prazoMetaEm: string | null;
  concluidaEm: string;
  agora: string;
  justificativa: string | null;
}): ProblemaEtapa | null {
  if (p.situacaoAtual !== 'em_andamento') return 'etapa-ja-concluida';
  if (diferencaMinutos(p.iniciadaEm, p.concluidaEm) < 0) return 'conclusao-antes-do-inicio';
  if (diferencaMinutos(p.agora, p.concluidaEm) > 0) return 'conclusao-no-futuro';
  if (situacaoAoConcluir(p.prazoMetaEm, p.concluidaEm) === 'meta_perdida' && !textoMinimo(p.justificativa))
    return 'justificativa-obrigatoria';
  return null;
}

export function problemaDoCancelamento(p: {
  situacaoAtual: SituacaoEtapa;
  obrigatoria: boolean;
  motivo: string | null;
}): ProblemaEtapa | null {
  if (p.situacaoAtual !== 'em_andamento') return 'etapa-ja-concluida';
  if (p.obrigatoria) return 'etapa-obrigatoria';
  if (!textoMinimo(p.motivo)) return 'motivo-obrigatorio';
  return null;
}

export type EstadoRelogioEtapa =
  'sem_meta' | 'no_prazo' | 'vencendo' | 'vencida' | 'cumprida' | 'perdida' | 'cancelada';

/** Minutos antes do prazo em que a etapa passa a "vencendo" (o aviso à equipe). */
export const AVISO_VENCENDO_MIN = 15;

export function relogioDaEtapa(
  situacao: SituacaoEtapa,
  prazo: string | null,
  agora: string,
): { estado: EstadoRelogioEtapa; minutosRestantes: number | null } {
  if (situacao === 'meta_atingida') return { estado: 'cumprida', minutosRestantes: null };
  if (situacao === 'meta_perdida') return { estado: 'perdida', minutosRestantes: null };
  if (situacao === 'cancelada') return { estado: 'cancelada', minutosRestantes: null };
  if (prazo === null) return { estado: 'sem_meta', minutosRestantes: null };
  const r = diferencaMinutos(agora, prazo);
  return {
    estado: r < 0 ? 'vencida' : r <= AVISO_VENCENDO_MIN ? 'vencendo' : 'no_prazo',
    minutosRestantes: r,
  };
}

export interface EtapaEntrada {
  readonly nome: string;
  readonly tipo: TipoEtapa;
  readonly metaMinutos: number | null;
  readonly faixaEtaria: FaixaEtapa;
  readonly obrigatoria: boolean;
}

/** A conferência da etapa: nome e meta de 1 minuto a 7 dias. */
export function problemaDaEtapa(e: EtapaEntrada): string | null {
  if (e.nome.trim().length < 3) return 'O nome da etapa tem ao menos 3 caracteres.';
  if (
    e.metaMinutos !== null &&
    (!Number.isInteger(e.metaMinutos) || e.metaMinutos < 1 || e.metaMinutos > 10_080)
  )
    return 'A meta vai de 1 minuto a 7 dias (10080 minutos).';
  return null;
}

// ── Modelos de mercado (configuráveis depois de aplicados) ──────────────────────────────────────────

export interface ModeloProtocolo {
  readonly formula: string | null;
  readonly criterios: readonly (Omit<CriterioEntrada, 'finalidade'> & { descricao: string })[];
  readonly etapas: readonly EtapaEntrada[];
}

const criterioSinal = (
  grupo: string,
  campo: string,
  min: number | null,
  max: number | null,
  descricao: string,
): ModeloProtocolo['criterios'][number] => ({
  grupo,
  categoria: 'sinal_vital',
  campo,
  termo: null,
  valorTexto: null,
  valorMinimo: min,
  valorMaximo: max,
  sexo: 'todos',
  idadeMinimaDias: 18 * DIAS_ANO,
  idadeMaximaDias: null,
  validadeHoras: 6,
  descricao,
});

const etapa = (
  nome: string,
  tipo: TipoEtapa,
  metaMinutos: number | null,
  obrigatoria = true,
): EtapaEntrada => ({
  nome,
  tipo,
  metaMinutos,
  faixaEtaria: 'todas',
  obrigatoria,
});

export const MODELOS_PROTOCOLO: Readonly<Partial<Record<string, ModeloProtocolo>>> = {
  // Suspeita de sepse no adulto: dois ou mais sinais de resposta inflamatória ou disfunção, nas últimas 6 h.
  sepse: {
    formula: 'PELO_MENOS 2 (temperatura, frequencia_cardiaca, frequencia_respiratoria, hipotensao)',
    criterios: [
      criterioSinal('temperatura', 'temperatura', 38.3, null, 'Temperatura ≥ 38,3 °C'),
      criterioSinal('temperatura', 'temperatura', null, 35.9, 'Temperatura ≤ 35,9 °C'),
      criterioSinal('frequencia_cardiaca', 'fc', 91, null, 'Frequência cardíaca > 90 bpm'),
      criterioSinal('frequencia_respiratoria', 'fr', 21, null, 'Frequência respiratória > 20 irpm'),
      criterioSinal('hipotensao', 'pas', null, 100, 'Pressão sistólica ≤ 100 mmHg'),
    ],
    etapas: [
      etapa('Lactato sérico coletado', 'exame', 60),
      etapa('Hemoculturas antes do antimicrobiano', 'exame', 60),
      etapa('Antimicrobiano de amplo espectro administrado', 'medicacao', 60),
      etapa('Cristaloide 30 mL/kg (hipotensão ou lactato ≥ 4 mmol/L)', 'medicacao', 180, false),
      etapa('Vasopressor se hipotensão persistente', 'medicacao', 60, false),
      etapa('Lactato reavaliado (se inicial > 2 mmol/L)', 'reavaliacao', 360, false),
    ],
  },
  dor_toracica: {
    formula: null,
    criterios: [],
    etapas: [
      etapa('Eletrocardiograma realizado e interpretado', 'exame', 10),
      etapa('Troponina coletada', 'exame', 60),
      etapa('Trombólise iniciada (porta-agulha)', 'medicacao', 30, false),
      etapa('Angioplastia primária (porta-balão)', 'consulta', 90, false),
    ],
  },
  avc: {
    formula: null,
    criterios: [],
    etapas: [
      etapa('Avaliação médica com escala de AVC', 'avaliacao', 10),
      etapa('Tomografia de crânio realizada (porta-TC)', 'exame', 25),
      etapa('Tomografia laudada', 'exame', 45),
      etapa('Trombólise iniciada (porta-agulha)', 'medicacao', 60, false),
    ],
  },
};
