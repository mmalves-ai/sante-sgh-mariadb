// E2E @M19 (ficha, seção 10): o administrador cadastra um totem e um painel de chamada (o token aparece uma vez); o
// paciente retira a senha no totem e faz o check-in pelo CPF; o guichê abre, chama a próxima e o painel mostra a
// chamada sem nome de paciente; uma chamada feita em outro terminal ("por fora") também chega ao painel; o guichê
// conclui, emite no balcão, registra a chegada do agendado e encaminha a senha em atendimento; o supervisor vê os
// guichês. axe sem violação séria em cada tela. Sessão real sobre a fonte sintética de dev e a porta da recepção em
// MEMÓRIA (recepções, senhas e agendados SINTÉTICOS; nada vai à cópia).
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-recepcao-por-fora.json');

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Cadastra o aparelho e devolve o endereço com o token (aparece uma vez). */
async function cadastrarAparelho(page: Page, tipo: 'totem' | 'painel', nome: string): Promise<string> {
  await page.getByTestId(`novo-${tipo}`).click();
  const dialogo = page.getByRole('dialog', { name: 'Cadastrar aparelho' });
  await dialogo.getByLabel('Nome do aparelho').fill(nome);
  if (tipo === 'totem') {
    await dialogo.getByLabel('MC · MARCACAO DE CONSULTA').check();
    await dialogo.getByLabel('BL · AMBULATORIO').check();
  }
  await page.getByTestId(`gravar-${tipo}`).click();
  const endereco = page.getByTestId('endereco-aparelho');
  await expect(endereco).toContainText('#token=');
  const texto = (await endereco.textContent())!.trim();
  await page.getByTestId('fechar-token').click();
  return new URL(texto).pathname + new URL(texto).hash;
}

