// M56 (etapa 3, F2) pela HTTP, com a sessão real sobre a fonte sintética e as portas da operadora EM MEMÓRIA (a da F1
// e a da cobrança sobre ela; nada conecta a banco; documentos SINTÉTICOS; relógio da cobrança fixo): com a chave
// desligada, a tela diz o motivo e as rotas dão 403; com o módulo, os beneficiários e a cobrança ligados, o ciclo
// reajuste anual (teto da ANS) → prévia e geração das mensalidades (faixa da RN 63 com o reajuste; pessoa física com o
// titular pagador, jurídica com o contratante; a segunda geração não repete) → lista (documento mascarado; auditada) →
// ficha com os itens → coparticipação e avulsa → baixa (valor conferido, versão vista), estorno e nova baixa → vencidas
// → inadimplência (notificar, notificado no prazo, passível de suspensão) → acordo (prévia, parcelas, renegociadas) →
// cancelamento → reajuste já cobrado não se cancela; quem só lê recebe 403 ao gravar; sem perfil da operadora, 403; a
// mensagem ao beneficiário não sai (chave desligada).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../config/public-api.js';
import { criarAppOperadora } from './infra/app-operadora.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaCobrancaOperadoraMemoria } from './cobranca-porta-memoria.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});
const pre = (recurso: string, tipo: PrerequisitoRecurso['tipo']): PrerequisitoRecurso => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});

let hoje = '2026-10-25';
let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  const f1 = new PortaOperadoraMemoria(trilha);
  ligado = await criarAppOperadora(env, {
    trilha,
    operadora: f1,
    cobranca: new PortaCobrancaOperadoraMemoria(f1, () => hoje),
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [
        chave('operadora'),
        chave('operadora.beneficiarios'),
        chave('operadora.cobranca'),
      ],
      prerequisitosIniciais: () => [
        pre('operadora', 'credenciamento'),
        pre('operadora.cobranca', 'contrato'),
      ],
    }),
  });
  desligado = await criarAppOperadora(env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const O = '/api/operadora';
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = { cookie: s.cookie, 'x-csrf': s.csrf };
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h }),
  };
};

const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];
const produto = (operadora: number, extra: Record<string, unknown> = {}) => ({
  operadora,
  codigo: 'AMB-HOSP',
  nome: 'Plano sintético enfermaria',
  natureza: 'plano',
  registroAns: '900000001',
  tipoContratacao: 1,
  segmentacao: 'ambulatorialHospitalar',
  abrangencia: 'estadual',
  acomodacao: 2,
  coparticipacao: { tipo: 2, valor: 30 },
  carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
  precos: PRECOS,
  ...extra,
});

