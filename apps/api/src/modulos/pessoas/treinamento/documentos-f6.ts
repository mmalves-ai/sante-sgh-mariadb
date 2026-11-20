// HTML dos documentos da fatia F6 (M52.6; cap-14 §14.4.2): a lista de presença da turma (para a assinatura dos
// participantes e do instrutor; evidência de capacitação da RDC63-05 e da NR32-04) e o relatório de plantões realizados
// ao repasse (com as contas escritas). O Gotenberg converte em PDF/A-2b, como os outros documentos da gestão de pessoas.
// Nada de CPF: o colaborador pelo nome e pela matrícula.
import {
  APROVEITAMENTOS_TREINAMENTO,
  MODALIDADES_TURMA,
  PRESENCAS_TREINAMENTO,
  type RelatorioRepasse,
  type TurmaResposta,
} from '@sgh/contratos';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const reais = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

const ESTILO = `body{font-family:sans-serif;font-size:9.5pt;margin:12mm}h1{font-size:13pt}h2{font-size:10.5pt;margin-top:12pt}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}
th{background:#f2f2f2}.assina{width:34%}.linha{margin-top:30pt;border-top:1px solid #000;width:60%;padding-top:3pt}
.num{text-align:right}`;

export function htmlListaPresenca(t: TurmaResposta, hoje: string): string {
  const linhas = t.lista
    .map(
      (p, i) =>
        `<tr><td class="num">${i + 1}</td><td>${esc(p.nome)}</td><td>${esc(p.matricula ?? '')}</td><td>${esc(
          p.unidadeNome ?? '',
        )}</td><td>${esc(PRESENCAS_TREINAMENTO[p.presenca])}</td><td>${esc(
          p.aproveitamento ? APROVEITAMENTOS_TREINAMENTO[p.aproveitamento] : '',
        )}</td><td class="assina"></td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Lista de presença ${esc(
    t.cursoCodigo,
  )}</title><style>${ESTILO}</style></head><body>
<h1>Lista de presença · ${esc(t.cursoTitulo)}</h1>
<p>Turma ${t.id} · ${dataBr(t.inicio)}${t.fim !== t.inicio ? ` a ${dataBr(t.fim)}` : ''} · carga ${horas(
    t.cargaMin,
  )} · ${esc(MODALIDADES_TURMA[t.modalidade])}${t.local ? ` · ${esc(t.local)}` : ''}</p>
<p>Instrutor: ${esc(t.instrutor)}${t.pop ? ` · POP ${esc(t.pop.codigo)}, versão ${t.pop.versao}` : ''}</p>
<h2>Conteúdo programático</h2><p>${esc(t.cursoConteudo)}</p>
<h2>Participantes (${t.lista.length})</h2>
<table><thead><tr><th>#</th><th>Nome</th><th>Matrícula</th><th>Unidade</th><th>Presença</th><th>Aproveitamento</th><th>Assinatura</th></tr></thead><tbody>${linhas}</tbody></table>
<p class="linha">Instrutor: ${esc(t.instrutor)}</p>
<p>Emitido em ${dataBr(hoje)}.</p>
</body></html>`;
}

export function htmlRelatorioRepasse(r: RelatorioRepasse, hoje: string): string {
  const grupos = r.grupos
    .map(
      (g) =>
        `<tr><td>${esc(g.nome)}</td><td class="num">${g.prestador}</td><td class="num">${g.plantoes}</td><td class="num">${horas(
          g.minutos,
        )}</td><td>${esc(g.parcelas)}</td><td class="num">${reais(g.valor)}</td></tr>`,
    )
    .join('');
  const lancados = r.lancados
    .map(
      (l) =>
        `<tr><td>${esc(l.nome)}</td><td class="num">${l.realizado}</td><td class="num">${l.lancamento}</td><td class="num">${
          l.valor !== null ? reais(l.valor) : ''
        }</td></tr>`,
    )
    .join('');
  const fora = r.foraDoRepasse
    .map(
      (f) => `<tr><td>${esc(f.nome)}</td><td class="num">${f.realizado}</td><td>${esc(f.motivo)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Plantões realizados ${esc(
    r.competencia,
  )}</title><style>${ESTILO}</style></head><body>
<h1>Plantões realizados ao repasse · ${esc(r.competencia.slice(5, 7))}/${esc(r.competencia.slice(0, 4))}</h1>
<p>Plantões aprovados pela coordenação, do prestador (cooperado, PJ ou terceiro), com o valor pela tarifa por hora.</p>
<h2>A lançar</h2>
<table><thead><tr><th>Prestador</th><th>Código</th><th>Plantões</th><th>Horas</th><th>Conta</th><th>Valor</th></tr></thead><tbody>${
    grupos || '<tr><td colspan="6">Nenhum.</td></tr>'
  }</tbody></table>
<p>Total a lançar: ${esc(r.total.parcelas)}</p>
<h2>Já lançados</h2>
<table><thead><tr><th>Prestador</th><th>Realizado</th><th>Lançamento</th><th>Valor</th></tr></thead><tbody>${
    lancados || '<tr><td colspan="4">Nenhum.</td></tr>'
  }</tbody></table>
<h2>Fora do repasse</h2>
<table><thead><tr><th>Colaborador</th><th>Realizado</th><th>Motivo</th></tr></thead><tbody>${
    fora || '<tr><td colspan="3">Nenhum.</td></tr>'
  }</tbody></table>
<p>Emitido em ${dataBr(hoje)}.</p>
</body></html>`;
}
