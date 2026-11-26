// Busca ativa de resultados (F8, 05-SADT linha 24): o exame que ficou pendente na alta ou o resultado liberado DEPOIS
// da alta do paciente que é crítico, alterado ou cultura positiva entra na fila da equipe, que procura o paciente,
// registra cada tentativa de contato e encerra o caso com o desfecho. Regras puras (sem banco):
//   - entra na fila o resultado crítico, alterado ou de cultura positiva liberado depois da alta (antes dela, a equipe
//     assistencial já o recebeu: o valor crítico durante o atendimento é da vigia dos críticos);
//   - entra também o exame pendente na alta: pedido até a alta, sem resultado liberado e que passou da espera de
//     24 horas depois da alta (ainda sem resultado, ou liberado só depois dessa espera, mesmo normal); o liberado
//     normal dentro da espera segue pela entrega comum do resultado;
//   - o motivo do caso é o mais grave (crítico > alterado > pendente);
//   - prazo por gravidade: crítico em 24 horas, alterado ou cultura positiva em 72 horas da liberação, pendente em
//     72 horas do fim da espera; o caso com vários exames vence no prazo mais curto;
//   - a tentativa de contato tem resultado do vocabulário; o contato feito exige a orientação dada; a nova coleta
//     combinada é futura e só com o contato feito;
//   - o caso encerrado (concluído ou cancelado) não recebe contato nem muda; concluir exige o desfecho; "sem contato"
//     só depois de 3 tentativas sem sucesso; o desfecho do contato feito exige um contato feito; cancelar exige o motivo.

export type MotivoBuscaAtiva = 'resultado_critico' | 'resultado_alterado' | 'resultado_pendente';

/** Espera, depois da alta, para o exame sem resultado liberado virar pendente na busca ativa. */
export const ESPERA_PENDENTE_HORAS = 24;

export interface ResultadoCandidato {
  readonly critico: boolean;
  readonly anormal: boolean;
  readonly culturaPositiva: boolean;
  /** Liberação do resultado; nulo: o exame ainda não tem resultado liberado. */
  readonly liberadoEm: Date | null;
  /** Alta médica (ou saída) do atendimento; nulo: o paciente não teve alta. */
  readonly altaEm: Date | null;
  /** Pedido do exame (para o pendente: só o pedido até a alta conta); nulo: desconhecido, não vira pendente. */
  readonly solicitadoEm?: Date | null;
}

/** Fim da espera do pendente: a partir dele, o exame sem resultado entra na fila. */
export function fimEsperaPendente(altaEm: Date): Date {
  return new Date(altaEm.getTime() + ESPERA_PENDENTE_HORAS * 3_600_000);
}

/** O motivo do exame na busca ativa; nulo quando ele não entra na fila. */
export function motivoDaBuscaAtiva(r: ResultadoCandidato, agora: Date = new Date()): MotivoBuscaAtiva | null {
  if (!r.altaEm) return null;
  const alta = r.altaEm.getTime();
  const espera = fimEsperaPendente(r.altaEm).getTime();
  const pedidoNaInternacao = !!r.solicitadoEm && r.solicitadoEm.getTime() <= alta;
  if (r.liberadoEm === null)
    return pedidoNaInternacao && agora.getTime() >= espera ? 'resultado_pendente' : null;
  if (r.liberadoEm.getTime() <= alta) return null;
  if (r.critico) return 'resultado_critico';
  if (r.anormal || r.culturaPositiva) return 'resultado_alterado';
  if (pedidoNaInternacao && r.liberadoEm.getTime() >= espera) return 'resultado_pendente';
  return null;
}

/** O motivo do caso com vários exames: o mais grave. */
export function motivoDoCaso(motivos: readonly MotivoBuscaAtiva[]): MotivoBuscaAtiva | null {
  if (!motivos.length) return null;
  if (motivos.includes('resultado_critico')) return 'resultado_critico';
  return motivos.includes('resultado_alterado') ? 'resultado_alterado' : 'resultado_pendente';
}

export const PRAZO_BUSCA_ATIVA_HORAS: Readonly<Record<MotivoBuscaAtiva, number>> = {
  resultado_critico: 24,
  resultado_alterado: 72,
  resultado_pendente: 72,
};

/** De onde o prazo do exame conta: a liberação; para o pendente, o fim da espera depois da alta. */
export function referenciaDaBuscaAtiva(
  motivo: MotivoBuscaAtiva,
  liberadoEm: Date | null,
  altaEm: Date,
): Date {
  return motivo === 'resultado_pendente' || liberadoEm === null ? fimEsperaPendente(altaEm) : liberadoEm;
}

/** Prazo do exame a partir da sua referência (a liberação, ou o fim da espera do pendente). */
export function prazoDaBuscaAtiva(motivo: MotivoBuscaAtiva, referenciaEm: Date): Date {
  return new Date(referenciaEm.getTime() + PRAZO_BUSCA_ATIVA_HORAS[motivo] * 3_600_000);
}

/** Prazo do caso: o mais curto entre os dos seus exames. */
export function prazoDoCaso(itens: readonly { motivo: MotivoBuscaAtiva; referenciaEm: Date }[]): Date | null {
  if (!itens.length) return null;
  return new Date(Math.min(...itens.map((i) => prazoDaBuscaAtiva(i.motivo, i.referenciaEm).getTime())));
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
