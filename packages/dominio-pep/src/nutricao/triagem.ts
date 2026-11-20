// Triagem nutricional (M45, etapa 5; ficha, regras 3 e 10; cap-05b §5.9; cap-06a §6.3): o NRS-2002 (Kondrup et al.,
// ESPEN 2003) e o NUTRIC modificado sem a interleucina 6 (Rahman et al., 2016) para a terapia intensiva, com o total
// SEMPRE calculado aqui (a tela manda as respostas; a idade vem do cadastro), a versão da regra gravada junto, o prazo de
// 48 h da admissão (de preferência 24 h) e a situação de cada internado na fila "pacientes a triar". Puro: sem banco.
import {
  type InstrumentoTriagem,
  type RespostasNrs2002,
  type RespostasNutric,
  type RespostasTriagem,
  type RiscoTriagem,
  type SituacaoTriagemNutricional,
  versaoDoInstrumento,
} from '@sgh/contratos';

export type CodigoRecusaTriagem = 'triagem-final-pendente' | 'idade-desconhecida' | 'admissao-invalida';

export class ErroTriagem extends Error {
  override readonly name = 'ErroTriagem';
  readonly codigo: CodigoRecusaTriagem;
  constructor(codigo: CodigoRecusaTriagem, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Idade em anos completos no dia (AAAA-MM-DD); null sem nascimento válido (a sentinela 1899-12-30 não vale). */
export function idadeNoDia(nascimento: string | null, dia: string): number | null {
  const n = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento ?? '');
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  if (!n || !d || (nascimento ?? '').startsWith('1899-12-30')) return null;
  let anos = Number(d[1]) - Number(n[1]);
  if (Number(d[2]) < Number(n[2]) || (d[2] === n[2] && Number(d[3]) < Number(n[3]))) anos -= 1;
  return anos >= 0 && anos < 150 ? anos : null;
}

/** IMC com uma casa (peso em kg, altura em cm); null sem os dois. */
export function imc(pesoKg: number | null, alturaCm: number | null): number | null {
  if (!pesoKg || !alturaCm || pesoKg <= 0 || alturaCm <= 0) return null;
  const m = alturaCm / 100;
  return Math.round((pesoKg / (m * m)) * 10) / 10;
}

export interface ResultadoTriagemCalculada {
  readonly instrumento: InstrumentoTriagem;
  readonly versao: string;
  readonly total: number;
  readonly parcelas: {
    readonly estado: number | null;
    readonly gravidade: number | null;
    readonly idade: number | null;
  };
  readonly risco: RiscoTriagem;
  /** NRS-2002: alguma resposta da triagem inicial foi "sim" (a final foi feita). */
  readonly triagemFinal: boolean;
}

/**
 * NRS-2002: a triagem inicial (IMC < 20,5; perda de peso em 3 meses; ingestão reduzida na última semana; gravemente
 * doente). Nenhum "sim": sem risco, reavaliar semanalmente. Algum "sim": a triagem final soma o estado nutricional (0 a
 * 3), a gravidade da doença (0 a 3) e 1 ponto para 70 anos ou mais; total ≥ 3 é risco nutricional.
 */
export function calcularNrs2002(r: RespostasNrs2002, idade: number | null): ResultadoTriagemCalculada {
  const inicial = r.imcAbaixoDe20e5 || r.perdaDePeso3Meses || r.ingestaoReduzidaSemana || r.gravementeDoente;
  const versao = versaoDoInstrumento('nrs2002');
  if (!inicial)
    return {
      instrumento: 'nrs2002',
      versao,
      total: 0,
      parcelas: { estado: null, gravidade: null, idade: null },
      risco: 'sem-risco',
      triagemFinal: false,
    };
  if (r.estadoNutricional === null || r.gravidade === null)
    throw new ErroTriagem(
      'triagem-final-pendente',
      'Alguma resposta da triagem inicial foi "sim": responda o estado nutricional e a gravidade da doença.',
    );
  if (idade === null)
    throw new ErroTriagem(
      'idade-desconhecida',
      'O cadastro do paciente não tem a data de nascimento: a idade entra no NRS-2002 (70 anos ou mais).',
    );
  const pontosIdade = idade >= 70 ? 1 : 0;
  const total = r.estadoNutricional + r.gravidade + pontosIdade;
  return {
    instrumento: 'nrs2002',
    versao,
    total,
    parcelas: { estado: r.estadoNutricional, gravidade: r.gravidade, idade: pontosIdade },
    risco: total >= 3 ? 'risco' : 'sem-risco',
    triagemFinal: true,
  };
}

/** Pontos de uma variável pelas faixas [limite inferior, pontos] em ordem crescente. */
function faixa(valor: number, faixas: readonly (readonly [number, number])[]): number {
  let p = 0;
  for (const [de, pontos] of faixas) if (valor >= de) p = pontos;
  return p;
}

/**
 * NUTRIC modificado (sem IL-6): idade (< 50: 0; 50 a 74: 1; ≥ 75: 2), APACHE II (< 15: 0; 15 a 19: 1; 20 a 27: 2;
 * ≥ 28: 3), SOFA (< 6: 0; 6 a 9: 1; ≥ 10: 2), comorbidades (0 a 1: 0; ≥ 2: 1) e dias internado antes da UTI (0: 0;
 * ≥ 1: 1). Total de 0 a 9; ≥ 5 é alto risco nutricional.
 */
export function calcularNutric(r: RespostasNutric, idade: number | null): ResultadoTriagemCalculada {
  if (idade === null)
    throw new ErroTriagem(
      'idade-desconhecida',
      'O cadastro do paciente não tem a data de nascimento: a idade entra no NUTRIC.',
    );
  const pIdade = faixa(idade, [
    [50, 1],
    [75, 2],
  ]);
  const pApache = faixa(r.apache2, [
    [15, 1],
    [20, 2],
    [28, 3],
  ]);
  const pSofa = faixa(r.sofa, [
    [6, 1],
    [10, 2],
  ]);
  const pComorb = r.comorbidades >= 2 ? 1 : 0;
  const pDias = r.diasInternadoAntesUti >= 1 ? 1 : 0;
  const total = pIdade + pApache + pSofa + pComorb + pDias;
  return {
    instrumento: 'nutric',
    versao: versaoDoInstrumento('nutric'),
    total,
    // Estado = APACHE II + SOFA (a gravidade fisiológica); gravidade = comorbidades + dias antes da UTI; idade à parte.
    parcelas: { estado: pApache + pSofa, gravidade: pComorb + pDias, idade: pIdade },
    risco: total >= 5 ? 'alto' : 'sem-risco',
    triagemFinal: true,
  };
}

export function calcularTriagem(r: RespostasTriagem, idade: number | null): ResultadoTriagemCalculada {
  return r.instrumento === 'nrs2002' ? calcularNrs2002(r, idade) : calcularNutric(r, idade);
}

/** As respostas em texto compacto para a coluna da triagem (só códigos e números; nunca texto livre). */
export function respostasCompactas(r: RespostasTriagem): string {
  return JSON.stringify(r);
}

// ── Prazo e situação na fila ──────────────────────────────────────────────────────────────────────

/** Minutos entre dois instantes locais ("AAAA-MM-DDTHH:MM[:SS]"); negativo quando b é antes de a. */
export function minutosEntre(a: string, b: string): number {
  const t = (s: string) =>
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) ? Date.parse(`${s.slice(0, 16).replace(' ', 'T')}:00Z`) : NaN;
  const x = t(a);
  const y = t(b);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new ErroTriagem('admissao-invalida', 'Instante inválido.');
  return Math.round((y - x) / 60_000);
}

