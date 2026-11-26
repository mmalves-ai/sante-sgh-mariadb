// E2E @C1-101 (02-AGE linha 42, ficha F3.2): a central marca a consulta de quem ainda não tem prontuário pelo bloco
// "sem prontuário" da tela de marcação (o mínimo da pessoa; horário, convênio e canal são os de cima); o painel do dia
// mostra o selo "Sem prontuário" e converte o pré-cadastro ali mesmo, ligando ao paciente do mesmo CPF; no guichê, a
// chegada lista os marcados de hoje sem prontuário, a recepção converte escolhendo o paciente na busca (divergência
// só com motivo) e a marcação passa à lista de agendados para ligar a senha; axe sem violação séria.
// Sessão real sobre a fonte sintética de dev e a porta da agenda em MEMÓRIA (agendas, horários, pacientes e
// pré-cadastros SINTÉTICOS). A conversão exige o banco próprio (cadastro.converterPreCadastro), então a prévia e a
// gravação da conversão são simuladas pelo Playwright, e o que se prova é a tela: o corpo de cada pedido, o paciente
// ligado e a marcação na lista. O efeito no banco (paciente_id preenchido na marcação, pré-cadastro 'convertido',
// chegada recusada antes e gravada depois) está nos contratos de efeito
// apps/api/src/modulos/recepcao/chegada-pre-cadastro.int.spec.ts e
// apps/api/src/modulos/cadastro/paciente-vinculos-proprio.int.spec.ts.
// Permissões: as dos perfis sintéticos, sem nada injetado na sessão. SINT.AGENDA converte no painel do dia com o
// cadastro de pacientes da recepção externa (cadastro.paciente.criar); SINT.SENHAS lista os marcados de hoje pela
// consulta da agenda (agenda.marcacao.ler) e converte com a mesma permissão do cadastro.
// Limite conhecido do trecho do guichê: a porta em memória não converte o pré-cadastro nem liga a agenda em memória à
// lista de agendados da recepção em memória, e a marcação é de um dia futuro (a grade de hoje pode já ter passado).
// Por isso a leitura do dia do guichê e a lista de agendados são simuladas a partir da marcação gravada acima; o
// fecho "paciente_id preenchido e pré-cadastro convertido" pela leitura real fica no contrato de efeito.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FERIADOS = ['01-01', '04-21', '09-07', '11-02', '11-15', '12-25'];
const PACIENTE = 1003;

/** Próximo dia útil a partir de três dias à frente (relógio de São Paulo), fora dos feriados fixos. */
function diaUtil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = 3; i < 20; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const iso = x.toISOString().slice(0, 10);
    const sem = x.getUTCDay();
    if (sem !== 0 && sem !== 6 && !FERIADOS.includes(iso.slice(5))) return iso;
  }
  throw new Error('sem dia útil');
}

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

interface Pedido {
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}

/**
 * A conversão do pré-cadastro (prévia e gravação) simulada: `porCpf` devolve o paciente do mesmo CPF; sem ele, a
 * prévia pede a busca e a escolha do paciente traz a divergência do nascimento (ligar só com motivo).
 */
async function simularConversao(page: Page, pedidos: Pedido[], porCpf: boolean): Promise<void> {
  await page.route('**/api/cadastros/pre-cadastros/**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace('/api/cadastros/', '');
    if (req.method() === 'POST' && /^pre-cadastros\/\d+\/converter$/.test(caminho)) {
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      return json(rota, { paciente: PACIENTE, marcacoes: 1, cobertura: null });
    }
    if (req.method() === 'GET' && /^pre-cadastros\/\d+\/conversao$/.test(caminho)) {
      const escolhido = url.searchParams.get('paciente');
      if (porCpf)
        return json(rota, {
          acao: 'vincular',
          paciente: PACIENTE,
          codigo: null,
          mensagem: null,
          divergencias: [],
          rascunho: null,
        });
      if (escolhido)
        return json(rota, {
          acao: 'vincular',
          paciente: Number(escolhido),
          codigo: null,
          mensagem: null,
          divergencias: ['nascimento'],
          rascunho: null,
        });
      return json(rota, {
        acao: 'cadastrar',
        paciente: null,
        codigo: null,
        mensagem: null,
        divergencias: [],
        rascunho: { nome: 'PESSOA SINTETICA SEM PRONTUARIO' },
      });
    }
    return rota.fallback();
  });
}

