// E2E @M59.5 (ficha do M59, etapa 5, F5 pacote de evidências SBIS, autoavaliação e pré-auditoria), com axe: a
// exportação da trilha para a auditoria (identificação do software e do estabelecimento e a prova da cadeia, CSV e
// XML) e a certificação em leitura pelo auditor; a autoavaliação do mês conduzida pelo escritório da qualidade (uma
// não conformidade avaliada, corrigida e verificada por OUTRA pessoa; concluir travado com requisito pendente;
// pré-auditoria sem avaliador recusada; cancelamento); o backup verificado (restauração diária registrada pelo
// operador de backup, fim antes do início recusado na tela); e o termo das concessões (previsão gravada; encerrar
// recusado enquanto a medida não confirma, falha fechada). Sessões reais sobre a fonte sintética; a porta do M59-F5
// em memória (porta-memoria.ts): nada na cópia. Contas sintéticas SINT.AUDITOR, SINT.SBIS.CONFORMIDADE e
// SINT.SBIS.CONFORMIDADE2 (gestão da qualidade), SINT.SBIS.BACKUP (operador de backup) e SINT.ADMIN (termo).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const REQ = 'SBIS-01';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaPagina(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

const semTextoDoOutroSistema = async (page: Page) =>
  expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);

/** `AAAA-MM-DDTHH:mm` no fuso do NAVEGADOR (o campo datetime-local), `minutos` atrás de agora. */
async function local(page: Page, minutos: number): Promise<string> {
  return page.evaluate((m) => {
    const d = new Date(Date.now() - m * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }, minutos);
}

test.describe('Certificação SBIS @M59.5 @fase7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('exportação da trilha para a auditoria e certificação em leitura pelo auditor; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.AUDITOR');
    await page.goto('/administracao/auditoria/trilha');
    // O período padrão (hoje) cabe nos 31 dias da prova da cadeia.
    await page.getByTestId('trilha-consultar').click();
    await expect(page.getByTestId('trilha-sbis')).toBeVisible();
    await expect(page.getByTestId('exportar-sbis-csv')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/auditoria/trilha (exportação SBIS, M59.5)');

    // O arquivo abre com a identificação e a prova da cadeia, antes das linhas da trilha.
    const csv = await page.getByTestId('exportar-sbis-csv').getAttribute('href');
    expect(csv).toBeTruthy();
    const rc = await page.request.get(csv!);
    expect(rc.status()).toBe(200);
    const textoCsv = await rc.text();
    for (const campo of ['# software', '# cnes', '# cnpj', '# cadeiaIntegra'])
      expect(textoCsv).toContain(campo);
    const xml = await page.getByTestId('exportar-sbis-xml').getAttribute('href');
    const rx = await page.request.get(xml!);
    expect(rx.status()).toBe(200);
    const textoXml = await rx.text();
    expect(textoXml).toContain('<identificacao ');
    expect(textoXml).toContain('<provaCadeia ');

    // A certificação, ligada da trilha: o auditor só lê.
    await page.getByTestId('trilha-certificacao-sbis').click();
    await expect(page).toHaveURL(/\/administracao\/auditoria\/sbis/);
    await expect(page.getByTestId('sbis-sem-edicao')).toBeVisible();
    await expect(page.getByTestId('sbis-requisitos')).toContainText('59');
    await expect(page.getByTestId('sbis-pacote-matriz-rastreabilidade')).toBeVisible();
    await expect(page.getByTestId('sbis-certificado')).toBeVisible();
    await expect(page.getByTestId('form-sbis-abrir')).toHaveCount(0);
    await semTextoDoOutroSistema(page);
    await semViolacaoAxe(page, '/administracao/auditoria/sbis (auditor, M59.5)');
    expect(externas).toEqual([]);
  });

  test('autoavaliação: não conformidade corrigida e verificada por outra pessoa; pré-auditoria sem avaliador recusada; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SBIS.CONFORMIDADE');
    await page.goto('/administracao/auditoria/sbis');
    await expect(page.getByTestId('form-sbis-abrir')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/auditoria/sbis (qualidade, M59.5)');

    // Abre a autoavaliação do mês.
    await escolher(page.getByTestId('sbis-novo-tipo'), 'autoavaliacao');
    await page.getByTestId('sbis-novo-versao').fill('2026.10-e2e');
    await page.getByTestId('sbis-novo-abrir').click();
    await expect(page.getByTestId('sbis-aviso')).toContainText('Ciclo aberto');
    await expect(page.getByTestId('sbis-itens')).toBeVisible();
    await expect(page.getByTestId(`sbis-item-${REQ}`)).toBeVisible();
    // Requisito pendente: concluir fica travado.
    await expect(page.getByTestId('sbis-pendentes')).toBeVisible();
    await expect(page.getByTestId('sbis-concluir')).toBeDisabled();

    // Avalia um requisito como não conforme (severidade e origem obrigatórias).
    await page.getByTestId(`sbis-avaliar-${REQ}`).click();
    await expect(page.getByTestId('form-sbis-avaliar')).toBeVisible();
    await escolher(page.getByTestId('sbis-avaliar-resultado'), 'nao-conforme');
    await escolher(page.getByTestId('sbis-avaliar-severidade'), 'menor');
    await escolher(page.getByTestId('sbis-avaliar-origem'), 'documentacao');
    await page.getByTestId('sbis-avaliar-evidencia').fill('Notas de versão sem a data (E2E M59.5)');
    await semViolacaoAxe(page, 'sbis: avaliar requisito (M59.5)');
    await page.getByTestId('sbis-avaliar-salvar').click();
    await expect(page.getByTestId('sbis-aviso')).toContainText('Avaliação registrada');

    // Registra a correção.
    await page.getByTestId(`sbis-corrigir-${REQ}`).click();
    await expect(page.getByTestId('form-sbis-corrigir')).toBeVisible();
    await page.getByTestId('sbis-corrigir-descricao').fill('Data incluída nas notas de versão (E2E M59.5)');
    await page.getByTestId('sbis-corrigir-salvar').click();
    await expect(page.getByTestId('sbis-aviso')).toContainText('Correção registrada');

    // Quem corrigiu não verifica a própria correção.
    await page.getByTestId(`sbis-verificar-${REQ}`).click();
    await expect(page.getByTestId('sbis-recusa')).toBeVisible();

    // A verificação por outra pessoa do escritório da qualidade.
    const outra = await novaPagina(browser);
    const externasOutra = vigiarExternas(outra);
    await entrar(outra, 'SINT.SBIS.CONFORMIDADE2');
    await outra.goto('/administracao/auditoria/sbis');
    await outra.locator('[data-testid^="sbis-ver-ciclo-"]').first().click();
    await expect(outra.getByTestId('sbis-itens')).toBeVisible();
    await outra.getByTestId(`sbis-verificar-${REQ}`).click();
    await expect(outra.getByTestId('sbis-aviso')).toContainText('Correção verificada');
    await expect(outra.getByTestId(`sbis-verificar-${REQ}`)).toHaveCount(0);
    await semViolacaoAxe(outra, 'sbis: correção verificada por outra pessoa (M59.5)');
    expect(externasOutra).toEqual([]);

    // Pré-auditoria sem o avaliador externo: recusada com o texto do contrato.
    await page.reload();
    await escolher(page.getByTestId('sbis-novo-tipo'), 'pre-auditoria');
    await page.getByTestId('sbis-novo-versao').fill('2026.10-e2e');
    await page.getByTestId('sbis-novo-abrir').click();
    await expect(page.getByTestId('sbis-recusa')).toBeVisible();

    // Cancela a autoavaliação de teste.
    await page.locator('[data-testid^="sbis-ver-ciclo-"]').first().click();
    await expect(page.getByTestId('form-sbis-cancelar')).toBeVisible();
    await page.getByTestId('sbis-cancelar-motivo').fill('Ciclo de demonstração (E2E M59.5)');
    await page.getByTestId('sbis-cancelar').click();
    await expect(page.getByTestId('sbis-aviso')).toContainText('Ciclo cancelado');
    await semTextoDoOutroSistema(page);
    await semViolacaoAxe(page, 'sbis: ciclo cancelado (M59.5)');
    expect(externas).toEqual([]);
  });

  test('backup verificado: restauração diária registrada pelo operador; fim antes do início recusado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SBIS.BACKUP');
    await page.goto('/administracao/auditoria/backup');
    await expect(page.getByTestId('backup-situacao-diaria')).toContainText('Atrasada');
    await expect(page.getByTestId('form-backup-registrar')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/auditoria/backup (M59.5)');

    const fim = await local(page, 5);
    const inicio = await local(page, 45);
    await escolher(page.getByTestId('backup-tipo'), 'diaria');
    await page.getByTestId('backup-inicio').fill(fim);
    await page.getByTestId('backup-fim').fill(inicio);
    await page.getByTestId('backup-ambiente').fill('Ambiente isolado de restauração');
    await page.getByTestId('backup-registrar').click();
    await expect(page.getByTestId('backup-falha')).toBeVisible();

    await page.getByTestId('backup-inicio').fill(inicio);
    await page.getByTestId('backup-fim').fill(fim);
    await page.getByTestId('backup-tamanho').fill('2048');
    await page.getByTestId('backup-registrar').click();
    await expect(page.getByTestId('backup-aviso')).toContainText('Restauração registrada');
    await expect(page.getByTestId('backup-situacao-diaria')).toContainText('Em dia');
    await expect(page.locator('[data-testid^="backup-restauracao-"]')).toHaveCount(1);
    await semTextoDoOutroSistema(page);
    await semViolacaoAxe(page, 'backup: restauração registrada (M59.5)');
    expect(externas).toEqual([]);
  });

  test('termo das concessões: previsão gravada; encerrar recusado sem a medida confirmada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/concessoes');
    await expect(page.getByTestId('concessoes-tabela')).toBeVisible();
    await expect(page.getByTestId('concessao-trilha-alteravel')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/coexistencia/concessoes (M59.5)');

    await page.getByTestId('concessao-prever-senha-formato-antigo').click();
    await expect(page.getByTestId('form-concessao')).toBeVisible();
    await page.getByTestId('form-concessao').getByLabel('Data prevista').fill('31/12/2027');
    await page.getByTestId('concessao-confirmar').click();
    await expect(page.getByTestId('concessoes-aviso')).toContainText('Termo atualizado');
    await expect(page.getByTestId('concessao-senha-formato-antigo')).toContainText('31/12/2027');

    // Encerrar exige a medida confirmada pelas telas das fatias F1 a F4: sem ela, a recusa (falha fechada).
    await page.getByTestId('concessao-encerrar-trilha-alteravel').click();
    await page.getByTestId('concessao-texto').fill('Trilha própria encadeada em uso (E2E M59.5)');
    await page.getByTestId('concessao-senha').fill(SENHA);
    await semViolacaoAxe(page, 'concessões: encerrar (M59.5)');
    await page.getByTestId('concessao-confirmar').click();
    await expect(page.getByTestId('concessoes-recusa')).toBeVisible();
    await expect(page.getByTestId('concessao-trilha-alteravel')).toContainText('Vigente');
    await semTextoDoOutroSistema(page);
    expect(externas).toEqual([]);
  });
});
