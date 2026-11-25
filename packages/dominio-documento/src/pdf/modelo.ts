// Modelo HTML do documento de prova, convertido em PDF/A-2b pelo Gotenberg (regra 9 da ficha do M09;
// roteiro 6.8). Autocontido (fontes e imagens em data:, nenhum endereço externo: o Chromium do Gotenberg só
// abre file:///tmp), com a marca por parâmetro (DP-49, DP-9) e o QR de validação. Massa sintética.

export interface CampoDocumento {
  readonly rotulo: string;
  readonly valor: string;
  /**
   * 'marcado' (04-INT L69): o valor é texto com marcação restrita — `**negrito**` e quebras de linha (linha em branco
   * abre parágrafo). Tudo é escapado antes; só essas marcas viram HTML. Sem formato, o valor sai como texto puro.
   */
  readonly formato?: 'texto' | 'marcado';
}

export interface DadosDocumento {
  readonly titulo: string;
  readonly produto: string;
  readonly estabelecimento: string;
  readonly emitidoEm: string;
  readonly via: string | null;
  readonly campos: readonly CampoDocumento[];
  readonly qrSvg: string;
  readonly identificadorQr: string;
  /** CSS de @font-face com a fonte embutida (woff2 em data:). */
  readonly fontesCss: string;
  /** Logo em SVG (marca do `packages/ui`), já inline. */
  readonly logoSvg?: string;
  /**
   * ADR 0021 (R1): documento emitido numa sessão "como" leva a marca visível "Registrado pelo suporte técnico
   * em nome de <alvo>" (o texto vem de marcaSuporteTecnico, @sgh/contratos), para o papel não atribuir ao
   * alvo um ato que ele não fez.
   */
  readonly marcaSuporte?: string | null;
  /**
   * SBIS-42 (M59, regra 9): o número do certificado SBIS vigente do estabelecimento (a auditoria formal concluída
   * apta mais recente). Só com ele o rodapé diz "Sistema certificado SBIS nº"; sem certificado, o rodapé não o cita.
   */
  readonly certificadoSbis?: string | null;
  /**
   * 04-INT L69: as cópias que saem no mesmo PDF (1 a 20). Cada cópia começa em página nova e leva "Cópia k de n";
   * sem o campo, ou com 1, sai uma só, sem a marca.
   */
  readonly copias?: number;
  /**
   * 03-PEP L131: as linhas do cabeçalho e do rodapé pela regra do tipo de documento (montarCabecalho). Com elas, o
   * cabeçalho imprime essas linhas no lugar do nome do estabelecimento, e o rodapé as traz antes da validação.
   */
  readonly cabecalhoLinhas?: readonly string[];
  readonly rodapeLinhas?: readonly string[];
}

/** Texto com marcação restrita em HTML: escapa tudo e só então troca `**x**` por negrito e as quebras de linha. */
export function htmlMarcado(texto: string): string {
  return escaparHtml(texto.replace(/\r\n?/g, '\n').trim())
    .replace(/\*\*([^*\n](?:[^*\n]|\*(?!\*))*?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** As cópias do documento, de 1 a 20 (fora disso, o número inteiro mais próximo dentro da faixa). */
export function copiasDoDocumento(copias: number | undefined): number {
  if (copias === undefined || !Number.isFinite(copias)) return 1;
  return Math.min(20, Math.max(1, Math.round(copias)));
}

/** O trecho do rodapé com a certificação SBIS (SBIS-42): só com o número do certificado; sem ele, vazio. */
export function rodapeCertificacaoSbis(certificado: string | null | undefined): string {
  const n = (certificado ?? '').trim();
  return n ? `Sistema certificado SBIS nº ${n}.` : '';
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function htmlDocumento(d: DadosDocumento): string {
  if (/https?:\/\//i.test(d.fontesCss) || /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(d.logoSvg ?? '')) {
    throw new Error('O documento não pode citar recurso externo (fonte ou imagem por URL).');
  }
  const campos = d.campos
    .map(
      (c) =>
        `<tr><th scope="row">${escaparHtml(c.rotulo)}</th><td>${c.formato === 'marcado' ? htmlMarcado(c.valor) : escaparHtml(c.valor)}</td></tr>`,
    )
    .join('');
  const n = copiasDoDocumento(d.copias);
  const cabecalho = d.cabecalhoLinhas?.length
    ? d.cabecalhoLinhas.map((l, i) => (i === 0 ? escaparHtml(l) : `<br>${escaparHtml(l)}`)).join('')
    : escaparHtml(d.estabelecimento);
  const rodape = (d.rodapeLinhas ?? []).map((l) => `<p class="rodape">${escaparHtml(l)}</p>`).join('');
  const corpo = (k: number) =>
    [
      `<section class="copia">`,
      `<header><div>${d.logoSvg ?? ''}<div>${cabecalho}</div></div>`,
      `${d.via ? `<div class="via">${escaparHtml(d.via)}</div>` : ''}${n > 1 ? `<div class="via">Cópia ${k} de ${n}</div>` : ''}</header>`,
      `<h1>${escaparHtml(d.titulo)}</h1>`,
      d.marcaSuporte ? `<p class="suporte">${escaparHtml(d.marcaSuporte)}</p>` : '',
      `<table>${campos}</table>`,
      rodape,
      `<footer>${d.qrSvg}<div>Emitido em ${escaparHtml(d.emitidoEm)} por ${escaparHtml(d.produto)}.`,
      ` Valide pelo QR (código ${escaparHtml(d.identificadorQr)}).`,
      d.certificadoSbis ? ` ${escaparHtml(rodapeCertificacaoSbis(d.certificadoSbis))}` : '',
      '</div></footer>',
      '</section>',
    ].join('');
  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    `<title>${escaparHtml(d.titulo)}</title>`,
    '<style>',
    d.fontesCss,
    "@page{size:A4;margin:18mm 16mm}body{font-family:'SGH Documento',sans-serif;color:#000;font-size:11pt}",
    'header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #83102c;padding-bottom:6px}',
    'h1{font-size:15pt;margin:14px 0 8px}.via{border:2px solid #83102c;color:#83102c;padding:2px 8px;font-weight:700}',
    'table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ccc;padding:4px 6px;vertical-align:top}',
    'th{width:35%;font-weight:600}footer{margin-top:18px;display:flex;gap:12px;align-items:center;font-size:9pt}',
    '.suporte{margin:10px 0;border:2px solid #000;padding:4px 8px;font-weight:700}',
    '.rodape{margin:8px 0 0;font-size:9pt}td p{margin:0 0 6px}.copia+.copia{break-before:page}header .via+.via{margin-left:6px}',
    '</style></head><body>',
    Array.from({ length: n }, (_, i) => corpo(i + 1)).join(''),
    '</body></html>',
  ].join('');
}

/** @font-face com a fonte em woff2 (bytes) como data: URI. */
export function fonteEmbutida(familia: string, woff2: Uint8Array, peso = 400): string {
  let s = '';
  for (const b of woff2) s += String.fromCharCode(b);
  return `@font-face{font-family:'${familia}';font-weight:${peso};src:url(data:font/woff2;base64,${btoa(s)}) format('woff2');}`;
}
