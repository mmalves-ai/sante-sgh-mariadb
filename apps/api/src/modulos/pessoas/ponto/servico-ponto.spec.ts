// M52.4: o serviço do ponto sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): as recusas que a HTTP
// não cobre (chave desligada, sem a chave do CPF, modelo do relógio, motivo e período do ramo, regime de outro
// estabelecimento, a reabertura com a competência seguinte fechada, a regra do banco alterada pela versão), o CPF que
// não é de colaborador, a inclusão de marcação aprovada no espelho, o colaborador sem vínculo no próprio espelho e a
// virada do ciclo do banco no fechamento.
import { linhaCabecalhoAfd, linhaMarcacaoAfd, linhaTrailerAfd } from '@sgh/dominio-pessoas';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/configuracao-fonte.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEscalaMemoria } from '../escala/porta-escala-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaPontoMemoria } from './porta-ponto-memoria.js';
import { MOTIVO_PROPRIO_PONTO, MOTIVO_SESSAO_COMO_PONTO, ServicoPonto } from './servico-ponto.js';

/** Contexto da porta em memória pelo código do estabelecimento da sessão sintética. */
const ctxMem = (hospital: string) => ({
  cliente: 'memoria',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste',
  rede: 'rede-sintetica',
  hospital,
});

const C = PESSOAS_SINTETICAS_M52;
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
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 7));

function montar(pontoLigado = true, comCifra = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', ...(pontoLigado ? ['pessoas.ponto'] : [])];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const escala = new PortaEscalaMemoria(pessoas);
  const porta = new PortaPontoMemoria(pessoas);
  porta.agoraFixo = '2026-10-25T10:00';
  const servico = new ServicoPonto(porta, pessoas, escala, trilha, config, null, comCifra ? cifra : null);
  return { pessoas, porta, rh, escala, servico };
}

