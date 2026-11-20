// E2E @W0-09 (programa CRUD completo: comunicação, relatórios, coexistência e configuração). Cada ação de alteração,
// cancelamento, encerramento ou exclusão pede o motivo (o curto é recusado na tela) e, na destrutiva, a confirmação:
// - início (SINT.COMUNICACAO e SINT.MEDICO): o comunicado ainda não lido tem o texto corrigido; depois da leitura e da
//   ciência, a tela não oferece mais a correção e a API devolve 409; a vigência é encurtada e o comunicado é encerrado
//   com motivo, e ele continua visível com as ciências (e para o médico que leu);
// - relatórios (SINT.ADMIN): o pedido aberto é editado e excluído; o pedido já respondido não se exclui (a recusa mostra
//   o vínculo e oferece o cancelamento, que é feito com motivo); o envio agendado é alterado com os endereços
//   mascarados, desativado e excluído;
// - coexistência (SINT.ADMIN e SINT.ONDA5): item da onda 3 e do desligamento (com senha) voltam a pendente; conclusão
//   estornada; a versão da trilha com turma e conclusões recusa a retirada (409 com a contagem) e é inativada pela
//   oferta; o registro do fim é gravado pela tela (motivo e senha) e volta a valer o versionado;
// - parâmetros (SINT.ADMIN): a sobreposição do estabelecimento é retirada com justificativa e o valor volta a herdar.
// axe sem violação séria nos formulários e diálogos. Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados
// SINTÉTICOS; nada vai à cópia). Os registros de partida que não são o objeto do teste entram pela API da sessão.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher as escolherNoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const marca = Date.now().toString(36);

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
  // O aviso grave sintético interrompe uma vez por sessão (M27): dispensa para seguir.
  const entendi = page.getByTestId('aviso-entendi');
  await entendi.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await entendi.isVisible()) {
    await entendi.click();
    await expect(entendi).toHaveCount(0);
  }
}

