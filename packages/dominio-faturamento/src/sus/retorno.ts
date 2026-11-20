// Retorno do gestor SUS (ficha do M51, seção 5: `faturamento.importarRetornoSus`; "espelho e rejeições do gestor;
// reapresentação"). O SIHD2 devolve ao prestador o espelho das AIHs processadas (aprovadas, rejeitadas com o motivo,
// valores) e o SIA o relatório de produção do BPA (aprovada, glosada, rejeitada). O faturamento transcreve ou exporta o
// relatório para um texto CSV com cabeçalho (D-RETORNO-51), separado por ponto e vírgula:
//   instrumento;competencia;identificacao;procedimento;situacao;motivo;valor_apresentado;valor_aprovado
// - identificação: o número da AIH (13 dígitos, conferido pelo dígito) ou a linha do BPA (tipo C ou I, folha e
//   sequência: `C-001-01`);
// - situação: aprovada, rejeitada ou glosada (aceita também A, R e G);
// - valores em reais, com vírgula ou ponto decimal (vazios quando o relatório não traz).
// A glosa é o apresentado menos o aprovado (nunca negativa). Puro: a gravação e a ligação com a AIH ou a linha do BPA
// ficam na API.
import { COLUNAS_RETORNO_SUS, type InstrumentoRetornoSus, type SituacaoRetornoSus } from '@sgh/contratos';
import { numeroAihValido } from './aih.js';

export interface LinhaRetornoSus {
  readonly linha: number;
  readonly identificacao: string;
  readonly procedimento: string | null;
  readonly situacao: SituacaoRetornoSus;
  readonly motivo: string | null;
  readonly valorApresentado: number | null;
  readonly valorAprovado: number | null;
  readonly valorGlosado: number;
  /** BPA: o tipo, a folha e a sequência da linha. */
  readonly bpa: { readonly tipo: 'c' | 'i'; readonly folha: number; readonly sequencia: number } | null;
}

export type ProblemaRetornoSus =
  | 'cabecalho-invalido'
  | 'colunas-a-menos'
  | 'instrumento-diferente'
  | 'competencia-diferente'
  | 'identificacao-invalida'
  | 'situacao-invalida'
  | 'valor-invalido'
  | 'identificacao-repetida';

export interface LeituraRetornoSus {
  readonly linhas: readonly LinhaRetornoSus[];
  readonly erros: readonly { readonly linha: number; readonly problema: ProblemaRetornoSus }[];
}

const SITUACOES: Readonly<Record<string, SituacaoRetornoSus>> = {
  a: 'aprovada',
  aprovada: 'aprovada',
  aprovado: 'aprovada',
  r: 'rejeitada',
  rejeitada: 'rejeitada',
  rejeitado: 'rejeitada',
  g: 'glosada',
  glosada: 'glosada',
  glosado: 'glosada',
};

/** Valor em reais ("1.234,56", "1234.56" ou vazio). */
export function valorDoRetorno(v: string): number | null | 'invalido' {
  const t = v.trim();
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return 'invalido';
  return Math.round(Number(normal) * 100) / 100;
}

const BPA = /^([CI])-(\d{1,3})-(\d{1,2})$/;

/** A identificação normalizada (AIH: 13 dígitos; BPA: `C-001-01`) ou null quando não confere. */
export function identificacaoDoRetorno(
  instrumento: InstrumentoRetornoSus,
  v: string,
): { id: string; bpa: LinhaRetornoSus['bpa'] } | null {
  const t = v.trim().toUpperCase().replace(/\s/g, '');
  if (instrumento === 'aih') {
    const d = t.replace(/\D/g, '');
    return numeroAihValido(d) ? { id: d, bpa: null } : null;
  }
  const m = BPA.exec(t);
  if (!m) return null;
  const tipo = m[1] === 'C' ? 'c' : 'i';
  const folha = Number(m[2]);
  const sequencia = Number(m[3]);
  if (folha < 1 || sequencia < 1) return null;
  return {
    id: `${m[1]}-${String(folha).padStart(3, '0')}-${String(sequencia).padStart(2, '0')}`,
    bpa: { tipo, folha, sequencia },
  };
}

