// E2E @M40 (ficha, seção 10): o relatório de contingência do posto gerado na linha do tempo do turno (o PDF/A real
// pelo serviço de emissão) e pela API. Lote 02-07 (ADR 0003): o painel da onda 2 e a coexistência livre na checagem
// saíram com a convivência. Sessão real sobre a fonte sintética de dev e as portas em MEMÓRIA. axe em cada tela.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-enfermagem-por-fora.json');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Onda 2: critério por setor, contingência do posto @M40 @fase4', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('relatório de contingência do posto: o pedido da unidade e do horizonte, o PDF numa aba nova e as contagens; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/turno');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const sec = page.getByTestId('contingencia');
    await expect(sec).toBeVisible();
    await escolher(sec.getByTestId('contingencia-horas'), '8');
    // O PDF/A real é provado pela integração (contingencia-pdf.int.spec.ts: Gotenberg, S3 com trava e veraPDF); no
    // dev do E2E não há o armazém de documentos da rede, então a resposta da emissão é a de mentira (como no M26).
    let pedido: unknown = null;
    await page.route('**/api/enfermagem/contingencia', async (rota) => {
      pedido = rota.request().postDataJSON();
      await rota.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'x-sgh-pacientes': '3', 'x-sgh-horarios': '9' },
        body: Buffer.from('%PDF-1.7\n% SINTETICO\n%%EOF\n'),
      });
    });
    const aba = page.context().waitForEvent('page');
    await sec.getByTestId('contingencia-gerar').click();
    await (await aba).close();
    expect(pedido).toEqual({ unidade: 'UTI', horas: 8 });
    await expect(sec.getByTestId('contingencia-mensagem')).toContainText('3 paciente(s), 9 horário(s)');
    await semViolacaoAxe(page, '/enfermagem/turno (contingência)');
  });

  test('relatório de contingência pela API: sem o armazém de documentos, a tela diz como seguir; o último do posto', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/enfermagem/turno');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const sec = page.getByTestId('contingencia');
    const resposta = page.waitForResponse((r) => r.url().endsWith('/api/enfermagem/contingencia'));
    await sec.getByTestId('contingencia-gerar').click();
    const r = await resposta;
    // Com o armazém da rede (homologação e produção), 200 com o PDF; no dev do E2E, 503 com a saída pela linha do tempo.
    if (r.status() === 200) expect(r.headers()['content-type']).toContain('application/pdf');
    else {
      expect(r.status()).toBe(503);
      await expect(sec).toContainText('linha do tempo do turno');
    }
    // A estação de contingência baixa o último relatório do posto (o da hora) sem gerar outro: com a emissão feita,
    // o PDF relido do armazém; sem ela, a tela diz para gerar um.
    const ultima = page.waitForResponse((x) => x.url().includes('/api/enfermagem/contingencia/ultima'));
    const aba = r.status() === 200 ? page.context().waitForEvent('page') : null;
    await sec.getByTestId('contingencia-ultima').click();
    const u = await ultima;
    if (r.status() === 200) {
      expect(u.status()).toBe(200);
      await (await aba!).close();
      await expect(sec.getByTestId('contingencia-mensagem')).toContainText('Último relatório do posto');
    } else {
      expect(u.status()).toBe(404);
      await expect(sec.getByTestId('contingencia-mensagem')).toContainText('Ainda não há relatório gerado');
    }
    await semViolacaoAxe(page, '/enfermagem/turno (último relatório)');
  });
});
