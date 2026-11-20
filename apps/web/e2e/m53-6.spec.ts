// E2E @M53.6 (ficha do M53, etapa F5: eSocial de tabela e não periódicos, conciliação; seções 1, 4 a 9 na parte da
// F5): o administrador liga a folha → o departamento pessoal abre o eSocial pelo menu → registra os parâmetros do
// empregador (nova vigência na competência atual) → gera o S-1000 pela prévia conferida no leiaute oficial (XML visível,
// sem pendência) e grava → o evento aparece validado, com o XML no detalhe → monta o lote com o validado → envia ao
// coletor local (confirmação; nada sai da máquina fora de produção) → registra o retorno do evento com o recibo → o
// evento fica aceito → a conciliação da competência mostra a situação e registra a conferência com a contagem do sistema
// externo → quem só consulta vê os eventos e os lotes sem gerar, sem montar lote e sem a ficha. Axe sem violação séria
// em cada estado. Sessão real sobre a fonte sintética de dev; eSocial, pessoas e folha em MEMÓRIA (nada vai à cópia);
// CNPJ sintético; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function chave(page: Page, recurso: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)', {
    timeout: 30_000,
  });
}
/** Registra a conferência e liga o recurso (se outro cenário já o ligou, segue). */
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, evidencia);
}

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();
const marcar = (page: Page, id: string, valor: string) =>
  page.getByTestId(id).locator(`input[type="checkbox"][data-valor="${valor}"]`).check();

async function abrirEsocial(page: Page): Promise<void> {
  await page.goto('/pessoas/esocial');
  await expect(page.getByRole('heading', { level: 1, name: 'eSocial' })).toBeVisible();
  await expect(page.getByTestId('esocial-filtros')).toBeVisible({ timeout: 30_000 });
}

