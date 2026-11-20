// APACHE II (Knaus et al., Crit Care Med 1985; ficha do M45, regra 5): a pontuação fisiológica aguda (12 variáveis, o
// pior valor das primeiras 24 horas, pelas faixas da configuração do estabelecimento), os pontos da idade e da doença
// crônica, e a mortalidade esperada pela equação ln(R/(1-R)) = -3,517 + 0,146 × APACHE II + peso da categoria
// diagnóstica (na configuração, o peso das categorias de cirurgia de urgência já leva o 0,603 da equação). Puro.
import type {
  CalculoIndiceUti,
  ConfiguracaoIndicesUti,
  PontoVariavel,
  TipoAdmissaoUti,
} from '@sgh/contratos';
import { categoriasDoTipo, glasgowDoIndice, pontosDaVariavel, variaveisDoIndice } from './configuracao.js';

export interface EntradaApache2 {
  /** Pelas siglas da configuração; o pior valor das primeiras 24 horas. Creatinina em mg/dL; leucócitos por mm³. */
  readonly variaveis: Readonly<Record<string, number | null>>;
  /** Os itens de Glasgow escolhidos (IDs dos itens da configuração). */
  readonly glasgow: { readonly ocular: number; readonly verbal: number; readonly motora: number };
  readonly idade: number;
  readonly tipoAdmissao: TipoAdmissaoUti;
  readonly categoria: number;
  readonly insuficienciaCronica: boolean;
  readonly falhaRenalAguda: boolean;
}

export type RecusaIndice = { readonly ok: false; readonly codigo: string; readonly mensagem: string };

const CONSTANTE = -3.517;
const COEFICIENTE = 0.146;
const fmt = (n: number, casas = 3) => n.toFixed(casas).replace('.', ',').replace(/^-/, '−');
const nulo = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v);

/** A FiO2 como fração (aceita 21 a 100 em porcentagem). */
export const fracao = (fio2: number) => (fio2 > 1 ? fio2 / 100 : fio2);

/** O gradiente alvéolo-arterial ao nível do mar: FiO2 × 713 − PaCO2 ÷ 0,8 − PaO2. */
export const gradienteAa = (fio2: number, paco2: number, pao2: number) =>
  Math.round(fracao(fio2) * 713 - paco2 / 0.8 - pao2);

