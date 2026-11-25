// E2E @F3.9-05 (F3.9, 01-ADM linha 79): impressora por estação e reimpressão controlada pelo caminho das telas.
// Em /administracao/impressao/estacoes a tela abre na estação reconhecida, mostra por finalidade a impressora que vai
// sair e de onde ela vem, e grava o vínculo da estação e o padrão do estabelecimento ou da unidade (o botão só libera
// com tudo escolhido). Nos impressos do atendimento a pulseira nunca impressa sai direto; já impressa, o botão vira
// "Reimprimir" e só libera com o motivo do catálogo e, quando o motivo pede, o complemento (conferido na hora).
// As rotas da impressão por estação exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as
// respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (via 1, reimpressão com motivo,
// estação e impressora, recusas) está em
// apps/api/src/modulos/administracao/impressao-identificacao-propria.int.spec.ts.
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

const MOTIVOS = [
  { id: 31, codigo: 'ILEGIVEL', descricao: 'IMPRESSAO ILEGIVEL SINTETICA', exigeComplemento: false },
  { id: 32, codigo: 'OUTRO', descricao: 'OUTRO MOTIVO SINTETICO', exigeComplemento: true },
];

test.describe('Impressora por estação e reimpressão controlada @F3.9-05 @fase3', () => {
  test.setTimeout(180_000);

  test('cadastro: a estação vê a impressora de cada finalidade; vínculo e padrão gravam só com tudo escolhido; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const vinculos: Record<string, unknown>[] = [];
    const padroes: Record<string, unknown>[] = [
      { id: 51, finalidade: 11, unidade: null, impressora: 22, copias: 1, ativo: true },
    ];
    await page.route('**/api/administracao/impressao/**', async (rota) => {
      const caminho = new URL(rota.request().url()).pathname;
      if (rota.request().method() === 'GET')
        return json(rota, {
          eu: 7,
          estacaoAtual: 1,
          estacoes: [
            { id: 1, codigo: 'REC1', nome: 'RECEPCAO SINTETICA 1', tipo: 'guiche', unidade: 41 },
            { id: 2, codigo: 'REC2', nome: 'RECEPCAO SINTETICA 2', tipo: 'guiche', unidade: null },
          ],
          finalidades: [
            { id: 11, codigo: 'PULSEIRA', descricao: 'PULSEIRA SINTETICA', midia: 'pulseira' },
            { id: 12, codigo: 'ETIQUETA_PACIENTE', descricao: 'ETIQUETA SINTETICA', midia: 'etiqueta' },
          ],
          impressoras: [
            { id: 21, codigo: 'I1', nome: 'IMPRESSORA DO GUICHE SINTETICA', tipo: 'pulseira', ativa: true },
            { id: 22, codigo: 'I2', nome: 'IMPRESSORA GERAL SINTETICA', tipo: 'pulseira', ativa: true },
            { id: 23, codigo: 'I3', nome: 'IMPRESSORA PARADA SINTETICA', tipo: 'pulseira', ativa: false },
          ],
          motivos: MOTIVOS,
          unidades: [{ id: 41, nome: 'UNIDADE SINTETICA' }],
          padroes,
          vinculos,
        });
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho.endsWith('/estacoes/vinculos')) {
        vinculos.push({ id: 61, ...corpo, usuario: corpo['usuario'] ?? null, padrao: true });
        return json(rota, { id: 61 });
      }
      padroes.push({ id: 52, ...corpo, unidade: corpo['unidade'] ?? null, ativo: true });
      return json(rota, { id: 52 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/impressao/estacoes');
    await expect(page.getByTestId('tela-impressao-estacoes')).toBeVisible();
    // A tela abre na estação reconhecida; a pulseira sai pelo padrão do estabelecimento; a etiqueta não tem impressora.
    await expect(page.getByTestId('impressao-finalidade-11')).toContainText('IMPRESSORA GERAL SINTETICA');
    await expect(page.getByTestId('impressao-finalidade-11')).toContainText('Padrão do estabelecimento');
    await expect(page.getByTestId('impressao-finalidade-12')).toContainText('Nenhuma configurada');
    await semViolacaoAxe(page, '/administracao/impressao/estacoes');

    // Vínculo da estação: o botão só libera com a finalidade e a impressora; a impressora inativa não é oferecida.
    const vincular = page.locator('section[aria-labelledby="impressao-vincular"]');
    await expect(page.getByTestId('vinculo-gravar')).toBeDisabled();
    await escolher(vincular.getByLabel('Finalidade', { exact: true }), '11');
    await expect(page.getByTestId('vinculo-gravar')).toBeDisabled();
    await escolher(vincular.getByLabel('Impressora', { exact: true }), '21');
    await page.getByTestId('vinculo-gravar').click();
    await expect(page.getByTestId('impressao-gravado')).toBeVisible();
    expect(pedidos.at(-1)).toEqual({
      caminho: '/api/administracao/impressao/estacoes/vinculos',
      corpo: { estacao: 1, finalidade: 11, impressora: 21 },
    });
    await expect(page.getByTestId('impressao-finalidade-11')).toContainText('IMPRESSORA DO GUICHE SINTETICA');
    await expect(page.getByTestId('impressao-finalidade-11')).toContainText('Vínculo da estação');

    // Padrão da unidade para a etiqueta: a estação (que é da unidade) passa a sair por ele.
    const padrao = page.locator('section[aria-labelledby="impressao-padrao"]');
    await expect(page.getByTestId('padrao-gravar')).toBeDisabled();
    await escolher(padrao.getByLabel('Finalidade', { exact: true }), '12');
    await escolher(padrao.getByLabel('Unidade', { exact: true }), '41');
    await escolher(padrao.getByLabel('Impressora', { exact: true }), '22');
    await page.getByTestId('padrao-gravar').click();
    await expect(page.getByTestId('impressao-gravado')).toBeVisible();
    expect(pedidos.at(-1)).toEqual({
      caminho: '/api/administracao/impressao/padroes',
      corpo: { finalidade: 12, impressora: 22, unidade: 41, copias: 1 },
    });
    await expect(page.getByTestId('impressao-finalidade-12')).toContainText('Padrão da unidade');
  });

  test('impressos do atendimento: a 1ª pulseira sai direto; a reimpressão só libera com motivo e complemento', async ({
    page,
  }) => {
    const REG = 900001;
    const emissoes: Record<string, unknown>[] = [];
    let vias = 0;
    const reimpressoes: Record<string, unknown>[] = [];
    await page.route(`**/api/documento/identificacoes/atendimento/${REG}`, (rota) =>
      json(rota, {
        atendimento: REG,
        estacao: 1,
        identificacoes: [
          {
            tipo: 'pulseira',
            vias,
            ultimaEm: vias ? '2026-03-15T09:30:00.000Z' : null,
            finalidade: 11,
            impressora: { id: 21, nome: 'IMPRESSORA DO GUICHE SINTETICA', nivel: 'estacao' },
          },
          { tipo: 'etiqueta', vias: 0, ultimaEm: null, finalidade: 12, impressora: null },
        ],
        motivos: MOTIVOS,
        reimpressoes,
      }),
    );
    await page.route(`**/api/atendimento/${REG}/impressos`, async (rota) => {
      if (rota.request().method() === 'GET')
        return json(rota, {
          reg: REG,
          impressos: [
            { impresso: 'pulseira', rotulo: 'Pulseira', formatos: ['zpl'], pode: true, motivo: null },
            { impresso: 'etiqueta', rotulo: 'Etiqueta', formatos: ['zpl'], pode: true, motivo: null },
          ],
          fichas: [],
          configuracaoLida: true,
        });
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      emissoes.push(corpo);
      vias += 1;
      if (vias > 1)
        reimpressoes.unshift({
          id: 70 + vias,
          tipo: 'pulseira',
          via: vias,
          em: '2026-03-15T10:00:00.000Z',
          motivo: 'OUTRO MOTIVO SINTETICO',
          complemento: String(corpo['complemento'] ?? ''),
          usuario: 'SINT.ATENDIMENTO',
          impressora: 'IMPRESSORA DO GUICHE SINTETICA',
          estacao: 'RECEPCAO SINTETICA 1',
        });
      return json(
        rota,
        {
          impresso: 'pulseira',
          formato: 'zpl',
          conteudo: '^XA^XZ',
          nomeArquivo: `pulseira-${REG}.zpl`,
          fila: { id: `f-${vias}`, novo: true },
          identificacao: { via: vias, reimpressao: vias > 1, impressora: 'IMPRESSORA DO GUICHE SINTETICA' },
        },
        201,
      );
    });

    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto(`/recepcao/atendimento/${REG}/impressos`);
    await expect(page.getByTestId('tela-impressos')).toBeVisible();
    // Nunca impressa: mostra por onde sai e emite sem pedir nada.
    await expect(page.getByTestId('identificacao-pulseira-vias')).toContainText('Ainda não impressa');
    await expect(page.getByTestId('identificacao-pulseira-vias')).toContainText(
      'IMPRESSORA DO GUICHE SINTETICA',
    );
    await expect(page.getByTestId('emitir-pulseira')).toHaveText('Emitir');
    await page.getByTestId('emitir-pulseira').click();
    await expect(page.getByTestId('impresso-emitido')).toContainText('impressora da estação');
    expect(emissoes.at(-1)).toEqual({ impresso: 'pulseira', formato: 'zpl', copias: 1 });

    // Já impressa: o botão vira "Reimprimir" e fica travado até o motivo (e o complemento que o motivo pede).
    await expect(page.getByTestId('identificacao-pulseira-vias')).toContainText('Já impressa: 1 via');
    await expect(page.getByTestId('emitir-pulseira')).toHaveText('Reimprimir');
    await expect(page.getByTestId('emitir-pulseira')).toBeDisabled();
    await expect(page.getByTestId('identificacao-pulseira-falta')).toContainText('escolha o motivo');
    const pulseira = page.getByTestId('identificacao-pulseira');
    await escolher(pulseira.getByLabel('Motivo da reimpressão', { exact: true }), '32');
    await expect(page.getByTestId('identificacao-pulseira-falta')).toContainText('pede o complemento');
    await expect(page.getByTestId('emitir-pulseira')).toBeDisabled();
    await pulseira.getByLabel('Complemento do motivo').fill('pulseira rasgada');
    await expect(page.getByTestId('emitir-pulseira')).toBeEnabled();
    await semViolacaoAxe(page, 'impressos do atendimento com a reimpressão');
    await page.getByTestId('emitir-pulseira').click();
    await expect(page.getByTestId('identificacao-pulseira-vias')).toContainText('Já impressa: 2 via');
    expect(emissoes.at(-1)).toEqual({
      impresso: 'pulseira',
      formato: 'zpl',
      copias: 1,
      motivo: 32,
      complemento: 'pulseira rasgada',
    });
    await expect(page.getByTestId('identificacao-pulseira-historico')).toContainText('Reimpressões (1)');
    // O motivo é limpo depois da emissão: a próxima via pede o motivo de novo.
    await expect(page.getByTestId('emitir-pulseira')).toBeDisabled();
    // A etiqueta é outra identificação: segue como 1ª impressão.
    await expect(page.getByTestId('emitir-etiqueta')).toHaveText('Emitir');
    await expect(page.getByTestId('emitir-etiqueta')).toBeEnabled();
  });
});
