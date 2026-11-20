// Remessa e retorno bancário (M32; ficha, seção 6; cap-12 §12.1): CNAB 240 de pagamento a fornecedores (segmento A),
// gerado só contra o SIMULADOR fora de produção (nada sai para banco). O retorno do simulador devolve as ocorrências do
// domínio de TBTPOCORBANCOPGTO ("00" crédito efetuado).
import { centavos } from '@sgh/contratos/regras-financeiro';

export interface TituloRemessa {
  readonly titulo: number;
  readonly valor: number;
  readonly vencimento: string;
  readonly favorecido: string;
}

const num = (v: number | string, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n);
const alfa = (v: string, n: number) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .padEnd(n, ' ')
    .slice(0, n);

/** O arquivo CNAB 240 (cabeçalho, segmento A por título e rodapé); cada linha com 240 posições. */
export function gerarCnab240(
  banco: number,
  conta: { agencia: number; numero: number },
  sequencial: number,
  titulos: readonly TituloRemessa[],
): { conteudo: string; linhas: number; total: number } {
  const linhas: string[] = [];
  linhas.push(
    `${num(banco, 3)}00000${' '.repeat(9)}2${num(0, 14)}${num(conta.agencia, 5)} ${num(conta.numero, 12)}`.padEnd(
      240,
      ' ',
    ),
  );
  titulos.forEach((t, i) => {
    linhas.push(
      `${num(banco, 3)}0001300${num(i + 1, 5)}A000${alfa(t.favorecido, 30)}${num(t.titulo, 20)}${t.vencimento.replace(/-/g, '')}${num(Math.round(t.valor * 100), 15)}`.padEnd(
        240,
        ' ',
      ),
    );
  });
  const total = centavos(titulos.reduce((s, t) => s + t.valor, 0));
  linhas.push(
    `${num(banco, 3)}99999${' '.repeat(9)}${num(titulos.length + 2, 6)}${num(Math.round(total * 100), 18)}${num(sequencial, 6)}`.padEnd(
      240,
      ' ',
    ),
  );
  return { conteudo: `${linhas.join('\r\n')}\r\n`, linhas: linhas.length, total };
}

/** O retorno do simulador: crédito efetuado ("00") para cada título, ou "BD" (inclusão rejeitada) no valor zero. */
export function simularRetorno(titulos: readonly TituloRemessa[]): { titulo: number; ocorrencia: string }[] {
  return titulos.map((t) => ({ titulo: t.titulo, ocorrencia: t.valor > 0 ? '00' : 'BD' }));
}
