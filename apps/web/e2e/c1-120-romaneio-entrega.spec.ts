// E2E @C1-120 (F8, 09-AREA linha 77): romaneio de entrega entre unidades, pelo caminho da tela.
// O almoxarife abre "Romaneios de entrega" pelo menu de Suprimentos, cadastra o veículo (a placa fora do padrão é
// recusada na hora), monta o romaneio com duas transferências (uma leva controlado), vê a expedição travada para o
// motorista sem autorização de controlado e expede com o motorista autorizado. Na chegada, confere item a item: o
// recusado sem motivo trava o botão; com o motivo, a conferência fecha o romaneio entregue em parte.
// O romaneio grava só no banco próprio, que a fonte sintética do E2E não tem: as respostas de
// `/api/suprimentos/romaneios*` são simuladas pelo Playwright com massa SINTÉTICA no formato do servidor. A regra está
// em packages/contratos/src/suprimentos/regras/romaneio-entrega.spec.ts e o que fica no banco em
// apps/api/src/modulos/suprimentos/romaneio-entrega.int.spec.ts.
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
  rota.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });

const B = '/api/suprimentos/romaneios';
const motorista = (id: number, nome: string, controlado: boolean) => ({
  id,
  versao: 1,
  nome,
  tipoVinculo: 'proprio',
  transportadora: null,
  numeroHabilitacao: `1234567890${id}`,
  categorias: ['b'],
  vencimentoHabilitacao: '2099-12-31',
  habilitacaoVencida: false,
  transportaControlado: controlado,
  situacao: 'ativo',
  motivoInativacao: null,
});
const transferencia = (documento: number, numero: string, controlado: boolean) => ({
  documento,
  numero,
  situacao: 'enviada',
  movimentadoEm: '2026-11-25T08:00:00',
  origem: 'ALMOXARIFADO SINTETICO',
  destino: 'FARMACIA SATELITE SINTETICA',
  destinoUnidade: 'UNIDADE SINTETICA 2',
  itens: 3,
  controlado,
  termolabil: false,
});
const item = (id: number, sequencia: number, documento: number, situacao: string) => ({
  id,
  sequencia,
  documento,
  numeroDocumento: `T-${documento}`,
  situacaoDocumento: 'enviada',
  destinoUnidade: 'UNIDADE SINTETICA 2',
  destinoLocal: 'FARMACIA SATELITE SINTETICA',
  volumes: 1,
  situacao,
  recebedor: null,
  entregueEm: null,
  observacao: null,
});

