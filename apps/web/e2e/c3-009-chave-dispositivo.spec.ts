// E2E @C3-009 (01-ADM L62, DP-45 decidida em 26/11): a chave do dispositivo (WebAuthn com biometria local) como segundo
// fator, na tela Segurança da própria conta. Cadastra "este aparelho" com um AUTENTICADOR VIRTUAL do Chromium (CDP
// WebAuthn: sem biometria real; a verificação do usuário é simulada como aceita), testa a biometria e remove. O E2E roda
// com a fonte sintética: as rotas /api/sessao/segundo-fator/dispositivos* são simuladas pelo Playwright com massa
// SINTÉTICA, e o teste confere o formato que a tela manda ao servidor (base64url, sem dado biométrico). A conferência
// criptográfica e a gravação têm contrato de efeito em apps/api/src/sessao/dispositivo-segundo-fator.int.spec.ts e
// unitário em packages/dominio-acesso/src/webauthn.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const B64URL = /^[A-Za-z0-9_-]+$/;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const b64 = (texto: string) => Buffer.from(texto).toString('base64url');

test.describe('@C3-009 chave do dispositivo como segundo fator', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'autenticador virtual só no Chromium (CDP)');
  // A WebAuthn recusa endereço IP como identificador do servidor (rpId): "127.0.0.1" dá SecurityError "invalid domain".
  // O mesmo servidor de teste é aberto por "localhost" (contexto seguro e domínio válido), como num servidor real com nome.
  test.use({ baseURL: async ({ baseURL }, use) => use(baseURL?.replace('//127.0.0.1', '//localhost')) });

  test('cadastra o aparelho, testa a biometria e remove', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: false,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await entrar(page, 'SINT.GUICHE');
    const servidor = new URL(page.url()).hostname;
    let lista: { id: number; nome: string; criadoEm: string; ultimoUsoEm: string | null }[] = [];
    let idCredencial = '';
    const corpos: Record<string, unknown>[] = [];

    await page.route('**/api/sessao/segundo-fator/dispositivos**', async (rota) => {
      const url = new URL(rota.request().url());
      const caminho = url.pathname.replace('/api/sessao/segundo-fator/dispositivos', '');
      const metodo = rota.request().method();
      if (metodo === 'GET') return json(rota, { dispositivos: lista });
      const corpo = (rota.request().postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push(corpo);
      if (caminho === '/opcoes-cadastro')
        return json(rota, {
          challenge: b64('desafio-sintetico-de-cadastro-0001'),
          rp: { id: servidor, name: 'Sistema hospitalar' },
          user: { id: b64('conta-sintetica'), name: 'SINT.GUICHE', displayName: 'Guichê sintético' },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -257 },
          ],
          timeout: 300000,
          attestation: 'none',
          authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
          excludeCredentials: [],
        });
      if (caminho === '') {
        const r = corpo['resposta'] as Record<string, string>;
        idCredencial = r['idCredencial'] ?? '';
        lista = [
          { id: 41, nome: String(corpo['nome']), criadoEm: '2026-11-26T10:00:00.000Z', ultimoUsoEm: null },
        ];
        return json(rota, { id: 41 }, 201);
      }
      if (caminho === '/opcoes-validacao')
        return json(rota, {
          challenge: b64('desafio-sintetico-de-validacao-01'),
          rpId: servidor,
          timeout: 300000,
          userVerification: 'required',
          allowCredentials: [{ type: 'public-key', id: idCredencial }],
        });
      if (caminho === '/validar') {
        lista = lista.map((x) => ({ ...x, ultimoUsoEm: '2026-11-26T10:05:00.000Z' }));
        return json(rota, { conferido: true, id: 41 });
      }
      if (caminho === '/41/revogar') {
        lista = [];
        return json(rota, { dispositivos: lista });
      }
      return json(rota, { title: 'rota desconhecida' }, 404);
    });

    await page.goto('/preferencias/seguranca');
    const secao = page.getByTestId('dispositivos-segundo-fator');
    await expect(secao).toBeVisible();
    await expect(page.getByTestId('dispositivos-nenhum')).toBeVisible();
    await semViolacaoAxe(page, 'C3-009 chave do dispositivo (vazia)');

    await page.getByTestId('dispositivo-nome').locator('input').fill('Notebook sintético');
    await page.getByTestId('dispositivo-cadastrar').click();
    await expect(page.getByTestId('dispositivo-item')).toHaveCount(1);
    await expect(page.getByTestId('dispositivo-item')).toContainText('Notebook sintético');

    const cadastro = corpos.find((c) => c['resposta'] && c['nome']) as {
      nome: string;
      resposta: Record<string, string>;
    };
    expect(cadastro.nome).toBe('Notebook sintético');
    for (const campo of ['idCredencial', 'dadosCliente', 'objetoAtestado'])
      expect(cadastro.resposta[campo]).toMatch(B64URL);
    const cliente = JSON.parse(Buffer.from(cadastro.resposta['dadosCliente']!, 'base64url').toString()) as {
      type: string;
      challenge: string;
    };
    expect(cliente.type).toBe('webauthn.create');
    expect(cliente.challenge).toBe(b64('desafio-sintetico-de-cadastro-0001'));

    await page.getByTestId('dispositivo-testar').click();
    await expect(secao).toContainText('Biometria conferida');
    const validacao = corpos.find(
      (c) => (c['resposta'] as Record<string, string> | undefined)?.['assinatura'],
    ) as {
      resposta: Record<string, string>;
    };
    expect(validacao.resposta['idCredencial']).toBe(idCredencial);
    for (const campo of ['dadosCliente', 'dadosAutenticador', 'assinatura'])
      expect(validacao.resposta[campo]).toMatch(B64URL);
    await semViolacaoAxe(page, 'C3-009 chave do dispositivo (cadastrada)');

    await page.getByTestId('dispositivo-remover').click();
    await expect(page.getByTestId('dispositivos-nenhum')).toBeVisible();
  });

  test('entra com a chave do dispositivo quando a conta a escolheu (passo da entrada)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: false,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.context().clearCookies();
    await page.goto('/entrar');
    const servidor = new URL(page.url()).hostname;
    // O aparelho já cadastrado (massa SINTÉTICA): a credencial nasce no autenticador virtual para este servidor.
    const idCredencial = await page.evaluate(async (rpId) => {
      const c = (await navigator.credentials.create({
        publicKey: {
          challenge: new TextEncoder().encode('desafio-sintetico-cadastro-entrada'),
          rp: { id: rpId, name: 'Sistema hospitalar' },
          user: {
            id: new TextEncoder().encode('conta-sintetica'),
            name: 'SINT.GUICHE',
            displayName: 'Conta',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { userVerification: 'required' },
        },
      })) as PublicKeyCredential;
      let t = '';
      for (const x of new Uint8Array(c.rawId)) t += String.fromCharCode(x);
      return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }, servidor);

    const corpos: Record<string, unknown>[] = [];
    await page.route('**/api/sessao', async (rota) => {
      if (rota.request().method() !== 'POST') return rota.continue();
      const corpo = (rota.request().postDataJSON() ?? {}) as Record<string, unknown>;
      corpos.push(corpo);
      if (!corpo['respostaDispositivo'])
        return json(
          rota,
          {
            type: 'about:blank',
            title: 'Segundo fator necessário',
            status: 401,
            detail: 'Confirme a entrada no seu dispositivo (biometria ou PIN do aparelho).',
            codigo: 'segundo-fator-dispositivo',
            opcoesDispositivo: {
              challenge: b64('desafio-sintetico-da-entrada-0001'),
              rpId: servidor,
              timeout: 120000,
              userVerification: 'required',
              allowCredentials: [{ type: 'public-key', id: idCredencial }],
            },
          },
          401,
        );
      // Com a assinatura, segue para a fonte sintética (a conta sintética entra pela senha).
      return rota.continue();
    });

    await page.getByTestId('campo-login').fill('SINT.GUICHE');
    await page.getByTestId('campo-senha').fill(SENHA);
    await semViolacaoAxe(page, 'C3-009 entrada com a chave do dispositivo');
    await page.getByTestId('botao-entrar').click();
    await expect(page).toHaveURL(/\/inicio/);

    expect(corpos).toHaveLength(2);
    expect(corpos[0]).not.toHaveProperty('respostaDispositivo');
    const r = corpos[1]!['respostaDispositivo'] as Record<string, string>;
    expect(r.idCredencial).toBe(idCredencial);
    for (const v of Object.values(r)) expect(v).toMatch(B64URL);
    const cliente = JSON.parse(Buffer.from(r.dadosCliente!, 'base64url').toString('utf8')) as Record<
      string,
      string
    >;
    expect(cliente['type']).toBe('webauthn.get');
    expect(cliente['challenge']).toBe(b64('desafio-sintetico-da-entrada-0001'));
    // Nada de biometria vai ao servidor: só a assinatura do desafio.
    expect(Object.keys(r).sort()).toEqual([
      'assinatura',
      'dadosAutenticador',
      'dadosCliente',
      'idCredencial',
    ]);
  });
});
