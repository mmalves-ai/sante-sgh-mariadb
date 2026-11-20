// pnpm implantacao:manual [-- --conferir]
// M60, etapa 3 (entrega 5): gera docs/implantacao/manual-implantacao.pdf (o manual e os anexos gerados) com o Chromium
// do Playwright do próprio repositório (POL-4: nada se instala; sem ele, o Chrome já presente) e grava a impressão das fontes ao lado
// (manual-implantacao.fontes.sha256). `--conferir` (no verificar): não grava; falha se o manual não tem as seções, as
// referências dos testes pós-implantação, os itens, as variáveis obrigatórias ou os anexos, ou se o PDF não foi gerado
// das fontes atuais.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SE_FALHAR } from '@sgh/dominio-config';
import { ANEXOS_MANUAL, conferirManual, htmlDoManual, impressaoDasFontes } from './manual.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const pasta = resolve(raiz, 'docs/implantacao');
const arquivoManual = join(pasta, 'manual-implantacao.md');
const arquivoPdf = join(pasta, 'manual-implantacao.pdf');
const arquivoImpressao = join(pasta, 'manual-implantacao.fontes.sha256');

const ler = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const manual = ler(arquivoManual);
const anexos = ANEXOS_MANUAL.map((a) => ({ arquivo: a, texto: ler(join(pasta, a)) }));
const impressao = impressaoDasFontes([manual, ...anexos.map((a) => a.texto)]);

const achados = conferirManual({
  manual,
  seFalhar: SE_FALHAR,
  anexoVariaveis: anexos.find((a) => a.arquivo.endsWith('variaveis.md'))?.texto ?? '',
});
for (const a of anexos) if (a.texto === '') achados.push(`falta o anexo ${a.arquivo}`);

if (process.argv.includes('--conferir')) {
  if (!existsSync(arquivoPdf)) achados.push('falta o PDF do manual: rode pnpm implantacao:manual');
  else if (ler(arquivoImpressao).trim() !== impressao)
    achados.push('o PDF do manual não foi gerado das fontes atuais: rode pnpm implantacao:manual');
  if (achados.length > 0) {
    for (const a of achados) console.error(`- ${a}`);
    console.error(`Manual de implantação: ${achados.length} achado(s).`);
    process.exit(1);
  }
  console.log(
    'Manual de implantação em dia: 12 seções, itens da verificação, variáveis obrigatórias, anexos e PDF.',
  );
} else {
  if (achados.length > 0) {
    for (const a of achados) console.error(`- ${a}`);
    console.error('Corrija o manual antes de gerar o PDF.');
    process.exit(1);
  }
  const { chromium } = await import('@playwright/test');
  const tmp = mkdtempSync(join(tmpdir(), 'manual-'));
  try {
    const html = join(tmp, 'manual.html');
    writeFileSync(html, htmlDoManual(manual, anexos));
    // O Chromium do Playwright do repositório; se não estiver baixado neste worktree, o Chrome já instalado na máquina
    // (só é lido, nada se instala).
    const navegador = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
    try {
      const pagina = await navegador.newPage();
      await pagina.goto(`file://${html}`);
      await pagina.pdf({
        path: arquivoPdf,
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:7pt;width:100%;text-align:center;color:#555">Manual de implantação · ' +
          '<span class="pageNumber"></span> de <span class="totalPages"></span></div>',
        margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
      });
    } finally {
      await navegador.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(arquivoImpressao, `${impressao}\n`);
  console.log('docs/implantacao/manual-implantacao.pdf gerado (manual e anexos).');
}
