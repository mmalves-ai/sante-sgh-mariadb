// F3.1 (02-CAD linhas 9 e 12): coberturas e origem do paciente na ficha, e o indicador da origem na central de marcação,
// pelo caminho da tela. Os vínculos exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as rotas dos
// vínculos são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: validação na hora (o botão só
// libera com o que a fonte exige), o corpo de cada pedido, a lista recarregada depois de gravar, o encerramento com
// motivo (sem apagar: a carteira fica na lista como encerrada) e a acessibilidade. O efeito no banco está no contrato de
// efeito (apps/api/src/modulos/cadastro/paciente-vinculos-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

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

interface Pedido {
  readonly metodo: string;
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

const HOJE = '2026-11-24';
type Carteira = Record<string, unknown> & { id: number; situacaoNoDia: string };

async function simular(page: Page, pedidos: Pedido[]): Promise<void> {
  const carteiras: Carteira[] = [];
  const captacoes: Record<string, unknown>[] = [];
  await page.route('**/api/cadastros/vinculos/opcoes', (r) =>
    json(r, {
      fontes: [
        { id: 3, nome: 'OPERADORA SINTETICA', particular: false, exigeValidade: true },
        { id: 4, nome: 'PARTICULAR SINTETICO', particular: true, exigeValidade: false },
      ],
      planos: [{ id: 31, fontePagadora: 3, descricao: 'PLANO SINTETICO OURO' }],
      tiposIndicacao: [
        { id: 7, descricao: 'INDICACAO SINTETICA', exigeProfissional: false, exigeComplemento: true },
      ],
      parentescos: [{ id: 2, descricao: 'CONJUGE' }],
      canais: ['espontaneo', 'indicacao_paciente', 'campanha'],
    }),
  );
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/coberturas**`, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    if (req.method() === 'GET')
      return json(rota, {
        hoje: HOJE,
        itens: carteiras,
        proposta: carteiras.find((c) => c['principal'] && c.situacaoNoDia !== 'encerrada')?.id ?? null,
        avisos: [],
      });
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: req.method(), caminho, corpo });
    if (caminho.endsWith('/encerrar')) {
      const c = carteiras.find((x) => caminho.includes(`/coberturas/${x.id}/`));
      if (c) Object.assign(c, { situacaoNoDia: 'encerrada', vigenciaFim: HOJE, principal: false, versao: 2 });
      return json(rota, { id: c?.id ?? 0 });
    }
    const id = 900 + carteiras.length;
    carteiras.push({
      id,
      fontePagadora: { id: 3, nome: 'OPERADORA SINTETICA' },
      plano: { id: 31, nome: 'PLANO SINTETICO OURO' },
      numeroCarteira: corpo['numeroCarteira'],
      validade: corpo['validade'],
      vigenciaInicio: HOJE,
      vigenciaFim: null,
      titular: true,
      titularNome: null,
      principal: true,
      situacaoNoDia: 'vigente',
      versao: 1,
    });
    return json(rota, { id }, 201);
  });
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/captacoes**`, async (rota) => {
    const req = rota.request();
    if (req.method() === 'GET') return json(rota, { itens: captacoes });
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: 'POST', caminho: 'captacoes', corpo });
    captacoes.push({
      id: 70,
      captadoEm: `${HOJE}T10:00:00`,
      canal: corpo['canal'],
      tipoIndicacao: { id: 7, descricao: 'INDICACAO SINTETICA' },
      indicador: corpo['indicadorNome'],
      campanha: null,
      situacao: 'ativa',
    });
    return json(rota, { id: 70 }, 201);
  });
  await page.route('**/api/cadastros/pre-cadastros**', (r) => json(r, { itens: [] }));
  await page.route('**/api/cadastros/captacoes/indicador**', (rota) => {
    const u = new URL(rota.request().url());
    pedidos.push({
      metodo: 'GET',
      caminho: 'indicador',
      corpo: { de: u.searchParams.get('de'), ate: u.searchParams.get('ate') },
    });
    return json(rota, {
      total: 4,
      porCanal: [
        { canal: 'indicacao_paciente', total: 3 },
        { canal: 'espontaneo', total: 1 },
      ],
      porTipo: [{ id: 7, descricao: 'INDICACAO SINTETICA', total: 4 }],
    });
  });
}

