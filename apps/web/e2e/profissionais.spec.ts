// E2E @M39 @D-PROF-39 (liberação full e requisitos do dono de 18/11/2026): Cadastros > Profissionais sem a faixa de
// "só consulta" (conferida DEPOIS da resposta da situação das telas); "Novo profissional" e a ficha no visual de
// Usuários e Acessos (cartão de perfil, abas, sensíveis mascarados com o olho); editar os dados (com a colisão de
// outra aba), registro (incluir, encerrar e reativar com o motivo), especialidade, lotação (horas só inteiras) e
// credenciamento; o login do sistema ligado por quem gere os acessos (com a senha e a justificativa) e no histórico;
// a exclusão recusada com quantos e quais (e a inativação oferecida no lugar); o cadastrado por engano excluído; sem as
// opções, o aviso único (perfil só de consulta e quem edita sem gerir acessos).
// Sessão real sobre a fonte sintética de dev (SINT.ADMIN, SINT.VINCULOS, SINT.RECEPCAO) e a porta do cadastro em
// MEMÓRIA (corpo clínico sintético marcado "SINTETICO"; nada vai à cópia); nenhum dado real.
import { expect, test, type Page } from '@playwright/test';
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

/** Abre a tela de profissionais. */
async function abrirLista(page: Page): Promise<void> {
  await page.goto('/cadastros/profissionais');
  await expect(page.getByTestId('tela-profissionais')).toBeVisible();
}

