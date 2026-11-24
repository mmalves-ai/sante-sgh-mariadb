// E2E @F3.1 (ficha docs/fases/fichas/F3.1-cadastros.md): os fluxos principais das funções fechadas no marco de
// cadastros. Desfazer a unificação (02-CAD linha 7): a unificação é feita pela tela da fila (só a permissão do cargo),
// e no histórico do prontuário que ficou, "Desfazer unificação" pede o motivo (validação na hora) e a senha; o absorvido
// volta a ativo (conferido pela API de leitura) e a unificação desfeita continua no histórico, marcada, com motivo e
// responsável. Quem não tem a permissão não desfaz (403 com o id real da unificação). Sessão real sobre a fonte
// sintética, portas em MEMÓRIA (pacientes SINTÉTICOS); o efeito nos registros ligados ao paciente (itens, versão,
// tudo ou nada, registro alterado depois) é provado contra o banco próprio em
// apps/api/src/modulos/cadastro/porta-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}

test.describe('@F3.1 cadastros', () => {
  test.describe.configure({ timeout: 240_000 });

  test('unificar um par pela tela e desfazer pelo histórico, com motivo e senha', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/duplicidades');
    await page.getByTestId('botao-atualizar-fila').click();
    await expect(page.getByTestId('unificacao-motivo')).toContainText('Unificação liberada');
    const linhas = page.getByTestId('tabela-duplicidades').locator('tbody tr');
    await expect(linhas.first()).toBeVisible();
    const par = Number(((await linhas.first().getAttribute('data-testid')) ?? '').replace('par-', ''));
    const fila = (await (await page.request.get('/api/cadastros/pacientes/duplicidades')).json()) as {
      itens: { id: number; a: number; b: number }[];
    };
    const item = fila.itens.find((x) => x.id === par);
    expect(item).toBeTruthy();
    const [idAbsorvido, idSobrevivente] = [item!.a, item!.b];

    // Unificar pela tela: fica o lado b.
    await page.getByTestId(`comparar-${par}`).click();
    await page.getByTestId('botao-unificar').click();
    await expect(page.getByTestId('form-unificar')).toBeVisible();
    await page.getByTestId('fica-b').check();
    await page.getByTestId('justificativa-unificar').fill('Mesmo CPF e mesma mãe (teste)');
    await page.getByTestId('senha-unificar').fill(SENHA);
    await page.getByTestId('botao-confirmar-unificar').click();
    await expect(page.getByTestId('mensagem-fila')).toContainText('Prontuários unificados');

    const hist = (await (
      await page.request.get(`/api/cadastros/pacientes/${idSobrevivente}/historico`)
    ).json()) as { unificacoes: { id?: number; absorvido: number; situacao?: string }[] };
    const unif = hist.unificacoes.find((u) => u.absorvido === idAbsorvido && u.situacao === 'efetivada');
    expect(unif?.id).toBeGreaterThan(0);
    const idUnificacao = unif!.id!;
    expect(idUnificacao).not.toBe(idAbsorvido);

    await page.goto(`/cadastros/pacientes/${idSobrevivente}/historico`);
    await expect(page.getByTestId(`unificacao-${idUnificacao}`)).toBeVisible();
    await page.getByTestId(`desfazer-unificacao-${idUnificacao}`).click();
    await expect(page.getByTestId('form-desfazer-unificacao')).toBeVisible();
    await page.getByTestId('motivo-desfazer').fill('abc');
    await expect(page.getByTestId('botao-confirmar-desfazer')).toBeDisabled();
    await page.getByTestId('motivo-desfazer').fill('Eram pessoas diferentes: documentos conferidos');
    await page.getByTestId('senha-desfazer').fill(SENHA);
    await semViolacaoAxe(page, 'desfazer unificação');
    await page.getByTestId('botao-confirmar-desfazer').click();
    await expect(page.getByTestId('mensagem-desfazer')).toContainText(`prontuário ${idAbsorvido} está ativo`);
    // A desfeita continua no histórico, marcada, com o motivo; sem o botão de desfazer.
    await expect(page.getByTestId(`unificacao-${idUnificacao}`)).toHaveAttribute(
      'data-situacao',
      'revertida',
    );
    await expect(page.getByTestId(`unificacao-desfeita-${idUnificacao}`)).toContainText(
      'Eram pessoas diferentes: documentos conferidos',
    );
    await expect(page.getByTestId(`desfazer-unificacao-${idUnificacao}`)).toHaveCount(0);
    // O absorvido está ativo de novo (API de leitura da ficha).
    const ficha = (await (await page.request.get(`/api/cadastros/pacientes/${idAbsorvido}`)).json()) as {
      unificadoEm: number | null;
    };
    expect(ficha.unificadoEm).toBeNull();
    // O par volta à fila aberta.
    await page.goto('/cadastros/pacientes/duplicidades');
    await expect(page.getByTestId(`par-${par}`)).toBeVisible();
    expect(externas).toEqual([]);

    // Quem não tem a permissão de unificar: 403 também para desfazer (id real da unificação).
    await entrar(page, 'SINT.RECEPCAO');
    const r = await page.request.post(`/api/cadastros/pacientes/unificacoes/${idUnificacao}/desfazer`, {
      headers: { 'x-csrf': await csrf(page) },
      data: { motivo: 'Tentativa sem a permissão', senha: SENHA },
    });
    expect(r.status()).toBe(403);
  });
});
