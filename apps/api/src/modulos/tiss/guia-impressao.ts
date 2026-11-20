// A guia TISS no leiaute da ANS para impressão (M31; ficha, seção 7, "Guias TISS"; PDF/A pelo Gotenberg, ADR 0020):
// os campos numerados do registro da ANS (cabeçalho, beneficiário, contratado, procedimentos e totais), a partir da
// conta EMITIDA (a emissão segue no outro sistema até o cenário controlado do M36: P2 faturamento.emitirConta). A
// carteira sai mascarada (D-GUIA-31: a via impressa aqui é a de conferência).
import type { GuiaLida, ItemGlosaLido } from '@sgh/contratos';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reais = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function guiaHtml(g: GuiaLida, itens: readonly ItemGlosaLido[]): string {
  const campo = (n: number, rotulo: string, valor: string) =>
    `<div class="c"><span class="n">${n} - ${esc(rotulo)}</span><span class="v">${esc(valor)}</span></div>`;
  const linhas = itens
    .slice(0, 200)
    .map(
      (i, k) =>
        `<tr><td>${k + 1}</td><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td class="d">${i.quantidade.toLocaleString('pt-BR')}</td><td class="d">${reais(i.valorCobrado)}</td></tr>`,
    )
    .join('');
  const total = itens.reduce((s, i) => s + i.valorCobrado, 0);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia ${esc(g.tipoGuiaNome)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;margin:12mm}
h1{font-size:12pt;margin:0 0 4mm} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin-bottom:3mm}
.c{border:1px solid #000;padding:1mm 2mm;min-height:9mm}.n{display:block;font-size:6.5pt}.v{font-size:9pt}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:1mm}.d{text-align:right}
footer{margin-top:4mm;font-size:7pt}
</style></head><body>
<h1>GUIA DE ${esc(g.tipoGuiaNome.toUpperCase())} — Padrão TISS 04.03.00</h1>
<div class="g">${campo(1, 'Registro ANS', '')}${campo(2, 'Nº Guia no Prestador', g.numeroGuia)}${campo(3, 'Convênio', g.convenioNome)}${campo(4, 'Data da emissão', g.dataEmissao ?? '')}</div>
<div class="g">${campo(8, 'Número da carteira (conferência)', g.beneficiario)}${campo(10, 'Conta', g.chave)}${campo(11, 'Tipo de conta', g.tipoConta === 'I' ? 'Internação' : 'Externa')}${campo(12, 'Lote', g.lote ? String(g.lote) : '—')}</div>
<table><thead><tr><th>Seq.</th><th>Código</th><th>Descrição</th><th>Qtde</th><th>Valor (R$)</th></tr></thead><tbody>${linhas}</tbody>
<tfoot><tr><td colspan="4">Total geral</td><td class="d">${reais(total)}</td></tr></tfoot></table>
<footer>Via de conferência gerada a partir da conta emitida. A emissão e a numeração da guia seguem no cadastro de origem.</footer>
</body></html>`;
}
