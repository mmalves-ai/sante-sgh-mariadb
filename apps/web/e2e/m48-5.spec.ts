// E2E @M48.5 (ficha do M48, etapa 5, gestão da qualidade ONA e envios regulatórios; seções 7, 8 regras 9 e 10, 10 e
// 11): a qualidade publica um POP (o aprovador igual ao elaborador é recusado), dá ciência e vê quem deu; a ouvidoria
// vê só o vigente e dá a sua ciência, registra uma reclamação anônima com o prazo de 10 dias úteis, encaminha à área e
// responde com a procedência, transforma a resposta da pesquisa em manifestação e lê o NPS com as parcelas; o NSP
// gera o arquivo do Notivisa (resumo SHA-256), baixa de novo e confere, e registra a transmissão manual com o
// protocolo. axe sem violação séria em cada estado. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados
// SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** A resposta sintética da pesquisa com nota de detrator (porta em memória da gestão da qualidade). */
const PESQUISA_DETRATOR = 9_485_003;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function sair(page: Page): Promise<void> {
  await page.context().clearCookies();
}

test.describe('Gestão da qualidade: POP e ciência, ouvidoria com prazo e resposta, envio regulatório @M48 @M48.5 @fase5', () => {
  test.setTimeout(300_000);

  test('POP publicado → ciência de dois usuários → manifestação → pesquisa e NPS → envio gerado, conferido e transmitido; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // ── A qualidade publica o POP ──────────────────────────────────────────────────────────────────────────────
    await entrar(page, 'SINT.QUALIDADE');
    await page.goto('/qualidade/documentos');
    await expect(page.getByTestId('tela-documentos')).toBeVisible();
    await expect(page.getByTestId('gestao-resumo')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/documentos (lista)');

    await page.getByTestId('doc-novo').click();
    const form = page.getByTestId('form-documento');
    await expect(form).toBeVisible();
    await form.getByTestId('doc-codigo').locator('input').fill('pop-e2e-01');
    await escolher(form.getByTestId('doc-tipo'), 'pop');
    await form.getByTestId('doc-area').locator('input').fill('Enfermagem');
    await form.getByTestId('doc-titulo').locator('input').fill('Higienização das mãos (texto sintético)');
    await form
      .getByTestId('doc-conteudo')
      .locator('textarea')
      .fill('1. Retirar adornos. 2. Friccionar por 20 segundos. 3. Secar (texto sintético).');
    // O aprovador (quem publica) não pode ser o elaborador.
    await form.getByTestId('doc-elaborado').locator('input').fill('SINT.QUALIDADE');
    await semViolacaoAxe(page, '/qualidade/documentos (novo documento)');
    await form.getByTestId('doc-publicar').click();
    await expect(form.getByTestId('recusa-gestao')).toBeVisible();
    await form.getByTestId('doc-elaborado').locator('input').fill('SINT.ENFERMEIRA');
    await form.getByTestId('doc-publicar').click();

    await expect(page.getByTestId('gestao-aviso')).toContainText('revisão 1');
    const doc = page.getByTestId('documento-detalhe');
    await expect(doc).toBeVisible();
    await expect(doc.getByTestId('doc-situacao')).toContainText('Vigente');
    await expect(doc.getByTestId('doc-ciencias')).toContainText('0');
    await semViolacaoAxe(page, '/qualidade/documentos (documento publicado)');
    await doc.getByTestId('doc-dar-ciencia').click();
    await expect(page.getByTestId('gestao-aviso')).toBeVisible();
    await expect(doc.getByTestId('doc-ciencias')).toContainText('1');
    await expect(doc.getByTestId('doc-dar-ciencia')).toHaveCount(0);
    await doc.getByTestId('doc-ver-cientes').click();
    await expect(doc.getByTestId('doc-cientes')).toContainText('SINT.QUALIDADE');
    await semViolacaoAxe(page, '/qualidade/documentos (quem deu ciência)');

    // ── A ouvidoria: o vigente e a ciência ───────────────────────────────────────────────────────────────────
    await sair(page);
    await entrar(page, 'SINT.OUVIDORIA');
    await page.goto('/qualidade/documentos');
    await expect(page.getByTestId('tela-documentos')).toBeVisible();
    // Quem não publica vê só os vigentes (sem o filtro da situação nem o botão de novo).
    await expect(page.getByTestId('doc-filtro-situacao')).toHaveCount(0);
    await expect(page.getByTestId('doc-novo')).toHaveCount(0);
    const linha = page.locator('[data-testid^="documento-"]').filter({ hasText: 'POP-E2E-01' });
    await expect(linha).toHaveCount(1);
    await linha.locator('[data-testid^="abrir-documento-"]').click();
    const lido = page.getByTestId('documento-detalhe');
    await expect(lido.getByTestId('doc-conteudo-lido')).toContainText('Friccionar');
    await expect(lido.getByTestId('doc-revisar')).toHaveCount(0);
    await lido.getByTestId('doc-dar-ciencia').click();
    await expect(lido.getByTestId('doc-ciencias')).toContainText('2');
    await semViolacaoAxe(page, '/qualidade/documentos (ciência de quem lê)');

    // ── A ouvidoria: manifestação anônima com prazo, encaminhamento e resposta ────────────────────────────────
    await page.goto('/qualidade/ouvidoria');
    await expect(page.getByTestId('tela-ouvidoria')).toBeVisible();
    await page.getByTestId('man-nova').click();
    const fm = page.getByTestId('form-manifestacao');
    await expect(fm).toBeVisible();
    await escolher(fm.getByTestId('man-canal'), 'telefone');
    await escolher(fm.getByTestId('man-tipo'), 'reclamacao');
    await fm.getByTestId('man-area').locator('input').fill('Recepção');
    await fm.getByTestId('man-identificada').setChecked(false);
    await expect(fm.getByTestId('man-anonima')).toBeVisible();
    await fm
      .getByTestId('man-relato')
      .locator('textarea')
      .fill('Demora de 2 horas para o atendimento na recepção (texto sintético).');
    await semViolacaoAxe(page, '/qualidade/ouvidoria (nova manifestação)');
    await fm.getByTestId('man-gravar').click();
    await expect(page.getByTestId('gestao-aviso')).toBeVisible();
    const man = page.getByTestId('manifestacao-detalhe');
    await expect(man).toBeVisible();
    await expect(man.getByTestId('man-situacao')).toContainText('Aberta');
    await expect(man.getByTestId('man-prazo')).toBeVisible();
    // Quem liga dá o protocolo: a busca acha a manifestação por ele.
    const protocolo = /OUV-\d{4}-\d{6}/.exec(
      (await page.getByTestId('gestao-aviso').textContent()) ?? '',
    )?.[0];
    expect(protocolo).toBeTruthy();
    await page.getByTestId('man-busca').locator('input').fill(protocolo!.toLowerCase());
    await page.getByTestId('man-buscar').click();
    await expect(page.locator('[data-testid^="abrir-manifestacao-"]')).toHaveCount(1);
    await semViolacaoAxe(page, '/qualidade/ouvidoria (manifestação aberta)');

    await man.getByTestId('man-encaminhar').click();
    const enc = man.getByTestId('form-encaminhar');
    await enc.getByTestId('man-encaminhada-a').locator('input').fill('Coordenação da recepção');
    await enc
      .getByTestId('man-observacao')
      .locator('textarea')
      .fill('Apurar a escala do turno (texto sintético).');
    await enc.getByTestId('man-gravar-andamento').click();
    await expect(man.getByTestId('man-situacao')).toContainText('Encaminhada');

    await man.getByTestId('man-responder').click();
    const resp = man.getByTestId('form-responder');
    await resp
      .getByTestId('man-resposta')
      .locator('textarea')
      .fill('A escala foi reforçada no horário de pico (texto sintético).');
    await escolher(resp.getByTestId('man-procedente'), 'sim');
    await semViolacaoAxe(page, '/qualidade/ouvidoria (resposta)');
    await resp.getByTestId('man-gravar-andamento').click();
    await expect(man.getByTestId('man-situacao')).toContainText('Respondida');

    // ── A pesquisa do portal vira manifestação; o NPS com as parcelas ─────────────────────────────────────────
    await page.getByTestId('aba-pesquisas').click();
    await escolher(page.getByTestId('ouv-competencia'), { indice: 1 });
    await expect(page.getByTestId('tabela-pesquisas')).toBeVisible();
    await expect(page.getByTestId(`pesquisa-${PESQUISA_DETRATOR}`)).toContainText('recepção');
    await semViolacaoAxe(page, '/qualidade/ouvidoria (pesquisa)');
    await page.getByTestId(`pesquisa-registrar-${PESQUISA_DETRATOR}`).click();
    const fp = page.getByTestId('form-manifestacao');
    await expect(fp).toBeVisible();
    await escolher(fp.getByTestId('man-tipo'), 'reclamacao');
    await fp.getByTestId('man-area').locator('input').fill('Recepção');
    await fp.getByTestId('man-gravar').click();
    await expect(page.getByTestId('manifestacao-detalhe')).toBeVisible();
    await expect(page.getByTestId('manifestacao-detalhe').getByTestId('man-situacao')).toContainText(
      'Aberta',
    );

    await page.getByTestId('aba-nps').click();
    await escolher(page.getByTestId('ouv-competencia'), { indice: 1 });
    const nps = page.getByTestId('tabela-nps');
    await expect(nps).toBeVisible();
    await expect(nps.locator('[data-testid^="nps-"]')).toHaveCount(6);
    await semViolacaoAxe(page, '/qualidade/ouvidoria (NPS)');

    // ── O NSP (dono dos incidentes) gera, confere e transmite o arquivo do Notivisa ─────────────────────────
    await sair(page);
    await entrar(page, 'SINT.NSP');
    await page.goto('/relatorios/envios-regulatorios');
    await expect(page.getByTestId('tela-envios')).toBeVisible();
    await expect(page.getByTestId('gestao-desligada')).toHaveCount(0);
    await semViolacaoAxe(page, '/relatorios/envios-regulatorios');
    const gerado = page.waitForEvent('download');
    await page.getByTestId('envio-gerar-notivisa').click();
    expect((await gerado).suggestedFilename()).toMatch(/\.csv$/i);
    await expect(page.getByTestId('gestao-aviso')).toBeVisible();
    const tabela = page.getByTestId('tabela-envios-notivisa');
    const envio = tabela.locator('[data-testid^="envio-linha-"]').first();
    await expect(envio).toContainText(/[0-9a-f]{64}/i);
    const id = ((await envio.getAttribute('data-testid')) ?? '').replace('envio-linha-', '');

    // Baixar de novo: o servidor gera outra vez e confere com o resumo da geração.
    const denovo = page.waitForEvent('download');
    await page.getByTestId(`envio-baixar-${id}`).click();
    await denovo;
    await expect(page.getByTestId(`envio-conferido-${id}`)).toHaveClass(/prazo--cumprido/);

    await page.getByTestId(`envio-transmitir-${id}`).click();
    const tx = page.getByTestId('form-transmissao');
    await expect(tx).toBeVisible();
    await expect(tx.getByTestId('tx-hash').locator('input')).toHaveValue(/[0-9a-f]{64}/i);
    await tx.getByTestId('tx-protocolo').locator('input').fill('NTV-E2E-0001');
    await semViolacaoAxe(page, '/relatorios/envios-regulatorios (transmissão)');
    await tx.getByTestId('tx-gravar').click();
    await expect(page.getByTestId(`envio-linha-${id}`)).toContainText('Transmitido');
    await expect(page.getByTestId(`envio-linha-${id}`)).toContainText('NTV-E2E-0001');
    await expect(page.getByTestId(`envio-transmitir-${id}`)).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
