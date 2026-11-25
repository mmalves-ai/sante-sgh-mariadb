// E2E @C2-039 (F8, 01-ADM L114): página inicial montada pelo hospital, por perfil. As rotas
// `/api/relatorios/pagina-inicial/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E
// simula essas rotas com um estado em memória que segue a regra do servidor (salvar a página inteira com trava de
// versão; publicar sem apagar). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/relatorio/pagina-inicial-propria.int.spec.ts. Aqui se prova o fluxo: criar o modelo; incluir
// lista de trabalho, indicador com gráfico, atalho e texto; o atalho com endereço inválido é recusado na hora e trava
// o salvar; ligar o perfil; salvar e publicar. Depois, a página inicial da pessoa sai montada pelo modelo do perfil:
// a pessoa acumula dois perfis (médico e recepção; /api/acesso/inicio simulada) e o modelo traz as filas dos dois, que
// aparecem juntas, na ordem e na largura do modelo, sem o seletor de perfil. Axe nas duas telas. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/relatorios/pagina-inicial';

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

const CATALOGO = {
  tipos: [
    {
      codigo: 'mensagens',
      descricao: 'Mensagens e comunicados',
      categoria: 'comunicado',
      componente: 'lista_trabalho',
      detalhamento: null,
    },
    {
      codigo: 'medico',
      descricao: 'Médico: meus pacientes',
      categoria: 'lista_trabalho',
      componente: 'lista_trabalho',
      detalhamento: null,
    },
    {
      codigo: 'recepcao',
      descricao: 'Recepção: senhas',
      categoria: 'lista_trabalho',
      componente: 'lista_trabalho',
      detalhamento: null,
    },
    {
      codigo: 'indicador',
      descricao: 'Indicador',
      categoria: 'indicador',
      componente: 'indicador',
      detalhamento: null,
    },
  ],
  indicadores: [{ id: 7, codigo: 'IND-FIC-7', nome: 'OCUPACAO FICTICIA', unidade: 'percentual' }],
  perfis: [
    {
      id: 3,
      codigo: 'perfil-ficticio',
      nome: 'PERFIL FICTICIO DA RECEPCAO',
      estabelecimentoId: 1,
      estabelecimento: 'HOSPITAL FICTICIO',
    },
  ],
  estabelecimento: 1,
  podeRede: false,
};

// A página fixa da pessoa (/api/acesso/inicio): dois perfis de trabalho e as filas que o servidor liberou.
const PAGINA_FIXA = {
  perfis: [
    { id: 'medico', titulo: 'Médico' },
    { id: 'recepcao', titulo: 'Recepção' },
  ],
  componentes: [
    { id: 'mensagens', titulo: 'Mensagens', rota: '/mensagens', pendentes: null, prioridade: 0, prazo: null },
    {
      id: 'medico',
      titulo: 'Meus pacientes',
      rota: '/inicio/medico',
      pendentes: null,
      prioridade: 0,
      prazo: null,
    },
    {
      id: 'recepcao',
      titulo: 'Senhas',
      rota: '/inicio/recepcao',
      pendentes: null,
      prioridade: 0,
      prazo: null,
    },
  ],
};
const LIBERADAS = new Set(PAGINA_FIXA.componentes.map((c) => c.id));

