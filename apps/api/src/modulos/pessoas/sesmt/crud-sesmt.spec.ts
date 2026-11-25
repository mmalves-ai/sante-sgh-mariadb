// W0-06, parte 3b (programa CRUD completo): retificação e anulação do acidente e da CAT com o S-2210 na fila do eSocial
// (o original fica guardado; o retificador leva indRetif 2 com o recibo; a anulação gera o S-3000) e cancelamento da
// entrega de EPI. Portas em memória (nada conecta a banco; nada sai: a transmissão fica desligada); dados sintéticos.
import type { DadosCatEntrada, FichaEsocialVinculo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import {
  type ChaveLiberacao,
  type PrerequisitoRecurso,
  fonteConfiguracaoMemoria,
} from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEsocialMemoria } from '../esocial/porta-esocial-memoria.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import type { PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import type { PortaRubricas } from '../rubricas/porta-rubricas.js';
import { ServicoPessoas } from '../servico.js';
import { PortaSesmtMemoria } from './porta-sesmt-memoria.js';
import { ServicoSesmt } from './servico-sesmt.js';
import { ctxTeste } from './contexto-teste.spec-util.js';

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
const cifra = new CifraCpf(Buffer.alloc(32, 9));
const CTX = ctxTeste('pc', 'rede-sintetica');
let k = 0;
const sessao = (): SessaoCadastro => ({
  req: {
    headers: { 'idempotency-key': `w006-sesmt-${++k}` },
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as never,
  hospital: 'pc',
  rede: 'rede-sintetica',
  login: 'SINT.SESMT',
  porta: CTX,
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

const CAT: DadosCatEntrada = {
  horasAntes: '05:30',
  lateralidade: 2,
  comunicouPolicia: false,
  dataObito: null,
  ultimoDiaTrabalhado: null,
  observacao: null,
  reciboOrigem: null,
  localTipo: 1,
  logradouro: 'Rua Sintética do Hospital',
  numero: '100',
  cep: '30110000',
  municipio: '3106200',
  uf: 'MG',
  atestadoData: '2026-10-20',
  atestadoHora: '15:00',
  internacao: false,
  duracaoDias: 2,
  complementoLesao: null,
  diagnostico: null,
  cid: 'W260',
  emitenteNome: 'MEDICA SINTETICA',
  emitenteConselho: 1,
  emitenteNumero: '12345',
  emitenteUf: 'MG',
};
const MOTIVO = 'Descrição do acidente registrada errada no plantão';

async function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', 'pessoas.folha', 'pessoas.sesmt'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, cifra);
  const folha = new PortaFolhaMemoria(pessoas);
  folha.agoraFixo = '2026-10-27T10:15:30';
  const portaEsocial = new PortaEsocialMemoria();
  const calculo = { salarios: async () => [] } as unknown as PortaCalculoFolha;
  const rubricas = { rubricas: async () => [] } as unknown as PortaRubricas;
  const esocial = new ServicoEsocial(
    portaEsocial,
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
  const porta = new PortaSesmtMemoria(pessoas);
  porta.agoraFixo = '2026-10-27T10:15';
  const sesmt = new ServicoSesmt(porta, pessoas, trilha, config, null, esocial);
  const s = sessao();
  await esocial.registrarEmpregador(s, PARAMETROS);
  const v = (
    await rh.admitir(s, {
      cpf: PESSOAS_SINTETICAS_M52.nova.cpf,
      nome: 'TECNICA SINTETICA SESMT',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Técnico de enfermagem',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 3' },
      matricula: null,
      usuario: null,
    })
  ).id;
  await esocial.registrarFicha(s, v, { ficha: FICHA, versao: null });
  const acidente = async (cat: DadosCatEntrada | null = CAT) => {
    const { id } = await sesmt.registrarAcidente(s, {
      vinculo: v,
      ocorridoEm: '2026-10-20T14:30',
      tipo: 'tipico',
      unidade: null,
      local: 'Posto 3',
      descricao: 'Corte na mão ao abrir ampola de medicação',
      biologico: false,
      perfurocortante: false,
      exposicao: null,
      material: null,
      fonte: null,
      fonteTeste: null,
      parteCorpo: 753030000,
      natureza: 702010000,
      agente: 302010000,
      situacao: 200004300,
      afastamento: false,
      obito: false,
      profilaxia: null,
      profilaxiaEm: null,
      profilaxiaObs: null,
    });
    await sesmt.emitirCat(s, {
      acidente: id,
      versao: 0,
      tipoCat: 1,
      iniciativa: 1,
      numero: `SINT-CAT-${id}`,
      emitidaEm: '2026-10-21',
      cat,
    });
    return id;
  };
  /** Lote, envio ao coletor e o retorno aceito com o recibo (o caminho da fila; nada sai do teste). */
  const aceitar = async (evento: number, recibo: string) => {
    const l = await esocial.montarLote(s, { empresa: 1, eventos: [evento] });
    await esocial.enviarLote(s, l.lote.id, { versao: 0 });
    await esocial.registrarRetorno(s, l.lote.id, {
      versao: 1,
      protocolo: null,
      eventos: [{ evento, aceito: true, recibo, codigo: '201', descricao: 'Sucesso' }],
    });
  };
  return { s, v, sesmt, esocial, porta, acidente, aceitar };
}

describe('W0-06: retificação e anulação do acidente e da CAT (S-2210 na fila do eSocial)', () => {
  it('original aceito → retificação gera o S-2210 retificador (indRetif 2 com o recibo); anulação gera o S-3000; nada se apaga', async () => {
    const m = await montar();
    const id = await m.acidente();
    expect((await m.sesmt.acidente(m.s, id)).cat).toMatchObject({ cid: 'W260', lateralidade: 2 });

    // O original: a prévia sem pendência e válida no XSD; gravado na fila.
    const previa = await m.sesmt.gerarCatEsocial(m.s, { acidente: id, empresa: 1, gravar: false });
    expect(previa.eventos[0]).toMatchObject({ evento: 'S-2210', pendencias: [], valido: true, id: null });
    const original = (await m.sesmt.gerarCatEsocial(m.s, { acidente: id, empresa: 1, gravar: true }))
      .eventos[0]!.id!;
    expect(await codigo(m.sesmt.gerarCatEsocial(m.s, { acidente: id, empresa: 1, gravar: true }))).toBe(
      'evento-ja-gerado',
    );
    await m.aceitar(original, '1.2.0000000000000000101');

    // Retificação: o registro inteiro com o motivo; o retificador leva o recibo do original.
    const ac = await m.sesmt.acidente(m.s, id);
    const ret = await m.sesmt.retificarAcidente(m.s, {
      acidente: id,
      versao: ac.versao,
      motivo: MOTIVO,
      ocorridoEm: ac.ocorridoEm,
      tipo: 'tipico',
      local: 'Posto 3',
      descricao: 'Corte no dedo ao abrir ampola de medicação',
      parteCorpo: 753050000,
      natureza: ac.natureza,
      agente: ac.agente,
      situacao: ac.situacao,
      afastamento: false,
      obito: false,
      cat: { ...CAT, lateralidade: 1 },
    });
    expect(ret.esocial).toMatchObject({ operacao: 'retificacao', anterior: original, valido: true });
    const retificador = ret.esocial!.evento!;
    const xml = (await m.esocial.detalheEvento(m.s, retificador)).xml!;
    expect(xml).toContain('<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000101</nrRecibo>');
    expect(xml).toContain('<codParteAting>753050000</codParteAting><lateralidade>1</lateralidade>');
    // O original continua guardado, aceito, até o retorno do retificador.
    expect((await m.esocial.detalheEvento(m.s, original)).evento.situacao).toBe('aceito');
    // A trilha do valor anterior: antes e depois.
    const corr = await m.porta.correcoes(CTX, 'comunicacao_acidente', [id]);
    expect(corr[0]).toMatchObject({
      operacao: 'acidente.retificado',
      motivo: MOTIVO,
      antes: { descricao: 'Corte na mão ao abrir ampola de medicação', parteCorpo: 753030000 },
      depois: { descricao: 'Corte no dedo ao abrir ampola de medicação', parteCorpo: 753050000 },
    });

    // Nova retificação antes de enviar: o retificador não enviado se descarta (guardado) e sai outro.
    const ac2 = await m.sesmt.acidente(m.s, id);
    const ret2 = await m.sesmt.retificarAcidente(m.s, {
      ...ac2,
      acidente: id,
      motivo: 'Lateralidade informada errada na retificação',
      ocorridoEm: ac2.ocorridoEm,
      tipo: 'tipico',
      cat: { ...CAT, lateralidade: 3 },
    } as never);
    expect((await m.esocial.detalheEvento(m.s, retificador)).evento.situacao).toBe('descartado');
    const retificador2 = ret2.esocial!.evento!;
    await m.aceitar(retificador2, '1.2.0000000000000000102');
    expect((await m.esocial.detalheEvento(m.s, original)).evento.situacao).toBe('substituido');

    // Anulação: S-3000 do S-2210 aceito (o retificador); o original e o retificador ficam guardados.
    const ac3 = await m.sesmt.acidente(m.s, id);
    const anul = await m.sesmt.anularAcidente(m.s, {
      acidente: id,
      versao: ac3.versao,
      motivo: 'Acidente lançado no colaborador errado',
    });
    expect(anul.esocial).toMatchObject({ operacao: 'exclusao', anterior: retificador2, valido: true });
    const exclusao = await m.esocial.detalheEvento(m.s, anul.esocial!.evento!);
    expect(exclusao.evento).toMatchObject({ evento: 'S-3000', eventoAnterior: retificador2 });
    expect(exclusao.xml).toContain('<nrRecEvt>1.2.0000000000000000102</nrRecEvt>');
    const fila = await m.esocial.eventosCat(m.s, id);
    expect(fila.map((x) => [x.id, x.situacao]).sort()).toEqual(
      [
        [original, 'substituido'],
        [retificador, 'descartado'],
        [retificador2, 'aceito'],
      ].sort(),
    );
    const anulado = await m.sesmt.acidente(m.s, id);
    expect(anulado).toMatchObject({ estado: 'encerrado', anuladoPor: 'SINT.SESMT' });
    expect(anulado.motivoEncerramento).toBe('Acidente lançado no colaborador errado');
    // O detalhe traz o histórico (retificações e anulação com motivo e valor anterior) e os eventos da fila.
    expect(anulado.correcoes!.map((c) => c.operacao)).toEqual([
      'acidente.anulado',
      'acidente.retificado',
      'acidente.retificado',
    ]);
    expect(anulado.correcoes![1]!).toMatchObject({
      antes: { cat: { lateralidade: 1 } },
      depois: { cat: { lateralidade: 3 } },
    });
    expect(anulado.esocial!.empresas.length).toBeGreaterThan(0);
    expect(anulado.esocial!.eventos.map((x) => x.id)).toEqual([retificador2, retificador, original]);
    expect(anulado.esocial!.eventos[0]).toMatchObject({ anterior: original, situacao: 'aceito' });
    expect(
      await codigo(m.sesmt.anularAcidente(m.s, { acidente: id, versao: anulado.versao, motivo: MOTIVO })),
    ).toBe('acidente-anulado');
    expect(
      await codigo(
        m.sesmt.retificarAcidente(m.s, { ...(anulado as object), acidente: id, motivo: MOTIVO } as never),
      ),
    ).toBe('acidente-anulado');
    // O painel não conta o anulado.
    expect((await m.porta.resumo(CTX, 2026)).acidentes.some((a) => a.id === id)).toBe(false);
  });

  it('retificação que vai ao eSocial com pendência recusa sem mudar nada; em lote recusa; não enviado se descarta na anulação', async () => {
    const m = await montar();
    const id = await m.acidente();
    const original = (await m.sesmt.gerarCatEsocial(m.s, { acidente: id, empresa: 1, gravar: true }))
      .eventos[0]!.id!;
    // Em lote: espera o retorno.
    const l = await m.esocial.montarLote(m.s, { empresa: 1, eventos: [original] });
    const ac = await m.sesmt.acidente(m.s, id);
    const base = {
      acidente: id,
      versao: ac.versao,
      motivo: MOTIVO,
      ocorridoEm: ac.ocorridoEm,
      tipo: 'tipico' as const,
      local: ac.local,
      descricao: ac.descricao,
      parteCorpo: ac.parteCorpo,
      natureza: ac.natureza,
      agente: ac.agente,
      situacao: ac.situacao,
      afastamento: false,
      obito: false,
      cat: CAT,
    };
    expect(await codigo(m.sesmt.retificarAcidente(m.s, base))).toBe('evento-em-transito');
    expect(
      await codigo(m.sesmt.anularAcidente(m.s, { acidente: id, versao: ac.versao, motivo: MOTIVO })),
    ).toBe('evento-em-transito');
    await m.esocial.enviarLote(m.s, l.lote.id, { versao: 0 });
    await m.esocial.registrarRetorno(m.s, l.lote.id, {
      versao: 1,
      protocolo: null,
      eventos: [
        {
          evento: original,
          aceito: true,
          recibo: '1.2.0000000000000000201',
          codigo: '201',
          descricao: 'Sucesso',
        },
      ],
    });
    // Retificação sem o CID do atestado: o retificador teria pendência; nada muda (nem o acidente, nem a fila).
    expect(await codigo(m.sesmt.retificarAcidente(m.s, { ...base, cat: { ...CAT, cid: null } }))).toBe(
      'cat-com-pendencia',
    );
    expect((await m.sesmt.acidente(m.s, id)).versao).toBe(ac.versao);
    expect(await m.porta.correcoes(CTX, 'comunicacao_acidente', [id])).toEqual([]);
    // Versão velha: desatualizado.
    expect(await codigo(m.sesmt.retificarAcidente(m.s, { ...base, versao: ac.versao - 1 }))).toBe(
      'desatualizado',
    );

    // Outro acidente só com o original gerado (não enviado): a anulação o descarta.
    const id2 = await m.acidente();
    const ev2 = (await m.sesmt.gerarCatEsocial(m.s, { acidente: id2, empresa: 1, gravar: true })).eventos[0]!
      .id!;
    const a2 = await m.sesmt.acidente(m.s, id2);
    const anul = await m.sesmt.anularAcidente(m.s, { acidente: id2, versao: a2.versao, motivo: MOTIVO });
    expect(anul.esocial).toMatchObject({ operacao: 'descarte', evento: null, anterior: ev2 });
    expect((await m.esocial.detalheEvento(m.s, ev2)).evento).toMatchObject({ situacao: 'descartado' });

    // Revisão W0-06: anular o já encerrado preserva quem encerrou e a data; o motivo e o autor anteriores vão ao
    // histórico (antes).
    const id4 = await m.acidente(null);
    const a4 = await m.sesmt.acidente(m.s, id4);
    await m.sesmt.encerrarAcidente(m.s, {
      acidente: id4,
      versao: a4.versao,
      motivo: 'Acompanhamento concluído sem sequela',
    } as never);
    const e4 = await m.sesmt.acidente(m.s, id4);
    const outro = { ...m.s, login: 'SINT.SESMT2' };
    await m.sesmt.anularAcidente(outro, { acidente: id4, versao: e4.versao, motivo: MOTIVO });
    const lido4 = await m.porta.acidente(CTX, id4);
    expect(lido4).toMatchObject({
      encerradoPor: 'SINT.SESMT',
      encerradoEm: e4.encerradoEm,
      anuladoPor: 'SINT.SESMT2',
    });
    const corr4 = await m.porta.correcoes(CTX, 'comunicacao_acidente', [id4]);
    expect(corr4[0]).toMatchObject({
      operacao: 'acidente.anulado',
      por: 'SINT.SESMT2',
      antes: {
        estado: 'encerrado',
        motivoEncerramento: 'Acompanhamento concluído sem sequela',
        encerradoPor: 'SINT.SESMT',
        encerradoEm: e4.encerradoEm,
      },
    });

    // Sem nada na fila: a retificação só muda o acidente (a CAT incompleta fica como pendência da geração).
    const id3 = await m.acidente(null);
    const a3 = await m.sesmt.acidente(m.s, id3);
    const r3 = await m.sesmt.retificarAcidente(m.s, { ...base, acidente: id3, versao: a3.versao });
    expect(r3.esocial).toMatchObject({ operacao: 'nenhuma' });
    expect((await m.sesmt.acidente(m.s, id3)).cat.cid).toBe('W260');
  });
});

describe('W0-06: cancelamento da entrega de EPI', () => {
  it('cancela com motivo e guarda; não se assina nem conta; o segundo cancelamento recusa', async () => {
    const m = await montar();
    const { id } = await m.sesmt.registrarEpi(m.s, {
      vinculo: m.v,
      tipo: 'epi',
      data: '2026-10-26',
      epi: 'Luva de procedimento',
      caNumero: '12345',
      caValidade: '2027-10-01',
      quantidade: 2,
      observacao: null,
    } as never);
    const r = await m.sesmt.cancelarEpi(m.s, {
      entrega: id,
      tipo: 'epi',
      motivo: 'Entrega lançada em dobro no posto',
    });
    expect(r.mensagem).toBe('Registro cancelado.');
    const epi = await m.sesmt.epiDoColaborador(m.s, m.v);
    const lido = epi.registros.find((x) => x.id === id)!;
    expect(epi.correcoes).toMatchObject([
      { operacao: 'epi.cancelado', registro: id, motivo: 'Entrega lançada em dobro no posto' },
    ]);
    expect(lido).toMatchObject({
      motivoCancelamento: 'Entrega lançada em dobro no posto',
      canceladoPor: 'SINT.SESMT',
    });
    expect(
      await codigo(m.sesmt.cancelarEpi(m.s, { entrega: id, tipo: 'epi', motivo: 'De novo por engano aqui' })),
    ).toBe('ja-cancelada');
    expect(await codigo(m.sesmt.assinarEpi(m.s, { entrega: id, conferida: true }))).toBe('ja-cancelada');
    expect((await m.porta.correcoes(CTX, 'entrega_epi', [id]))[0]).toMatchObject({
      operacao: 'epi.cancelado',
      antes: { cancelado: false, assinatura: 'pendente' },
    });
    expect((await m.porta.resumo(CTX, 2026)).epis.some((x) => x.id === id)).toBe(false);
  });
});
