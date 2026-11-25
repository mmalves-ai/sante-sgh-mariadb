// Cliente das telas do centro cirúrgico (M18), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar); o código da recusa (ex.: sala-ocupada) fica em `problema.codigo`.
import {
  type DetalheAgendamento,
  esquemaDetalheAgendamento,
  esquemaGravacaoAgenda,
  esquemaListaCancelamentosCirurgia,
  esquemaListaHistoricoCirurgia,
  esquemaListaRealizadas,
  esquemaMapaCirurgico,
  esquemaOpcoesCirurgia,
  esquemaSalaCirurgica,
  esquemaUsuariosDaSala,
  type GravacaoAgenda,
  type ListaCancelamentosCirurgia,
  type ListaHistoricoCirurgia,
  type ListaRealizadas,
  type MapaCirurgico,
  type OpcoesCirurgia,
  type SalaCirurgica,
  type UsuariosDaSala,
} from '@sgh/contratos';
import { z } from 'zod';
import { gravar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa, novaChave } from '../exames/api-exames.js';

const P = '/api/cirurgia';

const esquemaGravacaoCirurgia = z.object({ agenda: esquemaGravacaoAgenda, registro: esquemaGravacaoAgenda });
const esquemaProfissionais = z.array(z.object({ id: z.number(), cod: z.number(), nome: z.string() }));
// Com as sugestões do cadastro do procedimento (C1-089): caráter, anestesia e duração; vazias quando não há.
const esquemaProcedimentos = z.array(
  z.object({
    codigo: z.number(),
    nome: z.string(),
    carater: z.number().nullable().optional(),
    anestesia: z.number().nullable().optional(),
    duracaoMin: z.number().nullable().optional(),
  }),
);

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────
export const lerOpcoesCirurgia = (): Promise<OpcoesCirurgia> => ler(`${P}/opcoes`, esquemaOpcoesCirurgia);
export const lerGravacaoCirurgia = (): Promise<{ agenda: GravacaoAgenda; registro: GravacaoAgenda }> =>
  ler(`${P}/gravacao`, esquemaGravacaoCirurgia);
export const lerMapa = (inicio: string | null, dias: number, sala: number | null): Promise<MapaCirurgico> =>
  ler(`${P}/mapa${qs({ inicio, dias, sala })}`, esquemaMapaCirurgico);
export const lerAgendamento = (id: number): Promise<DetalheAgendamento> =>
  ler(`${P}/agendamentos/${id}`, esquemaDetalheAgendamento);
export const lerSolicitacao = (id: number): Promise<DetalheAgendamento> =>
  ler(`${P}/estados/${id}`, esquemaDetalheAgendamento);
export const listarCanceladas = (
  de: string | null,
  ate: string | null,
): Promise<ListaCancelamentosCirurgia> =>
  ler(`${P}/cancelamentos${qs({ de, ate })}`, esquemaListaCancelamentosCirurgia);
export const listarHistoricoAgenda = (
  de: string | null,
  ate: string | null,
): Promise<ListaHistoricoCirurgia> => ler(`${P}/historico${qs({ de, ate })}`, esquemaListaHistoricoCirurgia);
export const listarRealizadas = (f: {
  de: string | null;
  ate: string | null;
  reg?: number | null;
  sala?: number | null;
}): Promise<ListaRealizadas> => ler(`${P}/realizadas${qs(f)}`, esquemaListaRealizadas);
export const listarSalas = (): Promise<SalaCirurgica[]> => ler(`${P}/salas`, z.array(esquemaSalaCirurgica));
export const lerUsuariosDaSala = (sala: number): Promise<UsuariosDaSala> =>
  ler(`${P}/salas/${sala}/usuarios`, esquemaUsuariosDaSala);
export const buscarProfissionais = (q: string) => ler(`${P}/profissionais${qs({ q })}`, esquemaProfissionais);
export const buscarProcedimentos = (q: string) => ler(`${P}/procedimentos${qs({ q })}`, esquemaProcedimentos);

// ── Gravações ─────────────────────────────────────────────────────────────────────────────────────
export const agendarCirurgia = (p: unknown, k: string) => gravar(`${P}/agendamentos`, p, k);
export const moverCirurgia = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendamentos/${id}/mover`, p, k);
export const cancelarCirurgia = (id: number, p: unknown, k: string) =>
  gravar(`${P}/agendamentos/${id}/cancelar`, p, k);
export const solicitarCirurgia = (p: unknown, k: string) => gravar(`${P}/solicitacoes`, p, k);
export const marcarAndamento = (id: number, p: unknown, k: string) =>
  gravar(`${P}/estados/${id}/andamento`, p, k);
export const cancelarSolicitacao = (id: number, p: unknown, k: string) =>
  gravar(`${P}/estados/${id}/cancelar`, p, k);
export const registrarPendencia = (id: number, p: unknown, k: string) =>
  gravar(`${P}/estados/${id}/pendencias`, p, k);
export const registrarCirurgia = (p: unknown, k: string) => gravar(`${P}/realizadas`, p, k);
export const revisarLigacao = (id: number, p: unknown, k: string) =>
  gravar(`${P}/realizadas/${id}/ligacao`, p, k);
export const definirUsuarioDaSala = (sala: number, p: unknown, k: string) =>
  gravar(`${P}/salas/${sala}/usuarios`, p, k);
