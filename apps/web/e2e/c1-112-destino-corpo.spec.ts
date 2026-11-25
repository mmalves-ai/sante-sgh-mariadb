// E2E @C1-112 (F8, 09-AREA linha 74): o destino do corpo após o óbito pelo caminho da tela (`/internacao/obitos`).
// O painel mostra o óbito com o que falta; quem tem as permissões (SINT.OBITO) escolhe a funerária e o cartório da
// declaração de óbito num formulário só, registra a guarda no necrotério e libera o corpo à família ou à funerária,
// com a validação na hora pela regra do domínio (sem a entrega da declaração e com CPF inválido o botão trava); depois
// inclui uma funerária com o telefone do plantão. Os combos são SanteSelecao (nenhum <select> nativo). O destino só
// existe no banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com
// massa SINTÉTICA, no contrato do servidor. O que fica no banco está no contrato de efeito
// (apps/api/src/modulos/adt/destino-corpo-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

const OBITO_EM = new Date(Date.now() - 3 * 3600_000).toISOString();

function simular(page: Page) {
  const funerarias = [
    {
      id: 71,
      nome: 'Funerária Sintética Alfa',
      telefone: null,
      telefonePlantao: '11999990001',
      email: null,
      documentosExigidos: null,
      observacao: null,
      ativo: true,
      versao: 1,
    },
  ];
  const obito = {
    declaracao: 501,
    versao: 1,
    paciente: 9001,
    pacienteNome: 'Paciente Sintético Um',
    atendimento: 8001,
    numero: '1120001',
    situacao: 'emitida',
    obitoEm: OBITO_EM,
    encaminhadoServicoVerificacao: false,
    funeraria: null as null | { id: number; nome: string; telefonePlantao: string | null },
    cartorio: null as null | { id: number; descricao: string },
    guarda: null as null | Record<string, unknown>,
    pendencias: ['funeraria', 'cartorio', 'guarda'],
  };
  const st = { corpos: [] as { url: string; corpo: Record<string, unknown> }[] };
  const B = '/api/internacao/destino-corpo';
  void page.route(new RegExp(`${B}/apoio$`), (r) =>
    json(r, {
      funerarias: funerarias.filter((f) => f.ativo),
      cartorios: [{ id: 31, descricao: 'Cartório Sintético Central', padrao: true }],
      parentescos: [{ id: 3, descricao: 'Filho(a)' }],
    }),
  );
  void page.route(new RegExp(`${B}/obitos`), (r) => json(r, [obito]));
  void page.route(new RegExp(`${B}/funerarias(\\?.*)?$`), async (r) => {
    if (r.request().method() === 'GET') return json(r, funerarias);
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    const nova = {
      ...funerarias[0]!,
      ...corpo,
      id: 72,
      ativo: true,
      versao: 1,
    } as (typeof funerarias)[number];
    funerarias.push(nova);
    return json(r, { id: 72 }, 201);
  });
  void page.route(new RegExp(`${B}/declaracoes/501/destino$`), async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    obito.versao += 1;
    obito.funeraria = { id: 71, nome: 'Funerária Sintética Alfa', telefonePlantao: '11999990001' };
    obito.cartorio = { id: 31, descricao: 'Cartório Sintético Central' };
    obito.pendencias = ['guarda'];
    return json(r, obito);
  });
  void page.route(new RegExp(`${B}/guardas$`), async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    obito.guarda = {
      id: 601,
      situacao: 'em_guarda',
      entradaNecroterio: null,
      localGuarda: String(corpo['localGuarda'] ?? ''),
      encaminhadoIml: false,
      funeraria: 71,
      retiranteNome: null,
      documentosConferidos: false,
      declaracaoEntregue: false,
      pertencesEntregues: false,
      liberadoEm: null,
      retiradoEm: null,
      versao: 1,
    };
    obito.pendencias = ['liberacao'];
    return json(r, { id: 601 }, 201);
  });
  void page.route(new RegExp(`${B}/guardas/601/acao$`), async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    Object.assign(obito.guarda!, {
      situacao: 'liberado',
      retiranteNome: corpo['retiranteNome'],
      liberadoEm: new Date().toISOString(),
      versao: 2,
    });
    obito.pendencias = ['retirada'];
    return json(r, { id: 601, situacao: 'liberado' });
  });
  return st;
}

