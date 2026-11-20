// Chave do par e de idempotência (M57, regra 4): a mesma nos dois bancos, independente de qual lado chamou.
// Formato: "<estabelecimento>:<id>|<estabelecimento>:<id>", com os lados em ordem (estabelecimento, depois ID). Só
// identificadores: nenhum dado pessoal entra na chave.

export interface LadoChave {
  readonly estabelecimento: string;
  readonly id: number;
}

const LADO = /^([a-z][a-z0-9]{1,9}):([1-9]\d{0,9})$/;

export class ErroChaveRede extends Error {
  override readonly name = 'ErroChaveRede';
}

function compararLados(x: LadoChave, y: LadoChave): number {
  return x.estabelecimento.localeCompare(y.estabelecimento) || x.id - y.id;
}

/** A chave do par (ordem estável). Recusa o par do mesmo estabelecimento: não é do MPI da Rede (regra 5). */
export function chavePar(a: LadoChave, b: LadoChave): string {
  if (a.estabelecimento === b.estabelecimento)
    throw new ErroChaveRede('Par do mesmo estabelecimento não entra no índice da Rede.');
  const [x, y] = [a, b].sort(compararLados) as [LadoChave, LadoChave];
  const k = `${x.estabelecimento}:${x.id}|${y.estabelecimento}:${y.id}`;
  ladosDaChave(k);
  return k;
}

/** Os dois lados de uma chave (recusa chave malformada, fora de ordem ou do mesmo estabelecimento). */
export function ladosDaChave(chave: string): readonly [LadoChave, LadoChave] {
  const partes = chave.split('|');
  if (partes.length !== 2) throw new ErroChaveRede('Chave de par malformada.');
  const lados = partes.map((p) => {
    const m = LADO.exec(p);
    if (!m) throw new ErroChaveRede('Chave de par malformada.');
    return { estabelecimento: m[1] as string, id: Number(m[2]) };
  }) as [LadoChave, LadoChave];
  if (lados[0].estabelecimento === lados[1].estabelecimento || compararLados(lados[0], lados[1]) > 0)
    throw new ErroChaveRede('Chave de par fora da forma canônica.');
  return lados;
}

/** O lado da chave que é do estabelecimento dado, e o outro. */
export function ladoLocalERemoto(
  chave: string,
  estabelecimento: string,
): { local: LadoChave; remoto: LadoChave } {
  const [x, y] = ladosDaChave(chave);
  if (x.estabelecimento === estabelecimento) return { local: x, remoto: y };
  if (y.estabelecimento === estabelecimento) return { local: y, remoto: x };
  throw new ErroChaveRede('O estabelecimento não está no par.');
}
