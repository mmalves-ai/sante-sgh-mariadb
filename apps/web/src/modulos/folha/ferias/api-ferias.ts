// Cliente das telas de férias e 13º (M53.4, etapa F3): o apoio, o saldo do colaborador, a escala, programar, o detalhe
// com o recibo, calcular (prévia ou gravado) e cancelar; as parcelas do 13º do ano e o cálculo de uma parcela (o detalhe,
// a memória e o descarte do 13º são os do cálculo: `api-calculo.ts`); as férias do próprio colaborador. As gravações vão
// com o CSRF e a Idempotency-Key (uma por intenção). As respostas seguem os tipos de @sgh/contratos.
import type {
  ApoioFeriasDecimo,
  CalcularDecimoEntrada,
  CalcularFeriasEntrada,
  CancelarFeriasEntrada,
  DetalheFerias,
  FiltroFerias,
  ListaFerias,
  ListaProcessosFolha,
  MinhasFerias,
  ProgramarFeriasEntrada,
  ResultadoCalculoDecimo,
  ResultadoCalculoFerias,
  ResultadoFolha,
  ResultadoProgramacaoFerias,
  SaldoFerias,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const F = '/api/pessoas/folha';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioFerias = () => ler(`${F}/ferias/apoio`, confiar<ApoioFeriasDecimo>());
export const lerSaldoFerias = (vinculo: number) =>
  ler(`${F}/ferias/saldo${qs({ vinculo })}`, confiar<SaldoFerias>());
export const lerEscalaFerias = (f: FiltroFerias) =>
  ler(
    `${F}/ferias${qs({ vinculo: f.vinculo, empresa: f.empresa, de: f.de, ate: f.ate, situacao: f.situacao })}`,
    confiar<ListaFerias>(),
  );
export const programarFerias = (e: ProgramarFeriasEntrada) =>
  enviar(`${F}/ferias`, e, confiar<ResultadoProgramacaoFerias>(), novaChave('m53.ferias'));
export const lerDetalheFerias = (id: number) => ler(`${F}/ferias/${id}`, confiar<DetalheFerias>());
export const calcularFerias = (id: number, e: CalcularFeriasEntrada) =>
  enviar(
    `${F}/ferias/${id}/calculo`,
    e,
    confiar<ResultadoCalculoFerias>(),
    novaChave(e.simular ? 'm53.ferias.previa' : 'm53.ferias.recibo'),
  );
export const cancelarFerias = (id: number, e: CancelarFeriasEntrada) =>
  enviar(`${F}/ferias/${id}/cancelamento`, e, confiar<ResultadoFolha>(), novaChave('m53.ferias.cancelar'));
/** O aviso e o recibo de férias em PDF/A (com o salário; leitura auditada). */
export const urlReciboFeriasPdf = (id: number) => `${F}/ferias/${id}/recibo/pdf`;

export const lerDecimos = (f: { empresa?: number | null; ano?: number | null }) =>
  ler(`${F}/decimo${qs({ empresa: f.empresa, ano: f.ano })}`, confiar<ListaProcessosFolha>());
export const calcularDecimo = (e: CalcularDecimoEntrada) =>
  enviar(
    `${F}/decimo`,
    e,
    confiar<ResultadoCalculoDecimo>(),
    novaChave(e.simular ? 'm53.decimo.previa' : 'm53.decimo'),
  );

export const lerMinhasFerias = (vinculo: number | null) =>
  ler(`/api/pessoas/meu/ferias${qs({ vinculo })}`, confiar<MinhasFerias>());
