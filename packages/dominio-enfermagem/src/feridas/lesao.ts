// W0-03, mercado M4: as regras das feridas e da lesão por pressão (LPP), sem banco (o servidor e a tela usam as mesmas):
//   - a ficha conferida (estágio NPUAP só na LPP e obrigatório nela; o estágio 1 e a lesão tissular profunda sem
//     profundidade; os tecidos do leito somando 100%; a identificação não pode ser do futuro nem antes da admissão;
//     "presente na admissão" só até 24 horas da admissão; a finalizada exige as medidas, salvo o estágio 1);
//   - a origem: admitida (presente na admissão) ou adquirida na internação;
//   - a versão: o rascunho é livre do autor; a ficha finalizada só o autor corrige, com a justificativa;
//   - a área (comprimento × largura) e a evolução pelos curativos;
//   - a sugestão de notificação ao Núcleo de Segurança do Paciente (LPP adquirida, finalizada, não inativada; grave
//     no estágio 3, 4, não classificável ou tissular profunda);
//   - a incidência do período com o numerador e o denominador impressos: LPP adquiridas por 1.000 pacientes-dia e o
//     percentual de pacientes com LPP adquirida sobre os pacientes internados no período.
// Base: RDC 36/2013 (segurança do paciente; notificação ao NSP); Protocolo para Prevenção de Úlcera por Pressão (MS,
// ANVISA e Fiocruz, 2013); classificação NPUAP 2016 (consenso SOBEST/SOBENDE 2016).
import {
  type DadosLesao,
  type EstagioLpp,
  ESTAGIOS_GRAVES_LPP,
  type IncidenciaLpp,
  type LeitoLesao,
  type MedidasLesao,
} from '@sgh/contratos';
import { diferencaMinutos } from '../tempo.js';

/** Janela em que a lesão vista conta como presente na admissão (24 horas). */
export const JANELA_ADMISSAO_LPP_MINUTOS = 24 * 60;

/** A lista vive no contrato (a qualidade usa a mesma na sugestão ao NSP). */
export { ESTAGIOS_GRAVES_LPP };

export type ProblemaLesao =
  | 'lpp-sem-estagio'
  | 'estagio-fora-da-lpp'
  | 'profundidade-sem-perda-de-pele'
  | 'tecidos-sem-somar-100'
  | 'identificada-no-futuro'
  | 'identificada-antes-da-admissao'
  | 'admissao-fora-da-janela'
  | 'finalizada-sem-medidas'
  | 'regiao-sem-descricao'
  | 'cobertura-sem-descricao';

const MENSAGENS: Readonly<Record<ProblemaLesao, string>> = {
  'lpp-sem-estagio': 'Na lesão por pressão, informe o estágio.',
  'estagio-fora-da-lpp': 'O estágio é só da lesão por pressão.',
  'profundidade-sem-perda-de-pele':
    'No estágio 1 e na lesão tissular profunda a pele está íntegra: não há profundidade.',
  'tecidos-sem-somar-100':
    'Os tecidos do leito (granulação, epitelização, esfacelo e necrose) devem somar 100%.',
  'identificada-no-futuro': 'A hora da identificação é do futuro.',
  'identificada-antes-da-admissao': 'A hora da identificação é anterior à admissão.',
  'admissao-fora-da-janela':
    'Presente na admissão só se identificada até 24 horas da admissão; depois, a lesão é adquirida na internação.',
  'finalizada-sem-medidas': 'Para finalizar, informe o comprimento e a largura.',
  'regiao-sem-descricao': 'Descreva a região.',
  'cobertura-sem-descricao': 'Descreva a cobertura.',
};

const problema = (codigo: ProblemaLesao) => ({ codigo, mensagem: MENSAGENS[codigo] });

const semPerdaDePele = (e: EstagioLpp | null): boolean => e === 'estagio1' || e === 'tissularProfunda';

/** Confere o leito (os tecidos somam 100%). */
export function conferirLeito(l: LeitoLesao): { codigo: ProblemaLesao; mensagem: string } | null {
  return l.granulacao + l.epitelizacao + l.esfacelo + l.necrose === 100
    ? null
    : problema('tecidos-sem-somar-100');
}

