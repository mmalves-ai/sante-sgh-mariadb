// E2E @C2-088 (01-REL L116): painéis de TV operacionais. Fonte SINTÉTICA (rotas da API simuladas; nenhum dado real):
// cria o painel, monta os blocos (terapia intensiva com a unidade, farmácia), vê a validação na hora (título curto),
// salva com o corpo esperado, ativa, liga um televisor e vê o código de pareamento; a TV pareia com o código e mostra
// o bloco com as iniciais (nenhum nome) e o resumo com as parcelas.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '**/api/relatorios/paineis-tv';

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.ADMIN');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const catalogo = {
  tipos: [
    {
      id: 1,
      codigo: 'uti',
      descricao: 'Ocupação da terapia intensiva',
      categoria: 'ocupacao_leitos',
      atualizacaoPadraoSegundos: 60,
    },
  ],
  unidadesIntensivas: [{ id: 11, nome: 'UTI adulto sintética' }],
  salas: [{ id: 21, nome: 'Sala 1' }],
  televisores: [{ id: 31, codigo: 'TV1', nome: 'TV do corredor' }],
};
let painel = {
  id: 7,
  codigo: 'TV-UTI',
  nome: 'TV da UTI',
  situacao: 'rascunho',
  tipo: { id: 1, codigo: 'uti', descricao: 'Ocupação da terapia intensiva' },
  tempoRotacaoSegundos: 30,
  atualizacaoSegundos: 60,
  versao: 1,
  blocos: [] as unknown[],
  televisores: [] as unknown[],
};
const resumo = () => ({
  id: 7,
  codigo: 'TV-UTI',
  nome: painel.nome,
  tipo: painel.tipo.descricao,
  situacao: painel.situacao,
  blocos: painel.blocos.length,
  televisores: painel.televisores.length,
  noAr: false,
  versao: painel.versao,
});

test('@C2-088 cadastro do painel de TV, blocos, ativação e televisor', async ({ page }) => {
  let corpoSalvo: Record<string, unknown> | null = null;
  await page.route(`${B}/catalogo`, (r) => json(r, catalogo));
  await page.route(B, (r) => {
    if (r.request().method() === 'POST') return json(r, { id: 7, versao: 1 }, 201);
    return json(r, { itens: [resumo()] });
  });
  await page.route(`${B}/7`, (r) => {
    if (r.request().method() === 'PUT') {
      corpoSalvo = r.request().postDataJSON() as Record<string, unknown>;
      painel = { ...painel, versao: 2, blocos: corpoSalvo['blocos'] as unknown[] };
      return json(r, { id: 7, versao: 2 });
    }
    return json(r, painel);
  });
  await page.route(`${B}/7/situacao`, (r) => {
    painel = { ...painel, situacao: 'ativo', versao: 3 };
    return json(r, { id: 7, situacao: 'ativo', versao: 3 });
  });
  await page.route(`${B}/7/televisores`, (r) => json(r, { id: 41, codigoPareamento: 'K7M3QZ' }, 201));

  await entrar(page);
  await page.goto('/relatorios/paineis-tv');
  await expect(page.getByTestId('tela-paineis-tv-operacionais')).toBeVisible();
  await page.getByTestId('ptv-novo-codigo').fill('TV-UTI');
  await page.getByTestId('ptv-novo-nome').fill('TV da UTI');
  await escolher(page.getByTestId('ptv-novo-tipo'), { rotulo: 'Ocupação da terapia intensiva' });
  await page.getByTestId('ptv-criar').click();
  await expect(page.getByTestId('ptv-editor')).toBeVisible();

  await page.getByTestId('ptv-incluir-bloco').click();
  await escolher(page.getByTestId('ptv-bloco-0-unidade'), { rotulo: 'UTI adulto sintética' });
  await page.getByTestId('ptv-incluir-bloco').click();
  await escolher(page.getByTestId('ptv-bloco-1-fonte'), { rotulo: 'Fila da farmácia' });
  // Validação na hora: título curto bloqueia o salvar.
  await page.getByTestId('ptv-bloco-1-titulo').fill('F');
  await expect(page.getByText('Bloco 2: o título tem ao menos 3 letras.')).toBeVisible();
  await expect(page.getByTestId('ptv-salvar')).toBeDisabled();
  await page.getByTestId('ptv-bloco-1-titulo').fill('Farmácia central');
  await page.getByTestId('ptv-salvar').click();
  await expect(page.getByTestId('ptv-salvo')).toBeVisible();
  expect(corpoSalvo).toMatchObject({
    versao: 1,
    blocos: [
      { fonte: 'uti', unidadeInternacaoId: 11, salaCirurgicaId: null },
      { fonte: 'farmacia', titulo: 'Farmácia central', unidadeInternacaoId: null },
    ],
  });

  await page.getByTestId('ptv-ativar').click();
  await expect(page.getByTestId('ptv-suspender')).toBeVisible();
  await escolher(page.getByTestId('ptv-tv-escolha'), { rotulo: 'TV do corredor' });
  await page.getByTestId('ptv-ligar').click();
  await expect(page.getByTestId('ptv-codigo')).toContainText('K7M3QZ');
  await semViolacaoAxe(page);
});

test('@C2-088 televisor pareia com o código e mostra só iniciais', async ({ page }) => {
  await page.route(`${B}/parear`, (r) => json(r, { id: 41, painelId: 7 }));
  await page.route(`${B}/7/tela`, (r) =>
    json(r, {
      id: 7,
      nome: 'TV da UTI',
      situacao: 'ativo',
      atualizacaoSegundos: 60,
      atualizadoEm: '2026-11-25T12:00:00.000Z',
      blocos: [
        {
          sequencia: 1,
          titulo: 'UTI adulto',
          fonte: 'uti',
          forma: 'tabela',
          tempoEmTelaSegundos: 30,
          colunas: [
            { campo: 'leito', rotulo: 'Leito' },
            { campo: 'paciente', rotulo: 'Paciente' },
            { campo: 'dias', rotulo: 'Dias' },
          ],
          linhas: [
            { leito: 'U01', paciente: 'T. C. V.', dias: 3 },
            { leito: 'U02', paciente: 'Livre', dias: null },
          ],
          resumo: [
            { rotulo: 'Leitos', valor: 2 },
            { rotulo: 'Ocupados', valor: 1 },
            { rotulo: 'Ocupação (%)', valor: 50 },
          ],
        },
      ],
    }),
  );
  await entrar(page);
  await page.goto('/tv/operacional');
  await page.evaluate(() => localStorage.removeItem('sgh.tv-operacional'));
  await page.reload();
  await page.getByTestId('tvo-codigo').fill('k7m3qz');
  await page.getByTestId('tvo-parear-enviar').click();
  const bloco = page.getByTestId('tvo-bloco-uti');
  await expect(bloco).toBeVisible();
  await expect(bloco).toContainText('T. C. V.');
  await expect(bloco).toContainText('Ocupação (%)');
  await semViolacaoAxe(page);
});
