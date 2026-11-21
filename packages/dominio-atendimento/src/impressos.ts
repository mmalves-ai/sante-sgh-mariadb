// Impressos do atendimento externo (ficha do M20, seção 4 "Impressos" e seção 5 "Cadastros pelo CRUD genérico"): a
// ficha em PDF, as etiquetas e a pulseira em ZPL (o modelo ZPL é o do M09, montado na API). Aqui as regras puras:
//   - quais fichas a imprimir valem para o atendimento: o modelo (com a impressora gráfica ou a matricial) e as
//     seleções por convênio, especialidade, unidade e grupo de procedimento — numa dimensão com seleções, o modelo só
//     sai quando o item do atendimento está marcado; sem seleção na dimensão, ela não restringe (a confirmar na
//     validação: DP-46.8); a clínica pela letra, o retorno (só no retorno ou em todo atendimento) e a faixa de idade (0 = sem limite);
//   - a ordem e as cópias de cada modelo;
//   - o que cada impresso exige (a pulseira sai só com a data de nascimento: dois identificadores legíveis).
import { IMPRESSOS_ATENDIMENTO, type ImpressoAtendimento } from '@sgh/contratos';

export interface ModeloFicha {
  readonly grafica: boolean;
  readonly modelo: number;
  readonly nome: string;
  readonly copias: number;
  readonly ordem: number;
  /** Letras das clínicas atendidas (M, C, O…). */
  readonly clinicas: string;
  /** Verdadeiro: só no retorno; falso: em todo atendimento. */
  readonly soNoRetorno: boolean;
  /** Sai na abertura do atendimento (IMPATE). */
  readonly noAtendimento: boolean;
  readonly idadeInicial: number;
  readonly idadeFinal: number;
}

export type DimensaoSelecao = 'convenio' | 'especialidade' | 'unidade' | 'grupo';

export interface SelecaoFicha {
  readonly grafica: boolean;
  readonly modelo: number;
  readonly dimensao: DimensaoSelecao;
  readonly item: number;
  readonly imprime: boolean;
}

export interface AtendimentoParaFicha {
  readonly convenio: number;
  readonly especialidade: number;
  readonly unidade: number;
  /** Grupos dos procedimentos do atendimento. */
  readonly grupos: readonly number[];
  readonly clinica: string;
  readonly retorno: boolean;
  /** Idade em anos (null: sem data de nascimento). */
  readonly idade: number | null;
}

export interface FichaAImprimir {
  readonly modelo: number;
  readonly nome: string;
  readonly copias: number;
  readonly ordem: number;
}

const DIMENSOES: readonly DimensaoSelecao[] = ['convenio', 'especialidade', 'unidade', 'grupo'];

function passaNaDimensao(
  m: ModeloFicha,
  selecoes: readonly SelecaoFicha[],
  d: DimensaoSelecao,
  a: AtendimentoParaFicha,
): boolean {
  const doModelo = selecoes.filter(
    (s) => s.grafica === m.grafica && s.modelo === m.modelo && s.dimensao === d,
  );
  if (doModelo.length === 0) return true;
  const itens =
    d === 'convenio'
      ? [a.convenio]
      : d === 'especialidade'
        ? [a.especialidade]
        : d === 'unidade'
          ? [a.unidade]
          : a.grupos;
  return doModelo.some((s) => s.imprime && itens.includes(s.item));
}

function passaNaIdade(m: ModeloFicha, idade: number | null): boolean {
  if (m.idadeInicial <= 0 && m.idadeFinal <= 0) return true;
  if (idade === null) return false;
  if (m.idadeInicial > 0 && idade < m.idadeInicial) return false;
  if (m.idadeFinal > 0 && idade > m.idadeFinal) return false;
  return true;
}

/** As fichas que saem para o atendimento, na ordem de impressão, com as cópias (só as da impressora escolhida). */
export function fichasAImprimir(
  modelos: readonly ModeloFicha[],
  selecoes: readonly SelecaoFicha[],
  a: AtendimentoParaFicha,
  grafica: boolean,
): FichaAImprimir[] {
  return modelos
    .filter((m) => m.grafica === grafica && m.noAtendimento && m.copias > 0)
    .filter((m) => !m.clinicas.trim() || m.clinicas.toUpperCase().includes(a.clinica.trim().toUpperCase()))
    .filter((m) => !m.soNoRetorno || a.retorno)
    .filter((m) => passaNaIdade(m, a.idade))
    .filter((m) => DIMENSOES.every((d) => passaNaDimensao(m, selecoes, d, a)))
    .sort((x, y) => x.ordem - y.ordem || x.modelo - y.modelo)
    .map((m) => ({ modelo: m.modelo, nome: m.nome, copias: m.copias, ordem: m.ordem }));
}

/** Idade em anos completos no dia (AAAA-MM-DD); null sem nascimento válido. */
export function idadeEmAnos(nascimento: string | null, dia: string): number | null {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento ?? '');
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!n || !h || nascimento === '1899-12-30') return null;
  let anos = Number(h[1]) - Number(n[1]);
  if (Number(h[2]) < Number(n[2]) || (h[2] === n[2] && Number(h[3]) < Number(n[3]))) anos--;
  return anos >= 0 ? anos : null;
}

export interface PacienteParaImpresso {
  readonly nome: string;
  readonly nascimento: string | null;
  readonly prontuario: number;
}

export interface DecisaoImpresso {
  readonly impresso: ImpressoAtendimento;
  readonly formatos: readonly string[];
  readonly pode: boolean;
  readonly motivo: string | null;
}

/** Os impressos do atendimento e o que falta para cada um (a tela mostra o motivo no lugar do botão). */
export function impressosDoAtendimento(p: PacienteParaImpresso): DecisaoImpresso[] {
  const semNascimento = !p.nascimento || p.nascimento === '1899-12-30';
  return IMPRESSOS_ATENDIMENTO.map((i) => {
    const motivo =
      !p.nome.trim() || p.prontuario <= 0
        ? 'O paciente precisa de nome e prontuário para a identificação.'
        : i.codigo === 'pulseira' && semNascimento
          ? 'A pulseira exige a data de nascimento (dois identificadores legíveis): complete o cadastro.'
          : null;
    return { impresso: i.codigo, formatos: i.formatos, pode: motivo === null, motivo };
  });
}

/** Cópias aceitas por impresso (a pessoa escolhe; o teto evita fila de impressão cheia por engano). */
export function copiasValidas(impresso: ImpressoAtendimento, copias: number): boolean {
  const teto = impresso === 'etiqueta' ? 20 : 5;
  return Number.isInteger(copias) && copias >= 1 && copias <= teto;
}
