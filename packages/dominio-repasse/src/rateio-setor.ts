// Rateio do repasse por setor e custos do prestador descontados do médico (F8, 06-FAT linha 49). Prática de mercado
// adotada (gestão de custos hospitalares por centro de resultado):
//   - regra de rateio: de um médico, de um prestador terceiro ou de um grupo de repasse, com a base ("repasse": o que o
//     médico produziu na apuração; "custo": o custo do prestador descontado dele) e os setores com o percentual; a
//     soma dos percentuais é exatamente 100 (nada fica sem setor, nada é rateado duas vezes) e o setor não se repete;
//   - uma regra vigente por dono no mesmo dia (o médico sabe sempre qual vale); encerrar não estende nem apaga;
//   - na apuração, vale a regra do próprio médico; sem ela, a do grupo de repasse em que ele está; sem nenhuma, o
//     médico fica pendente (nada é inventado);
//   - a divisão em centavos é pelos maiores restos: a soma das parcelas é sempre o valor rateado;
//   - custo do prestador (regra de custo): valor ou percentual da produção, frequência mensal, por apuração ou única,
//     faixa de produção opcional; tipo de desconto com a forma padrão (informado, valor fixo ou percentual).
// Tudo em centavos inteiros; percentuais com até 4 casas (dinheiro.ts). Datas AAAA-MM-DD.
import { percentualE4 } from './dinheiro.js';
import { type Problema, type Vigencia, vigenteNaCompetencia } from './remuneracao-variavel.js';

export const BASES_RATEIO = ['repasse', 'custo'] as const;
export type BaseRateio = (typeof BASES_RATEIO)[number];

export const NATUREZAS_TIPO_DESCONTO = ['adiantamento', 'taxa', 'multa', 'custo', 'glosa', 'outro'] as const;
export type NaturezaTipoDesconto = (typeof NATUREZAS_TIPO_DESCONTO)[number];
export const FORMAS_TIPO_DESCONTO = ['informado', 'valor_fixo', 'percentual'] as const;
export type FormaTipoDesconto = (typeof FORMAS_TIPO_DESCONTO)[number];
export const FREQUENCIAS_CUSTO = ['mensal', 'por_apuracao', 'unica'] as const;
export type FrequenciaCusto = (typeof FREQUENCIAS_CUSTO)[number];

export interface SetorRateio {
  readonly setor: number;
  readonly percentual: number;
}

export interface RegraRateioSetor extends Vigencia {
  readonly descricao: string;
  readonly profissional: number | null;
  readonly prestadorTerceiro: number | null;
  readonly grupoRepasse: number | null;
  readonly base: string;
  readonly setores: readonly SetorRateio[];
}

const casasOk = (p: number) => Math.abs(p * 10000 - Math.round(p * 10000)) < 1e-6;

