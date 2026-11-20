// Regra 6 do M08 (cap-08 §8.13): exportar exige a permissão `exportar` e trilha; com campo de dado pessoal,
// exige a justificativa de PRTIPO_JUSTIF_EXPORTACAO (4 justificativas do legado, domínio de auditoria).
// CSV em CP1252-compatível (o conteúdo já é CP1252), separador ';' (padrão do Excel em pt-BR), aspas
// duplicadas, e neutralização de fórmula (célula que começa com = + - @ ganha apóstrofo).
import type { CampoDescrito, ItemDominio } from '@sgh/contratos';

export type RecusaExportacao = 'sem-permissao' | 'justificativa-obrigatoria' | 'justificativa-inexistente';

export function conferirExportacao(o: {
  readonly podeExportar: boolean;
  readonly temDadoPessoal: boolean;
  readonly justificativa: number | undefined;
  readonly justificativasValidas: ReadonlySet<number>;
}): RecusaExportacao | null {
  if (!o.podeExportar) return 'sem-permissao';
  if (!o.temDadoPessoal) return null;
  if (o.justificativa === undefined) return 'justificativa-obrigatoria';
  if (!o.justificativasValidas.has(o.justificativa)) return 'justificativa-inexistente';
  return null;
}

function celula(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function gerarCsv(
  campos: readonly Pick<CampoDescrito, 'campo' | 'rotulo'>[],
  itens: readonly ItemDominio[],
  rotuloAtivo = 'Situação',
): string {
  const cab = ['Código', ...campos.map((c) => c.rotulo), rotuloAtivo].map(celula).join(';');
  const linhas = itens.map((i) =>
    [i.codigo, ...campos.map((c) => i.valores[c.campo] ?? ''), i.ativo ? 'Ativo' : 'Inativo']
      .map(celula)
      .join(';'),
  );
  return `${[cab, ...linhas].join('\r\n')}\r\n`;
}
