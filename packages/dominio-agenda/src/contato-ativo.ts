// Contato ativo com o paciente antes da consulta (02-REC linha 39): a central liga, manda mensagem ou e-mail e registra
// cada tentativa com o canal, o motivo e o resultado. O resultado padronizado decide o que acontece:
//   - se o contato atingiu o paciente (sucesso) e o resultado confirma, a marcação aguardando fica confirmada;
//   - se o resultado é a desistência, a marcação é cancelada com o motivo "desistência do paciente" e a vaga volta à
//     grade (a lista de espera vê o horário livre);
//   - sem sucesso e sem resultado que encerre as tentativas, a próxima tentativa fica programada sozinha até o limite.
// Regra pura (sem banco): a porta própria lê o estado, chama `decidirContato` e grava o que a decisão manda.

export const CANAIS_CONTATO = ['telefone', 'whatsapp', 'sms', 'email', 'presencial', 'outro'] as const;
export type CanalContato = (typeof CANAIS_CONTATO)[number];

export const MOTIVOS_CONTATO = [
  'confirmacao_marcacao',
  'lembrete',
  'resultado_exame',
  'acompanhamento',
  'busca_ativa',
  'pesquisa_satisfacao',
  'cobranca',
  'outro',
] as const;
export type MotivoContato = (typeof MOTIVOS_CONTATO)[number];

/** Motivos que só fazem sentido ligados a uma marcação. */
export const MOTIVOS_DA_MARCACAO: readonly MotivoContato[] = ['confirmacao_marcacao', 'lembrete'];

export const EFEITOS_RESULTADO_CONTATO = ['confirmar', 'cancelar'] as const;
export type EfeitoResultadoContato = (typeof EFEITOS_RESULTADO_CONTATO)[number];

/** Tentativas sem sucesso antes de a central desistir (prática de mercado: três). */
export const LIMITE_TENTATIVAS_CONTATO = 3;
/** Intervalo até a próxima tentativa automática, em horas. */
export const INTERVALO_NOVA_TENTATIVA_HORAS = 4;
/** Tolerância do relógio para o contato informado (o atendente registra logo depois de desligar). */
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export interface ResultadoContatoPadrao {
  readonly codigo: string;
  /** O contato atingiu o paciente (ou quem responde por ele). */
  readonly sucesso: boolean;
  /** Não tentar de novo (número errado, paciente pediu para não ligar). */
  readonly encerraTentativas: boolean;
  /** O que o resultado faz na marcação ligada; nulo: só registra. */
  readonly efeitoMarcacao: EfeitoResultadoContato | null;
}

export interface MarcacaoDoContato {
  /** Significado da situação atual (aguardando, confirmada, cancelada, falta, chegada…). */
  readonly significado: string;
  readonly inicioEm: Date;
}

export interface EntradaDecisaoContato {
  readonly canal: string;
  readonly motivo: string;
  readonly contatoEm: Date;
  readonly agora: Date;
  readonly resultado: ResultadoContatoPadrao;
  readonly marcacao: MarcacaoDoContato | null;
  /** Tentativas já registradas (realizadas ou sem sucesso) para a mesma marcação ou o mesmo motivo. */
  readonly tentativasAnteriores: number;
  /** Quem cancela precisa da permissão de cancelar consulta. */
  readonly podeCancelar: boolean;
  readonly limiteTentativas?: number;
}

export type DecisaoContato =
  | {
      readonly ok: true;
      readonly situacao: 'realizado' | 'sem_sucesso';
      readonly efeito: EfeitoResultadoContato | null;
      readonly novaTentativaEm: Date | null;
      readonly alertas: readonly string[];
    }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string };

const recusar = (codigo: string, mensagem: string): DecisaoContato => ({ ok: false, codigo, mensagem });

