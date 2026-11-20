// Termo de baixa do bem patrimonial (M54, etapa 6; ficha, seção 10, "Documento: ... termo de baixa ... em PDF/A"): o
// Gotenberg converte o HTML em PDF/A-2b (conferido pelo veraPDF no teste de integração dos documentos). Relido do banco
// (o bem baixado e o movimento de baixa registrado, nunca o que a tela mostrou), com a conta do valor contábil e do
// resultado da venda impressa. Autocontido: nenhum recurso externo. Nenhum dado de paciente.
import { type BemPatrimonial, type MovimentoBem, rotuloGrupoSemente } from '@sgh/contratos';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const reais = (cent: number) =>
  `R$ ${(cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const ESTILO = `body{font-family:sans-serif;font-size:10pt;margin:16mm}h1{font-size:14pt}table{border-collapse:collapse;width:100%;margin:6px 0}
th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{width:35%}td.v{text-align:right}
.assinaturas{display:flex;gap:24px;margin-top:36px}.assinaturas div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}`;

export interface TermoBaixaParaDocumento {
  readonly bem: BemPatrimonial;
  readonly baixa: MovimentoBem;
  readonly estabelecimento: string;
  readonly titular: string;
  readonly emitidoEm: string;
  readonly emitidoPor: string;
  /** W0-08: o nome do grupo no cadastro (sem ele, o rótulo da semente ou o código). */
  readonly grupoNome?: string;
}

/** O resultado da baixa: venda − valor contábil (sem venda, a perda é o valor contábil inteiro). */
export function resultadoDaBaixa(contabilCent: number, vendaCent: number | null): number {
  return (vendaCent ?? 0) - contabilCent;
}

export function htmlTermoBaixa(t: TermoBaixaParaDocumento): string {
  const { bem: b, baixa: m } = t;
  const linha = (rotulo: string, valor: string) =>
    `<tr><th scope="row">${esc(rotulo)}</th><td>${esc(valor)}</td></tr>`;
  const valor = (rotulo: string, cent: number) =>
    `<tr><th scope="row">${esc(rotulo)}</th><td class="v">${reais(cent)}</td></tr>`;
  const resultado = resultadoDaBaixa(b.contabilCent, m.valorVendaCent);
  const origem =
    b.documento === 'nota' && b.nota
      ? `Nota fiscal ${b.nota.numero ?? b.nota.id}${b.nota.serie ? `/${b.nota.serie}` : ''} de ${dataBr(b.nota.data)} (${b.nota.fornecedor ?? '—'})`
      : b.termo
        ? `Termo de doação ${b.termo.numero} de ${dataBr(b.termo.data)} (${b.termo.doador})`
        : '—';
  const titulo = `Termo de baixa ${m.termoNumero ?? m.id} · bem ${b.plaqueta}`;
  const corpo = `<h1>Termo de baixa de bem patrimonial nº ${esc(m.termoNumero ?? String(m.id))}</h1>
<p>${esc(t.estabelecimento)} · ${esc(t.titular)}</p>
<table><tbody>
${linha('Plaqueta', b.plaqueta)}
${linha('Descrição', b.descricao)}
${linha('Grupo', t.grupoNome ?? rotuloGrupoSemente(b.grupo))}
${linha('Origem', `${b.origem.nome}: ${origem}`)}
${linha('Setor (centro de custo)', `${b.centro.codigo ?? b.centro.id} ${b.centro.nome}`)}
${linha('Marca, modelo e série', [b.marca, b.modelo, b.numeroSerie].filter(Boolean).join(' · ') || '—')}
${linha('Aquisição', dataBr(b.dataAquisicao))}
${linha('Data da baixa', dataBr(m.data))}
${linha('Motivo', m.motivo)}
${linha('Registrada por', `${m.solicitadoPor} em ${dataBr(m.solicitadoEm)}`)}
</tbody></table>
<table><tbody>
${valor('Valor de aquisição', b.valorCent)}
${valor(`Depreciação acumulada (${b.cotas} cota(s), até ${b.ultimaCompetencia ?? '—'})`, b.acumuladaCent)}
${valor('Valor contábil na baixa', b.contabilCent)}
${valor('Valor da venda', m.valorVendaCent ?? 0)}
${valor(resultado >= 0 ? 'Ganho na baixa' : 'Perda na baixa', Math.abs(resultado))}
</tbody></table>
<p>Conta: ${reais(b.valorCent)} − ${reais(b.acumuladaCent)} = ${reais(b.contabilCent)} (valor contábil); ${reais(m.valorVendaCent ?? 0)} − ${reais(b.contabilCent)} = ${resultado < 0 ? '−' : ''}${reais(Math.abs(resultado))} (resultado).</p>
<div class="assinaturas"><div>Responsável pelo patrimônio</div><div>Diretoria administrativa</div></div>
<p>Emitido em ${dataBr(t.emitidoEm)} por ${esc(t.emitidoPor)}.</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;
}
