// Cliente das telas da farmácia hospitalar e da farmácia clínica (M29). As gravações vão com o CSRF e a Idempotency-Key
// (uma por intenção de gravar: repetir o pedido não dispensa de novo); Problem Details viram ErroApi e a recusa de
// negócio traz o texto em português do servidor (dose já dispensada, etiqueta diferente, saldo insuficiente…).
import type {
  ApoioFarmacia,
  DoseDispensadaLida,
  EntregaSetor,
  FilaAvaliacao,
  FilaDispensacao,
  GravacaoFarmacia,
  IntervencaoLida,
  JanelaEntregas,
  LivroControladosLido,
  LoteFarmacia,
  MovimentoControladoLido,
  ParametrosIntegracaoFarmacia,
  ResultadoFarmacia,
  SaldoControlado,
  SubstituicaoLida,
  TipoEnvioAvaliacao,
  UnidadeFarmacia,
  WorklistFarmaceutico,
} from '@sgh/contratos';
import type { SugestaoDevolucao } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const F = '/api/farmacia';
/** As respostas da farmácia são tipos dos contratos: o cliente confere só que veio um objeto (D-RESP-29). */
const objeto = <T>() => z.custom<T>((v) => typeof v === 'object' && v !== null);
const lista = <T>() => z.custom<T[]>((v) => Array.isArray(v));

let sequencia = 0;
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m29.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}
const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoFarmacia> =>
  enviar(url, corpo, objeto<ResultadoFarmacia>(), chave);

export const CANAL_FARMACIA = `${F}/eventos`;
export const CANAL_AVALIACAO = `${F}/eventos/avaliacao`;

export const lerGravacao = (): Promise<GravacaoFarmacia> => ler(`${F}/gravacao`, objeto<GravacaoFarmacia>());
export const lerGravacaoEntrega = (): Promise<GravacaoFarmacia> =>
  ler(`${F}/gravacao/entrega`, objeto<GravacaoFarmacia>());
export const lerUnidades = (): Promise<UnidadeFarmacia[]> => ler(`${F}/unidades`, lista<UnidadeFarmacia>());
export const lerUnidadesAvaliacao = (): Promise<UnidadeFarmacia[]> =>
  ler(`${F}/unidades/avaliacao`, lista<UnidadeFarmacia>());

// ── Dispensação e devolução ──────────────────────────────────────────────────────────────────────────

export const lerFila = (unidade: string): Promise<FilaDispensacao> =>
  ler(`${F}/fila${qs({ unidade })}`, objeto<FilaDispensacao>());
export const dispensar = (e: unknown, chave: string) => gravar(`${F}/dispensar`, e, chave);
export const lerDoses = (
  reg: number,
): Promise<{ doses: DoseDispensadaLida[]; sugestoes: SugestaoDevolucao[] }> =>
  ler(
    `${F}/atendimentos/${reg}/doses`,
    objeto<{ doses: DoseDispensadaLida[]; sugestoes: SugestaoDevolucao[] }>(),
  );
export const devolver = (e: unknown, chave: string) => gravar(`${F}/devolucoes`, e, chave);
export const cancelarDose = (dose: number, motivo: string, chave: string) =>
  gravar(`${F}/doses/${dose}/cancelar`, { motivo }, chave);

export const lerApoio = (): Promise<ApoioFarmacia> => ler(`${F}/apoio`, objeto<ApoioFarmacia>());
export const lerLotes = (item: number, local: number): Promise<LoteFarmacia[]> =>
  ler(`${F}/lotes${qs({ item, local })}`, lista<LoteFarmacia>());

// ── Entrega ──────────────────────────────────────────────────────────────────────────────────────────

export const lerEntregas = (situacao: number, centro?: number | null): Promise<EntregaSetor[]> =>
  ler(`${F}/entregas${qs({ situacao, centro })}`, lista<EntregaSetor>());
export const lerJanelaEntregas = (): Promise<JanelaEntregas> =>
  ler(`${F}/entregas/janela`, objeto<JanelaEntregas>());
export const aceitar = (controle: number, e: unknown, chave: string) =>
  gravar(`${F}/entregas/${controle}/aceite`, e, chave);