interface Modelo {
  id: number;
  nome: string;
  descricao: string | null;
  situacao: 'rascunho' | 'publicado' | 'inativo';
  rede: boolean;
  versao: number;
  blocos: Record<string, unknown>[];
  perfis: { perfilId: number; nome: string; prioridade: number }[];
}

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const modelos: Modelo[] = [];
  const resumo = (m: Modelo) => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    situacao: m.situacao,
    rede: m.rede,
    blocos: m.blocos.length,
    perfis: m.perfis.length,
    versao: m.versao,
  });
  const detalhe = (m: Modelo) => ({
    ...m,
    podeAlterar: true,
    perfisOutros: 0,
    blocos: m.blocos.map((b) => ({
      ...b,
      indicadorNome: b['indicadorId'] ? CATALOGO.indicadores[0]!.nome : null,
    })),
  });
  return {
    corpos,
    modelos,
    async ligar() {
      await page.route(`**${B}/catalogo`, (rota) => json(rota, CATALOGO));
      await page.route('**/api/acesso/inicio', (rota) => json(rota, PAGINA_FIXA));
      await page.route(`**${B}/modelos`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, { itens: modelos.map(resumo) });
        const c = rota.request().postDataJSON() as { nome: string; descricao: string | null; rede: boolean };
        corpos.push(c);
        const m: Modelo = {
          id: 5 + modelos.length,
          nome: c.nome,
          descricao: c.descricao,
          situacao: 'rascunho',
          rede: c.rede,
          versao: 1,
          blocos: [],
          perfis: [],
        };
        modelos.push(m);
        return json(rota, { id: m.id, versao: m.versao });
      });
      await page.route(/\/api\/relatorios\/pagina-inicial\/modelos\/\d+$/, async (rota) => {
        const id = Number(rota.request().url().split('/modelos/')[1]);
        const m = modelos.find((x) => x.id === id);
        if (!m) return json(rota, { status: 404, title: 'Modelo' }, 404);
        if (rota.request().method() === 'GET') return json(rota, detalhe(m));
        const c = rota.request().postDataJSON() as {
          versao: number;
          nome: string;
          descricao: string | null;
          blocos: Record<string, unknown>[];
          perfis: { perfilId: number; prioridade: number }[];
        };
        corpos.push(c);
        if (c.versao !== m.versao) return json(rota, { status: 409, title: 'Versão' }, 409);
        m.nome = c.nome;
        m.descricao = c.descricao;
        m.blocos = c.blocos;
        m.perfis = c.perfis.map((p) => ({
          ...p,
          nome: CATALOGO.perfis.find((x) => x.id === p.perfilId)!.nome,
        }));
        m.versao += 1;
        return json(rota, { id: m.id, versao: m.versao });
      });
      await page.route(/\/api\/relatorios\/pagina-inicial\/modelos\/\d+\/situacao$/, async (rota) => {
        const id = Number(rota.request().url().split('/modelos/')[1]!.split('/')[0]);
        const m = modelos.find((x) => x.id === id)!;
        const c = rota.request().postDataJSON() as { versao: number; situacao: Modelo['situacao'] };
        corpos.push(c);
        if (c.versao !== m.versao) return json(rota, { status: 409, title: 'Versão' }, 409);
        if (c.situacao === 'publicado' && (m.blocos.length === 0 || m.perfis.length === 0))
          return json(rota, { status: 422, title: 'Falta bloco ou perfil' }, 422);
        m.situacao = c.situacao;
        m.versao += 1;
        return json(rota, { id: m.id, versao: m.versao });
      });
      // A página da pessoa: o modelo publicado do perfil, só com as listas liberadas para ela (como a porta), e a série
      // do indicador apurada (competência AAAA-MM-DD, como a porta devolve).
      await page.route(`**${B}/minha`, (rota) => {
        const m = modelos.find((x) => x.situacao === 'publicado');
        if (!m) return json(rota, { modelo: null, blocos: [] });
        return json(rota, {
          modelo: { id: m.id, nome: m.nome },
          blocos: m.blocos
            .filter((b) => b['tipo'] !== 'lista_trabalho' || LIBERADAS.has(String(b['catalogo'])))
            .map((b) => ({
              ...b,
              indicador:
                b['tipo'] === 'indicador'
                  ? {
                      id: 7,
                      codigo: 'IND-FIC-7',
                      nome: 'OCUPACAO FICTICIA',
                      unidade: 'percentual',
                      simbolo: '%',
                      serie: [
                        { competencia: '2030-01-01', valor: 71.5, meta: 85 },
                        { competencia: '2030-02-01', valor: 78, meta: 85 },
                        { competencia: '2030-03-01', valor: 82.25, meta: 85 },
                      ],
                    }
                  : null,
            })),
        });
      });
    },
  };
}

