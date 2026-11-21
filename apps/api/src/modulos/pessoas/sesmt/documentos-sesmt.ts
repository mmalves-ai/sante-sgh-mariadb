// HTML da CAT e do comprovante de entrega de EPI (M52.5; ficha, seção 10, "Documento"; cap-14 §14.4.2): o Gotenberg
// converte em PDF/A-2b, como os documentos do repasse. Nada de CPF nem de identificação de paciente (a fonte do
// material biológico é só "conhecida" ou "desconhecida"); o colaborador pelo nome e pela matrícula. A CAT impressa é a
// cópia do registro da empresa com o número da comunicação; o envio ao eSocial é do M53 (chave pessoas.esocial). O PPP
// de consulta (D-PPP-525) junta os períodos de atribuição, os fatores de risco, o EPI com o CA, a dosimetria e, para
// quem consulta o prontuário ocupacional, a monitoração biológica.
import {
  type AcidenteResposta,
  type ColaboradorSesmt,
  EXPOSICOES_BIOLOGICAS,
  type ExposicaoBiologica,
  MATERIAIS_BIOLOGICOS,
  type MaterialBiologico,
  type PppColaborador,
  type RegistroEpiResposta,
  SITUACOES_PROFILAXIA,
  TIPOS_ACIDENTE,
} from '@sgh/contratos';
import type { DominiosSesmt } from './porta-sesmt.js';

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instanteBr = (d: string) => `${dataBr(d.slice(0, 10))} ${d.slice(11, 16)}`;
const sim = (b: boolean) => (b ? 'Sim' : 'Não');

const ESTILO = `body{font-family:sans-serif;font-size:10pt;margin:16mm}h1{font-size:14pt}h2{font-size:11pt;margin-top:14pt}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}
th{width:34%;background:#f2f2f2}.assinatura{margin-top:36pt;border-top:1px solid #000;width:60%;padding-top:3pt}`;

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;
}

const linha = (rotulo: string, valor: string) =>
  `<tr><th scope="row">${esc(rotulo)}</th><td>${esc(valor)}</td></tr>`;

function colaboradorHtml(c: ColaboradorSesmt): string {
  return `<table>${[
    linha('Colaborador', c.nome),
    linha('Matrícula', c.matricula ?? '—'),
    linha('Cargo e função', [c.cargo, c.funcao].filter(Boolean).join(' · ')),
    linha('Lotação', [c.unidadeNome, c.setor].filter(Boolean).join(' · ') || '—'),
    linha('Admissão', dataBr(c.admissao)),
  ].join('')}</table>`;
}

const rotulo = (xs: readonly { codigo: number; rotulo: string }[], c: number | null) =>
  c === null ? '—' : (xs.find((x) => x.codigo === c)?.rotulo ?? String(c));

export function htmlCat(a: AcidenteResposta, d: DominiosSesmt): string {
  const bio = a.biologico
    ? [
        linha('Exposição', a.exposicao ? EXPOSICOES_BIOLOGICAS[a.exposicao as ExposicaoBiologica] : '—'),
        linha('Material', a.material ? MATERIAIS_BIOLOGICOS[a.material as MaterialBiologico] : '—'),
        linha('Fonte', a.fonte === 'conhecida' ? 'Conhecida' : 'Desconhecida'),
        linha('Profilaxia pós-exposição', SITUACOES_PROFILAXIA[a.profilaxia]),
      ].join('')
    : '';
  return pagina(
    `CAT ${a.catNumero ?? ''}`,
    `<h1>Comunicação de Acidente de Trabalho (CAT)</h1>
<p>Número ${esc(a.catNumero ?? '—')} · tipo ${esc(rotulo(d.tiposCat, a.tipoCat))} · emitida em ${dataBr(a.catEmitidaEm)}
 (prazo ${dataBr(a.catPrazo)}) · iniciativa ${esc(rotulo(d.iniciativasCat, a.iniciativaCat))}</p>
<h2>Acidentado</h2>${colaboradorHtml(a.colaborador)}
<h2>Acidente</h2><table>${[
      linha('Data e hora', instanteBr(a.ocorridoEm)),
      linha('Tipo', TIPOS_ACIDENTE[a.tipo]),
      linha('Local', a.local),
      linha('Descrição', a.descricao),
      linha('Parte do corpo atingida', rotulo(d.partesCorpo, a.parteCorpo)),
      linha('Natureza da lesão', rotulo(d.naturezas, a.natureza)),
      linha('Agente causador', rotulo(d.agentes, a.agente)),
      linha('Situação geradora', rotulo(d.situacoes, a.situacao)),
      linha('Material biológico', sim(a.biologico)),
      linha('Perfurocortante', sim(a.perfurocortante)),
      linha('Houve afastamento', sim(a.afastamento)),
      linha('Houve óbito', sim(a.obito)),
    ].join('')}${bio}</table>
<p class="assinatura">Emitente: ${esc(a.catEmitidaPor ?? '—')}</p>`,
  );
}

