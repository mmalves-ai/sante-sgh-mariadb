// Orçamento de exames particulares (F3.5, 05-SADT linha 26): a montagem do orçamento (preço da tabela da fonte
// particular ou informado no balcão, quantidade, desconto e total com as parcelas), o destino da conversão (o paciente do
// atendimento tem de ser o do orçamento) e a divisão por setor executante (uma requisição por setor, no mesmo
// atendimento). Regra pura: a API lê o cadastro e grava o que esta regra decide.

export class RecusaOrcamento extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly campos: readonly string[] = [],
  ) {
    super(mensagem);
  }
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

export interface ExameOrcado {
  readonly exame: number;
  readonly nome: string;
  readonly quantidade: number;
  /** O preço vigente da tabela da fonte particular (null: o exame não tem preço na tabela). */
  readonly precoTabela: number | null;
  /** O valor unitário digitado no balcão (null: usa o da tabela). */
  readonly valorInformado: number | null;
}

export interface ItemMontado {
  readonly exame: number;
  readonly quantidade: number;
  readonly unitario: number;
  readonly total: number;
  readonly origemPreco: 'tabela' | 'informado';
}

export interface OrcamentoMontado {
  readonly itens: readonly ItemMontado[];
  readonly bruto: number;
  readonly desconto: number;
  readonly total: number;
}

/**
 * Monta o orçamento: cada exame uma vez só, quantidade de 1 a 99, preço da tabela quando o balcão não informa, e o
 * desconto nunca acima do bruto. Recusa com o campo da tela que causou a recusa.
 */
export function montarOrcamentoExames(itens: readonly ExameOrcado[], desconto: number): OrcamentoMontado {
  if (itens.length === 0)
    throw new RecusaOrcamento('orcamento-sem-exames', 'Escolha ao menos um exame.', ['exames']);
  const vistos = new Set<number>();
  const montados: ItemMontado[] = [];
  for (const [k, i] of itens.entries()) {
    if (vistos.has(i.exame))
      throw new RecusaOrcamento(
        'exame-repetido',
        `O exame ${i.nome} aparece duas vezes: ajuste a quantidade.`,
        [`exames.${k}`],
      );
    vistos.add(i.exame);
    if (!Number.isInteger(i.quantidade) || i.quantidade < 1 || i.quantidade > 99)
      throw new RecusaOrcamento('quantidade-invalida', `A quantidade de ${i.nome} vai de 1 a 99.`, [
        `exames.${k}.quantidade`,
      ]);
    const unitario = i.valorInformado ?? i.precoTabela;
    if (unitario === null)
      throw new RecusaOrcamento(
        'exame-sem-preco',
        `O exame ${i.nome} não tem preço na tabela da fonte particular: informe o valor.`,
        [`exames.${k}.valor`],
      );
    if (!Number.isFinite(unitario) || unitario < 0)
      throw new RecusaOrcamento('valor-invalido', `O valor de ${i.nome} não pode ser negativo.`, [
        `exames.${k}.valor`,
      ]);
    const u = centavos(unitario);
    montados.push({
      exame: i.exame,
      quantidade: i.quantidade,
      unitario: reais(u),
      total: reais(u * i.quantidade),
      origemPreco: i.valorInformado === null ? 'tabela' : 'informado',
    });
  }
  const bruto = montados.reduce((a, i) => a + centavos(i.total), 0);
  const d = centavos(desconto);
  if (!Number.isFinite(desconto) || d < 0)
    throw new RecusaOrcamento('desconto-invalido', 'O desconto não pode ser negativo.', ['desconto']);
  if (d > bruto)
    throw new RecusaOrcamento('desconto-acima-do-total', 'O desconto é maior que o valor dos exames.', [
      'desconto',
    ]);
  return { itens: montados, bruto: reais(bruto), desconto: reais(d), total: reais(bruto - d) };
}

/**
 * Quem recebe o orçamento: o paciente cadastrado ou o interessado sem cadastro, com nome de ao menos 3 letras. O CPF,
 * quando vem, tem 11 dígitos.
 */
export function conferirInteressado(o: {
  readonly paciente: number | null;
  readonly nome: string | null;
  readonly cpf: string | null;
}): void {
  if (o.paciente === null && (o.nome ?? '').trim().length < 3)
    throw new RecusaOrcamento(
      'interessado-obrigatorio',
      'Escolha o paciente ou digite o nome do interessado.',
      ['nome'],
    );
  if (o.cpf !== null && !/^[0-9]{11}$/.test(o.cpf))
    throw new RecusaOrcamento('cpf-invalido', 'O CPF tem 11 dígitos.', ['cpf']);
}

/**
 * O atendimento da conversão tem de ser do paciente do orçamento. Orçamento sem paciente (interessado sem cadastro):
 * aceita o paciente do atendimento, mas recusa quando os dois CPFs existem e diferem.
 */
export function conferirDestinoDaConversao(
  orcamento: { readonly paciente: number | null; readonly cpfInteressado: string | null },
  atendimento: { readonly paciente: number; readonly cpfPaciente: string | null },
): { readonly vinculaPaciente: boolean } {
  if (orcamento.paciente !== null) {
    if (orcamento.paciente !== atendimento.paciente)
      throw new RecusaOrcamento(
        'paciente-diferente',
        'O atendimento é de outro paciente: escolha um atendimento do paciente do orçamento.',
        ['atendimento'],
      );
    return { vinculaPaciente: false };
  }
  if (
    orcamento.cpfInteressado !== null &&
    atendimento.cpfPaciente !== null &&
    orcamento.cpfInteressado !== atendimento.cpfPaciente
  )
    throw new RecusaOrcamento(
      'paciente-diferente',
      'O CPF do paciente do atendimento difere do CPF do interessado do orçamento.',
      ['atendimento'],
    );
  return { vinculaPaciente: true };
}

/**
 * Uma requisição por setor executante: o setor padrão do exame, ou o único ativo. Exame sem setor executante ativo, ou
 * com mais de um sem padrão, é recusado com o nome do exame (a conversão não escolhe por conta própria).
 */
export function setoresDaConversao(
  itens: readonly {
    readonly exame: number;
    readonly nome: string;
    readonly quantidade: number;
    readonly setores: readonly { readonly setor: number; readonly padrao: boolean }[];
  }[],
): ReadonlyMap<number, readonly { exame: number; quantidade: number }[]> {
  const r = new Map<number, { exame: number; quantidade: number }[]>();
  for (const i of itens) {
    const padrao = i.setores.filter((s) => s.padrao);
    const setor =
      padrao.length === 1 ? padrao[0]!.setor : i.setores.length === 1 ? i.setores[0]!.setor : null;
    if (setor === null)
      throw new RecusaOrcamento(
        i.setores.length === 0 ? 'exame-sem-setor' : 'exame-setor-ambiguo',
        i.setores.length === 0
          ? `O exame ${i.nome} não tem setor executante ativo.`
          : `O exame ${i.nome} tem mais de um setor executante sem um padrão: marque o padrão no catálogo.`,
      );
    r.set(setor, [...(r.get(setor) ?? []), { exame: i.exame, quantidade: i.quantidade }]);
  }
  return r;
}
