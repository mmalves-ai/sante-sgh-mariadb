// Cliente da aba de rescisão (M53.5, etapa F4): o apoio, a fila dos desligados de um intervalo, as rescisões do
// intervalo, calcular (prévia ou gravada), o detalhe com o termo, o cancelamento e o termo em PDF/A. As gravações vão
// com o CSRF e a Idempotency-Key (uma por intenção). As respostas seguem os tipos de @sgh/contratos.
import type {
  ApoioRescisao,
  CalcularRescisaoEntrada,
  CancelarRescisaoEntrada,
  DetalheRescisao,
  FiltroDesligados,
  FiltroRescisoes,
  ListaDesligados,
  ListaRescisoes,
  ResultadoCalculoRescisao,
  ResultadoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const F = '/api/pessoas/folha/rescisoes';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioRescisao = () => ler(`${F}/apoio`, confiar<ApoioRescisao>());
export const lerDesligados = (f: FiltroDesligados) =>
  ler(`${F}/desligados${qs({ de: f.de, ate: f.ate })}`, confiar<ListaDesligados>());
export const lerRescisoes = (f: FiltroRescisoes) =>
  ler(
    `${F}${qs({ vinculo: f.vinculo, empresa: f.empresa, de: f.de, ate: f.ate, situacao: f.situacao })}`,
    confiar<ListaRescisoes>(),
  );
export const calcularRescisao = (e: CalcularRescisaoEntrada) =>
  enviar(
    F,
    e,
    confiar<ResultadoCalculoRescisao>(),
    novaChave(e.simular ? 'm53.rescisao.previa' : 'm53.rescisao'),
  );
export const lerDetalheRescisao = (id: number) => ler(`${F}/${id}`, confiar<DetalheRescisao>());
export const cancelarRescisao = (id: number, e: CancelarRescisaoEntrada) =>
  enviar(`${F}/${id}/cancelamento`, e, confiar<ResultadoFolha>(), novaChave('m53.rescisao.cancelar'));
/** O termo de rescisão em PDF/A (com o salário; leitura auditada). */
export const urlTermoRescisaoPdf = (id: number) => `${F}/${id}/termo/pdf`;
