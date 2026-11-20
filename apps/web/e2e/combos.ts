// Combos do E2E (ADR 0027): o SanteSelecao é o Select do OpenVue, com a busca embutida na lista. Os testes
// escolhem como o usuário: abrem a lista e clicam na opção (nada de selectOption, que só serve a <select>
// nativo; o portão `combos` recusa selectOption e locator('select') nos E2E).
// O `campo` pode ser o invólucro (getByTestId do SanteSelecao) ou o próprio combobox (getByLabel/getByRole).
import { type Locator, expect } from '@playwright/test';

export type Escolha = string | { readonly rotulo: string | RegExp } | { readonly indice: number };

function caixaDe(campo: Locator): Locator {
  return campo.locator('xpath=self::*[@role="combobox"] | .//*[@role="combobox"]').first();
}

/** Invólucro do SanteSelecao (onde mora o data-valor), a partir do invólucro ou do combobox. */
function involucroDe(campo: Locator): Locator {
  return campo.locator('xpath=ancestor-or-self::*[contains(concat(" ", @class, " "), " sgh-selecao ")][1]');
}

/** Abre a lista do combo e devolve o painel (anexado ao body pelo OpenVue). */
export async function abrirCombo(campo: Locator): Promise<Locator> {
  const caixa = caixaDe(campo);
  if ((await caixa.getAttribute('aria-expanded')) !== 'true') await caixa.click();
  await expect(caixa).toHaveAttribute('aria-expanded', 'true');
  const lista = caixa.page().locator(`#${await caixa.getAttribute('aria-controls')}`);
  await expect(lista).toBeVisible();
  return lista;
}

/**
 * Escolhe uma opção: pelo valor (texto; null/vazio é ''), pelo rótulo ou pela posição (0 = primeira).
 * Em lista com busca, o rótulo é digitado na caixa embutida antes de clicar (lista longa não rola às cegas).
 */
export async function escolher(campo: Locator, escolha: Escolha): Promise<void> {
  const lista = await abrirCombo(campo);
  let opcao: Locator;
  if (typeof escolha === 'string') {
    opcao = lista.locator(`[role="option"]:has([data-valor="${escolha.replace(/"/g, '\\"')}"])`);
  } else if ('indice' in escolha) {
    opcao = lista.getByRole('option').nth(escolha.indice);
  } else {
    // A busca mora no painel desta lista (nunca a página inteira: a busca do menu lateral também é searchbox).
    const busca = lista
      .locator('xpath=ancestor::*[@data-pc-section="overlay"][1]')
      .locator('input[role="searchbox"]');
    if (typeof escolha.rotulo === 'string' && (await busca.count()) > 0) await busca.fill(escolha.rotulo);
    opcao = lista.getByRole('option', { name: escolha.rotulo, exact: typeof escolha.rotulo === 'string' });
  }
  await opcao.first().click();
  await expect(caixaDe(campo)).toHaveAttribute('aria-expanded', 'false');
}

/** Valor atual do combo ('' para vazio/nulo), para trocar `toHaveValue`. */
export async function esperarValor(campo: Locator, valor: string): Promise<void> {
  await expect(involucroDe(campo)).toHaveAttribute('data-valor', valor);
}

/** Fecha a lista com Escape e espera o painel sair (reabrir durante a animação de saída pega opção solta). */
export async function fecharCombo(campo: Locator, lista?: Locator): Promise<void> {
  const caixa = caixaDe(campo);
  const painel = lista ?? caixa.page().locator(`#${await caixa.getAttribute('aria-controls')}`);
  await caixa.press('Escape');
  await expect(caixa).toHaveAttribute('aria-expanded', 'false');
  await expect(painel).toBeHidden();
}

/** Rótulos das opções do combo (abre e fecha a lista), para trocar `locator('option')`. */
export async function rotulosDoCombo(campo: Locator): Promise<string[]> {
  const lista = await abrirCombo(campo);
  const rotulos = (await lista.getByRole('option').allInnerTexts()).map((r) => r.trim());
  await fecharCombo(campo, lista);
  return rotulos;
}

/** Quantidade de opções do combo (para trocar `locator('option')).toHaveCount(n)`); `null` = pelo menos uma. */
export async function esperarOpcoes(campo: Locator, quantas: number | null): Promise<void> {
  const contar = async () => (await rotulosDoCombo(campo)).length;
  if (quantas === null) await expect.poll(contar).toBeGreaterThan(0);
  else await expect.poll(contar).toBe(quantas);
}
