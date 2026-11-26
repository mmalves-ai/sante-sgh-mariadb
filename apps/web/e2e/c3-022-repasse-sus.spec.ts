// C3-022 (06-SUS linha 62): repasse da produção SUS aos profissionais, pelo caminho da tela. As rotas /api/sus/repasse
// exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas destas rotas são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a rota abre a tela, a conferência do domínio
// aparece na hora (base por pontos sem o valor do ponto e procedimento junto com grupo travam o botão sem ir ao
// servidor), a regra vai com a vigência por competência (primeiro dia), o encerramento na própria linha leva a versão
// lida e o último dia da competência, o rateio do SADT sem alvo é recusado na hora, e a apuração vai com a versão lida
// e mostra totais, pendências e as linhas. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/sus/repasse-sus-propria.int.spec.ts).
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

test.describe('C3-022 repasse da produção SUS @C3-022', () => {
  test('regra conferida na hora, incluída e encerrada; rateio do SADT; apuração com totais e linhas', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const painel = {
      regras: [] as Record<string, unknown>[],
      rateios: [] as Record<string, unknown>[],
      apuracoes: [{ id: 501, numero: 'AP-SINT-1', competencia: '2026-09-01', versao: 3 }],
    };
    let apurada = false;
    await page.route('**/api/sus/repasse**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/apuracoes/501/linhas'))
          return json(
            r,
            apurada
              ? [
                  {
                    sequencia: 6,
                    instrumento: 'aih',
                    executante: 701,
                    executanteNome: 'Profissional sintético A',
                    papel: 'executante',
                    regraCodigo: 'SINT.AIH',
                    base: 200,
                    percentual: 80,
                    glosa: 40,
                    repasse: 128,
                  },
                ]
              : [],
          );
        return json(r, painel);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/regras')) {
        painel.regras.push({
          id: 901,
          codigo: corpo['codigo'],
          descricao: corpo['descricao'],
          modalidade: corpo['modalidade'],
          procedimentoCodigo: corpo['procedimento'],
          grupoCodigo: corpo['grupo'],
          ocupacaoCodigo: corpo['ocupacao'],
          papel: corpo['papel'],
          base: corpo['base'],
          percentualPago: corpo['percentualPago'],
          percentualDesconto: corpo['percentualDesconto'],
          valorFixo: corpo['valorFixo'],
          valorDesconto: corpo['valorDesconto'],
          valorPonto: corpo['valorPonto'],
          prioridade: corpo['prioridade'],
          inicio: corpo['inicio'],
          fim: null,
          ativo: true,
          versao: 1,
        });
        return json(r, { id: 901 }, 201);
      }
      if (url.pathname.endsWith('/rateios')) {
        painel.rateios.push({
          id: 951,
          procedimentoCodigo: corpo['procedimento'],
          grupoCodigo: corpo['grupo'],
          profissional: null,
          profissionalNome: null,
          consideraSadt: true,
          usaPeso: false,
          pesoPercentual: null,
          tetoPercentual: corpo['tetoPercentual'],
          inicio: corpo['inicio'],
          fim: null,
          ativo: true,
          versao: 1,
        });
        return json(r, { id: 951 }, 201);
      }
      if (url.pathname.endsWith('/regras/901/encerrar')) {
        painel.regras[0] = { ...painel.regras[0], fim: corpo['fim'], versao: 2 };
        return json(r, { id: 901 });
      }
      if (url.pathname.endsWith('/apuracoes/501/apurar')) {
        apurada = true;
        painel.apuracoes[0] = { ...painel.apuracoes[0]!, versao: 4 };
        return json(r, {
          apuracao: 501,
          competencia: '2026-09-01',
          linhas: 1,
          excluidas: 5,
          totalRepasse: 128,
          totalGlosa: 40,
          pendencias: [{ instrumento: 'bpa', origem: 77, motivo: 'sem-regra' }],
          versao: 4,
        });
      }
      return json(r, { tipo: 'nao-encontrado' }, 404);
    });

    await // O repasse é do analista do repasse (segregação do M33): o SINT.ADMIN não tem as permissões repasse.* e a rota
    // (repasse.apuracao.ler) não abria a tela.
    await entrar(page, 'SINT.REP.ANALISTA');
    await page.goto('/faturamento/sus/repasse');
    await expect(page.getByTestId('tela-repasse-sus')).toBeVisible();

    // Regra: base por pontos sem o valor do ponto e procedimento junto com grupo travam o botão.
    await page.getByTestId('repasse-sus-regra-codigo').fill('SINT.AIH');
    await page.getByTestId('repasse-sus-regra-descricao').fill('Regra sintética da internação');
    await escolher(page.getByTestId('repasse-sus-regra-modalidade'), 'internacao');
    await escolher(page.getByTestId('repasse-sus-regra-base'), 'pontos');
    await page.getByTestId('repasse-sus-regra-procedimento').fill('0000000001');
    await page.getByTestId('repasse-sus-regra-grupo').fill('99');
    await expect(page.getByTestId('repasse-sus-regra-problemas')).toBeVisible();
    await expect(page.getByTestId('repasse-sus-regra-incluir')).toBeDisabled();
    expect(pedidos).toHaveLength(0);

    await page.getByTestId('repasse-sus-regra-grupo').fill('');
    await escolher(page.getByTestId('repasse-sus-regra-base'), 'servico_profissional');
    await page.getByTestId('repasse-sus-regra-percentual').fill('80');
    await page.getByTestId('repasse-sus-regra-inicio').fill('2026-09');
    await expect(page.getByTestId('repasse-sus-regra-problemas')).toHaveCount(0);
    await page.getByTestId('repasse-sus-regra-incluir').click();
    await expect(page.getByTestId('repasse-sus-regra-901')).toBeVisible();
    expect(pedidos[0]?.corpo).toMatchObject({
      codigo: 'SINT.AIH',
      modalidade: 'internacao',
      procedimento: '0000000001',
      grupo: null,
      base: 'servico_profissional',
      percentualPago: 80,
      inicio: '2026-09-01',
      fim: null,
    });

    // Encerramento na própria linha, com a versão lida e o último dia da competência.
    await page.getByTestId('repasse-sus-regra-encerrar').click();
    await page.getByTestId('repasse-sus-encerrar-mes').fill('2026-12');
    await page.getByTestId('repasse-sus-encerrar-confirmar').click();
    await expect(page.getByTestId('repasse-sus-aviso')).toBeVisible();
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/sus/repasse/regras/901/encerrar',
      corpo: { versao: 1, fim: '2026-12-31' },
    });

    // Rateio do SADT: sem procedimento nem grupo é recusado na hora.
    await page.getByTestId('repasse-sus-aba-rateios').click();
    await expect(page.getByTestId('repasse-sus-rateio-problemas')).toBeVisible();
    await expect(page.getByTestId('repasse-sus-rateio-incluir')).toBeDisabled();
    await page.getByTestId('repasse-sus-rateio-grupo').fill('99');
    await page.getByTestId('repasse-sus-rateio-teto').fill('50');
    await page.getByTestId('repasse-sus-rateio-inicio').fill('2026-09');
    await page.getByTestId('repasse-sus-rateio-incluir').click();
    await expect(page.getByTestId('repasse-sus-rateio-951')).toBeVisible();
    expect(pedidos[2]?.corpo).toMatchObject({ grupo: '99', procedimento: null, tetoPercentual: 50, usaPeso: false });

    // Apuração: com a versão lida; totais, pendências e linhas.
    await page.getByTestId('repasse-sus-aba-apuracao').click();
    await escolher(page.getByTestId('repasse-sus-apuracao-escolha'), '501');
    await expect(page.getByTestId('repasse-sus-linhas-vazias')).toBeVisible();
    await page.getByTestId('repasse-sus-apurar').click();
    await expect(page.getByTestId('repasse-sus-resumo')).toContainText('1 linhas');
    await expect(page.getByTestId('repasse-sus-pendencias')).toContainText('BPA 77');
    await expect(page.getByTestId('repasse-sus-linha-6')).toBeVisible();
    expect(pedidos[3]).toMatchObject({ caminho: '/api/sus/repasse/apuracoes/501/apurar', corpo: { versao: 3 } });

    await semViolacaoAxe(page, 'repasse da produção SUS');
  });
});
