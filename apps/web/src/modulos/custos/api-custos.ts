// Cliente da tela "Centros de custo e critérios de rateio" (M54, etapa 4): apoio, estrutura (classificação, ordem e
// critério do rateio), matriz das estatísticas da competência, coleta e lançamento manual. As gravações vão com o CSRF e
// a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o código da recusa. As respostas seguem os tipos
// de @sgh/contratos.
import type {
  ApoioCustos,
  CentroCustoEstrutura,
  ClassificarCentro,
  ColetaEstatisticas,
  LancarEstatistica,
  ListaEstruturaCustos,
  MatrizEstatisticas,
  ValorEstatistica,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const C = '/api/custos';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioCustos = () => ler(`${C}/apoio`, confiar<ApoioCustos>());
export const lerEstruturaCustos = () => ler(`${C}/centros`, confiar<ListaEstruturaCustos>());
export const classificarCentro = (id: number, e: ClassificarCentro) =>
  enviar(
    `${C}/centros/${id}`,
    e,
    confiar<{ centro: CentroCustoEstrutura; mudou: boolean }>(),
    novaChave('m54.classificar'),
  );
export const lerMatrizEstatisticas = (competencia: string) =>
  ler(`${C}/estatisticas${qs({ competencia })}`, confiar<MatrizEstatisticas>());
export const coletarEstatisticas = (competencia: string) =>
  enviar(`${C}/estatisticas/coleta`, { competencia }, confiar<ColetaEstatisticas>(), novaChave('m54.coleta'));
export const lancarEstatistica = (e: LancarEstatistica) =>
  enviar(
    `${C}/estatisticas/lancamentos`,
    e,
    confiar<{ valor: ValorEstatistica; substituidas: number }>(),
    novaChave('m54.lancamento'),
  );
