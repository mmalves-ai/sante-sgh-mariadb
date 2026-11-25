// Direito à refeição do acompanhante (F7, 04-HOT linha 133): qual regra vale para a refeição de um dia e se ela é
// coberta, fica à espera da autorização da fonte pagadora ou é cobrável (vai para a conta do atendimento).
//
// Fundamentos:
//   - lei: o direito legal do acompanhante (pessoa idosa, Lei 10.741/2003; criança e adolescente, Lei 8.069/1990;
//     parturiente, Lei 11.108/2005; pessoa com deficiência, Lei 13.146/2015), com a cobertura dos planos pela
//     RN ANS 465/2021. A regra de lei vale quando a base legal está registrada na internação ou quando a idade do
//     paciente cai na faixa da regra;
//   - convenio: a regra comercial da fonte pagadora (cobre, exige autorização ou já está na diária);
//   - politica_interna: o que o hospital decide oferecer por conta própria.
// Prioridade: a regra de lei ganha; entre as demais, a mais específica (fonte pagadora, acomodação, faixa de idade,
// refeições escolhidas) e, empatando, a de vigência mais recente. Sem regra: com direito legal registrado, a refeição é
// coberta (RN 465); fora disso, cobrável. Função pura: nada de banco.

export const FUNDAMENTOS_DIREITO_REFEICAO = ['lei', 'convenio', 'politica_interna'] as const;
export type FundamentoDireitoRefeicao = (typeof FUNDAMENTOS_DIREITO_REFEICAO)[number];

export const COBERTURAS_REFEICAO = ['coberta', 'a_autorizar', 'cobravel'] as const;
export type CoberturaRefeicao = (typeof COBERTURAS_REFEICAO)[number];

export interface RegraDireitoRefeicao {
  readonly id: number;
  readonly descricao: string;
  readonly fundamento: FundamentoDireitoRefeicao;
  /** Nula: vale para todas as fontes pagadoras. */
  readonly fontePagadora: number | null;
  /** Nula: vale para todas as acomodações. */
  readonly acomodacao: number | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly cobertoPelaFonte: boolean;
  readonly exigeAutorizacao: boolean;
  readonly incluidoNaDiaria: boolean;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  /** Refeições do dia cobertas; vazia = todas. */
  readonly refeicoes: readonly number[];
}

export interface SituacaoDaRefeicao {
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly refeicao: number;
  readonly fontePagadora: number | null;
  readonly acomodacao: number | null;
  /** Idade do paciente na data da refeição; nula sem nascimento. */
  readonly idadePaciente: number | null;
  /** Base legal do acompanhante registrada e vigente na internação. */
  readonly direitoLegal: boolean;
}

export interface DecisaoRefeicao {
  readonly cobertura: CoberturaRefeicao;
  readonly regra: number | null;
  readonly fundamento: FundamentoDireitoRefeicao | null;
  /** A refeição já está paga na diária: coberta, sem lançamento à parte. */
  readonly incluidaNaDiaria: boolean;
  readonly motivo: string;
}

