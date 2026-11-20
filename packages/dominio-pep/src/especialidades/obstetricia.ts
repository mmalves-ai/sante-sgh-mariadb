// Obstetrícia e neonatologia (M45, etapa 6; ficha, seção 7 "Especialidades"; DP-32): o partograma e o registro do
// recém-nascido. Regras puras (a API aplica):
//   - partograma (OMS; Diretrizes Nacionais de Assistência ao Parto Normal, Ministério da Saúde, 2017): a fase ativa
//     começa no primeiro registro com a dilatação do parâmetro (4 cm); a linha de alerta sobe 1 cm por hora a partir
//     dele e a linha de ação fica 4 horas à direita; a dilatação à direita da alerta e além da ação alertam;
//   - alertas do registro: batimentos cardíacos fetais fora de 110 a 160 bpm (FIGO), mais de 5 contrações em 10 minutos
//     (taquissistolia), líquido meconial, pressão de 140/90 mmHg ou mais e temperatura de 38 °C ou mais;
//   - recém-nascido: a idade gestacional, o peso ao nascer e o Apgar do 5º minuto classificados (OMS; Academia Americana
//     de Pediatria); Apgar do 10º minuto obrigatório quando o do 5º é menor que 7; a mãe é a paciente da internação.
// Os registros são só de inclusão (corrigir é registrar de novo, com a observação).
import type {
  LinhasPartograma,
  RegistrarPartogramaEntrada,
  RegistrarRecemNascidoEntrada,
} from '@sgh/contratos';
import { arredondar, minutosEntreCivis, recusar } from './comum.js';

/** Tolerância do relógio para o registro "agora" (minutos à frente do relógio do estabelecimento). */
const TOLERANCIA_FUTURO_MIN = 5;

function conferirInstante(em: string, admissao: string, agora: string, oQue: string): void {
  if (minutosEntreCivis(agora, em) > TOLERANCIA_FUTURO_MIN)
    recusar('instante-futuro', `${oQue} não pode ser no futuro.`);
  if (minutosEntreCivis(admissao, em) < 0) recusar('antes-da-admissao', `${oQue} é anterior à admissão.`);
}

const MEDIDAS: readonly (keyof RegistrarPartogramaEntrada)[] = [
  'dilatacaoCm',
  'alturaApresentacao',
  'bcf',
  'contracoes10min',
  'duracaoContracaoS',
  'bolsa',
  'liquido',
  'paSistolica',
  'paDiastolica',
  'temperatura',
  'ocitocina',
];

/** Os alertas clínicos do próprio registro (sem as linhas). */
export function alertasDoRegistro(e: RegistrarPartogramaEntrada): string[] {
  const a: string[] = [];
  if (e.bcf !== null && e.bcf < 110)
    a.push(`Batimentos cardíacos fetais de ${e.bcf} bpm: bradicardia fetal.`);
  if (e.bcf !== null && e.bcf > 160)
    a.push(`Batimentos cardíacos fetais de ${e.bcf} bpm: taquicardia fetal.`);
  if (e.contracoes10min !== null && e.contracoes10min > 5)
    a.push(`${e.contracoes10min} contrações em 10 minutos: taquissistolia.`);
  if (e.liquido === 'meconial') a.push('Líquido amniótico meconial.');
  if ((e.paSistolica ?? 0) >= 140 || (e.paDiastolica ?? 0) >= 90)
    a.push(`Pressão arterial de ${e.paSistolica ?? '?'}/${e.paDiastolica ?? '?'} mmHg: 140/90 ou mais.`);
  if (e.temperatura !== null && e.temperatura >= 38) a.push(`Temperatura de ${e.temperatura} °C: febre.`);
  return a;
}

export interface PontoDilatacao {
  readonly em: string;
  readonly dilatacaoCm: number | null;
}

/** As linhas de alerta e de ação a partir do início da fase ativa (o primeiro registro com a dilatação do parâmetro). */
export function linhasDoPartograma(pontos: readonly PontoDilatacao[], faseAtivaCm: number): LinhasPartograma {
  const ordenados = [...pontos].sort((a, b) => a.em.localeCompare(b.em));
  const inicio = ordenados.find((p) => p.dilatacaoCm !== null && p.dilatacaoCm >= faseAtivaCm) ?? null;
  if (!inicio || inicio.dilatacaoCm === null) return { inicioFaseAtiva: null, alerta: [], acao: [] };
  const d0 = inicio.dilatacaoCm;
  const horasAte10 = 10 - d0;
  return {
    inicioFaseAtiva: { em: inicio.em, dilatacaoCm: d0 },
    alerta: [
      { horas: 0, dilatacaoCm: d0 },
      { horas: horasAte10, dilatacaoCm: 10 },
    ],
    acao: [
      { horas: 4, dilatacaoCm: d0 },
      { horas: 4 + horasAte10, dilatacaoCm: 10 },
    ],
  };
}

/** A posição da dilatação em relação às linhas (alerta: à direita da linha de alerta; acao: além da linha de ação). */
export function posicaoNasLinhas(
  linhas: LinhasPartograma,
  em: string,
  dilatacaoCm: number,
): 'antes-da-fase-ativa' | 'esquerda-da-alerta' | 'alerta' | 'acao' {
  const i = linhas.inicioFaseAtiva;
  if (!i) return 'antes-da-fase-ativa';
  const horas = minutosEntreCivis(i.em, em) / 60;
  if (horas < 0) return 'antes-da-fase-ativa';
  const esperadaAlerta = Math.min(10, i.dilatacaoCm + horas);
  const esperadaAcao = Math.min(10, i.dilatacaoCm + Math.max(0, horas - 4));
  if (horas >= 4 && dilatacaoCm < esperadaAcao) return 'acao';
  if (dilatacaoCm < esperadaAlerta) return 'alerta';
  return 'esquerda-da-alerta';
}

