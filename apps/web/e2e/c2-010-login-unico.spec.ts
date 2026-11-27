// E2E @C2-010 (F7, 01-ADM linha 61): login único corporativo. O gestor de acessos (SINT.GESTOR, sem permissão clínica
// nem de faturamento) abre Administração › Acesso › Login único corporativo pelo menu, cadastra o provedor OpenID do
// hospital com a conferência na hora (endereço sem https e emissor vazio aparecem no formulário e nada é gravado), liga
// o grupo do diretório a um perfil e uma conta à identidade externa. Depois, na tela de entrada, o botão "Entrar com"
// do provedor leva à volta em /entrar/provedor, que pede o segundo fator e só então abre a sessão. O cadastro grava só
// no banco próprio, e o provedor real fica fora da VM: as rotas do cadastro e da entrada pelo provedor são servidas
// pelo spec (estado mantido aqui, corpos conferidos). A sessão final é a real da conta sintética, aberta pela API.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const A = '**/api/acesso/provedores-identidade';
const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

/** Cadastro do provedor, grupos e vínculos; devolve os corpos das gravações. */
async function servirCadastro(page: Page): Promise<Record<string, unknown>[]> {
  const corpos: Record<string, unknown>[] = [];
  const provedores: Record<string, unknown>[] = [];
  const grupos: Record<string, unknown>[] = [];
  const vinculos: Record<string, unknown>[] = [];
  await page.route(A, (r) => {
    if (r.request().method() !== 'POST') return json(r, provedores);
    const e = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ provedor: e });
    provedores.splice(0, provedores.length, {
      ...e,
      id: 41,
      versao: 1,
      dominio: null,
      basePesquisa: null,
      filtroUsuario: null,
      atributoLogin: 'preferred_username',
      atributoEmail: 'email',
      atributoGrupo: e['atributoGrupo'] || null,
      sincronizaPerfis: true,
      prioridade: 1,
      entradaLigada: true,
      vinculosAtivos: vinculos.length,
      gruposAtivos: grupos.length,
    });
    return json(r, { id: 41, versao: 1 });
  });
  await page.route(`${A}/41/grupos`, (r) => {
    if (r.request().method() !== 'POST') return json(r, grupos);
    const e = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ grupo: e });
    grupos.push({ id: 7, versao: 1, ...e, ativo: true });
    return json(r, { id: 7 });
  });
  await page.route(`${A}/41/vinculos`, (r) => {
    if (r.request().method() !== 'POST') return json(r, vinculos);
    const e = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ vinculo: e });
    vinculos.push({ id: 9, versao: 1, ...e, vinculadoEm: null, ultimoUsoEm: null, ativo: true });
    return json(r, { id: 9 });
  });
  return corpos;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input');

test.describe('Login único corporativo @C2-010 @fase7', () => {
  test('cadastro do provedor com a conferência na hora, grupo e vínculo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos = await servirCadastro(page);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/provedores-identidade');
    await expect(page.getByTestId('form-provedor')).toBeVisible();

    // A conferência na hora: sem https e sem emissor, o formulário aponta e nada é gravado.
    await campo(page, 'provedor-codigo').fill('diretorio');
    await campo(page, 'provedor-nome').fill('Diretório ficticio do hospital');
    await campo(page, 'provedor-url').fill('http://sso.exemplo.invalid');
    await campo(page, 'provedor-cliente').fill('sgh-teste');
    await expect(page.getByTestId('provedor-falhas').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('provedor-gravar')).toBeDisabled();
    expect(corpos).toHaveLength(0);

    await campo(page, 'provedor-url').fill('https://sso.exemplo.invalid');
    await campo(page, 'provedor-emissor').fill('https://sso.exemplo.invalid/realms/hospital');
    await campo(page, 'provedor-cofre').fill('cofre/sso/diretorio');
    await expect(page.getByTestId('provedor-falhas')).toHaveCount(0);
    await page.getByTestId('provedor-gravar').click();
    await expect(page.getByTestId('provedor-gravado')).toBeVisible();
    expect(corpos[0]).toMatchObject({
      provedor: { codigo: 'diretorio', protocolo: 'oidc', urlServidor: 'https://sso.exemplo.invalid' },
    });

    // Perfil padrão por grupo do diretório e a conta ligada à identidade externa.
    await campo(page, 'grupo-externo').fill('cn=enfermagem');
    await campo(page, 'grupo-perfil').fill('ENFERMAGEM');
    await page.getByTestId('grupo-incluir').click();
    await expect(page.getByTestId('provedor-grupos')).toContainText('cn=enfermagem');
    await campo(page, 'vinculo-externo-login').fill('SINT.GESTOR');
    await campo(page, 'vinculo-externo-identificador').fill('id-externo-ficticio');
    await page.getByTestId('vinculo-externo-ligar').click();
    await expect(page.getByTestId('provedor-vinculos')).toContainText('SINT.GESTOR');
    expect(corpos.slice(1)).toEqual([
      { grupo: { grupoExterno: 'cn=enfermagem', perfil: 'ENFERMAGEM', soEsteEstabelecimento: false } },
      { vinculo: { login: 'SINT.GESTOR', identificador: 'id-externo-ficticio', email: null } },
    ]);
    await semViolacaoAxe(page, 'login único corporativo: cadastro');
    expect(externas).toEqual([]);
  });

  test('"Entrar com" o provedor: volta em /entrar/provedor pede o segundo fator e abre a sessão', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let estabelecimento = '';
    const retornos: Record<string, unknown>[] = [];
    await page.route('**/api/sessao/provedores?*', (r) =>
      json(r, { provedores: [{ codigo: 'diretorio', nome: 'Diretório ficticio do hospital' }] }),
    );
    await page.route('**/api/sessao/provedor/inicio', (r) => {
      const e = r.request().postDataJSON() as { estabelecimento: string; provedor: string };
      estabelecimento = e.estabelecimento;
      expect(e.provedor).toBe('diretorio');
      return json(r, { url: '/entrar/provedor?state=estado-ficticio&code=codigo-ficticio' });
    });
    await page.route('**/api/sessao/provedor/retorno', async (r) => {
      const e = r.request().postDataJSON() as Record<string, unknown>;
      retornos.push(e);
      if (!e['codigoSegundoFator'])
        return r.fulfill({
          status: 401,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Segundo fator', status: 401, codigo: 'segundo-fator-codigo' }),
        });
      // O provedor confirmou e o código confere: a sessão é a real da conta sintética.
      const real = await page.request.post('/api/sessao', {
        data: { estabelecimento, login: 'SINT.GESTOR', senha: SENHA },
      });
      return json(r, await real.json());
    });

    await page.goto('/entrar');
    await page.getByTestId('entrar-provedor-diretorio').click();
    await expect(page).toHaveURL(/\/entrar\/provedor/);
    await expect(page.getByTestId('provedor-segundo-fator')).toBeVisible();
    await campo(page, 'provedor-codigo').fill('123456');
    await page.getByTestId('provedor-confirmar').click();
    await expect(page).toHaveURL(/\/inicio/);
    expect(retornos).toEqual([
      { estado: 'estado-ficticio', codigo: 'codigo-ficticio' },
      { estado: 'estado-ficticio', codigo: 'codigo-ficticio', codigoSegundoFator: '123456' },
    ]);
    expect(externas).toEqual([]);
  });
});
