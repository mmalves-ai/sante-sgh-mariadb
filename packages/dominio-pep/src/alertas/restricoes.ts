// Restrições próprias do hospital no apoio à decisão da prescrição (03-PEP L108; ANVISA RDC 36/2013, ISMP): o ajuste de
// dose pela função renal (ou hepática, ou diálise) por faixa, a restrição de posologia por paciente (idade, peso, sexo,
// gestante, lactante, setor, via, forma) e a configuração do alerta por estabelecimento e setor (liga, desliga ou muda o
// comportamento da regra vigente no setor). O cadastro é da farmácia clínica; os limites que o hospital já usava chegam
// pela importação. Nada aqui lê banco: a porta entrega as linhas já resolvidas para os produtos da prescrição.
import type { NivelAlerta } from '@sgh/contratos';
import type { AlertaGerado, ContextoAlertas, ItemAvaliado } from './tipos.js';

export const CRITERIOS_AJUSTE_RENAL = [
  'depuracao_creatinina',
  'taxa_filtracao_glomerular',
  'child_pugh',
  'dialise',
] as const;
export type CriterioAjusteRenal = (typeof CRITERIOS_AJUSTE_RENAL)[number];
export const AJUSTES_RENAIS = [
  'reduzir_dose',
  'aumentar_intervalo',
  'reduzir_dose_e_intervalo',
  'evitar',
  'sem_ajuste',
] as const;
export type AjusteRenal = (typeof AJUSTES_RENAIS)[number];
export const COMPORTAMENTOS_RESTRICAO = ['avisar', 'exigir_justificativa', 'bloquear'] as const;
export type ComportamentoRestricao = (typeof COMPORTAMENTOS_RESTRICAO)[number];
export const TIPOS_RESTRICAO_POSOLOGIA = [
  'contraindicacao',
  'dose_maxima',
  'via_proibida',
  'forma_proibida',
] as const;
export type TipoRestricaoPosologia = (typeof TIPOS_RESTRICAO_POSOLOGIA)[number];
export const COMPORTAMENTOS_CONFIGURACAO = ['aviso', 'exige_justificativa', 'bloqueio'] as const;
export type ComportamentoConfiguracao = (typeof COMPORTAMENTOS_CONFIGURACAO)[number];

/** Faixa de ajuste já resolvida para os produtos a que vale (o item ou os itens do princípio ativo). */
export interface FaixaAjusteRenal {
  readonly id: number;
  readonly produtos: readonly number[];
  readonly criterio: CriterioAjusteRenal;
  readonly faixaMinima: number | null;
  readonly faixaMaxima: number | null;
  readonly classeHepatica: 'A' | 'B' | 'C' | null;
  readonly modalidadeDialise: string | null;
  readonly ajuste: AjusteRenal;
  readonly percentualDose: number | null;
  readonly doseMaxima: number | null;
  readonly intervaloHoras: number | null;
  readonly comportamento: ComportamentoRestricao;
  readonly orientacao: string | null;
}

export interface RestricaoPosologia {
  readonly id: number;
  readonly produtos: readonly number[];
  readonly setor: number | null;
  /** Via proibida (a mesma sigla da via do item). */
  readonly via: string | null;
  readonly sexo: number | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly pesoMinimoKg: number | null;
  readonly pesoMaximoKg: number | null;
  readonly gestante: boolean | null;
  readonly lactante: boolean | null;
  readonly tipo: TipoRestricaoPosologia;
  readonly doseMaxima: number | null;
  readonly doseMaximaDiaria: number | null;
  readonly acao: ComportamentoRestricao;
  readonly mensagem: string;
}