test.describe('folha de pagamento, etapa F5: eSocial de tabela e não periódicos, conciliação @M53.6', () => {
  test.setTimeout(600_000);
  test.use({ actionTimeout: 60_000 });

  test('ligar → menu → parâmetros → S-1000 pela prévia → gravar → lote → coletor → retorno → conciliação → consulta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // O administrador liga a folha (gerar, gravar e entregar ao coletor seguem a chave da folha; D-CHAVE-536).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.6)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.6)');

    // O departamento pessoal abre o eSocial pelo menu: fora de produção, o destino é o coletor local.
    await entrar(page, 'SINT.DP.FOLHA');
    await (await itemDoMenu(page, 'eSocial')).click();
    await expect(page).toHaveURL(/\/pessoas\/esocial/);
    await expect(page.getByTestId('esocial-transmissao')).toContainText('coletor local', { timeout: 30_000 });
    await expect(page.getByTestId('esocial-so-consulta')).toHaveCount(0);
    await expect(page.getByTestId('esocial-sem-cnpj')).toHaveCount(0);
    await expect(page.getByTestId('esocial-eventos')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/esocial (eventos)');

    // Parâmetros do empregador: nova vigência na competência atual (o padrão do formulário).
    await page.getByTestId('esocial-aba-parametros').click();
    await expect(page.getByTestId('esocial-parametros')).toBeVisible();
    await expect(
      page
        .getByTestId('esocial-parametros-vazio')
        .or(page.locator('[data-testid^="esocial-vigencia-"]').first()),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('esocial-leiaute-catalogo')).toContainText('S-1000');
    const hoje = new Date();
    const competencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    if ((await page.getByTestId(`esocial-vigencia-${competencia}`).count()) === 0) {
      await page.getByTestId('esocial-parametros-nova').click();
      await expect(page.getByTestId('esocial-parametros-form')).toBeVisible();
      await campo(page, 'esocial-param-classTrib').fill('99');
      await campo(page, 'esocial-param-cnae').fill('8610101');
      // FAP fora da faixa (0,5 a 2): a tela aponta o campo antes de gravar.
      await campo(page, 'esocial-param-fap').fill('9,9');
      await campo(page, 'esocial-param-lotacao').fill('LOT01');
      await campo(page, 'esocial-param-fpas').fill('515');
      await campo(page, 'esocial-param-tercs').fill('0115');
      await campo(page, 'esocial-param-tabrubr').fill('SANTE');
      await page.getByTestId('esocial-param-gravar').click();
      await expect(page.getByTestId('esocial-param-invalido')).toContainText('FAP');
      await semViolacaoAxe(page, '/pessoas/esocial (parâmetros, campo inválido)');
      await campo(page, 'esocial-param-fap').fill('1,0000');
      await page.getByTestId('esocial-param-gravar').click();
      await expect(page.getByTestId('esocial-parametros-aviso')).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByTestId(`esocial-vigencia-${competencia}`)).toContainText('8610101');
    await semViolacaoAxe(page, '/pessoas/esocial (parâmetros)');

    // S-1000 pela prévia conferida no leiaute oficial: XML visível, sem pendência; nada gravado ainda.
    await page.getByTestId('esocial-aba-eventos').click();
    await expect(page.getByTestId('esocial-eventos')).toBeVisible();
    await page.getByTestId('esocial-gerar-tabela').click();
    await expect(page.getByTestId('esocial-tabela-form')).toBeVisible();
    await expect(page.getByTestId('esocial-tabela-previa')).toBeDisabled();
    await marcar(page, 'esocial-tabela-eventos', 'S-1000');
    await semViolacaoAxe(page, '/pessoas/esocial (gerar os de tabela)');
    await page.getByTestId('esocial-tabela-previa').click();
    const resultado = page.getByTestId('esocial-resultado');
    await expect(resultado).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('esocial-resultado-valido-0')).toContainText('leiaute oficial');
    await expect(resultado).toContainText('evtInfoEmpregador');
    await expect(page.getByTestId('esocial-resultado-pendencias-0')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/esocial (prévia do S-1000)');
    await page.getByTestId('esocial-resultado-gravar').click();
    await expect(page.getByTestId('esocial-eventos-aviso')).toContainText('1 evento(s) gravado(s)', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('esocial-resultado-gravar')).toHaveCount(0);
    await page.getByTestId('esocial-resultado-fechar').click();
    await expect(resultado).toHaveCount(0);

    // O evento gravado aparece validado; o detalhe mostra o identificador e o XML.
    const linha = page.locator('tr[data-testid^="esocial-evento-"]', { hasText: 'S-1000' }).first();
    await expect(linha).toBeVisible({ timeout: 30_000 });
    const idEvento =
      /^esocial-evento-(\d+)$/.exec((await linha.getAttribute('data-testid')) ?? '')?.[1] ?? '';
    expect(idEvento).toMatch(/^\d+$/);
    await page.getByTestId(`esocial-evento-ver-${idEvento}`).click();
    await expect(page.getByTestId('esocial-evento-xml')).toContainText('evtInfoEmpregador', {
      timeout: 30_000,
    });
    await semViolacaoAxe(page, '/pessoas/esocial (detalhe do evento)');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('esocial-evento-detalhe')).toHaveCount(0);

    // Monta o lote com o validado.
    await expect(page.getByTestId('esocial-escolha-lote')).toBeVisible();
    await marcar(page, 'esocial-escolha-eventos', idEvento);
    await expect(page.getByTestId('esocial-escolha-texto')).toContainText('1 evento(s)');
    await page.getByTestId('esocial-montar-lote').click();
    await expect(page.getByTestId('esocial-eventos-aviso')).toContainText(
      /Lote \d+ montado com 1 evento\(s\)/,
      {
        timeout: 30_000,
      },
    );
    const idLote =
      /Lote (\d+) montado/.exec(await page.getByTestId('esocial-eventos-aviso').innerText())?.[1] ?? '';
    expect(idLote).toMatch(/^\d+$/);

    // Envia ao coletor local com a confirmação.
    await page.getByTestId('esocial-aba-lotes').click();
    const lote = page.getByTestId(`esocial-lote-${idLote}`);
    await expect(lote).toBeVisible({ timeout: 30_000 });
    await expect(lote).toContainText('Coletor local');
    await semViolacaoAxe(page, '/pessoas/esocial (lotes)');
    await page.getByTestId(`esocial-lote-enviar-${idLote}`).click();
    const confirmacao = page.getByTestId('confirmacao');
    await expect(confirmacao).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/esocial (confirmar o envio)');
    await confirmacao.getByRole('button').last().click();
    await expect(page.getByTestId('esocial-lotes-aviso')).toContainText(`Lote ${idLote} enviado`, {
      timeout: 30_000,
    });

    // Retorno do evento: aceito com o recibo (nenhum recibo inventado: quem registra informa).
    await page.getByTestId(`esocial-lote-retorno-${idLote}`).click();
    await expect(page.getByTestId('esocial-retorno-form')).toBeVisible();
    await expect(page.getByTestId('esocial-retorno-gravar')).toBeDisabled();
    await campo(page, `esocial-retorno-recibo-${idEvento}`).fill('1.1.0000000000000000001');
    await campo(page, `esocial-retorno-codigo-${idEvento}`).fill('201');
    await campo(page, `esocial-retorno-descricao-${idEvento}`).fill('Sucesso (E2E M53.6)');
    await semViolacaoAxe(page, '/pessoas/esocial (retorno do lote)');
    await page.getByTestId('esocial-retorno-gravar').click();
    await expect(page.getByTestId('esocial-lotes-aviso')).toContainText(
      `Retorno do lote ${idLote} registrado`,
      {
        timeout: 30_000,
      },
    );
    await page.getByTestId('esocial-aba-eventos').click();
    await expect(page.getByTestId(`esocial-evento-${idEvento}`)).toContainText('1.1.0000000000000000001', {
      timeout: 30_000,
    });

    // Conciliação da competência: a situação por evento e a conferência com a contagem do sistema externo.
    await page.getByTestId('esocial-aba-conciliacao').click();
    await expect(page.getByTestId('esocial-conciliacao')).toBeVisible();
    await expect(page.getByTestId('esocial-conciliacao-transmissor')).toContainText('Este sistema', {
      timeout: 30_000,
    });
    // Os eventos de autônomo do repasse (RPA: 3 recibos sintéticos na competência) entram na linha do S-1200, que este
    // sistema transmite nos periódicos (ficha, seção 10: painel de conciliação com os eventos de RPA).
    await expect(page.getByTestId('esocial-conciliacao-repasse-S-1200')).toHaveText('3', { timeout: 30_000 });
    await expect(page.getByTestId('esocial-conciliacao-situacao-S-1200')).toContainText(
      'Repasse nos periódicos deste sistema',
    );
    const externos = page.locator('[data-testid^="esocial-conciliacao-externo-"]');
    await expect(externos.first()).toBeVisible();
    const n = await externos.count();
    for (let i = 0; i < n; i++) await externos.nth(i).locator('input').first().fill('0');
    await campo(page, 'esocial-conciliacao-observacao').fill('Conferência sintética (E2E M53.6)');
    await semViolacaoAxe(page, '/pessoas/esocial (conciliação)');
    await page.getByTestId('esocial-conciliacao-conferir').click();
    await expect(page.getByTestId('esocial-conciliacao-conferida')).toContainText('SINT.DP.FOLHA', {
      timeout: 30_000,
    });

    // Pendências acumuladas: só a contagem.
    await page.getByTestId('esocial-aba-pendencias').click();
    await expect(
      page.getByTestId('esocial-pendencias-total').or(page.getByTestId('esocial-pendencias-vazio')),
    ).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/esocial (pendências)');

    // Quem só consulta vê os eventos e os lotes, sem gerar, sem montar lote, sem a ficha e sem enviar.
    await entrar(page, 'SINT.ESOCIAL.CONSULTA');
    await abrirEsocial(page);
    await expect(page.getByTestId('esocial-so-consulta')).toBeVisible();
    await expect(page.getByTestId(`esocial-evento-${idEvento}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('esocial-gerar-tabela')).toHaveCount(0);
    await expect(page.getByTestId('esocial-escolha-lote')).toHaveCount(0);
    await expect(page.getByTestId('esocial-aba-fichas')).toHaveCount(0);
    await expect(page.getByTestId(`esocial-evento-descartar-${idEvento}`)).toHaveCount(0);
    // O detalhe sem o XML (o XML só com `pessoas.esocial.gerar`).
    await page.getByTestId(`esocial-evento-ver-${idEvento}`).click();
    await expect(page.getByTestId('esocial-evento-detalhe')).toContainText('1.1.0000000000000000001', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('esocial-evento-xml')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('esocial-evento-detalhe')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/esocial (consulta)');
    await page.getByTestId('esocial-aba-lotes').click();
    await expect(page.getByTestId(`esocial-lote-${idLote}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="esocial-lote-enviar-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="esocial-lote-retorno-"]')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
