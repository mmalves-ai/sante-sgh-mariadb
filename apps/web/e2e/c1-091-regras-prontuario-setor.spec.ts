// F3.3 (03-PEP L91): regras do prontuário por setor pelo caminho da tela. A configuração grava e lê só o banco próprio,
// e o E2E roda com a fonte sintética (sem núcleo, as rotas respondem 503). Por isso a rota da configuração é simulada
// pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o item do menu (PEP › Administração do PEP) leva às
// regras, o padrão do estabelecimento (assinatura do parâmetro) aparece no topo, a tolerância só abre com o retroativo
// ligado e fora de 1 a 720 h o botão fica travado com o motivo na hora, e a linha nova vai à API com o setor, o tipo,
// o retroativo, a tolerância e a assinatura escolhidos. O efeito na gravação do registro clínico (recusa do retroativo
// fora da regra e da assinatura ICP sem certificado, nada gravado) está no contrato de efeito
// apps/api/src/modulos/pep/registro-propria-gravacao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe } from './ajuda.js';
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

test.describe('regras do prontuário por setor (03-PEP L91) @F33 @C1-091', () => {
  test('pelo menu, vê o padrão do estabelecimento, valida a tolerância na hora e grava a regra do setor', async ({
    page,
  }) => {
    const itens: Record<string, unknown>[] = [];
    const gravados: Record<string, unknown>[] = [];
    await page.route('**/api/pep/prontuario-setor*', (r) => {
      if (r.request().method() === 'PUT') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        gravados.push(corpo);
        itens.push({ ...corpo, id: 9101, setorNome: 'Clínica médica sintética', versao: 1 });
        return json(r, { id: 9101 });
      }
      return json(r, {
        itens,
        setores: [
          { id: 31, nome: 'Clínica médica sintética' },
          { id: 32, nome: 'UTI sintética' },
        ],
        padrao: {
          permiteRetroativo: true,
          toleranciaRetroativoHoras: null,
          assinaturaExigida: 'digital_icp',
          exigeEvolucaoMedica: false,
          exigeEvolucaoEnfermagem: false,
        },
        vigente: { configuracao: null, origem: 'padrao' },
      });
    });

    await entrar(page, 'SINT.ADMIN');
    await (await itemDoMenu(page, 'Regras do prontuário por setor')).click();
    await expect(page).toHaveURL(/\/pep\/prontuario-setor/);
    const tela = page.getByTestId('config-setor-prontuario');
    // O padrão do estabelecimento (parâmetro da assinatura exigida) fica à vista.
    await expect(page.getByTestId('cfg-padrao')).toContainText('Digital (certificado)');

    const nova = page.getByTestId('cfg-nova');
    await escolher(nova.getByTestId('cfg-setor'), '31');
    await escolher(nova.getByTestId('cfg-tipo'), 'internacao');
    // A tolerância só abre com o retroativo ligado.
    await expect(nova.getByTestId('cfg-tolerancia')).toBeDisabled();
    await nova.getByTestId('cfg-retroativo').check();
    await expect(nova.getByTestId('cfg-tolerancia')).toBeEnabled();
    // Fora de 1 a 720 h: o botão trava e o motivo aparece na hora, sem ida à API.
    await nova.getByTestId('cfg-tolerancia').fill('800');
    await expect(nova.getByTestId('cfg-gravar')).toBeDisabled();
    await expect(nova).toContainText('A tolerância vai de 1 a 720 horas.');
    await nova.getByTestId('cfg-tolerancia').fill('6');
    await expect(nova.getByTestId('cfg-gravar')).toBeEnabled();
    await escolher(nova.getByTestId('cfg-assinatura'), 'digital_icp');
    await nova.getByTestId('cfg-gravar').click();

    await expect(tela.getByTestId('cfg-linha-9101')).toContainText('Clínica médica sintética');
    await expect(tela.getByTestId('cfg-linha-9101')).toContainText('Internação');
    expect(gravados).toHaveLength(1);
    expect(gravados[0]).toMatchObject({
      setor: 31,
      tipoAtendimento: 'internacao',
      permiteRetroativo: true,
      toleranciaRetroativoHoras: 6,
      assinaturaExigida: 'digital_icp',
      ativo: true,
      versao: null,
    });
    await semViolacaoAxe(page, '/pep/prontuario-setor');
  });
});
