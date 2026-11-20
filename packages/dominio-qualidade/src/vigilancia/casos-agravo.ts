// O ciclo do caso de agravo (ficha do M48, regra 8; manual m17 "Notificação compulsória de agravos"): aberto (com
// prazo) → notificado (autoridade, canal, número) ou descartado (motivo e justificativa). Nada é apagado; a notificação
// depois do prazo é aceita (o atraso fica no relatório) porque notificar tarde ainda é obrigatório.
import type {
  AbrirCasoAgravoEntrada,
  DescartarCasoAgravoEntrada,
  RegistrarNotificacaoAgravoEntrada,
  SituacaoCasoAgravo,
} from '@sgh/contratos';
import { msLocal } from '../nsp/prazos.js';

const DIA_MS = 86_400_000;
/** Até quantos dias para trás a vigilância abre um caso (o gatilho mais antigo que a fila mostra é de 30 dias). */
export const DIAS_MAXIMOS_GATILHO = 90;

export type RecusaAgravo =
  | 'versao-desatualizada'
  | 'caso-encerrado'
  | 'cid-nao-notificavel'
  | 'gatilho-futuro'
  | 'gatilho-antigo'
  | 'notificacao-antes-do-gatilho'
  | 'notificacao-futura'
  | 'caso-ja-aberto'
  | 'atendimento-de-outro-paciente'
  | 'exame-de-outro-paciente'
  | 'gatilho-nao-confirmado'
  | 'cid-inexistente'
  | 'paciente-inexistente';

/** Tolerância do relógio para "futuro" (o tablet e o servidor podem divergir alguns minutos). */
const TOLERANCIA_MS = 5 * 60_000;

/** Abertura: o gatilho não pode estar no futuro nem ter mais de 90 dias; o CID tem de ser notificável. */
export function recusaAbertura(
  e: Pick<AbrirCasoAgravoEntrada, 'origem' | 'gatilhoEm'>,
  cidEhNotificavel: boolean,
  agora: string,
): RecusaAgravo | null {
  const t = msLocal(e.gatilhoEm);
  const a = msLocal(agora);
  if (t > a + TOLERANCIA_MS) return 'gatilho-futuro';
  if (a - t > DIAS_MAXIMOS_GATILHO * DIA_MS) return 'gatilho-antigo';
  // O exame vem da configuração da vigilância (o CID pode não estar no cadastro); o resto exige o cadastro.
  if (!cidEhNotificavel && e.origem !== 'exame' && e.origem !== 'manual') return 'cid-nao-notificavel';
  return null;
}

interface EstadoCaso {
  readonly versao: number;
  readonly situacao: SituacaoCasoAgravo;
  readonly gatilhoEm: string;
}

/** Notificação: só do caso aberto, na versão lida, não antes do gatilho nem no futuro. */
export function recusaNotificacao(
  caso: EstadoCaso,
  e: Pick<RegistrarNotificacaoAgravoEntrada, 'versao' | 'notificadoEm'>,
  agora: string,
): RecusaAgravo | null {
  if (caso.versao !== e.versao) return 'versao-desatualizada';
  if (caso.situacao !== 'aberto') return 'caso-encerrado';
  if (msLocal(e.notificadoEm) > msLocal(agora) + TOLERANCIA_MS) return 'notificacao-futura';
  if (msLocal(e.notificadoEm) < msLocal(caso.gatilhoEm.slice(0, 16))) return 'notificacao-antes-do-gatilho';
  return null;
}

/** Descarte: só do caso aberto, na versão lida. */
export function recusaDescarte(
  caso: EstadoCaso,
  e: Pick<DescartarCasoAgravoEntrada, 'versao'>,
): RecusaAgravo | null {
  if (caso.versao !== e.versao) return 'versao-desatualizada';
  if (caso.situacao !== 'aberto') return 'caso-encerrado';
  return null;
}

export const MENSAGENS_RECUSA_AGRAVO: Readonly<Record<RecusaAgravo, string>> = {
  'versao-desatualizada': 'O caso foi alterado por outra pessoa. Abra de novo para ver a versão atual.',
  'caso-encerrado': 'O caso já foi notificado ou descartado.',
  'cid-nao-notificavel': 'O CID informado não está na lista de notificação compulsória do estabelecimento.',
  'gatilho-futuro': 'A data e a hora do gatilho não podem estar no futuro.',
  'gatilho-antigo':
    'O gatilho tem mais de 90 dias: fale com a coordenação da vigilância para o registro retroativo.',
  'notificacao-antes-do-gatilho': 'A notificação não pode ser anterior ao gatilho do caso.',
  'notificacao-futura': 'A data e a hora da notificação não podem estar no futuro.',
  'caso-ja-aberto': 'Já existe caso aberto ou notificado deste agravo para o paciente nos últimos 30 dias.',
  'atendimento-de-outro-paciente': 'O atendimento informado é de outro paciente.',
  'exame-de-outro-paciente': 'O exame informado é de outro paciente ou não tem resultado reagente.',
  'gatilho-nao-confirmado':
    'O gatilho não foi encontrado: o CID, o resultado ou o óbito não está registrado.',
  'cid-inexistente': 'O CID informado não existe no cadastro de CID-10 do estabelecimento.',
  'paciente-inexistente': 'O paciente informado não foi encontrado no cadastro.',
};
