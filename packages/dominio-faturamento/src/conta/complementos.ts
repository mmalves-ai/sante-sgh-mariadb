// F3.7 (06-FAT linhas 10 e 12): os complementos da conta e da guia, com regra no domínio.
// - Período da conta parcial: a internação longa é faturada em faixas de data e hora, cada uma na sua competência. O
//   próximo período é sugerido (começa onde o último terminou e vai até o fim do mês ou da conta), a competência sai do
//   fim da faixa, e a faixa não pode sair da conta nem se sobrepor a outra do mesmo tipo de lançamento (nula: todos).
// - Dados do segurado na conta: a carteira usada nesta conta (copiada da cobertura do paciente, com a validade
//   conferida na data de início da conta) e os dados funcionais do servidor, quando a fonte pagadora é um órgão.
// - Campo adicional da operadora na guia: genérico (texto, número, data, sim ou não, ou lista de opções, com
//   dependência entre listas, como a fase dentro do tratamento oncológico). A guia só é apresentada com os
//   obrigatórios preenchidos, e o valor é conferido pelo tipo na hora em que é informado.

export type Erros = Record<string, string>;

/** Situações da conta em que os complementos ainda podem mudar (depois disso, só reabrindo a conta). */
export const SITUACOES_CONTA_EDITAVEL = ['aberta', 'em_conferencia', 'em_auditoria'] as const;
export function contaEditavel(situacao: string): boolean {
  return (SITUACOES_CONTA_EDITAVEL as readonly string[]).includes(situacao);
}

// ── Período da conta parcial ──────────────────────────────────────────────────────────────────────

export interface PeriodoConta {
  readonly inicio: string; // ISO data e hora
  readonly fim: string;
  readonly tipoLancamentoId: number | null;
}

export interface ContaDoPeriodo {
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
}

const ms = (iso: string) => new Date(iso).getTime();
const valida = (iso: string) => !Number.isNaN(ms(iso));

/** Primeiro dia do mês de uma data e hora ISO (no relógio do texto, sem fuso). */
export function competenciaDoPeriodo(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function fimDoMes(iso: string): string {
  const [a, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, '0')}T23:59:59.999`;
}

const sobrepoe = (a: PeriodoConta, b: PeriodoConta) =>
  (a.tipoLancamentoId === null || b.tipoLancamentoId === null || a.tipoLancamentoId === b.tipoLancamentoId) &&
  ms(a.inicio) < ms(b.fim) &&
  ms(b.inicio) < ms(a.fim);

/** Primeiro instante do mês seguinte ao de uma data e hora ISO. */
function inicioDoMesSeguinte(iso: string): string {
  const [a, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00.000`;
}

/**
 * Sugestão do próximo período: começa onde terminou o último (ou no início da conta); se o último acabou no último
 * instante do mês, começa no primeiro instante do mês seguinte. Vai até o fim do mês do início, ou até o fim da conta
 * quando ela termina antes. Nulo quando a conta já está coberta até o fim.
 */
export function sugerirProximoPeriodo(
  conta: ContaDoPeriodo,
  existentes: readonly PeriodoConta[],
): (PeriodoConta & { competencia: string }) | null {
  const ultimoFim = existentes.reduce<string | null>(
    (m, p) => (m === null || ms(p.fim) > ms(m) ? p.fim : m),
    null,
  );
  let inicio = ultimoFim ?? conta.inicio;
  if (ms(inicio) >= ms(fimDoMes(inicio))) inicio = inicioDoMesSeguinte(inicio);
  if (conta.fim !== null && ms(inicio) >= ms(conta.fim)) return null;
  const fimMes = fimDoMes(inicio);
  const fim = conta.fim !== null && ms(conta.fim) < ms(fimMes) ? conta.fim : fimMes;
  return { inicio, fim, tipoLancamentoId: null, competencia: competenciaDoPeriodo(fim) };
}

