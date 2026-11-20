// M54.6 pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco): cada rota do
// patrimônio pela permissão da opção do outro sistema. O responsável pelo patrimônio (Gestão patrimonial: Bens,
// Movimentação, Cálculo de Depreciação, Transferência, Baixa, Relatórios) cadastra da nota, deprecia, movimenta, baixa e
// faz o inventário; o gestor do setor (Movimentação) aceita a transferência e não cadastra; quem só consulta a ficha de
// bens lê e não grava. A chave `patrimonio` está ligada na sessão sintética. Dados sintéticos.
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { textoDoQr } from '@sgh/dominio-patrimonio';
import { PORTA_PATRIMONIO } from './porta.js';
import type { PortaPatrimonioMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  csrfDe.set(
    cookie,
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '',
  );
  return cookie;
}
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '' },
    payload: payload as Record<string, unknown>,
  });

const P = '/api/patrimonio';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: { json: () => unknown }) => r.json() as any;

describe('patrimônio: cada rota pela sua permissão, o ciclo do bem', { timeout: 180_000 }, () => {
  it('leituras e ações de quem pode; consulta só lê; sem opção, 403', async () => {
    const pat = await entrar('SINT.PATRIMONIO');
    const a = j(await get(pat, `${P}/apoio`));
    expect(a.liberacao).toEqual({ ligada: true });
    expect(a.acoes).toEqual({
      cadastrar: true,
      calcular: true,
      registrar: true,
      aceitar: true,
      baixar: true,
      contar: true,
    });
    expect(a.grupos.map((g: { valor: string }) => g.valor)).toContain('equipamentoMedico');
    expect(a.parametros).toEqual([
      { empresa: 1, depreciar: true, aplicarCoeficiente: true, considerarResidual: true },
    ]);
    const con = await entrar('SINT.PATRIMONIO.CONSULTA');
    expect(j(await get(con, `${P}/apoio`)).acoes).toEqual({
      cadastrar: false,
      calcular: false,
      registrar: false,
      aceitar: false,
      baixar: false,
      contar: false,
    });
    expect((await get(con, `${P}/bens`)).statusCode).toBe(200);
    expect((await get(con, `${P}/depreciacao?empresa=1&competencia=2026-04`)).statusCode).toBe(403);
    expect((await get(con, `${P}/notas?competencia=2026-03`)).statusCode).toBe(403);
    expect((await post(con, `${P}/bens`, {})).statusCode).toBe(403);
    expect((await get(con, `${P}/inventarios`)).statusCode).toBe(403);
    const sem = await entrar('SINT.CUSTOS.CONSULTA');
    expect((await get(sem, `${P}/bens`)).statusCode).toBe(403);
  });

  it('o ciclo: nota → bens → depreciação → transferência com aceite → empréstimo e devolução → baixa → inventário', async () => {
    const pat = await entrar('SINT.PATRIMONIO');
    const setor = await entrar('SINT.PATRIMONIO.SETOR');

    // regra 11: da nota fiscal de entrada (as unidades do item, uma plaqueta por unidade)
    const notas = j(await get(pat, `${P}/notas?competencia=2026-03`));
    expect(notas.notas.map((n: { id: number }) => n.id)).toEqual([9001]);
    const itens = j(await get(pat, `${P}/notas/9001/itens`));
    expect(itens.itens.map((i: { id: number; disponiveis: number }) => [i.id, i.disponiveis])).toEqual([
      [90011, 2],
      [90012, 1],
    ]);
    const base = {
      descricao: 'Monitor multiparamétrico',
      grupo: 'equipamentoMedico',
      origem: 1,
      centro: 101,
    };
    const cad = await post(pat, `${P}/bens`, {
      documento: 'nota',
      nota: 9001,
      itemNota: 90011,
      quantidade: 2,
      ...base,
    });
    expect(cad.statusCode, cad.body).toBe(201);
    const [b1, b2] = j(cad).bens as {
      id: number;
      plaqueta: string;
      valorCent: number;
      inicioDepreciacao: string;
      qr: string;
      versao: number;
    }[];
    expect([b1?.valorCent, b2?.valorCent]).toEqual([12_000_00, 12_000_00]);
    expect(b1?.inicioDepreciacao).toBe('2026-04');
    expect(b1?.qr).toBe(textoDoQr('aa', b1?.plaqueta ?? ''));
    const esgotado = await post(pat, `${P}/bens`, {
      documento: 'nota',
      nota: 9001,
      itemNota: 90011,
      ...base,
    });
    expect(esgotado.statusCode).toBe(409);
    expect(j(esgotado).codigo).toBe('item-esgotado');
    // sem nota: só a doação com termo
    const termo = {
      documento: 'termo',
      termoNumero: 'TD-1/2026',
      termoData: '2026-04-01',
      doador: 'Associação sintética',
      empresa: 1,
      dataAquisicao: '2026-04-01',
      valorCent: 1_200_00,
      descricao: 'Cadeira de rodas',
      grupo: 'moveis',
      centro: 103,
    };
    const semNota = await post(pat, `${P}/bens`, { ...termo, origem: 1 });
    expect(semNota.statusCode).toBe(409);
    expect(j(semNota).codigo).toBe('sem-nota');
    const doacao = await post(pat, `${P}/bens`, { ...termo, origem: 2 });
    expect(doacao.statusCode, doacao.body).toBe(201);
    const b3 = (j(doacao).bens as { id: number; plaqueta: string }[])[0]!;
    expect(j(await get(pat, `${P}/bens`)).total).toBe(3);
    expect(j(await get(pat, `${P}/bens/codigo?codigo=${encodeURIComponent(b1!.qr)}`)).id).toBe(b1?.id);
    expect(j(await get(pat, `${P}/bens/${b1?.id}/etiqueta`)).zpl).toContain('^XA');

    // regra 12: depreciação linear, a prévia e as parcelas, a sequência
    const previa = j(await get(pat, `${P}/depreciacao?empresa=1&competencia=2026-04`));
    expect(previa.calculo).toBeNull();
    expect(previa.cotas.map((c: { valorCent: number }) => c.valorCent)).toEqual([100_00, 100_00]);
    expect(previa.totalCent).toBe(200_00);
    expect(previa.semCota).toEqual([{ bem: b3.id, plaqueta: b3.plaqueta, motivo: 'ainda-nao-iniciou' }]);
    expect(previa.impedimentos).toEqual([]);
    const calc = await post(pat, `${P}/depreciacao/calculo`, { empresa: 1, competencia: '2026-04' });
    expect(calc.statusCode, calc.body).toBe(201);
    expect(j(calc).calculo).toMatchObject({ competencia: '2026-04', bens: 2, totalCent: 200_00 });
    const pulou = await post(pat, `${P}/depreciacao/calculo`, { empresa: 1, competencia: '2026-06' });
    expect(pulou.statusCode).toBe(409);
    expect(
      (await post(pat, `${P}/depreciacao/calculo`, { empresa: 1, competencia: '2026-05' })).statusCode,
    ).toBe(201);

    // W0-08, parte 5: o estorno do último cálculo, com motivo (fato novo; a competência se recalcula depois)
    const estorno = {
      empresa: 1,
      competencia: '2026-05',
      motivo: 'Vida útil cadastrada errada',
      senha: SENHA,
    };
    const doMeio = await post(pat, `${P}/depreciacao/estorno`, { ...estorno, competencia: '2026-04' });
    expect(doMeio.statusCode).toBe(409);
    expect(j(doMeio).codigo).toBe('nao-e-o-ultimo');
    expect((await post(pat, `${P}/depreciacao/estorno`, { ...estorno, motivo: 'x' })).statusCode).toBe(400);
    const con = await entrar('SINT.PATRIMONIO.CONSULTA');
    expect((await post(con, `${P}/depreciacao/estorno`, estorno)).statusCode).toBe(403);
    const memoria = app.get(PORTA_PATRIMONIO) as PortaPatrimonioMemoria;
    memoria.lotesExportados.push({ empresa: 1, periodo: '2026-05', exportadoEm: '2026-06-02T10:00:00' });
    const exportado = await post(pat, `${P}/depreciacao/estorno`, estorno);
    expect(exportado.statusCode).toBe(409);
    expect(j(exportado).codigo).toBe('lote-exportado');
    expect(j(exportado).detail).toMatch(/cancele a exportação primeiro/);
    memoria.lotesExportados.length = 0;
    const antesDoEstorno = j(await get(pat, `${P}/depreciacao?empresa=1&competencia=2026-05`));
    expect(antesDoEstorno.estornavel).toBe(true);
    expect(j(await get(pat, `${P}/depreciacao?empresa=1&competencia=2026-04`)).estornavel).toBe(false);
    const est = await post(pat, `${P}/depreciacao/estorno`, estorno);
    expect(est.statusCode, est.body).toBe(201);
    expect(j(est).calculo).toBeNull();
    expect(j(est).estornos[0]).toMatchObject({
      calculo: antesDoEstorno.calculo.id,
      motivo: 'Vida útil cadastrada errada',
      origem: 'patrimonio/estorno-depreciacao',
      estornadoPor: 'SINT.PATRIMONIO',
      totalCent: antesDoEstorno.totalCent,
    });
    expect(j(est).impedimentos).toEqual([]);
    // A cota estornada não conta na acumulada; o estorno repetido não acha cálculo vigente.
    expect(j(await get(pat, `${P}/bens/${b1?.id}`)).acumuladaCent).toBe(100_00);
    expect(j(await post(pat, `${P}/depreciacao/estorno`, estorno)).codigo).toBe('sem-calculo');
    expect(trilha.eventos.some((l) => l.evento === 'patrimonio.depreciacao.estornada')).toBe(true);
    const recalculo = await post(pat, `${P}/depreciacao/calculo`, { empresa: 1, competencia: '2026-05' });
    expect(recalculo.statusCode, recalculo.body).toBe(201);
    expect(j(recalculo).calculo).toMatchObject({ rodada: 2, totalCent: antesDoEstorno.totalCent });
    expect(j(recalculo).estornos).toHaveLength(1);
    const detalhe = j(await get(pat, `${P}/bens/${b1?.id}`));
    expect(detalhe).toMatchObject({
      acumuladaCent: 200_00,
      contabilCent: 11_800_00,
      ultimaCompetencia: '2026-05',
    });
    const alterar = {
      descricao: 'Monitor multiparamétrico',
      grupo: 'equipamentoMedico',
      localDetalhe: 'Leito 3',
      tipoResponsavel: null,
      responsavel: null,
      marca: null,
      modelo: null,
      numeroSerie: null,
      vidaUtilMeses: 60,
      residualCent: 0,
      coeficiente: null,
      inicioDepreciacao: '2026-04',
      depreciavel: true,
      versao: detalhe.versao,
    };
    expect((await post(pat, `${P}/bens/${b1?.id}`, alterar)).statusCode).toBe(409);
    const alterado = await post(pat, `${P}/bens/${b1?.id}`, { ...alterar, vidaUtilMeses: 120 });
    expect(alterado.statusCode, alterado.body).toBe(200);
    expect(j(alterado)).toMatchObject({ mudou: true, bem: { localDetalhe: 'Leito 3' } });

    // regra 13: transferência com o aceite de quem recebe
    const v1 = j(alterado).bem.versao as number;
    const transf = {
      tipo: 'transferencia',
      bem: b1?.id,
      versao: v1,
      data: '2026-10-20',
      motivo: 'Reorganização',
      destino: 102,
    };
    expect((await post(setor, `${P}/movimentos`, transf)).statusCode).toBe(403);
    const pedido = await post(pat, `${P}/movimentos`, transf);
    expect(pedido.statusCode, pedido.body).toBe(201);
    const mov = j(pedido).movimento as { id: number; situacao: string; versao: number };
    expect(mov.situacao).toBe('pendente');
    expect(j(pedido).bem.centro.id).toBe(101);
    const dePat = await post(pat, `${P}/movimentos/${mov.id}/decisao`, { aceitar: true, versao: mov.versao });
    expect(dePat.statusCode).toBe(409);
    // D-ACEITE-546: o gestor de outro setor não vê o pedido entre os pendentes e não aceita nem recusa
    const outro = await entrar('SINT.PATRIMONIO.OUTRO');
    expect(j(await get(outro, `${P}/movimentos?situacao=pendente`))).toEqual([]);
    expect(j(await get(setor, `${P}/movimentos?situacao=pendente`)).map((m: { id: number }) => m.id)).toEqual(
      [mov.id],
    );
    for (const aceitar of [true, false]) {
      const deOutro = await post(outro, `${P}/movimentos/${mov.id}/decisao`, {
        aceitar,
        versao: mov.versao,
        ...(aceitar ? {} : { motivo: 'Não é deste setor' }),
      });
      expect(deOutro.statusCode, deOutro.body).toBe(409);
      expect(deOutro.body).toMatch(/setor de destino/u);
    }
    const aceite = await post(setor, `${P}/movimentos/${mov.id}/decisao`, {
      aceitar: true,
      versao: mov.versao,
    });
    expect(aceite.statusCode, aceite.body).toBe(200);
    expect(j(aceite).bem.centro.id).toBe(102);
    expect(j(await get(pat, `${P}/movimentos?situacao=aceito`)).length).toBe(1);

    // empréstimo e devolução; a baixa não cai em competência depreciada e exige a rota própria
    const v2 = j(await get(pat, `${P}/bens/${b2?.id}`)).versao as number;
    const emp = await post(pat, `${P}/movimentos`, {
      tipo: 'emprestimo',
      bem: b2?.id,
      versao: v2,
      data: '2026-10-21',
      motivo: 'Apoio a parceiro',
      terceiro: 'Hospital parceiro sintético',
    });
    expect(emp.statusCode, emp.body).toBe(201);
    expect(j(emp).bem.situacao).toBe('emprestado');
    const dev = await post(pat, `${P}/movimentos`, {
      tipo: 'devolucao',
      bem: b2?.id,
      versao: j(emp).bem.versao,
      data: '2026-10-22',
      motivo: 'Retorno',
    });
    expect(dev.statusCode, dev.body).toBe(201);
    expect(j(dev).movimento.referencia).toBe(j(emp).movimento.id);
    const v3 = j(dev).bem.versao as number;
    expect(
      (
        await post(pat, `${P}/movimentos`, {
          tipo: 'baixa',
          bem: b2?.id,
          versao: v3,
          data: '2026-10-22',
          motivo: 'x',
          termoNumero: 'T',
        })
      ).statusCode,
    ).toBe(400);
    const baixaVelha = await post(pat, `${P}/bens/${b2?.id}/baixa`, {
      versao: v3,
      data: '2026-05-10',
      motivo: 'Obsolescência',
      termoNumero: 'TB-1',
      senha: SENHA,
    });
    expect(baixaVelha.statusCode).toBe(409);
    const baixa = await post(pat, `${P}/bens/${b2?.id}/baixa`, {
      versao: v3,
      data: '2026-10-22',
      motivo: 'Obsolescência',
      termoNumero: 'TB-1',
      valorVendaCent: 50_00,
      senha: SENHA,
    });
    expect(
      (
        await post(pat, `${P}/bens/${b1?.id}/baixa`, {
          versao: 0,
          data: '2026-10-22',
          motivo: 'x',
          termoNumero: 'T',
        })
      ).statusCode,
    ).not.toBe(201);
    expect(baixa.statusCode, baixa.body).toBe(201);
    expect(j(baixa).bem).toMatchObject({ situacao: 'baixado', baixadoEm: '2026-10-22' });
    // o termo de baixa (PDF/A pelo Gotenberg; sem ele no ar, 503 com o motivo) e a recusa para o bem ainda ativo
    const termoBaixa = await get(pat, `${P}/bens/${b2?.id}/termo-baixa`);
    expect([200, 503]).toContain(termoBaixa.statusCode);
    if (termoBaixa.statusCode === 200)
      expect(termoBaixa.headers['content-type']).toContain('application/pdf');
    expect((await get(pat, `${P}/bens/${b1?.id}/termo-baixa`)).statusCode).toBe(409);
    expect(
      (
        await post(setor, `${P}/bens/${b2?.id}/baixa`, {
          versao: 0,
          data: '2026-10-22',
          motivo: 'x',
          termoNumero: 'T',
        })
      ).statusCode,
    ).toBe(403);

    // inventário pelo QR: a divergência fica registrada, nada é corrigido
    const inv = await post(pat, `${P}/inventarios`, { descricao: 'Inventário sintético', centro: 102 });
    expect(inv.statusCode, inv.body).toBe(201);
    const idInv = j(inv).id as number;
    expect(j(inv).resumo).toMatchObject({ esperados: 1, naoEncontradosTotal: 1 });
    const ler = (codigo: string, centro = 102) =>
      post(pat, `${P}/inventarios/${idInv}/leituras`, { codigo, centro });
    expect(j(await ler(b1!.qr)).leitura.resultado).toBe('conforme');
    expect(j(await ler(b1!.plaqueta.toLowerCase())).leitura.resultado).toBe('repetida');
    expect(j(await ler('ZZ999999')).leitura.resultado).toBe('nao-cadastrado');
    expect(j(await ler(b3.plaqueta)).leitura.resultado).toBe('outro-local');
    const r = j(await ler(b2!.plaqueta));
    expect(r.leitura.resultado).toBe('baixado');
    expect((await ler('PAT1:aa:XX:0')).statusCode).toBe(400);
    const enc = await post(pat, `${P}/inventarios/${idInv}/encerramento`, {});
    expect(enc.statusCode, enc.body).toBe(200);
    expect(j(enc)).toMatchObject({
      situacao: 'encerrado',
      resumo: {
        esperados: 1,
        naoEncontradosTotal: 0,
        porResultado: { conforme: 1, repetida: 1, 'nao-cadastrado': 1, 'outro-local': 1, baixado: 1 },
      },
    });
    expect((await ler(b1!.qr)).statusCode).toBe(409);
    expect(j(await get(pat, `${P}/bens/${b3.id}`)).centro.id).toBe(103);
    expect(j(await get(pat, `${P}/inventarios`))[0].resumo.esperados).toBe(1);
    // W0-08: o encerrado não se cancela; o aberto se cancela com motivo e as leituras feitas ficam
    const cancela = (id: number, motivo: string) =>
      post(pat, `${P}/inventarios/${id}/cancelamento`, { motivo });
    const encCancel = await cancela(idInv, 'Contagem refeita');
    expect(encCancel.statusCode).toBe(409);
    expect(j(encCancel).codigo).toBe('inventario-encerrado');
    const inv2 = j(await post(pat, `${P}/inventarios`, { descricao: 'Inventário a cancelar', centro: 102 }));
    const ler2 = (codigo: string) =>
      post(pat, `${P}/inventarios/${inv2.id}/leituras`, { codigo, centro: 102 });
    expect(j(await ler2(b1!.qr)).leitura.resultado).toBe('conforme');
    expect((await cancela(inv2.id, 'x')).statusCode).toBe(400);
    expect((await cancela(999_999, 'Setor errado na abertura')).statusCode).toBe(404);
    const cancelado = await cancela(inv2.id, 'Setor errado na abertura');
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    expect(j(cancelado)).toMatchObject({
      situacao: 'cancelado',
      canceladoPor: 'SINT.PATRIMONIO',
      motivoCancelamento: 'Setor errado na abertura',
      encerradoPor: null,
    });
    expect(j(cancelado).leituras).toHaveLength(1);
    const lerCancelado = await ler2(b1!.qr);
    expect(lerCancelado.statusCode).toBe(409);
    expect(j(lerCancelado).codigo).toBe('inventario-cancelado');
    expect(j(await post(pat, `${P}/inventarios/${inv2.id}/encerramento`, {})).codigo).toBe(
      'inventario-cancelado',
    );
    expect(j(await cancela(inv2.id, 'De novo, cancelado')).codigo).toBe('inventario-cancelado');
    expect(j(await get(pat, `${P}/inventarios/${inv2.id}`)).leituras).toHaveLength(1);
    expect(trilha.eventos.some((l) => l.evento === 'patrimonio.inventario.cancelado')).toBe(true);

    expect(trilha.eventos.some((l) => l.evento === 'patrimonio.bem.cadastrado')).toBe(true);
    expect(trilha.eventos.some((l) => l.evento === 'patrimonio.movimento.decidido')).toBe(true);
    expect(trilha.eventos.some((l) => l.evento === 'patrimonio.depreciacao.calculada')).toBe(true);
  });
});

