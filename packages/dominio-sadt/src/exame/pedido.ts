// Pedido de exames (F3.5, 05-SADT linhas 4 e 5): a montagem dos itens a partir de exames avulsos e de kits com versão,
// as restrições clínicas da solicitação (sexo, idade, material, horário, dia, setor, unidade e tipo de atendimento),
// com a exceção autorizada e registrada, e o cancelamento do item com motivo. Regra pura, sem banco: a aplicação lê o
// cadastro, chama estas funções e grava o que elas decidem na mesma transação.

/** Um exame pedido avulso ou vindo de um kit. */
export interface ExamePedido {
  readonly exame: number;
  readonly setor: number | null;
  readonly material: number | null;
  readonly quantidade: number;
  readonly urgente: boolean;
}

/** Os itens de uma versão de kit, como estão no cadastro. */
export interface KitNoPedido {
  readonly kit: number;
  readonly versao: number;
  readonly numeroVersao: number;
  readonly itens: readonly Omit<ExamePedido, 'urgente'>[];
}

export interface ItemMontado extends ExamePedido {
  readonly sequencia: number;
  /** A versão do kit de onde o exame veio (nulo no exame avulso). */
  readonly kitVersao: number | null;
}

export class RecusaPedido extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const chave = (e: { exame: number; material: number | null }) => `${e.exame}:${e.material ?? '-'}`;

/**
 * Os itens do pedido: os avulsos primeiro, depois os de cada kit (na ordem do kit). O mesmo exame com o mesmo material
 * entra uma vez só (o primeiro vence); a urgência do pedido vale para os itens do kit. Pedido vazio é recusado.
 */
export function itensDoPedido(
  avulsos: readonly ExamePedido[],
  kits: readonly KitNoPedido[],
  urgente: boolean,
): ItemMontado[] {
  const vistos = new Set<string>();
  const saida: ItemMontado[] = [];
  const por = (e: ExamePedido, kitVersao: number | null) => {
    if (!Number.isSafeInteger(e.quantidade) || e.quantidade < 1)
      throw new RecusaPedido('quantidade-invalida', 'A quantidade do exame precisa ser 1 ou mais.');
    const k = chave(e);
    if (vistos.has(k)) return;
    vistos.add(k);
    saida.push({ ...e, sequencia: saida.length + 1, kitVersao });
  };
  for (const a of avulsos) por(a, null);
  for (const k of kits) {
    if (k.itens.length === 0)
      throw new RecusaPedido('kit-vazio', 'O kit escolhido não tem exames na versão vigente.');
    for (const i of k.itens) por({ ...i, urgente }, k.versao);
  }
  if (saida.length === 0) throw new RecusaPedido('sem-exames', 'Escolha ao menos um exame ou um kit.');
  return saida;
}

/** A próxima versão do kit: os itens conferidos e numerados (sem repetir exame e material). */
export function itensDaVersaoDoKit(
  itens: readonly Omit<ExamePedido, 'urgente'>[],
): (Omit<ExamePedido, 'urgente'> & { sequencia: number })[] {
  if (itens.length === 0) throw new RecusaPedido('kit-vazio', 'O kit precisa de ao menos um exame.');
  const vistos = new Set<string>();
  return itens.map((i, ix) => {
    if (!Number.isSafeInteger(i.quantidade) || i.quantidade < 1)
      throw new RecusaPedido('quantidade-invalida', 'A quantidade do exame precisa ser 1 ou mais.');
    const k = chave(i);
    if (vistos.has(k)) throw new RecusaPedido('exame-repetido', 'O mesmo exame aparece duas vezes no kit.');
    vistos.add(k);
    return { ...i, sequencia: ix + 1 };
  });
}

// ── Restrições clínicas da solicitação ─────────────────────────────────────────────────────────────────────────

export type Sexo = 'feminino' | 'masculino';
export type TipoAtendimento = 'ambulatorial' | 'internacao' | 'urgencia' | 'externo' | 'domiciliar';

