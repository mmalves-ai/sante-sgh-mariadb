// E2E @F3.5-13 (F3.5, 05-SADT linha 21): entrega de resultados pelo caminho das telas. No balcão (/sadt/entregas) a
// equipe acha o paciente pelo número do pedido, vê o que está pronto (já marcado), o que falta com a previsão do
// prazo e os protocolos emitidos; a entrega a outra pessoa só libera com o nome e o documento (o CPF é conferido na
// hora, a cada tecla), o protocolo sai numerado e o cancelamento pede o motivo. No cadastro (/sadt/entregas/cadastro)
// o prazo só libera com exame e tempo, o exame restrito pede a carência só na regra dos dias e o perfil do portal
// leva os setores marcados. As rotas /api/sadt/entregas exigem o banco próprio e o E2E roda com a fonte sintética
// (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (protocolo, quem
// retirou, histórico do exame, cancelamento que não apaga, prazo substituído, portal por perfil e exame restrito) está
// em apps/api/src/modulos/sadt/aplicacao/entrega-resultado.int.spec.ts.
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

const PRONTO = {
  item: 701,
  pedido: 'RQ-100',
  exame: 'HEMOGRAMA SINTETICO',
  setor: 'LABORATORIO SINTETICO',
  pedidoEm: '2026-03-13T10:00',
  liberado: true,
  previsto: '2026-03-14T10:00',
  situacaoPrazo: 'liberado_no_prazo',
};
const AGUARDANDO = {
  item: 702,
  pedido: 'RQ-100',
  exame: 'CULTURA SINTETICA',
  setor: 'LABORATORIO SINTETICO',
  pedidoEm: '2026-03-13T10:00',
  liberado: false,
  previsto: '2026-03-18T10:00',
  situacaoPrazo: 'no_prazo',
};
const protocolo = (situacao: 'entregue' | 'cancelada', motivo: string | null) => ({
  id: 91,
  numero: 'ER-1',
  situacao,
  entregueEm: '2026-03-15T09:30',
  entreguePor: 'ATENDENTE SINTETICA',
  forma: 'BALCAO SINTETICO',
  retiradoPeloPaciente: false,
  nomeResponsavel: 'RESPONSAVEL SINTETICO',
  documentoResponsavel: '52998224725',
  motivoCancelamento: motivo,
  observacao: null,
  exames: [{ item: 701, exame: 'HEMOGRAMA SINTETICO', pedido: 'RQ-100' }],
});

