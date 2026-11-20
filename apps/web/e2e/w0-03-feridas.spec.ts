// E2E @W0-03 (mercado M4, critério 12): feridas e lesão por pressão pela tela.
//   - a enfermeira abre as feridas pelo atalho da tela dos escores, escolhe a UTI e registra a LPP adquirida (estágio,
//     medidas, finalizada): a tela mostra a origem e a sugestão de notificar ao NSP;
//   - corrige a ficha finalizada (só com a justificativa; a versão 1 fica tachada e legível no histórico);
//   - registra o curativo (a evolução) e o corrige com a justificativa (o anterior fica tachado);
//   - anexa a foto (o arquivo vai ao prontuário como anexo de imagem; a lesão guarda a referência) e a desvincula com
//     motivo e senha (fica tachada);
//   - encerra o acompanhamento (desfecho e hora);
//   - a lesão lançada errada é inativada pelo autor com o motivo e a senha e fica visível, tachada;
//   - a incidência de LPP imprime o numerador e o denominador.
// axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Paciente sintético da UTI (as lesões são só deste spec).
const ATENDIMENTO = 25102;
// PNG de 1×1 (foto sintética).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function idDe(lesao: Locator): Promise<number> {
  return Number((await lesao.getAttribute('data-testid'))!.replace('fe-lesao-', ''));
}

async function inativar(page: Page, motivo: string): Promise<void> {
  await expect(page.getByTestId('fe-dialogo-inativar')).toBeVisible();
  await page.getByTestId('fe-dialogo-inativar-motivo').fill(motivo);
  await page.getByTestId('fe-dialogo-inativar-senha').fill(SENHA);
  await page.getByTestId('fe-dialogo-inativar-confirmar').click();
}