/** Confere a regra antes de gravar: dono, base, vigência e setores somando exatamente 100%. */
export function validarRegraRateioSetor(r: RegraRateioSetor): Problema[] {
  const p: Problema[] = [];
  if (!r.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição da regra.' });
  const donos = [r.profissional, r.prestadorTerceiro, r.grupoRepasse].filter((x) => x !== null).length;
  if (donos !== 1)
    p.push({
      campo: 'profissional',
      mensagem: 'A regra é de um só dono: o médico, o prestador terceiro ou o grupo de repasse.',
    });
  if (!(BASES_RATEIO as readonly string[]).includes(r.base))
    p.push({ campo: 'base', mensagem: 'A base do rateio é o repasse ou o custo do prestador.' });
  if (r.fim !== null && r.fim < r.inicio)
    p.push({ campo: 'fim', mensagem: 'O fim da vigência é anterior ao início.' });
  if (!r.setores.length) p.push({ campo: 'setores', mensagem: 'Informe ao menos um setor.' });
  const vistos = new Set<number>();
  r.setores.forEach((s, i) => {
    if (!(s.percentual > 0 && s.percentual <= 100) || !casasOk(s.percentual))
      p.push({
        campo: `setores.${i}.percentual`,
        mensagem: 'O percentual de cada setor fica entre 0 e 100, com até 4 casas.',
      });
    if (vistos.has(s.setor))
      p.push({ campo: `setores.${i}.setor`, mensagem: 'O mesmo setor aparece duas vezes na regra.' });
    vistos.add(s.setor);
  });
  if (r.setores.length && somaPercentuaisE4(r.setores) !== 1_000_000)
    p.push({
      campo: 'setores',
      mensagem: 'A soma dos percentuais dos setores tem de ser exatamente 100%.',
    });
  return p;
}

export function somaPercentuaisE4(setores: readonly SetorRateio[]): number {
  return setores.reduce((t, s) => t + percentualE4(s.percentual), 0);
}

/** Divide o valor (centavos) pelos setores, pelos maiores restos: a soma das parcelas é sempre o valor. */
export function ratearPorSetor(
  valorCentavos: number,
  setores: readonly SetorRateio[],
): { setor: number; centavos: number }[] {
  const valor = Math.round(valorCentavos);
  const total = somaPercentuaisE4(setores);
  if (valor <= 0 || total <= 0) return setores.map((s) => ({ setor: s.setor, centavos: 0 }));
  const brutas = setores.map((s, i) => {
    const exato = (BigInt(valor) * BigInt(percentualE4(s.percentual))) / BigInt(total);
    const resto = (BigInt(valor) * BigInt(percentualE4(s.percentual))) % BigInt(total);
    return { i, setor: s.setor, centavos: Number(exato), resto: Number(resto) };
  });
  let sobra = valor - brutas.reduce((t, b) => t + b.centavos, 0);
  const ordem = [...brutas].sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const b of ordem) {
    if (sobra <= 0) break;
    b.centavos += 1;
    sobra -= 1;
  }
  return brutas.map((b) => ({ setor: b.setor, centavos: b.centavos }));
}

export interface RegraRateioVigente extends Vigencia {
  readonly id: number;
  readonly profissional: number | null;
  readonly grupoRepasse: number | null;
  readonly base: BaseRateio;
  readonly setores: readonly SetorRateio[];
}

/** A regra que vale para o médico na competência: a dele; sem ela, a de um grupo de repasse em que ele está. */
export function regraDoMedico(
  regras: readonly RegraRateioVigente[],
  profissional: number,
  gruposDoMedico: readonly number[],
  competencia: string,
): RegraRateioVigente | null {
  const vigentes = regras.filter((r) => vigenteNaCompetencia(r, competencia));
  const propria = vigentes
    .filter((r) => r.profissional === profissional)
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  if (propria[0]) return propria[0];
  const doGrupo = vigentes
    .filter((r) => r.grupoRepasse !== null && gruposDoMedico.includes(r.grupoRepasse))
    .sort((a, b) => b.inicio.localeCompare(a.inicio) || a.id - b.id);
  return doGrupo[0] ?? null;
}

export interface MedicoNaApuracao {
  readonly profissional: number;
  /** O que o médico produziu na apuração (centavos). */
  readonly repasseCentavos: number;
  /** O custo do prestador descontado dele na apuração (centavos). */
  readonly custoCentavos: number;
  readonly grupos: readonly number[];
}

export interface ParcelaRateio {
  readonly profissional: number;
  readonly setor: number;
  readonly regra: number;
  readonly base: BaseRateio;
  readonly centavos: number;
}

/** Rateia a apuração por setor: uma parcela por médico e setor; médico sem regra ou sem valor fica pendente. */
export function ratearApuracaoPorSetor(
  medicos: readonly MedicoNaApuracao[],
  regras: readonly RegraRateioVigente[],
  competencia: string,
): { parcelas: ParcelaRateio[]; pendencias: { profissional: number; motivo: 'sem-regra' | 'sem-valor' }[] } {
  const parcelas: ParcelaRateio[] = [];
  const pendencias: { profissional: number; motivo: 'sem-regra' | 'sem-valor' }[] = [];
  for (const m of [...medicos].sort((a, b) => a.profissional - b.profissional)) {
    const regra = regraDoMedico(regras, m.profissional, m.grupos, competencia);
    if (!regra) {
      pendencias.push({ profissional: m.profissional, motivo: 'sem-regra' });
      continue;
    }
    const valor = regra.base === 'custo' ? m.custoCentavos : m.repasseCentavos;
    if (valor <= 0) {
      pendencias.push({ profissional: m.profissional, motivo: 'sem-valor' });
      continue;
    }
    for (const p of ratearPorSetor(valor, regra.setores))
      if (p.centavos > 0)
        parcelas.push({
          profissional: m.profissional,
          setor: p.setor,
          regra: regra.id,
          base: regra.base,
          centavos: p.centavos,
        });
  }
  return { parcelas, pendencias };
}

