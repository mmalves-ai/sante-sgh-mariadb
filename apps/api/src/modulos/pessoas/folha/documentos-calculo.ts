// Documentos do cálculo mensal da folha (M53.3; ficha do M53, seção 10, "Documento: holerite e relatório de conferência
// em PDF/A"): o HTML que o Gotenberg converte em PDF/A-2b, como o espelho de ponto e os documentos do SESMT. Nenhum CPF
// nem nome: o holerite leva o vínculo e a matrícula; o relatório de conferência leva só IDs de vínculo, matrícula, centro
// de custo, contagens e somas, com as parcelas de cada conta impressas (regra 8; toda conta agregada com as parcelas).
// Sem gerador configurado (dev e testes), a resposta é o próprio HTML.
import {
  type AvisoPrevio,
  type DetalheFerias,
  type DetalheProcessoFolha,
  type DetalheRescisao,
  type ModalidadeRescisao,
  type MeuHolerite,
  type PapelLinhaFolha,
  PAPEIS_FORA_DO_HOLERITE,
  parcelasMultaFgts,
} from '@sgh/contratos';
import { ErroProblema } from '../../../problema.filter.js';

export const GERADOR_PDF_FOLHA = Symbol('GERADOR_PDF_FOLHA');
export type GeradorPdfFolha = (html: string, titulo: string) => Promise<Buffer>;
export type RespostaPdf = { header(n: string, v: string): unknown; send(b: unknown): unknown };

export const ROTULO_PAPEL_FOLHA: Readonly<Record<PapelLinhaFolha, string>> = {
  salario: 'Salário',
  horaExtra50: 'Hora extra em dia útil',
  horaExtra100: 'Hora extra em descanso ou feriado',
  adicionalNoturno: 'Adicional noturno',
  dsrVariaveis: 'Descanso semanal sobre variáveis',
  sobreaviso: 'Sobreaviso',
  insalubridade: 'Insalubridade',
  periculosidade: 'Periculosidade',
  salarioFamilia: 'Salário-família',
  faltas: 'Faltas',
  atrasos: 'Atrasos',
  inss: 'INSS',
  irrf: 'IRRF',
  fgts: 'FGTS',
  feriasGozo: 'Férias',
  feriasMedias: 'Médias das variáveis nas férias',
  feriasTerco: 'Terço constitucional de férias',
  abonoPecuniario: 'Abono pecuniário',
  abonoTerco: 'Terço do abono pecuniário',
  feriasDobra: 'Férias em dobro',
  inssFerias: 'INSS das férias',
  irrfFerias: 'IRRF das férias',
  decimoAdiantamento: 'Adiantamento do 13º com as férias',
  decimoPrimeira: '13º salário: 1ª parcela',
  decimoTerceiro: '13º salário',
  decimoMedias: 'Médias das variáveis no 13º',
  decimoDesconto: 'Desconto do adiantamento do 13º',
  inssDecimo: 'INSS do 13º',
  irrfDecimo: 'IRRF do 13º',
  avisoIndenizado: 'Aviso prévio indenizado',
  avisoDescontado: 'Desconto do aviso prévio não cumprido',
  indenizacao479: 'Indenização da antecipação do contrato a termo',
  feriasVencidas: 'Férias vencidas indenizadas',
  feriasVencidasDobra: 'Férias vencidas em dobro',
  feriasProporcionais: 'Férias proporcionais indenizadas',
  feriasAviso: 'Férias sobre o aviso prévio indenizado',
  feriasRescisaoTerco: 'Terço constitucional das férias indenizadas',
  decimoProporcional: '13º salário proporcional',
  decimoAviso: '13º salário sobre o aviso prévio indenizado',
  baseInss: 'Base do INSS',
  baseIrrf: 'Base do IRRF',
  baseFgts: 'Base do FGTS',
  inssPatronal: 'INSS da empresa',
  rat: 'RAT ajustado',
  terceiros: 'Outras entidades',
  multaFgts: 'Multa do FGTS na rescisão',
};

