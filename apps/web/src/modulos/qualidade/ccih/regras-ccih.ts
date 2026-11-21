// Regras de tela da CCIH (M48, etapa 3): a competência, o texto das parcelas (regra 5: todo indicador com o numerador e
// o denominador impressos), os critérios de cada sítio de IRAS, o filtro da vigilância, a classe das situações e a
// montagem das entradas dos formulários (conferidas de novo pelo servidor). Sem chamada de rede.
import {
  type CriterioIras,
  type DefinirPrecaucaoEntrada,
  type MomentoHigieneMaos,
  type MotivoPrecaucao,
  type Precaucao,
  type RegistrarIrasEntrada,
  type RegistrarObservacaoMaosEntrada,
  type SitioIras,
  SITIOS_IRAS,
  tipoSugeridoDaPrecaucao,
} from '@sgh/contratos';
import { bloqueioDoVizinho, conferirCriterios, REGRAS_IRAS } from '@sgh/dominio-qualidade';
import { horaDoCampo } from '../regras-qualidade.js';

/** "AAAA-MM" do instante local. */
export function competenciaDe(agora: string): string {
  return agora.slice(0, 7);
}

/** A competência anterior ("2026-01" → "2025-12"). */
export function competenciaAnterior(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return m === 1 ? `${String(a - 1)}-12` : `${String(a)}-${String(m - 1).padStart(2, '0')}`;
}

/** As últimas `quantas` competências até a do instante (a mais recente primeiro), para o filtro. */
export function competenciasRecentes(agora: string, quantas = 13): string[] {
  const r = [competenciaDe(agora)];
  while (r.length < quantas) r.push(competenciaAnterior(r[r.length - 1] as string));
  return r;
}

/** "2026-10" → "10/2026". */
export function rotuloCompetencia(c: string): string {
  return `${c.slice(5, 7)}/${c.slice(0, 4)}`;
}