test.describe('Marcação sem prontuário e conversão ali mesmo @C1-101 @F3.2', () => {
  test.setTimeout(180_000);
  test('marcar sem prontuário; converter no painel do dia e na chegada; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const dia = diaUtil();
    const pedidos: Pedido[] = [];
    await entrar(page, 'SINT.AGENDA');
    await simularConversao(page, pedidos, true);

    // Central: vaga na grade e o bloco sem prontuário (validação na hora: o botão só liga com o mínimo da pessoa).
    await page.goto('/agenda/consultas/marcar');
    await expect(page.getByTestId('tela-marcar')).toBeVisible();
    const busca = page.getByRole('region', { name: 'Buscar vagas' });
    await escolher(busca.getByLabel('Agenda'), '901');
    await page.getByTestId('vagas-de').fill(dia);
    await page.getByTestId('vagas-ate').fill(dia);
    await busca.getByRole('button', { name: 'Buscar vagas' }).click();
    await expect(page.getByTestId('tabela-vagas')).toBeVisible();
    await page
      .getByTestId(new RegExp(`^vaga-901-${dia}-\\d{4}$`))
      .last()
      .click();
    await expect(page.getByTestId('vaga-escolhida')).toBeVisible();
    await escolher(page.getByRole('region', { name: 'Marcar consulta' }).getByLabel('Convênio'), '10');
    const bloco = page.getByTestId('sem-prontuario');
    await expect(bloco).toBeVisible();
    const botao = page.getByTestId('botao-marcar-sem-prontuario');
    await expect(botao).toBeDisabled();
    await page.getByTestId('sp-nome').locator('input').fill('PESSOA SINTETICA SEM PRONTUARIO');
    await page.getByTestId('sp-nascimento').fill('1991-03-14');
    await page.getByTestId('sp-telefone').fill('31999990101');
    await expect(botao).toBeEnabled();
    await semViolacaoAxe(page, 'marcação sem prontuário');
    await botao.click();
    await expect(page).toHaveURL(/\/agenda\/consultas\/marcacoes\/\d+/);
    const marcada = Number(/\/marcacoes\/(\d+)/.exec(page.url())?.[1]);

    // Painel do dia: selo "Sem prontuário" e conversão ali mesmo, ligando ao paciente do mesmo CPF.
    await page.goto('/agenda/consultas/dia');
    await page.getByTestId('dia-data').fill(dia);
    const leitura = page.waitForResponse(
      (r) => r.url().includes('/api/agenda/consultas/dia') && r.url().includes(`data=${dia}`) && r.ok(),
    );
    await escolher(page.getByLabel('Agenda'), '901');
    const painel = (await (await leitura).json()) as {
      marcacoes: { id: number; preCadastroAConverter?: number | null }[];
    };
    await expect(page.getByTestId('tabela-dia')).toBeVisible();
    const daMarcacao = painel.marcacoes.find((m) => m.id === marcada);
    expect(daMarcacao?.preCadastroAConverter).toBeGreaterThan(0);
    const pre = daMarcacao!.preCadastroAConverter!;
    await expect(page.getByTestId(`dia-sem-prontuario-${marcada}`)).toContainText('Sem prontuário');
    await page.getByTestId(`dia-converter-${marcada}`).click();
    await expect(page.getByTestId(`converter-pre-${pre}`)).toBeVisible();
    await semViolacaoAxe(page, 'conversão no painel do dia');
    await page.getByTestId('converter-ligar').click();
    await expect(page.getByTestId('dia-resultado-conversao')).toContainText('convertido');
    expect(pedidos.at(-1)).toEqual({
      caminho: `pre-cadastros/${pre}/converter`,
      corpo: { paciente: PACIENTE },
    });

    // Guichê: os marcados de hoje sem prontuário (a leitura do dia traz a marcação acima como de hoje); conversão
    // pela busca, com o motivo da divergência, e a marcação passa à lista de agendados para ligar a senha.
    const hoje = { ...daMarcacao!, preCadastroAConverter: pre };
    let convertida = false;
    await entrar(page, 'SINT.SENHAS');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await simularConversao(page, pedidos, false);
    await page.route('**/api/cadastros/pre-cadastros/**/converter', async (rota) => {
      convertida = true;
      await rota.fallback();
    });
    await page.route('**/api/agenda/consultas/dia**', async (rota) => {
      if (new URL(rota.request().url()).searchParams.has('data')) return rota.fallback();
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as { marcacoes: unknown[] };
      corpo.marcacoes = [{ ...hoje, preCadastroAConverter: convertida ? null : pre }];
      await rota.fulfill({ response: resposta, json: corpo });
    });
    await page.route('**/api/recepcao/agendados**', async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as { itens: unknown[] };
      if (convertida)
        corpo.itens = [
          ...corpo.itens,
          {
            tipo: 'consulta',
            marcacao: marcada,
            hora: '08:00',
            agenda: 'AGENDA SINTETICA',
            paciente: 'PESSOA SINTETICA SEM PRONTUARIO',
            nomeSocial: false,
            sigiloso: false,
            foto: null,
            prontuario: PACIENTE,
            chegou: false,
            senha: null,
          },
        ];
      await rota.fulfill({ response: resposta, json: corpo });
    });

    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('8');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 8 aberto');
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    await page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'Balcão' })
      .last()
      .getByRole('button')
      .click();
    await expect(page.getByTestId('senha-atual')).toHaveText(/^BL \d{3}$/);
    await page.getByTestId('evento-checkin').click();

    const chegada = page.getByTestId('chegada-sem-prontuario');
    await expect(chegada).toBeVisible();
    await expect(page.getByTestId('lista-agendados')).not.toContainText('PESSOA SINTETICA SEM PRONTUARIO');
    await page.getByTestId(`chegada-converter-${marcada}`).click();
    await expect(page.getByTestId(`converter-pre-${pre}`)).toBeVisible();
    await expect(page.getByTestId('converter-cadastrar')).toBeVisible();
    await page.getByTestId('converter-termo').fill('cinthya');
    await page.getByTestId('converter-termo').press('Enter');
    await page.getByTestId(`converter-escolher-${PACIENTE}`).click();
    const ligarEscolhido = page.getByTestId('converter-ligar-escolhido');
    await expect(ligarEscolhido).toBeDisabled();
    await page
      .getByTestId('converter-motivo')
      .fill('Nascimento SINTETICO corrigido na conferência do documento');
    await expect(ligarEscolhido).toBeEnabled();
    await semViolacaoAxe(page, 'conversão na chegada');
    await ligarEscolhido.click();
    await expect(page.getByTestId('chegada-sem-prontuario-aviso')).toContainText('convertido');
    expect(pedidos.at(-1)).toEqual({
      caminho: `pre-cadastros/${pre}/converter`,
      corpo: {
        paciente: PACIENTE,
        motivoDivergencia: 'Nascimento SINTETICO corrigido na conferência do documento',
      },
    });
    // A marcação convertida já tem paciente: aparece entre os agendados, pronta para ligar a senha.
    await expect(page.getByTestId(`ligar-consulta-${marcada}`)).toBeVisible();
    await expect(page.getByTestId(`chegada-converter-${marcada}`)).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
