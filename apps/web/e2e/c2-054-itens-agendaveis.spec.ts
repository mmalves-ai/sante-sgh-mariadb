// E2E @C2-054 (F8, 02-AGE linha 45): itens agendáveis pelo caminho da tela (`/agenda/consultas/itens-agendaveis`).
// O gestor cadastra o exame com preparo, pré-requisito com validade, conflito com outro item, recurso exigido e a
// orientação do convênio, vendo a validação do domínio na hora (dias de preparo sem orientação travam o gravar). Na
// marcação (?marcacao=), confere os itens antes de lançar: o pré-requisito que falta impede o lançamento; cumprido, o
// preparo aparece e o lançamento grava os itens com o preparo para imprimir. Os itens só existem no banco do cliente
// (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato
// do servidor. O efeito no banco está em apps/api/src/modulos/agenda/itens-agendaveis.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

const OPCOES = {
  itens: [
    { id: 9601, nome: 'C2054-A — CONSULTA PRE SINTETICA', tipo: 'consulta' },
    { id: 9602, nome: 'C2054-B — COLONOSCOPIA SINTETICA', tipo: 'exame' },
    { id: 9603, nome: 'C2054-C — TOMOGRAFIA SINTETICA', tipo: 'exame' },
  ],
  recursos: [{ id: 9611, nome: 'SALA DE ENDOSCOPIA SINTETICA' }],
  fontes: [{ id: 9621, nome: 'CONVENIO SINTETICO C2054' }],
};
const resumo = (id: number, codigo: string, descricao: string, tipoItem: string) => ({
  id,
  codigo,
  descricao,
  tipoItem,
  duracaoMinutos: 30,
  ativo: true,
  versao: 1,
  regras: { composicao: 0, conflitos: 0, requisitos: 0, recursos: 0, orientacoes: 0 },
});
const PREPARO =
  'Começar o preparo 2 dia(s) antes: a partir de 10/03/2030.\nDieta líquida sem resíduos.\nOrientação do convênio: Levar a guia autorizada.';

function simular(page: Page) {
  const st = {
    lista: [
      resumo(9601, 'C2054-A', 'CONSULTA PRE SINTETICA', 'consulta'),
      resumo(9603, 'C2054-C', 'TOMOGRAFIA SINTETICA', 'exame'),
    ],
    gravado: null as Record<string, unknown> | null,
    criticas: 0,
    lancado: null as Record<string, unknown> | null,
  };
  void page.route('**/api/agenda/itens-agendaveis**', (r) => {
    const url = new URL(r.request().url());
    const caminho = url.pathname.replace(/^.*\/itens-agendaveis/, '');
    const metodo = r.request().method();
    if (caminho === '/opcoes') return json(r, OPCOES);
    if (/^\/marcacao\/\d+\/critica$/.test(caminho)) {
      st.criticas += 1;
      // Primeira conferência: a consulta prévia não foi feita; na segunda, já foi (outra marcação realizada).
      return json(r, {
        itens: [
          { id: 9602, descricao: 'COLONOSCOPIA SINTETICA', preparo: PREPARO, inicioPreparo: '2030-03-10' },
        ],
        bloqueios:
          st.criticas === 1
            ? [
                {
                  codigo: 'requisito-nao-realizado',
                  item: 9602,
                  mensagem:
                    'COLONOSCOPIA SINTETICA: exige CONSULTA PRE SINTETICA realizado antes (nos últimos 30 dias).',
                },
              ]
            : [],
        alertas: [],
      });
    }
    if (/^\/marcacao\/\d+\/itens$/.test(caminho) && metodo === 'POST') {
      st.lancado = r.request().postDataJSON() as Record<string, unknown>;
      return json(r, {
        ok: true,
        resultado: { marcacao: 7001, itens: 1, equipamentos: 1, alertas: '' },
        repetida: false,
        mensagem: 'Itens lançados na marcação, com o preparo do paciente.',
      });
    }
    if (/^\/marcacao\/\d+$/.test(caminho))
      return json(r, {
        marcacao: 7001,
        itens: st.lancado
          ? [
              {
                sequencia: 1,
                item: 9602,
                descricao: 'COLONOSCOPIA SINTETICA',
                situacao: 'marcado',
                preparo: PREPARO,
              },
            ]
          : [],
        equipamentos: st.lancado
          ? [{ equipamento: 9631, nome: 'VIDEOENDOSCOPIO SINTETICO', quantidade: 1 }]
          : [],
      });
    if (caminho === '' && metodo === 'GET') return json(r, st.lista);
    if (caminho === '' && metodo === 'POST') {
      st.gravado = r.request().postDataJSON() as Record<string, unknown>;
      st.lista.push(resumo(9602, 'C2054-B', 'COLONOSCOPIA SINTETICA', 'exame'));
      return json(r, {
        ok: true,
        resultado: { item: 9602, regras: 4 },
        repetida: false,
        mensagem: 'Item agendável criado.',
      });
    }
    if (caminho === '/9602' && metodo === 'GET')
      return json(r, {
        id: 9602,
        versao: 1,
        ...(st.gravado as object),
        codigo: 'C2054-B',
        nomes: {},
      });
    return json(r, { type: 'about:blank', title: 'Não simulado', status: 404 }, 404);
  });
  return st;
}

