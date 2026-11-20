// E2E @W0-06 (programa CRUD completo; parte 3a-3: colaborador e dependente): liga o cadastro de colaboradores → o RH
// admite um colaborador sintético → na ficha, CORRIGE o cadastro (nome e matrícula) com motivo obrigatório (gravar fica
// desabilitado sem motivo de 10 caracteres) e o histórico "Correções e alterações" mostra o valor anterior e o novo →
// inclui um dependente e o ALTERA com versão (a partir de hoje, passa a contar no imposto de renda), com motivo; a linha
// mostra "Vale desde" e o histórico guarda o antes e o depois → recolher. Axe sem violação séria na ficha e nos diálogos.
// Sessão real sobre a fonte sintética de dev; gestão de pessoas em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const p2 = (x: number) => String(x).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
}

async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  if ((await page.getByTestId(`recurso-${recurso}`).innerText()).includes('Ligada')) return;
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chave(page, recurso, true, evidencia);
}
async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.colaborador')).toBeVisible({ timeout: 30_000 });
}

test.describe('W0-06 (parte 3a-3): correção do colaborador e versão do dependente @W0-06', () => {
  test.setTimeout(300_000);

  test('ligar → admitir → corrigir cadastro com motivo → dependente: incluir e alterar com versão → histórico → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = br(new Date());
    const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
    const nome = `TECNICA W006 CORR ${sufixo}`;
    const corrigido = `TECNICA W006 CORRIGIDA ${sufixo}`;
    const dependente = `FILHA W006 ${sufixo}`;
    const fim2 = String(Date.now() % 100).padStart(2, '0');

    await abrirLiberacao(page);
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06 3a-3)');

    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(cpf(`9006063${fim2}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(hoje);
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
    await page.getByLabel('Matrícula').fill(`W6-${sufixo}`);
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();
    await page.getByTestId('abrir-ficha-admitido').click();
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    await expect(page.getByTestId('ficha-correcoes')).toContainText('Nenhuma correção cadastral');

    // Correção cadastral: o motivo é obrigatório; o valor anterior fica no histórico.
    await page.getByTestId('abrir-correcao').click();
    const fc = page.getByTestId('form-correcao');
    await expect(fc).toBeVisible();
    await preencher(fc.getByTestId('correcao-nome'), corrigido);
    await preencher(fc.getByTestId('correcao-matricula'), `W6C-${sufixo}`);
    await preencher(fc.getByTestId('correcao-motivo'), 'curto');
    await expect(page.getByTestId('correcao-gravar')).toBeDisabled();
    await preencher(fc.getByTestId('correcao-motivo'), 'Nome digitado errado na admissão (E2E W0-06)');
    await semViolacaoAxe(page, 'diálogo da correção cadastral');
    await page.getByTestId('correcao-gravar').click();
    await expect(page.getByTestId('aviso-ficha')).toContainText('Cadastro corrigido');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(corrigido);
    const hist = page.getByTestId('ficha-correcoes');
    await expect(hist).toContainText('Cadastro corrigido');
    await expect(hist).toContainText(`Nome: ${nome} → ${corrigido}`);
    await expect(hist).toContainText(`Matrícula: W6-${sufixo} → W6C-${sufixo}`);
    await expect(hist).toContainText('Nome digitado errado na admissão (E2E W0-06)');

    // Dependente: inclusão e alteração com versão (passa a contar no imposto de renda a partir de hoje).
    await page.getByTestId('abrir-dependente').click();
    const fd = page.getByTestId('form-dependente');
    await fd.getByLabel('Nome completo').fill(dependente);
    await fd.getByLabel('Nascimento').fill('10/05/2020');
    await fd.getByLabel('Nascimento').press('Tab');
    await escolher(page.getByTestId('dependente-parentesco'), { rotulo: /^Filho\(a\) ou enteado\(a\)$/ });
    await page.getByTestId('dependente-gravar').click();
    const linha = page.getByTestId('ficha-dependentes').locator('tr', { hasText: dependente });
    await expect(linha).toBeVisible();
    await linha.getByRole('button', { name: 'Alterar' }).click();
    const fa = page.getByTestId('form-alterar-dependente');
    await expect(fa).toContainText('versão nova');
    await expect(entrada(fa.getByTestId('alterar-dependente-desde'))).toHaveValue(hoje);
    await fa.getByTestId('alterar-dependente-ir').check();
    await preencher(fa.getByTestId('alterar-dependente-motivo'), 'curto');
    await expect(page.getByTestId('alterar-dependente-gravar')).toBeDisabled();
    await preencher(
      fa.getByTestId('alterar-dependente-motivo'),
      'Declaração de dependente para o IR entregue (E2E W0-06)',
    );
    await semViolacaoAxe(page, 'diálogo da alteração do dependente');
    await page.getByTestId('alterar-dependente-gravar').click();
    await expect(page.getByTestId('aviso-ficha')).toContainText('Dependente alterado');
    await expect(page.getByTestId('ficha-dependentes').locator('tr', { hasText: dependente })).toContainText(
      hoje,
    );
    await expect(hist).toContainText('Dependente alterado');
    await expect(hist).toContainText('Imposto de renda: Não → Sim');
    await expect(hist).toContainText(`Vale desde: — → ${hoje}`);
    await expect(hist).toContainText('Declaração de dependente para o IR entregue (E2E W0-06)');
    await semViolacaoAxe(page, 'ficha com correções');

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06 3a-3');
    expect(externas).toEqual([]);
  });
});
