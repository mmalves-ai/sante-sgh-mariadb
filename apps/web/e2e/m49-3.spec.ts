// E2E @M49.3 (ficha do M49, seção 10, na parte da etapa 3): atestado emitido → prévia → assinatura qualificada no
// provedor SIMULADO → o código do QR → o VERIFICADOR PÚBLICO, sem login, mostra "válida", o tipo, o profissional e o
// registro, e NUNCA o paciente nem o conteúdo (verificação do DOM, regra 9) → o PDF assinado conferido pelo hash no
// navegador (e a prévia, que não é o assinado, recusada) → o código inexistente: "não encontrado" → o painel interno
// conta as consultas → os cadastros da assinatura digital (OIDs e formas, CRUD genérico) → a entrada com certificado A3
// pelo agente local (o teste responde pelo agente com o simulador da API) e a recusa sem o vínculo; axe sem violação
// séria. Sessão real sobre a fonte sintética de dev, o serviço de emissão do Compose e as portas em MEMÓRIA (CPF,
// certificados, ICP e pacientes SINTÉTICOS).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { abrirCombo, escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const AGENTE = 'http://127.0.0.1:47999';

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

async function autorizarNoProvedor(page: Page, cpf: string, volta: RegExp): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Provedor de certificado simulado' })).toBeVisible();
  await page.getByLabel('CPF do titular').fill(cpf);
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page).toHaveURL(volta);
}

async function api(page: Page, metodo: string, url: string, corpo: unknown) {
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
          'idempotency-key': crypto.randomUUID(),
        },
        body: metodo === 'GET' ? null : JSON.stringify(corpo),
      });
      return { status: r.status, json: (await r.json().catch(() => null)) as unknown };
    },
    { metodo, url, corpo },
  );
}

/** O agente local da estação: o teste responde por ele com o agente simulado da API (só dev/ci). */
async function agenteSimulado(page: Page): Promise<void> {
  await page.route(`${AGENTE}/**`, async (rota) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
    if (rota.request().method() === 'OPTIONS') return rota.fulfill({ status: 204, headers: cors });
    const r = await page.request.post('/api/documento/simulador-agente/assinar', {
      data: rota.request().postDataJSON(),
    });
    return rota.fulfill({
      status: r.status(),
      headers: { ...cors, 'content-type': 'application/json' },
      body: await r.text(),
    });
  });
}

