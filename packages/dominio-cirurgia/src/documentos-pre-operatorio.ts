// Documentos obrigatórios antes da cirurgia, com bloqueio do início (F8, 04-CC linha 104; Cirurgia Segura da OMS,
// Programa Nacional de Segurança do Paciente e CFM). Regras puras, sem banco:
//   - quais documentos a cirurgia exige: o tipo obrigatório para toda cirurgia e as regras do estabelecimento por
//     procedimento, fonte pagadora e faixa etária (nulo na regra: vale para todos);
//   - o estado de cada exigido na data da cirurgia: apresentado (dentro da validade), vencido, dispensado, recusado ou
//     pendente; o registro mais recente do tipo é o que vale (o histórico fica, nunca apagado);
//   - a confirmação da cirurgia é recusada com documento que gera pendência em falta; a entrada no bloco e o início,
//     com documento que bloqueia em falta. O termo de consentimento e a avaliação pré-anestésica bloqueiam sempre que
//     exigidos e só são dispensados em urgência, emergência ou acidente, com justificativa.
import { naturezaDeUrgencia } from './autorizacao-convenio.js';

export const CATEGORIAS_DOCUMENTO_PRE_OPERATORIO = [
  'consentimento',
  'risco_cirurgico',
  'exame',
  'autorizacao',
  'avaliacao',
  'outro',
] as const;

/** Categorias que bloqueiam o início sempre que exigidas (consentimento e avaliação pré-anestésica). */
export const CATEGORIAS_QUE_SEMPRE_BLOQUEIAM: readonly string[] = ['consentimento', 'avaliacao'];

export type SituacaoRegistroDocumento = 'apresentado' | 'dispensado' | 'recusado';
export type EstadoDocumentoCirurgia = 'pendente' | 'apresentado' | 'vencido' | 'dispensado' | 'recusado';

export interface FaixaEtariaRegra {
  /** Unidade das idades da faixa. */
  readonly unidade: 'dia' | 'mes' | 'ano';
  readonly inicial: number;
  readonly final: number;
}

export interface RegraDocumentoCirurgia {
  readonly tipo: number;
  readonly categoria: string;
  readonly procedimento: number | null;
  readonly fontePagadora: number | null;
  readonly faixa: FaixaEtariaRegra | null;
  readonly validadeDias: number | null;
  readonly obrigatorio: boolean;
  readonly bloqueiaEntradaSala: boolean;
  readonly geraPendencia: boolean;
}

export interface IdadePaciente {
  readonly dias: number;
  readonly meses: number;
  readonly anos: number;
}

export interface CirurgiaParaDocumentos {
  readonly procedimentos: readonly number[];
  readonly fontePagadora: number | null;
  readonly idade: IdadePaciente | null;
}

export interface DocumentoExigido {
  readonly tipo: number;
  readonly categoria: string;
  /** Menor validade entre as regras que exigem o tipo (nulo: sem prazo). */
  readonly validadeDias: number | null;
  readonly bloqueia: boolean;
  readonly geraPendencia: boolean;
}

export interface RegistroDocumento {
  readonly tipo: number;
  readonly sequencia: number;
  readonly situacao: string;
  /** Data do documento apresentado (AAAA-MM-DD). */
  readonly apresentadoEm: string | null;
  readonly validoAte: string | null;
}

export interface ProblemaDocumento {
  readonly campo: string;
  readonly mensagem: string;
}

function naFaixa(faixa: FaixaEtariaRegra | null, idade: IdadePaciente | null): boolean {
  if (!faixa) return true;
  if (!idade) return false;
  const valor = faixa.unidade === 'dia' ? idade.dias : faixa.unidade === 'mes' ? idade.meses : idade.anos;
  return valor >= faixa.inicial && valor <= faixa.final;
}

/** A regra vale para esta cirurgia? Campo nulo na regra vale para todos. */
export function regraSeAplica(r: RegraDocumentoCirurgia, c: CirurgiaParaDocumentos): boolean {
  if (!r.obrigatorio) return false;
  if (r.procedimento !== null && !c.procedimentos.includes(r.procedimento)) return false;
  if (r.fontePagadora !== null && r.fontePagadora !== c.fontePagadora) return false;
  return naFaixa(r.faixa, c.idade);
}

