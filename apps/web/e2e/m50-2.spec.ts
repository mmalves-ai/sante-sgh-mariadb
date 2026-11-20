// E2E @M50.2 (ficha do M50, seção 10, na parte da etapa 2): "criar conta com 2FA → agendar → pré-check-in → recepção
// confere → chegada → resultado liberado no portal → pesquisa".
//   - a recepção emite o convite e o paciente ativa a conta (o mesmo caminho da etapa 1);
//   - no portal, a busca de horários da agenda liberada; o outro sistema ocupa o horário escolhido antes da confirmação
//     (por fora, como ele grava) e o portal oferece o próximo livre, marcado com um toque;
//   - o pré-check-in com o celular e o documento; a recepção confere na tela interna (o documento, o campo marcado) e
//     grava no cadastro; o paciente vê "conferido";
//   - o pagamento do particular por Pix no gateway simulado ("Simular o pagamento") e o histórico;
//   - a chegada registrada pela recepção (por fora) muda a situação; o resultado liberado abre no portal; a pesquisa de
//     satisfação do atendimento anterior é respondida uma vez;
//   - as agendas oferecidas no portal, configuradas na tela interna.
// axe sem violação séria nas telas; nenhuma requisição externa. Sessão real sobre a fonte sintética de dev e as portas em
// MEMÓRIA (pacientes, agendas, horários e e-mails SINTÉTICOS; o gateway é o simulado).
import { createHmac } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENDA_POR_FORA = resolve(import.meta.dirname, '../../../.tmp/e2e-agenda-por-fora.json');