export function somarHoras(instante: string, horas: number): string {
  const t = Date.parse(`${instante.slice(0, 16).replace(' ', 'T')}:00Z`);
  return new Date(t + horas * 3_600_000).toISOString().slice(0, 16);
}

export function somarDias(dia: string, dias: number): string {
  const t = Date.parse(`${dia.slice(0, 10)}T00:00:00Z`);
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}

export interface PrazosTriagem {
  readonly prazoHoras: number;
  readonly preferencialHoras: number;
  readonly reavaliacaoDias: number;
}

export const PRAZOS_TRIAGEM_PADRAO: PrazosTriagem = {
  prazoHoras: 48,
  preferencialHoras: 24,
  reavaliacaoDias: 7,
};

/** Horas inteiras desde a admissão (nunca negativas: admissão no futuro conta 0). */
export function horasDesdeAdmissao(admissao: string, agora: string): number {
  return Math.max(0, Math.floor(minutosEntre(admissao, agora) / 60));
}

/** A data da reavaliação: a triagem sem risco reavalia em N dias; com risco, o acompanhamento é da nutricionista. */
export function reavaliarEm(risco: RiscoTriagem, dia: string, p: PrazosTriagem): string | null {
  return risco === 'sem-risco' ? somarDias(dia, p.reavaliacaoDias) : null;
}

