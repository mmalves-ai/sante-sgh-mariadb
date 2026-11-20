// E2E @M40 (ficha, seção 10; regras 1, 3, 4, 6, 8, 14 e 16): o painel de migração com a aba da onda 2 (a ordem dos
// setores, o critério item a item com o calculado e o registrado, o registro de um item com a evidência e a data, o
// que o recolhimento desliga, o acompanhamento por dia e unidade e os códigos "a confirmar"); o relatório de
// contingência do posto gerado na linha do tempo do turno (o PDF/A real pelo serviço de emissão); e a coexistência
// livre na checagem (regra 3: o registro começa no novo e o outro sistema o termina — a prescrição suspensa por fora
// entre a leitura e o "Registrar": nada é gravado e a tela mostra o que mudou). Sessão real sobre a fonte sintética
// de dev e as portas em MEMÓRIA (nada vai à cópia); o "outro sistema" grava pelo arquivo de E2E da enfermagem. axe em
// cada tela.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-enfermagem-por-fora.json');
// Internação sintética da porta em memória da enfermagem (porta-memoria.ts).
const UTI3 = { atendimento: 25103, pulseira: 'P25003|A25203' };

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Onda 2: critério por setor, contingência do posto e coexistência livre @M40 @fase4', () => {
  test.setTimeout(240_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('painel da onda 2: ordem, critério calculado e registrado, recolhimento, acompanhamento e códigos; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-onda2').click();
    await expect(page.getByTestId('tela-migracao-onda2')).toBeVisible();
    await expect(page.locator('[data-testid^="onda2-setor-"]')).toHaveCount(8);
    await expect(page.getByTestId('onda2-sem-espera')).toBeVisible();
    await expect(page.getByTestId('onda2-versao')).toContainText('Janelas sem versão nova');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/onda2');

    // O filtro de setor (lista com busca): só a enfermagem.
    await escolher(page.getByTestId('onda2-filtro-setor'), 'enfermagem');
    await expect(page.locator('[data-testid^="onda2-setor-"]')).toHaveCount(1);
    const enf = page.getByTestId('onda2-setor-enfermagem');
    await expect(enf.getByTestId('veredito')).toHaveText('Falta completar o critério');
    await expect(enf.getByTestId('item-operacoes-conferidas')).toContainText('Calculado');
    await expect(enf.getByTestId('item-pentest-sem-critico')).toContainText('Calculado');
    await expect(enf.getByTestId('item-unidade-piloto').getByTestId('situacao')).toHaveText('Pendente');
    await expect(enf.getByTestId('recursos-novos')).toContainText('sinais vitais estruturados');
    await expect(enf.getByTestId('recolhimento')).toContainText('Recolher na hora');

    // Registrar a unidade-piloto (regra 11) com a evidência e a data.
    await enf.getByTestId('onda2-abrir-enfermagem').click();
    const form = page.getByTestId('form-onda2');
    await escolher(form.getByTestId('onda2-item'), { rotulo: 'Liberação começando pela unidade-piloto' });
    await escolher(form.getByTestId('onda2-situacao'), 'cumprido');
    await form.getByLabel(/^Evidência/).fill('UTI (ata 3 do comitê)');
    await form.getByLabel('Data do cumprimento').fill('01/12/2026');
    await form.getByLabel('Data do cumprimento').blur();
    await form.getByLabel('Justificativa').fill('Unidade-piloto definida pelo comitê (sintético)');
    await semViolacaoAxe(page, 'registro de item do critério da onda 2');
    await form.getByTestId('onda2-gravar').click();
    await expect(page.getByTestId('mensagem-onda2')).toContainText('1 item(ns) gravado(s)');
    await expect(enf.getByTestId('item-unidade-piloto').getByTestId('situacao')).toHaveText('Cumprido');
    await expect(enf.getByTestId('item-unidade-piloto').getByTestId('falta')).toContainText('UTI (ata 3');

    // O acompanhamento: agregados por dia e unidade, com o filtro de unidade e a conta dos registros.
    const ac = page.getByTestId('onda2-acompanhamento');
    await expect(ac.getByTestId('onda2-checagem')).toContainText('UTI');
    await escolher(ac.getByTestId('onda2-filtro-unidade'), 'CLI');
    await expect(ac.getByTestId('onda2-checagem')).not.toContainText('UTI');
    await expect(ac.getByTestId('onda2-registros')).toContainText('no novo +');
    await expect(page.getByTestId('onda2-codigos')).toContainText('a confirmar');
    await expect(page.locator('main')).not.toContainText(/spdata|legado/i);
    await semViolacaoAxe(page, 'acompanhamento da onda 2');
    expect(externas).toEqual([]);
  });

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

  test('coexistência livre: a checagem começa no novo e o outro sistema termina (suspende) antes do registrar; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(`/enfermagem/checagem/${UTI3.atendimento}`);
    await expect(page.getByTestId('painel-paciente')).toBeVisible();
    const linha = page
      .locator('[data-testid^="ph-"][data-estado]')
      .filter({ hasText: 'CEFTRIAXONA' })
      .filter({ has: page.locator('[data-testid^="ph-checar-"]') })
      .first();
    await expect(linha).toBeVisible();
    const id = Number((await linha.getAttribute('data-testid'))!.replace('ph-', ''));
    await page.getByTestId(`ph-checar-${id}`).click();
    await expect(page.getByTestId('form-checagem')).toBeVisible();
    await page.getByTestId('chk-pulseira').fill(UTI3.pulseira);
    await page.getByTestId('chk-avisos-conferidos').check();
    // O outro sistema termina o registro (suspende o item) depois de a tela ler o horário.
    mkdirSync(dirname(POR_FORA), { recursive: true });
    writeFileSync(POR_FORA, JSON.stringify({ suspensos: [id] }));
    await page.getByTestId('chk-registrar').click();
    await expect(page.getByTestId('recusa-enfermagem').first()).toBeVisible();
    await expect(page.getByTestId(`ph-${id}`)).toHaveAttribute('data-estado', 'suspensa');
    await semViolacaoAxe(page, '/enfermagem/checagem (terminado no outro sistema)');
  });
});