test.describe('Entrega de resultados @F3.5-13 @fase3', () => {
  test.setTimeout(180_000);

  test('balcão: visão por paciente, quem retira conferido na hora, protocolo numerado e cancelamento com motivo; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let estado: 'pronto' | 'entregue' | 'cancelado' = 'pronto';
    await page.route('**/api/sadt/entregas**', (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^\/api\/sadt\/entregas\/?/, '');
      if (req.method() === 'GET' && caminho === 'balcao') {
        if (url.searchParams.get('busca') !== 'RQ-100')
          return json(rota, {
            paciente: null,
            prontos: [],
            aguardando: [],
            entregas: [],
            formas: [],
            parentescos: [],
          });
        return json(rota, {
          paciente: { id: 11, nome: 'PACIENTE SINTETICO', nascimento: '1980-05-20' },
          prontos: estado === 'entregue' ? [] : [PRONTO],
          aguardando: [AGUARDANDO],
          entregas:
            estado === 'pronto'
              ? []
              : [
                  protocolo(
                    estado === 'entregue' ? 'entregue' : 'cancelada',
                    estado === 'cancelado' ? 'entregue ao paciente errado' : null,
                  ),
                ],
          formas: [{ id: 21, nome: 'BALCAO SINTETICO' }],
          parentescos: [{ id: 31, nome: 'FILHO SINTETICO' }],
        });
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === '') {
        estado = 'entregue';
        return json(rota, { id: 91, numero: 'ER-1' });
      }
      if (caminho === 'protocolo/91/cancelar') {
        estado = 'cancelado';
        return json(rota, { id: 91 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/entregas');
    await expect(page.getByTestId('entrega-resultados')).toBeVisible();
    await expect(page.getByTestId('entrega-buscar')).toBeDisabled();
    await semViolacaoAxe(page, '/sadt/entregas');

    // Número que não existe: a tela diz, sem inventar paciente.
    await page.getByTestId('entrega-busca').fill('RQ-999');
    await page.getByTestId('entrega-buscar').click();
    await expect(page.getByTestId('entrega-nao-achado')).toBeVisible();

    // O pedido do paciente: o pronto já vem marcado; o que falta traz a previsão e a situação do prazo.
    await page.getByTestId('entrega-busca').fill('RQ-100');
    await page.getByTestId('entrega-busca').press('Enter');
    await expect(page.getByTestId('entrega-paciente')).toContainText('PACIENTE SINTETICO');
    await expect(page.getByTestId('entrega-paciente')).toContainText('20/05/1980');
    await expect(page.getByTestId('entrega-item-701')).toBeChecked();
    await expect(page.getByTestId('entrega-aguardando')).toContainText('18/03/2026 10:00');
    await expect(page.getByTestId('entrega-prazo-702')).toHaveText('no prazo');
    const registrar = page.getByTestId('entrega-registrar');
    await expect(registrar).toBeEnabled();

    // Sem exame marcado não entrega.
    await page.getByTestId('entrega-item-701').uncheck();
    await expect(registrar).toBeDisabled();
    await page.getByTestId('entrega-item-701').check();

    // Outra pessoa retira: nome e documento conferidos a cada tecla (o CPF pelos dígitos).
    await page.getByTestId('entrega-proprio').uncheck();
    await expect(registrar).toBeDisabled();
    await expect(page.getByTestId('entrega-falta-responsavel')).toBeVisible();
    await page.getByTestId('entrega-nome').fill('RESPONSAVEL SINTETICO');
    await expect(registrar).toBeDisabled();
    await page.getByTestId('entrega-cpf').fill('529.982.247-24');
    await expect(page.getByTestId('entrega-cpf-invalido')).toBeVisible();
    await expect(registrar).toBeDisabled();
    await page.getByTestId('entrega-cpf').fill('529.982.247-25');
    await expect(page.getByTestId('entrega-cpf-invalido')).toHaveCount(0);
    await expect(registrar).toBeEnabled();
    await escolher(page.getByTestId('entrega-parentesco'), { rotulo: 'FILHO SINTETICO' });
    await escolher(page.getByTestId('entrega-forma'), { rotulo: 'BALCAO SINTETICO' });
    expect(pedidos).toHaveLength(0);
    await registrar.click();

    await expect(page.getByTestId('entrega-mensagem')).toContainText('ER-1');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: '',
      corpo: {
        paciente: 11,
        itens: [701],
        forma: 21,
        retiradoPeloPaciente: false,
        nomeResponsavel: 'RESPONSAVEL SINTETICO',
        cpfResponsavel: '52998224725',
        parentesco: 31,
      },
    });
    // O protocolo aparece na lista e na folha de impressão; nada mais pronto para sair.
    await expect(page.getByTestId('entrega-protocolos')).toContainText('ER-1');
    await expect(page.getByTestId('entrega-protocolos')).toContainText('RESPONSAVEL SINTETICO');
    await expect(page.getByTestId('entrega-folha')).toContainText('ER-1');
    await expect(page.getByTestId('entrega-item-701')).toHaveCount(0);

    // Cancelar pede o motivo (ao menos 5 letras) e o protocolo continua na lista, cancelado.
    await page.getByTestId('entrega-cancelar-91').click();
    const confirmar = page.getByTestId('entrega-confirmar-cancelamento');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('entrega-motivo').fill('erro');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('entrega-motivo').fill('entregue ao paciente errado');
    await confirmar.click();
    await expect(page.getByTestId('entrega-cancelada-91')).toContainText('entregue ao paciente errado');
    expect(pedidos[1]).toMatchObject({
      caminho: 'protocolo/91/cancelar',
      corpo: { motivo: 'entregue ao paciente errado' },
    });
    await expect(page.getByTestId('entrega-item-701')).toBeChecked();
  });

  test('cadastro: prazo por exame e setor, exame restrito com carência e perfil do portal por setor; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const cadastro = {
      prazos: [] as unknown[],
      restricoes: [] as unknown[],
      perfis: [] as unknown[],
      setores: [
        { id: 601, nome: 'LABORATORIO SINTETICO' },
        { id: 602, nome: 'IMAGEM SINTETICA' },
      ],
      setoresSolicitantes: [{ id: 41, nome: 'SETOR SOLICITANTE SINTETICO' }],
      materiais: [],
    };
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) =>
      json(rota, {
        exames: [{ id: 501, nome: 'HEMOGRAMA SINTETICO' }],
        setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
        analitos: [],
      }),
    );
    await page.route('**/api/sadt/entregas**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/entregas\/?/, '');
      if (req.method() === 'GET') return json(rota, cadastro);
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === 'prazos') {
        cadastro.prazos = [
          {
            id: 71,
            exame: 501,
            exameNome: 'HEMOGRAMA SINTETICO',
            setor: 601,
            setorSolicitante: null,
            material: null,
            prioridade: 'rotina',
            tipoAtendimento: null,
            prazoDias: 2,
            prazoMinutos: null,
            horarioCorte: '16:00',
            diasDaSemana: [false, true, true, true, true, true, true],
            ativo: true,
          },
        ];
        return json(rota, { id: 71 });
      }
      if (caminho === 'restricoes') {
        cadastro.restricoes = [
          {
            id: 81,
            exame: 501,
            exameNome: 'HEMOGRAMA SINTETICO',
            regra: 'apos_dias',
            diasCarencia: 3,
            motivo: null,
            global: false,
            ativo: true,
          },
        ];
        return json(rota, { id: 81 });
      }
      if (caminho === 'perfis') {
        cadastro.perfis = [
          {
            id: 91,
            versao: 1,
            codigo: 'PACIENTE',
            descricao: 'Paciente sintetico',
            publico: 'paciente',
            setores: [601],
            ocultaExameRestrito: true,
            diasVisibilidade: 90,
            global: false,
            ativo: true,
            aplicado: true,
          },
          // Trazidos de outro sistema: ativo do mesmo público que o portal não usa, e público ainda sem efeito.
          {
            id: 90,
            versao: 1,
            codigo: 'PAC-ANTIGO',
            descricao: 'Paciente antigo sintetico',
            publico: 'paciente',
            setores: [],
            ocultaExameRestrito: true,
            diasVisibilidade: null,
            global: false,
            ativo: true,
            aplicado: false,
          },
          {
            id: 89,
            versao: 1,
            codigo: 'EMPRESA',
            descricao: 'Empresa sintetica',
            publico: 'empresa',
            setores: [],
            ocultaExameRestrito: true,
            diasVisibilidade: null,
            global: false,
            ativo: true,
            aplicado: false,
          },
        ];
        return json(rota, { id: 91 });
      }
      if (caminho === 'prazo/71/desativar') {
        cadastro.prazos = cadastro.prazos.map((p) => ({ ...(p as object), ativo: false }));
        return json(rota, { id: 71 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/entregas/cadastro');
    await expect(page.getByTestId('entrega-cadastro')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/entregas/cadastro');

    // Prazo: só libera com o exame e o tempo; sem dia de realização não libera.
    const incluirPrazo = page.getByTestId('prazo-incluir');
    await expect(incluirPrazo).toBeDisabled();
    await escolher(page.getByTestId('prazo-exame'), { rotulo: 'HEMOGRAMA SINTETICO' });
    await expect(incluirPrazo).toBeDisabled();
    await expect(page.getByTestId('prazo-falta')).toBeVisible();
    await page.getByTestId('prazo-dias').fill('2');
    await expect(incluirPrazo).toBeEnabled();
    await escolher(page.getByTestId('prazo-setor'), { rotulo: 'LABORATORIO SINTETICO' });
    await page.getByTestId('prazo-corte').fill('16:00');
    await page.getByTestId('prazo-dia-0').uncheck();
    expect(pedidos).toHaveLength(0);
    await incluirPrazo.click();
    await expect(page.getByTestId('entrega-cadastro-mensagem')).toBeVisible();
    expect(pedidos[0]).toMatchObject({
      caminho: 'prazos',
      corpo: {
        exame: 501,
        setor: 601,
        prioridade: 'rotina',
        prazoDias: 2,
        horarioCorte: '16:00',
        diasDaSemana: [false, true, true, true, true, true, true],
      },
    });
    await expect(page.getByTestId('entrega-prazos')).toContainText('HEMOGRAMA SINTETICO');
    await expect(page.getByTestId('entrega-prazos')).toContainText('corte às 16:00');

    // Exame restrito: a carência só aparece (e só é exigida) na regra dos dias.
    await escolher(page.getByTestId('restricao-exame'), { rotulo: 'HEMOGRAMA SINTETICO' });
    await expect(page.getByTestId('restricao-carencia')).toHaveCount(0);
    await expect(page.getByTestId('restricao-incluir')).toBeEnabled();
    await escolher(page.getByTestId('restricao-regra'), { rotulo: 'Só depois de alguns dias da liberação' });
    await expect(page.getByTestId('restricao-incluir')).toBeDisabled();
    await page.getByTestId('restricao-carencia').fill('3');
    await page.getByTestId('restricao-incluir').click();
    await expect(page.getByTestId('entrega-restricoes')).toContainText('3 dia(s)');
    expect(pedidos[1]).toMatchObject({
      caminho: 'restricoes',
      corpo: { exame: 501, regra: 'apos_dias', diasCarencia: 3 },
    });

    // Perfil do portal: código conferido na hora, setores marcados.
    const salvar = page.getByTestId('perfil-salvar');
    await expect(salvar).toBeDisabled();
    await page.getByTestId('perfil-codigo').fill('P A');
    await page.getByTestId('perfil-descricao').fill('Paciente sintetico');
    await expect(salvar).toBeDisabled();
    await page.getByTestId('perfil-codigo').fill('PACIENTE');
    await expect(salvar).toBeEnabled();
    await page.getByTestId('perfil-setor-601').check();
    await page.getByTestId('perfil-visibilidade').fill('90');
    await salvar.click();
    expect(pedidos[2]).toMatchObject({
      caminho: 'perfis',
      corpo: {
        id: null,
        codigo: 'PACIENTE',
        publico: 'paciente',
        setores: [601],
        ocultaExameRestrito: true,
        diasVisibilidade: 90,
      },
    });
    await expect(page.getByTestId('entrega-perfis')).toContainText('LABORATORIO SINTETICO');
    await expect(page.getByTestId('entrega-perfis')).toContainText('visível por 90 dia(s)');
    // Um perfil por público: a tela diz a regra, qual perfil o portal usa e qual ativo não tem efeito.
    await expect(page.getByTestId('perfil-regra')).toContainText('um perfil por público');
    await expect(page.getByTestId('perfil-uso-91')).toHaveText('em uso no portal');
    await expect(page.getByTestId('perfil-uso-90')).toContainText('o portal usa outro perfil');
    await expect(page.getByTestId('perfil-uso-89')).toContainText('ainda não aplica perfil a este público');
    // Editar carrega o perfil no formulário (com a versão lida).
    await page.getByTestId('perfil-editar-91').click();
    await expect(page.getByTestId('perfil-codigo')).toHaveValue('PACIENTE');
    await expect(page.getByTestId('perfil-setor-601')).toBeChecked();

    // Desativar o prazo não o tira da lista.
    await page.getByTestId('prazo-desativar-71').click();
    await expect(page.getByTestId('entrega-prazos')).toContainText('inativo');
    expect(pedidos[3]).toMatchObject({ caminho: 'prazo/71/desativar' });
  });
});
