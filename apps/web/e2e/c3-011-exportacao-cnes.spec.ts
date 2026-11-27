// C3-011 (02-CAD linha 29, item 3): exportação dos profissionais ao cadastro nacional pelo caminho da tela. As rotas
// /api/sus/estabelecimento exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as
// respostas são simuladas pelo Playwright com massa SINTÉTICA, seguindo o contrato da API. O que se prova é a tela: a
// aba da conferência mostra a exportação, Gerar arquivo manda a competência AAAAMM, o resultado mostra a contagem, o
// aviso do leiaute e as pendências, a exportação nova entra na lista e Baixar arquivo entrega o XML guardado. O efeito
// no banco está no contrato de efeito (apps/api/src/modulos/sus/exportacao-cnes.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

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

const XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<profissionaisCadastroNacional leiaute="1.0" cnes="9999965" competencia="202610" quantidade="1">\n</profissionaisCadastroNacional>\n';

test.describe('C3-011 exportação dos profissionais ao cadastro nacional @C3-011', () => {
  test('gerar o arquivo da competência, ver as pendências e baixar o XML', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const exportacoes: Record<string, unknown>[] = [];
    await page.route('**/api/sus/estabelecimento**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/cnes/conferencias')) return json(r, []);
        if (url.pathname.endsWith('/cnes/exportacoes')) return json(r, exportacoes);
        if (url.pathname.endsWith('/cnes/exportacoes/902/arquivo'))
          return json(r, { nomeArquivo: 'profissionais-cnes-9999965-202610.xml', conteudo: XML });
        if (url.pathname.endsWith('/opcoes'))
          return json(r, {
            tiposPrestador: [],
            instrumentos: [],
            naturezas: [],
            servicos: [],
            servicosSigtap: [],
            grupos: [],
            prestadores: [],
            setores: [],
            locais: [],
          });
        return json(r, { habilitacoes: [], servicos: [], regrasPrestador: [], regrasServico: [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/cnes/exportacoes')) {
        exportacoes.unshift({
          id: 902,
          competencia: String(corpo['competencia']),
          numeroRemessa: 1,
          situacao: 'exportada',
          exportadaEm: '2026-11-27T12:00:00.000Z',
          arquivoId: 7702,
          nomeArquivo: 'profissionais-cnes-9999965-202610.xml',
          observacao: '1 lotação(ões) exportada(s); 1 com pendência; leiaute 1.0.',
        });
        return json(
          r,
          {
            id: 902,
            arquivoId: 7702,
            nomeArquivo: 'profissionais-cnes-9999965-202610.xml',
            exportados: 1,
            pendencias: [
              {
                sequencia: 2,
                nome: 'Profissional sintético B',
                motivos: ['Sem vínculo de trabalho do cadastro nacional.'],
              },
            ],
            leiaute: {
              versao: '1.0',
              aviso: 'Leiaute a confirmar: passe à equipe de desenvolvimento o esquema XML.',
            },
          },
          201,
        );
      }
      return json(r, { tipo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.FATURISTA.AIH');
    await page.goto('/faturamento/sus/cadastros/estabelecimento');
    await page.getByTestId('estab-sus-aba-conferencia').click();
    await expect(page.getByTestId('estab-sus-cnes-exp-vazio')).toBeVisible();

    await page.getByTestId('estab-sus-cnes-exp-competencia').fill('2026-10');
    await page.getByTestId('estab-sus-cnes-exportar').click();
    const res = page.getByTestId('estab-sus-cnes-exp-resultado');
    await expect(res).toContainText('1 lotação(ões); 1 com pendência');
    await expect(page.getByTestId('estab-sus-cnes-exp-aviso')).toContainText('Leiaute a confirmar');
    await expect(page.getByTestId('estab-sus-cnes-exp-pendencias')).toContainText('Sem vínculo de trabalho');
    expect(pedidos.at(-1)).toEqual({
      caminho: '/api/sus/estabelecimento/cnes/exportacoes',
      corpo: { competencia: '202610' },
    });
    await expect(page.getByTestId('estab-sus-cnes-exp-902')).toContainText('10/2026');
    await semViolacaoAxe(page, 'exportação dos profissionais ao cadastro nacional');

    const baixa = page.waitForEvent('download');
    await page.getByTestId('estab-sus-cnes-exp-baixar-902').click();
    const arq = await baixa;
    expect(arq.suggestedFilename()).toBe('profissionais-cnes-9999965-202610.xml');
  });
});
