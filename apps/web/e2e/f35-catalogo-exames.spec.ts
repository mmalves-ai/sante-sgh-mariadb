// E2E @F35-1 (F3.5, 05-SADT linhas 1, 2 e 3): o catálogo de exames do diagnóstico (`/sadt/catalogo`) pela tela.
// Linha 1: incluir o exame de laboratório (a regra do domínio segura o botão até o código, a sigla e o nome valerem),
// inativar o setor padrão e o material (a tela manda só id, versão e ativo: nada se apaga) e o procedimento operacional
// do exame (nasce em rascunho, segue para revisão; o conteúdo vai inteiro). Linha 2: o exame de imagem pede a
// modalidade na hora e leva a especialidade diagnóstica escolhida no seletor. Linha 3: o cadastro do analito recusa na
// hora o limite aceito invertido e grava o analito válido; o seletor de analitos do exame é recarregado.
// A API do catálogo é a do banco do cliente: na fonte sintética do E2E ela é simulada aqui (page.route) e o teste prova
// o que a TELA manda e mostra. O efeito no banco (versão, trilha, inativação sem apagar, aprovação pela conta da
// sessão, nova versão tornando a anterior obsoleta) é provado nos contratos de efeito catalogo-porta-propria.int.spec.ts
// e catalogo-analito-pop.int.spec.ts. Dados SINTÉTICOS. axe sem violação séria na tela.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
type Corpo = Record<string, unknown>;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** A API do catálogo simulada: guarda o que a tela enviou (rota → corpos) e devolve a ficha sintética. */
function simularCatalogo(page: Page) {
  const enviados: Record<string, Corpo[]> = {};
  let leiturasOpcoes = 0;
  const procedimentos: Corpo[] = [];
  const ficha = () => ({
    exame: {
      id: 900,
      versao: 1,
      codigo: 'E2E-GLI',
      sigla: 'GLI',
      nome: 'Glicose sintética',
      tipoServico: 'laboratorio',
      ativo: true,
    },
    setores: [{ id: 11, versao: 3, nomeSetor: 'Bioquímica sintética', padrao: true, ativo: true }],
    materiais: [{ id: 21, versao: 2, nomeMaterial: 'Soro sintético', padrao: true, ativo: true }],
    preparos: [],
    lateralidades: [],
    ligados: [],
    analitos: [],
    procedimentos,
  });
  const json = (r: Route, corpo: unknown) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  void page.route('**/api/sadt/catalogo/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/sadt/catalogo', '');
    if (req.method() === 'GET') {
      if (caminho === '/opcoes') {
        leiturasOpcoes += 1;
        return json(r, {
          setores: [{ id: 1, nome: 'Bioquímica sintética' }],
          materiais: [{ id: 2, nome: 'Soro sintético' }],
          recipientes: [],
          preparos: [],
          sexos: [],
          modalidades: [{ id: 5, nome: 'Tomografia sintética' }],
          metodos: [{ id: 6, nome: 'Enzimático sintético' }],
          especialidades: [{ id: 7, nome: 'Neurorradiologia sintética' }],
          unidades: [{ id: 8, nome: 'mg/dL · miligrama por decilitro' }],
          analitos: [],
          exames: [],
        });
      }
      if (caminho === '/exames') return json(r, []);
      if (caminho === '/exames/900') return json(r, ficha());
      if (caminho === '/analitos')
        return json(r, [{ id: 300, versao: 1, codigo: 'E2E-A1', nome: 'Analito sintético', ativo: true }]);
      return json(r, {});
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    (enviados[caminho] ??= []).push(corpo);
    if (caminho === '/exames') return json(r, { id: 900, versao: 1 });
    if (caminho === '/exames/900/procedimentos') {
      if (!corpo['id'])
        procedimentos.push({
          ...corpo,
          id: 71,
          versao: 1,
          versaoDocumento: 1,
          situacao: 'rascunho',
        });
      else Object.assign(procedimentos[0] ?? {}, { situacao: corpo['situacao'], versao: 2 });
      return json(r, { id: 71, obsoletas: [] });
    }
    if (caminho === '/analitos') return json(r, { id: 300, versao: 1 });
    return json(r, { id: Number(corpo['id'] ?? 1), versao: Number(corpo['versao'] ?? 0) + 1 });
  });
  return { enviados, leiturasOpcoes: () => leiturasOpcoes };
}

