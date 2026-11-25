// E2E @F3.5-08 (F3.5, 05-SADT linha 14): a remessa ao laboratório de apoio e o de-para, na tela do laboratório de apoio.
// Quem cuida do apoio vê as amostras coletadas que ainda não saíram, abre a remessa com todas num clique, retira o
// item sem código no apoio (que segura o fechamento), fecha, envia pela integração (a tela diz quantos pedidos foram
// para a fila de envio), gera as etiquetas e baixa o arquivo da impressora térmica; depois inclui de-para de analito e
// de material pela tela, com o código do exame já preenchido e a conferência na hora (código e fator), só com o combo
// do tema (nada de <select> cru). axe sem violação séria.
// Sessão real sobre a fonte sintética; as rotas /api/sadt/apoio precisam do banco do cliente, então respondem aqui por
// um estado SINTÉTICO em memória (o que fica no banco é provado no contrato de efeito apoio-remessa.int.spec.ts e, no
// retorno do resultado, no porta-propria.int.spec.ts da integração). C1-092: o login é o do pessoal do laboratório, não
// o do administrador: o técnico do apoio (SINT.LAB.APOIO), sem opção do menu de origem, recebeu por concessão nominal o
// perfil próprio `laboratorio-apoio`, que concede sadt.apoio.ler, sadt.apoio.remessa e sadt.apoio.configurar; chega à
// tela pelo item do menu.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const LAB = 6;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

interface Item {
  id: number;
  sequencia: number;
  amostra: number;
  codigoBarras: string;
  exameItem: number;
  exameNome: string;
  codigoExameApoio: string | null;
  codigoMaterialApoio: string | null;
  situacao: string;
}

