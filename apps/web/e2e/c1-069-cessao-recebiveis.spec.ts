// F8 (07-FIN linha 79): a tela do portador do título e das operações de desconto e cessão de recebíveis e o bloco do
// portador na ficha do título a receber. As leituras e gravações de `/api/financeiro/nota-cessao` só existem no banco do
// cliente (na fonte sintética respondem 503), então este E2E simula as rotas com um estado em memória que segue a regra
// do servidor (conta do portador bancário, cessionário da cessão, coobrigação do desconto, limite do portador, desfecho
// só do item com o portador, recompra só com coobrigação, motivo do cancelamento com 5 caracteres ou mais). O que fica
// no banco (portador e condição, operação com os itens, parcela com o portador ou fora da carteira, lançamentos na conta,
// recompra, cancelamento que devolve) é provado no contrato de efeito `aplicacao/nota-cessao.int.spec.ts`; aqui se
// prova o fluxo da tela: o cadastro do portador com a conferência na hora, a operação com o tipo filtrando os
// portadores, a taxa da condição, as parcelas marcadas (a que já está com portador vem travada), a prévia pela regra do
// domínio (deságio, líquido, limite depois), a recusa antes de gravar, contratar com o corpo certo, o desfecho de cada
// item, o cancelamento com motivo, o portador na ficha do título e o item no menu. Axe em cada passo. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { escolher } from './combos.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
// Quem gere o financeiro com o perfil de administrador do sistema (que dá financeiro.cessaoRecebivel.* e
// financeiro.parametro.editar).
const LOGIN = 'SINT.FIN.GESTOR';
const TELA = '/financeiro/receber/cessao';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });
const somarDias = (iso: string, dias: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

interface Portador {
  portador: number;
  codigo: string;
  descricao: string;
  tipo: string;
  ativo: boolean;
  contaBancaria: number | null;
  pessoaJuridica: number | null;
  taxaDesconto: number | null;
  prazoDias: number | null;
  limiteCredito: number | null;
  valorTarifa: number | null;
  vigenciaInicio: string | null;
  utilizado: number;
}
interface Item {
  item: number;
  parcela: number;
  documento: string;
  vencimento: string;
  valorFace: number;
  valorDesagio: number;
  situacao: string;
}
interface Operacao {
  operacao: number;
  numero: number;
  tipo: string;
  dataOperacao: string;
  taxaMensal: number;
  comCoobrigacao: boolean;
  valorFace: number;
  valorDesagio: number;
  valorTarifas: number;
  valorIof: number;
  valorLiquido: number;
  situacao: string;
  portador: string | null;
  itens: Item[];
}

test.describe('financeiro: portador do título, desconto e cessão de recebíveis @C1-069', () => {
  test.setTimeout(180_000);

  test('cadastra portador com conferência na hora, contrata com prévia, dá desfecho, cancela e mostra o portador no título; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const apoios = {
      motivos: [],
      motivosCancelamento: [],
      tributos: [],
      contas: [{ id: 5, rotulo: 'CONTA COBRANCA SINTETICA' }],
      pessoas: [{ id: 8, rotulo: 'FUNDO SINTETICO' }],
    };
    const portadores: Portador[] = [
      {
        portador: 1,
        codigo: 'DESC1',
        descricao: 'BANCO DESCONTO SINTETICO',
        tipo: 'cobranca_descontada',
        ativo: true,
        contaBancaria: 5,
        pessoaJuridica: null,
        taxaDesconto: 2,
        prazoDias: null,
        limiteCredito: null,
        valorTarifa: null,
        vigenciaInicio: '2026-01-01',
        utilizado: 0,
      },
    ];
    const parcelas = [
      {
        parcela: 21,
        sequencia: 1,
        vencimento: '',
        saldo: 600,
        situacao: 'aberta',
        titulo: 201,
        numero: 'TR-SINT-201',
        documento: 'FAT 201',
        contraparte: 'CLIENTE SINTETICO',
        portador: null as string | null,
      },
      {
        parcela: 22,
        sequencia: 2,
        vencimento: '',
        saldo: 400,
        situacao: 'aberta',
        titulo: 201,
        numero: 'TR-SINT-201',
        documento: 'FAT 201',
        contraparte: 'CLIENTE SINTETICO',
        portador: null as string | null,
      },
      {
        parcela: 23,
        sequencia: 1,
        vencimento: '',
        saldo: 300,
        situacao: 'aberta',
        titulo: 202,
        numero: 'TR-SINT-202',
        documento: 'FAT 202',
        contraparte: 'CONVENIO SINTETICO',
        portador: 'OUTRO PORTADOR SINTETICO' as string | null,
      },
    ];
    const operacoes: Operacao[] = [];
    let proximoItem = 1;

    await page.route('**/api/financeiro/nota-cessao/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/nota-cessao/, '');
      if (req.method() === 'GET') {
        if (caminho === '/apoios') return json(rota, apoios);
        if (caminho === '/portadores') return json(rota, portadores);
        if (caminho === '/operacoes') return json(rota, operacoes);
        if (caminho === '/parcelas') {
          // A busca filtra pelo devedor ou pelo número/sequência (só para o teste trocar a busca entre as marcações).
          const busca = (url.searchParams.get('busca') ?? '').toUpperCase();
          return json(
            rota,
            parcelas.filter(
              (p) =>
                p.situacao === 'aberta' &&
                (!busca || `${p.contraparte ?? ''} ${p.numero}/${p.sequencia}`.toUpperCase().includes(busca)),
            ),
          );
        }
        if (caminho === '/titulos/201')
          return json(
            rota,
            parcelas
              .filter((p) => p.titulo === 201)
              .map((p) => {
                const op = operacoes.find((o) => o.itens.some((i) => i.parcela === p.parcela));
                const it = op?.itens.find((i) => i.parcela === p.parcela);
                return {
                  parcela: p.parcela,
                  sequencia: p.sequencia,
                  vencimento: p.vencimento,
                  saldo: p.situacao === 'aberta' ? p.saldo : 0,
                  situacao: p.situacao,
                  portador: p.portador,
                  tipoPortador: p.portador ? 'cobranca_descontada' : null,
                  operacao:
                    op && it
                      ? {
                          numero: op.numero,
                          tipo: op.tipo,
                          comCoobrigacao: op.comCoobrigacao,
                          situacao: op.situacao,
                          situacaoItem: it.situacao,
                        }
                      : null,
                };
              }),
          );
        return json(rota, []);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      if (caminho === '/portadores') {
        if (corpo['tipo'] === 'cessao' && corpo['pessoaJuridica'] === null)
          return recusa(rota, 'cessionario-obrigatorio', 'Informe o cessionário (banco, fundo ou fomento).');
        portadores.push({
          portador: portadores.length + 1,
          codigo: String(corpo['codigo']),
          descricao: String(corpo['descricao']),
          tipo: String(corpo['tipo']),
          ativo: corpo['ativo'] === true,
          contaBancaria: corpo['contaBancaria'] as number | null,
          pessoaJuridica: corpo['pessoaJuridica'] as number | null,
          taxaDesconto: Number(corpo['taxaDesconto']),
          prazoDias: corpo['prazoDias'] as number | null,
          limiteCredito: corpo['limiteCredito'] as number | null,
          valorTarifa: corpo['valorTarifa'] as number | null,
          vigenciaInicio: String(corpo['vigenciaInicio']),
          utilizado: 0,
        });
        return ok('Portador gravado.');
      }
      if (caminho === '/operacoes') {
        const port = portadores.find((p) => p.portador === corpo['portador']);
        if (!port) return recusa(rota, 'portador-inexistente', 'O portador não existe ou está inativo.');
        const ids = corpo['parcelas'] as number[];
        const taxa = Number(corpo['taxaMensal']);
        const itens: Item[] = ids.map((id) => {
          const p = parcelas.find((x) => x.parcela === id);
          const dias = Math.round(
            (Date.parse(`${p?.vencimento}T00:00:00Z`) -
              Date.parse(`${String(corpo['dataOperacao'])}T00:00:00Z`)) /
              86_400_000,
          );
          return {
            item: proximoItem++,
            parcela: id,
            documento: p?.documento ?? '',
            vencimento: p?.vencimento ?? '',
            valorFace: p?.saldo ?? 0,
            valorDesagio: Math.round(((p?.saldo ?? 0) * taxa * dias) / 30) / 100,
            situacao: 'cedida',
          };
        });
        const face = itens.reduce((s, i) => s + i.valorFace, 0);
        const desagio = itens.reduce((s, i) => s + i.valorDesagio, 0);
        const liquido = face - desagio - Number(corpo['valorTarifas']) - Number(corpo['valorIof']);
        const numero = operacoes.length + 1;
        operacoes.unshift({
          operacao: numero,
          numero,
          tipo: String(corpo['tipo']),
          dataOperacao: String(corpo['dataOperacao']),
          taxaMensal: taxa,
          comCoobrigacao: corpo['comCoobrigacao'] === true,
          valorFace: face,
          valorDesagio: desagio,
          valorTarifas: Number(corpo['valorTarifas']),
          valorIof: Number(corpo['valorIof']),
          valorLiquido: liquido,
          situacao: 'contratada',
          portador: port.descricao,
          itens,
        });
        port.utilizado += face;
        for (const id of ids) {
          const p = parcelas.find((x) => x.parcela === id);
          if (p) p.portador = port.descricao;
        }
        return ok(`Operação ${numero} contratada: líquido ${liquido.toFixed(2)}.`);
      }
      if (caminho === '/operacoes/desfecho') {
        const op = operacoes.find((o) => o.itens.some((i) => i.item === corpo['item']));
        const it = op?.itens.find((i) => i.item === corpo['item']);
        if (!op || !it) return recusa(rota, 'item-inexistente', 'O item não existe.');
        if (op.situacao !== 'contratada' || it.situacao !== 'cedida')
          return recusa(rota, 'item-encerrado', 'Este recebível já teve desfecho.');
        const p = parcelas.find((x) => x.parcela === it.parcela);
        if (corpo['acao'] === 'recomprar') {
          if (!op.comCoobrigacao)
            return recusa(rota, 'sem-coobrigacao', 'Na cessão sem coobrigação o hospital não recompra.');
          it.situacao = 'recomprada';
          if (p) p.portador = null;
        } else {
          it.situacao = 'liquidada';
          if (p) p.situacao = 'recebida';
        }
        if (op.itens.every((i) => i.situacao !== 'cedida')) op.situacao = 'liquidada';
        return ok(
          corpo['acao'] === 'recomprar'
            ? 'Recebível recomprado: a parcela voltou à carteira.'
            : 'Recebível liquidado pelo sacado.',
        );
      }
      if (caminho === '/operacoes/cancelar') {
        if (String(corpo['motivo'] ?? '').trim().length < 5)
          return recusa(rota, 'motivo-obrigatorio', 'Informe o motivo.');
        const op = operacoes.find((o) => o.operacao === corpo['operacao']);
        if (!op || op.situacao !== 'contratada')
          return recusa(rota, 'operacao-nao-contratada', 'A operação não está contratada.');
        let devolvidas = 0;
        for (const i of op.itens)
          if (i.situacao === 'cedida') {
            i.situacao = 'devolvida';
            devolvidas++;
            const p = parcelas.find((x) => x.parcela === i.parcela);
            if (p) p.portador = null;
          }
        op.situacao = 'cancelada';
        return ok(`Operação cancelada; ${devolvidas} parcela(s) devolvida(s).`);
      }
      return recusa(rota, 'rota-inexistente', 'Rota não simulada.');
    });
    // A ficha do título 201 (só o que a tela lê; o resto do título é de outras funções).
    await page.route('**/api/financeiro/receber/titulos/201', (rota) =>
      json(rota, {
        id: 201,
        devedor: 'CLIENTE',
        codigo: 1,
        convenio: 0,
        documento: 201,
        apresentacao: null,
        vencimento: parcelas[0]?.vencimento ?? null,
        valor: 1000,
        recebido: 0,
        dataRecebimento: null,
        origem: 'avulso',
        origemBaixa: '',
        nome: 'CLIENTE SINTETICO',
        contas: 0,
        glosaAceita: 0,
        situacao: 'aberto',
        versao: '1',
        contasLigadas: [],
        glosa: {
          itens: 0,
          baixados: 0,
          cobradoBaixado: 0,
          pagoBaixado: 0,
          glosado: 0,
          pagoAMaior: 0,
          taxa: 0,
        },
        glosas: [],
        saldo: 1000,
        recebivelRecurso: 0,
      }),
    );

    await entrar(page, LOGIN);
    const hoje = ((await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string }).hoje;
    const [p21, p22, p23] = parcelas;
    if (p21) p21.vencimento = somarDias(hoje, 15);
    if (p22) p22.vencimento = somarDias(hoje, 45);
    if (p23) p23.vencimento = somarDias(hoje, 30);
    await page.goto(TELA);
    await expect(page.getByTestId('tela-fin-cessao')).toBeVisible();
    await expect(page.getByTestId('ces-portador-DESC1')).toBeVisible();
    await semViolacaoAxe(page, `${TELA} (início)`);

    // Portador: o cessionário sem a pessoa jurídica é recusado na hora; com ela, grava o corpo certo.
    await page.getByTestId('ces-codigo').fill('CESS1');
    await page.getByTestId('ces-descricao').fill('FUNDO CESSIONARIO SINTETICO');
    await escolher(page.getByTestId('ces-tipo-portador'), { rotulo: /Cessão \(cessionário\)/ });
    await expect(page.getByTestId('ces-falta-portador')).toContainText('Informe o cessionário');
    await expect(page.getByTestId('ces-gravar-portador')).toBeDisabled();
    await escolher(page.getByTestId('ces-pessoa'), { rotulo: /FUNDO SINTETICO/ });
    await escolher(page.getByTestId('ces-conta'), { rotulo: /CONTA COBRANCA SINTETICA/ });
    await page.getByTestId('ces-taxa').fill('3');
    await page.getByTestId('ces-limite').fill('500');
    await expect(page.getByTestId('ces-falta-portador')).toHaveCount(0);
    await semViolacaoAxe(page, `${TELA} (portador)`);
    await page.getByTestId('ces-gravar-portador').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Portador gravado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/portadores',
      corpo: {
        id: null,
        codigo: 'CESS1',
        descricao: 'FUNDO CESSIONARIO SINTETICO',
        tipo: 'cessao',
        contaBancaria: 5,
        pessoaJuridica: 8,
        taxaDesconto: 3,
        prazoDias: null,
        limiteCredito: 500,
        valorTarifa: null,
        vigenciaInicio: hoje,
        ativo: true,
      },
    });
    await expect(page.getByTestId('ces-disponivel-CESS1')).toContainText('R$ 500,00');

    // Cessão: o tipo filtra o portador; a parcela com outro portador vem travada; o limite estoura antes de gravar.
    await escolher(page.getByTestId('ces-tipo-operacao'), { rotulo: /Cessão de recebíveis/ });
    await escolher(page.getByTestId('ces-portador'), { rotulo: /CESS1/ });
    await expect(page.getByTestId('ces-taxa-op')).toHaveValue('3');
    await expect(page.getByTestId('ces-marcar-23')).toBeDisabled();
    await page.getByTestId('ces-marcar-21').check();
    await expect(page.getByTestId('ces-recusa-previa')).toContainText('passa do limite do portador');
    await expect(page.getByTestId('ces-contratar')).toBeDisabled();
    await page.getByTestId('ces-marcar-21').uncheck();

    // Desconto de duplicata: coobrigação travada; prévia pela regra do domínio (600 × 2% × 15/30 = 6; 400 × 2% × 45/30 = 12).
    await escolher(page.getByTestId('ces-tipo-operacao'), { rotulo: /Desconto de duplicata/ });
    await expect(page.getByTestId('ces-coobrigacao')).toBeChecked();
    await expect(page.getByTestId('ces-coobrigacao')).toBeDisabled();
    await escolher(page.getByTestId('ces-portador'), { rotulo: /DESC1/ });
    // Marcar numa busca, trocar a busca e marcar de novo: a prévia, o contador e o corpo enviado usam as duas.
    await page.getByTestId('ces-busca').fill('TR-SINT-201/1');
    await expect(page.getByTestId('ces-marcar-22')).toHaveCount(0);
    await page.getByTestId('ces-marcar-21').check();
    await page.getByTestId('ces-busca').fill('TR-SINT-201/2');
    await expect(page.getByTestId('ces-marcar-21')).toHaveCount(0);
    await page.getByTestId('ces-marcar-22').check();
    await page.getByTestId('ces-tarifas').fill('10');
    await expect(page.getByTestId('ces-marcadas')).toContainText('2 parcela(s)');
    await expect(page.getByTestId('ces-previa-texto')).toContainText('Face R$ 1.000,00');
    await expect(page.getByTestId('ces-previa-texto')).toContainText('deságio R$ 18,00');
    await expect(page.getByTestId('ces-previa-texto')).toContainText('líquido na conta R$ 972,00');
    await page.getByTestId('ces-contrato').fill('CT-SINT-1');
    await semViolacaoAxe(page, `${TELA} (operação)`);
    await page.getByTestId('ces-contratar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Operação 1 contratada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/operacoes',
      corpo: {
        portador: 1,
        tipo: 'desconto_duplicata',
        comCoobrigacao: true,
        dataOperacao: hoje,
        taxaMensal: 2,
        valorTarifas: 10,
        valorIof: 0,
        numeroContrato: 'CT-SINT-1',
        parcelas: [21, 22],
      },
    });
    await expect(page.getByTestId('ces-operacao-situacao-1')).toContainText('Contratada');

    // A ficha do título mostra com quem cada parcela está e a operação.
    await page.goto('/financeiro/receber/titulos/201');
    await expect(page.getByTestId('trd-portador')).toBeVisible();
    await expect(page.getByTestId('trd-portador-1')).toContainText('BANCO DESCONTO SINTETICO');
    await expect(page.getByTestId('trd-portador-1')).toContainText('operação 1 (Desconto de duplicata');
    await expect(page.getByTestId('trd-portador-1')).toContainText('Com o portador');
    await semViolacaoAxe(page, '/financeiro/receber/titulos/201 (portador)');
    await page.getByTestId('trd-ir-cessao').click();
    await expect(page).toHaveURL(/\/financeiro\/receber\/cessao/);

    // Desfecho: o devedor pagou ao portador a primeira; o hospital recompra a segunda pelo valor informado.
    await page.getByTestId('ces-liquidar-1').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('liquidado pelo sacado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/operacoes/desfecho',
      corpo: { item: 1, acao: 'liquidar', data: hoje },
    });
    await expect(page.getByTestId('ces-item-situacao-1')).toContainText('Paga ao portador');
    await page.getByTestId('ces-valor-recompra-2').fill('400');
    await page.getByTestId('ces-recomprar-2').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('voltou à carteira');
    expect(corpos.at(-1)).toEqual({
      caminho: '/operacoes/desfecho',
      corpo: { item: 2, acao: 'recomprar', data: hoje, valorRecompra: 400 },
    });
    await expect(page.getByTestId('ces-operacao-situacao-1')).toContainText('Liquidada');
    await expect(page.getByTestId('ces-cancelar-1')).toHaveCount(0);

    // Nova operação com a parcela recomprada e cancelamento com motivo conferido na hora.
    await escolher(page.getByTestId('ces-portador'), { rotulo: /DESC1/ });
    await page.getByTestId('ces-marcar-22').check();
    await page.getByTestId('ces-contratar').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('Operação 2 contratada');
    await page.getByTestId('ces-cancelar-2').click();
    await page.getByTestId('ces-motivo').fill('erro');
    await expect(page.getByTestId('ces-confirmar-cancelamento')).toBeDisabled();
    await expect(page.getByTestId('ces-cancelamento')).toContainText('Faltam 1 caracteres');
    await page.getByTestId('ces-motivo').fill('contrato não assinado');
    await semViolacaoAxe(page, `${TELA} (cancelar)`);
    await page.getByTestId('ces-confirmar-cancelamento').click();
    await expect(page.getByTestId('fat-mensagem')).toContainText('1 parcela(s) devolvida(s)');
    expect(corpos.at(-1)).toEqual({
      caminho: '/operacoes/cancelar',
      corpo: { operacao: 2, motivo: 'contrato não assinado' },
    });
    // A cancelada fica na lista, sem ações.
    await expect(page.getByTestId('ces-operacao-situacao-2')).toContainText('Cancelada');
    await expect(page.getByTestId('ces-item-situacao-3')).toContainText('Devolvida à carteira');

    // O item está no menu.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'Desconto e cessão de recebíveis')).click();
    await expect(page).toHaveURL(/\/financeiro\/receber\/cessao/);
    await expect(page.getByTestId('tela-fin-cessao')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
