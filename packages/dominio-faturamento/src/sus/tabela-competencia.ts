// Tabela unificada do SUS por competência (06-SUS linha 50): qual competência carregada está em uso, e as
// compatibilidades entre procedimentos (principal × secundário) vigentes na competência do atendimento.
// Regra pura: a leitura do banco entrega as linhas; aqui se decide a vigência e o que cada par significa.

/** Situação da carga de uma competência da tabela. */
export type SituacaoCargaSigtap = 'pendente' | 'carregando' | 'carregada' | 'falha' | 'substituida';

export interface CompetenciaSigtapLida {
  /** AAAAMM. */
  readonly codigo: string;
  readonly situacao: SituacaoCargaSigtap;
  readonly vigente: boolean;
  readonly publicacao: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly procedimentos: number | null;
}

/** Tipos oficiais do par: compatível, incompatível (excludente) e concomitante. */
export type TipoCompatibilidadeSigtap = 'compativel' | 'incompativel' | 'concomitante';

export interface ParSigtapLido {
  readonly principal: string;
  readonly secundario: string;
  readonly tipo: TipoCompatibilidadeSigtap;
  readonly quantidadeMaxima: number | null;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** A competência AAAAMM de uma data AAAA-MM-DD (null se a data não é válida). */
export function competenciaDaVigencia(data: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(data ?? '');
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? Number(m[1]) * 100 + mes : null;
}

function valida(c: string): number {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(c)) throw new Error(`competência inválida: ${c}`);
  return Number(c);
}

/**
 * A competência em uso: a marcada vigente e carregada; sem ela, a carregada mais recente. Falha, pendente e
 * substituída nunca são a de uso. null quando nenhuma foi carregada.
 */
export function competenciaEmUso(lidas: readonly CompetenciaSigtapLida[]): CompetenciaSigtapLida | null {
  const carregadas = lidas.filter((c) => c.situacao === 'carregada');
  const marcada = carregadas.find((c) => c.vigente);
  if (marcada) return marcada;
  return carregadas.reduce<CompetenciaSigtapLida | null>(
    (m, c) => (m === null || valida(c.codigo) > valida(m.codigo) ? c : m),
    null,
  );
}

/** As competências da mais nova para a mais antiga. */
export function competenciasOrdenadas(lidas: readonly CompetenciaSigtapLida[]): CompetenciaSigtapLida[] {
  return [...lidas].sort((a, b) => valida(b.codigo) - valida(a.codigo));
}

/** O par vale na competência quando ela cai entre a competência inicial e a final (sem fim: vigente). */
export function parVigenteNaCompetencia(p: ParSigtapLido, competencia: string): boolean {
  const n = valida(competencia);
  const ini = competenciaDaVigencia(p.vigenciaInicio);
  const fim = p.vigenciaFim === null ? null : competenciaDaVigencia(p.vigenciaFim);
  return (ini === null || n >= ini) && (fim === null || n <= fim);
}

/** Os pares vigentes na competência, um por (principal, secundário, tipo): o de início mais recente prevalece. */
export function paresDaCompetencia(pares: readonly ParSigtapLido[], competencia: string): ParSigtapLido[] {
  const m = new Map<string, ParSigtapLido>();
  for (const p of pares) {
    if (!parVigenteNaCompetencia(p, competencia)) continue;
    const k = `${p.principal}|${p.secundario}|${p.tipo}`;
    const atual = m.get(k);
    if (!atual || p.vigenciaInicio > atual.vigenciaInicio) m.set(k, p);
  }
  return [...m.values()].sort(
    (a, b) => a.principal.localeCompare(b.principal) || a.secundario.localeCompare(b.secundario),
  );
}

export interface SecundarioInformado {
  readonly codigo: string;
  readonly quantidade: number;
}

export type MotivoParSigtap = 'incompativel' | 'fora-dos-compativeis' | 'quantidade-acima';

export interface OcorrenciaParSigtap {
  readonly secundario: string;
  readonly motivo: MotivoParSigtap;
  readonly quantidadeMaxima?: number;
}

/**
 * Confere os secundários de um principal na competência do atendimento (nunca a de hoje):
 * - par incompatível vigente: recusa;
 * - quando o principal tem lista de compatíveis vigente, o secundário fora dela (e não concomitante) é recusado;
 * - compatível ou concomitante com quantidade máxima: a quantidade informada não passa dela.
 * Sem nenhuma linha do principal na competência, nada é recusado (o procedimento não restringe).
 */
export function conferirSecundarios(
  principal: string,
  secundarios: readonly SecundarioInformado[],
  competencia: string,
  pares: readonly ParSigtapLido[],
): OcorrenciaParSigtap[] {
  const doPrincipal = paresDaCompetencia(
    pares.filter((p) => p.principal === principal),
    competencia,
  );
  const temLista = doPrincipal.some((p) => p.tipo === 'compativel');
  const saida: OcorrenciaParSigtap[] = [];
  for (const s of secundarios) {
    if (s.codigo === principal) continue;
    const dele = doPrincipal.filter((p) => p.secundario === s.codigo);
    if (dele.some((p) => p.tipo === 'incompativel')) {
      saida.push({ secundario: s.codigo, motivo: 'incompativel' });
      continue;
    }
    const aceito = dele.find((p) => p.tipo === 'compativel' || p.tipo === 'concomitante');
    if (!aceito) {
      if (temLista) saida.push({ secundario: s.codigo, motivo: 'fora-dos-compativeis' });
      continue;
    }
    if (aceito.quantidadeMaxima !== null && s.quantidade > aceito.quantidadeMaxima)
      saida.push({
        secundario: s.codigo,
        motivo: 'quantidade-acima',
        quantidadeMaxima: aceito.quantidadeMaxima,
      });
  }
  return saida;
}