test.describe('@C1-120 romaneio de entrega entre unidades', () => {
  test('cadastra o veículo, monta, expede com o motorista autorizado e confere por item; axe', async ({
    page,
  }) => {
    const veiculos: unknown[] = [];
    const transferencias = [transferencia(701, 'T-701', true), transferencia(702, 'T-702', false)];
    let romaneio: Record<string, unknown> | null = null;
    const gravados: { url: string; corpo: unknown; chave: string | null }[] = [];
    const resumo = () =>
      romaneio
        ? [
            {
              ...romaneio,
              lista: undefined,
              pendentes: (romaneio['lista'] as { situacao: string }[]).filter(
                (i) => i.situacao === 'pendente',
              ).length,
            },
          ]
        : [];
    await page.route(new RegExp(`${B}(/.*)?$`), async (rota) => {
      const req = rota.request();
      const url = new URL(req.url()).pathname;
      if (req.method() !== 'GET') {
        gravados.push({ url, corpo: req.postDataJSON(), chave: req.headers()['idempotency-key'] ?? null });
      }
      if (req.method() === 'GET' && url === B)
        return json(rota, {
          hoje: '2026-11-25',
          romaneios: resumo(),
          motoristas: [
            motorista(31, 'MOTORISTA SINTETICO SEM CONTROLADO', false),
            motorista(32, 'MOTORISTA SINTETICO AUTORIZADO', true),
          ],
          veiculos,
          transportadoras: [{ id: 81, nome: 'TRANSPORTADORA SINTETICA' }],
          transferencias: romaneio ? [] : transferencias,
        });
      if (req.method() === 'GET' && url === `${B}/1`) return json(rota, romaneio);
      if (url === `${B}/veiculos`) {
        veiculos.push({
          id: 41,
          versao: 1,
          codigo: 'VAN-SINT',
          descricao: 'VAN SINTETICA',
          placa: 'ABC1D23',
          proprio: true,
          transportadora: null,
          refrigerado: false,
          capacidadeCargaKg: 1200,
          ativo: true,
          motivoInativacao: null,
        });
        return json(rota, { ok: true, id: 41, mensagem: 'Veículo cadastrado.' }, 201);
      }
      if (url === B) {
        romaneio = {
          id: 1,
          versao: 1,
          numero: 1,
          descricao: 'ROTA SINTETICA',
          situacao: 'aberto',
          saidaPrevistaEm: null,
          saidaEm: null,
          chegadaEm: null,
          veiculo: 'ABC1D23',
          motorista: null,
          transportadora: null,
          valorFrete: null,
          itens: 2,
          pendentes: 2,
          veiculoId: 41,
          motoristaId: null,
          transportadoraId: null,
          quilometragemSaida: null,
          quilometragemChegada: null,
          liberador: null,
          conferente: null,
          observacao: null,
          levaControlado: true,
          levaTermolabil: false,
          lista: [item(901, 1, 701, 'pendente'), item(902, 2, 702, 'pendente')],
        };
        return json(rota, { ok: true, id: 1, numero: 1, mensagem: 'Romaneio 1 montado.' }, 201);
      }
      if (url === `${B}/1/expedicao` && romaneio) {
        romaneio = {
          ...romaneio,
          versao: 2,
          situacao: 'em_transito',
          motorista: 'MOTORISTA SINTETICO AUTORIZADO',
          motoristaId: 32,
          quilometragemSaida: 1000,
          saidaEm: '2026-11-25T09:00:00',
          liberador: 'ALMOXARIFE SINTETICO',
        };
        return json(rota, { ok: true, id: 1, mensagem: 'Romaneio expedido: em trânsito.' });
      }
      if (url === `${B}/1/conferencia` && romaneio) {
        romaneio = {
          ...romaneio,
          versao: 3,
          situacao: 'entregue_parcial',
          quilometragemChegada: 1042,
          lista: [item(901, 1, 701, 'entregue'), item(902, 2, 702, 'recusado')],
        };
        return json(rota, { ok: true, id: 1, mensagem: 'Conferência registrada.' });
      }
      return json(rota, { title: 'não simulado', status: 404 }, 404);
    });

    await entrar(page, 'SINT.ALMOXARIFE');
    await page.goto('/suprimentos/romaneios');
    const tela = page.getByTestId('tela-romaneios');
    await expect(tela.getByTestId('romaneio-vazio')).toBeVisible();

    // Veículo: a placa fora do padrão é recusada na hora; no padrão Mercosul, grava.
    await tela.getByTestId('romaneio-aba-veiculos').click();
    await tela.getByTestId('vei-codigo').fill('VAN-SINT');
    await tela.getByTestId('vei-descricao').fill('VAN SINTETICA');
    await tela.getByTestId('vei-placa').fill('AB12');
    await expect(tela.getByTestId('vei-recusas')).toBeVisible();
    await expect(tela.getByTestId('vei-gravar')).toBeDisabled();
    await tela.getByTestId('vei-placa').fill('ABC1D23');
    await tela.getByTestId('vei-capacidade').fill('1200');
    await expect(tela.getByTestId('vei-gravar')).toBeEnabled();
    await tela.getByTestId('vei-gravar').click();
    await expect(tela.getByTestId('romaneio-mensagem')).toContainText('Veículo cadastrado');
    const vei = gravados.find((g) => g.url === `${B}/veiculos`);
    expect(vei?.corpo).toMatchObject({
      codigo: 'VAN-SINT',
      placa: 'ABC1D23',
      proprio: true,
      capacidadeCargaKg: 1200,
    });
    expect(vei?.chave).toBeTruthy();

    // Montagem: as duas transferências, o controlado à vista, o veículo cadastrado.
    await tela.getByTestId('romaneio-aba-montar').click();
    await expect(tela.getByTestId('romaneio-transferencias')).toContainText('controlado');
    await expect(tela.getByTestId('romaneio-montar')).toBeDisabled();
    await tela.getByTestId('romaneio-transferencia-T-701').check();
    await tela.getByTestId('romaneio-transferencia-T-702').check();
    await tela.getByTestId('romaneio-descricao').fill('ROTA SINTETICA');
    await escolher(tela.getByTestId('romaneio-veiculo'), { rotulo: /ABC1D23/ });
    await tela.getByTestId('romaneio-montar').click();
    await expect(tela.getByTestId('romaneio-mensagem')).toContainText('Romaneio 1 montado');
    expect(gravados.find((g) => g.url === B)?.corpo).toMatchObject({
      documentos: [701, 702],
      veiculo: 41,
      descricao: 'ROTA SINTETICA',
    });

    // Expedição: o motorista sem autorização de controlado trava; o autorizado expede.
    await tela.getByTestId('romaneio-abrir-1').click();
    const detalhe = tela.getByTestId('romaneio-detalhe');
    await expect(detalhe).toContainText('Leva medicamento controlado');
    await escolher(detalhe.getByTestId('romaneio-exp-motorista'), { rotulo: /SEM CONTROLADO/ });
    await expect(detalhe.getByTestId('romaneio-recusas-expedicao')).toBeVisible();
    await expect(detalhe.getByTestId('romaneio-expedir')).toBeDisabled();
    await escolher(detalhe.getByTestId('romaneio-exp-motorista'), { rotulo: /AUTORIZADO/ });
    await detalhe.getByTestId('romaneio-km-saida').fill('1000');
    await expect(detalhe.getByTestId('romaneio-recusas-expedicao')).toHaveCount(0);
    await detalhe.getByTestId('romaneio-expedir').click();
    await expect(tela.getByTestId('romaneio-mensagem')).toContainText('em trânsito');
    expect(gravados.find((g) => g.url === `${B}/1/expedicao`)?.corpo).toMatchObject({
      versao: 1,
      veiculo: 41,
      motorista: 32,
      quilometragemSaida: 1000,
    });

    // Conferência por item: o recusado sem motivo trava; com o motivo, fecha entregue em parte.
    await expect(detalhe.getByTestId('romaneio-conferencia')).toBeVisible();
    await escolher(detalhe.getByTestId('romaneio-desfecho-1'), { rotulo: 'Entregue' });
    await escolher(detalhe.getByTestId('romaneio-desfecho-2'), { rotulo: 'Recusado' });
    await expect(detalhe.getByTestId('romaneio-recusas-conferencia')).toContainText('motivo');
    await expect(detalhe.getByTestId('romaneio-conferir')).toBeDisabled();
    await detalhe.getByTestId('romaneio-motivo-2').fill('Embalagem violada na chegada');
    await detalhe.getByTestId('romaneio-km-chegada').fill('1042');
    await detalhe.getByTestId('romaneio-conferir').click();
    await expect(tela.getByTestId('romaneio-mensagem')).toContainText('Conferência registrada');
    expect(gravados.find((g) => g.url === `${B}/1/conferencia`)?.corpo).toEqual({
      versao: 2,
      quilometragemChegada: 1042,
      desfechos: [
        { item: 901, desfecho: 'entregue', motivo: null },
        { item: 902, desfecho: 'recusado', motivo: 'Embalagem violada na chegada' },
      ],
    });
    await expect(detalhe).toContainText('Entregue em parte');
    await expect(detalhe.getByTestId('romaneio-item-2')).toContainText('Recusado');
    expect(gravados.every((g) => g.chave)).toBe(true);
    await semViolacaoAxe(page, '/suprimentos/romaneios');
  });
});