/** Uma regra do cadastro de restrições do exame (já filtrada pelo exame e pelo estabelecimento). */
export interface RegraRestricao {
  readonly id: number;
  readonly exame: number;
  readonly tipo: 'bloqueio' | 'alerta';
  readonly setor: number | null;
  readonly unidade: number | null;
  readonly material: number | null;
  readonly sexo: Sexo | null;
  readonly idadeMinimaDias: number | null;
  readonly idadeMaximaDias: number | null;
  readonly tipoAtendimento: TipoAtendimento | null;
  /** 1 = domingo a 7 = sábado. */
  readonly diaSemana: number | null;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
  readonly intervaloMinimoDias: number | null;
  readonly permiteExcecao: boolean;
  readonly mensagem: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** O pedido de um exame, como a regra o enxerga. */
export interface SolicitacaoAvaliada {
  readonly exame: number;
  readonly setor: number | null;
  readonly material: number | null;
  readonly unidade: number | null;
  readonly tipoAtendimento: TipoAtendimento | null;
  readonly sexo: Sexo | null;
  /** Idade em dias na data do pedido (nulo sem data de nascimento). */
  readonly idadeDias: number | null;
  /** Data (AAAA-MM-DD) e hora (HH:MM) do pedido na hora do estabelecimento. */
  readonly data: string;
  readonly hora: string;
  /** Datas (AAAA-MM-DD) dos pedidos anteriores do mesmo exame para o paciente. */
  readonly anteriores: readonly string[];
}

export interface RestricaoAcionada {
  readonly regra: number;
  readonly exame: number;
  readonly tipo: 'bloqueio' | 'alerta';
  readonly motivo: 'sexo' | 'idade' | 'material' | 'atendimento' | 'dia' | 'horario' | 'repeticao';
  readonly mensagem: string;
  readonly permiteExcecao: boolean;
  /** Exceção vigente que já libera o pedido (do estabelecimento, do setor, do perfil ou do paciente). */
  readonly excecao: number | null;
}

const diaDaSemana = (data: string): number => new Date(`${data}T12:00:00Z`).getUTCDay() + 1;
const dias = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const vigente = (inicio: string, fim: string | null, data: string) =>
  inicio <= data && (fim === null || data <= fim);

/** O horário do pedido cai na janela da regra (a janela pode atravessar a meia-noite). */
export function dentroDaJanela(hora: string, inicio: string, fim: string): boolean {
  const h = hora.slice(0, 5);
  const i = inicio.slice(0, 5);
  const f = fim.slice(0, 5);
  return i <= f ? h >= i && h <= f : h >= i || h <= f;
}

/**
 * As regras que se aplicam ao pedido: a regra limita a quem vale (setor, unidade, material, tipo de atendimento, dia e
 * horário) e diz o que é permitido (sexo, faixa de idade, intervalo). Uma regra de horário ou de dia sem sexo nem idade
 * restringe o pedido àquela janela: fora dela, o pedido é acionado.
 */
export function restricoesAcionadas(
  regras: readonly RegraRestricao[],
  s: SolicitacaoAvaliada,
  excecaoDe: (regra: number) => number | null = () => null,
): RestricaoAcionada[] {
  const saida: RestricaoAcionada[] = [];
  for (const r of regras) {
    if (r.exame !== s.exame || !vigente(r.vigenciaInicio, r.vigenciaFim, s.data)) continue;
    if (r.setor !== null && r.setor !== s.setor) continue;
    if (r.unidade !== null && r.unidade !== s.unidade) continue;
    const motivos: RestricaoAcionada['motivo'][] = [];
    if (r.sexo !== null && s.sexo !== null && s.sexo !== r.sexo) motivos.push('sexo');
    if (
      s.idadeDias !== null &&
      ((r.idadeMinimaDias !== null && s.idadeDias < r.idadeMinimaDias) ||
        (r.idadeMaximaDias !== null && s.idadeDias > r.idadeMaximaDias))
    )
      motivos.push('idade');
    if (r.material !== null && s.material !== null && s.material !== r.material) motivos.push('material');
    if (r.tipoAtendimento !== null && s.tipoAtendimento !== null && s.tipoAtendimento !== r.tipoAtendimento)
      motivos.push('atendimento');
    if (r.diaSemana !== null && diaDaSemana(s.data) !== r.diaSemana) motivos.push('dia');
    if (r.horaInicio !== null && r.horaFim !== null && !dentroDaJanela(s.hora, r.horaInicio, r.horaFim))
      motivos.push('horario');
    if (
      r.intervaloMinimoDias !== null &&
      r.intervaloMinimoDias > 0 &&
      s.anteriores.some((a) => a <= s.data && dias(a.slice(0, 10), s.data) < r.intervaloMinimoDias!)
    )
      motivos.push('repeticao');
    const primeiro = motivos[0];
    if (primeiro === undefined) continue;
    saida.push({
      regra: r.id,
      exame: r.exame,
      tipo: r.tipo,
      motivo: primeiro,
      mensagem: r.mensagem,
      permiteExcecao: r.permiteExcecao,
      excecao: excecaoDe(r.id),
    });
  }
  return saida;
}

export interface DecisaoDoPedido {
  readonly segue: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
  /** As regras de bloqueio liberadas agora pela justificativa: viram exceção do item, gravada com quem autorizou. */
  readonly excecoesNovas: readonly number[];
}

/**
 * Decide se o pedido segue. O bloqueio sem exceção vigente recusa, a não ser que a regra aceite exceção e a tela traga
 * a justificativa (10 caracteres ou mais): aí o pedido segue e a exceção do item é registrada. O alerta pede só a
 * confirmação da tela.
 */
export function decisaoDoPedido(
  acionadas: readonly RestricaoAcionada[],
  o: { readonly confirmado: boolean; readonly justificativa: string | null },
): DecisaoDoPedido {
  const justificada = (o.justificativa ?? '').trim().length >= 10;
  const novas: number[] = [];
  for (const a of acionadas) {
    if (a.tipo !== 'bloqueio' || a.excecao !== null) continue;
    if (!a.permiteExcecao)
      return { segue: false, codigo: 'restricao-bloqueio', motivo: a.mensagem, excecoesNovas: [] };
    if (!justificada)
      return {
        segue: false,
        codigo: 'restricao-justificativa',
        motivo: `${a.mensagem} Informe a justificativa da exceção (10 caracteres ou mais).`,
        excecoesNovas: [],
      };
    if (!novas.includes(a.regra)) novas.push(a.regra);
  }
  if (acionadas.some((a) => a.tipo === 'alerta') && !o.confirmado)
    return {
      segue: false,
      codigo: 'restricao-confirmar',
      motivo: 'Confirme os avisos do pedido antes de gravar.',
      excecoesNovas: [],
    };
  return { segue: true, codigo: null, motivo: null, excecoesNovas: novas };
}

// ── Cancelamento do item ───────────────────────────────────────────────────────────────────────────────────────

/** Situações do item em que o cancelamento ainda é permitido (antes do resultado liberado). */
export const SITUACOES_CANCELAVEIS = [
  'solicitado',
  'autorizado',
  'agendado',
  'coletado',
  'em_analise',
  'resultado_digitado',
  'revisado',
] as const;

export interface MotivoCancelamento {
  readonly ativo: boolean;
  readonly aplicaA: 'exame' | 'amostra' | 'ambos';
  readonly exigeComplemento: boolean;
}

/** Confere o cancelamento do item: situação que ainda permite, motivo ativo do exame e o complemento quando exigido. */
export function conferirCancelamento(
  situacao: string,
  m: MotivoCancelamento,
  complemento: string | null,
): void {
  if (!(SITUACOES_CANCELAVEIS as readonly string[]).includes(situacao))
    throw new RecusaPedido(
      'item-nao-cancelavel',
      situacao === 'cancelado'
        ? 'O exame já está cancelado.'
        : 'O exame com resultado liberado não se cancela: retifique o resultado.',
    );
  if (!m.ativo || m.aplicaA === 'amostra')
    throw new RecusaPedido('motivo-invalido', 'Escolha um motivo de cancelamento de exame ativo.');
  if (m.exigeComplemento && (complemento ?? '').trim().length < 5)
    throw new RecusaPedido('complemento-obrigatorio', 'Este motivo pede a explicação do cancelamento.');
}
