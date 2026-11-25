// E2E @F3.5-01 (F3.5, 05-SADT linha 3): respostas, textos padrão e fórmula pela tela.
// 1) Na ficha do exame (`/sadt/catalogo`): o grupo de respostas é mantido com as respostas na mesma gravação (a regra
//    do domínio segura o botão enquanto a resposta crítica não é anormal), o grupo é ligado ao analito do exame por
//    seletor (a tela manda só id, versão e o grupo) e o texto padrão do exame é incluído e inativado (nada se apaga).
// 2) Na digitação (`/sadt/resultados/digitacao`): o analito calculado mostra o que falta e, digitados o analito e a
//    variável, a conta da fórmula aparece na hora; a resposta padrão preenche o analito qualitativo e o texto padrão
//    entra na observação.
// As APIs são as do banco do cliente: na fonte sintética do E2E elas são simuladas aqui (page.route) e o teste prova o
// que a TELA manda e mostra. O efeito no banco (grupo, respostas, texto, calculado gravado pela fórmula, variável
// guardada, trilha) é provado no contrato de efeito catalogo-respostas-formula.int.spec.ts. Dados SINTÉTICOS.
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

/** A API do catálogo simulada: guarda o que a tela enviou e devolve a ficha, os grupos e os textos sintéticos. */
function simularCatalogo(page: Page) {
  const enviados: Record<string, Corpo[]> = {};
  const grupos: Corpo[] = [];
  const textos: Corpo[] = [];
  const analito: Corpo = {
    id: 31,
    versao: 4,
    analitoId: 300,
    nomeAnalito: 'Sorologia sintética',
    ordem: 1,
    calculado: false,
    grupoRespostaId: null,
    ativo: true,
  };
  void page.route('**/api/sadt/catalogo/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace('/api/sadt/catalogo', '');
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
          analitos: [{ id: 300, nome: 'Sorologia sintética (E2E-SOR)' }],
          exames: [],
          gruposResposta: grupos.map((g) => ({
            id: g['id'],
            nome: `${String(g['descricao'])} (${String(g['codigo'])})`,
          })),
        });
      if (caminho === '/exames')
        return json(r, [
          { id: 900, codigo: 'E2E-SOR', sigla: 'SOR', nome: 'Sorologia sintética', ativo: true },
        ]);
      if (caminho === '/exames/900')
        return json(r, {
          exame: {
            id: 900,
            versao: 1,
            codigo: 'E2E-SOR',
            sigla: 'SOR',
            nome: 'Sorologia sintética',
            tipoServico: 'laboratorio',
            ativo: true,
          },
          setores: [],
          materiais: [],
          preparos: [],
          lateralidades: [],
          ligados: [],
          analitos: [analito],
          procedimentos: [],
        });
      if (caminho === '/grupos-resposta') return json(r, grupos);
      if (caminho === '/textos-padrao') return json(r, textos);
      return json(r, {});
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    (enviados[caminho] ??= []).push(corpo);
    if (caminho === '/grupos-resposta') {
      grupos.push({
        ...corpo,
        id: 50,
        versao: 1,
        emUso: 0,
        respostas: (corpo['respostas'] as Corpo[]).map((x, i) => ({ ...x, id: 500 + i, versao: 1 })),
      });
      return json(r, { id: 50, versao: 1 });
    }
    if (caminho === '/exames/900/analito') {
      Object.assign(analito, { grupoRespostaId: corpo['grupoRespostaId'], versao: 5 });
      return json(r, { id: 31 });
    }
    if (caminho === '/textos-padrao') {
      if (corpo['id']) Object.assign(textos[0] ?? {}, { ativo: corpo['ativo'], versao: 2 });
      else textos.push({ ...corpo, id: 70, versao: 1 });
      return json(r, { id: 70, versao: corpo['id'] ? 2 : 1 });
    }
    return json(r, { id: Number(corpo['id'] ?? 1), versao: Number(corpo['versao'] ?? 0) + 1 });
  });
  return { enviados };
}