/** Confere o período novo; devolve os erros por campo e a competência (a informada ou a do fim da faixa). */
export function validarPeriodoConta(
  conta: ContaDoPeriodo,
  existentes: readonly PeriodoConta[],
  novo: PeriodoConta & { competencia?: string | null },
): { erros: Erros; competencia: string } {
  const erros: Erros = {};
  if (!contaEditavel(conta.situacao))
    erros['conta'] = 'A conta não está aberta: reabra-a para mudar os períodos.';
  if (!valida(novo.inicio)) erros['inicio'] = 'Informe o início do período.';
  if (!valida(novo.fim)) erros['fim'] = 'Informe o fim do período.';
  const competencia = novo.competencia ?? (valida(novo.fim) ? competenciaDoPeriodo(novo.fim) : '');
  if (Object.keys(erros).some((c) => c === 'inicio' || c === 'fim')) return { erros, competencia };
  if (ms(novo.fim) < ms(novo.inicio)) erros['fim'] = 'O fim do período não pode ser antes do início.';
  else if (ms(novo.fim) === ms(novo.inicio)) erros['fim'] = 'O período não pode ter duração zero.';
  if (ms(novo.inicio) < ms(conta.inicio)) erros['inicio'] = 'O período começa antes da abertura da conta.';
  if (conta.fim !== null && ms(novo.fim) > ms(conta.fim))
    erros['fim'] = 'O período termina depois do fim da conta.';
  if (!/^\d{4}-\d{2}-01$/.test(competencia))
    erros['competencia'] = 'A competência é o primeiro dia de um mês.';
  else if (competencia < competenciaDoPeriodo(novo.inicio))
    erros['competencia'] = 'A competência não pode ser anterior ao mês de início do período.';
  if (!erros['fim'] && !erros['inicio'] && existentes.some((p) => sobrepoe(p, novo)))
    erros['inicio'] = 'O período se sobrepõe a outro período da conta para o mesmo tipo de lançamento.';
  return { erros, competencia };
}

// ── Dados do segurado na conta ────────────────────────────────────────────────────────────────────

export interface SeguradoConta {
  readonly numeroCarteira: string;
  readonly validadeCarteira: string | null; // AAAA-MM-DD
  readonly parentescoTitular: string | null;
  readonly titularCoberturaId: number | null;
  readonly matriculaFuncional: string | null;
}

/** Erros que impedem gravar e alertas que só avisam (carteira vencida em relação à data de início da conta). */
export function validarSeguradoConta(
  situacaoConta: string,
  inicioConta: string,
  s: SeguradoConta,
): { erros: Erros; alertas: string[] } {
  const erros: Erros = {};
  const alertas: string[] = [];
  if (!contaEditavel(situacaoConta))
    erros['conta'] = 'A conta não está aberta: reabra-a para mudar os dados do segurado.';
  const carteira = s.numeroCarteira.trim();
  if (!carteira) erros['numeroCarteira'] = 'Informe o número da carteira usada nesta conta.';
  else if (!/^[0-9A-Za-z.\- /]+$/.test(carteira))
    erros['numeroCarteira'] = 'A carteira tem só letras, números, ponto, traço, barra e espaço.';
  if (s.validadeCarteira !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.validadeCarteira) || !valida(s.validadeCarteira))
      erros['validadeCarteira'] = 'Validade da carteira inválida.';
    else if (s.validadeCarteira < inicioConta.slice(0, 10))
      alertas.push('A carteira estava vencida no início da conta: confira a autorização com a operadora.');
  }
  const parentesco = s.parentescoTitular?.trim().toLowerCase() ?? '';
  if (parentesco && parentesco !== 'titular' && s.titularCoberturaId === null && !s.matriculaFuncional)
    erros['titularCoberturaId'] = 'Dependente: informe o titular da cobertura ou a matrícula funcional.';
  return { erros, alertas };
}

// ── Campo adicional da operadora na guia ──────────────────────────────────────────────────────────

export type TipoDadoAtributo = 'texto' | 'numero' | 'data' | 'booleano' | 'opcao';
export const TIPOS_DADO_ATRIBUTO: readonly TipoDadoAtributo[] = [
  'texto',
  'numero',
  'data',
  'booleano',
  'opcao',
];
export const TIPOS_GUIA_ATRIBUTO = [
  'consulta',
  'sp_sadt',
  'solicitacao_internacao',
  'resumo_internacao',
  'honorario',
  'outras_despesas',
  'odontologia',
] as const;

