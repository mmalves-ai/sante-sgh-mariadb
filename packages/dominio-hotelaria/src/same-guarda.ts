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

/** As operações padrão do produto (semeadas em todo cliente). As operações importadas de outro sistema entram com tipo
 * e sentido presumidos até o de-para do conector (pendência registrada na ficha da F3.9, 04-HOT L126). */
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
  /** Volumes contados no local onde o volume vai ficar (o de destino ou, sem ele, o de guarda do volume) e a
   * capacidade dele (null: sem limite). A contagem é a do banco: inclui o próprio volume quando ele já é do local e não
   * está extraviado nem eliminado; a regra o desconta. */
  readonly ocupacaoDestino?: { readonly volumes: number; readonly capacidade: number | null } | null;
  /** O que o descarte confere: o prazo de guarda do tipo de documento e a deliberação da comissão. */
  readonly descarte?: DadosDescarte | null;
}

/** A deliberação registrada em reunião que autoriza o descarte. */
export interface DeliberacaoDescarte {
  /** A comissão é de revisão de prontuários e do mesmo estabelecimento do volume. */
  readonly comissaoDeProntuario: boolean;
  readonly reuniaoRealizada: boolean;
  readonly cancelada: boolean;
}

export interface DadosDescarte {
  /** Desde quando corre o prazo: a data do último documento do volume ou, sem ela, a abertura. */
  readonly guardaDesde: Date | null;
  /** O prazo de guarda do tipo de documento, em anos (null: guarda permanente). */
  readonly prazoAnos: number | null;
  readonly deliberacao: DeliberacaoDescarte | null;
}

/** O dia em que o prazo de guarda se cumpre (null: sem prazo, guarda permanente). */
export function fimDoPrazoGuarda(desde: Date | null, anos: number | null): Date | null {
  if (desde === null || anos === null) return null;
  const f = new Date(desde.getTime());
  f.setUTCFullYear(f.getUTCFullYear() + anos);
  return f;
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
  // Fora do arquivo o volume está sempre num setor: a saída e o empréstimo pedem o setor (o local de destino só vale
  // para quem entra no arquivo e seria descartado, perdendo onde o volume está).
  if (o.sentido === 'saida' && !o.encerraGuarda) {
    if (p.setorDestino === null)
      recusa('setorDestino', 'Informe o setor de destino: fora do arquivo o volume fica num setor.');
  } else if (o.exigeDestino && p.setorDestino === null && p.localDestino === null)
    recusa('setorDestino', 'Informe o setor ou o local de destino.');
  if (o.exigePrevisaoRetorno) {
    if (!p.previsaoRetorno) recusa('previsaoRetorno', 'Informe a previsão de retorno.');
    else if (p.previsaoRetorno.getTime() <= p.agora.getTime())
      recusa('previsaoRetorno', 'A previsão de retorno tem de ser futura.');
  }
  if ((o.sentido === 'saida' || o.tipo === 'recebimento') && !p.responsavel?.trim())
    recusa('responsavel', 'Informe quem retira ou recebe o volume.');
  if (o.encerraGuarda)
    for (const e of conferirDescarte(p.descarte ?? null, p.agora)) recusa(e.campo, e.mensagem);
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
  const entra =
    !o.encerraGuarda &&
    (o.tipo === 'registro' || o.sentido === 'entrada' || (o.tipo === 'transferencia' && v.noLocal));
  const alvo = entra ? (p.localDestino ?? v.localArquivo) : null;
  if (alvo !== null && p.ocupacaoDestino?.capacidade != null) {
    // O próprio volume já conta no local de guarda dele (emprestado inclusive): não ocupa duas vagas.
    const jaContado = alvo === v.localArquivo && v.situacao !== 'extraviado' ? 1 : 0;
    if (p.ocupacaoDestino.volumes - jaContado >= p.ocupacaoDestino.capacidade)
      recusa('localDestino', 'O local de guarda está cheio.');
  }
  return erros;
}

/** O descarte: deliberação da comissão de revisão de prontuários, em reunião realizada, e o prazo de guarda cumprido. */
export function conferirDescarte(d: DadosDescarte | null, agora: Date): ProblemaGuarda[] {
  const erros: ProblemaGuarda[] = [];
  const del = d?.deliberacao ?? null;
  if (!del)
    erros.push({
      campo: 'deliberacao',
      mensagem: 'O descarte exige a deliberação da comissão de revisão de prontuários registrada em reunião.',
    });
  else if (!del.comissaoDeProntuario)
    erros.push({
      campo: 'deliberacao',
      mensagem: 'A deliberação não é da comissão de revisão de prontuários deste estabelecimento.',
    });
  else if (!del.reuniaoRealizada)
    erros.push({ campo: 'deliberacao', mensagem: 'A reunião da deliberação ainda não foi realizada.' });
  else if (del.cancelada) erros.push({ campo: 'deliberacao', mensagem: 'A deliberação foi cancelada.' });
  if (!d || d.prazoAnos === null)
    erros.push({
      campo: 'operacao',
      mensagem:
        'O tipo de documento não tem prazo de guarda: a guarda é permanente e o volume não se elimina.',
    });
  else {
    const fim = fimDoPrazoGuarda(d.guardaDesde, d.prazoAnos);
    if (fim === null || fim.getTime() > agora.getTime())
      erros.push({
        campo: 'operacao',
        mensagem: `O prazo de guarda de ${d.prazoAnos} anos ainda não se cumpriu${
          fim ? ` (cumpre-se em ${fim.toISOString().slice(0, 10)})` : ''
        }.`,
      });
  }
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