/** Confere a ficha da lesão; devolve o primeiro problema (código e mensagem) ou null. */
export function conferirLesao(
  d: DadosLesao,
  finalizar: boolean,
  agora: string,
  admissaoEm: string | null,
): { codigo: ProblemaLesao; mensagem: string } | null {
  if (d.tipo === 'lpp' && !d.estagio) return problema('lpp-sem-estagio');
  if (d.tipo !== 'lpp' && d.estagio) return problema('estagio-fora-da-lpp');
  if (d.regiao === 'outra' && !d.regiaoDescricao?.trim()) return problema('regiao-sem-descricao');
  if (d.cobertura === 'outra' && !d.coberturaDescricao?.trim()) return problema('cobertura-sem-descricao');
  if (d.identificadaEm > agora.slice(0, 16)) return problema('identificada-no-futuro');
  if (admissaoEm && d.identificadaEm < admissaoEm.slice(0, 16))
    return problema('identificada-antes-da-admissao');
  if (
    d.presenteNaAdmissao &&
    admissaoEm &&
    diferencaMinutos(admissaoEm.slice(0, 16), d.identificadaEm) > JANELA_ADMISSAO_LPP_MINUTOS
  )
    return problema('admissao-fora-da-janela');
  if (d.medidas?.profundidade && semPerdaDePele(d.estagio)) return problema('profundidade-sem-perda-de-pele');
  if (d.leito) {
    const p = conferirLeito(d.leito);
    if (p) return p;
  }
  if (finalizar && !d.medidas && d.estagio !== 'estagio1') return problema('finalizada-sem-medidas');
  return null;
}

/** Confere o curativo (o leito, a profundidade pelo estágio atual e a hora). */
export function conferirCurativo(
  c: {
    readonly realizadoEm: string;
    readonly estagio: EstagioLpp | null;
    readonly medidas: MedidasLesao | null;
    readonly leito: LeitoLesao;
    readonly cobertura: string;
    readonly coberturaDescricao?: string | undefined;
  },
  tipo: DadosLesao['tipo'],
  identificadaEm: string,
  agora: string,
): { codigo: ProblemaLesao | 'curativo-antes-da-lesao'; mensagem: string } | null {
  if (c.realizadoEm > agora.slice(0, 16)) return problema('identificada-no-futuro');
  if (c.realizadoEm < identificadaEm)
    return {
      codigo: 'curativo-antes-da-lesao',
      mensagem: 'O curativo não pode ser antes da identificação da lesão.',
    };
  if (tipo === 'lpp' && !c.estagio) return problema('lpp-sem-estagio');
  if (tipo !== 'lpp' && c.estagio) return problema('estagio-fora-da-lpp');
  if (c.cobertura === 'outra' && !c.coberturaDescricao?.trim()) return problema('cobertura-sem-descricao');
  if (c.medidas?.profundidade && semPerdaDePele(c.estagio)) return problema('profundidade-sem-perda-de-pele');
  return conferirLeito(c.leito);
}

/** Admitida (presente na admissão) ou adquirida na internação. */
export function origemDaLesao(d: Pick<DadosLesao, 'presenteNaAdmissao'>): 'admitida' | 'adquirida' {
  return d.presenteNaAdmissao ? 'admitida' : 'adquirida';
}

/** A área em cm² (comprimento × largura), com duas casas; null sem medidas. */
export function areaLesao(m: MedidasLesao | null): number | null {
  if (!m) return null;
  return Math.round(m.comprimento * m.largura * 100) / 100;
}

export type ProblemaVersaoLesao =
  'so-o-autor' | 'correcao-sem-motivo' | 'rascunho-com-motivo' | 'inativada' | 'encerrada';

/**
 * A versão seguinte da ficha. O rascunho é livre do autor (sem motivo); a finalizada só o autor corrige, com a
 * justificativa, e a correção já sai finalizada (não volta a rascunho). A inativada não recebe versão; a encerrada
 * também não (o acompanhamento acabou).
 */
export function conferirVersaoLesao(
  atual: {
    readonly autor: string;
    readonly situacao: 'rascunho' | 'finalizada';
    readonly inativada: boolean;
    readonly encerrada: boolean;
  },
  usuario: string,
  nova: { readonly finalizar: boolean; readonly motivo?: string | undefined },
): { codigo: ProblemaVersaoLesao; mensagem: string } | null {
  if (atual.inativada) return { codigo: 'inativada', mensagem: 'A ficha está inativada.' };
  if (atual.encerrada) return { codigo: 'encerrada', mensagem: 'O acompanhamento da lesão foi encerrado.' };
  if (atual.autor.trim().toUpperCase() !== usuario.trim().toUpperCase())
    return { codigo: 'so-o-autor', mensagem: 'Só quem registrou a ficha pode corrigi-la.' };
  if (atual.situacao === 'finalizada' && (!nova.motivo || !nova.finalizar))
    return {
      codigo: 'correcao-sem-motivo',
      mensagem: 'A ficha finalizada só se corrige por versão finalizada com a justificativa.',
    };
  if (atual.situacao === 'rascunho' && nova.motivo)
    return { codigo: 'rascunho-com-motivo', mensagem: 'O rascunho se altera sem justificativa.' };
  return null;
}