test.describe('agenda: itens agendáveis @C2-054 @fase8', () => {
  test.setTimeout(180_000);

  test('cadastra o exame com preparo e regras, valida na hora; na marcação, o pré-requisito impede e o preparo sai no lançamento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.AGENDA');
    await page.goto('/agenda/consultas/itens-agendaveis');
    await expect(page.getByTestId('itens-lista')).toContainText('CONSULTA PRE SINTETICA');
    await semViolacaoAxe(page, 'itens agendáveis: lista');

    await page.getByTestId('itens-novo').click();
    const ed = page.getByTestId('item-edicao');
    await ed.getByLabel('Código').fill('C2054-B');
    await ed.getByLabel('Descrição').fill('COLONOSCOPIA SINTETICA');
    // Validação na hora (regra do domínio): dias de preparo sem a orientação ao paciente não gravam.
    await ed.getByLabel('Dias de preparo').fill('2');
    await expect(page.getByTestId('item-recusa')).toContainText('orientação');
    await expect(page.getByTestId('item-gravar')).toBeDisabled();
    await ed.getByLabel('Orientação de preparo ao paciente').fill('Dieta líquida sem resíduos.');
    await expect(page.getByTestId('item-recusa')).toHaveCount(0);

    // Pré-requisito: a consulta prévia realizada nos últimos 30 dias.
    await escolher(ed.getByLabel('Item').nth(0), '9601');
    await ed.getByLabel('Validade (dias)').fill('30');
    await page.getByTestId('item-incluir-requisito').click();
    await expect(page.getByTestId('item-requisitos')).toContainText('CONSULTA PRE SINTETICA');
    // Conflito com a tomografia em 48 h; o item já usado como pré-requisito não pode ser conflito (domínio).
    await escolher(ed.getByLabel('Item').nth(1), '9603');
    await ed.getByLabel('Intervalo mínimo (h)').fill('48');
    await page.getByTestId('item-incluir-conflito').click();
    await escolher(ed.getByLabel('Recurso'), '9611');
    await page.getByTestId('item-incluir-recurso').click();
    await escolher(ed.getByLabel('Convênio'), '9621');
    await ed.getByLabel('Orientação', { exact: true }).fill('Levar a guia autorizada.');
    await page.getByTestId('item-incluir-orientacao').click();
    await semViolacaoAxe(page, 'itens agendáveis: edição');
    await page.getByTestId('item-gravar').click();
    await expect(page.getByTestId('itens-mensagem')).toContainText('Item agendável criado.');
    expect(st.gravado).toMatchObject({
      codigo: 'C2054-B',
      diasPreparo: 2,
      orientacaoPreparo: 'Dieta líquida sem resíduos.',
      requisitos: [{ tipo: 'item_realizado', item: 9601, prazoMaximoDias: 30, bloqueia: true }],
      conflitos: [{ item: 9603, intervaloMinimoHoras: 48, direcao: 'ambos' }],
      recursos: [{ recurso: 9611, papel: 'exigido', quantidade: 1 }],
      orientacoes: [{ fontePagadora: 9621, orientacao: 'Levar a guia autorizada.' }],
    });

    // Na marcação: a crítica antes de lançar.
    await page.goto('/agenda/consultas/itens-agendaveis?marcacao=7001');
    const m = page.getByTestId('itens-marcacao');
    await escolher(m.getByLabel('Item a marcar'), '9602');
    await page.getByTestId('itens-escolher-incluir').click();
    await page.getByTestId('itens-conferir').click();
    await expect(page.getByTestId('itens-bloqueios')).toContainText('exige CONSULTA PRE SINTETICA');
    await expect(page.getByTestId('itens-lancar')).toBeDisabled();
    await page.getByTestId('itens-conferir').click();
    await expect(page.getByTestId('itens-bloqueios')).toHaveCount(0);
    await expect(page.getByTestId('itens-preparo')).toContainText('Levar a guia autorizada.');
    await page.getByTestId('itens-lancar').click();
    await expect(page.getByTestId('itens-mensagem')).toContainText('Itens lançados');
    expect(st.lancado).toEqual({ itens: [9602] });
    await expect(page.getByTestId('itens-lancados')).toContainText('Dieta líquida sem resíduos.');
    await expect(m).toContainText('VIDEOENDOSCOPIO SINTETICO');
    await semViolacaoAxe(page, 'itens agendáveis: marcação');
    expect(externas).toEqual([]);
  });
});
