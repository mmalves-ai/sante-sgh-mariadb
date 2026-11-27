// E2E @C2-023 (08-INTG L133): comunicação com o paciente pela Hal-AI. O administrador grava um modelo de confirmação do
// cliente inteiro (com a conferência das variáveis na hora), a regra da véspera da marcação ligada a ele, gera os avisos
// dos eventos pelo botão e abre a visão por paciente com a coluna do efeito da resposta na marcação. axe sem violação
// séria. Fonte sintética de dev (nomes e números fictícios); nada sai da VM (sem rede externa).
// O E2E padrão roda sem banco (fonte sintética): as rotas das mensagens só têm a porta própria e responderiam 503. A
// resposta da API é simulada aqui seguindo o contrato de comunicacao.controller.ts (itens, { id }, resumo do disparo e
// visão por paciente com o efeito da resposta); as regras do banco são provadas no contrato de efeito
// mensagens-paciente-eventos-propria.int.spec.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

/** A API das mensagens pelo contrato, com estado: modelos e regras gravados, disparo uma vez por regra e marcação. */
async function simularApiMensagens(page: Page): Promise<void> {
  const modelos: Record<string, unknown>[] = [];
  const regras: Record<string, unknown>[] = [];
  let disparos = 0;
  await page.route(/\/api\/integracoes\/mensagens\//, async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(/^.*\/api\/integracoes\/mensagens\//, '');
    const corpo = (req.postDataJSON() as Record<string, unknown> | null) ?? {};
    const metodo = req.method();
    if (metodo === 'GET' && caminho === 'modelos') return json(rota, { itens: modelos });
    if (metodo === 'GET' && caminho === 'regras') return json(rota, { itens: regras });
    if (metodo === 'PUT' && (caminho === 'modelos' || caminho === 'modelos/cliente')) {
      const id = modelos.length + 1;
      modelos.push({
        id,
        doCliente: caminho === 'modelos/cliente',
        codigo: corpo['codigo'],
        descricao: corpo['descricao'],
        finalidade: corpo['finalidade'],
        canal: corpo['canal'],
        assunto: corpo['assunto'] ?? null,
        corpo: corpo['corpo'],
        respostaConfirmacao: corpo['respostaConfirmacao'] ?? null,
        respostaRecusa: corpo['respostaRecusa'] ?? null,
        janelaInicio: null,
        janelaFim: null,
        ativo: true,
        versao: 1,
      });
      return json(rota, { id });
    }
    if (metodo === 'PUT' && caminho === 'regras') {
      const m = modelos.find((x) => x['id'] === Number(corpo['modeloId']));
      if (!m) return json(rota, { title: 'Regra recusada', detail: 'Modelo não encontrado.' }, 422);
      const id = regras.length + 1;
      regras.push({
        id,
        codigo: corpo['codigo'],
        descricao: corpo['descricao'],
        modeloId: m['id'],
        modelo: m['descricao'],
        gatilho: corpo['gatilho'],
        canal: m['canal'],
        antecedenciaMinutos: corpo['antecedenciaMinutos'] ?? null,
        horaInicio: corpo['horaInicio'] ?? null,
        horaFim: corpo['horaFim'] ?? null,
        maximoEnviosPaciente: null,
        exigeConsentimento: true,
        ativo: true,
        versao: 1,
      });
      return json(rota, { id });
    }
    if (metodo === 'POST' && caminho === 'disparo') {
      disparos += 1;
      return json(
        rota,
        disparos === 1 ? { pedidos: 2, recusados: { 'sem-contato': 1 } } : { pedidos: 0, recusados: {} },
      );
    }
    if (metodo === 'GET' && caminho.startsWith('paciente/'))
      return json(rota, {
        itens: [
          {
            id: 1,
            motivo: 'confirmacao',
            canal: 'whatsapp',
            regra: regras[0]?.['codigo'] ?? null,
            situacao: 'enviado',
            agendadoPara: '2026-11-27T11:00:00.000Z',
            enviadoEm: '2026-11-27T11:00:05.000Z',
            canceladoEm: null,
            motivoCancelamento: null,
            retornos: [
              {
                tipo: 'resposta',
                recebidoEm: '2026-11-27T11:10:00.000Z',
                respostaInterpretada: 'confirmacao',
                efeitoResposta: 'confirmar_presenca',
              },
            ],
          },
        ],
      });
    return json(rota, { title: 'Não simulado', detail: `${metodo} ${caminho}` }, 404);
  });
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Mensagens ao paciente pelos eventos @C2-023', () => {
  test('modelo do cliente, regra da véspera, avisos gerados e efeito da resposta na visão por paciente', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await simularApiMensagens(page);
    const sufixo = Date.now().toString(36).slice(-6);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/admin/integracoes/mensagens');
    const painel = page.getByTestId('mensagens-painel');
    await expect(painel).toBeVisible();

    // Modelo: a variável desconhecida é recusada na hora e trava o botão; corrigida, o modelo do cliente é gravado.
    const modelo = page.getByTestId('mensagens-novo-modelo');
    await modelo.getByLabel('Código').fill(`CONF${sufixo}`);
    await modelo.getByLabel('Descrição').fill(`Confirmação da véspera ${sufixo}`);
    await escolher(modelo.getByRole('combobox', { name: 'Finalidade' }), 'confirmacao');
    await escolher(modelo.getByRole('combobox', { name: 'Canal' }), 'whatsapp');
    await modelo
      .getByLabel('Texto')
      .fill('Olá {{paciente_nome}}, confirma {{servico}} em {{data}} às {{hora}}? {{senha}}');
    await expect(modelo.getByRole('alert')).toContainText('Variável desconhecida: senha');
    await expect(modelo.getByRole('button', { name: 'Gravar' })).toBeDisabled();
    await modelo
      .getByLabel('Texto')
      .fill('Olá {{paciente_nome}}, confirma {{servico}} em {{data}} às {{hora}}? Responda SIM ou NAO.');
    await modelo.getByLabel('Resposta que confirma').fill('SIM');
    await modelo.getByLabel('Resposta que recusa').fill('NAO');
    await page.getByTestId('mensagens-modelo-cliente').check();
    await modelo.getByRole('button', { name: 'Gravar' }).click();
    await expect(painel.getByRole('status')).toContainText('Gravado.');
    await expect(page.getByTestId('mensagens-modelos')).toContainText(`CONF${sufixo}`);

    // Regra da véspera (24 h antes, das 8h às 20h no fuso do estabelecimento) ligada ao modelo novo.
    const regra = page.getByTestId('mensagens-nova-regra');
    await regra.getByLabel('Código').fill(`VESP${sufixo}`);
    await regra.getByLabel('Descrição').fill(`Véspera da marcação ${sufixo}`);
    await escolher(regra.getByRole('combobox', { name: 'Modelo' }), {
      rotulo: new RegExp(`Confirmação da véspera ${sufixo}`),
    });
    await escolher(regra.getByRole('combobox', { name: 'Aviso' }), 'lembrete_agendamento');
    await regra.getByLabel('Antecedência (minutos)').fill('1440');
    await regra.getByRole('button', { name: 'Gravar' }).click();
    await expect(painel.getByRole('status')).toContainText('Gravado.');
    await expect(page.getByTestId('mensagens-regras')).toContainText(`VESP${sufixo}`);

    // Os avisos dos eventos são gerados na hora (uma vez por regra e marcação): o resumo traz os gerados e os recusados.
    await page.getByTestId('mensagens-gerar').click();
    await expect(painel.getByRole('status')).toContainText(/Avisos gerados: \d+\. Recusados: \d+\./);
    // Repetir não duplica: o segundo disparo não gera de novo os mesmos avisos.
    await page.getByTestId('mensagens-gerar').click();
    await expect(painel.getByRole('status')).toContainText('Avisos gerados: 0.');

    // Visão por paciente: a tabela traz a coluna do efeito da resposta na marcação.
    await page.getByTestId('mensagens-paciente').fill('1');
    const pedidos = page.getByTestId('mensagens-pedidos');
    const nenhum = painel.getByText('Nenhuma mensagem para este paciente.');
    await expect(pedidos.or(nenhum)).toBeVisible();
    if (await pedidos.isVisible()) {
      await expect(pedidos).toContainText('Efeito na marcação');
      await expect(pedidos).toContainText('Presença confirmada');
    }

    await semViolacaoAxe(page, '/admin/integracoes/mensagens');
    expect(externas).toEqual([]);
  });
});
