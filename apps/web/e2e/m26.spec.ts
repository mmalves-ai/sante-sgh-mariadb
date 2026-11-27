// E2E @M26 (ficha, seção 10): a jornada J4 inteira — o médico pede o potássio no prontuário → a coleta lê a pulseira e
// a amostra nasce com o código único (a etiqueta vai à fila da estação) → o laboratório recebe o pedido → digita o
// valor crítico → libera confirmando o crítico (o aviso sai na hora) → registra a comunicação → emite o laudo (PDF/A
// como arquivo do navegador) → o médico dá a ciência no prontuário e o painel mostra "Com ciência"; o laudo de imagem
// pelo médico laudador; o orçamento convertido em lançamento; o portal do paciente (protocolo e nascimento) e o do
// médico externo (autocadastro aprovado, segundo fator, só os pedidos dele). axe sem violação séria em cada tela. O PDF/A
// do laudo vem do serviço de emissão (provado na integração da API, com o veraPDF); aqui, a tela baixa o arquivo. Sessão
// real sobre a fonte sintética de dev e as portas em MEMÓRIA (exames, resultados e amostras SINTÉTICOS; nada vai à
// cópia).
import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
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

async function sair(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1), como o do celular do médico. */
function totp(segredoBase32: string, agora = Date.now()): string {
  const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of segredoBase32.replace(/=+$/, '').toUpperCase())
    bits += ALF.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(agora / 1000 / 30)));
  const h = createHmac('sha1', bytes).update(passo).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

