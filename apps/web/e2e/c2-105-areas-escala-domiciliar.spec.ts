// E2E @C2-105 (F8, 03-PEP L143): áreas e escala da atenção domiciliar pela tela /internacao/domiciliar/areas, aberta
// pelo painel da internação domiciliar (RDC ANVISA 11/2006 e Portaria GM/MS 825/2016). A equipe cadastra a área pelas
// faixas de CEP (a sobreposição com outra área ativa aparece na hora e trava o botão), acha a área do CEP do
// endereço, vincula o profissional à área (o vínculo repetido no mesmo período aparece na hora), cria o turno da
// escala (o choque com outro turno do profissional aparece na hora) e vê a grade com as vagas. As rotas
// /api/internacao/domiciliar exigem o banco próprio e o E2E roda com a fonte sintética: as respostas são simuladas
// pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/adt/area-escala-domiciliar-propria.int.spec.ts.
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

const areas = {
  areas: [
    {
      id: 1,
      versao: 1,
      codigo: 'SUL',
      descricao: 'Zona sul sintética',
      ativo: true,
      programa: null,
      programaNome: null,
      faixas: [{ sequencia: 1, cepInicial: '02000000', cepFinal: '02999999', municipio: null, bairro: null }],
      profissionais: [
        {
          id: 21,
          versao: 1,
          profissional: 101,
          nome: 'PROFISSIONAL SINTETICO A',
          prioridade: 1,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
        },
      ],
    },
  ],
  programas: [{ id: 5, nome: 'Programa sintético' }],
  tiposChamado: [{ id: 9, nome: 'Rotina sintética' }],
  profissionais: [
    { id: 101, nome: 'PROFISSIONAL SINTETICO A' },
    { id: 102, nome: 'PROFISSIONAL SINTETICO B' },
  ],
};
const turno = {
  id: 31,
  versao: 1,
  area: 1,
  areaNome: 'Zona sul sintética',
  profissional: 101,
  profissionalNome: 'PROFISSIONAL SINTETICO A',
  tipoChamado: null,
  tipoNome: null,
  diaSemana: 2,
  horaInicio: '08:00',
  horaFim: '12:00',
  quantidade: 4,
  permiteExtra: false,
  atendeFeriado: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
};