export interface CustoDoPrestador extends Vigencia {
  readonly forma: string;
  readonly valor: number | null;
  readonly percentual: number | null;
  readonly faixaInicial: number | null;
  readonly faixaFinal: number | null;
  readonly frequencia: string;
  readonly natureza: string;
}

/** Confere a regra de custo do prestador: forma com o valor ou o percentual, faixa e vigência coerentes. */
export function validarCustoDoPrestador(c: CustoDoPrestador): Problema[] {
  const p: Problema[] = [];
  if (c.forma === 'valor') {
    if (c.valor === null || !(c.valor > 0))
      p.push({ campo: 'valor', mensagem: 'Informe o valor do custo, maior que zero.' });
    if (c.percentual !== null)
      p.push({ campo: 'percentual', mensagem: 'O custo por valor não leva percentual.' });
  } else if (c.forma === 'percentual') {
    if (c.percentual === null || !(c.percentual > 0 && c.percentual <= 100) || !casasOk(c.percentual))
      p.push({ campo: 'percentual', mensagem: 'O percentual fica entre 0 e 100, com até 4 casas.' });
    if (c.valor !== null) p.push({ campo: 'valor', mensagem: 'O custo por percentual não leva valor.' });
  } else p.push({ campo: 'forma', mensagem: 'A forma do custo é valor ou percentual da produção.' });
  if (!(FREQUENCIAS_CUSTO as readonly string[]).includes(c.frequencia))
    p.push({ campo: 'frequencia', mensagem: 'A frequência é mensal, por apuração ou única.' });
  if (c.natureza !== 'desconto' && c.natureza !== 'acrescimo')
    p.push({ campo: 'natureza', mensagem: 'O custo é desconto ou acréscimo.' });
  if ((c.faixaInicial !== null && c.faixaInicial < 0) || (c.faixaFinal !== null && c.faixaFinal < 0))
    p.push({ campo: 'faixaInicial', mensagem: 'A faixa de produção não é negativa.' });
  if (c.faixaInicial !== null && c.faixaFinal !== null && c.faixaFinal < c.faixaInicial)
    p.push({ campo: 'faixaFinal', mensagem: 'O fim da faixa de produção é menor que o início.' });
  if (c.fim !== null && c.fim < c.inicio)
    p.push({ campo: 'fim', mensagem: 'O fim da vigência é anterior ao início.' });
  return p;
}

export interface TipoDescontoRepasse {
  readonly codigo: string;
  readonly descricao: string;
  readonly natureza: string;
  readonly forma: string;
  readonly valorPadrao: number | null;
  readonly percentualPadrao: number | null;
}

/** Confere o tipo de desconto: natureza, forma padrão e o valor ou percentual que a forma pede. */
export function validarTipoDescontoRepasse(t: TipoDescontoRepasse): Problema[] {
  const p: Problema[] = [];
  if (!/^[A-Za-z0-9_.-]{1,30}$/.test(t.codigo))
    p.push({ campo: 'codigo', mensagem: 'O código tem até 30 letras, números, ponto, hífen ou sublinhado.' });
  if (!t.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição do tipo.' });
  if (!(NATUREZAS_TIPO_DESCONTO as readonly string[]).includes(t.natureza))
    p.push({ campo: 'natureza', mensagem: 'Natureza desconhecida.' });
  if (!(FORMAS_TIPO_DESCONTO as readonly string[]).includes(t.forma))
    p.push({ campo: 'forma', mensagem: 'A forma é informada, valor fixo ou percentual.' });
  if (t.forma === 'valor_fixo' && (t.valorPadrao === null || t.valorPadrao < 0))
    p.push({ campo: 'valorPadrao', mensagem: 'O valor fixo pede o valor padrão.' });
  if (
    t.forma === 'percentual' &&
    (t.percentualPadrao === null || t.percentualPadrao < 0 || t.percentualPadrao > 100)
  )
    p.push({ campo: 'percentualPadrao', mensagem: 'O percentual pede o percentual padrão, de 0 a 100.' });
  return p;
}
