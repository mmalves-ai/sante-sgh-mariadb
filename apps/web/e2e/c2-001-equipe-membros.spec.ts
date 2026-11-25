// C2-001 (F3.4, 04-CC linha 95): a equipe cirúrgica como lista de membros. No registro do ato, a troca de cirurgião
// no meio do ato (a nova linha entra na hora em que a anterior saiu), o aviso na hora quando os tempos se cruzam e a
// gravação. Na lista das realizadas, o painel da equipe realizada (membros, minutos, percentual) e a ponte que leva a
// equipe do procedimento ao item da conta. Fonte sintética; a equipe realizada e a ponte são simuladas pela rota
// (a porta em memória do E2E não tem o banco próprio; o contrato de efeito está em equipe-realizada-propria.int.spec).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ATO = 990001;

function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const EQUIPE = {
  ato: ATO,
  numero: 'CC-SINT-1',
  atendimento: 77003,
  entradaSala: `${hojeSp()}T14:00:00.000Z`,
  saidaSala: `${hojeSp()}T17:00:00.000Z`,
  procedimentos: [{ id: 11, sequencia: 1, descricao: 'PROCEDIMENTO SINTETICO A' }],
  membros: [
    {
      participante: 1,
      funcao: 'cirurgiao',
      funcaoDescricao: 'Cirurgião',
      profissional: 5001,
      profissionalNome: 'CIRURGIAO SINTETICO UM',
      procedimentoAto: 11,
      procedimentoDescricao: 'PROCEDIMENTO SINTETICO A',
      principal: true,
      entrada: `${hojeSp()}T14:00:00.000Z`,
      saida: `${hojeSp()}T16:40:00.000Z`,
      minutos: 160,
      percentual: 100,
    },
    {
      participante: 2,
      funcao: 'cirurgiao',
      funcaoDescricao: 'Cirurgião',
      profissional: 5002,
      profissionalNome: 'CIRURGIAO SINTETICO DOIS',
      procedimentoAto: 11,
      procedimentoDescricao: 'PROCEDIMENTO SINTETICO A',
      principal: false,
      entrada: `${hojeSp()}T16:40:00.000Z`,
      saida: `${hojeSp()}T17:00:00.000Z`,
      minutos: 20,
      percentual: 80,
    },
  ],
  itensConta: [{ id: 501, conta: '9001', descricao: 'HONORARIO SINTETICO', situacao: 'lancado' }],
  itensContaCortados: false,
};

