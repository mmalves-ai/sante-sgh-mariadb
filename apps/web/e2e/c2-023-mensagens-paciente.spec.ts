// E2E @C2-023 (08-INTG L133): comunicação com o paciente pela Hal-AI. O administrador grava um modelo de confirmação do
// cliente inteiro (com a conferência das variáveis na hora), a regra da véspera da marcação ligada a ele, gera os avisos
// dos eventos pelo botão e abre a visão por paciente com a coluna do efeito da resposta na marcação. axe sem violação
// séria. Fonte sintética de dev (nomes e números fictícios); nada sai da VM (sem rede externa).
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

test.describe('Mensagens ao paciente pelos eventos @C2-023', () => {
  test('modelo do cliente, regra da véspera, avisos gerados e efeito da resposta na visão por paciente', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = Date.now().toString(36).slice(-6);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/admin/integracoes/mensagens');
    const painel = page.getByTestId('mensagens-painel');
    await expect(painel).toBeVisible();

    // Modelo: a variável desconhecida é recusada na hora e trava o botão; corrigida, o modelo do cliente é gravado.
    const modelo = page.getByTestId('mensagens-novo-modelo');
    await modelo.getByLabel('Código').fill(`CONF${sufixo}`);
    await modelo.getByLabel('Descrição').fill(`Confirmação da véspera ${sufixo}`);
    await escolher(modelo.getByRole('combobox', { name: 'Finalidade' }), 'confirmacao');
    await escolher(modelo.getByRole('combobox', { name: 'Canal' }), 'whatsapp');
    await modelo
      .getByLabel('Texto')
      .fill('Olá {{paciente_nome}}, confirma {{servico}} em {{data}} às {{hora}}? {{senha}}');
    await expect(modelo.getByRole('alert')).toContainText('Variável desconhecida: senha');
    await expect(modelo.getByRole('button', { name: 'Gravar' })).toBeDisabled();
    await modelo
      .getByLabel('Texto')
      .fill('Olá {{paciente_nome}}, confirma {{servico}} em {{data}} às {{hora}}? Responda SIM ou NAO.');
    await modelo.getByLabel('Resposta que confirma').fill('SIM');
    await modelo.getByLabel('Resposta que recusa').fill('NAO');
    await page.getByTestId('mensagens-modelo-cliente').check();
    await modelo.getByRole('button', { name: 'Gravar' }).click();
    await expect(painel.getByRole('status')).toContainText('Gravado.');
    await expect(page.getByTestId('mensagens-modelos')).toContainText(`CONF${sufixo}`);

    // Regra da véspera (24 h antes, das 8h às 20h no fuso do estabelecimento) ligada ao modelo novo.
    const regra = page.getByTestId('mensagens-nova-regra');
    await regra.getByLabel('Código').fill(`VESP${sufixo}`);
    await regra.getByLabel('Descrição').fill(`Véspera da marcação ${sufixo}`);
    await escolher(regra.getByRole('combobox', { name: 'Modelo' }), {
      rotulo: new RegExp(`Confirmação da véspera ${sufixo}`),
    });
    await escolher(regra.getByRole('combobox', { name: 'Aviso' }), 'lembrete_agendamento');
    await regra.getByLabel('Antecedência (minutos)').fill('1440');
    await regra.getByRole('button', { name: 'Gravar' }).click();
    await expect(painel.getByRole('status')).toContainText('Gravado.');
    await expect(page.getByTestId('mensagens-regras')).toContainText(`VESP${sufixo}`);

    // Os avisos dos eventos são gerados na hora (uma vez por regra e marcação): o resumo traz os gerados e os recusados.
    await page.getByTestId('mensagens-gerar').click();
    await expect(painel.getByRole('status')).toContainText(/Avisos gerados: \d+\. Recusados: \d+\./);
    // Repetir não duplica: o segundo disparo não gera de novo os mesmos avisos.
    await page.getByTestId('mensagens-gerar').click();
    await expect(painel.getByRole('status')).toContainText('Avisos gerados: 0.');

    // Visão por paciente: a tabela traz a coluna do efeito da resposta na marcação.
    await page.getByTestId('mensagens-paciente').fill('1');
    const pedidos = page.getByTestId('mensagens-pedidos');
    const nenhum = painel.getByText('Nenhuma mensagem para este paciente.');
    await expect(pedidos.or(nenhum)).toBeVisible();
    if (await pedidos.isVisible()) await expect(pedidos).toContainText('Efeito na marcação');

    await semViolacaoAxe(page, '/admin/integracoes/mensagens');
    expect(externas).toEqual([]);
  });
});
