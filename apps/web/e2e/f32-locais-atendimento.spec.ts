// F3.2 (02-REC linha 34): manutenção dos locais de atendimento (consultórios e salas), pelo caminho da tela.
// A manutenção exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas de
// /api/atendimento/locais são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: o painel na
// página dos locais, a inclusão de um local com a recepção e o módulo, a grade de funcionamento validada na hora pela
// regra do domínio (faixa sobreposta trava o botão sem ir ao servidor), o encaminhamento e a visibilidade entre
// locais, o local que não encaminha com os destinos travados, os usuários do local com o papel exigido e a
// inativação pelos dados. O efeito no banco (semana trocada inteira, exclusão lógica e reativação da mesma linha,
// trilha, recusas sem gravação) está no contrato de efeito
// (apps/api/src/modulos/atendimento/locais-atendimento.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface Faixa {
  diaSemana: number | null;
  diaNaoUtil: boolean;
  inicio: string;
  fim: string;
}
interface Local {
  id: number;
  codigo: string;
  descricao: string;
  recepcao: number;
  recepcaoDescricao: string;
  moduloRecepcao: number | null;
  permiteEncaminhamento: boolean;
  ativo: boolean;
  horario: Faixa[];
  encaminhaPara: number[];
  consulta: number[];
  usuarios: { usuario: number; login: string; nome: string; atuaNoLocal: boolean; podeOperar: boolean }[];
}

const MENSAGEM: Record<string, string> = {
  incluir: 'Local incluído.',
  dados: 'Dados do local gravados.',
  horario: 'Horário de funcionamento gravado.',
  encaminhamentos: 'Locais de encaminhamento gravados.',
  visibilidade: 'Locais consultados gravados.',
  usuarios: 'Usuários do local gravados.',
};