export interface ProblemaRegra {
  readonly campo: string;
  readonly mensagem: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Idade em anos completos na data (AAAA-MM-DD); nula sem nascimento. */
export function idadeNaData(nascimento: string | null, data: string): number | null {
  if (!nascimento || !DATA.test(nascimento.slice(0, 10)) || !DATA.test(data)) return null;
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  let idade = a - an;
  if (m < mn || (m === mn && d < dn)) idade -= 1;
  return idade < 0 ? null : idade;
}

/** Validação da regra antes do banco (o banco tem os CHECK equivalentes). */
export function validarRegraDireitoRefeicao(r: {
  readonly descricao: string;
  readonly fundamento: FundamentoDireitoRefeicao;
  readonly fontePagadora: number | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly cobertoPelaFonte: boolean;
  readonly exigeAutorizacao: boolean;
  readonly incluidoNaDiaria: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}): ProblemaRegra[] {
  const p: ProblemaRegra[] = [];
  if (!r.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Descreva a regra.' });
  if (!DATA.test(r.vigenciaInicio))
    p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  if (r.idadeMinima !== null && r.idadeMaxima !== null && r.idadeMaxima < r.idadeMinima)
    p.push({ campo: 'idadeMaxima', mensagem: 'A idade máxima não pode ser menor que a mínima.' });
  if (r.fundamento === 'convenio' && r.fontePagadora === null)
    p.push({ campo: 'fontePagadora', mensagem: 'A regra do convênio precisa da fonte pagadora.' });
  if (r.fundamento === 'convenio' && !r.cobertoPelaFonte && !r.incluidoNaDiaria && !r.exigeAutorizacao)
    p.push({
      campo: 'cobertoPelaFonte',
      mensagem:
        'A regra do convênio precisa dizer o que cobre: paga pela fonte, incluída na diária ou com autorização.',
    });
  if (r.incluidoNaDiaria && r.exigeAutorizacao)
    p.push({
      campo: 'exigeAutorizacao',
      mensagem: 'A refeição incluída na diária já está paga: não pede autorização.',
    });
  return p;
}

function naFaixa(r: RegraDireitoRefeicao, idade: number | null): boolean | null {
  if (r.idadeMinima === null && r.idadeMaxima === null) return null;
  if (idade === null) return false;
  return (
    (r.idadeMinima === null || idade >= r.idadeMinima) && (r.idadeMaxima === null || idade <= r.idadeMaxima)
  );
}

/** A regra vale para a situação (vigente, da fonte, da acomodação, da idade e da refeição). */
export function regraAplicavel(r: RegraDireitoRefeicao, s: SituacaoDaRefeicao): boolean {
  if (!r.ativo) return false;
  if (r.vigenciaInicio > s.data || (r.vigenciaFim !== null && r.vigenciaFim < s.data)) return false;
  if (r.fontePagadora !== null && r.fontePagadora !== s.fontePagadora) return false;
  if (r.acomodacao !== null && r.acomodacao !== s.acomodacao) return false;
  if (r.refeicoes.length > 0 && !r.refeicoes.includes(s.refeicao)) return false;
  const faixa = naFaixa(r, s.idadePaciente);
  if (r.fundamento === 'lei') return s.direitoLegal || faixa === true;
  return faixa !== false;
}

const especificidade = (r: RegraDireitoRefeicao): number =>
  (r.fontePagadora !== null ? 8 : 0) +
  (r.acomodacao !== null ? 4 : 0) +
  (r.idadeMinima !== null || r.idadeMaxima !== null ? 2 : 0) +
  (r.refeicoes.length > 0 ? 1 : 0);

/** A regra que vale: a de lei primeiro, depois a mais específica, depois a de vigência mais recente. */
export function regraVigente(
  regras: readonly RegraDireitoRefeicao[],
  s: SituacaoDaRefeicao,
): RegraDireitoRefeicao | null {
  const validas = regras.filter((r) => regraAplicavel(r, s));
  validas.sort(
    (a, b) =>
      Number(b.fundamento === 'lei') - Number(a.fundamento === 'lei') ||
      especificidade(b) - especificidade(a) ||
      b.vigenciaInicio.localeCompare(a.vigenciaInicio) ||
      b.id - a.id,
  );
  return validas[0] ?? null;
}

/** Decide a refeição: coberta, à espera da autorização da fonte ou cobrável. */
export function decidirRefeicaoAcompanhante(
  regras: readonly RegraDireitoRefeicao[],
  s: SituacaoDaRefeicao,
): DecisaoRefeicao {
  const r = regraVigente(regras, s);
  if (!r) {
    if (s.direitoLegal)
      return {
        cobertura: 'coberta',
        regra: null,
        fundamento: 'lei',
        incluidaNaDiaria: false,
        motivo: 'Direito legal do acompanhante (cobertura dos planos pela RN ANS 465/2021).',
      };
    return {
      cobertura: 'cobravel',
      regra: null,
      fundamento: null,
      incluidaNaDiaria: false,
      motivo: 'Sem direito legal nem regra do convênio para esta refeição: vai para a conta.',
    };
  }
  const base = { regra: r.id, fundamento: r.fundamento } as const;
  if (r.incluidoNaDiaria)
    return {
      ...base,
      cobertura: 'coberta',
      incluidaNaDiaria: true,
      motivo: `${r.descricao}: já paga na diária.`,
    };
  if (r.exigeAutorizacao)
    return {
      ...base,
      cobertura: 'a_autorizar',
      incluidaNaDiaria: false,
      motivo: `${r.descricao}: depende da autorização da fonte pagadora.`,
    };
  if (r.fundamento === 'convenio' && !r.cobertoPelaFonte)
    return {
      ...base,
      cobertura: 'cobravel',
      incluidaNaDiaria: false,
      motivo: `${r.descricao}: o convênio não cobre; vai para a conta.`,
    };
  return { ...base, cobertura: 'coberta', incluidaNaDiaria: false, motivo: `${r.descricao}: coberta.` };
}

/** A autorização da fonte decide a refeição que esperava: autorizada é coberta; negada é cobrável. */
export function decidirAutorizacao(autorizadaPelaFonte: boolean): CoberturaRefeicao {
  return autorizadaPelaFonte ? 'coberta' : 'cobravel';
}

export interface PrecoDaRefeicao {
  readonly id: number;
  readonly fontePagadora: number | null;
  readonly itemFaturavel: number | null;
  readonly valor: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** O preço vigente da refeição: o do convênio da conta antes do geral; o de vigência mais recente. */
export function precoVigenteDaRefeicao(
  precos: readonly PrecoDaRefeicao[],
  fontePagadora: number | null,
  data: string,
): PrecoDaRefeicao | null {
  const v = precos.filter(
    (p) =>
      (p.fontePagadora === null || p.fontePagadora === fontePagadora) &&
      p.vigenciaInicio <= data &&
      (p.vigenciaFim === null || p.vigenciaFim >= data),
  );
  v.sort(
    (a, b) =>
      Number(b.fontePagadora !== null) - Number(a.fontePagadora !== null) ||
      b.vigenciaInicio.localeCompare(a.vigenciaInicio) ||
      b.id - a.id,
  );
  return v[0] ?? null;
}