test.describe('internação: destino do corpo após o óbito @C1-112 @F8', () => {
  test.setTimeout(180_000);

  test('escolhe funerária e cartório, registra a guarda, libera com validação na hora e inclui funerária; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.OBITO');
    await page.goto('/internacao/obitos');
    const tela = page.getByTestId('tela-destino-corpo');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('obito-501')).toContainText('funerária, cartório, guarda');
    await esperarSemSelectNativo(tela);
    await semViolacaoAxe(page, 'destino do corpo: painel');

    // Funerária e cartório na declaração, num formulário só (o cartório padrão já vem escolhido).
    await escolher(page.getByTestId('destino-corpo-funeraria'), { rotulo: 'Funerária Sintética Alfa' });
    await expect(page.getByTestId('destino-corpo-plantao')).toContainText('11999990001');
    await page.getByTestId('destino-corpo-gravar').click();
    await expect(page.getByTestId('destino-corpo-aviso')).toContainText('Destino gravado');
    expect(st.corpos.at(-1)?.corpo).toEqual({ funeraria: 71, cartorio: 31, versao: 1 });

    // Guarda no necrotério.
    await page.getByTestId('destino-corpo-local').fill('Câmara 2');
    await page.getByTestId('destino-corpo-abrir').click();
    await expect(page.getByTestId('destino-corpo-situacao')).toContainText('Em guarda');
    expect(st.corpos.at(-1)?.corpo).toMatchObject({ declaracao: 501, localGuarda: 'Câmara 2' });

    // Liberação: a regra do domínio trava sem a entrega da declaração e com CPF inválido.
    const confirmar = page.getByTestId('destino-corpo-confirmar');
    await page.getByTestId('destino-corpo-retirante').fill('Pessoa Sintética');
    await page.getByTestId('destino-corpo-cpf').fill('111.111.111-11');
    await page.getByTestId('destino-corpo-conferidos').check();
    await expect(page.getByTestId('destino-corpo-problemas')).toContainText('entrega da declaração');
    await expect(page.getByTestId('destino-corpo-problemas')).toContainText('CPF de quem retira inválido');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('destino-corpo-entregue').check();
    await page.getByTestId('destino-corpo-cpf').fill('529.982.247-25');
    await escolher(page.getByTestId('destino-corpo-parentesco'), { rotulo: 'Filho(a)' });
    await expect(page.getByTestId('destino-corpo-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, 'destino do corpo: liberação preenchida');
    await confirmar.click();
    await expect(page.getByTestId('destino-corpo-situacao')).toContainText('Liberado');
    expect(st.corpos.at(-1)?.corpo).toMatchObject({
      acao: 'liberar',
      versao: 1,
      funeraria: 71,
      retiranteNome: 'Pessoa Sintética',
      retiranteCpf: '529.982.247-25',
      parentesco: 3,
      documentosConferidos: true,
      declaracaoEntregue: true,
    });

    // Funerária nova: sem telefone a regra trava; com o do plantão, grava.
    const salvar = page.getByTestId('funeraria-salvar');
    await page.getByTestId('funeraria-nome').fill('Funerária Sintética Beta');
    await expect(page.getByTestId('funeraria-problemas')).toContainText('ao menos um telefone');
    await expect(salvar).toBeDisabled();
    await page.getByTestId('funeraria-plantao').fill('(11) 98888-0002');
    await salvar.click();
    await expect(page.getByTestId('destino-corpo-aviso')).toContainText('Funerária gravada');
    expect(st.corpos.at(-1)?.corpo).toMatchObject({
      nome: 'Funerária Sintética Beta',
      telefonePlantao: '(11) 98888-0002',
    });
    await semViolacaoAxe(page, 'destino do corpo: funerárias');
    expect(externas).toEqual([]);
  });
});
