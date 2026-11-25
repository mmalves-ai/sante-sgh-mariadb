// Reuso do dialisador na hemodiálise (03-PEP linha 146). O dialisador é identificado e exclusivo do paciente; antes de
// cada reuso ele é reprocessado e testado. Regras puras (a API grava, a tela confere na hora com as mesmas funções),
// pelo regulamento sanitário dos serviços de diálise (RDC ANVISA 11/2014):
//   - teto de reusos pelo método: até 12 no reprocessamento manual e até 20 no automatizado; o dialisador de uso único
//     (sorologia que o impede, por exemplo) nunca é reprocessado;
//   - o volume interno das fibras é medido na abertura (base) e em cada reprocessamento: abaixo de 80% do inicial o
//     dialisador é descartado na hora;
//   - o teste do desinfetante: presente antes do enxágue (prova que a desinfecção aconteceu) e ausente depois (prova
//     que o enxágue tirou o resíduo); qualquer um fora reprova o reprocessamento, que se refaz;
//   - um dialisador em uso por paciente; nada é apagado: o reprocessamento lançado por engano é cancelado com motivo
//     (só o último, com o dialisador em uso), o dialisador sai por descarte ou, aberto por engano, por desativação.
// Melhorias: o resultado (aprovado, reprovado ou descartado) sai das medidas, sem escolha manual, e a tela mostra o
// percentual do volume e o aviso do último reuso antes de gravar.

export const METODOS_LIMPEZA_DIALISADOR = ['automatizado', 'manual', 'uso_unico'] as const;
export type MetodoLimpezaDialisador = (typeof METODOS_LIMPEZA_DIALISADOR)[number];
export const METODOS_REPROCESSAMENTO = ['automatizado', 'manual'] as const;
export type MetodoReprocessamento = (typeof METODOS_REPROCESSAMENTO)[number];
export const RESULTADOS_TESTE_DESINFETANTE = ['positivo', 'negativo'] as const;
export type ResultadoTesteDesinfetante = (typeof RESULTADOS_TESTE_DESINFETANTE)[number];
export type SituacaoDialisador = 'em_uso' | 'descartado' | 'desativado';
export type SituacaoReusoDialisador = 'valido' | 'cancelado';

/** Teto de reusos de cada método (RDC ANVISA 11/2014). */
export const TETO_REUSOS_DIALISADOR: Readonly<Record<MetodoLimpezaDialisador, number>> = {
  automatizado: 20,
  manual: 12,
  uso_unico: 0,
};
/** Fração mínima do volume interno inicial para o dialisador seguir em uso. */
export const FRACAO_MINIMA_VOLUME_DIALISADOR = 0.8;
export const VOLUME_MAXIMO_DIALISADOR_ML = 1000;

export interface ErroCampoDialisador {
  readonly campo: string;
  readonly mensagem: string;
}

/** O limite proposto na abertura: o teto do método. */
export function limitePadraoReusos(metodo: MetodoLimpezaDialisador): number {
  return TETO_REUSOS_DIALISADOR[metodo];
}

export interface AberturaDialisador {
  readonly identificacao: string;
  readonly metodo: MetodoLimpezaDialisador;
  /** Limite pedido; nulo assume o teto do método. */
  readonly limiteReusos: number | null;
  readonly volumeInicialMl: number | null;
}

export function conferirAberturaDialisador(
  a: AberturaDialisador,
  emUsoDoPaciente: number,
): ErroCampoDialisador[] {
  const erros: ErroCampoDialisador[] = [];
  const id = a.identificacao.trim();
  if (!id || id.length > 30)
    erros.push({ campo: 'identificacao', mensagem: 'A etiqueta do dialisador tem de 1 a 30 caracteres.' });
  const teto = TETO_REUSOS_DIALISADOR[a.metodo];
  const limite = a.limiteReusos ?? teto;
  if (a.metodo === 'uso_unico') {
    if (limite !== 0)
      erros.push({ campo: 'limiteReusos', mensagem: 'O dialisador de uso único não é reprocessado.' });
  } else {
    if (!Number.isInteger(limite) || limite < 1 || limite > teto)
      erros.push({
        campo: 'limiteReusos',
        mensagem: `O limite de reusos do método ${a.metodo === 'manual' ? 'manual' : 'automatizado'} vai de 1 a ${teto}.`,
      });
    if (a.volumeInicialMl === null)
      erros.push({
        campo: 'volumeInicialMl',
        mensagem: 'Meça o volume interno inicial: é a base do teste de cada reprocessamento.',
      });
  }
  if (
    a.volumeInicialMl !== null &&
    (!Number.isFinite(a.volumeInicialMl) ||
      a.volumeInicialMl <= 0 ||
      a.volumeInicialMl > VOLUME_MAXIMO_DIALISADOR_ML)
  )
    erros.push({
      campo: 'volumeInicialMl',
      mensagem: `O volume interno inicial vai de 1 a ${VOLUME_MAXIMO_DIALISADOR_ML} ml.`,
    });
  if (emUsoDoPaciente > 0)
    erros.push({
      campo: 'paciente',
      mensagem: 'O paciente já tem um dialisador em uso: descarte-o antes de abrir outro.',
    });
  return erros;
}

