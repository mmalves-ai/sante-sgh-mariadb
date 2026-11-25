// Busca ativa de resultados (F8, 05-SADT linha 24): o resultado liberado DEPOIS da alta do paciente que é crítico,
// alterado ou cultura positiva entra na fila da equipe, que procura o paciente, registra cada tentativa de contato e
// encerra o caso com o desfecho. Regras puras (sem banco):
//   - entra na fila só o resultado liberado depois da alta (antes dela, a equipe assistencial já o recebeu: o valor
//     crítico durante o atendimento é da vigia dos críticos); o motivo é o mais grave do caso (crítico > alterado);
//   - prazo por gravidade: crítico em 24 horas, alterado ou cultura positiva em 72 horas da liberação;
//   - a tentativa de contato tem resultado do vocabulário; o contato feito exige a orientação dada; a nova coleta
//     combinada é futura e só com o contato feito;
//   - o caso encerrado (concluído ou cancelado) não recebe contato nem muda; concluir exige o desfecho; "sem contato"
//     só depois de 3 tentativas sem sucesso; o desfecho do contato feito exige um contato feito; cancelar exige o motivo.

export type MotivoBuscaAtiva = 'resultado_critico' | 'resultado_alterado';

export interface ResultadoCandidato {
  readonly critico: boolean;
  readonly anormal: boolean;
  readonly culturaPositiva: boolean;
  readonly liberadoEm: Date;
  /** Alta médica (ou saída) do atendimento; nulo: o paciente não teve alta. */
  readonly altaEm: Date | null;
}

/** O motivo do resultado na busca ativa; nulo quando ele não entra na fila. */
export function motivoDaBuscaAtiva(r: ResultadoCandidato): MotivoBuscaAtiva | null {
  if (!r.altaEm || r.liberadoEm.getTime() <= r.altaEm.getTime()) return null;
  if (r.critico) return 'resultado_critico';
  if (r.anormal || r.culturaPositiva) return 'resultado_alterado';
  return null;
}

/** O motivo do caso com vários exames: o mais grave. */
export function motivoDoCaso(motivos: readonly MotivoBuscaAtiva[]): MotivoBuscaAtiva | null {
  if (!motivos.length) return null;
  return motivos.includes('resultado_critico') ? 'resultado_critico' : 'resultado_alterado';
}

export const PRAZO_BUSCA_ATIVA_HORAS: Readonly<Record<MotivoBuscaAtiva, number>> = {
  resultado_critico: 24,
  resultado_alterado: 72,
};

/** Prazo do caso a partir da liberação mais antiga. */
export function prazoDaBuscaAtiva(motivo: MotivoBuscaAtiva, liberadoEm: Date): Date {
  return new Date(liberadoEm.getTime() + PRAZO_BUSCA_ATIVA_HORAS[motivo] * 3_600_000);
}

export const RESULTADOS_CONTATO = [
  'contato_realizado',
  'sem_resposta',
  'contato_invalido',
  'recado',
  'recusou',
] as const;
export type ResultadoContato = (typeof RESULTADOS_CONTATO)[number];

export const DESFECHOS_BUSCA_ATIVA = [
  'paciente_orientado',
  'paciente_retornou',
  'nova_coleta_realizada',
  'encaminhado',
  'sem_contato',
  'obito',
  'recusou',
] as const;
export type DesfechoBuscaAtiva = (typeof DESFECHOS_BUSCA_ATIVA)[number];

export type SituacaoBuscaAtiva = 'aberto' | 'em_contato' | 'suspenso' | 'concluido' | 'cancelado';

/** Tentativas sem sucesso antes de encerrar como "sem contato". */
export const TENTATIVAS_MINIMAS_SEM_CONTATO = 3;

export interface ProblemaBuscaAtiva {
  readonly campo: string;
  readonly mensagem: string;
}

export const casoEncerrado = (s: SituacaoBuscaAtiva) => s === 'concluido' || s === 'cancelado';

export interface ContatoProposto {
  readonly resultado: ResultadoContato;
  readonly orientacao: string | null;
  readonly contatadoEm: Date;
  readonly novaColetaEm: Date | null;
}