// ── Avaliação ────────────────────────────────────────────────────────────────────────────────────────

export const lerAvaliacao = (unidade: string): Promise<FilaAvaliacao & { novos: number }> =>
  ler(`${F}/avaliacao${qs({ unidade })}`, objeto<FilaAvaliacao & { novos: number }>());
export const triar = (unidade: string, chave: string) => gravar(`${F}/avaliacao/triagem`, { unidade }, chave);
export const decidir = (item: number, e: unknown, chave: string) =>
  gravar(`${F}/avaliacao/${item}/decisao`, e, chave);
export const intervir = (item: number, e: unknown, chave: string) =>
  gravar(`${F}/avaliacao/${item}/intervencoes`, e, chave);
export const lerHistorico = (
  item: number,
  horarios: readonly number[],
): Promise<{ substituicoes: SubstituicaoLida[]; intervencoes: IntervencaoLida[] }> =>
  ler(
    `${F}/avaliacao/${item}/historico${qs({ horarios: horarios.join(',') })}`,
    objeto<{ substituicoes: SubstituicaoLida[]; intervencoes: IntervencaoLida[] }>(),
  );
export const lerMinhasIntervencoes = (): Promise<IntervencaoLida[]> =>
  ler(`${F}/intervencoes/minhas`, lista<IntervencaoLida>());
export const responder = (id: number, e: unknown, chave: string) =>
  gravar(`${F}/intervencoes/${id}/resposta`, e, chave);
export const lerWorklist = (): Promise<WorklistFarmaceutico> =>
  ler(`${F}/worklist`, objeto<WorklistFarmaceutico>());

// ── Controlados e livro ──────────────────────────────────────────────────────────────────────────────

export const lerControlados = (p: { inicio?: string | undefined; fim?: string | undefined }) =>
  ler(`${F}/controlados${qs(p)}`, objeto<{ inicio: string; fim: string; itens: SaldoControlado[] }>());
export const lerMovimentos = (item: number, p: { inicio?: string | undefined; fim?: string | undefined }) =>
  ler(
    `${F}/controlados/${item}/movimentos${qs(p)}`,
    objeto<{
      inicio: string;
      fim: string;
      movimentos: (MovimentoControladoLido & { documentoId: number })[];
    }>(),
  );
export const conferir = (e: unknown, chave: string) => gravar(`${F}/controlados/conferencia`, e, chave);
export const registrarPerda = (e: unknown, chave: string) => gravar(`${F}/controlados/perda`, e, chave);
export const lerLivro = (p: {
  livro: number;
  inicio?: string | undefined;
  fim?: string | undefined;
}): Promise<LivroControladosLido> => ler(`${F}/livro${qs(p)}`, objeto<LivroControladosLido>());
export const urlPdfLivro = (p: { livro: number; inicio?: string | undefined; fim?: string | undefined }) =>
  `${F}/livro/pdf${qs(p)}`;
export const fecharLivro = (e: unknown, chave: string) => gravar(`${F}/livro/fechar`, e, chave);

// ── Parâmetros e farmácia ambulatorial ───────────────────────────────────────────────────────────────

export const lerParametros = (): Promise<ParametrosIntegracaoFarmacia> =>
  ler(`${F}/parametros`, objeto<ParametrosIntegracaoFarmacia>());
export const lerTipos = (): Promise<TipoEnvioAvaliacao[]> =>
  ler(`${F}/avaliacao/tipos`, lista<TipoEnvioAvaliacao>());
export const lerAmbulatorial = () =>
  ler(
    `${F}/ambulatorial`,
    objeto<{
      ligada: boolean;
      motivo: string | null;
      dispensacoes: {
        id: number;
        paciente: number;
        item: number;
        lote: string;
        quantidade: number;
        em: string;
        escriturada: boolean;
      }[];
    }>(),
  );
export const dispensarAmbulatorial = (e: unknown, chave: string) =>
  gravar(`${F}/ambulatorial/dispensar`, e, chave);
export const escriturarSngpc = (e: unknown, chave: string) => gravar(`${F}/ambulatorial/sngpc`, e, chave);