test.describe('assinatura ICP-Brasil, etapa 3: verificador público, cadastros e entrada com certificado @M49.3', () => {
  test.setTimeout(360_000);

  test('assinado → verificador público (válida, sem paciente) → arquivo conferido → painel → cadastros → entrada com certificado; axe', async ({
    page,
    browser,
  }) => {
    const pasta = mkdtempSync(join(resolve(import.meta.dirname, '../../../.tmp'), 'e2e-m49-3-'));
    try {
      await entrar(page, 'SINT.MEDICO');

      // O certificado em nuvem pelo provedor simulado e um atestado emitido e assinado (a etapa 2).
      await page.goto('/conta/certificado');
      await escolher(page.getByTestId('cert-provedor'), 'simulador');
      await page.getByTestId('cert-autorizar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/conta\/certificado/);
      await expect(page.getByTestId('cert-aviso')).toContainText('Certificado vinculado');
      await page.goto('/pep/paciente/1001/alergias');
      await page.getByTestId('aba-atestados').click();
      await page
        .getByTestId('atestado-texto')
        .fill('Atesto, para os devidos fins, que o paciente esteve em atendimento SINTETICO M493.');
      await page.getByTestId('atestado-dias').fill('1');
      await page.getByTestId('emitir-atestado').click();
      await expect(page.getByTestId('aba-atestados-conteudo')).toContainText('Documento emitido.');
      await page.goto('/pep/assinaturas');
      const primeiro = page.locator('[data-testid^="doc-previa-"]').first();
      const idDoc = Number((await primeiro.getAttribute('data-testid'))!.replace('doc-previa-', ''));
      await primeiro.click();
      await expect(page.getByTestId('docs-previa')).toBeVisible();
      const previaPdf = await (
        await page.request.get(`/api/documento/assinatura/documentos/${idDoc}/previa.pdf`)
      ).body();
      await page.getByTestId('docs-previa-assinar').click();
      await autorizarNoProvedor(page, CPF_DA_SESSAO, /\/pep\/assinaturas/);
      await expect(page.getByTestId('docs-aviso')).toContainText('1 assinado(s)');
      const fila = (await api(page, 'GET', '/api/documento/assinatura/documentos', null)).json as {
        assinados: { documento: number; codigo: string; nome: string; assinatura: number }[];
      };
      const assinado = fila.assinados.find((a) => a.documento === idDoc)!;
      expect(assinado.codigo).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      const pdfAssinado = await (
        await page.request.get(`/api/documento/assinatura/assinaturas/${assinado.assinatura}/pdf`)
      ).body();
      writeFileSync(join(pasta, 'assinado.pdf'), pdfAssinado);
      writeFileSync(join(pasta, 'previa.pdf'), previaPdf);

      // O verificador público, SEM sessão (outro navegador): o QR leva a /verificar/<código>.
      const publico = await browser.newContext();
      const visitante = await publico.newPage();
      const externas: string[] = [];
      visitante.on('request', (r) => {
        if (!/^(https?:\/\/127\.0\.0\.1:\d+|data:|blob:)/.test(r.url())) externas.push(new URL(r.url()).host);
      });
      await visitante.goto(`/verificar/${assinado.codigo}`);
      await expect(visitante.getByTestId('tela-verificar')).toBeVisible();
      await expect(visitante.getByTestId('verif-situacao')).toHaveAttribute('data-situacao', 'valida');
      await expect(visitante.getByTestId('verif-situacao')).toContainText('Assinatura válida');
      await expect(visitante.getByTestId('verif-tipo')).toHaveText('Atestado');
      await expect(visitante.getByTestId('verif-registro')).toContainText('CRM');
      await expect(visitante.getByTestId('verif-concessao')).toContainText(
        'não se refere ao prontuário inteiro',
      );
      // Regra 9: nada do paciente nem do conteúdo no DOM (nem no corpo da resposta da API).
      const dom = (await visitante.locator('body').innerText()) + (await visitante.content());
      expect(dom).not.toContain(assinado.nome);
      expect(dom).not.toContain('SINTETICO M493');
      expect(dom).not.toContain('1001');
      await semViolacaoAxe(visitante, '/verificar/:codigo (válida)');

      // Quem recebeu o arquivo confere: o assinado é o mesmo; a prévia (outro arquivo) não é.
      await visitante.getByTestId('verif-arquivo-campo').setInputFiles(join(pasta, 'assinado.pdf'));
      await expect(visitante.getByTestId('verif-arquivo-resultado')).toHaveAttribute(
        'data-arquivo',
        'confere',
      );
      await visitante.getByTestId('verif-arquivo-campo').setInputFiles(join(pasta, 'previa.pdf'));
      await expect(visitante.getByTestId('verif-arquivo-resultado')).toHaveAttribute(
        'data-arquivo',
        'nao-confere',
      );

      // O código inexistente (digitado no campo): "não encontrado".
      await visitante.getByLabel('Código do documento').fill('CodigoQueNaoExiste_M493x');
      await visitante.getByTestId('verif-verificar').click();
      await expect(visitante).toHaveURL(/\/verificar\/CodigoQueNaoExiste_M493x$/);
      await expect(visitante.getByTestId('verif-situacao')).toHaveAttribute(
        'data-situacao',
        'nao-encontrado',
      );
      await semViolacaoAxe(visitante, '/verificar/:codigo (não encontrado)');
      expect(externas).toEqual([]);
      await publico.close();

      // O painel interno (administrador): as consultas do dia por resultado.
      const contexto = await browser.newContext();
      const admin = await contexto.newPage();
      await entrar(admin, 'SINT.ADMIN');
      await admin.goto('/portais/verificador');
      await expect(admin.getByTestId('tela-painel-verificador')).toBeVisible();
      await expect(admin.getByTestId('painel-verif-limite')).toContainText('consulta(s) por minuto');
      const linha = admin.getByTestId('painel-verif-tabela').locator('tbody tr').first();
      await expect(linha.locator('[data-coluna="valida"]')).toHaveText(/[1-9]/);
      await expect(linha.locator('[data-coluna="nao-encontrado"]')).toHaveText(/[1-9]/);
      await semViolacaoAxe(admin, '/portais/verificador');

      // Os cadastros da assinatura digital: os OIDs e as formas dos provedores no CRUD genérico embutido.
      await admin.goto('/administracao/assinatura/oids');
      await expect(admin.getByTestId('tela-cadastros-assinatura')).toBeVisible();
      await expect(admin.getByTestId('grupo-dominios-assinaturaCadastros')).toBeVisible();
      const lista = await abrirCombo(admin.getByTestId('grupo-escolha'));
      for (const rotulo of [
        'OIDs ICP-Brasil',
        'Tipos de OID',
        'Tipos de certificado',
        'Formas de assinatura (SafeWeb)',
        'Formas de assinatura (Vidaas)',
        'Situações da autorização (SafeWeb)',
        'Tipos de atendimento (SafeWeb)',
      ])
        await expect(lista).toContainText(rotulo);
      await lista.locator('[role="option"]:has([data-valor="documento.formaAssinaturaSafeweb"])').click();
      await expect(admin.getByTestId('grupo-escolha')).toHaveAttribute(
        'data-valor',
        'documento.formaAssinaturaSafeweb',
      );
      await semViolacaoAxe(admin, '/administracao/assinatura/oids');
      await contexto.close();

      // A entrada com certificado A3 (agente local): sem o vínculo, recusada; vinculado, entra sem a senha.
      await agenteSimulado(page);
      await page.context().clearCookies();
      await page.goto('/entrar');
      await page.getByTestId('campo-login').fill('SINT.MEDICO');
      await expect(page.getByTestId('botao-entrar-certificado')).toBeVisible();
      await page.getByTestId('botao-entrar-certificado').click();
      await expect(page.getByTestId('erro-entrar')).toContainText(
        'Não foi possível entrar com este certificado',
      );
      await semViolacaoAxe(page, '/entrar (certificado recusado)');
      // O médico entra com a senha e vincula o A3 (a parte pública do certificado do agente).
      await entrar(page, 'SINT.MEDICO');
      const der = (
        (await (await page.request.get('/api/documento/simulador-agente/certificado')).json()) as {
          certificado: string;
        }
      ).certificado;
      writeFileSync(join(pasta, 'a3.cer'), Buffer.from(der, 'base64'));
      await page.goto('/conta/certificado');
      await page.getByTestId('cert-arquivo-campo').setInputFiles(join(pasta, 'a3.cer'));
      await page.getByTestId('cert-enviar-arquivo').click();
      await expect(page.getByTestId('cert-aviso')).toBeVisible();
      await page.context().clearCookies();
      await page.goto('/entrar');
      await page.getByTestId('campo-login').fill('SINT.MEDICO');
      await page.getByTestId('botao-entrar-certificado').click();
      await expect(page).toHaveURL(/\/inicio/);
      const eu = (await api(page, 'GET', '/api/sessao', null)).json as { usuario: { login: string } };
      expect(eu.usuario.login).toBe('SINT.MEDICO');
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