/** Confere a tentativa de contato antes de gravar (lista vazia: pode gravar). */
export function conferirContatoBuscaAtiva(
  situacao: SituacaoBuscaAtiva,
  c: ContatoProposto,
  agora: Date,
): ProblemaBuscaAtiva[] {
  const p: ProblemaBuscaAtiva[] = [];
  if (casoEncerrado(situacao))
    p.push({ campo: 'situacao', mensagem: 'O caso já foi encerrado: não recebe novo contato.' });
  if (!RESULTADOS_CONTATO.includes(c.resultado))
    p.push({ campo: 'resultado', mensagem: 'Informe o resultado da tentativa de contato.' });
  if (c.contatadoEm.getTime() > agora.getTime() + 5 * 60_000)
    p.push({ campo: 'contatadoEm', mensagem: 'O contato não pode estar no futuro.' });
  if (c.resultado === 'contato_realizado' && !(c.orientacao ?? '').trim())
    p.push({ campo: 'orientacao', mensagem: 'Registre a orientação dada ao paciente.' });
  if (c.novaColetaEm) {
    if (c.resultado !== 'contato_realizado')
      p.push({ campo: 'novaColetaEm', mensagem: 'A nova coleta só se combina com o contato feito.' });
    if (c.novaColetaEm.getTime() <= agora.getTime())
      p.push({ campo: 'novaColetaEm', mensagem: 'A nova coleta combinada tem de ser futura.' });
  }
  return p;
}

export interface ContatoFeito {
  readonly resultado: ResultadoContato;
}

/** Confere a conclusão do caso com o desfecho e os contatos já registrados. */
export function conferirConclusaoBuscaAtiva(
  situacao: SituacaoBuscaAtiva,
  desfecho: DesfechoBuscaAtiva | null,
  contatos: readonly ContatoFeito[],
): ProblemaBuscaAtiva[] {
  const p: ProblemaBuscaAtiva[] = [];
  if (casoEncerrado(situacao)) p.push({ campo: 'situacao', mensagem: 'O caso já foi encerrado.' });
  if (!desfecho || !DESFECHOS_BUSCA_ATIVA.includes(desfecho)) {
    p.push({ campo: 'desfecho', mensagem: 'Escolha o desfecho do caso.' });
    return p;
  }
  const feitos = contatos.filter((c) => c.resultado === 'contato_realizado').length;
  const semSucesso = contatos.length - feitos;
  if (desfecho === 'sem_contato' && semSucesso < TENTATIVAS_MINIMAS_SEM_CONTATO)
    p.push({
      campo: 'desfecho',
      mensagem: `"Sem contato" só depois de ${TENTATIVAS_MINIMAS_SEM_CONTATO} tentativas sem sucesso (há ${semSucesso}).`,
    });
  const exigeContato = desfecho === 'paciente_orientado' || desfecho === 'nova_coleta_realizada';
  if (exigeContato && feitos === 0)
    p.push({ campo: 'desfecho', mensagem: 'Registre antes o contato feito com o paciente.' });
  if (desfecho === 'recusou' && feitos === 0 && !contatos.some((c) => c.resultado === 'recusou'))
    p.push({ campo: 'desfecho', mensagem: 'Registre antes o contato em que o paciente recusou.' });
  return p;
}

/** Confere o cancelamento (caso aberto indevidamente): só com o motivo escrito. */
export function conferirCancelamentoBuscaAtiva(
  situacao: SituacaoBuscaAtiva,
  motivo: string | null,
): ProblemaBuscaAtiva[] {
  const p: ProblemaBuscaAtiva[] = [];
  if (casoEncerrado(situacao)) p.push({ campo: 'situacao', mensagem: 'O caso já foi encerrado.' });
  if ((motivo ?? '').trim().length < 5)
    p.push({ campo: 'observacao', mensagem: 'Escreva o motivo do cancelamento.' });
  return p;
}

/** Situação do caso depois de uma tentativa de contato. */
export const situacaoAposContato = (s: SituacaoBuscaAtiva): SituacaoBuscaAtiva =>
  casoEncerrado(s) ? s : 'em_contato';

/** O prazo venceu e o caso segue aberto. */
export const casoAtrasado = (s: SituacaoBuscaAtiva, prazo: Date | null, agora: Date) =>
  !casoEncerrado(s) && prazo !== null && prazo.getTime() < agora.getTime();
