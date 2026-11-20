// Cliente das telas do cálculo mensal da folha (M53.3, etapa F2): o apoio, o salário contratual do vínculo (leitura
// sensível e auditada no servidor), os parâmetros da folha da empresa, os cálculos da competência (prévia sem gravar e o
// cálculo gravado), o detalhe com a prova da soma, as linhas do colaborador com a memória e o descarte com motivo. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção). As respostas seguem os tipos de @sgh/contratos.
import type {
  ApoioCalculoFolha,
  CalcularFolhaEntrada,
  DescartarProcessoFolhaEntrada,
  DetalheProcessoFolha,
  LinhasDoVinculoFolha,
  ListaParametrosFolha,
  ListaProcessosFolha,
  ListaSalarios,
  MeuHolerite,
  RegistrarParametrosFolhaEntrada,
  RegistrarSalarioEntrada,
  ResultadoCalculoFolha,
  ResultadoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const F = '/api/pessoas/folha';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioCalculo = () => ler(`${F}/calculo/apoio`, confiar<ApoioCalculoFolha>());

export const lerSalarios = (vinculo: number) =>
  ler(`${F}/salarios${qs({ vinculo })}`, confiar<ListaSalarios>());
export const registrarSalario = (e: RegistrarSalarioEntrada) =>
  enviar(`${F}/salarios`, e, confiar<ResultadoFolha>(), novaChave('m53.salario'));

export const lerParametros = (empresa: number) =>
  ler(`${F}/parametros${qs({ empresa })}`, confiar<ListaParametrosFolha>());
export const registrarParametros = (e: RegistrarParametrosFolhaEntrada) =>
  enviar(`${F}/parametros`, e, confiar<ResultadoFolha>(), novaChave('m53.parametros'));

/** Os processamentos da folha mensal (M53.4: o recibo de férias e as parcelas do 13º ficam nas próprias abas). */
export const lerCalculos = (f: { empresa?: number | null; competencia?: string | null }) =>
  ler(
    `${F}/calculos${qs({ empresa: f.empresa, competencia: f.competencia, tipo: 'mensal' })}`,
    confiar<ListaProcessosFolha>(),
  );
export const calcularFolha = (e: CalcularFolhaEntrada) =>
  enviar(
    `${F}/calculos`,
    e,
    confiar<ResultadoCalculoFolha>(),
    novaChave(e.simular ? 'm53.previa' : 'm53.calculo'),
  );
export const lerDetalheCalculo = (id: number) => ler(`${F}/calculos/${id}`, confiar<DetalheProcessoFolha>());
export const lerLinhasDoVinculo = (id: number, vinculo: number) =>
  ler(`${F}/calculos/${id}/vinculos/${vinculo}`, confiar<LinhasDoVinculoFolha>());
export const descartarCalculo = (id: number, e: DescartarProcessoFolhaEntrada) =>
  enviar(`${F}/calculos/${id}/descarte`, e, confiar<ResultadoFolha>(), novaChave('m53.descarte'));
/** O descarte da parcela do 13º, pela permissão do 13º. */
export const descartarDecimo = (id: number, e: DescartarProcessoFolhaEntrada) =>
  enviar(`${F}/decimo/${id}/descarte`, e, confiar<ResultadoFolha>(), novaChave('m53.decimo.descarte'));

/** O relatório de conferência do processamento em PDF/A (só IDs, contagens e somas). */
export const urlConferenciaPdf = (id: number) => `${F}/calculos/${id}/conferencia/pdf`;
/** O holerite do próprio colaborador em PDF/A. */
export const urlMeuHoleritePdf = (competencia: string, vinculo: number | null) =>
  `/api/pessoas/meu/holerite/pdf${qs({ competencia, vinculo })}`;

export const lerMeuHolerite = (f: { competencia?: string | null; vinculo?: number | null }) =>
  ler(
    `/api/pessoas/meu/holerite${qs({ competencia: f.competencia, vinculo: f.vinculo })}`,
    confiar<MeuHolerite>(),
  );
