// F3.1 (02-CAD linha 5; fase 1): foto do paciente para a identificação positiva, pelo caminho da tela.
// A foto exige o banco próprio e a porta de arquivos, e o E2E roda com a fonte sintética (sem núcleo). Por isso as
// respostas da API destas rotas são simuladas pelo Playwright com massa SINTÉTICA (uma imagem PNG gerada no teste,
// sem pessoa); o que se prova é a tela: a captura por arquivo manda a foto em base64, a conferência manda o resultado
// e o ponto do fluxo, a dispensa manda o motivo e a revogação só sai com o motivo. O efeito no banco está no contrato
// de efeito (apps/api/src/modulos/cadastro/foto-identificacao.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 502;
/** PNG sintético de 1x1 pixel (nenhuma pessoa). */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

test.describe('F3.1 foto do paciente para a identificação positiva @C3-010', () => {
  test('capta a foto, confere a identidade, registra a dispensa e revoga com motivo', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let ativa: Record<string, unknown> | null = null;
    const conferencias: Record<string, unknown>[] = [];

    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/identificacao**`, (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/foto'))
          return r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') });
        return json(r, { baseLegal: 'lgpd_art11_ii_f_g', ativa, historico: [], conferencias });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/foto')) {
        ativa = {
          id: 71,
          situacao: 'ativa',
          capturadaEm: '2026-11-26T10:00:00.000Z',
          guardaAte: '2046-11-26',
          revogadaEm: null,
        };
        return json(r, { id: 71 }, 201);
      }
      if (url.pathname.endsWith('/revogar')) {
        ativa = null;
        return json(r, { id: 71 });
      }
      conferencias.unshift({
        id: conferencias.length + 1,
        ocorridaEm: '2026-11-26T10:05:00.000Z',
        contexto: corpo['contexto'],
        resultado: corpo['resultado'],
        motivoDispensa: corpo['motivoDispensa'],
        atendimento: null,
        usuario: 'SINT.ADMIN',
      });
      return json(r, { id: conferencias.length }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto(`/cadastros/pacientes/${PACIENTE}/identificacao`);
    await expect(page.getByTestId('fi-sem-foto')).toBeVisible();
    await expect(page.getByTestId('fi-base-legal')).toContainText('LGPD art. 11');

    // Captura por arquivo (a câmera não existe no navegador do teste).
    await page.getByTestId('pt-foto-arquivo').setInputFiles({
      name: 'sintetica.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1PX, 'base64'),
    });
    await expect(page.getByTestId('pt-foto-previa')).toBeVisible();
    await page.getByTestId('fi-gravar-foto').click();
    await expect(page.getByTestId('fi-foto')).toBeVisible();
    const captura = pedidos.find((p) => p.caminho.endsWith('/identificacao/foto'));
    expect(typeof captura?.corpo['conteudo']).toBe('string');
    expect(String(captura?.corpo['conteudo']).length).toBeGreaterThan(20);

    // Conferência pela foto, na recepção.
    await page.getByTestId('fi-registrar').click();
    await expect(page.getByTestId('fi-conferencias')).toContainText('Identidade confirmada pela foto');
    expect(pedidos.at(-1)?.corpo).toEqual({
      resultado: 'confirmada',
      contexto: 'recepcao',
      motivoDispensa: null,
    });

    // Dispensa na guia do convênio, com motivo.
    await escolher(page.getByLabel('Resultado'), { rotulo: 'Dispensada (conferida pelo documento)' });
    await escolher(page.getByLabel('Onde foi conferida'), { rotulo: 'Guia do convênio' });
    await page.getByTestId('fi-motivo-dispensa').fill('Paciente sem condição de comparar');
    await page.getByTestId('fi-registrar').click();
    await expect(page.getByTestId('fi-conferencias')).toContainText('Paciente sem condição de comparar');
    expect(pedidos.at(-1)?.corpo).toEqual({
      resultado: 'dispensada',
      contexto: 'guia',
      motivoDispensa: 'Paciente sem condição de comparar',
    });

    await semViolacaoAxe(page, 'foto e identificação do paciente');

    // Revogação: o botão só libera com o motivo.
    await expect(page.getByTestId('fi-revogar')).toBeDisabled();
    await page.getByTestId('fi-motivo-revogacao').fill('foto de outra pessoa');
    await page.getByTestId('fi-revogar').click();
    await expect(page.getByTestId('fi-sem-foto')).toBeVisible();
    expect(pedidos.at(-1)).toEqual({
      caminho: `/api/cadastros/pacientes/${PACIENTE}/identificacao/foto/revogar`,
      corpo: { motivo: 'foto de outra pessoa' },
    });
  });
});