const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
/** Centavos em reais (pt-BR), sem depender do ICU do processo. */
export function reaisBr(centavos: number): string {
  const neg = centavos < 0;
  const v = Math.abs(Math.round(centavos));
  const inteiro = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}R$ ${inteiro},${String(v % 100).padStart(2, '0')}`;
}
const competenciaBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const dataBr = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instanteBr = (i: string | null) => (i ? `${dataBr(i.slice(0, 10))} ${i.slice(11, 16)}` : '—');

const ESTILO = `body{font-family:sans-serif;font-size:9pt;margin:12mm}h1{font-size:13pt}h2{font-size:10.5pt;margin-top:12pt}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}
th{background:#f2f2f2}td.valor{text-align:right;white-space:nowrap}.secundario{color:#555}`;

const pagina = (titulo: string, corpo: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;

/** O holerite do próprio colaborador: vencimentos, descontos, o líquido com a conta e as bases (sem encargos da empresa). */
export function htmlHolerite(h: MeuHolerite): string {
  const linhas = h.linhas.filter((l) => !PAPEIS_FORA_DO_HOLERITE.includes(l.papel));
  const tabela = (tipo: 'provento' | 'desconto') =>
    linhas
      .filter((l) => l.tipo === tipo)
      .map(
        (l) =>
          `<tr><td>${l.codigoRubrica ?? ''}</td><th scope="row">${esc(ROTULO_PAPEL_FOLHA[l.papel])}</th><td>${l.quantidade || ''}</td><td class="valor">${reaisBr(l.valor)}</td><td class="secundario">${esc(l.memoria)}</td></tr>`,
      )
      .join('');
  const informativos = linhas
    .filter((l) => l.tipo !== 'provento' && l.tipo !== 'desconto')
    .map(
      (l) =>
        `<tr><th scope="row">${esc(ROTULO_PAPEL_FOLHA[l.papel])}</th><td class="valor">${reaisBr(l.valor)}</td></tr>`,
    )
    .join('');
  const titulo = `Holerite ${competenciaBr(h.competencia)}`;
  const cab = `<table><tr><th scope="row">Competência</th><td>${competenciaBr(h.competencia)}</td></tr>
<tr><th scope="row">Vínculo</th><td>${h.vinculo ?? '—'}</td></tr><tr><th scope="row">Matrícula</th><td>${esc(h.matricula ?? '—')}</td></tr>
<tr><th scope="row">Calculado em</th><td>${instanteBr(h.calculadoEm)}</td></tr></table>`;
  if (!h.calculado)
    return pagina(
      titulo,
      `<h1>${titulo}</h1>${cab}<p>O holerite desta competência ainda não foi calculado.</p>`,
    );
  const cabecalho =
    '<tr><th>Código</th><th>Descrição</th><th>Quantidade</th><th>Valor</th><th>Memória</th></tr>';
  return pagina(
    titulo,
    `<h1>${titulo}</h1>${cab}
<h2>Vencimentos</h2><table>${cabecalho}${tabela('provento') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h2>Descontos</h2><table>${cabecalho}${tabela('desconto') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h2>Líquido a receber</h2><p>${reaisBr(h.proventos)} − ${reaisBr(h.descontos)} = <strong>${reaisBr(h.liquido)}</strong></p>
<h2>Bases e FGTS (informativos)</h2><table>${informativos || '<tr><td>Nenhum.</td></tr>'}</table>`,
  );
}

/** O relatório de conferência do processamento: totais, a prova da soma com as parcelas e a grade por vínculo. */
export function htmlConferenciaCalculo(d: DetalheProcessoFolha): string {
  const p = d.processo;
  const t = p.totais;
  const titulo = `Conferência da folha ${competenciaBr(p.competencia)} · cálculo ${p.numero}`;
  const encargos = t.inssPatronal + t.rat + t.terceiros;
  const custo = t.proventos + t.fgts + encargos;
  const grade = d.colaboradores
    .map(
      (c) =>
        `<tr><td>${c.vinculo}</td><td>${esc(c.matricula ?? '—')}</td><td>${c.centroCusto}</td><td>${c.diasPagos}</td><td class="valor">${reaisBr(c.proventos)}</td><td class="valor">${reaisBr(c.descontos)}</td><td class="valor">${reaisBr(c.liquido)}</td><td class="valor">${reaisBr(c.inss)}</td><td class="valor">${reaisBr(c.irrf)}</td><td class="valor">${reaisBr(c.fgts)}</td><td class="valor">${reaisBr(c.encargos)}</td></tr>`,
    )
    .join('');
  const soma = (k: 'proventos' | 'descontos' | 'liquido') => d.colaboradores.reduce((s, c) => s + c[k], 0);
  return pagina(
    titulo,
    `<h1>${esc(titulo)}</h1>
<table><tr><th scope="row">Empresa</th><td>${p.empresa}</td></tr><tr><th scope="row">Situação</th><td>${
      p.situacao === 'calculada' ? 'Em vigor' : p.situacao === 'substituida' ? 'Substituído' : 'Descartado'
    }${p.motivo ? ` · ${esc(p.motivo)}` : ''}</td></tr>
<tr><th scope="row">Calculado por</th><td>${esc(p.calculadoPor)} em ${instanteBr(p.calculadoEm)}</td></tr>
<tr><th scope="row">Tabela legal</th><td>vigência de ${dataBr(p.tabelaLegal)}</td></tr><tr><th scope="row">Parâmetros</th><td>vigência de ${dataBr(p.parametros)}</td></tr>
<tr><th scope="row">Fora desta folha</th><td>${p.foraDaFolha} vínculo(s) (outro tipo de vínculo ou desligados na competência)</td></tr>
<tr><th scope="row">Resumo de conferência</th><td>${esc(p.resumo)}</td></tr></table>
<h2>Prova da soma</h2><p>${d.conferencia.ok ? 'A soma confere.' : 'A soma não confere.'}</p>
<table>${d.conferencia.parcelas.map((x) => `<tr><th scope="row">${esc(x.rotulo)}</th><td class="valor">${reaisBr(x.valor)}</td></tr>`).join('')}</table>
<p>Total: ${reaisBr(t.proventos)} − ${reaisBr(t.descontos)} = ${reaisBr(t.liquido)}. Soma dos ${d.colaboradores.length} vínculo(s): ${reaisBr(soma('proventos'))} − ${reaisBr(soma('descontos'))} = ${reaisBr(soma('liquido'))}.</p>
${d.conferencia.divergencias.length ? `<ul>${d.conferencia.divergencias.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<h2>Encargos e custo de pessoal</h2>
<p>Encargos da empresa: ${reaisBr(t.inssPatronal)} (INSS da empresa) + ${reaisBr(t.rat)} (RAT ajustado) + ${reaisBr(t.terceiros)} (outras entidades) = ${reaisBr(encargos)}.</p>
<p>Custo de pessoal: ${reaisBr(t.proventos)} (proventos) + ${reaisBr(t.fgts)} (FGTS) + ${reaisBr(encargos)} (encargos) = ${reaisBr(custo)}.</p>
<p>Retenções: ${reaisBr(t.inss)} (INSS dos colaboradores) e ${reaisBr(t.irrf)} (IRRF).</p>
<h2>Por vínculo</h2><table><tr><th>Vínculo</th><th>Matrícula</th><th>Centro de custo</th><th>Dias pagos</th><th>Proventos</th><th>Descontos</th><th>Líquido</th><th>INSS</th><th>IRRF</th><th>FGTS</th><th>Encargos</th></tr>${grade || '<tr><td colspan="11">Nenhum.</td></tr>'}</table>`,
  );
}

/**
 * O aviso e o recibo de férias (M53.4; CLT arts. 135 e 145): o período aquisitivo, o gozo, o abono, a dobra, a data de
 * pagamento e as linhas do recibo com a conta do líquido impressa. Só vínculo e matrícula (nenhum nome ou CPF); a
 * assinatura do colaborador fica em branco para o papel.
 */
export function htmlReciboFerias(d: DetalheFerias, matricula: string | null): string {
  const f = d.ferias;
  const titulo = `Aviso e recibo de férias · vínculo ${f.vinculo}`;
  const linhas = d.linhas.filter((l) => !PAPEIS_FORA_DO_HOLERITE.includes(l.papel));
  const doTipo = (tipo: 'provento' | 'desconto') => linhas.filter((l) => l.tipo === tipo);
  const tabela = (tipo: 'provento' | 'desconto') =>
    doTipo(tipo)
      .map(
        (l) =>
          `<tr><td>${l.codigoRubrica ?? ''}</td><th scope="row">${esc(ROTULO_PAPEL_FOLHA[l.papel])}</th><td>${l.quantidade || ''}</td><td class="valor">${reaisBr(l.valor)}</td><td class="secundario">${esc(l.memoria)}</td></tr>`,
      )
      .join('');
  const proventos = doTipo('provento').reduce((a, l) => a + l.valor, 0);
  const descontos = doTipo('desconto').reduce((a, l) => a + l.valor, 0);
  const cabecalho =
    '<tr><th>Código</th><th>Descrição</th><th>Quantidade</th><th>Valor</th><th>Memória</th></tr>';
  const situacao =
    f.situacao === 'calculada'
      ? 'Recibo calculado'
      : f.situacao === 'programada'
        ? 'Programadas'
        : 'Canceladas';
  const aviso = `<h2>Aviso de férias</h2>
<table><tr><th scope="row">Vínculo</th><td>${f.vinculo}</td></tr><tr><th scope="row">Matrícula</th><td>${esc(matricula ?? '—')}</td></tr>
<tr><th scope="row">Empresa</th><td>${f.empresa}</td></tr>
<tr><th scope="row">Período aquisitivo</th><td>${dataBr(f.aquisitivoInicio)} a ${dataBr(f.aquisitivoFim)}</td></tr>
<tr><th scope="row">Gozo</th><td>${dataBr(f.inicio)} a ${dataBr(f.fim)} (${f.dias} dia(s))</td></tr>
<tr><th scope="row">Abono pecuniário</th><td>${f.abono} dia(s)</td></tr>
<tr><th scope="row">Dias em dobro</th><td>${f.dobra}</td></tr>
<tr><th scope="row">Adiantamento do 13º</th><td>${f.adiantarDecimo ? 'Sim' : 'Não'}</td></tr>
<tr><th scope="row">Pagamento</th><td>${dataBr(f.pagamento)}</td></tr>
<tr><th scope="row">Situação</th><td>${situacao}${f.motivo ? ` · ${esc(f.motivo)}` : ''}</td></tr></table>`;
  if (!d.processo || d.linhas.length === 0)
    return pagina(
      titulo,
      `<h1>${esc(titulo)}</h1>${aviso}<p>O recibo destas férias ainda não foi calculado.</p>`,
    );
  return pagina(
    titulo,
    `<h1>${esc(titulo)}</h1>${aviso}
<h2>Recibo de férias</h2><p class="secundario">Cálculo ${d.processo.numero} · ${esc(d.processo.calculadoPor)} em ${instanteBr(d.processo.calculadoEm)}</p>
<h3>Vencimentos</h3><table>${cabecalho}${tabela('provento') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h3>Descontos</h3><table>${cabecalho}${tabela('desconto') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h3>Líquido a receber</h3><p>${reaisBr(proventos)} − ${reaisBr(descontos)} = <strong>${reaisBr(proventos - descontos)}</strong></p>
<p>Recebi a importância líquida acima, referente às férias descritas neste aviso.</p>
<p>Data: ____/____/________ &nbsp; Assinatura do colaborador: ________________________________</p>`,
  );
}

export const ROTULO_MODALIDADE_RESCISAO: Readonly<Record<ModalidadeRescisao, string>> = {
  'sem-justa-causa': 'Dispensa sem justa causa',
  'justa-causa': 'Dispensa por justa causa',
  'pedido-demissao': 'Pedido de demissão',
  acordo: 'Rescisão por acordo (art. 484-A da CLT)',
  'termino-contrato': 'Término do contrato a prazo determinado',
  'antecipada-empregador': 'Antecipação do término do contrato a prazo pelo empregador',
  'antecipada-empregado': 'Antecipação do término do contrato a prazo pelo empregado',
  'culpa-reciproca': 'Culpa recíproca',
  'rescisao-indireta': 'Rescisão indireta',
  falecimento: 'Falecimento do empregado',
};
export const ROTULO_AVISO_PREVIO: Readonly<Record<AvisoPrevio, string>> = {
  indenizado: 'Indenizado',
  trabalhado: 'Trabalhado',
  dispensado: 'Dispensado do cumprimento',
  'nao-cumprido': 'Não cumprido (descontado)',
  nenhum: 'Sem aviso prévio',
};
const pct = (centesimos: number) => `${String(centesimos / 100).replace('.', ',')}%`;

/**
 * O termo de rescisão do contrato de trabalho (M53.5; CLT art. 477): a modalidade, o aviso com os dias e a projeção,
 * o saldo do FGTS com a conta da multa impressa e as verbas rescisórias (vencimentos e descontos) com a conta do
 * líquido. Só vínculo e matrícula (nenhum nome ou CPF); as assinaturas ficam em branco para o papel. Exige o salário.
 */
export function htmlTermoRescisao(d: DetalheRescisao, matricula: string | null): string {
  const r = d.rescisao;
  const titulo = `Termo de rescisão do contrato de trabalho · vínculo ${r.vinculo}`;
  const linhas = d.linhas.filter((l) => !PAPEIS_FORA_DO_HOLERITE.includes(l.papel));
  const doTipo = (tipo: 'provento' | 'desconto') => linhas.filter((l) => l.tipo === tipo);
  const tabela = (tipo: 'provento' | 'desconto') =>
    doTipo(tipo)
      .map(
        (l) =>
          `<tr><td>${l.codigoRubrica ?? ''}</td><th scope="row">${esc(ROTULO_PAPEL_FOLHA[l.papel])}</th><td>${l.quantidade || ''}</td><td class="valor">${reaisBr(l.valor)}</td><td class="secundario">${esc(l.memoria)}</td></tr>`,
      )
      .join('');
  const proventos = doTipo('provento').reduce((a, l) => a + l.valor, 0);
  const descontos = doTipo('desconto').reduce((a, l) => a + l.valor, 0);
  const cabecalho =
    '<tr><th>Código</th><th>Descrição</th><th>Quantidade</th><th>Valor</th><th>Memória</th></tr>';
  const situacao =
    r.situacao === 'calculada'
      ? 'Calculada'
      : r.situacao === 'substituida'
        ? 'Substituída por um cálculo novo'
        : 'Cancelada';
  // As parcelas da multa (D-MULTA-535): o saldo para fins rescisórios e o FGTS desta rescisão, com o percentual da linha.
  const parcelas = parcelasMultaFgts(d.linhas);
  // O termo exige `pessoas.salario.ler` (D-PERM-SAL-535): o saldo e a multa vêm preenchidos.
  const saldoFgts = r.saldoFgts ?? 0;
  const multaFgts = r.multaFgts ?? 0;
  const base =
    parcelas.fgtsRescisao > 0
      ? `(${reaisBr(saldoFgts)} + ${reaisBr(parcelas.fgtsRescisao)} do FGTS desta rescisão)`
      : reaisBr(saldoFgts);
  const multa =
    multaFgts > 0
      ? `${base} × ${pct(parcelas.percentual)} = ${reaisBr(multaFgts)}`
      : 'Sem multa nesta modalidade';
  const dados = `<h2>Contrato e desligamento</h2>
<table><tr><th scope="row">Vínculo</th><td>${r.vinculo}</td></tr><tr><th scope="row">Matrícula</th><td>${esc(matricula ?? '—')}</td></tr>
<tr><th scope="row">Empresa</th><td>${r.empresa}</td></tr>
<tr><th scope="row">Desligamento</th><td>${dataBr(r.desligamento)}</td></tr>
<tr><th scope="row">Modalidade</th><td>${esc(ROTULO_MODALIDADE_RESCISAO[r.modalidade])}</td></tr>
<tr><th scope="row">Aviso prévio</th><td>${esc(ROTULO_AVISO_PREVIO[r.aviso])} · ${r.diasAviso} dia(s) devidos, ${r.diasIndenizados} indenizado(s)</td></tr>
<tr><th scope="row">Projeção do contrato</th><td>${dataBr(r.desligamento)} + ${r.diasIndenizados} dia(s) = ${dataBr(r.projecao)}</td></tr>
${r.termo ? `<tr><th scope="row">Termo do contrato a prazo</th><td>${dataBr(r.termo)}</td></tr>` : ''}
<tr><th scope="row">Saldo do FGTS para fins rescisórios</th><td>${reaisBr(saldoFgts)} (${r.saldoFgtsInformado ? 'extrato informado' : 'soma dos depósitos registrados'})</td></tr>
<tr><th scope="row">Multa do FGTS (depósito na conta vinculada)</th><td>${multa}</td></tr>
<tr><th scope="row">Pagamento</th><td>${dataBr(r.pagamento)}</td></tr>
<tr><th scope="row">Situação</th><td>${situacao}${r.motivo ? ` · ${esc(r.motivo)}` : ''}</td></tr></table>`;
  if (!d.processo || d.linhas.length === 0)
    return pagina(
      titulo,
      `<h1>${esc(titulo)}</h1>${dados}<p>As verbas desta rescisão não estão disponíveis.</p>`,
    );
  return pagina(
    titulo,
    `<h1>${esc(titulo)}</h1>${dados}
<h2>Verbas rescisórias</h2><p class="secundario">Cálculo ${d.processo.numero} · ${esc(d.processo.calculadoPor)} em ${instanteBr(d.processo.calculadoEm)}</p>
<h3>Vencimentos</h3><table>${cabecalho}${tabela('provento') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h3>Descontos</h3><table>${cabecalho}${tabela('desconto') || '<tr><td colspan="5">Nenhum.</td></tr>'}</table>
<h3>Líquido a receber</h3><p>${reaisBr(proventos)} − ${reaisBr(descontos)} = <strong>${reaisBr(proventos - descontos)}</strong></p>
<p>Recebi a importância líquida acima, referente às verbas rescisórias descritas neste termo.</p>
<p>Data: ____/____/________ &nbsp; Assinatura do empregado: ________________________________</p>
<p>Assinatura do empregador: ________________________________</p>`,
  );
}

/** Envia o PDF/A (ou o HTML, sem gerador configurado). */
export async function responderPdf(
  gerador: GeradorPdfFolha | null,
  res: RespostaPdf,
  html: string,
  titulo: string,
  arquivo: string,
): Promise<unknown> {
  if (!gerador) {
    res.header('content-type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  const pdf = await gerador(html, titulo).catch(() => null);
  if (!pdf)
    throw new ErroProblema(
      'indisponivel',
      503,
      'Gerador de PDF indisponível',
      'O conversor de PDF/A não respondeu.',
    );
  res.header('content-type', 'application/pdf');
  res.header('content-disposition', `attachment; filename="${arquivo}.pdf"`);
  return res.send(pdf);
}