/** A digitação simulada de um exame com analito digitado, calculado pela fórmula e qualitativo com respostas. */
function simularDigitacao(page: Page) {
  const referencia = { texto: null, minimo: null, maximo: null, versao: null, fonte: 'nenhuma' };
  const elemento = (codigo: number, nome: string, extra: Corpo = {}) => ({
    codigo,
    nome,
    titulo: false,
    unidade: null,
    casas: 1,
    numerico: true,
    minimoAberto: null,
    maximoAberto: null,
    referencia,
    respostasPadrao: [],
    critico: null,
    valor: null,
    ...extra,
  });
  void page.route('**/api/sadt/resultados/900/digitacao', (r) =>
    json(r, {
      exame: {
        id: 900,
        chave: { data: '2026-11-24', reg: 1, conta: 0, atend: 'E', ato: 15, exame: 'SOR', sequencia: 1 },
        versao: '1',
        paciente: {
          id: 1,
          prontuario: 1,
          nome: 'PACIENTE SINTETICO',
          sexo: 'F',
          idadeAnos: 40,
          nascimento: null,
        },
        atendimento: { cabecalho: 'Externo', reg: 1, tipo: 'E', unidade: null, leito: null },
        setor: 'laboratorio',
        ato: 15,
        atoRotulo: 'Patologia clínica',
        exame: { id: 900, codigo: 'SOR', nome: 'Perfil sintético' },
        estado: 'recebido',
        estadoRotulo: 'Recebido',
        urgente: false,
        origem: 'lancadoNoSetor',
        solicitante: 'SINTETICO',
        pedidoEm: null,
        previsaoColeta: null,
        material: null,
        recipiente: null,
        especialidade: null,
        amostra: null,
        critico: false,
      },
      elementos: [
        elemento(1, 'Creatinina sintética', { referencia: { ...referencia, minimo: 0.5, maximo: 1.2 } }),
        elemento(2, 'Depuração estimada sintética', {
          referencia: { ...referencia, minimo: 90, maximo: null },
          calculo: {
            expressao: '((140 - idade) * peso) / (72 * CR)',
            casas: 1,
            variaveis: [
              {
                codigo: 81,
                identificador: 'idade',
                fonte: 'dado_paciente',
                analito: null,
                dadoPaciente: 'idade',
              },
              {
                codigo: 82,
                identificador: 'peso',
                fonte: 'dado_paciente',
                analito: null,
                dadoPaciente: 'peso',
              },
              { codigo: 83, identificador: 'CR', fonte: 'analito', analito: 1, dadoPaciente: null },
            ],
            valor: null,
            motivo: 'Falta o valor de peso.',
          },
        }),
        elemento(3, 'Sorologia sintética', {
          numerico: false,
          respostasPadrao: [
            { codigo: 500, texto: 'Não reagente' },
            { codigo: 501, texto: 'Reagente' },
          ],
        }),
      ],
      variaveis: [{ codigo: 82, identificacao: 'peso', descricao: 'Peso em kg', valor: null }],
      observacoes: [],
      modelos: [],
      laudo: null,
      alertaDataInvalida: false,
      bloqueado: false,
      grandezas: [],
      textosPadrao: [
        {
          codigo: 70,
          descricao: 'Amostra hemolisada',
          texto: 'Amostra hemolisada (sintético).',
          mnemonico: 'hem',
        },
      ],
      idadePaciente: 40,
    }),
  );
}

