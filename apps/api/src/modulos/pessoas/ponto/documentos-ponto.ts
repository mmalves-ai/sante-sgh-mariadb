// HTML do espelho de ponto (M52.4; ficha, seção 10, "Documento": espelho de ponto em PDF/A; cap-14 §14.4.2): o Gotenberg
// converte em PDF/A-2b, como os documentos do SESMT. Nada de CPF: o colaborador pelo nome e pela matrícula. O espelho
// leva os dias com as marcações (a original desconsiderada riscada, a incluída por ajuste marcada), as horas por classe,
// os eventos para a folha, o banco de horas com as contas, a trilha do período e a ciência.
import { type EspelhoPonto, FONTES_MARCACAO } from '@sgh/contratos';
import { horasMinutos } from '@sgh/dominio-pessoas';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const hora = (i: string) => i.slice(11, 16);
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]!;

const ESTILO = `body{font-family:sans-serif;font-size:9pt;margin:12mm}h1{font-size:13pt}h2{font-size:10.5pt;margin-top:12pt}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}
th{background:#f2f2f2}.riscada{text-decoration:line-through;color:#666}.assinatura{margin-top:30pt;border-top:1px solid #000;width:60%;padding-top:3pt}`;

export function htmlEspelho(e: EspelhoPonto): string {
  const c = e.colaborador;
  const dias = e.dias
    .map((d) => {
      const marc = d.marcacoes
        .map((m) => {
          const t = `${hora(m.instante)}${m.fonte === 'I' ? ' (I)' : ''}`;
          return m.desconsiderada ? `<span class="riscada">${esc(t)}</span>` : esc(t);
        })
        .join(' ');
      const prev = d.previstos.map((p) => `${hora(p.inicio)}–${hora(p.fim)}`).join(' ');
      const horas = d.minutos.map((m) => `${esc(m.rotulo)} ${horasMinutos(m.minutos)}`).join('; ');
      const obs = [
        d.feriado ? 'Feriado' : '',
        d.justificativa ?? '',
        ...d.inconsistencias.map((x) => x.rotulo),
        ...d.alertas.map((x) => x.rotulo),
      ]
        .filter(Boolean)
        .map(esc)
        .join('; ');
      return `<tr><td>${dataBr(d.dia)} ${semana(d.dia)}</td><td>${esc(prev)}</td><td>${marc}</td><td>${horas}</td><td>${obs}</td></tr>`;
    })
    .join('');
  const totais = e.totais
    .map((t) => `<tr><th scope="row">${esc(t.rotulo)}</th><td>${horasMinutos(t.minutos)}</td></tr>`)
    .join('');
  const eventos = e.eventos
    .filter((x) => x.minutos > 0)
    .map((x) => `<tr><th scope="row">${esc(x.rotulo)}</th><td>${horasMinutos(x.minutos)}</td></tr>`)
    .join('');
  const trilha = e.trilha
    .map(
      (t) =>
        `<tr><td>${esc(t.acaoRotulo)}</td><td>${esc(t.registradoPor)}</td><td>${dataBr(t.registradoEm.slice(0, 10))} ${hora(t.registradoEm)}</td><td>${esc(t.texto ?? (t.concorda === false ? 'Não concorda' : ''))}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Espelho de ponto ${esc(e.competencia)}</title><style>${ESTILO}</style></head><body>
<h1>Espelho de ponto · ${esc(e.competencia.slice(5, 7))}/${esc(e.competencia.slice(0, 4))}</h1>
<table><tr><th scope="row">Colaborador</th><td>${esc(c.nome)}</td></tr><tr><th scope="row">Matrícula</th><td>${esc(c.matricula ?? '—')}</td></tr>
<tr><th scope="row">Cargo</th><td>${esc(c.cargo)}</td></tr><tr><th scope="row">Lotação</th><td>${esc([c.unidadeNome, c.setor].filter(Boolean).join(' · ') || '—')}</td></tr>
<tr><th scope="row">Regime</th><td>${esc(c.regime ?? '—')}</td></tr><tr><th scope="row">Situação</th><td>${e.estado === 'fechado' ? `Fechado (versão ${e.versao})` : 'Aberto (prévia)'}</td></tr>
<tr><th scope="row">Resumo de conferência</th><td>${esc(e.hash)}</td></tr></table>
<h2>Dias</h2><table><tr><th>Dia</th><th>Previsto</th><th>Marcações (${esc(FONTES_MARCACAO.I)}: I)</th><th>Horas</th><th>Observações</th></tr>${dias}</table>
<h2>Totais</h2><table>${totais || '<tr><td>Sem horas no período.</td></tr>'}</table>
<h2>Eventos para a folha</h2><table>${eventos || '<tr><td>Nenhum.</td></tr>'}</table>
<h2>Banco de horas</h2><p>${e.banco.parcelas.map(esc).join('<br>')}</p>
<h2>Conferência</h2><p>${e.parcelas.map(esc).join('<br>')}</p>
<h2>Trilha do período</h2><table><tr><th>Ação</th><th>Quem</th><th>Quando</th><th>Observação</th></tr>${trilha}</table>
<p class="assinatura">Ciência do colaborador: ${e.ciencia ? `${esc(e.ciencia.registradoPor)} em ${dataBr(e.ciencia.registradoEm.slice(0, 10))} ${hora(e.ciencia.registradoEm)}${e.ciencia.concorda === false ? ' (não concorda)' : ''}` : 'pendente'}</p>
</body></html>`;
}
