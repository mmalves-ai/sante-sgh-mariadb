// E2E @C2-089 (04-HOT L135, manutenção corretiva com oficina e conserto externo): pelo menu, a chefia da manutenção
// cadastra uma oficina terceirizada (validação na hora: terceirizada sem fornecedor, alçada só do aprovador) e põe-se
// como aprovadora, com alçada, na oficina das OS; o setor abre a OS pelo QR, o técnico assume e registra o orçamento;
// a chefia aprova (nunca quem registrou); o técnico envia o equipamento ao fornecedor (termo, nota, CFOP 5.915) e a OS
// passa a aguardar o fornecedor; o equipamento aparece em "fora para conserto"; o retorno devolve a OS ao atendimento.
// Axe sem violação séria em cada estado. Sessão, oficina, fornecedor e equipamento SINTÉTICOS (nada vai à cópia).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();

async function abrirOs(page: Page, id: number): Promise<Locator> {
  await page.goto(`/manutencao/os?os=${id}`);
  const d = page.getByTestId('os-detalhe');
  await expect(d).toBeVisible({ timeout: 30_000 });
  return d;
}

test.describe('manutenção corretiva: oficina, orçamento e conserto externo @C2-089', () => {
  test.setTimeout(300_000);

  test('oficina com aprovador e alçada → orçamento → aprovação → remessa ao fornecedor → retorno; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = Date.now().toString(36).toUpperCase().slice(-5);

    // 1. A chefia chega às oficinas pelo menu e cadastra a terceirizada (a regra do domínio confere na hora).
    await entrar(page, 'SINT.MANUTENCAO');
    await (await itemDoMenu(page, 'Oficinas e conserto externo')).click();
    await expect(page).toHaveURL(/\/manutencao\/oficinas$/);
    const tela = page.getByTestId('tela-manutencao-oficinas');
    await expect(tela.getByTestId('oficina-lista')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/oficinas');

    await tela.getByTestId('oficina-nova').click();
    const form = tela.getByTestId('oficina-form');
    await campo(form.getByTestId('oficina-codigo')).fill(`EXT-${sufixo}`);
    await campo(form.getByTestId('oficina-nome')).fill(`Oficina externa sintética ${sufixo}`);
    await form.getByTestId('oficina-terceirizada').check();
    await expect(form.getByTestId('oficina-problemas')).toContainText('exige a empresa fornecedora');
    await expect(form.getByTestId('oficina-gravar')).toBeDisabled();
    await campo(form.getByTestId('oficina-termo-fornecedor')).fill('SINT');
    await form.getByTestId('oficina-buscar-fornecedor').click();
    await escolher(form.getByTestId('oficina-fornecedor'), { indice: 1 });
    await form.getByTestId('oficina-membro-incluir').click();
    await campo(form.getByTestId('oficina-membro-login-0')).fill('SINT.MANUTENCAO');
    await escolher(form.getByTestId('oficina-membro-funcao-0'), 'Aprovador de orçamento');
    await campo(form.getByTestId('oficina-membro-alcada-0')).fill('5.000,00');
    await form.getByTestId('oficina-servico-incluir').click();
    await escolher(form.getByTestId('oficina-servico-0'), { indice: 1 });
    await expect(form.getByTestId('oficina-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/manutencao/oficinas (cadastro)');
    await form.getByTestId('oficina-gravar').click();
    await expect(tela.getByTestId('oficina-mensagem')).toContainText('Oficina gravada', { timeout: 30_000 });
    await expect(tela.getByTestId(`oficina-EXT-${sufixo}`)).toBeVisible();

    // A chefia também é aprovadora (alçada de R$ 5.000) na oficina que recebe as OS (a primeira da lista ativa).
    await tela.locator('[data-testid^="oficina-editar-"]').first().click();
    await expect(form).toBeVisible();
    await form.getByTestId('oficina-membro-incluir').click();
    const ultimo = form.locator('[data-testid^="oficina-membro-login-"]').last();
    await campo(ultimo).fill('SINT.MANUTENCAO');
    const funcoes = form.locator('[data-testid^="oficina-membro-funcao-"]');
    await escolher(funcoes.last(), 'Aprovador de orçamento');
    await campo(form.locator('[data-testid^="oficina-membro-alcada-"]').last()).fill('5000');
    await form.getByTestId('oficina-gravar').click();
    await expect(tela.getByTestId('oficina-mensagem')).toContainText('Oficina gravada', { timeout: 30_000 });

    // 2. O setor abre a OS pelo QR e o técnico assume.
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    await page.goto('/manutencao/os?abrir=EQ-CC-001');
    const abrir = page.getByTestId('os-form-abrir');
    await expect(abrir).toBeVisible({ timeout: 30_000 });
    await campo(abrir.getByTestId('os-abrir-descricao')).fill('Tela do monitor apagando durante o uso.');
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/manutencao/os') && r.request().method() === 'POST'),
      abrir.getByTestId('os-abrir-gravar').click(),
    ]);
    expect(resposta.status()).toBe(201);
    const aberta = (await resposta.json()) as { id: number; numero: string };

    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    let d = await abrirOs(page, aberta.id);
    await d.getByTestId('os-acao-assumir').click();
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento', { timeout: 30_000 });

    // 3. O técnico registra o orçamento do fornecedor (valor conferido na hora).
    let c = d.getByTestId('os-corretiva');
    await expect(c).toBeVisible();
    await c.getByTestId('os-corretiva-novo-orcamento').click();
    let f = c.getByTestId('os-corretiva-form-orcamento');
    await campo(f.getByTestId('os-orcamento-descricao')).fill(
      'Troca da fonte de alimentação e teste funcional.',
    );
    await campo(f.getByTestId('os-orcamento-valor')).fill('0');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('maior que zero');
    await campo(f.getByTestId('os-orcamento-valor')).fill('1.250,00');
    await campo(f.getByTestId('os-corretiva-termo-fornecedor')).fill('SINT');
    await f.getByTestId('os-corretiva-buscar-fornecedor').click();
    await escolher(f.getByTestId('os-corretiva-fornecedor'), { indice: 1 });
    await semViolacaoAxe(page, '/manutencao/os (orçamento)');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-orcamento-pendente')).toBeVisible({ timeout: 30_000 });
    // Quem registrou não aprova (segregação): a recusa vem do servidor com o texto da aplicação.
    await c.getByTestId('os-orcamento-aprovar').click();
    await expect(c.getByTestId('recusa-manutencao')).toBeVisible({ timeout: 30_000 });

    // 4. A chefia, aprovadora com alçada, aprova; a reprovação sem justificativa é recusada na hora.
    await entrar(page, 'SINT.MANUTENCAO');
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    await c.getByTestId('os-orcamento-reprovar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('pelo menos 10 caracteres');
    await c.getByTestId('os-orcamento-aprovar').click();
    await expect(c.getByTestId('os-orcamento-aprovado')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/os (orçamento aprovado)');

    // 5. O técnico envia o equipamento ao fornecedor: termo, nota e CFOP de remessa para conserto.
    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    await c.getByTestId('os-corretiva-nova-remessa').click();
    f = c.getByTestId('os-corretiva-form-remessa');
    await campo(f.getByTestId('os-remessa-termo')).fill(
      'Monitor com cabo de força, sem sensores; retirado pelo motorista.',
    );
    await campo(f.getByTestId('os-remessa-nota')).fill('900123');
    await escolher(f.getByTestId('os-remessa-cfop'), { rotulo: /5\.915/ });
    await semViolacaoAxe(page, '/manutencao/os (remessa)');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-remessa-enviado')).toBeVisible({ timeout: 30_000 });
    await expect(d.getByTestId('os-situacao')).toContainText(/fornecedor|terceiro/i);

    // 6. O equipamento aparece entre os que estão fora para conserto.
    await page.goto('/manutencao/oficinas');
    await expect(page.getByTestId('oficina-fora')).toContainText(aberta.numero, { timeout: 30_000 });

    // 7. O retorno: sem conserto exige observação; consertado devolve a OS ao atendimento.
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    const r = c.getByTestId('os-corretiva-retorno');
    await escolher(r.getByTestId('os-retorno-resultado'), 'Sem conserto');
    await r.getByTestId('os-retorno-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('pelo menos 10 caracteres');
    await escolher(r.getByTestId('os-retorno-resultado'), 'Consertado');
    await campo(r.getByTestId('os-retorno-nota')).fill('900456');
    await r.getByTestId('os-retorno-gravar').click();
    await expect(c.getByTestId('os-remessa-retornado')).toBeVisible({ timeout: 30_000 });
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento');
    await semViolacaoAxe(page, '/manutencao/os (retorno do conserto)');

    expect(externas).toEqual([]);
  });
});
