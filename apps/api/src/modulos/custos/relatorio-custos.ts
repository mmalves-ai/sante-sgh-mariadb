// HTML do relatório de custos do mês (M54, etapa 5; ficha, seção 10, "Documento: ... relatório de custos em PDF/A"): o
// Gotenberg converte em PDF/A-2b, como os demais documentos. A apuração vigente da competência, relida do banco: a marca
// de completude (regra 8), a conservação com as parcelas impressas (custo direto lido = custo final dos produtivos + não
// rateado + despesas não distribuídas), o custo de cada centro com o direto por grupo, os rateios recebidos e repassados,
// a produção e o custo unitário, e as pendências. Nenhum dado de paciente: o relatório é por centro de custo.
import {
  type ApuracaoCustos,
  ESTATISTICAS_CUSTO,
  GRUPOS_CUSTO_DIRETO,
  type LinhaApuracaoCentro,
  ROTULOS_GRUPO_CUSTO_DIRETO,
  ROTULOS_SITUACAO_APURACAO,
} from '@sgh/contratos';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Centavos → "R$ 1.234,56" (negativo com o sinal). */
export function reaisDeCentavos(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const inteiro = Math.trunc(abs / 100).toLocaleString('pt-BR');
  const cent = String(abs % 100).padStart(2, '0');
  return `${neg ? '−' : ''}R$ ${inteiro},${cent}`;
}