/** Os documentos que a cirurgia exige, um por tipo (as regras do mesmo tipo se somam: a mais exigente vale). */
export function documentosExigidos(
  regras: readonly RegraDocumentoCirurgia[],
  c: CirurgiaParaDocumentos,
): DocumentoExigido[] {
  const porTipo = new Map<number, DocumentoExigido>();
  for (const r of regras) {
    if (!regraSeAplica(r, c)) continue;
    const bloqueia = r.bloqueiaEntradaSala || CATEGORIAS_QUE_SEMPRE_BLOQUEIAM.includes(r.categoria);
    const atual = porTipo.get(r.tipo);
    if (!atual) {
      porTipo.set(r.tipo, {
        tipo: r.tipo,
        categoria: r.categoria,
        validadeDias: r.validadeDias,
        bloqueia,
        geraPendencia: r.geraPendencia,
      });
      continue;
    }
    const validades = [atual.validadeDias, r.validadeDias].filter((v): v is number => v !== null);
    porTipo.set(r.tipo, {
      ...atual,
      validadeDias: validades.length ? Math.min(...validades) : null,
      bloqueia: atual.bloqueia || bloqueia,
      geraPendencia: atual.geraPendencia || r.geraPendencia,
    });
  }
  return [...porTipo.values()].sort((a, b) => a.tipo - b.tipo);
}

const DIA_MS = 86_400_000;
const dataUtc = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** O registro que vale para o tipo: o de maior sequência. */
export function registroVigente(
  tipo: number,
  registros: readonly RegistroDocumento[],
): RegistroDocumento | null {
  let vigente: RegistroDocumento | null = null;
  for (const r of registros)
    if (r.tipo === tipo && (!vigente || r.sequencia > vigente.sequencia)) vigente = r;
  return vigente;
}

/**
 * O estado do documento exigido na data da cirurgia (AAAA-MM-DD; nula: sem data, a validade não é conferida). O
 * apresentado vence pela data de validade informada ou pela validade em dias contada da data do documento.
 */
export function estadoDoDocumento(
  exigido: DocumentoExigido,
  registro: RegistroDocumento | null,
  dataCirurgia: string | null,
): EstadoDocumentoCirurgia {
  if (!registro) return 'pendente';
  if (registro.situacao === 'dispensado') return 'dispensado';
  if (registro.situacao === 'recusado') return 'recusado';
  if (registro.situacao !== 'apresentado') return 'pendente';
  if (!dataCirurgia) return 'apresentado';
  const cirurgia = dataUtc(dataCirurgia);
  if (registro.validoAte && dataUtc(registro.validoAte) < cirurgia) return 'vencido';
  if (exigido.validadeDias !== null && registro.apresentadoEm) {
    const idade = Math.round((cirurgia - dataUtc(registro.apresentadoEm)) / DIA_MS);
    if (idade > exigido.validadeDias) return 'vencido';
  }
  return 'apresentado';
}

const cumprido = (e: EstadoDocumentoCirurgia) => e === 'apresentado' || e === 'dispensado';

export type ConferenciaDocumentos =
  { ok: true } | { ok: false; codigo: 'documentos-pendentes'; mensagem: string; faltam: number[] };

/** Situações em que a cirurgia começa (entrada no bloco e início). */
export const SITUACOES_DE_INICIO = ['no_bloco', 'em_andamento'] as const;

/**
 * Pode a cirurgia ir à situação `nova`? A confirmação exige os documentos que geram pendência; a entrada no bloco e o
 * início exigem os que bloqueiam. Faltando, recusa com os tipos em falta.
 */
export function conferirDocumentosCirurgia(
  exigidos: readonly DocumentoExigido[],
  registros: readonly RegistroDocumento[],
  nova: string,
  dataCirurgia: string | null,
): ConferenciaDocumentos {
  const inicio = (SITUACOES_DE_INICIO as readonly string[]).includes(nova);
  if (!inicio && nova !== 'confirmado') return { ok: true };
  const faltam = exigidos
    .filter((e) => (inicio ? e.bloqueia : e.geraPendencia))
    .filter((e) => !cumprido(estadoDoDocumento(e, registroVigente(e.tipo, registros), dataCirurgia)))
    .map((e) => e.tipo);
  if (!faltam.length) return { ok: true };
  return {
    ok: false,
    codigo: 'documentos-pendentes',
    mensagem: inicio
      ? `A cirurgia não começa sem os documentos obrigatórios: ${faltam.length} em falta, vencido ou recusado.`
      : `A cirurgia não é confirmada com documento obrigatório em falta: ${faltam.length} pendente(s).`,
    faltam,
  };
}

/** Situações da cirurgia em que os documentos ainda são registrados. */
export const SITUACOES_QUE_ACEITAM_DOCUMENTO = [
  'solicitado',
  'em_analise',
  'agendado',
  'confirmado',
  'no_bloco',
] as const;

export interface RegistroDocumentoEntrada {
  readonly situacao: SituacaoRegistroDocumento;
  readonly observacao: string | null;
  readonly apresentadoEm: string | null;
  readonly validoAte: string | null;
}

/**
 * Confere o registro de um documento da cirurgia (`hoje`: AAAA-MM-DD). Apresentado: data do documento até hoje e
 * validade, se informada, não anterior a ela. Dispensa e recusa: justificativa de 10 letras ou mais. O consentimento e
 * a avaliação pré-anestésica não se dispensam na cirurgia eletiva.
 */
