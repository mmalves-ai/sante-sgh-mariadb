// F3.1 (02-CAD linha 2) @F3.1-01: a regra de campo do cadastro na ABERTURA do atendimento.
//  1. Pelo caminho real da recepção (senha chamada no guichê → "abrir atendimento"): escolhidos o paciente, o tipo e o
//     convênio, a tela diz na hora quais campos do cadastro faltam no escopo. O módulo de recepção NÃO vem de parâmetro
//     de rota: a tela manda o local de atendimento do guichê, e o servidor resolve o módulo do local e o devolve; o
//     atalho leva à ficha do paciente com o mesmo escopo (módulo, tipo e convênio) na rota.
//  2. Na demanda direta (menu), quando o aviso prévio não aparece (a consulta dos campos pendentes falha) e o servidor
//     recusa a gravação com `cadastro-incompleto`, a tela mostra os campos pelo rótulo e o atalho para a ficha; nada de
//     mensagem geral com código de correlação.
// A rota dos campos pendentes exige o banco próprio e é simulada pelo Playwright com massa SINTÉTICA; a recusa de
// verdade (o que fica no banco) está nos contratos de efeito
// apps/api/src/modulos/atendimento/abertura-regra-campo.int.spec.ts e
// apps/api/src/modulos/adt/internacao-regra-campo.int.spec.ts; o módulo tirado da origem (canal de entrada e guichê da
// sessão, sem local) em apps/api/src/modulos/atendimento/abertura-modulo-origem.int.spec.ts (@C1-007: a tela manda
// também a senha chamada, de onde o servidor tira o módulo quando não há local).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarSemSelectNativo, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const CONVENIO = 306;
const MODULO_DO_LOCAL = 4;

// Cada teste tem contexto novo (sem cookie nem sessão). No lote, o 1º caso ficou 4 min esperando o formulário de
// entrada (25/11, lote2 da f3-integrar; o 2º caso, igual, entrou em 6 s): a página de entrada não chegou a montar. Uma
// recarga só, se o formulário não aparecer em 30 s; a espera do campo e o resto do teste ficam iguais.
async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  const campo = page.getByTestId('campo-login');
  await campo.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => page.reload());
  await campo.fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

async function escolherPaciente(page: Page): Promise<void> {
  await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
  await page.getByTestId('abrir-atd-buscar').click();
  await page.getByTestId(`abrir-atd-paciente-${PACIENTE}`).click();
  await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toBeVisible();
}

