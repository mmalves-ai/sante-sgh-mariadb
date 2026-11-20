// Apoios puros da tela da contratualização SUS (M55, etapa 5): o dinheiro digitado em centavos, a competência entre o
// campo do navegador (AAAA-MM) e a da API (AAAAMM), os rótulos dos vocabulários, a permissão de editar e a montagem do
// corpo da meta (só os campos do tipo escolhido: o servidor recusa campos de outro tipo). Sem estado; testados em
// contratualizacao-telas.spec.ts. O servidor confere tudo de novo (o mesmo Zod de @sgh/contratos).
import {
  AFERICOES_SUS,
  COMPLEXIDADES_SUS,
  ESCORES_SUS,
  ESFERAS_CONTRATO_SUS,
  FONTES_PRODUCAO_SUS,
  FORMATOS_INDICADOR_SUS,
  type GravacaoAgenda,
  MODALIDADES_PRODUCAO_SUS,
  NIVEIS_SIGTAP_META,
  ORIGENS_APURACAO_SUS,
  PERIODICIDADES_META_SUS,
  REDES_ASSISTENCIA_SUS,
  rotuloDominioSus,
  SENTIDOS_INDICADOR_SUS,
  SITUACOES_CONTRATO_SUS,
  TIPOS_INDICADOR_SUS,
  TIPOS_META_SUS,
} from '@sgh/contratos';

/** O valor digitado ("1.234,56", "1234.56" ou "R$ 10") em centavos; nulo se vazio ou inválido. */
export function centavosDe(s: string): number | null {
  const x = s.trim().replace(/^R\$\s*/, '');
  if (!x) return null;
  const normal = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Math.round(Number(normal) * 100);
}
/** Centavos para o campo de edição ("1234,56"); vazio para zero. */
export const textoDeCentavos = (c: number | null | undefined): string =>
  c ? (c / 100).toFixed(2).replace('.', ',') : '';

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reaisDeCentavos = (c: number | null | undefined): string =>
  c === null || c === undefined ? '—' : REAIS.format(c / 100);

