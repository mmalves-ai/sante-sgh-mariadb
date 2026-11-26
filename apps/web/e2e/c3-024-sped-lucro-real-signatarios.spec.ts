// E2E C3-024 (07-FIN linha 126): SPED contábil com a ECF do lucro real e os signatários do cadastro. Com o SPED ligado
// (o administrador liga a contabilidade e a chave do SPED, se outro cenário ainda não ligou), o contador abre a geração da ECF, vê o lucro real
// entre as formas geradas (a opção vem do apoio do servidor sem a marca de não gerada, e o formulário não mostra o aviso
// de forma não gerada), confere que os signatários do cadastro da empresa preenchem o formulário quando existem e o
// aviso de que ficam guardados no cadastro. Axe sem violação séria. Sessão e empresa SINTÉTICAS (nenhuma pessoa real).
// O exercício sintético não fecha (meses abertos, conta sem referencial: ver M54.3), então a prévia real impede gerar e
// o formulário não aparece; o cenário prova primeiro esse impedimento real e só então simula a resposta da PRÉVIA sem
// impedimentos. O apoio (formas geradas), os signatários do cadastro e a permissão de gerar vêm do servidor de verdade;
// a geração em si (blocos L, M e N, guarda dos signatários) está provada na integração e na HTTP.
import { expect, type Page, test } from '@playwright/test';
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

async function chave(page: Page, recurso: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)', { timeout: 30_000 });
}
/** Registra a conferência e liga o recurso (se outro cenário já o ligou, segue). */
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, evidencia);
}

test.describe('@C3-024 SPED: ECF do lucro real e signatários do cadastro', () => {
  test('a forma lucro real é gerada e o formulário avisa da guarda dos signatários', async ({ page }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'contabil', 'Competência sintética conferida com o escritório (E2E C3-024)');
    await ligar(page, 'contabil.sped', 'Decisão sintética da controladoria (E2E C3-024)');

    await entrar(page, 'SINT.CONTADOR');
    await page.goto('/contabil/sped');
    await expect(page.getByTestId('sped-ver-previa')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('sped-tipo'), { rotulo: 'ECF (Escrituração Contábil Fiscal)' });
    await page.getByTestId('sped-ver-previa').click();
    // A prévia real do exercício sintético impede gerar: sem formulário.
    await expect(page.getByTestId('sped-impedimentos')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sped-gerar')).toHaveCount(0);

    // A prévia simulada sem impedimentos (só ela: o resto segue o servidor).
    await page.route(/\/api\/contabil\/sped\/previa(\?.*)?$/, (rota) => {
      const q = new URL(rota.request().url()).searchParams;
      return rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          empresa: Number(q.get('empresa')),
          tipo: q.get('tipo'),
          exercicio: Number(q.get('exercicio')),
          leiaute: 'simulado',
          impedimentos: [],
          avisos: [],
          podeGerar: true,
          registros: [],
          linhas: 0,
        }),
      });
    });
    await page.reload();
    await expect(page.getByTestId('sped-ver-previa')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('sped-tipo'), { rotulo: 'ECF (Escrituração Contábil Fiscal)' });
    await page.getByTestId('sped-ver-previa').click();
    await expect(page.getByTestId('sped-gerar')).toBeVisible({ timeout: 30_000 });

    // O rótulo exato "1 Lucro real" só existe quando o servidor diz que a forma é gerada.
    await escolher(page.getByTestId('sped-forma'), { rotulo: '1 Lucro real' });
    await expect(page.getByTestId('sped-forma-nao-gerada')).toHaveCount(0);
    await expect(page.getByTestId('sped-guardar-signatarios')).toContainText('cadastro da empresa');
    // Sem cadastro, os dois signatários ficam para digitar; com cadastro, o aviso diz quantos vieram.
    const doCadastro = page.getByTestId('sped-signatarios-cadastro');
    if ((await doCadastro.count()) > 0) await expect(doCadastro).toContainText('cadastro da empresa');
    else await expect(page.getByTestId('sped-signatario-1')).toBeVisible();
    await semViolacaoAxe(page, '/contabil/sped (geração da ECF do lucro real)');
  });
});