test.describe('@F3.1 @F3.1-01 @C1-007 regra de campo do cadastro na abertura do atendimento', () => {
  test.describe.configure({ timeout: 240_000 });

  test('do guichê: avisa na hora o que falta, com o módulo de recepção do local, e leva à ficha com o escopo; axe', async ({
    page,
  }) => {
    const consultas: URLSearchParams[] = [];
    await entrar(page, 'SINT.SENHAS');
    // Regra sintética: na urgência falta o nome da mãe e, para o convênio escolhido, também o celular. O servidor
    // resolve o módulo de recepção pelo local de atendimento que a tela manda (o do guichê).
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/campos-pendentes**`, (rota) => {
      const p = new URL(rota.request().url()).searchParams;
      consultas.push(p);
      const pendentes: { campo: string; rotulo: string }[] = [];
      const urgencia = p.get('tipoAtendimento') === 'urgencia';
      if (urgencia && p.get('fontePagadora') === String(CONVENIO))
        pendentes.push({ campo: 'celular', rotulo: 'Celular' });
      if (urgencia) pendentes.push({ campo: 'nomeMae', rotulo: 'Nome da mãe' });
      return json(rota, { pendentes, modulo: p.get('local') ? MODULO_DO_LOCAL : null });
    });

    // Guichê: abrir o guichê, emitir a senha do balcão, chamá-la e abrir o atendimento a partir dela.
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('4');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 4 aberto');
    await page.getByTestId('guiche-emitir').click();
    await escolher(page.getByTestId('emissao-servico'), '1');
    await page.getByTestId('confirmar-emissao').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Senha emitida');
    await page
      .getByTestId('tabela-aguardando')
      .getByRole('row')
      .filter({ hasText: 'Balcão' })
      .first()
      .getByRole('button')
      .click();
    await expect(page.getByTestId('senha-atual')).toHaveText(/^BL \d{3}$/);
    await page.getByTestId('abrir-atendimento-atual').click();

    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    // A navegação real traz a senha e o local; nenhum módulo de recepção na rota.
    await expect(page).toHaveURL(/\/recepcao\/atendimento\/novo\?senha=\d+&local=\d+$/);
    const local = new URL(page.url()).searchParams.get('local');
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);
    await escolherPaciente(page);

    const ficha = page.locator('section[aria-labelledby="abrir-atd-ficha"]');
    // Consulta ambulatorial: a regra é só da urgência, nenhum aviso; a tela manda o local do guichê na conferência.
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await expect.poll(() => consultas.some((c) => c.get('tipoAtendimento') === 'ambulatorial')).toBe(true);
    expect(consultas.at(-1)?.get('local')).toBe(local);
    // A origem vai junto: a senha chamada (o servidor tira o módulo dela quando não há local).
    expect(consultas.at(-1)?.get('senha')).toBe(new URL(page.url()).searchParams.get('senha'));
    expect(consultas.at(-1)?.get('modulo')).toBeNull();
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);

    // Pronto atendimento: a regra da urgência aparece na hora, com o rótulo do campo.
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'pa');
    const aviso = page.getByTestId('abrir-atd-cadastro-pendente');
    await expect(aviso).toContainText('Faltam no cadastro do paciente para este atendimento:');
    await expect(aviso).toContainText('Nome da mãe.');

    // Com o convênio, a regra da fonte pagadora soma; o atalho leva à ficha, em outra aba, com o módulo de recepção
    // que o servidor tirou do local, o tipo e o convênio.
    await escolher(ficha.getByLabel('Convênio', { exact: true }), String(CONVENIO));
    await expect(aviso).toContainText(
      'Faltam no cadastro do paciente para este atendimento: Celular, Nome da mãe.',
    );
    const completar = page.getByTestId('abrir-atd-completar-cadastro');
    await expect(completar).toHaveAttribute(
      'href',
      new RegExp(
        `/cadastros/pacientes/${PACIENTE}\\?modulo=${MODULO_DO_LOCAL}&tipoAtendimento=urgencia&fontePagadora=${CONVENIO}$`,
      ),
    );
    await expect(completar).toHaveAttribute('target', '_blank');
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (cadastro pendente, do guichê)');

    // Paciente não identificado (emergência): o cadastro provisório não é barrado, e o aviso some.
    await page.getByTestId('abrir-atd-nao-identificado').check();
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);
  });

  test('recusa do servidor ao gravar: a tela mostra os campos que faltam e o atalho da ficha; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ATENDIMENTO');
    // O aviso prévio não aparece (a consulta dos campos pendentes falha): a conferência fica com o servidor.
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/campos-pendentes**`, (rota) =>
      json(rota, { type: 'about:blank', title: 'Indisponível', status: 503 }, 503),
    );
    // A gravação volta recusada pela regra de campo, com os campos (o que o servidor devolve de verdade).
    let gravacoes = 0;
    await page.route('**/api/atendimento', (rota) => {
      if (rota.request().method() !== 'POST') return rota.fallback();
      gravacoes += 1;
      return json(
        rota,
        {
          type: 'https://sgh.local/problemas/cadastro-incompleto',
          title: 'Operação recusada',
          status: 409,
          detail: 'Complete o cadastro do paciente antes de abrir o atendimento: Celular, Nome da mãe.',
          codigo: 'cadastro-incompleto',
          campos: ['celular', 'nomeMae'],
        },
        409,
      );
    });

    // Demanda direta, pelo menu da recepção (sem senha e sem agendamento).
    await page.goto('/recepcao/atendimento/novo');
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    await escolherPaciente(page);
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
    await escolher(ficha.getByLabel('Convênio', { exact: true }), String(CONVENIO));
    await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
    await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
    await page.getByTestId('abrir-atd-procedimento').fill('10101012');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await expect(page.getByTestId('abrir-atd-cadastro-pendente')).toHaveCount(0);
    await page.getByTestId('botao-abrir-atendimento').click();

    const recusa = page.getByTestId('abrir-atd-cadastro-recusado');
    await expect(recusa).toContainText(
      'O atendimento não foi gravado. Faltam no cadastro do paciente: Celular, Nome da mãe.',
    );
    expect(gravacoes).toBe(1);
    // Continua na abertura (nada foi gravado), sem a mensagem geral nem a recusa genérica do atendimento.
    await expect(page.getByTestId('tela-abrir-atendimento')).toBeVisible();
    await expect(page.getByTestId('recusa-atendimento')).toHaveCount(0);
    const completar = page.getByTestId('abrir-atd-completar-recusado');
    await expect(completar).toHaveAttribute(
      'href',
      new RegExp(
        `/cadastros/pacientes/${PACIENTE}\\?tipoAtendimento=ambulatorial&fontePagadora=${CONVENIO}$`,
      ),
    );
    await expect(completar).toHaveAttribute('target', '_blank');
    await semViolacaoAxe(page, '/recepcao/atendimento/novo (recusa por cadastro incompleto)');
  });
  test('canal de entrada dos módulos: combo por módulo, aviso na hora do canal de outro módulo e gravação; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens = [
      {
        id: 71,
        codigo: 'URG',
        descricao: 'RECEPCAO DA URGENCIA SINTETICA',
        ativo: true,
        canal: 'urgencia',
        versao: 1,
      },
      {
        id: 72,
        codigo: 'INT',
        descricao: 'RECEPCAO DA INTERNACAO SINTETICA',
        ativo: true,
        canal: null,
        versao: 3,
      },
    ] as {
      id: number;
      codigo: string;
      descricao: string;
      ativo: boolean;
      canal: string | null;
      versao: number;
    }[];
    await entrar(page, 'SINT.ADMIN');
    await page.route('**/api/cadastros/regras-campo**', (rota) => json(rota, { itens: [] }));
    await page.route('**/api/cadastros/modulos-recepcao**', (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') return json(rota, { itens });
      const caminho = new URL(req.url()).pathname;
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      const alvo = itens.find((i) => caminho.endsWith(`/${i.id}/canal`))!;
      alvo.canal = (corpo['canal'] as string | null) ?? null;
      alvo.versao += 1;
      return json(rota, { id: alvo.id });
    });
    await page.goto('/cadastros/regras-campo');
    const painel = page.getByTestId('painel-canal-modulo');
    await expect(painel.getByTestId('canal-modulo-URG')).toContainText('RECEPCAO DA URGENCIA SINTETICA');
    await esperarSemSelectNativo(painel);

    // O canal da urgência já é de outro módulo: a tela avisa na hora e não grava.
    await escolher(painel.getByTestId('canal-modulo-selecao-INT'), { rotulo: /Urgência/ });
    await expect(painel.getByTestId('recusa-canal')).toContainText('URG');
    expect(pedidos).toHaveLength(0);

    // O canal da internação: um clique grava, com a versão do módulo.
    await escolher(painel.getByTestId('canal-modulo-selecao-INT'), { rotulo: /Internação/ });
    await expect(painel.getByTestId('aviso-canal')).toContainText('gravado');
    expect(pedidos[0]).toEqual({
      caminho: '/api/cadastros/modulos-recepcao/72/canal',
      corpo: { versao: 3, canal: 'internacao' },
    });
    await esperarValor(painel.getByTestId('canal-modulo-selecao-INT'), 'internacao');
    await semViolacaoAxe(page, '/cadastros/regras-campo (canal de entrada dos módulos)');
  });
});