/**
 * Lê o retorno: o cabeçalho com as oito colunas, uma linha por registro do gestor. Linha com erro fica fora (listada);
 * a identificação repetida no mesmo arquivo também (a primeira vale).
 */
export function lerRetornoSus(
  conteudo: string,
  instrumento: InstrumentoRetornoSus,
  competencia: string,
): LeituraRetornoSus {
  const brutas = conteudo.replace(/^\uFEFF/, '').split(/\r?\n/);
  const erros: { linha: number; problema: ProblemaRetornoSus }[] = [];
  const linhas: LinhaRetornoSus[] = [];
  const cab = (brutas[0] ?? '')
    .split(';')
    .map((x) => x.trim().toLowerCase())
    .join(';');
  if (cab !== COLUNAS_RETORNO_SUS.join(';'))
    return { linhas, erros: [{ linha: 1, problema: 'cabecalho-invalido' }] };
  const vistas = new Set<string>();
  brutas.slice(1).forEach((texto, k) => {
    const linha = k + 2;
    if (!texto.trim()) return;
    const c = texto.split(';');
    if (c.length < COLUNAS_RETORNO_SUS.length) {
      erros.push({ linha, problema: 'colunas-a-menos' });
      return;
    }
    const [ins, comp, ident, proc, sit, mot, vap, vapr] = c.map((x) => x.trim()) as string[];
    if ((ins ?? '').toLowerCase() !== instrumento) {
      erros.push({ linha, problema: 'instrumento-diferente' });
      return;
    }
    if ((comp ?? '').replace(/\D/g, '') !== competencia) {
      erros.push({ linha, problema: 'competencia-diferente' });
      return;
    }
    const id = identificacaoDoRetorno(instrumento, ident ?? '');
    if (!id) {
      erros.push({ linha, problema: 'identificacao-invalida' });
      return;
    }
    const situacao = SITUACOES[(sit ?? '').toLowerCase()];
    if (!situacao) {
      erros.push({ linha, problema: 'situacao-invalida' });
      return;
    }
    const apresentado = valorDoRetorno(vap ?? '');
    const aprovado = valorDoRetorno(vapr ?? '');
    if (apresentado === 'invalido' || aprovado === 'invalido') {
      erros.push({ linha, problema: 'valor-invalido' });
      return;
    }
    const chave = `${id.id}|${(proc ?? '').replace(/\D/g, '')}`;
    if (vistas.has(chave)) {
      erros.push({ linha, problema: 'identificacao-repetida' });
      return;
    }
    vistas.add(chave);
    const procedimento = (proc ?? '').replace(/\D/g, '');
    const glosa =
      situacao === 'rejeitada'
        ? (apresentado ?? 0)
        : apresentado !== null && aprovado !== null
          ? Math.max(0, Math.round((apresentado - aprovado) * 100) / 100)
          : 0;
    linhas.push({
      linha,
      identificacao: id.id,
      procedimento: procedimento.length === 10 ? procedimento : null,
      situacao,
      motivo: (mot ?? '').slice(0, 60) || null,
      valorApresentado: apresentado,
      valorAprovado: situacao === 'rejeitada' ? 0 : aprovado,
      valorGlosado: glosa,
      bpa: id.bpa,
    });
  });
  return { linhas, erros };
}

/** Resumo por situação e o total glosado (o que a tela e a trilha mostram). */
export function resumoRetornoSus(linhas: readonly Pick<LinhaRetornoSus, 'situacao' | 'valorGlosado'>[]): {
  porSituacao: Record<string, number>;
  valorGlosado: number;
} {
  const porSituacao: Record<string, number> = {};
  let g = 0;
  for (const l of linhas) {
    porSituacao[l.situacao] = (porSituacao[l.situacao] ?? 0) + 1;
    g += l.valorGlosado;
  }
  return { porSituacao, valorGlosado: Math.round(g * 100) / 100 };
}
