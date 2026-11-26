// E2E @F3.5-06 (F3.5, 05-SADT linha 10): digitar, liberar e retificar o resultado pelas telas do laboratório, no
// contrato do banco do cliente (o exame pedido pelo id: POST /api/sadt/exames-pedidos/:exame/resultado, /liberar e
// /retificar). A tela manda o analito pelo id com número ou texto (sem versão por carimbo de data), diz na hora que o
// valor é crítico e que o aviso é aberto ao gravar, mostra a resposta do servidor (aviso do crítico aberto; quem já
// tinha visto avisado da retificação) e só oferece retificar com valor novo e motivo. As três rotas do banco são
// simuladas aqui (massa SINTÉTICA) para conferir o corpo enviado; o efeito no banco (faixa congelada, aviso de valor
// crítico pendente e cancelado, versão guardada, aviso a quem viu, trilha) é provado no contrato de efeito
// resultado-banco.int.spec.ts. Sem a simulação, a mesma tela grava pelo ambiente em memória (a jornada continua).
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Simula uma rota de gravação do banco do cliente: guarda o corpo recebido e devolve o resultado gravado. */
async function simular(
  page: Page,
  sufixo: string,
  resposta: Record<string, unknown>,
): Promise<{ corpos: unknown[]; parar: () => Promise<void> }> {
  const corpos: unknown[] = [];
  const padrao = new RegExp(`/api/sadt/exames-pedidos/\\d+/resultado${sufixo}$`);
  const tratar = async (rota: Route) => {
    corpos.push(rota.request().postDataJSON());
    await rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
  };
  await page.route(padrao, tratar);
  return { corpos, parar: () => page.unroute(padrao, tratar) };
}

