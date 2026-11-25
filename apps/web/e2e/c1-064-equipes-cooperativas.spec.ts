// F8 (02-CAD linha 22): equipes médicas e cooperativas do profissional, pelo caminho da tela.
// O cadastro exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA (CNPJ gerado para teste); o que se prova é a tela: o
// link da lista de profissionais leva à rota, a equipe valida na hora antes de gravar, o membro é escolhido pela busca
// por nome e incluído com papel e vigência, o encerramento manda o último dia, a cooperativa recusa CNPJ inválido e
// conta pela metade na hora e grava, e a visão por profissional (?profissional=) mostra só os vínculos dele. O efeito no
// banco está no contrato de efeito (apps/api/src/modulos/cadastro/equipes-cooperativas.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = '2041-03-10';
const CNPJ = '11222333000181';

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

test.describe('F8 equipes médicas e cooperativas @C1-064', () => {
  test('cadastra a equipe, inclui e encerra o membro, grava a cooperativa e filtra pelo profissional', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const consultas: string[] = [];
    const membros: Record<string, unknown>[] = [];
    const equipes: Record<string, unknown>[] = [
      {
        id: 7,
        versao: 1,
        codigo: 'EQ-CARDIO',
        nome: 'EQUIPE CARDIO SINTETICA',
        tipo: 'medica',
        setorId: null,
        setorNome: null,
        responsavelId: null,
        inicio: '2041-01-01',
        fim: null,
        ativo: true,
        membros,
      },
    ];
    const cooperativas: Record<string, unknown>[] = [];
    await page.route('**/api/cadastros/equipes-cooperativas**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/profissionais'))
          return json(r, [{ id: 901, nome: 'MEDICO SINTETICO UM' }]);
        consultas.push(url.search);
        const doProf = url.searchParams.get('profissional');
        return json(r, {
          hoje: HOJE,
          profissional: doProf ? { id: Number(doProf), nome: 'MEDICO SINTETICO UM' } : null,
          equipes,
          cooperativas: doProf ? [] : cooperativas,
          setores: [{ id: 3, nome: 'SETOR SINTETICO' }],
          bancos: [{ id: 1, nome: '001 BANCO SINTETICO' }],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/membros')) {
        membros.push({
          id: 50,
          versao: 1,
          profissionalId: corpo['profissionalId'],
          profissionalNome: 'MEDICO SINTETICO UM',
          papel: corpo['papel'],
          inicio: corpo['inicio'],
          fim: corpo['fim'],
          vigente: true,
        });
        return json(r, { id: 50 }, 201);
      }
      if (url.pathname.endsWith('/encerrar')) {
        Object.assign(membros[0]!, { fim: corpo['fim'], versao: 2 });
        return json(r, { id: 50 });
      }
      if (url.pathname.endsWith('/cooperativas')) {
        cooperativas.push({ ...corpo, id: 12, versao: 1, cooperados: [] });
        return json(r, { id: 12 });
      }
      equipes.push({ ...corpo, id: 8, versao: 1, setorNome: null, responsavelId: null, membros: [] });
      return json(r, { id: 8 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais');
    await page.getByTestId('link-equipes').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/equipes$/);
    await expect(page.getByTestId('tela-equipes')).toBeVisible();
    await expect(page.getByTestId('eqc-equipe-7')).toContainText('EQ-CARDIO');

    // Validação na hora: sem código e com nome curto nada vai ao servidor.
    await page.getByTestId('eqc-nome').fill('Eq');
    await page.getByTestId('eqc-gravar-equipe').click();
    await expect(page.getByTestId('eqc-problemas')).toContainText('Informe o código da equipe.');
    await expect(page.getByTestId('eqc-problemas')).toContainText('Escreva o nome com ao menos 3 letras.');
    expect(pedidos).toHaveLength(0);
    await page.getByTestId('eqc-codigo').fill('eq orto');
    await page.getByTestId('eqc-nome').fill('Equipe Ortopedia Sintetica');
    await escolher(page.getByTestId('eqc-tipo'), { rotulo: 'Cirúrgica' });
    await escolher(page.getByTestId('eqc-setor'), { rotulo: 'SETOR SINTETICO' });
    await page.getByTestId('eqc-gravar-equipe').click();
    await expect(page.getByTestId('eqc-aviso')).toHaveText('Gravado.');
    expect(pedidos[0]).toMatchObject({
      caminho: '/api/cadastros/equipes-cooperativas/equipes',
      corpo: { id: null, codigo: 'eq orto', tipo: 'cirurgica', setorId: 3, inicio: HOJE, fim: null },
    });

    // Membro pela busca por nome, com papel; depois o encerramento com o último dia.
    await page.getByTestId('eqc-abrir-equipe-7').click();
    await page.getByTestId('eqc-busca').fill('MEDICO');
    await page.getByTestId('eqc-achado-901').click();
    await expect(page.getByTestId('eqc-escolhido')).toContainText('MEDICO SINTETICO UM');
    await escolher(page.getByTestId('eqc-papel'), { rotulo: 'Responsável' });
    await page.getByTestId('eqc-incluir').click();
    await expect(page.getByTestId('eqc-aviso')).toHaveText('Vínculo incluído.');
    expect(pedidos.at(-1)).toMatchObject({
      caminho: '/api/cadastros/equipes-cooperativas/equipes/7/membros',
      corpo: { profissionalId: 901, papel: 'responsavel', inicio: HOJE, fim: null },
    });
    await page.getByTestId('eqc-fim-50').fill('2041-03-31');
    await page.getByTestId('eqc-encerrar-50').click();
    await expect(page.getByTestId('eqc-aviso')).toHaveText('Vínculo encerrado.');
    expect(pedidos.at(-1)).toMatchObject({
      caminho: '/api/cadastros/equipes-cooperativas/membros/50/encerrar',
      corpo: { versao: 1, fim: '2041-03-31' },
    });
    await expect(page.getByTestId('eqc-vinculo-50')).toContainText('até 2041-03-31');

    // Cooperativa: CNPJ inválido e conta pela metade barrados na hora; depois grava.
    await page.getByTestId('eqc-aba-cooperativas').click();
    const antes = pedidos.length;
    await page.getByTestId('eqc-cnpj').fill('11222333000182');
    await page.getByTestId('eqc-razao').fill('Cooperativa Sintetica de Anestesia');
    await page.getByTestId('eqc-coop-nome').fill('Coop Sintetica');
    await page.getByTestId('eqc-agencia').fill('0001');
    await page.getByTestId('eqc-gravar-cooperativa').click();
    await expect(page.getByTestId('eqc-problemas-coop')).toContainText('CNPJ inválido: confira os dígitos.');
    await expect(page.getByTestId('eqc-problemas-coop')).toContainText(
      'Informe banco, agência e conta juntos, ou nenhum deles.',
    );
    expect(pedidos).toHaveLength(antes);
    await page.getByTestId('eqc-cnpj').fill(CNPJ);
    await escolher(page.getByTestId('eqc-banco'), { rotulo: '001 BANCO SINTETICO' });
    await page.getByTestId('eqc-conta').fill('12345');
    await page.getByTestId('eqc-percentual').fill('80');
    await page.getByTestId('eqc-aliq-ir').fill('1,5');
    await page.getByTestId('eqc-gravar-cooperativa').click();
    await expect(page.getByTestId('eqc-aviso')).toHaveText('Gravado.');
    expect(pedidos.at(-1)).toMatchObject({
      caminho: '/api/cadastros/equipes-cooperativas/cooperativas',
      corpo: {
        cnpj: CNPJ,
        bancoId: 1,
        agencia: '0001',
        conta: '12345',
        percentualRepasse: 80,
        aliquotaIr: 1.5,
      },
    });
    await expect(page.getByTestId('eqc-cooperativa-12')).toContainText('Coop Sintetica');
    await semViolacaoAxe(page, 'equipes e cooperativas');

    // Visão por profissional: o link da ficha leva o filtro à API.
    await page.goto('/cadastros/profissionais/equipes?profissional=901');
    await expect(page.getByTestId('eqc-do-profissional')).toContainText('MEDICO SINTETICO UM');
    expect(consultas.at(-1)).toBe('?profissional=901');
  });
});
