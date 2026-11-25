// E2E @C1-017 (F7, 09-AREA linha 83): perfil epidemiológico pela CID-10. A vigilância epidemiológica chega à tela pelo
// menu (Qualidade e segurança > Vigilância epidemiológica), vê as ocorrências do mês por capítulo, abre o capítulo na
// própria linha e vê grupo e subgrupo; troca o filtro para "Só o principal" e a consulta sai com o filtro; o período
// invertido é recusado na hora, sem ir ao servidor; localiza onde fica o I21.9 (capítulo, grupo e subgrupo) e o
// código fora da CID-10 vigente recebe o aviso. As rotas /api/qualidade/vigilancia/perfil-cid exigem o banco próprio e
// o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA (só
// contagens). O que o banco devolve está no contrato apps/api/src/modulos/qualidade/perfil-cid.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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

const no = (codigo: string, descricao: string, nivel: string, n: number, filhos: unknown[] = []) => ({
  codigo,
  descricao,
  nivel,
  diagnosticos: n,
  percentual: 100,
  filhos,
});

function perfil(principal: boolean) {
  const n = principal ? 1 : 3;
  return {
    desde: '2026-11-01',
    ate: '2026-11-25',
    total: n,
    semCapitulo: 0,
    atendimentos: principal ? 1 : 2,
    pacientes: principal ? 1 : 2,
    capitulos: [
      no('IX', 'Doenças do aparelho circulatório', 'capitulo', n, [
        no('I20-I25', 'Doenças isquêmicas do coração', 'grupo', n, [
          no('I21-I22', 'Infarto agudo do miocárdio', 'subgrupo', n),
        ]),
      ]),
    ],
  };
}

const agr = (codigo: string, pai: string | null, nivel: string, descricao: string) => ({
  codigo,
  capitulo: 'IX',
  pai,
  nivel,
  inicial: codigo.slice(0, 3),
  final: codigo.slice(4, 7),
  descricao,
});
const LOCAL_I219 = {
  cid: 'I219',
  categoria: 'I21',
  descricao: 'Infarto agudo do miocárdio sintético',
  capitulo: {
    codigo: 'IX',
    numero: 9,
    inicial: 'I00',
    final: 'I99',
    descricao: 'Doenças do aparelho circulatório',
  },
  agrupamentos: [
    agr('I20-I25', null, 'grupo', 'Doenças isquêmicas do coração'),
    agr('I21-I22', 'I20-I25', 'subgrupo', 'Infarto agudo do miocárdio'),
  ],
};

test.describe('Perfil epidemiológico pela CID-10: capítulo, grupo e subgrupo @C1-017 @F78-09', () => {
  test.setTimeout(180_000);

  test('menu → perfil do mês → abrir capítulo → filtro do principal → período inválido → localizar código; axe', async ({
    page,
  }) => {
    const consultas: URL[] = [];
    await page.route('**/api/qualidade/vigilancia/perfil-cid?**', (r) => {
      const u = new URL(r.request().url());
      consultas.push(u);
      return json(r, perfil(u.searchParams.get('principal') === 'true'));
    });
    await page.route('**/api/qualidade/vigilancia/perfil-cid/cid/**', (r) => {
      const cod = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop() ?? '');
      return cod === 'I219'
        ? json(r, LOCAL_I219)
        : json(r, { type: 'about:blank', title: 'CID não encontrado', status: 404 }, 404);
    });

    await entrar(page, 'SINT.VIGILANCIA');
    // As áreas do menu começam recolhidas: a busca do menu abre Qualidade e segurança > Vigilância epidemiológica.
    await (await itemDoMenu(page, 'Perfil epidemiológico pela CID-10')).click();
    await expect(page.getByTestId('tela-perfil-cid')).toBeVisible();
    await expect(page.getByTestId('perfil-total')).toHaveText('3');
    await expect(page.getByTestId('perfil-capitulo-IX')).toContainText('Doenças do aparelho circulatório');
    await expect(page.getByTestId('perfil-grupo-I20-I25')).toHaveCount(0);
    expect(consultas[0]!.searchParams.get('principal')).toBeNull();
    await semViolacaoAxe(page, '/qualidade/vigilancia/perfil-cid (capítulos)');

    // O capítulo abre na própria linha, com grupo e subgrupo.
    await page.getByTestId('perfil-abrir-IX').click();
    await expect(page.getByTestId('perfil-abrir-IX')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('perfil-grupo-I20-I25')).toContainText('Doenças isquêmicas do coração');
    await expect(page.getByTestId('perfil-subgrupo-I21-I22')).toContainText('Infarto agudo do miocárdio');
    await semViolacaoAxe(page, '/qualidade/vigilancia/perfil-cid (capítulo aberto)');

    // Só o diagnóstico principal: a consulta sai com o filtro.
    await escolher(page.getByTestId('perfil-tipo'), 'Só o principal');
    await expect(page.getByTestId('perfil-total')).toHaveText('1');
    expect(consultas.at(-1)!.searchParams.get('principal')).toBe('true');

    // Período invertido: recusado na hora, sem consulta nova.
    const antes = consultas.length;
    const ate = page.getByTestId('perfil-ate').getByRole('textbox');
    await ate.fill('01/01/2026');
    await ate.blur();
    await expect(page.getByTestId('perfil-periodo-invalido')).toBeVisible();
    await expect(page.getByTestId('tabela-perfil-cid')).toHaveCount(0);
    expect(consultas.length).toBe(antes);

    // Onde fica um código: validação na hora e a hierarquia do I21.9.
    const campo = page.getByTestId('perfil-cid-codigo').getByRole('textbox');
    await campo.fill('12A');
    await expect(page.getByTestId('perfil-cid-invalido')).toBeVisible();
    await expect(page.getByTestId('perfil-cid-localizar')).toBeDisabled();
    await campo.fill('I21.9');
    await page.getByTestId('perfil-cid-localizar').click();
    const local = page.getByTestId('perfil-cid-local');
    await expect(local.getByTestId('local-capitulo')).toContainText('IX');
    await expect(local.getByTestId('local-grupo-I20-I25')).toBeVisible();
    await expect(local.getByTestId('local-subgrupo-I21-I22')).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/vigilancia/perfil-cid (código localizado)');

    // Código no formato certo, mas fora da CID-10 vigente.
    await campo.fill('D49');
    await page.getByTestId('perfil-cid-localizar').click();
    await expect(page.getByTestId('perfil-cid-fora')).toBeVisible();
  });
});
