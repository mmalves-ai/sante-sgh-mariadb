// E2E @F3.2-03 (02-REC linha 33): o hospital monta a recepção pela tela. O administrador cadastra uma recepção (o
// código chega sugerido pelo nome), inclui dois guichês (o número chega sugerido), inclui dois serviços de senha (o
// prefixo chega sugerido; o grupo de prioridade legal marca o botão como prioritário) e vê os botões na ordem da
// posição; a regra confere na hora (prefixo repetido fecha o botão de gravar); desativar pede o motivo e o registro
// continua na lista, marcado; reativar devolve. A tela dos geradores mostra os mesmos serviços. axe sem violação
// séria. Sessão real sobre a fonte sintética de dev e a porta da estrutura em MEMÓRIA (nada vai a banco).
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

test.describe('Montar a recepção pela tela @F3.2-03 @fase3', () => {
  test.setTimeout(120_000);

  test('recepção, guichês e serviços de senha: incluir, conferir na hora, ordenar, desativar e reativar', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/recepcoes');
    await expect(page.getByTestId('tela-recepcoes')).toBeVisible();
    await expect(page.getByTestId('estrutura-recepcao')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/recepcoes');

    // Recepção nova: o código acompanha o nome.
    await page.getByTestId('nova-recepcao').click();
    const dialogo = page.getByRole('dialog', { name: 'Nova recepção' });
    await dialogo.getByLabel('Nome').fill('Recepção do anexo');
    await expect(dialogo.getByLabel('Código')).toHaveValue('RECEPCAO-DO-ANEXO');
    await semViolacaoAxe(page, '/recepcao/recepcoes (diálogo)');
    await page.getByTestId('gravar-estrutura').click();
    await expect(page.getByTestId('mensagem-estrutura')).toContainText('Recepção cadastrada');
    const cartao = page.getByTestId('ponto-RECEPCAO-DO-ANEXO');
    await expect(cartao).toContainText('Nenhum guichê cadastrado');

    // Dois guichês: o número chega sugerido (1, depois 2).
    for (const n of ['1', '2']) {
      await page.getByTestId('novo-guiche-RECEPCAO-DO-ANEXO').click();
      await expect(page.getByLabel('Número do guichê')).toHaveValue(n);
      await page.getByTestId('gravar-estrutura').click();
      await expect(page.getByTestId(`guiche-RECEPCAO-DO-ANEXO-${n}`)).toBeVisible();
    }

    // Serviço de senha: prefixo sugerido pelas iniciais; posição sugerida 1.
    await page.getByTestId('novo-servico-RECEPCAO-DO-ANEXO').click();
    const servico = page.getByRole('dialog', { name: /Novo serviço de senha/ });
    await servico.getByLabel('Nome do serviço').fill('Marcação de exames');
    await expect(servico.getByLabel('Prefixo da senha')).toHaveValue('ME');
    await expect(servico.getByLabel(/Posição do botão/)).toHaveValue('1');
    await page.getByTestId('gravar-estrutura').click();
    await expect(page.getByTestId('servico-RECEPCAO-DO-ANEXO-ME')).toContainText('Marcação de exames');

    // Segundo serviço: o prefixo repetido é recusado na hora; com o grupo legal, o botão fica prioritário e vai
    // para a primeira posição.
    await page.getByTestId('novo-servico-RECEPCAO-DO-ANEXO').click();
    await servico.getByLabel('Nome do serviço').fill('Atendimento preferencial');
    await servico.getByLabel('Prefixo da senha').fill('ME');
    await expect(page.getByTestId('recusa-estrutura')).toContainText('já usa este prefixo');
    await expect(page.getByTestId('gravar-estrutura')).toBeDisabled();
    await servico.getByLabel('Prefixo da senha').fill('AP');
    await escolher(page.getByTestId('estrutura-grupo'), { rotulo: 'Gestante' });
    await expect(servico.getByLabel('Emite senha prioritária')).toBeChecked();
    await servico.getByLabel(/Posição do botão/).fill('1');
    await page.getByTestId('gravar-estrutura').click();
    const linhas = page.getByTestId('servicos-RECEPCAO-DO-ANEXO').locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toContainText('Atendimento preferencial');
    await expect(linhas.nth(0)).toContainText('Gestante');
    await expect(linhas.nth(1)).toContainText('Marcação de exames');

    // Desativar pede o motivo; o serviço continua na lista, marcado, e pode ser reativado.
    await page.getByTestId('desativar-servico-RECEPCAO-DO-ANEXO-ME').click();
    const desativar = page.getByRole('dialog', { name: /Desativar Marcação de exames/ });
    await expect(page.getByTestId('confirmar-desativar')).toBeDisabled();
    await desativar.getByLabel('Motivo').fill('Serviço transferido para outra recepção');
    await page.getByTestId('confirmar-desativar').click();
    await expect(page.getByTestId('servico-RECEPCAO-DO-ANEXO-ME')).toContainText('Inativo');
    await page.getByTestId('reativar-servico-RECEPCAO-DO-ANEXO-ME').click();
    await expect(page.getByTestId('servico-RECEPCAO-DO-ANEXO-ME')).toContainText('Ativo');

    // O guichê desativado continua na lista e o número fica reservado.
    await page.getByTestId('desativar-guiche-RECEPCAO-DO-ANEXO-2').click();
    await page
      .getByRole('dialog', { name: /Desativar Guichê 2/ })
      .getByLabel('Motivo')
      .fill('Guichê retirado do balcão');
    await page.getByTestId('confirmar-desativar').click();
    await expect(page.getByTestId('guiche-RECEPCAO-DO-ANEXO-2')).toContainText('Inativo');
    await page.getByTestId('novo-guiche-RECEPCAO-DO-ANEXO').click();
    await expect(page.getByLabel('Número do guichê')).toHaveValue('3');
    await page.getByLabel('Número do guichê').fill('2');
    await expect(page.getByTestId('recusa-estrutura')).toContainText('já existe nesta recepção');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await semViolacaoAxe(page, '/recepcao/recepcoes (montada)');

    // A tela dos geradores mostra os serviços da recepção nova, com a mesma gravação.
    await page.goto('/recepcao/senhas/geradores');
    await expect(page.getByTestId('tela-geradores')).toBeVisible();
    await expect(page.getByTestId('servicos-RECEPCAO-DO-ANEXO')).toContainText('Atendimento preferencial');
    await expect(page.getByTestId('nova-recepcao')).toHaveCount(0);
    await semViolacaoAxe(page, '/recepcao/senhas/geradores');
    expect(externas).toEqual([]);
  });
});