/** Centésimos → "1.234,5" (até duas casas). */
function quantidadeDeCentesimos(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const UNIDADES: ReadonlyMap<string, string> = new Map(ESTATISTICAS_CUSTO.map((e) => [e.codigo, e.unidade]));

const CLASSES: Readonly<Record<string, string>> = {
  produtivo: 'Produtivo',
  auxiliar: 'Auxiliar',
  administrativo: 'Administrativo',
};

const ESTILO = `body{font-family:sans-serif;font-size:8pt;margin:10mm}h1{font-size:13pt}h2{font-size:10pt;margin-top:8mm}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}
td.v,th.v{text-align:right}tfoot td{font-weight:bold}p.conta{font-family:monospace}`;

function linhaCentro(l: LinhaApuracaoCentro, nomes: ReadonlyMap<number, string>): string {
  const recebidos =
    l.recebidos.length === 0
      ? '—'
      : l.recebidos
          .map((r) => `${esc(nomes.get(r.de) ?? String(r.de))}: ${reaisDeCentavos(r.centavos)}`)
          .join('<br>');
  const producao = l.producao
    ? `${quantidadeDeCentesimos(l.producao.quantidadeCent)} ${esc(UNIDADES.get(l.producao.codigo) ?? l.producao.codigo)}`
    : '—';
  return `<tr><td>${l.codigo}</td><td>${esc(l.nome)}</td><td>${CLASSES[l.classe] ?? esc(l.classe)}</td>${GRUPOS_CUSTO_DIRETO.map(
    (g) => `<td class="v">${reaisDeCentavos(l.direto[g])}</td>`,
  ).join('')}<td class="v">${reaisDeCentavos(l.despesasGerais)}</td><td>${recebidos}</td>
<td class="v">${reaisDeCentavos(l.repassado)}</td><td class="v">${reaisDeCentavos(l.custoFinal)}</td><td class="v">${producao}</td>
<td class="v">${l.custoUnitario === null ? '—' : reaisDeCentavos(l.custoUnitario)}</td></tr>`;
}

/** O relatório de custos da apuração (HTML para o PDF/A). */
export function htmlRelatorioCustos(a: ApuracaoCustos): string {
  const t = a.totais;
  const nomes = new Map(a.linhas.map((l) => [l.centro, `${l.codigo} ${l.nome}`]));
  const situacao = ROTULOS_SITUACAO_APURACAO[a.situacao];
  const completude = a.completude.rotulo ? `Custeio ${a.completude.rotulo}` : 'Custeio completo';
  const fontes = a.completude.fontes
    .map((f) => `${esc(f.fonte)}: ${f.presente ? 'presente' : 'ausente'} (${esc(f.detalhe)})`)
    .join('; ');
  const direto = GRUPOS_CUSTO_DIRETO.map((g) => reaisDeCentavos(t.direto[g]));
  const conta =
    `Custo direto lido: ${direto.join(' + ')} + ${reaisDeCentavos(t.despesasSemCentro)} (despesas sem centro) = ` +
    `${reaisDeCentavos(t.diretoTotal)}. Destino: ${reaisDeCentavos(t.custoFinalProdutivos)} (custo final dos produtivos) + ` +
    `${reaisDeCentavos(t.naoRateado)} (não rateado) + ${reaisDeCentavos(t.despesasNaoDistribuidas)} (despesas não ` +
    `distribuídas) = ${reaisDeCentavos(t.custoFinalProdutivos + t.naoRateado + t.despesasNaoDistribuidas)}.`;
  const pendencias =
    a.pendencias.length === 0
      ? '<p>Nenhuma pendência.</p>'
      : `<ul>${a.pendencias
          .map(
            (p) =>
              `<li>${esc(p.mensagem)}${p.centavos ? ` (${reaisDeCentavos(p.centavos)})` : ''}${
                p.centros.length
                  ? ` · centros: ${p.centros.map((c) => esc(nomes.get(c) ?? String(c))).join(', ')}`
                  : ''
              }</li>`,
          )
          .join('')}</ul>`;
  const titulo = `Relatório de custos ${a.competencia}`;
  const totalFinal = a.linhas.reduce((s, l) => s + l.custoFinal, 0);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>
<h1>Relatório de custos do mês</h1>
<p>Competência ${esc(a.competencia)} · ${esc(situacao)} · versão ${a.versao} · ${esc(completude)}</p>
<p>Apurada por ${esc(a.apuradaPor)} em ${esc(a.apuradaEm)}${
    a.aprovadaPor ? ` · aprovada por ${esc(a.aprovadaPor)} em ${esc(a.aprovadaEm ?? '')}` : ''
  }${a.justificativa ? ` · justificativa: ${esc(a.justificativa)}` : ''}</p>
<p>Fontes: ${fontes}</p>
<p>Impressão digital (SHA-256): ${esc(a.impressao)}</p>
<h2>Conservação do custo</h2>
<p class="conta">${esc(conta)}</p>
<p>Fora do custeio (centros sem classe): ${reaisDeCentavos(t.foraDoCusteio)} · linhas de saída atípicas (acima de ${reaisDeCentavos(
    a.limiteLinhaSaida,
  )} cada): ${t.atipicas.linhas} linha(s), ${reaisDeCentavos(t.atipicas.centavos)} · devoluções ao estoque descontadas dos materiais: ${
    t.devolucoes?.linhas ?? 0
  } linha(s), ${reaisDeCentavos(t.devolucoes?.centavos ?? 0)}${
    t.devolucoes?.linhasAtipicas
      ? ` (mais ${t.devolucoes.linhasAtipicas} de saídas atípicas, ${reaisDeCentavos(t.devolucoes.centavosAtipicas)}, fora como a saída)`
      : ''
  }</p>
<p>Receita das contas: bruta ${reaisDeCentavos(t.receitaBruta)}, líquida ${reaisDeCentavos(t.receitaLiquida)} · ${t.contas} conta(s) ·
custo nas contas ${reaisDeCentavos(t.custoNasContas)} + custo sem conta ${reaisDeCentavos(t.custoSemConta)}</p>
<h2>Custo por centro (absorção com rateio sequencial)</h2>
<table><thead><tr><th>Código</th><th>Centro de custo</th><th>Classe</th>${GRUPOS_CUSTO_DIRETO.map(
    (g) => `<th class="v">${esc(ROTULOS_GRUPO_CUSTO_DIRETO[g])}</th>`,
  ).join('')}<th class="v">Despesas gerais</th><th>Rateios recebidos</th><th class="v">Repassado</th>
<th class="v">Custo final</th><th class="v">Produção</th><th class="v">Custo unitário</th></tr></thead>
<tbody>${a.linhas.map((l) => linhaCentro(l, nomes)).join('')}</tbody>
<tfoot><tr><td colspan="${3 + GRUPOS_CUSTO_DIRETO.length + 4}">Soma do custo final dos centros</td><td class="v">${reaisDeCentavos(
    totalFinal,
  )}</td><td colspan="2"></td></tr></tfoot></table>
<h2>Pendências</h2>
${pendencias}
</body></html>`;
}
