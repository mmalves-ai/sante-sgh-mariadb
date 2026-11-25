// Conferência das contas médicas recebidas além das críticas padrão (08-SGO linha 105, C1-100, F7):
//   - as regras de crítica que a operadora cadastra (procedimentos que não se cobram juntos, combinação rejeitada,
//     glosa de referência por procedimento e penalidade do prestador), aplicadas a cada guia no recebimento;
//   - o parecer da auditoria da conta (administrativa, médica ou de enfermagem), com as regras de quem pode auditar.
// Sem I/O: a porta lê as regras e grava as críticas e os pareceres; aqui só a regra.
import type { Problema } from './autorizacao.js';

export const TIPOS_REGRA_CRITICA = [
  'auto_excludente',
  'combinacao_rejeitada',
  'glosa_referencia',
  'penalidade_prestador',
] as const;
export type TipoRegraCritica = (typeof TIPOS_REGRA_CRITICA)[number];

export const ROTULOS_REGRA_CRITICA: Readonly<Record<TipoRegraCritica, string>> = {
  auto_excludente: 'Procedimentos que não se cobram juntos',
  combinacao_rejeitada: 'Combinação rejeitada',
  glosa_referencia: 'Glosa de referência do procedimento',
  penalidade_prestador: 'Penalidade do prestador',
};

