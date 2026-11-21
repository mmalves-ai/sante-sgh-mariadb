// M53.6: o serviço do eSocial sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): os parâmetros do
// empregador com o transmissor único por raiz de CNPJ (regra 1), a ficha cifrada, os eventos de tabela e do trabalhador
// conferidos no XSD oficial (regra 9; a prévia do trabalhador sem XML), o XML só para quem gera, o ciclo do lote ao
// coletor fora de produção (regra 3), o retorno com recibo, a retificação e a exclusão, o descarte, as pendências do
// outro sistema só contadas (regra 2), a conciliação com o repasse e as chaves desligadas.
import type { FichaEsocialVinculo, RubricaFolha } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import {
  type ChaveLiberacao,
  fonteConfiguracaoMemoria,
  type PrerequisitoRecurso,
} from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import type { PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { PortaEsocialMemoria } from './porta-esocial-memoria.js';
import { empregadorDaLinha, ServicoEsocial, textoRetornoSemValores, vigenciaNa } from './servico-esocial.js';
import { lerCertificadoEsocial } from './transmissor/certificado-esocial.js';
import { SimuladorEsocial } from './transmissor/simulador-esocial.spec-util.js';
import {
  type DisponibilidadeTransmissor,
  TransmissorEsocialSoap,
} from './transmissor/transmissor-esocial.js';
import { criarRaizSintetica, emitirSintetico } from '@sgh/dominio-documento';

type SalarioDoCalculo = Awaited<ReturnType<PortaCalculoFolha['salarios']>>[number];
type RescisaoDoCalculo = NonNullable<Awaited<ReturnType<PortaCalculoFolha['rescisaoPorId']>>>;

const C = PESSOAS_SINTETICAS_M52;
const CTX = {
  cliente: 'sintetico',
  estabelecimento: 1,
  usuario: 1,
  correlacao: 'teste-esocial',
  rede: 'rede-sintetica',
  hospital: 'pc',
};
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
  tipo: recurso === 'pessoas.esocial' ? 'certificado' : 'aprovacao',
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
      headers: { 'idempotency-key': `m53-esocial-${++k}` },
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

const rubrica = (id: number, over: Partial<RubricaFolha> = {}): RubricaFolha =>
  ({
    id,
    empresa: 1,
    codigo: id * 10,
    descricao: `Rubrica sintética ${id}`,
    tipo: 'provento',
    referencia: 'valor',
    percentual: 0,
    prioridade: null,
    ativa: true,
    vigencia: { inicio: null, fim: null },
    usos: ['mensal'],
    incidencias: {},
    esocial: { inss: '11', irrf: '11', fgts: '11', sindical: null },
    natureza: 1000,
    ...over,
  }) as RubricaFolha;

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

function montar(
  opcoes: { chaves?: readonly string[]; ambiente?: string; transmissao?: DisponibilidadeTransmissor } = {},
) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = opcoes.chaves ?? ['pessoas.colaborador', 'pessoas.folha'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-27T10:15:30';
  const porta = new PortaEsocialMemoria();
  const salarios: SalarioDoCalculo[] = [];
  const rescisoes: RescisaoDoCalculo[] = [];
  const calculo = {
    salarios: async (_c: unknown, vs: readonly number[]) => salarios.filter((x) => vs.includes(x.vinculo)),
    rescisaoPorId: async (_c: unknown, id: number) => rescisoes.find((r) => r.id === id) ?? null,
    linhasDoVinculo: async () => [
      {
        papel: 'saldoSalario',
        tipo: 'provento',
        rubrica: 1,
        codigoRubrica: 10,
        quantidade: 20,
        unidade: 'dias',
        valor: 200_000,
        memoria: '',
        vinculo: 0,
        centroCusto: 1,
        diasPagos: 20,
      },
    ],
  } as unknown as PortaCalculoFolha;
  const rubricas = {
    rubricas: async () => [rubrica(1), rubrica(2, { natureza: null })],
  } as unknown as PortaRubricas;
  const servico = new ServicoEsocial(
    porta,
    folha,
    calculo,
    rubricas,
    pessoas,
    cifra,
    trilha,
    config,
    null,
    opcoes.ambiente ?? 'ci',
    opcoes.transmissao,
  );
  return { pessoas, porta, folha, rh, servico, salarios, rescisoes, trilha };
}

async function admitir(m: ReturnType<typeof montar>, tipo: 'clt' | 'estagiario' = 'clt') {
  const v = (
    await m.rh.admitir(sessao(), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo,
      admissao: '2026-10-01',
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 44,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
  m.salarios.push({
    id: 70,
    vinculo: v,
    inicio: '2026-10-01',
    salario: 300_000,
    insalubridade: 0,
    periculosidade: false,
    motivo: 'Admissão',
    registradoPor: 'SINT',
    registradoEm: '2026-10-01T10:00:00',
  });
  return v;
}

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'] ?? (e as ErroProblema).tipo;
}

describe('eSocial (serviço)', () => {
  it('apoio: catálogo, leiaute vigente, coletor fora de produção, ações pela chave da folha e pela permissão', async () => {
    const m = montar();
    const a = await m.servico.apoioTela(sessao());
    expect(a.empresas).toEqual([{ codigo: 1, rotulo: 'EMPRESA SINTETICA DA FOLHA', temCnpj: true }]);
    expect(a.eventos).toHaveLength(17);
    expect(a.leiauteCatalogo.find((x) => x.evento === 'S-2200')?.versao).toBe('v_S_01_03_00');
    // O nome oficial vem do catálogo de eventos do banco (eventosCatalogo).
    expect(a.leiauteCatalogo.find((x) => x.evento === 'S-2200')?.nome).toBeTruthy();
    expect(a.transmissao).toMatchObject({
      chaveLigada: false,
      ambiente: 'coletor',
      podeEnviar: true,
      motivo: null,
    });
    expect(a.acoes).toEqual({ gerar: true, transmitir: true });
    const consulta = await m.servico.apoioTela(sessao((p) => p === 'pessoas.esocial.ler'));
    expect(consulta.acoes).toEqual({ gerar: false, transmitir: false });
    expect(consulta.transmissao.podeEnviar).toBe(false);
    const desligada = await montar({ chaves: ['pessoas.colaborador'] }).servico.apoioTela(sessao());
    expect(desligada.acoes).toEqual({ gerar: false, transmitir: false });
    expect(desligada.transmissao.motivo).toBeTruthy();
    const producao = await montar({ ambiente: 'producao' }).servico.apoioTela(sessao());
    expect(producao.transmissao).toMatchObject({ ambiente: 'producao', podeEnviar: false });
    expect(producao.transmissao.motivo).toMatch(/desligada/);
  });

  it('parâmetros do empregador: vigência gravada e relida; repetida recusada; mesma raiz com outro transmissor recusada (regra 1)', async () => {
    const m = montar();
    const s = sessao();
    expect(
      await codigo(
        m.servico.gerarTabela(s, {
          empresa: 1,
          eventos: ['S-1000'],
          operacao: 'inclusao',
          inicio: '2026-11',
          rubricas: [],
          gravar: false,
        }),
      ),
    ).toBe('empregador-sem-parametros');
    const v = await m.servico.registrarEmpregador(s, PARAMETROS);
    expect(v).toMatchObject({ empresa: 1, inicio: '2026-01', transmissor: 'sante', codLotacao: 'LOT01' });
    expect(await codigo(m.servico.registrarEmpregador(s, PARAMETROS))).toBe('vigencia-repetida');
    expect(await codigo(m.servico.registrarEmpregador(s, { ...PARAMETROS, empresa: 9 }))).toBe(
      'nao-encontrado',
    );
    // A empresa 2 (mesma raiz do CNPJ) tem o sistema externo desde 2026-06: a nova vigência da 1 não pode divergir.
    m.porta.cnpjsSinteticos.set(2, '11222333000262');
    await m.porta.gravarSgh(CTX, {} as never, (g) =>
      g.incluirEmpregador({
        empresa: 2,
        inicio: '2026-06',
        transmissor: 'externo',
        leiaute: 'v_S_01_03_00',
        parametros: JSON.stringify(PARAMETROS),
        por: 'SINT',
      }),
    );
    expect(await codigo(m.servico.registrarEmpregador(s, { ...PARAMETROS, inicio: '2026-07' }))).toBe(
      'dois-transmissores',
    );
    // Vigência gravada corrompida não entra em conta.
    expect(
      empregadorDaLinha({
        id: 1,
        empresa: 1,
        inicio: '2026-01',
        transmissor: 'sante',
        leiaute: 'v',
        parametros: 'x',
        criadoPor: 'a',
        criadoEm: 'b',
      }),
    ).toBeNull();
    expect(vigenciaNa([v], 1, '2025-12')).toBeNull();
  });

  it('transmissor externo: o Sante SGH não gera os eventos do empregador', async () => {
    const m = montar();
    await m.servico.registrarEmpregador(sessao(), { ...PARAMETROS, transmissor: 'externo' });
    expect(
      await codigo(
        m.servico.gerarTabela(sessao(), {
          empresa: 1,
          eventos: ['S-1000'],
          operacao: 'inclusao',
          inicio: '2026-11',
          rubricas: [],
          gravar: false,
        }),
      ),
    ).toBe('transmissor-externo');
  });

  it('eventos de tabela: prévia com XML válido no XSD e pendência da rubrica sem natureza; gravação; repetido recusado', async () => {
    const m = montar();
    const s = sessao();
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const entrada = {
      empresa: 1,
      eventos: ['S-1000', 'S-1005', 'S-1010', 'S-1020'] as const,
      operacao: 'inclusao' as const,
      inicio: '2026-11',
      rubricas: [],
      gravar: false,
    };
    const previa = await m.servico.gerarTabela(s, { ...entrada, eventos: [...entrada.eventos] });
    expect(previa.gravado).toBe(false);
    expect(previa.eventos.map((e) => [e.evento, e.referencia, e.valido])).toEqual([
      ['S-1000', 1, true],
      ['S-1005', 1, true],
      ['S-1010', 1, true],
      ['S-1010', 2, false],
      ['S-1020', 1, true],
    ]);
    expect(previa.eventos[3]!.pendencias.map((p) => p.codigo)).toEqual(['rubrica-sem-natureza']);
    expect(previa.eventos[0]!.xml).toContain('<classTrib>99</classTrib>');
    expect(previa.eventos.every((e) => e.id === null)).toBe(true);
    const gravado = await m.servico.gerarTabela(s, {
      ...entrada,
      eventos: ['S-1000', 'S-1010'],
      rubricas: [1],
      gravar: true,
    });
    expect(gravado.gravado).toBe(true);
    expect(gravado.eventos.map((e) => e.id !== null)).toEqual([true, true]);
    const lista = await m.servico.listarEventos(s, {});
    expect(lista.itens.map((e) => [e.evento, e.situacao, e.operacao])).toEqual([
      ['S-1010', 'validado', 'inclusao'],
      ['S-1000', 'validado', 'inclusao'],
    ]);
    expect(lista.itens[1]!.idEsocial).toMatch(/^ID1112223330000002026102710153000\d{3}$/);
    expect(await codigo(m.servico.gerarTabela(s, { ...entrada, eventos: ['S-1000'], gravar: true }))).toBe(
      'evento-ja-gerado',
    );
    expect(
      await codigo(
        m.servico.gerarTabela(s, { ...entrada, eventos: ['S-1010'], rubricas: [99], gravar: false }),
      ),
    ).toBe('nao-encontrado');
    // Chave da folha desligada: a prévia sai, a gravação não.
    const off = montar({ chaves: ['pessoas.colaborador'] });
    await off.porta.gravarSgh(CTX, {} as never, (g) =>
      g.incluirEmpregador({ ...PARAMETROS, parametros: JSON.stringify({ ...PARAMETROS }), por: 'SINT' }),
    );
    expect(
      (await off.servico.gerarTabela(sessao(), { ...entrada, eventos: ['S-1000'] })).eventos[0]!.valido,
    ).toBe(true);
    expect(
      await codigo(off.servico.gerarTabela(sessao(), { ...entrada, eventos: ['S-1000'], gravar: true })),
    ).toBe('recurso-desligado');
  });

  it('ficha: cifrada no banco, decifrada só para quem gera; sem a chave de proteção, recusada', async () => {
    const m = montar();
    const v = await admitir(m);
    const s = sessao();
    expect((await m.servico.ficha(s, v)).preenchida).toBe(false);
    const f = await m.servico.registrarFicha(s, v, { ficha: FICHA, versao: null });
    expect(f).toMatchObject({ vinculo: v, preenchida: true, versao: 0, ficha: FICHA });
    const guardada = await m.porta.ficha(CTX, v);
    expect(guardada!.dadosCifrados).toMatch(/^t1\./);
    expect(guardada!.dadosCifrados).not.toContain('Sintética');
    expect(
      (
        await m.servico.ficha(
          sessao((p) => p !== 'pessoas.esocial.gerar'),
          v,
        )
      ).ficha,
    ).toBeNull();
    expect(await codigo(m.servico.registrarFicha(s, v, { ficha: FICHA, versao: null }))).toBe(
      'desatualizado',
    );
    expect(
      (await m.servico.registrarFicha(s, v, { ficha: { ...FICHA, racaCor: 1 }, versao: 0 })).versao,
    ).toBe(1);
    expect(await codigo(m.servico.ficha(s, 999_999))).toBe('nao-encontrado');
    const semChave = new ServicoEsocial(
      m.porta,
      m.folha,
      {} as never,
      {} as never,
      m.pessoas,
      null,
      m.trilha,
      null,
      null,
      'ci',
    );
    expect(await codigo(semChave.registrarFicha(s, v, { ficha: FICHA, versao: 1 }))).toBe('ficha-sem-chave');
  });

  it('S-2200: prévia sem XML; gravado cifrado; XML só com gerar; lote ao coletor; retorno; retificação e exclusão', async () => {
    const m = montar();
    const s = sessao();
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const v = await admitir(m);
    const semFicha = await m.servico.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: null,
      gravar: false,
    });
    expect(semFicha.eventos[0]!.pendencias.map((p) => p.codigo)).toEqual(['ficha-ausente']);
    await m.servico.registrarFicha(s, v, { ficha: FICHA, versao: null });
    const previa = await m.servico.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: null,
      gravar: false,
    });
    expect(previa.eventos[0]).toMatchObject({
      valido: true,
      xml: null,
      id: null,
      dataReferencia: '2026-10-01',
    });
    expect(previa.eventos[0]!.errosXsd).toEqual([]);
    const g = await m.servico.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: null,
      gravar: true,
    });
    const id = g.eventos[0]!.id!;
    const bruto = await m.porta.evento(CTX, id);
    expect(bruto!.evento.xmlCifrado).toBe(true);
    expect(bruto!.xml).not.toContain(C.nova.cpf);
    const det = await m.servico.detalheEvento(s, id);
    expect(det.xml).toContain(`<cpfTrab>${C.nova.cpf}</cpfTrab>`);
    expect(det.evento).toMatchObject({
      evento: 'S-2200',
      vinculo: v,
      situacao: 'validado',
      origem: 'vinculo',
    });
    expect(
      (
        await m.servico.detalheEvento(
          sessao((p) => p !== 'pessoas.esocial.gerar'),
          id,
        )
      ).xml,
    ).toBeNull();
    expect(JSON.stringify(await m.servico.listarEventos(s, { vinculo: v }))).not.toContain(C.nova.cpf);
    expect(
      await codigo(
        m.servico.gerarTrabalhador(s, {
          evento: 'S-2200',
          empresa: 1,
          vinculo: v,
          referencia: null,
          data: null,
          retificar: null,
          gravar: true,
        }),
      ),
    ).toBe('evento-ja-gerado');

    // Lote misto recusado; lote do S-2200 montado, enviado ao coletor e com o retorno aceito.
    const [tab] = (
      await m.servico.gerarTabela(s, {
        empresa: 1,
        eventos: ['S-1000'],
        operacao: 'inclusao',
        inicio: '2026-11',
        rubricas: [],
        gravar: true,
      })
    ).eventos;
    expect(await codigo(m.servico.montarLote(s, { empresa: 1, eventos: [id, tab!.id!] }))).toBe('lote-misto');
    const lote = await m.servico.montarLote(s, { empresa: 1, eventos: [id] });
    expect(lote.lote).toMatchObject({
      grupo: 'nao-periodico',
      ambiente: 'coletor',
      situacao: 'montado',
      quantidade: 1,
    });
    expect(lote.eventos[0]!.situacao).toBe('em-lote');
    expect(await codigo(m.servico.montarLote(s, { empresa: 1, eventos: [id] }))).toBe('situacao-invalida');
    const enviado = await m.servico.enviarLote(s, lote.lote.id, { versao: 0 });
    expect(enviado.lote).toMatchObject({ situacao: 'enviado', protocolo: `COLETOR-${lote.lote.id}` });
    expect(enviado.eventos[0]!.situacao).toBe('enviado');
    expect(await codigo(m.servico.enviarLote(s, lote.lote.id, { versao: 1 }))).toBe('situacao-invalida');
    expect(
      await codigo(
        m.servico.registrarRetorno(s, lote.lote.id, {
          versao: 1,
          protocolo: null,
          eventos: [
            {
              evento: tab!.id!,
              aceito: true,
              recibo: '1.2.0000000000000000001',
              codigo: '201',
              descricao: 'Sucesso',
            },
          ],
        }),
      ),
    ).toBe('evento-fora-do-lote');
    const proc = await m.servico.registrarRetorno(s, lote.lote.id, {
      versao: 1,
      protocolo: 'P-1',
      eventos: [
        { evento: id, aceito: true, recibo: '1.2.0000000000000000001', codigo: '201', descricao: 'Sucesso' },
      ],
    });
    expect(proc.lote).toMatchObject({ situacao: 'processado', protocolo: 'P-1' });
    expect(proc.eventos[0]).toMatchObject({
      situacao: 'aceito',
      recibo: '1.2.0000000000000000001',
      retorno: { codigo: '201', descricao: 'Sucesso' },
    });

    // Retificação: indRetif 2 com o recibo; aceita, a anterior fica substituída.
    const ret = await m.servico.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: id,
      gravar: true,
    });
    const idRet = ret.eventos[0]!.id!;
    expect((await m.servico.detalheEvento(s, idRet)).xml).toContain(
      '<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000001</nrRecibo>',
    );
    const l2 = await m.servico.montarLote(s, { empresa: 1, eventos: [idRet] });
    await m.servico.enviarLote(s, l2.lote.id, { versao: 0 });
    await m.servico.registrarRetorno(s, l2.lote.id, {
      versao: 1,
      protocolo: null,
      eventos: [
        {
          evento: idRet,
          aceito: true,
          recibo: '1.2.0000000000000000002',
          codigo: '201',
          descricao: 'Sucesso',
        },
      ],
    });
    expect((await m.servico.detalheEvento(s, id)).evento.situacao).toBe('substituido');
    expect(
      await codigo(
        m.servico.gerarTrabalhador(s, {
          evento: 'S-2200',
          empresa: 1,
          vinculo: v,
          referencia: null,
          data: null,
          retificar: id,
          gravar: false,
        }),
      ),
    ).toBe('evento-sem-recibo');

    // Exclusão (S-3000) do evento aceito: prévia sem XML; aceita, o alvo fica excluído.
    const alvo = (await m.servico.detalheEvento(s, idRet)).evento;
    const exPrevia = await m.servico.excluir(s, idRet, {
      motivo: 'Admissão lançada em duplicidade',
      versao: alvo.versao,
      gravar: false,
    });
    expect(exPrevia.eventos[0]).toMatchObject({ evento: 'S-3000', valido: true, xml: null });
    const ex = await m.servico.excluir(s, idRet, {
      motivo: 'Admissão lançada em duplicidade',
      versao: alvo.versao,
      gravar: true,
    });
    const idEx = ex.eventos[0]!.id!;
    expect(
      await codigo(
        m.servico.excluir(s, idRet, { motivo: 'De novo, por engano', versao: alvo.versao, gravar: true }),
      ),
    ).toBe('evento-ja-gerado');
    const l3 = await m.servico.montarLote(s, { empresa: 1, eventos: [idEx] });
    await m.servico.enviarLote(s, l3.lote.id, { versao: 0 });
    await m.servico.registrarRetorno(s, l3.lote.id, {
      versao: 1,
      protocolo: null,
      eventos: [
        {
          evento: idEx,
          aceito: true,
          recibo: '1.2.0000000000000000003',
          codigo: '201',
          descricao: 'Sucesso',
        },
      ],
    });
    expect((await m.servico.detalheEvento(s, idRet)).evento.situacao).toBe('excluido');
    expect(
      await codigo(m.servico.excluir(s, idRet, { motivo: 'Já excluído antes', versao: 99, gravar: false })),
    ).toBe('desatualizado');
  });

  it('descarte e cancelamento do lote; rejeição; envio em produção sem a chave do eSocial recusado', async () => {
    const m = montar();
    const s = sessao();
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const [a, b] = (
      await m.servico.gerarTabela(s, {
        empresa: 1,
        eventos: ['S-1000', 'S-1005'],
        operacao: 'inclusao',
        inicio: '2026-11',
        rubricas: [],
        gravar: true,
      })
    ).eventos;
    expect(await codigo(m.servico.descartar(s, a!.id!, { motivo: 'Gerado por engano', versao: 5 }))).toBe(
      'desatualizado',
    );
    expect((await m.servico.descartar(s, a!.id!, { motivo: 'Gerado por engano', versao: 0 })).situacao).toBe(
      'descartado',
    );
    expect(await codigo(m.servico.descartar(s, a!.id!, { motivo: 'Gerado por engano', versao: 1 }))).toBe(
      'situacao-invalida',
    );
    const l = await m.servico.montarLote(s, { empresa: 1, eventos: [b!.id!] });
    const cancelado = await m.servico.cancelarLote(s, l.lote.id, {
      motivo: 'Montado antes da hora',
      versao: 0,
    });
    expect(cancelado.lote.situacao).toBe('cancelado');
    expect((await m.servico.detalheEvento(s, b!.id!)).evento).toMatchObject({
      situacao: 'validado',
      lote: null,
    });
    expect(
      await codigo(m.servico.cancelarLote(s, l.lote.id, { motivo: 'Montado antes da hora', versao: 1 })),
    ).toBe('situacao-invalida');
    const l2 = await m.servico.montarLote(s, { empresa: 1, eventos: [b!.id!] });
    await m.servico.enviarLote(s, l2.lote.id, { versao: 0 });
    const rej = await m.servico.registrarRetorno(s, l2.lote.id, {
      versao: 1,
      protocolo: null,
      eventos: [
        { evento: b!.id!, aceito: false, recibo: null, codigo: '401', descricao: 'Erro de validação' },
      ],
    });
    expect(rej.eventos[0]).toMatchObject({ situacao: 'rejeitado', recibo: null, retorno: { codigo: '401' } });
    expect(
      (
        await m.servico.descartar(s, b!.id!, {
          motivo: 'Corrigido em outro evento',
          versao: rej.eventos[0]!.versao,
        })
      ).situacao,
    ).toBe('descartado');
    expect((await m.servico.listarLotes(s, { empresa: 1 })).itens.map((x) => x.situacao)).toEqual([
      'processado',
      'cancelado',
    ]);
    expect(await codigo(m.servico.detalheLote(s, 999))).toBe('nao-encontrado');

    const prod = montar({ ambiente: 'producao' });
    await prod.servico.registrarEmpregador(s, PARAMETROS);
    const [c] = (
      await prod.servico.gerarTabela(s, {
        empresa: 1,
        eventos: ['S-1000'],
        operacao: 'inclusao',
        inicio: '2026-11',
        rubricas: [],
        gravar: true,
      })
    ).eventos;
    const lp = await prod.servico.montarLote(s, { empresa: 1, eventos: [c!.id!] });
    expect(lp.lote.ambiente).toBe('producao');
    expect(await codigo(prod.servico.enviarLote(s, lp.lote.id, { versao: 0 }))).toBe('envio-desligado');
    const ligada = montar({
      ambiente: 'producao',
      chaves: ['pessoas.colaborador', 'pessoas.folha', 'pessoas.esocial'],
    });
    expect(await codigo(ligada.servico.enviarLote(s, 1, { versao: 0 }))).toBe(
      'transmissor-real-indisponivel',
    );
  });

  it('produção com o transmissor real (simulador local): S-1000, S-1005 e S-2200 assinados, conferidos no XSD e enviados; protocolo; consulta do retorno com recibo e rejeição', async () => {
    const agora = new Date();
    const raiz = criarRaizSintetica(agora);
    const tit = emitirSintetico(raiz, { cpf: null, nome: 'EMPRESA SINTETICA LTDA:11222333000181' }, agora);
    const der = Buffer.from(tit.certificado).toString('base64');
    const l = lerCertificadoEsocial(
      {
        certificadoPem: `-----BEGIN CERTIFICATE-----\n${der.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`,
        chavePem: tit.chave.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
      agora,
    );
    if (!l.ok) throw new Error(l.motivo);
    const sim = new SimuladorEsocial();
    const transmissor = new TransmissorEsocialSoap(l.certificado, {
      ambiente: 'producao',
      urlEnvio: 'http://127.0.0.1:1/envio',
      urlConsulta: 'http://127.0.0.1:1/consulta',
      transporte: sim.transporte,
    });
    const m = montar({
      ambiente: 'producao',
      chaves: ['pessoas.colaborador', 'pessoas.folha', 'pessoas.esocial'],
      transmissao: { transmissor, motivo: null },
    });
    const s = sessao();
    expect((await m.servico.apoioTela(s)).transmissao).toMatchObject({
      ambiente: 'producao',
      podeEnviar: true,
    });
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const [a, b] = (
      await m.servico.gerarTabela(s, {
        empresa: 1,
        eventos: ['S-1000', 'S-1005'],
        operacao: 'inclusao',
        inicio: '2026-11',
        rubricas: [],
        gravar: true,
      })
    ).eventos;
    const lt = await m.servico.montarLote(s, { empresa: 1, eventos: [a!.id!, b!.id!] });
    // Envio recusado pelo eSocial: nada muda (o lote segue montado).
    sim.codigoEnvio = 402;
    expect(await codigo(m.servico.enviarLote(s, lt.lote.id, { versao: 0 }))).toBe('lote-recusado-esocial');
    expect((await m.servico.detalheLote(s, lt.lote.id)).lote.situacao).toBe('montado');
    sim.codigoEnvio = 201;
    const enviado = await m.servico.enviarLote(s, lt.lote.id, { versao: 0 });
    expect(sim.problemas).toEqual([]);
    expect(sim.recebidos[0]).toMatchObject({
      grupo: '1',
      empregador: '11222333',
      transmissor: '11222333000181',
    });
    expect(sim.recebidos[0]!.eventos.map((e) => e.raiz)).toEqual(['evtInfoEmpregador', 'evtTabEstab']);
    expect(enviado.lote).toMatchObject({ situacao: 'enviado', protocolo: sim.recebidos[0]!.protocolo });
    // Retorno: primeiro em processamento; depois o S-1000 aceito e o S-1005 rejeitado (sem o número na descrição).
    sim.consultasEmProcessamento = 1;
    expect(await codigo(m.servico.consultarRetorno(s, lt.lote.id, { versao: 1 }))).toBe(
      'lote-em-processamento',
    );
    sim.rejeitar.set(sim.recebidos[0]!.eventos[1]!.id, {
      codigo: '1027',
      descricao: 'CNPJ 11222333000181 sem cadastro "VALOR"',
    });
    const ret = await m.servico.consultarRetorno(s, lt.lote.id, { versao: 1 });
    expect(ret.lote.situacao).toBe('processado');
    const ra = ret.eventos.find((e) => e.id === a!.id);
    const rb = ret.eventos.find((e) => e.id === b!.id);
    expect(ra).toMatchObject({ situacao: 'aceito', recibo: '1.1.0000000000000000001' });
    expect(rb).toMatchObject({ situacao: 'rejeitado', recibo: null, retorno: { codigo: '1027' } });
    expect(rb!.retorno!.descricao).not.toContain('11222333000181');
    expect(rb!.retorno!.descricao).not.toContain('VALOR');
    expect(await codigo(m.servico.consultarRetorno(s, lt.lote.id, { versao: 2 }))).toBe('situacao-invalida');

    // S-2200: o XML cifrado é decifrado só para assinar; o evento assinado valida no XSD.
    const v = await admitir(m);
    await m.servico.registrarFicha(s, v, { ficha: FICHA, versao: null });
    const g = await m.servico.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: null,
      gravar: true,
    });
    const l2 = await m.servico.montarLote(s, { empresa: 1, eventos: [g.eventos[0]!.id!] });
    await m.servico.enviarLote(s, l2.lote.id, { versao: 0 });
    expect(sim.problemas).toEqual([]);
    expect(sim.recebidos[1]).toMatchObject({ grupo: '2' });
    expect(sim.recebidos[1]!.eventos[0]!.xml).toContain(`<cpfTrab>${C.nova.cpf}</cpfTrab>`);
    // Fora de produção a consulta não existe (o retorno é registrado evento a evento).
    expect(await codigo(montar().servico.consultarRetorno(s, 1, { versao: 0 }))).toBe(
      'consulta-so-em-producao',
    );
  });

  it('textoRetornoSemValores: tira número longo e valor entre aspas', () => {
    expect(textoRetornoSemValores('CPF 529.982.247-25 "FULANA" inválido')).toBe(
      'CPF (valor) (valor) inválido',
    );
  });

  it('S-2230, S-2206, S-2205 e S-2299 com a origem conferida; estagiário pelo S-2300 e o término pelo S-2399', async () => {
    const m = montar();
    const s = sessao();
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const v = await admitir(m);
    await m.servico.registrarFicha(s, v, { ficha: FICHA, versao: null });
    const base = { empresa: 1, vinculo: v, referencia: null, data: null, retificar: null, gravar: false };
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2230' }))).toBe(
      'referencia-obrigatoria',
    );
    const af = await m.folha.gravarSgh(CTX, {} as never, (g) =>
      g.incluirAfastamento({
        vinculo: v,
        motivo: 3,
        inicio: '2026-10-10',
        fim: '2026-10-20',
        observacao: null,
        por: 'SINT',
      }),
    );
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2230', referencia: af })).eventos[0],
    ).toMatchObject({ valido: true, origem: 'afastamento', dataReferencia: '2026-10-10' });
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2230', referencia: 999 }))).toBe(
      'referencia-invalida',
    );
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2205' }))).toBe(
      'referencia-obrigatoria',
    );
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2205', data: '2026-10-20' })).eventos[0]!
        .valido,
    ).toBe(true);
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2206', referencia: 70 })).eventos[0],
    ).toMatchObject({ valido: true, origem: 'salario', dataReferencia: '2026-10-01' });
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2206', data: '2026-10-15' })).eventos[0]!
        .origem,
    ).toBe('contrato');
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2206', referencia: 71 }))).toBe(
      'referencia-invalida',
    );
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2299' }))).toBe(
      'referencia-obrigatoria',
    );
    m.rescisoes.push({
      id: 5,
      vinculo: v,
      empresa: 1,
      desligamento: '2026-10-20',
      tipoRescisao: 2,
      modalidade: 'sem-justa-causa',
      aviso: 'indenizado',
      diasAviso: 30,
      diasIndenizados: 30,
      projecao: '2026-11-19',
      termo: null,
      saldoFgts: 0,
      saldoFgtsInformado: false,
      multaFgts: 0,
      pagamento: '2026-10-30',
      situacao: 'calculada',
      processo: 40,
      motivo: null,
      registradoPor: 'SINT',
      registradoEm: '2026-10-21T10:00:00',
      situacaoPor: null,
      situacaoEm: null,
      versao: 0,
    });
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2299', referencia: 5 })).eventos[0],
    ).toMatchObject({ valido: true, origem: 'rescisao', dataReferencia: '2026-10-20' });
    expect(
      await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2299', referencia: 5, empresa: 2 })),
    ).toBe('referencia-invalida');
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2399' }))).toBe(
      'referencia-obrigatoria',
    );
    expect(await codigo(m.servico.gerarTrabalhador(s, { ...base, vinculo: 999_999, evento: 'S-2200' }))).toBe(
      'nao-encontrado',
    );
    // O estagiário (categoria 901) pelo S-2300; o mesmo vínculo pelo S-2200 tem a pendência da categoria.
    await m.servico.registrarFicha(s, v, {
      ficha: {
        ...FICHA,
        categoria: '901',
        estagio: {
          natureza: 'O',
          nivel: 2,
          terminoPrevisto: '2027-06-30',
          cnpjInstituicao: '44555666000171',
        },
      },
      versao: 0,
    });
    expect((await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2300' })).eventos[0]!.valido).toBe(
      true,
    );
    expect(
      (await m.servico.gerarTrabalhador(s, { ...base, evento: 'S-2200' })).eventos[0]!.pendencias.map(
        (p) => p.codigo,
      ),
    ).toEqual(['categoria-sem-vinculo']);
  });

  it('pendências do outro sistema só contadas; conciliação com o repasse e a conferência gravada', async () => {
    const m = montar();
    const s = sessao();
    const p = await m.servico.pendenciasMigradas(s, null);
    expect(p.total).toBe(87);
    expect(p.porEvento.map((x) => [x.evento, x.quantidade])).toEqual([
      ['S-1010', 12],
      ['S-1200', 75],
    ]);
    const sem = await m.servico.conciliacao(s, { empresa: 1, competencia: '2026-11' });
    expect(sem).toMatchObject({ situacao: 'sem-transmissor', transmissor: null, conferida: null });
    await m.servico.registrarEmpregador(s, PARAMETROS);
    const c = await m.servico.conciliacao(s, { empresa: 1, competencia: '2026-11' });
    expect(c.situacao).toBe('conciliada');
    const por = Object.fromEntries(c.linhas.map((l) => [l.evento, l]));
    expect(por['S-1200']).toMatchObject({
      repasse: 3,
      pendenciaLegado: 75,
      situacao: 'repasse-no-periodico',
    });
    expect(por['S-1010']).toMatchObject({ situacao: 'so-contagem' });
    const conferida = await m.servico.conferirConciliacao(s, {
      empresa: 1,
      competencia: '2026-11',
      externo: { 'S-2299': 1 },
      observacao: 'O sistema externo ainda mandou um desligamento.',
    });
    expect(conferida.situacao).toBe('divergente');
    expect(conferida.conferida).toMatchObject({
      por: 'SINT.DP.FOLHA',
      situacao: 'divergente',
      observacao: 'O sistema externo ainda mandou um desligamento.',
    });
    expect(conferida.linhas.find((l) => l.evento === 'S-2299')).toMatchObject({
      externo: 1,
      situacao: 'dois-transmissores',
    });
    // A consulta seguinte usa o que o sistema externo informou na última conferência.
    expect(
      (await m.servico.conciliacao(s, { empresa: 1, competencia: '2026-11' })).linhas.find(
        (l) => l.evento === 'S-2299',
      )?.externo,
    ).toBe(1);
    expect(await codigo(m.servico.conciliacao(s, { empresa: 7, competencia: '2026-11' }))).toBe(
      'nao-encontrado',
    );
  });
});
