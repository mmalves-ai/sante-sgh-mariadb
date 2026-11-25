// E2E @F3.5-10 (F3.5, 05-SADT linha 17): laudo estruturado pela tela.
// 1) Na ficha do exame (`/sadt/catalogo`): a seção, as medidas, a faixa de referência e a fórmula da medida calculada
//    são mantidas no mesmo lugar; a regra do domínio segura cada botão enquanto há pendência (código inválido, nome que
//    não é medida do exame na fórmula, máximo menor que o mínimo, faixa do mesmo recorte no mesmo período) e a fórmula
//    descobre as variáveis pela própria expressão; a medida usada em fórmula não inativa.
// 2) Na redação do laudo (`/sadt/laudos/redacao`): num laudo novo, a medida digitada refaz a conta da calculada na
//    hora, a marca de fora da referência aparece na digitada e na calculada, a calculada não tem campo de digitação e
//    não vai no pedido (o servidor refaz a conta).
// As APIs são as do banco do cliente: na fonte sintética do E2E elas são simuladas aqui (page.route) e o teste prova o
// que a TELA manda e mostra. O efeito no banco (cadastro, fórmula, medida calculada gravada, trilha) é provado no
// contrato de efeito laudo-grandezas.int.spec.ts. Dados SINTÉTICOS.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

const json = (r: Route, corpo: unknown) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

/** A API do catálogo simulada: a ficha do exame de imagem e o laudo estruturado, que cresce com o que a tela envia. */
function simularCatalogo(page: Page) {
  const enviados: Record<string, Corpo[]> = {};
  const secoes: Corpo[] = [];
  const grandezas: (Corpo & { faixas: Corpo[]; formulas: Corpo[] })[] = [];
  void page.route('**/api/sadt/catalogo/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/sadt/catalogo', '');
    if (req.method() === 'GET') {
      if (caminho === '/opcoes')
        return json(r, {
          setores: [],
          materiais: [],
          recipientes: [],
          preparos: [],
          sexos: [],
          modalidades: [],
          metodos: [],
          especialidades: [],
          unidades: [],
          analitos: [],
          exames: [],
          gruposResposta: [],
        });
      if (caminho === '/exames')
        return json(r, [
          { id: 900, codigo: 'E2E-ECO', sigla: 'ECO', nome: 'Ecocardiograma sintético', ativo: true },
        ]);
      if (caminho === '/exames/900')
        return json(r, {
          exame: {
            id: 900,
            versao: 1,
            codigo: 'E2E-ECO',
            sigla: 'ECO',
            nome: 'Ecocardiograma sintético',
            tipoServico: 'imagem',
            ativo: true,
          },
          setores: [],
          materiais: [],
          preparos: [],
          lateralidades: [],
          ligados: [],
          analitos: [],
          procedimentos: [],
        });
      if (caminho === '/laudo-estruturado')
        return json(r, {
          exameId: 900,
          secoes,
          grandezas,
          sexos: [
            { id: 1, descricao: 'Feminino' },
            { id: 2, descricao: 'Masculino' },
          ],
          unidades: [
            { id: 5, simbolo: 'mm' },
            { id: 6, simbolo: '%' },
          ],
        });
      return json(r, []);
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    (enviados[caminho] ??= []).push(corpo);
    if (caminho === '/laudo-estruturado/secoes') {
      secoes.push({ sigla: null, ativo: true, ...corpo, id: 10 + secoes.length, versao: 1 });
      return json(r, { id: 10, versao: 1 });
    }
    if (caminho === '/laudo-estruturado/grandezas') {
      const id = 101 + grandezas.length;
      grandezas.push({ ativo: true, ...corpo, id, versao: 1, faixas: [], formulas: [] });
      return json(r, { id, versao: 1 });
    }
    if (caminho === '/laudo-estruturado/faixas') {
      const g = grandezas.find((x) => x['id'] === corpo['grandezaLaudoId']);
      g?.faixas.push({
        sexoId: null,
        idadeMinimaDias: null,
        idadeMaximaDias: null,
        pesoMinimoKg: null,
        pesoMaximoKg: null,
        superficieCorporalMinima: null,
        superficieCorporalMaxima: null,
        referenciaMinima: null,
        referenciaMaxima: null,
        indexadaSuperficie: false,
        referenciaTexto: null,
        vigenciaFim: null,
        ativo: true,
        ...corpo,
        id: 700 + (g?.faixas.length ?? 0),
        versao: 1,
      });
      return json(r, { id: 700, versao: 1 });
    }
    const formula = /^\/laudo-estruturado\/grandezas\/(\d+)\/formula$/.exec(caminho);
    if (formula) {
      const g = grandezas.find((x) => x['id'] === Number(formula[1]));
      g?.formulas.unshift({ ...corpo, id: 800 + (g?.formulas.length ?? 0), vigenciaFim: null });
      return json(r, { id: 800, encerradas: [] });
    }
    return json(r, { id: Number(corpo['id'] ?? 1), versao: Number(corpo['versao'] ?? 0) + 1 });
  });
  return { enviados };
}

