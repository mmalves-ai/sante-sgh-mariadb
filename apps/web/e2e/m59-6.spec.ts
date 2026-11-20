// E2E @M59.6 (ficha do M59, etapa 6, F6 ADR da retrocompatibilidade; regras 1, 6, 11 e 12; seção 5 "estado
// esperado"), com axe: o gestor da migração abre a aba "Retrocompatibilidade" da migração gradual e confere, só em
// leitura, a decisão registrada (pendente) e a vigente (mantida, falha fechada), as quatro condições da extinção, os
// cinco passos do plano de evolução na ordem (o primeiro com a ficha do ADR 0033; todos bloqueados enquanto a
// retrocompatibilidade não for extinta), o estado esperado das três retiradas (verde: mantida sem contingência longa)
// e as medidas da estrutura do banco; os únicos botões são os do registro gravado pela tela (W0-09). Quem não tem a
// permissão não abre a tela. Sessão real sobre a fonte sintética de dev e as portas EM MEMÓRIA (catálogo sintético;
// nada vai à cópia); o registro versionado docs/coexistencia/retrocompatibilidade/pc.yaml é o do repositório.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PASSOS = [
  'imutabilidade-por-linha',
  'regras-dos-gatilhos',
  'booleanos',
  'data-e-hora',
  'chaves-por-id',
] as const;
const CONDICOES = [
  'fim-da-coexistencia-registrado',
  'outro-sistema-desligado',
  'dp6-decidida',
  'contingencia-encerrada',
] as const;
const RETIRADAS = [
  'acesso-retirarSenhaLegado',
  'acesso-retirarSenhaSecundaria',
  'integracao-cifrarSegredoLegado',
] as const;

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Retrocompatibilidade e plano de evolução do modelo @M59.6 @fase7', () => {
  test.setTimeout(180_000);

  test('aba Retrocompatibilidade: decisão vigente, condições, cinco passos e retiradas, só leitura; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-retrocompatibilidade').click();
    await expect(page).toHaveURL(/\/administracao\/coexistencia\/retrocompatibilidade$/);
    await expect(page.getByTestId('retro-cabecalho')).toBeVisible();

    // Decisão: o registro diz "pendente"; a vigente é "mantida" (regra 11, falha fechada).
    await expect(page.getByTestId('retro-decisao-registrada')).toHaveText('Pendente (vale como mantida)');
    await expect(page.getByTestId('retro-decisao-vigente')).toHaveText('Mantida');
    await expect(page.getByTestId('retro-contingencia-longa')).toHaveText('não');
    await expect(page.getByTestId('retro-extincao-sem-condicoes')).toHaveCount(0);
    await expect(page.getByTestId('retro-registro-invalido')).toHaveCount(0);
    await expect(page.getByTestId('retro-pode-decidir')).toHaveText(
      'Ainda faltam condições para decidir a extinção.',
    );

    // As quatro condições da extinção, cada uma com a sua linha.
    for (const c of CONDICOES) await expect(page.getByTestId(`condicao-${c}`)).toBeVisible();

    // Os cinco passos na ordem, com o tamanho medido no catálogo sintético e bloqueados até a extinção.
    const linhas = page.getByTestId('retro-passos').locator('tbody tr');
    await expect(linhas).toHaveCount(5);
    for (const [i, p] of PASSOS.entries()) {
      await expect(linhas.nth(i)).toHaveAttribute('data-testid', `passo-${p}`);
      await expect(page.getByTestId(`passo-situacao-${p}`)).toHaveText('Bloqueado');
      await expect(page.getByTestId(`passo-motivos-${p}`)).toContainText(
        'A retrocompatibilidade ainda não foi extinta pelo dono do projeto.',
      );
    }
    await expect(page.getByTestId('passo-tamanho-imutabilidade-por-linha')).toHaveText('1 tabela clínica');
    await expect(page.getByTestId('passo-tamanho-regras-dos-gatilhos')).toHaveText('2 gatilhos');
    await expect(page.getByTestId('passo-tamanho-booleanos')).toHaveText('2 colunas de uma letra');
    await expect(page.getByTestId('passo-tamanho-data-e-hora')).toHaveText('2 pares de data e hora');
    await expect(page.getByTestId('passo-tamanho-chaves-por-id')).toHaveText('1 chave em texto');
    // Regra 11: o primeiro passo tem ficha própria (no ADR 0033); os demais ainda não.
    await expect(page.getByTestId('passo-ficha-imutabilidade-por-linha')).toContainText(
      '0033-retrocompatibilidade-e-evolucao-do-modelo.md',
    );
    await expect(page.getByTestId('passo-ficha-chaves-por-id')).toHaveText('sem ficha');

    // Estado esperado das retiradas (ficha, seção 5): mantida sem contingência longa → verde.
    for (const r of RETIRADAS) await expect(page.getByTestId(`retirada-${r}`)).toContainText('Verde');
    // O estado no catálogo de operações acompanha o esperado (verde no pc): sem aviso de divergência.
    for (const r of RETIRADAS) await expect(page.getByTestId(`retirada-confere-${r}`)).toHaveText('sim');
    await expect(page.getByTestId('retiradas-divergencia')).toHaveCount(0);

    // As medidas do banco: nenhum gatilho do Sante em tabela do outro sistema.
    await expect(page.getByTestId('retro-inventario')).toBeVisible();
    await expect(page.getByTestId('retro-gatilhos-sgh-alerta')).toHaveCount(0);

    // O registro (W0-09, D-RETRO-REGISTRO-F6): o painel não grava nada; os únicos botões são os do registro, que
    // grava em diálogo com motivo e senha (modo 'tela', o padrão) e mostra o histórico de versões.
    await expect(page.getByTestId('registro-coex-retrocompatibilidade')).toBeVisible();
    await expect(page.locator('main form')).toHaveCount(0);
    const botoes = page.locator('main').getByRole('button');
    for (const b of await botoes.all())
      await expect(b).toHaveAttribute('data-testid', /^registro-coex-(gravar|voltar)$/);
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual|SGH_/i);
    await semViolacaoAxe(page, '/administracao/coexistencia/retrocompatibilidade');
    expect(externas).toEqual([]);
  });

  test('sem a permissão de ler a coexistência, a tela não abre', async ({ page }) => {
    await entrar(page, 'SINT.FATURISTA');
    await page.goto('/administracao/coexistencia/retrocompatibilidade');
    await expect(page).toHaveURL(/sem-permissao/);
  });
});
