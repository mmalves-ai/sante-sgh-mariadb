// F3.1 (02-CAD linha 2) @F3.1-01: a regra de campo do cadastro na ABERTURA do atendimento. Escolhidos o paciente, o
// tipo e o convênio, a tela diz na hora quais campos do cadastro faltam no escopo dela (módulo de recepção, tipo de
// atendimento e fonte pagadora) e leva à ficha do paciente com o mesmo escopo na rota; o cadastro novo também abre com
// o escopo. A rota dos campos pendentes exige o banco próprio e é simulada pelo Playwright com massa SINTÉTICA; a
// recusa da abertura no banco está no contrato de efeito
// (apps/api/src/modulos/atendimento/abertura-regra-campo.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const CONVENIO = 306;

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

test.describe('@F3.1 @F3.1-01 regra de campo do cadastro na abertura do atendimento', () => {
  test.describe.configure({ timeout: 240_000 });

  test('avisa na hora os campos que faltam no escopo e leva à ficha com o escopo na rota; axe', async ({
    page,
  }) => {
    const consultas: string[] = [];
    await entrar(page, 'SINT.ADMIN');
    // Regra sintética: na urgência falta o nome da mãe e, para o convênio escolhido, também o celular.
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/campos-pendentes**`, (rota) => {
      const u = new URL(rota.request().url());
      consultas.push(u.search);
      const pendentes: { campo: string; rotulo: string }[] = [];
      const urgencia = u.searchParams.get('tipoAtendimento') === 'urgencia';
      if (urgencia && u.searchParams.get('fontePagadora') === String(CONVENIO))
        pendentes.push({ campo: 'celular', rotulo: 'Celular' });
      if (urgencia) pendentes.push({ campo: 'nomeMae', rotulo: 'Nome da mãe' });
      return json(rota, { pendentes });
    });

    await page.goto('/recepcao/atendimento/novo?modulo=4');
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    // O cadastro novo abre com o escopo da tela (o módulo de recepção da rota; o tipo e o convênio quando escolhidos).
    await expect(page.getByTestId('abrir-atd-cadastrar')).toHaveAttribute(
      'href',
      /\/cadastros\/pacientes\/novo\?modulo=4/,
    );
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);

    await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
    await page.getByTestId('abrir-atd-buscar').click();
    await page.getByTestId(`abrir-atd-paciente-${PACIENTE}`).click();
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();

    const ficha = page.locator('section[aria-labelledby="abrir-atd-ficha"]');
    // Consulta ambulatorial: a regra é só da urgência, nenhum aviso.
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await expect.poll(() => consultas.some((c) => c.includes('tipoAtendimento=ambulatorial'))).toBe(true);
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);

    // Pronto atendimento: a regra da urgência aparece na hora, com o rótulo do campo.
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'pa');
    const aviso = page.getByTestId('abrir-atd-cadastro-pendente');
    await expect(aviso).toContainText('Faltam no cadastro do paciente para este atendimento:');
    await expect(aviso).toContainText('Nome da mãe.');

    // Com o convênio, a regra da fonte pagadora soma; o atalho leva à ficha com o mesmo escopo, em outra aba.
    await escolher(ficha.getByLabel('Convênio', { exact: true }), String(CONVENIO));
    await expect(aviso).toContainText(
      'Faltam no cadastro do paciente para este atendimento: Celular, Nome da mãe.',
    );
    const completar = page.getByTestId('abrir-atd-completar-cadastro');
    await expect(completar).toHaveAttribute(
      'href',
      new RegExp(
        `/cadastros/pacientes/${PACIENTE}\\?modulo=4&tipoAtendimento=urgencia&fontePagadora=${CONVENIO}$`,
      ),
    );
    await expect(completar).toHaveAttribute('target', '_blank');
    expect(consultas.at(-1)).toBe(`?modulo=4&tipoAtendimento=urgencia&fontePagadora=${CONVENIO}`);
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (cadastro pendente)');

    // Paciente não identificado (emergência): o cadastro provisório não é barrado, e o aviso some.
    await page.getByTestId('abrir-atd-nao-identificado').check();
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);
  });
});
