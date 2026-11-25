// C1-077 (05-SADT linha 10): o aviso clínico chega à central de avisos (o sino) de quem o recebe. Fonte sintética; a
// rota dos avisos clínicos é simulada (no ambiente em memória ela responde 503 e a seção some), e o contrato de efeito
// da leitura e da ciência no banco está em apps/api/src/modulos/acesso/avisos-clinicos-propria.int.spec.ts.
// Prova: o selo soma o aviso clínico novo; a seção "Avisos clínicos" mostra o título e a mensagem; o link leva aos
// exames do paciente; a ciência num clique manda só o id (sem corpo) e o aviso passa a "Ciente"; axe.
import { expect, type Page, type Route, test } from '@playwright/test';
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

const aviso = (estado: 'novo' | 'ciente') => ({
  id: 77,
  aviso: 7,
  titulo: 'Resultado de exame retificado',
  mensagem:
    'O resultado de POTÁSSIO SINTETICO que você já tinha visto foi retificado. Motivo: erro de transcrição',
  gravidade: 'atencao',
  modulo: 'sadt.resultado',
  link: '/pep/paciente/1001/exames',
  estado,
  geradoEm: '2026-11-25T10:00:00',
});

test.describe('@C1-077 avisos clínicos na central de avisos', () => {
  test('o destinatário vê o aviso da retificação no sino, abre os exames e dá ciência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let estado: 'novo' | 'ciente' = 'novo';
    const ciencias: { url: string; corpo: unknown }[] = [];
    await page.route(/\/api\/acesso\/avisos-clinicos$/, (rota: Route) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avisos: [aviso(estado)], novos: estado === 'novo' ? 1 : 0 }),
      }),
    );
    await page.route(/\/api\/acesso\/avisos-clinicos\/\d+\/ciente$/, async (rota: Route) => {
      ciencias.push({ url: new URL(rota.request().url()).pathname, corpo: rota.request().postDataJSON() });
      estado = 'ciente';
      await rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 77, gravou: true }),
      });
    });

    await entrar(page, 'SINT.MEDICO');
    await expect(page.getByTestId('sino')).toBeVisible();
    await expect(page.getByTestId('sino-selo')).toBeVisible();
    await page.getByTestId('sino').click();
    await expect(page.getByTestId('avisos-clinicos')).toBeVisible();
    await expect(page.getByTestId('aviso-clinico-77')).toContainText('Resultado de exame retificado');
    await expect(page.getByTestId('aviso-clinico-77')).toContainText('Novo');
    await expect(page.getByTestId('aviso-clinico-mensagem-77')).toContainText('Motivo: erro de transcrição');
    await semViolacaoAxe(page, '/inicio (central de avisos com aviso clínico)');

    await page.getByTestId('aviso-clinico-ciente-77').click();
    await expect(page.getByTestId('aviso-clinico-77')).toContainText('Ciente');
    await expect(page.getByTestId('aviso-clinico-ciente-77')).toHaveCount(0);
    expect(ciencias).toEqual([{ url: '/api/acesso/avisos-clinicos/77/ciente', corpo: {} }]);

    await page.getByTestId('aviso-clinico-abrir-77').click();
    await expect(page).toHaveURL(/\/pep\/paciente\/1001\/exames/);
    await expect(page.getByTestId('central-avisos')).toBeHidden();

    expect(externas).toEqual([]);
  });
});