test.describe('F3.2 locais de atendimento: horário, encaminhamento e quem vê @F3.2 @F3.2-04', () => {
  test('inclui o local, grava a grade validada na hora, as ligações, os usuários e inativa', async ({
    page,
  }) => {
    const pedidos: Record<string, unknown>[] = [];
    const base = { recepcao: 51, recepcaoDescricao: 'RECEPCAO SINTETICA' };
    const locais: Local[] = [
      {
        ...base,
        id: 901,
        codigo: 'CONS1',
        descricao: 'CONSULTORIO SINTETICO 1',
        moduloRecepcao: null,
        permiteEncaminhamento: true,
        ativo: true,
        horario: [{ diaSemana: 2, diaNaoUtil: false, inicio: '08:00', fim: '12:00' }],
        encaminhaPara: [],
        consulta: [],
        usuarios: [],
      },
      {
        ...base,
        id: 902,
        codigo: 'SALA2',
        descricao: 'SALA SINTETICA 2',
        moduloRecepcao: null,
        permiteEncaminhamento: false,
        ativo: true,
        horario: [],
        encaminhaPara: [],
        consulta: [],
        usuarios: [],
      },
    ];
    await page.route('**/api/atendimento/locais**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (url.pathname.endsWith('/usuarios-candidatos'))
        return json(r, [{ usuario: 77, login: 'sint.medico', nome: 'MEDICO SINTETICO' }]);
      if (req.method() === 'GET')
        return json(r, {
          recepcoes: [{ id: 51, descricao: 'RECEPCAO SINTETICA' }],
          modulos: [{ id: 61, descricao: 'MODULO AMBULATORIO SINTETICO' }],
          locais,
        });
      const c = req.postDataJSON() as Record<string, unknown>;
      pedidos.push(c);
      expect(req.headers()['idempotency-key']).toBeTruthy();
      let id = Number(c['local']);
      if (c['acao'] === 'incluir') {
        id = 903;
        locais.push({
          ...base,
          id,
          codigo: String(c['codigo']),
          descricao: String(c['descricao']),
          moduloRecepcao: (c['moduloRecepcao'] as number | null) ?? null,
          permiteEncaminhamento: c['permiteEncaminhamento'] === true,
          ativo: true,
          horario: [],
          encaminhaPara: [],
          consulta: [],
          usuarios: [],
        });
      }
      const l = locais.find((x) => x.id === id)!;
      if (c['acao'] === 'dados') {
        l.descricao = String(c['descricao']);
        l.permiteEncaminhamento = c['permiteEncaminhamento'] === true;
        l.ativo = c['ativo'] === true;
        l.moduloRecepcao = (c['moduloRecepcao'] as number | null) ?? null;
      }
      if (c['acao'] === 'horario') l.horario = c['faixas'] as Faixa[];
      if (c['acao'] === 'encaminhamentos') l.encaminhaPara = c['destinos'] as number[];
      if (c['acao'] === 'visibilidade') l.consulta = c['consultados'] as number[];
      if (c['acao'] === 'usuarios')
        l.usuarios = (c['usuarios'] as { usuario: number; atuaNoLocal: boolean; podeOperar: boolean }[]).map(
          (u) => ({ ...u, login: 'sint.medico', nome: 'MEDICO SINTETICO' }),
        );
      return json(r, {
        ok: true,
        resultado: { local: id },
        repetida: false,
        mensagem: MENSAGEM[String(c['acao'])],
      });
    });

    await entrar(page, 'SINT.ADMIN');
    // O item Cadastros > Estrutura > Locais leva à página, e o painel da manutenção fica nela.
    await page.goto('/cadastros/estrutura/locais');
    const painel = page.getByTestId('locais-atendimento');
    await expect(painel).toBeVisible();
    const aviso = page.getByTestId('locais-atendimento-mensagem');

    // Inclusão: o botão só libera com código, descrição e recepção; o local novo já fica escolhido.
    const novo = page.getByTestId('local-novo');
    const incluir = novo.getByRole('button', { name: 'Incluir local' });
    await expect(incluir).toBeDisabled();
    await novo.getByLabel('Código do novo local').fill('SALA3');
    await novo.getByLabel('Descrição do novo local').fill('SALA SINTETICA 3');
    await escolher(novo.getByLabel('Recepção que atende o local'), '51');
    await escolher(novo.getByLabel('Módulo de recepção do novo local'), '61');
    await incluir.click();
    await expect(aviso).toHaveText('Local incluído.');
    expect(pedidos[0]).toEqual({
      acao: 'incluir',
      codigo: 'SALA3',
      descricao: 'SALA SINTETICA 3',
      recepcao: 51,
      permiteEncaminhamento: false,
      moduloRecepcao: 61,
    });
    await esperarValor(page.getByTestId('local-escolhido'), '903');
    await expect(page.getByTestId('local-resumo')).toContainText('RECEPCAO SINTETICA · 0 faixa(s)');

    // Grade de funcionamento: a faixa nova cai sobre a que existe, e a regra do domínio trava o botão na hora.
    await escolher(page.getByTestId('local-escolhido'), '901');
    const horario = page.getByTestId('local-horario');
    await horario.getByRole('button', { name: 'Acrescentar faixa' }).click();
    await expect(page.getByTestId('local-horario-recusa')).toContainText('se sobrepõem no mesmo dia');
    const gravarHorario = horario.getByRole('button', { name: 'Gravar horário' });
    await expect(gravarHorario).toBeDisabled();
    await horario.getByLabel('Início da faixa 2 (HH:MM)').fill('13:00');
    await horario.getByLabel('Fim da faixa 2 (HH:MM)').fill('17:00');
    await expect(page.getByTestId('local-horario-recusa')).toHaveCount(0);
    await expect(page.getByTestId('local-aberto')).toBeVisible();
    await gravarHorario.click();
    await expect(aviso).toHaveText('Horário de funcionamento gravado.');
    expect(pedidos[1]).toEqual({
      acao: 'horario',
      local: 901,
      faixas: [
        { diaSemana: 2, diaNaoUtil: false, inicio: '08:00', fim: '12:00' },
        { diaSemana: 2, diaNaoUtil: false, inicio: '13:00', fim: '17:00' },
      ],
    });
    await expect(page.getByTestId('local-resumo')).toContainText('2 faixa(s)');

    // Encaminhamento e visibilidade entre locais, cada um gravado inteiro.
    const ligacoes = page.getByTestId('local-ligacoes');
    await page.getByTestId('local-destino-902').click();
    await ligacoes.getByRole('button', { name: 'Gravar encaminhamentos' }).click();
    await expect(aviso).toHaveText('Locais de encaminhamento gravados.');
    expect(pedidos[2]).toEqual({ acao: 'encaminhamentos', local: 901, destinos: [902] });
    await page.getByTestId('local-consulta-902').click();
    await page.getByTestId('local-consulta-903').click();
    await ligacoes.getByRole('button', { name: 'Gravar locais consultados' }).click();
    await expect(aviso).toHaveText('Locais consultados gravados.');
    expect(pedidos[3]).toEqual({ acao: 'visibilidade', local: 901, consultados: [902, 903] });
    await expect(page.getByTestId('local-resumo')).toContainText('encaminha para 1 · consulta 2');
    await expect(page.getByTestId('local-destino-902')).toHaveAttribute('aria-checked', 'true');

    // Usuários do local: quem entra sem papel trava a gravação até marcar se atende ou opera.
    const usuarios = page.getByTestId('local-usuarios');
    await usuarios.getByLabel('Buscar usuário (nome ou login)').fill('sint');
    await escolher(page.getByTestId('local-usuario-candidato'), '77');
    await usuarios.getByRole('button', { name: 'Acrescentar usuário' }).click();
    await page.getByTestId('local-usuario-atende-77').click();
    await page.getByTestId('local-usuario-opera-77').click();
    await expect(page.getByTestId('local-usuario-sem-papel')).toBeVisible();
    const gravarUsuarios = usuarios.getByRole('button', { name: 'Gravar usuários' });
    await expect(gravarUsuarios).toBeDisabled();
    await page.getByTestId('local-usuario-atende-77').click();
    await gravarUsuarios.click();
    await expect(aviso).toHaveText('Usuários do local gravados.');
    expect(pedidos[4]).toEqual({
      acao: 'usuarios',
      local: 901,
      usuarios: [{ usuario: 77, atuaNoLocal: true, podeOperar: false }],
    });
    await expect(page.getByTestId('local-resumo')).toContainText('1 usuário(s)');
    await semViolacaoAxe(page, 'locais de atendimento');

    // O local que não encaminha avisa e trava os destinos; a inativação vai pelos dados e nada é apagado.
    await escolher(page.getByTestId('local-escolhido'), '902');
    await expect(page.getByTestId('local-nao-encaminha')).toBeVisible();
    await expect(page.getByTestId('local-destino-901')).toBeDisabled();
    await expect(ligacoes.getByRole('button', { name: 'Gravar encaminhamentos' })).toHaveCount(0);
    await page.getByTestId('local-ativo').click();
    await painel.getByRole('button', { name: 'Gravar dados' }).click();
    await expect(aviso).toHaveText('Dados do local gravados.');
    expect(pedidos[5]).toEqual({
      acao: 'dados',
      local: 902,
      descricao: 'SALA SINTETICA 2',
      permiteEncaminhamento: false,
      ativo: false,
      moduloRecepcao: null,
    });
    await expect(page.getByTestId('local-ativo')).toHaveAttribute('aria-checked', 'false');
    expect(pedidos).toHaveLength(6);
  });
});