export interface OpcaoAtributo {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly ativo: boolean;
  readonly opcaoPaiId: number | null;
}

export interface DefinicaoAtributoGuia {
  readonly id: number;
  readonly codigo: string;
  readonly rotulo: string;
  readonly tipoDado: TipoDadoAtributo;
  readonly tipoGuia: string | null;
  readonly obrigatorio: boolean;
  readonly tamanhoMaximo: number | null;
  readonly dependeDeId: number | null;
  readonly ativo: boolean;
  readonly ordem: number;
  readonly opcoes: readonly OpcaoAtributo[];
}

export interface ValorAtributo {
  readonly atributoId: number;
  readonly opcaoId: number | null;
  readonly texto: string | null;
}

/** Confere a definição de um campo adicional (o cadastro feito pelo faturamento para a operadora). */
export function validarDefinicaoAtributo(
  d: {
    readonly id: number | null;
    readonly codigo: string;
    readonly rotulo: string;
    readonly tipoDado: string;
    readonly tipoGuia: string | null;
    readonly tamanhoMaximo: number | null;
    readonly dependeDeId: number | null;
  },
  /** Os demais atributos da mesma operadora (para a dependência). */
  outros: readonly Pick<DefinicaoAtributoGuia, 'id' | 'tipoDado' | 'dependeDeId'>[],
): Erros {
  const erros: Erros = {};
  if (!/^[A-Za-z0-9_.-]{1,30}$/.test(d.codigo.trim()))
    erros['codigo'] = 'O código tem de 1 a 30 letras, números, ponto, traço ou sublinhado.';
  if (!d.rotulo.trim()) erros['rotulo'] = 'Informe o rótulo que aparece na guia.';
  if (!(TIPOS_DADO_ATRIBUTO as readonly string[]).includes(d.tipoDado))
    erros['tipoDado'] = 'Tipo de dado inválido.';
  if (d.tipoGuia !== null && !(TIPOS_GUIA_ATRIBUTO as readonly string[]).includes(d.tipoGuia))
    erros['tipoGuia'] = 'Tipo de guia inválido.';
  if (d.tamanhoMaximo !== null && (d.tipoDado !== 'texto' || d.tamanhoMaximo < 1 || d.tamanhoMaximo > 500))
    erros['tamanhoMaximo'] = 'O tamanho máximo vale só para texto, de 1 a 500.';
  if (d.dependeDeId !== null) {
    const pai = outros.find((o) => o.id === d.dependeDeId);
    if (d.tipoDado !== 'opcao') erros['dependeDeId'] = 'Só um campo de lista pode depender de outro.';
    else if (!pai || pai.tipoDado !== 'opcao')
      erros['dependeDeId'] = 'O campo de que este depende tem de ser uma lista da mesma operadora.';
    else {
      // Sem ciclo: subindo pela cadeia a partir do pai, não se chega a este.
      let atual: number | null = pai.id;
      const vistos = new Set<number>();
      while (atual !== null && !vistos.has(atual)) {
        if (d.id !== null && atual === d.id) {
          erros['dependeDeId'] = 'A dependência entre os campos formaria um ciclo.';
          break;
        }
        vistos.add(atual);
        atual = outros.find((o) => o.id === atual)?.dependeDeId ?? null;
      }
    }
  }
  return erros;
}

/**
 * Inativar um campo de que outros campos ativos dependem travaria a escolha nesses filhos: recusa e diz quais são.
 * Devolve os rótulos dos dependentes ativos (vazio: pode inativar).
 */
export function dependentesAtivos(
  id: number,
  outros: readonly Pick<DefinicaoAtributoGuia, 'rotulo' | 'dependeDeId' | 'ativo'>[],
): string[] {
  return outros.filter((o) => o.ativo && o.dependeDeId === id).map((o) => o.rotulo);
}

