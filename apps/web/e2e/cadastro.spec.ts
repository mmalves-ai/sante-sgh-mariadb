// E2E @M11 (ficha, seção 10): busca com erro de grafia, por telefone e por nome da mãe; ficha mascarada por
// perfil (a recepção não vê raça/cor nem religião; o SAME vê); cadastro com CPF repetido mostrando os
// candidatos; alteração com aviso de colisão (duas pessoas na mesma ficha); fila de duplicidades com "É outra
// pessoa" e o alerta de homônimo na busca; ficha de profissional com dois conselhos; axe sem violação séria.
// Sessão real sobre a fonte sintética de dev (SINT.RECEPCAO, SINT.SAME, SINT.ADMIN) e a porta do cadastro em
// MEMÓRIA (pacientes sintéticos marcados "SINTETICO"; nada vai à cópia); nenhum dado real.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaSessao(browser: Browser, login: string): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrar(page, login);
  return page;
}

async function buscar(page: Page, termo: string, tipo?: string): Promise<void> {
  await page.getByTestId('termo-paciente').fill(termo);
  if (tipo) await escolher(page.getByLabel('Buscar por'), tipo);
  await page.getByTestId('botao-buscar').click();
}

test.describe('Pacientes e profissionais @M11', () => {
  test('busca: grafia errada vira sugestão; telefone; nome da mãe; lista mascarada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes');
    await expect(page.getByRole('heading', { level: 1, name: 'Cadastro e busca de paciente' })).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes');
    // Grafia errada: nenhum nome igual; a pronúncia sugere o cadastro certo.
    await buscar(page, 'CINTIA GABRIELA VIANA');
    await expect(page.getByTestId('sugestoes-foneticas')).toContainText('CINTHYA GABRIELLA VIANNA');
    await semViolacaoAxe(page, 'sugestões fonéticas');
    await page
      .getByTestId('sugestoes-foneticas')
      .getByRole('button', { name: /Usar a sugestão/ })
      .first()
      .click();
    await expect(page.getByTestId('resultado-busca')).toContainText('CINTHYA GABRIELLA VIANNA');
    // Lista mascarada: CPF e telefone nunca inteiros.
    const linha = page.getByTestId('paciente-1003');
    await expect(linha).not.toContainText('90000000256');
    await expect(linha).not.toContainText('987650003');
    // Telefone pelos 8 últimos dígitos.
    await buscar(page, '8765-0003', 'telefone');
    await expect(page.getByTestId('paciente-1003')).toBeVisible();
    // Nome da mãe.
    await buscar(page, 'ROSA ROCHA', 'mae');
    await expect(page.getByTestId('paciente-1007')).toBeVisible();
    await semViolacaoAxe(page, 'resultado da busca');
    expect(externas).toEqual([]);
  });

  test('ficha mascarada por perfil: recepção sem raça/cor nem religião; SAME vê; axe', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/1001');
    await expect(page.getByTestId('ficha-nome')).toContainText('JOSÉ DA SILVA SINTETICO');
    await expect(page.getByTestId('sensiveis-restritos')).toBeVisible();
    await expect(page.getByTestId('ficha-raca-cor')).toHaveCount(0);
    // O texto clínico antigo aparece (só leitura), sem campo de edição.
    await expect(page.getByText('DIPIRONA (TEXTO DO LEGADO)')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes/1001 (recepção)');
    const same = await novaSessao(browser, 'SINT.SAME');
    await same.goto('/cadastros/pacientes/1001');
    await expect(same.getByTestId('ficha-raca-cor')).toBeVisible();
    await expect(same.getByTestId('sensiveis-restritos')).toHaveCount(0);
    await semViolacaoAxe(same, '/cadastros/pacientes/1001 (SAME)');
    await same.context().close();
  });

  test('cadastro com CPF repetido mostra os candidatos (nome mascarado e nascimento); axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/pacientes/novo');
    await expect(page.getByTestId('form-paciente')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes/novo');
    // CEP completa o endereço ao sair do campo; inexistente avisa antes de salvar.
    await page.getByTestId('campo-cep').fill('99999-999');
    await page.getByTestId('campo-cep').blur();
    await expect(page.getByTestId('cep-inexistente')).toBeVisible();
    await page.getByTestId('campo-cep').fill('30130-000');
    await page.getByTestId('campo-cep').blur();
    await expect(page.getByTestId('cep-cidade')).toContainText('BELO HORIZONTE / MG');
    await expect(page.getByLabel('Logradouro', { exact: true })).toHaveValue('AVENIDA SINTETICA');
    await page.getByTestId('campo-cpf').fill('123.456.789-09');
    await page.getByTestId('botao-procurar-cpf').click();
    const candidatos = page.getByTestId('candidatos-cpf');
    await expect(candidatos.getByTestId('candidato-1004')).toBeVisible();
    await expect(candidatos.getByTestId('candidato-1005')).toBeVisible();
    // Nome mascarado: nunca o nome inteiro na lista de candidatos.
    await expect(candidatos).not.toContainText('ANTÔNIO CONCEIÇÃO SINTETICO');
    await semViolacaoAxe(page, 'candidatos do CPF');
    await candidatos.getByTestId('candidato-1004').click();
    await expect(page).toHaveURL(/\/cadastros\/pacientes\/1004$/);
  });

  test('alteração com aviso de colisão: duas pessoas na mesma ficha; rever mantém o digitado', async ({
    page,
    browser,
  }) => {
    await entrar(page, 'SINT.RECEPCAO');
    const same = await novaSessao(browser, 'SINT.SAME');
    for (const p of [page, same]) {
      await p.goto('/cadastros/pacientes/1007');
      await p.getByTestId('botao-editar').click();
      await expect(p.getByTestId('form-paciente')).toBeVisible();
    }
    // A recepção grava primeiro.
    await page.getByTestId('campo-telefone').fill('(21) 3333-0007');
    await page.getByTestId('botao-salvar-paciente').click();
    await expect(page.getByTestId('mensagem-ficha')).toContainText('Cadastro salvo.');
    // O SAME, com a ficha lida antes, recebe o aviso de colisão; nada foi sobrescrito.
    await same.getByLabel('Bairro', { exact: true }).fill('BAIRRO SINTETICO E2E');
    await same.getByTestId('botao-salvar-paciente').click();
    await expect(same.getByTestId('aviso-colisao')).toBeVisible();
    await semViolacaoAxe(same, 'aviso de colisão');
    await same.getByTestId('aviso-colisao').getByTestId('rever').click();
    await expect(same.getByTestId('aviso-colisao')).toHaveCount(0);
    await expect(same.getByLabel('Bairro', { exact: true })).toHaveValue('BAIRRO SINTETICO E2E');
    await same.getByTestId('botao-salvar-paciente').click();
    await expect(same.getByTestId('mensagem-ficha')).toContainText('Cadastro salvo.');
    await same.context().close();
  });

  test('fila de duplicidades: atualizar, comparar lado a lado, "É outra pessoa" e homônimo na busca; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/duplicidades');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Unificação de prontuários: fila de duplicidades' }),
    ).toBeVisible();
    // A unificação segue no sistema atual: o motivo aparece.
    await expect(page.getByTestId('unificacao-motivo')).toBeVisible();
    await page.getByTestId('botao-atualizar-fila').click();
    await expect(page.getByTestId('mensagem-fila')).toBeVisible();
    const tabela = page.getByTestId('tabela-duplicidades');
    await expect(tabela).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes/duplicidades');
    const par = tabela.locator('tbody tr', { hasText: '501 · JOSÉ DA SILVA SINTETICO' });
    await expect(par).toContainText('502 · JOSÉ DA SILVA SINTETICO');
    await par.getByRole('button', { name: 'Comparar lado a lado' }).click();
    await expect(page.getByTestId('comparacao')).toBeVisible();
    await semViolacaoAxe(page, 'comparação lado a lado');
    await page.getByTestId('justificativa').fill('Mães com documentos diferentes; conferido com o paciente.');
    await page.getByTestId('botao-outra-pessoa').click();
    await expect(page.getByTestId('mensagem-fila')).toContainText('outra pessoa');
    await expect(tabela.locator('tbody tr', { hasText: '501 · JOSÉ DA SILVA SINTETICO' })).toHaveCount(0);
    // Na busca, o alerta de homônimo.
    await page.goto('/cadastros/pacientes');
    await buscar(page, 'JOSE DA SILVA');
    await expect(page.getByTestId('paciente-1001').getByTestId('alerta-homonimo')).toBeVisible();
    await expect(page.getByTestId('paciente-1002').getByTestId('alerta-homonimo')).toBeVisible();
  });

  test('profissional com dois conselhos: registros, categoria pelo CBO, situação "a confirmar" na aba Dados; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Profissionais, registros e especialidades' }),
    ).toBeVisible();
    await page.getByTestId('termo-profissional').fill('BRUNO');
    await page.getByTestId('botao-buscar-profissional').click();
    await expect(page.getByTestId('profissional-4')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/profissionais');
    await page.getByTestId('profissional-4').getByRole('link').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/4$/);
    // D-PROF-39 (redesenho): os registros ficam na aba Registros da ficha.
    await page.getByTestId('prof-aba-registros').click();
    await expect(page.getByTestId('registro-profissional')).toHaveCount(2);
    await expect(page.getByTestId('registros-profissional')).toContainText('CRM');
    await expect(page.getByTestId('registros-profissional')).toContainText('CRO');
    // Login único (18/11/2026): no cartão, cada registro no conselho uma vez e só a situação legível; o código
    // interno da situação (significado a confirmar) fica na aba Dados.
    await expect(page.getByTestId('perfil-conselho')).toHaveText(['CRM 22222/MG', 'CRO 3333/MG']);
    await expect(page.getByTestId('perfil-profissional')).not.toContainText('a confirmar');
    await page.getByTestId('prof-aba-dados').click();
    await expect(page.getByTestId('dado-situacao-cadastro')).toHaveText('código O (significado a confirmar)');
    await semViolacaoAxe(page, '/cadastros/profissionais/4');
  });

  test('consultas do marco: pessoas, solicitantes, conselhos, prestadores, especialidades e históricos; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    const telas: [string, string][] = [
      ['/cadastros/pessoas', 'tela-pessoas'],
      ['/cadastros/solicitantes', 'tela-solicitantes'],
      ['/cadastros/profissionais/conselhos', 'tela-conselhos'],
      ['/cadastros/prestadores', 'tela-dominio-cadastro.prestador'],
      ['/cadastros/especialidades', 'tela-especialidades'],
      ['/cadastros/profissionais/4/historico', 'tela-historico-profissional'],
    ];
    for (const [rota, id] of telas) {
      await page.goto(rota);
      await expect(page.getByTestId(id)).toBeVisible();
      await page.waitForLoadState('networkidle');
      await semViolacaoAxe(page, rota);
    }
    // Sem inclusão por aqui (o motivo aparece) e com as siglas em consulta.
    await page.goto('/cadastros/prestadores');
    await expect(page.getByTestId('dominio-sem-inclusao')).toBeVisible();
    await page.goto('/cadastros/profissionais/conselhos');
    await expect(page.getByTestId('tabela-siglas')).toBeVisible();
    // Solicitantes: repetido por conselho + UF + número aparece marcado.
    await page.goto('/cadastros/solicitantes');
    await page.getByTestId('termo-solicitante').fill('SINTETICO');
    await page.getByTestId('termo-solicitante').press('Enter');
    await expect(page.getByTestId('tabela-solicitantes')).toBeVisible();
    await semViolacaoAxe(page, 'solicitantes encontrados');
    // Pelo registro no conselho (a busca da guia TISS): conselho + UF + número.
    await page.getByTestId('conselho-solicitante').fill('CRM');
    await page.getByTestId('uf-solicitante').fill('RJ');
    await page.getByTestId('numero-solicitante').fill('70003');
    await page.getByTestId('buscar-registro-solicitante').click();
    await expect(page.getByTestId('tabela-solicitantes').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('tabela-solicitantes')).toContainText('70003');
    await semViolacaoAxe(page, 'solicitante pelo registro');
  });

  test('linha do tempo do cadastro do paciente (SAME); axe', async ({ page }) => {
    await entrar(page, 'SINT.SAME');
    await page.goto('/cadastros/pacientes/1001/historico');
    await expect(page.getByTestId('linha-do-tempo')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/pacientes/1001/historico');
  });
});
