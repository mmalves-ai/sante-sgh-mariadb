// F3.1 (02-CAD linha 6): pré-cadastro de quem marca sem prontuário, pelo caminho da tela. A central grava o mínimo; na
// chegada, a recepção abre a ficha nova JÁ PREENCHIDA com o pré-cadastro e, ao gravar o paciente, o pré-cadastro é ligado
// a ele (marcações, captações e carteira passam ao paciente) sem passo a mais.
// Os vínculos exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as rotas do pré-cadastro e
// a gravação do paciente são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: o corpo de cada
// pedido, a ficha preenchida, a ligação feita na mesma ação de gravar e a acessibilidade. O efeito no banco (aviso do
// paciente existente, conversão por CPF ou escolha conferida, marcações, captações e carteira levadas, trilha) está no
// contrato de efeito (apps/api/src/modulos/cadastro/paciente-vinculos-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PRE = 55;
const PACIENTE = 1004;

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
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

/** `jaGravado`: a recepção abre a tela com o pré-cadastro que a central já gravou (outra pessoa, outro navegador). */
async function simular(page: Page, pedidos: Pedido[], jaGravado = false): Promise<void> {
  const pendente = {
    id: PRE,
    nome: 'PRE SINTETICO CHEGADA',
    nascimento: '1990-05-17',
    celular: '31999990155',
    telefone: null,
    situacao: 'pendente',
    paciente: null,
    marcacoes: 2,
  };
  let gravado = jaGravado;
  await page.route('**/api/cadastros/vinculos/opcoes', (r) =>
    json(r, {
      fontes: [{ id: 3, nome: 'OPERADORA SINTETICA', particular: false, exigeValidade: true }],
      planos: [],
      tiposIndicacao: [],
      parentescos: [],
      canais: ['telefone'],
    }),
  );
  await page.route('**/api/cadastros/pre-cadastros**', async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace('/api/cadastros/', '');
    if (req.method() === 'POST') {
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === 'pre-cadastros') {
        gravado = true;
        return json(rota, { id: PRE });
      }
      if (caminho === `pre-cadastros/${PRE}/converter`)
        return json(rota, { paciente: PACIENTE, marcacoes: 2, cobertura: null });
      return rota.fallback();
    }
    if (caminho === 'pre-cadastros') return json(rota, { itens: gravado ? [pendente] : [] });
    if (caminho === `pre-cadastros/${PRE}/conversao`)
      return json(rota, {
        acao: 'cadastrar',
        paciente: null,
        codigo: null,
        mensagem: null,
        divergencias: [],
        rascunho: {
          nome: pendente.nome,
          nascimento: pendente.nascimento,
          cpf: '52998224725',
          celular: pendente.celular,
          telefone: null,
          email: null,
        },
      });
    return rota.fallback();
  });
  // O CPF do pré-cadastro não é de paciente: a procura antes de criar não acha ninguém.
  await page.route('**/api/cadastros/pacientes/candidatos**', (r) => json(r, { candidatos: [] }));
  await page.route('**/api/cadastros/pacientes', (rota) => {
    const req = rota.request();
    if (req.method() !== 'POST') return rota.fallback();
    pedidos.push({ caminho: 'pacientes', corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
    return json(rota, { idPaciente: PACIENTE, prontuario: 1004 }, 201);
  });
}

// A central de marcação (agenda.marcacao.agendar) grava o pré-cadastro; a recepção (cadastro.paciente.criar) recebe a
// chegada. Cada cargo com o seu nível de acesso e na SUA sessão de navegador (um teste por cargo, como no hospital):
// nada da sessão da central sobra na da recepção.
test.describe('@F3.1 @F3.1-03 pré-cadastro e chegada', () => {
  test.describe.configure({ timeout: 240_000 });

  test('central de marcação grava o mínimo e o pendente aparece na lista; axe', async ({ page }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.AGENDA');
    await simular(page, pedidos);

    await page.goto('/cadastros/pacientes/pre-cadastros');
    const novo = page.getByTestId('novo-pre-cadastro');
    await expect(novo).toBeVisible();
    await semViolacaoAxe(page, 'pré-cadastros');
    await novo.locator('input[name="nome"]').fill('pre sintetico chegada');
    await novo.locator('input[name="nascimento"]').fill('1990-05-17');
    await novo.locator('input[name="celular"]').fill('(31) 99999-0155');
    await novo.locator('button[type="submit"]').click();
    await expect
      .poll(() => pedidos.find((p) => p.caminho === 'pre-cadastros')?.corpo)
      .toMatchObject({
        nome: 'pre sintetico chegada',
        nascimento: '1990-05-17',
        celular: '(31) 99999-0155',
      });

    // Gravou: a tela avisa e relê a lista, com o pendente e o cancelamento (com motivo) à mão da central.
    await expect(page.getByTestId('pre-cadastros').getByText('Pré-cadastro gravado.')).toBeVisible();
    const lista = page.getByTestId('lista-pre-cadastros');
    await expect(lista).toContainText('PRE SINTETICO CHEGADA');
    await expect(lista.getByRole('button', { name: 'Cancelar pré-cadastro' })).toBeVisible();
  });

  test('recepção: na chegada a ficha nova abre preenchida e gravar liga o pré-cadastro; axe', async ({
    page,
  }) => {
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, pedidos, true);

    // Chegada, na recepção: um clique mostra o que a ficha nova recebe e leva a ela preenchida.
    await page.goto('/cadastros/pacientes/pre-cadastros');
    await expect(page.getByTestId('pre-cadastros')).toBeVisible();
    await expect(page.getByTestId('novo-pre-cadastro')).toHaveCount(0);
    const lista = page.getByTestId('lista-pre-cadastros');
    await expect(lista).toContainText('PRE SINTETICO CHEGADA');
    await lista.getByRole('button', { name: 'Chegou' }).click();
    const chegada = page.getByTestId('chegada');
    await expect(chegada).toBeVisible();
    await chegada.getByTestId('cadastrar-do-pre').click();
    await expect(page).toHaveURL(new RegExp(`/cadastros/pacientes/novo\\?preCadastro=${PRE}$`));
    await expect(page.getByTestId('ficha-do-pre-cadastro')).toBeVisible();
    await expect(page.getByTestId('campo-nome').locator('input')).toHaveValue('PRE SINTETICO CHEGADA');
    await expect(page.getByTestId('campo-celular')).toHaveValue(/99999.?0155/);
    await semViolacaoAxe(page, 'ficha nova do pré-cadastro');

    // A recepção completa só o que faltava e grava: o paciente é criado e o pré-cadastro ligado a ele na mesma ação.
    await escolher(page.getByTestId('campo-sexo'), 'F');
    await page.getByTestId('campo-naturalidade').locator('input').fill('BELO HORIZONTE');
    await page.getByTestId('campo-cep').fill('30130-000');
    await page.getByTestId('campo-cep').blur();
    await page.getByTestId('botao-salvar-paciente').click();
    await expect(page.getByTestId('mensagem-ficha')).toContainText('Pré-cadastro ligado ao paciente');
    await expect(page).toHaveURL(new RegExp(`/cadastros/pacientes/${PACIENTE}$`));
    expect(pedidos.find((p) => p.caminho === 'pacientes')?.corpo).toMatchObject({
      nome: 'PRE SINTETICO CHEGADA',
      nascimento: '1990-05-17',
      cpf: '52998224725',
      celular: '31999990155',
    });
    expect(pedidos.find((p) => p.caminho === `pre-cadastros/${PRE}/converter`)?.corpo).toEqual({
      paciente: PACIENTE,
    });
  });
});