export function calcularApache2(
  c: ConfiguracaoIndicesUti,
  e: EntradaApache2,
): ({ ok: true } & CalculoIndiceUti) | RecusaIndice {
  const vs = variaveisDoIndice(c, 'apache2');
  const parcelas: PontoVariavel[] = [];
  const avisos: string[] = [];
  const v = e.variaveis;
  const pontuar = (
    sigla: string,
    valor: number | null | undefined,
    grupo: string,
    nome?: string,
    fator = 1,
  ) => {
    const d = vs.get(sigla);
    if (!d) {
      avisos.push(`A configuração não tem a variável ${nome ?? sigla}: conta 0.`);
      parcelas.push({ variavel: null, sigla, nome: nome ?? sigla, valor: valor ?? null, pontos: 0, grupo });
      return;
    }
    if (nulo(valor)) {
      avisos.push(`${d.nome}: não informado, conta como normal (0).`);
      parcelas.push({ variavel: d.id, sigla, nome: d.nome, valor: null, pontos: 0, grupo });
      return;
    }
    parcelas.push({
      variavel: d.id,
      sigla,
      nome: d.nome,
      valor,
      pontos: pontosDaVariavel(d, valor * fator).pontos,
      grupo,
    });
  };
  const A = 'Fisiológica aguda';
  pontuar('TEMP', v['TEMP'], A);
  const pam = !nulo(v['PAM'])
    ? v['PAM']
    : !nulo(v['PAS']) && !nulo(v['PAD'])
      ? Math.round((v['PAS']! + 2 * v['PAD']!) / 3)
      : null;
  pontuar('PAM', pam, A);
  pontuar('FC', v['FC'], A);
  pontuar('FR', v['FR'], A);
  // Oxigenação: FiO2 ≥ 0,5 usa o gradiente A-a; abaixo, a PaO2.
  const fio2 = nulo(v['FIO2']) ? 0.21 : fracao(v['FIO2']!);
  if (fio2 >= 0.5) {
    const grad = !nulo(v['GRADIENTE'])
      ? v['GRADIENTE']
      : !nulo(v['PACO2']) && !nulo(v['PAO2'])
        ? gradienteAa(fio2, v['PACO2']!, v['PAO2']!)
        : null;
    pontuar('GRADIENTE', grad, A);
  } else pontuar('PAO2', v['PAO2'], A);
  // pH arterial; sem gasometria, o bicarbonato.
  if (!nulo(v['PH'])) pontuar('PH', v['PH'], A);
  else pontuar('HCO3', v['HCO3'], A);
  pontuar('NASERICO', v['NASERICO'], A);
  pontuar('KSERICO', v['KSERICO'], A);
  // Creatinina em mg/dL; as faixas da configuração estão em décimos (6 a 14 = 0,6 a 1,4 mg/dL); a falha renal aguda
  // usa as faixas dobradas.
  pontuar(e.falhaRenalAguda ? 'CREATCOMFALHA' : 'CREATSEMFALHA', v['CREATININA'], A, 'Creatinina', 10);
  pontuar('HEMATOCRITO', v['HEMATOCRITO'], A);
  pontuar('LEUCOCITO', v['LEUCOCITO'], A);
  // Glasgow: 15 menos o total dos três itens.
  const gl = glasgowDoIndice(c, 'apache2');
  const escolhidos = [e.glasgow.ocular, e.glasgow.verbal, e.glasgow.motora];
  const itens = gl.map((g) => g.itens.find((i) => escolhidos.includes(i.id)) ?? null);
  if (gl.length !== 3 || itens.some((i) => i === null))
    return {
      ok: false,
      codigo: 'glasgow-invalido',
      mensagem: 'Escolha os três itens de Glasgow da configuração do APACHE II.',
    };
  const gcs = itens.reduce((s, i) => s + i!.pontuacao, 0);
  parcelas.push({
    variavel: null,
    sigla: 'GLASGOW',
    nome: `Glasgow ${gcs}`,
    valor: gcs,
    pontos: 15 - gcs,
    grupo: A,
  });
  // Idade.
  pontuar('IDADE', e.idade, 'Idade');
  // Doença crônica: só com a insuficiência orgânica grave ou imunossupressão prévias.
  const insuf = vs.get('INSUF');
  const codigoInsuf = e.tipoAdmissao === 'eletiva' ? 1 : e.tipoAdmissao === 'urgencia' ? 2 : 3;
  parcelas.push({
    variavel: insuf?.id ?? null,
    sigla: 'INSUF',
    nome: insuf?.nome ?? 'Doença crônica',
    valor: e.insuficienciaCronica ? codigoInsuf : 0,
    pontos: e.insuficienciaCronica && insuf ? pontosDaVariavel(insuf, codigoInsuf).pontos : 0,
    grupo: 'Doença crônica',
  });
  const cat = categoriasDoTipo(c, e.tipoAdmissao).find((x) => x.id === e.categoria);
  if (!cat)
    return {
      ok: false,
      codigo: 'categoria-de-outro-tipo',
      mensagem: 'A categoria diagnóstica não é do tipo de admissão escolhido.',
    };
  const pontuacao = parcelas.reduce((s, p) => s + p.pontos, 0);
  const logit = CONSTANTE + COEFICIENTE * pontuacao + cat.peso;
  const mortalidade = 1 / (1 + Math.exp(-logit));
  const equacao = `ln(R/(1−R)) = ${fmt(CONSTANTE)} + ${fmt(COEFICIENTE)} × ${pontuacao} + ${fmt(cat.peso)} (${cat.nome}) = ${fmt(logit)}; R = ${fmt(mortalidade * 100, 1)}%`;
  return { ok: true, indice: 'apache2', pontuacao, parcelas, mortalidade, equacao, avisos };
}
