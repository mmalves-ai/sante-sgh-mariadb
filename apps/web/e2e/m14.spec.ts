// E2E @M14 (ficha, seção 10): o administrador acha um domínio no catálogo, inclui e inativa um item num domínio
// editável e não consegue num travado nem num oficial; o laboratório abre um exame e o histórico de referência; o
// auditor abre a trilha com filtro de período e exporta consulta com dado de pessoa (justificativa); o usuário de RH vê a consulta de colaboradores com o aviso de fase;
// o painel da matriz. Sessão real sobre a fonte sintética de dev (usuários sintéticos), domínios e consultas em
// MEMÓRIA (nada vai à cópia); axe sem violação séria em cada tela.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('domínios em massa, consultas e matriz @M14', () => {
  test('catálogo: acha o domínio, inclui e inativa; travado e oficial sem edição; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/dominios');
    await page.getByTestId('busca-catalogo').fill('caráter da cirurgia');
    await expect(page.getByTestId('dominio-cirurgia.caraterCirurgia')).toBeVisible();
    await expect(page.getByTestId('marcador-cirurgia.caraterCirurgia')).toHaveText('editável');
    await semViolacaoAxe(page, '/cadastros/dominios (catálogo)');
    await page.getByTestId('dominio-cirurgia.caraterCirurgia').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caráter da cirurgia' })).toBeVisible();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Descrição').fill('Caráter sintético E2E');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    const linha = page
      .getByTestId('tabela-dominio')
      .locator('tbody tr', { hasText: 'Caráter sintético E2E' });
    const codigo = (await linha.locator('td').first().innerText()).trim();
    await page.getByTestId(`inativar-${codigo}`).click();
    // Revisão do W0-02: a inativação pede o motivo (diálogo de gravação).
    await page
      .getByTestId('form-gravacao')
      .getByTestId('dialogo-motivo')
      .fill('Não é mais usado (teste E2E)');
    await page.getByTestId('form-gravacao').getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Inativado');
    await semViolacaoAxe(page, '/cadastros/dominios/cirurgia/caraterCirurgia');
    // Travado (regra 6) e oficial (regra 4): só consulta, sem incluir.
    await page.goto('/cadastros/dominios');
    await escolher(page.getByTestId('filtro-natureza'), 'travado');
    await expect(page.getByTestId('dominio-agenda.situacaoAgenda')).toBeVisible();
    await page.getByTestId('dominio-agenda.situacaoAgenda').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Situações de agenda' })).toBeVisible();
    await expect(page.getByText(/Só consulta: travado/)).toBeVisible();
    await expect(page.getByTestId('botao-incluir')).toHaveCount(0);
    await page.goto('/cadastros/dominios/pep/motivoAlta');
    await expect(page.getByRole('heading', { level: 1, name: 'Motivos de alta' })).toBeVisible();
    await expect(page.getByTestId('botao-incluir')).toHaveCount(0);
    await semViolacaoAxe(page, 'domínio oficial');
    expect(externas).toEqual([]);
  });

  test('laboratório: exame, elementos do exame e histórico de referência; axe', async ({ page }) => {
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/cadastros/exames');
    await expect(page.getByTestId('grupo-dominios-exames')).toBeVisible();
    await expect(page.getByTestId('tela-dominio-sadt.exame')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/exames');
    await page
      .getByTestId('tela-dominio-sadt.exame')
      .getByRole('button', { name: 'Ver os itens' })
      .first()
      .click();
    await expect(page.getByTestId('grupo-detalhes')).toBeVisible();
    await expect(page.getByTestId('tela-dominio-sadt.elemento').getByTestId('tabela-dominio')).toBeVisible();
    // Correção do M14: o histórico de referência do exame escolhido abre já filtrado por ele.
    const historico = page
      .getByTestId('grupo-detalhes')
      .getByTestId('tela-consulta-sadt.versaoFaixasReferenciaExame');
    await expect(historico.getByTestId('consulta-filtrada')).toBeVisible();
    await expect(historico.getByTestId('contagem')).toBeVisible();
    await semViolacaoAxe(page, 'exame com o histórico filtrado');
    // Histórico de valores de referência (consulta somente leitura do item).
    await escolher(page.getByTestId('grupo-escolha'), { rotulo: /faixas de referência por exame/i });
    await expect(page.getByTestId('tabela-consulta')).toBeVisible();
    await semViolacaoAxe(page, 'histórico de referência');
  });

  test('auditor: trilha grande só com período; axe', async ({ page }) => {
    await entrar(page, 'SINT.AUDITOR');
    await page.goto('/consultas/auditoria/trilha');
    await expect(page.getByTestId('aviso-exige-filtro')).toBeVisible();
    await expect(page.getByTestId('tabela-consulta')).toHaveCount(0);
    await page.getByTestId('de-dataHoraAcao').fill('2026-07-01');
    await page.getByTestId('ate-dataHoraAcao').fill('2026-07-31');
    await page.getByTestId('consultar').click();
    await expect(page.getByTestId('tabela-consulta')).toBeVisible();
    await expect(page.getByTestId('contagem')).toContainText('registro');
    await expect(page.getByTestId('anterior')).toBeVisible();
    await semViolacaoAxe(page, '/consultas/auditoria/trilha');
    // Correção do M14: o auditor exporta consulta de conteúdo clínico escolhendo a justificativa (rota das consultas;
    // ele não lê o domínio das justificativas).
    await page.goto('/consultas/pep/vinculoDocumentoProntuarioAssinaturaExam');
    await expect(page.getByTestId('tabela-consulta')).toBeVisible();
    await expect(page.getByTestId('sem-justificativas')).toHaveCount(0);
    // A opção 0 é "escolha" (vazia); a 1 é a primeira justificativa.
    const justificativa = page.getByTestId('justificativa');
    await expect.poll(async () => (await rotulosDoCombo(justificativa)).length).toBeGreaterThan(1);
    await escolher(justificativa, { indice: 1 });
    await page.getByTestId('exportar').click();
    await expect(page.getByText('Exportação registrada na trilha de auditoria.')).toBeVisible();
    await semViolacaoAxe(page, 'exportação de consulta clínica pelo auditor');
  });

  // M52.1: o cadastro de colaboradores ganhou a tela própria; a consulta provisória da Fase 6 segue no ponto eletrônico.
  test('RH: consulta provisória do ponto eletrônico com o aviso da fase; axe', async ({ page }) => {
    await entrar(page, 'SINT.RH');
    await page.goto('/consultas/item/gestao-de-pessoas.ponto-eletronico-marcacoes-justificativas');
    await expect(page.getByTestId('aviso-fase')).toContainText('Fase 6');
    await expect(page.getByTestId('tabela-consulta')).toBeVisible();
    await semViolacaoAxe(page, 'consulta provisória do ponto eletrônico');
  });

  test('painel da matriz de cobertura; axe', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/matriz');
    await expect(page.getByTestId('matriz-resumo')).toContainText('1503 tabelas com dados');
    await expect(page.getByTestId('matriz-resumo')).toContainText('50 descartadas');
    await escolher(page.getByTestId('matriz-atendimento'), 'descartada');
    await expect(page.getByTestId('matriz-tabelas').locator('tbody tr')).toHaveCount(50);
    await semViolacaoAxe(page, '/administracao/coexistencia/matriz');
  });
});
