// E2E @M49.1 (ficha do M49, seção 10, na parte da etapa 1): Meu certificado → vincular em nuvem pelo provedor
// SIMULADO (OAuth 2.0 + PKCE; o titular digita o CPF na página do provedor) com o CPF de outra pessoa → recusado
// (regra 2) → com o CPF do usuário → vinculado (CPF só mascarado) → assinatura de conferência no provedor → validada
// no servidor (assinatura, cadeia, revogação, CPF e carimbo do tempo: "Válida"); a política por tipo de documento recusa
// abaixo do mínimo legal e grava a regra; os provedores mostram o segredo só como "Definido", testam a conexão no
// simulador e gravam um provedor novo com o segredo no cofre; o texto da concessão (regra 11); axe sem violação séria.
// Sessão real sobre a fonte sintética de dev e a porta da assinatura em MEMÓRIA (CPF, certificados e ICP SINTÉTICOS;
// nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

/** CPF sintético com dígitos verificadores a partir de 9 dígitos (o mesmo cálculo do simulador; nunca de pessoa). */
function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}
const CPF_DA_SESSAO = cpfSintetico('900000001');
const CPF_DE_OUTRO = cpfSintetico('900000002');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Na página do provedor simulado, o titular digita o CPF e autoriza; volta a Meu certificado. */
async function autorizarNoProvedor(page: Page, cpf: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
  await page.getByLabel('CPF do titular').fill(cpf);
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page).toHaveURL(/\/conta\/certificado/);
  await expect(page.getByTestId('tela-meu-certificado')).toBeVisible();
}

