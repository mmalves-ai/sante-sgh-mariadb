// C1-048 (04-INT linha 74) @C1-048: declaração de óbito, do formulário numerado ao cancelamento pelo responsável técnico.
//  1. Formulários numerados da declaração de óbito (controles da internação): o lote é conferido na hora (final menor
//     que o inicial recusa e desabilita o recebimento; a quantidade aparece antes de gravar) e o recebimento envia o
//     intervalo. Promovido do rascunho do F78.04-1 (só a parte dos formulários).
//  2. Cancelamento por terceiro (CFM Res. 1.779/2005): o diretor clínico abre a aba de alta do paciente com a
//     declaração emitida por outro médico, escreve o motivo, confirma com a senha e a aba volta sem o óbito.
// Nada é gravado na base do E2E: o paciente sintético 1001 é de dezenas de specs vizinhas (ver o cabeçalho de
// c1-029-obito-bloqueia-entrada.spec.ts); as gravações e as releituras são respostas simuladas pelo Playwright. O que
// fica no banco está nos contratos de efeito apps/api/src/modulos/adt/controles-assistenciais-propria.int.spec.ts
// (formulários) e apps/api/src/modulos/pep/documentos-propria-pareceres.int.spec.ts (cancelamento por terceiro:
// motivo, evento com o usuário de quem cancelou, documento fora de vigência e trilha marcada). Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  const campo = page.getByTestId('campo-login');
  await campo.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => page.reload());
  await campo.fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('@C1-048 declaração de óbito @fase7', () => {
  test.describe.configure({ timeout: 240_000 });

  test('formulários numerados: lote conferido na hora e recebido; axe', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/internacao/controles/formularios-obito**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/internacao\/controles\//, '');
      if (req.method() === 'GET') {
        if (caminho !== 'formularios-obito') return rota.fallback();
        return json(rota, {
          itens: [
            {
              id: 1,
              numero: '00012345',
              lote: 'L-SINT',
              recebidoEm: '2026-11-01',
              orgao: null,
              situacao: 'disponivel',
              declaracao: null,
              utilizadoEm: null,
              motivo: null,
              versao: 1,
            },
          ],
          resumo: {
            porSituacao: { disponivel: 1, utilizado: 0, cancelado: 0, extraviado: 0, devolvido: 0 },
            viasADevolver: 0,
            estoqueBaixo: true,
          },
          declaracoesSemFormulario: 0,
        });
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === 'formularios-obito/lotes') return json(rota, { quantidade: 3, primeiro: 2 }, 201);
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/controles/formularios-obito');
    await expect(page.getByTestId('obito-resumo')).toContainText('Disponíveis 1');
    await page.getByTestId('obito-inicial').fill('00000004');
    await page.getByTestId('obito-final').fill('00000002');
    await expect(page.getByTestId('obito-lote-problema')).toContainText('menor que o inicial');
    await expect(page.getByTestId('obito-receber')).toBeDisabled();
    await page.getByTestId('obito-inicial').fill('00000002');
    await page.getByTestId('obito-final').fill('00000004');
    await expect(page.getByTestId('obito-lote-quantidade')).toContainText('3 formulário');
    await semViolacaoAxe(page, '/internacao/controles/formularios-obito');
    await page.getByTestId('obito-receber').click();
    await expect(page.getByTestId('controles-aviso')).toContainText('Lote recebido: 3');
    expect(pedidos.at(-1)).toMatchObject({
      caminho: 'formularios-obito/lotes',
      corpo: { inicial: '00000002', final: '00000004' },
    });
  });

  test('o diretor clínico cancela a declaração emitida por outro médico, com motivo e senha; axe', async ({
    page,
  }) => {
    let cancelada = false;
    let corpoCancelamento: Record<string, unknown> | null = null;
    await entrar(page, 'SINT.MEDICO');
    await page.route(`**/api/pep/paciente/${PACIENTE}/alta/obito/cancelar`, (rota) => {
      if (rota.request().method() !== 'POST') return rota.fallback();
      corpoCancelamento = (rota.request().postDataJSON() ?? {}) as Record<string, unknown>;
      cancelada = true;
      return json(rota, { id: 9_048_001, documento: 9_048_002, deOutroMedico: true });
    });
    await page.route(new RegExp(`/api/pep/paciente/${PACIENTE}/alta(\\?.*)?$`), async (rota) => {
      if (rota.request().method() !== 'GET') return rota.fallback();
      const real = await rota.fetch();
      const corpo = (await real.json()) as Record<string, unknown>;
      if (cancelada) return json(rota, { ...corpo, obito: null });
      return json(rota, {
        ...corpo,
        obito: { id: 9_048_001, em: '2026-11-20T13:00:00.000Z', numero: '90004801', documento: 9_048_002 },
        obitoAcao: { pode: false, motivo: 'O óbito do paciente já foi registrado.' },
        cancelarObitoAcao: { pode: true, motivo: null },
      });
    });
    await page.goto(`/pep/paciente/${PACIENTE}/alergias`);
    await page.getByTestId('aba-alta').click();
    await expect(page.getByTestId('aba-alta-conteudo')).toContainText('Óbito registrado em');
    const form = page.getByTestId('form-cancelar-obito');
    await expect(form).toBeVisible();
    // Validação na hora: motivo curto não libera o cancelamento.
    await page.getByTestId('cancelar-obito-motivo').fill('curto');
    await expect(page.getByTestId('cancelar-obito')).toBeDisabled();
    await page.getByTestId('cancelar-obito-motivo').fill('Causa básica SINTETICA registrada na linha errada');
    await form.locator('input[type=password]').fill(SENHA);
    await semViolacaoAxe(page, 'cancelamento da declaração de óbito por terceiro');
    await page.getByTestId('cancelar-obito').click();
    await page.getByTestId('confirmacao').getByRole('button').last().click();
    await expect(page.getByTestId('aba-alta-conteudo')).toContainText('Declaração de óbito cancelada.');
    expect(corpoCancelamento).toMatchObject({ motivo: 'Causa básica SINTETICA registrada na linha errada' });
    await expect(page.getByTestId('aba-alta-conteudo')).not.toContainText('Óbito registrado em');
  });
});