/** Confere o registro do partograma e devolve os alertas (do registro e das linhas). */
export function conferirPartograma(
  e: RegistrarPartogramaEntrada,
  c: {
    readonly admissao: string;
    readonly agora: string;
    readonly anteriores: readonly (PontoDilatacao & { readonly bolsa: string | null })[];
    readonly faseAtivaCm: number;
  },
): { alertas: string[] } {
  if (!MEDIDAS.some((k) => e[k] !== null && e[k] !== undefined) && !e.observacao)
    recusar('registro-vazio', 'Registre ao menos uma medida do partograma.');
  conferirInstante(e.em, c.admissao, c.agora, 'O registro do partograma');
  if (e.paSistolica !== null && e.paDiastolica !== null && e.paSistolica <= e.paDiastolica)
    recusar('pressao-invertida', 'A pressão sistólica precisa ser maior que a diastólica.');
  const rotaAntes = c.anteriores.some((p) => p.bolsa === 'rota' && p.em <= e.em);
  if (e.liquido !== null && e.bolsa !== 'rota' && !rotaAntes)
    recusar('liquido-sem-bolsa-rota', 'O aspecto do líquido amniótico só com a bolsa rota.');
  const alertas = alertasDoRegistro(e);
  if (e.dilatacaoCm !== null) {
    const linhas = linhasDoPartograma(
      [...c.anteriores, { em: e.em, dilatacaoCm: e.dilatacaoCm }],
      c.faseAtivaCm,
    );
    const pos = posicaoNasLinhas(linhas, e.em, e.dilatacaoCm);
    if (pos === 'alerta')
      alertas.push('Dilatação à direita da linha de alerta: reavaliar a evolução do trabalho de parto.');
    if (pos === 'acao') alertas.push('Dilatação além da linha de ação: conduta médica imediata.');
  }
  return { alertas };
}

// ── Recém-nascido ────────────────────────────────────────────────────────────────────────────────

export function classificarIdadeGestacional(semanas: number, dias: number): string {
  const ig = semanas + dias / 7;
  if (ig < 28) return 'Pré-termo extremo (menos de 28 semanas)';
  if (ig < 32) return 'Muito pré-termo (28 a 31 semanas)';
  if (ig < 37) return 'Pré-termo moderado a tardio (32 a 36 semanas)';
  if (ig < 42) return 'A termo (37 a 41 semanas)';
  return 'Pós-termo (42 semanas ou mais)';
}

export function classificarPesoAoNascer(pesoG: number): string {
  if (pesoG < 1000) return 'Extremo baixo peso (menos de 1.000 g)';
  if (pesoG < 1500) return 'Muito baixo peso (menos de 1.500 g)';
  if (pesoG < 2500) return 'Baixo peso (menos de 2.500 g)';
  if (pesoG >= 4000) return 'Macrossomia (4.000 g ou mais)';
  return 'Peso adequado (2.500 a 3.999 g)';
}

export function classificarApgar(apgar5: number): string {
  if (apgar5 >= 7) return 'Apgar do 5º minuto normal (7 a 10)';
  if (apgar5 >= 4) return 'Apgar do 5º minuto moderadamente anormal (4 a 6)';
  return 'Apgar do 5º minuto baixo (0 a 3)';
}

/** Confere o registro do recém-nascido e devolve as classificações e os alertas. */
export function conferirRecemNascido(
  e: RegistrarRecemNascidoEntrada,
  c: {
    readonly sexoMae: 'M' | 'F' | 'I';
    readonly tiposParto: ReadonlySet<number>;
    readonly admissao: string;
    readonly agora: string;
  },
): { classificacaoIg: string; classificacaoPeso: string; classificacaoApgar: string; alertas: string[] } {
  if (c.sexoMae === 'M')
    recusar(
      'mae-nao-feminina',
      'O recém-nascido é registrado na internação da mãe (a paciente é do sexo masculino).',
    );
  if (!c.tiposParto.has(e.tipoParto))
    recusar('valor-desconhecido', `Tipo de parto ${e.tipoParto} não existe no cadastro de tipos de parto.`);
  if (e.apgar5 < 7 && e.apgar10 === null)
    recusar('apgar10-ausente', 'Com o Apgar do 5º minuto menor que 7, registre o Apgar do 10º minuto.');
  conferirInstante(e.nascimentoEm, c.admissao, c.agora, 'O nascimento');
  const alertas: string[] = [];
  if (e.apgar5 < 7)
    alertas.push(`Apgar ${e.apgar1}/${e.apgar5}/${e.apgar10 ?? '-'}: acompanhamento neonatal.`);
  if (e.pesoG < 2500 || e.igSemanas < 37) alertas.push('Recém-nascido de risco (pré-termo ou baixo peso).');
  if (e.reanimacao) alertas.push('Recém-nascido reanimado na sala de parto.');
  return {
    classificacaoIg: classificarIdadeGestacional(e.igSemanas, e.igDias),
    classificacaoPeso: classificarPesoAoNascer(e.pesoG),
    classificacaoApgar: classificarApgar(e.apgar5),
    alertas,
  };
}

/** A idade gestacional em semanas com uma casa (apoio da tela). */
export const igDecimal = (semanas: number, dias: number) => arredondar(semanas + dias / 7, 1);
