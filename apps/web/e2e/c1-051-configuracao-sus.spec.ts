// E2E @C1-051 (06-SUS linha 53): a configuração do faturamento SUS. A supervisão do SUS abre Faturamento > Faturamento SUS
// > Configuração pelo menu (supervisão do faturamento SUS), dá a permissão por usuário e setor (combos, validação na hora: o fim antes do início trava o
// botão), vê a linha vigente e a encerra pela vigência na própria linha (nada apagado: a linha continua na lista). Nos
// parâmetros por instrumento, o CNPJ inválido do BPA mostra o erro ao lado do campo antes de gravar; corrigido, grava e
// a origem passa a "Gravado por". Quem só lê o faturamento SUS vê a tela sem os formulários e a API recusa a gravação.
// axe sem violação séria. Sessão real sobre a fonte sintética de dev e a porta em MEMÓRIA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@C1-051 Faturamento SUS: permissão por setor e parâmetros por instrumento', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a supervisão do SUS dá e encerra a permissão por setor e grava os parâmetros do BPA', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // A supervisão do faturamento SUS (o administrador não tem permissão de faturamento: segregação).
    await entrar(page, 'SINT.SUS.CONFIGURACAO');
    await (await itemDoMenu(page, 'Configuração do faturamento SUS')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/configuracao/);
    const tela = page.getByTestId('tela-configuracao-sus');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    // Permissão por usuário e setor: a validação aparece na hora e trava o botão.
    const incluir = page.getByTestId('permissao-sus-incluir');
    await expect(page.getByTestId('permissao-sus-problemas')).toBeVisible();
    await expect(incluir).toBeDisabled();
    await escolher(page.getByTestId('permissao-sus-usuario'), { indice: 1 });
    await escolher(page.getByTestId('permissao-sus-setor'), { rotulo: 'Ambulatório' });
    await escolher(page.getByTestId('permissao-sus-tipo'), { rotulo: 'Digitação' });
    await page.getByTestId('permissao-sus-inicio').fill('2026-01-10');
    await page.getByTestId('permissao-sus-fim').fill('2026-01-01');
    await expect(page.getByTestId('permissao-sus-problemas')).toContainText('antes do início');
    await expect(incluir).toBeDisabled();
    await page.getByTestId('permissao-sus-fim').fill('');
    await expect(incluir).toBeEnabled();
    const criada = page.waitForResponse(
      (r) => r.url().includes('/api/sus/configuracao/permissoes') && r.request().method() === 'POST',
    );
    await incluir.click();
    const resposta = await criada;
    expect(resposta.status()).toBe(201);
    const { id } = (await resposta.json()) as { id: number };
    const linha = page.getByTestId(`permissao-sus-linha-${id}`);
    await expect(linha).toContainText('Ambulatório');
    await expect(page.getByTestId(`permissao-sus-situacao-${id}`)).toHaveText('Vigente');

    // Encerrar pela vigência, na própria linha: a linha fica (histórico), fora da vigência.
    await page.getByTestId(`permissao-sus-encerrar-${id}`).click();
    await page.getByTestId('permissao-sus-encerrar-fim').fill('2026-01-15');
    await page.getByTestId('permissao-sus-encerrar-confirmar').click();
    await expect(page.getByTestId(`permissao-sus-situacao-${id}`)).toHaveText('Fora da vigência');
    await expect(linha).toContainText('2026-01-15');

    // Parâmetros do BPA: o CNPJ inválido mostra o erro ao lado do campo antes de gravar.
    const cnpj = page.getByTestId('parametros-sus-bpa-cnpjPrestador');
    await cnpj.fill('11222333000100');
    await expect(page.getByTestId('parametros-sus-bpa-cnpjPrestador-erro')).toContainText('CNPJ inválido');
    await expect(page.getByTestId('parametros-sus-bpa-gravar')).toBeDisabled();
    await cnpj.fill('11.222.333/0001-81');
    await expect(page.getByTestId('parametros-sus-bpa-cnpjPrestador-erro')).toHaveCount(0);
    await page.getByTestId('parametros-sus-bpa-siglaOrigem').fill('hsint');
    await escolher(page.getByTestId('parametros-sus-bpa-indicadorDestino'), { rotulo: 'Municipal' });
    await page.getByTestId('parametros-sus-bpa-gravar').click();
    await expect(page.getByTestId('parametros-sus-bpa-gravado')).toBeVisible();
    await expect(page.getByTestId('parametros-sus-bpa-origem')).toContainText('Gravado por');
    // O servidor guardou normalizado (só dígitos no CNPJ, sigla em maiúsculas).
    const lida = (await (await page.request.get('/api/sus/configuracao')).json()) as {
      parametros: {
        instrumento: string;
        campos: { cnpjPrestador: string | null; siglaOrigem: string | null };
      }[];
    };
    expect(lida.parametros.find((p) => p.instrumento === 'bpa')?.campos).toMatchObject({
      cnpjPrestador: '11222333000181',
      siglaOrigem: 'HSINT',
    });

    await semViolacaoAxe(page, 'Configuração do faturamento SUS');
    expect(externas).toEqual([]);
  });

  test('quem só lê o faturamento SUS vê a tela sem formulários e a API recusa a gravação', async ({
    page,
  }) => {
    await entrar(page, 'SINT.FATURISTA.SUS');
    await page.goto('/faturamento/sus/configuracao');
    await expect(page.getByTestId('tela-configuracao-sus')).toBeVisible();
    await expect(page.getByTestId('configuracao-sus-so-consulta')).toBeVisible();
    await expect(page.getByTestId('permissao-sus-form')).toHaveCount(0);
    await expect(page.getByTestId('parametros-sus-bpa-gravar')).toHaveCount(0);
    const r = await page.request.put('/api/sus/configuracao/parametros/apac', {
      data: {
        campos: {
          fontePadrao: null,
          orgaoOrigem: null,
          siglaOrigem: null,
          cnpjPrestador: null,
          orgaoDestino: null,
          indicadorDestino: null,
          uf: '33',
          utiPorAcomodacao: null,
          diretorClinicoCns: null,
        },
        versao: null,
      },
    });
    expect(r.status()).toBe(403);
  });
});