test.describe('@F3.5-01 respostas, textos padrão e fórmula do exame', () => {
  test('ficha do exame: grupo de respostas, ligação ao analito e texto padrão; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const api = simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/catalogo');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('button', { name: /Sorologia sintética/ }).click();
    const bloco = page.getByTestId('respostas-textos');
    await expect(bloco).toBeVisible();
    await esperarSemSelectNativo(bloco);

    // Grupo novo: a regra do domínio segura a gravação enquanto a resposta crítica não é anormal.
    await bloco.getByTestId('novo-grupo').click();
    const form = bloco.getByTestId('form-grupo');
    await form.locator('input[name="codigo"]').first().fill('E2E-REAG');
    await form.locator('input[name="descricao"]').first().fill('Reagente e não reagente');
    const r0 = form.getByTestId('resposta-0');
    await r0.locator('input[name="codigo"]').fill('NR');
    await r0.locator('input[name="descricao"]').fill('Não reagente');
    await r0.locator('input[name="padrao"]').check();
    await form.getByTestId('mais-resposta').click();
    const r1 = form.getByTestId('resposta-1');
    await r1.locator('input[name="codigo"]').fill('RG');
    await r1.locator('input[name="descricao"]').fill('Reagente');
    await r1.locator('input[name="critico"]').check();
    await expect(form.getByTestId('falhas-grupo')).toContainText('a resposta crítica é sempre anormal');
    await expect(form.getByTestId('gravar-grupo')).toBeDisabled();
    await r1.locator('input[name="anormal"]').check();
    await expect(form.getByTestId('gravar-grupo')).toBeEnabled();
    await form.getByTestId('gravar-grupo').click();
    await expect(bloco.getByTestId('respostas-aviso')).toContainText('Grupo de respostas gravado.');
    expect(api.enviados['/grupos-resposta']?.[0]).toMatchObject({
      codigo: 'E2E-REAG',
      descricao: 'Reagente e não reagente',
      tipo: 'qualitativo',
      ativo: true,
      respostas: [
        {
          sequencia: 1,
          codigo: 'NR',
          descricao: 'Não reagente',
          padrao: true,
          anormal: false,
          critico: false,
        },
        { sequencia: 2, codigo: 'RG', descricao: 'Reagente', padrao: false, anormal: true, critico: true },
      ],
    });

    // Liga o grupo ao analito do exame: só id, versão e o grupo.
    await escolher(bloco.getByTestId('grupo-analito-31'), { rotulo: 'Reagente e não reagente (E2E-REAG)' });
    await expect(bloco.getByTestId('respostas-aviso')).toContainText('Grupo do analito gravado.');
    expect(api.enviados['/exames/900/analito']?.[0]).toEqual({ id: 31, versao: 4, grupoRespostaId: 50 });

    // Texto padrão do exame: inclui e inativa (a linha continua na lista).
    await bloco.getByTestId('novo-texto').click();
    const ft = bloco.getByTestId('form-texto');
    await expect(ft.getByTestId('gravar-texto')).toBeDisabled();
    await ft.locator('input[name="codigo"]').fill('E2E-HEM');
    await ft.locator('input[name="descricao"]').fill('Amostra hemolisada');
    await ft.locator('input[name="mnemonico"]').fill('hem');
    await ft.locator('textarea[name="texto"]').fill('Amostra hemolisada (sintético).');
    await ft.getByTestId('gravar-texto').click();
    await expect(bloco.getByTestId('lista-textos')).toContainText('Amostra hemolisada · hem');
    expect(api.enviados['/textos-padrao']?.[0]).toMatchObject({
      exameId: 900,
      codigo: 'E2E-HEM',
      descricao: 'Amostra hemolisada',
      texto: 'Amostra hemolisada (sintético).',
      mnemonico: 'hem',
      aplicacao: 'resultado',
      ativo: true,
    });
    await bloco.getByTestId('inativar-texto-70').click();
    await expect
      .poll(() => api.enviados['/textos-padrao']?.[1])
      .toEqual({ id: 70, versao: 1, exameId: 900, ativo: false });
    await expect(bloco.getByTestId('lista-textos')).toContainText('Amostra hemolisada');

    await semViolacaoAxe(page, '/sadt/catalogo');
    expect(externas).toEqual([]);
  });

  test('digitação: o calculado refaz a conta na hora; resposta padrão e texto padrão por seletor', async ({
    page,
  }) => {
    simularDigitacao(page);
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/resultados/digitacao?exame=900');
    const ficha = page.getByTestId('digitacao-ficha');
    await expect(ficha).toBeVisible();
    const calculado = ficha.getByTestId('digitacao-calculado-2');
    // Sem os valores, a tela diz o que falta (nunca zero) e o calculado não tem campo de digitação.
    await expect(calculado).toContainText('Falta o valor de');
    await expect(ficha.getByTestId('digitacao-valor-2')).toHaveCount(0);
    await ficha.getByTestId('digitacao-valor-1').fill('1');
    await expect(calculado).toContainText('Falta o valor de peso.');
    // ((140 - 40) * 72) / (72 * 1) = 100
    await ficha.getByTestId('digitacao-var-82').fill('72');
    await expect(calculado).toHaveText('100');
    // Creatinina 2: a depuração cai para 50 e fica fora da referência (mínimo 90).
    await ficha.getByTestId('digitacao-valor-1').fill('2');
    await expect(calculado).toHaveText('50');
    await expect(ficha.getByTestId('digitacao-marca-2')).toContainText('Fora da referência');

    await escolher(ficha.getByTestId('digitacao-resposta-3'), { rotulo: 'Reagente' });
    await expect(ficha.getByTestId('digitacao-valor-3')).toHaveValue('Reagente');
    await escolher(ficha.getByTestId('digitacao-texto-padrao'), { rotulo: 'Amostra hemolisada · hem' });
    await expect(ficha.locator('#digitacao-obs')).toHaveValue('Amostra hemolisada (sintético).');
    await semViolacaoAxe(page, '/sadt/resultados/digitacao');
  });
});
