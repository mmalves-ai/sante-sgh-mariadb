// Competência SUS (ficha do M51, seções 5 e 8): AAAAMM por instrumento e estabelecimento. A competência do registro é a
// do atendimento (a data de saída da internação; a data do atendimento ambulatorial), nunca a de hoje (regra 2). A
// abertura, o fechamento e a reabertura são operações só `SGH_` (SGH_FAT_SUS_COMPETENCIA); estas regras decidem antes.
import type {
  CompetenciaSus,
  GravidadeCriticaSus,
  InstrumentoSus,
  SituacaoCompetenciaSus,
  SituacaoCriticaSus,
} from '@sgh/contratos';
import { FORMATO_COMPETENCIA_SUS } from '@sgh/contratos';

export interface PartesCompetencia {
  readonly ano: number;
  readonly mes: number;
}

/** A competência válida em partes (null quando o texto não é AAAAMM com mês de 01 a 12). */
export function partesDaCompetencia(c: string): PartesCompetencia | null {
  const m = FORMATO_COMPETENCIA_SUS.exec(c);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]) };
}

export function competenciaDe(ano: number, mes: number): CompetenciaSus {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12 || ano < 2000 || ano > 2099)
    throw new RangeError('competencia-invalida');
  return `${ano}${String(mes).padStart(2, '0')}`;
}

/** A competência de uma data AAAA-MM-DD (ou instante ISO); null para a data vazia do banco (antes de 1900). */
export function competenciaDaData(data: string | null | undefined): CompetenciaSus | null {
  if (!data) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(data);
  if (!m || m[1]! < '1900') return null;
  return competenciaDe(Number(m[1]), Number(m[2]));
}

export function competenciaSeguinte(c: CompetenciaSus): CompetenciaSus {
  const p = partesDaCompetencia(c);
  if (!p) throw new RangeError('competencia-invalida');
  return p.mes === 12 ? competenciaDe(p.ano + 1, 1) : competenciaDe(p.ano, p.mes + 1);
}

export function competenciaAnterior(c: CompetenciaSus): CompetenciaSus {
  const p = partesDaCompetencia(c);
  if (!p) throw new RangeError('competencia-invalida');
  return p.mes === 1 ? competenciaDe(p.ano - 1, 12) : competenciaDe(p.ano, p.mes - 1);
}

/** Primeiro e último dia da competência (AAAA-MM-DD), para filtrar datas no banco. */
export function intervaloDaCompetencia(c: CompetenciaSus): { readonly inicio: string; readonly fim: string } {
  const p = partesDaCompetencia(c);
  if (!p) throw new RangeError('competencia-invalida');
  const ultimo = new Date(Date.UTC(p.ano, p.mes, 0)).getUTCDate();
  const mm = String(p.mes).padStart(2, '0');
  return { inicio: `${p.ano}-${mm}-01`, fim: `${p.ano}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** A data cai dentro da competência? */
export function dataNaCompetencia(data: string | null | undefined, c: CompetenciaSus): boolean {
  return competenciaDaData(data) === c;
}

/** Recusas das transições da competência (códigos com texto em i18n-sus.ts). */
export type RecusaCompetenciaSus =
  | 'competencia-futura'
  | 'competencia-ja-aberta'
  | 'competencia-nao-aberta'
  | 'competencia-ja-fechada'
  | 'competencia-nao-fechada'
  | 'criticas-bloqueantes-abertas'
  | 'avisos-nao-justificados'
  | 'critica-nao-executada';

export interface CompetenciaExistente {
  readonly situacao: SituacaoCompetenciaSus;
}

/**
 * Pode abrir? Uma por instrumento e competência; nunca uma competência futura (a de hoje pode, porque a produção do
 * mês corrente é acompanhada antes do fechamento). Tudo ligado para todos (F3.7): BPA, APAC, AIH e CIHA valem em todo
 * estabelecimento; o acesso é a permissão do cargo.
 */
export function recusaAbrirCompetencia(
  c: CompetenciaSus,
  hoje: string,
  existente: CompetenciaExistente | null,
): RecusaCompetenciaSus | null {
  const atual = competenciaDaData(hoje);
  if (atual && c > atual) return 'competencia-futura';
  if (existente) return existente.situacao === 'fechada' ? 'competencia-ja-fechada' : 'competencia-ja-aberta';
  return null;
}

export interface CriticaParaFechamento {
  readonly gravidade: GravidadeCriticaSus;
  readonly situacao: SituacaoCriticaSus;
}

/**
 * Pode fechar? Só aberta, com a crítica executada depois da última mudança e as críticas tratadas (ficha, seção 5:
 * "fechamento com críticas tratadas"): nenhuma bloqueante aberta (corrige-se na origem) e nenhum aviso aberto (o aviso
 * se justifica ou se corrige).
 */
export function recusaFecharCompetencia(
  existente: CompetenciaExistente | null,
  criticaExecutada: boolean,
  criticas: readonly CriticaParaFechamento[],
): RecusaCompetenciaSus | null {
  if (!existente) return 'competencia-nao-aberta';
  if (existente.situacao === 'fechada') return 'competencia-ja-fechada';
  if (!criticaExecutada) return 'critica-nao-executada';
  if (criticas.some((x) => x.gravidade === 'bloqueante' && x.situacao === 'aberta'))
    return 'criticas-bloqueantes-abertas';
  if (criticas.some((x) => x.gravidade === 'aviso' && x.situacao === 'aberta'))
    return 'avisos-nao-justificados';
  return null;
}

/** Pode reabrir? Só a fechada (a justificativa é conferida pelo Zod da entrada). */
export function recusaReabrirCompetencia(
  existente: CompetenciaExistente | null,
): RecusaCompetenciaSus | null {
  if (!existente) return 'competencia-nao-aberta';
  if (existente.situacao !== 'fechada') return 'competencia-nao-fechada';
  return null;
}

/** A chave de liberação do instrumento (RECURSOS_DESLIGADOS): CIHA na etapa 1; BPA, APAC e AIH desligadas (DP-35). */
export function chaveLiberacaoDoInstrumento(i: InstrumentoSus): string {
  const nome = { ciha: 'Ciha', bpa: 'Bpa', apac: 'Apac', aih: 'Aih' } as const;
  return `faturamento.sus${nome[i]}`;
}
