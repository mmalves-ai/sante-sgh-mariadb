// Inventário de bens pela leitura do QR (M54, etapa 6; ficha, regra 13): cada leitura é classificada (no lugar, em
// outro setor, código sem bem, bem baixado ou emprestado encontrado, repetida) e o encerramento registra os esperados não
// encontrados. NADA é corrigido sozinho: a divergência fica para o responsável tratar (transferir, baixar, cadastrar).
// Esperados: os bens em uso (situação `ativo`) do setor do inventário, ou do estabelecimento inteiro.
import {
  RESULTADOS_LEITURA_INVENTARIO,
  type ResultadoLeituraInventario,
  type ResumoInventario,
  type SituacaoBem,
} from '@sgh/contratos';

export interface BemParaInventario {
  readonly id: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly centro: number;
  readonly situacao: SituacaoBem;
}

/** Resultado da leitura de um bem (null: o código não tem bem) lido no setor `centroLido`. */
export function resultadoDaLeitura(
  bem: BemParaInventario | null,
  centroLido: number,
  jaLidos: ReadonlySet<number>,
): ResultadoLeituraInventario {
  if (!bem) return 'nao-cadastrado';
  if (jaLidos.has(bem.id)) return 'repetida';
  if (bem.situacao === 'baixado') return 'baixado';
  if (bem.situacao === 'emprestado') return 'emprestado';
  return bem.centro === centroLido ? 'conforme' : 'outro-local';
}

export interface LeituraParaResumo {
  readonly bem: number | null;
  readonly resultado: ResultadoLeituraInventario;
}

/** Teto da lista de não encontrados guardada no encerramento (o resumo cabe em 2.000 caracteres). */
export const TETO_NAO_ENCONTRADOS_GUARDADOS = 150;

export function resumoDoInventario(
  esperados: readonly BemParaInventario[],
  leituras: readonly LeituraParaResumo[],
): ResumoInventario {
  const porResultado = Object.fromEntries(RESULTADOS_LEITURA_INVENTARIO.map((r) => [r, 0])) as Record<
    ResultadoLeituraInventario,
    number
  >;
  const lidos = new Set<number>();
  for (const l of leituras) {
    porResultado[l.resultado] += 1;
    if (l.bem !== null) lidos.add(l.bem);
  }
  const naoEncontrados = esperados
    .filter((b) => b.situacao === 'ativo' && !lidos.has(b.id))
    .map((b) => ({ bem: b.id, plaqueta: b.plaqueta, descricao: b.descricao, centro: b.centro }));
  return {
    esperados: esperados.length,
    leituras: leituras.length,
    porResultado,
    naoEncontrados,
    naoEncontradosTotal: naoEncontrados.length,
    listaCompleta: true,
  };
}

/**
 * O resumo gravado no encerramento (JSON até 2.000 caracteres): as contagens e os não encontrados (id e plaqueta) até o
 * teto; `completo: false` quando a lista foi cortada (a contagem é sempre a inteira).
 */
export function resumoParaGravar(r: ResumoInventario): string {
  const lista = r.naoEncontrados.slice(0, TETO_NAO_ENCONTRADOS_GUARDADOS);
  const montar = (n: number) =>
    JSON.stringify({
      esperados: r.esperados,
      leituras: r.leituras,
      porResultado: r.porResultado,
      naoEncontrados: r.naoEncontrados.length,
      lista: lista.slice(0, n).map((b) => [b.bem, b.plaqueta]),
      completo: n >= r.naoEncontrados.length,
    });
  let n = lista.length;
  let txt = montar(n);
  while (txt.length > 2000 && n > 0) {
    n = Math.max(0, n - 10);
    txt = montar(n);
  }
  return txt;
}

/**
 * Lê o resumo gravado no encerramento (null quando ilegível). A lista traz id e plaqueta; descrição e setor vêm da
 * leitura dos bens (quem chama completa).
 */
export function lerResumoGravado(texto: string | null): ResumoInventario | null {
  if (!texto) return null;
  try {
    const j = JSON.parse(texto) as {
      esperados: number;
      leituras: number;
      porResultado: Record<ResultadoLeituraInventario, number>;
      naoEncontrados: number;
      lista: [number, string][];
      completo: boolean;
    };
    return {
      esperados: j.esperados,
      leituras: j.leituras,
      porResultado: j.porResultado,
      naoEncontrados: j.lista.map(([bem, plaqueta]) => ({ bem, plaqueta, descricao: '', centro: 0 })),
      naoEncontradosTotal: j.naoEncontrados,
      listaCompleta: j.completo,
    };
  } catch {
    return null;
  }
}