export function conferirRegistroDocumento(
  e: RegistroDocumentoEntrada,
  contexto: {
    readonly situacaoCirurgia: string;
    readonly natureza: string;
    readonly categoria: string | null;
    readonly hoje: string;
  },
): ProblemaDocumento[] {
  const p: ProblemaDocumento[] = [];
  if (!(SITUACOES_QUE_ACEITAM_DOCUMENTO as readonly string[]).includes(contexto.situacaoCirurgia))
    p.push({
      campo: 'agendamento',
      mensagem: 'A cirurgia já começou, terminou ou foi cancelada: os documentos não são mais registrados.',
    });
  if (contexto.categoria === null)
    p.push({ campo: 'tipo', mensagem: 'O tipo de documento não está cadastrado ou está inativo.' });
  const justificativa = (e.observacao ?? '').trim();
  if (e.situacao === 'apresentado') {
    if (!e.apresentadoEm) p.push({ campo: 'apresentadoEm', mensagem: 'Informe a data do documento.' });
    else if (e.apresentadoEm > contexto.hoje)
      p.push({ campo: 'apresentadoEm', mensagem: 'A data do documento não pode ser futura.' });
    if (e.validoAte && e.apresentadoEm && e.validoAte < e.apresentadoEm)
      p.push({ campo: 'validoAte', mensagem: 'A validade não pode ser anterior à data do documento.' });
  } else {
    if (justificativa.length < 10)
      p.push({
        campo: 'observacao',
        mensagem:
          e.situacao === 'dispensado'
            ? 'Justifique a dispensa (mínimo de 10 letras).'
            : 'Informe o motivo da recusa (mínimo de 10 letras).',
      });
    if (
      e.situacao === 'dispensado' &&
      contexto.categoria !== null &&
      CATEGORIAS_QUE_SEMPRE_BLOQUEIAM.includes(contexto.categoria) &&
      !naturezaDeUrgencia(contexto.natureza)
    )
      p.push({
        campo: 'situacao',
        mensagem:
          'O consentimento e a avaliação pré-anestésica só são dispensados em urgência, emergência ou acidente.',
      });
  }
  return p;
}

export interface RegraDocumentoEntrada {
  readonly tipo: number;
  readonly procedimento: number | null;
  readonly fontePagadora: number | null;
  readonly faixaEtaria: number | null;
  readonly validadeDias: number | null;
  readonly bloqueiaEntradaSala: boolean;
  readonly geraPendencia: boolean;
}

/** Confere a regra de documento exigido do estabelecimento: tipo ativo, validade de 1 a 3650 dias. */
export function conferirRegraDocumento(
  e: RegraDocumentoEntrada,
  tipo: { readonly ativo: boolean; readonly categoria: string } | null,
): ProblemaDocumento[] {
  const p: ProblemaDocumento[] = [];
  if (!tipo || !tipo.ativo)
    p.push({ campo: 'tipo', mensagem: 'O tipo de documento não está cadastrado ou está inativo.' });
  if (
    e.validadeDias !== null &&
    (!Number.isInteger(e.validadeDias) || e.validadeDias < 1 || e.validadeDias > 3650)
  )
    p.push({ campo: 'validadeDias', mensagem: 'A validade vai de 1 a 3650 dias.' });
  if (tipo && CATEGORIAS_QUE_SEMPRE_BLOQUEIAM.includes(tipo.categoria) && !e.bloqueiaEntradaSala)
    p.push({
      campo: 'bloqueiaEntradaSala',
      mensagem: 'O consentimento e a avaliação pré-anestésica sempre bloqueiam o início da cirurgia.',
    });
  return p;
}

/** Confere o tipo de documento: código de 2 a 30 letras sem espaço, descrição e categoria válidas. */
export function conferirTipoDocumento(e: {
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: string;
  readonly validadeDias: number | null;
}): ProblemaDocumento[] {
  const p: ProblemaDocumento[] = [];
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(e.codigo.trim()))
    p.push({
      campo: 'codigo',
      mensagem: 'O código tem de 2 a 30 letras, números, ponto, hífen ou sublinhado.',
    });
  if (e.descricao.trim().length < 3) p.push({ campo: 'descricao', mensagem: 'Descreva o documento.' });
  if (!(CATEGORIAS_DOCUMENTO_PRE_OPERATORIO as readonly string[]).includes(e.categoria))
    p.push({ campo: 'categoria', mensagem: 'Escolha a categoria do documento.' });
  if (
    e.validadeDias !== null &&
    (!Number.isInteger(e.validadeDias) || e.validadeDias < 1 || e.validadeDias > 3650)
  )
    p.push({ campo: 'validadeDias', mensagem: 'A validade vai de 1 a 3650 dias.' });
  return p;
}
