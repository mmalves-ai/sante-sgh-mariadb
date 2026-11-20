// M53.7: os periódicos do eSocial sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): o painel do
// período, o S-1200 só do período fechado na folha (conferido no XSD; prévia sem XML; gravado cifrado), o lote ao
// coletor e o retorno, a retificação de quem já tem o aceito, o S-1210 do mês do pagamento com o líquido de cada
// demonstrativo, o S-1299 só com tudo aceito (e os recibos de autônomo do repasse barrando, regra 1), o S-1298 e a
// reabertura da folha recusada com o eSocial fechado.
import type { FichaEsocialVinculo, LinhaCalculoFolha } from '@sgh/contratos';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { ServicoFechamentoFolha } from '../folha/servico-fechamento.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { PortaEsocialMemoria } from './porta-esocial-memoria.js';
import { ServicoEsocial } from './servico-esocial.js';
import { ServicoPeriodicosEsocial, TETO_GERACAO_PERIODICOS } from './servico-periodicos.js';

const C = PESSOAS_SINTETICAS_M52;
const CTX = { rede: 'rede-sintetica', hospital: 'pc' };
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
      headers: { 'idempotency-key': `m53-periodicos-${++k}` },
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

const PARAMETROS = {
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

async function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-28';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', 'pessoas.folha'];
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
  const s = sessao();
  await esocial.registrarEmpregador(s, PARAMETROS);
  const v = (
    await rh.admitir(s, {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-08-01',
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
  await esocial.registrarFicha(s, v, { ficha: FICHA, versao: null });
  const processo = await calculo.gravarSgh(CTX, {} as never, async (g) => {
    const id = await g.incluirProcesso({
      empresa: 1,
      competencia: '2026-09',
      numero: 1,
      totais: {
        colaboradores: 1,
        proventos: 300_000,
        descontos: 30_000,
        liquido: 270_000,
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
      linha('irrf', 'desconto', 902, 6_000, v),
      linha('baseInss', 'base', null, 300_000, v),
    ]);
    return id;
  });
  return { esocial, periodicos, fechamento, porta, calculo, v, processo, s };
}

const SET = { empresa: 1, apuracao: 'mensal' as const, periodo: '2026-09' };

async function aceitar(m: Awaited<ReturnType<typeof montar>>, ids: number[], recibo: number) {
  const l = await m.esocial.montarLote(m.s, { empresa: 1, eventos: ids });
  await m.esocial.enviarLote(m.s, l.lote.id, { versao: 0 });
  await m.esocial.registrarRetorno(m.s, l.lote.id, {
    versao: 1,
    protocolo: null,
    eventos: ids.map((evento, i) => ({
      evento,
      aceito: true,
      recibo: `1.2.${String(recibo + i).padStart(19, '0')}`,
      codigo: '201',
      descricao: 'Sucesso',
    })),
  });
}

describe('periódicos do eSocial (serviço)', () => {
  it('S-1200 só do período fechado; prévia sem XML; gravado, aceito; S-1299 com tudo aceito; S-1298; reabertura da folha esperando o eSocial', async () => {
    const m = await montar();
    const { s, v } = m;
    // Período aberto na folha: o painel pede o fechamento; a geração é recusada.
    const aberto = await m.periodicos.painel(s, SET);
    expect(aberto).toMatchObject({ folha: null, situacao: 'aberto', repasse: 0 });
    expect(aberto.pendencias.map((p) => p.codigo)).toEqual(['folha-nao-fechada']);
    expect(aberto.acoes).toMatchObject({ gerar: false, fecharFolha: true, fecharEsocial: false });
    expect(await codigo(m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [], gravar: false }))).toBe(
      'folha-nao-fechada',
    );
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });

    const painel = await m.periodicos.painel(s, SET);
    expect(painel.remuneracao).toMatchObject({ esperados: 1, semEvento: [v], aceitos: 0 });
    expect(painel.pagamentos).toMatchObject({ esperados: 0 });
    expect(painel.pendencias.map((p) => p.codigo)).toEqual(['remuneracao-pendente']);
    expect(painel.acoes).toMatchObject({ gerar: true, fecharFolha: false, reabrirFolha: true });

    const previa = await m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [], gravar: false });
    expect(previa.gravado).toBe(false);
    expect(previa.eventos).toHaveLength(1);
    expect(previa.eventos[0]).toMatchObject({
      evento: 'S-1200',
      valido: true,
      xml: null,
      dataReferencia: '2026-09',
    });
    expect(previa.eventos[0]!.errosXsd).toEqual([]);
    const gravado = await m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [v], gravar: true });
    const id1200 = gravado.eventos[0]!.id!;
    const det = await m.esocial.detalheEvento(s, id1200);
    expect(det.xml).toContain('<indApuracao>1</indApuracao><perApur>2026-09</perApur>');
    expect(det.xml).toContain(`<ideDmDev>M${m.processo}</ideDmDev>`);
    expect(det.xml).toContain('<codRubr>1</codRubr><ideTabRubr>SGH</ideTabRubr><vrRubr>3000.00</vrRubr>');
    expect(det.xml).toContain('<codRubr>901</codRubr>');
    expect(JSON.stringify(await m.esocial.listarEventos(s, { vinculo: v }))).not.toContain(C.nova.cpf);
    // Em andamento: regerar deixa o colaborador de fora com a pendência.
    const andamento = await m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [], gravar: false });
    expect(andamento.eventos[0]!.pendencias.map((p) => p.codigo)).toEqual(['evento-em-andamento']);
    await aceitar(m, [id1200], 1);

    const pronto = await m.periodicos.painel(s, SET);
    expect(pronto.remuneracao.aceitos).toBe(1);
    expect(pronto.pendencias).toEqual([]);
    expect(pronto.acoes.fecharEsocial).toBe(true);

    // Retificação: quem já tem o aceito sai com indRetif 2 e o recibo.
    const ret = await m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [v], gravar: true });
    const idRet = ret.eventos[0]!.id!;
    expect((await m.esocial.detalheEvento(s, idRet)).xml).toContain(
      '<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000001</nrRecibo>',
    );
    expect((await m.periodicos.painel(s, SET)).pendencias.map((p) => p.codigo)).toEqual([
      'eventos-em-andamento',
    ]);
    await m.esocial.descartar(s, idRet, { motivo: 'Retificação desnecessária', versao: 0 });

    // S-1299: prévia válida no XSD e gravado; o período passa a fechando e não aceita nova remuneração.
    const f = await m.periodicos.gerarFechamento(s, { ...SET, gravar: true });
    const id1299 = f.eventos[0]!.id!;
    expect(f.eventos[0]).toMatchObject({ evento: 'S-1299', valido: true });
    expect((await m.esocial.detalheEvento(s, id1299)).xml).toContain(
      '<evtRemun>S</evtRemun><evtPgtos>N</evtPgtos>',
    );
    expect((await m.periodicos.painel(s, SET)).situacao).toBe('fechando');
    expect(await codigo(m.periodicos.gerarFechamento(s, { ...SET, gravar: true }))).toBe(
      'periodo-ja-fechado',
    );
    expect(await codigo(m.periodicos.gerarRemuneracao(s, { ...SET, vinculos: [], gravar: false }))).toBe(
      'periodo-ja-fechado',
    );
    expect(await codigo(m.periodicos.gerarReabertura(s, { ...SET, gravar: false }))).toBe(
      'periodo-nao-fechado',
    );
    await aceitar(m, [id1299], 10);
    const fechado = await m.periodicos.painel(s, SET);
    expect(fechado).toMatchObject({ situacao: 'fechado', eventoFechamento: id1299 });
    expect(fechado.acoes).toMatchObject({ reabrirEsocial: true, reabrirFolha: false, gerar: false });
    // A folha não reabre com o eSocial do período fechado.
    expect(
      await codigo(m.fechamento.reabrir(s, fechado.folha!.id, { versao: 0, motivo: 'Correção da folha' })),
    ).toBe('esocial-fechado');

    // S-1298: reabre; aceito, o período volta a aberto e a folha pode reabrir.
    const r = await m.periodicos.gerarReabertura(s, { ...SET, gravar: true });
    expect(r.eventos[0]).toMatchObject({ evento: 'S-1298', valido: true });
    await aceitar(m, [r.eventos[0]!.id!], 20);
    expect((await m.periodicos.painel(s, SET)).situacao).toBe('aberto');
    const reaberta = await m.fechamento.reabrir(s, fechado.folha!.id, {
      versao: 0,
      motivo: 'Correção da folha',
    });
    expect(reaberta.situacao).toBe('reaberta');
    // E fecha de novo com outro S-1299 (o aceito antigo não barra depois da reabertura).
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    const de2 = await m.periodicos.gerarFechamento(s, { ...SET, gravar: false });
    expect(de2.eventos[0]!.valido).toBe(true);
  });

  it('S-1210 no mês do pagamento: o líquido do demonstrativo da folha fechada, perRef da competência', async () => {
    const m = await montar();
    const { s, v } = m;
    expect(
      await codigo(
        m.periodicos.gerarPagamentos(s, { empresa: 1, periodo: '2026-10', vinculos: [], gravar: false }),
      ),
    ).toBe('sem-pagamentos');
    await m.fechamento.fechar(s, { ...SET, pagamento: '2026-10-05', simular: false });
    const outubro = { empresa: 1, apuracao: 'mensal' as const, periodo: '2026-10' };
    const painel = await m.periodicos.painel(s, outubro);
    expect(painel.pagamentos).toMatchObject({ esperados: 1, semEvento: [v] });
    expect(painel.remuneracao.esperados).toBe(0);
    const g = await m.periodicos.gerarPagamentos(s, {
      empresa: 1,
      periodo: '2026-10',
      vinculos: [],
      gravar: true,
    });
    expect(g.eventos[0]).toMatchObject({ evento: 'S-1210', valido: true, dataReferencia: '2026-10' });
    const xml = (await m.esocial.detalheEvento(s, g.eventos[0]!.id!)).xml!;
    expect(xml).toContain(
      `<infoPgto><dtPgto>2026-10-05</dtPgto><tpPgto>1</tpPgto><perRef>2026-09</perRef><ideDmDev>M${m.processo}</ideDmDev><vrLiq>2700.00</vrLiq></infoPgto>`,
    );
    expect((await m.periodicos.painel(s, outubro)).pendencias.map((p) => p.codigo)).toEqual([
      'folha-nao-fechada',
      'pagamento-pendente',
      'eventos-em-andamento',
    ]);
  });

  it('recibos de autônomo do repasse barram o S-1299 (D-RPA-PER-537); teto da geração', async () => {
    const m = await montar();
    m.porta.recibosSinteticos = 2;
    await m.fechamento.fechar(m.s, { ...SET, pagamento: '2026-10-05', simular: false });
    const p = await m.periodicos.painel(m.s, SET);
    expect(p.repasse).toBe(2);
    expect(p.pendencias.map((x) => x.codigo)).toContain('repasse-sem-remuneracao');
    const f = await m.periodicos.gerarFechamento(m.s, { ...SET, gravar: false });
    expect(f.eventos[0]!.pendencias.map((x) => x.codigo)).toContain('repasse-sem-remuneracao');
    expect(TETO_GERACAO_PERIODICOS).toBe(500);
    const consulta = await m.periodicos.painel(
      sessao((x) => x === 'pessoas.esocial.ler'),
      SET,
    );
    expect(consulta.acoes).toEqual({
      gerar: false,
      fecharEsocial: false,
      reabrirEsocial: false,
      fecharFolha: false,
      reabrirFolha: false,
    });
    // Só `pessoas.esocial.ler`: o fechamento vai sem os valores da folha (totais e processamentos com o líquido).
    expect(consulta.folha).toMatchObject({ numero: 1, situacao: 'fechada', fechadoPor: 'SINT.DP.FOLHA' });
    expect(consulta.folha!.totais).toBeNull();
    expect(consulta.folha!.processos).toBeNull();
    expect(Object.keys(consulta.folha!).sort()).toEqual([
      'fechadoEm',
      'fechadoPor',
      'id',
      'numero',
      'pagamento',
      'processos',
      'situacao',
      'totais',
    ]);
    expect(JSON.stringify(consulta.folha)).not.toMatch(/liquido|proventos|resumo/);
    // Com `pessoas.folha.ler` (sem `pessoas.salario.ler`), os totais e os processamentos voltam, com a máscara da folha.
    const folha = await m.periodicos.painel(
      sessao((x) => x === 'pessoas.esocial.ler' || x === 'pessoas.folha.ler'),
      SET,
    );
    expect(folha.folha!.totais).toMatchObject({ processos: 1 });
    expect(folha.folha!.processos).toHaveLength(1);
    // Tudo: o mesmo que a tela da folha devolve.
    expect(p.folha!.totais).toEqual((await m.fechamento.listar(m.s, { empresa: 1 })).itens[0]?.totais);
  });
});