export interface DialisadorParaReuso {
  readonly situacao: SituacaoDialisador;
  readonly metodo: MetodoLimpezaDialisador;
  readonly limiteReusos: number;
  readonly reusosRealizados: number;
  readonly volumeInicialMl: number | null;
}

export interface Reprocessamento {
  readonly metodo: MetodoReprocessamento;
  readonly volumeAtualMl: number | null;
  readonly testePreEnxague: ResultadoTesteDesinfetante | null;
  readonly testePosEnxague: ResultadoTesteDesinfetante | null;
}

export interface AvaliacaoReprocessamento {
  /** Recusas: nada se grava. */
  readonly erros: ErroCampoDialisador[];
  /** Volume atual sobre o inicial (0 a 1+), ou nulo sem as medidas. */
  readonly fracaoVolume: number | null;
  readonly aprovado: boolean;
  /** Os motivos de não liberar para o próximo uso. */
  readonly reprovacoes: string[];
  /** Volume abaixo do mínimo: o dialisador sai de uso agora. */
  readonly descartar: boolean;
  readonly motivoDescarte: string | null;
  /** Aprovado no último reuso permitido: descartar depois deste uso. */
  readonly ultimoReuso: boolean;
  /** Reusos realizados depois de gravar. */
  readonly reusosDepois: number;
}

/** O teto que vale para o reprocessamento: o limite do dialisador, nunca acima do teto do método usado agora. */
export function tetoDoReprocessamento(d: DialisadorParaReuso, metodo: MetodoReprocessamento): number {
  return Math.min(d.limiteReusos, TETO_REUSOS_DIALISADOR[metodo]);
}

