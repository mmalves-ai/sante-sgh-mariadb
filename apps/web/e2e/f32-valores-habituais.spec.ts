// E2E @F3.2-02 (02-REC linha 31): herança do atendimento anterior e valores habituais da abertura, pelo caminho da
// tela. A recepção grava os valores habituais (os do estabelecimento e os dela) e a configuração da herança em
// /recepcao/atendimento/heranca e abre a ficha de um paciente COM atendimento anterior: o que a herança traz do
// paciente fica, e o valor habitual só completa o campo que a herança não trouxe (o aviso diz quais). Com a unidade
// passando a ser herdada, a unidade do atendimento anterior vence a habitual. A coluna "A ficha vai receber" responde
// na hora, antes de gravar. No fim a configuração volta ao que era (a porta em memória é comum aos outros E2E).
// Sessão real sobre a fonte sintética de dev e a porta do atendimento em MEMÓRIA (massa SINTÉTICA). O paciente sem
// atendimento anterior, a trilha, as recusas e o item fora de uso estão no contrato de efeito
// (apps/api/src/modulos/atendimento/padrao-abertura.int.spec.ts e heranca.int.spec.ts).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a ficha nova do paciente sintético 1002 (tem um atendimento anterior no pronto atendimento, unidade 3). */
async function abrirFichaDoPaciente(page: Page) {
  await page.goto('/recepcao/atendimento/novo');
  await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
  await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
  await page.getByTestId('abrir-atd-buscar').click();
  await page.getByTestId('abrir-atd-paciente-1002').click();
  await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();
  return page.getByRole('region', { name: 'Dados do atendimento' });
}

test.describe('Herança e valores habituais da abertura do atendimento @F3.2-02', () => {
  test.setTimeout(180_000);

  test('valores habituais e herança gravados; a ficha do paciente com atendimento anterior recebe os dois; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ATENDIMENTO');

    // 1. Valores habituais: unidade e convênio do estabelecimento, centro de custo só para mim.
    await page.goto('/recepcao/atendimento/heranca');
    await expect(page.getByTestId('tela-heranca')).toBeVisible();
    const painel = page.getByTestId('painel-padrao-abertura');
    await expect(painel.getByTestId('tabela-padrao-abertura')).toBeVisible();
    await expect(painel.getByTestId('botao-gravar-padrao')).toBeDisabled();
    await escolher(painel.getByTestId('padrao-estabelecimento-unidade'), '1');
    await escolher(painel.getByTestId('padrao-estabelecimento-convenio'), '320');
    await escolher(painel.getByTestId('padrao-pessoal-centroCusto'), '300600');
    // Na hora, antes de gravar: o que a ficha vai receber e de qual escopo.
    await expect(painel.getByTestId('padrao-vigor-unidade')).toContainText('AMBULATORIO');
    await expect(painel.getByTestId('padrao-vigor-unidade')).toContainText('(do estabelecimento)');
    await expect(painel.getByTestId('padrao-vigor-centroCusto')).toContainText('(meu)');
    await expect(painel.getByTestId('padrao-vigor-especialidade')).toHaveText('Sem valor habitual');
    await semViolacaoAxe(page, '/recepcao/atendimento/heranca (valores habituais)');
    await painel.getByTestId('botao-gravar-padrao').click();
    await expect(painel.getByTestId('mensagem-padrao-abertura')).toContainText(
      'Valores habituais do estabelecimento gravados',
    );
    await painel.getByTestId('botao-gravar-padrao-pessoal').click();
    await expect(painel.getByTestId('mensagem-padrao-abertura')).toContainText(
      'Seus valores habituais foram gravados',
    );
    await expect(painel.getByTestId('botao-gravar-padrao')).toBeDisabled();
    await expect(painel.getByTestId('botao-gravar-padrao-pessoal')).toBeDisabled();

    // 2. Paciente com atendimento anterior: a herança traz o que é do paciente; o hábito completa unidade e centro
    //    de custo (que a herança não traz) e não troca o convênio do paciente pelo habitual.
    let ficha = await abrirFichaDoPaciente(page);
    await expect(page.getByTestId('abrir-atd-herdado')).toBeVisible();
    await esperarValor(ficha.getByLabel('Unidade', { exact: true }), '1');
    await esperarValor(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await expect(page.getByTestId('abrir-atd-habitual')).toContainText('Unidade');
    await expect(page.getByTestId('abrir-atd-habitual')).toContainText('Centro de custo');
    await expect(page.getByTestId('abrir-atd-habitual')).not.toContainText('Convênio');
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (herança e valores habituais)');

    // 3. A unidade passa a ser herdada no estabelecimento.
    await page.goto('/recepcao/atendimento/heranca');
    await expect(page.getByTestId('tabela-heranca')).toBeVisible();
    await page.getByTestId('heranca-unidade').check();
    await page.getByTestId('botao-gravar-heranca').click();
    await expect(page.getByTestId('tela-heranca')).toContainText('Configuração da herança gravada');
    await expect(page.getByTestId('heranca-vigor-unidade')).toHaveText('Herda');

    // 4. Agora a unidade do atendimento anterior (3) vence a habitual (1); o hábito só completa o centro de custo.
    ficha = await abrirFichaDoPaciente(page);
    await expect(page.getByTestId('abrir-atd-herdado')).toBeVisible();
    await esperarValor(ficha.getByLabel('Unidade', { exact: true }), '3');
    await esperarValor(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await expect(page.getByTestId('abrir-atd-habitual')).toContainText('Centro de custo');
    await expect(page.getByTestId('abrir-atd-habitual')).not.toContainText('Unidade');

    // 5. Volta ao que era: a unidade deixa de ser herdada e os valores habituais são limpos (a linha fica, vazia).
    await page.goto('/recepcao/atendimento/heranca');
    await expect(page.getByTestId('tabela-heranca')).toBeVisible();
    await page.getByTestId('heranca-unidade').uncheck();
    await page.getByTestId('botao-gravar-heranca').click();
    await expect(page.getByTestId('heranca-vigor-unidade')).toHaveText('Não herda');
    const fim = page.getByTestId('painel-padrao-abertura');
    await escolher(fim.getByTestId('padrao-estabelecimento-unidade'), { rotulo: 'Sem valor habitual' });
    await escolher(fim.getByTestId('padrao-estabelecimento-convenio'), { rotulo: 'Sem valor habitual' });
    await escolher(fim.getByTestId('padrao-pessoal-centroCusto'), { rotulo: 'Segue o estabelecimento' });
    await fim.getByTestId('botao-gravar-padrao').click();
    await expect(fim.getByTestId('mensagem-padrao-abertura')).toContainText(
      'Valores habituais do estabelecimento gravados',
    );
    await fim.getByTestId('botao-gravar-padrao-pessoal').click();
    await expect(fim.getByTestId('mensagem-padrao-abertura')).toContainText(
      'Seus valores habituais foram gravados',
    );
    await expect(fim.getByTestId('padrao-vigor-unidade')).toHaveText('Sem valor habitual');
    await expect(fim.getByTestId('padrao-vigor-centroCusto')).toHaveText('Sem valor habitual');
  });
});
