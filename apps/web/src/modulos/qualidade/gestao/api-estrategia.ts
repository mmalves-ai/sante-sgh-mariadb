// Cliente da API da gestão estratégica (C2-066, 01-ADM L118): mapa BSC, iniciativas com ações e horas, e reuniões de
// análise crítica. As regras (validação na hora) vêm de @sgh/dominio-qualidade, as mesmas da API.
import type { DesempenhoObjetivo } from '@sgh/dominio-qualidade';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../../exames/api-exames.js';

const como = <T>() => z.unknown().transform((v) => v as T);

export interface PainelEstrategia {
  perspectivas: { id: number; codigo: string; descricao: string; ordem: number }[];
  indicadores: { id: number; codigo: string; nome: string }[];
  mapas: {
    id: number;
    versao: number;
    nome: string;
    vigenciaInicio: string;
    vigenciaFim: string;
    ativo: boolean;
    objetivos: number;
  }[];
  iniciativas: {
    id: number;
    versao: number;
    codigo: string;
    titulo: string;
    situacao: string;
    prioridade: string;
    progresso: number;
    inicioPrevisto: string;
    terminoPrevisto: string;
    responsavel: string;
  }[];
  reunioes: {
    id: number;
    versao: number;
    numero: string;
    titulo: string;
    situacao: string;
    inicioPrevisto: string;
    competenciaInicio: string;
    competenciaFim: string;
  }[];
}

export interface IndicadorDoObjetivoTela {
  indicador: number;
  codigo: string;
  nome: string;
  peso: number | null;
  situacaoMeta: 'na_meta' | 'fora_da_meta' | 'sem_meta' | 'sem_valor' | null;
  valor: number | null;
  competencia: string | null;
}
export interface ObjetivoTela {
  id: number;
  versao: number;
  perspectiva: number;
  codigo: string;
  titulo: string;
  descricao: string | null;
  responsavel: string | null;
  ordem: number;
  indicadores: IndicadorDoObjetivoTela[];
  causas: number[];
  desempenho: DesempenhoObjetivo;
}
export interface MapaTela {
  id: number;
  versao: number;
  nome: string;
  descricao: string | null;
  missao: string | null;
  visao: string | null;
  valores: string | null;
  periodicidade: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  ativo: boolean;
  objetivos: ObjetivoTela[];
}
export interface AcaoTela {
  id: number;
  versao: number;
  sequencia: number;
  titulo: string;
  descricao: string | null;
  situacao: string;
  prioridade: string;
  progresso: number;
  inicioPrevisto: string;
  terminoPrevisto: string;
  inicioReal: string | null;
  terminoReal: string | null;
  duracaoPrevistaMinutos: number | null;
  responsavel: string;
  minutosApontados: number;
}
export interface IniciativaTela {
  id: number;
  versao: number;
  codigo: string;
  titulo: string;
  tipo: string;
  descricao: string | null;
  prioridade: string;
  situacao: string;
  mapa: number | null;
  responsavel: string;
  patrocinador: string | null;
  inicioPrevisto: string;
  terminoPrevisto: string;
  inicioReal: string | null;
  terminoReal: string | null;
  progresso: number;
  valorOrcamento: number | null;
  resultados: string | null;
  objetivos: { id: number; codigo: string; titulo: string }[];
  participantes: { usuario: string; papel: string }[];
  acoes: AcaoTela[];
  apontamentos: {
    id: number;
    acao: number;
    dataTrabalho: string;
    minutos: number;
    classificacao: string;
    descricao: string | null;
    pessoa: string;
  }[];
  horas: { total: number; porPessoa: { pessoa: string; minutos: number }[] };
}
export interface AnaliseNaPauta {
  id: number;
  naPauta: boolean;
  indicador: string;
  competencia: string;
  valor: number | null;
  resultado: string;
  tendencia: string | null;
  situacao: string;
  analise: string;
  acaoProposta: string | null;
}
export interface ReuniaoTela {
  id: number;
  versao: number;
  numero: string;
  titulo: string;
  situacao: string;
  mapa: number | null;
  competenciaInicio: string;
  competenciaFim: string;
  inicioPrevisto: string;
  fimPrevisto: string | null;
  realizadaEm: string | null;
  local: string | null;
  pauta: string | null;
  ata: string | null;
  responsavel: string;
  participantes: {
    id: number;
    versao: number;
    usuario: string | null;
    nome: string | null;
    convidado: string | null;
    papel: string;
    presenca: string;
    justificativa: string | null;
  }[];
  pautaAnalises: AnaliseNaPauta[];
  analisesDisponiveis: AnaliseNaPauta[];
  deliberacoes: {
    id: number;
    versao: number;
    sequencia: number;
    descricao: string;
    situacao: string;
    prazo: string | null;
    concluidaEm: string | null;
    objetivo: number | null;
    indicador: number | null;
    iniciativa: number | null;
    responsavel: string | null;
  }[];
}

const BASE = '/api/qualidade/estrategia';
const gravado = como<{ id: number; numero?: string; progressoIniciativa?: number }>();
const g = (caminho: string, corpo: unknown, rotulo: string) =>
  enviar(`${BASE}${caminho}`, corpo, gravado, novaChave(`estrategia.${rotulo}`));

export const lerPainelEstrategia = () => ler(BASE, como<PainelEstrategia>());
export const lerMapa = (id: number) => ler(`${BASE}/mapas/${id}`, como<MapaTela>());
export const lerIniciativa = (id: number) => ler(`${BASE}/iniciativas/${id}`, como<IniciativaTela>());
export const lerReuniao = (id: number) => ler(`${BASE}/reunioes/${id}`, como<ReuniaoTela>());

export const gravarPerspectiva = (c: unknown) => g('/perspectivas', c, 'perspectiva');
export const gravarMapa = (c: unknown) => g('/mapas', c, 'mapa');
export const gravarObjetivo = (c: unknown) => g('/objetivos', c, 'objetivo');
export const gravarIniciativa = (c: unknown) => g('/iniciativas', c, 'iniciativa');
export const mudarSituacaoIniciativa = (id: number, c: unknown) =>
  g(`/iniciativas/${id}/situacao`, c, 'iniciativa-situacao');
export const gravarAcao = (c: unknown) => g('/acoes', c, 'acao');
export const apontarHoras = (c: unknown) => g('/horas', c, 'horas');
export const gravarReuniao = (c: unknown) => g('/reunioes', c, 'reuniao');
export const gravarPauta = (id: number, c: unknown) => g(`/reunioes/${id}/pauta`, c, 'pauta');
export const registrarPresenca = (id: number, c: unknown) => g(`/reunioes/${id}/presenca`, c, 'presenca');
export const mudarSituacaoReuniao = (id: number, c: unknown) =>
  g(`/reunioes/${id}/situacao`, c, 'reuniao-situacao');
export const gravarDeliberacao = (c: unknown) => g('/deliberacoes', c, 'deliberacao');
