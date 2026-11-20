// E2E de fumaça @M60.3-instalado (ficha do M60, seção 6: "contra a instância instalada, implantacao:verificar verde e
// um E2E de fumaça (login e uma consulta ao vivo)"). Roda só pela configuração playwright.instalado.config.ts, contra o
// endereço HTTPS do servidor instalado (E2E_INSTALADO_URL), com a conta técnica de sonda (E2E_SONDA_LOGIN e
// E2E_SONDA_SENHA, as mesmas do SONDA_LOGIN e SONDA_SENHA do sante.env) e o segredo das sondas (E2E_SONDA_TOKEN). Nada
// é gravado: entra pela tela, vê o início, confere que não abre telas de administração nem de paciente, lê as
// consultas ao vivo pela sonda (banco, painel de leitos e recusa de gravação) e sai.
import { expect, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

function exigir(nome: string): string {
  const v = process.env[nome] ?? '';
  if (!v) throw new Error(`Defina ${nome} (ver deploy/ubuntu/ensaio/ensaiar.sh fumaca-e2e).`);
  return v;
}

test.describe('Fumaça da instância instalada @M60.3-instalado', () => {
  test.setTimeout(120_000);

  test('login pela tela, consulta ao vivo pela sonda, sem acesso a paciente, sair; axe', async ({ page }) => {
    const login = exigir('E2E_SONDA_LOGIN');
    const senha = exigir('E2E_SONDA_SENHA');
    const token = exigir('E2E_SONDA_TOKEN');

    // A página e a API pelo HTTPS do nginx, com a versão do pacote.
    const versao = await page.request.get('/api/versao');
    expect(versao.status()).toBe(200);
    const esperada = process.env['E2E_VERSAO_ESPERADA'];
    if (esperada) expect(JSON.stringify(await versao.json())).toContain(esperada);

    await page.goto('/entrar');
    await semViolacaoAxe(page, '/entrar (instância instalada)');
    await page.getByTestId('campo-login').fill(login);
    await page.getByTestId('campo-senha').fill(senha);
    const entrada = page.waitForResponse(
      (r) => r.url().endsWith('/api/sessao') && r.request().method() === 'POST',
    );
    await page.getByTestId('botao-entrar').click();
    // Entrou: a sessão abre (a conta de sonda não tem tela nenhuma; a casca diz isso, sem erro).
    expect([200, 201]).toContain((await entrada).status());
    await expect(page.locator('body')).toContainText('Nenhuma tela disponível para o seu perfil ainda.');
    expect((await page.request.get('/api/sessao')).status()).toBe(200);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);

    // A conta de sonda não vê administração nem paciente.
    await page.goto('/administracao/saude/fumaca');
    await expect(page.getByTestId('tela-fumaca-servidor')).toHaveCount(0);
    expect((await page.request.get('/api/administracao/implantacao/fumaca')).status()).toBe(403);

    // Consulta ao vivo: as sondas leem o banco do estabelecimento agora (banco, painel de leitos, recusa de gravação).
    const r = await page.request.get('/api/sistema/sonda', { headers: { 'x-sonda-token': token } });
    expect(r.status()).toBe(200);
    const corpo = (await r.json()) as { pronta?: boolean; sondas?: { sonda?: string; ok?: boolean }[] };
    const sondas = corpo.sondas ?? [];
    expect(sondas.map((s) => s.sonda)).toEqual(
      expect.arrayContaining(['saude', 'versao', 'login-sonda', 'painel-leitos', 'recusa-negocio']),
    );
    expect(sondas.filter((s) => s.ok !== true).map((s) => s.sonda)).toEqual([]);
    expect(corpo.pronta).toBe(true);

    // A fumaça do servidor pela sonda (a mesma da tela), sem sessão.
    const f = await page.request.get('/api/sistema/sonda/fumaca', { headers: { 'x-sonda-token': token } });
    expect(f.status()).toBe(200);

    // Sair pela tela: a sessão deixa de existir no servidor. A conta que ainda não aceitou o termo de uso vê o termo
    // (texto corrido, nunca os códigos do RTF) e sai por ele enquanto o aceite não está liberado (manual, seção 11.6).
    await page.goto('/inicio');
    await expect(page.getByTestId('menu-usuario')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const termo = page.getByTestId('dialogo-termo');
    if (await termo.isVisible().catch(() => false)) {
      await expect(page.getByTestId('texto-termo')).not.toContainText(/\\rtf|\\par|fonttbl/);
      await page.getByTestId('sair-termo').click();
    } else {
      await page.getByTestId('menu-usuario').click();
      await page.getByTestId('sair').click();
    }
    await expect(page).toHaveURL(/\/entrar/);
    expect((await page.request.get('/api/sessao')).status()).toBe(401);
  });
});
