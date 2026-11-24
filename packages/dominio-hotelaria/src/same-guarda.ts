// SAME pelo volume (04-HOT L126): a guarda física do prontuário, o local no arquivo e a movimentação entre setores. A
// unidade de trabalho é o volume (a pasta física com etiqueta), não o atendimento. A regra decide pelo TIPO e pelo
// SENTIDO da operação do cadastro (registro, saída, empréstimo, devolução, transferência, recebimento, descarte) e pelas
// exigências dela (destino, previsão de retorno, encerramento da guarda), nunca por um código numérico. Regras puras.

export const TIPOS_OPERACAO_GUARDA = [
  'registro',
  'saida',
  'emprestimo',
  'devolucao',
  'transferencia',
  'recebimento',
  'descarte',
] as const;
export type TipoOperacaoGuarda = (typeof TIPOS_OPERACAO_GUARDA)[number];
export const SENTIDOS_GUARDA = ['entrada', 'saida', 'neutro'] as const;
export type SentidoGuarda = (typeof SENTIDOS_GUARDA)[number];
export const SITUACOES_VOLUME = [
  'aberto',
  'encerrado',
  'arquivado',
  'emprestado',
  'extraviado',
  'eliminado',
] as const;
export type SituacaoVolume = (typeof SITUACOES_VOLUME)[number];

export interface OperacaoGuarda {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoOperacaoGuarda;
  readonly sentido: SentidoGuarda;
  readonly exigeDestino: boolean;
  readonly exigePrevisaoRetorno: boolean;
  readonly encerraGuarda: boolean;
}

/** As operações padrão do produto (semeadas em todo cliente; o de-para da origem fica no conector). */
export const OPERACOES_GUARDA_PADRAO: readonly OperacaoGuarda[] = [
  op('registro', 'Registro no arquivo', 'registro', 'entrada', false, false, false),
  op('saida', 'Saída para setor', 'saida', 'saida', true, true, false),
  op('emprestimo', 'Empréstimo (pesquisa, auditoria, jurídico)', 'emprestimo', 'saida', true, true, false),
  op('devolucao', 'Devolução ao arquivo', 'devolucao', 'entrada', false, false, false),
  op('transferencia', 'Transferência entre setores ou locais', 'transferencia', 'neutro', true, false, false),
  op('recebimento', 'Recebimento no setor de destino', 'recebimento', 'neutro', false, false, false),
  op('descarte', 'Descarte com aval da comissão', 'descarte', 'saida', false, false, true),
];

function op(
  codigo: string,
  descricao: string,
  tipo: TipoOperacaoGuarda,
  sentido: SentidoGuarda,
  exigeDestino: boolean,
  exigePrevisaoRetorno: boolean,
  encerraGuarda: boolean,
): OperacaoGuarda {
  return { codigo, descricao, tipo, sentido, exigeDestino, exigePrevisaoRetorno, encerraGuarda };
}

/** O estado do volume que a regra lê. */
export interface VolumeGuarda {
  readonly situacao: SituacaoVolume;
  /** O volume está no local de guarda do arquivo. */
  readonly noLocal: boolean;
  readonly localArquivo: number | null;
  /** O setor onde o volume está fora do arquivo (o destino do último movimento), ou null. */
  readonly setorAtual: number | null;
  /** Há movimento válido (não excluído) do volume. */
  readonly temMovimento: boolean;
  /** O tipo do último movimento válido. */
  readonly ultimoTipo: TipoOperacaoGuarda | null;
}

export interface PedidoGuarda {
  readonly operacao: OperacaoGuarda;
  readonly setorDestino: number | null;
  readonly localDestino: number | null;
  readonly previsaoRetorno: Date | null;
  readonly avalComissao: string | null;
  readonly responsavel: string | null;
  readonly agora: Date;
  /** Volumes já guardados no local de destino e a capacidade dele (null: sem limite). */
  readonly ocupacaoDestino?: { readonly volumes: number; readonly capacidade: number | null } | null;
}

export interface ProblemaGuarda {
  readonly campo: string;
  readonly mensagem: string;
}