function porFora(conteudo: unknown): void {
  mkdirSync(dirname(AGENDA_POR_FORA), { recursive: true });
  writeFileSync(AGENDA_POR_FORA, JSON.stringify(conteudo));
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** O código do aplicativo autenticador (TOTP de 30 s, 6 dígitos, SHA-1). */
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

const PDF = Buffer.from(
  '%PDF-1.4\n% documento sintetico de teste M50.2\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
);

test.describe('portal do paciente, etapa 2: agendar, pré-check-in, pagamento e pesquisa @M50.2', () => {
  test.setTimeout(300_000);
  test.beforeEach(() => rmSync(AGENDA_POR_FORA, { force: true }));
  test.afterEach(() => rmSync(AGENDA_POR_FORA, { force: true }));

  test('conta com 2FA → agendar com a colisão → pré-check-in → conferência → Pix simulado → chegada → resultado → pesquisa; agendas no portal; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1003');
    await page.getByTestId('conta-portal-convidar').click();
    const codigo = (await page.getByTestId('conta-portal-codigo').innerText()).trim();

    const contexto = await browser.newContext();
    const pac = await contexto.newPage();
    const externasPac = vigiarExternas(pac);
    await pac.goto('/paciente');
    await pac.getByTestId('pac-primeiro-acesso').click();
    await pac.getByTestId('pac-convite').fill(codigo);
    await pac.getByTestId('pac-nascimento').fill('1990-07-01');
    await pac.getByTestId('pac-conferir').click();
    await pac.getByTestId('pac-email-novo').fill('cinthya.m502@portal.test');
    await pac.getByTestId('pac-senha-nova').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-confirmacao').fill('frase-sintetica-longa');
    await pac.getByTestId('pac-termo').check();
    await pac.getByTestId('pac-politica').check();
    await pac.getByTestId('pac-dados').click();
    await expect(pac.getByTestId('pac-qr')).toBeVisible();
    const chave = /aplicativo:\s*([A-Z2-7]+)/.exec(await pac.locator('form').innerText())?.[1] ?? '';
    await pac.getByTestId('pac-codigo-novo').fill(totp(chave));
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('portal-ativada')).toBeVisible();

    // Agendar: a agenda liberada no portal, o convênio particular e os horários livres.
    await pac.getByTestId('portal-menu-agendar').click();
    await expect(pac.getByTestId('pac-nova-marcacao')).toBeVisible();
    await escolher(pac.getByTestId('pac-convenio'), '10');
    await pac.getByTestId('pac-buscar').click();
    const primeiro = pac.locator('[data-testid^="pac-horario-"]').first();
    await expect(primeiro).toBeVisible();
    const [, data, hora] = /pac-horario-(\d{4}-\d{2}-\d{2})-(\d{4})/.exec(
      (await primeiro.getAttribute('data-testid')) ?? '',
    )!;
    await semViolacaoAxe(pac, '/paciente/agendar (horários)');
    await primeiro.click();
    // O outro sistema ocupa o horário antes da confirmação: o portal oferece o próximo livre.
    porFora({ ocupar: [{ id: `m502-${Date.now()}`, agenda: 902, data, hora }] });
    await pac.getByTestId('pac-confirmar').click();
    await expect(pac.getByTestId('pac-colisao')).toBeVisible();
    await semViolacaoAxe(pac, '/paciente/agendar (colisão)');
    await pac.getByTestId('pac-proximo').click();
    await expect(pac.getByTestId('pac-agenda-aviso')).toContainText('Marcação feita');
    const linha = pac
      .locator('[data-testid^="pac-ag-consulta-"]')
      .filter({ hasText: 'Marcado pelo portal' })
      .first();
    await expect(linha).toBeVisible();
    const id = /pac-ag-consulta-(\d+)/.exec((await linha.getAttribute('data-testid')) ?? '')![1]!;

    // Pré-check-in: o celular novo, o documento (PDF) e o termo.
    await pac.getByTestId(`pac-precheckin-${id}`).click();
    await expect(pac.getByTestId('pac-pre-form')).toBeVisible();
    await pac.getByLabel('Celular', { exact: true }).fill('22999990000');
    await pac
      .getByTestId('pac-doc-identidade')
      .setInputFiles({ name: 'documento.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(pac.getByText('Arquivo pronto para enviar')).toBeVisible();
    await pac.getByTestId('pac-pre-termo').check();
    await semViolacaoAxe(pac, '/paciente/pre-checkin');
    await pac.getByTestId('pac-pre-enviar').click();
    await expect(pac.getByTestId('pac-pre-situacao')).toContainText('conferir');

    // A recepção confere: o documento, o campo marcado, gravar no cadastro.
    await entrar(page, 'SINT.PRECHECKIN');
    await page.goto('/recepcao/pre-checkin');
    await expect(page.getByTestId('pre-fila')).toContainText('CINTHYA');
    // A busca pelo nome do paciente no balcão.
    await page.getByTestId('pre-busca').locator('input').fill('CINTHYA VIANNA');
    await page.getByTestId('pre-buscar').click();
    await expect(page.getByTestId('pre-fila')).toContainText('CINTHYA');
    await semViolacaoAxe(page, '/recepcao/pre-checkin');
    await page.locator('[data-testid^="pre-abrir-"]').first().click();
    await expect(page.getByTestId('pre-detalhe')).toBeVisible();
    await expect(page.getByTestId('pre-marcar-celular')).toBeChecked();
    await page.getByTestId('pre-documento-0').click();
    await expect(page.getByTestId('pre-documento')).toBeVisible();
    await semViolacaoAxe(page, '/recepcao/pre-checkin (detalhe)');
    await page.getByTestId('pre-conferir').click();
    await expect(page.getByTestId('pre-feito')).toContainText('Celular');
    await pac.reload();
    await expect(pac.getByTestId('pac-pre-situacao')).toContainText('conferiu');

    // Pagamento por Pix no gateway simulado.
    await pac.getByTestId('portal-menu-pagamentos').click();
    await expect(pac.getByTestId(`pac-apagar-${id}`)).toContainText('R$');
    await pac.getByTestId(`pac-pix-${id}`).click();
    await expect(pac.getByTestId('pac-pix-codigo')).toHaveValue(/^SIMULADO-PIX\|/);
    await expect(pac.getByTestId('pac-cobranca')).toContainText('nenhum valor é cobrado');
    await semViolacaoAxe(pac, '/paciente/pagamentos (Pix)');
    await pac.getByTestId('pac-conferir-pagamento').click();
    await expect(pac.getByTestId('pac-cobranca')).toContainText('Aguardando o pagamento');
    await pac.getByTestId('pac-simular').click();
    await expect(pac.getByTestId('pac-cobranca')).toContainText('Pago');
    await expect(pac.getByTestId('pac-historico-pagamentos')).toContainText('Pago');

    // A chegada registrada pela recepção (por fora, como o check-in do M19) muda a situação no portal.
    porFora({ chegar: [{ id: `m502-chegada-${Date.now()}`, marcacao: Number(id) }] });
    await pac.getByTestId('portal-menu-agendar').click();
    await expect(pac.getByTestId(`pac-ag-consulta-${id}`)).toContainText('Atendido');

    // O resultado liberado no portal.
    await pac.getByTestId('portal-menu-documentos').click();
    await pac.locator('[data-testid^="portal-abrir-resultado-"]').first().click();
    await expect(pac.getByTestId('portal-resultado')).toBeVisible();

    // A pesquisa de satisfação do atendimento anterior, uma vez.
    await pac.getByTestId('portal-menu-pagamentos').click();
    const pesquisa = pac.locator('[data-testid^="pac-pesquisa-form-"]').first();
    await expect(pesquisa).toBeVisible();
    await escolher(pesquisa.locator('[data-testid^="pac-nota-"]'), '9');
    await pesquisa.locator('textarea').fill('Atendimento pontual (sintético).');
    await semViolacaoAxe(pac, '/paciente/pagamentos (pesquisa)');
    await pesquisa.locator('[data-testid^="pac-pesquisa-enviar-"]').click();
    await expect(pac.getByTestId('pac-pag-aviso')).toContainText('Obrigado');
    await expect(pac.locator('[data-testid^="pac-pesquisa-form-"]')).toHaveCount(0);

    // As agendas oferecidas no portal (tela interna da agenda).
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/online');
    await expect(page.getByTestId('online-lista')).toContainText('CARDIOLOGIA');
    await semViolacaoAxe(page, '/agenda/online');
    // A busca pelo procedimento ou pelo profissional; os convênios da agenda numa seleção múltipla com busca.
    await page.getByTestId('online-busca').locator('input').fill('CARDIOLOGIA');
    await page.getByTestId('online-abrir-consulta-901').click();
    await expect(page.getByTestId('online-detalhe')).toBeVisible();
    await expect(page.getByTestId('online-convenios')).toBeVisible();
    await semViolacaoAxe(page, '/agenda/online (detalhe)');
    await page.getByTestId('online-valor').locator('input').fill('120');
    await page.getByTestId('online-gravar').click();
    await expect(page.getByTestId('online-feito')).toContainText('gravada');

    expect(externas).toEqual([]);
    expect(externasPac).toEqual([]);
    await contexto.close();
  });
});
