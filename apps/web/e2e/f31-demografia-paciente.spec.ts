// F3.1 (02-CAD linha 15): dados demográficos e vulnerabilidades do paciente na ficha, pelo caminho da tela. As rotas
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as rotas da demografia são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: validação na hora (nome social usado sem o nome, raça/cor
// indígena sem o povo, capacidade civil que exige responsável sem responsável vigente; o botão só libera sem
// pendência), o povo indígena que só aparece com a raça/cor que o exige, a ocupação por busca, o corpo de cada pedido,
// a leitura recarregada depois de gravar, a vulnerabilidade declarada e encerrada (sem apagar: fica na lista como
// encerrada) e a acessibilidade. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/cadastro/demografia-paciente.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const HOJE = '2026-11-24';

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

const op = (id: number, descricao: string, marca = false) => ({ id, descricao, marca });

async function simular(page: Page, pedidos: Pedido[]): Promise<void> {
  const gravado: Record<string, unknown> = {
    usaNomeSocial: false,
    nomeSocial: null,
    identidadeGenero: null,
    racaCor: null,
    povoIndigena: null,
    escolaridade: null,
    religiao: null,
    nacionalidade: null,
    paisNascimento: null,
    capacidadeCivil: null,
    ocupacao: null,
  };
  const vulnerabilidades: Record<string, unknown>[] = [];
  const ocupacoes = [
    { id: 501, descricao: '322205 TECNICO DE ENFERMAGEM SINTETICO' },
    { id: 502, descricao: '223505 ENFERMEIRO SINTETICO' },
  ];
  await page.route('**/api/cadastros/ocupacoes-em-uso**', (rota) => {
    const termo = new URL(rota.request().url()).searchParams.get('termo') ?? '';
    pedidos.push({ metodo: 'GET', caminho: 'ocupacoes-em-uso', corpo: { termo } });
    return json(rota, { itens: ocupacoes });
  });
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/demografia`, (rota) => {
    const req = rota.request();
    if (req.method() === 'GET')
      return json(rota, {
        paciente: PACIENTE,
        hoje: HOJE,
        nome: 'PACIENTE SINTETICO',
        ...gravado,
        ocupacao: ocupacoes.find((o) => o.id === gravado['ocupacao']) ?? null,
        temRepresentanteVigente: false,
        opcoes: {
          identidadeGenero: [op(11, 'MULHER CIS SINTETICA'), op(12, 'MULHER TRANS SINTETICA', true)],
          racaCor: [op(21, 'PARDA SINTETICA'), op(22, 'INDIGENA SINTETICA', true)],
          povoIndigena: [op(31, 'POVO SINTETICO')],
          escolaridade: [op(41, 'MEDIO COMPLETO SINTETICO')],
          religiao: [op(51, 'SEM RELIGIAO SINTETICA')],
          nacionalidade: [op(61, 'BRASILEIRA SINTETICA')],
          paisNascimento: [op(71, 'BRASIL SINTETICO')],
          capacidadeCivil: [op(81, 'PLENA SINTETICA'), op(82, 'INCAPAZ SINTETICA', true)],
          condicoesVulnerabilidade: [op(91, 'SITUACAO DE RUA SINTETICA')],
          informantes: ['paciente', 'responsavel', 'familiar', 'profissional', 'servico_social', 'outro'],
        },
        vulnerabilidades,
      });
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: req.method(), caminho: `pacientes/${PACIENTE}/demografia`, corpo });
    Object.assign(gravado, corpo);
    return json(rota, { id: PACIENTE });
  });
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/vulnerabilidades**`, (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ metodo: req.method(), caminho, corpo });
    if (caminho.endsWith('/encerrar')) {
      const v = vulnerabilidades.find((x) => caminho.includes(`/vulnerabilidades/${String(x['id'])}/`));
      if (v) Object.assign(v, { vigente: false, fim: corpo['fim'] });
      return json(rota, { id: v?.['id'] ?? 0 });
    }
    const id = 700 + vulnerabilidades.length;
    vulnerabilidades.unshift({
      id,
      condicao: { id: 91, descricao: 'SITUACAO DE RUA SINTETICA' },
      declaradaEm: corpo['declaradaEm'],
      informanteTipo: corpo['informanteTipo'],
      informanteNome: corpo['informanteNome'],
      fim: null,
      vigente: true,
      observacao: null,
    });
    return json(rota, { id }, 201);
  });
}