describe('operadora própria, cobrança e mensalidades (F2), pela HTTP', { timeout: 120_000 }, () => {
  it('chave desligada: a tela diz o motivo; as rotas dão 403 sem ler nada', async () => {
    const c = pedir(desligado, await entrar(desligado, 'SINT.OPERADORA'));
    const t = await c.get(`${O}/cobranca/tela`);
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ liberacao: { ligada: false }, acoes: { gerar: false }, operadoras: [] });
    expect(t.json().liberacao.motivo).toMatch(/desligada|Ligada, mas/);
    for (const u of ['cobrancas', 'cobrancas/1', 'cobranca/inadimplencia', 'reajustes'])
      expect((await c.get(`${O}/${u}`)).statusCode, u).toBe(403);
    expect(
      (await c.post(`${O}/cobrancas/mensalidades/previa`, { operadora: 1, competencia: '2026-11' }))
        .statusCode,
    ).toBe(403);
    // A entrada é conferida antes de tudo.
    expect(
      (await c.post(`${O}/cobrancas/mensalidades/previa`, { operadora: 1, competencia: '2026-13' }))
        .statusCode,
    ).toBe(400);
  });

  it('o ciclo: reajuste → mensalidades → lista e ficha → lançamentos → baixa e estorno → inadimplência → acordo → cancelamento', async () => {
    const c = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const tela = (await c.get(`${O}/cobranca/tela`)).json();
    expect(tela).toMatchObject({
      liberacao: { ligada: true },
      acoes: { gerar: true },
      hoje: '2026-10-25',
      mensagens: { enviar: false },
      parametros: { multaPercentual: 2, jurosPercentualMes: 1, diasLimiteNotificacao: 50 },
    });
    expect(tela.mensagens.motivo).toContain('desligadas');

    // A base da F1: operadora, plano individual e coletivo, contrato PF (titular e dependente) e PJ.
    const ope = (
      await c.post(`${O}/empresas`, {
        registroAns: '900002',
        cnpj: cnpjSintetico('900000030001'),
        razaoSocial: 'Operadora Sintética da Cobrança',
        modalidade: 'medicinaGrupo',
      })
    ).json().id as number;
    const prodPf = (await c.post(`${O}/produtos`, produto(ope))).json().id as number;
    const prodPj = (
      await c.post(
        `${O}/produtos`,
        produto(ope, { codigo: 'COLETIVO', tipoContratacao: 2, registroAns: '900000002' }),
      )
    ).json().id as number;
    const k = {
      produto: prodPf,
      numero: 'COB-0001',
      tipo: 1,
      contratanteNome: 'Contratante Sintético',
      contratanteDocumento: cpfSintetico('900000031'),
      formaReajuste: 1,
      mesReajuste: 1,
      tipoVigencia: 2,
      inicio: '2025-01-15',
      diaVencimento: 10,
    };
    const pf = (await c.post(`${O}/contratos`, k)).json().id as number;
    const pj = (
      await c.post(`${O}/contratos`, {
        ...k,
        produto: prodPj,
        numero: 'COB-0002',
        tipo: 2,
        contratanteNome: 'Empresa Sintética Ltda',
        contratanteDocumento: cnpjSintetico('900000032001'),
      })
    ).json().id as number;
    const titular = (
      await c.post(`${O}/beneficiarios`, {
        contrato: pf,
        vinculo: 1,
        nome: 'Titular Sintética',
        cpf: cpfSintetico('900000033'),
        nascimento: '1980-05-10',
        sexo: 'F',
        nomeMae: 'Mãe Sintética',
        inclusao: '2025-01-15',
      })
    ).json().id as number;
    const dependente = (
      await c.post(`${O}/beneficiarios`, {
        contrato: pf,
        titular,
        vinculo: 5,
        nome: 'Dependente Sintético',
        nascimento: '2015-03-01',
        sexo: 'M',
        nomeMae: 'Titular Sintética',
        inclusao: '2025-02-01',
      })
    ).json().id as number;
    expect(
      (
        await c.post(`${O}/beneficiarios`, {
          contrato: pj,
          vinculo: 1,
          nome: 'Empregado Sintético',
          cpf: cpfSintetico('900000034'),
          nascimento: '1990-01-20',
          sexo: 'M',
          nomeMae: 'Mãe Sintética B',
          inclusao: '2025-01-15',
        })
      ).statusCode,
    ).toBe(201);

    // Reajuste anual: fora do aniversário e acima do teto, recusados; no aniversário com o teto, registrado.
    const reaj = {
      contrato: pf,
      competencia: '2026-01',
      percentual: 6.91,
      tetoAns: 6.91,
      oficioAns: 'Ofício sintético 1/2026',
      motivo: 'Reajuste anual sintético',
    };
    expect((await c.post(`${O}/reajustes`, { ...reaj, competencia: '2026-02' })).json()).toMatchObject({
      codigo: 'reajuste-fora-do-aniversario',
    });
    expect((await c.post(`${O}/reajustes`, { ...reaj, percentual: 7.5 })).json()).toMatchObject({
      codigo: 'reajuste-acima-do-teto',
    });
    const r1 = await c.post(`${O}/reajustes`, reaj);
    expect(r1.statusCode).toBe(201);
    expect((await c.post(`${O}/reajustes`, reaj)).json()).toMatchObject({ codigo: 'reajuste-ja-registrado' });
    // Coletivo pequeno: o aviso do agrupamento (sem teto da ANS).
    const rpj = await c.post(`${O}/reajustes`, {
      ...reaj,
      contrato: pj,
      tetoAns: null,
      oficioAns: null,
      percentual: 12,
    });
    expect(rpj.statusCode).toBe(201);
    expect(rpj.json().avisos[0]).toContain('menos de 30 vidas');
    const lr = (await c.get(`${O}/reajustes?operadora=${ope}`)).json();
    expect(lr.itens).toHaveLength(2);

    // Prévia das mensalidades de 11/2026: titular 46 anos (faixa 44 a 48) 200 → 213,82; dependente 100 → 106,91.
    const pv = await c.post(`${O}/cobrancas/mensalidades/previa`, { operadora: ope, competencia: '2026-11' });
    expect(pv.statusCode).toBe(200);
    const previa = pv.json();
    expect(previa).toMatchObject({ quantidade: 2, jaGeradas: 0, ignorados: [] });
    const dPf = previa.cobrancas.find((x: { contrato: number }) => x.contrato === pf);
    expect(dPf).toMatchObject({ valor: 320.73, vencimento: '2026-11-10', pagadorNome: 'Titular Sintética' });
    expect(dPf.itens.map((i: { valor: number }) => i.valor)).toEqual([213.82, 106.91]);
    // O coletivo: 36 anos (faixa 34 a 38) 150 com 12% → 168; o pagador é o contratante.
    expect(previa.cobrancas.find((x: { contrato: number }) => x.contrato === pj)).toMatchObject({
      valor: 168,
      pagadorNome: 'Empresa Sintética Ltda',
    });
    expect(previa.valorTotal).toBe(488.73);
    expect((await c.get(`${O}/cobrancas?operadora=${ope}`)).json().itens).toHaveLength(0);

    const g1 = await c.post(`${O}/cobrancas/mensalidades`, { operadora: ope, competencia: '2026-11' });
    expect(g1.statusCode).toBe(201);
    expect(g1.json()).toMatchObject({ geradas: 2, valorTotal: 488.73, jaGeradas: 0 });
    const g2 = (
      await c.post(`${O}/cobrancas/mensalidades`, { operadora: ope, competencia: '2026-11' })
    ).json();
    expect(g2).toMatchObject({ geradas: 0, jaGeradas: 2 });
    expect(g2.mensagem).toContain('Nenhuma mensalidade nova');

    // A lista (documento mascarado; o CNPJ por inteiro), as contagens e a ficha com os itens.
    const lista = (await c.get(`${O}/cobrancas?operadora=${ope}&competencia=2026-11`)).json();
    expect(lista.itens).toHaveLength(2);
    const mPf = lista.itens.find((x: { contrato: number }) => x.contrato === pf);
    const mPj = lista.itens.find((x: { contrato: number }) => x.contrato === pj);
    expect(mPf.pagadorDocumento).toMatch(/^\*\*\*\./);
    expect(mPj.pagadorDocumento).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
    expect(lista.totais).toMatchObject({ abertas: 2, valorAberto: 488.73, vencidas: 0 });
    const ficha = (await c.get(`${O}/cobrancas/${mPf.id}`)).json();
    expect(ficha.itens).toHaveLength(2);
    expect(ficha.itens[0]).toMatchObject({
      beneficiario: titular,
      beneficiarioNome: 'Titular Sintética',
      faixa: 6,
      idade: 46,
      valorBase: 200,
      valor: 213.82,
    });
    expect((await c.get(`${O}/cobrancas/999999`)).statusCode).toBe(404);
    expect((await c.get(`${O}/cobrancas?busca=COB-0002&operadora=${ope}`)).json().itens).toHaveLength(1);

    // O reajuste já cobrado não se cancela; o de uma competência ainda não cobrada, sim.
    expect(
      (
        await c.post(`${O}/reajustes/${r1.json().id}/cancelamento`, {
          motivo: 'Registrado por engano no teste',
        })
      ).json(),
    ).toMatchObject({ codigo: 'reajuste-ja-cobrado' });
    const r27 = await c.post(`${O}/reajustes`, { ...reaj, competencia: '2027-01' });
    expect(r27.statusCode).toBe(201);
    expect(
      (
        await c.post(`${O}/reajustes/${r27.json().id}/cancelamento`, {
          motivo: 'Registrado por engano no teste',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await c.post(`${O}/reajustes/${r27.json().id}/cancelamento`, {
          motivo: 'Registrado por engano no teste',
        })
      ).json(),
    ).toMatchObject({ codigo: 'reajuste-cancelado' });

    // Coparticipação do dependente (30% de 250 = 75) e cobrança avulsa do contrato.
    const cp = await c.post(`${O}/cobrancas/coparticipacao`, {
      beneficiario: dependente,
      competencia: '2026-11',
      vencimento: '2026-11-10',
      valorEvento: 250,
      descricao: 'Consulta eletiva sintética',
    });
    expect(cp.statusCode).toBe(201);
    const fcp = (await c.get(`${O}/cobrancas/${cp.json().id}`)).json();
    expect(fcp).toMatchObject({ tipo: 2, valor: 75, pagadorNome: 'Titular Sintética' });
    expect(fcp.itens[0]).toMatchObject({ beneficiario: dependente, valorBase: 250, valor: 75 });
    expect(
      (
        await c.post(`${O}/cobrancas/coparticipacao`, {
          beneficiario: dependente,
          competencia: '2026-11',
          vencimento: '2026-09-30',
          valorEvento: 250,
          descricao: 'Consulta eletiva sintética',
        })
      ).json(),
    ).toMatchObject({ codigo: 'vencimento-antes-da-competencia' });
    const av = await c.post(`${O}/cobrancas/avulsa`, {
      contrato: pf,
      beneficiario: titular,
      competencia: '2026-11',
      vencimento: '2026-11-10',
      valor: 15,
      descricao: 'Segunda via da carteirinha',
    });
    expect(av.statusCode).toBe(201);
    expect(
      (
        await c.post(`${O}/cobrancas/avulsa`, {
          contrato: pj,
          beneficiario: titular,
          competencia: '2026-11',
          vencimento: '2026-11-10',
          valor: 15,
          descricao: 'Segunda via da carteirinha',
        })
      ).json(),
    ).toMatchObject({ codigo: 'beneficiario-de-outro-contrato' });

    // Baixa da mensalidade do coletivo em dia (sem encargos): o valor errado é recusado; a versão velha, 409.
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/baixa`, { versao: 0, pagoEm: '2026-10-25', valorPago: 160 })
      ).json(),
    ).toMatchObject({ codigo: 'valor-divergente' });
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/baixa`, { versao: 0, pagoEm: '2026-10-26', valorPago: 168 })
      ).json(),
    ).toMatchObject({ codigo: 'pagamento-futuro' });
    const bx = await c.post(`${O}/cobrancas/${mPj.id}/baixa`, {
      versao: 0,
      pagoEm: '2026-10-25',
      valorPago: 168,
    });
    expect(bx.statusCode).toBe(200);
    expect(bx.json().mensagem).toContain('168,00');
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/baixa`, { versao: 0, pagoEm: '2026-10-25', valorPago: 168 })
      ).json(),
    ).toMatchObject({
      codigo: 'nao-aberta',
    });
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/cancelamento`, { versao: 1, motivo: 'Cancelamento indevido' })
      ).json(),
    ).toMatchObject({
      codigo: 'nao-aberta',
    });
    // Estorno (volta a ficar em aberto) e nova baixa sobre a versão nova; a versão velha é recusada.
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/estorno`, {
          versao: 1,
          motivo: 'Pagamento devolvido pelo banco',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await c.post(`${O}/cobrancas/${mPj.id}/estorno`, {
          versao: 2,
          motivo: 'Pagamento devolvido pelo banco',
        })
      ).json(),
    ).toMatchObject({
      codigo: 'nao-paga',
    });
    const velha = await c.post(`${O}/cobrancas/${mPj.id}/baixa`, {
      versao: 1,
      pagoEm: '2026-10-25',
      valorPago: 168,
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json()).toMatchObject({ codigo: 'cobranca-desatualizada' });
    expect(
      (await c.post(`${O}/cobrancas/${mPj.id}/baixa`, { versao: 2, pagoEm: '2026-10-25', valorPago: 168 }))
        .statusCode,
    ).toBe(200);
    expect((await c.get(`${O}/cobrancas?operadora=${ope}`)).json().totais).toMatchObject({
      pagasNoMes: 1,
      valorPagoNoMes: 168,
    });

    // As mensalidades de 08 e 09/2026 do contrato PF (vencidas em 10/08 e 10/09).
    for (const comp of ['2026-08', '2026-09'])
      expect(
        (
          await c.post(`${O}/cobrancas/mensalidades`, { operadora: ope, competencia: comp, contrato: pf })
        ).json(),
      ).toMatchObject({ geradas: 1 });
    const vencidas = (await c.get(`${O}/cobrancas?operadora=${ope}&vencidas=1`)).json();
    expect(vencidas.itens).toHaveLength(2);
    const ago = vencidas.itens.find((x: { competencia: string }) => x.competencia === '2026-08');
    // 76 dias: multa 2% e juros 1% ao mês pro rata (320,73 × 2% = 6,41; × 76/30% = 8,13).
    expect(ago).toMatchObject({
      vencida: true,
      diasAtraso: 76,
      encargosHoje: { multa: 6.41, juros: 8.13, total: 14.54 },
    });
    expect(vencidas.totais).toMatchObject({ vencidas: 2 });
    // A recusa da baixa diz o devido calculado na data (o valor, a multa e os juros), e com a dispensa, só o valor.
    const semEncargos = await c.post(`${O}/cobrancas/${ago.id}/baixa`, {
      versao: ago.versao,
      pagoEm: '2026-10-25',
      valorPago: 320.73,
    });
    expect(semEncargos.statusCode).toBe(422);
    expect(semEncargos.json()).toMatchObject({
      codigo: 'valor-divergente',
      devido: {
        data: '2026-10-25',
        valor: 320.73,
        multa: 6.41,
        juros: 8.13,
        total: 335.27,
        dispensado: false,
      },
    });
    expect(semEncargos.json().detail).toContain(
      'O devido em 25/10/2026 é R$ 335,27 (valor R$ 320,73, multa R$ 6,41',
    );
    const comDispensa = (
      await c.post(`${O}/cobrancas/${ago.id}/baixa`, {
        versao: ago.versao,
        pagoEm: '2026-10-25',
        valorPago: 335.27,
        dispensarEncargos: true,
        motivoDispensa: 'Acordo comercial sintético',
      })
    ).json();
    expect(comDispensa).toMatchObject({
      codigo: 'valor-divergente',
      devido: { valor: 320.73, multa: 0, juros: 0, total: 320.73, dispensado: true },
    });
    expect(comDispensa.detail).toContain('R$ 320,73 (o valor, com a multa e os juros dispensados)');

    // Inadimplência: notificar (o 50º dia já passou); registrar a carta; no prazo; depois, pode suspender.
    const i1 = (await c.get(`${O}/cobranca/inadimplencia?operadora=${ope}`)).json();
    expect(i1.itens).toHaveLength(1);
    expect(i1.itens[0]).toMatchObject({
      contrato: pf,
      situacao: 'notificar',
      vencidas: 2,
      diasAtrasoAtual: 76,
      diasAcumulados12m: 76,
      mensalidadesEmAtraso12m: 2,
    });
    expect(i1.itens[0].pagadorDocumento).toMatch(/^\*\*\*\./);
    expect(
      (
        await c.post(`${O}/cobranca/inadimplencia/notificacao`, {
          contrato: pj,
          em: '2026-10-20',
          meio: 'carta-ar',
          referencia: 'AR SINT-1',
        })
      ).json(),
    ).toMatchObject({ codigo: 'notificacao-sem-atraso' });
    expect(
      (
        await c.post(`${O}/cobranca/inadimplencia/notificacao`, {
          contrato: pf,
          em: '2026-10-26',
          meio: 'carta-ar',
          referencia: 'AR SINT-1',
        })
      ).json(),
    ).toMatchObject({ codigo: 'notificacao-futura' });
    const nt = await c.post(`${O}/cobranca/inadimplencia/notificacao`, {
      contrato: pf,
      em: '2026-10-20',
      meio: 'carta-ar',
      referencia: 'AR SINT-1',
    });
    expect(nt.statusCode).toBe(201);
    expect(nt.json().mensagem).toContain('2 cobrança(s)');
    expect((await c.get(`${O}/cobranca/inadimplencia?operadora=${ope}`)).json().itens[0]).toMatchObject({
      situacao: 'aguardando-prazo',
      notificadoEm: '2026-10-20',
      notificacaoMeio: 'carta-ar',
      prazoPagamento: '2026-10-30',
    });
    hoje = '2026-11-05';
    const i3 = (await c.get(`${O}/cobranca/inadimplencia?operadora=${ope}`)).json();
    expect(i3.itens[0]).toMatchObject({ situacao: 'passivel-suspensao', diasAcumulados12m: 87 });
    // A baixa lançada depois, com data passada: o devido é o daquela data (81 dias), não o de hoje (87 dias).
    const retro = await c.post(`${O}/cobrancas/${ago.id}/baixa`, {
      versao: ago.versao,
      pagoEm: '2026-10-30',
      valorPago: 336.44,
    });
    expect(retro.json()).toMatchObject({
      codigo: 'valor-divergente',
      devido: { data: '2026-10-30', multa: 6.41, juros: 8.66, total: 335.8 },
    });

    // Acordo das duas vencidas em 3 parcelas a partir de 10/11 (com multa e juros até hoje).
    const lv = (await c.get(`${O}/cobrancas?operadora=${ope}&vencidas=1&contrato=${pf}`)).json().itens as {
      id: number;
      versao: number;
      competencia: string;
    }[];
    const deVencidas = lv.filter((x) => x.competencia !== '2026-11');
    expect(deVencidas).toHaveLength(2);
    const ac = {
      contrato: pf,
      cobrancas: deVencidas.map((x) => ({ id: x.id, versao: x.versao })),
      parcelas: 3,
      primeiroVencimento: '2026-11-10',
    };
    expect((await c.post(`${O}/cobrancas/acordo/previa`, { ...ac, contrato: pj })).json()).toMatchObject({
      codigo: 'acordo-de-outro-contrato',
    });
    expect(
      (await c.post(`${O}/cobrancas/acordo/previa`, { ...ac, dispensarEncargos: true })).json(),
    ).toMatchObject({
      codigo: 'dispensa-sem-motivo',
    });
    const pa = (await c.post(`${O}/cobrancas/acordo/previa`, ac)).json();
    expect(pa.principal).toBe(641.46);
    expect(pa.parcelas).toHaveLength(3);
    expect(pa.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
    ]);
    const soma =
      Math.round(pa.parcelas.reduce((s: number, p: { valor: number }) => s + p.valor, 0) * 100) / 100;
    expect(soma).toBe(pa.total);
    const fa = await c.post(`${O}/cobrancas/acordo`, ac);
    expect(fa.statusCode).toBe(201);
    expect(fa.json().parcelas).toHaveLength(3);
    const parcela = (await c.get(`${O}/cobrancas/${fa.json().parcelas[0]}`)).json();
    expect(parcela).toMatchObject({ tipo: 4, parcela: 1, parcelas: 3, acordoOrigem: fa.json().acordo });
    expect(parcela.renegociadas.map((r: { competencia: string }) => r.competencia).sort()).toEqual([
      '2026-08',
      '2026-09',
    ]);
    expect((await c.get(`${O}/cobrancas/${deVencidas[0]!.id}`)).json()).toMatchObject({
      situacao: 'renegociada',
      acordoDestino: fa.json().acordo,
    });
    // O mesmo acordo outra vez: as cobranças já não estão em aberto.
    expect((await c.post(`${O}/cobrancas/acordo`, ac)).json()).toMatchObject({
      codigo: 'acordo-cobranca-nao-aberta',
    });

    // Cancelamento da avulsa (com o motivo).
    expect(
      (await c.post(`${O}/cobrancas/${av.json().id}/cancelamento`, { versao: 0, motivo: 'curto' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await c.post(`${O}/cobrancas/${av.json().id}/cancelamento`, {
          versao: 0,
          motivo: 'Taxa lançada por engano',
        })
      ).statusCode,
    ).toBe(200);
    expect((await c.get(`${O}/cobrancas?operadora=${ope}&situacao=cancelada`)).json().itens).toHaveLength(1);
    hoje = '2026-10-25';

    // A trilha: cada gravação com o seu evento; as leituras auditadas.
    const eventos = trilha.eventos.map((l) => l.evento);
    for (const ev of [
      'operadora.cobranca.gerada',
      'operadora.cobranca.baixada',
      'operadora.cobranca.estornada',
      'operadora.cobranca.cancelada',
      'operadora.cobranca.acordo',
      'operadora.cobranca.notificada',
      'operadora.reajuste.registrado',
      'operadora.reajuste.cancelado',
      'operadora.cobranca.lida',
    ])
      expect(eventos, ev).toContain(ev);
  });

  it('perfis: o atendimento só consulta (403 ao gravar); a cobrança grava; sem perfil da operadora, 403', async () => {
    const at = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const t = (await at.get(`${O}/cobranca/tela`)).json();
    expect(t.acoes).toMatchObject({ gerar: false });
    expect(t.acoes.motivo).toContain('só consulta');
    expect((await at.get(`${O}/cobrancas`)).statusCode).toBe(200);
    expect((await at.get(`${O}/cobranca/inadimplencia`)).statusCode).toBe(200);
    expect(
      (await at.post(`${O}/cobrancas/mensalidades/previa`, { operadora: 1, competencia: '2026-11' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await at.post(`${O}/reajustes`, {
          contrato: 1,
          competencia: '2026-01',
          percentual: 5,
          motivo: 'Teste sintético',
        })
      ).statusCode,
    ).toBe(403);
    const cob = pedir(ligado, await entrar(ligado, 'SINT.OPE.COBRANCA'));
    expect((await cob.get(`${O}/cobranca/tela`)).json().acoes).toMatchObject({ gerar: true });
    // Operadora inexistente: 404.
    expect(
      (await cob.post(`${O}/cobrancas/mensalidades/previa`, { operadora: 999999, competencia: '2026-11' }))
        .statusCode,
    ).toBe(404);
    const admin = pedir(ligado, await entrar(ligado, 'SINT.ADMIN'));
    expect((await admin.get(`${O}/cobranca/tela`)).statusCode).toBe(403);
    expect((await admin.get(`${O}/cobrancas`)).statusCode).toBe(403);
  });
});
