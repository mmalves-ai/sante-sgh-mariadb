// E2E @M22 (ficha, seção 10): o médico abre "meus rascunhos", acha o paciente, escolhe o modelo EVAM, digita,
// salva o rascunho, tenta finalizar sem o obrigatório (a pendência leva ao campo), responde, finaliza e vê o
// registro com a prova conferida; suspende com justificativa e senha e registra a correção ligada ao original; o
// formulário cabe no tablet sem rolagem
// lateral; o administrador do PEP consulta os modelos; axe sem violação séria. Sessão real sobre a fonte sintética
// de dev e a porta do registro em MEMÓRIA (modelos e pacientes SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Registro clínico nos modelos do formulário @M22 @fase2', () => {
  test('médico: rascunho, pendência, finalização com prova e suspensão; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/rascunhos');
    await expect(page.getByTestId('tela-rascunhos')).toBeVisible();
    await semViolacaoAxe(page, '/pep/rascunhos');
    await page.getByTestId('busca-paciente-registro').fill('cinthya');
    await page.getByTestId('busca-paciente-registro').press('Enter');
    await page.getByTestId('registro-paciente-1003').getByRole('link').click();

    await expect(page.getByTestId('tela-escolha-modelo')).toBeVisible();
    // O liberado é um link; o que não pode ser registrado aparece com o motivo.
    await expect(page.getByTestId('modelo-EVAM').getByRole('link')).toBeVisible();
    await semViolacaoAxe(page, 'escolha do modelo');
    await page.getByTestId('modelo-EVAM').getByRole('link').click();

    await expect(page.getByTestId('tela-registro-clinico')).toBeVisible();
    await expect(page.getByTestId('form-renderer')).toBeVisible();
    await semViolacaoAxe(page, 'formulário EVAM');
    await page.getByRole('textbox', { name: /Exame físico/ }).fill('Exame SINTETICO sem alterações');
    await page.getByTestId('salvar-rascunho').click();
    await expect(page.getByTestId('mensagem-registro')).toContainText('Rascunho salvo');

    // Sem o obrigatório: a lista de pendências, e o botão da pendência leva ao campo.
    await page.getByTestId('finalizar-registro').click();
    const pend = page.getByTestId('pendencias');
    await expect(pend).toContainText('responder Quadro clínico');
    await pend.getByRole('button', { name: /Quadro clínico/ }).click();
    const quadro = page.getByRole('textbox', { name: /Quadro clínico/ });
    await expect(quadro).toBeFocused();
    await quadro.fill('Quadro SINTETICO estável');
    await expect(pend).toHaveCount(0);
    await page.getByTestId('finalizar-registro').click();

    await expect(page).toHaveURL(/\/pep\/1003\/registro\/\d+\?finalizado=1/);
    await expect(page.getByTestId('registro-finalizado')).toBeVisible();
    await expect(page.getByTestId('prova-registro')).toContainText('Conteúdo conferido');
    await expect(page.getByTestId('form-renderer')).toContainText('Quadro SINTETICO estável');
    await semViolacaoAxe(page, 'registro gravado');

    // Suspensão: justificativa e senha (operação crítica); o original continua visível, marcado.
    await page.getByTestId('suspender-registro').click();
    await page.getByLabel(/Justificativa \(de 10 a 200/).fill('Registro SINTETICO no paciente errado');
    await page.getByLabel('Sua senha (confirmação da suspensão)').fill(SENHA);
    await page.getByRole('button', { name: 'Suspender', exact: true }).click();
    await expect(page.getByTestId('registro-suspenso-ok')).toBeVisible();
    await expect(page.getByTestId('marca-suspenso')).toBeVisible();
    await expect(page.getByTestId('form-renderer')).toContainText('Quadro SINTETICO estável');

    // Correção: do registro suspenso, o mesmo modelo ligado ao original (como o legado).
    await page.getByTestId('corrigir-registro').click();
    await expect(page.getByTestId('aviso-correcao')).toBeVisible();
    await page.getByRole('textbox', { name: /Quadro clínico/ }).fill('Quadro SINTETICO corrigido');
    await page.getByTestId('finalizar-registro').click();
    await expect(page).toHaveURL(/\/pep\/1003\/registro\/\d+\?finalizado=1/);
    await expect(page.getByTestId('registro-corrige')).toBeVisible();
    await semViolacaoAxe(page, 'correção gravada');
    expect(externas).toEqual([]);
  });

  test('tablet: o formulário cabe na largura (sem rolagem lateral) e o teclado percorre os campos', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/1003/registro/M10');
    await expect(page.getByTestId('form-renderer')).toBeVisible();
    const larguras = await page.evaluate(() => ({
      conteudo: document.documentElement.scrollWidth,
      janela: document.documentElement.clientWidth,
    }));
    expect(larguras.conteudo).toBeLessThanOrEqual(larguras.janela);
    // O Sim/Não "Não" desabilita a data (regra convertida), que mantém o valor e avisa.
    await page.getByRole('radio', { name: 'Não' }).check();
    await expect(page.getByText('Desabilitado pela resposta de outro campo')).toBeVisible();
    // Teclado: do Sim/Não, o Tab segue para o próximo controle do formulário (a ordem é a da árvore).
    await page.getByRole('radio', { name: 'Sim' }).focus();
    await page.keyboard.press('Tab');
    const dentro = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="form-renderer"]') !== null,
    );
    expect(dentro).toBe(true);
    await semViolacaoAxe(page, 'formulário M10 (tablet)');
  });

  test('administrador do PEP: modelos com a conversão e a pré-visualização; axe', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/pep/admin/modelos');
    await expect(page.getByTestId('tabela-modelos')).toContainText('EVAM');
    await semViolacaoAxe(page, '/pep/admin/modelos');
    await page.getByRole('button', { name: /^Ver M10/ }).click();
    await expect(page.getByTestId('detalhe-modelo')).toContainText('convertida');
    await expect(page.getByTestId('detalhe-modelo').getByTestId('form-renderer')).toBeVisible();
    await page.goto('/pep/admin/impressao');
    await expect(page.getByTestId('tela-admin-impressao')).toBeVisible();
    await semViolacaoAxe(page, '/pep/admin/impressao');
  });
});