/** A API da redação simulada: um exame realizado sem laudo, com duas medidas digitadas e uma calculada. */
function simularRedacao(page: Page) {
  const enviados: Corpo[] = [];
  const medida = (id: number, codigo: string, descricao: string, extra: Corpo = {}) => ({
    id,
    codigo,
    sigla: codigo,
    descricao,
    casasDecimais: 1,
    obrigatoria: false,
    calculada: false,
    ordem: id,
    unidade: null,
    secao: 10,
    ...extra,
  });
  const faixa = (grandeza: number, minima: number | null, maxima: number | null) => ({
    grandeza,
    sexo: null,
    idadeMinimaDias: null,
    idadeMaximaDias: null,
    pesoMinimoKg: null,
    pesoMaximoKg: null,
    superficieMinima: null,
    superficieMaxima: null,
    minima,
    maxima,
    indexadaSuperficie: false,
    vigenciaInicio: '2020-01-01',
    vigenciaFim: null,
  });
  void page.route('**/api/sadt/laudos/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/sadt/laudos', '');
    if (req.method() === 'GET') {
      if (caminho === '/redacao/77')
        return json(r, {
          exame: { item: 77, exame: 900, nome: 'Ecocardiograma sintético', setor: 3, tipoSetor: 'imagem' },
          paciente: {
            id: 4242,
            sexo: 'masculino',
            idadeDias: 14_610,
            dataExame: '2026-11-20',
            nome: 'PACIENTE SINTETICO',
            prontuario: 'E2E-4242',
          },
          laudo: null,
          versoes: [],
          secoes: [{ id: 10, nome: 'Ventrículo esquerdo', ordem: 1 }],
          grandezas: [
            medida(101, 'ddve', 'Diâmetro diastólico'),
            medida(102, 'dsve', 'Diâmetro sistólico'),
            medida(103, 'fenc', 'Fração de encurtamento', { calculada: true, obrigatoria: true }),
          ],
          faixas: [faixa(101, 35, 56), faixa(103, 25, 45)],
          formulas: [
            {
              grandeza: 103,
              expressao: '(dd - ds) / dd * 100',
              casas: 1,
              vigenciaInicio: '2020-01-01',
              vigenciaFim: null,
              variaveis: [
                { identificador: 'dd', fonte: 'grandeza', grandeza: 101, dadoPaciente: null },
                { identificador: 'ds', fonte: 'grandeza', grandeza: 102, dadoPaciente: null },
              ],
            },
          ],
          valores: [],
          modelos: [],
          pode: { salvar: true, assinar: true, retificar: false },
        });
      return json(r, { itens: [] });
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    enviados.push({ caminho, ...corpo });
    return json(r, { id: 1, situacao: 'rascunho', versaoAtual: 0, valores: 3, foraReferencia: 2 });
  });
  return { enviados };
}