/** Os campos que valem para o tipo de guia, ativos e na ordem do cadastro. */
export function atributosDaGuia(
  defs: readonly DefinicaoAtributoGuia[],
  tipoGuia: string,
): DefinicaoAtributoGuia[] {
  return defs
    .filter((d) => d.ativo && (d.tipoGuia === null || d.tipoGuia === tipoGuia))
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id);
}

/** Situações da guia em que os campos adicionais ainda podem mudar (antes do lote, ou devolvida pela operadora). */
export function guiaAceitaAtributos(situacao: string): boolean {
  return ['montada', 'conferida', 'rejeitada', 'glosada'].includes(situacao);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Confere e normaliza os valores informados contra os campos que valem para a guia. Campo vazio não grava; o
 * obrigatório vazio fica em `faltam` (a guia só é apresentada sem pendência). Erro de tipo ou de opção recusa.
 */
export function validarValoresAtributos(
  defs: readonly DefinicaoAtributoGuia[],
  valores: readonly ValorAtributo[],
): { erros: Erros; normalizados: ValorAtributo[]; faltam: string[] } {
  const erros: Erros = {};
  const normalizados: ValorAtributo[] = [];
  const porId = new Map(defs.map((d) => [d.id, d]));
  const escolhida = new Map<number, number>();
  for (const v of valores) {
    const d = porId.get(v.atributoId);
    const campo = `atributo.${v.atributoId}`;
    if (!d) {
      erros[campo] = 'Campo que não vale para esta guia da operadora.';
      continue;
    }
    const texto = v.texto?.trim() ?? '';
    if (d.tipoDado === 'opcao') {
      if (v.opcaoId === null) continue;
      const o = d.opcoes.find((x) => x.id === v.opcaoId);
      if (!o || !o.ativo) {
        erros[campo] = `${d.rotulo}: opção inexistente ou inativa.`;
        continue;
      }
      escolhida.set(d.id, o.id);
      normalizados.push({ atributoId: d.id, opcaoId: o.id, texto: null });
      continue;
    }
    if (!texto) continue;
    let norm = texto;
    if (d.tipoDado === 'numero') {
      const n = Number(texto.replace(',', '.'));
      if (!Number.isFinite(n)) erros[campo] = `${d.rotulo}: informe um número.`;
      else norm = String(n);
    } else if (d.tipoDado === 'data') {
      if (!DATA.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00Z`).getTime()))
        erros[campo] = `${d.rotulo}: informe a data (AAAA-MM-DD).`;
    } else if (d.tipoDado === 'booleano') {
      const b = texto.toLowerCase();
      if (['sim', 'true', '1', 's'].includes(b)) norm = 'sim';
      else if (['nao', 'não', 'false', '0', 'n'].includes(b)) norm = 'nao';
      else erros[campo] = `${d.rotulo}: responda sim ou não.`;
    } else if (d.tamanhoMaximo !== null && texto.length > d.tamanhoMaximo)
      erros[campo] = `${d.rotulo}: no máximo ${d.tamanhoMaximo} caracteres.`;
    if (!erros[campo]) normalizados.push({ atributoId: d.id, opcaoId: null, texto: norm });
  }
  // Dependência entre listas: a opção escolhida, quando tem pai, exige a opção-pai escolhida no campo de que depende.
  // Pai inativo (fora de `defs`, que só traz os campos que valem para a guia) não trava a escolha do filho.
  for (const d of defs) {
    const id = escolhida.get(d.id);
    if (id === undefined || d.dependeDeId === null || !porId.has(d.dependeDeId)) continue;
    const pai = d.opcoes.find((o) => o.id === id)?.opcaoPaiId ?? null;
    if (pai !== null && escolhida.get(d.dependeDeId) !== pai)
      erros[`atributo.${d.id}`] = `${d.rotulo}: a opção não combina com a escolhida no campo de que depende.`;
  }
  const preenchidos = new Set(normalizados.map((v) => v.atributoId));
  const faltam = defs.filter((d) => d.obrigatorio && !preenchidos.has(d.id)).map((d) => d.rotulo);
  return { erros, normalizados, faltam };
}