test.describe('Equipe cirúrgica como lista de membros @C2-001', () => {
  test.describe.configure({ mode: 'serial' });

  test('troca de cirurgião no meio do ato, aviso de tempos cruzados e gravação; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.BLOCO');
    await page.goto('/cirurgia/registro');
    await expect(page.getByTestId('tela-registro-cirurgia')).toBeVisible();
    const form = page.getByTestId('form-registro');
    await page.getByTestId('registro-reg').fill('77003');
    await page.getByTestId('registro-data').fill(hojeSp());
    await escolher(form.getByLabel('Sala', { exact: true }), '1');
    await escolher(form.getByLabel('Convênio', { exact: true }), '10');
    await page.getByTestId('registro-inicio').fill('14:00');
    await page.getByTestId('registro-fim').fill('17:00');
    await form.getByLabel('Procedimento (código ou início do nome)').fill('COLE');
    await form.getByLabel('Procedimento (código ou início do nome)').press('Enter');
    await form.getByRole('button', { name: /COLECISTECTOMIA/ }).click();
    await escolher(form.getByLabel('Cirurgião', { exact: true }), '5001:9001');

    // A primeira linha do cirurgião: entrada, saída e percentual.
    await expect(page.getByTestId('registro-participacao')).toBeVisible();
    await page.getByTestId('part-cirurgiao-entrada').fill('14:00');
    await page.getByTestId('part-cirurgiao-saida').fill('16:40');
    await page.getByTestId('part-cirurgiao-perc').fill('100');

    // Troca no meio do ato: a nova linha entra às 16:40, na hora em que o primeiro saiu.
    await page.getByTestId('part-cirurgiao-trocar').click();
    const segunda = page.getByTestId('part-cirurgiao-2-linha');
    await expect(segunda).toBeVisible();
    await expect(page.getByTestId('part-cirurgiao-2-entrada')).toHaveValue('16:40');
    await escolher(segunda.getByLabel('Profissional', { exact: true }), { indice: 2 });

    // Tempos cruzados: o aviso aparece na hora, antes de gravar.
    await page.getByTestId('part-cirurgiao-2-entrada').fill('16:00');
    await page.getByTestId('part-cirurgiao-2-saida').fill('17:00');
    await expect(page.getByTestId('registro-membros-problema')).toBeVisible();

    // Corrigido, o aviso some e o ato grava.
    await page.getByTestId('part-cirurgiao-2-entrada').fill('16:40');
    await page.getByTestId('part-cirurgiao-2-perc').fill('80');
    await expect(page.getByTestId('registro-membros-problema')).toHaveCount(0);
    await escolher(form.getByLabel('Classificação ASA', { exact: true }), '2');
    await semViolacaoAxe(page, 'registro com troca de cirurgião');
    await page.getByTestId('botao-registrar').click();
    await expect(page.getByTestId('registro-mensagem')).toContainText('registrado');
    expect(externas).toEqual([]);
  });

  test('equipe realizada com minutos e percentual; levar a equipe ao item da conta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let corpoConta: unknown = null;
    await page.route(/\/api\/cirurgia\/atos\/\d+\/equipe$/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EQUIPE) }),
    );
    await page.route(/\/api\/cirurgia\/atos\/\d+\/equipe\/conta$/, (r) => {
      corpoConta = r.request().postDataJSON();
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ATO,
          itens: [
            {
              procedimento: 11,
              item: 501,
              incluidos: 1,
              foraDaVaga: [{ profissional: 5002, funcaoCobranca: 1 }],
            },
          ],
        }),
      });
    });
    // Quem leva a equipe à conta lê o registro (cirurgia.registro.ler) e lança na conta (faturamento.item.lancar):
    // o SINT.BLOCO.CONTA. Sem a segunda, o formulário da ponte não aparece.
    await entrar(page, 'SINT.BLOCO.CONTA');
    await page.goto('/cirurgia/registro');
    // O ato registrado no teste anterior (a porta em memória guarda); a equipe dele vem da rota simulada.
    await page.getByTestId('tabela-realizadas').locator('[data-testid^="realizada-equipe-"]').first().click();
    const painel = page.getByTestId('equipe-realizada');
    await expect(painel).toContainText('CC-SINT-1');
    await expect(page.getByTestId('equipe-membro-1')).toContainText('160');
    await expect(page.getByTestId('equipe-membro-1')).toContainText('100%');
    await expect(page.getByTestId('equipe-membro-2')).toContainText('16:40');
    await expect(page.getByTestId('equipe-membro-2')).toContainText('80%');
    await semViolacaoAxe(page, 'equipe realizada');

    // Sem item escolhido, o botão fica desligado; escolhido, leva numa gravação só.
    await expect(page.getByTestId('equipe-conta-levar')).toBeDisabled();
    await expect(page.getByTestId('equipe-conta-cortados')).toHaveCount(0);
    await escolher(painel.getByLabel('Item da conta para PROCEDIMENTO SINTETICO A'), '501');
    await page.getByTestId('equipe-conta-levar').click();
    await expect(page.getByTestId('equipe-conta-resultado')).toContainText('1 participante');
    await expect(page.getByTestId('equipe-conta-resultado')).toContainText('fora da vaga');
    expect(corpoConta).toEqual({ itens: [{ procedimento: 11, item: 501 }] });
    expect(externas).toEqual([]);
  });
});
