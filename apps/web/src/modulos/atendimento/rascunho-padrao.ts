// Releitura dos valores habituais da abertura sem perder o que está na tela e ainda não foi gravado. A tela tem dois
// escopos com um botão cada (estabelecimento e pessoal); gravar um deles relê a configuração inteira, e a escolha
// pendente do outro escopo não pode voltar ao valor gravado. Campo a campo: o que a pessoa mudou em relação à
// leitura anterior fica; o que ela não mexeu passa a mostrar o valor relido (inclusive o que outra estação gravou).

/** Os valores na tela, por campo: o id do item em texto, ou '' para "sem valor". */
export type ValoresNaTela = Readonly<Record<string, string>>;

/** O que a releitura traz de um escopo: o campo e o id gravado (ou null). */
export interface CampoLido {
  readonly campo: string;
  readonly id: number | null;
}

const texto = (id: number | null): string => (id === null ? '' : String(id));

/**
 * Os valores da tela depois da releitura de um escopo. Sem leitura anterior (a primeira carga), vale o que veio do
 * servidor. Com leitura anterior, o campo cujo valor na tela difere do lido antes é uma mudança pendente e fica.
 */
export function recarregarRascunho(
  naTela: ValoresNaTela,
  relido: readonly CampoLido[],
  lidoAntes: readonly CampoLido[] | undefined,
): Record<string, string> {
  const antes = new Map((lidoAntes ?? []).map((x) => [x.campo, texto(x.id)]));
  return Object.fromEntries(
    relido.map((x) => {
      const valor = naTela[x.campo];
      const pendente = lidoAntes !== undefined && valor !== undefined && valor !== (antes.get(x.campo) ?? '');
      return [x.campo, pendente ? valor : texto(x.id)];
    }),
  );
}
