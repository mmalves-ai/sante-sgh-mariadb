// E2E @W0-06 (programa CRUD completo; parte 1: escala e regime): liga a escala e o cadastro → o RH admite um
// colaborador sintético novo → a gestora cria o regime, atribui e ANULA a vigência com motivo (o histórico mostra a
// anulada) → cria a escala de apoio em rascunho com um plantão e a EXCLUI com motivo (o botão só confirma com 10
// caracteres; a escala some da lista) → cria outra, publica e a CANCELA com motivo (estado "Cancelada", o aviso com quem
// e o motivo, a trilha da escala) → recolher. Axe sem violação séria nas telas e nos diálogos.
// Sessão real sobre a fonte sintética de dev; gestão de pessoas e escala em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, test, type Page } from '@playwright/test';
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

async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.escala')).toBeVisible({ timeout: 30_000 });
}
async function prerequisito(page: Page, recurso: string, evidencia: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
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

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a confirmação destrutiva pergunta. */
async function confirmarComMotivo(page: Page, testid: string, motivo: string): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  // A variante destrutiva pergunta antes (SanteBotao): confirma.
  await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('W0-06 (parte 1): exclusão do rascunho, cancelamento da escala e anulação do regime @W0-06', () => {
  test.setTimeout(360_000);

  test('ligar → admitir → regime atribuído e anulado → rascunho excluído → publicada cancelada → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const dia = (d: number) => `${p2(d)}/${p2(prox.getMonth() + 1)}/${prox.getFullYear()}`;
    const sufixo = Date.now().toString(36).slice(-5);
    const nome = `MAQUEIRO SINTETICO W006 ${sufixo.toUpperCase()}`;

    await abrirLiberacao(page);
    await prerequisito(page, 'pessoas.escala', 'Conferência sintética da coordenação (E2E W0-06)');
    await chave(page, 'pessoas.escala', true, 'Escala sintética do E2E W0-06');
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06)');
    await chave(page, 'pessoas.colaborador', true, 'Colaborador sintético do E2E W0-06');

    // O RH admite um colaborador novo (sem profissional, sem login).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page
      .getByLabel('CPF', { exact: true })
      .fill(cpf(`9006060${String(Date.now() % 100).padStart(2, '0')}`));
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(hoje));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Maqueiro');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // Regime atribuído por engano → anulado com motivo (fica no histórico, riscado, com o motivo).
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/regimes');
    const fr = page.getByTestId('form-regime');
    await expect(fr).toBeVisible({ timeout: 30_000 });
    await fr.getByLabel('Sigla (ex.: 12x36)').fill(`W6-${sufixo.slice(-4)}`);
    await fr.getByLabel('Nome', { exact: true }).fill(`Regime W0-06 ${sufixo}`);
    await escolher(fr.getByTestId('regime-jornada'), { rotulo: 'Escalonada' });
    await fr.getByLabel('Descanso mínimo entre jornadas (horas)').fill('11');
    await fr.getByLabel('Limite semanal de horas (fora do tempo parcial)').fill('44');
    await page.getByTestId('gravar-regime').click();
    await expect(page.getByTestId('regimes-resultado')).toContainText('Regime incluído.');
    const at = page.getByTestId('bloco-atribuir-regime');
    await at.getByLabel('Buscar colaborador (nome ou matrícula)').fill(sufixo.toUpperCase());
    await at.getByRole('button', { name: 'Buscar' }).click();
    await escolher(at.getByTestId('regime-colaborador'), { indice: 0 });
    await escolher(at.getByTestId('regime-escolhido'), { rotulo: new RegExp(`Regime W0-06 ${sufixo}`) });
    await at.getByLabel('Vale a partir de').fill(br(hoje));
    await at.getByLabel('Vale a partir de').press('Tab');
    await page.getByTestId('atribuir-regime').click();
    await expect(page.getByTestId('vigencias')).toContainText('SINT.ESCALA');
    await page.getByTestId('vigencias').getByRole('button', { name: 'Anular' }).first().click();
    await confirmarComMotivo(page, 'dialogo-anular-vigencia', 'Regime atribuído ao colaborador errado (E2E)');
    await expect(page.getByTestId('vigencias')).toContainText('anulado em');
    await expect(page.getByTestId('vigencias')).toContainText('Regime atribuído ao colaborador errado (E2E)');
    await semViolacaoAxe(page, '/pessoas/regimes (vigência anulada)');

    // Escala de apoio em rascunho com um plantão → excluída com motivo.
    const nova = async (setor: string) => {
      await page.goto('/pessoas/escala');
      const fe = page.getByTestId('form-nova-escala');
      await expect(fe).toBeVisible({ timeout: 30_000 });
      await escolher(fe.getByTestId('nova-unidade'), { rotulo: 'Unidade sintética' });
      await escolher(fe.getByTestId('nova-tipo'), { rotulo: /apoio/i });
      await fe.getByLabel('Setor (opcional)').fill(setor);
      await page.getByTestId('criar-escala').click();
      await expect(page.getByTestId('tela-grade-escala')).toBeVisible({ timeout: 30_000 });
      const fi = page.getByTestId('form-incluir-plantao');
      await fi.getByLabel('Buscar colaborador (nome ou matrícula)').fill(sufixo.toUpperCase());
      await fi.getByRole('button', { name: 'Buscar' }).click();
      await escolher(fi.getByTestId('incluir-colaborador'), { indice: 0 });
      await fi.getByLabel('Dia do início').fill(dia(2));
      await fi.getByLabel('Dia do início').press('Tab');
      await page.getByTestId('incluir-plantao').click();
      await expect(page.getByTestId('escala-resultado')).toContainText('Plantão incluído.');
    };
    const setorA = `Apoio W006 A ${sufixo}`;
    await nova(setorA);
    await expect(page.getByTestId('cancelar-escala')).toHaveCount(0);
    await page.getByTestId('excluir-escala').click();
    await confirmarComMotivo(page, 'dialogo-excluir-escala', 'Escala criada no setor errado (E2E)');
    await expect(page).toHaveURL(/\/pessoas\/escala$/, { timeout: 30_000 });
    await expect(page.getByText(setorA)).toHaveCount(0);

    // Outra escala: publicada → cancelada com motivo (não some: fica "Cancelada", com quem e o motivo).
    await nova(`Apoio W006 B ${sufixo}`);
    const just = page.getByLabel('Justificativa da publicação com turnos abaixo do mínimo');
    if (await just.isVisible().catch(() => false)) await just.fill('Cobertura mínima sintética (E2E W0-06)');
    await page.getByTestId('publicar-escala').click();
    await expect(page.getByTestId('grade-estado')).toContainText('Publicada');
    await expect(page.getByTestId('excluir-escala')).toHaveCount(0);
    await page.getByTestId('cancelar-escala').click();
    await confirmarComMotivo(page, 'dialogo-cancelar-escala', 'Setor fechado para reforma (E2E)');
    await expect(page.getByTestId('grade-estado')).toContainText('Cancelada');
    await expect(page.getByTestId('escala-cancelada')).toContainText('Setor fechado para reforma (E2E)');
    await expect(page.getByTestId('evento-cancelada')).toContainText('Setor fechado para reforma (E2E)');
    await expect(page.getByTestId('form-incluir-plantao')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/escala/:id (cancelada)');

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.escala', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06');
    expect(externas).toEqual([]);
  });
});
