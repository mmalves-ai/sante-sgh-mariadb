// E2E @M24 (ficha, seção 10): o médico acha o paciente pela entrada da prescrição, monta a prescrição item a item
// (medicamento com a busca do produto, cuidado com frequência), verifica os alertas e os horários previstos pela
// regra da unidade, assina e vê a prescrição com a prova conferida; monta e emite a receita de alta no receituário
// certo (regra 15); suspende um item com justificativa e senha; a alergia exige justificativa para manter o item; sem
// conexão a tela não assina; a farmácia clínica vê as regras e simula; a reconciliação registra a conduta; a cópia da
// anterior com revisão item a item e a impressão; o residente prescreve e o preceptor coassina; a nutricionista não
// prescreve medicamento; os cadastros de prescrição em consulta, o local de assistência no cadastro genérico e a
// farmácia incluindo um kit de solução na edição do cadastro. Sessão real sobre a fonte sintética e a porta da
// prescrição em MEMÓRIA (pacientes, produtos e cadastros SINTÉTICOS; nada vai à cópia). axe sem violação séria.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function incluirMedicamento(
  page: Page,
  termo: string,
  produto: number,
  dose: string,
  unidade: string,
  via: string,
  freq: string,
) {
  await page.getByTestId('aba-medicamentos').click();
  const editor = page.getByTestId('editor-medicamentos');
  await editor.getByTestId('busca-produto').fill(termo);
  await editor.getByTestId('buscar-produto').click();
  await editor.getByTestId(`produto-${produto}`).click();
  await editor.getByTestId('dose').fill(dose);
  await escolher(editor.getByTestId('unidade'), unidade);
  await escolher(editor.getByTestId('via'), via);
  await escolher(editor.getByTestId('frequencia'), { rotulo: freq });
  await editor.getByTestId('incluir-item').click();
}

