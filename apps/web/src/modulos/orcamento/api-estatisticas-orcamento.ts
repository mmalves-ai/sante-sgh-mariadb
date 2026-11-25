// Cliente do orçamento estatístico e dos indicadores orçamentários por setor (C1-129): o catálogo (grupos, dados
// estatísticos e indicadores), o cadastro do indicador, a grade da versão (indicador × setor × mês) com o painel orçado ×
// realizado, a projeção da linha nova e a gravação da linha. As gravações vão com o CSRF e a Idempotency-Key (uma por
// intenção); Problem Details viram ErroApi com o código da recusa.
import type { GrupoPainelIndicador, IndicadorOrcamentarioEntrada } from '@sgh/dominio-financeiro';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const O = '/api/financeiro/orcamento';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface IndicadorOrcamentarioVisao extends IndicadorOrcamentarioEntrada {
  readonly id: number;
  readonly versao: number;
}
export interface CatalogoIndicadores {
  readonly grupos: { id: number; codigo: string; descricao: string }[];
  readonly tiposDado: { id: number; codigo: string; descricao: string; unidade: string }[];
  readonly indicadores: IndicadorOrcamentarioVisao[];
}
export interface CelulaDaGrade {
  readonly id: number;
  readonly orcadoCent: number;
  readonly projetadaCent: number | null;
  readonly versao: number;
}
export interface LinhaDaGrade {
  readonly indicadorId: number;
  readonly centroId: number;
  readonly celulas: Record<string, CelulaDaGrade>;
  readonly realizado: Record<string, number>;
  readonly projecao: Record<string, number | null>;
}
export interface GradeEstatistica {
  readonly versaoId: number;
  readonly ano: number;
  readonly situacao: string;
  readonly editavel: boolean;
  readonly meses: string[];
  readonly ate: string;
  readonly centros: { id: number; codigo: number; nome: string }[];
  readonly indicadores: IndicadorOrcamentarioVisao[];
  readonly linhas: LinhaDaGrade[];
  readonly painel: GrupoPainelIndicador[];
}
export interface CelulaParaEnviar {
  readonly competencia: string;
  readonly quantidade: number | null;
  readonly projetada: number | null;
  readonly versao: number | null;
}

export const lerCatalogoIndicadores = () =>
  ler(`${O}/indicadores-estatisticos`, confiar<CatalogoIndicadores>());
export const criarIndicadorOrcamentario = (e: IndicadorOrcamentarioEntrada) =>
  enviar(`${O}/indicadores-estatisticos`, e, confiar<{ id: number }>(), novaChave('c1129.indicador.criar'));
export const alterarIndicadorOrcamentario = (
  id: number,
  e: IndicadorOrcamentarioEntrada & { versao: number },
) =>
  enviar(
    `${O}/indicadores-estatisticos/${id}`,
    e,
    confiar<{ versao: number }>(),
    novaChave('c1129.indicador.alterar'),
  );
export const lerGradeEstatistica = (versao: number, ate: string | null) =>
  ler(`${O}/versoes/${versao}/estatisticas${qs({ ate })}`, confiar<GradeEstatistica>());
export const lerProjecaoLinha = (versao: number, indicador: number, centro: number) =>
  ler(
    `${O}/versoes/${versao}/estatisticas/projecao${qs({ indicador, centro })}`,
    confiar<{ projecao: Record<string, number | null>; realizado: Record<string, number> }>(),
  );
export const gravarLinhaEstatistica = (
  versao: number,
  e: { indicador: number; centro: number; celulas: CelulaParaEnviar[] },
) =>
  enviar(
    `${O}/versoes/${versao}/estatisticas`,
    e,
    confiar<{ incluidas: number; alteradas: number; retiradas: number }>(),
    novaChave('c1129.estatistica.linha'),
  );
