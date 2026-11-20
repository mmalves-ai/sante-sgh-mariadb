// E2E @M50.6 (ficha do M50, seções 7, 10 e 11; etapa 6): a agenda de sessões — a grade das cadeiras e salas, a série de
// um plano terapêutico com a prévia das datas, a mesma cadeira no mesmo horário recusada para outro paciente na prévia, e
// a série cancelada a partir de uma sessão com o motivo; e a digitalização certificada — o SAME captura o PDF de um
// documento do prontuário com o índice, outra pessoa confere a fidelidade e assina com o certificado ICP-Brasil (o
// provedor SIMULADO), com o carimbo do tempo. axe sem violação séria nas telas. Sessão real sobre a fonte sintética e as
// portas em MEMÓRIA (pacientes, arquivos, certificados e CPF SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

/** CPF sintético com dígitos verificadores a partir de 9 dígitos (o mesmo cálculo do simulador; nunca de pessoa). */
function cpfSintetico(base9: string): string {
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}
const CPF_DA_SESSAO = cpfSintetico('900000001');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** A segunda-feira daqui a 2 semanas (a série nunca começa no passado), em AAAA-MM-DD e em DD/MM/AAAA. */
function segundaFutura(): { iso: string; br: string } {
  const d = new Date();
  d.setDate(d.getDate() + 14 + ((8 - d.getDay()) % 7));
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { iso, br: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` };
}

/** PDF mínimo de 2 páginas (o índice confere as páginas do arquivo), com uma marca para o resumo ser único. */
const pdf = (marca: string) =>
  Buffer.from(
    `%PDF-1.7\n% ${marca}\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 2 >> endobj\n` +
      '3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n',
    'latin1',
  );

async function buscarPaciente(page: Page, termo: string, id: number): Promise<void> {
  await page.getByTestId('sessoes-termo').fill(termo);
  await page.getByRole('button', { name: 'Buscar paciente' }).click();
  await page.getByTestId(`sessoes-paciente-${id}`).click();
}

async function preencherSerie(page: Page, inicioBr: string, hora: string): Promise<void> {
  await escolher(page.getByTestId('serie-recurso'), '7001');
  await escolher(page.getByTestId('serie-complexidade'), '2');
  await escolher(page.getByTestId('serie-duracao'), '2');
  await page.getByLabel('Duração da sessão (minutos)').fill('90');
  await page.getByLabel('Primeira sessão').fill(inicioBr);
  await page.getByLabel('Hora (HHMM)').fill(hora);
  await page.getByLabel('Número de sessões').fill('3');
  await page.getByLabel('Dias entre as sessões').fill('7');
  await page
    .getByLabel('Plano terapêutico (protocolo, ciclo, prescrição de referência)')
    .fill('PROTOCOLO SINTETICO C1 — ciclo de 21 dias');
}

test.describe('agenda de sessões e digitalização certificada @M50 @M50.6 @fase5', () => {
  test.setTimeout(360_000);

  test('a série de sessões com a prévia; a cadeira ocupada recusada; a série cancelada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const { iso, br } = segundaFutura();
    await entrar(page, 'SINT.SESSOES');
    await page.goto('/agenda/sessoes');
    await expect(page.getByTestId('tela-agenda-sessoes')).toBeVisible();
    await expect(page.getByTestId('grade-sessoes')).toContainText('CADEIRA PEDIATRICA');
    await expect(page.getByTestId('recurso-7002')).toContainText('0 a 17 anos');
    await semViolacaoAxe(page, '/agenda/sessoes');

    // A série de 3 sessões semanais na CADEIRA 01 para o paciente sintético.
    await buscarPaciente(page, 'JOSÉ DA SILVA', 1001);
    await preencherSerie(page, br, '0800');
    await expect(page.getByTestId('serie-agendar')).toBeDisabled();
    await page.getByTestId('serie-previa').click();
    await expect(page.getByTestId('serie-previa-resultado')).toContainText('Todas as sessões estão livres.');
    await expect(page.getByTestId('previa-3')).toContainText('livre');
    await semViolacaoAxe(page, '/agenda/sessoes (prévia)');
    await page.getByTestId('serie-agendar').click();
    await expect(page.getByTestId('sessoes-mensagem')).toContainText(
      'Série de 3 sessão(ões) agendada em CADEIRA 01.',
    );

    // A grade do dia da primeira sessão mostra a sessão 1 de 3.
    await page.getByLabel('A partir de').fill(br);
    await page.getByLabel('A partir de').press('Tab');
    const sessao = page
      .locator('button[data-testid^="sessao-"]')
      .filter({ hasText: 'Sessão 1 de 3' })
      .first();
    await expect(sessao).toBeVisible();

    // Outro paciente na mesma cadeira e horário: a prévia mostra a cadeira ocupada e não deixa agendar.
    await page.getByRole('button', { name: 'Trocar o paciente' }).click();
    await buscarPaciente(page, 'CINTHYA', 1003);
    await preencherSerie(page, br, '0830');
    await page.getByTestId('serie-previa').click();
    await expect(page.getByTestId('previa-1')).toContainText('cadeira ou sala ocupada');
    await expect(page.getByTestId('serie-agendar')).toBeDisabled();

    // A série cancelada a partir da primeira sessão, com o motivo.
    await sessao.click();
    await expect(page.getByTestId('sessao-escolhida')).toContainText(
      `${iso.slice(8, 10)}/${iso.slice(5, 7)} 08:00`,
    );
    await expect(page.getByTestId('sessao-restantes')).toBeDisabled();
    await page.getByLabel('Motivo (falta ou cancelamento)').fill('Plano suspenso pelo oncologista');
    await semViolacaoAxe(page, '/agenda/sessoes (sessão)');
    await page.getByTestId('sessao-restantes').click();
    await expect(page.getByTestId('sessoes-mensagem')).toContainText('3 sessão(ões) da série cancelada(s).');
    await expect(sessao).toContainText('Cancelada');
    expect(externas).toEqual([]);
  });

  test('o SAME captura o PDF; outra pessoa confere e assina com o certificado ICP-Brasil; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const descricao = `EVOLUCAO SINTETICA E2E ${Date.now()}`;
    await entrar(page, 'SINT.SAME.CAPTURA');
    await page.goto('/same/digitalizacao');
    await expect(page.getByTestId('tela-digitalizacao')).toBeVisible();
    await page.getByTestId('digit-prontuario').fill('501');
    await page.getByRole('button', { name: 'Buscar o prontuário' }).click();
    await expect(page.getByTestId('digit-paciente')).toContainText('prontuário 501');
    await page.getByLabel('Data do documento em papel').fill('02/04/2019');
    await page.getByLabel('Páginas').fill('2');
    await page.getByLabel('Descrição').fill(descricao);
    await page
      .getByTestId('digit-arquivo')
      .setInputFiles({ name: 'evolucao.pdf', mimeType: 'application/pdf', buffer: pdf(descricao) });
    await expect(page.getByTestId('digit-resumo')).toContainText('Resumo SHA-256');
    await semViolacaoAxe(page, '/same/digitalizacao (captura)');
    await page.getByTestId('digit-capturar').click();
    await expect(page.getByTestId('digit-aviso')).toContainText(
      'a conferência da fidelidade é de outra pessoa',
    );
    const linha = page.locator('tr[data-testid^="digit-"]').filter({ hasText: descricao }).first();
    await expect(linha).toContainText('Capturado (aguarda a conferência)');
    const id = /digit-(\d+)/.exec((await linha.getAttribute('data-testid')) ?? '')![1]!;
    // Quem capturou não confere.
    await expect(page.getByTestId(`digit-fiel-${id}`)).toHaveCount(0);

    // Quem confere: o certificado em nuvem pelo provedor simulado, a fidelidade e a assinatura.
    await entrar(page, 'SINT.SAME.CONFERE');
    await page.goto('/conta/certificado');
    await escolher(page.getByTestId('cert-provedor'), 'simulador');
    await page.getByTestId('cert-autorizar').click();
    await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
    await page.getByLabel('CPF do titular').fill(CPF_DA_SESSAO);
    await page.getByRole('button', { name: 'Autorizar' }).click();
    await expect(page.getByTestId('cert-aviso')).toContainText('Certificado vinculado');

    await page.goto('/same/digitalizacao');
    await expect(page.getByTestId(`digit-${id}`)).toContainText(descricao);
    await semViolacaoAxe(page, '/same/digitalizacao (conferência)');
    await page.getByTestId(`digit-fiel-${id}`).click();
    await expect(page.getByTestId('digit-aviso')).toContainText('Fidelidade conferida');
    await page.getByTestId(`digit-marcar-${id}`).check();
    await page.getByTestId('digit-assinar').click();
    await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
    await page.getByLabel('CPF do titular').fill(CPF_DA_SESSAO);
    await page.getByRole('button', { name: 'Autorizar' }).click();
    await expect(page).toHaveURL(/\/same\/digitalizacao/);
    await expect(page.getByTestId('digit-aviso')).toContainText('1 assinado(s); 0 não assinado(s).');
    await expect(page.getByTestId(`digit-${id}`)).toContainText('Assinado');
    await expect(page.getByTestId(`digit-${id}`)).toContainText('carimbo do tempo');
    await semViolacaoAxe(page, '/same/digitalizacao (assinado)');
    expect(externas).toEqual([]);
  });
});