test.describe('@F35-1 catálogo de exames do diagnóstico', () => {
  test('linha 1: inclui o exame, inativa setor padrão e material, procedimento operacional; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/catalogo');
    await expect(page.getByTestId('catalogo-exames')).toBeVisible();
    await expect(page.locator('[data-testid="catalogo-exames"] select')).toHaveCount(0);

    await page.getByRole('button', { name: 'Novo exame' }).click();
    const salvar = page.getByTestId('salvar-exame');
    await expect(salvar).toBeDisabled();
    const form = page.getByTestId('form-exame');
    await form.locator('input[name="codigo"]').fill('E2E-GLI');
    await form.locator('input[name="sigla"]').fill('GLI');
    await form.locator('input[name="nome"]').fill('Glicose sintética');
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(page.getByTestId('secao-setor')).toContainText('Bioquímica sintética');
    expect(api.enviados['/exames']?.[0]).toMatchObject({
      codigo: 'E2E-GLI',
      sigla: 'GLI',
      nome: 'Glicose sintética',
      tipoServico: 'laboratorio',
      ativo: true,
    });

    await page.getByTestId('inativar-setor-11').click();
    await expect(page.getByRole('status')).toContainText('Vínculo inativado.');
    expect(api.enviados['/exames/900/setor']?.[0]).toEqual({ id: 11, versao: 3, ativo: false });
    await page.getByTestId('inativar-material-21').click();
    await expect
      .poll(() => api.enviados['/exames/900/material']?.[0])
      .toEqual({ id: 21, versao: 2, ativo: false });

    // Procedimento operacional: nasce em rascunho e segue para revisão.
    const pop = page.getByTestId('secao-procedimento');
    await pop.getByTestId('novo-procedimento').click();
    await expect(pop.getByTestId('salvar-procedimento')).toBeDisabled();
    await pop.locator('input[name="codigo-documento"]').fill('POP-E2E-01');
    await pop.locator('input[name="titulo-documento"]').fill('Dosagem de glicose sintética');
    await pop.locator('textarea[name="procedimentoTecnico"]').fill('Passos técnicos sintéticos.');
    await pop.getByTestId('salvar-procedimento').click();
    await expect(pop.getByTestId('procedimento-POP-E2E-01-v1')).toContainText('rascunho');
    expect(api.enviados['/exames/900/procedimentos']?.[0]).toMatchObject({
      codigoDocumento: 'POP-E2E-01',
      titulo: 'Dosagem de glicose sintética',
      procedimentoTecnico: 'Passos técnicos sintéticos.',
    });
    expect(api.enviados['/exames/900/procedimentos']?.[0]).not.toHaveProperty('situacao');
    await pop.getByTestId('procedimento-POP-E2E-01-v1').getByRole('button', { name: 'Abrir' }).click();
    await pop.getByTestId('revisao-procedimento').click();
    await expect(pop.getByTestId('procedimento-POP-E2E-01-v1')).toContainText('em revisão');
    expect(api.enviados['/exames/900/procedimentos']?.[1]).toEqual({
      id: 71,
      versao: 1,
      situacao: 'em_revisao',
    });

    await semViolacaoAxe(page, '/sadt/catalogo');
    expect(externas).toEqual([]);
  });

  test('linha 2: exame de imagem pede a modalidade e leva a especialidade diagnóstica', async ({ page }) => {
    const api = simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/catalogo');
    await page.getByRole('button', { name: 'Novo exame' }).click();
    const form = page.getByTestId('form-exame');
    await form.locator('input[name="codigo"]').fill('E2E-TC');
    await form.locator('input[name="sigla"]').fill('TCC');
    await form.locator('input[name="nome"]').fill('Tomografia sintética de crânio');
    await escolher(form.getByRole('combobox', { name: 'Tipo', exact: true }), 'imagem');
    // Sem a modalidade, a regra do domínio segura a gravação na hora.
    await expect(page.getByTestId('salvar-exame')).toBeDisabled();
    await escolher(form.getByRole('combobox', { name: 'Modalidade', exact: true }), {
      rotulo: 'Tomografia sintética',
    });
    await escolher(form.getByTestId('exame-especialidade'), { rotulo: 'Neurorradiologia sintética' });
    await expect(page.getByTestId('salvar-exame')).toBeEnabled();
    await page.getByTestId('salvar-exame').click();
    await expect
      .poll(() => api.enviados['/exames']?.[0])
      .toMatchObject({
        tipoServico: 'imagem',
        modalidadeImagemId: 5,
        especialidadeDiagnosticaId: 7,
      });
  });

  test('linha 3: o analito recusa na hora o limite invertido e grava o válido', async ({ page }) => {
    const api = simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/catalogo');
    await page.getByTestId('abrir-analitos').click();
    const cad = page.getByTestId('cadastro-analitos');
    await expect(cad).toContainText('Analito sintético');
    await cad.getByTestId('novo-analito').click();
    const form = cad.getByTestId('form-analito');
    await form.locator('input[name="codigo-analito"]').fill('E2E-GLI');
    await form.locator('input[name="nome-analito"]').fill('Glicose sintética');
    await form.locator('input[name="minimo"]').fill('10');
    await form.locator('input[name="maximo"]').fill('5');
    await expect(cad.getByTestId('salvar-analito')).toBeDisabled();
    await expect(form.locator('small.erro')).not.toHaveCount(0);
    await form.locator('input[name="maximo"]').fill('2000');
    await escolher(form.getByRole('combobox', { name: 'Unidade', exact: true }), {
      rotulo: 'mg/dL · miligrama por decilitro',
    });
    await expect(cad.getByTestId('salvar-analito')).toBeEnabled();
    const antes = api.leiturasOpcoes();
    await cad.getByTestId('salvar-analito').click();
    await expect(cad.getByRole('status')).toContainText('Analito gravado.');
    expect(api.enviados['/analitos']?.[0]).toMatchObject({
      codigo: 'E2E-GLI',
      nome: 'Glicose sintética',
      tipoResultado: 'numerico',
      unidadeResultadoId: 8,
      limiteMinimoAceito: 10,
      limiteMaximoAceito: 2000,
      ativo: true,
    });
    await expect.poll(() => api.leiturasOpcoes()).toBeGreaterThan(antes);
  });
});
