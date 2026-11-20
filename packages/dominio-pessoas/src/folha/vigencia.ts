// Vigência das rubricas e das tabelas legais da folha (M53, etapa F1; ficha, seção 8, regra 7: "Tabelas legais com
// vigência, nunca constante no código; competência usa a vigência da data de competência"). Regras puras: quem chama
// lê as vigências do banco e passa a competência; nada aqui sabe de valor de tabela (nenhuma alíquota no código).
// D-VIG-532 (POL-5): a data de competência é o PRIMEIRO dia do mês da competência — a tabela que começa no meio do
// mês (lei publicada com vigência a partir do dia 11, por exemplo) só vale a partir da competência seguinte, salvo se o
// departamento pessoal cadastrar a vigência no dia 1º (a tela mostra o aviso).
import type {
  ConferenciaTabelaLegal,
  FaixaSalarioFamilia,
  FaixaTabelaLegal,
  TabelaLegalFolha,
  VigenciaRubrica,
} from '@sgh/contratos';
import { diaUtc } from '../datas.js';

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A data em que a vigência é lida para a competência (AAAA-MM → AAAA-MM-01). */
export function dataDaCompetencia(competencia: string): string {
  if (!COMPETENCIA.test(competencia)) throw new Error(`Competência inválida: ${competencia}`);
  return `${competencia}-01`;
}

/** Último dia da competência (para quem precisa do intervalo inteiro). */
export function fimDaCompetencia(competencia: string): string {
  const m = COMPETENCIA.exec(competencia);
  if (!m) throw new Error(`Competência inválida: ${competencia}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(dia).padStart(2, '0')}`;
}

/**
 * A vigência em vigor na data: a de maior início que não passe da data (início igual à data vale). Itens com o mesmo
 * início são ambíguos: devolve null e a conferência acusa (o cadastro tem chave única no início, então não acontece
 * na tabela legal; a regra fica para quem passar outra lista).
 */
export function vigenteNaData<T extends { readonly inicio: string }>(
  itens: readonly T[],
  data: string,
): T | null {
  const d = diaUtc(data);
  let melhor: T | null = null;
  let empate = false;
  for (const i of itens) {
    const ini = diaUtc(i.inicio);
    if (ini > d) continue;
    if (!melhor || ini > diaUtc(melhor.inicio)) {
      melhor = i;
      empate = false;
    } else if (ini === diaUtc(melhor.inicio)) empate = true;
  }
  return empate ? null : melhor;
}

/** A vigência em vigor na competência (regra 7). */
export function vigenteNaCompetencia<T extends { readonly inicio: string }>(
  itens: readonly T[],
  competencia: string,
): T | null {
  return vigenteNaData(itens, dataDaCompetencia(competencia));
}

/** As vigências da mais nova para a mais antiga (lista da tela). */
export function ordenarVigencias<T extends { readonly inicio: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => diaUtc(b.inicio) - diaUtc(a.inicio));
}

/**
 * A rubrica vale na data? Início vazio = desde sempre; fim vazio = sem fim; os dois extremos valem (fim no último dia
 * em que a rubrica ainda vale). Vigência invertida (fim antes do início) nunca vale.
 */
export function rubricaVigenteNaData(v: VigenciaRubrica, data: string): boolean {
  const d = diaUtc(data);
  if (v.inicio && v.fim && diaUtc(v.fim) < diaUtc(v.inicio)) return false;
  if (v.inicio && diaUtc(v.inicio) > d) return false;
  if (v.fim && diaUtc(v.fim) < d) return false;
  return true;
}

/**
 * A rubrica vale em algum dia da competência? (início até o fim do mês, fim a partir do dia 1º). Exceção registrada na
 * D-VIG-532 (M53.2): a rubrica é o que se pode lançar na folha do mês, então a que começa ou termina no meio do mês entra
 * nele; a tabela legal e os dias de afastamento, parâmetros do cálculo, são lidos só no primeiro dia (a tela diz as duas
 * regras).
 */
export function rubricaVigenteNaCompetencia(v: VigenciaRubrica, competencia: string): boolean {
  const ini = diaUtc(dataDaCompetencia(competencia));
  const fim = diaUtc(fimDaCompetencia(competencia));
  if (v.inicio && v.fim && diaUtc(v.fim) < diaUtc(v.inicio)) return false;
  if (v.inicio && diaUtc(v.inicio) > fim) return false;
  if (v.fim && diaUtc(v.fim) < ini) return false;
  return true;
}

function conferirFaixas(
  faixas: readonly (FaixaTabelaLegal | FaixaSalarioFamilia)[],
  tabela: 'irrf' | 'inss' | 'salarioFamilia',
  progressiva: boolean,
): ConferenciaTabelaLegal[] {
  const r: ConferenciaTabelaLegal[] = [];
  if (faixas.length === 0) return [{ codigo: 'sem-faixas', tabela, faixa: null }];
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i]!;
    if (f.ate !== null && f.ate < f.de) r.push({ codigo: 'faixas-fora-de-ordem', tabela, faixa: i + 1 });
    if (i === 0) continue;
    const a = faixas[i - 1]!;
    if (a.ate === null || f.de <= a.ate) r.push({ codigo: 'faixas-fora-de-ordem', tabela, faixa: i + 1 });
    else if (f.de - a.ate > 1) r.push({ codigo: 'faixas-com-buraco', tabela, faixa: i + 1 });
    if (progressiva && 'aliquota' in f && 'aliquota' in a && f.aliquota < a.aliquota)
      r.push({ codigo: 'aliquota-regressiva', tabela, faixa: i + 1 });
  }
  return r;
}

/**
 * Conferência da tabela legal da vigência (o que a tela mostra antes de o cálculo usá-la): faixas em ordem, sem
 * sobreposição nem buraco (até um centavo entre o fim de uma e o começo da seguinte), alíquotas progressivas, o teto do
 * INSS igual ao fim da última faixa e o salário mínimo preenchido.
 */
export function conferirTabelaLegal(t: TabelaLegalFolha): ConferenciaTabelaLegal[] {
  const r = [
    ...conferirFaixas(t.irrf.faixas, 'irrf', true),
    ...conferirFaixas(t.inss.faixas, 'inss', true),
    ...(t.salarioFamilia.length > 0 ? conferirFaixas(t.salarioFamilia, 'salarioFamilia', false) : []),
  ];
  const ultima = t.inss.faixas.at(-1);
  if (ultima && ultima.ate !== null && t.inss.teto > 0 && ultima.ate !== t.inss.teto)
    r.push({ codigo: 'teto-diferente-da-ultima-faixa', tabela: 'inss', faixa: t.inss.faixas.length });
  if (t.salarioMinimo <= 0) r.push({ codigo: 'sem-salario-minimo', tabela: 'geral', faixa: null });
  return r;
}