test.describe('assinatura ICP-Brasil, etapa 1 @M49.1', () => {
  test.setTimeout(240_000);

  test('vincular em nuvem (CPF divergente recusado), conferência válida, política e provedores; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');

    // Meu certificado: o ambiente de teste avisa que tudo é simulado; nada vinculado ainda.
    await page.goto('/conta/certificado');
    await expect(page.getByTestId('tela-meu-certificado')).toBeVisible();
    await expect(page.getByTestId('cert-simulador')).toBeVisible();
    await expect(page.getByTestId('cert-concessao')).toContainText(
      'Ela não torna o prontuário inteiro assinado nem imutável',
    );
    await semViolacaoAxe(page, '/conta/certificado');

    // CPF de outra pessoa no provedor: recusado (regra 2), nada vinculado.
    await escolher(page.getByTestId('cert-provedor'), 'simulador');
    await page.getByTestId('cert-autorizar').click();
    await autorizarNoProvedor(page, CPF_DE_OUTRO);
    await expect(page.getByTestId('cert-aviso')).toContainText('O CPF do certificado não é o seu');
    await expect(page.getByTestId('cert-nenhum')).toBeVisible();

    // O próprio CPF: vinculado; a tela mostra só o CPF mascarado.
    await escolher(page.getByTestId('cert-provedor'), 'simulador');
    await page.getByTestId('cert-autorizar').click();
    await autorizarNoProvedor(page, CPF_DA_SESSAO);
    await expect(page.getByTestId('cert-aviso')).toContainText('Certificado vinculado');
    await expect(page.getByTestId('cert-lista')).toBeVisible();
    await expect(page.getByTestId('cert-cpf').first()).toHaveText(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    await expect(page.getByTestId('tela-meu-certificado')).not.toContainText(CPF_DA_SESSAO);

    // Assinatura de conferência: só o hash vai ao provedor; a validação do servidor diz "Válida" com o carimbo.
    await page.getByTestId('cert-testar').first().click();
    await autorizarNoProvedor(page, CPF_DA_SESSAO);
    await expect(page.getByTestId('cert-aviso')).toContainText('Assinatura de conferência válida');
    const conferencia = page.getByTestId('cert-conferencia').first();
    await expect(conferencia.getByTestId('conf-estado')).toHaveText('Assinada');
    await expect(conferencia.getByTestId('conf-resultado')).toHaveText('Válida');
    await semViolacaoAxe(page, '/conta/certificado (vinculado e conferido)');

    // Política: abaixo do mínimo legal é recusada (dizendo o mínimo); a regra de NGS2 da evolução é gravada.
    await page.goto('/administracao/assinatura/politica');
    await expect(page.getByTestId('tela-politica-assinatura')).toBeVisible();
    await expect(page.getByTestId('pol-sem-regras')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/assinatura/politica');
    await escolher(page.getByTestId('pol-tipo'), 'atestado');
    await escolher(page.getByTestId('pol-destino'), 'externo');
    await escolher(page.getByTestId('pol-nivel'), 'eletronica-avancada');
    await page.locator('#pol-justificativa').fill('Teste sintético abaixo do mínimo legal');
    await page.getByTestId('pol-gravar').click();
    await expect(page.getByTestId('recusa-assinatura')).toContainText('o mínimo é: Qualificada (ICP-Brasil)');
    await escolher(page.getByTestId('pol-tipo'), 'registro-clinico');
    await escolher(page.getByTestId('pol-destino'), 'interno');
    await escolher(page.getByTestId('pol-nivel'), 'icp-brasil');
    await escolher(page.getByTestId('pol-icp'), 'AD-RB');
    await page.getByTestId('pol-gravar').click();
    await expect(page.getByTestId('pol-aviso')).toContainText('Regra gravada');
    await expect(page.getByTestId('pol-regra')).toHaveCount(1);
    await expect(page.getByTestId('pol-vig-registro-clinico-interno')).toContainText('Regra cadastrada');
    await expect(page.getByTestId('pol-vig-receita-controlada-externo')).toContainText(
      'Com carimbo do tempo',
    );

    // Provedores: o simulado com o segredo "Definido" e o teste de conexão; um provedor novo com o segredo no cofre.
    await page.goto('/administracao/assinatura/provedores');
    await expect(page.getByTestId('tela-provedores')).toBeVisible();
    await expect(page.getByTestId('prov-simulador').getByTestId('prov-segredo')).toHaveText('Definido');
    await semViolacaoAxe(page, '/administracao/assinatura/provedores');
    await page.getByTestId('prov-simulador').getByTestId('prov-testar').click();
    await expect(page.getByTestId('prov-aviso')).toContainText('bem-sucedida');
    await page.getByTestId('prov-novo').click();
    await page.getByTestId('prov-codigo').fill('psc-sintetico');
    await page.locator('#prov-nome').fill('Provedor sintético');
    await page.getByTestId('prov-uri').fill('https://psc.sintetico.invalid/v0');
    await page.getByTestId('prov-cliente').fill('cliente-sintetico');
    await page.locator('#prov-autoridades').fill('AC SINTETICA A');
    await page.locator('#prov-just').fill('Cadastro sintético do provedor');
    await page.getByTestId('prov-gravar').click();
    await expect(page.getByTestId('prov-aviso')).toContainText('Provedor gravado');
    const novo = page.getByTestId('prov-psc-sintetico');
    await expect(novo.getByTestId('prov-segredo')).toHaveText('Não definido');
    await novo.getByTestId('prov-trocar-segredo').click();
    await page.getByTestId('prov-novo-segredo').fill('segredo-sintetico-de-teste');
    await page.locator('#prov-just-seg').fill('Segredo sintético do provedor');
    await page.getByTestId('prov-senha').fill(SENHA);
    await page.getByTestId('prov-gravar-segredo').click();
    await expect(page.getByTestId('prov-aviso')).toContainText('Segredo gravado no cofre');
    await expect(novo.getByTestId('prov-segredo')).toHaveText('Definido');
    await expect(page.getByTestId('tela-provedores')).not.toContainText('segredo-sintetico-de-teste');
    await semViolacaoAxe(page, '/administracao/assinatura/provedores (com o provedor novo)');
    // Com o segredo definido, trocar o endereço pede a senha (o segredo iria para o novo destino).
    await novo.getByTestId('prov-editar').click();
    await expect(page.getByTestId('prov-pede-senha')).toHaveCount(0);
    await page.getByTestId('prov-uri').fill('https://outro.sintetico.invalid/v0');
    await expect(page.getByTestId('prov-pede-senha')).toBeVisible();
    await page.getByTestId('prov-uri').fill('https://psc.sintetico.invalid/v0');
    await expect(page.getByTestId('prov-pede-senha')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
