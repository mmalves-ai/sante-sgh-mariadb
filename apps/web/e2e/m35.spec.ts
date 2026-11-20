// E2E @M35 (ficha, seções 7, 10 e 11): a aba "Prontidão por setor" da tela de testes de assinatura (o relatório
// versionado em docs/prontidao/prontidao.json: os setores por onda, a proposta das ondas 0 e 1, o Serrano em
// bloqueio), a revisão das telas da coexistência (schema, assinaturas, gravação, conexões com a carga somada,
// estabelecimentos e matriz) e o ensaio de recolhimento de uma liberação na tela de funcionalidades (ligar para um
// setor e recolher na hora, cap-15 §15.3.2). Sessão sintética de dev; funcionalidades em MEMÓRIA (nada vai à cópia);
// axe sem violação séria em cada tela.
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

test.describe('Consolidação da semana e prontidão por setor @M35', () => {
  test('prontidão por setor: aba da tela de assinaturas, setores por onda, proposta e o Serrano em bloqueio; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await page.goto('/administracao/coexistencia/assinaturas');
    await expect(page.getByTestId('abas-assinaturas')).toBeVisible();
    await page.getByTestId('aba-prontidao').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/prontidao$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Prontidão por setor' })).toBeVisible();
    await expect(page.getByTestId('prontidao-gerado')).toContainText('Operações liberadas: 0');
    await expect(page.getByTestId('proposta-onda0')).toContainText('Consultas para diretoria');
    await expect(page.getByTestId('proposta-onda1')).toContainText('Agendamento e call center');
    // O veredito vem do relatório versionado (docs/prontidao/prontidao.json): desde o M38 (M32 e M33 integrados), o
    // faturamento está pronto com ressalvas; a onda 3 tem os quatro setores do M41 e a onda 4 os nove do M42.
    await expect(page.getByTestId('setor-faturamento-convenio').getByTestId('veredito')).toHaveText(
      'pronto para homologar, com ressalvas',
    );
    await expect(page.getByTestId('setor-farmacia-central')).toBeVisible();
    await expect(page.getByTestId('setor-glosa-recurso')).toBeVisible();
    await expect(page.getByTestId('itens-agendamento')).toContainText('Aceite do chave-usuário');
    await page.getByTestId('fora-agendamento').locator('summary').click();
    await expect(page.getByTestId('fora-agendamento')).toContainText('agenda.agendarSemProntuario');
    await expect(page.getByTestId('prontidao-publico')).toContainText('Médico');
    await semViolacaoAxe(page, '/administracao/coexistencia/prontidao (pc)');
    await escolher(page.getByTestId('filtro-hospital'), 'hs');
    await expect(page.getByTestId('prontidao-bloqueio')).toContainText('HS-1');
    await expect(page.getByTestId('proposta-onda0')).toContainText('nenhum setor');
    await semViolacaoAxe(page, '/administracao/coexistencia/prontidao (hs)');
    await page.getByTestId('aba-operacoes').click();
    await expect(page.getByTestId('tabela-assinaturas')).toBeVisible();
    expect(externas).toEqual([]);
  });

  test('revisão das telas da coexistência: schema, gravação, conexões com a carga somada, estabelecimentos e matriz; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    for (const rota of [
      '/administracao/coexistencia/schema',
      '/administracao/coexistencia/gravacao',
      '/administracao/coexistencia/conexoes',
      '/administracao/coexistencia/estabelecimentos',
      '/administracao/coexistencia/matriz',
    ]) {
      await page.goto(rota);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (rota.endsWith('/conexoes')) {
        await expect(page.getByTestId('painel-carga')).toBeVisible();
        await expect(page.getByTestId('painel-carga')).toContainText('Carga somada');
      }
      await semViolacaoAxe(page, rota);
    }
    expect(externas).toEqual([]);
  });

  test('ensaio de recolhimento: ligar uma funcionalidade para um setor e recolher na hora; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Funcionalidades por estabelecimento' }),
    ).toBeVisible();
    await page.getByTestId('abrir-licitacao').click();
    const form = page.getByTestId('form-liberacao');
    await escolher(form.getByTestId('liberacao-escopo'), 'setor');
    await form.getByTestId('liberacao-valores').fill('35');
    await form.getByLabel('Justificativa').fill('Ensaio sintético de recolhimento');
    await form.getByTestId('liberacao-senha').fill(SENHA);
    await form.getByTestId('liberacao-aplicar').click();
    await expect(page.getByTestId('mensagem-liberacao')).toContainText('1 chave(s) alterada(s)');
    // Recolher: a reversão do lote devolve o estado de antes (o setor volta para o que usava, sem perder nada).
    await form.getByTestId('liberacao-senha').fill(SENHA);
    await form.getByTestId('liberacao-reverter').click();
    await expect(page.getByTestId('mensagem-liberacao')).toContainText(/revertid/i);
    await expect(form.getByTestId('liberacao-reverter')).toHaveCount(0);
    await semViolacaoAxe(page, '/administracao/liberacao (recolhida)');
  });
});