export function avaliarReprocessamento(d: DialisadorParaReuso, r: Reprocessamento): AvaliacaoReprocessamento {
  const erros: ErroCampoDialisador[] = [];
  if (d.situacao !== 'em_uso')
    erros.push({
      campo: 'dialisador',
      mensagem: 'O dialisador não está em uso: já foi descartado ou desativado.',
    });
  if (d.metodo === 'uso_unico')
    erros.push({ campo: 'dialisador', mensagem: 'O dialisador de uso único não é reprocessado.' });
  const teto = tetoDoReprocessamento(d, r.metodo);
  if (d.metodo !== 'uso_unico' && d.reusosRealizados >= teto)
    erros.push({
      campo: 'dialisador',
      mensagem: `O dialisador já fez ${d.reusosRealizados} reuso(s), o limite do ${r.metodo === 'manual' ? 'reprocessamento manual' : 'dialisador'}: descarte-o.`,
    });
  if (d.volumeInicialMl === null || d.volumeInicialMl <= 0)
    erros.push({ campo: 'dialisador', mensagem: 'O dialisador não tem o volume interno inicial medido.' });
  if (
    r.volumeAtualMl === null ||
    !Number.isFinite(r.volumeAtualMl) ||
    r.volumeAtualMl <= 0 ||
    r.volumeAtualMl > VOLUME_MAXIMO_DIALISADOR_ML
  )
    erros.push({
      campo: 'volumeAtualMl',
      mensagem: `Meça o volume interno atual (1 a ${VOLUME_MAXIMO_DIALISADOR_ML} ml).`,
    });
  if (r.testePreEnxague === null)
    erros.push({ campo: 'testePreEnxague', mensagem: 'Registre o teste do desinfetante antes do enxágue.' });
  if (r.testePosEnxague === null)
    erros.push({ campo: 'testePosEnxague', mensagem: 'Registre o teste do desinfetante depois do enxágue.' });
  const fracaoVolume =
    d.volumeInicialMl && d.volumeInicialMl > 0 && r.volumeAtualMl && r.volumeAtualMl > 0
      ? Math.round((r.volumeAtualMl / d.volumeInicialMl) * 1000) / 1000
      : null;
  const reprovacoes: string[] = [];
  const descartar = fracaoVolume !== null && fracaoVolume < FRACAO_MINIMA_VOLUME_DIALISADOR;
  const motivoDescarte = descartar
    ? `Volume interno em ${Math.round((fracaoVolume ?? 0) * 100)}% do inicial, abaixo do mínimo de 80%.`
    : null;
  if (motivoDescarte) reprovacoes.push(motivoDescarte);
  if (r.testePreEnxague === 'negativo')
    reprovacoes.push(
      'Desinfetante ausente antes do enxágue: a desinfecção não se confirmou, reprocesse de novo.',
    );
  if (r.testePosEnxague === 'positivo')
    reprovacoes.push('Resíduo do desinfetante depois do enxágue: enxágue de novo antes de liberar.');
  const aprovado = erros.length === 0 && reprovacoes.length === 0;
  const reusosDepois = d.reusosRealizados + (aprovado ? 1 : 0);
  return {
    erros,
    fracaoVolume,
    aprovado,
    reprovacoes,
    descartar: erros.length === 0 && descartar,
    motivoDescarte: erros.length === 0 ? motivoDescarte : null,
    ultimoReuso: aprovado && reusosDepois >= teto,
    reusosDepois,
  };
}

export function conferirDescarteDialisador(
  situacao: SituacaoDialisador,
  motivo: string,
): ErroCampoDialisador[] {
  const erros: ErroCampoDialisador[] = [];
  if (situacao !== 'em_uso')
    erros.push({ campo: 'dialisador', mensagem: 'Só o dialisador em uso é descartado.' });
  if (motivo.trim().length < 5)
    erros.push({ campo: 'motivo', mensagem: 'Informe o motivo do descarte (ao menos 5 caracteres).' });
  return erros;
}

/** A desativação é do dialisador aberto por engano: em uso e sem reprocessamento válido. */
export function conferirDesativacaoDialisador(
  situacao: SituacaoDialisador,
  reprocessamentosValidos: number,
  motivo: string,
): ErroCampoDialisador[] {
  const erros: ErroCampoDialisador[] = [];
  if (situacao !== 'em_uso')
    erros.push({ campo: 'dialisador', mensagem: 'Só o dialisador em uso é desativado.' });
  if (reprocessamentosValidos > 0)
    erros.push({
      campo: 'dialisador',
      mensagem: 'O dialisador já foi reprocessado: ele sai de uso pelo descarte, não pela desativação.',
    });
  if (motivo.trim().length < 5)
    erros.push({ campo: 'motivo', mensagem: 'Informe o motivo da desativação (ao menos 5 caracteres).' });
  return erros;
}

/** Cancela o reprocessamento lançado por engano: só o último válido, com o dialisador ainda em uso. */
export function conferirCancelamentoReuso(x: {
  readonly situacao: SituacaoReusoDialisador;
  readonly ehUltimoValido: boolean;
  readonly situacaoDialisador: SituacaoDialisador;
  readonly motivo: string;
}): ErroCampoDialisador[] {
  const erros: ErroCampoDialisador[] = [];
  if (x.situacao !== 'valido')
    erros.push({ campo: 'reprocessamento', mensagem: 'O reprocessamento já está cancelado.' });
  else if (!x.ehUltimoValido)
    erros.push({ campo: 'reprocessamento', mensagem: 'Só o último reprocessamento válido é cancelado.' });
  if (x.situacaoDialisador !== 'em_uso')
    erros.push({
      campo: 'dialisador',
      mensagem: 'O dialisador já saiu de uso: o reprocessamento fica no histórico.',
    });
  if (x.motivo.trim().length < 5)
    erros.push({ campo: 'motivo', mensagem: 'Informe o motivo do cancelamento (ao menos 5 caracteres).' });
  return erros;
}
