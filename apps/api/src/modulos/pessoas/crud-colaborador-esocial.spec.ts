// Revisão W0-06: a correção de matrícula ou admissão do colaborador confere a fila do eSocial (S-2200/S-2300), como o
// SESMT faz com o S-2210: em lote ou enviado recusa; o não enviado se descarta e sai de novo; o aceito ganha o
// retificador (admissão) ou o S-3000 (matrícula, que não se retifica). Tudo em memória; nada sai do teste.
import type { FichaEsocialVinculo } from '@sgh/contratos';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { CifraCpf } from './cifra-cpf.js';
import { PortaEsocialMemoria } from './esocial/porta-esocial-memoria.js';
import { ServicoEsocial } from './esocial/servico-esocial.js';
import type { PortaCalculoFolha } from './folha/porta-calculo.js';
import { PortaFolhaMemoria } from './folha/porta-folha-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from './porta-memoria.js';
import type { PortaRubricas } from './rubricas/porta-rubricas.js';
import { ServicoPessoas } from './servico.js';

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
const sessao = (): SessaoCadastro => ({
  req: {
    headers: { 'idempotency-key': `w006-s2200-${++k}` },
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as never,
  hospital: 'pc',
  rede: 'rede-sintetica',
  login: 'SINT.RH',
  porta: { rede: 'rede-sintetica', hospital: 'pc' },
  pode: () => true,
});

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
  cboCargo: '322205',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Plantão 12x36',
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
  motivosAfastamento: {},
};
const MOTIVO = 'Matrícula digitada errada na admissão';

async function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', 'pessoas.folha'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-27T10:15:30';
  const esocial = new ServicoEsocial(
    new PortaEsocialMemoria(),
    folha,
    {
      salarios: async (_c: unknown, ids: readonly number[]) =>
        ids.map((vinculo) => ({ id: 1, vinculo, inicio: '2026-01-01', salario: 3200 })),
    } as unknown as PortaCalculoFolha,
    { rubricas: async () => [] } as unknown as PortaRubricas,
    pessoas,
    cifra,
    trilha,
    config,
    null,
    'ci',
  );
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra, esocial);
  const s = sessao();
  await esocial.registrarEmpregador(s, PARAMETROS);
  const v = (
    await rh.admitir(s, {
      cpf: PESSOAS_SINTETICAS_M52.nova.cpf,
      nome: 'TECNICA SINTETICA ADMISSAO',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Técnico de enfermagem',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: 'M0100',
      usuario: null,
    })
  ).id;
  await esocial.registrarFicha(s, v, { ficha: FICHA, versao: null });
  const gerar = async () => {
    const r = await esocial.gerarTrabalhador(s, {
      evento: 'S-2200',
      empresa: 1,
      vinculo: v,
      referencia: null,
      data: null,
      retificar: null,
      gravar: true,
    });
    expect(r.eventos[0]!.pendencias).toEqual([]);
    return r.eventos[0]!.id!;
  };
  const lote = async (evento: number) =>
    (await esocial.montarLote(s, { empresa: 1, eventos: [evento] })).lote.id;
  const aceitar = async (evento: number, recibo: string) => {
    const l = await lote(evento);
    await esocial.enviarLote(s, l, { versao: 0 });
    await esocial.registrarRetorno(s, l, {
      versao: 1,
      protocolo: null,
      eventos: [{ evento, aceito: true, recibo, codigo: '201', descricao: 'Sucesso' }],
    });
  };
  const versao = async () => (await rh.ficha(s, v)).versao;
  return { s, v, rh, esocial, gerar, lote, aceitar, versao };
}

describe('revisão W0-06: correção de matrícula ou admissão com a fila do eSocial (S-2200)', () => {
  it('não enviado: descarta (guardado, com o motivo) e gera de novo com a matrícula corrigida', async () => {
    const m = await montar();
    const original = await m.gerar();
    const r = await m.rh.corrigir(m.s, {
      vinculo: m.v,
      versao: await m.versao(),
      matricula: 'M0101',
      motivo: MOTIVO,
    });
    expect(r.esocial).toMatchObject({ operacao: 'original', anterior: original });
    expect((await m.esocial.detalheEvento(m.s, original)).evento.situacao).toBe('descartado');
    const novo = await m.esocial.detalheEvento(m.s, r.esocial!.evento!);
    expect(novo.evento).toMatchObject({ evento: 'S-2200', situacao: 'validado' });
    expect(novo.xml).toContain('<matricula>M0101</matricula>');
  });

  it('aceito, só a admissão: o retificador (indRetif 2 com o recibo) na mesma operação', async () => {
    const m = await montar();
    const original = await m.gerar();
    await m.aceitar(original, '1.2.0000000000000000201');
    const r = await m.rh.corrigir(m.s, {
      vinculo: m.v,
      versao: await m.versao(),
      admissao: '2026-09-28',
      motivo: 'Admissão registrada com a data errada',
    });
    expect(r.esocial).toMatchObject({ operacao: 'retificacao', anterior: original, valido: true });
    const ret = await m.esocial.detalheEvento(m.s, r.esocial!.evento!);
    expect(ret.evento).toMatchObject({ evento: 'S-2200', eventoAnterior: original });
    expect(ret.xml).toContain('<indRetif>2</indRetif>');
    expect(ret.xml).toContain('<nrRecibo>1.2.0000000000000000201</nrRecibo>');
    expect(ret.xml).toContain('<dtAdm>2026-09-28</dtAdm>');
  });

  it('aceito, a matrícula: S-3000 do aceito (a matrícula não se retifica), com a mensagem do reenvio', async () => {
    const m = await montar();
    const original = await m.gerar();
    await m.aceitar(original, '1.2.0000000000000000202');
    const r = await m.rh.corrigir(m.s, {
      vinculo: m.v,
      versao: await m.versao(),
      matricula: 'M0102',
      motivo: MOTIVO,
    });
    expect(r.esocial).toMatchObject({ operacao: 'exclusao', anterior: original });
    const exc = await m.esocial.detalheEvento(m.s, r.esocial!.evento!);
    expect(exc.evento).toMatchObject({ evento: 'S-3000', eventoAnterior: original });
    expect(exc.xml).toContain('<nrRecEvt>1.2.0000000000000000202</nrRecEvt>');
    expect(r.mensagem).toMatch(/S-3000/);
  });

  it('em lote: recusa (409) e nada muda no cadastro nem na fila', async () => {
    const m = await montar();
    const original = await m.gerar();
    await m.lote(original);
    const v0 = await m.versao();
    expect(
      await codigo(m.rh.corrigir(m.s, { vinculo: m.v, versao: v0, matricula: 'M0103', motivo: MOTIVO })),
    ).toBe('evento-em-transito');
    expect(await m.versao()).toBe(v0);
    expect((await m.esocial.detalheEvento(m.s, original)).evento.situacao).toBe('em-lote');
  });

  it('só o nome: a fila não é conferida', async () => {
    const m = await montar();
    const original = await m.gerar();
    await m.lote(original);
    const r = await m.rh.corrigir(m.s, {
      vinculo: m.v,
      versao: await m.versao(),
      nome: 'TECNICA SINTETICA ADMISSAO CORRIGIDA',
      motivo: 'Nome digitado errado na admissão',
    });
    expect(r.esocial).toBeUndefined();
  });
});
