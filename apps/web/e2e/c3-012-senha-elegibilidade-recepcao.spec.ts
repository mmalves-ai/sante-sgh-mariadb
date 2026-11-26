// E2E @C3-012 (F7, 02-REC linha 37): a senha de autorização e a elegibilidade da operadora na recepção. Quem edita o
// contrato grava uma regra do plano que exige a senha só num setor (unidade assistencial) e vê o alcance na tabela
// (especialidade, serviço e setor). Na abertura do atendimento, a recepção vê o bloco de elegibilidade e senha (carteiras
// do paciente com a última consulta, consulta em um clique) e a prévia da regra do plano passa a conferir a senha.
// A elegibilidade do paciente vem de resposta sintética (rota interceptada). Fonte sintética; axe nas duas telas.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dataFutura(): string {
  const d = new Date(Date.UTC(2093, 0, 1) + Math.floor(Math.random() * 3_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Senha e elegibilidade da operadora na recepção @C3-012 @fase7', () => {
  test('regra da senha por setor gravada com o alcance na tabela; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/recepcao/atendimento/regras-plano');
    const tela = page.getByTestId('tela-regras-plano');
    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-setor')).toBeVisible();
    await expect(page.getByTestId('rp-especialidade')).toBeVisible();
    await expect(page.getByTestId('rp-servico')).toBeVisible();
    await escolher(page.getByTestId('rp-setor'), { indice: 1 });
    await page.getByTestId('rp-exigeSenhaAutorizacao').click();
    await page.getByTestId('rp-campo-vigenciaInicio').fill(dataFutura());
    await semViolacaoAxe(page, 'regras do plano com setor');
    // A prévia confere a abertura também por especialidade, serviço e setor.
    await expect(page.getByTestId('rp-previa-especialidade')).toBeVisible();
    await expect(page.getByTestId('rp-previa-servico')).toBeVisible();
    await expect(page.getByTestId('rp-previa-setor')).toBeVisible();
    await page.getByTestId('rp-gravar').click();
    await expect(tela.getByRole('columnheader', { name: 'Especialidade, serviço e setor' })).toBeVisible();
    await expect(
      tela
        .getByRole('cell', { name: /Todas as especialidades · Todos os serviços · (?!Todos os setores)/ })
        .first(),
    ).toBeVisible();
    expect(externas).toEqual([]);
  });

  test('abertura mostra a elegibilidade e colhe a senha; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await page.route('**/api/tiss/elegibilidade/pacientes/*', (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          coberturas: [
            {
              id: 91,
              fontePagadora: 'OPERADORA ALFA SINTETICA',
              carteira: '000123',
              validade: null,
              ultimaElegibilidadeEm: '2026-11-26',
              ultimaAprovada: true,
            },
          ],
          consultas: [
            {
              id: 501,
              fontePagadora: 'OPERADORA ALFA SINTETICA',
              carteira: '000123',
              situacao: 'elegivel',
              solicitadaEm: '2026-11-26',
              respondidaEm: '2026-11-26',
              motivoNegativa: null,
              codigoValidacao: 'VAL-SINT-1',
              por: 'SINT.GUICHE',
              versao: 1,
              pelaOperadora: false,
            },
          ],
        }),
      }),
    );
    await entrar(page, 'SINT.GUICHE');
    // 02-REC linha 37: os serviços da abertura (fonte sintética), para a regra que vale só num serviço.
    await page.route('**/api/atendimento/regras-plano/servicos', (rota) =>
      rota.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 901, rotulo: 'SERVICO SINTETICO A' },
          { id: 902, rotulo: 'SERVICO SINTETICO B' },
        ]),
      }),
    );
    await page.goto('/recepcao/atendimento/novo');
    const bloco = page.getByTestId('elegibilidade-abertura');
    await expect(bloco).toBeVisible();
    await expect(page.getByTestId('abrir-senha-convenio')).toBeVisible();
    await expect(page.getByTestId('abrir-validade-senha')).toBeVisible();
    await escolher(page.getByTestId('abrir-servico'), { rotulo: /SERVICO SINTETICO A/ });
    await semViolacaoAxe(page, 'abertura com elegibilidade');
    expect(externas).toEqual([]);
  });
});
