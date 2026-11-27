// C2-034 (04-INT linha 69, passo 3): a guia TISS de solicitação (internação, SP/SADT, prorrogação, OPME...) impressa a
// partir do pedido de autorização prévia: cabeçalho, beneficiário (carteira mascarada: a via impressa aqui é a de
// conferência), diagnósticos (CID) e procedimentos solicitados. O PDF sai pelo mesmo gerador das guias da conta.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const NOMES: Record<string, string> = {
  internacao: 'Solicitação de Internação',
  sp_sadt: 'SP/SADT',
  prorrogacao: 'Solicitação de Prorrogação de Internação',
  quimioterapia: 'Anexo de Quimioterapia',
  radioterapia: 'Anexo de Radioterapia',
  opme: 'Anexo de OPME',
};

export interface PedidoParaGuia {
  numero: string;
  tipo: string;
  fontePagadora: string;
  carteira: string;
  conta: number | null;
  solicitadaEm: string | null;
  diagnosticos: readonly { sequencia: number; principal: boolean; cid: string; descricao: string }[];
  itens: readonly {
    sequencia: number;
    codigoTabela: string;
    codigoProcedimento: string;
    descricao: string;
    quantidade: number;
  }[];
}

/** A carteira na via de conferência: só os 4 últimos caracteres. */
export const carteiraMascarada = (c: string) =>
  c.length <= 4 ? '*'.repeat(c.length) : `${'*'.repeat(c.length - 4)}${c.slice(-4)}`;

export const nomeGuiaSolicitacao = (tipo: string) => NOMES[tipo] ?? tipo;

export function guiaSolicitacaoHtml(p: PedidoParaGuia): string {
  const campo = (n: number, rotulo: string, valor: string) =>
    `<div class="c"><span class="n">${n} - ${esc(rotulo)}</span><span class="v">${esc(valor)}</span></div>`;
  const nome = nomeGuiaSolicitacao(p.tipo);
  const cids = p.diagnosticos
    .map(
      (d) =>
        `<tr><td>${d.principal ? 'Principal' : d.sequencia}</td><td>${esc(d.cid)}</td><td>${esc(d.descricao)}</td></tr>`,
    )
    .join('');
  const itens = p.itens
    .slice(0, 200)
    .map(
      (i) =>
        `<tr><td>${i.sequencia}</td><td>${esc(i.codigoTabela)}</td><td>${esc(i.codigoProcedimento)}</td><td>${esc(i.descricao)}</td><td class="d">${i.quantidade.toLocaleString('pt-BR')}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia ${esc(nome)} ${esc(p.numero)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;margin:12mm}
h1{font-size:12pt;margin:0 0 4mm} h2{font-size:10pt;margin:3mm 0 1mm} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin-bottom:3mm}
.c{border:1px solid #000;padding:1mm 2mm;min-height:9mm}.n{display:block;font-size:6.5pt}.v{font-size:9pt}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:1mm}.d{text-align:right}
footer{margin-top:4mm;font-size:7pt}
</style></head><body>
<h1>GUIA DE ${esc(nome.toUpperCase())} — Padrão TISS 04.03.00</h1>
<div class="g">${campo(1, 'Registro ANS', '')}${campo(2, 'Nº Guia no Prestador', p.numero)}${campo(3, 'Operadora', p.fontePagadora)}${campo(4, 'Data da solicitação', p.solicitadaEm?.slice(0, 10) ?? '')}</div>
<div class="g">${campo(7, 'Número da carteira (conferência)', carteiraMascarada(p.carteira))}${campo(10, 'Conta', p.conta === null ? '—' : String(p.conta))}</div>
<h2>Diagnósticos (CID-10)</h2>
<table><thead><tr><th>Seq.</th><th>CID</th><th>Descrição</th></tr></thead><tbody>${cids}</tbody></table>
<h2>Procedimentos solicitados</h2>
<table><thead><tr><th>Seq.</th><th>Tabela</th><th>Código</th><th>Descrição</th><th>Qtde</th></tr></thead><tbody>${itens}</tbody></table>
<footer>Via de conferência do pedido de autorização prévia. A carteira sai mascarada.</footer>
</body></html>`;
}