/** PUT direto pela sessão da página (a "outra aba"): o mesmo cookie, o CSRF e a chave de idempotência. */
async function putPelaOutraAba(page: Page, url: string, corpo: unknown): Promise<number> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  const r = await page.request.put(url, {
    data: corpo,
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-outra-aba-${Date.now()}` },
  });
  return r.status();
}

async function confirmarDialogo(page: Page, motivo: string | null, senha: boolean): Promise<void> {
  const form = page.getByTestId('form-gravacao');
  await expect(form).toBeVisible();
  if (motivo !== null) await form.getByTestId('dialogo-motivo').fill(motivo);
  if (senha) await form.getByTestId('dialogo-senha').fill(SENHA);
  await form.getByTestId('dialogo-confirmar').click();
  await expect(form).toBeHidden();
}

test.describe('Profissionais: inclusão, login, inativação e exclusão só sem vínculo @M39 @D-PROF-39', () => {
  test('novo profissional, ficha com perfil e abas, login ligado com a senha, histórico; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await abrirLista(page);
    await semViolacaoAxe(page, '/cadastros/profissionais');
    await page.getByTestId('novo-profissional-abrir').click();
    await page.getByTestId('np-nome').fill('Nova Medica Sintetica');
    await page.getByTestId('np-cpf').fill('529.982.247-25');
    await page.getByTestId('np-numero').fill('812001');
    await escolher(page.getByTestId('np-uf'), 'RJ');
    await escolher(page.getByTestId('np-cbo'), { rotulo: /225125/ });
    await page.getByTestId('np-gravar').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/\d+$/);
    const perfil = page.getByTestId('perfil-profissional');
    await expect(perfil).toContainText('NOVA MEDICA SINTETICA');
    await expect(page.getByTestId('perfil-situacao')).toContainText('Ativo');
    await expect(page.getByTestId('perfil-sem-login')).toBeVisible();
    // O administrador edita o cadastro, mas não gere acessos: o login do profissional fica no aviso único.
    const avisoAdm = page.getByTestId('aviso-unico');
    await avisoAdm.locator('summary').click();
    await expect(avisoAdm).toContainText('só quem gere os acessos');
    await expect(avisoAdm).not.toContainText('opção Alterar');
    await semViolacaoAxe(page, 'ficha do profissional');
    const fichaUrl = page.url();
    const id = Number(/\/(\d+)$/.exec(fichaUrl)?.[1]);

    // As abas (teclado: seta para a direita) e a aba do login.
    await page.getByTestId('prof-aba-dados').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('prof-aba-registros')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('prof-aba-login').click();
    await expect(page.getByTestId('login-so-consulta')).toBeVisible();
    await expect(page.getByTestId('login-gravar')).toHaveCount(0);

    // Quem gere os acessos liga o login (senha e justificativa, também na primeira ligação).
    await page.context().clearCookies();
    await entrar(page, 'SINT.VINCULOS');
    await page.goto(`/cadastros/profissionais/${id}`);
    await page.getByTestId('prof-aba-login').click();
    await expect(page.getByTestId('login-condicao')).toContainText('papel Operador de sistema ativo');
    await escolher(page.getByTestId('login-escolha'), { rotulo: /SINT\.LIVRE1/ });
    await page.getByTestId('login-gravar').click();
    const form1 = page.getByTestId('form-gravacao');
    await form1.getByTestId('dialogo-senha').fill(SENHA);
    await expect(form1.getByTestId('dialogo-confirmar')).toBeDisabled();
    await form1.getByTestId('dialogo-motivo').fill('Médica admitida no corpo clínico');
    await form1.getByTestId('dialogo-confirmar').click();
    await expect(form1).toBeHidden();
    await expect(page.getByTestId('login-aviso')).toBeVisible();
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.LIVRE1');
    await expect(page.getByTestId('perfil-login')).toContainText('SINT.LIVRE1');
    await semViolacaoAxe(page, 'aba do login');

    // Trocar exige a justificativa (o botão só confirma com 10 letras).
    await escolher(page.getByTestId('login-escolha'), { rotulo: /SINT\.LIVRE2/ });
    await page.getByTestId('login-gravar').click();
    const form = page.getByTestId('form-gravacao');
    await form.getByTestId('dialogo-senha').fill(SENHA);
    await expect(form.getByTestId('dialogo-confirmar')).toBeDisabled();
    await form.getByTestId('dialogo-motivo').fill('Troca para o login novo do teste');
    await form.getByTestId('dialogo-confirmar').click();
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.LIVRE2');

    await page.getByTestId('prof-aba-historico').click();
    await expect(page.getByTestId('evento-profissional')).toHaveCount(2);
    await expect(page.getByTestId('eventos-profissional')).toContainText('Troca para o login novo do teste');
    await expect(page.getByTestId('eventos-profissional')).toContainText('Médica admitida no corpo clínico');
    // Perfil só de consulta do cadastro (sem Alterar): sem formulários, o aviso único diz por quê.
    await page.getByTestId('prof-aba-dados').click();
    await expect(page.getByTestId('editar-dados')).toHaveCount(0);
    const aviso = page.getByTestId('aviso-unico');
    await aviso.locator('summary').click();
    await expect(aviso).toContainText('opção Alterar');
    await semViolacaoAxe(page, 'ficha só de consulta');
    expect(externas).toEqual([]);
  });

  test('editar dados (colisão de outra aba), registro com motivo, especialidade, lotação, credenciamento e o olho', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais/5');
    await expect(page.getByTestId('perfil-profissional')).toContainText('CARLA ENFERMEIRA');

    // Dados: grava o e-mail; mascarado até o olho.
    await page.getByTestId('editar-dados').click();
    await page.getByTestId('ed-email').fill('carla.sint@exemplo.com');
    await page.getByTestId('gravar-dados').click();
    await expect(page.getByTestId('edicao-gravada')).toBeVisible();
    await expect(page.getByTestId('dado-email')).toHaveText('c•••@exemplo.com');
    await page.getByTestId('revelar-sensiveis').click();
    await expect(page.getByTestId('dado-email')).toHaveText('carla.sint@exemplo.com');
    await expect(page.getByTestId('revelar-sensiveis')).toHaveAttribute('aria-pressed', 'true');

    // Colisão: outra aba grava antes; esta recebe a recusa com o motivo e nada é sobrescrito.
    await page.getByTestId('editar-dados').click();
    await page.getByTestId('ed-social').fill('Carlinha');
    const f = (await (await page.request.get('/api/cadastros/profissionais/5')).json()) as {
      dados: { versao: string };
    };
    expect(
      await putPelaOutraAba(page, '/api/cadastros/profissionais/5', {
        versao: f.dados.versao,
        alteracoes: { nomeMae: 'MAE SINTETICA OUTRA ABA' },
      }),
    ).toBe(200);
    await page.getByTestId('gravar-dados').click();
    await expect(page.getByTestId('edicao-recusa')).toBeVisible();
    await expect(page.getByTestId('perfil-profissional')).not.toContainText('CARLINHA');

    // Registros: incluir; encerrar e reativar pedem o motivo (vai ao histórico).
    await page.reload();
    await page.getByTestId('prof-aba-registros').click();
    const form = page.getByTestId('form-registro');
    await form.getByTestId('nr-numero').fill('812555');
    await escolher(form.getByTestId('nr-uf'), 'RJ');
    await escolher(form.getByTestId('nr-cbo'), { rotulo: /223505/ });
    await page.getByTestId('incluir-registro').click();
    await expect(page.getByTestId('registro-profissional')).toHaveCount(2);
    const novo = page.getByTestId('registro-edicao').filter({ hasText: '812555' });
    await novo.getByTestId('inativar-registro').click();
    await confirmarDialogo(page, 'Encerrado: mudou de estado no teste', false);
    await expect(page.getByTestId('registro-profissional').filter({ hasText: '812555' })).toContainText(
      'Inativo',
    );
    await page
      .getByTestId('registro-edicao')
      .filter({ hasText: '812555' })
      .getByTestId('reativar-registro')
      .click();
    await confirmarDialogo(page, 'Voltou ao estado no teste', false);
    await expect(page.getByTestId('registro-profissional').filter({ hasText: '812555' })).toContainText(
      'Ativo',
    );

    // Especialidade e credenciamento (a lotação, com API própria, está no f31-lotacao-profissional.spec.ts).
    await page.getByTestId('prof-aba-especialidades').click();
    await escolher(page.getByTestId('ne-registro'), { indice: 1 });
    await escolher(page.getByTestId('ne-especialidade'), { rotulo: /CARDIOLOGIA/ });
    await page.getByTestId('incluir-especialidade').click();
    await expect(page.getByTestId('prof-painel-especialidades')).toContainText('CARDIOLOGIA');
    await page.getByTestId('prof-aba-convenios').click();
    await escolher(page.getByTestId('nc-registro'), { indice: 1 });
    await escolher(page.getByTestId('nc-convenio'), { rotulo: /PLANO/ });
    await page.getByTestId('credenciar').click();
    await expect(page.getByTestId('prof-painel-convenios')).toContainText('PLANO');

    // O histórico mostra o encerramento e a reativação do registro com o motivo.
    await page.getByTestId('prof-aba-historico').click();
    await expect(page.getByTestId('eventos-profissional')).toContainText(
      'Encerrado: mudou de estado no teste',
    );
    await expect(page.getByTestId('eventos-profissional')).toContainText('Voltou ao estado no teste');
    await semViolacaoAxe(page, 'ficha editada');
  });

  test('exclusão com vínculo: quantos e quais, inativar no lugar; o cadastrado por engano sai', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais/3');
    await page.getByTestId('excluir-profissional').click();
    await expect(page.getByTestId('ficha-recusa')).toContainText(/vínculos.*Atendimentos: 8/);
    await page.getByTestId('inativar-em-vez').click();
    await confirmarDialogo(page, 'Desligado do corpo clínico no teste', false);
    await expect(page.getByTestId('ficha-aviso')).toContainText('inativado');
    await expect(page.getByTestId('perfil-situacao')).toContainText('Inativo');
    await expect(page.getByTestId('chave-situacao')).toHaveAttribute('aria-checked', 'false');
    // Reativar pela chave.
    await page.getByTestId('chave-situacao').click();
    await confirmarDialogo(page, 'Readmitido no corpo clínico no teste', false);
    await expect(page.getByTestId('chave-situacao')).toHaveAttribute('aria-checked', 'true');

    // O cadastrado por engano: sem vínculo, sai com o motivo e a senha.
    await page.goto('/cadastros/profissionais');
    await page.getByTestId('novo-profissional-abrir').click();
    await page.getByTestId('np-nome').fill('Engano Sintetico');
    await page.getByTestId('np-cpf').fill('111.444.777-35');
    await page.getByTestId('np-numero').fill('812999');
    await escolher(page.getByTestId('np-uf'), 'MG');
    await escolher(page.getByTestId('np-cbo'), { rotulo: /225125/ });
    await page.getByTestId('np-credenciar').uncheck();
    await page.getByTestId('np-gravar').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/\d+$/);
    await page.getByTestId('excluir-profissional').click();
    await confirmarDialogo(page, 'Cadastro feito por engano no teste', true);
    await expect(page).toHaveURL(/\/cadastros\/profissionais\?excluido=1$/);
    await expect(page.getByTestId('profissional-excluido')).toBeVisible();
  });

  test('registro incluído por engano sai; sem registro, o aviso único diz por que o login não liga; recepção sem acesso', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/profissionais');
    await page.getByTestId('novo-profissional-abrir').click();
    await page.getByTestId('np-nome').fill('Registro Engano Sintetico');
    await page.getByTestId('np-cpf').fill('390.533.447-05');
    await page.getByTestId('np-numero').fill('812777');
    await escolher(page.getByTestId('np-uf'), 'SP');
    await escolher(page.getByTestId('np-cbo'), { rotulo: /223505/ });
    await page.getByTestId('np-credenciar').uncheck();
    await page.getByTestId('np-gravar').click();
    await expect(page).toHaveURL(/\/cadastros\/profissionais\/\d+$/);
    await page.getByTestId('prof-aba-registros').click();
    await page.getByTestId('excluir-registro').click();
    await confirmarDialogo(page, 'Registro incluído por engano no teste', true);
    await expect(page.getByTestId('registro-profissional')).toHaveCount(0);
    // Quem gere os acessos vê por que o login não liga (sem registro no conselho).
    const semRegistro = page.url();
    await page.context().clearCookies();
    await entrar(page, 'SINT.VINCULOS');
    await page.goto(semRegistro);
    const aviso = page.getByTestId('aviso-unico');
    await aviso.locator('summary').click();
    await expect(aviso).toContainText('inclua um registro antes de ligar o login');
    await semViolacaoAxe(page, 'ficha sem registro');

    // Sem a opção de ler profissionais: a ficha não abre (o servidor recusa).
    await page.context().clearCookies();
    await entrar(page, 'SINT.RECEPCAO');
    await page.goto('/cadastros/profissionais/4');
    await expect(page.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible();
    await expect(page.getByTestId('perfil-profissional')).toHaveCount(0);
  });

  // Login único (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): o mesmo CRM em três ocupações tem UM login.
  test('login único: cartão sem chips repetidos, um seletor de login só, trocar a ocupação; o herdado com dois logins', async ({
    page,
  }) => {
    test.slow(); // duas fichas, dois diálogos com a senha e duas conferências de acessibilidade
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.VINCULOS');
    await page.goto('/cadastros/profissionais/7');
    const perfil = page.getByTestId('perfil-profissional');
    await expect(perfil).toContainText('EDUARDO TRÊS OCUPAÇÕES');
    // O CRM uma vez, com as três ocupações como detalhe; sem a etiqueta do código interno da situação no cartão.
    await expect(page.getByTestId('perfil-conselho')).toHaveCount(1);
    await expect(page.getByTestId('perfil-conselho')).toHaveText('CRM 66666/MG');
    await expect(page.getByTestId('perfil-ocupacao')).toHaveCount(3);
    await expect(page.getByTestId('perfil-registros')).toContainText('225170 · MÉDICO GENERALISTA');
    await expect(page.getByTestId('perfil-login')).toHaveCount(1);
    await expect(perfil).not.toContainText('a confirmar');
    await expect(page.getByTestId('dado-situacao-cadastro')).toHaveText('código O (significado a confirmar)');

    // A aba do login: um login, a ocupação que ele usa e um seletor de login só.
    await page.getByTestId('prof-aba-login').click();
    await expect(page.getByTestId('login-escolha')).toHaveCount(1);
    await expect(page.getByTestId('login-atual')).toHaveCount(1);
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.PROF6');
    await expect(page.getByTestId('login-ocupacao-atual')).toContainText('225125 · MÉDICO CLÍNICO');
    await semViolacaoAxe(page, 'aba do login com um login só');
    // Trocar a ocupação: o mesmo login passa à de ginecologista (justificativa e senha).
    await escolher(page.getByTestId('login-ocupacao-escolha'), { rotulo: /225250/ });
    await page.getByTestId('login-trocar-ocupacao').click();
    await expect(page.getByTestId('form-gravacao')).toContainText('continua o deste profissional');
    await confirmarDialogo(page, 'Passa a atender como ginecologista', true);
    await expect(page.getByTestId('login-aviso')).toBeVisible();
    await expect(page.getByTestId('login-atual')).toHaveCount(1);
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.PROF6');
    await expect(page.getByTestId('login-ocupacao-atual')).toContainText('225250 · MÉDICO GINECOLOGISTA');
    await page.getByTestId('prof-aba-historico').click();
    await expect(page.getByTestId('evento-profissional')).toHaveCount(2);
    await expect(page.getByTestId('eventos-profissional')).toContainText(
      'Passa a atender como ginecologista',
    );

    // O dado herdado com dois logins: aparecem os dois, com o aviso; desligar o extra deixa um login só.
    await page.goto('/cadastros/profissionais/8');
    await expect(page.getByTestId('perfil-login')).toHaveCount(2);
    // Revisão (WCAG 1.4.1): o conflito também por escrito no cartão, não só pela cor.
    await expect(page.getByTestId('perfil-login-conflito')).toContainText(
      '2 logins: um profissional tem um login só',
    );
    await page.getByTestId('prof-aba-login').click();
    await expect(page.getByTestId('login-conflito')).toContainText('2 logins ligados (dado herdado)');
    await expect(page.getByTestId('login-atual')).toHaveCount(2);
    await expect(page.getByTestId('login-escolha')).toHaveCount(0);
    await semViolacaoAxe(page, 'aba do login com dois logins herdados');
    await page.getByTestId('login-desligar').nth(1).click();
    await confirmarDialogo(page, 'Login extra herdado desligado', true);
    await expect(page.getByTestId('login-conflito')).toHaveCount(0);
    await expect(page.getByTestId('login-atual')).toHaveText('SINT.PROF7');
    await expect(page.getByTestId('login-escolha')).toHaveCount(1);
    await expect(page.getByTestId('perfil-login')).toHaveCount(1);
    await expect(page.getByTestId('perfil-login-conflito')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
