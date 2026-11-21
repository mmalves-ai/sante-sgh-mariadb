// M56 (etapa 5, F4) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco;
// dados SINTÉTICOS): a autorização nasce desligada (o apoio diz o motivo; o resto dá 403 recurso-desligado); ligada
// (o registro na ANS e a designação dos auditores cumpridos, a chave do módulo e a da fatia), o ciclo: a diretoria designa
// o auditor → o atendimento registra o pedido com o protocolo e o prazo (as recusas da conferência) → o auditor lê a
// ficha (trilha) → pede complemento → o atendimento responde → o enfermeiro auditor não nega nem corta, autoriza por
// inteiro com a senha → a crítica que bloqueia impede autorizar e o médico nega com o comunicado → a urgência com o prazo
// imediato, a junta e a conclusão parcial → o pedido de SP/SADT ligado à internação → o cancelamento → a lista, a busca e
// as contagens → a versão vista → quem não pode.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  carteirinhaValida,
  cnpjSintetico,
  cpfSintetico,
  numeroCarteirinha,
  senhaValida,
} from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../config/public-api.js';
import { criarAppOperadora } from './infra/app-operadora.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';
import { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';

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
  evidencia: 'sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});

const trilha = new RegistradorTrilhaMemoria();
const operadora = new PortaOperadoraMemoria(trilha);
const rede = new PortaRedeOperadoraMemoria();
const autorizacao = new PortaAutorizacaoOperadoraMemoria(operadora, rede);
// O relógio fixo da memória (sexta-feira, 23/10/2026, 10h): os prazos em dias úteis ficam determinados.
let agora = '2026-10-23T10:00:00';
autorizacao.agora = () => agora;
let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;

beforeAll(async () => {
  ligado = await criarAppOperadora(env, {
    trilha,
    operadora,
    rede: rede,
    autorizacao: autorizacao,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [
        chave('operadora'),
        chave('operadora.beneficiarios'),
        chave('operadora.autorizacao'),
      ],
      prerequisitosIniciais: () => [
        pre('operadora', 'credenciamento'),
        pre('operadora.autorizacao', 'aprovacao'),
      ],
    }),
  });
  desligado = await criarAppOperadora(env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
  // Duas aplicações inteiras no mesmo gancho: com a máquina carregada passam dos 10 s do padrão.
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
let n = 0;
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
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m56-5-${++n}-${Date.now()}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const O = '/api/operadora';
const A = `${O}/autorizacoes`;

const profissional = { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' };
const sadt = (carteirinha: string, x: Record<string, unknown> = {}) => ({
  carteirinha,
  prestador: 1,
  executante: null,
  tipoGuia: 4,
  carater: 'E',
  altaComplexidade: false,
  origem: 1,
  guiaPrincipal: null,
  cid: null,
  indicacaoClinica: 'Indicação clínica sintética do pedido',
  profissional,
  internacao: null,
  itens: [
    { tabela: 22, codigo: '4030.1630', descricao: null, quantidade: 2 },
    { tabela: 22, codigo: '40304361', descricao: null, quantidade: 1 },
  ],
  ...x,
});

describe('autorização de guias da operadora (etapa 5, F4), pela HTTP', { timeout: 120_000 }, () => {
  it('desligada: o apoio diz o motivo; a lista, a ficha e as gravações dão 403 recurso-desligado', async () => {
    const c = pedir(desligado, await entrar(desligado, 'SINT.OPE.ATENDE'));
    const a = await c.get(`${A}/apoio`);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ ligada: false, podeRegistrar: false, operadoras: [], prestadores: [] });
    expect(a.json().motivo).toMatch(/desligada|pré-requisito|Ligada, mas/);
    expect(a.json().dominios.tipoGuia.map((x: { rotulo: string }) => x.rotulo)).toContain('SP/SADT');
    for (const u of [A, `${A}/1`, `${A}/procedimentos?busca=consulta`])
      expect((await c.get(u)).json().codigo, u).toBe('recurso-desligado');
    expect((await c.post(A, sadt('9000010000000017'))).json().codigo).toBe('recurso-desligado');
    // Quem não tem perfil da operadora nem lê o apoio.
    const adm = pedir(desligado, await entrar(desligado, 'SINT.ADMIN'));
    expect((await adm.get(`${A}/apoio`)).statusCode).toBe(403);
  });

  it('o ciclo: designar → registrar → complemento → decisão (enfermeiro e médico) → junta → SP/SADT → cancelar', async () => {
    const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const auditor = pedir(ligado, await entrar(ligado, 'SINT.OPE.AUDITOR'));

    // A carteira sintética pela F1 (o gestor da operadora cadastra).
    const ope = (
      await gestor.post(`${O}/empresas`, {
        registroAns: '900005',
        cnpj: cnpjSintetico('900000050001'),
        razaoSocial: 'Operadora Sintética F4',
        modalidade: 'medicinaGrupo',
      })
    ).json().id as number;
    const prod = await gestor.post(`${O}/produtos`, {
      operadora: ope,
      codigo: 'F4',
      nome: 'Plano sintético F4',
      natureza: 'plano',
      registroAns: '900000051',
      tipoContratacao: 1,
      segmentacao: 'ambulatorialHospitalar',
      abrangencia: 'estadual',
      acomodacao: 2,
      coparticipacao: { tipo: 1, valor: null },
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
      precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
    });
    expect(prod.statusCode, prod.body).toBe(201);
    const ctr = await gestor.post(`${O}/contratos`, {
      produto: prod.json().id,
      numero: 'F4-0001',
      tipo: 1,
      contratanteNome: 'Contratante Sintético F4',
      contratanteDocumento: cpfSintetico('900000051'),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
    });
    expect(ctr.statusCode, ctr.body).toBe(201);
    const ben = await gestor.post(`${O}/beneficiarios`, {
      contrato: ctr.json().id,
      vinculo: 1,
      nome: 'Beneficiária Sintética Autorização',
      cpf: cpfSintetico('900000052'),
      nascimento: '1980-05-10',
      sexo: 'F',
      nomeMae: 'Mãe Sintética',
      inclusao: '2026-02-01',
    });
    expect(ben.statusCode, ben.body).toBe(201);
    const carteirinha = ben.json().carteirinha as string;
    expect(carteirinhaValida(carteirinha)).toBe(true);

    // O auditor sem designação: o apoio diz que não é auditor; a diretoria (gestor) designa como enfermeiro.
    expect((await auditor.get(`${A}/apoio`)).json()).toMatchObject({
      ligada: true,
      auditor: null,
      podeDecidir: true,
    });
    const des = await gestor.post(`${O}/auditores`, {
      operadora: ope,
      login: 'sint.ope.auditor',
      nome: 'Auditora Sintética',
      categoria: 'enfermeiro',
      numero: '900010',
      uf: 'SC',
      inicio: '2026-10-23',
    });
    expect(des.statusCode, des.body).toBe(200);
    expect(des.json().mensagem).toContain('COREN 900010/SC');
    expect(
      (
        await gestor.post(`${O}/auditores`, {
          operadora: ope,
          login: 'SINT.OPE.AUDITOR',
          nome: 'Repetida',
          categoria: 'medico',
          numero: '1',
          uf: 'SC',
          inicio: '2026-10-23',
        })
      ).json().codigo,
    ).toBe('auditor-ja-designado');
    expect(
      (
        await gestor.post(`${O}/auditores`, {
          operadora: ope,
          login: 'OUTRO',
          nome: 'Fora do prazo',
          categoria: 'medico',
          numero: '1',
          uf: 'SC',
          inicio: '2027-01-01',
        })
      ).json().codigo,
    ).toBe('inicio-no-futuro-distante');
    const apoioAud = (await auditor.get(`${A}/apoio`)).json();
    expect(apoioAud.auditor).toMatchObject({ categoria: 'enfermeiro', conselho: 'COREN' });
    expect(apoioAud.prestadores.map((p: { id: number }) => p.id)).toEqual(expect.arrayContaining([1, 2, 3]));

    // O atendimento registra: as recusas da conferência e o pedido com o protocolo e o prazo de 5 dias úteis.
    expect((await atende.post(A, sadt('9000010000000017'))).json().codigo).toBe('carteirinha-invalida');
    expect((await atende.post(A, sadt(numeroCarteirinha('900005', 999_999)))).json().codigo).toBe(
      'beneficiario-inexistente',
    );
    const ruim = await atende.post(
      A,
      sadt(carteirinha, { itens: [{ tabela: 22, codigo: '99999999', descricao: null, quantidade: 1 }] }),
    );
    expect(ruim.json().codigo).toBe('procedimento-inexistente');
    expect((await atende.post(A, sadt(carteirinha, { tipoGuia: 2 }))).json().codigo).toBe('consulta-um-item');
    expect((await atende.post(A, sadt(carteirinha, { prestador: 999 }))).json().codigo).toBe(
      'prestador-inexistente',
    );
    const r1 = await atende.post(A, sadt(carteirinha));
    expect(r1.statusCode, r1.body).toBe(200);
    const p1 = r1.json();
    expect(p1.protocolo).toMatch(/^90000520261023\d{6}$/);
    expect(p1.mensagem).toContain('30/10/2026 23:59');
    expect(p1.avisos.join(' ')).toContain('cobertura parcial temporária');

    // A ficha (auditada) com os itens da terminologia, o histórico e as críticas de hoje.
    const lidas = trilha.eventos.filter((e) => e.evento === 'operadora.autorizacao.lida').length;
    const f1 = (await auditor.get(`${A}/${p1.id}`)).json();
    expect(f1).toMatchObject({
      situacao: 'em-analise',
      prazoTipo: 'padrao',
      vencida: false,
      situacaoGuia: null,
      beneficiario: { nome: 'Beneficiária Sintética Autorização', carteirinha },
    });
    expect(f1.itens.map((i: { descricao: string }) => i.descricao)).toEqual([
      'Dosagem sintética de laboratório',
      'Hemograma sintético',
    ]);
    expect(f1.criticas.map((c: { codigo: string }) => c.codigo)).toEqual(['cpt-vigente']);
    expect(trilha.eventos.filter((e) => e.evento === 'operadora.autorizacao.lida').length).toBe(lidas + 1);

    // Complemento: o auditor pede, o atendimento responde (o atendimento não pede: 403).
    expect(
      (await atende.post(`${A}/${p1.id}/complemento`, { versao: 1, pedido: 'Envie o laudo anterior' }))
        .statusCode,
    ).toBe(403);
    const c1 = await auditor.post(`${A}/${p1.id}/complemento`, {
      versao: 1,
      pedido: 'Envie o laudo anterior',
    });
    expect(c1.json()).toMatchObject({ situacao: 'pendente', versao: 2 });
    expect(
      (
        await auditor.post(`${A}/${p1.id}/decisao`, {
          versao: 2,
          decisao: 'negar',
          itens: [],
          diariasAutorizadas: null,
          critica: 4,
          fundamento: 'x',
          parecer: 'Parecer sintético',
        })
      ).json().codigo,
    ).toBe('situacao-nao-permite');
    const c2 = await atende.post(`${A}/${p1.id}/complemento/resposta`, {
      versao: 2,
      resposta: 'Laudo anterior enviado',
    });
    expect(c2.json()).toMatchObject({ situacao: 'em-analise', versao: 3 });

    // O enfermeiro auditor não nega nem corta; autoriza por inteiro, com a senha válida por 30 dias.
    const itens1 = f1.itens.map((i: { id: number; quantidadeSolicitada: number }) => ({
      item: i.id,
      quantidadeAutorizada: i.quantidadeSolicitada,
    }));
    const negar = {
      versao: 3,
      decisao: 'negar',
      itens: [],
      diariasAutorizadas: null,
      critica: 4,
      fundamento: 'Cláusula 5',
      parecer: 'Parecer sintético da negativa',
    };
    expect((await auditor.post(`${A}/${p1.id}/decisao`, negar)).json().codigo).toBe('negativa-so-medico');
    const corte = {
      ...negar,
      decisao: 'autorizar',
      itens: [{ ...itens1[0], quantidadeAutorizada: 1 }, itens1[1]],
    };
    expect((await auditor.post(`${A}/${p1.id}/decisao`, corte)).json().codigo).toBe('negativa-so-medico');
    const ok1 = await auditor.post(`${A}/${p1.id}/decisao`, {
      versao: 3,
      decisao: 'autorizar',
      itens: itens1,
      diariasAutorizadas: null,
      critica: null,
      fundamento: null,
      parecer: 'Autorizado conforme a indicação',
    });
    expect(ok1.statusCode, ok1.body).toBe(200);
    expect(ok1.json()).toMatchObject({ situacao: 'autorizada' });
    expect(senhaValida(ok1.json().senha)).toBe(true);
    expect(ok1.json().mensagem).toContain('válida até 22/11/2026');
    const f1b = (await atende.get(`${A}/${p1.id}`)).json();
    expect(f1b).toMatchObject({ situacao: 'autorizada', situacaoGuia: 1, comunicado: null, criticas: [] });
    expect(f1b.eventos.map((e: { evento: string }) => e.evento)).toEqual([
      'registro',
      'complemento-pedido',
      'complemento-resposta',
      'decisao',
    ]);

    // A diretoria troca a designação: encerra a de enfermeiro e designa como médico.
    const auds = (await gestor.get(`${O}/auditores`)).json().itens;
    expect(auds).toHaveLength(1);
    expect(
      (
        await gestor.post(`${O}/auditores/${auds[0].id}/encerrar`, {
          versao: 1,
          motivo: 'Troca de categoria sintética',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await gestor.post(`${O}/auditores/${auds[0].id}/encerrar`, {
          versao: 2,
          motivo: 'Troca de categoria sintética',
        })
      ).json().codigo,
    ).toBe('auditor-ja-encerrado');
    expect(
      (
        await gestor.post(`${O}/auditores`, {
          operadora: ope,
          login: 'SINT.OPE.AUDITOR',
          nome: 'Auditora Sintética',
          categoria: 'medico',
          numero: '900011',
          uf: 'SC',
          inicio: '2026-10-23',
        })
      ).statusCode,
    ).toBe(200);

    // Internação eletiva no laboratório (regime ambulatorial): a crítica bloqueia; o médico nega com o comunicado.
    const internacao = { tipo: 1, diarias: 3, admissaoPrevista: '2026-10-28' };
    expect(
      (await atende.post(A, sadt(carteirinha, { tipoGuia: 3, internacao })).then((r) => r.json())).codigo,
    ).toBe('cid-obrigatorio');
    expect(
      (
        await atende
          .post(A, sadt(carteirinha, { tipoGuia: 3, internacao, cid: 'Z99.9' }))
          .then((r) => r.json())
      ).codigo,
    ).toBe('cid-inexistente');
    const r2 = (await atende.post(A, sadt(carteirinha, { tipoGuia: 3, internacao, cid: 'J18.9' }))).json();
    expect(r2.mensagem).toContain('06/11/2026');
    const f2 = (await auditor.get(`${A}/${r2.id}`)).json();
    expect(f2.cidNome).toBe('Pneumonia (sintético)');
    expect(
      f2.criticas.filter((c: { bloqueia: boolean }) => c.bloqueia).map((c: { codigo: string }) => c.codigo),
    ).toEqual(['prestador-sem-regime']);
    const itens2 = f2.itens.map((i: { id: number; quantidadeSolicitada: number }) => ({
      item: i.id,
      quantidadeAutorizada: i.quantidadeSolicitada,
    }));
    expect(
      (
        await auditor.post(`${A}/${r2.id}/decisao`, {
          versao: 1,
          decisao: 'autorizar',
          itens: itens2,
          diariasAutorizadas: 3,
          critica: null,
          fundamento: null,
          parecer: 'Tentativa de autorizar',
        })
      ).json().codigo,
    ).toBe('critica-bloqueante');
    expect(
      (
        await auditor.post(`${A}/${r2.id}/decisao`, { ...negar, versao: 1, critica: null, fundamento: null })
      ).json().codigo,
    ).toBe('critica-obrigatoria');
    const neg = await auditor.post(`${A}/${r2.id}/decisao`, { ...negar, versao: 1 });
    expect(neg.json()).toMatchObject({ situacao: 'negada', senha: null });
    const f2b = (await atende.get(`${A}/${r2.id}`)).json();
    expect(f2b.comunicado).toContain(`Protocolo ${r2.protocolo}`);
    expect(f2b.comunicado).toContain('Motivo: Cobertura do procedimento (sintético).');
    expect(f2b.comunicado).toContain('Fundamento: Cláusula 5.');
    expect(f2b.itens.every((i: { situacao: string }) => i.situacao === 'negado')).toBe(true);

    // Urgência no hospital Beta: prazo imediato (vence na hora); a junta e a conclusão parcial (2 de 3 diárias).
    const r3 = (
      await atende.post(
        A,
        sadt(carteirinha, {
          prestador: 2,
          carater: 'U',
          tipoGuia: 3,
          internacao: { ...internacao, admissaoPrevista: '2026-10-23' },
          cid: 'K35.9',
        }),
      )
    ).json();
    expect(r3.mensagem).toContain('resposta é imediata');
    agora = '2026-10-23T10:05:00';
    expect((await auditor.get(`${A}?vencidas=sim`)).json().itens.map((x: { id: number }) => x.id)).toEqual([
      r3.id,
    ]);
    const junta = {
      versao: 1,
      divergencia: 'Divergência sintética sobre a indicação cirúrgica',
      desempatador: { nome: 'Desempatador Sintético', crm: '900001', uf: 'SC' },
      notificadosEm: '2026-10-23',
    };
    expect((await auditor.post(`${A}/${r3.id}/junta`, junta)).json().codigo).toBe(
      'desempatador-e-o-solicitante',
    );
    const j = await auditor.post(`${A}/${r3.id}/junta`, {
      ...junta,
      desempatador: { ...junta.desempatador, crm: '900002' },
    });
    expect(j.json()).toMatchObject({ situacao: 'em-junta', versao: 2 });
    const f3 = (await auditor.get(`${A}/${r3.id}`)).json();
    const itens3 = f3.itens.map((i: { id: number; quantidadeSolicitada: number }) => ({
      item: i.id,
      quantidadeAutorizada: i.quantidadeSolicitada,
    }));
    const conclusao = {
      versao: 2,
      parecerDesempatador: 'Desempatador favorável com 2 diárias',
      decisao: 'autorizar',
      itens: itens3,
      diariasAutorizadas: 2,
      critica: 5,
      fundamento: 'Parecer da junta',
      parecer: 'Autorizado em parte conforme a junta',
    };
    const cj = await auditor.post(`${A}/${r3.id}/junta/conclusao`, conclusao);
    expect(cj.statusCode, cj.body).toBe(200);
    expect(cj.json().situacao).toBe('parcial');
    const f3b = (await atende.get(`${A}/${r3.id}`)).json();
    expect(f3b).toMatchObject({
      junta: { parecer: 'Desempatador favorável com 2 diárias', crm: '900002' },
      internacao: { diarias: 3, diariasAutorizadas: 2 },
      decisao: { auditor: 'Auditora Sintética', critica: 5 },
    });
    expect(f3b.comunicado).toContain('autorizado em parte');

    // SP/SADT ligado à internação autorizada em parte (a guia principal); de outra guia, recusa.
    const r4 = await atende.post(A, sadt(carteirinha, { prestador: 2, guiaPrincipal: r3.id }));
    expect(r4.statusCode, r4.body).toBe(200);
    expect((await atende.get(`${A}/${r4.json().id}`)).json().guiaPrincipal).toEqual({
      id: r3.id,
      protocolo: r3.protocolo,
    });
    expect((await atende.post(A, sadt(carteirinha, { guiaPrincipal: r2.id }))).json().codigo).toBe(
      'guia-principal-inexistente',
    );

    // Cancelar: a autorização ainda válida (a senha deixa de valer); de novo, não vale.
    const cx = await atende.post(`${A}/${p1.id}/cancelar`, {
      versao: 4,
      motivo: 'Prestador desistiu do pedido sintético',
    });
    expect(cx.json()).toMatchObject({ situacao: 'cancelada' });
    expect(cx.json().mensagem).toContain('deixa de valer');
    expect((await atende.get(`${A}/${p1.id}`)).json().situacaoGuia).toBe(5);
    expect(
      (await atende.post(`${A}/${p1.id}/cancelar`, { versao: 5, motivo: 'De novo, sem efeito' })).json()
        .codigo,
    ).toBe('situacao-nao-permite');

    // A versão vista: outra pessoa mudou antes.
    expect(
      (
        await auditor.post(`${A}/${r4.json().id}/complemento`, {
          versao: 9,
          pedido: 'Pedido com a versão velha',
        })
      ).json().codigo,
    ).toBe('autorizacao-desatualizada');

    // A lista: busca pelo protocolo, pela senha, pela carteirinha e pelo nome; as contagens; a terminologia.
    const porProtocolo = (await atende.get(`${A}?busca=${r2.protocolo}`)).json();
    expect(porProtocolo.itens.map((x: { id: number }) => x.id)).toEqual([r2.id]);
    expect(
      (await atende.get(`${A}?busca=${cj.json().senha}`)).json().itens.map((x: { id: number }) => x.id),
    ).toEqual([r3.id]);
    expect((await atende.get(`${A}?busca=${carteirinha}`)).json().itens).toHaveLength(4);
    const porNome = (
      await atende.get(`${A}?busca=${encodeURIComponent('beneficiária sint')}&situacao=negada`)
    ).json();
    expect(porNome.itens.map((x: { id: number }) => x.id)).toEqual([r2.id]);
    expect(porNome.totais).toMatchObject({ emAnalise: 1, pendentes: 0, emJunta: 0, decididasHoje: 2 });
    expect((await atende.get(`${A}?prestador=2`)).json().itens).toHaveLength(2);
    const tuss = (await atende.get(`${A}/procedimentos?busca=hemograma`)).json();
    expect(tuss.itens).toEqual([{ codigo: '40304361', nome: 'Hemograma sintético', vigente: true }]);
    expect((await atende.get(`${A}/procedimentos?busca=4030`)).json().itens).toHaveLength(2);
    expect((await atende.get(`${A}?situacao=xpto`)).statusCode).toBe(400);
    expect((await atende.get(`${A}/procedimentos?busca=x`)).statusCode).toBe(400);
    expect((await atende.get(`${A}/999`)).statusCode).toBe(404);

    // A trilha de cada gravação (a da memória pela API).
    for (const ev of [
      'operadora.autorizacao.registrada',
      'operadora.autorizacao.complemento-pedido',
      'operadora.autorizacao.complemento-respondido',
      'operadora.autorizacao.decidida',
      'operadora.autorizacao.junta-aberta',
      'operadora.autorizacao.junta-concluida',
      'operadora.autorizacao.cancelada',
      'operadora.auditor.designado',
      'operadora.auditor.encerrado',
    ])
      expect(
        trilha.eventos.some((e) => e.evento === ev),
        ev,
      ).toBe(true);
  });

  it('W0-10: alterar a designação com o motivo; trocar o auditor com pedidos em análise recusa sem a redistribuição', async () => {
    const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const auditor = pedir(ligado, await entrar(ligado, 'SINT.OPE.AUDITOR'));
    // A designação ativa (médico, do ciclo) e uma carteirinha da operadora dela.
    const ativo = (await gestor.get(`${O}/auditores`))
      .json()
      .itens.find(
        (a: { situacao: string; login: string }) => a.situacao === 'ativo' && a.login === 'SINT.OPE.AUDITOR',
      );
    expect(ativo).toMatchObject({ emAnalise: 0 });
    const carteirinha = (await atende.get(A)).json().itens[0].carteirinha as string;

    // Alteração dos dados: motivo obrigatório, sobre a versão vista; o conselho segue a categoria.
    const semMotivo = await gestor.post(`${O}/auditores/${ativo.id}/alteracao`, {
      versao: ativo.versao,
      categoria: 'medico',
      numero: '900012',
      uf: 'PR',
    });
    expect(semMotivo.statusCode).toBe(400);
    const alt = await gestor.post(`${O}/auditores/${ativo.id}/alteracao`, {
      versao: ativo.versao,
      categoria: 'medico',
      numero: '900012',
      uf: 'PR',
      motivo: 'Transferência sintética de conselho regional',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(alt.json().mensagem).toContain('CRM 900012/PR');
    // O nome é o do cadastro: a alteração não o troca, e a mensagem usa o nome cadastrado.
    expect(alt.json().mensagem).toContain(ativo.nome);
    const velha = await gestor.post(`${O}/auditores/${ativo.id}/alteracao`, {
      versao: ativo.versao,
      categoria: 'medico',
      numero: '1',
      uf: 'SC',
      motivo: 'Versão velha sintética',
    });
    expect(velha.json().codigo).toBe('auditor-desatualizado');

    // O auditor pede complemento num pedido novo: passa a ser o responsável pela análise.
    const r = await atende.post(A, sadt(carteirinha));
    expect(r.statusCode, r.body).toBe(200);
    const pedido = r.json();
    const c = await auditor.post(`${A}/${pedido.id}/complemento`, { versao: 1, pedido: 'Envie o laudo' });
    expect(c.statusCode, c.body).toBe(200);
    const comPedido = (await gestor.get(`${O}/auditores`))
      .json()
      .itens.find((a: { id: number }) => a.id === ativo.id);
    expect(comPedido).toMatchObject({
      emAnalise: 1,
      versao: ativo.versao + 1,
      nome: ativo.nome,
    });

    // Encerrar (trocar) sem a redistribuição: 409 com a contagem e o protocolo; nada muda.
    const recusa = await gestor.post(`${O}/auditores/${ativo.id}/encerrar`, {
      versao: comPedido.versao,
      motivo: 'Troca sintética do auditor',
    });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json()).toMatchObject({ codigo: 'auditor-com-autorizacoes' });
    expect(recusa.json().dependentes[0]).toMatchObject({ quantidade: 1, amostra: [pedido.protocolo] });
    // Para ele mesmo: inválida.
    expect(
      (
        await gestor.post(`${O}/auditores/${ativo.id}/encerrar`, {
          versao: comPedido.versao,
          motivo: 'Troca sintética do auditor',
          redistribuirPara: ativo.id,
        })
      ).json().codigo,
    ).toBe('redistribuicao-invalida');

    // Com a redistribuição a outro auditor ativo da operadora: encerra e o novo responde pelo pedido.
    const outro = await gestor.post(`${O}/auditores`, {
      operadora: ativo.operadora,
      login: 'SINT.OPE.AUDITOR2',
      nome: 'Auditor Sintético Dois',
      categoria: 'medico',
      numero: '900013',
      uf: 'SC',
      inicio: '2026-10-23',
    });
    expect(outro.statusCode, outro.body).toBe(200);
    const ok = await gestor.post(`${O}/auditores/${ativo.id}/encerrar`, {
      versao: comPedido.versao,
      motivo: 'Troca sintética do auditor',
      redistribuirPara: outro.json().id,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().mensagem).toContain('1 pedido(s) em análise passaram');
    const depois = (await gestor.get(`${O}/auditores`)).json().itens;
    expect(depois.find((a: { id: number }) => a.id === outro.json().id)).toMatchObject({ emAnalise: 1 });
    expect(depois.find((a: { id: number }) => a.id === ativo.id)).toMatchObject({
      situacao: 'encerrado',
      emAnalise: 0,
    });
    expect(trilha.eventos.some((e) => e.evento === 'operadora.auditor.alterado')).toBe(true);
  });

  it('quem não pode: o gestor não lê guias; o atendimento não decide nem designa; o auditor não designa', async () => {
    const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const auditor = pedir(ligado, await entrar(ligado, 'SINT.OPE.AUDITOR'));
    expect((await gestor.get(A)).statusCode).toBe(403);
    expect((await gestor.get(`${A}/apoio`)).statusCode).toBe(403);
    const ap = (await atende.get(`${A}/apoio`)).json();
    expect(ap).toMatchObject({ podeRegistrar: true, podeDecidir: false, podeDesignar: false, auditor: null });
    expect(ap.parametros).toEqual({ diasUteisPadrao: 5, diasUteisComplexo: 10, diasValidadeSenha: 30 });
    expect((await atende.post(`${A}/1/decisao`, {})).statusCode).toBe(403);
    expect((await atende.get(`${O}/auditores`)).statusCode).toBe(403);
    expect((await auditor.post(`${O}/auditores`, {})).statusCode).toBe(403);
    // Corpo inválido: 400 antes de qualquer leitura.
    expect((await atende.post(A, { carteirinha: '1' })).statusCode).toBe(400);
  });
});