test.describe('Feridas e lesão por pressão @W0-03 @crud', () => {
  test.setTimeout(300_000);

  test('registrar a LPP, corrigir a ficha, curativo e correção, foto, encerrar, inativar a errada e a incidência', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    // O caminho pela interface: o atalho da tela dos escores (a entrada de menu é do W4-01).
    await page.goto('/enfermagem/escores');
    await page.getByTestId('es-atalho-feridas').click();
    await expect(page).toHaveURL(/\/enfermagem\/feridas/);
    await expect(page.getByTestId('tela-feridas')).toBeVisible();
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const cartao = page.getByTestId(`fe-paciente-${ATENDIMENTO}`);
    await expect(cartao).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/feridas');

    // A LPP adquirida, finalizada: o estágio é obrigatório na LPP.
    await page.getByTestId(`fe-registrar-${ATENDIMENTO}`).click();
    await expect(page.getByTestId('fe-dialogo-ficha')).toBeVisible();
    await expect(page.getByTestId('fe-ficha-confirmar')).toBeDisabled();
    await escolher(page.getByTestId('fe-estagio'), 'estagio2');
    await page.getByTestId('fe-ficha-comprimento').fill('3');
    await page.getByTestId('fe-ficha-largura').fill('2');
    await escolher(page.getByTestId('fe-cobertura'), 'hidrocoloide');
    await semViolacaoAxe(page, '/enfermagem/feridas (ficha)');
    await page.getByTestId('fe-ficha-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('ficha finalizada');
    const lesao = cartao.locator('article[data-testid^="fe-lesao-"]').first();
    const id = await idDe(lesao);
    await expect(page.getByTestId(`fe-origem-${id}`)).toContainText('Adquirida');
    await expect(page.getByTestId(`fe-nsp-${id}`)).toContainText('Núcleo de Segurança do Paciente');
    await expect(lesao).toContainText('6 cm²');

    // A correção da ficha finalizada: só com a justificativa; a versão 1 fica tachada no histórico.
    await page.getByTestId(`fe-versao-${id}`).click();
    await expect(page.getByTestId('fe-dialogo-ficha')).toBeVisible();
    await escolher(page.getByTestId('fe-estagio'), 'estagio3');
    await expect(page.getByTestId('fe-ficha-confirmar')).toBeDisabled();
    await page
      .getByTestId('fe-motivo')
      .fill('Reavaliada com a coordenação: perda de pele em espessura total');
    await page.getByTestId('fe-ficha-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toBeVisible();
    await page.getByTestId(`fe-historico-${id}`).click();
    await expect(page.getByTestId(`fe-versao-lida-${id}-1`)).toHaveClass(/tachado/);
    await expect(page.getByTestId(`fe-versao-lida-${id}-2`)).toContainText('espessura total');

    // O curativo (a evolução) e a correção dele pelo autor.
    await page.getByTestId(`fe-curativo-${id}`).click();
    await expect(page.getByTestId('fe-dialogo-curativo')).toBeVisible();
    await page.getByTestId('fe-curativo-comprimento').fill('2.5');
    await page.getByTestId('fe-curativo-largura').fill('2');
    await semViolacaoAxe(page, '/enfermagem/feridas (curativo)');
    await page.getByTestId('fe-curativo-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('Curativo registrado');
    const curativo = page
      .getByTestId(`fe-hist-${id}`)
      .locator('[data-testid^="fe-corrigir-curativo-"]')
      .first();
    await curativo.click();
    await expect(page.getByTestId('fe-dialogo-curativo')).toBeVisible();
    await page.getByTestId('fe-curativo-largura').fill('1.5');
    await expect(page.getByTestId('fe-curativo-confirmar')).toBeDisabled();
    await page.getByTestId('fe-curativo-motivo').fill('Largura medida com a régua errada');
    await page.getByTestId('fe-curativo-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('Curativo corrigido');
    const curativos = page.getByTestId(`fe-hist-${id}`).locator('[data-testid^="fe-curativo-lido-"]');
    await expect(curativos).toHaveCount(2);
    await expect(curativos.filter({ has: page.locator('.tachado') })).toHaveCount(1);
    await expect(page.getByTestId(`fe-hist-${id}`)).toContainText('régua errada');

    // A foto: o arquivo vai ao prontuário e a lesão guarda a referência; depois, desvinculada com motivo e senha.
    // O anexo do prontuário (rota do PEP, coberta pelo E2E do M23) só conhece os pacientes sintéticos do PEP em
    // memória: aqui a rota é interceptada para provar o que a tela envia (o PDF de uma página com a foto) e devolver o
    // anexo gravado; o vínculo à lesão segue pela API real.
    const enviados: { extensao?: string; conteudo?: string; atendimento?: number }[] = [];
    await page.route('**/api/pep/paciente/*/anexos', async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      enviados.push(r.request().postDataJSON() as (typeof enviados)[number]);
      await r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ documento: 990_001, origem: 990_001, hash: 'e2e', pdf: true, qr: null }),
      });
    });
    await page.getByTestId(`fe-foto-${id}`).click();
    await expect(page.getByTestId('fe-dialogo-foto')).toBeVisible();
    await page
      .getByTestId('fe-foto-arquivo')
      .setInputFiles({ name: 'sacral.png', mimeType: 'image/png', buffer: PNG });
    await page.getByTestId('fe-foto-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('Foto vinculada');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.extensao).toBe('pdf');
    expect(enviados[0]!.atendimento).toBe(ATENDIMENTO);
    expect(enviados[0]!.conteudo!.startsWith('JVBERi0')).toBe(true);
    const foto = page.getByTestId(`fe-hist-${id}`).locator('[data-testid^="fe-foto-lida-"]').first();
    await expect(foto).toContainText('Anexo nº');
    await foto.locator('[data-testid^="fe-inativar-foto-"]').click();
    await inativar(page, 'Foto de outro paciente enviada por engano');
    await expect(page.getByTestId('fe-mensagem')).toContainText('Foto desvinculada');
    await expect(foto).toHaveAttribute('data-inativo', 'sim');

    // O encerramento do acompanhamento.
    await page.getByTestId(`fe-encerrar-${id}`).click();
    await expect(page.getByTestId('fe-dialogo-encerrar')).toBeVisible();
    await expect(page.getByTestId('fe-encerrar-confirmar')).toBeDisabled();
    await escolher(page.getByTestId('fe-desfecho'), 'cicatrizada');
    await page.getByTestId('fe-encerrar-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('Acompanhamento encerrado');
    await expect(page.getByTestId(`fe-encerramento-${id}`)).toContainText('Cicatrizada');

    // A lesão lançada errada (rascunho): o autor inativa com o motivo e a senha; fica tachada e visível.
    await page.getByTestId(`fe-registrar-${ATENDIMENTO}`).click();
    await escolher(page.getByTestId('fe-tipo'), 'cirurgica');
    await page.getByTestId('fe-finalizar').uncheck();
    await page.getByTestId('fe-ficha-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('Rascunho');
    const errada = cartao.locator('article[data-testid^="fe-lesao-"][data-situacao="rascunho"]').first();
    const idErrada = await idDe(errada);
    await page.getByTestId(`fe-inativar-${idErrada}`).click();
    await semViolacaoAxe(page, '/enfermagem/feridas (inativar)');
    await inativar(page, 'Lançada no paciente errado (leito ao lado)');
    await expect(page.getByTestId(`fe-inativacao-${idErrada}`)).toContainText('paciente errado');
    await expect(page.getByTestId(`fe-lesao-${idErrada}`)).toHaveAttribute('data-inativo', 'sim');

    // A incidência de LPP: numerador e denominador impressos.
    await page.getByTestId('fe-ind-calcular').click();
    await expect(page.getByTestId('fe-ind-densidade')).toContainText('LPP adquiridas ÷');
    await expect(page.getByTestId('fe-ind-pacientes')).toContainText('pacientes internados');
    expect(externas).toEqual([]);
  });

  test('a técnica de enfermagem registra a lesão, mas não anexa foto (sem permissão de anexar ao prontuário)', async ({
    page,
  }) => {
    await entrar(page, 'SINT.TECNICO.ENF');
    await page.goto('/enfermagem/feridas');
    await escolher(page.getByTestId('enf-unidade'), 'UTI');
    const cartao = page.getByTestId('fe-paciente-25103');
    await page.getByTestId('fe-registrar-25103').click();
    await escolher(page.getByTestId('fe-tipo'), 'traumatica');
    await page.getByTestId('fe-ficha-comprimento').fill('1');
    await page.getByTestId('fe-ficha-largura').fill('1');
    await page.getByTestId('fe-ficha-confirmar').click();
    await expect(page.getByTestId('fe-mensagem')).toContainText('ficha finalizada');
    const lesao = cartao.locator('article[data-testid^="fe-lesao-"]').first();
    const id = await idDe(lesao);
    await expect(page.getByTestId(`fe-curativo-${id}`)).toBeVisible();
    await expect(page.getByTestId(`fe-foto-${id}`)).toHaveCount(0);
    await expect(page.getByTestId(`fe-nsp-${id}`)).toHaveCount(0);
    // A ficha de teste sai pelo caminho certo: inativada pelo autor, visível e tachada.
    await page.getByTestId(`fe-inativar-${id}`).click();
    await inativar(page, 'Registro de teste da técnica, lançado errado');
    await expect(lesao).toHaveAttribute('data-inativo', 'sim');
  });
});
