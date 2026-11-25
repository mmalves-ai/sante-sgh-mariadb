// Cliente da reserva de equipamentos e hemocomponentes da cirurgia (F8, 04-CC linha 103):
// /api/cirurgia/agendamentos/:id/reservas. As reservas, o período padrão (a janela da cirurgia) e as opções; reservar
// equipamento, pedir hemocomponente, ligar à requisição transfusional e cancelar (nada se apaga).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const base = (agendamento: number) => `/api/cirurgia/agendamentos/${agendamento}/reservas`;

const periodo = z.object({ inicio: z.string(), fim: z.string() });
const esquemaReservas = z.object({
  agendamento: z.number(),
  numero: z.string(),
  situacao: z.string(),
  aberta: z.boolean(),
  periodo: periodo.nullable(),
  equipamentos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      sequencia: z.number(),
      equipamento: z.number(),
      codigo: z.string(),
      nome: z.string(),
      quantidade: z.number(),
      inicio: z.string(),
      fim: z.string(),
      situacao: z.string(),
    }),
  ),
  hemocomponentes: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      sequencia: z.number(),
      hemocomponente: z.number(),
      sigla: z.string(),
      descricao: z.string(),
      quantidade: z.number(),
      quantidadeReservada: z.number(),
      provaCruzada: z.string(),
      situacao: z.string(),
      observacao: z.string().nullable(),
      requisicaoItem: z.number().nullable(),
      requisicaoNumero: z.string().nullable(),
      bolsasLiberadas: z.number().nullable(),
    }),
  ),
  opcoes: z.object({
    equipamentos: z.array(z.object({ id: z.number(), codigo: z.string(), nome: z.string() })),
    hemocomponentes: z.array(
      z.object({ id: z.number(), sigla: z.string(), descricao: z.string(), exigeProva: z.boolean() }),
    ),
    requisicoes: z.array(
      z.object({
        item: z.number(),
        requisicao: z.string(),
        hemocomponente: z.number(),
        sigla: z.string(),
        bolsas: z.number(),
        liberadas: z.number(),
        situacao: z.string(),
      }),
    ),
  }),
});
export type ReservasDaCirurgia = z.infer<typeof esquemaReservas>;

const esquemaGravado = z.object({ id: z.number().nullable().optional() }).passthrough();

export const lerReservasCirurgia = (agendamento: number) => ler(base(agendamento), esquemaReservas);

export const reservarEquipamento = (
  agendamento: number,
  corpo: { equipamento: number; quantidade: number; inicio: string; fim: string },
) => enviar(`${base(agendamento)}/equipamentos`, corpo, esquemaGravado, novaChave('reserva-equipamento'));

export const pedirHemocomponente = (
  agendamento: number,
  corpo: { hemocomponente: number; quantidade: number; observacao?: string },
) =>
  enviar(`${base(agendamento)}/hemocomponentes`, corpo, esquemaGravado, novaChave('reserva-hemocomponente'));

export const ligarRequisicao = (
  agendamento: number,
  reserva: number,
  requisicaoItem: number,
  versao: number,
) =>
  enviar(
    `${base(agendamento)}/hemocomponentes/${reserva}/requisicao`,
    { requisicaoItem, versao },
    esquemaGravado,
    novaChave('reserva-requisicao'),
  );

export const cancelarReserva = (
  agendamento: number,
  tipo: 'equipamentos' | 'hemocomponentes',
  reserva: number,
  versao: number,
) =>
  enviar(
    `${base(agendamento)}/${tipo}/${reserva}/cancelar`,
    { versao },
    esquemaGravado,
    novaChave('reserva-cancelar'),
  );