test.describe('@C2-039 página inicial montada pelo hospital por perfil', () => {
  test('a administração monta, confere na hora, salva e publica; o início sai pelo modelo do perfil', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/admin/pagina-inicial');
    await expect(page.getByTestId('tela-pagina-inicial')).toBeVisible();

    // Criar o modelo: abre direto no editor, em rascunho, sem blocos nem perfis.
    await page.getByTestId('pi-novo-nome').fill('PAGINA FICTICIA DA RECEPCAO');
    await page.getByTestId('pi-criar').click();
    await expect(page.getByTestId('pi-editor')).toBeVisible();
    await expect(page.getByTestId('pi-situacao')).toContainText('Rascunho');
    expect(api.corpos.at(-1)).toEqual({ nome: 'PAGINA FICTICIA DA RECEPCAO', descricao: null, rede: false });
    await expect(page.getByTestId('pi-falta-publicar')).toBeVisible();
    await expect(page.getByTestId('pi-publicar')).toBeDisabled();

    // Lista de trabalho do catálogo.
    await escolher(page.getByTestId('pi-novo-tipo'), 'lista_trabalho');
    await page.getByTestId('pi-incluir').click();
    await escolher(page.getByTestId('pi-bloco-0-lista'), 'mensagens');
    await escolher(page.getByTestId('pi-bloco-0-largura'), '2');
    // Indicador com gráfico.
    await escolher(page.getByTestId('pi-novo-tipo'), 'indicador');
    await page.getByTestId('pi-incluir').click();
    await escolher(page.getByTestId('pi-bloco-1-indicador'), '7');
    // Atalho com endereço inválido: o erro aparece na hora e o salvar trava.
    await escolher(page.getByTestId('pi-novo-tipo'), 'link');
    await page.getByTestId('pi-incluir').click();
    await page.getByTestId('pi-bloco-2-titulo').fill('AGENDA FICTICIA');
    await page.getByTestId('pi-bloco-2-endereco').fill('javascript:alert(1)');
    await expect(page.getByTestId('pi-bloco-2-erro')).toContainText('Use uma tela do sistema');
    await expect(page.getByTestId('pi-salvar')).toBeDisabled();
    await page.getByTestId('pi-bloco-2-endereco').fill('http://exemplo.invalid/agenda');
    await expect(page.getByTestId('pi-bloco-2-erro')).toBeVisible();
    await page.getByTestId('pi-bloco-2-endereco').fill('/agenda');
    await expect(page.getByTestId('pi-bloco-2-erro')).toHaveCount(0);
    // Texto em linha inteira.
    await escolher(page.getByTestId('pi-novo-tipo'), 'texto');
    await page.getByTestId('pi-incluir').click();
    await page.getByTestId('pi-bloco-3-texto').fill('AVISO FICTICIO DA GESTAO');
    // As filas dos dois perfis de trabalho (médico e recepção) no mesmo modelo.
    await escolher(page.getByTestId('pi-novo-tipo'), 'lista_trabalho');
    await page.getByTestId('pi-incluir').click();
    await escolher(page.getByTestId('pi-bloco-4-lista'), 'medico');
    await escolher(page.getByTestId('pi-novo-tipo'), 'lista_trabalho');
    await page.getByTestId('pi-incluir').click();
    await escolher(page.getByTestId('pi-bloco-5-lista'), 'recepcao');
    await expect(page.locator('[data-testid$="-erro"]')).toHaveCount(0);

    // Ligar o perfil.
    await escolher(page.getByTestId('pi-perfil'), '3');
    await page.getByTestId('pi-ligar').click();
    await expect(page.getByTestId('pi-perfil-3')).toContainText('PERFIL FICTICIO DA RECEPCAO');
    await expect(page.getByTestId('pi-falta-publicar')).toHaveCount(0);

    // Salvar a página inteira, pela versão.
    await expect(page.getByTestId('pi-salvar')).toBeEnabled();
    await page.getByTestId('pi-salvar').click();
    await expect(page.getByTestId('pi-aviso')).toBeVisible();
    expect(api.corpos.at(-1)).toEqual({
      versao: 1,
      nome: 'PAGINA FICTICIA DA RECEPCAO',
      descricao: null,
      blocos: [
        {
          tipo: 'lista_trabalho',
          catalogo: 'mensagens',
          indicadorId: null,
          titulo: null,
          endereco: null,
          texto: null,
          largura: 2,
        },
        {
          tipo: 'indicador',
          catalogo: null,
          indicadorId: 7,
          titulo: null,
          endereco: null,
          texto: null,
          largura: 1,
        },
        {
          tipo: 'link',
          catalogo: null,
          indicadorId: null,
          titulo: 'AGENDA FICTICIA',
          endereco: '/agenda',
          texto: null,
          largura: 1,
        },
        {
          tipo: 'texto',
          catalogo: null,
          indicadorId: null,
          titulo: null,
          endereco: null,
          texto: 'AVISO FICTICIO DA GESTAO',
          largura: 3,
        },
        ...['medico', 'recepcao'].map((catalogo) => ({
          tipo: 'lista_trabalho',
          catalogo,
          indicadorId: null,
          titulo: null,
          endereco: null,
          texto: null,
          largura: 1,
        })),
      ],
      perfis: [{ perfilId: 3, prioridade: 1 }],
    });

    // Publicar: o modelo fica, agora publicado.
    await expect(page.getByTestId('pi-publicar')).toBeEnabled();
    await page.getByTestId('pi-publicar').click();
    await expect(page.getByTestId('pi-situacao')).toContainText('Publicado');
    expect(api.corpos.at(-1)).toEqual({ versao: 2, situacao: 'publicado' });
    await expect(page.getByTestId('pi-modelo-5')).toBeVisible();
    await semViolacaoAxe(page, '/admin/pagina-inicial');

    // A página inicial da pessoa sai montada pelo modelo do perfil.
    await page.goto('/inicio');
    await expect(page.getByTestId('inicio-modelo')).toContainText('PAGINA FICTICIA DA RECEPCAO');
    // O modelo manda na página: sem o seletor de perfil, as filas dos dois perfis aparecem, na ordem do modelo (a lista
    // de mensagens antes do indicador) e com a largura dele.
    await expect(page.getByTestId('inicio-perfil')).toHaveCount(0);
    const grade = page.getByTestId('inicio-cartoes');
    await expect(grade.getByTestId('cartao-mensagens')).toHaveClass(/largura-2/);
    await expect(grade.locator(':scope > [data-testid]')).toHaveCount(6);
    expect(
      await grade
        .locator(':scope > [data-testid]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))),
    ).toEqual([
      'cartao-mensagens',
      'bloco-indicador',
      'bloco-link',
      'bloco-texto',
      'cartao-medico',
      'cartao-recepcao',
    ]);
    await expect(grade.getByTestId('bloco-texto')).toHaveClass(/largura-3/);
    const indicador = page.getByTestId('bloco-indicador');
    await expect(indicador).toBeVisible();
    await expect(indicador.getByTestId('bloco-indicador-ultimo')).toBeVisible();
    await expect(indicador.locator('.grafico > li')).toHaveCount(3);
    await expect(
      page.getByTestId('bloco-link').getByRole('link', { name: 'AGENDA FICTICIA' }),
    ).toHaveAttribute('href', '/agenda');
    await expect(page.getByTestId('bloco-texto')).toContainText('AVISO FICTICIO DA GESTAO');
    await semViolacaoAxe(page, '/inicio');
    expect(externas).toEqual([]);
  });
});
