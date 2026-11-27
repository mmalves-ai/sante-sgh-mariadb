// E2E @M15 (ficha, seção 10): o médico acha o paciente pelo Ctrl+K, informa o motivo, abre um registro de 2021
// (sem documento: o formulário da época) e um de 2026 (documento emitido), vê um suspenso com a justificativa; o
// Auditor vê as leituras no registro de acesso ao prontuário; axe sem violação séria. Sessão real sobre a fonte
// sintética de dev e as portas do cadastro e do prontuário em MEMÓRIA (registros SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Prontuário ao vivo (consulta) @M15 @jornada', () => {
  test('médico: Ctrl+K, motivo, registro de 2021 e de 2026, suspenso; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    // Paleta: "Abrir prontuário: <termo>" abre a busca do prontuário com o termo.
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('paleta')).toBeVisible();
    await page.keyboard.type('cinthya vianna');
    await expect(page.getByRole('option', { name: /Abrir prontuário: cinthya vianna/ })).toBeVisible();
    await page.getByRole('option', { name: /Abrir prontuário: cinthya vianna/ }).click();
    await expect(page).toHaveURL(/\/pep\/prontuario\?q=cinthya/);
    await expect(page.getByRole('heading', { level: 1, name: 'Prontuário ao vivo: consulta' })).toBeVisible();
    await expect(page.getByTestId('prontuario-paciente-1003')).toBeVisible();
    await semViolacaoAxe(page, '/pep/prontuario');
    await page.getByTestId('prontuario-paciente-1003').getByRole('link').click();

    // Primeira abertura do paciente na sessão: o motivo (lista fechada).
    const dialogo = page.getByTestId('dialogo-motivo');
    await expect(dialogo).toBeVisible();
    await semViolacaoAxe(page, 'diálogo do motivo');
    await dialogo.getByRole('radio', { name: 'Assistência ao paciente' }).check();
    await page.getByTestId('confirmar-motivo').click();
    await expect(page.getByTestId('lista-registros')).toBeVisible();
    await expect(page.getByTestId('cabecalho-prontuario')).toContainText('CINTHYA GABRIELLA VIANNA');
    await expect(page.getByTestId('aviso-excecoes')).toBeVisible();
    // Marcas legais na lista: o suspenso, a correção e o sem conteúdo.
    await expect(page.getByTestId('registro-900004').getByTestId('marca-suspenso')).toBeVisible();
    await expect(page.getByTestId('registro-900003').getByTestId('marca-correcao')).toBeVisible();
    await expect(page.getByTestId('registro-900002').getByTestId('marca-sem-conteudo')).toBeVisible();
    await semViolacaoAxe(page, '/pep/prontuario/1003');

    // Filtro por categoria profissional.
    await escolher(page.getByLabel('Categoria profissional'), 'enfermagem');
    await page.getByTestId('aplicar-filtros').click();
    await expect(page.getByTestId('registro-900005')).toBeVisible();
    await expect(page.getByTestId('registro-900006')).toHaveCount(0);
    await page.getByRole('button', { name: 'Limpar' }).click();
    await expect(page.getByTestId('registro-900006')).toBeVisible();

    // Busca de palavra (sem acento).
    await page.getByTestId('termo-palavra').fill('toracica');
    await page.getByTestId('buscar-palavra').click();
    await expect(page.getByTestId('resultado-palavra')).toContainText('torácica');

    // Registro de 2021: sem documento emitido, abre com o formulário da época.
    await page.getByTestId('registro-900001').getByRole('link').click();
    await expect(page.getByTestId('tela-registro')).toBeVisible();
    await expect(page.getByTestId('aviso-fonte')).toContainText('não tem o documento emitido');
    await expect(page.getByTestId('painel-aba')).toContainText('Dor ao esforço');
    await expect(page.getByTestId('painel-aba')).not.toContainText('Conduta');
    await semViolacaoAxe(page, 'registro de 2021 (como emitido)');
    await page.getByTestId('aba-texto').click();
    await expect(page.getByTestId('texto-formatado')).toContainText('Dor torácica há 2 dias');
    await page.getByTestId('aba-respostas').click();
    await expect(page.getByTestId('painel-aba')).toContainText('Dor ao esforço: Sim');
    // Teclado nas abas.
    await page.getByTestId('aba-respostas').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('aba-contexto')).toBeFocused();
    await expect(page.getByTestId('contexto-ato')).toContainText('31337');
    await semViolacaoAxe(page, 'registro de 2021 (contexto)');

    // Registro de 2026: documento emitido com o cabeçalho congelado; retroativo e supervisão.
    await page.goto('/pep/prontuario/1003/registro/900006');
    await expect(page.getByTestId('painel-aba')).toContainText('Lançamento');
    await expect(page.getByTestId('marca-retroativo')).toBeVisible();
    await expect(page.getByTestId('marca-supervisao')).toBeVisible();
    await expect(page.getByTestId('aviso-icp')).toBeVisible();
    await expect(page.getByTestId('painel-aba')).not.toContainText('00000000191');
    await semViolacaoAxe(page, 'registro de 2026 (documento emitido)');

    // O suspenso: marca, data e justificativa; o histórico do documento mostra a suspensão.
    await page.goto('/pep/prontuario/1003/registro/900004');
    await expect(page.getByTestId('detalhe-suspenso')).toContainText('Lançado no paciente errado');
    await expect(page.getByTestId('eventos-documento')).toContainText('Suspenso');
    await semViolacaoAxe(page, 'registro suspenso');

    // Exceções do prontuário (regra 9): só contagens; "<5" abaixo de 5; nenhum paciente.
    await page.goto('/pep/prontuario');
    await page.getByTestId('link-excecoes').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Exceções do prontuário' })).toBeVisible();
    await expect(page.getByTestId('lista-excecoes')).toContainText('Sem conteúdo');
    await expect(page.getByTestId('lista-excecoes')).toContainText('<5');
    await expect(page.getByTestId('tela-excecoes-prontuario')).not.toContainText('CINTHYA');
    await semViolacaoAxe(page, '/pep/prontuario/excecoes');
    expect(externas).toEqual([]);
  });

  test('Auditor: vê as leituras no registro de acesso ao prontuário; o médico não', async ({ browser }) => {
    const medico = await (await browser.newContext()).newPage();
    await entrar(medico, 'SINT.MEDICO');
    await medico.goto('/administracao/auditoria/acessos-prontuario');
    await expect(medico).toHaveURL(/sem-permissao/);
    // Uma leitura do médico, para o Auditor ver.
    await medico.goto('/pep/prontuario/1001');
    await medico.getByRole('radio', { name: 'Auditoria de contas' }).check();
    await medico.getByTestId('confirmar-motivo').click();
    await expect(medico.getByTestId('lista-registros')).toBeVisible();

    const auditor = await (await browser.newContext()).newPage();
    await entrar(auditor, 'SINT.AUDITOR');
    await auditor.goto('/administracao/auditoria/acessos-prontuario');
    await expect(
      auditor.getByRole('heading', { level: 1, name: 'Registro de acesso ao prontuário' }),
    ).toBeVisible();
    await auditor.getByTestId('acessos-paciente').fill('1001');
    await auditor.getByTestId('acessos-aplicar').click();
    const lista = auditor.getByTestId('lista-acessos');
    await expect(lista).toContainText('SINT.MEDICO');
    await expect(lista).toContainText('Lista de registros');
    await expect(lista).toContainText('Auditoria de contas');
    await expect(lista).not.toContainText('JOSÉ DA SILVA');
    await expect(auditor.getByTestId('acessos-exportar')).toBeVisible();
    await semViolacaoAxe(auditor, '/administracao/auditoria/acessos-prontuario');
    // "Só os alertas ao Auditor" (o e-mail do alerta leva a este filtro): nenhuma leitura comum aparece.
    await auditor.getByTestId('acessos-so-alertas').check();
    await auditor.getByTestId('acessos-aplicar').click();
    await expect(auditor.getByText('Lista de registros')).toHaveCount(0);
    await semViolacaoAxe(auditor, 'registro de acesso (só alertas)');
  });
});
