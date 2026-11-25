// F3.1 (02-CAD linha 28): calendário de feriados e dias não úteis, pelo caminho da tela.
// O cadastro exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: o item do menu leva à rota,
// a inclusão de um dia do estabelecimento com meio expediente (validação na hora antes de gravar), a geração das datas
// móveis de vários anos num clique e a inativação que pede o motivo e deixa o registro na lista, inativo. O efeito no
// banco (trilha, duplicidade no alvo, faixas, versão, inativação com motivo, móveis, sessão do outro estabelecimento)
// está no contrato de efeito (apps/api/src/modulos/cadastro/calendario-proprio.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const EST = 11;

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

type Item = Record<string, unknown> & { id: number; versao: number; ativo: boolean };

test.describe('F3.1 calendário de feriados e dias não úteis @F3.1 @C1-087', () => {
  test('inclui meio expediente do estabelecimento, gera móveis e inativa com motivo', async ({ page }) => {
    const pedidos: { metodo: string; caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens: Item[] = [];
    let ano = 0;
    await page.route('**/api/cadastros/calendario**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        ano = Number(url.searchParams.get('ano'));
        return json(r, {
          ano,
          local: {
            estabelecimento: EST,
            estabelecimentoNome: 'HOSPITAL SINTETICO',
            ufId: 31,
            ufSigla: 'MG',
            municipio: 3106200,
            municipioNome: 'MUNICIPIO SINTETICO',
          },
          itens,
          semExpediente: itens
            .filter((x) => x.ativo)
            .map((x) => ({
              data: (x['datasNoAno'] as string[])[0],
              nome: x['descricao'],
              horaInicio: x['horaInicio'],
              horaFim: x['horaFim'],
            })),
          ufs: [{ id: 31, sigla: 'MG' }],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ metodo: req.method(), caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/moveis')) return json(r, { incluidos: [801, 802], pulados: 1 });
      const situacao = /\/(\d+)\/situacao$/.exec(url.pathname);
      if (situacao) {
        const x = itens.find((i) => i.id === Number(situacao[1]))!;
        x.ativo = corpo['ativo'] === true;
        x.versao += 1;
        return json(r, { id: x.id });
      }
      const dia = String(corpo['dia']).padStart(2, '0');
      const mes = String(corpo['mes']).padStart(2, '0');
      itens.push({
        ...corpo,
        id: 701,
        versao: 1,
        ativo: true,
        ufSigla: null,
        municipioNome: null,
        estabelecimentoNome: 'HOSPITAL SINTETICO',
        valeAqui: true,
        datasNoAno: [`${ano}-${mes}-${dia}`],
      } as Item);
      return json(r, { id: 701 });
    });

    await entrar(page, 'SINT.ADMIN');
    // O item do menu Cadastros > Estrutura leva à tela.
    await (await itemDoMenu(page, 'Calendário de feriados e dias não úteis')).click();
    await expect(page).toHaveURL(/\/cadastros\/estrutura\/calendario$/);
    await expect(page.getByTestId('tela-calendario')).toBeVisible();
    await expect(page.getByTestId('cal-resumo')).toContainText('HOSPITAL SINTETICO');

    await page.getByTestId('cal-descricao').fill('Aniversario sintetico');
    await escolher(page.getByTestId('cal-abrangencia'), 'estabelecimento');
    await page.getByTestId('cal-dia').fill('20');
    await escolher(page.getByTestId('cal-mes'), { rotulo: 'Nov' });
    await page.getByTestId('cal-meio').check();
    await page.getByTestId('cal-hora-inicio').fill('14:00');
    await page.getByTestId('cal-hora-fim').fill('12:00');
    // Validação na hora: o fim antes do início trava o botão, sem ir ao servidor.
    await expect(page.getByTestId('cal-problemas')).toContainText('O fim do período é depois do início.');
    await expect(page.getByTestId('cal-gravar')).toBeDisabled();
    await page.getByTestId('cal-hora-inicio').fill('12:00');
    await page.getByTestId('cal-hora-fim').fill('18:00');
    await expect(page.getByTestId('cal-gravar')).toBeEnabled();
    await page.getByTestId('cal-gravar').click();
    await expect(page.getByTestId('cal-aviso')).toHaveText('Gravado.');
    await expect(page.getByTestId('cal-item-701')).toContainText('Aniversario sintetico');
    await expect(page.getByTestId('cal-item-701')).toContainText('12:00–18:00');
    await expect(page.getByTestId('cal-resumo')).toContainText('1');
    expect(pedidos[0]).toMatchObject({
      metodo: 'POST',
      caminho: '/api/cadastros/calendario',
      corpo: {
        descricao: 'Aniversario sintetico',
        abrangencia: 'estabelecimento',
        estabelecimento: EST,
        municipio: null,
        ufId: null,
        recorrencia: 'anual',
        dia: 20,
        mes: 11,
        data: null,
        horaInicio: '12:00',
        horaFim: '18:00',
      },
    });

    // Datas móveis de vários anos num clique (abrangência do formulário, que voltou ao município do local).
    await escolher(page.getByTestId('cal-base'), 'carnaval');
    await page.getByTestId('cal-gerar-moveis').click();
    await expect(page.getByTestId('cal-aviso')).toContainText('2 ano(s) incluído(s), 1 já estava(m)');
    expect(pedidos[1]).toMatchObject({
      metodo: 'POST',
      caminho: '/api/cadastros/calendario/moveis',
      corpo: {
        base: 'carnaval',
        anoInicio: ano,
        anoFim: ano + 4,
        abrangencia: 'municipal',
        municipio: 3106200,
      },
    });

    // Inativar pede o motivo e nunca apaga: o registro continua na lista, inativo, com o reativar.
    page.once('dialog', (d) => void d.accept('Nao vale mais neste ano'));
    await page.getByTestId('cal-item-701').getByRole('button', { name: 'Inativar' }).click();
    await expect(page.getByTestId('cal-aviso')).toHaveText('Inativado.');
    expect(pedidos[2]).toMatchObject({
      metodo: 'POST',
      caminho: '/api/cadastros/calendario/701/situacao',
      corpo: { versao: 1, ativo: false, motivo: 'Nao vale mais neste ano' },
    });
    await expect(page.getByTestId('cal-item-701')).toHaveClass(/inativo/);
    await expect(page.getByTestId('cal-item-701').getByRole('button', { name: 'Reativar' })).toBeVisible();
    await semViolacaoAxe(page, 'calendário de feriados');
  });
});
