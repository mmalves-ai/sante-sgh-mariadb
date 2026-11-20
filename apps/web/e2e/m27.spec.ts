// E2E @M27 @fase2 (ficha, seções 7, 8 e 10): a página inicial por perfil (só os componentes liberados), a fila do médico
// (só com vínculo: o paciente entra quando o médico registra no episódio), a central de avisos (só o risco grave
// interrompe, uma vez; o resto fica no sino), as mensagens e o comunicado com ciência (nenhum dado do paciente no
// texto; o paciente como contexto), as mensagens antigas e o dicionário pessoal; o tablet de 10 polegadas sem rolagem
// lateral; axe sem violação séria em cada tela. Sessão real sobre a fonte sintética de dev e as portas em MEMÓRIA
// (pacientes, senhas, avisos e mensagens SINTÉTICOS; nada vai à cópia). A jornada sobre o banco é a integração
// `packages/testes/src/integracao/m27-jornada.int.spec.ts`.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const agoraLocal = (somaDias = 0) => {
  const d = new Date(Date.now() + somaDias * 86_400_000 - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

test.describe('Página inicial, filas, avisos, mensagens e dicionário @M27 @fase2', () => {
  test.setTimeout(180_000);

  test('médico: a página inicial com a fila; a fila só com vínculo; a pendência abre a tela que resolve; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
    await expect(page.getByTestId('cartao-medico')).toBeVisible();
    await expect(page.getByTestId('cartao-mensagens')).toBeVisible();
    // Regra 1: a fila da recepção não é do perfil; a da enfermagem ainda não foi entregue.
    await expect(page.getByTestId('cartao-recepcao')).toHaveCount(0);
    await expect(page.getByTestId('cartao-enfermagem')).toHaveCount(0);
    await expect(page.getByTestId('sino')).toBeVisible();
    await semViolacaoAxe(page, '/inicio (médico)');

    // Regra 2: sem registro do médico no episódio, nenhum paciente é "dele".
    await page.getByTestId('cartao-medico').getByRole('link').first().click();
    await expect(page).toHaveURL(/\/inicio\/medico$/);
    await expect(page.getByTestId('tela-worklist-medico')).toBeVisible();
    await expect(page.getByTestId('wl-medico-vazia')).toBeVisible();
    await semViolacaoAxe(page, '/inicio/medico (vazia)');

    // O médico registra a evolução do paciente internado: o vínculo nasce e o paciente entra na fila.
    await page.goto('/pep/rascunhos');
    await page.getByTestId('busca-paciente-registro').fill('cinthya');
    await page.getByTestId('busca-paciente-registro').press('Enter');
    await page.getByTestId('registro-paciente-1003').getByRole('link').click();
    await page.getByTestId('modelo-EVAM').getByRole('link').click();
    await expect(page.getByTestId('form-renderer')).toBeVisible();
    await page.getByRole('textbox', { name: /Exame físico/ }).fill('Exame SINTETICO M27');
    await page.getByRole('textbox', { name: /Quadro clínico/ }).fill('Quadro SINTETICO M27');
    await page.getByTestId('finalizar-registro').click();
    await expect(page.getByTestId('registro-finalizado')).toBeVisible();

    await page.goto('/inicio/medico');
    const tabela = page.getByTestId('tabela-worklist-medico');
    await expect(tabela).toBeVisible();
    const linha = tabela.locator('tbody tr').first();
    await expect(linha).toContainText(/CINTHYA/i);
    await expect(page.getByTestId('wl-medico-contagem')).toContainText('paciente(s)');
    await semViolacaoAxe(page, '/inicio/medico (com vínculo)');
    // O filtro "só internados" e o link do prontuário (a autorização normal do prontuário).
    await escolher(page.getByTestId('wl-medico-filtro'), 'pendentes');
    await esperarValor(page.getByTestId('wl-medico-filtro'), 'pendentes');
    await escolher(page.getByTestId('wl-medico-filtro'), 'todos');
    await esperarValor(page.getByTestId('wl-medico-filtro'), 'todos');
    await linha.getByRole('link', { name: /Abrir o prontuário/ }).click();
    await expect(page).toHaveURL(/\/pep\/paciente\/1003/);

    // A página inicial agora mostra o paciente no cartão do médico.
    await page.goto('/inicio');
    await expect(page.getByTestId('topo-medico')).toContainText(/CINTHYA/i);
    expect(externas).toEqual([]);
  });

  test('avisos e mensagens: o risco grave interrompe uma vez; comunicado com ciência; mensagem sem dado do paciente; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O gestor da comunicação: o aviso grave interrompe (uma vez nesta sessão); o informativo fica só no sino.
    await entrar(page, 'SINT.COMUNICACAO');
    const interrupcao = page.getByTestId('aviso-interrupcao-texto');
    await expect(interrupcao).toContainText('Alergia');
    await semViolacaoAxe(page, 'aviso grave');
    await page.getByTestId('aviso-entendi').click();
    await expect(interrupcao).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
    await expect(interrupcao).toHaveCount(0);
    await expect(page.getByTestId('sino-selo')).toHaveText('2');
    await page.getByTestId('sino').click();
    const central = page.getByTestId('central-avisos');
    await expect(central).toBeVisible();
    await expect(central.locator('li')).toHaveCount(2);
    await semViolacaoAxe(page, 'central de avisos');
    const informativo = central.locator('li').filter({ hasText: 'Resultado' });
    await informativo.getByRole('button', { name: 'Resolver' }).click();
    await expect(informativo).toContainText('Resolvido');
    await expect(page.getByTestId('sino-selo')).toHaveText('1');

    // Comunicado com vigência e ciência obrigatória para o médico.
    await page.goto('/mensagens');
    await expect(page.getByTestId('tela-mensagens')).toBeVisible();
    await page.getByTestId('aba-comunicado').click();
    await page.getByTestId('msg-valor-destino').locator('input').fill('SINT.MEDICO');
    await page.getByTestId('msg-adicionar-destino').click();
    await expect(page.getByTestId('msg-destinos')).toContainText('SINT.MEDICO');
    await page.getByTestId('msg-assunto').locator('input').fill('Comunicado SINTETICO M27');
    await page.getByTestId('msg-texto').locator('textarea').fill('Novo protocolo de passagem de plantão.');
    await page.getByTestId('msg-vigencia-inicio').fill(agoraLocal(-1));
    await page.getByTestId('msg-vigencia-fim').fill(agoraLocal(7));
    await semViolacaoAxe(page, 'novo comunicado');
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Comunicado publicado para 1');

    // Mensagem: o CPF no texto é recusado na tela (regra 7); o paciente vai como contexto.
    await page.getByTestId('aba-nova').click();
    await page.getByTestId('msg-valor-destino').locator('input').fill('SINT.MEDICO');
    await page.getByTestId('msg-adicionar-destino').click();
    await page.getByTestId('msg-assunto').locator('input').fill('Paciente do leito 12');
    await page.getByTestId('msg-texto').locator('textarea').fill('CPF 123.456.789-09: rever a prescrição.');
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('erro-texto')).toContainText('CPF');
    await page.getByTestId('msg-texto').locator('textarea').fill('Favor rever a prescrição antes das 14 h.');
    // Sem acesso ao prontuário, o gestor não põe paciente como contexto (revisão do M27): recusa e envia sem ele.
    const contexto = page.getByTestId('msg-contexto-atendimento').locator('input');
    await contexto.fill('10031');
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('recusa-trabalho')).toContainText('acesso ao prontuário');
    await contexto.fill('');
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Mensagem enviada a 1');
    await expect(page.getByTestId('tabela-enviadas')).toContainText('Paciente do leito 12');
    await semViolacaoAxe(page, 'mensagens enviadas');

    // O médico: o sino mostra as novas; abre o comunicado e dá a ciência; a mensagem abre o prontuário do contexto.
    await entrar(page, 'SINT.MEDICO');
    await expect(page.getByTestId('sino-selo')).not.toHaveText('0');
    await page.goto('/mensagens');
    const recebidas = page.getByTestId('tabela-recebidas');
    await expect(recebidas).toContainText('Comunicado SINTETICO M27');
    await recebidas.getByRole('button', { name: /Comunicado SINTETICO M27/ }).click();
    await expect(page.getByTestId('mensagem-texto')).toContainText('passagem de plantão');
    await page.getByTestId('dar-ciencia').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Ciência registrada');
    await recebidas.getByRole('button', { name: /Paciente do leito 12/ }).click();
    await expect(page.getByTestId('mensagem-texto')).toContainText('rever a prescrição');
    await expect(page.getByTestId('msg-contexto')).toHaveCount(0);
    // O médico (com o prontuário) põe o paciente como contexto; a mensagem abre o prontuário do contexto.
    await page.getByTestId('aba-nova').click();
    await page.getByTestId('msg-valor-destino').locator('input').fill('SINT.MEDICO');
    await page.getByTestId('msg-adicionar-destino').click();
    await page.getByTestId('msg-assunto').locator('input').fill('Paciente para a visita');
    await page.getByTestId('msg-texto').locator('textarea').fill('Rever na visita da tarde.');
    await page.getByTestId('msg-contexto-atendimento').locator('input').fill('10031');
    await page.getByTestId('msg-enviar').click();
    await expect(page.getByTestId('msg-aviso')).toContainText('Mensagem enviada a 1');
    await page.getByTestId('aba-recebidas').click();
    await recebidas.getByRole('button', { name: /Paciente para a visita/ }).click();
    await expect(page.getByTestId('msg-contexto')).toHaveAttribute('href', '/pep/paciente/1003');
    await semViolacaoAxe(page, 'mensagem aberta');
    // As mensagens antigas (só consulta).
    await page.getByTestId('aba-anteriores').click();
    await expect(page.getByTestId('tabela-anteriores').locator('tbody tr')).toHaveCount(2);
    await semViolacaoAxe(page, 'mensagens antigas');
    expect(externas).toEqual([]);
  });

  test('dicionário pessoal: incluir, a recusa repetida e excluir; axe; tablet sem rolagem lateral', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/preferencias/dicionario');
    await expect(page.getByTestId('tela-dicionario')).toBeVisible();
    await semViolacaoAxe(page, '/preferencias/dicionario');
    const palavra = page.getByTestId('dic-palavra').locator('input');
    await palavra.fill('Eletrocardiograma');
    await page.getByTestId('dic-incluir').click();
    await expect(page.getByTestId('dic-aviso')).toContainText('incluída');
    await expect(page.getByTestId('dic-lista')).toContainText('eletrocardiograma');
    await palavra.fill('Eletrocardiograma');
    await page.getByTestId('dic-incluir').click();
    await expect(page.getByTestId('recusa-trabalho')).toContainText('já está no seu dicionário');
    await page.getByTestId('dic-palavra').locator('input').fill('duas palavras');
    await page.getByTestId('dic-incluir').click();
    await expect(page.getByTestId('dic-erro-campo')).toContainText('Uma palavra só');
    const excluir = page.locator('[data-testid^="dic-excluir-"]').first();
    await excluir.click();
    await page
      .getByRole('button', { name: /Confirmar|Excluir/ })
      .last()
      .click();
    await expect(page.getByTestId('dic-aviso')).toContainText('excluída');

    // Tablet de 10 polegadas: a página inicial e a fila do médico cabem na largura.
    await page.setViewportSize({ width: 800, height: 1280 });
    for (const rota of ['/inicio', '/inicio/medico', '/mensagens']) {
      await page.goto(rota);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const largura = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(largura, `${rota} sem rolagem lateral`).toBeLessThanOrEqual(1);
    }
    await semViolacaoAxe(page, '/mensagens (tablet)');
    expect(externas).toEqual([]);
  });
});