const numero = (v: number, casas = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Casas do valor pelo fator: por 1.000 e por 1 com duas casas; por 100 (taxa) com uma. */
const casasDo = (fator: 1 | 100 | 1000) => (fator === 100 ? 1 : 2);

export interface ParcelaTexto {
  readonly numerador: number;
  readonly denominador: number;
  readonly valor: number | null;
  readonly fator: 1 | 100 | 1000;
}

/** O valor do indicador ("2,40", "85,0 %"; "-" sem denominador). */
export function valorDaParcela(p: ParcelaTexto): string {
  if (p.valor === null) return '-';
  const v = numero(p.valor, casasDo(p.fator));
  return p.fator === 100 ? `${v} %` : v;
}

/**
 * A conta com as parcelas impressas (regra 5): "3 ÷ 1.250 × 1.000 = 2,40". O numerador fracionário (DDD) sai com duas
 * casas; sem denominador, "sem denominador".
 */
export function contaDaParcela(p: ParcelaTexto): string {
  const num = Number.isInteger(p.numerador) ? numero(p.numerador) : numero(p.numerador, 2);
  const base = `${num} ÷ ${numero(p.denominador)}`;
  const comFator = p.fator === 1 ? base : `${base} × ${numero(p.fator)}`;
  return p.valor === null ? `${comFator} (sem denominador)` : `${comFator} = ${valorDaParcela(p)}`;
}

/** Todos os critérios que valem para o sítio (os da regra principal e os da alternativa), na ordem do catálogo. */
export function criteriosDoSitio(sitio: SitioIras): CriterioIras[] {
  const s = new Set<CriterioIras>();
  type Regra = (typeof REGRAS_IRAS)[SitioIras] & {
    todos?: readonly CriterioIras[];
    grupos?: readonly { de: readonly CriterioIras[] }[];
    ou?: Regra;
  };
  const juntar = (r: Regra | undefined): void => {
    if (!r) return;
    for (const c of r.todos ?? []) s.add(c);
    for (const g of r.grupos ?? []) for (const c of g.de) s.add(c);
    juntar(r.ou);
  };
  juntar(REGRAS_IRAS[sitio] as Regra);
  return [...s];
}

/** O dispositivo cuja associação o sítio confere (CVC na IPCS, VM na PAV, SVD na ITU). */
export function dispositivoDoSitio(sitio: SitioIras): string | null {
  return SITIOS_IRAS.find((x) => x.codigo === sitio)?.dispositivo ?? null;
}

export interface FormularioIras {
  internacao: number;
  sitio: SitioIras | '';
  dataInfeccao: string | null;
  criterios: CriterioIras[];
  nivelIsc: string;
  cirurgia: number | null;
  implante: boolean;
  exame: number | null;
  microrganismo: string;
  multirresistente: boolean;
  descricao: string;
}

export function formularioIrasVazio(internacao: number): FormularioIras {
  return {
    internacao,
    sitio: '',
    dataInfeccao: null,
    criterios: [],
    nivelIsc: '',
    cirurgia: null,
    implante: false,
    exame: null,
    microrganismo: '',
    multirresistente: false,
    descricao: '',
  };
}

export type ProblemaIras =
  | 'sitio'
  | 'data'
  | 'criterio-de-outro-sitio'
  | 'criterios-insuficientes'
  | 'cirurgia'
  | 'nivelIsc'
  | 'microrganismo'
  | 'descricao';

const ou = (t: string): string | null => (t.trim() === '' ? null : t.trim());

/**
 * A entrada de `qualidade.registrarIras`, ou o primeiro problema que a tela mostra antes de gravar (os mesmos do
 * servidor: critérios do sítio, ISC com cirurgia e profundidade, "outra" com descrição, multirresistente com o germe).
 */
export function montarIras(
  f: FormularioIras,
): { entrada: RegistrarIrasEntrada; problema: null } | { entrada: null; problema: ProblemaIras } {
  const falha = (problema: ProblemaIras) => ({ entrada: null, problema }) as const;
  if (!f.sitio) return falha('sitio');
  if (!f.dataInfeccao) return falha('data');
  const criterios = f.criterios.filter((c) => criteriosDoSitio(f.sitio as SitioIras).includes(c));
  const c = conferirCriterios(f.sitio, criterios);
  if (c) return falha(c);
  const isc = f.sitio === 'isc';
  if (isc && f.cirurgia === null) return falha('cirurgia');
  if (isc && !f.nivelIsc) return falha('nivelIsc');
  if (f.multirresistente && !ou(f.microrganismo)) return falha('microrganismo');
  if (f.sitio === 'outra' && (ou(f.descricao)?.length ?? 0) < 10) return falha('descricao');
  return {
    problema: null,
    entrada: {
      internacao: f.internacao,
      sitio: f.sitio,
      dataInfeccao: f.dataInfeccao,
      criterios,
      nivelIsc: isc ? (f.nivelIsc as RegistrarIrasEntrada['nivelIsc']) : null,
      cirurgia: isc ? f.cirurgia : null,
      implante: isc ? f.implante : false,
      exame: f.exame,
      microrganismo: ou(f.microrganismo),
      multirresistente: f.multirresistente,
      descricao: ou(f.descricao),
    },
  };
}

export interface FormularioPrecaucao {
  internacao: number;
  motivo: MotivoPrecaucao | '';
  motivoOutro: string;
  tipo: Precaucao | '';
  origem: 'manual' | 'microbiologia';
  exame: number | null;
  bloquearVizinhos: boolean;
  observacao: string;
}

/** O tipo sugerido ao escolher o motivo (a CCIH pode trocar) e o bloqueio do vizinho (exigido, sugerido ou não). */
export function sugestaoDaPrecaucao(
  motivo: MotivoPrecaucao,
  tipo: Precaucao | '',
  outrosLeitos: number,
): { tipo: Precaucao; bloqueio: 'exigido' | 'sugerido' | 'naoSeAplica' } {
  const t = tipo || tipoSugeridoDaPrecaucao(motivo);
  return { tipo: t, bloqueio: bloqueioDoVizinho(t, motivo, outrosLeitos) };
}

export type ProblemaPrecaucao = 'motivo' | 'motivoOutro' | 'tipo' | 'exame' | 'bloqueio-vizinho-exigido';

export function montarPrecaucao(
  f: FormularioPrecaucao,
  outrosLeitos: number,
): { entrada: DefinirPrecaucaoEntrada; problema: null } | { entrada: null; problema: ProblemaPrecaucao } {
  const falha = (problema: ProblemaPrecaucao) => ({ entrada: null, problema }) as const;
  if (!f.motivo) return falha('motivo');
  if (f.motivo === 'outro' && (ou(f.motivoOutro)?.length ?? 0) < 3) return falha('motivoOutro');
  if (!f.tipo) return falha('tipo');
  if (f.origem === 'microbiologia' && f.exame === null) return falha('exame');
  if (bloqueioDoVizinho(f.tipo, f.motivo, outrosLeitos) === 'exigido' && !f.bloquearVizinhos)
    return falha('bloqueio-vizinho-exigido');
  return {
    problema: null,
    entrada: {
      internacao: f.internacao,
      motivo: f.motivo,
      motivoOutro: f.motivo === 'outro' ? ou(f.motivoOutro) : null,
      tipo: f.tipo,
      origem: f.origem,
      exame: f.origem === 'microbiologia' ? f.exame : null,
      bloquearVizinhos: f.bloquearVizinhos,
      observacao: ou(f.observacao),
    },
  };
}

export interface OportunidadeTela {
  momento: MomentoHigieneMaos;
  acao: 'friccao' | 'lavagem' | 'naoRealizada';
  luvas: boolean;
}

/** A sessão de observação do tablet (sem identificar quem foi observado); null sem oportunidade ou sem instante. */
export function montarObservacao(e: {
  unidade: number | null;
  setor: string;
  observadoEm: string | null;
  categoria: string;
  oportunidades: readonly OportunidadeTela[];
  observacao: string;
}): RegistrarObservacaoMaosEntrada | null {
  if (e.unidade === null || !e.observadoEm || !e.categoria || e.oportunidades.length === 0) return null;
  return {
    unidade: e.unidade,
    setor: ou(e.setor),
    observadoEm: e.observadoEm,
    categoria: e.categoria as RegistrarObservacaoMaosEntrada['categoria'],
    oportunidades: e.oportunidades.map((o) => ({ ...o })),
    observacao: ou(e.observacao),
  };
}

/** Adesão parcial da sessão em curso (conformes ÷ oportunidades), para o observador ver antes de gravar. */
export function adesaoDaSessao(ops: readonly OportunidadeTela[]): { conformes: number; total: number } {
  return { conformes: ops.filter((o) => o.acao !== 'naoRealizada').length, total: ops.length };
}

export interface FiltroVigilancia {
  setor: string;
  motivo: string;
  busca: string;
}

/** O filtro da fila da vigilância (setor, motivo e nome ou prontuário), sem mudar a ordem do peso. */
export function filtrarVigilancia<
  T extends { setor: string; motivos: readonly string[]; nome: string; prontuario: number },
>(itens: readonly T[], f: FiltroVigilancia): T[] {
  const b = f.busca.trim().toUpperCase();
  return itens.filter(
    (i) =>
      (!f.setor || i.setor === f.setor) &&
      (!f.motivo || i.motivos.includes(f.motivo)) &&
      (!b || i.nome.toUpperCase().includes(b) || String(i.prontuario) === b),
  );
}

/** Os setores distintos da fila, em ordem. */
export function setoresDe(itens: readonly { setor: string }[]): string[] {
  return [...new Set(itens.map((i) => i.setor))].sort();
}

/** Classe do selo da situação do antimicrobiano restrito. */
export function classeDaSituacao(situacao: string): string {
  if (situacao === 'vencida') return 'selo selo--grave';
  if (situacao === 'aguardando') return 'selo selo--atencao';
  if (situacao === 'naoLiberado') return 'selo selo--neutro';
  return 'selo selo--ok';
}

/**
 * Instante local "AAAA-MM-DDTHH:mm" a partir dos campos de data e hora (null se faltar um ou se a hora for inválida).
 * A hora vira "HH:MM" pelo auxiliar neutro do contrato.
 */
export function instanteLocal(data: string | null, hora: string | null): string | null {
  const h = hora === null ? null : horaDoCampo(hora);
  if (!data || h === null || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  return `${data}T${h}`;
}

/** Número decimal digitado ("1,5" ou "1.5"): vazio → null; positivo → o número; inválido ou zero → undefined. */
export function numeroDecimal(texto: string): number | null | undefined {
  const v = texto.trim();
  if (v === '') return null;
  if (!/^\d+([.,]\d+)?$/.test(v)) return undefined;
  const n = Number(v.replace(',', '.'));
  return n > 0 && n <= 1000 ? n : undefined;
}

/** Inteiro positivo digitado (casos, mL); inválido → null. */
export function inteiroPositivo(texto: string, maximo: number): number | null {
  const v = texto.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= maximo ? n : null;
}
