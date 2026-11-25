// C2-014 (06-SUS linha 65): transplante para a central estadual, pelo caminho da tela. As rotas /api/sus/transplante
// exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas destas rotas são
// simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a rota abre pelo menu do faturamento SUS, a
// busca escolhe o paciente (visão por paciente), a inscrição do receptor é validada na hora (sem órgão o botão fica
// travado) e vai com o paciente e o órgão; a ficha aberta mostra o histórico pendente e a saída da lista pede a data
// do transplante; o número da central registra o envio; a notificação de doador recusa na hora a abordagem
// antes do protocolo concluído, e o desfecho encerra a notificação com os órgãos doados; o protocolo da central é
// digitado de volta. O efeito no banco (número pela sequência, histórico, envio, versão, trilha, isolamento) está no
// contrato de efeito apps/api/src/modulos/sus/transplante-propria.int.spec.ts.
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

const PACIENTE = { id: 9001, nome: 'Paciente Sintético Receptor', prontuario: '900001', cns: null };

test.describe('C2-014 transplante para a central estadual @C2-014', () => {
  test('receptor inscrito e enviado à central; doador notificado, encerrado e com protocolo', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const inscricoes: Record<string, unknown>[] = [];
    const notificacoes: Record<string, unknown>[] = [];
    const historico: Record<string, unknown>[] = [];
    await page.route('**/api/sus/transplante/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const c = url.pathname.replace('/api/sus/transplante', '');
      if (req.method() === 'GET') {
        if (c === '/opcoes')
          return json(r, {
            orgaos: [
              { id: 1, codigo: 'rim', descricao: 'Rim', tipo: 'orgao' },
              { id: 2, codigo: 'figado', descricao: 'Fígado', tipo: 'orgao' },
            ],
            centrais: [{ id: 5, sigla: 'CET-S', nome: 'Central sintética de transplantes' }],
            profissionais: [{ id: 31, nome: 'Profissional Sintético' }],
          });
        if (c === '/pacientes') return json(r, { itens: [PACIENTE] });
        if (c === '/inscricoes') return json(r, { itens: inscricoes });
        if (c.startsWith('/inscricoes/')) return json(r, { ...inscricoes[0], historico });
        if (c === '/notificacoes') return json(r, { itens: notificacoes });
        return json(r, notificacoes[0]);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (c === '/inscricoes') {
        inscricoes.push({
          id: 801,
          paciente: PACIENTE.id,
          pacienteNome: PACIENTE.nome,
          prontuario: PACIENTE.prontuario,
          cns: null,
          orgao: corpo['orgao'],
          orgaoDescricao: 'Rim',
          tipoPaciente: 'receptor',
          numeroCentral: null,
          dataInscricao: corpo['dataInscricao'],
          prioridade: corpo['prioridade'],
          situacao: 'ativa',
          apto: true,
          motivo: null,
          dataTransplante: null,
          notificacaoDoador: null,
          responsavel: null,
          pendentesEnvio: 1,
          versao: 1,
        });
        historico.push({
          id: 1,
          operacao: 'inclusao',
          ocorridoEm: '2026-11-25T09:00:00',
          motivo: null,
          enviadoCentralEm: null,
        });
        return json(r, { id: 801 }, 201);
      }
      if (c === '/inscricoes/801/central') {
        Object.assign(inscricoes[0]!, {
          numeroCentral: corpo['numeroCentral'],
          pendentesEnvio: 0,
          versao: 2,
        });
        historico[0]!['enviadoCentralEm'] = '2026-11-25T09:05:00';
        return json(r, { id: 801, enviados: 1 });
      }
      if (c === '/notificacoes') {
        notificacoes.push({
          id: 901,
          numero: 'ND-1',
          paciente: PACIENTE.id,
          pacienteNome: PACIENTE.nome,
          prontuario: PACIENTE.prontuario,
          notificanteNome: 'Profissional Sintético',
          atendimento: null,
          centralNome: 'CET-S',
          protocoloCentral: null,
          versao: 1,
          ...corpo,
        });
        return json(r, { id: 901, numero: 'ND-1' }, 201);
      }
      if (c === '/notificacoes/901/protocolo') {
        Object.assign(notificacoes[0]!, { protocoloCentral: corpo['protocoloCentral'], versao: 3 });
        return json(r, { id: 901 });
      }
      Object.assign(notificacoes[0]!, corpo, { versao: 2 });
      return json(r, { id: 901 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/sus/transplantes');
    await expect(page.getByTestId('tela-transplante')).toBeVisible();
    await expect(page.getByTestId('transplante-receptores-vazio')).toBeVisible();

    // Visão por paciente: a busca escolhe o paciente do formulário novo.
    await page.getByTestId('transplante-busca-paciente').fill('9000');
    await page.getByTestId('transplante-paciente-9001').click();
    await expect(page.getByTestId('transplante-paciente-escolhido')).toContainText('900001');

    // Receptor: sem órgão, o botão fica travado; a inscrição vai com paciente, órgão e prioridade.
    await page.getByTestId('transplante-nova-inscricao').click();
    await expect(page.getByTestId('transplante-receptor-problemas')).toContainText('Escolha o órgão');
    await expect(page.getByTestId('transplante-receptor-gravar')).toBeDisabled();
    await escolher(page.getByTestId('transplante-receptor-orgao'), '1');
    await escolher(page.getByTestId('transplante-receptor-prioridade'), 'urgente');
    await page.getByTestId('transplante-receptor-data').fill('2026-10-01');
    await expect(page.getByTestId('transplante-receptor-problemas')).toHaveCount(0);
    await page.getByTestId('transplante-receptor-gravar').click();
    await expect(page.getByTestId('transplante-aviso')).toHaveText('Gravado.');
    expect(pedidos[0]).toEqual({
      caminho: '/api/sus/transplante/inscricoes',
      corpo: expect.objectContaining({
        paciente: 9001,
        orgao: 1,
        prioridade: 'urgente',
        dataInscricao: '2026-10-01',
      }),
    });
    await expect(page.getByTestId('transplante-inscricao-801')).toContainText('Rim');

    // A ficha mostra o histórico pendente; o transplantado pede a data do transplante.
    await page.getByTestId('transplante-abrir-inscricao-801').click();
    await expect(page.getByTestId('transplante-historico')).toContainText('pendente');
    await escolher(page.getByTestId('transplante-receptor-situacao'), 'transplantado');
    await expect(page.getByTestId('transplante-receptor-problemas')).toContainText(
      'Informe a data do transplante.',
    );
    await expect(page.getByTestId('transplante-receptor-gravar')).toBeDisabled();
    await escolher(page.getByTestId('transplante-receptor-situacao'), 'ativa');

    // O número da central registra o envio das mudanças pendentes, com a versão lida.
    await page.getByTestId('transplante-receptor-numero').fill('CET-SINT-77');
    await page.getByTestId('transplante-receptor-central').click();
    await expect(page.getByTestId('transplante-aviso')).toHaveText('Gravado.');
    expect(pedidos[1]).toEqual({
      caminho: '/api/sus/transplante/inscricoes/801/central',
      corpo: { numeroCentral: 'CET-SINT-77', versao: 1 },
    });
    await expect(page.getByTestId('transplante-inscricao-801')).toContainText('CET-SINT-77');
    await expect(page.getByTestId('transplante-conferencia')).toHaveAttribute(
      'href',
      /inscricoes\/conferencia/,
    );

    // Doador: a abordagem antes do protocolo concluído é recusada na hora.
    await page.getByTestId('transplante-aba-doadores').click();
    await page.getByTestId('transplante-nova-notificacao').click();
    await escolher(page.getByTestId('transplante-doador-notificante'), '31');
    await page.getByTestId('transplante-doador-notificado').fill('2026-11-01T10:00');
    await page.getByTestId('transplante-doador-protocolo-inicio').fill('2026-11-01T08:00');
    await page.getByTestId('transplante-doador-abordagem').fill('2026-11-01T09:00');
    await expect(page.getByTestId('transplante-doador-problemas')).toContainText(
      'abordagem familiar vem depois',
    );
    await expect(page.getByTestId('transplante-doador-gravar')).toBeDisabled();
    await page.getByTestId('transplante-doador-abordagem').fill('');
    await expect(page.getByTestId('transplante-doador-problemas')).toHaveCount(0);
    await page.getByTestId('transplante-doador-gravar').click();
    await expect(page.getByTestId('transplante-aviso')).toHaveText('Gravado.');
    expect(pedidos[2]).toEqual({
      caminho: '/api/sus/transplante/notificacoes',
      corpo: expect.objectContaining({
        paciente: 9001,
        tipoDoador: 'morte_encefalica',
        notificante: 31,
        notificadoEm: '2026-11-01T10:00',
        protocoloInicioEm: '2026-11-01T08:00',
        situacao: 'notificada',
      }),
    });
    await expect(page.getByTestId('transplante-notificacao-901')).toContainText('ND-1');

    // O desfecho encerra a notificação com os órgãos doados; o protocolo da central é digitado de volta.
    await page.getByTestId('transplante-abrir-notificacao-901').click();
    await page.getByTestId('transplante-doador-protocolo-fim').fill('2026-11-01T20:00');
    await page.getByTestId('transplante-doador-abordagem').fill('2026-11-01T21:00');
    await escolher(page.getByTestId('transplante-doador-consentimento'), 'true');
    await escolher(page.getByTestId('transplante-doador-desfecho'), 'doacao_efetivada');
    await page.getByTestId('transplante-doador-desfecho-em').fill('2026-11-02T06:00');
    await expect(page.getByTestId('transplante-doador-problemas')).toContainText(
      'Marque ao menos um órgão doado.',
    );
    await page.getByTestId('transplante-doador-orgao-rim').check();
    await expect(page.getByTestId('transplante-doador-problemas')).toHaveCount(0);
    await page.getByTestId('transplante-doador-gravar').click();
    await expect(page.getByTestId('transplante-aviso')).toHaveText('Gravado.');
    expect(pedidos[3]).toEqual({
      caminho: '/api/sus/transplante/notificacoes/901',
      corpo: expect.objectContaining({
        desfecho: 'doacao_efetivada',
        situacao: 'encerrada',
        familiaConsentiu: true,
        orgaosDoados: ['rim'],
        versao: 1,
      }),
    });
    await page.getByTestId('transplante-abrir-notificacao-901').click();
    await page.getByTestId('transplante-doador-protocolo-central').fill('CET-SINT-PROT-1');
    await page.getByTestId('transplante-doador-gravar-protocolo').click();
    await expect(page.getByTestId('transplante-notificacao-901')).toContainText('CET-SINT-PROT-1');
    expect(pedidos[4]).toEqual({
      caminho: '/api/sus/transplante/notificacoes/901/protocolo',
      corpo: { protocoloCentral: 'CET-SINT-PROT-1', versao: 2 },
    });
    await semViolacaoAxe(page, 'transplante para a central estadual');
  });
});