/** A regra como a conferência usa: os procedimentos já pelo código TUSS (a porta resolve o item faturável). */
export interface RegraCriticaConta {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoRegraCritica;
  readonly principal: string | null;
  readonly relacionado: string | null;
  readonly prestador: number | null;
  readonly motivoGlosa: number | null;
  readonly percentual: number | null;
  readonly glosaAutomatica: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** O que a tela manda para cadastrar uma regra (procedimentos pelo id do item faturável). */
export interface EntradaRegraCritica {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoRegraCritica;
  readonly principal: number | null;
  readonly relacionado: number | null;
  readonly prestador: number | null;
  readonly motivoGlosa: number | null;
  readonly percentual: number | null;
  readonly glosaAutomatica: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Código da regra: maiúsculas, sem espaços nas pontas e espaços internos por hífen. */
export const normalizarCodigoRegra = (c: string): string => c.trim().toUpperCase().replace(/\s+/g, '-');

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Problemas da regra antes de gravar (todos de uma vez, para a tela marcar cada campo). */
export function problemasDaRegraCritica(
  e: EntradaRegraCritica,
  codigosExistentes: readonly string[] = [],
): Problema[] {
  const p: Problema[] = [];
  const codigo = normalizarCodigoRegra(e.codigo);
  if (!/^[A-Z0-9][A-Z0-9._-]{1,29}$/.test(codigo)) p.push({ codigo: 'codigo-invalido', campo: 'codigo' });
  else if (codigosExistentes.map(normalizarCodigoRegra).includes(codigo))
    p.push({ codigo: 'codigo-repetido', campo: 'codigo' });
  if (!e.descricao.trim() || e.descricao.trim().length > 150)
    p.push({ codigo: 'descricao-obrigatoria', campo: 'descricao' });
  if (!TIPOS_REGRA_CRITICA.includes(e.tipo)) p.push({ codigo: 'tipo-invalido', campo: 'tipo' });
  const par = e.tipo === 'auto_excludente' || e.tipo === 'combinacao_rejeitada';
  if (e.tipo !== 'penalidade_prestador' && e.principal === null)
    p.push({ codigo: 'procedimento-obrigatorio', campo: 'principal' });
  if (par && e.relacionado === null) p.push({ codigo: 'relacionado-obrigatorio', campo: 'relacionado' });
  if (par && e.principal !== null && e.principal === e.relacionado)
    p.push({ codigo: 'relacionado-igual-ao-principal', campo: 'relacionado' });
  if (!par && e.relacionado !== null) p.push({ codigo: 'relacionado-sem-uso', campo: 'relacionado' });
  if (e.tipo === 'penalidade_prestador' && e.prestador === null)
    p.push({ codigo: 'prestador-obrigatorio', campo: 'prestador' });
  if (e.percentual !== null && !(e.percentual > 0 && e.percentual <= 100))
    p.push({ codigo: 'percentual-invalido', campo: 'percentual' });
  const glosa = e.glosaAutomatica || e.tipo === 'glosa_referencia' || e.tipo === 'penalidade_prestador';
  if (glosa && e.motivoGlosa === null) p.push({ codigo: 'motivo-obrigatorio', campo: 'motivoGlosa' });
  if ((e.tipo === 'glosa_referencia' || (e.glosaAutomatica && !par)) && e.percentual === null)
    p.push({ codigo: 'percentual-obrigatorio', campo: 'percentual' });
  if (!DATA.test(e.vigenciaInicio)) p.push({ codigo: 'vigencia-invalida', campo: 'vigenciaInicio' });
  if (e.vigenciaFim !== null && (!DATA.test(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    p.push({ codigo: 'vigencia-invalida', campo: 'vigenciaFim' });
  return p;
}

/** A regra vale na data do atendimento e para o prestador da conta. */
export function regraValeNaData(r: RegraCriticaConta, data: string, prestador: number): boolean {
  if (!r.ativo || data < r.vigenciaInicio || (r.vigenciaFim !== null && data > r.vigenciaFim)) return false;
  return r.prestador === null || r.prestador === prestador;
}

export interface ItemParaRegra {
  readonly indice: number;
  readonly codigo: string;
  readonly apresentado: number;
}

export type CodigoCriticaRegra =
  | 'regra-procedimentos-excludentes'
  | 'regra-combinacao-rejeitada'
  | 'regra-glosa-referencia'
  | 'regra-penalidade-prestador';

export interface CriticaDeRegra {
  readonly regra: number;
  /** O item criticado (índice na guia); nulo quando a crítica é da guia. */
  readonly indice: number | null;
  readonly codigo: CodigoCriticaRegra;
  /** `glosa` quando a regra glosa sem análise manual; `critica` quando só sinaliza ao auditor. */
  readonly tipo: 'critica' | 'glosa';
  readonly motivoGlosa: number | null;
  readonly glosado: number;
  readonly descricao: string;
}

const CODIGO_DA_REGRA: Readonly<Record<TipoRegraCritica, CodigoCriticaRegra>> = {
  auto_excludente: 'regra-procedimentos-excludentes',
  combinacao_rejeitada: 'regra-combinacao-rejeitada',
  glosa_referencia: 'regra-glosa-referencia',
  penalidade_prestador: 'regra-penalidade-prestador',
};

const centavos = (v: number) => Math.round(v * 100);

/**
 * Aplica as regras cadastradas a uma guia: cada regra vigente na data de início, do prestador (ou de todos), gera as
 * críticas dos itens alcançados. A glosa só sai com `glosaAutomatica` e o percentual; um item recebe no máximo uma glosa
 * de regra (a primeira, pela ordem das regras), e a soma nunca passa do apresentado nem do que ainda resta do item.
 * `jaGlosado` traz a glosa que o item já tem das críticas padrão (a regra glosa só o resto).
 */
export function criticasDasRegras(
  guia: { readonly data: string; readonly itens: readonly ItemParaRegra[] },
  prestador: number,
  regras: readonly RegraCriticaConta[],
  jaGlosado: ReadonlyMap<number, number> = new Map(),
): CriticaDeRegra[] {
  const out: CriticaDeRegra[] = [];
  const glosadoPorRegra = new Set<number>();
  const valerAs = regras.filter((r) => regraValeNaData(r, guia.data, prestador));
  for (const r of valerAs) {
    const doCodigo = (c: string | null) => (c === null ? [] : guia.itens.filter((i) => i.codigo === c));
    let alvos: ItemParaRegra[] = [];
    switch (r.tipo) {
      case 'auto_excludente':
      case 'combinacao_rejeitada':
        alvos = doCodigo(r.principal).length > 0 ? doCodigo(r.relacionado) : [];
        break;
      case 'glosa_referencia':
        alvos = doCodigo(r.principal);
        break;
      case 'penalidade_prestador':
        alvos = r.principal === null ? [...guia.itens] : doCodigo(r.principal);
        break;
    }
    if (alvos.length === 0) continue;
    const percentual =
      r.percentual ?? (r.tipo === 'auto_excludente' || r.tipo === 'combinacao_rejeitada' ? 100 : null);
    for (const i of alvos) {
      const resto = Math.max(0, centavos(i.apresentado) - centavos(jaGlosado.get(i.indice) ?? 0));
      const glosa =
        r.glosaAutomatica && percentual !== null && !glosadoPorRegra.has(i.indice)
          ? Math.min(resto, Math.round((centavos(i.apresentado) * percentual) / 100))
          : 0;
      if (glosa > 0) glosadoPorRegra.add(i.indice);
      out.push({
        regra: r.id,
        indice: i.indice,
        codigo: CODIGO_DA_REGRA[r.tipo],
        tipo: glosa > 0 ? 'glosa' : 'critica',
        motivoGlosa: r.motivoGlosa,
        glosado: glosa / 100,
        descricao: `${r.codigo}: ${r.descricao}`.slice(0, 2000),
      });
    }
  }
  return out;
}

// ── Auditoria da conta ──────────────────────────────────────────────────────────────────────────

export const TIPOS_AUDITORIA_CONTA = ['administrativa', 'medica', 'enfermagem'] as const;
export type TipoAuditoriaConta = (typeof TIPOS_AUDITORIA_CONTA)[number];
export const RESULTADOS_AUDITORIA_CONTA = [
  'pendente',
  'liberado',
  'glosa_parcial',
  'glosa_total',
  'devolvido',
] as const;
export type ResultadoAuditoriaConta = (typeof RESULTADOS_AUDITORIA_CONTA)[number];

export interface ParecerAuditoriaConta {
  readonly tipo: TipoAuditoriaConta;
  readonly resultado: ResultadoAuditoriaConta;
  readonly parecer: string;
  readonly motivoGlosa: number | null;
  /** A situação da conta: só a conta em análise (recebida) recebe parecer. */
  readonly situacaoConta: string;
  /** A categoria do auditor designado na operadora (nulo: sem designação). */
  readonly categoriaAuditor: 'medico' | 'enfermeiro' | null;
}

export const PARECER_MINIMO = 10;

/**
 * Problemas do parecer: só na conta em análise; texto mínimo; glosa exige o motivo padronizado; a auditoria médica é de
 * médico e a de enfermagem, de enfermeiro designado (a administrativa não exige designação).
 */
export function problemasDoParecerAuditoria(e: ParecerAuditoriaConta): Problema[] {
  const p: Problema[] = [];
  if (e.situacaoConta !== 'recebida') p.push({ codigo: 'conta-fora-da-analise' });
  if (!TIPOS_AUDITORIA_CONTA.includes(e.tipo)) p.push({ codigo: 'tipo-invalido', campo: 'tipo' });
  if (!RESULTADOS_AUDITORIA_CONTA.includes(e.resultado))
    p.push({ codigo: 'resultado-invalido', campo: 'resultado' });
  if (e.parecer.trim().length < PARECER_MINIMO) p.push({ codigo: 'parecer-obrigatorio', campo: 'parecer' });
  if ((e.resultado === 'glosa_parcial' || e.resultado === 'glosa_total') && e.motivoGlosa === null)
    p.push({ codigo: 'motivo-obrigatorio', campo: 'motivoGlosa' });
  if (e.tipo === 'medica' && e.categoriaAuditor !== 'medico')
    p.push({ codigo: 'auditor-sem-categoria', campo: 'tipo' });
  if (e.tipo === 'enfermagem' && e.categoriaAuditor !== 'enfermeiro')
    p.push({ codigo: 'auditor-sem-categoria', campo: 'tipo' });
  return p;
}
