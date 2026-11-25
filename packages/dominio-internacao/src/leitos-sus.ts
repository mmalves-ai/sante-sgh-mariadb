// Leitos do sistema público (F78.04-2, 04-INT linha 79): habilitação do estabelecimento para leitos especiais (portaria
// e vigência), os leitos físicos do programa, a capacidade contratada por especialidade e competência e o teto de
// diárias especiais que ela dá. Regras puras: sem banco, sem relógio (as datas chegam em ISO, AAAA-MM-DD).
// Melhoria: a capacidade é histórico (cada alteração é uma nova linha, a vigente é a última da competência), o leito
// só entra no programa dentro da vigência da habilitação e sem passar da quantidade habilitada, e o teto de diárias
// especiais é conferido antes do faturamento, com liberação explícita e nominal.

export const TIPOS_ATENDIMENTO_LEITO_SUS = [
  'internacao',
  'urgencia',
  'hospital_dia',
  'ambulatorial',
  'todos',
] as const;
export type TipoAtendimentoLeitoSus = (typeof TIPOS_ATENDIMENTO_LEITO_SUS)[number];

export interface ProblemaLeitoSus {
  readonly campo: string;
  readonly mensagem: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (s: string): boolean => DATA.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export interface HabilitacaoLeitoSus {
  readonly codigo: string;
  readonly nome: string;
  readonly numeroPortaria: string | null;
  readonly dataPortaria: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly quantidadeLeitosHabilitados: number | null;
  readonly tipoAtendimento: TipoAtendimentoLeitoSus;
  readonly permiteUsoForaPrograma: boolean;
  readonly avisaUsuario: boolean;
}

/** Confere a habilitação: vigência coerente, portaria com número e data juntos e anterior ao fim, aviso coerente. */
export function conferirHabilitacaoLeitoSus(h: HabilitacaoLeitoSus): ProblemaLeitoSus[] {
  const p: ProblemaLeitoSus[] = [];
  if (!h.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código da habilitação.' });
  if (!h.nome.trim()) p.push({ campo: 'nome', mensagem: 'Informe o nome da habilitação.' });
  if (!dataValida(h.vigenciaInicio))
    p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  if (h.vigenciaFim !== null && !dataValida(h.vigenciaFim))
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não é uma data válida.' });
  else if (h.vigenciaFim !== null && h.vigenciaFim < h.vigenciaInicio)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
  if ((h.numeroPortaria === null) !== (h.dataPortaria === null))
    p.push({ campo: 'numeroPortaria', mensagem: 'A portaria precisa de número e data juntos.' });
  if (h.dataPortaria !== null && !dataValida(h.dataPortaria))
    p.push({ campo: 'dataPortaria', mensagem: 'A data da portaria não é uma data válida.' });
  else if (h.dataPortaria !== null && h.vigenciaFim !== null && h.dataPortaria > h.vigenciaFim)
    p.push({ campo: 'dataPortaria', mensagem: 'A portaria é posterior ao fim da vigência.' });
  if (
    h.quantidadeLeitosHabilitados !== null &&
    (!Number.isInteger(h.quantidadeLeitosHabilitados) || h.quantidadeLeitosHabilitados < 1)
  )
    p.push({
      campo: 'quantidadeLeitosHabilitados',
      mensagem: 'A quantidade de leitos habilitados é um inteiro positivo.',
    });
  if (!TIPOS_ATENDIMENTO_LEITO_SUS.includes(h.tipoAtendimento))
    p.push({ campo: 'tipoAtendimento', mensagem: 'Tipo de atendimento desconhecido.' });
  if (h.avisaUsuario && !h.permiteUsoForaPrograma)
    p.push({
      campo: 'avisaUsuario',
      mensagem: 'O aviso só vale quando o leito do programa aceita paciente de fora dele.',
    });
  return p;
}

export interface VinculoLeitoPrograma {
  readonly leito: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Os vínculos que valem numa data. */
export function vinculosVigentes<T extends VinculoLeitoPrograma>(vinculos: readonly T[], data: string): T[] {
  return vinculos.filter(
    (v) => v.vigenciaInicio <= data && (v.vigenciaFim === null || v.vigenciaFim >= data),
  );
}

/**
 * Confere a entrada de um leito no programa: dentro da vigência da habilitação, sem vínculo vigente do mesmo leito e
 * sem passar da quantidade habilitada em nenhuma data do período do vínculo.
 */
export function conferirVinculoLeitoPrograma(entrada: {
  readonly habilitacao: Pick<
    HabilitacaoLeitoSus,
    'vigenciaInicio' | 'vigenciaFim' | 'quantidadeLeitosHabilitados'
  >;
  readonly habilitacaoAtiva: boolean;
  readonly vinculos: readonly VinculoLeitoPrograma[];
  readonly novo: VinculoLeitoPrograma;
}): ProblemaLeitoSus[] {
  const { habilitacao: h, novo } = entrada;
  const p: ProblemaLeitoSus[] = [];
  if (!entrada.habilitacaoAtiva) p.push({ campo: 'habilitacao', mensagem: 'A habilitação está inativa.' });
  if (!dataValida(novo.vigenciaInicio))
    p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início do vínculo.' });
  if (novo.vigenciaFim !== null && novo.vigenciaFim < novo.vigenciaInicio)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim do vínculo é anterior ao início.' });
  if (
    novo.vigenciaInicio < h.vigenciaInicio ||
    (h.vigenciaFim !== null && (novo.vigenciaFim === null || novo.vigenciaFim > h.vigenciaFim))
  )
    p.push({ campo: 'vigenciaInicio', mensagem: 'O vínculo sai da vigência da habilitação.' });
  const sobrepoe = (a: VinculoLeitoPrograma) =>
    a.leito === novo.leito &&
    (a.vigenciaFim === null || a.vigenciaFim >= novo.vigenciaInicio) &&
    (novo.vigenciaFim === null || novo.vigenciaFim >= a.vigenciaInicio);
  if (entrada.vinculos.some(sobrepoe))
    p.push({ campo: 'leito', mensagem: 'O leito já está no programa nesse período.' });
  // O teto vale em todo o período do novo vínculo: o pico de vínculos simultâneos acontece no início do novo ou no
  // início de algum vínculo existente que cai dentro do período dele (um vínculo futuro também conta).
  const datas = [
    novo.vigenciaInicio,
    ...entrada.vinculos
      .map((v) => v.vigenciaInicio)
      .filter((d) => d > novo.vigenciaInicio && (novo.vigenciaFim === null || d <= novo.vigenciaFim)),
  ];
  const pico = Math.max(...datas.map((d) => vinculosVigentes(entrada.vinculos, d).length));
  if (h.quantidadeLeitosHabilitados !== null && pico + 1 > h.quantidadeLeitosHabilitados)
    p.push({
      campo: 'leito',
      mensagem: `A habilitação permite ${h.quantidadeLeitosHabilitados} leito(s) e já tem ${pico} no programa nesse período.`,
    });
  return p;
}

/** Confere o encerramento de um vínculo (o leito sai do programa sem apagar o histórico). */
export function conferirFimVinculo(v: VinculoLeitoPrograma, fim: string): ProblemaLeitoSus[] {
  if (!dataValida(fim)) return [{ campo: 'vigenciaFim', mensagem: 'Informe a data de saída do programa.' }];
  if (fim < v.vigenciaInicio)
    return [{ campo: 'vigenciaFim', mensagem: 'A saída é anterior à entrada no programa.' }];
  if (v.vigenciaFim !== null && v.vigenciaFim <= fim)
    return [{ campo: 'vigenciaFim', mensagem: 'O vínculo já termina nessa data ou antes.' }];
  return [];
}

export const OPERACOES_CAPACIDADE_SUS = ['inclusao', 'alteracao', 'exclusao'] as const;
export type OperacaoCapacidadeSus = (typeof OPERACOES_CAPACIDADE_SUS)[number];

export interface LinhaCapacidadeSus {
  readonly especialidade: number;
  readonly competencia: string;
  readonly quantidadeLeitos: number;
  readonly criticaLiberada: boolean;
  readonly operacao: OperacaoCapacidadeSus;
  readonly ocorridoEm: string;
  readonly id: number;
}

/** Competência em AAAA-MM-01 a partir de AAAA-MM ou AAAA-MM-DD; nula quando não é uma data. */
export function competenciaDe(s: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

/** A capacidade que vale para a especialidade na competência: a última linha dela (exclusão: nenhuma). */
export function capacidadeVigente(
  linhas: readonly LinhaCapacidadeSus[],
  especialidade: number,
  competencia: string,
): LinhaCapacidadeSus | null {
  const da = linhas
    .filter((l) => l.especialidade === especialidade && l.competencia === competencia)
    .sort((a, b) => (a.ocorridoEm === b.ocorridoEm ? a.id - b.id : a.ocorridoEm < b.ocorridoEm ? -1 : 1));
  const ult = da[da.length - 1];
  return !ult || ult.operacao === 'exclusao' ? null : ult;
}

/** A operação da nova linha: inclusão sem vigente, alteração com vigente; recusa a mesma quantidade sem mudança. */
export function conferirCapacidadeSus(entrada: {
  readonly competencia: string;
  readonly quantidadeLeitos: number;
  readonly criticaLiberada: boolean;
  readonly vigente: LinhaCapacidadeSus | null;
  readonly excluir: boolean;
}): { operacao: OperacaoCapacidadeSus | null; problemas: ProblemaLeitoSus[] } {
  const p: ProblemaLeitoSus[] = [];
  if (competenciaDe(entrada.competencia) !== entrada.competencia)
    p.push({ campo: 'competencia', mensagem: 'A competência é o primeiro dia do mês (AAAA-MM-01).' });
  if (entrada.excluir) {
    if (!entrada.vigente)
      p.push({ campo: 'competencia', mensagem: 'Não há capacidade vigente para retirar nesta competência.' });
    return { operacao: p.length ? null : 'exclusao', problemas: p };
  }
  if (
    !Number.isInteger(entrada.quantidadeLeitos) ||
    entrada.quantidadeLeitos < 0 ||
    entrada.quantidadeLeitos > 9999
  )
    p.push({ campo: 'quantidadeLeitos', mensagem: 'A quantidade de leitos é um inteiro de 0 a 9999.' });
  const v = entrada.vigente;
  if (v && v.quantidadeLeitos === entrada.quantidadeLeitos && v.criticaLiberada === entrada.criticaLiberada)
    p.push({ campo: 'quantidadeLeitos', mensagem: 'A capacidade informada é igual à vigente.' });
  return { operacao: p.length ? null : v ? 'alteracao' : 'inclusao', problemas: p };
}

/** Dias do mês da competência (AAAA-MM-01). */
export function diasDaCompetencia(competencia: string): number {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a!, m!, 0)).getUTCDate();
}

/** Teto de diárias especiais da competência: leitos contratados × dias do mês. */
export function tetoDiariasEspeciais(quantidadeLeitos: number, competencia: string): number {
  return quantidadeLeitos * diasDaCompetencia(competencia);
}

/**
 * Situação das diárias especiais contra o teto: dentro, acima com liberação ou acima sem liberação (crítica que segura
 * o faturamento). Sem capacidade cadastrada, a crítica é a falta do cadastro.
 */
export function conferirTetoDiarias(entrada: {
  readonly diarias: number;
  readonly vigente: LinhaCapacidadeSus | null;
  readonly competencia: string;
}): {
  teto: number | null;
  excedente: number;
  situacao: 'dentro' | 'liberado' | 'critica' | 'sem_capacidade';
} {
  const v = entrada.vigente;
  if (!v) return { teto: null, excedente: 0, situacao: entrada.diarias > 0 ? 'sem_capacidade' : 'dentro' };
  const teto = tetoDiariasEspeciais(v.quantidadeLeitos, entrada.competencia);
  const excedente = Math.max(0, entrada.diarias - teto);
  return {
    teto,
    excedente,
    situacao: excedente === 0 ? 'dentro' : v.criticaLiberada ? 'liberado' : 'critica',
  };
}

/** As diárias especiais (de UTI) de um tipo de leito numa competência (AAAA-MM-01), somadas do que vai ser faturado. */
export interface DiariasEspeciaisDaCompetencia {
  /** O código do tipo de leito, o mesmo da especialidade de leito da capacidade (código do cadastro nacional). */
  readonly tipo: number;
  readonly competencia: string;
  readonly diarias: number;
}

export interface ConferenciaTetoDiarias {
  readonly tipo: number;
  readonly competencia: string;
  readonly diarias: number;
  readonly teto: number | null;
  readonly excedente: number;
  readonly situacao: 'dentro' | 'liberado' | 'critica' | 'sem_capacidade';
}

/**
 * Soma as diárias especiais por tipo e competência e confere cada soma contra o teto da capacidade vigente
 * (`conferirTetoDiarias`). As linhas de capacidade chegam com `especialidade` igual ao código do tipo de leito. Sem
 * nenhuma linha de capacidade no estabelecimento o cadastro não é usado e nada é conferido (lista vazia). Só devolve o
 * que precisa de atenção: acima do teto sem liberação (`critica`) e sem capacidade para o tipo (`sem_capacidade`).
 */
export function conferirTetosDiarias(
  diarias: readonly DiariasEspeciaisDaCompetencia[],
  capacidades: readonly LinhaCapacidadeSus[],
): ConferenciaTetoDiarias[] {
  if (capacidades.length === 0) return [];
  const somas = new Map<string, DiariasEspeciaisDaCompetencia>();
  for (const d of diarias) {
    // A competência do faturamento chega em AAAAMM; a da capacidade é AAAA-MM-01.
    const c = d.competencia.trim();
    const competencia = competenciaDe(/^\d{6}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
    if (competencia === null || !(d.diarias > 0)) continue;
    const chave = `${d.tipo}|${competencia}`;
    const atual = somas.get(chave);
    somas.set(chave, { tipo: d.tipo, competencia, diarias: (atual?.diarias ?? 0) + d.diarias });
  }
  const saida: ConferenciaTetoDiarias[] = [];
  for (const s of [...somas.values()].sort((a, b) =>
    a.competencia === b.competencia ? a.tipo - b.tipo : a.competencia < b.competencia ? -1 : 1,
  )) {
    const r = conferirTetoDiarias({
      diarias: s.diarias,
      vigente: capacidadeVigente(capacidades, s.tipo, s.competencia),
      competencia: s.competencia,
    });
    if (r.situacao === 'critica' || r.situacao === 'sem_capacidade') saida.push({ ...s, ...r });
  }
  return saida;
}
