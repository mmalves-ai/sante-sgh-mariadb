// Participação de cada membro da equipe no ato cirúrgico (F3.4, 04-CC linha 95): a entrada e a saída de cada um na
// sala e o percentual de participação, para a troca de cirurgião ou de anestesista no meio do ato ficar registrada
// (ONA/JCI: quem fez o quê e quando) e o repasse do auxiliar sair do percentual gravado. As horas vêm do dia do ato
// ("HH:MM") e ficam dentro da permanência do paciente na sala; o término antes do início vira a meia-noite.

/** Percentual padrão por função quando a tela não informa (prática dos honorários: auxiliares 30, 20 e 10%). */
export const PERCENTUAL_PADRAO_FUNCAO: Readonly<Record<string, number>> = Object.freeze({
  cirurgiao: 100,
  auxiliar1: 30,
  auxiliar2: 20,
  auxiliar3: 10,
});

export interface ParticipacaoInformada {
  readonly entrada: string | null;
  readonly saida: string | null;
  readonly percentual: number | null;
}

export interface ParticipacaoConferida {
  /** Minutos depois da entrada do paciente na sala (null = desde a entrada do paciente). */
  readonly entradaMin: number | null;
  /** Minutos depois da entrada do paciente na sala (null = até a saída do paciente). */
  readonly saidaMin: number | null;
  readonly percentual: number | null;
}

export type ResultadoParticipacao =
  | { readonly ok: true; readonly valor: ParticipacaoConferida }
  | { readonly ok: false; readonly campo: 'entrada' | 'saida' | 'percentual'; readonly texto: string };

const minutosDoDia = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Minutos de `h` depois de `referencia`, no mesmo ato (a hora menor que a referência é do dia seguinte). */
export function minutosDepois(referencia: string, h: string): number {
  return (minutosDoDia(h) - minutosDoDia(referencia) + 1440) % 1440;
}

/**
 * Confere a participação de um membro: as horas dentro da permanência do paciente na sala (entrada e saída da
 * sala), a saída depois da entrada e o percentual entre 0 e 100; sem percentual, vale o padrão da função.
 */
export function conferirParticipacao(
  funcao: string,
  p: ParticipacaoInformada,
  sala: { readonly entrada: string; readonly saida: string },
): ResultadoParticipacao {
  const duracao = minutosDepois(sala.entrada, sala.saida);
  const dentro = (h: string) => minutosDepois(sala.entrada, h) <= duracao;
  if (p.entrada !== null && !dentro(p.entrada))
    return {
      ok: false,
      campo: 'entrada',
      texto: 'A entrada do participante tem de estar dentro do tempo do paciente na sala.',
    };
  if (p.saida !== null && !dentro(p.saida))
    return {
      ok: false,
      campo: 'saida',
      texto: 'A saída do participante tem de estar dentro do tempo do paciente na sala.',
    };
  const entradaMin = p.entrada === null ? null : minutosDepois(sala.entrada, p.entrada);
  const saidaMin = p.saida === null ? null : minutosDepois(sala.entrada, p.saida);
  if ((saidaMin ?? duracao) <= (entradaMin ?? 0))
    return { ok: false, campo: 'saida', texto: 'A saída do participante tem de vir depois da entrada.' };
  if (p.percentual !== null && (p.percentual < 0 || p.percentual > 100))
    return { ok: false, campo: 'percentual', texto: 'O percentual de participação vai de 0 a 100.' };
  return {
    ok: true,
    valor: { entradaMin, saidaMin, percentual: p.percentual ?? PERCENTUAL_PADRAO_FUNCAO[funcao] ?? null },
  };
}
