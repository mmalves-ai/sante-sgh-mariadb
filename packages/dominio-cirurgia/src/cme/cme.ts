// Central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012 da ANVISA). Regras puras do processamento
// dos produtos para saúde: o cadastro da caixa de instrumental, a montagem do ciclo de esterilização, o resultado dos
// indicadores e a liberação do lote, a validade e a etiqueta do pacote, e o uso do pacote na cirurgia (rastreio do
// pacote até o paciente). A porta reconfere tudo no banco e nunca apaga: o pacote rejeitado e o ciclo reprovado ficam
// no histórico com a situação.
//
// Monitoramento (RDC 15/2012, arts. 96 a 99): cada ciclo tem indicador físico (parâmetros do equipamento) e químico; o
// biológico é diário e obrigatório em toda carga com implante (material de terceiro ou OPME, que vem consignado). A
// carga com implante só é liberada depois da leitura do biológico; sem ela, o ciclo fica concluído e aguardando.
// Etiqueta (art. 83): nome do produto, número do lote, data da esterilização, data limite de uso, método e responsável
// pelo preparo.

export type ResultadoIndicador = 'conforme' | 'nao_conforme' | 'pendente';

export interface Problema {
  readonly campo: string;
  readonly mensagem: string;
}

// ── Caixa de instrumental ────────────────────────────────────────────────────────────────────────────────────────

export interface ItemCaixaEntrada {
  readonly insumo: number | null;
  readonly produto: number | null;
  readonly quantidade: number;
  readonly pecaMestre: boolean;
}

export interface CaixaEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly validadeDias: number | null;
  readonly controlaReprocessamentos: boolean;
  readonly limiteReprocessamentos: number | null;
  readonly itens: readonly ItemCaixaEntrada[];
}

