// E2E @F3.1-12 (ficha docs/fases/fichas/F3.1-cadastros.md, 02-CAD linha 26): logotipos e mantenedora do
// estabelecimento pelo caminho da tela (/cadastros/estrutura, abas Logotipos e Mantenedora). Validação na hora: o
// arquivo que não é imagem não segue; o envio para a finalidade que já tem logotipo avisa o que substitui; a alteração
// que deixaria dois ativos na finalidade segura a gravação; excluir e ligar pedem o motivo; na mantenedora, o CNPJ que
// não confere e a operadora sem registro na agência seguram a gravação, e o responsável legal entra pelo CPF inteiro.
// As rotas /api/cadastros/estrutura-gestao exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as
// respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (arquivo com o estabelecimento como
// dono, um ativo por finalidade, sequência, exclusão lógica com motivo na trilha, pessoa jurídica única por CNPJ,
// ligação do estabelecimento) está em apps/api/src/modulos/cadastro/identidade-estabelecimento.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Imagem sintética de 1 ponto (PNG).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

type Pedido = { metodo: string; caminho: string; corpo: Record<string, unknown> };

const ESTRUTURA = {
  estabelecimento: {
    id: 1,
    versao: 3,
    codigo: 'E1',
    razaoSocial: 'HOSPITAL SINTETICO LTDA',
    nomeFantasia: 'HOSPITAL SINTETICO',
    cnpj: null,
    inscricaoEstadual: null,
    inscricaoMunicipal: null,
    cnes: null,
    tipo: null,
    porte: null,
    esfera: null,
    hospitalDia: false,
    cep: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    telefone: null,
    email: null,
    site: null,
    inicioAtividade: null,
    fimAtividade: null,
  },
  unidades: [],
  setores: [],
  opcoes: { tipos: [], portes: [], esferas: [], centrosCusto: [] },
};

const logotipo = (id: number, sequencia: number, finalidade: string, ativo: boolean) => ({
  id,
  versao: 1,
  sequencia,
  finalidade,
  largura: 320,
  altura: 120,
  cabecalhoRelatorio: null,
  rodapeRelatorio: null,
  imprimeEmRelatorio: true,
  ativo,
  enviadoEm: '2026-11-20',
  nomeOriginal: `logo-${sequencia}.png`,
  tipoMime: 'image/png',
  tamanho: 2048,
});

const MANTENEDORA_OUTRA = {
  id: 52,
  versao: 4,
  codigo: 'MANT-B',
  ativo: true,
  razaoSocial: 'FUNDACAO SINTETICA B',
  nomeFantasia: null,
  cnpj: '45723174000110',
  naturezaJuridica: null,
  inscricaoEstadual: null,
  inscricaoMunicipal: null,
  nire: null,
  dataRegistroNire: null,
  registroCivil: null,
  dataRegistroCivil: null,
  cnaePrincipal: null,
  registroAns: null,
  optanteSimples: false,
  filantropica: true,
  incentivoCultural: false,
  tipoDeclarante: null,
  responsavel: null,
  responsavelNome: null,
  contador: null,
  contadorNome: null,
  contadorCrc: null,
  site: null,
  estabelecimentos: 1,
};

const identidade = (extra: Record<string, unknown> = {}) => ({
  estabelecimento: 1,
  logotipos: [logotipo(7, 2, 'relatorio', true), logotipo(6, 1, 'relatorio', false)],
  mantenedora: null,
  mantenedoras: [MANTENEDORA_OUTRA],
  opcoes: {
    finalidades: [
      'documento',
      'relatorio',
      'prescricao',
      'etiqueta',
      'tela',
      'email',
      'orgao_publico',
      'portal',
    ],
    tiposDeclarante: ['prestador_saude', 'operadora', 'prestador_e_operadora'],
    naturezas: [{ id: 9, descricao: '3069 · FUNDACAO PRIVADA' }],
  },
  ...extra,
});