test.describe('@F3.1 vínculos do paciente', () => {
  test.describe.configure({ timeout: 240_000 });

  test('ficha: inclui e encerra a carteira, registra a origem; central: indicador por canal e tipo; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, pedidos);

    // Cobertura: o botão só libera com o que a fonte exige (carteira e validade), sem ida ao servidor.
    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    const cob = page.getByTestId('coberturas-paciente');
    await expect(cob.getByText('Nenhuma carteira cadastrada.')).toBeVisible();
    const form = cob.getByTestId('nova-carteira');
    await escolher(form.getByRole('combobox', { name: 'Fonte pagadora' }), { rotulo: 'OPERADORA SINTETICA' });
    const incluir = form.getByRole('button', { name: 'Incluir carteira' });
    await expect(form.getByText('Informe o número da carteira.')).toBeVisible();
    await expect(form.getByText('Esta fonte exige a validade da carteira.')).toBeVisible();
    await expect(incluir).toBeDisabled();
    await escolher(form.getByRole('combobox', { name: 'Plano' }), { rotulo: 'PLANO SINTETICO OURO' });
    await form.getByLabel('Carteira').fill('0099887766');
    await form.getByLabel('Validade').fill('2027-06-30');
    await expect(incluir).toBeEnabled();
    await semViolacaoAxe(page, `/cadastros/pacientes/${PACIENTE} (vínculos)`);
    await incluir.click();
    await expect(cob.getByRole('status')).toContainText('Carteira incluída.');
    const linha = cob.locator('tr[data-situacao="vigente"]');
    await expect(linha).toContainText('OPERADORA SINTETICA / PLANO SINTETICO OURO');
    await expect(linha).toContainText('(principal)');
    await expect(linha).toContainText('proposta no atendimento');
    expect(pedidos[0]).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/coberturas`,
      corpo: {
        fontePagadora: 3,
        plano: 31,
        numeroCarteira: '0099887766',
        validade: '2027-06-30',
        titular: true,
        titularNome: null,
        parentesco: null,
      },
    });

    // Encerrar pede o motivo e não apaga: a carteira continua na lista, encerrada, sem ações.
    page.once('dialog', (d) => void d.accept('Plano cancelado pela empresa'));
    await linha.getByRole('button', { name: 'Encerrar' }).click();
    await expect(cob.getByRole('status')).toContainText('Carteira encerrada.');
    const encerrada = cob.locator('tr[data-situacao="encerrada"]');
    await expect(encerrada).toContainText('0099887766');
    await expect(encerrada.getByRole('button')).toHaveCount(0);
    expect(pedidos[1]).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/coberturas/900/encerrar`,
      corpo: { versao: 1, motivo: 'Plano cancelado pela empresa' },
    });

    // Origem e indicação: o tipo que exige complemento pede quem indicou antes de liberar.
    const cap = page.getByTestId('captacao-paciente');
    await expect(cap.getByText('Origem não registrada.')).toBeVisible();
    const fc = cap.getByTestId('nova-captacao');
    await escolher(fc.getByRole('combobox', { name: 'Canal' }), { rotulo: 'Indicação de paciente' });
    await escolher(fc.getByRole('combobox', { name: 'Tipo de indicação' }), {
      rotulo: 'INDICACAO SINTETICA',
    });
    const registrar = fc.getByRole('button', { name: 'Registrar origem' });
    await expect(fc.getByText('Informe quem indicou.')).toBeVisible();
    await expect(registrar).toBeDisabled();
    await fc.getByLabel('Quem indicou').fill('VIZINHA SINTETICA');
    await registrar.click();
    await expect(cap.getByRole('status')).toContainText('Origem registrada.');
    await expect(cap.getByRole('listitem').first()).toContainText(
      'Indicação de paciente — INDICACAO SINTETICA: VIZINHA SINTETICA',
    );
    expect(pedidos[2]).toEqual({
      metodo: 'POST',
      caminho: 'captacoes',
      corpo: {
        canal: 'indicacao_paciente',
        tipoIndicacao: 7,
        indicadorNome: 'VIZINHA SINTETICA',
        indicadorProfissional: null,
        campanha: null,
      },
    });

    // Indicador na central: recolhido (nenhuma consulta) até abrir; abre com o mês corrente e muda com o período.
    await page.goto('/cadastros/pacientes/pre-cadastros');
    const ind = page.getByTestId('indicador-captacao');
    await expect(ind).toBeVisible();
    expect(pedidos.filter((p) => p.caminho === 'indicador')).toHaveLength(0);
    await ind.locator('summary').click();
    await expect(ind.getByTestId('indicador-total')).toContainText('4');
    await expect(ind.getByTestId('indicador-canal')).toContainText('Indicação de paciente');
    await expect(ind.getByTestId('indicador-canal')).toContainText('75');
    await expect(ind.getByTestId('indicador-tipo')).toContainText('INDICACAO SINTETICA');
    const primeiro = pedidos.find((p) => p.caminho === 'indicador');
    expect(String(primeiro?.corpo['de'])).toMatch(/^\d{4}-\d{2}-01$/);
    await ind.getByLabel('De', { exact: true }).fill('2026-01-01');
    await ind.getByLabel('De', { exact: true }).dispatchEvent('change');
    await expect
      .poll(() => pedidos.filter((p) => p.caminho === 'indicador').at(-1)?.corpo['de'])
      .toBe('2026-01-01');
    await semViolacaoAxe(page, '/cadastros/pacientes/pre-cadastros (indicador)');
  });
});