test.describe('Áreas e escala da atenção domiciliar @C2-105 @fase8', () => {
  test.setTimeout(180_000);
  test('área por CEP com sobreposição na hora, busca do CEP, vínculo, turno sem choque e grade; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    await page.route('**/api/internacao/domiciliar/**', async (r) => {
      const u = new URL(r.request().url());
      const caminho = u.pathname.replace('/api/internacao/domiciliar', '');
      if (r.request().method() === 'POST') {
        pedidos.push({ caminho, corpo: r.request().postDataJSON() as Record<string, unknown> });
        return json(r, { id: 77 }, 201);
      }
      if (caminho === '/opcoes')
        return json(r, {
          tiposChamado: [],
          motivosChamado: [],
          motivosTransferencia: [],
          programas: [],
          areas: [],
          fontes: [],
          tiposCusto: [],
          profissionais: [],
        });
      if (caminho === '/painel')
        return json(r, { internacoes: [], chamados: [], visitas: [], orcamentos: [] });
      if (caminho === '/areas') return json(r, areas);
      if (caminho.startsWith('/areas/cep/')) return json(r, { cep: '02100500', area: 1 });
      if (caminho === '/escalas') return json(r, [turno]);
      if (caminho === '/escalas/grade') {
        const inicio = u.searchParams.get('inicio') ?? '2026-11-30';
        return json(r, {
          inicio,
          dias: [{ data: inicio, turnos: [{ ...turno, ocupadas: 1, livres: 3 }] }],
        });
      }
      return json(r, {});
    });

    // A recepção da internação lê e grava (internacao.internacao.ler e .criar); o administrador do sistema não tem.
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/domiciliar');
    await page.getByTestId('domiciliar-ir-areas').click();
    await expect(page).toHaveURL(/\/internacao\/domiciliar\/areas/);
    await expect(page.getByTestId('tela-area-escala-domiciliar')).toBeVisible();
    await expect(page.getByTestId('area-1')).toContainText('02000-000 a 02999-999');

    // Área nova: a faixa que cruza a área SUL aparece na hora e trava o botão.
    await page.getByTestId('area-codigo').fill('NORTE');
    await page.getByTestId('area-descricao').fill('Zona norte sintética');
    await page.getByTestId('area-faixa-inicio-0').fill('02500-000');
    await page.getByTestId('area-faixa-fim-0').fill('03000-000');
    await expect(page.getByTestId('area-problemas')).toContainText('área SUL');
    await expect(page.getByTestId('area-salvar')).toBeDisabled();
    await page.getByTestId('area-faixa-inicio-0').fill('03000-000');
    await page.getByTestId('area-faixa-fim-0').fill('03999-999');
    await expect(page.getByTestId('area-problemas')).toHaveCount(0);
    await page.getByTestId('area-salvar').click();
    await expect(page.getByTestId('area-escala-aviso')).toContainText('Gravado');
    expect(pedidos.find((p) => p.caminho === '/areas')?.corpo).toMatchObject({
      codigo: 'NORTE',
      faixas: [{ cepInicial: '03000-000', cepFinal: '03999-999' }],
    });

    // A área do CEP do endereço.
    await page.getByTestId('area-cep').fill('02100-500');
    await page.getByTestId('area-cep-procurar').click();
    await expect(page.getByTestId('area-cep-resultado')).toContainText('SUL');

    // Vínculo: o profissional A já está na área (aparece na hora); o B entra.
    await escolher(page.getByTestId('area-vinculo-area'), { rotulo: /SUL/ });
    await escolher(page.getByTestId('area-vinculo-profissional'), { rotulo: 'PROFISSIONAL SINTETICO A' });
    await expect(page.getByTestId('area-vinculo-problemas')).toContainText('já está nesta área');
    await expect(page.getByTestId('area-vinculo-salvar')).toBeDisabled();
    await escolher(page.getByTestId('area-vinculo-profissional'), { rotulo: 'PROFISSIONAL SINTETICO B' });
    await expect(page.getByTestId('area-vinculo-problemas')).toHaveCount(0);
    await page.getByTestId('area-vinculo-salvar').click();
    await expect(page.getByTestId('area-escala-aviso')).toContainText('Gravado');
    expect(pedidos.find((p) => p.caminho === '/areas/1/profissionais')?.corpo).toMatchObject({
      profissional: 102,
      prioridade: 1,
    });

    // Turno: o choque com o turno das 08:00 às 12:00 aparece na hora; o da tarde entra.
    await escolher(page.getByTestId('escala-area'), { rotulo: /SUL/ });
    await escolher(page.getByTestId('escala-profissional'), { rotulo: 'PROFISSIONAL SINTETICO A' });
    await escolher(page.getByTestId('escala-dia'), { rotulo: 'segunda' });
    await page.getByTestId('escala-inicio').fill('2026-02-01');
    await page.getByTestId('escala-hora-inicio').fill('11:00');
    await page.getByTestId('escala-hora-fim').fill('14:00');
    await expect(page.getByTestId('escala-problemas')).toContainText('08:00 às 12:00');
    await expect(page.getByTestId('escala-salvar')).toBeDisabled();
    await page.getByTestId('escala-hora-inicio').fill('13:00');
    await page.getByTestId('escala-hora-fim').fill('17:00');
    await expect(page.getByTestId('escala-problemas')).toHaveCount(0);
    await page.getByTestId('escala-extra').check();
    await page.getByTestId('escala-salvar').click();
    await expect(page.getByTestId('area-escala-aviso')).toContainText('Gravado');
    expect(pedidos.find((p) => p.caminho === '/escalas')?.corpo).toMatchObject({
      area: 1,
      profissional: 101,
      diaSemana: 2,
      horaInicio: '13:00',
      horaFim: '17:00',
      permiteExtra: true,
    });

    // Lista dos turnos e grade com as vagas.
    await expect(page.getByTestId('escala-31')).toContainText('segunda');
    await expect(page.getByTestId('escala-grade')).toContainText('1 de 4 (3 livres)');
    await semViolacaoAxe(page, 'areas-escala-domiciliar');
  });
});
