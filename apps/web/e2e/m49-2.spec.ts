// E2E @M49.2 (ficha do M49, seção 10, na parte da etapa 2): o médico vincula o certificado no provedor SIMULADO, emite
// 21 atestados → a tela de assinatura mostra a exigência da política (qualificada, com carimbo do tempo) → a prévia exata
// (o PDF/A com o selo; o hash da tela é o do arquivo, regra 4) → "Assinar este documento" na própria prévia (assina-se o
// arquivo conferido) → o CPF de outra pessoa no provedor é recusado (regra 2) → o lote dos outros 20 numa autorização só → os assinados com o selo e o código do verificador, e o PDF assinado
// conferido FORA do sistema (pdfsig: "Signature is Valid"; o texto do selo e do rodapé legal no PDF) → a ACT fora do
// ar deixa o documento PENDENTE com o aviso ao autor e à direção técnica (regra 5) → "tentar de novo" conclui → o texto
// da concessão (regra 11); axe sem violação séria. Sessão real sobre a fonte sintética de dev, o serviço de emissão do
// Compose (Gotenberg e S3 em 127.0.0.1) e as portas em MEMÓRIA (CPF, certificados, ICP e pacientes SINTÉTICOS).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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
const CPF_DE_OUTRO = cpfSintetico('900000002');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Na página do provedor simulado, o titular digita o CPF e autoriza; volta à tela de origem. */
async function autorizarNoProvedor(page: Page, cpf: string, volta: RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
  await page.getByLabel('CPF do titular').fill(cpf);
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page).toHaveURL(volta);
}

/** Uma chamada da API pela sessão da página (o cabeçalho CSRF do cookie, como as telas fazem). */
async function api(
  page: Page,
  metodo: string,
  url: string,
  corpo: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ metodo, url, corpo }) => {
      const csrf =
        document.cookie
          .split(';')
          .map((p) => p.trim())
          .find((p) => p.startsWith('sgh_csrf='))
          ?.slice('sgh_csrf='.length) ?? '';
      const r = await fetch(url, {
        method: metodo,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf': csrf,
          // As gravações levam a chave de idempotência (uma por pedido), como as telas.
          'idempotency-key': crypto.randomUUID(),
        },
        body: metodo === 'GET' ? null : JSON.stringify(corpo),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { metodo, url, corpo },
  );
}

const ROTA_ATESTADOS = '/api/pep/paciente/1001/atestados';

