// HTML do demonstrativo do repasse e do RPA (M33; ficha, seção 10, "Documento"): o Gotenberg converte em PDF/A-2b
// (conferido pelo veraPDF no teste de integração dos documentos). Nenhum dado de paciente nem conta bancária; o RPA é o
// emitido, relido do banco (número, série, parcelas, título), com o contribuinte identificado pelo nome, pelo conselho e
// pelo CPF MASCARADO (ficha §4; o inteiro só pelo "mostrar" auditado do contas a pagar); a conta de cada valor impressa.
import type { DemonstrativoResposta } from '@sgh/contratos';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const reais = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESTILO = `body{font-family:sans-serif;font-size:10pt;margin:16mm}h1{font-size:14pt}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:3px 5px;text-align:left}td.v{text-align:right}tfoot td{font-weight:bold}`;

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;
}

export function htmlDemonstrativo(d: DemonstrativoResposta): string {
  const linhas = d.itens
    .map(
      (i) =>
        `<tr><td>${i.item}</td><td>${i.regra ?? '—'}</td><td>${esc(i.conta)}</td><td class="v">${reais(i.valor)}</td></tr>`,
    )
    .join('');
  return pagina(
    `Demonstrativo de repasse ${d.competencia}`,
    `<h1>Demonstrativo de repasse</h1>
<p>Competência ${esc(d.competencia)} · empresa ${d.empresa} · prestador ${d.prestador} · apuração ${d.apuracao} (${esc(d.estado)})</p>
<table><thead><tr><th>Item</th><th>Regra</th><th>Conta</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody>
<tfoot><tr><td colspan="3">Total (base ${reais(d.base)})</td><td class="v">${reais(d.valor)}</td></tr></tfoot></table>`,
  );
}

/** O RPA emitido, relido do banco (nunca a prévia da tela). */
export interface RpaParaDocumento {
  readonly rpa: {
    readonly serie: string;
    readonly numero: number;
    readonly inicio: string | null;
    readonly fim: string | null;
    readonly emissao: string | null;
    readonly prestador: number;
  };
  readonly lancamentos: readonly { id: number; data: string | null; evento: number; valor: number }[];
  readonly retencoes: {
    bruto: number;
    baseInss: number;
    inss: number;
    baseIrrf: number;
    irrf: number;
    iss: number;
    liquido: number;
  } | null;
  readonly titulo: { id: number; valor: number; vencimento: string | null } | null;
  readonly contribuinte: { nome: string; conselho: string; documento: string } | null;
  readonly eventos: ReadonlyMap<number, string>;
}

const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

export function htmlRpaEmitido(r: RpaParaDocumento): string {
  const linha = (rotulo: string, v: number) =>
    `<tr><td>${esc(rotulo)}</td><td class="v">${reais(v)}</td></tr>`;
  const c = r.contribuinte;
  const competencia = r.rpa.fim ? r.rpa.fim.slice(0, 7) : (r.rpa.emissao ?? '').slice(0, 7);
  const lancs = r.lancamentos
    .map(
      (l) =>
        `<tr><td>${l.id}</td><td>${dataBr(l.data)}</td><td>${esc(r.eventos.get(l.evento) ?? `Evento ${l.evento}`)}</td><td class="v">${reais(l.valor)}</td></tr>`,
    )
    .join('');
  const t = r.retencoes;
  const retencoes = t
    ? `<table><tbody>${linha('Bruto', t.bruto)}${linha('Base do INSS', t.baseInss)}${linha('INSS', t.inss)}${linha('Base do IRRF', t.baseIrrf)}${linha('IRRF', t.irrf)}${linha('ISS', t.iss)}</tbody>
<tfoot>${linha('Líquido', t.liquido)}</tfoot></table>
<p>${reais(t.bruto)} − INSS ${reais(t.inss)} − IRRF ${reais(t.irrf)} − ISS ${reais(t.iss)} = ${reais(t.liquido)}</p>`
    : '<p>As retenções deste RPA não foram registradas por este sistema.</p>';
  return pagina(
    `RPA ${r.rpa.serie} ${r.rpa.numero}`,
    `<h1>Recibo de pagamento a autônomo (RPA) ${esc(r.rpa.serie)} nº ${r.rpa.numero}</h1>
<p>Emissão ${dataBr(r.rpa.emissao)} · período ${dataBr(r.rpa.inicio)} a ${dataBr(r.rpa.fim)} · competência ${esc(competencia)}</p>
<p>Contribuinte: ${c ? `${esc(c.nome)} · conselho ${esc(c.conselho)}${c.documento ? ` · CPF ${esc(c.documento)}` : ''}` : `prestador ${r.rpa.prestador}`}</p>
<table><thead><tr><th>Lançamento</th><th>Data</th><th>Evento</th><th>Valor</th></tr></thead><tbody>${lancs}</tbody></table>
${retencoes}
<p>${r.titulo ? `Título a pagar ${r.titulo.id}: ${reais(r.titulo.valor)}, vencimento ${dataBr(r.titulo.vencimento)}.` : 'Sem título a pagar ligado.'}</p>`,
  );
}