/** As recusas do cadastro da caixa (vazio: pode gravar). */
export function conferirCaixa(c: CaixaEntrada): Problema[] {
  const p: Problema[] = [];
  if (!c.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código da caixa.' });
  if (!c.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição da caixa.' });
  if (c.itens.length === 0) p.push({ campo: 'itens', mensagem: 'A caixa precisa de ao menos uma peça.' });
  c.itens.forEach((i, n) => {
    if ((i.insumo === null) === (i.produto === null))
      p.push({
        campo: `itens.${n}`,
        mensagem: `Peça ${n + 1}: escolha o produto do estoque ou o reprocessável.`,
      });
    if (!(i.quantidade > 0))
      p.push({
        campo: `itens.${n}.quantidade`,
        mensagem: `Peça ${n + 1}: a quantidade tem de ser maior que zero.`,
      });
  });
  if (c.itens.filter((i) => i.pecaMestre).length > 1)
    p.push({ campo: 'itens', mensagem: 'Só uma peça identifica a caixa (peça mestre).' });
  if (c.validadeDias !== null && !(c.validadeDias > 0 && c.validadeDias <= 3650))
    p.push({ campo: 'validadeDias', mensagem: 'A validade da esterilização vai de 1 a 3650 dias.' });
  if (c.controlaReprocessamentos && !(c.limiteReprocessamentos && c.limiteReprocessamentos > 0))
    p.push({ campo: 'limiteReprocessamentos', mensagem: 'Informe o limite de reprocessamentos da caixa.' });
  return p;
}

/** Se a caixa ainda pode ir a um novo pacote (o limite de reprocessamentos do fabricante não foi atingido). */
export function caixaReprocessavel(c: {
  readonly ativo: boolean;
  readonly controla: boolean;
  readonly limite: number | null;
  readonly feitos: number;
}): Problema[] {
  if (!c.ativo) return [{ campo: 'caixa', mensagem: 'A caixa está inativa.' }];
  if (c.controla && c.limite !== null && c.feitos >= c.limite)
    return [
      {
        campo: 'caixa',
        mensagem: 'A caixa atingiu o limite de reprocessamentos; deve ser revista ou descartada.',
      },
    ];
  return [];
}

// ── Validade e etiqueta do pacote ────────────────────────────────────────────────────────────────────────────────

/** Dias de validade do pacote: o da caixa; sem ele, o da embalagem; sem os dois, não há validade (recusa). */
export function diasDeValidade(caixa: number | null, embalagem: number | null): number | null {
  return caixa ?? embalagem ?? null;
}

/** A data limite de uso (AAAA-MM-DD) a partir do dia da esterilização. */
export function validadeDoPacote(diaEsterilizacao: string, dias: number): string {
  const d = new Date(`${diaEsterilizacao.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** O código da etiqueta do pacote: estabelecimento e número sequencial (lido pelo leitor de código de barras). */
export function codigoEtiqueta(estabelecimento: number, numero: number): string {
  return `PE${String(estabelecimento).padStart(3, '0')}${String(numero).padStart(8, '0')}`;
}

export interface EtiquetaPacote {
  readonly codigo: string;
  readonly produto: string;
  readonly lote: string | null;
  readonly esterilizadoEm: string | null;
  readonly validade: string | null;
  readonly metodo: string | null;
  readonly preparadoPor: string | null;
}

/** O que falta na etiqueta para o pacote sair da CME (art. 83 da RDC 15/2012). */
export function faltasDaEtiqueta(e: EtiquetaPacote): string[] {
  const f: string[] = [];
  if (!e.produto) f.push('produto');
  if (!e.lote) f.push('lote');
  if (!e.esterilizadoEm) f.push('data da esterilização');
  if (!e.validade) f.push('data limite de uso');
  if (!e.metodo) f.push('método');
  if (!e.preparadoPor) f.push('responsável pelo preparo');
  return f;
}

// ── Ciclo de esterilização ───────────────────────────────────────────────────────────────────────────────────────

export interface PacoteParaCiclo {
  readonly id: number;
  readonly situacao: string;
  readonly metodo: number | null;
}

/** As recusas da montagem da carga: pacotes aguardando esterilização, sem repetição, compatíveis com o método. */
export function conferirCarga(
  metodo: number,
  pacotes: readonly PacoteParaCiclo[],
  pedidos: readonly number[],
): Problema[] {
  const p: Problema[] = [];
  if (pedidos.length === 0) p.push({ campo: 'pacotes', mensagem: 'A carga precisa de ao menos um pacote.' });
  if (new Set(pedidos).size !== pedidos.length)
    p.push({ campo: 'pacotes', mensagem: 'O mesmo pacote apareceu duas vezes na carga.' });
  for (const id of new Set(pedidos)) {
    const k = pacotes.find((x) => x.id === id);
    if (!k) p.push({ campo: 'pacotes', mensagem: `O pacote ${id} não existe neste estabelecimento.` });
    else if (k.situacao !== 'aguardando_esterilizacao')
      p.push({ campo: 'pacotes', mensagem: `O pacote ${id} não está aguardando esterilização.` });
    else if (k.metodo !== null && k.metodo !== metodo)
      p.push({ campo: 'pacotes', mensagem: `O pacote ${id} pede outro método de esterilização.` });
  }
  return p;
}

export interface Indicadores {
  readonly fisico: ResultadoIndicador;
  readonly quimico: ResultadoIndicador;
  readonly biologico: ResultadoIndicador;
}

export type DesfechoCiclo =
  | { readonly situacao: 'liberado' | 'reprovado' | 'concluido'; readonly motivo: string }
  | { readonly situacao: 'recusa'; readonly problemas: Problema[] };

/**
 * O desfecho do ciclo ao registrar os indicadores. Indicador não conforme reprova a carga inteira (os pacotes são
 * rejeitados e voltam ao reprocessamento). Físico e químico são lidos ao fim de todo ciclo. A carga com implante só se
 * libera com o biológico conforme; sem a leitura, fica concluída e aguardando.
 */
export function desfechoDoCiclo(i: Indicadores, cargaComImplante: boolean): DesfechoCiclo {
  const faltas: Problema[] = [];
  if (i.fisico === 'pendente')
    faltas.push({ campo: 'fisico', mensagem: 'Registre o indicador físico do ciclo.' });
  if (i.quimico === 'pendente')
    faltas.push({ campo: 'quimico', mensagem: 'Registre o indicador químico do ciclo.' });
  const nc = (['fisico', 'quimico', 'biologico'] as const).filter((k) => i[k] === 'nao_conforme');
  if (nc.length) return { situacao: 'reprovado', motivo: `Indicador não conforme: ${nc.join(', ')}.` };
  if (faltas.length) return { situacao: 'recusa', problemas: faltas };
  if (cargaComImplante && i.biologico !== 'conforme')
    return { situacao: 'concluido', motivo: 'Carga com implante: aguarda a leitura do indicador biológico.' };
  return { situacao: 'liberado', motivo: 'Indicadores conformes.' };
}

/** A liberação do ciclo concluído, com a leitura do biológico. */
export function desfechoDaLiberacao(situacaoAtual: string, biologico: ResultadoIndicador): DesfechoCiclo {
  if (situacaoAtual !== 'concluido')
    return {
      situacao: 'recusa',
      problemas: [{ campo: 'ciclo', mensagem: 'Só o ciclo concluído aguarda liberação.' }],
    };
  if (biologico === 'pendente')
    return {
      situacao: 'recusa',
      problemas: [{ campo: 'biologico', mensagem: 'Registre a leitura do indicador biológico.' }],
    };
  return biologico === 'conforme'
    ? { situacao: 'liberado', motivo: 'Indicador biológico conforme.' }
    : { situacao: 'reprovado', motivo: 'Indicador biológico não conforme.' };
}

// ── Entrega e uso na cirurgia (rastreio até o paciente) ──────────────────────────────────────────────────────────

export interface PacoteParaUso {
  readonly situacao: string;
  readonly validade: string | null;
  readonly cicloSituacao: string | null;
  /** O agendamento para o qual o pacote foi entregue (null: ainda não entregue). */
  readonly agendamentoEntregue: number | null;
}

/** Recusas da entrega do pacote para a cirurgia (pacote estéril, ciclo liberado, dentro da validade). */
export function conferirEntrega(p: PacoteParaUso, hoje: string): Problema[] {
  if (p.situacao !== 'esteril')
    return [{ campo: 'pacote', mensagem: 'Só o pacote estéril, guardado no arsenal, sai para a cirurgia.' }];
  return conferirEsterilidade(p, hoje);
}

/** Recusas do uso do pacote no paciente: entregue a esta cirurgia, ciclo liberado e dentro da validade. */
export function conferirUso(p: PacoteParaUso, agendamento: number, hoje: string): Problema[] {
  if (p.situacao !== 'distribuido' || p.agendamentoEntregue !== agendamento)
    return [{ campo: 'pacote', mensagem: 'O pacote não foi entregue para esta cirurgia.' }];
  return conferirEsterilidade(p, hoje);
}

function conferirEsterilidade(p: PacoteParaUso, hoje: string): Problema[] {
  if (p.cicloSituacao !== 'liberado')
    return [{ campo: 'pacote', mensagem: 'O ciclo de esterilização do pacote não foi liberado.' }];
  if (!p.validade || p.validade < hoje.slice(0, 10))
    return [{ campo: 'pacote', mensagem: 'O pacote está fora da validade da esterilização; volte-o à CME.' }];
  return [];
}

/** A situação da solicitação de material estéril pelos itens (todos entregues, parte ou nenhum). */
export function situacaoDaSolicitacao(itens: readonly { readonly situacao: string }[]): string {
  const vivos = itens.filter((i) => i.situacao !== 'cancelado');
  if (vivos.length === 0) return 'cancelada';
  const entregues = vivos.filter((i) => i.situacao === 'entregue').length;
  if (entregues === vivos.length) return 'entregue';
  if (entregues > 0) return 'parcial';
  if (vivos.some((i) => i.situacao === 'em_processamento' || i.situacao === 'pronto'))
    return 'em_processamento';
  return 'aberta';
}
