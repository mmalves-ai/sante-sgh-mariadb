// Produto e plano da operadora (M56.2, fatia F1; ficha, seções 6 e 8, regras 2 e 3): a conferência completa antes de
// gravar em SGH_OPE_PRODUTO. Plano de saúde tem registro na ANS, segmentação, abrangência, acomodação quando interna,
// carências dentro do teto legal (Lei 9.656/1998, art. 12, V) e a tabela de preços nas 10 faixas da RN ANS 63/2003;
// cartão de desconto não é plano (regra 2): sem registro, sem segmentação e sem carência. E a operadora (empresa
// distinta, regra 3) tem registro de 6 dígitos na ANS e CNPJ válido.
import {
  CARENCIAS_PRODUTO,
  FAIXAS_ETARIAS_ANS,
  type CarenciasProduto,
  type NaturezaProduto,
  type SegmentacaoProduto,
  TIPOS_CARENCIA,
} from '@sgh/contratos';
import { cnpjValido } from './documentos.js';
import { type ProblemaProduto, problemasDoProduto, registroOperadoraAnsValido } from './produto.js';

export type ProblemaOperadoraEmpresa = 'registro-operadora-invalido' | 'cnpj-invalido';

export function problemasDaOperadora(o: {
  readonly registroAns: string;
  readonly cnpj: string;
}): ProblemaOperadoraEmpresa[] {
  const p: ProblemaOperadoraEmpresa[] = [];
  if (!registroOperadoraAnsValido(o.registroAns)) p.push('registro-operadora-invalido');
  if (!cnpjValido(o.cnpj)) p.push('cnpj-invalido');
  return p;
}

export type ProblemaPlano =
  | ProblemaProduto
  | 'segmentacao-obrigatoria'
  | 'abrangencia-obrigatoria'
  | 'acomodacao-obrigatoria'
  | 'acomodacao-sem-internacao'
  | 'cartao-desconto-com-cobertura'
  | 'coparticipacao-sem-valor'
  | 'coparticipacao-percentual-invalido'
  | 'carencia-acima-do-limite'
  | 'precos-obrigatorios'
  | 'preco-zero'
  | 'precos-decrescentes'
  | 'precos-ultima-acima-de-seis-vezes'
  | 'precos-variacao-final-maior'
  | 'produto-em-uso';

export interface PlanoDeclarado {
  readonly natureza: NaturezaProduto;
  readonly registroAns: string | null;
  readonly segmentacao: SegmentacaoProduto | null;
  readonly abrangencia: string | null;
  readonly acomodacao: number | null;
  readonly coparticipacao: { readonly tipo: number; readonly valor: number | null };
  readonly carencias: CarenciasProduto;
  readonly precos: readonly number[] | null;
}

/** Segmentações com internação: pedem a acomodação (apartamento ou enfermaria). */
const COM_INTERNACAO: ReadonlySet<SegmentacaoProduto> = new Set([
  'hospitalarSemObstetricia',
  'hospitalarComObstetricia',
  'ambulatorialHospitalar',
  'referencia',
]);

/** Acomodação "Ambulatório" (código 3): a única que cabe em produto sem internação. */
const ACOMODACAO_AMBULATORIO = 3;

/** Problemas da tabela de preços pelas faixas da RN 63 (vazio: a tabela cabe na regra). */
export function problemasDosPrecos(precos: readonly number[]): ProblemaPlano[] {
  const p: ProblemaPlano[] = [];
  if (precos.length !== FAIXAS_ETARIAS_ANS.length) return ['precos-obrigatorios'];
  const [primeira, setima, ultima] = [precos[0] as number, precos[6] as number, precos[9] as number];
  if (primeira <= 0) return ['preco-zero'];
  for (let i = 1; i < precos.length; i++)
    if ((precos[i] as number) < (precos[i - 1] as number)) {
      p.push('precos-decrescentes');
      break;
    }
  // Centavos: a comparação com 6 vezes e a das variações sem erro de ponto flutuante.
  const c = (v: number) => Math.round(v * 100);
  if (c(ultima) > 6 * c(primeira)) p.push('precos-ultima-acima-de-seis-vezes');
  // Variação acumulada 7ª→10ª não maior que 1ª→7ª: (u/s − 1) ≤ (s/p − 1) ⇔ u·p ≤ s² (todos positivos).
  if (c(ultima) * c(primeira) > c(setima) * c(setima)) p.push('precos-variacao-final-maior');
  return p;
}