test.describe('SADT, laudos e portal de resultados @M26 @fase2', () => {
  test.setTimeout(240_000);

  test('J4: pedido no prontuário → coleta → recebimento → resultado crítico → liberação → laudo → ciência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O médico pede o potássio no prontuário do paciente internado.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/exames');
    await page.getByTestId('incluir-exame-502').click();
    await page.getByTestId('enviar-pedido').click();
    // O servidor da rodada é compartilhado: outro spec pode ter pedido o potássio deste paciente nas últimas 24 horas,
    // e então o pedido repetido só sai com os avisos conferidos (regra do pedido, que não se afrouxa aqui).
    const enviado = page.getByTestId('aba-exames-conteudo').getByText('Pedido enviado.');
    await expect(enviado.or(page.getByTestId('avisos-pedido'))).toBeVisible();
    if (!(await enviado.isVisible())) {
      await page.getByTestId('confirmar-avisos').check();
      await page.getByTestId('enviar-pedido').click();
    }
    await expect(page.getByTestId('aba-exames-conteudo')).toContainText('Pedido enviado.');
    await sair(page);

    // Coleta: o grupo do potássio (internado: a pulseira lida); a amostra com o código único.
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/coleta');
    await expect(page.getByTestId('tela-sadt-coleta')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/coleta');
    const grupo = page.locator('[data-testid^="coleta-grupo-"]').filter({ hasText: 'POTÁSSIO' }).first();
    await expect(grupo).toBeVisible();
    const indice = (await grupo.getAttribute('data-testid'))!.replace('coleta-grupo-', '');
    await page.getByTestId(`coleta-pulseira-${indice}`).fill('P1003|A31338');
    await page.getByTestId(`coleta-conferido-${indice}`).check();
    await page.getByTestId(`coleta-coletar-${indice}`).click();
    await expect(page.getByTestId('recusa-sadt')).toContainText('pulseira lida não é do paciente');
    await page.getByTestId(`coleta-pulseira-${indice}`).fill('P1001|A31337');
    await page.getByTestId(`coleta-coletar-${indice}`).click();
    await expect(page.getByTestId('coleta-mensagem')).toContainText(/Amostra [0-9A-Z]{10} coletada/);
    const codigo = /Amostra ([0-9A-Z]{10})/.exec(
      (await page.getByTestId('coleta-mensagem').textContent()) ?? '',
    )![1]!;

    // Rastreio: a amostra recebida no laboratório.
    await page.goto('/sadt/amostras');
    await page.getByTestId('amostra-codigo').fill(codigo);
    await page.getByTestId('amostra-achar').click();
    await escolher(page.getByTestId(`amostra-estado-${codigo}`), 'recebida');
    await page.getByTestId(`amostra-mudar-${codigo}`).click();
    await expect(page.getByTestId('amostra-mensagem')).toContainText('Recebida no laboratório');
    await semViolacaoAxe(page, '/sadt/amostras');

    // Recebimento do pedido do prontuário no setor.
    await page.goto('/sadt/exames');
    await expect(page.getByTestId('tela-sadt-exames')).toBeVisible();
    const linha = page
      .locator('[data-testid^="sadt-exame-"]')
      .filter({ hasText: 'POTÁSSIO' })
      .filter({ hasText: 'Pedido do prontuário' })
      // Ainda a receber (servidor compartilhado: o potássio já recebido por outro spec não tem a seleção).
      .filter({ has: page.locator('[data-testid^="sadt-selecionar-"]') })
      .first();
    const id = Number((await linha.getAttribute('data-testid'))!.replace('sadt-exame-', ''));
    await page.getByTestId(`sadt-selecionar-${id}`).check();
    await page.getByTestId('sadt-receber').click();
    await expect(page.getByTestId('sadt-mensagem')).toContainText('Pedido recebido');
    await expect(page.getByTestId(`sadt-estado-${id}`)).toContainText('Recebido');
    await semViolacaoAxe(page, '/sadt/exames');

    // Digitação: o valor crítico destacado enquanto digita.
    await page.goto(`/sadt/resultados/digitacao?exame=${id}`);
    await expect(page.getByTestId('digitacao-ficha')).toBeVisible();
    await page.getByTestId('digitacao-valor-0').fill('7,2');
    await expect(page.getByTestId('digitacao-marca-0')).toContainText('Valor crítico');
    await page.getByTestId('digitacao-gravar').click();
    await expect(page.getByTestId('digitacao-mensagem')).toContainText('Resultado digitado');
    await semViolacaoAxe(page, '/sadt/resultados/digitacao');

    // Liberação: o crítico pede a confirmação; o aviso sai ao responsável.
    await page.goto('/sadt/resultados/liberacao');
    await expect(page.getByTestId(`liberacao-${id}`)).toBeVisible();
    await expect(page.getByTestId(`liberacao-liberar-${id}`)).toBeDisabled();
    await page.getByTestId(`liberacao-confirmar-${id}`).check();
    await page.getByTestId(`liberacao-liberar-${id}`).click();
    await expect(page.getByTestId('liberacao-mensagem')).toContainText('aviso do valor crítico');
    await semViolacaoAxe(page, '/sadt/resultados/liberacao');
    // Os liberados (filtrados pela data; o de outro dia também se retifica); a retificação mostra as versões.
    await expect(page.getByTestId('liberados-data')).toBeVisible();
    await page.getByTestId(`liberados-retificar-${id}`).click();
    await expect(page.getByTestId('retificar-versoes')).toContainText('Versão 1');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    // Os indicadores (TAT com o pedido, a coleta e a liberação) pelo caminho da tela, e a volta.
    await page.getByTestId('liberacao-ir-indicadores').click();
    await expect(page.getByTestId('tabela-tat')).toContainText('Pedido à coleta');
    await page.goBack();

    // Painel do valor crítico (pelo caminho da liberação): o aviso, a comunicação registrada.
    await page.getByTestId('liberacao-ir-criticos').click();
    await expect(page.getByTestId(`aviso-situacao-${id}`)).toContainText('Aguardando ciência');
    await page.getByTestId(`aviso-destinatario-${id}`).fill('Enfermeira do plantão');
    await page.getByTestId(`aviso-comunicar-${id}`).click();
    await expect(page.getByTestId('criticos-mensagem')).toContainText('Comunicação registrada');
    await semViolacaoAxe(page, '/sadt/valores-criticos');

    // Laudo: emitido em PDF/A (o arquivo do navegador por blob:).
    await page.goto('/sadt/laudos/emissao');
    const atendimento = page
      .locator('[data-testid^="laudo-atendimento-"]')
      .filter({ hasText: 'POTÁSSIO' })
      .first();
    const at = (await atendimento.getAttribute('data-testid'))!.replace('laudo-atendimento-', '');
    // A emissão real, sem interceptar: o número do laudo reservado na emissão, o PDF/A pelo conversor do E2E (Gotenberg de
    // loopback, tools/obra/e2e-vm.sh), o código de autenticação e a conferência pública. O número sai na tela, na
    // validação pelo código e no histórico do exame; a 2ª via, com o motivo, repete o número e o código do mesmo laudo.
    const download = page.waitForEvent('download');
    await page.getByTestId(`laudo-emitir-${at}`).click();
    const msg = page.getByTestId('laudos-mensagem');
    await expect(msg).toContainText(/Laudo emitido: número \S+ \(autenticação [0-9a-f-]{36}\)/);
    const [, numero, autenticacao] = /número (\S+) \(autenticação ([0-9a-f-]{36})\)/.exec(
      (await msg.textContent()) ?? '',
    )!;
    expect((await download).suggestedFilename()).toBe(`laudo-${autenticacao}.pdf`);
    await page.getByTestId('laudos-codigo').fill(autenticacao!);
    await page.getByTestId('laudos-codigo').press('Enter');
    await expect(page.getByTestId('laudos-codigo-resultado')).toContainText(`Laudo número ${numero} válido`);
    // A 2ª via: o motivo do cadastro, o mesmo número e o mesmo código.
    await page.getByTestId(`laudo-motivo-${at}`).fill('Paciente perdeu a primeira via');
    const download2 = page.waitForEvent('download');
    await page.getByTestId(`laudo-via-${at}`).click();
    await expect(msg).toContainText(
      `2ª via do laudo número ${numero} emitida (autenticação ${autenticacao})`,
    );
    expect((await download2).suggestedFilename()).toBe(`laudo-${autenticacao}.pdf`);
    await semViolacaoAxe(page, '/sadt/laudos/emissao');
    await sair(page);

    // A ciência do crítico no prontuário; o painel mostra "Com ciência".
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/resultados');
    await expect(page.getByTestId(`resultado-${id}`)).toContainText('Valor crítico');
    await page.getByTestId(`conduta-${id}`).fill('Repetido o exame e iniciada a correção');
    await page.getByTestId(`ciencia-${id}`).click();
    await expect(page.getByTestId(`resultado-${id}`)).toContainText('Ciência de');
    await sair(page);
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/valores-criticos');
    await expect(page.getByTestId(`aviso-situacao-${id}`)).toContainText('Com ciência');
    expect(externas).toEqual([]);
  });

  test('laudo de imagem privativo de médico; orçamento convertido; axe', async ({ page }) => {
    // O laudo de imagem e de métodos gráficos passou para a redação do laudo (lista de trabalho, modelos, versões e
    // assinatura no banco do cliente): a jornada dele está em f35-laudo-redacao.spec.ts (@F3.5-09).
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/orcamentos');
    const orc = page.locator('[data-testid^="orcamento-situacao-"]').filter({ hasText: 'Em aberto' }).first();
    const id = (await orc.getAttribute('data-testid'))!.replace('orcamento-situacao-', '');
    // F3.5 (05-SADT linha 26): a conversão parte dos atendimentos do paciente (nunca um id digitado) e só existe com o
    // banco do cliente; o efeito (requisição, valores aprovados na conta, situação) é provado no contrato de efeito
    // orcamento-propria.int.spec.ts. Aqui, na fonte sintética, a tela oferece o caminho novo e não o campo antigo.
    await expect(page.getByTestId(`orcamento-atendimentos-${id}`)).toBeVisible();
    await expect(page.getByTestId(`orcamento-atendimento-${id}`)).toHaveCount(0);
    await expect(page.getByTestId(`orcamento-executante-busca-${id}`)).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/orcamentos');
  });

  test('portal: o paciente pelo protocolo e o médico externo pelo autocadastro aprovado e o segundo fator; axe', async ({
    page,
  }) => {
    // O protocolo do paciente externo emitido na recepção do diagnóstico.
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/atendimentos');
    await page.getByTestId('requisicao-protocolo-31338').click();
    const texto = (await page.getByTestId('requisicao-protocolo').textContent()) ?? '';
    const protocolo = /protocolo do portal: ([0-9A-Z]{10})/i.exec(texto)![1]!;
    await semViolacaoAxe(page, '/sadt/atendimentos');
    await sair(page);

    await page.goto('/resultados');
    await expect(page.getByTestId('tela-portal')).toBeVisible();
    await semViolacaoAxe(page, '/resultados');
    await page.getByTestId('portal-protocolo').fill(protocolo);
    await page.getByTestId('portal-nascimento').fill('1990-07-01');
    await page.getByTestId('portal-entrar').click();
    await expect(page.getByTestId('portal-sessao')).toContainText('CINTHYA');
    await expect(page.getByTestId('portal-laudos')).toBeVisible();
    await page.locator('[data-testid^="portal-abrir-"]').first().click();
    await expect(page.getByTestId('portal-laudo')).toBeVisible();
    await semViolacaoAxe(page, '/resultados (laudo)');
    await page.getByTestId('portal-sair').click();

    // O médico externo pede o acesso; a recepção aprova; ele entra com a senha e o código do autenticador.
    await page.goto('/medico/cadastro');
    await page.getByTestId('medico-nome').fill('Medica Solicitante Portal');
    await page.getByTestId('medico-uf').fill('SP');
    await page.getByTestId('medico-numero').fill('12345');
    await page.getByTestId('medico-cpf').fill('111.444.777-35');
    await page.getByTestId('medico-email').fill('medica.portal@exemplo.invalid');
    await page.getByTestId('medico-senha').fill('senha-longa-sintetica');
    await page.getByTestId('medico-aceite').check();
    await semViolacaoAxe(page, '/medico/cadastro');
    await page.getByTestId('medico-enviar').click();
    const otpauth = (await page.getByTestId('medico-otpauth').locator('code').textContent()) ?? '';
    const segredo = new URL(otpauth).searchParams.get('secret')!;

    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/solicitantes/autocadastro');
    await escolher(page.getByTestId('autocadastro-candidato-12345'), { indice: 1 });
    await page.getByTestId('autocadastro-aprovar-12345').click();
    await expect(page.getByTestId('autocadastro-mensagem')).toContainText('aprovado');
    await semViolacaoAxe(page, '/sadt/solicitantes/autocadastro');
    await sair(page);

    await page.goto('/resultados');
    await escolher(page.getByTestId('portal-perfil'), 'medicoExterno');
    await page.getByTestId('portal-uf').fill('SP');
    await page.getByTestId('portal-numero').fill('12345');
    await page.getByTestId('portal-senha').fill('senha-longa-sintetica');
    await page.getByTestId('portal-codigo').fill(totp(segredo));
    await page.getByTestId('portal-entrar').click();
    await expect(page.getByTestId('portal-sessao')).toBeVisible();
    await expect(page.getByTestId('portal-laudos')).toContainText('CINTHYA');
  });
});