const agoraLocal = (somaDias = 0) => {
  const d = new Date(Date.now() + somaDias * 86_400_000 - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const diaLocal = (somaDias = 0) => agoraLocal(somaDias).slice(0, 10);

/** Requisição pela sessão do navegador (CSRF do cookie e uma Idempotency-Key): devolve o status e o JSON. */
async function chamar(
  page: Page,
  metodo: 'POST' | 'PUT',
  url: string,
  corpo: unknown,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, u, c]) => {
      const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const resp = await fetch(u as string, {
        method: m as string,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf': csrf,
          'idempotency-key': `e2e.w009.${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify(c),
      });
      return { status: resp.status, corpo: (await resp.json().catch(() => ({}))) as Record<string, unknown> };
    },
    [metodo, url, corpo] as const,
  );
}

/** O SanteBotao destrutivo pergunta de novo num diálogo: confirma pelo último botão dele. */
async function confirmarPergunta(page: Page): Promise<void> {
  const d = page.getByRole('dialog').last();
  await expect(d).toBeVisible();
  await d.getByRole('button').last().click();
}

test.describe('W0-09: comunicado e relatórios com motivo em cada ação @W0-09', () => {
  test('início: comunicado corrigido antes da leitura; com ciência não se edita (409); vigência encurtada e encerramento com motivo; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const assunto = `Comunicado SINTETICO W0-09 ${marca}`;
    await entrar(page, 'SINT.COMUNICACAO');
    await page.goto('/mensagens');
    await page.getByTestId('aba-comunicado').click();
    await page.getByTestId('msg-valor-destino').locator('input').fill('SINT.MEDICO');
    await page.getByTestId('msg-adicionar-destino').click();
    await page.getByTestId('msg-assunto').locator('input').fill(assunto);
    await page
      .getByTestId('msg-texto')
      .locator('textarea')
      .fill('Novo protocolo de passagem de plantao (versao 1).');
    await page.getByTestId('msg-vigencia-inicio').fill(agoraLocal(-1));
    await page.getByTestId('msg-vigencia-fim').fill(agoraLocal(10));
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Comunicado publicado para 1');

    // Ninguém leu: a correção do texto é oferecida e pede o motivo (o curto é recusado na tela).
    const gerir = page.getByTestId('tabela-enviadas').getByRole('button', { name: new RegExp(marca) });
    await gerir.click();
    const gestao = page.getByTestId('comunicado-gestao');
    await expect(gestao).toBeVisible();
    const id = (await gerir.getAttribute('data-testid'))?.replace('gerir-', '') ?? '';
    expect(id).toMatch(/^\d+$/);
    await gestao.getByTestId('comunicado-corrigir').click();
    await gestao
      .getByTestId('comunicado-novo-texto')
      .locator('textarea')
      .fill('Novo protocolo de passagem de plantao (versao 2).');
    await gestao.getByTestId('comunicado-motivo').locator('input').fill('abc');
    await gestao.getByTestId('comunicado-confirmar').click();
    await expect(gestao.getByTestId('erro-motivo')).toBeVisible();
    await semViolacaoAxe(page, '/mensagens (corrigir comunicado)');
    await gestao
      .getByTestId('comunicado-motivo')
      .locator('input')
      .fill('Erro de digitacao na versao do protocolo');
    await gestao.getByTestId('comunicado-confirmar').click();
    await expect(gestao.getByTestId('comunicado-feito')).toBeVisible();
    await expect(gestao.getByTestId('comunicado-texto')).toContainText('versao 2');

    // O médico lê e dá a ciência.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/mensagens');
    const recebidas = page.getByTestId('tabela-recebidas');
    await recebidas.getByRole('button', { name: new RegExp(marca) }).click();
    await expect(page.getByTestId('mensagem-texto')).toContainText('versao 2');
    await page.getByTestId('dar-ciencia').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Ciência registrada');

    // Lido e com ciência: a tela não oferece a correção e a API recusa a edição do texto (409).
    await entrar(page, 'SINT.COMUNICACAO');
    await page.goto('/mensagens');
    await page.getByRole('tab', { name: 'Enviadas' }).click();
    await page.getByTestId(`gerir-${id}`).click();
    await expect(gestao.getByTestId('comunicado-nao-corrige')).toBeVisible();
    await expect(gestao.getByTestId('comunicado-corrigir')).toHaveCount(0);
    const recusa = await chamar(page, 'PUT', `/api/acesso/comunicados/${id}`, {
      assunto,
      texto: 'Tentativa de editar o texto ja lido pelo destinatario.',
      motivo: 'Tentativa de corrigir depois da ciencia',
    });
    expect(recusa.status, JSON.stringify(recusa.corpo)).toBe(409);
    expect(JSON.stringify(recusa.corpo)).toContain('comunicado-ja-lido');

    // Encurtar a vigência (só para o futuro) com motivo.
    await gestao.getByTestId('comunicado-encurtar').click();
    await gestao.getByTestId('comunicado-novo-fim').fill(agoraLocal(3));
    await gestao
      .getByTestId('comunicado-motivo')
      .locator('input')
      .fill('Protocolo vale so ate a proxima reuniao');
    await gestao.getByTestId('comunicado-confirmar').click();
    await expect(gestao.getByTestId('comunicado-feito')).toBeVisible();

    // Encerrar com motivo (a destrutiva pergunta de novo): o comunicado e as ciências continuam visíveis.
    await gestao.getByTestId('comunicado-encerrar').click();
    await gestao
      .getByTestId('comunicado-motivo')
      .locator('input')
      .fill('Protocolo substituido por outro comunicado');
    await gestao.getByTestId('comunicado-confirmar').click();
    await semViolacaoAxe(page, '/mensagens (encerrar comunicado)');
    await confirmarPergunta(page);
    await expect(gestao.getByTestId('comunicado-encerrado')).toContainText('Protocolo substituido');
    await expect(gestao.getByTestId('comunicado-texto')).toContainText('versao 2');
    await expect(gestao.getByTestId('comunicado-destinatarios')).toContainText('SINT.MEDICO');
    await expect(gestao.getByTestId('comunicado-eventos')).toContainText('Erro de digitacao');
    await expect(gestao.getByTestId('comunicado-encurtar')).toHaveCount(0);
    await semViolacaoAxe(page, '/mensagens (comunicado encerrado)');

    // Para o médico que leu, o encerrado continua na caixa, marcado como encerrado.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/mensagens');
    await expect(page.getByTestId('tabela-recebidas')).toContainText(marca);
    await page
      .getByTestId('tabela-recebidas')
      .getByRole('button', { name: new RegExp(marca) })
      .click();
    await expect(page.getByTestId('mensagem-encerrada')).toContainText('Protocolo substituido');
    await expect(page.getByTestId('dar-ciencia')).toHaveCount(0);
  });

  test('relatórios: pedido editado e excluído; pedido respondido recusa a exclusão e é cancelado; envio agendado alterado (mascarado), desativado e excluído; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await entrar(page, 'SINT.ADMIN');
    const pedido = (titulo: string) => ({
      titulo,
      descricao: 'Lista dos atendimentos por setor com totais por dia.',
      finalidade: 'Acompanhar a ocupacao dos setores',
      area: 'Diretoria',
      prazo: diaLocal(20),
    });
    const a = await chamar(page, 'POST', '/api/relatorios/pedidos', pedido(`Pedido aberto ${marca}`));
    const b = await chamar(page, 'POST', '/api/relatorios/pedidos', pedido(`Pedido respondido ${marca}`));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const idA = String(a.corpo['id']);
    const idB = String(b.corpo['id']);
    const resp = await chamar(page, 'POST', `/api/relatorios/pedidos/${idB}/resposta`, {
      situacao: 'em-analise',
      relatorio: null,
      resposta: 'Em analise pela equipe de indicadores.',
    });
    expect(resp.status, JSON.stringify(resp.corpo)).toBe(200);

    await page.goto('/relatorios/pedidos');
    await expect(page.getByTestId('tabela-pedidos')).toContainText(marca);

    // Editar o pedido aberto: o motivo curto é recusado na tela; com o motivo, grava e vai ao histórico.
    await page.getByTestId(`pedido-editar-${idA}`).click();
    const form = page.getByTestId('pedido-novo');
    await form.getByLabel(/Área/).fill('Diretoria clinica');
    await page.getByTestId('pedido-motivo').locator('input').fill('abc');
    await page.getByTestId('pedido-enviar').click();
    await expect(page.getByTestId('pedido-motivo-curto')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/pedidos (editar pedido)');
    await page.getByTestId('pedido-motivo').locator('input').fill('A area que usa e a diretoria clinica');
    await page.getByTestId('pedido-enviar').click();
    await expect(page.getByTestId('pedido-feito')).toBeVisible();
    await expect(page.getByTestId(`pedido-${idA}`)).toContainText('Diretoria clinica');
    await page.getByTestId(`pedido-historico-${idA}`).click();
    await expect(page.getByTestId('pedido-historico')).toContainText('A area que usa e a diretoria clinica');

    // O respondido não se exclui: a recusa mostra o vínculo e oferece o cancelamento, feito com motivo.
    await page.getByTestId(`pedido-excluir-${idB}`).click();
    await page.getByTestId('acao-motivo-texto').locator('input').fill('Pedido feito em duplicidade');
    await page.getByTestId('acao-motivo-confirmar').click();
    await confirmarPergunta(page);
    await expect(page.getByTestId('recusa-vinculos')).toContainText('resposta do curador');
    await semViolacaoAxe(page, '/relatorios/pedidos (recusa da exclusão)');
    await page.getByTestId('recusa-vinculos-oferta').click();
    await page.getByTestId('acao-motivo-texto').locator('input').fill('Pedido feito em duplicidade');
    await page.getByTestId('acao-motivo-confirmar').click();
    await expect(page.getByTestId(`pedido-cancelado-${idB}`)).toContainText('Pedido feito em duplicidade');
    await expect(page.getByTestId(`pedido-excluir-${idB}`)).toHaveCount(0);

    // O aberto, nunca atendido, se exclui (com motivo e a pergunta de novo).
    await page.getByTestId(`pedido-excluir-${idA}`).click();
    await page.getByTestId('acao-motivo-texto').locator('input').fill('Pedido nao e mais necessario');
    await page.getByTestId('acao-motivo-confirmar').click();
    await confirmarPergunta(page);
    await expect(page.getByTestId(`pedido-${idA}`)).toHaveCount(0);

    // Envio agendado: Alterar mostra os endereços mascarados; o motivo é obrigatório; desativar e excluir com motivo.
    await page.goto('/relatorios/agendamentos');
    await escolherNoCombo(page.getByTestId('agendamento-relatorio'), 'atendimentosPorDia');
    const titulo = `Envio W0-09 ${marca}`;
    await page.getByLabel('Nome do envio').fill(titulo);
    await escolherNoCombo(page.getByTestId('agendamento-parametro-inicio'), 'ontem');
    await escolherNoCombo(page.getByTestId('agendamento-parametro-fim'), 'ontem');
    await page.getByTestId('agendamento-enderecos').fill('diretoria@sintetico.invalid');
    await page.getByTestId('agendamento-agendar').click();
    await expect(page.getByTestId('agendamento-aviso')).toContainText('Envio agendado');
    const linha = page.getByTestId('tabela-agendamentos').locator('tbody tr', { hasText: titulo });
    await linha.locator('[data-testid^="agendamento-alterar-"]').click();
    const mascarados = page.getByTestId('agendamento-mascarados');
    await expect(mascarados).toContainText('di***@si***.invalid');
    await expect(mascarados).not.toContainText('diretoria@sintetico.invalid');
    await page.getByLabel('Nome do envio').fill(`${titulo} (diario)`);
    await page.getByTestId('agendamento-motivo').locator('input').fill('abc');
    await page.getByTestId('agendamento-agendar').click();
    await expect(page.getByTestId('agendamento-motivo-curto')).toBeVisible();
    await semViolacaoAxe(page, '/relatorios/agendamentos (alterar envio)');
    await page.getByTestId('agendamento-motivo').locator('input').fill('Nome do envio mais claro');
    await page.getByTestId('agendamento-agendar').click();
    await expect(page.getByTestId('agendamento-aviso')).toBeVisible();
    const alterada = page
      .getByTestId('tabela-agendamentos')
      .locator('tbody tr', { hasText: `${titulo} (diario)` });
    await expect(alterada).toBeVisible();
    await expect(page.getByTestId('tabela-agendamentos')).not.toContainText('diretoria@sintetico.invalid');

    await alterada.locator('[data-testid^="agendamento-desativar-"]').click();
    await page.getByTestId('acao-motivo-texto').locator('input').fill('Diretoria pediu para pausar');
    await page.getByTestId('acao-motivo-confirmar').click();
    await expect(alterada.locator('[data-testid^="agendamento-ativar-"]')).toBeVisible();
    await alterada.locator('[data-testid^="agendamento-historico-"]').click();
    await expect(page.getByTestId('agendamento-historico')).toContainText('Diretoria pediu para pausar');
    await expect(page.getByTestId('agendamento-historico')).toContainText('Nome do envio mais claro');

    await alterada.locator('[data-testid^="agendamento-excluir-"]').click();
    await page.getByTestId('acao-motivo-texto').locator('input').fill('Envio criado so para o teste');
    await page.getByTestId('acao-motivo-confirmar').click();
    await confirmarPergunta(page);
    await expect(alterada).toHaveCount(0);
  });
});

/** O diálogo do ciclo (motivo e, quando pede, a senha): o motivo curto é recusado na tela antes de ir ao servidor. */
async function motivoCurtoRecusado(page: Page, senha = false): Promise<void> {
  const d = page.getByTestId('ciclo-dialogo');
  await expect(d).toBeVisible();
  await d.getByTestId('ciclo-motivo').fill('abc');
  // A senha é campo obrigatório do formulário: preenchida, o envio chega à conferência do motivo.
  if (senha) await d.getByTestId('ciclo-senha').fill(SENHA);
  await d.getByTestId('ciclo-confirmar').click();
  await expect(d.getByTestId('ciclo-falta')).toContainText('ao menos 5 caracteres');
}

async function confirmarCiclo(page: Page, motivo: string, senha = false): Promise<void> {
  const d = page.getByTestId('ciclo-dialogo');
  await d.getByTestId('ciclo-motivo').fill(motivo);
  if (senha) await d.getByTestId('ciclo-senha').fill(SENHA);
  await d.getByTestId('ciclo-confirmar').click();
}

test.describe('W0-09: coexistência e parâmetros com motivo em cada ação @W0-09', () => {
  test('coexistência: item do critério e do desligamento voltam a pendente; conclusão estornada; versão com conclusões recusa a retirada (409) e é inativada; registro do fim gravado pela tela e devolvido ao versionado; axe', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/migracao');

    // Onda 3: o item registrado como cumprido volta a pendente com motivo.
    await page.getByTestId('aba-migracao-onda3').click();
    await escolherNoCombo(page.getByTestId('onda3-filtro-setor'), 'farmacia-central');
    const central = page.getByTestId('onda3-setor-farmacia-central');
    await central.getByTestId('onda3-abrir-farmacia-central').click();
    const form3 = page.getByTestId('form-onda3');
    await escolherNoCombo(form3.getByTestId('onda3-item'), {
      rotulo: 'Inventário recente dos locais de estoque que entram',
    });
    await escolherNoCombo(form3.getByTestId('onda3-situacao'), 'cumprido');
    await form3.getByLabel(/^Evidência/).fill('ata W0-09 do comitê');
    await form3.getByLabel('Data do cumprimento').fill('01/12/2026');
    await form3.getByLabel('Data do cumprimento').blur();
    await form3.getByLabel('Justificativa').fill('Inventário dos locais da farmácia central (sintético)');
    await form3.getByTestId('onda3-gravar').click();
    const item = central.getByTestId('item-inventario-recente');
    await expect(item.getByTestId('situacao')).toHaveText('Cumprido');
    await page.getByTestId('voltar-pendente-farmacia-central-inventario-recente').click();
    await motivoCurtoRecusado(page);
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/onda3 (voltar a pendente)');
    await confirmarCiclo(page, 'Inventario refeito: a contagem anterior perdeu a validade');
    await expect(item.getByTestId('situacao')).toHaveText('Pendente');
    await expect(page.getByTestId('voltar-pendente-farmacia-central-inventario-recente')).toHaveCount(0);

    // Treinamento: trilha publicada e três conclusões; uma é estornada; a versão com conclusões não se exclui.
    await page.getByTestId('aba-migracao-treinamento').click();
    await page
      .getByTestId('exercicio-recepcao-1')
      .fill('Marcar e remarcar a consulta do paciente sintético.');
    await page.getByTestId('publicar-recepcao-1').click();
    await expect(page.getByTestId('mensagem-treino')).toContainText('Versão 1 publicada');
    const formT = page.getByTestId('form-conclusao');
    await formT
      .getByTestId('conclusao-turma')
      .locator('input, textarea')
      .first()
      .fill(`W9${marca}`.slice(0, 10));
    await formT.getByTestId('conclusao-logins').fill('SINT.TURMA01 SINT.TURMA02 SINT.TURMA03');
    await formT.getByTestId('conclusao-registrar').click();
    await expect(page.getByTestId('mensagem-treino')).toContainText('3 conclusão(ões) registrada(s)');
    const conclusoes = page.getByTestId('tabela-conclusoes');
    const turma03 = conclusoes.locator('tbody tr', { hasText: 'SINT.TURMA03' });
    await turma03.locator('[data-testid^="estornar-"]').click();
    await motivoCurtoRecusado(page);
    await confirmarCiclo(page, 'Pessoa saiu antes do fim da turma');
    await expect(page.getByTestId('mensagem-treino')).toContainText('Conclusão estornada');
    await expect(turma03).toHaveCount(0);

    await page.getByTestId('versoes-recepcao-1').locator('summary').click();
    await page.getByTestId('retirar-recepcao-1-1').click();
    await confirmarCiclo(page, 'Versao publicada com o exercicio errado');
    const recusa = page.getByTestId('ciclo-recusa');
    await expect(recusa).toBeVisible();
    // A conclusão estornada continua registrada (o estorno é fato novo): conta entre os vínculos.
    await expect(recusa).toContainText('turmas: 1');
    await expect(recusa).toContainText('conclusões de treinamento: 3');
    // Revisão: o total conta as conclusões; as turmas agrupam as mesmas linhas e ficam fora da soma (3, não 4).
    await expect(recusa).toContainText('3 registro(s) dependem deste.');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/treinamento (recusa da retirada)');
    await page.getByTestId('ciclo-oferta').click();
    await expect(page.getByTestId('mensagem-treino')).toContainText('Versão 1 inativada');
    await expect(page.getByTestId('versao-recepcao-1-1')).toContainText('retirada');
    await expect(page.getByTestId('retirar-recepcao-1-1')).toHaveCount(0);

    // Desligamento (gestor da migração): o item registrado volta a pendente com motivo e senha.
    await entrar(page, 'SINT.ONDA5');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('aba-migracao-desligamento').click();
    const sac = page.getByTestId('item-servico-sac-movel');
    await page.getByTestId('registrar-servico-sac-movel').click();
    const formD = page.getByTestId('form-desligamento');
    await escolherNoCombo(formD.getByTestId('desligamento-situacao'), 'aceito-como-perdido');
    await escolherNoCombo(formD.getByTestId('desligamento-contingencia'), 'nenhuma');
    await formD.getByLabel('Papel de quem aceitou').fill('atendimento ao cliente');
    await formD.getByLabel(/^Evidência/).fill('ata sintética W0-09');
    await formD.getByTestId('desligamento-senha').fill(SENHA);
    await formD.getByTestId('desligamento-gravar').click();
    await expect(sac.getByTestId('situacao')).toContainText('Aceito como perdido pela área');
    await page.getByTestId('voltar-pendente-servico-sac-movel').click();
    await motivoCurtoRecusado(page, true);
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/desligamento (voltar a pendente)');
    await confirmarCiclo(page, 'Area reabriu a avaliacao do aplicativo', true);
    await expect(sac.getByTestId('situacao')).toContainText('Pendente');
    await expect(page.getByTestId('voltar-pendente-servico-sac-movel')).toHaveCount(0);

    // Registro do fim: gravado pela tela (versão nova com motivo e senha) e devolvido ao registro versionado.
    await page.getByTestId('aba-migracao-fim').click();
    const reg = page.getByTestId('registro-coex-fim');
    await expect(reg.getByTestId('registro-coex-fonte')).toContainText('registro versionado');
    await reg.getByTestId('registro-coex-gravar').click();
    // Sem versão gravada, o editor abre vazio: o registro inteiro é digitado (o servidor confere o esquema e o
    // estabelecimento: o de outro é recusado).
    await page.getByTestId('registro-coex-conteudo').fill(
      JSON.stringify({
        formato: 1,
        estabelecimento: 'pc',
        contasCombinadas: [],
        dp6: { previstaPara: '2027-04-01' },
      }),
    );
    await motivoCurtoRecusado(page, true);
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/fim (gravar registro)');
    await confirmarCiclo(page, 'Registro do fim conferido pelo comite', true);
    await expect(reg.getByTestId('registro-coex-aviso')).toContainText('Nova versão do registro gravada');
    await expect(reg.getByTestId('registro-coex-fonte')).toContainText('gravada por esta tela');
    await expect(reg.getByTestId('registro-coex-historico')).toContainText(
      'Registro do fim conferido pelo comite',
    );
    await reg.getByTestId('registro-coex-voltar').click();
    await confirmarCiclo(page, 'Volta ao registro versionado do repositorio', true);
    await expect(reg.getByTestId('registro-coex-aviso')).toContainText(
      'Voltou a valer o registro versionado',
    );
    await expect(reg.getByTestId('registro-coex-fonte')).toContainText('Vale o registro versionado');
    await expect(reg.getByTestId('registro-coex-historico')).toContainText('volta ao registro versionado');
  });

  test('parâmetros: a sobreposição do estabelecimento é retirada com justificativa e o valor volta a ser herdado; a versão retirada fica visível; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const chave = 'cadastro.itensPorPagina';
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/parametros');
    await page.getByTestId(`definir-${chave}`).click();
    const form = page.getByTestId('form-parametro');
    await form.getByTestId('parametro-valor').fill('35');
    await form.getByLabel('Justificativa').fill('Sobreposicao sintetica do teste W0-09');
    await form.getByTestId('parametro-salvar').click();
    await expect(page.getByTestId('mensagem-parametro')).toContainText('Versão nova gravada');
    await expect(page.getByTestId(`parametro-${chave}`)).toContainText('35');

    const heranca = page.getByTestId(`heranca-${chave}`);
    await heranca.locator(`[data-testid^="herdar-${chave}-estabelecimento-"]`).click();
    const fh = page.getByTestId('form-herdar');
    await fh.getByTestId('herdar-justificativa').fill('curta');
    await fh.getByTestId('herdar-confirmar').click();
    await expect(fh.getByTestId('herdar-falta')).toContainText('10 caracteres');
    await semViolacaoAxe(page, '/administracao/parametros (voltar a herdar)');
    await fh.getByTestId('herdar-justificativa').fill('A sobreposicao do teste deixa de valer');
    await fh.getByTestId('herdar-confirmar').click();
    await expect(page.getByTestId('mensagem-parametro')).toContainText('volta a ser herdado');
    await expect(page.getByTestId(`parametro-${chave}`)).not.toContainText('35');
    await expect(page.getByTestId(`versoes-${chave}`)).toContainText(
      'A sobreposicao do teste deixa de valer',
    );
  });
});

test.describe('W0-09: perfis, mapa, segundo fator e hora confiável @W0-09', () => {
  test('perfis: concessão alterada (vigência e motivo) e revogada com motivo; a permissão efetiva muda na hora; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const motivo = `Auditoria interna W0-09 ${marca}`;
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/perfis');
    await page.getByTestId('perfis-senha').fill(SENHA);
    await page.getByTestId('perfis-busca').fill('SINT.MEDICO');
    await page.getByTestId('perfis-procurar').click();
    await page.getByTestId('perfis-usuario-SINT.MEDICO').click();
    const efetivas = page.getByTestId('perfis-efetivas');
    await escolherNoCombo(page.getByTestId('perfis-perfil'), 'auditor');
    await page.getByTestId('perfis-motivo').fill(motivo);
    await page.getByTestId('perfis-conceder-perfil').click();
    const linha = page.getByTestId('perfis-concessoes').locator('tbody tr', { hasText: marca });
    await expect(linha).toHaveCount(1);
    await expect(efetivas.locator('li', { hasText: /^auditor \(/ })).toHaveCount(1);

    // Alterar: nova vigência e motivo, com justificativa e senha (o motivo curto é recusado na tela).
    await linha.locator('[data-testid^="perfis-alterar-"]').click();
    const alt = page.getByTestId('perfil-alteracao');
    await alt.getByTestId('perfil-alteracao-fim').fill(agoraLocal(5));
    await alt.getByTestId('perfil-alteracao-motivo').fill('ab');
    await alt.getByTestId('perfil-alteracao-justificativa').fill('abc');
    await alt.getByTestId('perfil-alteracao-senha').fill(SENHA);
    await alt.getByTestId('perfil-alteracao-confirmar').click();
    await expect(alt.getByTestId('perfil-alteracao-falta')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/acesso/perfis (alterar concessão)');
    await alt.getByTestId('perfil-alteracao-motivo').fill(`${motivo} (prazo de cinco dias)`);
    await alt.getByTestId('perfil-alteracao-justificativa').fill('A auditoria termina nesta semana');
    await alt.getByTestId('perfil-alteracao-confirmar').click();
    await expect(page.getByTestId('perfis-aviso')).toContainText('Concessão alterada');
    await expect(linha).toContainText('prazo de cinco dias');
    await expect(linha).toContainText('1 alteração');
    await expect(efetivas.locator('li', { hasText: /^auditor \(/ })).toHaveCount(1);

    // Revogar com motivo e senha: a concessão fica no histórico com quem revogou; o perfil sai das efetivas.
    await linha.locator('[data-testid^="perfis-revogar-"]').click();
    const rev = page.getByTestId('perfil-revogacao');
    await rev.getByTestId('perfil-revogacao-motivo').fill('abc');
    await rev.getByTestId('perfil-revogacao-senha').fill(SENHA);
    await rev.getByTestId('perfil-revogacao-confirmar').click();
    await expect(rev.getByTestId('perfil-revogacao-falta')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/acesso/perfis (revogar concessão)');
    await rev.getByTestId('perfil-revogacao-motivo').fill('Auditoria encerrada antes do prazo');
    await rev.getByTestId('perfil-revogacao-confirmar').click();
    await expect(page.getByTestId('perfis-aviso')).toContainText('Perfil revogado');
    await expect(linha).toContainText('revogada por SINT.GESTOR: Auditoria encerrada antes do prazo');
    await expect(linha.locator('[data-testid^="perfis-revogar-"]')).toHaveCount(0);
    await expect(efetivas.locator('li', { hasText: /^auditor \(/ })).toHaveCount(0);
  });

  test('mapa: aprovado e voltado a proposta com a prévia de quem perde o acesso, motivo e senha; as efetivas mudam na hora; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/acesso/perfis');
    const efetivasDoMedico = async () => {
      await page.getByTestId('aba-usuario').click();
      await page.getByTestId('perfis-busca').fill('SINT.MEDICO');
      await page.getByTestId('perfis-procurar').click();
      await page.getByTestId('perfis-usuario-SINT.MEDICO').click();
      return page.getByTestId('perfis-permissoes');
    };
    const dialogo = page.getByTestId('mapa-decisao');
    const decidir = async (motivo: string) => {
      await expect(dialogo.getByTestId('mapa-previa')).toBeVisible();
      await dialogo.getByTestId('mapa-decisao-motivo').fill(motivo);
      await dialogo.getByTestId('mapa-decisao-senha').fill(SENHA);
      await dialogo.getByTestId('mapa-decisao-confirmar').click();
      await expect(page.getByTestId('perfis-aviso')).toBeVisible();
    };
    await expect(await efetivasDoMedico()).not.toContainText('perfil ouvidoria (mapa do grupo)');
    await page.getByTestId('aba-mapa').click();
    await escolherNoCombo(page.getByTestId('propor-grupo'), 'MEDICOS');
    await escolherNoCombo(page.getByTestId('propor-perfil'), 'ouvidoria');
    await page.getByTestId('propor').click();
    await decidir('Proposta da revisao de acessos W0-09');
    await page.getByTestId('aprovar-MEDICOS-ouvidoria').click();
    await decidir('Aprovado pela direcao (W0-09)');
    await expect(await efetivasDoMedico()).toContainText('perfil ouvidoria (mapa do grupo)');

    // Voltar a proposta: a prévia diz quantos perdem o acesso (e quem) antes de confirmar; o motivo curto é recusado.
    await page.getByTestId('aba-mapa').click();
    await page.getByTestId('voltar-MEDICOS-ouvidoria').click();
    await expect(dialogo.getByTestId('mapa-previa-perdem')).toContainText(
      /\d+ usuário\(s\) ativo\(s\) perdem/,
    );
    await expect(dialogo.getByTestId('mapa-previa-amostra')).toContainText('SINT.MEDICO');
    await dialogo.getByTestId('mapa-decisao-motivo').fill('abc');
    await dialogo.getByTestId('mapa-decisao-senha').fill(SENHA);
    await dialogo.getByTestId('mapa-decisao-confirmar').click();
    await expect(dialogo.getByTestId('mapa-decisao-falta')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/acesso/perfis (voltar o mapa a proposta)');
    await decidir('Revisao reaberta pela comissao de acessos');
    const linhaMapa = page.getByTestId('perfis-mapa-grupo').locator('tbody tr', { hasText: 'ouvidoria' });
    await expect(linhaMapa.filter({ hasText: 'MEDICOS' })).toContainText(/proposta/i);
    await expect(await efetivasDoMedico()).not.toContainText('perfil ouvidoria (mapa do grupo)');
  });

  test('segundo fator: a linha vigente tem o prazo e o alvo alterados com motivo e senha; axe', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await entrar(page, 'SINT.GESTOR');
    // A linha de partida começa daqui a 30 dias (não obriga ninguém durante o teste) e é encerrada no fim.
    const inicio = diaLocal(30);
    const criada = await chamar(page, 'POST', '/api/acesso/identidade/politica-2fa', {
      dados: {
        alvo: 'grupo',
        valor: 'MASTER',
        onda: 2,
        inicio,
        prazoAdesaoDias: 30,
        motivo: `Partida W0-09 ${marca}`,
      },
      senha: SENHA,
    });
    expect([200, 201]).toContain(criada.status);
    const id = String(criada.corpo['id']);
    let novaId = '';
    try {
      await page.goto('/administracao/acesso/2fa');
      await page.getByTestId(`politica-alterar-${id}`).click();
      const form = page.getByTestId('form-politica-alterar');
      await expect(form).toBeVisible();
      await escolherNoCombo(form.getByTestId('alterar-valor'), 'MEDICOS');
      await form.getByTestId('alterar-prazo').fill('20');
      await form.getByTestId('alterar-motivo').fill('abc');
      await form.getByTestId('alterar-senha').fill(SENHA);
      await form.getByTestId('alterar-confirmar').click();
      // O motivo curto não passa (o navegador ou a tela recusa) e nada muda.
      await expect(form).toBeVisible();
      await semViolacaoAxe(page, '/administracao/acesso/2fa (alterar a linha)');
      await form.getByTestId('alterar-motivo').fill('Comissao antecipou o grupo dos medicos');
      await form.getByTestId('alterar-senha').fill(SENHA);
      await form.getByTestId('alterar-confirmar').click();
      await expect(page.getByText('Linha alterada; a anterior ficou encerrada como alterada.')).toBeVisible();
      await expect(page.getByTestId(`politica-alterar-${id}`)).toHaveCount(0);
      const linhas = (await (await page.request.get('/api/acesso/identidade/politica-2fa')).json()) as {
        id: string;
        alvo: string;
        valor: string | null;
        prazoAdesaoDias: number;
        encerradaEm: string | null;
      }[];
      const nova = linhas.find((l) => !l.encerradaEm && l.valor === 'MEDICOS' && l.alvo === 'grupo');
      expect(nova?.prazoAdesaoDias).toBe(20);
      expect(linhas.find((l) => l.id === id)?.encerradaEm).toBeTruthy();
      novaId = nova?.id ?? '';
      await expect(page.getByTestId(`politica-alterar-${novaId}`)).toBeVisible();
    } finally {
      for (const alvo of [novaId, id].filter(Boolean))
        await chamar(page, 'POST', `/api/acesso/identidade/politica-2fa/${alvo}/encerrar`, {
          dados: { motivo: 'Fim do roteiro E2E do W0-09' },
          senha: SENHA,
        });
    }
  });

  test('saúde do sistema: o item hora confiável mostra o desvio contra o NTP e o limiar; o fuso é parâmetro', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/saude/fumaca');
    const item = page.getByTestId('fumaca-item-hora-confiavel');
    await expect(item).toContainText('Hora confiável (NTP)');
    expect(['ok', 'alerta']).toContain(await item.getAttribute('data-situacao'));
    await expect(item).toContainText(/limiar|Sem referência/);
    await page.goto('/administracao/parametros');
    await expect(page.getByTestId('parametro-sistema.fusoInstituicao')).toContainText('America/Sao_Paulo');
    await expect(page.getByTestId('parametro-sistema.ntpServidor')).toBeVisible();
  });
});
