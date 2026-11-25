// E2E @C1-119 (07-RH linha 171, SESMT): a leitura do dosímetro e a exposição a quimioterápico entram no prontuário
// ocupacional (NR-32; CNEN NN 3.01: a dose por período em mSv) → a dose do ano soma as parcelas → a leitura lançada por
// engano se cancela com motivo pelo tipo junto do id (fica na lista, sai da dose) → a leitura certa do mesmo período
// entra depois → a exposição a quimioterápico se cancela do mesmo jeito → recolher. Axe sem violação séria.
// Sessão real sobre a fonte sintética de dev; CPF e nomes SINTÉTICOS. O efeito no MariaDB está provado em
// apps/api/src/modulos/pessoas/sesmt/sesmt.int.spec.ts (caso "dosimetria e quimioterápico (C1-119)").
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
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, true, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, true, evidencia);
}

async function escolherColaborador(page: Page, nome: string): Promise<void> {
  const sel = page.getByTestId('seletor-colaborador');
  await entrada(sel.getByTestId('buscar-colaborador-termo')).fill(nome);
  await sel.getByTestId('buscar-colaborador').click();
  await sel
    .getByTestId('colaboradores-achados')
    .getByRole('button', { name: new RegExp(nome) })
    .first()
    .click();
  await expect(sel.getByRole('heading', { name: nome })).toBeVisible();
}

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a confirmação destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = true,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('C1-119: dosimetria e exposição a quimioterápico no prontuário ocupacional @C1-119', () => {
  test.setTimeout(300_000);

  test('ligar → admitir → leitura do dosímetro → cancelar com motivo → leitura certa → quimioterápico → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = br(new Date());
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const NOME = `TECNICA SINTETICA C119 ${sufixo}`;

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.sesmt')).toBeVisible({ timeout: 30_000 });
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E C1-119)');
    await ligar(page, 'pessoas.sesmt', 'Conferência sintética do SESMT (E2E C1-119)');

    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores');
    await page.getByTestId('abrir-admissao').click();
    await page.getByLabel('CPF', { exact: true }).fill(cpf(`9011907${sufixo.slice(-2)}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(NOME);
    await page.getByLabel('Data de admissão').fill(hoje);
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de radiologia');
    await page.getByLabel('Carga semanal (horas)').fill('24');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
    await page.getByLabel('Matrícula').fill(`E2E-C119-${sufixo}`);
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    await entrar(page, 'SINT.SESMT');
    await page.goto('/pessoas/sesmt/riscos');
    await escolherColaborador(page, NOME);
    const fe = page.getByTestId('form-registro-epi');
    const tabela = page.getByTestId('tabela-registros-epi');

    // A leitura do dosímetro (período de hoje) lançada com a dose errada.
    async function lerDosimetro(dose: string): Promise<void> {
      await fe.getByTestId('registro-epi-tipo').getByLabel('Leitura do dosímetro').check();
      await preencher(fe.getByTestId('registro-epi-inicio'), hoje);
      await preencher(fe.getByTestId('registro-epi-data'), hoje);
      await preencher(fe.getByTestId('registro-epi-dose'), dose);
      await preencher(fe.getByTestId('registro-epi-dosimetro'), `DOS-C119-${sufixo}`);
      await fe.getByTestId('registro-epi-gravar').click();
      await expect(page.getByTestId('sesmt-aviso')).toContainText('Leitura do dosímetro registrada.');
    }
    await lerDosimetro('3,5');
    await expect(page.getByTestId('dose-ano')).toContainText('3.5');
    const errada = tabela.locator('tr', { hasText: 'Leitura do dosímetro' }).first();
    await expect(errada).toContainText(`DOS-C119-${sufixo}`);
    await semViolacaoAxe(page, 'SESMT: leitura do dosímetro registrada');

    // O mesmo dosímetro e período não entra duas vezes enquanto a leitura está ativa.
    await fe.getByTestId('registro-epi-tipo').getByLabel('Leitura do dosímetro').check();
    await preencher(fe.getByTestId('registro-epi-inicio'), hoje);
    await preencher(fe.getByTestId('registro-epi-data'), hoje);
    await preencher(fe.getByTestId('registro-epi-dose'), '0,4');
    await preencher(fe.getByTestId('registro-epi-dosimetro'), `DOS-C119-${sufixo}`);
    await fe.getByTestId('registro-epi-gravar').click();
    await expect(page.getByText('Já há leitura deste dosímetro para o mesmo período')).toBeVisible();

    // Cancelar a leitura errada com motivo: fica na lista, com o motivo, e sai da dose do ano.
    await errada.getByRole('button', { name: 'Cancelar registro' }).click();
    await confirmarComMotivo(page, 'dlg-cancelar-epi', 'Leitura de outro dosímetro lançada por engano.');
    await expect(errada).toContainText('Leitura de outro dosímetro lançada por engano.');
    await expect(errada.getByRole('button', { name: 'Cancelar registro' })).toHaveCount(0);
    await expect(page.getByTestId('epi-historico')).toContainText('Cancelamento do registro');

    // A leitura certa do mesmo período entra depois do cancelamento.
    await lerDosimetro('0,4');
    await expect(page.getByTestId('dose-ano')).toContainText('0.4');
    await expect(page.getByTestId('dose-ano')).not.toContainText('3.5');

    // A exposição a quimioterápico entra e se cancela do mesmo jeito (o tipo vai junto do id).
    await fe.getByTestId('registro-epi-tipo').getByLabel('Exposição a quimioterápico').check();
    await preencher(fe.getByTestId('registro-epi-data'), hoje);
    await preencher(fe.getByTestId('registro-epi-agente'), 'Ciclofosfamida sintética');
    await preencher(fe.getByTestId('registro-epi-duracao'), '45');
    await fe.getByTestId('registro-epi-gravar').click();
    await expect(page.getByTestId('sesmt-aviso')).toContainText('Exposição registrada.');
    const quimio = tabela.locator('tr', { hasText: 'Ciclofosfamida sintética' }).first();
    await quimio.getByRole('button', { name: 'Cancelar registro' }).click();
    await confirmarComMotivo(page, 'dlg-cancelar-epi', 'Exposição lançada no colaborador errado.');
    await expect(quimio).toContainText('Exposição lançada no colaborador errado.');
    await semViolacaoAxe(page, 'SESMT: registros cancelados');

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await chave(page, 'pessoas.sesmt', false, 'Recolher o E2E C1-119 do SESMT');
    expect(externas).toEqual([]);
  });
});
