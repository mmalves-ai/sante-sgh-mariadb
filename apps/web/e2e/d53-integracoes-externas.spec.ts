// E2E da central de integrações externas (decisão 53 do dono). O administrador abre Administração > Integrações >
// Integrações externas pelo menu, vê cada integração com o selo "Simulador", o aviso para passar a definição do
// fornecedor à equipe de desenvolvimento (com o que pedir) na operadora TISS, guarda uma credencial com a senha de
// novo (a tela mostra só "Definida", nunca o valor) e liga o real com justificativa e senha: fora de produção a tela
// avisa "neutralizado neste ambiente" e o selo diz que segue no simulador. A leitura vem da porta em memória; as duas
// gravações críticas (senha de novo) são servidas pelo spec seguindo o contrato (docs/obra/integracoes-externas.md).
import {
  esquemaDefinirModoIntegracao,
  esquemaGuardarCredencialIntegracao,
  type IntegracaoExternaLida,
  type PainelIntegracoesExternas,
} from '@sgh/contratos';
import { expect, test, type Page } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const SEGREDO = 'usuario-sintetico-e2e';
const TISS = 'operadora-tiss-webservice';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Central de integrações externas @D53 @fase7', () => {
  test.setTimeout(180_000);

  test('abrir pelo menu, ver o aviso do fornecedor, guardar a credencial, ligar o real e ver neutralizado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O estado que as gravações servidas pelo spec deixam na TISS, aplicado por cima da leitura real.
    let tiss: Partial<IntegracaoExternaLida> = {};
    const aplicar = (i: IntegracaoExternaLida): IntegracaoExternaLida =>
      i.id === TISS ? { ...i, ...tiss } : i;
    let lido: IntegracaoExternaLida | null = null;

    await page.route(/\/api\/administracao\/integracoes-externas$/, async (rota) => {
      const r = await rota.fetch();
      const p = (await r.json()) as PainelIntegracoesExternas;
      lido = p.integracoes.find((i) => i.id === TISS) ?? null;
      await rota.fulfill({ response: r, json: { ...p, integracoes: p.integracoes.map(aplicar) } });
    });
    await page.route(/\/api\/administracao\/integracoes-externas\/credencial$/, async (rota) => {
      const pedido = esquemaGuardarCredencialIntegracao.safeParse(rota.request().postDataJSON());
      if (!pedido.success || pedido.data.senha !== SENHA)
        return rota.fulfill({
          status: 401,
          contentType: 'application/problem+json',
          json: {
            type: 'about:blank',
            title: 'Senha não confere',
            status: 401,
            detail: 'A senha não confere.',
          },
        });
      const base = lido!;
      tiss = {
        credenciais: base.credenciais.map((c) =>
          c.campo === pedido.data.campo ? { ...c, definida: true } : c,
        ),
      };
      return rota.fulfill({ json: { integracao: aplicar(base), neutralizado: false } });
    });
    await page.route(/\/api\/administracao\/integracoes-externas\/modo$/, async (rota) => {
      const pedido = esquemaDefinirModoIntegracao.parse(rota.request().postDataJSON());
      expect(pedido.senha).toBe(SENHA);
      tiss = {
        ...tiss,
        modo: pedido.modo,
        situacao: pedido.modo === 'real' ? 'real-incompleto' : 'simulador',
      };
      return rota.fulfill({ json: { integracao: aplicar(lido!), neutralizado: pedido.modo === 'real' } });
    });

    await entrar(page, 'SINT.ADMIN');
    await (await itemDoMenu(page, 'Integrações externas')).click();
    await expect(page).toHaveURL(/\/administracao\/integracoes-externas$/);
    const tela = page.getByTestId('tela-integracoes-externas');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('externas-ambiente')).toContainText('não é produção');
    await expect(page.getByTestId(`selo-${TISS}`)).toHaveText('Simulador');
    const aviso = page.getByTestId(`fornecedor-${TISS}`);
    await expect(aviso).toContainText('Passe a definição à equipe de desenvolvimento');
    await expect(aviso).toContainText('Lista das transações TISS aceitas pelo webservice');
    await expect(tela).not.toContainText(/SPDATA|legado|config\.integracaoExterna/i);
    await semViolacaoAxe(page, '/administracao/integracoes-externas');

    // Guardar a credencial: senha errada recusada; com a senha, "Definida" e o valor nunca na tela.
    const cartao = page.getByTestId(`integracao-${TISS}`);
    const campo = cartao.getByTestId(/^credencial-operadora-tiss-webservice-/).first();
    await expect(campo).toHaveText('Não definida');
    await page.getByTestId(`configurar-${TISS}`).click();
    const config = page.getByTestId(`config-${TISS}`);
    await config.getByTestId('externas-credencial-valor').fill(SEGREDO);
    await config.getByTestId('externas-credencial-senha').fill('senha-errada-1');
    await config.getByTestId('externas-guardar-credencial').click();
    await expect(config.getByTestId('externas-recusa')).toBeVisible();
    await config.getByTestId('externas-credencial-valor').fill(SEGREDO);
    await config.getByTestId('externas-credencial-senha').fill(SENHA);
    await config.getByTestId('externas-guardar-credencial').click();
    await expect(config.getByTestId('externas-gravado')).toContainText('guardada no cofre');
    await expect(campo).toHaveText('Definida');
    expect(await page.content()).not.toContain(SEGREDO);

    // Ligar o real: justificativa e senha; fora de produção, neutralizado.
    await config.getByTestId('externas-modo-real').check();
    await config.getByLabel(/^Justificativa/).fill('ensaio sintético do real da operadora');
    await config.getByTestId('externas-modo-senha').fill(SENHA);
    await config.getByTestId('externas-gravar-modo').click();
    await expect(config.getByTestId('externas-neutralizado')).toContainText('neutralizado neste ambiente');
    await expect(page.getByTestId(`selo-${TISS}`)).toContainText('segue no simulador');
    await semViolacaoAxe(page, '/administracao/integracoes-externas (real neutralizado)');
    expect(externas).toEqual([]);
  });
});
