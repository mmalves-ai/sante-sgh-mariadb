// Cliente das seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/pep/sumario-alta';

export const TIPOS_CONTEUDO = [
  'texto_livre',
  'diagnosticos',
  'procedimentos',
  'exames',
  'medicamentos',
  'evolucao_clinica',
  'plano_terapeutico',
  'orientacoes',
  'alergias',
  'dispositivos',
  'condicao_alta',
] as const;
export type TipoConteudo = (typeof TIPOS_CONTEUDO)[number];
export const TIPOS_ATENDIMENTO = [
  'todos',
  'internacao',
  'pronto_atendimento',
  'ambulatorio',
  'hospital_dia',
] as const;
export type TipoAtendimentoSecao = (typeof TIPOS_ATENDIMENTO)[number];
export const PERIODOS = [
  'atendimento_inteiro',
  'ultimas_24_horas',
  'ultimas_72_horas',
  'ultimo_registro',
] as const;
export type Periodo = (typeof PERIODOS)[number];
/** Os tipos que trazem dados do episódio (só eles aceitam recorte de tempo; a mesma regra do domínio). */
export const TIPOS_COM_PERIODO: ReadonlySet<string> = new Set([
  'diagnosticos',
  'procedimentos',
  'exames',
  'medicamentos',
  'evolucao_clinica',
  'dispositivos',
]);
/** Os tipos sem campo próprio no sumário: a tela da alta abre um texto para cada seção deles. */
export const TIPOS_DE_TEXTO: ReadonlySet<string> = new Set([
  'texto_livre',
  'orientacoes',
  'exames',
  'dispositivos',
]);

/** O texto de uma seção configurada no sumário (vai em `secoes`, pelo código). */
export interface TextoSecao {
  codigo: string;
  titulo?: string;
  texto: string;
}

export interface Componente {
  id: number | null;
  estabelecimento: number | null;
  codigo: string;
  descricao: string;
  tipoConteudo: TipoConteudo;
  tipoAtendimento: TipoAtendimentoSecao;
  ordem: number;
  obrigatorio: boolean;
  periodo: Periodo | null;
  /** Período próprio do cliente (id); vale no lugar do recorte fixo. */
  periodoConsulta: number | null;
  ativo: boolean;
  versao: number | null;
}
export interface SecaoVigente {
  codigo: string;
  descricao: string;
  tipoConteudo: TipoConteudo;
  ordem: number;
  obrigatorio: boolean;
  periodo: Periodo | null;
  periodoConsulta?: number | null;
  horasRetroativas?: number | null;
  origem: 'estabelecimento' | 'cliente' | 'padrao';
  /** Só nas seções do atendimento: de quando a quando os dados do episódio entram. */
  janela?: { desde: string; ate: string; ultimo: boolean } | null;
}
export interface PeriodoConsulta {
  id: number | null;
  codigo: string;
  descricao: string;
  atendimentoInteiro: boolean;
  horasRetroativas: number | null;
  ordem: number;
  ativo: boolean;
  versao: number | null;
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf': tokenCsrf() }),
    },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const lerSecoes = (tipo: TipoAtendimentoSecao) =>
  pedir<{ itens: Componente[]; vigentes: SecaoVigente[] }>(`${P}/secoes?tipo=${tipo}`);
export const gravarSecao = (c: Componente) =>
  pedir<{ id: number }>(`${P}/secoes`, 'PUT', {
    id: c.id,
    doCliente: c.estabelecimento === null,
    codigo: c.codigo,
    descricao: c.descricao,
    tipoConteudo: c.tipoConteudo,
    tipoAtendimento: c.tipoAtendimento,
    ordem: c.ordem,
    obrigatorio: c.obrigatorio,
    periodo: TIPOS_COM_PERIODO.has(c.tipoConteudo) && c.periodoConsulta === null ? c.periodo : null,
    periodoConsulta: TIPOS_COM_PERIODO.has(c.tipoConteudo) ? c.periodoConsulta : null,
    ativo: c.ativo,
    versao: c.versao,
  });
export const secoesDoAtendimento = (atendimento: number) =>
  pedir<{ itens: SecaoVigente[] }>(`${P}/atendimento/${atendimento}/secoes`);
export const lerPeriodos = () => pedir<{ itens: PeriodoConsulta[] }>(`${P}/periodos`);
export const gravarPeriodo = (p: PeriodoConsulta) =>
  pedir<{ id: number }>(`${P}/periodos`, 'PUT', {
    id: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    atendimentoInteiro: p.atendimentoInteiro,
    horasRetroativas: p.atendimentoInteiro ? null : p.horasRetroativas,
    ordem: p.ordem,
    ativo: p.ativo,
    versao: p.versao,
  });
