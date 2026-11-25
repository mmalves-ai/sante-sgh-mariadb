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

/** Campo em que a pessoa mudou a tela e outra gravação mudou o mesmo campo: vale o gravado, e a tela avisa. */
export interface ConflitoRascunho {
  readonly campo: string;
  /** O que a pessoa tinha escolhido e não foi gravado ('' para "sem valor"). */
  readonly naTela: string;
  /** O que está gravado agora e passa a aparecer na tela ('' para "sem valor"). */
  readonly gravado: string;
}

export interface RascunhoRelido {
  readonly valores: Record<string, string>;
  readonly conflitos: readonly ConflitoRascunho[];
}

/**
 * Os valores da tela depois da releitura de um escopo. Sem leitura anterior (a primeira carga), vale o que veio do
 * servidor. Com leitura anterior, campo a campo:
 * - a tela igual ao lido antes: recebe o relido (inclusive o que outra estação gravou);
 * - a tela diferente do lido antes e o relido igual ao lido antes: mudança pendente, fica;
 * - a tela diferente do lido antes e o relido também diferente (e diferente da tela): conflito. Vale o gravado, para
 *   que a próxima gravação não sobrescreva sem ninguém ver, e o campo volta em `conflitos` com as duas escolhas.
 */
export function recarregarRascunho(
  naTela: ValoresNaTela,
  relido: readonly CampoLido[],
  lidoAntes: readonly CampoLido[] | undefined,
): RascunhoRelido {
  const antes = new Map((lidoAntes ?? []).map((x) => [x.campo, texto(x.id)]));
  const conflitos: ConflitoRascunho[] = [];
  const valores = Object.fromEntries(
    relido.map((x) => {
      const gravado = texto(x.id);
      const valor = naTela[x.campo];
      const anterior = antes.get(x.campo) ?? '';
      const pendente = lidoAntes !== undefined && valor !== undefined && valor !== anterior;
      if (!pendente) return [x.campo, gravado];
      if (gravado !== anterior && gravado !== valor)
        conflitos.push({ campo: x.campo, naTela: valor, gravado });
      return [x.campo, gravado !== anterior ? gravado : valor];
    }),
  );
  return { valores, conflitos };
}
