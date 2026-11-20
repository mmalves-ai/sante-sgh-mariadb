// Apoio das telas dos envios à ANS (M56, etapa 7, F6): a competência sugerida (o último período encerrado de cada
// obrigação), a conferência do formato antes de pedir a prévia, a competência para a tela e o corpo do retorno da ANS
// montado a partir do que a pessoa marcou. Puro (o relógio entra como parâmetro).
import { OBRIGACOES_ANS, type ObrigacaoAns } from '@sgh/contratos';

const dois = (n: number) => String(n).padStart(2, '0');

/** O último período encerrado em `hoje` (mensal: o mês anterior; trimestral: o trimestre anterior; sob demanda: hoje). */
export function competenciaSugerida(obrigacao: ObrigacaoAns, hoje: string): string {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const per = OBRIGACOES_ANS[obrigacao].periodicidade;
  if (per === 'mensal') return m === 1 ? `${a - 1}-12` : `${a}-${dois(m - 1)}`;
  if (per === 'trimestral') {
    const t = Math.floor((m - 1) / 3) + 1;
    return t === 1 ? `${a - 1}-T4` : `${a}-T${t - 1}`;
  }
  return hoje.slice(0, 10);
}

/** O formato da competência confere com a periodicidade da obrigação (a regra completa fica no servidor). */
export function competenciaNoFormato(obrigacao: ObrigacaoAns, c: string): boolean {
  const per = OBRIGACOES_ANS[obrigacao].periodicidade;
  if (per === 'mensal') return /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
  if (per === 'trimestral') return /^\d{4}-T[1-4]$/.test(c);
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(c);
}

/** A competência para a tela: 09/2026, 3º trimestre de 2026 ou 15/09/2026. */
export function competenciaTela(c: string): string {
  const t = /^(\d{4})-T([1-4])$/.exec(c);
  if (t) return `${t[2]}º trimestre de ${t[1]}`;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c);
  if (d) return `${d[3]}/${d[2]}/${d[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  return m ? `${m[2]}/${m[1]}` : c;
}

export interface MarcaRetorno {
  readonly ordem: number;
  readonly aceito: boolean;
  readonly cco: string;
  readonly erro: string;
}

/**
 * O corpo do retorno da ANS: no simulador, só `simular`; na ANS, o arquivo rejeitado inteiro ou os itens (os aceitos com
 * o CCO, quando informado; os rejeitados com o erro).
 */
export function corpoRetorno(
  versao: number,
  modo: 'simular' | 'rejeitado' | 'itens',
  resumo: string,
  marcas: readonly MarcaRetorno[],
): Record<string, unknown> {
  if (modo === 'simular') return { versao, simular: true };
  const r = resumo.trim() || null;
  if (modo === 'rejeitado') return { versao, rejeitado: true, resumo: r };
  return {
    versao,
    resumo: r,
    itens: marcas.map((x) => ({
      ordem: x.ordem,
      aceito: x.aceito,
      ...(x.aceito && x.cco.trim() ? { cco: x.cco.trim() } : {}),
      ...(!x.aceito ? { erro: x.erro.trim() || null } : {}),
    })),
  };
}

/** Linha do aviso de ressarcimento colada da notificação: tipo;número;identificação;início;fim;procedimento;valor. */
export interface AtendimentoLido {
  readonly tipo: string;
  readonly numero: string;
  readonly identificacao: string;
  readonly inicio: string;
  readonly fim: string;
  readonly procedimento: string;
  readonly valor: number;
}

const dataIso = (v: string): string => {
  const b = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  return b ? `${b[3]}-${b[2]}-${b[1]}` : v.trim();
};

/**
 * Lê os atendimentos colados (um por linha, campos separados por ponto e vírgula ou tabulação; data em DD/MM/AAAA ou
 * AAAA-MM-DD; valor com vírgula ou ponto). Devolve as linhas lidas e os números das linhas que não têm os 7 campos (o
 * servidor confere cada campo de novo).
 */
export function lerAtendimentos(texto: string): { itens: AtendimentoLido[]; invalidas: number[] } {
  const itens: AtendimentoLido[] = [];
  const invalidas: number[] = [];
  texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((l, i) => {
      if (!l) return;
      const c = l.split(/[;\t]/).map((x) => x.trim());
      const v = c[6] ?? '';
      const valor = Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
      if (c.length !== 7 || !Number.isFinite(valor) || !v) {
        invalidas.push(i + 1);
        return;
      }
      itens.push({
        tipo: c[0]!.toUpperCase(),
        numero: c[1]!.replace(/\D/g, ''),
        identificacao: c[2]!.replace(/\D/g, ''),
        inicio: dataIso(c[3]!),
        fim: dataIso(c[4]!),
        procedimento: c[5]!.replace(/\D/g, ''),
        valor,
      });
    });
  return { itens, invalidas };
}
