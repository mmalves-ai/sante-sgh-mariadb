// Conversão HTML → PDF/A-2b pelo Gotenberg do Compose (127.0.0.1:3318; ADR 0020). O Chromium do Gotenberg
// só abre file:///tmp e não baixa nada: o HTML vai autocontido (fontes e imagens em data:). Tempo medido
// para o painel "Técnico" (latência da conversão).
export class ErroGotenberg extends Error {
  override readonly name = 'ErroGotenberg';
}

export interface ResultadoConversao {
  readonly pdf: Uint8Array;
  readonly ms: number;
}

export async function converterHtmlEmPdfA(
  urlGotenberg: string,
  html: string,
  opcoes: {
    readonly formato?: 'PDF/A-2b';
    readonly tempoMaximoMs?: number;
    /** Metadados do PDF (Title, Keywords…): a via fica legível no próprio arquivo, sem quebrar o PDF/A. */
    readonly metadados?: Readonly<Record<string, string>>;
  } = {},
): Promise<ResultadoConversao> {
  const formulario = new FormData();
  formulario.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  formulario.append('pdfa', opcoes.formato ?? 'PDF/A-2b');
  formulario.append('paperWidth', '8.27');
  formulario.append('paperHeight', '11.69');
  formulario.append('preferCssPageSize', 'true');
  if (opcoes.metadados) formulario.append('metadata', JSON.stringify(opcoes.metadados));
  const inicio = performance.now();
  const url = `${urlGotenberg.replace(/\/+$/, '')}/forms/chromium/convert/html`;
  const pedir = () =>
    fetch(url, {
      method: 'POST',
      body: formulario,
      signal: AbortSignal.timeout(opcoes.tempoMaximoMs ?? 30_000),
    });
  // Conexão reaproveitada que o Gotenberg já fechou (EPIPE, ECONNRESET, "other side closed"): a conversão não tem
  // efeito colateral, então tenta uma vez mais numa conexão nova. Outras falhas sobem como estão.
  const r = await pedir().catch((e: unknown) => {
    if (conexaoFechada(e)) return pedir();
    throw e;
  });
  if (!r.ok) throw new ErroGotenberg(`Gotenberg recusou a conversão (${r.status}).`);
  const pdf = new Uint8Array(await r.arrayBuffer());
  if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-')
    throw new ErroGotenberg('Resposta do Gotenberg não é PDF.');
  return { pdf, ms: performance.now() - inicio };
}

function conexaoFechada(e: unknown): boolean {
  const causa = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return (
    e instanceof TypeError && (causa === 'EPIPE' || causa === 'ECONNRESET' || causa === 'UND_ERR_SOCKET')
  );
}

/** Saúde do Gotenberg (painel "Técnico"). */
export async function gotenbergDisponivel(urlGotenberg: string): Promise<boolean> {
  try {
    const r = await fetch(`${urlGotenberg.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
