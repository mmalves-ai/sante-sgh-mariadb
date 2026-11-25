// E2E @F3.5-07 (F3.5, 05-SADT linha 13): interfaces de equipamento do laboratório pelo caminho da tela
// /sadt/laboratorio/interfaces. A equipe do laboratório vê a lista com o que está pendente (interface sem códigos,
// resultado com erro), cadastra a interface com o equipamento no mesmo formulário (a regra confere na hora: de mão única
// não envia lista de trabalho, e o botão só libera com tudo certo), inclui o código do exame e do analito no equipamento
// e reprocessa a mensagem que ficou em erro. As rotas /api/sadt/interfaces-equipamento exigem o banco próprio e o E2E
// roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no
// banco (interface e equipamento gravados juntos, pedido na fila só com a amostra e os códigos, resultado convertido e
// marcado como vindo da interface, mensagem sem duplicar e reprocessada) está em
// apps/api/src/modulos/sadt/aplicacao/interface-equipamento.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

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

const interfaceSintetica = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  versao: 1,
  codigo: `INT-${id}`,
  descricao: `INTERFACE SINTETICA ${id}`,
  modelo: 11,
  modeloNome: 'MODELO SINTETICO ASTM',
  protocolo: 'astm',
  sentido: 'bidirecional',
  host: '10.0.0.9',
  porta: 5000,
  caminhoEnvio: null,
  caminhoRetorno: null,
  enviaListaTrabalho: true,
  recebeResultado: true,
  importaComoLiberado: false,
  revisaAutomaticamente: false,
  assinaAutomaticamente: false,
  bloqueiaLaudo: false,
  ativo: true,
  temCredencial: false,
  equipamento: {
    id: 300 + id,
    codigo: `EQ-${id}`,
    descricao: `ANALISADOR SINTETICO ${id}`,
    modelo: null,
    numeroSerie: null,
    setor: 601,
    setorNome: 'LABORATORIO SINTETICO',
  },
  examesComCodigo: 0,
  analitosComCodigo: 0,
  pedidosNaFila: 0,
  resultadosComErro: 0,
  ultimoResultadoEm: null,
  ...extra,
});