test.describe('@F3.5-10 laudo estruturado: cadastro das medidas e medida calculada', () => {
  test('ficha do exame: seção, medidas, fórmula pela expressão e faixa de referência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/catalogo');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('button', { name: /Ecocardiograma sintético/ }).click();
    const bloco = page.getByTestId('laudo-estruturado');
    await expect(bloco).toBeVisible();
    await esperarSemSelectNativo(bloco);

    // Seção: o botão só libera com o nome.
    await bloco.getByTestId('le-secao-codigo').fill('VE');
    await expect(bloco.getByTestId('le-secao-incluir')).toBeDisabled();
    await expect(bloco.getByTestId('le-secao-pendencias')).toContainText('Informe o nome da seção');
    await bloco.getByTestId('le-secao-nome').fill('Ventrículo esquerdo');
    await bloco.getByTestId('le-secao-incluir').click();
    await expect(bloco.getByTestId('le-secoes')).toContainText('Ventrículo esquerdo (VE)');
    expect(api.enviados['/laudo-estruturado/secoes']?.[0]).toMatchObject({
      exameId: 900,
      codigo: 'VE',
      nome: 'Ventrículo esquerdo',
      ordem: 1,
    });

    // Medidas: o código inválido é barrado na hora; a seção sai do seletor.
    const medida = async (codigo: string, descricao: string, calculada = false) => {
      await bloco.getByTestId('le-medida-codigo').fill(codigo);
      await bloco.getByTestId('le-medida-descricao').fill(descricao);
      await escolher(bloco.getByTestId('le-medida-secao'), { rotulo: 'Ventrículo esquerdo' });
      if (calculada) {
        await bloco.getByTestId('le-medida-calculada').check();
        await bloco.getByTestId('le-medida-obrigatoria').check();
      }
      await bloco.getByTestId('le-medida-gravar').click();
      await expect(bloco.getByTestId(`le-medida-${codigo}`)).toContainText(descricao);
    };
    await bloco.getByTestId('le-medida-codigo').fill('1dd');
    await bloco.getByTestId('le-medida-descricao').fill('Diâmetro diastólico');
    await expect(bloco.getByTestId('le-medida-pendencias')).toContainText('começa por letra');
    await expect(bloco.getByTestId('le-medida-gravar')).toBeDisabled();
    await medida('ddve', 'Diâmetro diastólico');
    await medida('dsve', 'Diâmetro sistólico');
    await medida('fenc', 'Fração de encurtamento', true);
    expect(api.enviados['/laudo-estruturado/grandezas']).toHaveLength(3);
    expect(api.enviados['/laudo-estruturado/grandezas']?.[2]).toMatchObject({
      exameId: 900,
      codigo: 'fenc',
      secaoLaudoEstruturadoId: 10,
      calculada: true,
      obrigatoria: true,
    });
    // O código repetido também é barrado antes de enviar.
    await bloco.getByTestId('le-medida-codigo').fill('ddve');
    await bloco.getByTestId('le-medida-descricao').fill('Repetida');
    await expect(bloco.getByTestId('le-medida-pendencias')).toContainText('Já existe medida');
    await bloco.getByTestId('le-medida-codigo').fill('');
    await bloco.getByTestId('le-medida-descricao').fill('');

    // Fórmula da calculada: escrita com os códigos das medidas; o nome que não é medida do exame segura o botão.
    await bloco.getByTestId('le-detalhar-fenc').click();
    const detalhe = bloco.getByTestId('le-detalhe');
    await expect(detalhe.getByTestId('le-sem-formula')).toBeVisible();
    await detalhe.getByTestId('le-formula-expressao').fill('(ddve - xx) / ddve * 100');
    await expect(detalhe.getByTestId('le-formula-pendencias')).toContainText('xx');
    await expect(detalhe.getByTestId('le-formula-gravar')).toBeDisabled();
    await detalhe.getByTestId('le-formula-expressao').fill('(ddve - dsve) / ddve * 100');
    await expect(detalhe.getByTestId('le-formula-usa')).toContainText('ddve (Diâmetro diastólico)');
    await expect(detalhe.getByTestId('le-formula-usa')).toContainText('dsve (Diâmetro sistólico)');
    await detalhe.getByTestId('le-formula-gravar').click();
    await expect(detalhe.getByTestId('le-formulas')).toContainText('(ddve - dsve) / ddve * 100');
    expect(api.enviados['/laudo-estruturado/grandezas/103/formula']?.[0]).toMatchObject({
      expressao: '(ddve - dsve) / ddve * 100',
      casasDecimais: 1,
      variaveis: [
        { identificador: 'ddve', fonte: 'grandeza', grandezaLaudoId: 101, dadoPaciente: null },
        { identificador: 'dsve', fonte: 'grandeza', grandezaLaudoId: 102, dadoPaciente: null },
      ],
    });
    // A medida que entra na fórmula não inativa.
    await expect(bloco.getByTestId('le-inativar-ddve')).toBeDisabled();
    await expect(bloco.getByTestId('le-inativar-fenc')).toBeEnabled();

    // Faixa: máximo menor que o mínimo é barrado; gravada, outra do mesmo recorte no período também.
    await detalhe.getByTestId('le-faixa-min').fill('45');
    await detalhe.getByTestId('le-faixa-max').fill('25');
    await expect(detalhe.getByTestId('le-faixa-pendencias')).toContainText('menor que o mínimo');
    await expect(detalhe.getByTestId('le-faixa-incluir')).toBeDisabled();
    await detalhe.getByTestId('le-faixa-min').fill('25');
    await detalhe.getByTestId('le-faixa-max').fill('45');
    await detalhe.getByTestId('le-faixa-incluir').click();
    await expect(detalhe.getByTestId('le-faixas')).toContainText('25–45');
    expect(api.enviados['/laudo-estruturado/faixas']?.[0]).toMatchObject({
      grandezaLaudoId: 103,
      sexoId: null,
      referenciaMinima: 25,
      referenciaMaxima: 45,
      indexadaSuperficie: false,
    });
    await detalhe.getByTestId('le-faixa-min').fill('28');
    await detalhe.getByTestId('le-faixa-max').fill('44');
    await expect(detalhe.getByTestId('le-faixa-pendencias')).toContainText('mesmo recorte');
    await expect(detalhe.getByTestId('le-faixa-incluir')).toBeDisabled();
    // Para o sexo masculino o recorte é outro: a faixa pode entrar.
    await escolher(detalhe.getByTestId('le-faixa-sexo'), { rotulo: 'Masculino' });
    await expect(detalhe.getByTestId('le-faixa-incluir')).toBeEnabled();

    await semViolacaoAxe(page, '/sadt/catalogo');
    expect(externas).toEqual([]);
  });

  test('laudo novo: a medida digitada refaz a calculada e mostra a marca na hora', async ({ page }) => {
    const api = simularRedacao(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/sadt/laudos/redacao?item=77');
    const tela = page.getByTestId('laudo-redacao');
    await expect(tela.getByTestId('laudo-cabecalho')).toContainText('Ecocardiograma sintético');
    const calculada = tela.getByTestId('laudo-medida-fenc');
    // A calculada não se digita; sem as medidas, a tela diz o que falta (nunca zero).
    await expect(tela.locator('input[data-testid="laudo-medida-fenc"]')).toHaveCount(0);
    await expect(tela.getByTestId('laudo-conta-falta-fenc')).toContainText('Falta a medida dd');
    await tela.getByTestId('laudo-medida-ddve').fill('50');
    await expect(tela.getByTestId('laudo-conta-falta-fenc')).toContainText('Falta a medida ds');
    // (50 - 30) / 50 * 100 = 40: dentro de 25–45, sem marca.
    await tela.getByTestId('laudo-medida-dsve').fill('30');
    await expect(calculada).toContainText('40');
    await expect(tela.getByTestId('laudo-conta-falta-fenc')).toHaveCount(0);
    await expect(tela.getByTestId('laudo-fora-fenc')).toHaveCount(0);
    // (50 - 10) / 50 * 100 = 80: a calculada fica fora da referência na hora.
    await tela.getByTestId('laudo-medida-dsve').fill('10');
    await expect(calculada).toContainText('80');
    await expect(tela.getByTestId('laudo-fora-fenc')).toBeVisible();
    // A medida digitada nova também ganha a marca (diâmetro diastólico 60, referência 35–56).
    await tela.getByTestId('laudo-medida-ddve').fill('60');
    await expect(tela.getByTestId('laudo-fora-ddve')).toBeVisible();
    await expect(calculada).toContainText('83.3');

    // O pedido leva só as medidas digitadas: a calculada é refeita pelo servidor.
    await tela.getByTestId('laudo-texto').fill('Laudo sintético com medidas.');
    await tela.getByTestId('laudo-salvar').click();
    await expect(tela.getByTestId('laudo-mensagem')).toContainText('2 medida(s) fora da referência');
    expect(api.enviados.find((x) => x['caminho'] === '/redacao/77')).toMatchObject({
      caminho: '/redacao/77',
      valores: [
        { grandeza: 101, numero: 60, texto: null },
        { grandeza: 102, numero: 10, texto: null },
      ],
    });
    await semViolacaoAxe(page, '/sadt/laudos/redacao');
  });
});