/** Decide a situação do contato, o efeito na marcação e a próxima tentativa. */
export function decidirContato(e: EntradaDecisaoContato): DecisaoContato {
  if (!(CANAIS_CONTATO as readonly string[]).includes(e.canal))
    return recusar('canal-invalido', 'Escolha o canal do contato (telefone, WhatsApp, SMS, e-mail…).');
  if (!(MOTIVOS_CONTATO as readonly string[]).includes(e.motivo))
    return recusar('motivo-invalido', 'Escolha o motivo do contato.');
  if (Number.isNaN(e.contatoEm.getTime()))
    return recusar('contato-sem-data', 'Informe quando o contato foi feito.');
  if (e.contatoEm.getTime() > e.agora.getTime() + TOLERANCIA_FUTURO_MS)
    return recusar(
      'contato-no-futuro',
      'O contato não pode ter sido feito no futuro: para depois, programe.',
    );
  if (MOTIVOS_DA_MARCACAO.includes(e.motivo as MotivoContato) && !e.marcacao)
    return recusar(
      'motivo-exige-marcacao',
      'Confirmação e lembrete são de uma marcação: escolha a consulta.',
    );
  const alertas: string[] = [];
  let efeito = e.resultado.sucesso ? e.resultado.efeitoMarcacao : null;
  if (e.resultado.efeitoMarcacao && !e.resultado.sucesso)
    alertas.push('O resultado sem sucesso não muda a marcação.');
  if (efeito && !e.marcacao)
    return recusar(
      'efeito-sem-marcacao',
      'Este resultado confirma ou cancela uma consulta: escolha a marcação do contato.',
    );
  if (efeito && e.marcacao) {
    const passou = e.marcacao.inicioEm.getTime() <= e.agora.getTime();
    const sig = e.marcacao.significado;
    if (efeito === 'confirmar') {
      if (sig === 'confirmada') {
        efeito = null;
        alertas.push('A consulta já estava confirmada: só o contato fica registrado.');
      } else if (sig !== 'aguardando')
        return recusar(
          'marcacao-encerrada',
          'A marcação já não aguarda confirmação (cancelada, falta ou chegada).',
        );
      else if (passou) return recusar('consulta-passou', 'A consulta já passou: não há o que confirmar.');
    } else {
      if (!e.podeCancelar)
        return recusar(
          'sem-permissao-cancelar',
          'Cancelar a consulta pela desistência exige a permissão de cancelar consulta.',
        );
      if (sig !== 'aguardando' && sig !== 'confirmada')
        return recusar(
          'marcacao-encerrada',
          'A marcação já não pode ser cancelada (cancelada, falta ou chegada).',
        );
      if (passou)
        return recusar('consulta-passou', 'A consulta já passou: registre a falta, não o cancelamento.');
    }
  }
  const limite = e.limiteTentativas ?? LIMITE_TENTATIVAS_CONTATO;
  const tentativa = e.tentativasAnteriores + 1;
  let novaTentativaEm: Date | null = null;
  if (!e.resultado.sucesso && !e.resultado.encerraTentativas) {
    const prox = new Date(e.agora.getTime() + INTERVALO_NOVA_TENTATIVA_HORAS * 3_600_000);
    const antesDaConsulta = !e.marcacao || prox.getTime() < e.marcacao.inicioEm.getTime();
    if (tentativa < limite && antesDaConsulta) novaTentativaEm = prox;
    else
      alertas.push(`Tentativas encerradas (${tentativa} de ${limite}): a central não liga de novo sozinha.`);
  }
  return {
    ok: true,
    situacao: e.resultado.sucesso ? 'realizado' : 'sem_sucesso',
    efeito,
    novaTentativaEm,
    alertas,
  };
}

/** Item da fila da central: marcação próxima que pede contato. */
export interface ItemFilaContato {
  readonly inicioEm: Date;
  /** A última resposta à confirmação (mensagem ou contato) foi negativa. */
  readonly respostaNegativa: boolean;
  /** Contato pendente programado e já devido. */
  readonly contatoDevido: boolean;
  readonly tentativas: number;
}

/**
 * Ordem da fila: primeiro a resposta negativa (o paciente disse não na mensagem e a vaga pode voltar à grade), depois
 * o contato programado já devido, depois a consulta mais próxima e, no empate, quem teve menos tentativas.
 */
export function ordemFilaContato(a: ItemFilaContato, b: ItemFilaContato): number {
  const peso = (x: ItemFilaContato) => (x.respostaNegativa ? 0 : x.contatoDevido ? 1 : 2);
  return peso(a) - peso(b) || a.inicioEm.getTime() - b.inicioEm.getTime() || a.tentativas - b.tentativas;
}

/** Validação na hora do contato programado (sem banco). */
export function validarProgramacaoContato(e: {
  canal: string;
  motivo: string;
  programadoPara: Date;
  agora: Date;
}): string | null {
  if (!(CANAIS_CONTATO as readonly string[]).includes(e.canal)) return 'Escolha o canal do contato.';
  if (!(MOTIVOS_CONTATO as readonly string[]).includes(e.motivo)) return 'Escolha o motivo do contato.';
  if (Number.isNaN(e.programadoPara.getTime())) return 'Informe quando ligar.';
  if (e.programadoPara.getTime() < e.agora.getTime() - TOLERANCIA_FUTURO_MS)
    return 'O contato programado precisa ser para agora ou depois.';
  return null;
}