test.describe('Prescrição eletrônica @M24 @fase2', () => {
  // Cada escolha abre a lista e clica (como o usuário), mais lento que o selectOption do <select> nativo: o fluxo
  // completo do médico passava perto dos 30 s padrão.
  test.setTimeout(90_000);
  test('médico: prescreve, verifica, assina com prova, emite a receita de alta e suspende um item; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/prescricao');
    await expect(page.getByTestId('tela-prescricao-inicio')).toBeVisible();
    await semViolacaoAxe(page, 'entrada da prescrição');
    await page.getByTestId('busca-paciente-prescricao').fill('jose');
    await page.getByTestId('buscar-paciente-prescricao').click();
    await page.getByTestId('paciente-prescricao-1001').getByRole('link').click();

    await expect(page.getByTestId('tela-prescricao-paciente')).toBeVisible();
    await expect(page.getByTestId('prescritor-sessao')).toContainText('médico');
    await expect(page.getByTestId('dados-clinicos')).toContainText('peso 72 kg');
    await expect(page.getByTestId('dados-clinicos')).toContainText('clearance estimado');
    await expect(page.getByTestId('periodos')).toContainText('16:01');
    await expect(page.getByTestId('lista-prescricoes')).toContainText('Gravada por outra aplicação');
    await semViolacaoAxe(page, 'prescrição do paciente');
    await page.getByTestId('nova-prescricao').click();

    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await escolher(page.getByTestId('editor-periodo'), 'seguinte');
    // Regra 12: a dose por kg com o peso do cadastro e a data do dado (sugestão; o prescritor confere).
    await page.getByTestId('aba-medicamentos').click();
    const calc = page.getByTestId('editor-medicamentos');
    await escolher(calc.getByTestId('regra-dose'), 'por-kg');
    await calc.getByTestId('dose-por-unidade').fill('0,5');
    await expect(calc.getByTestId('dose-calculada')).toContainText('72 kg');
    await expect(calc.getByTestId('dose')).toHaveValue('36');
    await semViolacaoAxe(page, 'cálculo de dose');
    await escolher(calc.getByTestId('regra-dose'), 'fixa');
    await incluirMedicamento(page, 'dipirona', 501, '2', 'ML', 'EV', '06/06');
    await page.getByTestId('aba-cuidados').click();
    const cuidado = page.getByTestId('editor-cuidados');
    await escolher(cuidado.getByTestId('procedimento'), '2');
    await escolher(cuidado.getByTestId('frequencia-cuidado'), { rotulo: '08/08' });
    await cuidado.getByTestId('incluir-item').click();
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(2);
    await semViolacaoAxe(page, 'editor da prescrição');

    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('painel-alertas')).toBeVisible();
    await expect(page.getByTestId('aviso-base-interacoes')).toBeVisible();
    await expect(page.getByTestId('itens-prescricao')).toContainText('18:00 · 00:00 · 06:00 · 12:00');
    await semViolacaoAxe(page, 'alertas e horários');
    await page.getByTestId('assinar-prescricao').click();

    await expect(page).toHaveURL(/\/pep\/paciente\/1001\/prescricao\/\d+\?assinada=/);
    await expect(page.getByTestId('prescricao-assinada')).toContainText('2 itens');
    await expect(page.getByTestId('prova-prescricao')).toContainText('Conteúdo conferido');
    await semViolacaoAxe(page, 'prescrição assinada');

    // Regra 15: a receita de alta no receituário certo (a dipirona vai à receita simples), emitida pelo receituário.
    await page.getByTestId('montar-receita-alta').click();
    const simples = page.getByTestId('receita-alta-simples');
    await expect(simples).toContainText('Receita simples');
    await expect(simples).toContainText('2 ML, EV, 06/06');
    await semViolacaoAxe(page, 'receita de alta');
    await simples.locator('[data-testid^="quantidade-simples-"]').getByRole('textbox').fill('1 frasco');
    await simples.getByTestId('emitir-simples').click();
    await expect(page.getByTestId('receita-emitida-simples')).toContainText('Receita emitida');

    const linha = page.getByTestId('itens-lidos').locator('tbody tr').first();
    await linha.getByRole('button', { name: /^Suspender/ }).click();
    const dialogo = page.getByTestId('dialogo-prescricao');
    await dialogo.getByTestId('justificativa-suspensao').fill('Sem indicação sintética para manter.');
    await dialogo.getByTestId('senha-confirmacao').fill(SENHA);
    await semViolacaoAxe(page, 'diálogo de suspensão');
    await dialogo.getByTestId('confirmar-dialogo').click();
    await expect(page.getByTestId('mensagem-prescricao')).toContainText('4 horários suspensos');
    await expect(linha).toContainText('Suspenso');

    // Correção: o cuidado é suspenso "por correção" e o corrigido entra ligado a ele.
    const cuidadoLido = page.getByTestId('itens-lidos').locator('tbody tr').nth(1);
    await cuidadoLido.getByRole('button', { name: /^Corrigir/ }).click();
    const correcao = page.getByTestId('dialogo-prescricao');
    const editorCorrecao = correcao.getByTestId('editor-cuidados');
    await escolher(editorCorrecao.getByTestId('procedimento'), '2');
    await escolher(editorCorrecao.getByTestId('frequencia-cuidado'), { rotulo: '06/06' });
    await editorCorrecao.getByTestId('incluir-item').click();
    await expect(correcao.getByTestId('item-pronto')).toBeVisible();
    await correcao
      .getByTestId('justificativa-suspensao')
      .fill('Correção sintética da frequência do cuidado.');
    await correcao.getByTestId('senha-confirmacao').fill(SENHA);
    await semViolacaoAxe(page, 'diálogo de correção');
    await correcao.getByTestId('confirmar-dialogo').click();
    await expect(page.getByTestId('itens-lidos')).toContainText('Suspenso por correção');
    expect(externas).toEqual([]);
  });

  test('aplicar protocolo e renovar a anterior com os itens confirmados', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/prescricao/nova?montar=1');
    const protocolo = page.getByTestId('aplicar-protocolo');
    await expect(protocolo).toBeVisible();
    await escolher(protocolo.getByTestId('escolher-protocolo'), '1');
    await protocolo.getByTestId('botao-aplicar-protocolo').click();
    await expect(page.getByTestId('aviso-protocolo')).toContainText('itens do protocolo incluídos');
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr').first()).toBeVisible();
    await semViolacaoAxe(page, 'protocolo aplicado');

    // Renovação da prescrição do outro sistema: nada é levado sem a confirmação item a item.
    await page.goto('/pep/paciente/1001/prescricao');
    await page
      .getByTestId('lista-prescricoes')
      .locator('tbody tr', { hasText: 'Gravada por outra aplicação' })
      .getByRole('link')
      .first()
      .click();
    await page.getByTestId('renovar').click();
    const origem = page.getByTestId('origem-itens');
    await expect(origem).toBeVisible();
    const marcas = origem.locator('[data-testid^="confirmar-origem-"]');
    await expect(marcas).toHaveCount(2);
    for (const k of [0, 1]) await marcas.nth(k).check();
    await page.getByTestId('levar-origem').click();
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(2);
    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('painel-alertas')).toBeVisible();
    await semViolacaoAxe(page, 'renovação com os itens confirmados');
  });

  test('alergia exige justificativa para manter; sem conexão não assina', async ({ page, context }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1003/prescricao/nova');
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await incluirMedicamento(page, 'amoxicilina', 506, '500', 'MG', 'VO', '08/08');
    // Antimicrobiano: a ficha (indicação e sítio) é pedida antes de o item entrar na lista.
    await expect(page.getByTestId('item-incompleto')).toBeVisible();
    await page.getByTestId('ficha-indicacao').fill('Infecção sintética');
    await page.getByTestId('ficha-sitio').fill('Pulmão');
    await page.getByTestId('editor-medicamentos').getByTestId('incluir-item').click();
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('alerta-alergia')).toBeVisible();
    await expect(page.getByTestId('alerta-impede')).toBeVisible();
    await expect(page.getByTestId('assinar-prescricao')).toBeDisabled();
    await page
      .getByTestId('alerta-alergia')
      .getByTestId('justificativa-alerta')
      .fill('Benefício avaliado; sem alternativa sintética.');
    await page.getByTestId('alerta-alergia').getByTestId('manter-alerta').click();
    await expect(page.getByTestId('alerta-mantido').first()).toBeVisible();
    await semViolacaoAxe(page, 'alerta de alergia justificado');

    await context.setOffline(true);
    await expect(page.getByTestId('sem-conexao')).toBeVisible();
    await expect(page.getByTestId('assinar-prescricao')).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId('sem-conexao')).toHaveCount(0);
  });

  test('farmácia clínica: regras vigentes e simulador; reconciliação registra a conduta', async ({
    page,
  }) => {
    await entrar(page, 'SINT.FARMACIA');
    await page.goto('/farmacia-clinica/interacoes');
    await expect(page.getByTestId('tela-farmacia-interacoes')).toBeVisible();
    await expect(page.getByTestId('situacao-base')).toContainText('não contratada');
    await expect(page.getByTestId('regras-alerta')).toContainText('Alergia');
    await page.getByTestId('sim-produtos').fill('501 507');
    await page.getByTestId('simular').click();
    await expect(page.getByTestId('resultado-simulacao')).toBeVisible();
    await semViolacaoAxe(page, 'farmácia clínica');

    await page.goto('/farmacia-clinica/antimicrobianos');
    await expect(page.getByTestId('tela-antimicrobianos')).toBeVisible();
    await semViolacaoAxe(page, 'fichas de antimicrobiano');

    await page.context().clearCookies();
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/reconciliacao');
    await expect(page.getByTestId('tela-reconciliacao')).toBeVisible();
    await page.getByTestId('recon-descricao-0').fill('Losartana sintética 50 mg');
    await escolher(page.getByTestId('recon-conduta-0'), 'suspender');
    await page.getByTestId('recon-registrar').click();
    await expect(page.getByTestId('recon-aviso')).toBeVisible();
    await page.getByTestId('recon-justificativa-0').fill('Hipotensão sintética na admissão.');
    await page.getByTestId('recon-registrar').click();
    await expect(page.getByTestId('recon-ok')).toBeVisible();
    await expect(page.locator('[data-testid^="reconciliacao-"]').first()).toContainText('Losartana');
    await semViolacaoAxe(page, 'reconciliação');
  });

  test('copiar a anterior com revisão item a item; imprimir', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/prescricao');
    await expect(page.getByTestId('tela-prescricao-paciente')).toBeVisible();
    await page
      .getByTestId('lista-prescricoes')
      .locator('tbody tr', { hasText: 'Gravada por outra aplicação' })
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByTestId('tela-prescricao-ver')).toBeVisible();
    await page.getByRole('button', { name: 'Copiar', exact: true }).click();
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    const origem = page.getByTestId('origem-itens');
    await expect(origem).toBeVisible();
    await semViolacaoAxe(page, 'cópia com revisão');
    // Revisão: nada vai sem a confirmação; o segundo item fica de fora.
    const marcas = origem.locator('[data-testid^="confirmar-origem-"]');
    await expect(marcas).toHaveCount(2);
    await marcas.nth(0).check();
    await marcas.nth(1).uncheck();
    await page.getByTestId('levar-origem').click();
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(1);
    await escolher(page.getByTestId('editor-periodo'), 'atual');
    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('painel-alertas')).toBeVisible();
    await page.getByTestId('assinar-prescricao').click();
    await expect(page).toHaveURL(/\/pep\/paciente\/1001\/prescricao\/\d+\?assinada=/);
    await expect(page.getByTestId('prescricao-assinada')).toContainText('1 ite');
    // Impressão: o PDF/A do serviço de emissão abre numa aba (a reimpressão pede o motivo da 2ª via); sem o serviço,
    // a impressão da tela.
    await page.evaluate(() => {
      const w = window as unknown as { abertos: number; impressoes: number };
      w.abertos = 0;
      w.impressoes = 0;
      window.open = () => {
        w.abertos++;
        return null;
      };
      window.print = () => {
        w.impressoes++;
      };
    });
    const contar = () =>
      page.evaluate(() => {
        const w = window as unknown as { abertos: number; impressoes: number };
        return { abertos: w.abertos, impressoes: w.impressoes };
      });
    const imprimir = page.getByTestId('imprimir-prescricao');
    await imprimir.getByRole('button', { name: 'Imprimir' }).click();
    await expect.poll(async () => (await contar()).abertos + (await contar()).impressoes).toBe(1);
    console.log(
      `[impressão] ${(await contar()).abertos === 1 ? 'PDF/A do serviço de emissão' : 'impressão da tela'}`,
    );
    if ((await contar()).abertos === 1) {
      await imprimir.getByLabel('Motivo da 2ª via').fill('Reimpressão para a enfermagem');
      await semViolacaoAxe(page, 'reimpressão da prescrição');
      await imprimir.getByRole('button', { name: 'Imprimir' }).click();
      await expect.poll(async () => (await contar()).abertos).toBe(2);
    }
  });

  test('residente prescreve e o preceptor coassina; nutricionista não prescreve medicamento', async ({
    page,
  }) => {
    await entrar(page, 'SINT.RESIDENTE');
    await page.goto('/pep/paciente/1003/prescricao/nova');
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await page.getByTestId('aba-cuidados').click();
    const cuidado = page.getByTestId('editor-cuidados');
    await escolher(cuidado.getByTestId('procedimento'), '2');
    await escolher(cuidado.getByTestId('frequencia-cuidado'), { rotulo: '08/08' });
    await cuidado.getByTestId('incluir-item').click();
    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('painel-alertas')).toBeVisible();
    await page.getByTestId('assinar-prescricao').click();
    await expect(page).toHaveURL(/\/pep\/paciente\/1003\/prescricao\/\d+\?assinada=/);
    await expect(page.getByText('Coassinatura pendente')).toBeVisible();
    const endereco = page.url().replace(/\?.*$/, '');

    await page.context().clearCookies();
    await entrar(page, 'SINT.MEDICO');
    await page.goto(endereco);
    await page.getByTestId('coassinar').click();
    const dialogo = page.getByTestId('dialogo-prescricao');
    await dialogo.getByTestId('senha-confirmacao').fill(SENHA);
    await semViolacaoAxe(page, 'coassinatura do preceptor');
    await dialogo.getByTestId('confirmar-dialogo').click();
    await expect(page.getByTestId('mensagem-prescricao')).toContainText('Coassinatura registrada');
    await expect(page.getByText('Coassinatura pendente')).toHaveCount(0);

    await page.context().clearCookies();
    await entrar(page, 'SINT.NUTRI');
    await page.goto('/pep/paciente/1001/prescricao/nova');
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await page.getByTestId('aba-medicamentos').click();
    await expect(
      page.getByText('A sua categoria profissional não prescreve este tipo de item.'),
    ).toBeVisible();
    await semViolacaoAxe(page, 'nutricionista fora da categoria');
  });

  test('cadastros de prescrição: consulta, o local de assistência e a edição dos kits pela farmácia', async ({
    page,
  }) => {
    // A farmácia NÃO tem a opção da prescrição (2601): os cadastros abrem pelas opções de cada cadastro (M06).
    await entrar(page, 'SINT.FARMACIA');
    await page.goto('/cadastros/prescricao/kits');
    await expect(page).not.toHaveURL(/sem-permissao/);
    const kits = page.getByTestId('consulta-kitsMedicamento');
    await expect(kits.getByTestId('lista-kitsMedicamento')).toContainText('CEFTRIAXONA');
    await kits
      .getByRole('button', { name: /^Componentes de / })
      .first()
      .click();
    await expect(kits.locator('[data-testid^="filhos-kitsMedicamento-"]')).toBeVisible();
    await expect(page.getByTestId('lista-kitsSolucao')).toContainText('SORO');
    await semViolacaoAxe(page, 'kits de medicamentos e de soluções');
    await page.goto('/cadastros/prescricao/parametros-item');
    const par = page.getByTestId('consulta-parametrosItem');
    await expect(par.getByText('Digite 2 letras ou mais do nome do item.')).toBeVisible();
    await par.getByLabel('Procurar pelo nome').fill('morfina');
    await par.getByRole('button', { name: 'Procurar' }).click();
    await expect(par.getByTestId('lista-parametrosItem')).toContainText('MORFINA');
    await expect(par.getByTestId('lista-parametrosItem')).toContainText('Alta vigilância');
    await semViolacaoAxe(page, 'parâmetros do item');

    await page.context().clearCookies();
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/prescricao/locais-assistencia');
    await expect(page.getByRole('heading', { level: 1, name: 'Locais de assistência' })).toBeVisible();
    await semViolacaoAxe(page, 'locais de assistência');
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Local de assistência').fill('Posto sintético E2E');
    await escolher(form.getByLabel('Tipo de atendimento'), 'I');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');

    // P-CAD-1: a farmácia edita os kits pelo cadastro, logo abaixo da consulta (mestre e materiais).
    await page.context().clearCookies();
    await entrar(page, 'SINT.FARMACIA');
    await page.goto('/cadastros/prescricao/kits');
    const edicao = page.getByTestId('edicao-cadastro');
    await expect(
      edicao.getByRole('heading', { level: 2, name: 'Kits de medicamentos e de soluções' }),
    ).toBeVisible();
    expect(await rotulosDoCombo(edicao.getByTestId('grupo-escolha'))).toContain('Kits de soluções');
    await escolher(edicao.getByTestId('grupo-escolha'), { rotulo: 'Kits de soluções' });
    await edicao.getByTestId('botao-incluir').click();
    const kit = page.getByTestId('form-dominio');
    await kit.getByLabel('Kit de solução').fill('Kit sintético E2E');
    await escolher(kit.getByLabel('Frequência'), { indice: 0 });
    await escolher(kit.getByLabel('Via'), 'EV');
    await escolher(kit.getByLabel('Iniciar a administração agora'), 'F');
    await kit.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await semViolacaoAxe(page, 'edição dos kits');
  });

  test('enfermagem: horários-padrão com a regra da unidade', async ({ page }) => {
    await entrar(page, 'SINT.ENFERMAGEM');
    await page.goto('/cadastros/prescricao/horarios-padrao');
    await expect(page.getByTestId('tela-horarios-padrao')).toBeVisible();
    await expect(page.getByTestId('regra-horario-4')).toContainText('16:01');
    await semViolacaoAxe(page, 'horários-padrão');
  });
});