/** O número digitado com vírgula decimal; nulo se vazio ou inválido. */
export function numeroDe(s: string): number | null {
  const x = s.trim();
  if (!x) return null;
  const normal = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

/** AAAAMM → MM/AAAA. */
export const competenciaTexto = (c: string | null | undefined): string =>
  c && /^\d{6}$/.test(c) ? `${c.slice(4, 6)}/${c.slice(0, 4)}` : '—';
/** AAAAMM → AAAA-MM (o valor do campo de mês). */
export const competenciaParaCampo = (c: string | null | undefined): string =>
  c && /^\d{6}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4, 6)}` : '';
/** AAAA-MM → AAAAMM; nulo se vazio. */
export const competenciaDoCampo = (v: string): string | null =>
  /^\d{4}-\d{2}$/.test(v) ? v.replace('-', '') : null;

export const rotuloEsfera = (c: number) => rotuloDominioSus(ESFERAS_CONTRATO_SUS, c);
export const rotuloRede = (c: number) => rotuloDominioSus(REDES_ASSISTENCIA_SUS, c);
export const rotuloPeriodicidade = (c: number) => rotuloDominioSus(PERIODICIDADES_META_SUS, c);
export const rotuloTipoMeta = (c: string) => rotuloDominioSus(TIPOS_META_SUS, c);
export const rotuloIndicador = (c: number | null) => rotuloDominioSus(TIPOS_INDICADOR_SUS, c);
export const rotuloFormato = (c: number | null) => rotuloDominioSus(FORMATOS_INDICADOR_SUS, c);
export const rotuloAfericao = (c: number | null) => rotuloDominioSus(AFERICOES_SUS, c);
export const rotuloComplexidade = (c: number | null) => rotuloDominioSus(COMPLEXIDADES_SUS, c);
export const rotuloModalidade = (c: string | null) => rotuloDominioSus(MODALIDADES_PRODUCAO_SUS, c);
export const rotuloNivel = (c: string | null) => rotuloDominioSus(NIVEIS_SIGTAP_META, c);
export const rotuloSentido = (c: string | null) => rotuloDominioSus(SENTIDOS_INDICADOR_SUS, c);
export const rotuloEscore = (c: number | null) => rotuloDominioSus(ESCORES_SUS, c);
export const rotuloSituacao = (c: string) => rotuloDominioSus(SITUACOES_CONTRATO_SUS, c);
export const rotuloFonte = (c: string) => rotuloDominioSus(FONTES_PRODUCAO_SUS, c);
export const rotuloOrigem = (c: string | null) => rotuloDominioSus(ORIGENS_APURACAO_SUS, c);

/** Os dígitos do código SIGTAP de cada nível da meta. */
export const digitosDoNivel = (n: string | null): number | null =>
  NIVEIS_SIGTAP_META.find((x) => x.codigo === n)?.digitos ?? null;

/** Pode editar agora (a funcionalidade ligada no estabelecimento e a permissão de editar)? */
export const podeEditarSus = (g: GravacaoAgenda | null | undefined): boolean =>
  !!g && g.ligada && g.operacoes['editar']?.pode === true;

/** O formulário da meta como a tela o guarda (textos dos campos). */
export interface FormularioMetaSus {
  tipo: 'quantitativa' | 'qualitativa';
  descricao: string;
  periodicidade: number;
  inicio: string;
  fim: string;
  pontos: string;
  nivelSigtap: string | null;
  codigoSigtap: string;
  modalidade: string | null;
  complexidade: number | null;
  indicador: number | null;
  formato: number | null;
  sentido: string | null;
  unidade: string;
  afericao: number | null;
  valorMeta: string;
  ativa: boolean;
}

/** Os campos que faltam ou estão errados (o nome de cada um, para a tela listar); vazio quando dá para enviar. */
export function faltasDaMeta(f: FormularioMetaSus): string[] {
  const xs: string[] = [];
  if (f.descricao.trim().length < 3) xs.push('descricao');
  if (!competenciaDoCampo(f.inicio)) xs.push('inicio');
  if (f.fim && competenciaDoCampo(f.fim) && f.fim < f.inicio) xs.push('fim');
  const pontos = Number(f.pontos);
  if (!Number.isInteger(pontos) || pontos < 1 || pontos > 1000) xs.push('pontos');
  const meta = numeroDe(f.valorMeta);
  if (meta === null || meta <= 0) xs.push('valorMeta');
  if (f.tipo === 'quantitativa') {
    const d = digitosDoNivel(f.nivelSigtap);
    if (d === null) xs.push('nivelSigtap');
    else if (!new RegExp(`^\\d{${d}}$`).test(f.codigoSigtap.trim())) xs.push('codigoSigtap');
  } else {
    if (f.indicador === null) xs.push('indicador');
    if (f.formato === null) xs.push('formato');
    if (f.formato === 2 && meta !== 1) xs.push('valorMeta');
    if (f.formato === 7 && meta !== null && !Number.isInteger(meta)) xs.push('valorMeta');
  }
  return [...new Set(xs)];
}

/** O corpo da meta para a API: só os campos do tipo; os do outro tipo vão nulos. */
export function corpoDaMeta(f: FormularioMetaSus, versaoVista: number | null): Record<string, unknown> {
  const quanti = f.tipo === 'quantitativa';
  const simNao = !quanti && f.formato === 2;
  return {
    tipo: f.tipo,
    descricao: f.descricao.trim(),
    periodicidade: f.periodicidade,
    inicio: competenciaDoCampo(f.inicio),
    fim: f.fim ? competenciaDoCampo(f.fim) : null,
    pontos: Number(f.pontos),
    nivelSigtap: quanti ? f.nivelSigtap : null,
    codigoSigtap: quanti ? f.codigoSigtap.trim() : null,
    modalidade: quanti ? (f.modalidade ?? 'todas') : null,
    complexidade: quanti ? f.complexidade : null,
    indicador: quanti ? null : f.indicador,
    formato: quanti ? null : f.formato,
    sentido: quanti ? null : simNao ? 'maior' : (f.sentido ?? 'maior'),
    unidade: quanti ? null : f.unidade.trim() || null,
    afericao: quanti ? null : f.afericao,
    valorMeta: numeroDe(f.valorMeta),
    ativa: f.ativa,
    versaoVista,
  };
}

/** A competência anterior (AAAAMM): a última fechada, a referência padrão do painel. */
export function competenciaAnterior(c: string): string {
  const t = Number(c.slice(0, 4)) * 12 + Number(c.slice(4, 6)) - 2;
  return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, '0')}`;
}

/** A competência que fecha o período já terminou na competência atual (só então a apuração é registrada)? */
export const periodoEncerrado = (fimPeriodo: string, competenciaAtual: string): boolean =>
  fimPeriodo < competenciaAtual;