test.describe('@F3.1 @F3.1-07 dados demográficos do paciente', () => {
  test.describe.configure({ timeout: 240_000 });

  test('ficha: validação na hora, povo só com a raça/cor que o exige, ocupação por busca, vulnerabilidade; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, pedidos);

    await page.goto(`/cadastros/pacientes/${PACIENTE}`);
    const bloco = page.getByTestId('demografia-paciente');
    await expect(bloco.getByTestId('demografia-leitura')).toContainText('Não informado');
    await bloco.getByTestId('editar-demografia').click();
    const form = bloco.getByTestId('form-demografia');
    const gravar = form.getByRole('button', { name: 'Gravar dados demográficos' });
    await expect(gravar).toBeEnabled();

    // Nome social: usado sem o nome trava o botão, na hora, sem ida ao servidor.
    await form.getByLabel('Usa nome social').check();
    await expect(form.getByText('Informe o nome social, ou desmarque o uso dele.')).toBeVisible();
    await expect(gravar).toBeDisabled();
    await form.getByLabel('Nome social', { exact: true }).fill('JOANA SINTETICA');
    await expect(gravar).toBeEnabled();

    // Povo indígena: só aparece com a raça/cor que o exige, e passa a ser obrigatório.
    await expect(form.getByRole('combobox', { name: 'Povo indígena (etnia)' })).toHaveCount(0);
    await escolher(form.getByRole('combobox', { name: 'Raça/cor' }), { rotulo: 'INDIGENA SINTETICA' });
    await expect(form.getByText('Para a raça/cor indígena, informe o povo indígena (etnia).')).toBeVisible();
    await expect(gravar).toBeDisabled();
    await escolher(form.getByRole('combobox', { name: 'Povo indígena (etnia)' }), {
      rotulo: 'POVO SINTETICO',
    });
    await expect(gravar).toBeEnabled();

    // Capacidade civil que exige responsável legal: sem responsável vigente na ficha, o botão trava.
    await escolher(form.getByRole('combobox', { name: 'Capacidade civil' }), { rotulo: 'INCAPAZ SINTETICA' });
    await expect(form.getByText(/Esta capacidade civil exige responsável legal/)).toBeVisible();
    await expect(gravar).toBeDisabled();
    await escolher(form.getByRole('combobox', { name: 'Capacidade civil' }), { rotulo: 'PLENA SINTETICA' });
    await expect(gravar).toBeEnabled();

    // Ocupação por busca (a partir de 3 letras) e os demais vocabulários.
    const ocupacao = form.getByTestId('ocupacao-paciente');
    await ocupacao.getByLabel('Buscar ocupação (código ou parte do nome)').fill('en');
    await expect(ocupacao.getByText('Digite ao menos 3 letras.')).toBeVisible();
    await ocupacao.getByLabel('Buscar ocupação (código ou parte do nome)').fill('enferm');
    await ocupacao.getByRole('button', { name: '223505 ENFERMEIRO SINTETICO' }).click();
    await expect(ocupacao).toContainText('Ocupação: 223505 ENFERMEIRO SINTETICO');
    await escolher(form.getByRole('combobox', { name: 'Escolaridade' }), {
      rotulo: 'MEDIO COMPLETO SINTETICO',
    });
    await escolher(form.getByRole('combobox', { name: 'Nacionalidade' }), { rotulo: 'BRASILEIRA SINTETICA' });
    await semViolacaoAxe(page, `/cadastros/pacientes/${PACIENTE} (demografia, edição)`);
    await gravar.click();
    await expect(bloco.getByRole('status')).toContainText('Dados demográficos gravados.');
    expect(pedidos.find((p) => p.metodo === 'PUT')).toEqual({
      metodo: 'PUT',
      caminho: `pacientes/${PACIENTE}/demografia`,
      corpo: {
        usaNomeSocial: true,
        nomeSocial: 'JOANA SINTETICA',
        identidadeGenero: null,
        racaCor: 22,
        povoIndigena: 31,
        escolaridade: 41,
        religiao: null,
        nacionalidade: 61,
        paisNascimento: null,
        capacidadeCivil: 81,
        ocupacao: 502,
      },
    });
    expect(pedidos.filter((p) => p.caminho === 'ocupacoes-em-uso').map((p) => p.corpo['termo'])).toEqual([
      'enferm',
    ]);
    const leitura = bloco.getByTestId('demografia-leitura');
    await expect(leitura).toContainText('JOANA SINTETICA');
    await expect(leitura).toContainText('INDIGENA SINTETICA');
    await expect(leitura).toContainText('POVO SINTETICO');
    await expect(leitura).toContainText('223505 ENFERMEIRO SINTETICO');

    // Trocar a raça/cor tira o povo indígena do pedido (o campo some da tela).
    await bloco.getByTestId('editar-demografia').click();
    await escolher(form.getByRole('combobox', { name: 'Raça/cor' }), { rotulo: 'PARDA SINTETICA' });
    await expect(form.getByRole('combobox', { name: 'Povo indígena (etnia)' })).toHaveCount(0);
    await gravar.click();
    await expect(bloco.getByRole('status')).toContainText('Dados demográficos gravados.');
    const segundo = pedidos.filter((p) => p.metodo === 'PUT')[1]!;
    expect([segundo.corpo['racaCor'], segundo.corpo['povoIndigena']]).toEqual([21, null]);

    // Vulnerabilidade: informante familiar pede o nome; declarada entra como vigente; encerrada fica na lista.
    const nova = bloco.getByTestId('nova-vulnerabilidade');
    const declarar = nova.getByRole('button', { name: 'Declarar condição' });
    await expect(declarar).toBeDisabled();
    await escolher(nova.getByRole('combobox', { name: 'Condição' }), { rotulo: 'SITUACAO DE RUA SINTETICA' });
    await nova.getByLabel('Declarada em').fill('2026-11-10');
    await escolher(nova.getByRole('combobox', { name: 'Quem informou' }), { rotulo: 'Familiar' });
    await expect(nova.getByText('Informe o nome de quem declarou a condição.')).toBeVisible();
    await expect(declarar).toBeDisabled();
    await nova.getByLabel('Nome de quem informou').fill('IRMA SINTETICA');
    await declarar.click();
    await expect(bloco.getByRole('status')).toContainText('Condição declarada.');
    expect(pedidos.find((p) => p.caminho === `pacientes/${PACIENTE}/vulnerabilidades`)).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/vulnerabilidades`,
      corpo: {
        condicao: 91,
        declaradaEm: '2026-11-10',
        informanteTipo: 'familiar',
        informanteNome: 'IRMA SINTETICA',
      },
    });
    const vigente = bloco.locator('tr[data-situacao="vigente"]');
    await expect(vigente).toContainText('SITUACAO DE RUA SINTETICA');
    await expect(vigente).toContainText('Familiar (IRMA SINTETICA)');
    // A mesma condição vigente não é declarada de novo.
    await escolher(nova.getByRole('combobox', { name: 'Condição' }), { rotulo: 'SITUACAO DE RUA SINTETICA' });
    await expect(nova.getByText('O paciente já tem esta condição vigente.')).toBeVisible();
    await expect(declarar).toBeDisabled();
    await semViolacaoAxe(page, `/cadastros/pacientes/${PACIENTE} (demografia, vulnerabilidade)`);
    const encerrar = vigente.getByRole('button', { name: 'Encerrar' });
    await expect(encerrar).toBeDisabled();
    await vigente.getByLabel('Data do fim').fill('2026-11-20');
    await encerrar.click();
    await expect(bloco.getByRole('status')).toContainText('Condição encerrada.');
    const encerrada = bloco.locator('tr[data-situacao="encerrada"]');
    await expect(encerrada).toContainText('Encerrada 20/11/2026');
    await expect(encerrada.getByRole('button')).toHaveCount(0);
    expect(pedidos.at(-1)).toEqual({
      metodo: 'POST',
      caminho: `pacientes/${PACIENTE}/vulnerabilidades/700/encerrar`,
      corpo: { fim: '2026-11-20' },
    });
  });
});
