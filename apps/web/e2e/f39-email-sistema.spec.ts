// E2E @F3.9-04 (01-ADM linha 77): e-mail do sistema pela tela "Servidor de e-mail e notificações".
// A manutenção exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas de
// /api/administracao/email são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela:
// - servidor: a senha digitada no lugar da referência do cofre é recusada na hora (o botão trava sem ir ao
//   servidor); a troca da segurança leva a porta habitual; o pedido de gravação não leva senha; o teste de conexão
//   só libera com o cadastro gravado e mostra o resultado e quando foi;
// - modelo: os campos nascem dos marcadores do texto, a pré-visualização troca cada um pelo exemplo e aponta o que
//   falta; marcador mal escrito trava o botão; o pedido leva os campos com descrição e exemplo;
// - C1-063: autenticação sem SSL/TLS nem STARTTLS é recusada na hora; a senha do servidor vai num campo só de
//   escrita, direto à rota do cofre (com a versão lida), o campo se esvazia e a tela mostra só "senha guardada";
// - registro de envio: situação, tentativas e identificador da mensagem, com filtro por situação.
// O efeito no banco está nos contratos de efeito email-configuracao-propria.int.spec.ts (API) e
// registro-envio-proprio.int.spec.ts (worker).
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

test.describe('F3.9 e-mail do sistema: servidor, modelo e registro de envio @F3.9 @F3.9-04', () => {
  test('@C1-063 grava o servidor sem senha, testa a conexão, guarda a senha no cofre, grava o modelo com os campos e filtra os envios', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const servidores: Record<string, unknown>[] = [];
    const modelos: Record<string, unknown>[] = [];
    const envios = [
      {
        id: 1,
        ocorridoEm: '2026-11-24T12:00:00.000Z',
        finalidade: null,
        modelo: null,
        assunto: 'ALERTA SINTETICO A',
        situacao: 'capturado',
        tentativas: 1,
        enviadoEm: '2026-11-24T12:00:01.000Z',
        identificadorMensagem: '<alerta-a.1.1@sintetico.invalid>',
        erro: null,
        destinatarios: [{ tipo: 'para', email: 'destino@sintetico.invalid', situacao: 'capturado' }],
      },
      {
        id: 2,
        ocorridoEm: '2026-11-24T12:05:00.000Z',
        finalidade: null,
        modelo: null,
        assunto: 'ALERTA SINTETICO B',
        situacao: 'falhou',
        tentativas: 3,
        enviadoEm: null,
        identificadorMensagem: '<alerta-b.2.1@sintetico.invalid>',
        erro: 'Error: resposta 451',
        destinatarios: [{ tipo: 'para', email: 'destino@sintetico.invalid', situacao: 'rejeitado' }],
      },
    ];
    await page.route('**/api/administracao/email**', (r) => {
      const req = r.request();
      const caminho = new URL(req.url()).pathname.replace('/api/administracao/email', '');
      if (req.method() === 'GET')
        return json(r, {
          saidaDeTeste: true,
          finalidades: [{ codigo: 'LAUDO', descricao: 'FINALIDADE SINTETICA' }],
          servidores,
          modelos,
          envios,
        });
      const c = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo: c });
      expect(req.headers()['idempotency-key']).toBeTruthy();
      if (caminho === '/servidores') {
        servidores.push({
          ...c,
          id: 701,
          versao: 1,
          ultimoTesteEm: null,
          ultimoTesteSucesso: null,
          senhaDefinida: false,
        });
        return json(r, { resultado: { servidor: 701 }, repetida: false });
      }
      if (caminho === '/servidores/701/teste') {
        Object.assign(servidores[0]!, {
          versao: 2,
          ultimoTesteEm: '2026-11-24T12:10:00.000Z',
          ultimoTesteSucesso: true,
        });
        return json(r, {
          resultado: { servidor: 701, sucesso: true, detalhe: 'Servidor respondeu.' },
          repetida: false,
        });
      }
      if (caminho === '/servidores/701/senha') {
        Object.assign(servidores[0]!, {
          versao: 3,
          ultimoTesteEm: null,
          ultimoTesteSucesso: null,
          senhaDefinida: true,
        });
        return json(r, { resultado: { servidor: 701, senhaDefinida: true }, repetida: false });
      }
      if (caminho === '/modelos') {
        modelos.push({ ...c, id: 801, versao: 1 });
        return json(r, {
          resultado: { modelo: 801, campos: (c['campos'] as unknown[]).length },
          repetida: false,
        });
      }
      return json(r, { codigo: 'nao-encontrado', title: 'Não encontrado' }, 404);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/notificacoes');
    const painel = page.getByTestId('email-sistema');
    await expect(painel).toBeVisible();
    const aviso = page.getByTestId('email-sistema-mensagem');

    // ── Servidor: validação na hora, sem ir ao servidor ──
    const servidor = page.getByTestId('email-servidor');
    const gravarServidor = page.getByTestId('email-servidor-gravar');
    await servidor.getByLabel('Código do servidor').fill('SAIDA1');
    await servidor.getByLabel('Nome do servidor').fill('SERVIDOR SINTETICO');
    await servidor.getByLabel('Endereço do servidor').fill('smtp.sintetico.invalid');
    await servidor.getByLabel('E-mail do remetente').fill('nao-responda@sintetico.invalid');
    await servidor.getByLabel('Usuário de autenticação').fill('envio-sintetico');
    await servidor.getByLabel('Referência da senha no cofre').fill('Segredo#2026');
    await expect(page.getByTestId('email-servidor-recusa')).toContainText('nunca a senha');
    await expect(gravarServidor).toBeDisabled();
    await servidor.getByLabel('Referência da senha no cofre').fill('email/saida/sintetico');
    await expect(page.getByTestId('email-servidor-recusa')).toHaveCount(0);
    await expect(gravarServidor).toBeEnabled();
    // A troca da segurança leva a porta habitual.
    await expect(servidor.getByLabel('Porta')).toHaveValue('587');
    // Autenticação sem cifra: recusada na hora (a senha nunca trafega aberta).
    await escolher(page.getByTestId('email-servidor-seguranca'), { rotulo: 'Nenhuma' });
    await expect(page.getByTestId('email-servidor-recusa')).toContainText('sem cifra');
    await escolher(page.getByTestId('email-servidor-seguranca'), { rotulo: 'SSL/TLS' });
    await expect(servidor.getByLabel('Porta')).toHaveValue('465');
    await expect(page.getByTestId('email-servidor-testar')).toHaveCount(0);
    await gravarServidor.click();
    await expect(aviso).toHaveText('Gravado.');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.caminho).toBe('/servidores');
    expect(pedidos[0]!.corpo).toMatchObject({
      codigo: 'SAIDA1',
      host: 'smtp.sintetico.invalid',
      porta: 465,
      seguranca: 'ssl_tls',
      exigeAutenticacao: true,
      usuarioAutenticacao: 'envio-sintetico',
      referenciaCofre: 'email/saida/sintetico',
      todosEstabelecimentos: false,
    });
    // O pedido não leva senha em campo nenhum.
    expect(Object.keys(pedidos[0]!.corpo).filter((k) => /senha|segredo|password/i.test(k))).toEqual([]);
    expect(JSON.stringify(pedidos[0]!.corpo)).not.toContain('Segredo#2026');

    // ── Teste de conexão: só com o cadastro gravado; mostra o resultado e quando foi ──
    await expect(page.getByTestId('email-servidor-teste')).toHaveText('Conexão nunca testada.');
    const testar = page.getByTestId('email-servidor-testar');
    await servidor.getByLabel('Nome do servidor').fill('SERVIDOR SINTETICO B');
    await expect(testar).toBeDisabled();
    await servidor.getByLabel('Nome do servidor').fill('SERVIDOR SINTETICO');
    await expect(testar).toBeEnabled();
    await testar.click();
    await expect(aviso).toHaveText('Conexão testada: o servidor respondeu.');
    await expect(page.getByTestId('email-servidor-teste')).toContainText('o servidor respondeu');
    await expect(page.getByTestId('email-servidor-teste')).toContainText('24/11/2026');
    expect(pedidos[1]!.caminho).toBe('/servidores/701/teste');

    // ── Senha do servidor (C1-063): só escrita, vai direto ao cofre; a tela mostra só se está guardada ──
    await expect(page.getByTestId('email-servidor-senha-situacao')).toContainText('ainda não guardada');
    const campoSenha = page.getByTestId('email-servidor-senha-campo');
    const gravarSenha = page.getByTestId('email-servidor-senha-gravar');
    await expect(gravarSenha).toBeDisabled();
    await campoSenha.fill('Sintetica#Cofre1');
    await gravarSenha.click();
    await expect(aviso).toHaveText('Senha guardada no cofre. Teste a conexão de novo.');
    await expect(page.getByTestId('email-servidor-senha-situacao')).toHaveText('Senha guardada no cofre.');
    await expect(campoSenha).toHaveValue('');
    expect(pedidos[2]).toEqual({
      caminho: '/servidores/701/senha',
      corpo: { versao: 2, senha: 'Sintetica#Cofre1' },
    });

    // ── Modelo: campos pelos marcadores, pré-visualização e validação na hora ──
    const modelo = page.getByTestId('email-modelo');
    const gravarModelo = page.getByTestId('email-modelo-gravar');
    await modelo.getByLabel('Código do modelo').fill('LAUDO.PRONTO');
    await modelo.getByLabel('Nome do modelo').fill('MODELO SINTETICO');
    await modelo.getByLabel('Assunto').fill('Pedido {{pedido.numero}} pronto');
    await modelo.getByLabel('Corpo da mensagem (HTML)').fill('<p>Olá, {{pessoa.nome}}.</p>');
    await expect(gravarModelo).toBeDisabled();
    await escolher(page.getByTestId('email-modelo-finalidade'), { rotulo: 'FINALIDADE SINTETICA' });
    await expect(gravarModelo).toBeEnabled();
    const campos = page.getByTestId('email-modelo-campos');
    await campos.getByLabel('Descrição de pessoa.nome').fill('Nome da pessoa');
    await campos.getByLabel('Exemplo de pessoa.nome').fill('PESSOA SINTETICA');
    const previa = page.getByTestId('email-previa');
    await expect(previa).toContainText('<p>Olá, PESSOA SINTETICA.</p>');
    await expect(page.getByTestId('email-previa-faltando')).toHaveText('Sem exemplo: pedido.numero');
    await campos.getByLabel('Exemplo de pedido.numero').fill('123');
    await expect(previa).toContainText('Pedido 123 pronto');
    await expect(page.getByTestId('email-previa-faltando')).toHaveCount(0);
    // Marcador mal escrito trava o botão sem ir ao servidor.
    await modelo.getByLabel('Assunto').fill('Pedido {{Pedido Numero}} pronto');
    await expect(page.getByTestId('email-modelo-recusa')).toContainText('Marcador mal escrito');
    await expect(gravarModelo).toBeDisabled();
    await modelo.getByLabel('Assunto').fill('Pedido {{pedido.numero}} pronto');
    await gravarModelo.click();
    await expect(aviso).toHaveText('Gravado.');
    expect(pedidos[3]!.caminho).toBe('/modelos');
    expect(pedidos[3]!.corpo).toMatchObject({
      finalidade: 'LAUDO',
      codigo: 'LAUDO.PRONTO',
      assunto: 'Pedido {{pedido.numero}} pronto',
      corpoHtml: '<p>Olá, {{pessoa.nome}}.</p>',
      campos: [
        { marcador: 'pedido.numero', descricao: 'pedido.numero', exemplo: '123' },
        { marcador: 'pessoa.nome', descricao: 'Nome da pessoa', exemplo: 'PESSOA SINTETICA' },
      ],
    });
    expect(pedidos).toHaveLength(4);

    // ── Registro de envio: situação, tentativas e identificador; filtro por situação ──
    const tabela = page.getByTestId('email-envios');
    await expect(tabela.locator('tbody tr')).toHaveCount(2);
    await expect(tabela).toContainText('<alerta-a.1.1@sintetico.invalid>');
    await expect(tabela).toContainText('Capturado (caixa de teste)');
    await escolher(page.getByTestId('email-envios-filtro'), { rotulo: 'Falhou' });
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    const linha = tabela.locator('tbody tr').first();
    await expect(linha).toContainText('ALERTA SINTETICO B');
    await expect(linha).toContainText('Error: resposta 451');
    await expect(linha.locator('td').nth(3)).toHaveText('3');
    await escolher(page.getByTestId('email-envios-filtro'), { rotulo: 'Cancelado' });
    await expect(page.getByTestId('email-envios-vazio')).toBeVisible();

    await semViolacaoAxe(page, '/administracao/notificacoes (e-mail do sistema)');
  });
});