/** Configuração do alerta (pelo tipo da regra) num estabelecimento ou setor, com vigência. */
export interface ConfiguracaoAlertaSetor {
  readonly id: number;
  readonly tipo: string;
  readonly estabelecimento: number | null;
  readonly setor: number | null;
  readonly gatilhoProduto: number | null;
  readonly comportamento: ComportamentoConfiguracao;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface ContextoRestricoes {
  readonly estabelecimento: number | null;
  readonly setor: number | null;
  readonly paciente: {
    readonly idadeDias: number | null;
    readonly sexo: number | null;
    readonly gestante: boolean | null;
    readonly lactante: boolean | null;
    readonly classeHepatica: 'A' | 'B' | 'C' | null;
    readonly dialise: string | null;
  };
  readonly ajustesRenais: readonly FaixaAjusteRenal[];
  readonly posologia: readonly RestricaoPosologia[];
  readonly configuracoes: readonly ConfiguracaoAlertaSetor[];
}

export const NIVEL_DO_COMPORTAMENTO: Record<ComportamentoRestricao | ComportamentoConfiguracao, NivelAlerta> =
  {
    avisar: 'aviso',
    aviso: 'aviso',
    exigir_justificativa: 'justificar',
    exige_justificativa: 'justificar',
    bloquear: 'bloqueio',
    bloqueio: 'bloqueio',
  };

const dentro = (v: number | null, min: number | null, max: number | null): boolean =>
  v !== null && (min === null || v >= min) && (max === null || v <= max);

/** Problemas de uma faixa de ajuste antes de gravar (a mesma coerência dos CHECK, com mensagem na hora). */
export function problemasFaixaRenal(f: Omit<FaixaAjusteRenal, 'id' | 'produtos'>): string[] {
  const p: string[] = [];
  if (f.faixaMinima !== null && f.faixaMaxima !== null && f.faixaMinima > f.faixaMaxima)
    p.push('faixa-invertida');
  if (f.criterio === 'child_pugh' && !f.classeHepatica) p.push('classe-hepatica-obrigatoria');
  if (f.criterio === 'dialise' && !f.modalidadeDialise) p.push('modalidade-dialise-obrigatoria');
  if (
    (f.criterio === 'depuracao_creatinina' || f.criterio === 'taxa_filtracao_glomerular') &&
    f.faixaMinima === null &&
    f.faixaMaxima === null
  )
    p.push('faixa-obrigatoria');
  if (f.percentualDose !== null && (f.percentualDose <= 0 || f.percentualDose > 100))
    p.push('percentual-invalido');
  if (
    (f.ajuste === 'reduzir_dose' || f.ajuste === 'reduzir_dose_e_intervalo') &&
    f.doseMaxima === null &&
    f.percentualDose === null
  )
    p.push('reducao-sem-limite');
  if (
    (f.ajuste === 'aumentar_intervalo' || f.ajuste === 'reduzir_dose_e_intervalo') &&
    f.intervaloHoras === null
  )
    p.push('intervalo-obrigatorio');
  return p;
}

/** Problemas de uma restrição de posologia antes de gravar. */
export function problemasRestricao(r: Omit<RestricaoPosologia, 'id' | 'produtos'>): string[] {
  const p: string[] = [];
  if (r.mensagem.trim().length < 5) p.push('mensagem-obrigatoria');
  if (r.tipo === 'dose_maxima' && r.doseMaxima === null && r.doseMaximaDiaria === null)
    p.push('dose-obrigatoria');
  if (r.tipo === 'via_proibida' && !r.via) p.push('via-obrigatoria');
  if (r.idadeMinimaDias !== null && r.idadeMaximaDias !== null && r.idadeMinimaDias > r.idadeMaximaDias)
    p.push('idade-invertida');
  if (r.pesoMinimoKg !== null && r.pesoMaximoKg !== null && r.pesoMinimoKg > r.pesoMaximoKg)
    p.push('peso-invertido');
  return p;
}

/** A faixa que vale para o paciente (a primeira que casa, na ordem: diálise, hepática, renal). */
export function faixaDoPaciente(
  faixas: readonly FaixaAjusteRenal[],
  produto: number,
  clearance: number | null,
  p: ContextoRestricoes['paciente'],
): FaixaAjusteRenal | null {
  const doProduto = faixas.filter((f) => f.produtos.includes(produto));
  return (
    doProduto.find(
      (f) => f.criterio === 'dialise' && p.dialise !== null && f.modalidadeDialise === p.dialise,
    ) ??
    doProduto.find(
      (f) =>
        f.criterio === 'child_pugh' && p.classeHepatica !== null && f.classeHepatica === p.classeHepatica,
    ) ??
    doProduto.find(
      (f) =>
        (f.criterio === 'depuracao_creatinina' || f.criterio === 'taxa_filtracao_glomerular') &&
        dentro(clearance, f.faixaMinima, f.faixaMaxima),
    ) ??
    null
  );
}

/** Ajuste renal por faixa: dose acima do limite da faixa, intervalo menor que o da faixa, ou item a evitar. */
export function alertasAjusteRenalFaixa(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const rs = ctx.restricoes;
  if (!rs || rs.ajustesRenais.length === 0) return [];
  const r: AlertaGerado[] = [];
  for (const { produto, dose } of item.produtos) {
    const f = faixaDoPaciente(rs.ajustesRenais, produto.produto, ctx.paciente.clearance, rs.paciente);
    if (!f || f.ajuste === 'sem_ajuste') continue;
    const motivos: string[] = [];
    if (f.ajuste === 'evitar') motivos.push('evitar nesta faixa');
    const limite =
      f.doseMaxima ??
      (f.percentualDose !== null && produto.doseMaxima !== null
        ? (produto.doseMaxima * f.percentualDose) / 100
        : null);
    if (
      (f.ajuste === 'reduzir_dose' || f.ajuste === 'reduzir_dose_e_intervalo') &&
      dose !== null &&
      limite !== null &&
      dose > limite
    )
      motivos.push(`dose acima de ${Math.round(limite * 10000) / 10000}`);
    if (
      (f.ajuste === 'aumentar_intervalo' || f.ajuste === 'reduzir_dose_e_intervalo') &&
      f.intervaloHoras !== null &&
      item.intervaloHoras !== null &&
      item.intervaloHoras < f.intervaloHoras
    )
      motivos.push(`intervalo menor que ${f.intervaloHoras} h`);
    if (motivos.length === 0) continue;
    const base =
      f.criterio === 'child_pugh'
        ? `Child-Pugh ${f.classeHepatica}`
        : f.criterio === 'dialise'
          ? `diálise (${f.modalidadeDialise})`
          : `clearance estimado de ${ctx.paciente.clearance} mL/min`;
    r.push({
      id: `ajuste-renal-faixa:${produto.produto}:${f.id}`,
      item: item.chave,
      tipo: 'ajuste-renal',
      titulo: f.criterio === 'child_pugh' ? 'Ajuste pela função hepática' : 'Ajuste renal',
      detalhe: `${produto.nome}: ${base}; ${motivos.join('; ')}.${f.orientacao ? ` ${f.orientacao}` : ''}`,
      nivel: NIVEL_DO_COMPORTAMENTO[f.comportamento],
    });
  }
  return r;
}

const doseNoDia = (dose: number | null, item: ItemAvaliado): number | null =>
  dose === null ? null : dose * Math.max(1, item.dosesNoPeriodo);

/** A restrição vale para o paciente e o setor? (campo nulo: indiferente). */
export function restricaoAlcanca(
  r: RestricaoPosologia,
  rs: ContextoRestricoes,
  pesoKg: number | null,
): boolean {
  const p = rs.paciente;
  if (r.setor !== null && r.setor !== rs.setor) return false;
  if (r.sexo !== null && r.sexo !== p.sexo) return false;
  if (
    (r.idadeMinimaDias !== null || r.idadeMaximaDias !== null) &&
    !dentro(p.idadeDias, r.idadeMinimaDias, r.idadeMaximaDias)
  )
    return false;
  if ((r.pesoMinimoKg !== null || r.pesoMaximoKg !== null) && !dentro(pesoKg, r.pesoMinimoKg, r.pesoMaximoKg))
    return false;
  if (r.gestante === true && p.gestante !== true) return false;
  if (r.lactante === true && p.lactante !== true) return false;
  return true;
}

/** Restrição de posologia do hospital: contraindicação, dose máxima (por dose ou no dia), via ou forma proibida. */
export function alertasRestricaoPosologia(item: ItemAvaliado, ctx: ContextoAlertas): AlertaGerado[] {
  const rs = ctx.restricoes;
  if (!rs || rs.posologia.length === 0) return [];
  const r: AlertaGerado[] = [];
  for (const { produto, dose } of item.produtos) {
    for (const x of rs.posologia) {
      if (!x.produtos.includes(produto.produto) || !restricaoAlcanca(x, rs, ctx.paciente.pesoKg)) continue;
      let dispara: boolean;
      if (x.tipo === 'contraindicacao' || x.tipo === 'forma_proibida') dispara = true;
      else if (x.tipo === 'via_proibida')
        dispara = item.via !== null && x.via !== null && item.via.toUpperCase() === x.via.toUpperCase();
      else {
        const dia = doseNoDia(dose, item);
        dispara =
          (x.doseMaxima !== null && dose !== null && dose > x.doseMaxima) ||
          (x.doseMaximaDiaria !== null && dia !== null && dia > x.doseMaximaDiaria);
      }
      if (!dispara) continue;
      r.push({
        id: `restricao-posologia:${produto.produto}:${x.id}`,
        item: item.chave,
        tipo: 'restricao-posologia',
        titulo:
          x.tipo === 'dose_maxima'
            ? 'Dose acima do limite do hospital'
            : x.tipo === 'via_proibida'
              ? 'Via não permitida para este paciente'
              : x.tipo === 'forma_proibida'
                ? 'Forma não permitida para este paciente'
                : 'Contraindicação para este paciente',
        detalhe: `${produto.nome}: ${x.mensagem}`,
        nivel: NIVEL_DO_COMPORTAMENTO[x.acao],
      });
    }
  }
  return r;
}

/**
 * Configuração do alerta que vale no setor: a mais específica vigente (gatilho do item no setor, setor, estabelecimento,
 * cliente). Inativa: o alerta fica desligado ali. Sem configuração: null (vale a regra).
 */
export function configuracaoDoAlerta(
  rs: ContextoRestricoes | undefined,
  tipo: string,
  produtos: readonly number[],
  hoje: string,
): { ligado: boolean; nivel: NivelAlerta } | null {
  if (!rs || rs.configuracoes.length === 0) return null;
  const peso = (c: ConfiguracaoAlertaSetor) =>
    (c.gatilhoProduto !== null ? 4 : 0) + (c.setor !== null ? 2 : 0) + (c.estabelecimento !== null ? 1 : 0);
  const c = rs.configuracoes
    .filter(
      (c) =>
        c.tipo === tipo &&
        (c.estabelecimento === null || c.estabelecimento === rs.estabelecimento) &&
        (c.setor === null || c.setor === rs.setor) &&
        (c.gatilhoProduto === null || produtos.includes(c.gatilhoProduto)) &&
        (c.vigenciaInicio === null || c.vigenciaInicio <= hoje) &&
        (c.vigenciaFim === null || c.vigenciaFim >= hoje),
    )
    .sort((a, b) => peso(b) - peso(a) || b.id - a.id)[0];
  return c ? { ligado: c.ativo, nivel: NIVEL_DO_COMPORTAMENTO[c.comportamento] } : null;
}
