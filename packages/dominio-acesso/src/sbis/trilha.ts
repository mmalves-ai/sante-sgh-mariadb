// M59-F5 (ficha do M59, seção 4, "Prova da trilha"; cap-13 §13.6.3; SBIS-16 a 19): a prova da cadeia de hash da
// trilha própria no período exportado, dia a dia (a verificação de cada dia confere o primeiro elo com o último do dia
// anterior), e a identificação que abre o arquivo (software, versão, ambiente, estabelecimento, CNES, CNPJ, período,
// geração em RFC 3339 com o fuso).
import type { IdentificacaoExportacao, ProvaCadeia } from '@sgh/contratos';

const DIA_MS = 86_400_000;

/** Os dias civis de `inicio` a `fim` (AAAA-MM-DD, inclusive), até `maximo`. */
export function diasDoPeriodo(inicio: string, fim: string, maximo: number): string[] {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const dias: string[] = [];
  for (let t = a; t <= b && dias.length < maximo; t += DIA_MS)
    dias.push(new Date(t).toISOString().slice(0, 10));
  return dias;
}

export interface VerificacaoDia {
  readonly dia: string;
  readonly linhas: number;
  readonly ok: boolean;
  readonly quebraEm: string | null;
}

export function provaDaCadeia(verificacoes: readonly VerificacaoDia[]): ProvaCadeia {
  const quebra = verificacoes.find((v) => !v.ok) ?? null;
  return {
    dias: verificacoes.length,
    eventos: verificacoes.reduce((s, v) => s + v.linhas, 0),
    integra: quebra === null,
    quebraDia: quebra?.dia ?? null,
    quebraEm: quebra?.quebraEm ?? null,
  };
}

/** Data e hora RFC 3339 com o fuso do estabelecimento (-03:00 por padrão) e milissegundos (SBIS-21). */
export function rfc3339(d: Date, deslocamentoMinutos = -180): string {
  const local = new Date(d.getTime() + deslocamentoMinutos * 60_000).toISOString().slice(0, 23);
  const sinal = deslocamentoMinutos < 0 ? '-' : '+';
  const abs = Math.abs(deslocamentoMinutos);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sinal}${hh}:${mm}`;
}

/** Linhas do cabeçalho da exportação (CSV: comentário; XML: atributos do elemento de identificação). */
export function camposIdentificacao(i: IdentificacaoExportacao): [string, string][] {
  return [
    ['software', i.software],
    ['versao', i.versao],
    ['ambiente', i.ambiente],
    ['estabelecimento', i.estabelecimento ?? ''],
    ['cnes', i.cnes ?? ''],
    ['cnpj', i.cnpj ?? ''],
    ['inicio', i.inicio],
    ['fim', i.fim],
    ['geradoEm', i.geradoEm],
    ['geradoPor', i.geradoPor],
  ];
}

export function camposProva(p: ProvaCadeia): [string, string][] {
  return [
    ['diasVerificados', String(p.dias)],
    ['eventosVerificados', String(p.eventos)],
    ['cadeiaIntegra', p.integra ? 'sim' : 'nao'],
    ['quebraDia', p.quebraDia ?? ''],
    ['quebraEm', p.quebraEm ?? ''],
  ];
}
