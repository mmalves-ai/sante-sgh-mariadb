// Cliente da tela do eSocial (M53.6, etapa F5): o apoio, os parâmetros do empregador (vigências), a ficha do eSocial do
// colaborador, os eventos (lista, detalhe com o XML, gerar os de tabela e os do trabalhador, descartar, excluir pelo
// S-3000), os lotes (montar, enviar, registrar o retorno, cancelar), as pendências acumuladas (só a contagem) e a
// conciliação do transmissor único. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção); as respostas
// seguem os tipos de @sgh/contratos.
import type {
  ApoioEsocial,
  CancelarLoteEsocialEntrada,
  ConciliacaoEsocial,
  ConferirConciliacaoEsocialEntrada,
  DescartarEventoEsocialEntrada,
  DetalheEventoEsocial,
  DetalheLoteEsocial,
  EmpregadorEsocial,
  EmpregadorEsocialLido,
  EnviarLoteEsocialEntrada,
  EventoEsocialResumo,
  ExcluirEventoEsocialEntrada,
  FichaEsocialDoVinculo,
  FiltroConciliacaoEsocial,
  FiltroEventosEsocial,
  FiltroLotesEsocial,
  GerarFechamentoEsocialEntrada,
  GerarPagamentosEsocialEntrada,
  GerarRemuneracaoEsocialEntrada,
  GerarEventosTabelaEntrada,
  GerarEventoTrabalhadorEntrada,
  ListaEventosEsocial,
  ListaLotesEsocial,
  MontarLoteEsocialEntrada,
  PainelPeriodicosEsocial,
  PendenciasLegadoEsocial,
  PeriodoFolha,
  RegistrarFichaEsocialEntrada,
  ResultadoGeracaoEsocial,
  RetornoLoteEsocialEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const E = '/api/pessoas/esocial';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioEsocial = () => ler(`${E}/apoio`, confiar<ApoioEsocial>());

// ── Empregador ────────────────────────────────────────────────────────────────────────────────────────────────
export const lerEmpregadores = (empresa: number | null) =>
  ler(`${E}/empregadores${qs({ empresa })}`, confiar<EmpregadorEsocialLido[]>());
export const registrarEmpregador = (e: EmpregadorEsocial) =>
  enviar(`${E}/empregadores`, e, confiar<EmpregadorEsocialLido>(), novaChave('m53.esocial.empregador'));

// ── Ficha do colaborador ──────────────────────────────────────────────────────────────────────────────────────
export const lerFichaEsocial = (vinculo: number) =>
  ler(`${E}/fichas/${vinculo}`, confiar<FichaEsocialDoVinculo>());
export const registrarFichaEsocial = (vinculo: number, e: RegistrarFichaEsocialEntrada) =>
  enviar(`${E}/fichas/${vinculo}`, e, confiar<FichaEsocialDoVinculo>(), novaChave('m53.esocial.ficha'));

// ── Eventos ───────────────────────────────────────────────────────────────────────────────────────────────────
export const lerEventosEsocial = (f: FiltroEventosEsocial) =>
  ler(
    `${E}/eventos${qs({
      empresa: f.empresa,
      evento: f.evento,
      situacao: f.situacao,
      vinculo: f.vinculo,
      lote: f.lote,
      de: f.de,
      ate: f.ate,
    })}`,
    confiar<ListaEventosEsocial>(),
  );
export const lerEventoEsocial = (id: number) => ler(`${E}/eventos/${id}`, confiar<DetalheEventoEsocial>());
export const gerarEventosTabela = (e: GerarEventosTabelaEntrada) =>
  enviar(
    `${E}/eventos/tabela`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.tabela' : 'm53.esocial.tabela.previa'),
  );
export const gerarEventoTrabalhador = (e: GerarEventoTrabalhadorEntrada) =>
  enviar(
    `${E}/eventos/trabalhador`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.trabalhador' : 'm53.esocial.trabalhador.previa'),
  );
export const descartarEventoEsocial = (id: number, e: DescartarEventoEsocialEntrada) =>
  enviar(`${E}/eventos/${id}/descarte`, e, confiar<EventoEsocialResumo>(), novaChave('m53.esocial.descarte'));
export const excluirEventoEsocial = (id: number, e: ExcluirEventoEsocialEntrada) =>
  enviar(
    `${E}/eventos/${id}/exclusao`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.exclusao' : 'm53.esocial.exclusao.previa'),
  );

// ── Lotes ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const lerLotesEsocial = (f: FiltroLotesEsocial) =>
  ler(`${E}/lotes${qs({ empresa: f.empresa, situacao: f.situacao })}`, confiar<ListaLotesEsocial>());
export const lerLoteEsocial = (id: number) => ler(`${E}/lotes/${id}`, confiar<DetalheLoteEsocial>());
export const montarLoteEsocial = (e: MontarLoteEsocialEntrada) =>
  enviar(`${E}/lotes`, e, confiar<DetalheLoteEsocial>(), novaChave('m53.esocial.lote'));
export const enviarLoteEsocial = (id: number, e: EnviarLoteEsocialEntrada) =>
  enviar(`${E}/lotes/${id}/envio`, e, confiar<DetalheLoteEsocial>(), novaChave('m53.esocial.envio'));
export const registrarRetornoEsocial = (id: number, e: RetornoLoteEsocialEntrada) =>
  enviar(`${E}/lotes/${id}/retorno`, e, confiar<DetalheLoteEsocial>(), novaChave('m53.esocial.retorno'));
export const consultarRetornoEsocial = (id: number, e: EnviarLoteEsocialEntrada) =>
  enviar(`${E}/lotes/${id}/consulta`, e, confiar<DetalheLoteEsocial>(), novaChave('m53.esocial.consulta'));
export const cancelarLoteEsocial = (id: number, e: CancelarLoteEsocialEntrada) =>
  enviar(
    `${E}/lotes/${id}/cancelamento`,
    e,
    confiar<DetalheLoteEsocial>(),
    novaChave('m53.esocial.lote.cancelar'),
  );

// ── Pendências e conciliação ──────────────────────────────────────────────────────────────────────────────────
export const lerPendenciasEsocial = (empresa: number | null) =>
  ler(`${E}/pendencias${qs({ empresa })}`, confiar<PendenciasLegadoEsocial>());
export const lerConciliacaoEsocial = (f: FiltroConciliacaoEsocial) =>
  ler(
    `${E}/conciliacao${qs({ empresa: f.empresa, competencia: f.competencia })}`,
    confiar<ConciliacaoEsocial>(),
  );
export const conferirConciliacaoEsocial = (e: ConferirConciliacaoEsocialEntrada) =>
  enviar(`${E}/conciliacao`, e, confiar<ConciliacaoEsocial>(), novaChave('m53.esocial.conciliacao'));

// ── Periódicos (M53.7): painel do período, S-1200, S-1210, S-1299 e S-1298 ────────────────────────────────────
export const lerPainelPeriodicos = (f: PeriodoFolha) =>
  ler(
    `${E}/periodicos${qs({ empresa: f.empresa, apuracao: f.apuracao, periodo: f.periodo })}`,
    confiar<PainelPeriodicosEsocial>(),
  );
export const gerarRemuneracaoEsocial = (e: GerarRemuneracaoEsocialEntrada) =>
  enviar(
    `${E}/periodicos/remuneracao`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.s1200' : 'm53.esocial.s1200.previa'),
  );
export const gerarPagamentosEsocial = (e: GerarPagamentosEsocialEntrada) =>
  enviar(
    `${E}/periodicos/pagamentos`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.s1210' : 'm53.esocial.s1210.previa'),
  );
export const gerarFechamentoEsocial = (e: GerarFechamentoEsocialEntrada) =>
  enviar(
    `${E}/periodicos/fechamento`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.s1299' : 'm53.esocial.s1299.previa'),
  );
export const gerarReaberturaEsocial = (e: GerarFechamentoEsocialEntrada) =>
  enviar(
    `${E}/periodicos/reabertura`,
    e,
    confiar<ResultadoGeracaoEsocial>(),
    novaChave(e.gravar ? 'm53.esocial.s1298' : 'm53.esocial.s1298.previa'),
  );
