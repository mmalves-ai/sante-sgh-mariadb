// E2E @F3.5-09 (F3.5, 05-SADT linha 16): o laudo de imagem e de métodos gráficos pela tela nova. A lista de trabalho de
// quem lauda abre o exame num clique; o cabeçalho traz o nome e o prontuário do paciente e o laudo anterior do mesmo
// exame; o modelo é aplicado, as palavras-chave e o achado crítico vão no corpo, "salvar e assinar" libera o exame e
// abre o aviso crítico; a retificação com motivo diz que a via emitida foi superada; o texto inteiro da versão anterior
// abre ao lado; e a manutenção dos modelos mostra os campos variáveis na hora e grava. A redação do laudo só existe no
// banco do cliente: as rotas /api/sadt/laudos/* são simuladas aqui (massa SINTÉTICA) para conferir a tela e o corpo
// enviado; o efeito no banco (versão, hash, palavras, exame liberado, avisos, emissão superada, recusa do outro
// laudista) é provado no contrato de efeito laudo-redacao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ITEM = 9001;
const TEXTO_V1 = 'Exame sem alterações (sintético). Fração de ejeção preservada.';
const TEXTO_V2 = 'Exame sem alterações (sintético). Texto retificado.';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown) =>
  rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

/** Simula as rotas da redação do laudo com um estado sintético que anda com a assinatura e a retificação. */
async function simularLaudos(page: Page) {
  const estado = { situacao: null as string | null, versao: 0, texto: '', palavras: [] as number[] };
  const corpos: {
    assinar?: Record<string, unknown>;
    retificar?: Record<string, unknown>;
    modelo?: Record<string, unknown>;
  } = {};
  const modelos = [
    {
      id: 7,
      codigo: 'ECO-N',
      nome: 'Ecocardiograma normal (sintético)',
      tipo: 'normal',
      atalho: null,
      texto: TEXTO_V1,
      ativo: true,
      exame: 55,
      exameNome: 'ECOCARDIOGRAMA (SINTÉTICO)',
      setor: null,
      setorNome: null,
      pessoal: true,
    },
  ];
  const aberto = () => ({
    exame: {
      item: ITEM,
      exame: 55,
      nome: 'ECOCARDIOGRAMA (SINTÉTICO)',
      setor: 3,
      tipoSetor: 'metodos_graficos',
    },
    paciente: {
      id: 1001,
      sexo: 'feminino',
      idadeDias: 14_000,
      dataExame: '2026-11-20',
      nome: 'PACIENTE SINTÉTICA UM',
      prontuario: '123',
    },
    palavrasChave: estado.palavras,
    palavras: [
      { id: 1, codigo: 'ENSINO', descricao: 'Caso de ensino' },
      { id: 2, codigo: 'RARO', descricao: 'Achado raro' },
    ],
    anteriores: [
      {
        item: 8001,
        assinadoEm: '2025-10-01T12:00:00.000Z',
        resultado: 'normal',
        achadoCritico: false,
        texto: 'Laudo anterior sintético.',
      },
    ],
    laudo:
      estado.situacao === null
        ? null
        : {
            id: 50,
            situacao: estado.situacao,
            titulo: null,
            texto: estado.texto,
            resultado: null,
            achadoCritico: true,
            achadoCriticoDescricao: 'Achado sintético',
            modelo: 7,
            versaoAtual: estado.versao,
            pesoKg: null,
            alturaCm: null,
            superficieCorporal: null,
          },
    versoes: Array.from({ length: estado.versao }, (_, i) => ({
      numero: estado.versao - i,
      situacao: estado.versao - i === 1 ? 'assinado' : 'retificado',
      em: '2026-11-24T12:00:00.000Z',
      motivo: estado.versao - i === 1 ? null : 'Correção de digitação',
      hash: 'a'.repeat(64),
    })),
    secoes: [],
    grandezas: [],
    faixas: [],
    valores: [],
    modelos: modelos.map(({ id, nome, tipo, atalho, texto }) => ({
      id,
      nome,
      tipo,
      atalho,
      texto,
      campos: [],
    })),
    pode: {
      salvar: estado.situacao === null,
      assinar: estado.situacao === null,
      retificar: estado.situacao !== null,
    },
  });
  await page.route(/\/api\/sadt\/laudos\/fila(\?.*)?$/, (r) =>
    json(r, {
      itens:
        estado.situacao === null
          ? [
              {
                item: ITEM,
                exame: 'ECOCARDIOGRAMA (SINTÉTICO)',
                setor: 3,
                setorNome: 'Métodos gráficos',
                paciente: 'PACIENTE SINTÉTICA UM',
                prontuario: '123',
                realizadoEm: '2026-11-20T13:00:00.000Z',
                laudo: null,
              },
            ]
          : [],
      setores: [{ id: 3, nome: 'Métodos gráficos' }],
    }),
  );
  await page.route(/\/api\/sadt\/laudos\/palavras-chave$/, (r) =>
    json(r, { itens: [{ id: 1, codigo: 'ENSINO', descricao: 'Caso de ensino' }] }),
  );
  await page.route(/\/api\/sadt\/laudos\/motivos-retificacao$/, (r) =>
    json(r, { itens: [{ id: 3, codigo: 'DIG', descricao: 'Correção de digitação' }] }),
  );
  await page.route(new RegExp(`/api/sadt/laudos/redacao/${ITEM}$`), (r) => json(r, aberto()));
  await page.route(new RegExp(`/api/sadt/laudos/redacao/${ITEM}/previa$`), (r) =>
    json(r, { texto: TEXTO_V1, faltam: [] }),
  );
  await page.route(new RegExp(`/api/sadt/laudos/redacao/${ITEM}/assinar$`), async (r) => {
    corpos.assinar = r.request().postDataJSON() as Record<string, unknown>;
    Object.assign(estado, {
      situacao: 'assinado',
      versao: 1,
      texto: String(corpos.assinar['texto']),
      palavras: corpos.assinar['palavrasChave'] as number[],
    });
    await json(r, {
      id: 50,
      situacao: 'assinado',
      versaoAtual: 1,
      valores: 0,
      foraReferencia: 0,
      exameLiberado: true,
      avisoCritico: 'abrir',
      avisados: 1,
    });
  });
  await page.route(new RegExp(`/api/sadt/laudos/redacao/${ITEM}/retificar$`), async (r) => {
    corpos.retificar = r.request().postDataJSON() as Record<string, unknown>;
    Object.assign(estado, { situacao: 'retificado', versao: 2, texto: String(corpos.retificar['texto']) });
    await json(r, {
      id: 50,
      situacao: 'retificado',
      versaoAtual: 2,
      valores: 0,
      foraReferencia: 0,
      avisoCritico: 'nada',
      avisados: 1,
      emissoesSuperadas: 1,
    });
  });
  await page.route(new RegExp(`/api/sadt/laudos/redacao/${ITEM}/versoes/1$`), (r) =>
    json(r, {
      numero: 1,
      situacao: 'assinado',
      em: '2026-11-24T12:00:00.000Z',
      titulo: null,
      texto: TEXTO_V1,
      motivo: null,
      laudista: 'MÉDICA SINTÉTICA',
      resultado: null,
      achadoCritico: true,
    }),
  );
  await page.route(/\/api\/sadt\/laudos\/modelos$/, async (r) => {
    if (r.request().method() === 'POST') {
      corpos.modelo = r.request().postDataJSON() as Record<string, unknown>;
      modelos.push({
        ...modelos[0]!,
        id: 8,
        codigo: String(corpos.modelo['codigo']),
        nome: String(corpos.modelo['nome']),
        texto: String(corpos.modelo['texto']),
        pessoal: false,
        exame: null as unknown as number,
        exameNome: null as unknown as string,
      });
      return json(r, { id: 8, campos: ['fe'] });
    }
    return json(r, {
      itens: modelos,
      exames: [{ id: 55, nome: 'ECOCARDIOGRAMA (SINTÉTICO)' }],
      setores: [{ id: 3, nome: 'Métodos gráficos' }],
      temProfissional: true,
    });
  });
  return corpos;
}