test.describe('Recepção, senhas, totens e painéis @M19 @fase2', () => {
  test.setTimeout(150_000);
  test.beforeAll(() => rmSync(POR_FORA, { force: true }));
  test.afterAll(() => rmSync(POR_FORA, { force: true }));

  test('totem → painel → guichê → por fora → concluir, balcão, chegada e encaminhamento; supervisor; axe', async ({
    page,
    context,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');

    // W1-04: termos de consentimento. Incluir (versão 1), nova versão (a 1 fica no histórico), excluir o nunca
    // assinado; o exigido na consulta vai pedir a assinatura na chegada.
    await page.goto('/recepcao/termos');
    await expect(page.getByTestId('termos-vazio')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/termos');
    async function novoTermo(codigo: string, titulo: string, exigido: boolean): Promise<void> {
      await page.getByTestId('termo-novo').click();
      await page.getByTestId('termo-codigo').locator('input').fill(codigo);
      await page.getByTestId('termo-titulo').locator('input').fill(titulo);
      await page.getByTestId('termo-tipo-consulta').check();
      if (exigido) await page.getByTestId('termo-exigido').click();
      await page
        .getByTestId('termo-texto-campo')
        .locator('textarea')
        .fill('Autorizo o atendimento e o tratamento dos meus dados de saúde para esta finalidade.');
      await page.getByTestId('termo-gravar').click();
      await expect(page.getByTestId('mensagem-termos')).toContainText('versão 1');
    }
    await novoTermo('lgpd-consulta', 'Consentimento da consulta', true);
    await page.getByTestId('termo-versao-lgpd-consulta').click();
    await page.getByTestId('termo-titulo').locator('input').fill('Consentimento LGPD da consulta');
    await page.getByTestId('termo-gravar').click();
    await expect(page.getByTestId('mensagem-termos')).toContainText('Versão 2');
    await expect(page.getByTestId('termo-versoes-lgpd-consulta').locator('li')).toHaveCount(2);
    await novoTermo('engano', 'Termo cadastrado por engano', false);
    await page.getByTestId('termo-excluir-engano').click();
    await page.getByTestId('termo-motivo').fill('Cadastrado por engano no teste.');
    await page.getByTestId('termo-confirmar').click();
    await expect(page.getByTestId('mensagem-termos')).toContainText('excluído');
    await expect(page.getByTestId('termo-engano')).toHaveCount(0);

    // Cadastros: totem (geradores) e painel de chamada.
    await page.goto('/recepcao/senhas/geradores');
    await expect(page.getByTestId('tela-geradores')).toBeVisible();
    await expect(page.getByTestId('tabela-filas')).toContainText('MARCACAO DE CONSULTA');
    await semViolacaoAxe(page, '/recepcao/senhas/geradores');
    const totem = await cadastrarAparelho(page, 'totem', 'Totem da entrada');
    await expect(page.getByTestId('dispositivos-totem')).toContainText('Totem da entrada');

    await page.goto('/recepcao/senhas/paineis');
    await expect(page.getByTestId('tela-paineis-chamada')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/senhas/paineis');
    const painelEndereco = await cadastrarAparelho(page, 'painel', 'TV da sala de espera');

    // Totem: retirar a senha da marcação de consulta e fazer o check-in pelo CPF.
    const tTotem = await context.newPage();
    await tTotem.goto(totem);
    await expect(tTotem.getByTestId('totem')).toContainText('Toque no serviço');
    await semViolacaoAxe(tTotem, '/totem');
    await tTotem.getByTestId('totem-servico-24').click();
    await expect(tTotem.getByTestId('totem-senha')).toHaveText(/^MC \d{3}$/);
    await expect(tTotem.getByTestId('totem-ticket')).toContainText('à frente');
    await semViolacaoAxe(tTotem, 'ticket do totem');
    await tTotem.getByTestId('totem-nova').click();
    // Sem rede: a tela diz que a senha NÃO foi emitida (nenhum número inventado no aparelho).
    await tTotem.route('**/api/dispositivo/totem/senhas', (r) => r.abort('internetdisconnected'));
    await tTotem.getByTestId('totem-servico-24').click();
    await expect(tTotem.getByTestId('totem-falha')).toContainText('a senha NÃO foi emitida');
    await expect(tTotem.getByTestId('totem-senha')).toHaveCount(0);
    await tTotem.unroute('**/api/dispositivo/totem/senhas');
    await tTotem.getByRole('button', { name: 'Voltar' }).click();
    await tTotem.getByTestId('totem-checkin').click();
    for (const d of '22255588846') await tTotem.getByTestId(`tecla-${d}`).click();
    await tTotem.getByTestId('totem-confirmar').click();
    await tTotem.getByTestId('totem-checkin-servico-1').click();
    await expect(tTotem.getByTestId('totem-ticket')).toContainText(
      'Chegada registrada para o horário das 08:30',
    );
    await expect(tTotem.getByTestId('totem-ticket')).not.toContainText('SINTETICO');
    // Pelo código do exame (o tipo escolhido no totem) e o CPF de quem está no totem.
    await tTotem.getByTestId('totem-nova').click();
    await tTotem.getByTestId('totem-checkin').click();
    await tTotem.getByRole('button', { name: 'Código do agendamento' }).click();
    await tTotem.getByTestId('totem-codigo-exame').click();
    for (const d of '8001') await tTotem.getByTestId(`tecla-${d}`).click();
    await tTotem.getByTestId('totem-confirmar').click();
    await expect(tTotem.getByTestId('totem-cpf-do-codigo')).toBeVisible();
    await semViolacaoAxe(tTotem, 'código do agendamento no totem');
    for (const d of '33366699957') await tTotem.getByTestId(`tecla-${d}`).click();
    await tTotem.getByTestId('totem-confirmar').click();
    await tTotem.getByTestId('totem-checkin-servico-1').click();
    await expect(tTotem.getByTestId('totem-ticket')).toContainText(
      'Chegada registrada para o horário das 09:00',
    );

    // Painel de chamada (TV): sem chamada ainda.
    const tPainel = await context.newPage();
    await tPainel.goto(painelEndereco);
    await expect(tPainel.getByTestId('painel-chamada')).toBeVisible();
    await expect(tPainel.getByTestId('painel-atual')).toBeVisible();
    await semViolacaoAxe(tPainel, '/painel');

    // Guichê: abrir o guichê 3 do ambulatório e chamar a próxima.
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('3');
    await expect(page.getByTestId('guiches-outros')).toContainText('1');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 3 aberto');
    await semViolacaoAxe(page, '/recepcao/guiche');
    const t0 = Date.now();
    await page.getByTestId('chamar-proxima').click();
    // O painel mostra a chamada (o canal de eventos avisa logo após a gravação), sem nome de paciente: em menos de
    // 1 s depois que a chamada volta ao guichê; o tempo do clique ao painel vai ao log (ficha, seção 11).
    await expect(tPainel.getByTestId('painel-senha')).toHaveText(/^[A-Z]{2} \d{3}$/, { timeout: 1_000 });
    console.log(`[M19] chamada do guichê no painel em ${Date.now() - t0} ms`);
    const atual = page.getByTestId('senha-atual');
    await expect(atual).toHaveText(/^[A-Z]{2} \d{3}$/);
    const chamada = (await atual.textContent())!.trim();
    await expect(tPainel.getByTestId('painel-senha')).toHaveText(chamada);
    await expect(tPainel.getByTestId('painel-destino')).toContainText('3');
    await expect(tPainel.locator('main')).not.toContainText('SINTETICO');

    // Chamar de novo pelo teclado (F7) e concluir o serviço diverso.
    await page.keyboard.press('F7');
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');
    await page.getByTestId('evento-liberar').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');
    await expect(page.getByTestId('guiche-atual')).toContainText('Nenhuma senha chamada');

    // Outro terminal chama uma senha (por fora): o painel mostra a chamada do guichê 5.
    const t1 = Date.now();
    writeFileSync(POR_FORA, JSON.stringify({ chamadas: [{ id: 'fora-1', guiche: 5 }] }));
    // Pelo vigia (ciclo de 1 s no E2E) e o canal de eventos: em até 2 s (ficha, seção 11).
    await expect(tPainel.getByTestId('painel-destino')).toContainText('5', { timeout: 2_000 });
    console.log(`[M19] chamada feita por fora no painel em ${Date.now() - t1} ms`);

    // Balcão: emitir a senha do ambulatório (abre atendimento), chamá-la pela lista e registrar a chegada.
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    // As do totem (com check-in) e a do balcão aguardam; chama-se a do balcão (sem agendamento ligado).
    const linhasBl = page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'BL ' })
      .filter({ hasText: 'Balcão' });
    await expect(linhasBl).toHaveCount(1);
    await linhasBl.getByRole('button').click();
    await expect(atual).toHaveText(/^BL \d{3}$/);
    await page.getByTestId('evento-checkin').click();
    await expect(page.getByTestId('lista-agendados')).toBeVisible();
    await expect(page.getByTestId('lista-agendados')).not.toContainText('SINTETICO DE SOUZA');
    // Nome social marcado (BRUNA), sigiloso mascarado e sem foto (CARLA), foto do cadastro para conferir (ANA).
    await expect(page.getByTestId('nome-social-consulta-7002')).toHaveText('nome social');
    await expect(page.getByTestId('lista-agendados')).not.toContainText('BRUNO');
    await expect(page.getByTestId('sigiloso-exame-8001')).toHaveText('sigiloso');
    await expect(page.getByTestId('lista-agendados')).not.toContainText('ROCHA');
    await expect(page.getByTestId('sem-foto-exame-8001')).toHaveAttribute('aria-label', /sigiloso/);
    await expect(page.getByTestId('foto-consulta-7001')).toBeVisible();
    await semViolacaoAxe(page, 'chegada do agendado');
    // A busca pela agenda (parte do nome) acha a marcação certa entre as do dia.
    await page.getByTestId('busca-agenda').locator('input').fill('cardio');
    await page.getByTestId('buscar-agendados').click();
    await expect(page.getByTestId('lista-agendados').getByRole('listitem')).toHaveCount(1);
    await page.getByTestId('ligar-consulta-7001').click();
    // W1-04: falta o termo exigido na consulta: assinatura em tela (traço), revogação (fato novo; a assinatura
    // segue visível), nova assinatura e só então a chegada.
    const termos = page.getByTestId('termos-paciente');
    await expect(termos.getByTestId('termos-faltando')).toContainText('Consentimento LGPD da consulta');
    async function assinar(): Promise<void> {
      await page.getByTestId('assinar-termo-lgpd-consulta').click();
      await expect(page.getByTestId('termo-texto')).toContainText('Autorizo o atendimento');
      await page.getByTestId('termo-nome-signatario').locator('input').fill('ANA SINTETICA');
      const caixa = (await page.getByTestId('assinatura-canvas').boundingBox())!;
      await page.mouse.move(caixa.x + 20, caixa.y + 20);
      await page.mouse.down();
      await page.mouse.move(caixa.x + 120, caixa.y + 60, { steps: 5 });
      await page.mouse.move(caixa.x + 200, caixa.y + 30, { steps: 5 });
      await page.mouse.up();
      await page.getByTestId('gravar-assinatura').click();
      await expect(termos.getByTestId('termos-nada-faltando')).toBeVisible();
    }
    await assinar();
    await expect(termos.getByTestId('termos-assinados')).toContainText('Resumo (hash)');
    await semViolacaoAxe(page, 'termos na chegada');
    await termos.getByTestId('termos-assinados').getByRole('button', { name: 'Revogar' }).click();
    await page.getByTestId('revogar-motivo').fill('Paciente pediu a revogação no balcão.');
    await page.getByTestId('revogar-confirmar').click();
    await expect(termos.getByTestId('termos-assinados')).toContainText('revogado em');
    await expect(termos.getByTestId('termos-faltando')).toBeVisible();
    await assinar();
    await page.getByTestId('termos-registrar-chegada').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Chegada registrada');

    // W1-04: desfazer a chegada (motivo; a marcação volta) e registrar de novo (o termo já assinado não pede nada).
    await page.getByTestId('evento-desfazer-chegada').click();
    await page.getByTestId('desfazer-motivo').fill('Ligada à marcação errada no balcão.');
    await page.getByTestId('desfazer-confirmar').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Chegada desfeita');
    await page.getByTestId('evento-checkin').click();
    await page.getByTestId('busca-agenda').locator('input').fill('cardio');
    await page.getByTestId('buscar-agendados').click();
    await page.getByTestId('ligar-consulta-7001').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Chegada registrada');

    // Duas senhas no guichê (a de recepção só sai dele com a abertura do atendimento): a atual é a ÚLTIMA chamada,
    // e o F7 chama de novo essa (o painel mostra a nova, não a antiga).
    const bl = (await atual.textContent())!.trim();
    await page.getByTestId('chamar-proxima').click();
    await expect(atual).not.toHaveText(bl);
    const segunda = (await atual.textContent())!.trim();
    await expect(tPainel.getByTestId('painel-senha')).toHaveText(segunda);
    await page.keyboard.press('F7');
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');
    await expect(atual).toHaveText(segunda);
    await expect(tPainel.getByTestId('painel-senha')).toHaveText(segunda);

    // Suspender a senha com motivo e retomá-la.
    await page.getByTestId('evento-suspender').click();
    await page.getByTestId('confirmar-suspensao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');

    // Encaminhar a senha em atendimento no consultório para a observação.
    const linhaAtendimento = page.getByTestId('tabela-em-atendimento').getByRole('row').nth(1);
    await linhaAtendimento.getByRole('button', { name: 'Encaminhar' }).click();
    await page.getByTestId('confirmar-encaminhamento').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');

    // Supervisor: o guichê 3 aberto por esta pessoa e o 1 por outra (com a liberação).
    await page.goto('/recepcao/supervisor');
    await expect(page.getByTestId('supervisor-guiches')).toContainText('SINT.SENHAS');
    await expect(page.getByTestId('liberar-2-1')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/supervisor');
    await page.goto('/recepcao/indicadores');
    await expect(page.getByTestId('indicadores-total')).toContainText('Total no período');
    await expect(page.getByTestId('indicadores-por-guiche')).toContainText('Guichê 3');
    await expect(page.getByTestId('indicadores-espera-hora')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/indicadores');

    // Fechar o guichê.
    await page.goto('/recepcao/guiche');
    await page.getByTestId('guiche-numero').fill('3');
    await page.getByTestId('guiche-fechar').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Guichê fechado');
    expect(externas).toEqual([]);
  });

  test('perfil do guichê: chama sem o supervisor e sem configurar filas nem totens; token inválido no aparelho; axe', async ({
    page,
    context,
  }) => {
    await entrar(page, 'SINT.GUICHE');
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Painel do supervisor da recepção' })).toHaveCount(0);
    await page.goto('/recepcao/supervisor');
    await expect(page).toHaveURL(/sem-permissao/);
    // Os geradores ele lê (a opção de gerador de senhas), mas sem configurar a fila nem cadastrar totem.
    await page.goto('/recepcao/senhas/geradores');
    await expect(page.getByTestId('tabela-filas')).toContainText('MARCACAO DE CONSULTA');
    await expect(page.getByTestId('configurar-24')).toHaveCount(0);
    await expect(page.getByTestId('dispositivos-totem')).toHaveCount(0);
    // Aparelho com token que não vale: a tela diz que está fora de serviço (nunca mostra uma senha).
    const tv = await context.newPage();
    await tv.goto(`/painel/999#token=${'x'.repeat(43)}`);
    await expect(tv.getByTestId('painel-fora')).toBeVisible();
    const totem = await context.newPage();
    await totem.goto(`/totem/999#token=${'y'.repeat(43)}`);
    await expect(totem.getByTestId('totem-fora')).toContainText('fora de serviço');
    await semViolacaoAxe(totem, '/totem fora de serviço');
  });
});