test.describe('@F3.5-08 @C1-092 remessa ao laboratório de apoio e de-para pela tela', () => {
  test.setTimeout(180_000);
  test('abre com as pendentes, retira o item sem código, fecha, envia pela integração, etiqueta da impressora e de-para novo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // ---- estado sintético das rotas do apoio ----
    const pendentes = [
      {
        amostra: 11,
        codigoBarras: 'SINT0000000011',
        exameItem: 101,
        exameNome: 'GLICOSE SINTETICA',
        codigoExameApoio: 'GLI',
        codigoMaterialApoio: 'SOR',
      },
      {
        amostra: 12,
        codigoBarras: 'SINT0000000012',
        exameItem: 102,
        exameNome: 'EXAME SINTETICO SEM CODIGO',
        codigoExameApoio: null,
        codigoMaterialApoio: null,
      },
    ];
    let remessa: {
      id: number;
      numero: string;
      situacao: string;
      meio: string;
      protocolo: string | null;
      itens: Item[];
    } | null = null;
    const acoes: Record<string, unknown>[] = [];
    const dePara = {
      analitos: [] as Record<string, unknown>[],
      materiais: [] as Record<string, unknown>[],
    };
    const gravados: { rota: string; corpo: Record<string, unknown> }[] = [];
    const ativos = () => (remessa?.itens ?? []).filter((i) => i.situacao !== 'cancelado');
    const resumo = () =>
      remessa && {
        id: remessa.id,
        numero: remessa.numero,
        laboratorio: LAB,
        laboratorioNome: 'Laboratório de apoio sintético',
        situacao: remessa.situacao,
        abertaEm: '2026-11-24T08:00:00',
        enviadaEm: remessa.situacao === 'enviada' ? '2026-11-24T08:10:00' : null,
        protocolo: remessa.protocolo,
        quantidadeAmostras: ativos().length,
      };
    await page.route(/\/api\/sadt\/apoio\//, async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace('/api/sadt/apoio/', '');
      const corpo = req.method() === 'POST' ? (req.postDataJSON() as Record<string, unknown>) : {};
      if (caminho === `${LAB}/pendentes`) return json(rota, { itens: remessa ? [] : pendentes });
      if (caminho === 'remessas' && req.method() === 'GET')
        return json(rota, { itens: remessa ? [resumo()] : [] });
      if (caminho === 'remessas') {
        remessa = {
          id: 1,
          numero: 'RA-000001',
          situacao: 'aberta',
          meio: 'manual',
          protocolo: null,
          itens: pendentes.map((p, i) => ({ id: 21 + i, sequencia: i + 1, situacao: 'enviado', ...p })),
        };
        return json(rota, { id: 1, numero: remessa.numero, itens: 2, semDePara: 1 });
      }
      if (caminho === 'remessas/1' && remessa)
        return json(rota, {
          ...resumo(),
          meio: remessa.meio,
          semDePara: ativos().filter((i) => !i.codigoExameApoio).length,
          itens: remessa.itens,
        });
      if (caminho === 'remessas/1/retirar' && remessa) {
        const item = remessa.itens.find((i) => i.id === corpo['item']);
        if (item) item.situacao = 'cancelado';
        return json(rota, { id: Number(corpo['item']), itens: ativos().length });
      }
      if (caminho === 'remessas/1/acao' && remessa) {
        acoes.push(corpo);
        const acao = String(corpo['acao']);
        if (acao === 'fechar') remessa.situacao = 'fechada';
        if (acao === 'enviar') {
          remessa.situacao = 'enviada';
          remessa.meio = String(corpo['meio']);
          remessa.protocolo = (corpo['protocolo'] as string | null) ?? null;
        }
        return json(rota, {
          id: 1,
          situacao: remessa.situacao,
          pedidos: acao === 'enviar' && corpo['meio'] === 'integracao' ? ativos().length : 0,
        });
      }
      if (caminho === 'remessas/1/etiquetas')
        return json(rota, {
          itens: ativos().map((i) => ({
            item: i.id,
            codigo: `H01-RA-000001-00${i.sequencia}`,
            linhas: ['Laboratório de apoio sintético', `Amostra ${i.codigoBarras}`],
            zpl: `^XA\n^FO20,15^BCN,60,Y,N,N^FH_^FDH01-RA-000001-00${i.sequencia}^FS\n^XZ`,
          })),
        });
      if (caminho === `${LAB}/de-para`) return json(rota, dePara);
      if (caminho === `${LAB}/de-para/opcoes`)
        return json(rota, {
          exames: [
            {
              exame: 1,
              nome: 'GLICOSE SINTETICA',
              codigoExameApoio: 'GLI',
              analitos: [{ analito: 5, nome: 'GLICOSE', comDePara: dePara.analitos.length > 0 }],
            },
          ],
          materiais: [{ material: 3, nome: 'SORO SINTETICO', comDePara: dePara.materiais.length > 0 }],
        });
      if (caminho === 'de-para/analito') {
        gravados.push({ rota: caminho, corpo });
        dePara.analitos.push({
          id: 31,
          exame: 1,
          exameNome: 'GLICOSE SINTETICA',
          analito: 5,
          analitoNome: 'GLICOSE',
          codigoExameApoio: String(corpo['codigoExameApoio']),
          codigoAnalitoApoio: String(corpo['codigoAnalitoApoio']),
          nomeApoio: null,
          fatorConversao: Number(corpo['fatorConversao']),
          ativo: true,
        });
        return json(rota, { id: 31 });
      }
      if (caminho === 'de-para/material') {
        gravados.push({ rota: caminho, corpo });
        dePara.materiais.push({
          id: 41,
          material: 3,
          materialNome: 'SORO SINTETICO',
          codigoApoio: String(corpo['codigoApoio']),
          nomeApoio: null,
          ativo: true,
        });
        return json(rota, { id: 41 });
      }
      return json(rota, { title: 'Rota sintética não prevista', status: 404 }, 404);
    });

    await entrar(page, 'SINT.LAB.APOIO');
    await (await itemDoMenu(page, 'Laboratório de apoio')).click();
    await expect(page).toHaveURL(/\/sadt\/laboratorio\/apoio$/);
    await expect(page.getByTestId('tela-laboratorio-apoio')).toBeVisible();
    const tela = page.getByTestId('remessa-apoio');
    await expect(tela).toBeVisible();

    // As pendentes do apoio, com o aviso do exame sem código; a remessa nasce com todas num clique.
    await expect(page.getByTestId('remessa-apoio-pendentes')).toContainText('2 amostra(s)');
    await expect(page.getByTestId('remessa-apoio-pendentes')).toContainText('1 sem código no apoio');
    await page.getByTestId('remessa-apoio-abrir').click();
    const detalhe = page.getByTestId('remessa-apoio-detalhe');
    await expect(detalhe).toContainText('RA-000001');
    await expect(detalhe.getByRole('alert')).toContainText('1 exame(s) sem código no apoio');

    // Retirar o item sem código (fica cancelado, não some) libera o fechamento.
    await page.getByTestId('remessa-apoio-retirar-22').click();
    await expect(detalhe.getByRole('alert')).toHaveCount(0);
    await expect(detalhe).toContainText('cancelado');
    await page.getByTestId('remessa-apoio-fechar').click();
    await expect(detalhe.getByRole('heading', { level: 3 })).toContainText('fechada');

    // Envio pela integração: a tela diz quantos pedidos foram para a fila de envio ao apoio.
    await escolher(page.getByTestId('remessa-apoio-meio'), 'integracao');
    await page.getByTestId('remessa-apoio-enviar').click();
    await expect(page.getByTestId('remessa-apoio-feito')).toContainText('1 pedido(s) na fila de envio');
    await expect(detalhe.getByRole('heading', { level: 3 })).toContainText('enviada');
    expect(acoes.map((a) => [a['acao'], a['meio']])).toEqual([
      ['fechar', 'portal'],
      ['enviar', 'integracao'],
    ]);

    // Etiquetas do apoio: na tela e no arquivo da impressora térmica.
    await page.getByTestId('remessa-apoio-etiquetas-gerar').click();
    await expect(page.getByTestId('remessa-apoio-etiquetas')).toContainText('H01-RA-000001-001');
    const baixar = page.waitForEvent('download');
    await page.getByTestId('remessa-apoio-etiquetas-baixar').click();
    expect((await baixar).suggestedFilename()).toBe('etiquetas-apoio-RA-000001.zpl');

    // De-para de analito pela tela: nada a gravar antes de escolher; o código do exame vem preenchido e o analito
    // único já fica escolhido; a conferência do código e do fator é na hora.
    const novo = page.getByTestId('de-para-novo');
    await expect(page.getByTestId('de-para-analito-incluir')).toBeDisabled();
    await expect(page.getByTestId('de-para-analito-problema')).toHaveCount(0);
    await escolher(page.getByTestId('de-para-exame'), '1');
    await expect(
      page.getByTestId('de-para-codigo-exame').locator('xpath=descendant-or-self::input').first(),
    ).toHaveValue('GLI');
    await esperarValor(page.getByTestId('de-para-analito'), '5');
    await page
      .getByTestId('de-para-codigo-analito')
      .locator('xpath=descendant-or-self::input')
      .first()
      .fill('G U');
    await expect(page.getByTestId('de-para-analito-problema')).toContainText('código do analito');
    await page
      .getByTestId('de-para-codigo-analito')
      .locator('xpath=descendant-or-self::input')
      .first()
      .fill('GLU');
    await expect(page.getByTestId('de-para-analito-problema')).toHaveCount(0);
    await page.getByTestId('de-para-fator').locator('xpath=descendant-or-self::input').first().fill('0');
    await expect(page.getByTestId('de-para-analito-problema')).toContainText('fator');
    await expect(page.getByTestId('de-para-analito-incluir')).toBeDisabled();
    await page.getByTestId('de-para-fator').locator('xpath=descendant-or-self::input').first().fill('0,0555');
    await page.getByTestId('de-para-analito-incluir').click();
    await expect(page.getByTestId('de-para-novo-feito')).toContainText('analito incluído');
    await expect(tela).toContainText('GLI / GLU');
    // Com o único analito já no de-para, a tela não oferece mais nada a incluir.
    await expect(novo).toContainText('Todos os analitos dos exames deste apoio já têm de-para.');

    // De-para de material.
    await expect(page.getByTestId('de-para-material-incluir')).toBeDisabled();
    await escolher(page.getByTestId('de-para-material'), '3');
    await expect(page.getByTestId('de-para-material-problema')).toContainText('código do material');
    await page
      .getByTestId('de-para-codigo-material')
      .locator('xpath=descendant-or-self::input')
      .first()
      .fill('SOR');
    await page.getByTestId('de-para-material-incluir').click();
    await expect(page.getByTestId('de-para-novo-feito')).toContainText('material incluído');
    await expect(novo).toContainText('Todos os materiais ativos já têm de-para.');
    expect(gravados).toEqual([
      {
        rota: 'de-para/analito',
        corpo: {
          laboratorio: LAB,
          exame: 1,
          analito: 5,
          codigoExameApoio: 'GLI',
          codigoAnalitoApoio: 'GLU',
          fatorConversao: 0.0555,
        },
      },
      { rota: 'de-para/material', corpo: { laboratorio: LAB, material: 3, codigoApoio: 'SOR' } },
    ]);

    // Só o combo do tema na tela; axe sem violação séria.
    await expect(page.locator('[data-testid="remessa-apoio"] select')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/laboratorio/apoio');
    expect(externas).toEqual([]);
  });
});
