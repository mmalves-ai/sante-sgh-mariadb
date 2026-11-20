// Documentos pessoais dentro do registro (D-DOC-1; ficha do cadastro, cap-08 §8.13): sem a permissão de ver
// documentos (`cadastro.paciente.verDocumento`), o CPF, o cartão nacional de saúde e a identidade não aparecem
// inteiros em nenhuma parte do registro: nem no cabeçalho do documento emitido, nem nos campos do formulário da
// época, nem nas respostas (a pergunta do tipo CPF). O formato mascarado é o do cadastro: CPF "***.***.789-01";
// os outros, só os 4 últimos dígitos. Além dos campos que se declaram documento (tipo, título ou nome), todo
// CPF formatado (000.000.000-00) que aparecer num texto é mascarado.
import type { CampoFormulario, ItemResposta, TextoFormatado, ValorCampoRegistro } from '@sgh/contratos';

/** Título ou nome de campo que é documento pessoal. */
const DOCUMENTO = /\b(cpf|cns|rg|identidade|cart[aã]o\s+(nacional\s+)?(de\s+)?sa[uú]de|cart[aã]o\s+sus)\b/i;
/** CPF formatado no meio de um texto. */
const CPF_FORMATADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;

/** Tipo de pergunta (rótulo de TIPOS_PERGUNTA) que guarda documento pessoal. */
const TIPOS_DOCUMENTO = new Set(['CPF']);

/** Mascara um documento: CPF (11 dígitos) como no cadastro; os demais, só os 4 últimos dígitos. */
export function mascararDocumento(valor: string): string {
  const d = valor.replace(/\D/g, '');
  if (d.length === 11) return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 4) return `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
  return d.length > 0 ? '****' : valor;
}

function mascararCpfsNoTexto(t: string): string {
  return t.replace(CPF_FORMATADO, (m) => mascararDocumento(m));
}

export function pareceDocumentoPessoal(...rotulos: readonly (string | null | undefined)[]): boolean {
  return rotulos.some((r) => !!r && DOCUMENTO.test(r.replace(/_/g, ' ')));
}

function textoFormatadoSemCpf(t: TextoFormatado): TextoFormatado {
  return {
    ...t,
    paragrafos: t.paragrafos.map((p) => ({
      ...p,
      trechos: p.trechos.map((x) => ({ ...x, texto: mascararCpfsNoTexto(x.texto) })),
    })),
  };
}

function valorMascarado(v: ValorCampoRegistro, documento: boolean): ValorCampoRegistro {
  const m = (s: string) => (documento ? mascararDocumento(s) : mascararCpfsNoTexto(s));
  switch (v.tipo) {
    case 'vazio':
      return v;
    case 'texto':
      return { tipo: 'texto', texto: m(v.texto) };
    case 'lista':
      return { tipo: 'lista', itens: v.itens.map(m) };
    case 'formatado':
      return { tipo: 'formatado', texto: textoFormatadoSemCpf(v.texto) };
  }
}

/** Campos do formulário (layout da época e documento emitido) sem documento pessoal inteiro. */
export function ocultarDocumentosDosCampos(campos: readonly CampoFormulario[]): CampoFormulario[] {
  return campos.map((c) => ({
    ...c,
    valor: valorMascarado(c.valor, pareceDocumentoPessoal(c.titulo, c.nome)),
  }));
}

/** Respostas (a pergunta do tipo CPF e as que se declaram documento) sem documento pessoal inteiro. */
export function ocultarDocumentosDasRespostas(itens: readonly ItemResposta[]): ItemResposta[] {
  return itens.map((i) => {
    const documento = TIPOS_DOCUMENTO.has(i.tipo) || pareceDocumentoPessoal(i.titulo);
    const m = (s: string) => (documento ? mascararDocumento(s) : mascararCpfsNoTexto(s));
    return {
      ...i,
      valores: i.valores.map(m),
      grade: i.grade
        ? { colunas: i.grade.colunas, linhas: i.grade.linhas.map((l) => l.map(mascararCpfsNoTexto)) }
        : null,
      itens: ocultarDocumentosDasRespostas(i.itens),
    };
  });
}
