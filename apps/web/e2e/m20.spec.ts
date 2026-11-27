// E2E @M20 (ficha, seção 10): a senha chamada no guichê abre o atendimento (consulta), a pulseira sai na fila da
// estação, o consultório chama e atende o paciente pela fila do local e a recepção encerra; no pronto atendimento, o
// médico registra a etapa no quadro, tira e põe o paciente na observação e registra a alta. axe sem violação séria em
// cada tela. Correções da revisão: a abertura pelo agendamento (preenchida pela marcação) até a fila; o paciente não
// identificado e a identificação pendente; a ficha em PDF como arquivo do navegador; o PA liberado pela outra ponta à
// parte no quadro; o leito livre depois do desfecho; o painel de indicadores do período. Sessão real sobre a fonte
// sintética de dev e as portas da recepção e do atendimento em MEMÓRIA (senhas, fichas, contas e leitos SINTÉTICOS;
// nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Atendimento ambulatorial e pronto atendimento @M20 @fase2', () => {
  test.setTimeout(180_000);

  test('senha → abertura → pulseira → fila do consultório (chamar, atender) → encerramento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');

    // Guichê: abrir o guichê 4, emitir a senha do balcão e chamá-la.
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('4');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 4 aberto');
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    await page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'Balcão' })
      .first()
      .getByRole('button')
      .click();
    await expect(page.getByTestId('senha-atual')).toHaveText(/^BL \d{3}$/);
    await page.getByTestId('abrir-atendimento-atual').click();

    // Abertura a partir da senha: consulta do paciente do cadastro.
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/atendimento/novo');
    await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
    await page.getByTestId('abrir-atd-buscar').click();
    await page.getByTestId('abrir-atd-paciente-1001').click();
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toContainText('JOSÉ DA SILVA');
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
    await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
    await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await expect(page.getByTestId('abrir-atd-procedimento')).toHaveValue('10101012');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await expect(page.getByTestId('abrir-atd-cid-escolhido')).toContainText('R509');
    await page.getByTestId('botao-abrir-atendimento').click();

    // Impressos: a pulseira na fila da impressora da estação.
    await expect(page.getByTestId('tela-impressos')).toBeVisible();
    await expect(page.getByTestId('atendimento-aberto')).toBeVisible();
    const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);
    expect(reg).toBeGreaterThan(0);
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/impressos');
    await page.getByTestId('emitir-pulseira').click();
    await expect(page.getByTestId('impresso-emitido')).toContainText('impressora da estação');
    // A ficha em PDF abre numa aba nova por endereço blob: (nunca data:, que o navegador bloqueia). O conversor de
    // PDF do servidor não roda no E2E (sem serviço externo): a resposta da emissão da ficha é um PDF SINTÉTICO no
    // mesmo formato do contrato; o que se prova aqui é a tela abrir o arquivo.
    await page.route(`**/api/atendimento/${reg}/impressos`, async (rota) => {
      const corpo = rota.request().postDataJSON() as { impresso?: string } | null;
      if (rota.request().method() !== 'POST' || corpo?.impresso !== 'ficha') return rota.fallback();
      await rota.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          impresso: 'ficha',
          formato: 'pdf',
          conteudo: Buffer.from('%PDF-1.4\n% SINTETICO\n%%EOF\n').toString('base64'),
          nomeArquivo: `ficha-${reg}.pdf`,
          fila: null,
        }),
      });
    });
    const aba = page.waitForEvent('popup');
    await page.getByTestId('emitir-ficha').click();
    const nova = await aba;
    expect(nova.url()).toMatch(/^blob:/);
    await nova.close();
    await expect(page.getByTestId('impresso-emitido')).toContainText('PDF gerado');
    await expect(page.getByTestId('abrir-pdf')).toHaveAttribute('href', /^blob:/);

    // Lista do dia (a recepção ambulatorial, com a alteração do convênio): o atendimento novo, com os atalhos.
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto('/recepcao/atendimento?acao=segurado');
    await expect(page.getByTestId(`atendimento-${reg}`)).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/atendimento');
    await page.getByTestId(`atd-segurado-${reg}`).click();
    await expect(page.getByTestId('tela-segurado')).toBeVisible();
    await page.getByLabel('Plano').fill('PLANO EMPRESARIAL');
    await page.getByTestId('botao-gravar-segurado').click();
    await expect(page.getByTestId('segurado-gravado')).toContainText('convênio gravados');
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/segurado');

    // Fila do consultório 01: o paciente aguarda; chamar e iniciar o atendimento.
    await page.goto('/consultorio/fila?local=3');
    await expect(page.getByTestId('tela-fila-consultorio')).toBeVisible();
    await expect(page.getByTestId(`fila-situacao-${reg}`)).toContainText('Aguardando');
    await semViolacaoAxe(page, '/consultorio/fila');
    await page.getByTestId(`fila-chamar-${reg}`).click();
    await expect(page.getByTestId('fila-mensagem')).toContainText('chamado');
    await expect(page.getByTestId(`fila-situacao-${reg}`)).toContainText('Chamado');
    await page.getByTestId(`fila-atender-${reg}`).click();
    await expect(page.getByTestId(`fila-situacao-${reg}`)).toContainText('Em atendimento');
    // A linha leva ao prontuário do paciente (a leitura do prontuário é auditada no PEP).
    await expect(page.getByTestId(`fila-pep-${reg}`)).toHaveAttribute('href', '/pep/paciente/1001');

    // Encerrar: a recepção não vê o ato médico; o encerramento administrativo libera o paciente.
    await page.getByTestId(`fila-encerrar-${reg}`).click();
    await expect(page.getByTestId('tela-encerrar')).toBeVisible();
    await expect(page.getByLabel('Alta', { exact: true })).toHaveCount(0);
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/encerrar');
    await page.getByLabel('Encerramento administrativo').check();
    await page.getByTestId('botao-encerrar').click();
    await expect(page.getByTestId('encerrado')).toContainText('Atendimento encerrado');
    await expect(page.getByTestId('situacao-atendimento')).toContainText('Encerramento administrativo');
    expect(externas).toEqual([]);
  });

  test('pronto atendimento: quadro, etapa, observação e alta pelo médico; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO.PA');
    await page.goto('/pa/quadro');
    await expect(page.getByTestId('tela-quadro-pa')).toBeVisible();
    const obs = page.getByTestId('coluna-observacao');
    await expect(obs).toContainText('MARIA APARECIDA');
    await semViolacaoAxe(page, '/pa/quadro');
    const cartao = obs.locator('[data-testid^="cartao-"]').first();
    const reg = Number((await cartao.getAttribute('data-testid'))!.replace('cartao-', ''));
    await escolher(page.getByTestId(`etapa-${reg}`), 'exames');
    await page.getByTestId(`registrar-etapa-${reg}`).click();
    await expect(page.getByTestId('quadro-mensagem')).toContainText('Etapa registrada');
    await expect(page.getByTestId('coluna-exames')).toContainText('MARIA APARECIDA');

    // Observação: tirar do leito 1 e pôr no leito 2.
    await page.goto('/pa/observacao');
    await expect(page.getByTestId('tela-observacao-pa')).toBeVisible();
    await expect(page.getByTestId('leito-1')).toContainText('MARIA APARECIDA');
    await semViolacaoAxe(page, '/pa/observacao');
    await page.getByTestId('obs-liberar-1').click();
    await page.getByTestId('obs-confirmar-saida').click();
    await expect(page.getByTestId('obs-mensagem')).toContainText('saiu da observação');
    await expect(page.getByTestId('leito-1')).toContainText('Livre');
    await escolher(page.getByTestId('obs-paciente-2'), String(reg));
    await page.getByTestId('obs-alocar-2').click();
    await expect(page.getByTestId('obs-mensagem')).toContainText('em observação');
    await expect(page.getByTestId('leito-2')).toContainText('MARIA APARECIDA');

    // Desfecho do PA: a alta é ato médico (o médico com conselho registra); o paciente sai do quadro.
    await page.goto(`/pa/desfecho/${reg}`);
    await expect(page.getByTestId('tela-desfecho-pa')).toBeVisible();
    await semViolacaoAxe(page, '/pa/desfecho/:reg');
    await page.getByLabel('Alta', { exact: true }).check();
    await page.getByTestId('botao-desfecho-pa').click();
    await expect(page.getByTestId('tela-quadro-pa')).toBeVisible();
    await expect(page.getByTestId(`cartao-${reg}`)).toHaveCount(0);
    // O PA liberado do local pela outra ponta (sem desfecho codificado) fica à parte, nunca como aguardando.
    await expect(page.getByTestId('quadro-saidas')).toContainText('liberado do local');
    await expect(page.getByTestId('quadro-saidas')).toContainText('JOSÉ DA SILVA');
    // O desfecho tirou a paciente do leito 2 (o leito não fica preso).
    await page.goto('/pa/observacao');
    await expect(page.getByTestId('leito-2')).toContainText('Livre');
    expect(externas).toEqual([]);
  });

  test('agendamento → abertura preenchida → fila; não identificado e a identificação; indicadores; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ATENDIMENTO');
    // A abertura pelo agendamento do dia: a marcação preenche o paciente, o convênio, o profissional e o resto.
    await page.goto('/recepcao/atendimento/novo?marcacao=880001');
    await expect(page.getByTestId('abrir-atd-do-agendamento')).toContainText('08:00');
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toContainText('LETÍCIA ROCHA');
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await esperarValor(ficha.getByLabel('Convênio', { exact: true }), '306');
    await esperarValor(ficha.getByLabel('Especialidade', { exact: true }), '15');
    // O agendamento não traz o profissional (como na cópia): a recepção escolhe entre os da especialidade.
    await esperarValor(ficha.getByLabel('Profissional', { exact: true }), '');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await esperarValor(ficha.getByLabel('Unidade', { exact: true }), '1');
    await expect(page.getByTestId('abrir-atd-procedimento')).toHaveValue('10101012');
    await semViolacaoAxe(page, '/recepcao/atendimento/novo?marcacao');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await page.getByTestId('botao-abrir-atendimento').click();
    await expect(page.getByTestId('tela-impressos')).toBeVisible();
    const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);
    await page.goto('/consultorio/fila?local=3');
    await expect(page.getByTestId(`fila-${reg}`)).toContainText('agendado 08:00');
    await expect(page.getByTestId(`fila-situacao-${reg}`)).toContainText('Aguardando');

    // Paciente não identificado da emergência: o cadastro temporário recebe a marca e a ficha do PA abre.
    await page.goto('/recepcao/atendimento/novo');
    await page.getByTestId('abrir-atd-termo').fill('CINTHYA');
    await page.getByTestId('abrir-atd-buscar').click();
    await page.getByTestId('abrir-atd-paciente-1003').click();
    await page.getByTestId('abrir-atd-nao-identificado').check();
    await page
      .getByLabel('Características para a identificação (sem nome)')
      .fill('Mulher adulta, casaco vermelho');
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'pa');
    await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
    await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await escolher(ficha.getByLabel('Unidade', { exact: true }), '3');
    await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300400');
    await page.getByTestId('abrir-atd-procedimento').fill('10101039');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await page.getByTestId('botao-abrir-atendimento').click();
    await expect(page.getByTestId('tela-impressos')).toBeVisible();

    // A identificação pendente na lista do dia: escolher o cadastro da pessoa encerra a marca.
    await page.goto('/recepcao/atendimento');
    await page.getByTestId('identificacao-pendente').locator('summary').click();
    await expect(page.getByTestId('nao-identificado-1003')).toContainText('casaco vermelho');
    await semViolacaoAxe(page, 'identificação pendente');
    await page.getByTestId('identificar-1003').click();
    await page.getByTestId('identificar-termo').fill('JOSE DA SILVA');
    await page.getByTestId('identificar-termo').press('Enter');
    await page.getByTestId('identificar-destino-1001').click();
    await expect(page.getByTestId('identificacao-mensagem')).toContainText('Identificação registrada');
    await expect(page.getByTestId('nao-identificado-1003')).toHaveCount(0);

    // A busca da lista do dia e o painel de indicadores do período.
    await page.getByTestId('dia-atd-termo').fill('ROCHA');
    await page.getByTestId('dia-atd-buscar').click();
    await expect(page.getByTestId(`atendimento-${reg}`)).toBeVisible();
    await page.getByTestId('link-indicadores').click();
    await expect(page.getByTestId('tela-indicadores-atendimento')).toBeVisible();
    await expect(page.getByTestId('ind-atd-pa')).toContainText('atendimento(s)');
    await expect(page.getByTestId('ind-atd-evasao')).toContainText('Evasão');
    await semViolacaoAxe(page, '/recepcao/atendimento/indicadores');
    expect(externas).toEqual([]);
  });
});
