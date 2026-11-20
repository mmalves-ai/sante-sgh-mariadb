// Utilidades do E2E do M07: preferências antes de carregar, axe e vigia de requisições externas.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

/** Origem do servidor do E2E (E2E_PORTAS troca a porta da web; ver playwright.config.ts). */
export const ORIGEM = `http://127.0.0.1:${/^(\d{4,5}):/.exec(process.env['E2E_PORTAS'] ?? '')?.[1] ?? '5300'}`;

export type Combinacao = { tema: 'claro' | 'escuro'; densidade: 'compacta' | 'confortavel' };
export const COMBINACOES: readonly Combinacao[] = [
  { tema: 'claro', densidade: 'compacta' },
  { tema: 'claro', densidade: 'confortavel' },
  { tema: 'escuro', densidade: 'compacta' },
  { tema: 'escuro', densidade: 'confortavel' },
];

/** Grava as preferências no navegador antes de a página carregar (a casca lê com try/catch). */
export async function usarPreferencias(page: Page, c: Combinacao): Promise<void> {
  await page.addInitScript((p) => {
    window.localStorage.setItem('sgh.preferencias.v1', JSON.stringify({ ...p, fonteAmpliada: false }));
  }, c);
}

/** Toda requisição que não seja do próprio servidor local (ou data:/blob:) é externa e falha o teste. */
export function vigiarExternas(page: Page): string[] {
  const externas: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGEM) && !u.startsWith('data:') && !u.startsWith('blob:'))
      externas.push(new URL(u).host);
  });
  return externas;
}

export async function semViolacaoAxe(page: Page, rotulo: string): Promise<void> {
  // Espera as transições de cor do tema terminarem antes do axe (lição da sonda do OpenVue).
  await page.waitForTimeout(600);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(
    `[axe ${rotulo}] violações: ${r.violations.map((v) => `${v.id}(${v.impact ?? '?'})`).join(', ') || 'nenhuma'}`,
  );
  for (const g of graves)
    for (const n of g.nodes.slice(0, 3)) console.log(`   ${g.id}: ${n.target.join(' ')}`);
  expect(
    graves.map((v) => v.id),
    rotulo,
  ).toEqual([]);
}

/** O menu principal da casca. */
export function menuPrincipal(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Menu principal' });
}

/** Abre todas as áreas e níveis do menu (eles começam recolhidos; só a área da tela atual vem aberta). */
export async function abrirMenuInteiro(page: Page): Promise<void> {
  const fechados = menuPrincipal(page).locator('button[aria-expanded="false"]');
  while ((await fechados.count()) > 0) await fechados.first().click();
}

/** Busca no menu (abre as áreas com resultado) e devolve o link do item com esse nome. */
export async function itemDoMenu(page: Page, nome: string): Promise<Locator> {
  await menuPrincipal(page).getByRole('searchbox', { name: 'Buscar no menu' }).fill(nome);
  return menuPrincipal(page).getByRole('link', { name: nome, exact: true });
}
