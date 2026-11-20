// Comuns das telas da gestão de pessoas (M52.1): datas no formato do Brasil, as opções dos vocabulários e o código da
// recusa de um erro da API (para a tela mostrar o texto certo).
import { ErroApi } from '../../casca/erros/problem-details.js';

export function dataBr(d: string | null | undefined): string {
  if (!d) return '';
  const [a, m, dia] = d.slice(0, 10).split('-');
  return a && m && dia ? `${dia}/${m}/${a}` : d;
}

export function opcoesDe<K extends string>(
  vocab: Readonly<Record<K, string>>,
): { valor: K; rotulo: string }[] {
  return (Object.entries(vocab) as [K, string][])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([valor, rotulo]) => ({ valor, rotulo }));
}

export function codigoDoErro(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const c = (e.problema as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' ? c : null;
}

/** A entrada sem o vínculo (a rota leva o vínculo na URL). */
export function semVinculo<T extends { vinculo: number }>(e: T): Omit<T, 'vinculo'> {
  const r: Partial<T> = { ...e };
  delete r.vinculo;
  return r as Omit<T, 'vinculo'>;
}