describe(
  'W0-08: grupo do bem como cadastro (inclusão, alteração pela versão, inativação, exclusão do nunca usado)',
  {
    timeout: 180_000,
  },
  () => {
    const put = (cookie: string, url: string, payload: unknown) =>
      app.inject({
        method: 'PUT',
        url,
        headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '' },
        payload: payload as Record<string, unknown>,
      });

    it('a vida útil nova vale só para o bem seguinte; com bem, 409 com a contagem e a oferta de inativar', async () => {
      const pat = await entrar('SINT.PATRIMONIO');
      const con = await entrar('SINT.PATRIMONIO.CONSULTA');
      // A semente da IN RFB aparece antes de qualquer gravação de grupo.
      const lista = j(await get(pat, `${P}/grupos`)).grupos as { codigo: string; versao: number }[];
      expect(lista.map((g) => g.codigo)).toContain('equipamentoMedico');
      expect(
        (await post(con, `${P}/grupos`, { codigo: 'ortese', nome: 'Órteses', vidaUtilMeses: 36 })).statusCode,
      ).toBe(403);

      const inc = await post(pat, `${P}/grupos`, {
        codigo: 'ortese',
        nome: 'Órteses',
        vidaUtilMeses: 36,
        conta: '1.2.3.09',
      });
      expect(inc.statusCode, inc.body).toBe(201);
      expect(j(inc)).toMatchObject({ codigo: 'ortese', versao: 1, ativo: true, bens: 0, semente: false });
      const rep = await post(pat, `${P}/grupos`, { codigo: 'ortese', nome: 'Outro', vidaUtilMeses: 12 });
      expect(rep.statusCode).toBe(409);
      expect(j(rep).codigo).toBe('codigo-em-uso');

      const alt = await put(pat, `${P}/grupos/ortese`, {
        versao: 1,
        nome: 'Órteses e próteses',
        vidaUtilMeses: 48,
        conta: '1.2.3.09',
        motivo: 'Laudo da engenharia clínica',
      });
      expect(alt.statusCode, alt.body).toBe(200);
      expect(j(alt)).toMatchObject({ versao: 2, vidaUtilMeses: 48 });
      const velha = await put(pat, `${P}/grupos/ortese`, {
        versao: 1,
        nome: 'Grupo velho',
        vidaUtilMeses: 1,
        motivo: 'versão velha',
      });
      expect(velha.statusCode).toBe(409);
      expect(j(velha).codigo).toBe('desatualizado');
      const det = j(await get(pat, `${P}/grupos/ortese`));
      expect(det.versoes).toEqual([
        expect.objectContaining({
          versao: 1,
          operacao: 'alteracao',
          vidaUtilMeses: 36,
          motivo: 'Laudo da engenharia clínica',
        }),
      ]);

      // O bem cadastrado agora guarda 48 meses; a mudança seguinte do grupo não o altera.
      const termo = {
        documento: 'termo',
        termoNumero: 'TD-W008/2026',
        termoData: '2026-04-01',
        doador: 'Associação sintética',
        empresa: 1,
        dataAquisicao: '2026-04-01',
        valorCent: 4_800_00,
        descricao: 'Órtese sintética',
        grupo: 'ortese',
        centro: 103,
        origem: 2,
      };
      const cad = await post(pat, `${P}/bens`, termo);
      expect(cad.statusCode, cad.body).toBe(201);
      const bem = (j(cad).bens as { id: number; vidaUtilMeses: number }[])[0]!;
      expect(bem.vidaUtilMeses).toBe(48);
      const alt2 = await put(pat, `${P}/grupos/ortese`, {
        versao: 2,
        nome: 'Órteses e próteses',
        vidaUtilMeses: 24,
        conta: '1.2.3.09',
        motivo: 'Nova política de vida útil',
      });
      expect(j(alt2)).toMatchObject({ versao: 3, vidaUtilMeses: 24, bens: 1 });
      expect(j(await get(pat, `${P}/bens/${bem.id}`)).vidaUtilMeses).toBe(48);

      // Excluir com bem: 409 com quantos e quais, e a oferta de inativar.
      const exc = await post(pat, `${P}/grupos/ortese/exclusao`, {
        versao: 3,
        motivo: 'cadastrado por engano',
      });
      expect(exc.statusCode).toBe(409);
      expect(j(exc)).toMatchObject({ codigo: 'com-dependentes', podeInativar: true });
      expect(j(exc).dependentes).toEqual([
        expect.objectContaining({ rotulo: 'Bens patrimoniais', quantidade: 1 }),
      ]);

      // Inativado: some do combo do bem e recusa bem novo; reativado volta.
      const ina = await post(pat, `${P}/grupos/ortese/inativacao`, {
        versao: 3,
        motivo: 'grupo descontinuado',
      });
      expect(ina.statusCode, ina.body).toBe(200);
      expect(j(ina)).toMatchObject({ ativo: false, versao: 4, motivoInativacao: 'grupo descontinuado' });
      // Revisão W0-08: o apoio traz também o grupo inativo, marcado, para o bem dele mostrar o nome cadastrado (o
      // combo de escolha filtra os ativos).
      expect(
        (j(await get(pat, `${P}/apoio`)).grupos as { valor: string }[]).find((g) => g.valor === 'ortese'),
      ).toMatchObject({ rotulo: 'Órteses e próteses', ativo: false });
      const recusado = await post(pat, `${P}/bens`, { ...termo, termoNumero: 'TD-W008/2' });
      expect(recusado.statusCode).toBe(409);
      expect(j(recusado).codigo).toBe('grupo-inativo');

      // Revisão W0-08: a alteração do bem confere o grupo no cadastro. Código que não existe: 409 'grupo' (nada
      // gravado); trocar para o grupo inativo: 409 'grupo-inativo'; manter o grupo inativo que o bem já tem: aceito.
      const paraAlterar = async (bemId: number, mudancas: Record<string, unknown>) => {
        const d = j(await get(pat, `${P}/bens/${bemId}`));
        return post(pat, `${P}/bens/${bemId}`, {
          descricao: d.descricao,
          grupo: d.grupo,
          localDetalhe: d.localDetalhe ?? null,
          tipoResponsavel: d.tipoResponsavel?.id ?? null,
          responsavel: d.responsavel ?? null,
          marca: d.marca ?? null,
          modelo: d.modelo ?? null,
          numeroSerie: d.numeroSerie ?? null,
          vidaUtilMeses: d.vidaUtilMeses,
          residualCent: d.residualCent,
          coeficiente: d.coeficiente?.id ?? null,
          inicioDepreciacao: d.inicioDepreciacao,
          depreciavel: d.depreciavel,
          versao: d.versao,
          ...mudancas,
        });
      };
      const inexistente = await paraAlterar(bem.id, { grupo: 'ZZ99' });
      expect(inexistente.statusCode, inexistente.body).toBe(409);
      expect(j(inexistente)).toMatchObject({ codigo: 'grupo' });
      expect(j(await get(pat, `${P}/bens/${bem.id}`)).grupo).toBe('ortese');
      const mantido = await paraAlterar(bem.id, { descricao: 'Órtese sintética (revisada)' });
      expect(mantido.statusCode, mantido.body).toBe(200);
      expect(j(mantido)).toMatchObject({ mudou: true, bem: { grupo: 'ortese' } });
      const outro = await post(pat, `${P}/bens`, {
        ...termo,
        termoNumero: 'TD-W008/3',
        grupo: 'equipamentoMedico',
      });
      expect(outro.statusCode, outro.body).toBe(201);
      const outroId = (j(outro).bens as { id: number }[])[0]!.id;
      const paraInativo = await paraAlterar(outroId, { grupo: 'ortese' });
      expect(paraInativo.statusCode, paraInativo.body).toBe(409);
      expect(j(paraInativo)).toMatchObject({ codigo: 'grupo-inativo' });
      expect(j(await get(pat, `${P}/bens/${outroId}`)).grupo).toBe('equipamentoMedico');
      const rea = await post(pat, `${P}/grupos/ortese/reativacao`, {
        versao: 4,
        motivo: 'voltou a ser usado',
      });
      expect(j(rea)).toMatchObject({ ativo: true, versao: 5 });

      // Revisão W0-08: a conta do grupo é conta analítica e ativa do plano. A lista leva as contas para o combo;
      // conta fora do plano (inexistente ou sintética) é 409 'conta' na inclusão e na alteração, sem gravar nada;
      // manter a conta que o grupo já tem segue aceito mesmo depois que ela saiu do plano.
      expect(j(await get(pat, `${P}/grupos`)).contas).toContainEqual({
        codigo: '1.2.3.09',
        nome: 'Outros bens do imobilizado',
      });
      const contaInc = await post(pat, `${P}/grupos`, {
        codigo: 'contaW008',
        nome: 'Grupo com conta errada',
        vidaUtilMeses: 60,
        conta: '1.2.3',
      });
      expect(contaInc.statusCode, contaInc.body).toBe(409);
      expect(j(contaInc)).toMatchObject({ codigo: 'conta', campos: ['conta'] });
      expect((await get(pat, `${P}/grupos/contaW008`)).statusCode).toBe(404);
      const contaAlt = await put(pat, `${P}/grupos/ortese`, {
        versao: 5,
        nome: 'Órteses e próteses',
        vidaUtilMeses: 48,
        conta: '9.9.9.99',
        motivo: 'conta digitada errada',
      });
      expect(contaAlt.statusCode, contaAlt.body).toBe(409);
      expect(j(contaAlt)).toMatchObject({ codigo: 'conta' });
      expect(j(await get(pat, `${P}/grupos/ortese`))).toMatchObject({ versao: 5, conta: '1.2.3.09' });
      const memoria = app.get(PORTA_PATRIMONIO) as PortaPatrimonioMemoria;
      const plano = memoria.contasPlano;
      memoria.contasPlano = plano.filter((c) => c.codigo !== '1.2.3.09');
      try {
        const mantem = await put(pat, `${P}/grupos/ortese`, {
          versao: 5,
          nome: 'Órteses, próteses e afins',
          vidaUtilMeses: 48,
          conta: '1.2.3.09',
          motivo: 'só o nome muda',
        });
        expect(mantem.statusCode, mantem.body).toBe(200);
        expect(j(mantem)).toMatchObject({ versao: 6, conta: '1.2.3.09' });
      } finally {
        memoria.contasPlano = plano;
      }

      // O nunca usado sai de vez; o código inválido na rota é 404.
      const vazio = j(
        await post(pat, `${P}/grupos`, { codigo: 'vazioW008', nome: 'Grupo vazio', vidaUtilMeses: 60 }),
      );
      const fora = await post(pat, `${P}/grupos/vazioW008/exclusao`, {
        versao: vazio.versao,
        motivo: 'cadastrado por engano',
      });
      expect(fora.statusCode, fora.body).toBe(200);
      expect((await get(pat, `${P}/grupos/vazioW008`)).statusCode).toBe(404);
      expect((await get(pat, `${P}/grupos/x!`)).statusCode).toBe(404);
      expect(trilha.eventos.map((l) => l.evento)).toEqual(
        expect.arrayContaining([
          'patrimonio.grupo.incluido',
          'patrimonio.grupo.alterado',
          'patrimonio.grupo.inativado',
          'patrimonio.grupo.excluido',
        ]),
      );
    });
  },
);