/**
 * A situação do internado na fila (regra 10): sem triagem, pelo tempo desde a admissão (até a preferência: a triar; até
 * o prazo: atenção; depois: vencida, em vermelho); triado sem risco com a reavaliação vencida: reavaliar; senão, triado.
 */
export function situacaoTriagem(x: {
  readonly admissao: string;
  readonly agora: string;
  readonly ultima: { readonly risco: RiscoTriagem; readonly reavaliarEm: string | null } | null;
  readonly prazos: PrazosTriagem;
}): SituacaoTriagemNutricional {
  if (x.ultima) {
    if (x.ultima.reavaliarEm !== null && x.ultima.reavaliarEm <= x.agora.slice(0, 10)) return 'reavaliar';
    return 'triado';
  }
  const h = minutosEntre(x.admissao, x.agora) / 60;
  if (h <= x.prazos.preferencialHoras) return 'a-triar';
  if (h <= x.prazos.prazoHoras) return 'atencao';
  return 'vencida';
}

const ORDEM_SITUACAO: Readonly<Record<SituacaoTriagemNutricional, number>> = {
  vencida: 0,
  atencao: 1,
  'a-triar': 2,
  reavaliar: 3,
  triado: 4,
};

/** A ordem da fila: vencidas primeiro, depois atenção, a triar, reavaliar e triados; na mesma situação, a admissão mais antiga. */
export function ordenarFilaTriagem<
  T extends { readonly situacao: SituacaoTriagemNutricional; readonly admissao: string },
>(itens: readonly T[]): T[] {
  return [...itens].sort(
    (a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.admissao.localeCompare(b.admissao),
  );
}

/**
 * Indicadores da triagem (cap-05b §5.9, "percentual de pacientes triados em 24 h e em 48 h"): dos admitidos, quantos
 * tiveram a primeira triagem até a preferência e até o prazo. As parcelas vão impressas na tela.
 */
export function indicadoresTriagem(
  admitidos: readonly { readonly admissao: string; readonly primeiraTriagemEm: string | null }[],
  p: PrazosTriagem,
): { admitidos: number; triados24h: number; triados48h: number } {
  let t24 = 0;
  let t48 = 0;
  for (const a of admitidos) {
    if (!a.primeiraTriagemEm) continue;
    const h = minutosEntre(a.admissao, a.primeiraTriagemEm) / 60;
    if (h <= p.preferencialHoras) t24 += 1;
    if (h <= p.prazoHoras) t48 += 1;
  }
  return { admitidos: admitidos.length, triados24h: t24, triados48h: t48 };
}