test.describe('@F3.5-09 laudo de imagem: lista de trabalho, redação, retificação e modelos', () => {
  test.setTimeout(180_000);

  test('laudar pela lista, assinar com palavra-chave e achado crítico, retificar, ver a versão e manter modelos; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos = await simularLaudos(page);
    await entrar(page, 'SINT.LAUDADOR');

    // A lista de trabalho: o exame realizado com o paciente, um clique para laudar.
    await page.goto('/sadt/laudos');
    await expect(page.getByTestId('fila-laudos')).toBeVisible();
    await expect(page.getByTestId(`fila-linha-${ITEM}`)).toContainText('PACIENTE SINTÉTICA UM');
    await expect(page.getByTestId(`fila-linha-${ITEM}`)).toContainText('A escrever');
    await semViolacaoAxe(page, '/sadt/laudos');
    await page.getByTestId(`fila-abrir-${ITEM}`).click();

    // O cabeçalho com o nome e o prontuário; o laudo anterior do mesmo exame ao lado.
    await expect(page.getByTestId('laudo-cabecalho')).toContainText('PACIENTE SINTÉTICA UM');
    await expect(page.getByTestId('laudo-cabecalho')).toContainText('prontuário 123');
    await expect(page.getByTestId('laudo-anterior-8001')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`item=${ITEM}`));

    // Modelo aplicado, palavra-chave e achado crítico; salvar e assinar num clique.
    await escolher(page.getByTestId('laudo-modelo'), { indice: 1 });
    await page.getByTestId('laudo-aplicar').click();
    await expect(page.getByTestId('laudo-texto')).toHaveValue(TEXTO_V1);
    await page.getByTestId('laudo-palavra-1').check();
    await page.getByTestId('laudo-critico').check();
    await page.getByLabel('Descrição do achado crítico').fill('Achado sintético');
    await page.getByTestId('laudo-assinar').click();
    await expect(page.getByTestId('laudo-mensagem')).toContainText('Exame liberado para a emissão.');
    await expect(page.getByTestId('laudo-mensagem')).toContainText(
      'Aviso crítico aberto; 1 pessoa(s) avisada(s).',
    );
    expect(corpos.assinar).toMatchObject({
      modelo: 7,
      texto: TEXTO_V1,
      palavrasChave: [1],
      achadoCritico: true,
      achadoCriticoDescricao: 'Achado sintético',
    });

    // Depois de assinado, só a retificação com motivo; a via emitida antes fica superada.
    await expect(page.getByTestId('laudo-assinar')).toHaveCount(0);
    await expect(page.getByTestId('laudo-retificar')).toBeDisabled();
    await page.getByTestId('laudo-texto').fill(TEXTO_V2);
    await escolher(page.getByTestId('laudo-motivo'), { indice: 1 });
    await page.getByTestId('laudo-retificar').click();
    await expect(page.getByTestId('laudo-mensagem')).toContainText('emita a nova via');
    expect(corpos.retificar).toMatchObject({ texto: TEXTO_V2, motivo: 3, palavrasChave: [1] });

    // O texto inteiro da versão anterior a um clique.
    await page.getByTestId('laudo-versao-ver-1').click();
    await expect(page.getByTestId('laudo-versao-texto')).toContainText(TEXTO_V1);
    await expect(page.getByTestId('laudo-versao-texto')).toContainText('MÉDICA SINTÉTICA');
    await semViolacaoAxe(page, '/sadt/laudos');

    // Manutenção dos modelos: o que falta aparece na hora, os campos variáveis saem do texto, e o modelo grava.
    await page.getByTestId('laudo-ir-modelos').click();
    await expect(page.getByTestId('modelos-lista')).toContainText('Ecocardiograma normal (sintético)');
    await page.getByTestId('modelo-novo').click();
    await expect(page.getByTestId('modelo-falta')).toContainText('Informe o código.');
    await expect(page.getByTestId('modelo-salvar')).toBeDisabled();
    await page.getByTestId('modelo-codigo').fill('ECO-FE');
    await page.getByTestId('modelo-nome').fill('Ecocardiograma com fração de ejeção');
    await page.getByTestId('modelo-texto').fill('Fração de ejeção de {{fe}}%.');
    await expect(page.getByTestId('modelo-campos')).toContainText('fe');
    await page.getByTestId('modelo-salvar').click();
    await expect(page.getByTestId('modelo-mensagem')).toContainText('Modelo gravado.');
    expect(corpos.modelo).toMatchObject({
      id: null,
      codigo: 'ECO-FE',
      pessoal: false,
      tipo: 'texto',
      texto: 'Fração de ejeção de {{fe}}%.',
      ativo: true,
    });
    await expect(page.getByTestId('modelo-linha-8')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/laudos/modelos');
    expect(externas).toEqual([]);
  });
});