/** Conferência do produto antes de gravar (a mensagem da tela vem do código). */
export function problemasDoPlano(x: PlanoDeclarado): ProblemaPlano[] {
  const p: ProblemaPlano[] = [...problemasDoProduto(x)];
  const tipoCopart = x.coparticipacao.tipo;
  const valor = x.coparticipacao.valor;
  if (tipoCopart !== 1 && (valor === null || valor <= 0)) p.push('coparticipacao-sem-valor');
  if (tipoCopart === 2 && valor !== null && valor > 100) p.push('coparticipacao-percentual-invalido');
  if (x.natureza === 'cartaoDesconto') {
    const temCarencia = TIPOS_CARENCIA.some((t) => x.carencias[t] > 0);
    if (x.segmentacao !== null || x.acomodacao !== null || temCarencia)
      p.push('cartao-desconto-com-cobertura');
    if (x.precos) p.push(...problemasDosPrecos(x.precos).filter((c) => c !== 'precos-obrigatorios'));
    return [...new Set(p)];
  }
  if (x.segmentacao === null) p.push('segmentacao-obrigatoria');
  if (!x.abrangencia) p.push('abrangencia-obrigatoria');
  if (x.segmentacao && COM_INTERNACAO.has(x.segmentacao)) {
    if (x.acomodacao === null || x.acomodacao === ACOMODACAO_AMBULATORIO) p.push('acomodacao-obrigatoria');
  } else if (x.segmentacao && x.acomodacao !== null && x.acomodacao !== ACOMODACAO_AMBULATORIO)
    p.push('acomodacao-sem-internacao');
  if (TIPOS_CARENCIA.some((t) => x.carencias[t] > CARENCIAS_PRODUTO[t].maximo))
    p.push('carencia-acima-do-limite');
  if (!x.precos) p.push('precos-obrigatorios');
  else p.push(...problemasDosPrecos(x.precos));
  return [...new Set(p)];
}

/** O que identifica o produto perante a ANS e os contratos: natureza, tipo de contratação e registro. */
export interface IdentidadeDoPlano {
  readonly natureza: NaturezaProduto;
  readonly tipoContratacao: number;
  readonly registroAns: string | null;
}

/**
 * Alteração de produto com contrato em uso (ativo ou suspenso): natureza, tipo de contratação e registro na ANS não
 * mudam, senão os beneficiários trocam de plano em silêncio e os contratos de pessoa física ficam incompatíveis com o
 * próprio produto (D-BAIXA-56). O resto (nome, preços, carências, situação) segue alterável.
 */
export function problemasDaAlteracaoDoPlano(
  anterior: IdentidadeDoPlano,
  novo: IdentidadeDoPlano,
  contratosEmUso: number,
): ProblemaPlano[] {
  if (contratosEmUso <= 0) return [];
  const mudou =
    anterior.natureza !== novo.natureza ||
    anterior.tipoContratacao !== novo.tipoContratacao ||
    (anterior.registroAns ?? null) !== (novo.registroAns ?? null);
  return mudou ? ['produto-em-uso'] : [];
}

/** Índice da faixa etária da RN 63 para a idade (0 a 9). */
export function faixaEtariaDaIdade(idade: number): number {
  const i = FAIXAS_ETARIAS_ANS.findIndex((f) => idade >= f.de && (f.ate === null || idade <= f.ate));
  return i < 0 ? 0 : i;
}

/** Idade completa em anos na data (AAAA-MM-DD). */
export function idadeEm(nascimento: string, data: string): number {
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
}

/** Preço de referência da faixa do beneficiário (null sem tabela). A cobrança é da fatia F2. */
export function precoDeReferencia(
  precos: readonly number[] | null,
  nascimento: string,
  data: string,
): number | null {
  if (!precos) return null;
  return precos[faixaEtariaDaIdade(idadeEm(nascimento, data))] ?? null;
}
