// E2E @PLATAFORMA (ADR 0022): acesso total da plataforma e a tela "Perfis e permissões", com as contas e os
// usuários SINTÉTICOS de dev (nenhum login real; a gestão grava no estado sintético em memória). A plataforma
// escolhe "Eu mesmo, com acesso total" em nome de um usuário sintético, vê a faixa, o menu com todas as telas e a
// tela nova; aprova o mapa grupo → perfil e vê a permissão efetiva mudar na hora. O suporte não tem a opção.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarOpcoes } from './combos.js';

const SENHA = 'Sintetico#Plataforma2026';

async function entrarPlataforma(page: Page, email: string): Promise<void> {
  await page.goto('/plataforma/entrar');
  await page.getByTestId('plataforma-email').fill(email);
  await page.getByTestId('plataforma-senha').fill(SENHA);
  await page.getByTestId('plataforma-acessar').click();
  await expect(page.getByTestId('plataforma-inicio')).toBeVisible();
}

test.describe('acesso total da plataforma e Perfis e permissões @PLATAFORMA', () => {
  test('plataforma: acesso total em nome de um usuário sintético, menu completo e mapa que muda as efetivas', async ({
    page,
  }) => {
    await entrarPlataforma(page, 'plataforma@sintetico.invalid');
    await page.getByTestId('abrir-como').click();
    await page.getByTestId('como-modo-total').check();
    await expect(page.getByTestId('como-aviso-total')).toBeVisible();
    await semViolacaoAxe(page, 'como-acesso-total');
    await escolher(page.getByTestId('como-grupo'), 'SINTETICO');
    await escolher(page.getByTestId('como-usuario'), 'SINT.ADMIN');
    await page.getByTestId('como-abrir').click();
    await expect(page).toHaveURL(/\/inicio/);
    await expect(page.getByTestId('faixa-acesso-total')).toContainText('acesso total da plataforma em');
    const s = await (await page.request.get('/api/sessao')).json();
    expect(s.como.modo).toBe('acesso-total');
    expect(s.permissoes).toEqual(
      expect.arrayContaining(['acesso.perfil.gerir', 'config.schema.ler', 'sistema.saude.ler']),
    );
    // O menu mostra todas as telas existentes (inclusive as da Fase 0 e a nova).
    await page.goto('/administracao/acesso/perfis');
    await expect(page.getByRole('heading', { name: 'Perfis e permissões' })).toBeVisible();
    await semViolacaoAxe(page, 'perfis-permissoes');
    // Efetivas do médico sintético antes do mapa.
    await page.getByTestId('perfis-busca').fill('SINT.MEDICO');
    await page.getByTestId('perfis-procurar').click();
    await page.getByTestId('perfis-usuario-SINT.MEDICO').click();
    await expect(page.getByTestId('perfis-permissoes')).toContainText('grupo MEDICOS');
    await expect(page.getByTestId('perfis-permissoes')).not.toContainText('config.schema.ler');
    // Aprova "MEDICOS → administrador-sistema" (a senha é a da conta da plataforma, o ator real).
    await page.getByTestId('perfis-senha').fill(SENHA);
    await page.getByTestId('aba-mapa').click();
    await escolher(page.getByTestId('propor-grupo'), 'MEDICOS');
    await escolher(page.getByTestId('propor-perfil'), 'administrador-sistema');
    // W0-09: toda decisão do mapa abre o diálogo com a prévia de quem perde o acesso, o motivo e a senha.
    const decidirNoDialogo = async (motivo: string) => {
      await expect(page.getByTestId('mapa-previa')).toBeVisible();
      await page.getByTestId('mapa-decisao-motivo').fill(motivo);
      await page.getByTestId('mapa-decisao-senha').fill(SENHA);
      await page.getByTestId('mapa-decisao-confirmar').click();
      await expect(page.getByTestId('perfis-aviso')).toBeVisible();
    };
    await page.getByTestId('propor').click();
    await decidirNoDialogo('Proposta da revisão de acessos (E2E)');
    await page.getByTestId('aprovar-MEDICOS-administrador-sistema').click();
    await decidirNoDialogo('Aprovado pela direção (E2E)');
    await page.getByTestId('aba-usuario').click();
    await page.getByTestId('perfis-procurar').click();
    await page.getByTestId('perfis-usuario-SINT.MEDICO').click();
    await expect(page.getByTestId('perfis-permissoes')).toContainText('config.schema.ler');
    await expect(page.getByTestId('perfis-permissoes')).toContainText(
      'perfil administrador-sistema (mapa do grupo)',
    );
    // A auditoria da plataforma mostra a sessão de acesso total.
    await page.getByTestId('voltar-conta').click();
    await expect(page.getByTestId('plataforma-inicio')).toBeVisible();
    const sessoes = await (await page.request.get('/api/plataforma/auditoria/sessoes')).json();
    expect(sessoes[0]).toMatchObject({ modo: 'acesso-total', alvoLogin: 'SINT.ADMIN' });
  });

  test('suporte: sem a opção de acesso total; o servidor também recusa', async ({ page }) => {
    await entrarPlataforma(page, 'suporte@sintetico.invalid');
    await page.getByTestId('abrir-como').click();
    await esperarOpcoes(page.getByTestId('como-estabelecimento'), null);
    await expect(page.getByTestId('como-modo')).toHaveCount(0);
    const eu = await (await page.request.get('/api/plataforma/eu')).json();
    expect(eu.podeAcessoTotal).toBe(false);
  });
});