/** A evolução pela área dos curativos vigentes, na ordem da hora: a variação da primeira à última medida. */
export function evolucaoLesao(
  curativos: readonly {
    readonly realizadoEm: string;
    readonly areaCm2: number | null;
    readonly vigente: boolean;
  }[],
): {
  primeira: number;
  ultima: number;
  variacaoPercentual: number;
  tendencia: 'melhora' | 'estavel' | 'piora';
} | null {
  const m = curativos
    .filter((c) => c.vigente && c.areaCm2 !== null)
    .sort((a, b) => (a.realizadoEm < b.realizadoEm ? -1 : 1));
  if (m.length < 2 || m[0]!.areaCm2! === 0) return null;
  const primeira = m[0]!.areaCm2!;
  const ultima = m[m.length - 1]!.areaCm2!;
  const variacaoPercentual = Math.round(((ultima - primeira) / primeira) * 1000) / 10;
  // Variação menor que 10% conta como estável (a régua tem erro de leitura).
  const tendencia = variacaoPercentual <= -10 ? 'melhora' : variacaoPercentual >= 10 ? 'piora' : 'estavel';
  return { primeira, ultima, variacaoPercentual, tendencia };
}

export interface LesaoParaNotificacao {
  readonly tipo: DadosLesao['tipo'];
  readonly estagio: EstagioLpp | null;
  readonly presenteNaAdmissao: boolean;
  readonly situacao: 'rascunho' | 'finalizada';
  readonly inativada: boolean;
}

/** A sugestão de notificação ao NSP: a LPP adquirida, finalizada e não inativada; grave nos estágios avançados. */
export function sugestaoNotificacaoLpp(l: LesaoParaNotificacao): { sugerir: boolean; grave: boolean } {
  const sugerir = l.tipo === 'lpp' && !l.presenteNaAdmissao && l.situacao === 'finalizada' && !l.inativada;
  return { sugerir, grave: sugerir && l.estagio !== null && ESTAGIOS_GRAVES_LPP.includes(l.estagio) };
}

export interface LesaoParaIncidencia extends LesaoParaNotificacao {
  readonly paciente: number;
  readonly identificadaEm: string;
}

/**
 * A incidência do período [de, ate] (datas AAAA-MM-DD, inclusive): as LPP adquiridas (finalizadas, não inativadas,
 * identificadas no período) sobre os pacientes-dia × 1.000, e os pacientes com LPP adquirida sobre os pacientes
 * internados no período × 100. A admitida não conta (já veio com o paciente).
 */
export function incidenciaLpp(
  lesoes: readonly LesaoParaIncidencia[],
  pacientesDia: number,
  pacientesInternados: number,
  de: string,
  ate: string,
): IncidenciaLpp {
  const casos = lesoes.filter(
    (l) =>
      sugestaoNotificacaoLpp(l).sugerir &&
      l.identificadaEm.slice(0, 10) >= de &&
      l.identificadaEm.slice(0, 10) <= ate,
  );
  const pacientes = new Set(casos.map((l) => l.paciente)).size;
  const porEstagio: Partial<Record<EstagioLpp, number>> = {};
  for (const c of casos) if (c.estagio) porEstagio[c.estagio] = (porEstagio[c.estagio] ?? 0) + 1;
  const por1000 = pacientesDia > 0 ? Math.round((casos.length / pacientesDia) * 1000 * 100) / 100 : null;
  const percentual =
    pacientesInternados > 0 ? Math.round((pacientes / pacientesInternados) * 1000) / 10 : null;
  const fmt = (n: number | null) => (n === null ? 'sem denominador' : n.toLocaleString('pt-BR'));
  return {
    de,
    ate,
    densidade: { numerador: casos.length, denominador: pacientesDia, por1000 },
    pacientes: { numerador: pacientes, denominador: pacientesInternados, percentual },
    porEstagio,
    impressao:
      `LPP adquiridas: ${casos.length} / ${pacientesDia} pacientes-dia × 1.000 = ${fmt(por1000)}; ` +
      `pacientes com LPP adquirida: ${pacientes} / ${pacientesInternados} internados × 100 = ${fmt(percentual)}%`,
  };
}