export function htmlComprovanteEpi(e: RegistroEpiResposta, c: ColaboradorSesmt): string {
  return pagina(
    `Comprovante de entrega de EPI ${e.id}`,
    `<h1>Comprovante de entrega de EPI</h1>
<p>Registro ${e.id} · entregue em ${dataBr(e.data)}</p>
${colaboradorHtml(c)}
<h2>Equipamento</h2><table>${[
      linha('EPI', e.epi ?? '—'),
      linha('Certificado de Aprovação (CA)', e.caNumero ?? '—'),
      linha('Validade do CA', dataBr(e.caValidade)),
      linha('Quantidade', String(e.quantidade ?? 0)),
    ].join('')}</table>
<p>Declaro que recebi o equipamento de proteção individual acima, gratuitamente, em perfeito estado, e que fui
orientado sobre o uso adequado, a guarda e a conservação, e sobre a obrigação de comunicar qualquer alteração que o
torne impróprio para o uso (NR-6, item 6.7.1).</p>
<p class="assinatura">Assinatura do colaborador</p>
<p class="assinatura">Responsável pela entrega: ${esc(e.registradoPor)}</p>`,
  );
}

const tabela = (cab: readonly string[], linhas: readonly (readonly string[])[], vazio: string) =>
  linhas.length === 0
    ? `<p>${esc(vazio)}</p>`
    : `<table><thead><tr>${cab.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas
        .map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;

/** O PPP de consulta (D-PPP-525; IN PRES/INSS 128/2022, art. 284). */
export function htmlPpp(d: PppColaborador, emitidoPor: string): string {
  const periodo = (de: string, ate: string | null) => `${dataBr(de)} a ${ate ? dataBr(ate) : 'atual'}`;
  const atribuicao = tabela(
    ['Período', 'Função', 'Lotação'],
    d.periodos.map((p) => [
      periodo(p.inicio, p.fim),
      p.funcao,
      [p.unidadeNome, p.setor].filter(Boolean).join(' · ') || '—',
    ]),
    'Sem período de atribuição.',
  );
  const riscos = d.periodos
    .map(
      (p) =>
        `<h3>${esc(`${periodo(p.inicio, p.fim)} · ${p.funcao}`)}</h3>${tabela(
          ['Vigência', 'Fator de risco ou EPI exigido', 'Grupo', 'EPC (eficácia)', 'EPI'],
          p.linhas.map((l) => [
            periodo(l.vigenteDe, l.vigenteAte),
            l.tipo === 'risco'
              ? [l.fatorRisco, l.fatorRiscoRotulo].filter(Boolean).join(' · ') || (l.descricao ?? '—')
              : 'EPI exigido',
            l.grupoRiscoRotulo ?? '—',
            l.epcRotulo ?? '—',
            l.epi ?? '—',
          ]),
          'Nenhum fator de risco registrado no mapa para este período.',
        )}`,
    )
    .join('');
  const epis = tabela(
    ['Entrega', 'EPI', 'CA', 'Validade do CA', 'Quantidade', 'Assinatura'],
    d.registros
      .filter((r) => r.tipo === 'epi')
      .map((r) => [
        dataBr(r.data),
        r.epi ?? '—',
        r.caNumero ?? '—',
        dataBr(r.caValidade),
        String(r.quantidade ?? 0),
        r.assinatura === 'assinada' ? 'Conferida' : 'Pendente',
      ]),
    'Nenhuma entrega de EPI registrada.',
  );
  const doses = tabela(
    ['Período', 'Dose (mSv)', 'Dosímetro'],
    d.registros
      .filter((r) => r.tipo === 'dosimetria')
      .map((r) => [periodo(r.periodoInicio ?? r.data, r.data), String(r.doseMsv ?? 0), r.dosimetro ?? '—']),
    'Nenhuma leitura de dosímetro registrada.',
  );
  const biologica =
    d.asos === null
      ? '<p>A monitoração biológica aparece para quem consulta o prontuário ocupacional.</p>'
      : tabela(
          ['Data', 'Exame', 'Natureza', 'Resultado'],
          d.asos.flatMap((a) =>
            a.exames.length === 0
              ? [[dataBr(a.data), 'ASO', a.tipoRotulo, a.conclusaoRotulo]]
              : a.exames.map((x) => [
                  dataBr(x.data),
                  x.exame,
                  a.tipoRotulo,
                  x.resultado === 'normal' ? 'Normal' : 'Alterado',
                ]),
          ),
          'Nenhum exame ocupacional registrado.',
        );
  return pagina(
    `PPP ${d.colaborador.nome}`,
    `<h1>Perfil Profissiográfico Previdenciário (consulta)</h1>
<p>Emitido em ${dataBr(d.hoje)} por ${esc(emitidoPor)}. Documento de consulta da empresa; o PPP eletrônico é o do
evento de condições ambientais do trabalho do eSocial.</p>
${colaboradorHtml(d.colaborador)}
<h2>Lotação e atribuição</h2>${atribuicao}
<h2>Exposição a fatores de risco</h2>${riscos}
<h2>Equipamentos de proteção individual</h2>${epis}
<h2>Dosimetria</h2>${doses}
<h2>Monitoração biológica</h2>${biologica}
<p class="assinatura">Responsável pelos registros ambientais</p>
<p class="assinatura">Responsável pela monitoração biológica</p>`,
  );
}