let k = 0;
function sessao(login = 'SINT.RH', hospital = 'pc'): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m52-ponto-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital,
    rede: 'rede-sintetica',
    login,
    porta: ctxMem(hospital),
    pode: () => true,
  };
}
async function admitir(rh: ServicoPessoas, admissao = '2026-01-01') {
  return (
    await rh.admitir(sessao(), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao,
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
}
async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}
const cab = (de: string, ate: string) =>
  linhaCabecalhoAfd({
    cnpj: '00000000000191',
    razaoSocial: 'HOSPITAL SINTETICO',
    numeroRep: '00004000000000999',
    dataInicial: de,
    dataFinal: ate,
    geradoEm: '2026-10-01T08:00:00-0300',
  });
const afd = (de: string, ate: string, ms: [string, string][]) =>
  [
    cab(de, ate),
    ...ms.map(([q, cpf], i) => linhaMarcacaoAfd(i + 1, `${q}:00-0300`, cpf)),
    linhaTrailerAfd({ '3': ms.length }),
  ].join('\n');

describe('serviço do ponto (M52.4)', () => {
  it('chave desligada e sem a chave do CPF: a importação não grava', async () => {
    const d = montar(false);
    expect(
      await codigo(
        d.servico.importarAfd(sessao(), { nome: 'a', tipoRep: 'REP-C', modelo: null, conteudo: 'x' }),
      ),
    ).toBeTruthy();
    expect((await d.servico.apoioTela(sessao())).gravacao.ligada).toBe(false);
    const s = montar(true, false);
    expect(
      await codigo(
        s.servico.importarAfd(sessao(), { nome: 'a', tipoRep: 'REP-C', modelo: null, conteudo: 'x' }),
      ),
    ).toBe('sem-chave-cpf');
    expect(await codigo(s.servico.aej(sessao('SINT.PONTO'), '2026-09'))).toBe('sem-chave-cpf');
  });

  it('modelo do relógio fora da lista; CPF que não é de colaborador entra sem vínculo', async () => {
    const d = montar();
    expect(
      await codigo(
        d.servico.importarAfd(sessao(), { nome: 'a', tipoRep: 'REP-C', modelo: 99, conteudo: 'x' }),
      ),
    ).toBe('modelo');
    const r = await d.servico.importarAfd(sessao(), {
      nome: 'b',
      tipoRep: 'REP-C',
      modelo: 1,
      conteudo: afd('2026-09-01', '2026-09-30', [['2026-09-02T07:00', '12345678909']]),
    });
    expect(r).toMatchObject({
      situacao: 'importado',
      novas: 1,
      semColaborador: 1,
      modelo: 'Relógio sintético modelo A',
    });
    expect(r.mensagem).toContain('1 sem colaborador');
    // O mesmo relógio exporta de novo um período que cobre o anterior: a marcação já importada não entra outra vez.
    const de2 = await d.servico.importarAfd(sessao(), {
      nome: 'c',
      tipoRep: 'REP-C',
      modelo: null,
      conteudo: afd('2026-09-01', '2026-09-30', [
        ['2026-09-02T07:00', '12345678909'],
        ['2026-09-02T19:00', '12345678909'],
      ]),
    });
    expect(de2).toMatchObject({ novas: 1, jaImportadas: 1 });
    expect(await codigo(d.servico.arquivo(sessao(), 999))).toBe('nao-encontrado');
  });

  it('ajuste: motivo e período do ramo; inclusão aprovada entra no espelho como incluída', async () => {
    const d = montar();
    const v = await admitir(d.rh);
    await d.servico.importarAfd(sessao(), {
      nome: 'a',
      tipoRep: 'REP-C',
      modelo: null,
      conteudo: afd('2026-09-01', '2026-09-30', [['2026-09-03T08:00', C.nova.cpf]]),
    });
    const base = {
      vinculo: v,
      dia: '2026-09-03',
      marcacao: null,
      movimento: null,
      minutos: null,
      motivo: 'Esqueceu a batida de saída',
    };
    expect(
      await codigo(
        d.servico.lancarAjuste(sessao(), {
          ...base,
          tipo: 'inclusao',
          instante: '2026-09-03T17:00',
          justificativa: 9,
          periodo: null,
        }),
      ),
    ).toBe('justificativa');
    expect(
      await codigo(
        d.servico.lancarAjuste(sessao(), {
          ...base,
          tipo: 'inclusao',
          instante: '2026-09-03T17:00',
          justificativa: null,
          periodo: 99,
        }),
      ),
    ).toBe('periodo');
    const a = await d.servico.lancarAjuste(sessao(), {
      ...base,
      tipo: 'inclusao',
      instante: '2026-09-03T17:00',
      justificativa: null,
      periodo: 1,
    });
    expect(
      await codigo(d.servico.decidirAjuste(sessao(), { ajuste: a.id!, decisao: 'aprovar', motivo: null })),
    ).toBe('aprovador-e-solicitante');
    await d.servico.decidirAjuste(sessao('SINT.PONTO'), { ajuste: a.id!, decisao: 'aprovar', motivo: null });
    expect(
      await codigo(
        d.servico.decidirAjuste(sessao('SINT.PONTO'), { ajuste: a.id!, decisao: 'aprovar', motivo: null }),
      ),
    ).toBe('ja-decidido');
    expect(
      await codigo(
        d.servico.decidirAjuste(sessao('SINT.PONTO'), { ajuste: 9999, decisao: 'aprovar', motivo: null }),
      ),
    ).toBe('nao-encontrado');
    const e = await d.servico.espelho(sessao(), v, '2026-09');
    const dia = e.dias.find((x) => x.dia === '2026-09-03')!;
    expect(dia.marcacoes.map((m) => [m.instante, m.fonte])).toEqual([
      ['2026-09-03T08:00', 'O'],
      ['2026-09-03T17:00', 'I'],
    ]);
    // Sem plantão na escala: trabalho em dia sem escala (alerta) vai à extra de descanso semanal.
    expect(dia.alertas.map((x) => x.codigo)).toEqual(['sem-escala']);
    expect(e.ajustes[0]).toMatchObject({
      situacao: 'aprovado',
      decididoPor: 'SINT.PONTO',
      periodoRotulo: '1ª Saída',
    });
    expect(
      await codigo(
        d.servico
          .espelho(sessao(), v, '2026-09')
          .then(() => d.servico.espelho(sessao('SINT.RH', 'hs'), v, '2026-09')),
      ),
    ).toBe('nao-encontrado');
  });

  it('reabertura com a competência seguinte fechada é recusada; o próprio espelho sem vínculo é vazio', async () => {
    const d = montar();
    const v = await admitir(d.rh, '2026-07-01');
    const co = sessao('SINT.PONTO');
    await d.servico.fechar(co, { vinculo: v, competencia: '2026-08' });
    await d.servico.fechar(co, { vinculo: v, competencia: '2026-09' });
    expect(
      await codigo(
        d.servico.reabrir(co, { vinculo: v, competencia: '2026-08', motivo: 'Correção do mês de agosto' }),
      ),
    ).toBe('seguinte-fechado');
    await d.servico.reabrir(co, {
      vinculo: v,
      competencia: '2026-09',
      motivo: 'Correção do mês de setembro',
    });
    await d.servico.reabrir(co, { vinculo: v, competencia: '2026-08', motivo: 'Correção do mês de agosto' });
    expect(await d.servico.meuEspelho(sessao('SINT.SEM.VINCULO'), null, null)).toEqual({
      vinculos: [],
      competencias: [],
      espelho: null,
    });
    expect(
      await codigo(
        d.servico.ciencia(sessao('SINT.RH'), {
          vinculo: v,
          competencia: '2026-08',
          hash: 'a'.repeat(64),
          concorda: true,
          observacao: null,
        }),
      ),
    ).toBe('nao-e-o-proprio');
  });

  it('o aprovador não trata o próprio ponto; na sessão "como" não há ciência, lançamento nem decisão de ajuste', async () => {
    const d = montar();
    const colab = 'SINT.COLAB.PONTO';
    const v = (
      await d.rh.admitir(sessao(), {
        cpf: C.ponto.cpf,
        nome: 'COLABORADORA DO PONTO SINTETICA',
        profissional: null,
        tipo: 'clt',
        admissao: '2026-07-01',
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanalHoras: 44,
        lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
        matricula: null,
        usuario: idUsuarioSintetico(colab),
      })
    ).id;
    // A própria colaboradora com a permissão de aprovar (pode: tudo): nada do próprio ponto.
    const eu = sessao(colab);
    const meu = await d.servico.espelho(eu, v, '2026-09');
    expect(meu.acoes).toMatchObject({
      aprovar: false,
      fechar: false,
      reabrir: false,
      motivo: MOTIVO_PROPRIO_PONTO,
    });
    expect(await codigo(d.servico.fechar(eu, { vinculo: v, competencia: '2026-09' }))).toBe(
      'proprio-vinculo',
    );
    const acerto = { vinculo: v, competencia: '2026-10', minutos: 600, motivo: 'Crédito no próprio saldo' };
    expect(await codigo(d.servico.acertoBanco(eu, acerto))).toBe('proprio-vinculo');
    const movimento = (await d.servico.apoioTela(sessao())).dominios.movimentos[0]!.codigo;
    const aj = await d.servico.lancarAjuste(sessao(), {
      vinculo: v,
      dia: '2026-09-03',
      tipo: 'justificativa',
      marcacao: null,
      instante: null,
      movimento,
      justificativa: null,
      periodo: null,
      minutos: 60,
      motivo: 'Consulta médica comprovada',
    });
    expect(
      await codigo(d.servico.decidirAjuste(eu, { ajuste: aj.id!, decisao: 'aprovar', motivo: null })),
    ).toBe('proprio-vinculo');
    // Outra pessoa fecha; a reabertura também não é da própria colaboradora.
    const co = sessao('SINT.PONTO');
    await d.servico.decidirAjuste(co, { ajuste: aj.id!, decisao: 'aprovar', motivo: null });
    await d.servico.fechar(co, { vinculo: v, competencia: '2026-09' });
    expect(
      await codigo(
        d.servico.reabrir(eu, { vinculo: v, competencia: '2026-09', motivo: 'Reabrir o próprio mês' }),
      ),
    ).toBe('proprio-vinculo');
    expect(await codigo(d.servico.acertoBanco(eu, { ...acerto, competencia: '2026-09' }))).toBe(
      'proprio-vinculo',
    );

    // Sessão "como" a colaboradora (ADR 0021): a ciência é ato pessoal; lançar e decidir ajuste, a segregação.
    const como = sessao(colab);
    (como.req as unknown as { sghComo: unknown }).sghComo = {
      alvoLogin: colab,
      rede: 'rede-sintetica',
      hospital: 'pc',
    };
    const e = await d.servico.espelho(como, v, '2026-09');
    expect(e.acoes).toMatchObject({
      ciencia: false,
      justificar: false,
      aprovar: false,
      motivo: MOTIVO_SESSAO_COMO_PONTO,
    });
    expect((await d.servico.espelho(eu, v, '2026-09')).acoes.ciencia).toBe(true);
    expect(
      await codigo(
        d.servico.ciencia(como, {
          vinculo: v,
          competencia: '2026-09',
          hash: e.hash,
          concorda: true,
          observacao: null,
        }),
      ),
    ).toBe('sessao-como');
    const comoRh = sessao('SINT.RH');
    (comoRh.req as unknown as { sghComo: unknown }).sghComo = {
      alvoLogin: 'SINT.RH',
      rede: 'rede-sintetica',
      hospital: 'pc',
    };
    expect(
      await codigo(
        d.servico.lancarAjuste(comoRh, {
          vinculo: v,
          dia: '2026-10-03',
          tipo: 'justificativa',
          marcacao: null,
          instante: null,
          movimento,
          justificativa: null,
          periodo: null,
          minutos: 60,
          motivo: 'Lançado na sessão de suporte',
        }),
      ),
    ).toBe('sessao-como');
    expect(
      await codigo(
        d.servico.decidirAjuste(comoRh, { ajuste: aj.id!, decisao: 'recusar', motivo: 'Recusa no como' }),
      ),
    ).toBe('sessao-como');
    // Fora do "como", a própria colaboradora dá a ciência.
    await d.servico.ciencia(eu, {
      vinculo: v,
      competencia: '2026-09',
      hash: e.hash,
      concorda: true,
      observacao: null,
    });
  });

  it('regra do banco: regime de outro estabelecimento não; alteração pela versão; virada do ciclo no fechamento', async () => {
    const d = montar();
    const v = await admitir(d.rh, '2026-01-01');
    const c = ctxMem('pc');
    const regime = await d.escala.gravarSgh<number>(c, {} as never, async (g) => {
      const r = await g.incluirRegime({
        codigo: '44h',
        nome: 'Comercial 44 h',
        jornada: 1,
        contratoParcial: 0,
        folgaPadrao: null,
        minutosPlantao: 480,
        descansoMinimoMin: 660,
        limiteSemanalHoras: 44,
        acordo: null,
        ativo: true,
        por: 'SINT.ESCALA',
      });
      await g.atribuirRegime({ vinculo: v, regime: r, desde: '2026-01-01', por: 'SINT.ESCALA' });
      return r;
    });
    expect(
      await codigo(
        d.servico.gravarRegraBanco(sessao('SINT.ESCALA', 'hs'), {
          regime,
          destino: 2,
          inicio: 1,
          desde: '2026-01',
          cicloMeses: 1,
          faltaDebita: false,
          versao: null,
        }),
      ),
    ).toBe('nao-encontrado');
    await d.servico.gravarRegraBanco(sessao('SINT.ESCALA'), {
      regime,
      destino: 2,
      inicio: 1,
      desde: '2026-08',
      cicloMeses: 1,
      faltaDebita: false,
      versao: null,
    });
    await d.servico.gravarRegraBanco(sessao('SINT.ESCALA'), {
      regime,
      destino: 2,
      inicio: 1,
      desde: '2026-07',
      cicloMeses: 1,
      faltaDebita: false,
      versao: 0,
    });
    expect((await d.servico.regrasBanco(sessao())).itens[0]).toMatchObject({ desde: '2026-07', versao: 1 });
    const co = sessao('SINT.PONTO');
    // Acerto de +90 em agosto e o fechamento: em setembro (ciclo de 1 mês, saldo zerado) o positivo vai à folha.
    await d.servico.acertoBanco(co, {
      vinculo: v,
      competencia: '2026-08',
      minutos: 90,
      motivo: 'Saldo inicial do banco',
    });
    await d.servico.fechar(co, { vinculo: v, competencia: '2026-08' });
    await d.servico.fechar(co, { vinculo: v, competencia: '2026-09' });
    const e = await d.servico.espelho(co, v, '2026-09');
    expect(e.banco.movimentos.map((m) => [m.competencia, m.origem, m.minutos])).toEqual([
      ['2026-08', 'acerto', 90],
      ['2026-09', 'pago-folha', -90],
    ]);
    expect(e.banco.saldoFinalMin).toBe(0);
    expect(e.eventos.find((x) => x.codigo === 10)?.minutos).toBe(90);
    const csv = await d.servico.eventosFolha(co, '2026-09');
    expect(csv).toContain(`${v};;2026-09;10;90`);
  });
});