test.describe('@F3.5-06 resultado: digitar, liberar e retificar pelo exame pedido', () => {
  test.setTimeout(240_000);

  test('a tela grava pelo contrato do banco, avisa do crítico e da retificação; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    // O médico pede o potássio no prontuário do paciente internado.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/exames');
    await page.getByTestId('incluir-exame-502').click();
    await page.getByTestId('enviar-pedido').click();
    // O servidor da rodada é compartilhado: outro spec (M26, @C1-077) pode ter pedido o potássio deste paciente nas
    // últimas 24 horas, e então o pedido repetido só sai com os avisos conferidos (regra do pedido, não se afrouxa).
    const enviado = page.getByTestId('aba-exames-conteudo').getByText('Pedido enviado.');
    await expect(enviado.or(page.getByTestId('avisos-pedido'))).toBeVisible();
    if (!(await enviado.isVisible())) {
      await page.getByTestId('confirmar-avisos').check();
      await page.getByTestId('enviar-pedido').click();
    }
    await expect(page.getByTestId('aba-exames-conteudo')).toContainText('Pedido enviado.');

    // A biomédica coleta, recebe a amostra e recebe o pedido no setor.
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/coleta');
    const grupo = page.locator('[data-testid^="coleta-grupo-"]').filter({ hasText: 'POTÁSSIO' }).first();
    await expect(grupo).toBeVisible();
    const indice = (await grupo.getAttribute('data-testid'))!.replace('coleta-grupo-', '');
    await page.getByTestId(`coleta-pulseira-${indice}`).fill('P1001|A31337');
    await page.getByTestId(`coleta-conferido-${indice}`).check();
    await page.getByTestId(`coleta-coletar-${indice}`).click();
    await expect(page.getByTestId('coleta-mensagem')).toContainText(/Amostra [0-9A-Z]{10} coletada/);
    const codigo = /Amostra ([0-9A-Z]{10})/.exec(
      (await page.getByTestId('coleta-mensagem').textContent()) ?? '',
    )![1]!;
    await page.goto('/sadt/amostras');
    await page.getByTestId('amostra-codigo').fill(codigo);
    await page.getByTestId('amostra-achar').click();
    await escolher(page.getByTestId(`amostra-estado-${codigo}`), 'recebida');
    await page.getByTestId(`amostra-mudar-${codigo}`).click();
    await expect(page.getByTestId('amostra-mensagem')).toContainText('Recebida no laboratório');
    await page.goto('/sadt/exames');
    await expect(page.getByTestId('tela-sadt-exames')).toBeVisible();
    const linha = page
      .locator('[data-testid^="sadt-exame-"]')
      .filter({ hasText: 'POTÁSSIO' })
      .filter({ hasText: 'Pedido do prontuário' })
      .filter({ has: page.locator('[data-testid^="sadt-selecionar-"]') })
      .last();
    const id = Number((await linha.getAttribute('data-testid'))!.replace('sadt-exame-', ''));
    await page.getByTestId(`sadt-selecionar-${id}`).check();
    await escolher(page.getByTestId('sadt-prestador'), { indice: 1 });
    await page.getByTestId('sadt-receber').click();
    await expect(page.getByTestId('sadt-mensagem')).toContainText('Pedido recebido');

    // Digitação: o crítico aparece enquanto se digita, com o aviso de que ele é aberto ao gravar.
    await page.goto(`/sadt/resultados/digitacao?exame=${id}`);
    await expect(page.getByTestId('digitacao-ficha')).toBeVisible();
    await expect(page.locator('[data-testid="tela-sadt-digitacao"] select')).toHaveCount(0);
    await page.getByTestId('digitacao-valor-0').fill('7,2');
    await expect(page.getByTestId('digitacao-marca-0')).toContainText('o aviso é aberto ao gravar');
    // No banco do cliente: o corpo é o do contrato novo (analito pelo id, número; sem versão nem chave antiga).
    const digitar = await simular(page, '', {
      resultado: 9001,
      exame: id,
      situacao: 'digitado',
      numeroVersao: 1,
      critico: true,
      anormal: true,
    });
    await page.getByTestId('digitacao-gravar').click();
    await expect(page.getByTestId('digitacao-mensagem')).toContainText(
      'Valor crítico: o aviso foi aberto para a comunicação ao responsável',
    );
    expect(digitar.corpos).toEqual([{ valores: [{ analito: 0, numero: 7.2, texto: null }] }]);
    await digitar.parar();
    // Sem o banco do cliente (ambiente em memória), a mesma tela grava e a jornada segue.
    await page.getByTestId('digitacao-valor-0').fill('7,2');
    await page.getByTestId('digitacao-gravar').click();
    await expect(page.getByTestId('digitacao-mensagem')).toContainText('Resultado digitado');
    await semViolacaoAxe(page, '/sadt/resultados/digitacao');

    // Liberação: o crítico pede a confirmação antes de liberar.
    await page.goto('/sadt/resultados/liberacao');
    await expect(page.getByTestId(`liberacao-${id}`)).toBeVisible();
    await expect(page.getByTestId(`liberacao-liberar-${id}`)).toBeDisabled();
    await page.getByTestId(`liberacao-confirmar-${id}`).check();
    const liberar = await simular(page, '/liberar', {
      resultado: 9001,
      exame: id,
      situacao: 'liberado',
      numeroVersao: 1,
      critico: true,
      anormal: true,
    });
    await page.getByTestId(`liberacao-liberar-${id}`).click();
    await expect(page.getByTestId('liberacao-mensagem')).toContainText(
      'O aviso do valor crítico segue no painel até a comunicação',
    );
    // Quem libera é o profissional habilitado da sessão: a tela não manda responsável nem versão.
    expect(liberar.corpos).toEqual([{}]);
    await liberar.parar();
    await expect(page.getByTestId(`liberacao-${id}`)).toBeVisible();
    await page.getByTestId(`liberacao-confirmar-${id}`).check();
    await page.getByTestId(`liberacao-liberar-${id}`).click();
    await expect(page.getByTestId('liberacao-mensagem')).toContainText('aviso do valor crítico');

    // Retificação: só grava com valor novo e motivo; a versão anterior aparece; quem já viu é avisado.
    await page.getByTestId(`liberados-retificar-${id}`).click();
    await expect(page.getByTestId('retificar-versoes')).toContainText('Versão 1');
    await expect(page.getByTestId('retificar-gravar')).toBeDisabled();
    await page.getByTestId('retificar-motivo').fill('Erro de transcrição do valor');
    await expect(page.getByTestId('retificar-gravar')).toBeDisabled();
    await page.getByTestId('retificar-valor-0').fill('5,1');
    await expect(page.getByTestId('retificar-gravar')).toBeEnabled();
    const retificar = await simular(page, '/retificar', {
      resultado: 9001,
      exame: id,
      situacao: 'retificado',
      numeroVersao: 2,
      critico: false,
      anormal: false,
    });
    await page.getByTestId('retificar-gravar').click();
    await expect(page.getByTestId('liberacao-mensagem')).toContainText(
      'Resultado retificado. Quem já tinha visto foi avisado.',
    );
    expect(retificar.corpos).toEqual([
      { valores: [{ analito: 0, numero: 5.1, texto: null }], motivo: 'Erro de transcrição do valor' },
    ]);
    await retificar.parar();
    await semViolacaoAxe(page, '/sadt/resultados/liberacao');

    expect(externas).toEqual([]);
  });
});
