// M53.8: o FGTS Digital e as obrigações legais sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): os
// parâmetros com vigência, a apuração do FGTS Digital só do período fechado e conferida com o eSocial, a geração com o
// arquivo cifrado e a soma de verificação, a substituição, a entrega só com o leiaute conferido (no FGTS, a guia
// conciliada), o cancelamento, a SEFIP e o CAGED onde o regime os exige, a RAIS com os meses por fechar, os valores
// mascarados sem `pessoas.salario.ler` e a chave da folha desligada.
import {
  type FichaEsocialVinculo,
  type LinhaCalculoFolha,
  type ParametrosObrigacoes,
  REGIMES_SUGERIDOS_OBRIGACOES,
} from '@sgh/contratos';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEsocialMemoria } from '../esocial/porta-esocial-memoria.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import { ServicoPeriodicosEsocial } from '../esocial/servico-periodicos.js';
import { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { ServicoFechamentoFolha } from '../folha/servico-fechamento.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { competenciaAnterior, csvApuracaoFgts, ServicoObrigacoes } from './servico-obrigacoes.js';

const C = PESSOAS_SINTETICAS_M52;
const CTX = { rede: 'rede-sintetica', hospital: 'pc' };
const NIS = '12345678919';
const chave = (c: string): ChaveGravada => ({
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
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cifra = new CifraCpf(Buffer.alloc(32, 9));
let k = 0;
function sessao(pode: (p: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m53-obrigacoes-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: 'SINT.DP.FOLHA',
    porta: CTX,
    pode,
  };
}
async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

const FICHA: FichaEsocialVinculo = {
  sexo: 'F',
  racaCor: 3,
  estadoCivil: null,
  grauInstrucao: '09',
  nomeSocial: null,
  nascimento: '1990-05-17',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: null,
    logradouro: 'Rua Sintética',
    numero: '10',
    complemento: null,
    bairro: null,
    cep: '30110000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '411005',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Segunda a sexta, das 8h às 17h',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: null,
  estagio: null,
};

const EMPREGADOR = {
  empresa: 1,
  inicio: '2026-01',
  transmissor: 'sante' as const,
  leiaute: 'v_S_01_03_00' as const,
  classTrib: '99',
  indCoop: null,
  indConstr: null,
  indDesFolha: 0,
  indOptRegEletron: 0,
  cnaePrep: '8610101',
  aliqRat: 3,
  fap: 10_000,
  codLotacao: 'LOT01',
  fpas: '515',
  codTercs: '0115',
  ideTabRubr: 'SGH',
  cnpjSindicato: '33444555000106',
  motivosAfastamento: { '3': '01' },
};

const parametros = (over: Partial<ParametrosObrigacoes> = {}): ParametrosObrigacoes => ({
  empresa: 1,
  inicio: '2020-01',
  razaoSocial: 'Hospital Sintético Ltda',
  endereco: {
    logradouro: 'Avenida Central, 1000',
    bairro: 'Centro',
    cep: '30110000',
    cidade: 'Belo Horizonte',
    uf: 'MG',
    municipio: '3106200',
  },
  contato: { nome: 'Setor Pessoal', telefone: '3133334444', email: 'dp@exemplo.com.br' },
  naturezaJuridica: '2062',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps: '2100',
  regimes: { ...REGIMES_SUGERIDOS_OBRIGACOES },
  ...over,
});

const linha = (
  papel: LinhaCalculoFolha['papel'],
  tipo: LinhaCalculoFolha['tipo'],
  codigoRubrica: number | null,
  valor: number,
  vinculo: number,
) => ({
  papel,
  tipo,
  rubrica: codigoRubrica,
  codigoRubrica,
  quantidade: 0,
  unidade: 'valor' as const,
  valor,
  memoria: 'sintética',
  vinculo,
  centroCusto: 9521,
  diasPagos: 30,
});

async function montar(opcoes: { chaveDesligada?: boolean } = {}) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-28';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = opcoes.chaveDesligada ? ['pessoas.colaborador'] : ['pessoas.colaborador', 'pessoas.folha'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-28T10:15:30';
  const calculo = new PortaCalculoFolhaMemoria(pessoas);
  calculo.agoraFixo = '2026-10-28T10:15:30';
  const porta = new PortaEsocialMemoria();
  porta.recibosSinteticos = 0;
  const rubricas = { rubricas: async () => [] } as unknown as PortaRubricas;
  const esocial = new ServicoEsocial(
    porta,
    folha,
    calculo,
    rubricas,
    pessoas,
    cifra,
    trilha,
    config,
    null,
    'ci',
  );
  const periodicos = new ServicoPeriodicosEsocial(esocial);
  const fechamento = new ServicoFechamentoFolha(calculo, folha, porta, trilha, config, null);
  const servico = new ServicoObrigacoes(esocial, trilha, config, null);
  const s = sessao();
  if (!opcoes.chaveDesligada) await esocial.registrarEmpregador(s, EMPREGADOR);
  const v = (
    await rh.admitir(s, {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-09-01',
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
  if (!opcoes.chaveDesligada)
    await esocial.registrarFicha(s, v, { ficha: { ...FICHA, nis: NIS }, versao: null });
  await calculo.gravarSgh(CTX, {} as never, async (g) => {
    const id = await g.incluirProcesso({
      empresa: 1,
      competencia: '2026-09',
      numero: 1,
      totais: {
        colaboradores: 1,
        proventos: 300_000,
        descontos: 24_000,
        liquido: 276_000,
        inss: 24_000,
        irrf: 0,
        fgts: 24_000,
        inssPatronal: 60_000,
        rat: 9_000,
        terceiros: 17_400,
      },
      foraDaFolha: 0,
      tabelaLegal: '2026-01-01',
      parametros: '2026-01-01',
      resumo: 'a'.repeat(64),
      por: 'SINT',
    });
    await g.incluirLinhas(id, [
      linha('salario', 'provento', 1, 300_000, v),
      linha('inss', 'desconto', 901, 24_000, v),
      linha('baseInss', 'base', null, 300_000, v),
      linha('baseFgts', 'base', null, 300_000, v),
      linha('fgts', 'informativa', null, 24_000, v),
    ]);
    return id;
  });
  return { servico, esocial, periodicos, fechamento, porta, calculo, v, s };
}

const SET = { empresa: 1, apuracao: 'mensal' as const, periodo: '2026-09' };
const GERAR = { empresa: 1, tipo: 'fgts-digital' as const, periodo: '2026-09', recolhimento: null };

async function aceitarS1200(m: Awaited<ReturnType<typeof montar>>) {
  const g = await m.periodicos.gerarRemuneracao(m.s, { ...SET, vinculos: [], gravar: true });
  const ids = g.eventos.map((e) => e.id!);
  const l = await m.esocial.montarLote(m.s, { empresa: 1, eventos: ids });
  await m.esocial.enviarLote(m.s, l.lote.id, { versao: 0 });
  await m.esocial.registrarRetorno(m.s, l.lote.id, {
    versao: 1,
    protocolo: null,
    eventos: ids.map((evento, i) => ({
      evento,
      aceito: true,
      recibo: `1.2.${String(100 + i).padStart(19, '0')}`,
      codigo: '201',
      descricao: 'Sucesso',
    })),
  });
}

describe('FGTS Digital (serviço)', () => {
  it('parâmetros, apuração só do período fechado e com o eSocial aceito, geração, substituição, entrega com a guia conciliada', async () => {
    const m = await montar();
    const { s, v, servico } = m;
    expect(competenciaAnterior('2026-01-15')).toBe('2025-12');
    const apoio = await servico.apoioTela(s);
    expect(apoio).toMatchObject({ competenciaSugerida: '2026-09', anoSugerido: '2025' });
    expect(apoio.tipos).toEqual(['fgts-digital', 'sefip', 'caged', 'rais']);

    // Sem parâmetros: a apuração diz o que falta.
    const sem = await servico.apuracaoFgts(s, { empresa: 1, competencia: '2026-09' });
    expect(sem).toMatchObject({ exigida: false, trabalhadores: null, vigente: null });
    expect(sem.pendencias.map((p) => p.codigo)).toEqual(['sem-parametros']);
    await servico.registrarParametros(s, parametros());
    expect(await codigo(servico.registrarParametros(s, parametros()))).toBe('parametros-vigencia-repetida');
    const errado = parametros({
      inicio: '2021-01',
      regimes: {
        ...REGIMES_SUGERIDOS_OBRIGACOES,
        rais: { ...REGIMES_SUGERIDOS_OBRIGACOES.rais, exigidaAte: '2018-12' },
      },
    });
    expect(await codigo(servico.registrarParametros(s, errado))).toBe('parametros-invalidos');
    expect((await servico.parametros(s, 1)).itens.map((x) => x.inicio)).toEqual(['2020-01']);
    expect(await codigo(servico.parametros(s, 77))).toBe('nao-encontrado');

    // Folha aberta: pendência; fechada, o eSocial sem o S-1200 barra.
    const aberta = await servico.apuracaoFgts(s, { empresa: 1, competencia: '2026-09' });
    expect(aberta.pendencias.map((p) => p.codigo)).toEqual(['folha-nao-fechada']);
    expect(aberta.avisos).toEqual(['leiaute-nao-conferido']);
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    const semEvento = await servico.apuracaoFgts(s, { empresa: 1, competencia: '2026-09' });
    expect(semEvento.pendencias.map((p) => [p.codigo, p.vinculos])).toEqual([
      ['evento-esocial-pendente', [v]],
    ]);
    expect(semEvento.trabalhadores?.[0]).toMatchObject({
      vinculo: v,
      baseFgts: 300_000,
      fgts: 24_000,
      esocial: 'sem-evento',
    });
    expect(await codigo(servico.gerar(s, { ...GERAR, simular: false }))).toBe('obrigacao-com-pendencias');

    await aceitarS1200(m);
    const pronta = await servico.apuracaoFgts(s, { empresa: 1, competencia: '2026-09' });
    expect(pronta.pendencias).toEqual([]);
    expect(pronta.conferencia).toMatchObject({ ok: true });
    expect(pronta.totais).toMatchObject({ trabalhadores: 1, baseFgts: 300_000, fgts: 24_000, admissoes: 1 });
    expect(pronta.fechamento?.numero).toBe(1);
    // Sem `pessoas.salario.ler`: as pendências e a situação, sem os valores.
    const semSalario = await servico.apuracaoFgts(
      sessao((p) => p !== 'pessoas.salario.ler'),
      {
        empresa: 1,
        competencia: '2026-09',
      },
    );
    expect(semSalario).toMatchObject({ trabalhadores: null, totais: null, conferencia: null });

    const previa = await servico.gerar(s, { ...GERAR, simular: true });
    expect(previa).toMatchObject({
      gerado: false,
      simulado: true,
      nomeArquivo: 'FGTSDIGITAL202609.csv',
      trabalhadores: 1,
    });
    const g1 = await servico.gerar(s, { ...GERAR, simular: false });
    expect(g1.obrigacao).toMatchObject({
      numero: 1,
      situacao: 'gerada',
      leiauteConferido: false,
      trabalhadores: 1,
    });
    const id1 = g1.obrigacao!.id;
    const arq = await servico.arquivo(s, id1);
    expect(arq.nome).toBe('FGTSDIGITAL202609.csv');
    expect(arq.conteudo.split('\r\n')[1]).toBe(`2026-09;${v};;;300000;24000;0;0;0;aceito`);
    expect(arq.conteudo).not.toContain(C.nova.cpf);
    // Entrega com o leiaute não conferido é recusada.
    const entrega = {
      versao: 0,
      protocolo: 'GFD-0001',
      data: '2026-10-20',
      valorGuia: 24_000,
      acrescimos: null,
    };
    expect(await codigo(servico.registrarEntrega(s, id1, entrega))).toBe('leiaute-nao-conferido');

    // O DP marca o leiaute conferido (vigência nova) e gera de novo: a anterior fica substituída.
    await servico.registrarParametros(
      s,
      parametros({
        inicio: '2026-01',
        regimes: {
          ...REGIMES_SUGERIDOS_OBRIGACOES,
          'fgts-digital': { ...REGIMES_SUGERIDOS_OBRIGACOES['fgts-digital'], leiauteConferido: true },
        },
      }),
    );
    const g2 = await servico.gerar(s, { ...GERAR, simular: false });
    expect(g2.obrigacao).toMatchObject({ numero: 2, leiauteConferido: true, resumo: g1.obrigacao!.resumo });
    expect(g2.avisos).toEqual([]);
    const id2 = g2.obrigacao!.id;
    expect((await servico.detalhe(s, id1)).situacao).toBe('substituida');
    expect(await codigo(servico.registrarEntrega(s, id1, entrega))).toBe('obrigacao-nao-gerada');
    expect(await codigo(servico.registrarEntrega(s, id2, { ...entrega, valorGuia: null }))).toBe(
      'entrega-sem-guia',
    );
    expect(await codigo(servico.registrarEntrega(s, id2, { ...entrega, valorGuia: 24_100 }))).toBe(
      'guia-divergente',
    );
    const entregue = await servico.registrarEntrega(s, id2, {
      ...entrega,
      valorGuia: 24_100,
      acrescimos: 100,
    });
    expect(entregue).toMatchObject({
      situacao: 'entregue',
      entrega: {
        protocolo: 'GFD-0001',
        data: '2026-10-20',
        valorGuia: 24_100,
        acrescimos: 100,
        por: 'SINT.DP.FOLHA',
      },
    });
    expect(await codigo(servico.registrarEntrega(s, id2, { ...entrega, versao: 1 }))).toBe(
      'obrigacao-ja-entregue',
    );
    expect(await codigo(servico.cancelar(s, id2, { versao: 1, motivo: 'Gerada por engano' }))).toBe(
      'obrigacao-ja-entregue',
    );
    expect(await codigo(servico.cancelar(s, id1, { versao: 1, motivo: 'Gerada por engano' }))).toBe(
      'obrigacao-nao-gerada',
    );
    // Entregue: gerar de novo é pendência.
    const depois = await servico.gerar(s, { ...GERAR, simular: true });
    expect(depois.pendencias.map((p) => p.codigo)).toEqual(['ja-entregue']);
    const lista = await servico.listar(s, { empresa: 1, ano: '2026' });
    expect(lista.itens.map((x) => [x.numero, x.situacao])).toEqual([
      [2, 'entregue'],
      [1, 'substituida'],
    ]);
    const mascarada = await servico.listar(
      sessao((p) => p !== 'pessoas.salario.ler'),
      { tipo: 'fgts-digital' },
    );
    expect(mascarada.itens[0]).toMatchObject({
      totais: null,
      trabalhadores: 1,
      entrega: { valorGuia: null },
    });
    expect((await servico.listar(s, { situacao: 'entregue' })).itens).toHaveLength(1);
    expect(await codigo(servico.detalhe(s, 999_999))).toBe('nao-encontrado');
    expect(JSON.stringify(lista)).not.toContain(C.nova.cpf);
  });

  it('cancelar a gerada; a reabertura da folha depois da prévia invalida a geração; chave desligada', async () => {
    const m = await montar();
    const { s, servico } = m;
    await servico.registrarParametros(s, parametros());
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    await aceitarS1200(m);
    const g = await servico.gerar(s, { ...GERAR, simular: false });
    const c = await servico.cancelar(s, g.obrigacao!.id, { versao: 0, motivo: 'Gerada por engano' });
    expect(c).toMatchObject({ situacao: 'cancelada', motivo: 'Gerada por engano' });
    expect((await servico.apuracaoFgts(s, { empresa: 1, competencia: '2026-09' })).vigente).toBeNull();

    const d = await montar({ chaveDesligada: true });
    expect(await codigo(d.servico.gerar(d.s, { ...GERAR, simular: false }))).toBe('recurso-desligado');
    expect(await codigo(d.servico.registrarParametros(d.s, parametros()))).toBe('recurso-desligado');
    const previa = await d.servico.gerar(d.s, { ...GERAR, simular: true });
    expect(previa.pendencias.map((p) => p.codigo)).toEqual(['sem-parametros']);
  });

  it('o arquivo de conferência sem dado pessoal', () => {
    const t = {
      trabalhadores: 1,
      remuneracao: 10,
      remuneracaoDecimo: 0,
      baseFgts: 10,
      fgts: 1,
      rescisorio: 0,
      admissoes: 0,
      desligamentos: 0,
    };
    const csv = csvApuracaoFgts(
      '2026-09',
      [
        {
          vinculo: 5,
          matricula: 'M5',
          categoria: '101',
          baseFgts: 10,
          fgts: 1,
          baseDecimo: 0,
          fgtsDecimo: 0,
          rescisorio: 0,
          processos: [1],
          esocial: 'aceito',
        },
      ],
      t,
    );
    expect(csv.split('\r\n')).toEqual([
      'competencia;vinculo;matricula;categoria;base_fgts;fgts;base_13;fgts_13;rescisorio;esocial',
      '2026-09;5;M5;101;10;1;0;0;0;aceito',
      '2026-09;total;;;10;1;0;;0;',
      '',
    ]);
  });
});

describe('SEFIP, CAGED e RAIS (serviço)', () => {
  it('não exigidas pelo regime sugerido; com o regime gravado, a SEFIP e o CAGED com o arquivo; a RAIS com os meses por fechar', async () => {
    const m = await montar();
    const { s, servico } = m;
    await servico.registrarParametros(s, parametros());
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    for (const tipo of ['sefip', 'caged'] as const) {
      const r = await servico.gerar(s, { ...GERAR, tipo, simular: true });
      expect(
        r.pendencias.map((p) => p.codigo),
        tipo,
      ).toEqual(['nao-exigida']);
    }
    // Um regime que ainda exige as duas (sintético, para a prova do arquivo).
    const sempre = { exigidaDe: null, exigidaAte: null, leiaute: 'teste', leiauteConferido: false };
    await servico.registrarParametros(
      s,
      parametros({
        inicio: '2026-01',
        regimes: { ...REGIMES_SUGERIDOS_OBRIGACOES, sefip: sempre, caged: sempre, rais: sempre },
      }),
    );
    const sefip = await servico.gerar(s, {
      ...GERAR,
      tipo: 'sefip',
      simular: false,
      recolhimento: '2026-10-07',
    });
    expect(sefip.pendencias).toEqual([]);
    expect(sefip.obrigacao).toMatchObject({ nomeArquivo: 'SEFIP.RE', leiaute: 'teste', trabalhadores: 1 });
    expect(sefip.totais).toMatchObject({ remuneracao: 300_000, fgts: 24_000, admissoes: 1 });
    const arq = await servico.arquivo(s, sefip.obrigacao!.id);
    const linhas = arq.conteudo.split('\r\n').filter(Boolean);
    expect(linhas.map((l) => l.slice(0, 2))).toEqual(['00', '10', '30', '90']);
    expect(linhas[2]).toContain(NIS);
    expect(linhas[2]).toContain('PESSOA NOVA SINTETICA');
    // O banco guarda cifrado: a lista não traz o conteúdo nem o nome.
    expect(JSON.stringify(await servico.listar(s, {}))).not.toContain('PESSOA NOVA');

    const caged = await servico.gerar(s, { ...GERAR, tipo: 'caged', simular: false });
    expect(caged.pendencias).toEqual([]);
    const c = (await servico.arquivo(s, caged.obrigacao!.id)).conteudo.split('\r\n').filter(Boolean);
    expect(c.map((l) => l[0])).toEqual(['A', 'B', 'C']);
    expect(c[2]!.slice(65, 67)).toBe('20');

    const rais = await servico.gerar(s, { ...GERAR, tipo: 'rais', periodo: '2026', simular: true });
    expect(rais.pendencias.map((p) => p.codigo)).toEqual(['periodo-em-curso', 'folha-nao-fechada']);
    expect(rais.pendencias[1]!.mensagem).toContain('2026-01');
    expect(rais.pendencias[1]!.mensagem).toContain('2026');
    // Sem a ficha completa: a pendência do NIS.
    await m.esocial.registrarFicha(s, m.v, { ficha: { ...FICHA, nis: null }, versao: 0 });
    const semNis = await servico.gerar(s, { ...GERAR, tipo: 'sefip', simular: true });
    expect(semNis.pendencias.map((p) => p.codigo)).toEqual(['sem-nis']);
  });

  it('sem o empregador do eSocial a SEFIP pede os parâmetros; período em curso barra', async () => {
    const m = await montar();
    const { s, servico } = m;
    const sempre = { exigidaDe: null, exigidaAte: null, leiaute: 'teste', leiauteConferido: false };
    await servico.registrarParametros(
      s,
      parametros({ inicio: '2026-01', regimes: { ...REGIMES_SUGERIDOS_OBRIGACOES, sefip: sempre } }),
    );
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    m.porta.cnpjsSinteticos = new Map();
    const r = await servico.gerar(s, { ...GERAR, tipo: 'sefip', simular: true });
    expect(r.pendencias.map((p) => p.codigo)).toEqual(['sem-empregador']);
    const corrente = await servico.gerar(s, { ...GERAR, tipo: 'sefip', periodo: '2026-10', simular: true });
    expect(corrente.pendencias.map((p) => p.codigo)).toEqual(['periodo-em-curso', 'folha-nao-fechada']);
  });
});