/** Simula as rotas da estrutura e da identidade; devolve os pedidos de gravação recebidos. */
async function simular(page: Page): Promise<Pedido[]> {
  const pedidos: Pedido[] = [];
  await page.route('**/api/cadastros/estrutura-gestao**', (rota) => {
    const r = rota.request();
    const url = new URL(r.url());
    const caminho = url.pathname;
    if (r.method() !== 'GET') {
      pedidos.push({
        metodo: r.method(),
        caminho,
        corpo: (r.postDataJSON() ?? {}) as Record<string, unknown>,
      });
      return json(rota, caminho.endsWith('/logotipos') ? { ids: [8, 9] } : { id: 51 });
    }
    if (caminho.endsWith('/identidade/pessoa'))
      return json(rota, {
        pessoa:
          url.searchParams.get('cpf') === '52998224725' ? { id: 301, nome: 'RESPONSAVEL SINTETICO' } : null,
      });
    if (caminho.endsWith('/identidade')) return json(rota, identidade());
    if (caminho.endsWith('/imagem')) return json(rota, { tipo: 'image/png', conteudo: PNG_BASE64 });
    return json(rota, ESTRUTURA);
  });
  return pedidos;
}

test.describe('Logotipos e mantenedora do estabelecimento @F3.1-12 @F3.1', () => {
  test.setTimeout(180_000);

  test('logotipos: painel por finalidade, envio para várias finalidades com o aviso, alterar e excluir; axe', async ({
    page,
  }) => {
    const pedidos = await simular(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura');
    await page.getByTestId('aba-logotipos').click();
    await expect(page.getByRole('heading', { name: 'Logotipos por finalidade de uso' })).toBeVisible();

    // Painel: a finalidade com logotipo ativo mostra a imagem e as dimensões; a sem logotipo diz que falta.
    await expect(page.getByTestId('finalidade-relatorio')).toContainText('320 × 120');
    await expect(page.getByTestId('finalidade-relatorio').getByRole('img')).toBeVisible();
    await expect(page.getByTestId('finalidade-documento')).toContainText('Sem logotipo');

    // Envio: sem imagem e sem finalidade o botão segura; o que não é imagem é recusado na hora.
    const enviar = page.getByTestId('enviar-logotipo');
    await expect(enviar).toBeDisabled();
    const arquivo = page.getByTestId('arquivo-logotipo');
    await arquivo.setInputFiles({ name: 'texto.txt', mimeType: 'text/plain', buffer: Buffer.from('texto') });
    await expect(page.getByTestId('arquivo-logotipo-erro')).toBeVisible();
    await arquivo.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    });
    await expect(page.getByTestId('arquivo-logotipo-erro')).toHaveCount(0);
    await expect(enviar).toBeDisabled();
    await page.locator('input[name="usar-documento"]').check();
    await expect(page.getByTestId('logotipo-substitui')).toHaveCount(0);
    await page.locator('input[name="usar-relatorio"]').check();
    await expect(page.getByTestId('logotipo-substitui')).toContainText('Relatórios');
    await page.locator('input[name="cabecalhoRelatorio"]').fill('HOSPITAL SINTETICO');
    await enviar.click();
    await expect(page.getByTestId('logotipo-gravado')).toBeVisible();
    const envio = pedidos.find((x) => x.caminho.endsWith('/logotipos'))!;
    expect(envio.metodo).toBe('POST');
    expect(envio.corpo).toMatchObject({
      nomeOriginal: 'logo.png',
      finalidades: ['documento', 'relatorio'],
      cabecalhoRelatorio: 'HOSPITAL SINTETICO',
      imprimeEmRelatorio: true,
    });
    expect(String(envio.corpo['conteudo'])).toMatch(/^data:image\/png;base64,/);

    // Alterar: reativar o antigo da finalidade que já tem ativo segura a gravação; outra finalidade libera.
    await page.getByTestId('editar-logotipo-1').click();
    await page.locator('input[name="edicao-ativo"]').check();
    await expect(page.getByTestId('logotipo-dois-ativos')).toBeVisible();
    await expect(page.getByTestId('gravar-logotipo')).toBeDisabled();
    await escolher(page.getByTestId('logotipo-finalidade'), 'portal');
    await expect(page.getByTestId('logotipo-dois-ativos')).toHaveCount(0);
    await page.getByTestId('gravar-logotipo').click();
    await expect(page.getByTestId('logotipo-gravado')).toBeVisible();
    const alteracao = pedidos.find((x) => x.caminho.endsWith('/logotipos/6'))!;
    expect(alteracao.metodo).toBe('PUT');
    expect(alteracao.corpo).toMatchObject({ versao: 1, finalidade: 'portal', ativo: true });

    // Excluir: só com o motivo.
    await page.getByTestId('excluir-logotipo-2').click();
    const confirmar = page.getByTestId('confirmar-exclusao-logotipo');
    await expect(confirmar).toBeDisabled();
    await page.locator('input[name="motivo-exclusao"]').fill('Logotipo antigo da marca');
    await confirmar.click();
    await expect(page.getByTestId('logotipo-gravado')).toBeVisible();
    const exclusao = pedidos.find((x) => x.caminho.endsWith('/logotipos/7/excluir'))!;
    expect(exclusao.corpo).toMatchObject({ versao: 1, motivo: 'Logotipo antigo da marca' });
    await semViolacaoAxe(page, 'estrutura: logotipos');
  });

  test('mantenedora: nova com CNPJ e regras conferidos na hora, responsável pelo CPF, ligar outra com motivo; axe', async ({
    page,
  }) => {
    const pedidos = await simular(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura');
    await page.getByTestId('aba-mantenedora').click();
    await expect(page.getByRole('heading', { name: 'Mantenedora do estabelecimento' })).toBeVisible();
    await expect(page.getByTestId('sem-mantenedora')).toBeVisible();

    // Nova: sem os dados mínimos o botão segura; CNPJ com dígito errado avisa e segura.
    await page.getByTestId('nova-mantenedora').click();
    const gravar = page.getByTestId('gravar-mantenedora');
    await expect(gravar).toBeDisabled();
    await page.locator('input[name="mantenedora-codigo"]').fill('MANT-A');
    await page.locator('input[name="mantenedora-razaoSocial"]').fill('ASSOCIACAO SINTETICA A');
    const cnpj = page.locator('input[name="mantenedora-cnpj"]');
    await cnpj.fill('11444777000160');
    await expect(page.getByTestId('mantenedora-avisos')).toContainText('O CNPJ não confere.');
    await expect(gravar).toBeDisabled();
    await cnpj.fill('11444777000161');
    await expect(page.getByTestId('mantenedora-avisos')).toHaveCount(0);
    await expect(gravar).toBeEnabled();

    // Quem declara como operadora informa o registro na agência.
    await escolher(page.getByTestId('mantenedora-declarante'), 'operadora');
    await expect(page.getByTestId('mantenedora-avisos')).toContainText('registro na agência');
    await expect(gravar).toBeDisabled();
    await page.locator('input[name="mantenedora-registroAns"]').fill('123456');
    await expect(gravar).toBeEnabled();

    // Responsável legal pelo CPF inteiro: o CPF sem cadastro avisa; o cadastrado traz o nome.
    const buscar = page.getByTestId('buscar-responsavel');
    await expect(buscar).toBeDisabled();
    await page.locator('input[name="cpf-responsavel"]').fill('11144477735');
    await buscar.click();
    await expect(page.getByText('Nenhuma pessoa cadastrada com este CPF')).toBeVisible();
    await page.locator('input[name="cpf-responsavel"]').fill('529.982.247-25');
    await buscar.click();
    await expect(page.getByTestId('mantenedora-responsavel-nome')).toHaveText('RESPONSAVEL SINTETICO');
    await semViolacaoAxe(page, 'estrutura: mantenedora');

    await gravar.click();
    await expect(page.getByTestId('mantenedora-gravada')).toBeVisible();
    const inclusao = pedidos.find((x) => x.caminho.endsWith('/mantenedoras'))!;
    expect(inclusao.metodo).toBe('POST');
    expect(inclusao.corpo).toMatchObject({
      codigo: 'MANT-A',
      razaoSocial: 'ASSOCIACAO SINTETICA A',
      cnpj: '11444777000161',
      tipoDeclarante: 'operadora',
      registroAns: '123456',
      responsavel: 301,
      ligar: true,
    });

    // Ligar a outra já cadastrada: só com o motivo; a que tem estabelecimento ligado não inativa.
    await escolher(page.getByTestId('outra-mantenedora'), '52');
    await expect(page.getByTestId('situacao-mantenedora')).toBeDisabled();
    await page.getByTestId('ligar-mantenedora').click();
    const confirmar = page.getByTestId('confirmar-mantenedora');
    await expect(confirmar).toBeDisabled();
    await page.locator('input[name="motivo-mantenedora"]').fill('Hospital passou para a fundação');
    await confirmar.click();
    await expect(page.getByTestId('mantenedora-gravada')).toBeVisible();
    const ligacao = pedidos.find((x) => x.caminho.endsWith('/mantenedora-ligada'))!;
    expect(ligacao.corpo).toEqual({ mantenedora: 52, motivo: 'Hospital passou para a fundação' });
  });
});