test.describe('Interfaces de equipamento do laboratório @F3.5-07 @fase3', () => {
  test.setTimeout(180_000);
  test('lista com pendências, cadastro conferido na hora, códigos no equipamento e reprocessamento; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let interfaces: unknown[] = [interfaceSintetica(1, { resultadosComErro: 1 })];
    let exames: unknown[] = [];
    let analitos: unknown[] = [];
    let mensagens: unknown[] = [
      {
        id: 71,
        direcao: 'entrada',
        situacao: 'erro',
        referencia: 'MSG-SINTETICA-1',
        tentativas: 1,
        erro: 'codigo-sem-de-para:GLU',
        criadaEm: '2026-03-15T10:00:00.000Z',
        processadaEm: '2026-03-15T10:00:01.000Z',
      },
    ];
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) =>
      json(rota, {
        exames: [{ id: 501, nome: 'GLICOSE SINTETICA' }],
        setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
        analitos: [{ id: 701, nome: 'ANALITO SINTETICO' }],
      }),
    );
    await page.route('**/api/sadt/interfaces-equipamento**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/interfaces-equipamento\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, interfaces);
        if (caminho === 'apoio')
          return json(rota, {
            modelos: [
              { id: 11, nome: 'MODELO SINTETICO ASTM', padrao: 'astm', sentido: 'bidirecional' },
              { id: 12, nome: 'MODELO SINTETICO HL7', padrao: 'hl7_v2', sentido: 'bidirecional' },
            ],
            setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
            protocolos: ['astm', 'hl7', 'arquivo', 'serial', 'servico_web', 'outro'],
          });
        if (/^\d+\/de-para$/.test(caminho)) return json(rota, { exames, analitos });
        if (/^\d+\/mensagens$/.test(caminho)) return json(rota, mensagens);
        return json(rota, { codigo: 'nao-simulado' }, 500);
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === '') {
        interfaces = [
          ...interfaces,
          interfaceSintetica(2, { codigo: 'BIOQ-02', descricao: 'BIOQUIMICA SINTETICA 2' }),
        ];
        return json(rota, { id: 2 });
      }
      if (caminho === '1/de-para/exames') {
        exames = [
          {
            id: 81,
            versao: 1,
            exame: 501,
            exameNome: 'GLICOSE SINTETICA',
            material: null,
            codigo: 'GLI',
            enviaAnalitos: false,
            ativo: true,
            editavel: true,
          },
        ];
        return json(rota, { id: 81 });
      }
      if (caminho === '1/de-para/analitos') {
        analitos = [
          {
            id: 91,
            versao: 1,
            analito: 701,
            analitoNome: 'ANALITO SINTETICO',
            exame: null,
            codigo: 'GLU',
            fator: 10,
            casas: 1,
            recebe: true,
            ativo: true,
          },
        ];
        return json(rota, { id: 91 });
      }
      if (caminho === '1/mensagens/71/reprocessar') {
        mensagens = [{ ...(mensagens[0] as object), situacao: 'processada', erro: null, tentativas: 2 }];
        interfaces = [
          interfaceSintetica(1, { examesComCodigo: 1, analitosComCodigo: 1 }),
          ...interfaces.slice(1),
        ];
        return json(rota, { mensagem: 71, situacao: 'processada', pendencias: [] });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/laboratorio/interfaces');
    await expect(page.getByTestId('tela-interfaces')).toBeVisible();
    // A lista mostra as pendências da interface: sem códigos e com resultado em erro.
    await expect(page.getByTestId('interface-sem-codigos-1')).toBeVisible();
    await expect(page.getByTestId('interface-erros-1')).toHaveText('1');
    await semViolacaoAxe(page, '/sadt/laboratorio/interfaces');

    // Cadastro: a regra confere na hora e o botão só libera com tudo certo.
    await page.getByTestId('interface-nova').click();
    const gravar = page.getByTestId('interface-gravar');
    await expect(gravar).toBeDisabled();
    await page.getByTestId('interface-codigo').fill('BIOQ-02');
    await page.getByTestId('interface-descricao').fill('BIOQUIMICA SINTETICA 2');
    await escolher(page.getByTestId('interface-modelo'), { rotulo: 'MODELO SINTETICO ASTM' });
    await page.getByTestId('interface-host').fill('10.0.0.10');
    await page.getByTestId('interface-porta').fill('5001');
    await page.getByTestId('equipamento-codigo').fill('EQ-02');
    await page.getByTestId('equipamento-descricao').fill('ANALISADOR SINTETICO 2');
    await expect(gravar).toBeDisabled();
    await escolher(page.getByTestId('equipamento-setor'), { rotulo: 'LABORATORIO SINTETICO' });
    await expect(gravar).toBeEnabled();
    // De mão única não envia lista de trabalho: o aviso aparece no campo e o botão volta a travar.
    await escolher(page.getByTestId('interface-sentido'), 'unidirecional');
    await expect(
      page.locator('[data-testid="interface-problemas"] [data-campo="enviaListaTrabalho"]'),
    ).toBeVisible();
    await expect(gravar).toBeDisabled();
    await page.getByTestId('interface-envia').uncheck();
    await expect(gravar).toBeEnabled();
    expect(pedidos).toHaveLength(0);
    await gravar.click();
    await expect(page.getByTestId('interfaces-mensagem')).toBeVisible();
    expect(pedidos[0]).toMatchObject({
      caminho: '',
      corpo: {
        id: null,
        codigo: 'BIOQ-02',
        modelo: 11,
        protocolo: 'astm',
        sentido: 'unidirecional',
        porta: 5001,
        enviaListaTrabalho: false,
        equipamento: { codigo: 'EQ-02', setor: 601 },
      },
    });
    await expect(page.getByTestId('interface-2')).toContainText('BIOQUIMICA SINTETICA 2');

    // Códigos no equipamento: o exame e o analito com o fator de conversão.
    await page.getByTestId('interface-abrir-1').click();
    await expect(page.getByTestId('interface-de-para')).toBeVisible();
    const incluirExame = page.getByTestId('depara-exame-incluir');
    await expect(incluirExame).toBeDisabled();
    await escolher(page.getByTestId('depara-exame'), { rotulo: 'GLICOSE SINTETICA' });
    await page.getByTestId('depara-exame-codigo').fill('GLI');
    await incluirExame.click();
    await expect(page.getByTestId('depara-exames')).toContainText('GLICOSE SINTETICA · GLI');
    await escolher(page.getByTestId('depara-analito'), { rotulo: 'ANALITO SINTETICO' });
    await page.getByTestId('depara-analito-codigo').fill('GLU');
    await page.getByTestId('depara-analito-fator').fill('0');
    await expect(page.getByTestId('depara-analito-incluir')).toBeDisabled();
    await page.getByTestId('depara-analito-fator').fill('10');
    await page.getByTestId('depara-analito-incluir').click();
    await expect(page.getByTestId('depara-analitos')).toContainText('ANALITO SINTETICO');
    expect(pedidos[1]).toMatchObject({ caminho: '1/de-para/exames', corpo: { exame: 501, codigo: 'GLI' } });
    expect(pedidos[2]).toMatchObject({
      caminho: '1/de-para/analitos',
      corpo: { analito: 701, codigo: 'GLU', fator: 10, casas: null },
    });

    // A mensagem em erro mostra a pendência por código e é reprocessada depois do de-para.
    await expect(page.getByTestId('mensagem-71')).toContainText('codigo-sem-de-para:GLU');
    await page.getByTestId('mensagem-reprocessar-71').click();
    await expect(page.getByTestId('mensagem-reprocessar-71')).toHaveCount(0);
    await expect(page.getByTestId('interface-erros-1')).toHaveCount(0);
    expect(pedidos[3]).toMatchObject({ caminho: '1/mensagens/71/reprocessar' });
  });
});
