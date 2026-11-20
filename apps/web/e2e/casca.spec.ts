import { expect, test } from '@playwright/test';
import { PRODUTO_NOME_E2E } from './ambiente.js';
import { escolher, esperarValor } from './combos.js';
import {
  abrirMenuInteiro,
  COMBINACOES,
  menuPrincipal,
  semViolacaoAxe,
  usarPreferencias,
  vigiarExternas,
} from './ajuda.js';

test.describe('casca @M07', () => {
  for (const c of COMBINACOES) {
    test(`axe ${c.tema} × ${c.densidade}: /inicio, /preferencias, /sobre e a paleta; 0 requisição externa`, async ({
      page,
    }) => {
      const externas = vigiarExternas(page);
      await usarPreferencias(page, c);
      await page.goto('/inicio');
      await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(new RegExp(`densidade-${c.densidade}`));
      if (c.tema === 'escuro') await expect(page.locator('html')).toHaveClass(/modo-escuro/);
      else await expect(page.locator('html')).not.toHaveClass(/modo-escuro/);
      await semViolacaoAxe(page, `/inicio ${c.tema} ${c.densidade}`);
      await page.goto('/preferencias');
      await expect(page.getByRole('heading', { level: 1, name: 'Preferências' })).toBeVisible();
      await semViolacaoAxe(page, `/preferencias ${c.tema} ${c.densidade}`);
      await page.goto('/sobre');
      await expect(page.getByTestId('sobre-api')).not.toContainText('Lendo');
      await semViolacaoAxe(page, `/sobre ${c.tema} ${c.densidade}`);
      await page.keyboard.press('Control+k');
      await expect(page.getByTestId('paleta')).toBeVisible();
      await semViolacaoAxe(page, `paleta ${c.tema} ${c.densidade}`);
      expect(externas).toEqual([]);
    });
  }

  test('marca e nome do produto vêm da configuração; fontes empacotadas carregadas', async ({ page }) => {
    const externas = vigiarExternas(page);
    await page.goto('/inicio');
    await expect(page).toHaveTitle(PRODUTO_NOME_E2E);
    await expect(page.getByTestId('marca')).toContainText(PRODUTO_NOME_E2E);
    await expect(page.getByTestId('marca')).toContainText('provisório');
    await page.evaluate(() => document.fonts.ready);
    const fontes = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
    );
    expect(fontes).toContain('Inter');
    expect(externas).toEqual([]);
  });

  test('menu gerado da árvore: só as telas prontas, com rótulo de produto e sem selo de fase', async ({
    page,
  }) => {
    await page.goto('/inicio');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    const itens = menu.getByRole('link');
    // Áreas e níveis começam recolhidos (só a área da tela atual vem aberta): abre tudo para contar.
    await abrirMenuInteiro(page);
    // M06: a sessão sintética (Administrador do sistema e Gestor de acessos) vê também as consultas do acesso;
    // M08: os subitens do CRUD genérico, parâmetros, funcionalidades e as telas técnicas (menu ligado); ADR 0022:
    // Perfis e permissões (desde o M10, aberta das telas de acesso); M11: profissionais e médicos solicitantes (a
    // sessão sintética tem as opções).
    // M10: estrutura (rede), usuários, simulador, termo, alertas, e-mail, dados fiscais, LGPD e backup (a sessão é
    // Administrador do sistema e Gestor de acessos). Centros de custo, locais e locais de conta só aparecem com a
    // permissão do domínio (a opção do legado), que esta sessão não tem; o item do simulador abre o simulador.
    // Na fase0 de 22/10/2026: mais a matriz de riscos, os grupos novos dos cadastros auxiliares e as telas técnicas
    // da matriz de cobertura e da saúde do sistema (a contagem de 28 já não valia antes do menu hierárquico).
    // M26 e M27 (22/10/2026): mais as modalidades DICOM e o portal de resultados (M26), as mensagens internas e o
    // dicionário pessoal (M27, de toda pessoa).
    // M35 (revisão, consolidação): o menu cresce a cada marco (36 até o M27; o M34 acrescentou as integrações). Em vez
    // das posições fixas, confere que os itens esperados estão lá, na ordem da árvore, e que nada sem tela aparece.
    const textos = (await itens.allInnerTexts()).map((x) => x.trim());
    expect(textos.length).toBeGreaterThanOrEqual(36);
    const esperados = [
      'Minha fila de trabalho',
      'Mensagens internas e avisos',
      'Dicionário ortográfico pessoal',
      'Aparência e segurança da conta',
      'Matriz de riscos e não conformidades',
      'Profissionais, registros e especialidades',
      'Médicos solicitantes externos',
      'Rede, empresa, hospital e unidades',
      'Demográficos, documentos e endereço',
      'Usuários',
      'Grupos de usuários e perfis',
      'Permissões, menus e papéis SBIS',
      'Simulador de permissões',
      'Parâmetros por módulo',
      'Funcionalidades por estabelecimento',
      'Estabelecimentos e conexões',
      'Integridade de gravação',
    ];
    const posicoes = esperados.map((e) => textos.indexOf(e));
    expect(
      posicoes.filter((p) => p < 0),
      `ausentes: ${esperados.filter((_, i) => posicoes[i]! < 0).join(', ')}`,
    ).toEqual([]);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(textos.slice(0, 4)).toEqual(esperados.slice(0, 4));
    await expect(menu.getByRole('link', { name: 'Centros de custo e clínicas' })).toHaveCount(0);
    // Telas técnicas de convivência com o banco: área própria, só com as permissões técnicas.
    await expect(menu.getByRole('heading', { name: 'Técnico' })).toBeVisible();
    await expect(menu).not.toContainText(/SPDATA|legado|sistema atual|\(|F[0-7]\b/);
  });

  test('menu hierárquico: recolhível e lembrado, a tela atual aberta, busca sem acento, teclado e axe', async ({
    page,
  }) => {
    await page.goto('/inicio');
    const menu = menuPrincipal(page);
    const area = (nome: string) => menu.getByRole('button', { name: new RegExp(`^${nome}`) });
    // A área da tela atual vem aberta, com o item marcado; as outras, recolhidas.
    await expect(area('Início')).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('[aria-current="page"]')).toHaveText('Minha fila de trabalho');
    await expect(area('Administração')).toHaveAttribute('aria-expanded', 'false');
    await expect(menu.getByRole('link', { name: 'Usuários', exact: true })).toHaveCount(0);
    // Área > nível > item; o título completo fica no title.
    await area('Administração').click();
    const acesso = menu.getByRole('button', { name: /^Acesso/ });
    await expect(acesso).toHaveAttribute('aria-expanded', 'false');
    await acesso.click();
    const usuarios = menu.getByRole('link', { name: 'Usuários', exact: true });
    await expect(usuarios).toHaveAttribute('title', 'Administração › Acesso › Usuários');
    await semViolacaoAxe(page, 'menu aberto');
    // Lembrado por usuário: recarregar mantém aberto; "Recolher tudo" fecha.
    await page.reload();
    await expect(usuarios).toBeVisible();
    await menu.getByRole('button', { name: 'Recolher tudo' }).click();
    await expect(usuarios).toHaveCount(0);
    await page.reload();
    await expect(area('Administração')).toHaveAttribute('aria-expanded', 'false');
    // Teclado: à direita abre, à esquerda fecha; Enter alterna.
    await area('Administração').focus();
    await page.keyboard.press('ArrowRight');
    await expect(area('Administração')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(acesso).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(acesso).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(usuarios).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(acesso).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(acesso).toHaveAttribute('aria-expanded', 'false');
    // Busca sem acento nem maiúsculas: abre as áreas com resultado.
    await menu.getByRole('button', { name: 'Recolher tudo' }).click();
    const busca = menu.getByRole('searchbox', { name: 'Buscar no menu' });
    await busca.fill('SIMULADOR DE PERMISSOES');
    await expect(menu.getByRole('link')).toHaveCount(1);
    await expect(menu.getByRole('link', { name: 'Simulador de permissões' })).toBeVisible();
    await busca.press('Escape');
    await expect(busca).toHaveValue('');
    await expect(menu.getByRole('link', { name: 'Simulador de permissões' })).toHaveCount(0);
  });

  test('hospital: estabelecimento ativo sempre visível; a troca chama a API e relê tudo (cache limpo)', async ({
    page,
  }) => {
    const sessao = (ativo: string) => ({
      usuario: { id: 'sintetico', nome: 'Usuário sintético' },
      rede: 'rede-teste',
      estabelecimentos: [
        { codigo: 'aa', nome: 'Estabelecimento A (teste)' },
        { codigo: 'bb', nome: 'Estabelecimento B (teste)' },
      ],
      estabelecimentoAtivo: ativo,
      permissoes: [
        'acesso.inicio.ler',
        'acesso.preferencia.ler',
        'acesso.preferencia.editar',
        'acesso.sobre.ler',
      ],
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    });
    const trocas: unknown[] = [];
    let versoes = 0;
    await page.route('**/api/sessao', (r) => r.fulfill({ json: sessao('aa') }));
    await page.route('**/api/sessao/estabelecimento', async (r) => {
      trocas.push(r.request().postDataJSON());
      await r.fulfill({ json: sessao('bb') });
    });
    page.on('request', (r) => {
      if (r.url().endsWith('/api/versao')) versoes++;
    });
    await page.goto('/sobre');
    const barra = page.getByTestId('estabelecimento-ativo');
    await esperarValor(barra.getByRole('combobox'), 'aa');
    await expect(barra).toContainText('Estabelecimento A (teste)');
    await expect(page.getByTestId('sobre-api')).not.toContainText('Lendo');
    expect(versoes).toBe(1);
    // Escolher no combo não troca (setas no Windows disparam change): só a confirmação troca.
    await escolher(barra.getByRole('combobox'), 'bb');
    expect(trocas).toEqual([]);
    await barra.getByTestId('confirmar-troca').click();
    await esperarValor(barra.getByRole('combobox'), 'bb');
    expect(trocas).toEqual([{ codigo: 'bb' }]);
    await expect(barra.getByTestId('confirmar-troca')).toHaveCount(0);
    await expect.poll(() => versoes).toBe(2);
    await expect(page.getByText('Estabelecimento B (teste)').last()).toBeVisible();
  });

  test('hospital: falha na troca de estabelecimento aparece em português e o ativo não muda', async ({
    page,
  }) => {
    const sessao = {
      usuario: { id: 'sintetico', nome: 'Usuário sintético' },
      rede: 'rede-teste',
      estabelecimentos: [
        { codigo: 'aa', nome: 'Estabelecimento A (teste)' },
        { codigo: 'bb', nome: 'Estabelecimento B (teste)' },
      ],
      estabelecimentoAtivo: 'aa',
      permissoes: ['acesso.inicio.ler', 'acesso.sobre.ler'],
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    };
    await page.route('**/api/sessao', (r) => r.fulfill({ json: sessao }));
    await page.route('**/api/sessao/estabelecimento', (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        json: { type: 'urn:sgh:problema:indisponivel', status: 503, correlacao: 'teste-0000-0001' },
      }),
    );
    await page.goto('/inicio');
    const barra = page.getByTestId('estabelecimento-ativo');
    await escolher(barra.getByRole('combobox'), 'bb');
    await barra.getByRole('combobox').press('Enter');
    await expect(page.getByTestId('erro-troca')).toContainText('Não foi possível trocar de estabelecimento');
    await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
  });

  test('hospital: depois da troca, a tela atual é conferida de novo contra as permissões do banco novo', async ({
    page,
  }) => {
    const sessao = (ativo: string, permissoes: string[]) => ({
      usuario: { id: 'sintetico', nome: 'Usuário sintético' },
      rede: 'rede-teste',
      estabelecimentos: [
        { codigo: 'aa', nome: 'Estabelecimento A (teste)' },
        { codigo: 'bb', nome: 'Estabelecimento B (teste)' },
      ],
      estabelecimentoAtivo: ativo,
      permissoes,
      sintetica: true,
      bloqueioInatividadeSegundos: 0,
    });
    await page.route('**/api/sessao', (r) =>
      r.fulfill({ json: sessao('aa', ['acesso.inicio.ler', 'acesso.sobre.ler']) }),
    );
    await page.route('**/api/sessao/estabelecimento', (r) =>
      r.fulfill({ json: sessao('bb', ['acesso.inicio.ler']) }),
    );
    await page.goto('/sobre');
    await expect(page.getByTestId('sobre-api')).toBeVisible();
    const barra = page.getByTestId('estabelecimento-ativo');
    await escolher(barra.getByRole('combobox'), 'bb');
    await barra.getByTestId('confirmar-troca').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible();
    await expect(page.getByTestId('sobre-api')).toHaveCount(0);
  });

  test('hospital: com um só estabelecimento o seletor some, mas o nome continua na barra', async ({
    page,
  }) => {
    await page.goto('/inicio');
    const barra = page.getByTestId('estabelecimento-ativo');
    await expect(barra).toBeVisible();
    const n = await page.request
      .get('/api/sessao')
      .then((r) => r.json() as Promise<{ estabelecimentos: unknown[] }>);
    if (n.estabelecimentos.length <= 1) await expect(barra.getByRole('combobox')).toHaveCount(0);
    await expect(barra.locator('strong, select')).toBeVisible();
  });

  test('teclado: pular para o conteúdo, Ctrl+K, setas e Enter, "?" só com atalhos disponíveis, Esc, foco visível', async ({
    page,
  }) => {
    await page.goto('/inicio');
    await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
    await page.keyboard.press('Tab');
    const pular = page.getByRole('link', { name: 'Ir para o conteúdo' });
    await expect(pular).toBeFocused();
    const contorno = await pular.evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(contorno).not.toBe('none');
    await page.keyboard.press('Enter');

    const inicio = Date.now();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: 'Buscar tela ou ação' })).toBeFocused();
    console.log(`[métrica] abertura da paleta: ${Date.now() - inicio} ms`);
    // M27: "preferencias" acha também o dicionário pessoal (Início › Preferências do usuário); a busca vai direto.
    await page.keyboard.type('aparencia');
    await expect(page.getByRole('option').first()).toContainText('Aparência e segurança da conta');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/preferencias$/);

    // Tema escuro só por teclado.
    await page.getByRole('radio', { name: 'Claro' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Escuro' })).toBeChecked();
    await expect(page.locator('html')).toHaveClass(/modo-escuro/);

    // "?" mostra só o que existe nesta tela (sem lista, sem rascunho, sem paciente).
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Shift+?');
    const painel = page.getByTestId('painel-atalhos');
    await expect(painel).toBeVisible();
    const ids = await painel
      .locator('[data-atalho]')
      .evaluateAll((l) => l.map((e) => e.getAttribute('data-atalho')));
    expect(ids).toEqual(expect.arrayContaining(['paleta', 'ajuda', 'fechar']));
    expect(ids).not.toContain('salvar-rascunho');
    expect(ids).not.toContain('nova-prescricao');
    expect(ids).not.toContain('busca-lista');
    await page.keyboard.press('Escape');
    await expect(painel).toBeHidden();
  });

  test('teclado: "/" vai para a busca da lista; F2 e Ctrl+Enter só onde a tela registra', async ({
    page,
  }) => {
    await page.goto('/demonstracao');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Demonstração');
    await page.locator('h1').click();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Buscar itens sintéticos' })).toBeFocused();
    await page.keyboard.press('F2');
    await expect(page.getByTestId('aviso-demo')).toContainText('Rascunho salvo');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('aviso-demo')).toContainText('Registro concluído');
  });

  test('tela larga: só duas rolagens (menu e conteúdo), nenhuma da página inteira', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto('/inicio');
    await abrirMenuInteiro(page);
    const pagina = await page.evaluate(() => ({
      altura: document.documentElement.scrollHeight,
      janela: window.innerHeight,
    }));
    expect(pagina.altura).toBeLessThanOrEqual(pagina.janela);
  });

  test('ampliação a 200%: sem rolagem horizontal; o menu abre por botão', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('/inicio');
    const largura = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(largura[0]).toBeLessThanOrEqual(largura[1]!);
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await expect(menu).toBeHidden();
    await page.getByRole('button', { name: 'Abrir o menu' }).click();
    await expect(menu).toBeVisible();
    // M27: o segundo item do Início são as mensagens internas.
    await menu.getByRole('link').nth(1).click();
    await expect(page).toHaveURL(/\/mensagens$/);
  });

  test('bloqueio: oculta todo dado de paciente e volta à mesma tela com o digitado', async ({ page }) => {
    await page.goto('/demonstracao');
    const campo = page.getByLabel('Observação (tente colar um emoji ou "≥")');
    await campo.fill('Texto digitado antes do bloqueio');
    await expect(page.getByTestId('cabecalho-paciente')).toBeVisible();
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('bloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    await expect(page.getByTestId('cabecalho-paciente')).toBeHidden();
    await expect(page.getByText('Paciente Fictício Um')).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('paleta')).toHaveCount(0);
    await page.getByTestId('desbloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toHaveCount(0);
    await expect(page).toHaveURL(/\/demonstracao$/);
    await expect(campo).toHaveValue('Texto digitado antes do bloqueio');
  });

  test('bloqueio: diálogo aberto (desenhado no body) também fica oculto e inerte', async ({ page }) => {
    await page.route('**/api/sessao', async (r) => {
      const real = await r.fetch();
      const corpo = (await real.json()) as Record<string, unknown>;
      await r.fulfill({ json: { ...corpo, bloqueioInatividadeSegundos: 2 } });
    });
    await page.goto('/demonstracao');
    await page.getByTestId('descartar-observacao').click();
    const dialogo = page.getByTestId('confirmacao');
    await expect(dialogo).toBeVisible();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible({ timeout: 10_000 });
    await expect(dialogo).toBeHidden();
    const isolado = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="confirmacao"]');
      return !!d?.closest('[inert]');
    });
    expect(isolado).toBe(true);
    await page.getByTestId('desbloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toHaveCount(0);
    await expect(dialogo).toBeVisible();
  });

  test('CP1252 e colisão na tela: emoji recusado, troca proposta, aviso de colisão mantendo o digitado', async ({
    page,
  }) => {
    await page.goto('/demonstracao');
    const campo = page.getByLabel('Observação (tente colar um emoji ou "≥")');
    await campo.fill('dor 😀');
    await expect(page.getByTestId('erro-cp1252')).toContainText('Emoji não pode ser gravado');
    await campo.fill('PA ≥ 140');
    await page.getByTestId('aplicar-troca').click();
    await expect(campo).toHaveValue('PA >= 140');
    await page.getByTestId('simular-colisao').click();
    const aviso = page.getByTestId('aviso-colisao');
    await expect(aviso).toContainText('Registro alterado no outro sistema desde a leitura');
    await expect(aviso).toContainText('PA >= 140');
    await expect(campo).toHaveValue('PA >= 140');
    await semViolacaoAxe(page, '/demonstracao com aviso de colisão');
  });

  test('Sobre: produto, versão da tela e do servidor', async ({ page, request }) => {
    const v = (await (await request.get('/api/versao')).json()) as { identificacao: string };
    await page.goto('/sobre');
    await expect(page.getByTestId('sobre-produto')).toHaveText(PRODUTO_NOME_E2E);
    await expect(page.getByTestId('sobre-api')).toHaveText(v.identificacao);
    await expect(page.getByTestId('sobre-web')).toContainText('+');
  });

  test('impresso sempre claro', async ({ page }) => {
    await usarPreferencias(page, { tema: 'escuro', densidade: 'compacta' });
    await page.goto('/inicio');
    await expect(page.locator('html')).toHaveClass(/modo-escuro/);
    const escuro = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ media: 'print' });
    const impresso = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(impresso).toBe('rgb(255, 255, 255)');
    expect(impresso).not.toBe(escuro);
  });
});