test.describe('assinatura ICP-Brasil dos documentos, etapa 2 @M49.2', () => {
  test.setTimeout(420_000);

  test('atestado → prévia exata → qualificada (selo, PDF validável); CPF divergente; lote de 20; pendente e reprocessado; axe', async ({
    page,
    browser,
  }) => {
    // O visualizador de PDF do próprio Chrome (a prévia num iframe) pede recursos internos (chrome-extension://):
    // não é rede; o resto tem de ser da origem.
    const externas: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!/^(https?:\/\/127\.0\.0\.1:\d+|data:|blob:|chrome-extension:|chrome:)/.test(u))
        externas.push(new URL(u).host);
    });
    const pasta = mkdtempSync(join(resolve(import.meta.dirname, '../../../.tmp'), 'e2e-m49-2-'));
    try {
      await entrar(page, 'SINT.MEDICO');

      // O certificado do médico, em nuvem, pelo provedor simulado (o CPF da sessão).
      await page.goto('/conta/certificado');
      await expect(page.getByTestId('tela-meu-certificado')).toBeVisible();
      await escolher(page.getByTestId('cert-provedor'), 'simulador');
      await page.getByTestId('cert-autorizar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/conta\/certificado/);
      await expect(page.getByTestId('cert-aviso')).toContainText('Certificado vinculado');

      // O atestado emitido no prontuário (o corpo da emissão é repetido pela API: um assinado pela prévia e o lote de 20).
      await page.goto('/pep/paciente/1001/alergias');
      await page.getByTestId('aba-atestados').click();
      await page
        .getByTestId('atestado-texto')
        .fill('Atesto, para os devidos fins, que o paciente esteve em atendimento SINTETICO.');
      await page.getByTestId('atestado-dias').fill('1');
      const pedidoEmissao = page.waitForRequest(
        (r) => r.url().endsWith(ROTA_ATESTADOS) && r.method() === 'POST',
      );
      await page.getByTestId('emitir-atestado').click();
      const corpoAtestado = (await pedidoEmissao).postDataJSON() as unknown;
      await expect(page.getByTestId('aba-atestados-conteudo')).toContainText('Documento emitido.');
      for (let i = 0; i < 20; i++) {
        const r = await api(page, 'POST', ROTA_ATESTADOS, corpoAtestado);
        expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
      }

      // A tela de assinatura: o simulador avisado, a concessão (regra 11) e a exigência da política (regra 6).
      await page.goto('/pep/assinaturas');
      await expect(page.getByTestId('tela-assinar-documentos')).toBeVisible();
      await expect(page.getByTestId('docs-simulador')).toBeVisible();
      await expect(page.getByTestId('docs-concessao')).toContainText(
        'Ela não torna o prontuário inteiro assinado nem imutável',
      );
      await expect(page.getByTestId('docs-total')).toContainText('21 documento(s)');
      await expect(page.getByTestId('docs-lista')).toContainText(
        'Qualificada (ICP-Brasil) · Com carimbo do tempo (AD-RT)',
      );
      await semViolacaoAxe(page, '/pep/assinaturas (a assinar)');

      // A prévia exata (regra 4): o PDF/A servido é o do hash da tela; tem o selo, o rodapé legal e o verificador.
      const primeiro = page.locator('[data-testid^="doc-previa-"]').first();
      const idPrimeiro = Number((await primeiro.getAttribute('data-testid'))!.replace('doc-previa-', ''));
      await primeiro.click();
      await expect(page.getByTestId('docs-previa')).toBeVisible();
      const hashTela = /([0-9a-f]{64})/.exec(
        (await page.getByTestId('docs-previa-hash').textContent()) ?? '',
      )![1]!;
      const pdfPrevia = await (
        await page.request.get(`/api/documento/assinatura/documentos/${idPrimeiro}/previa.pdf`)
      ).body();
      expect(createHash('sha256').update(pdfPrevia).digest('hex')).toBe(hashTela);
      const textoPrevia = execFileSync('pdftotext', ['-', '-'], { input: pdfPrevia, encoding: 'utf8' });
      expect(textoPrevia).toContain('Assinado digitalmente por');
      expect(textoPrevia).toContain('validar.iti.gov.br');
      expect(textoPrevia).toMatch(/\/verificar\/[A-Za-z0-9_-]{16,}/);
      expect(textoPrevia).not.toContain('Assinar à mão');
      await semViolacaoAxe(page, 'prévia exata');

      // "Assinar este documento" a partir da prévia conferida: nenhuma prévia nova; assina-se o arquivo do hash da tela.
      await page.getByTestId('docs-previa-assinar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/pep\/assinaturas/);
      await expect(page.getByTestId('docs-aviso')).toContainText(
        '1 assinado(s), 0 pendente(s), 0 recusado(s)',
      );
      await expect(page.getByTestId('docs-total')).toContainText('20 documento(s)');
      // O endereço do PDF assinado deste (depois do lote ele sai dos 20 mais recentes da lista).
      const href = await page.getByTestId(`baixar-${idPrimeiro}`).getAttribute('href');
      const daPrevia = await (
        await page.request.get(`/api/documento/assinatura/documentos/${idPrimeiro}/previa.pdf`)
      ).body();
      expect(createHash('sha256').update(daPrevia).digest('hex')).toBe(hashTela);

      // CPF de outra pessoa no provedor: recusado (regra 2); o documento continua a assinar.
      const segundo = page.locator('[data-testid^="doc-marcar-"]').first();
      const idSegundo = Number((await segundo.getAttribute('data-testid'))!.replace('doc-marcar-', ''));
      await segundo.check();
      await page.getByTestId('docs-preparar').click();
      await expect(page.getByTestId(`preparada-${idSegundo}`)).toBeVisible();
      await page.getByTestId('docs-autorizar').click();
      await autorizarNoProvedor(page, CPF_DE_OUTRO, /\/pep\/assinaturas/);
      await expect(page.getByTestId('docs-aviso')).toContainText('O CPF do certificado não é o seu');
      await expect(page.getByTestId('docs-total')).toContainText('20 documento(s)');

      // O lote dos outros 20: a prévia de cada um e UMA autorização no provedor.
      await page.getByTestId('docs-todos').click();
      await page.getByTestId('docs-preparar').click();
      await expect(page.locator('[data-testid^="preparada-"]')).toHaveCount(20, { timeout: 180_000 });
      await semViolacaoAxe(page, 'lote preparado');
      await page.getByTestId('docs-autorizar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/pep\/assinaturas/);
      await expect(page.getByTestId('docs-aviso')).toContainText(
        '20 assinado(s), 0 pendente(s), 0 recusado(s)',
      );
      await expect(page.getByTestId('docs-assinados')).toContainText('Assinado digitalmente (ICP-Brasil)');
      await expect(page.locator('[data-testid^="assinado-"]')).toHaveCount(20);
      await semViolacaoAxe(page, '/pep/assinaturas (assinados)');

      // O PDF assinado, conferido fora do sistema (pdfsig, biblioteca independente; regra 8).
      const assinado = await (await page.request.get(href!)).body();
      // O que se assinou é exatamente a prévia que o médico conferiu (o hash da tela): o começo exato do PDF assinado.
      expect(assinado.subarray(0, pdfPrevia.length).equals(pdfPrevia)).toBe(true);
      expect(assinado.toString('latin1')).toContain('/SubFilter /ETSI.CAdES.detached');
      if (spawnSync('pdfsig', ['-v']).status === 0) {
        writeFileSync(join(pasta, 'assinado.pdf'), assinado);
        const saida = execFileSync('pdfsig', [join(pasta, 'assinado.pdf')], { encoding: 'utf8' });
        expect(saida).toContain('Signature is Valid');
        expect(saida).toContain('Total document signed');
      }

      // A ACT fora do ar (regra 5): o administrador põe o simulador do carimbo fora; a assinatura fica pendente.
      const contexto = await browser.newContext();
      const admin = await contexto.newPage();
      await entrar(admin, 'SINT.ADMIN');
      expect((await api(admin, 'PUT', '/api/documento/simulador-psc/fontes', { act: true })).status).toBe(
        200,
      );
      expect((await api(page, 'POST', ROTA_ATESTADOS, corpoAtestado)).status).toBeLessThan(300);
      await page.goto('/pep/assinaturas');
      await expect(page.getByTestId('docs-total')).toContainText('1 documento(s)');
      await page.getByTestId('docs-todos').click();
      await page.getByTestId('docs-preparar').click();
      await expect(page.locator('[data-testid^="preparada-"]')).toHaveCount(1);
      await page.getByTestId('docs-autorizar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/pep\/assinaturas/);
      await expect(page.getByTestId('docs-aviso')).toContainText('0 assinado(s), 1 pendente(s)');
      const pendente = page.locator('[data-testid^="doc-situacao-"]').first();
      await expect(pendente).toContainText('Pendente');
      await expect(pendente).toContainText('Carimbo do tempo indisponível');
      await expect(page.getByTestId('docs-avisos')).toContainText('Carimbo do tempo indisponível');
      await semViolacaoAxe(page, '/pep/assinaturas (pendente com aviso)');
      // A direção técnica também é avisada.
      const dt = (await api(admin, 'GET', '/api/documento/assinatura/estabelecimento', null)) as {
        status: number;
        json: { pendentes: number; avisos: { destinatario: string; autor: string | null }[] };
      };
      expect(dt.status).toBe(200);
      expect(dt.json.pendentes).toBeGreaterThanOrEqual(1);
      expect(
        dt.json.avisos.some((v) => v.destinatario === 'diretor-tecnico' && v.autor === 'SINT.MEDICO'),
      ).toBe(true);

      // A ACT volta: "tentar de novo" conclui a MESMA assinatura (nada é assinado de novo no provedor).
      expect((await api(admin, 'PUT', '/api/documento/simulador-psc/fontes', { act: false })).status).toBe(
        200,
      );
      await page.locator('[data-testid^="doc-reprocessar-"]').first().click();
      await expect(page.getByTestId('docs-aviso')).toContainText('Assinatura refeita: Assinada.');
      await expect(page.locator('[data-testid^="assinado-"]')).toHaveCount(20); // os 20 mais recentes
      await page.getByTestId('docs-avisos-lidos').click();
      await expect(page.getByTestId('docs-avisos')).toBeHidden();
      await contexto.close();
      expect(externas).toEqual([]);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
