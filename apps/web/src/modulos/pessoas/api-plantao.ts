// Cliente da fatia F3 da gestão de pessoas (M52.3): trocas de plantão (apoio, lista, plantões da escala, pedido,
// resposta, decisão e cancelamento), quem está de plantão agora com o acionamento do sobreaviso, e o dimensionamento de
// enfermagem (apoio, lista, prévia e registro). As gravações vão com o CSRF e a Idempotency-Key (uma por intenção);
// Problem Details viram ErroApi com o código da recusa. As respostas seguem os tipos de @sgh/contratos.
import type {
  AcionarSobreavisoEntrada,
  ApoioDimensionamento,
  ApoioTrocas,
  CalcularDimensionamentoEntrada,
  DimensionamentoLido,
  FiltroPlantaoAgoraEntrada,
  ListaDimensionamentos,
  ListaTrocas,
  PedirTrocaEntrada,
  PlantaoAgora,
  PlantoesParaTroca,
  ResultadoEscala,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const P = '/api/pessoas';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoEscala>();

// ── Trocas ──
export const lerApoioTrocas = (): Promise<ApoioTrocas> => ler(`${P}/trocas/apoio`, confiar<ApoioTrocas>());
export const lerTrocas = (f: { estado?: string | null; minhas?: boolean }): Promise<ListaTrocas> =>
  ler(
    `${P}/trocas${qs({ estado: f.estado || undefined, minhas: f.minhas ? 'sim' : undefined })}`,
    confiar<ListaTrocas>(),
  );
export const lerPlantoesParaTroca = (escala: number): Promise<PlantoesParaTroca> =>
  ler(`${P}/trocas/escala/${escala}`, confiar<PlantoesParaTroca>());
export const pedirTroca = (e: PedirTrocaEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/trocas`, e, resultado, novaChave('pessoas.troca'));
export const responderTroca = (
  troca: number,
  e: { versao: number; aceite: boolean; confirmacao: string | null },
): Promise<ResultadoEscala> =>
  enviar(`${P}/trocas/${troca}/resposta`, e, resultado, novaChave('pessoas.troca.resp'));
export const decidirTroca = (
  troca: number,
  e: { versao: number; aprovar: boolean; motivo: string | null },
): Promise<ResultadoEscala> =>
  enviar(`${P}/trocas/${troca}/decisao`, e, resultado, novaChave('pessoas.troca.dec'));
export const cancelarTroca = (
  troca: number,
  e: { versao: number; motivo: string },
): Promise<ResultadoEscala> =>
  enviar(`${P}/trocas/${troca}/cancelamento`, e, resultado, novaChave('pessoas.troca.canc'));

// ── Quem está de plantão agora ──
export const lerPlantaoAgora = (f: Partial<FiltroPlantaoAgoraEntrada>): Promise<PlantaoAgora> =>
  ler(
    `${P}/plantao-agora${qs({
      instante: f.instante,
      unidade: f.unidade,
      setor: f.setor || undefined,
      especialidade: f.especialidade,
      tipo: f.tipo,
    })}`,
    confiar<PlantaoAgora>(),
  );
export const acionarSobreaviso = (e: AcionarSobreavisoEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/plantao-agora/acionamentos`, e, resultado, novaChave('pessoas.sobreaviso'));
export const registrarChegada = (
  acionamento: number,
  e: { versao: number; chegouEm: string },
): Promise<ResultadoEscala> =>
  enviar(
    `${P}/plantao-agora/acionamentos/${acionamento}/chegada`,
    e,
    resultado,
    novaChave('pessoas.sobreaviso.cheg'),
  );
export const cancelarAcionamento = (
  acionamento: number,
  e: { versao: number; motivo: string },
): Promise<ResultadoEscala> =>
  enviar(
    `${P}/plantao-agora/acionamentos/${acionamento}/cancelamento`,
    e,
    resultado,
    novaChave('pessoas.sobreaviso.canc'),
  );

// ── Dimensionamento ──
export const lerApoioDimensionamento = (): Promise<ApoioDimensionamento> =>
  ler(`${P}/dimensionamento/apoio`, confiar<ApoioDimensionamento>());
export const lerDimensionamentos = (unidade: number | null): Promise<ListaDimensionamentos> =>
  ler(`${P}/dimensionamentos${qs({ unidade: unidade ?? undefined })}`, confiar<ListaDimensionamentos>());
export const previaDimensionamento = (e: CalcularDimensionamentoEntrada): Promise<DimensionamentoLido> =>
  enviar(`${P}/dimensionamento/previa`, e, confiar<DimensionamentoLido>(), novaChave('pessoas.dim.previa'));
export const registrarDimensionamento = (e: CalcularDimensionamentoEntrada): Promise<ResultadoEscala> =>
  enviar(`${P}/dimensionamentos`, e, resultado, novaChave('pessoas.dim'));
