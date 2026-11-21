// Porta PRÓPRIA da etapa 2 do portal (M50): configuração da agenda online, pré-check-in, intenção de pagamento,
// conciliação da tesouraria e pesquisa de satisfação, sobre o MariaDB do cliente.
// O modelo ainda não tem estas estruturas com a forma da etapa 2: a configuração da agenda no portal, a intenção de
// pagamento com o gateway e a conciliação, e o pré-check-in/pesquisa ligados à conta do portal (o pre_checkin e a
// resposta_pesquisa_satisfacao existentes não guardam a conta, os documentos enviados, a reserva da conferência nem
// a nota ligada à marcação). Cada operação RECUSA com 503 `recurso-sem-modelo`, nomeando-a: nada é lido vazio nem
// gravado pela metade. O DDL pedido está em docs/obra/fatias/f22/saida/03-12.json.
// Melhoria: a recusa explícita substitui a leitura vazia; a tela interna mostra que o recurso depende do modelo.
import { indisponivel, semModelo } from '../porta-propria.js';
import { type GravadorAgendaOnline, METODOS_PORTA_AGENDA_ONLINE, type PortaAgendaOnline } from './porta.js';

export class PortaAgendaOnlinePropria implements PortaAgendaOnline {
  readonly destino = 'banco' as const;
  gravar<T>(): Promise<T> {
    return Promise.reject(semModelo('agendaOnline.gravar'));
  }
  configs(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.configs'));
  }
  config(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.config'));
  }
  preCheckinDaMarcacao(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.preCheckinDaMarcacao'));
  }
  preCheckinPorId(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.preCheckinPorId'));
  }
  preCheckinsDoPaciente(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.preCheckinsDoPaciente'));
  }
  filaPreCheckin(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.filaPreCheckin'));
  }
  pagamentoPorTransacao(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.pagamentoPorTransacao'));
  }
  pagamentoPorId(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.pagamentoPorId'));
  }
  pagamentosDoPaciente(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.pagamentosDoPaciente'));
  }
  pesquisasDoPaciente(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.pesquisasDoPaciente'));
  }
  tesouraria(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.tesouraria'));
  }
  pagamentoTesouraria(): Promise<never> {
    return Promise.reject(semModelo('agendaOnline.pagamentoTesouraria'));
  }
}

/** As gravações da etapa 2 (todas sem modelo): usadas só para nomear a recusa. */
export type { GravadorAgendaOnline };

export function portaAgendaOnlineIndisponivel(): PortaAgendaOnline {
  return indisponivel<PortaAgendaOnline>(METODOS_PORTA_AGENDA_ONLINE);
}