/** Confere o movimento pedido sobre o estado do volume; devolve os problemas (vazio: pode gravar). */
export function conferirMovimentoGuarda(v: VolumeGuarda, p: PedidoGuarda): ProblemaGuarda[] {
  const o = p.operacao;
  const erros: ProblemaGuarda[] = [];
  const recusa = (campo: string, mensagem: string) => erros.push({ campo, mensagem });
  if (v.situacao === 'eliminado') return [{ campo: 'volume', mensagem: 'O volume foi eliminado.' }];
  if (v.situacao === 'extraviado' && o.sentido !== 'entrada')
    return [
      {
        campo: 'volume',
        mensagem: 'O volume está extraviado: só a devolução ao arquivo (reencontrado) é aceita.',
      },
    ];
  if (o.exigeDestino && p.setorDestino === null && p.localDestino === null)
    recusa('setorDestino', 'Informe o setor ou o local de destino.');
  if (o.exigePrevisaoRetorno) {
    if (!p.previsaoRetorno) recusa('previsaoRetorno', 'Informe a previsão de retorno.');
    else if (p.previsaoRetorno.getTime() <= p.agora.getTime())
      recusa('previsaoRetorno', 'A previsão de retorno tem de ser futura.');
  }
  if ((o.sentido === 'saida' || o.tipo === 'recebimento') && !p.responsavel?.trim())
    recusa('responsavel', 'Informe quem retira ou recebe o volume.');
  if (o.encerraGuarda && !p.avalComissao?.trim())
    recusa('avalComissao', 'O descarte exige o aval da comissão de revisão de prontuários.');
  if (o.tipo === 'registro') {
    if (v.temMovimento) recusa('operacao', 'O volume já está registrado no arquivo.');
    if (p.localDestino === null) recusa('localDestino', 'Informe o local de guarda do volume.');
  } else if (!v.temMovimento && v.situacao !== 'extraviado') {
    recusa('operacao', 'Registre o volume no arquivo antes de movimentá-lo.');
  } else if (o.sentido === 'saida') {
    if (!v.noLocal) recusa('operacao', 'O volume não está no arquivo: um lugar por vez.');
  } else if (o.sentido === 'entrada') {
    if (v.noLocal) recusa('operacao', 'O volume já está no arquivo.');
    if (p.localDestino === null && v.localArquivo === null)
      recusa('localDestino', 'Informe o local de guarda do volume.');
  } else if (o.tipo === 'recebimento') {
    if (v.noLocal || v.setorAtual === null)
      recusa('operacao', 'O volume não foi enviado a um setor: registre a ocorrência.');
    else if (p.setorDestino !== null && p.setorDestino !== v.setorAtual)
      recusa('setorDestino', 'O volume não foi enviado a este setor: registre a ocorrência.');
    else if (v.ultimoTipo === 'recebimento') recusa('operacao', 'O volume já foi recebido neste setor.');
  } else if (o.tipo === 'transferencia') {
    if (v.noLocal && p.localDestino === null)
      recusa('localDestino', 'No arquivo, a transferência é para outro local de guarda.');
    if (v.noLocal && p.localDestino !== null && p.localDestino === v.localArquivo)
      recusa('localDestino', 'O volume já está neste local.');
    if (!v.noLocal && (p.setorDestino === null || p.setorDestino === v.setorAtual))
      recusa('setorDestino', 'Fora do arquivo, a transferência é para outro setor.');
  }
  const entraNoLocal =
    p.localDestino !== null &&
    (o.tipo === 'registro' || o.sentido === 'entrada' || (o.tipo === 'transferencia' && v.noLocal));
  if (
    entraNoLocal &&
    p.ocupacaoDestino?.capacidade != null &&
    p.ocupacaoDestino.volumes >= p.ocupacaoDestino.capacidade
  )
    recusa('localDestino', 'O local de guarda está cheio.');
  return erros;
}

export interface EfeitoGuarda {
  readonly situacao: SituacaoVolume;
  readonly noLocal: boolean;
  readonly localArquivo: number | null;
}

/** O que o movimento (já conferido) deixa no volume: situação, presença no local e local de guarda. */
export function efeitoNoVolume(v: VolumeGuarda, p: PedidoGuarda): EfeitoGuarda {
  const o = p.operacao;
  if (o.encerraGuarda) return { situacao: 'eliminado', noLocal: false, localArquivo: v.localArquivo };
  if (o.tipo === 'registro' || o.sentido === 'entrada')
    return { situacao: 'arquivado', noLocal: true, localArquivo: p.localDestino ?? v.localArquivo };
  if (o.sentido === 'saida') return { situacao: 'emprestado', noLocal: false, localArquivo: v.localArquivo };
  if (o.tipo === 'transferencia' && v.noLocal)
    return { situacao: v.situacao, noLocal: true, localArquivo: p.localDestino ?? v.localArquivo };
  return { situacao: v.situacao, noLocal: v.noLocal, localArquivo: v.localArquivo };
}

/** O extravio: só de volume que não está eliminado nem já extraviado, com o motivo. */
export function conferirExtravio(v: Pick<VolumeGuarda, 'situacao'>, motivo: string | null): ProblemaGuarda[] {
  if (v.situacao === 'eliminado') return [{ campo: 'volume', mensagem: 'O volume foi eliminado.' }];
  if (v.situacao === 'extraviado') return [{ campo: 'volume', mensagem: 'O extravio já foi registrado.' }];
  if (!motivo || motivo.trim().length < 10)
    return [{ campo: 'motivo', mensagem: 'Descreva o extravio com pelo menos 10 caracteres.' }];
  return [];
}

/** O próximo número de volume do paciente para o tipo de documento. */
export function proximoNumeroVolume(numeros: readonly number[]): number {
  return numeros.reduce((m, n) => Math.max(m, n), 0) + 1;
}

/** A matrícula da etiqueta do volume: prontuário, tipo de documento e número do volume (só dígitos e hífen). */
export function matriculaVolume(prontuario: number, tipoDocumento: number, numero: number): string {
  return `${prontuario}-${tipoDocumento}-${numero}`;
}

/** A leitura da etiqueta do volume: a matrícula (prontuário-tipo-número), ou null. */
export function lerMatriculaVolume(lido: string): string | null {
  const m = /^\s*(\d{1,15})-(\d{1,6})-(\d{1,5})\s*$/.exec(lido);
  return m ? `${Number(m[1])}-${Number(m[2])}-${Number(m[3])}` : null;
}

/** O volume está fora do arquivo além da previsão de retorno? */
export function retornoAtrasado(
  v: Pick<VolumeGuarda, 'noLocal' | 'situacao'>,
  previsao: Date | null,
  agora: Date,
): boolean {
  return (
    !v.noLocal && v.situacao === 'emprestado' && previsao !== null && previsao.getTime() < agora.getTime()
  );
}