describe('W0-08 (M1): ajuste de valor do bem pela HTTP (CPC 01 e CPC 27)', { timeout: 180_000 }, () => {
  it('impairment com laudo, cota seguinte prospectiva, recusas, estorno com senha; revisão e reavaliação', async () => {
    const pat = await entrar('SINT.PATRIMONIO');
    const con = await entrar('SINT.PATRIMONIO.CONSULTA');
    const memoria = app.get(PORTA_PATRIMONIO) as PortaPatrimonioMemoria;
    // Bem novo que começa a depreciar em 2026-06 (moveis: 120 meses; R$ 1.200,00 → cota de R$ 10,00).
    const cad = await post(pat, `${P}/bens`, {
      documento: 'termo',
      termoNumero: 'TD-M1/2026',
      termoData: '2026-05-10',
      doador: 'Associação sintética',
      empresa: 1,
      dataAquisicao: '2026-05-10',
      valorCent: 1_200_00,
      descricao: 'Mesa auxiliar M1',
      grupo: 'moveis',
      centro: 103,
      origem: 2,
    });
    expect(cad.statusCode, cad.body).toBe(201);
    const bem = (j(cad).bens as { id: number; versao: number }[])[0]!;
    const cotaDe = async () =>
      (
        j(await get(pat, `${P}/depreciacao?empresa=1&competencia=2026-06`)).cotas as {
          bem: number;
          valorCent: number;
        }[]
      ).find((c) => c.bem === bem.id)?.valorCent;
    const versao = async () => (j(await get(pat, `${P}/bens/${bem.id}`)) as { versao: number }).versao;
    expect(await cotaDe()).toBe(10_00);
    expect(j(await get(pat, `${P}/bens/${bem.id}/ajustes`))).toEqual([]);
    expect((await get(pat, `${P}/bens/999999/ajustes`)).statusCode).toBe(404);

    // Achado 6: o laudo é o PDF anexado ao bem (guardado pelo SHA-256; imutável), não um número digitado.
    const pdf = Buffer.from('%PDF-1.7\n% laudo sintético do teste de recuperabilidade\n%%EOF\n');
    const lUrl = `${P}/bens/${bem.id}/laudos`;
    const anexo = {
      nome: 'laudo-m1.pdf',
      descricao: 'Teste de recuperabilidade 2026',
      conteudo: pdf.toString('base64'),
    };
    expect(j(await get(pat, lUrl))).toEqual([]);
    expect((await post(con, lUrl, anexo)).statusCode).toBe(403);
    const naoPdf = await post(pat, lUrl, {
      ...anexo,
      conteudo: Buffer.from('texto qualquer').toString('base64'),
    });
    expect(naoPdf.statusCode).toBe(400);
    expect(j(naoPdf).codigo).toBe('laudo-nao-pdf');
    expect((await post(pat, lUrl, { ...anexo, descricao: 'x' })).statusCode).toBe(400);
    expect((await post(pat, `${P}/bens/999999/laudos`, anexo)).statusCode).toBe(404);
    const anexado = await post(pat, lUrl, anexo);
    expect(anexado.statusCode, anexado.body).toBe(201);
    const laudo = j(anexado) as { id: number; sha256: string };
    expect(laudo).toMatchObject({
      bem: bem.id,
      nome: 'laudo-m1.pdf',
      descricao: 'Teste de recuperabilidade 2026',
      sha256: createHash('sha256').update(pdf).digest('hex'),
      tamanho: pdf.length,
      enviadoPor: 'SINT.PATRIMONIO',
    });
    expect(laudo).not.toHaveProperty('chave');
    expect(j(await get(con, lUrl)).map((l: { id: number }) => l.id)).toEqual([laudo.id]);
    const arq = await get(con, `${P}/laudos/${laudo.id}/arquivo`);
    expect(arq.statusCode).toBe(200);
    expect(arq.headers['content-type']).toMatch(/application\/pdf/);
    expect(arq.headers['x-sgh-sha256']).toBe(laudo.sha256);
    expect(Buffer.from(arq.rawPayload).equals(pdf)).toBe(true);
    expect((await get(pat, `${P}/laudos/999999/arquivo`)).statusCode).toBe(404);

    const imp = {
      tipo: 'impairment',
      recuperavelCent: 600_00,
      laudo: laudo.id,
      motivo: 'Laudo de recuperabilidade',
    };
    const url = `${P}/bens/${bem.id}/ajustes`;
    expect((await post(con, url, { ...imp, versao: await versao() })).statusCode).toBe(403);
    expect((await post(pat, url, { ...imp, laudo: undefined, versao: await versao() })).statusCode).toBe(400);
    const velha = await post(pat, url, { ...imp, versao: (await versao()) + 5 });
    expect(velha.statusCode).toBe(409);
    expect(j(velha).codigo).toBe('desatualizado');
    // O laudo tem de estar anexado a este bem.
    const semLaudo = await post(pat, url, { ...imp, laudo: 999_999, versao: await versao() });
    expect(semLaudo.statusCode).toBe(409);
    expect(j(semLaudo).codigo).toBe('laudo-inexistente');
    memoria.contasImpairmentConfiguradas = false;
    const semConta = await post(pat, url, { ...imp, versao: await versao() });
    expect(semConta.statusCode).toBe(409);
    expect(j(semConta).codigo).toBe('sem-conta');
    memoria.contasImpairmentConfiguradas = true;

    const ok = await post(pat, url, { ...imp, versao: await versao() });
    expect(ok.statusCode, ok.body).toBe(201);
    const ajuste = j(ok);
    expect(ajuste).toMatchObject({
      tipo: 'impairment',
      competenciaMarco: '2026-05',
      valorContabilAntesCent: 1_200_00,
      valorContabilDepoisCent: 600_00,
      perdaCent: 600_00,
      vidaRestanteMeses: 120,
      laudo: laudo.id,
      origem: 'patrimonio/ajuste-bem',
      registradoPor: 'SINT.PATRIMONIO',
      estorno: null,
    });
    // Prospectivo: a cota seguinte parte do valor recuperável (R$ 600,00 em 120 meses).
    expect(await cotaDe()).toBe(5_00);
    expect(j(await get(pat, url)).map((a: { id: number }) => a.id)).toEqual([ajuste.id]);

    const eUrl = `${P}/ajustes/${ajuste.id}/estorno`;
    const est = { motivo: 'Laudo substituído', senha: SENHA };
    expect((await post(con, eUrl, est)).statusCode).toBe(403);
    expect((await post(pat, eUrl, { motivo: 'x', senha: SENHA })).statusCode).toBe(400);
    memoria.lotesExportados.push({ empresa: 1, periodo: ajuste.data.slice(0, 7), exportadoEm: ajuste.data });
    const exportado = await post(pat, eUrl, est);
    expect(exportado.statusCode).toBe(409);
    expect(j(exportado).codigo).toBe('lote-exportado');
    expect(j(exportado).detail).toMatch(/cancele a exportação primeiro/);
    memoria.lotesExportados.length = 0;
    const estornado = await post(pat, eUrl, est);
    expect(estornado.statusCode, estornado.body).toBe(201);
    expect(j(estornado).estorno).toMatchObject({
      motivo: 'Laudo substituído',
      origem: 'patrimonio/estorno-ajuste-bem',
      estornadoPor: 'SINT.PATRIMONIO',
    });
    expect(await cotaDe()).toBe(10_00);
    expect((await post(pat, eUrl, est)).statusCode).toBe(409);
    expect((await post(pat, `${P}/ajustes/999999/estorno`, est)).statusCode).toBe(404);

    // Revisão de estimativa: 60 meses restantes, residual R$ 0 → R$ 20,00; a reavaliação é só evento.
    const rev = await post(pat, url, {
      tipo: 'revisao-estimativa',
      vidaRestanteMeses: 60,
      residualCent: 0,
      motivo: 'Uso intensivo pela engenharia',
      versao: await versao(),
    });
    expect(rev.statusCode, rev.body).toBe(201);
    expect(await cotaDe()).toBe(20_00);
    // O mesmo PDF anexado de novo vira outro laudo com a mesma chave (o arquivo travado é reaproveitado).
    const laudo2 = j(await post(pat, lUrl, { ...anexo, descricao: 'Reavaliação por perito 2026' })) as {
      id: number;
      sha256: string;
    };
    expect(laudo2.sha256).toBe(laudo.sha256);
    const reav = await post(pat, url, {
      tipo: 'reavaliacao',
      valorJustoCent: 900_00,
      laudo: laudo2.id,
      motivo: 'Reavaliação por perito',
      versao: await versao(),
    });
    expect(reav.statusCode, reav.body).toBe(201);
    expect(j(reav)).toMatchObject({ perdaCent: 0, valorJustoCent: 900_00 });
    expect(await cotaDe()).toBe(20_00);
    expect(j(await get(pat, url))).toHaveLength(3);
    expect(trilha.eventos.map((l) => l.evento)).toEqual(
      expect.arrayContaining([
        'patrimonio.ajuste.registrado',
        'patrimonio.ajuste.estornado',
        'patrimonio.laudo.anexado',
      ]),
    );
  });
});
