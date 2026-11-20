// E2E @M59.2 (ficha do M59, etapa 2, F2 senhas, segundo fator e identidade), com axe: primeiro login pela senha antiga
// com a regravação na credencial forte, cadastro do segundo fator na segurança da conta (código calculado do segredo
// mostrado na tela, como o aplicativo autenticador faria), login com o código; a vista "Senhas e segundo fator" dos
// usuários; a política (onda 1 de uma vez, prazo zero) recusando o perfil crítico sem segundo fator e a volta a
// opcional. Sessões reais sobre a fonte sintética; a identidade em memória (porta-identidade-sintetica.ts): nada na
// cópia. Contas sintéticas SINT.IDENT, SINT.IDENT.CRITICO (grupo MASTER) e SINT.GESTOR (gestor de acessos).
import { createHmac } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

/** RFC 6238 (SHA-1, 6 dígitos, passo de 30 s): o que o aplicativo autenticador mostraria. */
function totp(base32: string, agoraMs: number): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alfabeto.indexOf(ch);
    if (v < 0) throw new Error('chave fora do base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(agoraMs / 30_000)));
  const h = createHmac('sha1', bytes).update(contador).digest();
  const d = h[h.length - 1]! & 0xf;
  const n = ((h[d]! & 0x7f) << 24) | (h[d + 1]! << 16) | (h[d + 2]! << 8) | h[d + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

async function preencherEntrada(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
}

async function novaPagina(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m59-2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

/** Volta tudo a opcional (as linhas em vigor da política), para o servidor do E2E seguir como estava. */
async function encerrarPoliticas(gestor: Page): Promise<void> {
  const r = await gestor.request.get('/api/acesso/identidade/politica-2fa');
  if (!r.ok()) return;
  const linhas = (await r.json()) as { id: string; encerradaEm: string | null }[];
  for (const l of linhas.filter((x) => !x.encerradaEm)) {
    await postar(gestor, `/api/acesso/identidade/politica-2fa/${l.id}/encerrar`, {
      dados: { motivo: 'Fim do roteiro E2E do M59.2' },
      senha: SENHA,
    });
  }
}

test.describe('Senhas, segundo fator e identidade @M59.2 @fase7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('primeiro login com rehash, cadastro do segundo fator e login com o código; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    // 1. Primeiro login: a senha antiga confere e a credencial forte é gravada (sem nada na tela).
    await preencherEntrada(page, 'SINT.IDENT');
    await expect(page).toHaveURL(/\/inicio/);

    // 2. Segurança da conta: QR e chave, o primeiro código certo ativa.
    await page.goto('/preferencias/seguranca');
    await expect(page.getByTestId('seguranca-situacao-fator')).toContainText('Não cadastrado');
    await page.getByTestId('seguranca-cadastrar').click();
    await expect(page.getByTestId('seguranca-qr')).toBeVisible();
    const chave = (await page.getByTestId('seguranca-chave').innerText()).trim();
    expect(chave.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{16,}$/);
    await semViolacaoAxe(page, '/preferencias/seguranca (cadastro, M59.2)');
    await page.getByTestId('seguranca-codigo').fill(totp(chave, Date.now()));
    await page.getByTestId('seguranca-confirmar').click();
    await expect(page.getByTestId('seguranca-situacao-fator')).toContainText('Ativo');
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/preferencias/seguranca (ativo, M59.2)');

    // 3. Novo login: agora pela credencial forte; o servidor pede o código, o errado é recusado, o certo entra.
    const outra = await novaPagina(browser);
    await preencherEntrada(outra, 'SINT.IDENT');
    await expect(outra.getByTestId('campo-2fa')).toBeVisible();
    await expect(outra.getByTestId('erro-entrar')).toBeVisible();
    await expect(outra).toHaveURL(/\/entrar/);
    const certo = totp(chave, Date.now());
    await outra.getByTestId('campo-2fa').fill(certo === '000000' ? '111111' : '000000');
    await outra.getByTestId('botao-entrar').click();
    await expect(outra.getByTestId('erro-entrar')).toBeVisible();
    await expect(outra).toHaveURL(/\/entrar/);
    // O passo seguinte (o anterior pode já ter sido usado na confirmação).
    const espera = 30_000 - (Date.now() % 30_000) + 500;
    await outra.waitForTimeout(espera);
    await outra.getByTestId('campo-2fa').fill(totp(chave, Date.now()));
    await outra.getByTestId('botao-entrar').click();
    await expect(outra).toHaveURL(/\/inicio/);
    await semViolacaoAxe(outra, '/entrar com o segundo fator (M59.2)');
    expect(externas).toEqual([]);
  });

  test('vista Senhas e segundo fator dos usuários: credencial forte e fator ativo; axe', async ({ page }) => {
    await preencherEntrada(page, 'SINT.GESTOR');
    await expect(page).toHaveURL(/\/inicio/);
    await page.goto('/administracao/acesso/usuarios?vista=identidade');
    await expect(page.getByTestId('identidade-resumo')).toBeVisible();
    await expect(page.getByTestId('identidade-senha-de-SINT.IDENT')).toContainText('Credencial forte');
    await expect(page.getByTestId('identidade-fator-de-SINT.IDENT')).toContainText('Ativo');
    await expect(page.getByTestId('identidade-fator-de-SINT.IDENT.CRITICO')).toContainText('Não cadastrado');
    // A contingência ligada (padrão): retirar a senha antiga não aparece.
    await expect(page.getByTestId('identidade-retirar-SINT.IDENT')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    await semViolacaoAxe(page, '/administracao/acesso/usuarios?vista=identidade (M59.2)');
  });

  test('política: onda 1 com prazo zero recusa o perfil crítico sem segundo fator; volta a opcional; axe', async ({
    page,
    browser,
  }) => {
    await preencherEntrada(page, 'SINT.GESTOR');
    await expect(page).toHaveURL(/\/inicio/);
    try {
      // Pela interface (correção da revisão): da vista Senhas e segundo fator, o link para a política.
      await page.goto('/administracao/acesso/usuarios?vista=identidade');
      await page.getByTestId('identidade-ir-politica-2fa').click();
      await expect(page).toHaveURL(/\/administracao\/acesso\/2fa/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await semViolacaoAxe(page, '/administracao/acesso/2fa (vazia, M59.2)');
      await page.getByTestId('politica-abrir-onda1').click();
      await expect(page.getByTestId('form-politica-onda1')).toBeVisible();
      // Início hoje (a tela sugere amanhã) e prazo zero: obrigatório já.
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const inicio = page.getByTestId('form-politica-onda1').getByLabel('Início', { exact: true });
      await inicio.fill(hoje);
      await inicio.press('Enter');
      await page.getByTestId('onda1-prazo').fill('0');
      await page.getByTestId('onda1-motivo').fill('Onda 1 do roteiro E2E');
      await page.getByTestId('onda1-senha').fill(SENHA);
      await page.getByTestId('onda1-confirmar').click();
      await expect(page.getByTestId('tabela-politica-2fa')).toBeVisible();
      await expect(page.getByTestId('tabela-politica-2fa').locator('tbody tr')).toHaveCount(15);
      // A onda 1 abrange o grupo MASTER (o do usuário crítico).
      await semViolacaoAxe(page, '/administracao/acesso/2fa (onda 1, M59.2)');

      // O grupo MASTER sem segundo fator, com o prazo vencido: o login é recusado com o texto próprio.
      const critico = await novaPagina(browser);
      await preencherEntrada(critico, 'SINT.IDENT.CRITICO');
      await expect(critico.getByTestId('erro-entrar')).toBeVisible();
      await expect(critico).toHaveURL(/\/entrar/);
      await semViolacaoAxe(critico, '/entrar recusado sem segundo fator (M59.2)');

      // Voltar a opcional pela tela: encerrar a linha do grupo MASTER.
      const linhas = (await (await page.request.get('/api/acesso/identidade/politica-2fa')).json()) as {
        id: string;
        alvo: string;
        valor: string | null;
      }[];
      const master = linhas.find((l) => l.alvo === 'grupo' && l.valor === 'MASTER');
      expect(master).toBeTruthy();
      await page.getByTestId(`politica-encerrar-${master!.id}`).click();
      await expect(page.getByTestId('form-politica-encerrar')).toBeVisible();
      await page.getByTestId('encerrar-motivo').fill('Volta a opcional no roteiro E2E');
      await page.getByTestId('encerrar-senha').fill(SENHA);
      await page.getByTestId('encerrar-confirmar').click();
      await expect(page.getByTestId(`politica-encerrar-${master!.id}`)).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);

      // Sem a linha do grupo, o crítico entra de novo.
      await preencherEntrada(critico, 'SINT.IDENT.CRITICO');
      await expect(critico).toHaveURL(/\/inicio/);
    } finally {
      await encerrarPoliticas(page);
    }
  });
});
